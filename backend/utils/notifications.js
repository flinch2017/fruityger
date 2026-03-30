import { v4 as uuidv4 } from "uuid";
import pool from "../db.js";

let notificationsTableReadyPromise = null;

export async function ensureNotificationsTable() {
  if (!notificationsTableReadyPromise) {
    notificationsTableReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          notification_id UUID PRIMARY KEY,
          recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          post_id UUID REFERENCES posts(post_id) ON DELETE CASCADE,
          comment_id UUID REFERENCES comments(comment_id) ON DELETE CASCADE,
          is_read BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
        ON notifications(recipient_id, created_at DESC)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
        ON notifications(recipient_id, is_read)
      `);
    })().catch((error) => {
      notificationsTableReadyPromise = null;
      throw error;
    });
  }

  await notificationsTableReadyPromise;
}

export async function createNotification({
  recipientId,
  actorId,
  type,
  postId = null,
  commentId = null,
}) {
  if (!recipientId || !actorId || !type || recipientId === actorId) {
    return null;
  }

  try {
    await ensureNotificationsTable();

    const { rows } = await pool.query(
      `
      INSERT INTO notifications
        (notification_id, recipient_id, actor_id, type, post_id, comment_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [uuidv4(), recipientId, actorId, type, postId, commentId]
    );

    return rows[0] || null;
  } catch (error) {
    console.error("Notification creation failed:", error);
    return null;
  }
}
