import pool from "../db.js";

let tapeViewEventsSchemaReadyPromise = null;

export async function ensureTapeViewEventsSchema() {
  if (!tapeViewEventsSchemaReadyPromise) {
    tapeViewEventsSchemaReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tape_view_events (
          id BIGSERIAL PRIMARY KEY,
          post_id UUID NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
          viewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_tape_view_events_post_id
        ON tape_view_events(post_id)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_tape_view_events_viewer_id
        ON tape_view_events(viewer_id)
      `);
    })().catch((error) => {
      tapeViewEventsSchemaReadyPromise = null;
      throw error;
    });
  }

  await tapeViewEventsSchemaReadyPromise;
}
