import pool from "../db.js";

let privateAccountSchemaReadyPromise = null;

export async function ensurePrivateAccountSchema() {
  if (!privateAccountSchemaReadyPromise) {
    privateAccountSchemaReadyPromise = (async () => {
      await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS follow_requests (
          requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          requested_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (requester_id, requested_id)
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_follow_requests_requested_created
        ON follow_requests(requested_id, created_at DESC)
      `);
    })().catch((error) => {
      privateAccountSchemaReadyPromise = null;
      throw error;
    });
  }

  await privateAccountSchemaReadyPromise;
}

export async function canViewUserActivity(viewerId, ownerId) {
  if (!viewerId || !ownerId) return false;
  if (viewerId === ownerId) return true;

  await ensurePrivateAccountSchema();

  const { rows } = await pool.query(
    `
    SELECT
      COALESCE(u.is_private, false) AS is_private,
      EXISTS (
        SELECT 1
        FROM follows f
        WHERE f.follower_id = $1
          AND f.following_id = $2
      ) AS is_following
    FROM users u
    WHERE u.id = $2
    LIMIT 1
    `,
    [viewerId, ownerId]
  );

  const target = rows[0];
  if (!target) return false;

  return !target.is_private || target.is_following;
}
