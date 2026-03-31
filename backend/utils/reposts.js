import pool from "../db.js";

let repostSchemaReadyPromise = null;

export async function ensureRepostSchema() {
  if (!repostSchemaReadyPromise) {
    repostSchemaReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS reposts (
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          post_id UUID NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, post_id)
        )
      `);
    })().catch((error) => {
      repostSchemaReadyPromise = null;
      throw error;
    });
  }

  await repostSchemaReadyPromise;
}
