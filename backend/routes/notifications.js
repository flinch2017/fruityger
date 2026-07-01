import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";
import { ensureNotificationsTable } from "../utils/notifications.js";

const router = express.Router();

const CHAT_ALERT_NOTIFICATION_TYPES = [
  "direct_message",
  "group_message",
  "group_message_reply",
  "message_reaction",
  "group_message_reaction",
];

router.get("/", authenticateToken, async (req, res) => {
  try {
    await ensureNotificationsTable();

    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const offset = parseInt(req.query.offset, 10) || 0;

    const { rows } = await pool.query(
      `
      SELECT
        n.notification_id,
        n.type,
        n.post_id,
        n.comment_id,
        n.chat_id,
        n.group_chat_id,
        n.message_id,
        n.game_lobby_id,
        n.game_match_id,
        n.is_read,
        n.created_at,
        u.id AS actor_id,
        u.username AS actor_username,
        u.profile_pic AS actor_profile_pic,
        p.caption AS post_caption,
        c.commented_text AS comment_text
      FROM notifications n
      JOIN users u
        ON u.id = n.actor_id
      LEFT JOIN posts p
        ON p.post_id = n.post_id
      LEFT JOIN comments c
        ON c.comment_id = n.comment_id
      WHERE n.recipient_id = $1
        AND n.type <> ALL($4::text[])
      ORDER BY n.created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [req.user.id, limit, offset, CHAT_ALERT_NOTIFICATION_TYPES]
    );

    res.json({ notifications: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

router.get("/unread-count", authenticateToken, async (req, res) => {
  try {
    await ensureNotificationsTable();

    const { rows } = await pool.query(
      `
      SELECT COUNT(*)::int AS unread_count
      FROM notifications
      WHERE recipient_id = $1
        AND is_read = false
        AND type <> ALL($2::text[])
      `,
      [req.user.id, CHAT_ALERT_NOTIFICATION_TYPES]
    );

    res.json({ unreadCount: rows[0]?.unread_count || 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch unread count" });
  }
});

router.post("/read-all", authenticateToken, async (req, res) => {
  try {
    await ensureNotificationsTable();

    await pool.query(
      `
      UPDATE notifications
      SET is_read = true
      WHERE recipient_id = $1
        AND is_read = false
        AND type <> ALL($2::text[])
      `,
      [req.user.id, CHAT_ALERT_NOTIFICATION_TYPES]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to mark notifications as read" });
  }
});

router.post("/clear", authenticateToken, async (req, res) => {
  try {
    await ensureNotificationsTable();

    const { notificationIds = [], clearAll = false } = req.body || {};

    if (!clearAll && (!Array.isArray(notificationIds) || notificationIds.length === 0)) {
      return res.status(400).json({ error: "notificationIds are required" });
    }

    if (clearAll) {
      await pool.query(
        `
        DELETE FROM notifications
        WHERE recipient_id = $1
          AND type <> ALL($2::text[])
        `,
        [req.user.id, CHAT_ALERT_NOTIFICATION_TYPES]
      );

      return res.json({ success: true });
    }

    await pool.query(
      `
      DELETE FROM notifications
      WHERE recipient_id = $1
        AND notification_id = ANY($2::uuid[])
      `,
      [req.user.id, notificationIds]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to clear notifications" });
  }
});

export default router;
