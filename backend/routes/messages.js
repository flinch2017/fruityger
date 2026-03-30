import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

let deletedChatsTableReadyPromise = null;

async function ensureDeletedChatsTable() {
  if (!deletedChatsTableReadyPromise) {
    deletedChatsTableReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS deleted_chats (
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
          deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, chat_id)
        )
      `);
    })().catch((error) => {
      deletedChatsTableReadyPromise = null;
      throw error;
    });
  }

  await deletedChatsTableReadyPromise;
}

router.get("/chats", authenticateToken, async (req, res) => {
  const userId = req.user.id;

  try {
    await ensureDeletedChatsTable();

    const { rows } = await pool.query(
      `
      SELECT
        c.*,
        dc.deleted_at,
        m.id AS last_message_id,
        m.content AS last_message,
        m.created_at AS last_message_at,
        m.sender_id AS last_message_sender_id,
        m.read_status AS last_message_read,
        (
          SELECT COUNT(*)::int
          FROM messages unread
          LEFT JOIN deleted_messages unread_dm
            ON unread_dm.message_id = unread.id
           AND unread_dm.user_id = $1
          WHERE unread.chat_id = c.id
            AND unread.receiver_id = $1
            AND unread.read_status = FALSE
            AND unread_dm.message_id IS NULL
            AND (
              dc.deleted_at IS NULL OR unread.created_at > dc.deleted_at
            )
        ) AS unread_count,
        u1.id AS user1_id,
        u1.username AS user1_username,
        u1.profile_pic AS user1_profile_pic,
        u2.id AS user2_id,
        u2.username AS user2_username,
        u2.profile_pic AS user2_profile_pic
      FROM chats c
      LEFT JOIN deleted_chats dc
        ON dc.chat_id = c.id
       AND dc.user_id = $1
      LEFT JOIN LATERAL (
        SELECT m.*
        FROM messages m
        LEFT JOIN deleted_messages dm
          ON dm.message_id = m.id
         AND dm.user_id = $1
        WHERE m.chat_id = c.id
          AND dm.message_id IS NULL
          AND (
            dc.deleted_at IS NULL OR m.created_at > dc.deleted_at
          )
        ORDER BY m.created_at DESC
        LIMIT 1
      ) m ON true
      JOIN users u1
        ON u1.id = c.user1_id
      JOIN users u2
        ON u2.id = c.user2_id
      WHERE (c.user1_id = $1 OR c.user2_id = $1)
        AND (
          dc.chat_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM messages visible_message
            LEFT JOIN deleted_messages visible_dm
              ON visible_dm.message_id = visible_message.id
             AND visible_dm.user_id = $1
            WHERE visible_message.chat_id = c.id
              AND visible_dm.message_id IS NULL
              AND visible_message.created_at > dc.deleted_at
          )
        )
      ORDER BY m.created_at DESC NULLS LAST
      `,
      [userId]
    );

    const formatted = rows.map((chat) => ({
      id: chat.id,
      last_message: chat.last_message,
      last_message_at: chat.last_message_at,
      last_message_sender_id: chat.last_message_sender_id,
      last_message_read: chat.last_message_read,
      unread_count: chat.unread_count,
      user1: {
        id: chat.user1_id,
        username: chat.user1_username,
        profile_pic: chat.user1_profile_pic,
      },
      user2: {
        id: chat.user2_id,
        username: chat.user2_username,
        profile_pic: chat.user2_profile_pic,
      },
    }));

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch chats" });
  }
});

router.get("/unread-count", authenticateToken, async (req, res) => {
  const userId = req.user.id;

  try {
    await ensureDeletedChatsTable();

    const { rows } = await pool.query(
      `
      SELECT COUNT(*)::int AS unread_count
      FROM messages m
      JOIN chats c
        ON c.id = m.chat_id
      LEFT JOIN deleted_chats dc
        ON dc.chat_id = c.id
       AND dc.user_id = $1
      LEFT JOIN deleted_messages dm
        ON dm.message_id = m.id
       AND dm.user_id = $1
      WHERE m.receiver_id = $1
        AND m.read_status = FALSE
        AND dm.message_id IS NULL
        AND (
          dc.deleted_at IS NULL OR m.created_at > dc.deleted_at
        )
      `,
      [userId]
    );

    res.json({ unreadCount: rows[0]?.unread_count || 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch unread message count" });
  }
});

router.post("/send", authenticateToken, async (req, res) => {
  const { chatId, receiverId, content } = req.body;
  const senderId = req.user.id;

  try {
    await ensureDeletedChatsTable();

    await pool.query(`
      CREATE TABLE IF NOT EXISTS blocked_users (
        blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (blocker_id, blocked_id)
      )
    `);

    const blockedResult = await pool.query(
      `
      SELECT 1
      FROM blocked_users
      WHERE (blocker_id = $1 AND blocked_id = $2)
         OR (blocker_id = $2 AND blocked_id = $1)
      LIMIT 1
      `,
      [senderId, receiverId]
    );

    if (blockedResult.rows.length > 0) {
      return res.status(403).json({ error: "Messaging is unavailable with this user" });
    }

    const message = await pool.query(
      `
      INSERT INTO messages (chat_id, sender_id, receiver_id, content)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [chatId, senderId, receiverId, content]
    );

    await pool.query(
      `
      UPDATE chats
      SET last_message = $1, last_message_at = CURRENT_TIMESTAMP
      WHERE id = $2
      `,
      [content, chatId]
    );

    res.json(message.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

router.post("/delete-chats", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { chatIds = [] } = req.body || {};

  if (!Array.isArray(chatIds) || chatIds.length === 0) {
    return res.status(400).json({ error: "chatIds are required" });
  }

  try {
    await ensureDeletedChatsTable();

    const participantChats = await pool.query(
      `
      SELECT id
      FROM chats
      WHERE id = ANY($1::uuid[])
        AND (user1_id = $2 OR user2_id = $2)
      `,
      [chatIds, userId]
    );

    const allowedChatIds = participantChats.rows.map((row) => row.id);

    if (allowedChatIds.length === 0) {
      return res.status(404).json({ error: "No chats found" });
    }

    await pool.query(
      `
      INSERT INTO deleted_chats (user_id, chat_id, deleted_at)
      SELECT $2, UNNEST($1::uuid[]), NOW()
      ON CONFLICT (user_id, chat_id)
      DO UPDATE SET deleted_at = EXCLUDED.deleted_at
      `,
      [allowedChatIds, userId]
    );

    res.json({ success: true, chatIds: allowedChatIds });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete chats" });
  }
});

router.get("/search-users", authenticateToken, async (req, res) => {
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({ error: "Query is required" });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT id, username, profile_pic
      FROM users
      WHERE username ILIKE $1
      LIMIT 15
      `,
      [`%${q}%`]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to search users" });
  }
});

router.get("/:chatId", authenticateToken, async (req, res) => {
  const { chatId } = req.params;
  const userId = req.user.id;

  try {
    await ensureDeletedChatsTable();

    const chatResult = await pool.query(
      `
      SELECT
        c.id,
        c.user1_id,
        c.user2_id,
        dc.deleted_at,
        u1.username AS user1_username,
        u1.profile_pic AS user1_profile_pic,
        u2.username AS user2_username,
        u2.profile_pic AS user2_profile_pic
      FROM chats c
      LEFT JOIN deleted_chats dc
        ON dc.chat_id = c.id
       AND dc.user_id = $2
      JOIN users u1
        ON u1.id = c.user1_id
      JOIN users u2
        ON u2.id = c.user2_id
      WHERE c.id = $1
      `,
      [chatId, userId]
    );

    if (chatResult.rows.length === 0) {
      return res.status(404).json({ error: "Chat not found" });
    }

    const chat = chatResult.rows[0];

    await pool.query(`
      CREATE TABLE IF NOT EXISTS blocked_users (
        blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (blocker_id, blocked_id)
      )
    `);

    const otherUserId =
      String(chat.user1_id) === String(userId)
        ? chat.user2_id
        : chat.user1_id;

    const blockResult = await pool.query(
      `
      SELECT
        EXISTS (
          SELECT 1
          FROM blocked_users
          WHERE blocker_id = $1
            AND blocked_id = $2
        ) AS blocked_by_me,
        EXISTS (
          SELECT 1
          FROM blocked_users
          WHERE blocker_id = $2
            AND blocked_id = $1
        ) AS blocked_by_them
      `,
      [userId, otherUserId]
    );

    await pool.query(
      `
      UPDATE messages
      SET read_status = TRUE
      WHERE chat_id = $1
        AND receiver_id = $2
        AND read_status = FALSE
        AND (
          $3::timestamptz IS NULL OR created_at > $3::timestamptz
        )
      `,
      [chatId, userId, chat.deleted_at]
    );

    const messagesResult = await pool.query(
      `
      SELECT m.*
      FROM messages m
      LEFT JOIN deleted_messages dm
        ON dm.message_id = m.id
       AND dm.user_id = $2
      WHERE m.chat_id = $1
        AND dm.message_id IS NULL
        AND (
          $3::timestamptz IS NULL OR m.created_at > $3::timestamptz
        )
      ORDER BY m.created_at ASC
      `,
      [chatId, userId, chat.deleted_at]
    );

    res.json({
      chat: {
        id: chat.id,
        blocked_by_me: blockResult.rows[0]?.blocked_by_me || false,
        blocked_by_them: blockResult.rows[0]?.blocked_by_them || false,
        user1: {
          id: chat.user1_id,
          username: chat.user1_username,
          profile_pic: chat.user1_profile_pic,
        },
        user2: {
          id: chat.user2_id,
          username: chat.user2_username,
          profile_pic: chat.user2_profile_pic,
        },
      },
      messages: messagesResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch chat" });
  }
});

router.post("/:chatId/read", authenticateToken, async (req, res) => {
  const { chatId } = req.params;
  const userId = req.user.id;

  try {
    await ensureDeletedChatsTable();

    const deletedChatResult = await pool.query(
      `
      SELECT deleted_at
      FROM deleted_chats
      WHERE user_id = $1
        AND chat_id = $2
      `,
      [userId, chatId]
    );

    const deletedAt = deletedChatResult.rows[0]?.deleted_at || null;

    await pool.query(
      `
      UPDATE messages
      SET read_status = TRUE
      WHERE chat_id = $1
        AND receiver_id = $2
        AND read_status = FALSE
        AND (
          $3::timestamptz IS NULL OR created_at > $3::timestamptz
        )
      `,
      [chatId, userId, deletedAt]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to mark messages as read" });
  }
});

router.delete("/:messageId", authenticateToken, async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user.id;

  try {
    const { rows } = await pool.query(
      `
      DELETE FROM messages
      WHERE id = $1 AND sender_id = $2
      RETURNING *
      `,
      [messageId, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Message not found or not allowed" });
    }

    return res.json({ success: true, message: rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to delete message" });
  }
});

router.post("/delete-for-me", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { messageId } = req.body;

  if (!messageId) {
    return res.status(400).json({ error: "messageId is required" });
  }

  try {
    const messageResult = await pool.query(
      `
      SELECT id
      FROM messages
      WHERE id = $1
        AND (sender_id = $2 OR receiver_id = $2)
      `,
      [messageId, userId]
    );

    if (messageResult.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    await pool.query(
      `
      INSERT INTO deleted_messages (user_id, message_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, message_id) DO NOTHING
      `,
      [userId, messageId]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to delete message for user" });
  }
});

router.post("/report", authenticateToken, async (req, res) => {
  const reporterId = req.user.id;
  const { messageId, reason = "message", details = null } = req.body;

  if (!messageId) {
    return res.status(400).json({ error: "messageId is required" });
  }

  try {
    const messageResult = await pool.query(
      `
      SELECT id, chat_id
      FROM messages
      WHERE id = $1
      `,
      [messageId]
    );

    if (messageResult.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    const message = messageResult.rows[0];
    const reportDetails = details
      ? `${details}\nReported message ID: ${messageId}`
      : `Reported message ID: ${messageId}`;

    const { rows } = await pool.query(
      `
      INSERT INTO reports (reporter_id, content_type, content_id, reason, details)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [reporterId, "message", message.chat_id, reason, reportDetails]
    );

    return res.status(201).json({ success: true, report: rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to report message" });
  }
});

router.post("/get-or-create", authenticateToken, async (req, res) => {
  const senderId = req.user.id;
  const { targetUserId } = req.body;

  try {
    await ensureDeletedChatsTable();

    const existing = await pool.query(
      `
      SELECT *
      FROM chats
      WHERE (user1_id = $1 AND user2_id = $2)
         OR (user1_id = $2 AND user2_id = $1)
      `,
      [senderId, targetUserId]
    );

    if (existing.rows.length > 0) {
      return res.json({ chatId: existing.rows[0].id });
    }

    const newChat = await pool.query(
      `
      INSERT INTO chats (user1_id, user2_id, last_message_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      RETURNING id
      `,
      [senderId, targetUserId]
    );

    res.json({ chatId: newChat.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create chat" });
  }
});

export default router;
