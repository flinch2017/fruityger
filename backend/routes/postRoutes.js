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
import { ensureHashtagSchema, extractHashtags, MAX_HASHTAGS_PER_POST, removePostHashtags, syncPostHashtags } from "../utils/hashtags.js";
import { syncPostMentions } from "../utils/mentions.js";
import { burnTapeEditsIntoVideoFile, createVideoThumbnailFile, transcodeVideoFileToMp4 } from "../utils/videoProcessing.js";
import { assertContentAllowedOrReport, ContentModerationError } from "../utils/contentModeration.js";
import { ensurePostMediaThumbnailSchema } from "../utils/postMediaSchema.js";
import { deleteR2Object } from "../utils/r2Delete.js";

const router = express.Router();
const sanitizeFileName = (value = "") =>
    String(value)
        .normalize("NFKD")
        .replace(/[^\w.\-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "file";

const parseJsonBodyField = (value) => {
    if (!value) {
        return null;
    }

    if (typeof value === "object") {
        return value;
    }

    try {
        return JSON.parse(String(value));
    } catch {
        return null;
    }
};

const getTapeEditsFromBody = (body = {}) =>
    parseJsonBodyField(body.tapeEdits) || parseJsonBodyField(body.tape_edits);

const isLowMemoryMediaMode = () =>
    String(process.env.LOW_MEMORY_MEDIA_MODE || "false").toLowerCase() === "true";

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

const deleteUploadedObjects = async (objectKeys = []) => {
    const bucketName = process.env.R2_BUCKET;
    const uniqueKeys = [...new Set(objectKeys.filter(Boolean))];

    await Promise.allSettled(
        uniqueKeys.map((key) => deleteR2Object(bucketName, key))
    );
};

const removePublishedPostAfterModeration = async (postId, objectKeys = []) => {
    try {
        await removePostHashtags(postId);
    } catch (error) {
        console.error("Failed to update hashtags for moderated post removal:", error);
    }

    try {
        await pool.query("DELETE FROM comments WHERE post_id = $1", [postId]);
        await pool.query("DELETE FROM likes WHERE post_id = $1", [postId]);
        await pool.query("DELETE FROM reposts WHERE post_id = $1", [postId]);
        await pool.query("DELETE FROM post_media WHERE post_id = $1", [postId]);
        await pool.query("DELETE FROM posts WHERE post_id = $1", [postId]);
    } catch (error) {
        console.error("Failed to remove moderated post from database:", error);
    }

    await deleteUploadedObjects(objectKeys);
};

const scanPublishedPostForModeration = async ({
    postId,
    userId,
    caption,
    media,
    objectKeys,
    isTapeUpload,
}) => {
    try {
        await assertContentAllowedOrReport({
            userId,
            contentType: "post",
            contentId: postId,
            text: caption,
            media,
            context: {
                surface: isTapeUpload ? "tape_post_publish_background" : "post_publish_background",
                media_count: media.length,
                published_before_scan: true,
            },
        });
    } catch (error) {
        if (
            error instanceof ContentModerationError &&
            (error.result?.status === "blocked" || error.result?.status === "review")
        ) {
            console.warn(`Post ${postId} removed after background moderation scan.`);
            await removePublishedPostAfterModeration(postId, objectKeys);
            return;
        }

        console.error("Background post moderation scan failed:", error);
    }
};

/* ======================================================
   CREATE POST API
====================================================== */

router.post(
    "/create",
    authenticateToken,
    upload.fields([
        { name: "media", maxCount: 4 },
        { name: "music", maxCount: 1 },
    ]),
    async (req, res) => {
        let postId = null;
        let dbClient = null;
        const cleanupTasks = [];
        const uploadedObjectKeys = [];

        try {
            await ensureHashtagSchema();
            await ensurePostMediaThumbnailSchema();

            const { caption, kind } = req.body;
            const isTapeUpload = kind === "tape";
            const lowMemoryMediaMode = isLowMemoryMediaMode();
            const tapeEdits = getTapeEditsFromBody(req.body);
            const files = Array.isArray(req.files) ? req.files : req.files?.media || [];
            const musicFile = !Array.isArray(req.files) ? req.files?.music?.[0] : null;
            const hashtagCount = extractHashtags(caption || "").length;

            if (musicFile) {
                cleanupTasks.push(() => fs.rm(musicFile.path, { force: true }));
            }

            if (musicFile && (!isTapeUpload || !musicFile.mimetype?.startsWith("audio/"))) {
                return res.status(400).json({
                    error: "Music must be an audio file for a tape upload.",
                });
            }

            if (hashtagCount > MAX_HASHTAGS_PER_POST) {
                return res.status(400).json({
                    error: `You can only use up to ${MAX_HASHTAGS_PER_POST} hashtags per post.`,
                });
            }

            /* ⭐ Insert post */
            postId = uuidv4();

            /* ===================================================
               Upload Media Files → Cloudflare R2
            =================================================== */

            const bucketName = process.env.R2_BUCKET;
            const mediaRecords = [];
            const moderationMedia = [];

            for (let i = 0; i < files.length; i++) {

                const file = files[i];
                const isVideo = file.mimetype.startsWith("video");
                let uploadBody;
                let uploadContentType;
                let uploadFileName;
                let thumbnailUrl = null;
                let thumbnailSourcePath = null;

                cleanupTasks.push(() => fs.rm(file.path, { force: true }));

                if (isVideo && !lowMemoryMediaMode) {
                    const processedFile = isTapeUpload
                        ? await burnTapeEditsIntoVideoFile(file.path, file.originalname, tapeEdits, musicFile?.path || null)
                        : await transcodeVideoFileToMp4(file.path, file.originalname);
                    cleanupTasks.push(processedFile.cleanup);
                    uploadBody = createReadStream(processedFile.outputPath);
                    uploadContentType = processedFile.mimetype;
                    uploadFileName = sanitizeFileName(processedFile.fileName);
                    thumbnailSourcePath = processedFile.outputPath;
                } else {
                    uploadBody = createReadStream(file.path);
                    uploadContentType = file.mimetype;
                    uploadFileName = sanitizeFileName(file.originalname);
                }

                const mediaId = uuidv4();

                const key = `posts/${postId}/${mediaId}-${uploadFileName}`;
                uploadedObjectKeys.push(key);

                await r2.send(
                    new PutObjectCommand({
                        Bucket: bucketName,
                        Key: key,
                        Body: uploadBody,
                        ContentType: uploadContentType
                    })
                );

                const mediaUrl = `${process.env.R2_PUBLIC_URL}/${key}`;

                if (isVideo && !lowMemoryMediaMode) {
                    const thumbnail = await createVideoThumbnailFile(
                        thumbnailSourcePath || file.path,
                        uploadFileName
                    );
                    cleanupTasks.push(thumbnail.cleanup);

                    const thumbnailFileName = sanitizeFileName(thumbnail.fileName);
                    const thumbnailKey = `posts/${postId}/${mediaId}-${thumbnailFileName}`;
                    uploadedObjectKeys.push(thumbnailKey);

                    await r2.send(
                        new PutObjectCommand({
                            Bucket: bucketName,
                            Key: thumbnailKey,
                            Body: createReadStream(thumbnail.outputPath),
                            ContentType: thumbnail.mimetype
                        })
                    );

                    thumbnailUrl = `${process.env.R2_PUBLIC_URL}/${thumbnailKey}`;
                }

                moderationMedia.push({
                    kind: isVideo ? "video" : file.mimetype?.startsWith("image") ? "image" : "other",
                    filePath: thumbnailSourcePath || file.path,
                    mimetype: uploadContentType,
                    originalName: uploadFileName,
                });

                mediaRecords.push([
                    mediaId,
                    postId,
                    mediaUrl,
                    isVideo ? "video" : "image",
                    i,
                    thumbnailUrl
                ]);
            }

            /* ===================================================
               Insert Media Metadata
            =================================================== */

            dbClient = await pool.connect();
            await dbClient.query("BEGIN");

            await dbClient.query(
                `INSERT INTO posts (post_id, user_id, caption)
                 VALUES ($1,$2,$3)`,
                [postId, req.user.id, caption]
            );

            if (mediaRecords.length > 0) {
                await dbClient.query(
                    `INSERT INTO post_media
                    (media_id, post_id, media_url, media_type, media_order, thumbnail_url)
                    VALUES ${mediaRecords.map((_, i) =>
                        `($${i*6+1},$${i*6+2},$${i*6+3},$${i*6+4},$${i*6+5},$${i*6+6})`
                    ).join(",")}`,
                    mediaRecords.flat()
                );
            }

            await dbClient.query("COMMIT");
            dbClient.release();
            dbClient = null;

            await syncPostHashtags(postId, caption);
            await syncPostMentions(postId, caption, req.user.id);

            res.json({
                success: true,
                post_id: postId
            });

            await scanPublishedPostForModeration({
                postId,
                userId: req.user.id,
                caption,
                media: moderationMedia,
                objectKeys: uploadedObjectKeys,
                isTapeUpload,
            });

        } catch (err) {
            console.error(err);

            if (dbClient) {
                try {
                    await dbClient.query("ROLLBACK");
                } catch (rollbackError) {
                    console.error("Failed to rollback post transaction:", rollbackError);
                } finally {
                    dbClient.release();
                    dbClient = null;
                }
            }

            if (postId) {
                try {
                    await pool.query(`DELETE FROM posts WHERE post_id = $1`, [postId]);
                } catch (cleanupError) {
                    console.error("Failed to rollback post after upload error:", cleanupError);
                }
            }

            await deleteUploadedObjects(uploadedObjectKeys);

            if (res.headersSent) {
                return;
            }

            if (err instanceof ContentModerationError) {
                return res.status(err.statusCode || 400).json({
                    error: err.message,
                    moderation: err.result,
                });
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
