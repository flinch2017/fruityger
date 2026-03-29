import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();



router.get("/chats", authenticateToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const { rows } = await pool.query(`
      SELECT 
        c.*,

        u1.id AS user1_id,
        u1.username AS user1_username,
        u1.profile_pic AS user1_profile_pic,

        u2.id AS user2_id,
        u2.username AS user2_username,
        u2.profile_pic AS user2_profile_pic

      FROM chats c
      JOIN users u1 ON u1.id = c.user1_id
      JOIN users u2 ON u2.id = c.user2_id

      WHERE c.user1_id = $1 OR c.user2_id = $1
      ORDER BY c.last_message_at DESC
    `, [userId]);

    // Transform into clean structure
    const formatted = rows.map(c => ({
      id: c.id,
      last_message: c.last_message,
      last_message_at: c.last_message_at,

      user1: {
        id: c.user1_id,
        username: c.user1_username,
        profile_pic: c.user1_profile_pic
      },
      user2: {
        id: c.user2_id,
        username: c.user2_username,
        profile_pic: c.user2_profile_pic
      }
    }));

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch chats" });
  }
});



router.post("/send", authenticateToken, async (req, res) => {
    const { chatId, receiverId, content } = req.body;
    const senderId = req.user.id;

    const message = await pool.query(`
        INSERT INTO messages (chat_id, sender_id, receiver_id, content)
        VALUES ($1, $2, $3, $4)
        RETURNING *
    `, [chatId, senderId, receiverId, content]);

    // Update last message in chats table
    await pool.query(`
        UPDATE chats
        SET last_message = $1, last_message_at = CURRENT_TIMESTAMP
        WHERE id = $2
    `, [content, chatId]);

    res.json(message.rows[0]);
});


/* ===============================
   SEARCH USERS TO CHAT
================================ */
router.get("/search-users", authenticateToken, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "Query is required" });

  try {
    const { rows } = await pool.query(
      `SELECT id, username, profile_pic
       FROM users
       WHERE username ILIKE $1
       LIMIT 15`,
      [`%${q}%`]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to search users" });
  }
});

/* ===============================
   GET CHAT MESSAGES BY CHAT ID
================================ */
router.get("/:chatId", authenticateToken, async (req, res) => {
  const { chatId } = req.params;

  try {
    // Get chat info + messages
    const chatResult = await pool.query(
      `SELECT c.id, c.user1_id, c.user2_id, u1.username AS user1_username, u1.profile_pic AS user1_profile_pic,
              u2.username AS user2_username, u2.profile_pic AS user2_profile_pic
       FROM chats c
       JOIN users u1 ON u1.id = c.user1_id
       JOIN users u2 ON u2.id = c.user2_id
       WHERE c.id = $1`,
      [chatId]
    );

    if (chatResult.rows.length === 0)
      return res.status(404).json({ error: "Chat not found" });

    const chat = chatResult.rows[0];

    const messagesResult = await pool.query(
      `SELECT * FROM messages
       WHERE chat_id = $1
       ORDER BY created_at ASC`,
      [chatId]
    );

    res.json({
      chat: {
        id: chat.id,
        user1: { id: chat.user1_id, username: chat.user1_username, profile_pic: chat.user1_profile_pic },
        user2: { id: chat.user2_id, username: chat.user2_username, profile_pic: chat.user2_profile_pic },
      },
      messages: messagesResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch chat" });
  }
});

router.post("/get-or-create", authenticateToken, async (req, res) => {
  const senderId = req.user.id;
  const { targetUserId } = req.body;

  try {
    // Check if chat exists
    const existing = await pool.query(
      `SELECT * FROM chats 
       WHERE (user1_id = $1 AND user2_id = $2)
          OR (user1_id = $2 AND user2_id = $1)`,
      [senderId, targetUserId]
    );

    if (existing.rows.length > 0) {
      return res.json({ chatId: existing.rows[0].id });
    }

    // Create new chat
    const newChat = await pool.query(
      `INSERT INTO chats (user1_id, user2_id, last_message_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       RETURNING id`,
      [senderId, targetUserId]
    );

    res.json({ chatId: newChat.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create chat" });
  }
});

export default router;