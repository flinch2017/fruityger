import pool from "../db.js";

let tapeViewsSchemaReadyPromise = null;

export async function ensureTapeViewsSchema() {
  if (!tapeViewsSchemaReadyPromise) {
    tapeViewsSchemaReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tape_views (
          post_id UUID NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
          viewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (post_id, viewer_id)
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_tape_views_viewer_id
        ON tape_views(viewer_id)
      `);
    })().catch((error) => {
      tapeViewsSchemaReadyPromise = null;
      throw error;
    });
  }

  await tapeViewsSchemaReadyPromise;
}
