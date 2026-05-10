import express from "express";
import pool from "../db.js";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { createReadStream } from "fs";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { r2 } from "../utils/r2.js";
import { authenticateToken } from "../middleware/auth.js";
import { ensureHashtagSchema, extractHashtags, MAX_HASHTAGS_PER_POST, syncPostHashtags } from "../utils/hashtags.js";
import { transcodeVideoFileToMp4 } from "../utils/videoProcessing.js";

const router = express.Router();
const sanitizeFileName = (value = "") =>
    String(value)
        .normalize("NFKD")
        .replace(/[^\w.\-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "file";

const tempUploadDir = path.join(os.tmpdir(), "fruityger-post-uploads");

await fs.mkdir(tempUploadDir, { recursive: true });

const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, tempUploadDir),
        filename: (_req, file, cb) => {
            const ext = path.extname(file.originalname) || "";
            cb(null, `${Date.now()}-${uuidv4()}${ext}`);
        }
    }),
    limits: {
        fileSize: 150 * 1024 * 1024 // 150MB raw upload limit before compression
    }
});

/* ======================================================
   CREATE POST API
====================================================== */

router.post(
    "/create",
    authenticateToken,
    upload.array("media", 4),
    async (req, res) => {
        let postId = null;
        const cleanupTasks = [];

        try {
            await ensureHashtagSchema();

            const { caption } = req.body;
            const files = req.files || [];
            const hashtagCount = extractHashtags(caption || "").length;

            if (hashtagCount > MAX_HASHTAGS_PER_POST) {
                return res.status(400).json({
                    error: `You can only use up to ${MAX_HASHTAGS_PER_POST} hashtags per post.`,
                });
            }

            /* ⭐ Insert post */
            postId = uuidv4();

            await pool.query(
                `INSERT INTO posts (post_id, user_id, caption)
                 VALUES ($1,$2,$3)`,
                [postId, req.user.id, caption]
            );

            await syncPostHashtags(postId, caption);

            /* ===================================================
               Upload Media Files → Cloudflare R2
            =================================================== */

            const bucketName = process.env.R2_BUCKET;
            const mediaRecords = [];

            for (let i = 0; i < files.length; i++) {

                const file = files[i];
                const isVideo = file.mimetype.startsWith("video");
                let uploadBody;
                let uploadContentType;
                let uploadFileName;

                cleanupTasks.push(() => fs.rm(file.path, { force: true }));

                if (isVideo) {
                    const processedFile = await transcodeVideoFileToMp4(file.path, file.originalname);
                    cleanupTasks.push(processedFile.cleanup);
                    uploadBody = createReadStream(processedFile.outputPath);
                    uploadContentType = processedFile.mimetype;
                    uploadFileName = sanitizeFileName(processedFile.fileName);
                } else {
                    uploadBody = createReadStream(file.path);
                    uploadContentType = file.mimetype;
                    uploadFileName = sanitizeFileName(file.originalname);
                }

                const mediaId = uuidv4();

                const key = `posts/${postId}/${mediaId}-${uploadFileName}`;

                await r2.send(
                    new PutObjectCommand({
                        Bucket: bucketName,
                        Key: key,
                        Body: uploadBody,
                        ContentType: uploadContentType
                    })
                );

                const mediaUrl = `${process.env.R2_PUBLIC_URL}/${key}`;

                mediaRecords.push([
                    mediaId,
                    postId,
                    mediaUrl,
                    isVideo ? "video" : "image",
                    i
                ]);
            }

            /* ===================================================
               Insert Media Metadata
            =================================================== */

            if (mediaRecords.length > 0) {
                await pool.query(
                    `INSERT INTO post_media
                    (media_id, post_id, media_url, media_type, media_order)
                    VALUES ${mediaRecords.map((_, i) =>
                        `($${i*5+1},$${i*5+2},$${i*5+3},$${i*5+4},$${i*5+5})`
                    ).join(",")}`,
                    mediaRecords.flat()
                );
            }

            res.json({
                success: true,
                post_id: postId
            });

        } catch (err) {
            console.error(err);

            if (postId) {
                try {
                    await pool.query(`DELETE FROM posts WHERE post_id = $1`, [postId]);
                } catch (cleanupError) {
                    console.error("Failed to rollback post after upload error:", cleanupError);
                }
            }

            res.status(500).json({
                error: err?.message || "Post creation failed"
            });
        } finally {
            await Promise.allSettled(cleanupTasks.map((cleanup) => cleanup()));
        }
    }
);

export default router;
