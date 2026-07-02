import pool from "../db.js";

let postMediaThumbnailSchemaReadyPromise = null;

export async function ensurePostMediaThumbnailSchema() {
  if (!postMediaThumbnailSchemaReadyPromise) {
    postMediaThumbnailSchemaReadyPromise = pool
      .query(`
        ALTER TABLE IF EXISTS post_media
        ADD COLUMN IF NOT EXISTS thumbnail_url TEXT
      `)
      .catch((error) => {
        postMediaThumbnailSchemaReadyPromise = null;
        throw error;
      });
  }

  await postMediaThumbnailSchemaReadyPromise;
}
