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
        ALTER TABLE notifications
        ADD COLUMN IF NOT EXISTS chat_id UUID REFERENCES chats(id) ON DELETE CASCADE
      `);

      await pool.query(`
        ALTER TABLE notifications
        ADD COLUMN IF NOT EXISTS group_chat_id UUID REFERENCES group_chats(id) ON DELETE CASCADE
      `);

      await pool.query(`
        ALTER TABLE notifications
        ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES messages(id) ON DELETE CASCADE
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
        ON notifications(recipient_id, created_at DESC)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
        ON notifications(recipient_id, is_read)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_notifications_recipient_chat
        ON notifications(recipient_id, chat_id, created_at DESC)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_notifications_recipient_group_chat
        ON notifications(recipient_id, group_chat_id, created_at DESC)
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
    case "direct_message":
      return {
        title: "New message",
        body: `@${actorUsername} sent you a message.`,
      };
    case "group_message":
      return {
        title: "New group message",
        body: `@${actorUsername} sent a group message.`,
      };
    case "message_reaction":
      return {
        title: "New reaction",
        body: `@${actorUsername} reacted to your message.`,
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
        channelId: "default",
        categoryId: payload.categoryId || undefined,
        priority: "high",
        title: payload.title || "Fruityger",
        body: payload.body || "You have a new notification.",
        data: payload.data || {},
      }),
    });

    const result = await response.json().catch(() => null);
    if (!response.ok) {
      console.error("Expo push request failed:", response.status, result);
      return null;
    }

    const ticket = Array.isArray(result?.data) ? result.data[0] : result?.data;
    if (ticket?.status === "error") {
      console.error("Expo push ticket rejected:", ticket.details?.error || ticket.message || ticket);
      return null;
    }

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
  chatId = null,
  groupChatId = null,
  messageId = null,
  pushTitle = null,
  pushBody = null,
  pushCategoryId = null,
  pushData = null,
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
        (notification_id, recipient_id, actor_id, type, post_id, comment_id, chat_id, group_chat_id, message_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
      `,
      [uuidv4(), recipientId, actorId, type, postId, commentId, chatId, groupChatId, messageId]
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
      title: pushTitle || pushCopy.title,
      body: pushBody || pushCopy.body,
      categoryId: pushCategoryId || undefined,
      data:
        pushData || {
          type: "notification",
          notificationType: type,
          postId,
          commentId,
          chatId,
          groupChatId,
          messageId,
        },
    });

    return rows[0] || null;
  } catch (error) {
    console.error("Notification creation failed:", error);
    return null;
  }
}
