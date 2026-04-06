import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";
import multer from "multer";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { r2 } from "../utils/r2.js";
import { sendPushToUser } from "../utils/notifications.js";

const router = express.Router();

let deletedChatsTableReadyPromise = null;
let deletedMessagesTableReadyPromise = null;
let blockedUsersTableReadyPromise = null;
let activeUsersTableReadyPromise = null;
let messageRepliesSchemaReadyPromise = null;
let messageReactionsSchemaReadyPromise = null;
let messageAttachmentsSchemaReadyPromise = null;
let chatGroupsSchemaReadyPromise = null;
let groupChatSchemaReadyPromise = null;

const CHAT_ATTACHMENT_MAX_SIZE = 5 * 1024 * 1024;
const allowedDocumentExtensions = new Set([".pdf", ".docx"]);
const allowedDocumentMimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const sanitizeFileName = (value = "") =>
  String(value)
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "file";

const uploadAttachment = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: CHAT_ATTACHMENT_MAX_SIZE,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    const mime = String(file.mimetype || "").toLowerCase();
    const isImage = mime.startsWith("image/");
    const isVideo = mime.startsWith("video/");
    const isAllowedDocument =
      allowedDocumentMimeTypes.has(mime) || allowedDocumentExtensions.has(extension);

    if (isImage || isVideo || isAllowedDocument) {
      cb(null, true);
      return;
    }

    cb(new Error("Only images, videos, PDF, and DOCX files are allowed"));
  },
});

const parseChatAttachment = (req, res) =>
  new Promise((resolve, reject) => {
    uploadAttachment.single("attachment")(req, res, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

function classifyAttachment(file) {
  const mime = String(file?.mimetype || "").toLowerCase();
  const extension = path.extname(file?.originalname || "").toLowerCase();

  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf" || extension === ".pdf") return "pdf";
  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === ".docx"
  ) {
    return "docx";
  }

  return "file";
}

function getAttachmentFallbackText(type) {
  if (type === "image") return "Sent an image";
  if (type === "video") return "Sent a video";
  if (type === "pdf") return "Sent a PDF";
  if (type === "docx") return "Sent a DOCX file";
  return "Sent an attachment";
}

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

async function ensureDeletedMessagesTable() {
  if (!deletedMessagesTableReadyPromise) {
    deletedMessagesTableReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS deleted_messages (
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
          deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, message_id)
        )
      `);
    })().catch((error) => {
      deletedMessagesTableReadyPromise = null;
      throw error;
    });
  }

  await deletedMessagesTableReadyPromise;
}

async function ensureBlockedUsersTable() {
  if (!blockedUsersTableReadyPromise) {
    blockedUsersTableReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS blocked_users (
          blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (blocker_id, blocked_id)
        )
      `);
    })().catch((error) => {
      blockedUsersTableReadyPromise = null;
      throw error;
    });
  }

  await blockedUsersTableReadyPromise;
}

async function ensureActiveUsersTable() {
  if (!activeUsersTableReadyPromise) {
    activeUsersTableReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS active_users (
          user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    })().catch((error) => {
      activeUsersTableReadyPromise = null;
      throw error;
    });
  }

  await activeUsersTableReadyPromise;
}

async function ensureMessageRepliesSchema() {
  if (!messageRepliesSchemaReadyPromise) {
    messageRepliesSchemaReadyPromise = (async () => {
      await pool.query(`
        ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS reply_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_messages_reply_to_message_id
        ON messages(reply_to_message_id)
      `);
    })().catch((error) => {
      messageRepliesSchemaReadyPromise = null;
      throw error;
    });
  }

  await messageRepliesSchemaReadyPromise;
}

async function ensureMessageReactionsSchema() {
  if (!messageReactionsSchemaReadyPromise) {
    messageReactionsSchemaReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS message_reactions (
          message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          reaction VARCHAR(20) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (message_id, user_id)
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_message_reactions_message_id
        ON message_reactions(message_id)
      `);
    })().catch((error) => {
      messageReactionsSchemaReadyPromise = null;
      throw error;
    });
  }

  await messageReactionsSchemaReadyPromise;
}

async function ensureMessageAttachmentsSchema() {
  if (!messageAttachmentsSchemaReadyPromise) {
    messageAttachmentsSchemaReadyPromise = (async () => {
      await pool.query(`
        ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS attachment_url TEXT
      `);

      await pool.query(`
        ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS attachment_type VARCHAR(20)
      `);

      await pool.query(`
        ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS attachment_name TEXT
      `);

      await pool.query(`
        ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS attachment_mime TEXT
      `);

      await pool.query(`
        ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS attachment_size INTEGER
      `);
    })().catch((error) => {
      messageAttachmentsSchemaReadyPromise = null;
      throw error;
    });
  }

  await messageAttachmentsSchemaReadyPromise;
}

async function ensureChatGroupsSchema() {
  if (!chatGroupsSchemaReadyPromise) {
    chatGroupsSchemaReadyPromise = (async () => {
      await pool.query(`
        ALTER TABLE chats
        ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT FALSE
      `);

      await pool.query(`
        ALTER TABLE chats
        ADD COLUMN IF NOT EXISTS group_name TEXT
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_members (
          chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_read_at TIMESTAMPTZ,
          PRIMARY KEY (chat_id, user_id)
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_chat_members_user_id
        ON chat_members(user_id, joined_at DESC)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_chat_members_chat_id
        ON chat_members(chat_id, joined_at ASC)
      `);

      await pool.query(`
        ALTER TABLE messages
        ALTER COLUMN receiver_id DROP NOT NULL
      `).catch(() => null);

      await pool.query(`
        INSERT INTO chat_members (chat_id, user_id, joined_at, last_read_at)
        SELECT c.id, c.user1_id, COALESCE(c.last_message_at, NOW()), c.last_message_at
        FROM chats c
        WHERE c.user1_id IS NOT NULL
        ON CONFLICT (chat_id, user_id) DO NOTHING
      `);

      await pool.query(`
        INSERT INTO chat_members (chat_id, user_id, joined_at, last_read_at)
        SELECT c.id, c.user2_id, COALESCE(c.last_message_at, NOW()), c.last_message_at
        FROM chats c
        WHERE c.user2_id IS NOT NULL
        ON CONFLICT (chat_id, user_id) DO NOTHING
      `);
    })().catch((error) => {
      chatGroupsSchemaReadyPromise = null;
      throw error;
    });
  }

  await chatGroupsSchemaReadyPromise;
}

async function ensureGroupChatSchema() {
  if (!groupChatSchemaReadyPromise) {
    groupChatSchemaReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS group_chats (
          id UUID PRIMARY KEY,
          group_name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          admin_user_ids UUID[] NOT NULL DEFAULT ARRAY[]::uuid[]
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS group_chat_members (
          group_chat_id UUID NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_read_at TIMESTAMPTZ,
          PRIMARY KEY (group_chat_id, user_id)
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS group_messages (
          id UUID PRIMARY KEY,
          group_chat_id UUID NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
          sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          attachment_url TEXT,
          attachment_type VARCHAR(20),
          attachment_name TEXT,
          attachment_mime TEXT,
          attachment_size INTEGER,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_group_chat_members_user
        ON group_chat_members(user_id, joined_at DESC)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_group_messages_group_created
        ON group_messages(group_chat_id, created_at DESC)
      `);
    })().catch((error) => {
      groupChatSchemaReadyPromise = null;
      throw error;
    });
  }

  await groupChatSchemaReadyPromise;
}

async function fetchChatMembers(chatId) {
  const { rows } = await pool.query(
    `
    SELECT
      u.id,
      u.username,
      u.profile_pic
    FROM chat_members cm
    JOIN users u
      ON u.id = cm.user_id
    WHERE cm.chat_id = $1
    ORDER BY LOWER(u.username) ASC
    `,
    [chatId]
  );

  return rows;
}

async function fetchMessageForUser(messageId, userId) {
  const { rows } = await pool.query(
    `
    SELECT
      m.*,
      CASE
        WHEN reply_dm.message_id IS NULL THEN reply_message.content
        ELSE NULL
      END AS reply_to_content,
      CASE
        WHEN reply_dm.message_id IS NULL THEN reply_message.sender_id
        ELSE NULL
      END AS reply_to_sender_id,
      COALESCE(reactions_agg.reactions, '[]'::json) AS reactions
    FROM messages m
    LEFT JOIN messages reply_message
      ON reply_message.id = m.reply_to_message_id
    LEFT JOIN deleted_messages reply_dm
      ON reply_dm.message_id = reply_message.id
     AND reply_dm.user_id = $2
    LEFT JOIN LATERAL (
      SELECT json_agg(
        json_build_object(
          'reaction', grouped.reaction,
          'count', grouped.reaction_count,
          'reacted_by_me', grouped.reacted_by_me
        )
        ORDER BY grouped.first_reacted_at ASC, grouped.reaction ASC
      ) AS reactions
      FROM (
        SELECT
          mr.reaction,
          COUNT(*)::int AS reaction_count,
          BOOL_OR(mr.user_id = $2) AS reacted_by_me,
          MIN(mr.created_at) AS first_reacted_at
        FROM message_reactions mr
        WHERE mr.message_id = m.id
        GROUP BY mr.reaction
      ) grouped
    ) reactions_agg ON true
    WHERE m.id = $1
    LIMIT 1
    `,
    [messageId, userId]
  );

  return rows[0] || null;
}

async function fetchMessageReactionViewers(messageId, userId) {
  const { rows } = await pool.query(
    `
    SELECT
      mr.reaction,
      mr.created_at,
      u.id AS user_id,
      u.username,
      u.profile_pic,
      mr.user_id = $2 AS reacted_by_me
    FROM message_reactions mr
    JOIN users u
      ON u.id = mr.user_id
    WHERE mr.message_id = $1
    ORDER BY mr.created_at ASC, u.username ASC
    `,
    [messageId, userId]
  );

  return rows;
}

router.get("/chats", authenticateToken, async (req, res) => {
  const userId = req.user.id;

  try {
    await ensureDeletedChatsTable();
    await ensureDeletedMessagesTable();
    await ensureMessageAttachmentsSchema();

    const { rows } = await pool.query(
      `
      SELECT
        c.id,
        c.user1_id,
        c.user2_id,
        dc.deleted_at,
        u1.username AS user1_username,
        u1.profile_pic AS user1_profile_pic,
        u2.username AS user2_username,
        u2.profile_pic AS user2_profile_pic,
        m.content AS last_message,
        m.attachment_type AS last_message_attachment_type,
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
        ) AS unread_count
      FROM chats c
      JOIN users u1
        ON u1.id = c.user1_id
      JOIN users u2
        ON u2.id = c.user2_id
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

    res.json(
      rows.map((chat) => ({
        id: chat.id,
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
        last_message: chat.last_message,
        last_message_attachment_type: chat.last_message_attachment_type,
        last_message_at: chat.last_message_at,
        last_message_sender_id: chat.last_message_sender_id,
        last_message_read: chat.last_message_read,
        unread_count: chat.unread_count,
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch chats" });
  }
});

router.get("/unread-count", authenticateToken, async (req, res) => {
  const userId = req.user.id;

  try {
    await ensureDeletedChatsTable();
    await ensureDeletedMessagesTable();

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
  try {
    await parseChatAttachment(req, res);

    const { chatId, receiverId, content, replyToMessageId = null } = req.body;
    const senderId = req.user.id;
    const trimmedContent = String(content || "").trim();
    const attachment = req.file || null;
    const normalizedReplyToMessageId = String(replyToMessageId || "").trim() || null;

    await ensureDeletedChatsTable();
    await ensureDeletedMessagesTable();
    await ensureMessageRepliesSchema();
    await ensureMessageReactionsSchema();
    await ensureMessageAttachmentsSchema();

    if (!chatId) {
      return res.status(400).json({ error: "chatId is required" });
    }

    if (!receiverId) {
      return res.status(400).json({ error: "receiverId is required" });
    }

    if (!trimmedContent && !attachment) {
      return res.status(400).json({ error: "Message content or an attachment is required" });
    }

    await ensureBlockedUsersTable();

    const chatResult = await pool.query(
      `
      SELECT c.id
      FROM chats c
      WHERE c.id = $1
        AND (
          (c.user1_id = $2 AND c.user2_id = $3)
          OR (c.user1_id = $3 AND c.user2_id = $2)
        )
      LIMIT 1
      `,
      [chatId, senderId, receiverId]
    );

    if (chatResult.rows.length === 0) {
      return res.status(404).json({ error: "Chat not found" });
    }

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

    if (normalizedReplyToMessageId) {
      const replyTargetResult = await pool.query(
        `
        SELECT id
        FROM messages
        WHERE id = $1
          AND chat_id = $2
        LIMIT 1
        `,
        [normalizedReplyToMessageId, chatId]
      );

      if (replyTargetResult.rows.length === 0) {
        return res.status(400).json({ error: "Reply target was not found" });
      }
    }

    let attachmentUrl = null;
    let attachmentType = null;
    let attachmentName = null;
    let attachmentMime = null;
    let attachmentSize = null;

    if (attachment) {
      attachmentType = classifyAttachment(attachment);
      attachmentName = sanitizeFileName(attachment.originalname);
      attachmentMime = attachment.mimetype;
      attachmentSize = attachment.size;

      const key = `messages/${chatId}/${uuidv4()}-${attachmentName}`;

      await r2.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET,
          Key: key,
          Body: attachment.buffer,
          ContentType: attachmentMime,
        })
      );

      attachmentUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
    }

    const storedContent = trimmedContent || getAttachmentFallbackText(attachmentType);

    const message = await pool.query(
      `
      INSERT INTO messages (
        chat_id,
        sender_id,
        receiver_id,
        content,
        reply_to_message_id,
        attachment_url,
        attachment_type,
        attachment_name,
        attachment_mime,
        attachment_size
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
      `,
      [
        chatId,
        senderId,
        receiverId,
        storedContent,
        normalizedReplyToMessageId,
        attachmentUrl,
        attachmentType,
        attachmentName,
        attachmentMime,
        attachmentSize,
      ]
    );

    const lastMessagePreview = storedContent;

    await pool.query(
      `
      UPDATE chats
      SET last_message = $1, last_message_at = CURRENT_TIMESTAMP
      WHERE id = $2
      `,
      [lastMessagePreview, chatId]
    );

    const senderResult = await pool.query(
      `
      SELECT username
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [senderId]
    );

    await sendPushToUser(receiverId, {
      title: senderResult.rows[0]?.username || "New message",
      body: storedContent,
      categoryId: "messageReply",
      data: {
        type: "message",
        chatId,
        senderId,
      },
    }).catch(() => null);

    const enrichedMessage = await fetchMessageForUser(message.rows[0].id, senderId);

    res.json(enrichedMessage || message.rows[0]);
  } catch (err) {
    console.error(err);
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Attachments must be 5MB or smaller" });
    }

    if (err?.message === "Only images, videos, PDF, and DOCX files are allowed") {
      return res.status(400).json({ error: err.message });
    }

    res.status(500).json({ error: err?.message || "Failed to send message" });
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
    await ensureDeletedMessagesTable();

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
        AND id <> $2
        AND deactivated_at IS NULL
        AND deleted_at IS NULL
      LIMIT 15
      `,
      [`%${q}%`, req.user.id]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to search users" });
  }
});

router.get("/online-candidates", authenticateToken, async (req, res) => {
  const userId = req.user.id;

  try {
    await ensureDeletedChatsTable();
    await ensureDeletedMessagesTable();
    await ensureBlockedUsersTable();
    await ensureActiveUsersTable();

    const { rows } = await pool.query(
      `
      WITH followed_people AS (
        SELECT
          u.id,
          u.username,
          u.profile_pic,
          NULL::uuid AS chat_id,
          FALSE AS has_chat
        FROM follows f
        JOIN users u
          ON u.id = f.following_id
        WHERE f.follower_id = $1
      ),
      chat_people AS (
        SELECT DISTINCT ON (other_user.id)
          other_user.id,
          other_user.username,
          other_user.profile_pic,
          c.id AS chat_id,
          TRUE AS has_chat,
          c.last_message_at
        FROM chats c
        JOIN users other_user
          ON other_user.id = CASE
            WHEN c.user1_id = $1 THEN c.user2_id
            ELSE c.user1_id
          END
        LEFT JOIN deleted_chats dc
          ON dc.chat_id = c.id
         AND dc.user_id = $1
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
        ORDER BY other_user.id, c.last_message_at DESC NULLS LAST
      ),
      combined AS (
        SELECT * FROM followed_people
        UNION ALL
        SELECT id, username, profile_pic, chat_id, has_chat FROM chat_people
      )
      SELECT DISTINCT ON (combined.id)
        combined.id,
        combined.username,
        combined.profile_pic,
        combined.chat_id,
        combined.has_chat,
        (
          active_users.last_seen_at IS NOT NULL
          AND active_users.last_seen_at >= NOW() - INTERVAL '3 minutes'
        ) AS is_online
      FROM combined
      LEFT JOIN active_users
        ON active_users.user_id = combined.id
      WHERE combined.id <> $1
        AND NOT EXISTS (
          SELECT 1
          FROM blocked_users bu
          WHERE (bu.blocker_id = $1 AND bu.blocked_id = combined.id)
             OR (bu.blocker_id = combined.id AND bu.blocked_id = $1)
        )
      ORDER BY combined.id, combined.has_chat DESC
      `
      ,
      [userId]
    );

    res.json({ users: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load online candidates" });
  }
});

router.post("/presence/heartbeat", authenticateToken, async (req, res) => {
  const userId = req.user.id;

  try {
    await ensureActiveUsersTable();

    await pool.query(
      `
      INSERT INTO active_users (user_id, last_seen_at)
      VALUES ($1, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET last_seen_at = NOW()
      `,
      [userId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update presence" });
  }
});

router.get("/presence/:targetUserId", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { targetUserId } = req.params;

  try {
    await ensureBlockedUsersTable();
    await ensureActiveUsersTable();

    const blockedResult = await pool.query(
      `
      SELECT 1
      FROM blocked_users
      WHERE (blocker_id = $1 AND blocked_id = $2)
         OR (blocker_id = $2 AND blocked_id = $1)
      LIMIT 1
      `,
      [userId, targetUserId]
    );

    if (blockedResult.rows.length > 0) {
      return res.json({ is_online: false });
    }

    const { rows } = await pool.query(
      `
      SELECT
        last_seen_at IS NOT NULL
        AND last_seen_at >= NOW() - INTERVAL '3 minutes' AS is_online
      FROM active_users
      WHERE user_id = $1
      LIMIT 1
      `,
      [targetUserId]
    );

    res.json({ is_online: Boolean(rows[0]?.is_online) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load presence status" });
  }
});

router.get("/:chatId", authenticateToken, async (req, res) => {
  const { chatId } = req.params;
  const userId = req.user.id;

  try {
    await ensureDeletedChatsTable();
    await ensureDeletedMessagesTable();
    await ensureMessageRepliesSchema();
    await ensureMessageReactionsSchema();

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
        AND (c.user1_id = $2 OR c.user2_id = $2)
      `,
      [chatId, userId]
    );

    if (chatResult.rows.length === 0) {
      return res.status(404).json({ error: "Chat not found" });
    }

    const chat = chatResult.rows[0];
    await ensureBlockedUsersTable();

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
      SELECT
        m.*,
        sender_user.username AS sender_username,
        sender_user.profile_pic AS sender_profile_pic,
        CASE
          WHEN reply_dm.message_id IS NULL THEN reply_message.content
          ELSE NULL
        END AS reply_to_content,
        CASE
          WHEN reply_dm.message_id IS NULL THEN reply_message.sender_id
          ELSE NULL
        END AS reply_to_sender_id,
        COALESCE(reactions_agg.reactions, '[]'::json) AS reactions
      FROM messages m
      LEFT JOIN deleted_messages dm
        ON dm.message_id = m.id
       AND dm.user_id = $2
      LEFT JOIN messages reply_message
        ON reply_message.id = m.reply_to_message_id
      LEFT JOIN users sender_user
        ON sender_user.id = m.sender_id
      LEFT JOIN deleted_messages reply_dm
        ON reply_dm.message_id = reply_message.id
       AND reply_dm.user_id = $2
      LEFT JOIN LATERAL (
        SELECT json_agg(
          json_build_object(
            'reaction', grouped.reaction,
            'count', grouped.reaction_count,
            'reacted_by_me', grouped.reacted_by_me
          )
          ORDER BY grouped.first_reacted_at ASC, grouped.reaction ASC
        ) AS reactions
        FROM (
          SELECT
            mr.reaction,
            COUNT(*)::int AS reaction_count,
            BOOL_OR(mr.user_id = $2) AS reacted_by_me,
            MIN(mr.created_at) AS first_reacted_at
          FROM message_reactions mr
          WHERE mr.message_id = m.id
          GROUP BY mr.reaction
        ) grouped
      ) reactions_agg ON true
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

router.get("/:messageId/reactions", authenticateToken, async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user.id;

  try {
    await ensureMessageReactionsSchema();

    const messageResult = await pool.query(
      `
      SELECT m.id
      FROM messages m
      WHERE m.id = $1
        AND (m.sender_id = $2 OR m.receiver_id = $2)
      LIMIT 1
      `,
      [messageId, userId]
    );

    if (messageResult.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    const viewers = await fetchMessageReactionViewers(messageId, userId);
    return res.json({ reactions: viewers });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to load reaction viewers" });
  }
});

router.post("/:messageId/react", authenticateToken, async (req, res) => {
  const { messageId } = req.params;
  const { reaction = null } = req.body || {};
  const userId = req.user.id;
  const allowedReactions = new Set(["heart", "laugh", "sad", "angry", "care"]);

  if (reaction && !allowedReactions.has(reaction)) {
    return res.status(400).json({ error: "Invalid reaction" });
  }

  try {
    await ensureMessageReactionsSchema();

    const messageResult = await pool.query(
      `
      SELECT m.id, m.chat_id
      FROM messages m
      WHERE m.id = $1
        AND (m.sender_id = $2 OR m.receiver_id = $2)
      LIMIT 1
      `,
      [messageId, userId]
    );

    if (messageResult.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    if (!reaction) {
      await pool.query(
        `
        DELETE FROM message_reactions
        WHERE message_id = $1
          AND user_id = $2
        `,
        [messageId, userId]
      );
    } else {
      await pool.query(
        `
        INSERT INTO message_reactions (message_id, user_id, reaction)
        VALUES ($1, $2, $3)
        ON CONFLICT (message_id, user_id)
        DO UPDATE SET reaction = EXCLUDED.reaction, created_at = NOW()
        `,
        [messageId, userId, reaction]
      );
    }

    const enrichedMessage = await fetchMessageForUser(messageId, userId);
    return res.json({ success: true, message: enrichedMessage });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to update reaction" });
  }
});

router.post("/:chatId/read", authenticateToken, async (req, res) => {
  const { chatId } = req.params;
  const userId = req.user.id;

  try {
    await ensureDeletedChatsTable();
    await ensureDeletedMessagesTable();

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
      SELECT m.id
      FROM messages m
      WHERE m.id = $1
        AND (m.sender_id = $2 OR m.receiver_id = $2)
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
      SELECT m.id, m.chat_id
      FROM messages m
      WHERE m.id = $1
        AND (m.sender_id = $2 OR m.receiver_id = $2)
      `,
      [messageId, reporterId]
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
    await ensureDeletedMessagesTable();

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

router.get("/groups/chats", authenticateToken, async (req, res) => {
  const userId = req.user.id;

  try {
    await ensureGroupChatSchema();

    const { rows } = await pool.query(
      `
      SELECT
        gc.id,
        gc.group_name,
        gc.created_at,
        gc.created_by,
        gcm.last_read_at,
        gm.id AS last_message_id,
        gm.content AS last_message,
        gm.attachment_type AS last_message_attachment_type,
        gm.created_at AS last_message_at,
        gm.sender_id AS last_message_sender_id,
        sender.username AS last_message_sender_username,
        (
          SELECT COUNT(*)::int
          FROM group_messages unread
          WHERE unread.group_chat_id = gc.id
            AND unread.sender_id <> $1
            AND (
              gcm.last_read_at IS NULL
              OR unread.created_at > gcm.last_read_at
            )
        ) AS unread_count,
        COALESCE(member_summary.members, '[]'::json) AS members
      FROM group_chats gc
      JOIN group_chat_members gcm
        ON gcm.group_chat_id = gc.id
       AND gcm.user_id = $1
      LEFT JOIN LATERAL (
        SELECT gm.*
        FROM group_messages gm
        WHERE gm.group_chat_id = gc.id
        ORDER BY gm.created_at DESC
        LIMIT 1
      ) gm ON true
      LEFT JOIN users sender
        ON sender.id = gm.sender_id
      LEFT JOIN LATERAL (
        SELECT json_agg(
          json_build_object(
            'id', u.id,
            'username', u.username,
            'profile_pic', u.profile_pic
          )
          ORDER BY CASE WHEN u.id = $1 THEN 1 ELSE 0 END, LOWER(u.username) ASC
        ) AS members
        FROM group_chat_members members
        JOIN users u
          ON u.id = members.user_id
        WHERE members.group_chat_id = gc.id
      ) member_summary ON true
      ORDER BY gm.created_at DESC NULLS LAST, gc.created_at DESC
      `,
      [userId]
    );

    res.json(
      rows.map((chat) => ({
        id: chat.id,
        group_name: chat.group_name,
        created_at: chat.created_at,
        created_by: chat.created_by,
        last_message: chat.last_message,
        last_message_attachment_type: chat.last_message_attachment_type,
        last_message_at: chat.last_message_at,
        last_message_sender_id: chat.last_message_sender_id,
        last_message_sender_username: chat.last_message_sender_username,
        unread_count: chat.unread_count,
        members: Array.isArray(chat.members) ? chat.members : [],
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch group chats" });
  }
});

router.post("/groups/chats", authenticateToken, async (req, res) => {
  const creatorId = req.user.id;
  const groupName = String(req.body?.groupName || "").trim();
  const rawMemberIds = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];

  if (groupName.length < 2) {
    return res.status(400).json({ error: "Group name is required" });
  }

  const memberIds = Array.from(
    new Set(rawMemberIds.map((value) => String(value || "").trim()).filter(Boolean))
  ).filter((id) => id !== String(creatorId));

  if (memberIds.length === 0) {
    return res.status(400).json({ error: "Choose at least one other member" });
  }

  try {
    await ensureGroupChatSchema();
    await ensureBlockedUsersTable();

    const validUsersResult = await pool.query(
      `
      SELECT id
      FROM users
      WHERE id = ANY($1::uuid[])
        AND deactivated_at IS NULL
        AND deleted_at IS NULL
      `,
      [memberIds]
    );

    const validMemberIds = validUsersResult.rows.map((row) => String(row.id));

    if (validMemberIds.length !== memberIds.length) {
      return res.status(400).json({ error: "Some selected users were not found" });
    }

    const blockedResult = await pool.query(
      `
      SELECT 1
      FROM blocked_users
      WHERE (
        blocker_id = $1
        AND blocked_id = ANY($2::uuid[])
      ) OR (
        blocked_id = $1
        AND blocker_id = ANY($2::uuid[])
      )
      LIMIT 1
      `,
      [creatorId, validMemberIds]
    );

    if (blockedResult.rows.length > 0) {
      return res.status(403).json({ error: "You cannot create a group with blocked users" });
    }

    const groupChatId = uuidv4();
    const everyone = [String(creatorId), ...validMemberIds];

    await pool.query(
      `
      INSERT INTO group_chats (id, group_name, created_by, admin_user_ids)
      VALUES ($1, $2, $3, ARRAY[$3]::uuid[])
      `,
      [groupChatId, groupName, creatorId]
    );

    await pool.query(
      `
      INSERT INTO group_chat_members (group_chat_id, user_id, joined_at, last_read_at)
      SELECT $1, member_id, NOW(), NOW()
      FROM unnest($2::uuid[]) AS member_id
      ON CONFLICT (group_chat_id, user_id) DO NOTHING
      `,
      [groupChatId, everyone]
    );

    res.status(201).json({ groupChatId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create group chat" });
  }
});

router.get("/groups/chats/:groupChatId", authenticateToken, async (req, res) => {
  const { groupChatId } = req.params;
  const userId = req.user.id;

  try {
    await ensureGroupChatSchema();

    const groupResult = await pool.query(
      `
      SELECT
        gc.id,
        gc.group_name,
        gc.created_at,
        gc.created_by,
        gc.admin_user_ids,
        gcm.last_read_at
      FROM group_chats gc
      JOIN group_chat_members gcm
        ON gcm.group_chat_id = gc.id
       AND gcm.user_id = $2
      WHERE gc.id = $1
      LIMIT 1
      `,
      [groupChatId, userId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: "Group chat not found" });
    }

    const groupChat = groupResult.rows[0];

    const membersResult = await pool.query(
      `
      SELECT
        u.id,
        u.username,
        u.profile_pic,
        gcm.joined_at,
        u.id = ANY($2::uuid[]) AS is_admin
      FROM group_chat_members gcm
      JOIN users u
        ON u.id = gcm.user_id
      WHERE gcm.group_chat_id = $1
      ORDER BY LOWER(u.username) ASC
      `,
      [groupChatId, groupChat.admin_user_ids || []]
    );

    const messagesResult = await pool.query(
      `
      SELECT
        gm.*,
        sender.username AS sender_username,
        sender.profile_pic AS sender_profile_pic
      FROM group_messages gm
      JOIN users sender
        ON sender.id = gm.sender_id
      WHERE gm.group_chat_id = $1
      ORDER BY gm.created_at ASC
      `,
      [groupChatId]
    );

    await pool.query(
      `
      UPDATE group_chat_members
      SET last_read_at = NOW()
      WHERE group_chat_id = $1
        AND user_id = $2
      `,
      [groupChatId, userId]
    );

    res.json({
      groupChat: {
        id: groupChat.id,
        group_name: groupChat.group_name,
        created_at: groupChat.created_at,
        created_by: groupChat.created_by,
        admin_user_ids: groupChat.admin_user_ids || [],
        members: membersResult.rows,
      },
      messages: messagesResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch group chat" });
  }
});

router.post("/groups/chats/:groupChatId/send", authenticateToken, async (req, res) => {
  try {
    await parseChatAttachment(req, res);

    const { groupChatId } = req.params;
    const senderId = req.user.id;
    const content = String(req.body?.content || "").trim();
    const attachment = req.file || null;

    await ensureGroupChatSchema();

    if (!content && !attachment) {
      return res.status(400).json({ error: "Message content or an attachment is required" });
    }

    const membershipResult = await pool.query(
      `
      SELECT 1
      FROM group_chat_members
      WHERE group_chat_id = $1
        AND user_id = $2
      LIMIT 1
      `,
      [groupChatId, senderId]
    );

    if (membershipResult.rows.length === 0) {
      return res.status(404).json({ error: "Group chat not found" });
    }

    let attachmentUrl = null;
    let attachmentType = null;
    let attachmentName = null;
    let attachmentMime = null;
    let attachmentSize = null;

    if (attachment) {
      attachmentType = classifyAttachment(attachment);
      attachmentName = sanitizeFileName(attachment.originalname);
      attachmentMime = attachment.mimetype;
      attachmentSize = attachment.size;

      const key = `group-messages/${groupChatId}/${uuidv4()}-${attachmentName}`;

      await r2.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET,
          Key: key,
          Body: attachment.buffer,
          ContentType: attachmentMime,
        })
      );

      attachmentUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
    }

    const storedContent = content || getAttachmentFallbackText(attachmentType);
    const messageId = uuidv4();

    const { rows } = await pool.query(
      `
      INSERT INTO group_messages (
        id,
        group_chat_id,
        sender_id,
        content,
        attachment_url,
        attachment_type,
        attachment_name,
        attachment_mime,
        attachment_size
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
      `,
      [
        messageId,
        groupChatId,
        senderId,
        storedContent,
        attachmentUrl,
        attachmentType,
        attachmentName,
        attachmentMime,
        attachmentSize,
      ]
    );

    await pool.query(
      `
      UPDATE group_chat_members
      SET last_read_at = NOW()
      WHERE group_chat_id = $1
        AND user_id = $2
      `,
      [groupChatId, senderId]
    );

    const senderResult = await pool.query(
      `
      SELECT username, profile_pic
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [senderId]
    );

    const message = rows[0];

    const memberIdsResult = await pool.query(
      `
      SELECT user_id
      FROM group_chat_members
      WHERE group_chat_id = $1
        AND user_id <> $2
      `,
      [groupChatId, senderId]
    );

    await Promise.all(
      memberIdsResult.rows.map((row) =>
        sendPushToUser(row.user_id, {
          title: senderResult.rows[0]?.username || "New group message",
          body: storedContent,
          categoryId: "messageReply",
          data: {
            type: "group_message",
            groupChatId,
            senderId,
          },
        }).catch(() => null)
      )
    );

    res.json({
      ...message,
      sender_username: senderResult.rows[0]?.username || "Member",
      sender_profile_pic: senderResult.rows[0]?.profile_pic || null,
    });
  } catch (err) {
    console.error(err);
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Attachments must be 5MB or smaller" });
    }
    res.status(500).json({ error: "Failed to send group message" });
  }
});

router.post("/groups/chats/:groupChatId/read", authenticateToken, async (req, res) => {
  const { groupChatId } = req.params;
  const userId = req.user.id;

  try {
    await ensureGroupChatSchema();

    await pool.query(
      `
      UPDATE group_chat_members
      SET last_read_at = NOW()
      WHERE group_chat_id = $1
        AND user_id = $2
      `,
      [groupChatId, userId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to mark group chat as read" });
  }
});

export default router;
