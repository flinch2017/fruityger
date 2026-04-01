import express from "express";
import pool from "../db.js";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "../utils/r2.js";
import { authenticateToken } from "../middleware/auth.js";
import { ensureHashtagSchema, syncPostHashtags } from "../utils/hashtags.js";
import { transcodeVideoToMp4 } from "../utils/videoProcessing.js";

const router = express.Router();
const sanitizeFileName = (value = "") =>
    String(value)
        .normalize("NFKD")
        .replace(/[^\w.\-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "file";

/* Memory storage (files go directly to buffer) */
const upload = multer({
    storage: multer.memoryStorage(),
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

        try {
            await ensureHashtagSchema();

            const { caption } = req.body;
            const files = req.files || [];

            /* ⭐ Insert post */
            const postId = uuidv4();

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
                const processedFile = isVideo
                    ? await transcodeVideoToMp4(file.buffer, file.originalname)
                    : {
                        buffer: file.buffer,
                        mimetype: file.mimetype,
                        fileName: sanitizeFileName(file.originalname),
                    };

                const mediaId = uuidv4();

                const key = `posts/${postId}/${mediaId}-${sanitizeFileName(processedFile.fileName)}`;

                await r2.send(
                    new PutObjectCommand({
                        Bucket: bucketName,
                        Key: key,
                        Body: processedFile.buffer,
                        ContentType: processedFile.mimetype
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
            res.status(500).json({
                error: err?.message || "Post creation failed"
            });
        }
    }
);

export default router;
