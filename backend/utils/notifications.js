import { v4 as uuidv4 } from "uuid";
import pool from "../db.js";

let notificationsTableReadyPromise = null;
let pushSubscriptionsTableReadyPromise = null;

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

export async function ensurePushNotificationSubscriptionsTable() {
  if (!pushSubscriptionsTableReadyPromise) {
    pushSubscriptionsTableReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS push_notification_subscriptions (
          user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          expo_push_token TEXT UNIQUE,
          platform TEXT,
          subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        ALTER TABLE push_notification_subscriptions
        ADD COLUMN IF NOT EXISTS expo_push_token TEXT
      `);

      await pool.query(`
        ALTER TABLE push_notification_subscriptions
        ADD COLUMN IF NOT EXISTS platform TEXT
      `);

      await pool.query(`
        ALTER TABLE push_notification_subscriptions
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      `);

      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_push_notification_subscriptions_token
        ON push_notification_subscriptions(expo_push_token)
        WHERE expo_push_token IS NOT NULL
      `);
    })().catch((error) => {
      pushSubscriptionsTableReadyPromise = null;
      throw error;
    });
  }

  await pushSubscriptionsTableReadyPromise;
}

const getNotificationPushCopy = (type, actorUsername = "Someone") => {
  switch (type) {
    case "new_follower":
      return {
        title: "New follower",
        body: `@${actorUsername} started following you.`,
      };
    case "post_like":
      return {
        title: "New like",
        body: `@${actorUsername} liked your post.`,
      };
    case "post_comment":
      return {
        title: "New comment",
        body: `@${actorUsername} commented on your post.`,
      };
    case "comment_reply":
      return {
        title: "New reply",
        body: `@${actorUsername} replied to your comment.`,
      };
    case "post_repost":
      return {
        title: "New repost",
        body: `@${actorUsername} reposted your post.`,
      };
    default:
      return {
        title: "Fruityger",
        body: `@${actorUsername} sent you an update.`,
      };
  }
};

export async function sendPushToUser(recipientId, payload = {}) {
  if (!recipientId) {
    return null;
  }

  try {
    await ensurePushNotificationSubscriptionsTable();

    const { rows } = await pool.query(
      `
      SELECT expo_push_token
      FROM push_notification_subscriptions
      WHERE user_id = $1
        AND expo_push_token IS NOT NULL
      LIMIT 1
      `,
      [recipientId]
    );

    const expoPushToken = rows[0]?.expo_push_token;
    if (!expoPushToken) {
      return null;
    }

    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        to: expoPushToken,
        sound: "default",
        title: payload.title || "Fruityger",
        body: payload.body || "You have a new notification.",
        data: payload.data || {},
      }),
    });

    const result = await response.json().catch(() => null);
    return result;
  } catch (error) {
    console.error("Push notification send failed:", error);
    return null;
  }
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
    await ensurePushNotificationSubscriptionsTable();

    const { rows } = await pool.query(
      `
      INSERT INTO notifications
        (notification_id, recipient_id, actor_id, type, post_id, comment_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [uuidv4(), recipientId, actorId, type, postId, commentId]
    );

    const actorResult = await pool.query(
      `
      SELECT username
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [actorId]
    );

    const actorUsername = actorResult.rows[0]?.username || "someone";
    const pushCopy = getNotificationPushCopy(type, actorUsername);

    await sendPushToUser(recipientId, {
      title: pushCopy.title,
      body: pushCopy.body,
      data: {
        type: "notification",
        notificationType: type,
        postId,
        commentId,
      },
    });

    return rows[0] || null;
  } catch (error) {
    console.error("Notification creation failed:", error);
    return null;
  }
}
