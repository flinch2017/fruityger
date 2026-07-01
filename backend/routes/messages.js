import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";
import multer from "multer";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { r2 } from "../utils/r2.js";
import { createNotification, sendPushToUser } from "../utils/notifications.js";
import { ensureVerificationBadgeSchema } from "../utils/verificationBadge.js";
import { ensureAccountNameSchema } from "../utils/accountName.js";
import { assertContentAllowedOrReport, ContentModerationError } from "../utils/contentModeration.js";

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
let deletedGroupChatsTableReadyPromise = null;
let groupMessageRepliesSchemaReadyPromise = null;
let groupMessageReactionsSchemaReadyPromise = null;
let deletedGroupMessagesTableReadyPromise = null;
let groupMemberAddRequestsSchemaReadyPromise = null;

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

const uploadGroupImage = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: CHAT_ATTACHMENT_MAX_SIZE,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (String(file.mimetype || "").toLowerCase().startsWith("image/")) {
      cb(null, true);
      return;
    }
    cb(new Error("Only image files are allowed"));
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

const parseGroupImage = (req, res) =>
  new Promise((resolve, reject) => {
    uploadGroupImage.single("image")(req, res, (error) => {
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

function getModerationAttachment(attachment) {
  if (!attachment) return [];

  return [
    {
      kind: attachment.mimetype?.startsWith("video")
        ? "video"
        : attachment.mimetype?.startsWith("image")
          ? "image"
          : "other",
      buffer: attachment.buffer,
      mimetype: attachment.mimetype,
      originalName: attachment.originalname,
    },
  ];
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
          group_image TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          admin_user_ids UUID[] NOT NULL DEFAULT ARRAY[]::uuid[]
        )
      `);

      await pool.query(`
        ALTER TABLE group_chats
        ADD COLUMN IF NOT EXISTS group_image TEXT
      `);

      await pool.query(`
        ALTER TABLE group_chats
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      `).catch(() => null);

      await pool.query(`
        ALTER TABLE group_chats
        ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE CASCADE
      `);

      await pool.query(`
        ALTER TABLE group_chats
        ADD COLUMN IF NOT EXISTS admin_user_ids UUID[] NOT NULL DEFAULT ARRAY[]::uuid[]
      `).catch(() => null);
      await pool.query(`
        ALTER TABLE group_chats
        ADD COLUMN IF NOT EXISTS member_add_requires_admin_approval BOOLEAN NOT NULL DEFAULT FALSE
      `).catch(() => null);

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

async function ensureDeletedGroupChatsTable() {
  if (!deletedGroupChatsTableReadyPromise) {
    deletedGroupChatsTableReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS deleted_group_chats (
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          group_chat_id UUID NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
          deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, group_chat_id)
        )
      `);
    })().catch((error) => {
      deletedGroupChatsTableReadyPromise = null;
      throw error;
    });
  }

  await deletedGroupChatsTableReadyPromise;
}

async function ensureDeletedGroupMessagesTable() {
  if (!deletedGroupMessagesTableReadyPromise) {
    deletedGroupMessagesTableReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS deleted_group_messages (
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          message_id UUID NOT NULL REFERENCES group_messages(id) ON DELETE CASCADE,
          deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, message_id)
        )
      `);
    })().catch((error) => {
      deletedGroupMessagesTableReadyPromise = null;
      throw error;
    });
  }

  await deletedGroupMessagesTableReadyPromise;
}

async function ensureGroupMemberAddRequestsSchema() {
  if (!groupMemberAddRequestsSchemaReadyPromise) {
    groupMemberAddRequestsSchemaReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS group_member_add_requests (
          id UUID PRIMARY KEY,
          group_chat_id UUID NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
          requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          requested_member_ids UUID[] NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
          reviewed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_group_member_add_requests_group_status
        ON group_member_add_requests(group_chat_id, status, created_at DESC)
      `);
    })().catch((error) => {
      groupMemberAddRequestsSchemaReadyPromise = null;
      throw error;
    });
  }

  await groupMemberAddRequestsSchemaReadyPromise;
}

async function ensureGroupMessageRepliesSchema() {
  if (!groupMessageRepliesSchemaReadyPromise) {
    groupMessageRepliesSchemaReadyPromise = (async () => {
      await pool.query(`
        ALTER TABLE group_messages
        ADD COLUMN IF NOT EXISTS reply_to_message_id UUID REFERENCES group_messages(id) ON DELETE SET NULL
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_group_messages_reply_to_message_id
        ON group_messages(reply_to_message_id)
      `);
    })().catch((error) => {
      groupMessageRepliesSchemaReadyPromise = null;
      throw error;
    });
  }

  await groupMessageRepliesSchemaReadyPromise;
}

async function ensureGroupMessageReactionsSchema() {
  if (!groupMessageReactionsSchemaReadyPromise) {
    groupMessageReactionsSchemaReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS group_message_reactions (
          message_id UUID NOT NULL REFERENCES group_messages(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          reaction VARCHAR(20) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (message_id, user_id)
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_group_message_reactions_message_id
        ON group_message_reactions(message_id)
      `);
    })().catch((error) => {
      groupMessageReactionsSchemaReadyPromise = null;
      throw error;
    });
  }

  await groupMessageReactionsSchemaReadyPromise;
}

async function fetchChatMembers(chatId) {
  const { rows } = await pool.query(
    `
    SELECT
      u.id,
      u.username,
      u.account_name,
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
      u.account_name,
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

async function fetchGroupMessageForUser(messageId, userId) {
  const { rows } = await pool.query(
    `
    SELECT
      gm.*,
      sender.username AS sender_username,
      sender.account_name AS sender_account_name,
      sender.profile_pic AS sender_profile_pic,
      CASE
        WHEN reply_dgm.message_id IS NULL THEN reply_message.content
        ELSE NULL
      END AS reply_to_content,
      CASE
        WHEN reply_dgm.message_id IS NULL THEN reply_message.sender_id
        ELSE NULL
      END AS reply_to_sender_id,
      reply_sender.username AS reply_to_sender_username,
      reply_sender.account_name AS reply_to_sender_account_name,
      COALESCE(reactions_agg.reactions, '[]'::json) AS reactions
    FROM group_messages gm
    JOIN users sender
      ON sender.id = gm.sender_id
    LEFT JOIN group_messages reply_message
      ON reply_message.id = gm.reply_to_message_id
    LEFT JOIN users reply_sender
      ON reply_sender.id = reply_message.sender_id
    LEFT JOIN deleted_group_messages reply_dgm
      ON reply_dgm.message_id = reply_message.id
     AND reply_dgm.user_id = $2
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
          gmr.reaction,
          COUNT(*)::int AS reaction_count,
          BOOL_OR(gmr.user_id = $2) AS reacted_by_me,
          MIN(gmr.created_at) AS first_reacted_at
        FROM group_message_reactions gmr
        WHERE gmr.message_id = gm.id
        GROUP BY gmr.reaction
      ) grouped
    ) reactions_agg ON true
    WHERE gm.id = $1
    LIMIT 1
    `,
    [messageId, userId]
  );

  return rows[0] || null;
}

async function fetchGroupMessageReactionViewers(messageId, userId) {
  const { rows } = await pool.query(
    `
    SELECT
      gmr.reaction,
      gmr.created_at,
      u.id AS user_id,
      u.username,
      u.account_name,
      u.profile_pic,
      gmr.user_id = $2 AS reacted_by_me
    FROM group_message_reactions gmr
    JOIN users u
      ON u.id = gmr.user_id
    WHERE gmr.message_id = $1
    ORDER BY gmr.created_at ASC, u.username ASC
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
    await ensureVerificationBadgeSchema();
    await ensureAccountNameSchema();

    const { rows } = await pool.query(
      `
      SELECT
        c.id,
        c.user1_id,
        c.user2_id,
        dc.deleted_at,
        u1.username AS user1_username,
        u1.account_name AS user1_account_name,
        u1.profile_pic AS user1_profile_pic,
        u1.is_verified AS user1_is_verified,
        u2.username AS user2_username,
        u2.account_name AS user2_account_name,
        u2.profile_pic AS user2_profile_pic,
        u2.is_verified AS user2_is_verified,
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
          account_name: chat.user1_account_name,
          profile_pic: chat.user1_profile_pic,
          is_verified: chat.user1_is_verified,
        },
        user2: {
          id: chat.user2_id,
          username: chat.user2_username,
          account_name: chat.user2_account_name,
          profile_pic: chat.user2_profile_pic,
          is_verified: chat.user2_is_verified,
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
    await ensureAccountNameSchema();
    await ensureVerificationBadgeSchema();
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

    await assertContentAllowedOrReport({
      userId: senderId,
      contentType: "message",
      contentId: chatId,
      text: trimmedContent,
      media: getModerationAttachment(attachment),
      context: {
        surface: "direct_message_send",
        chat_id: chatId,
        receiver_id: receiverId,
        has_attachment: Boolean(attachment),
      },
    });

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
      SELECT username, account_name
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [senderId]
    );

    await sendPushToUser(receiverId, {
      title: senderResult.rows[0]?.account_name || senderResult.rows[0]?.username || "New message",
      body: storedContent,
      categoryId: "messageReply",
      data: {
        type: "message",
        chatId,
        senderId,
        messageId: message.rows[0].id,
      },
    });

    const enrichedMessage = await fetchMessageForUser(message.rows[0].id, senderId);

    res.json(enrichedMessage || message.rows[0]);
  } catch (err) {
    console.error(err);
    if (err instanceof ContentModerationError) {
      return res.status(err.statusCode || 400).json({
        error: err.message,
        moderation: err.result,
      });
    }

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
    await ensureVerificationBadgeSchema();
    await ensureAccountNameSchema();
    const { rows } = await pool.query(
      `
      SELECT id, username, account_name, profile_pic, is_verified
      FROM users
      WHERE (username ILIKE $1 OR account_name ILIKE $1)
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
    await ensureVerificationBadgeSchema();
    await ensureAccountNameSchema();

    const { rows } = await pool.query(
      `
      WITH followed_people AS (
        SELECT
          u.id,
          u.username,
          u.account_name,
          u.profile_pic,
          u.is_verified,
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
          other_user.account_name,
          other_user.profile_pic,
          other_user.is_verified,
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
        SELECT id, username, account_name, profile_pic, is_verified, chat_id, has_chat FROM chat_people
      )
      SELECT DISTINCT ON (combined.id)
        combined.id,
        combined.username,
        combined.account_name,
        combined.profile_pic,
        combined.is_verified,
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
        u1.account_name AS user1_account_name,
        u1.profile_pic AS user1_profile_pic,
        u1.is_verified AS user1_is_verified,
        u2.username AS user2_username,
        u2.account_name AS user2_account_name,
        u2.profile_pic AS user2_profile_pic,
        u2.is_verified AS user2_is_verified
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
        sender_user.account_name AS sender_account_name,
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
          account_name: chat.user1_account_name,
          profile_pic: chat.user1_profile_pic,
          is_verified: chat.user1_is_verified,
        },
        user2: {
          id: chat.user2_id,
          username: chat.user2_username,
          account_name: chat.user2_account_name,
          profile_pic: chat.user2_profile_pic,
          is_verified: chat.user2_is_verified,
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
    await ensureAccountNameSchema();

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
  const allowedReactions = new Set(["like", "heart", "laugh", "wow", "sad", "angry", "care"]);

  if (reaction && !allowedReactions.has(reaction)) {
    return res.status(400).json({ error: "Invalid reaction" });
  }

  try {
    await ensureMessageReactionsSchema();
    await ensureAccountNameSchema();

    const messageResult = await pool.query(
      `
      SELECT m.id, m.chat_id, m.sender_id, m.receiver_id, m.content
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

    const targetMessage = messageResult.rows[0];

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

      await createNotification({
        recipientId: targetMessage.sender_id,
        actorId: userId,
        type: "message_reaction",
        chatId: targetMessage.chat_id,
        messageId,
        pushCategoryId: "messageReply",
        pushData: {
          type: "message_reaction",
          chatId: targetMessage.chat_id,
          messageId,
          reaction,
          actorId: userId,
        },
      });
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

    const reportDetails = String(details || "").trim() || null;

    const { rows } = await pool.query(
      `
      INSERT INTO reports (reporter_id, content_type, content_id, reason, details)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [reporterId, "message", messageId, reason, reportDetails]
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
    await ensureDeletedGroupChatsTable();
    await ensureAccountNameSchema();

    const { rows } = await pool.query(
      `
      SELECT
        gc.id,
        gc.group_name,
        gc.group_image,
        gc.created_at,
        gc.created_by,
        gcm.last_read_at,
        dgc.deleted_at,
        gm.id AS last_message_id,
        gm.content AS last_message,
        gm.attachment_type AS last_message_attachment_type,
        gm.created_at AS last_message_at,
        gm.sender_id AS last_message_sender_id,
        sender.username AS last_message_sender_username,
        sender.account_name AS last_message_sender_account_name,
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
      LEFT JOIN deleted_group_chats dgc
        ON dgc.group_chat_id = gc.id
       AND dgc.user_id = $1
      LEFT JOIN LATERAL (
        SELECT gm.*
        FROM group_messages gm
        WHERE gm.group_chat_id = gc.id
          AND (
            dgc.deleted_at IS NULL OR gm.created_at > dgc.deleted_at
          )
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
            'account_name', u.account_name,
            'profile_pic', u.profile_pic
          )
          ORDER BY CASE WHEN u.id = $1 THEN 1 ELSE 0 END, LOWER(u.username) ASC
        ) AS members
        FROM group_chat_members members
        JOIN users u
          ON u.id = members.user_id
        WHERE members.group_chat_id = gc.id
      ) member_summary ON true
      WHERE (
        dgc.group_chat_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM group_messages visible_message
          WHERE visible_message.group_chat_id = gc.id
            AND visible_message.created_at > dgc.deleted_at
        )
      )
      ORDER BY gm.created_at DESC NULLS LAST, gc.created_at DESC
      `,
      [userId]
    );

    res.json(
      rows.map((chat) => ({
        id: chat.id,
        group_name: chat.group_name,
        group_image: chat.group_image,
        created_at: chat.created_at,
        created_by: chat.created_by,
        last_message: chat.last_message,
        last_message_attachment_type: chat.last_message_attachment_type,
        last_message_at: chat.last_message_at,
        last_message_sender_id: chat.last_message_sender_id,
        last_message_sender_username: chat.last_message_sender_username,
        last_message_sender_account_name: chat.last_message_sender_account_name,
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
    await ensureDeletedGroupMessagesTable();
    await ensureGroupMessageRepliesSchema();
    await ensureGroupMessageReactionsSchema();
    await ensureAccountNameSchema();

    const groupResult = await pool.query(
      `
      SELECT
        gc.id,
        gc.group_name,
        gc.group_image,
        gc.created_at,
        gc.created_by,
        gc.admin_user_ids,
        gc.member_add_requires_admin_approval,
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
        u.account_name,
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
        sender.account_name AS sender_account_name,
        sender.profile_pic AS sender_profile_pic,
        CASE
          WHEN reply_dgm.message_id IS NULL THEN reply_message.content
          ELSE NULL
        END AS reply_to_content,
        CASE
          WHEN reply_dgm.message_id IS NULL THEN reply_message.sender_id
          ELSE NULL
        END AS reply_to_sender_id,
        reply_sender.username AS reply_to_sender_username,
        reply_sender.account_name AS reply_to_sender_account_name,
        COALESCE(reactions_agg.reactions, '[]'::json) AS reactions
      FROM group_messages gm
      JOIN users sender
        ON sender.id = gm.sender_id
      LEFT JOIN deleted_group_messages dgm
        ON dgm.message_id = gm.id
       AND dgm.user_id = $2
      LEFT JOIN group_messages reply_message
        ON reply_message.id = gm.reply_to_message_id
      LEFT JOIN users reply_sender
        ON reply_sender.id = reply_message.sender_id
      LEFT JOIN deleted_group_messages reply_dgm
        ON reply_dgm.message_id = reply_message.id
       AND reply_dgm.user_id = $2
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
            gmr.reaction,
            COUNT(*)::int AS reaction_count,
            BOOL_OR(gmr.user_id = $2) AS reacted_by_me,
            MIN(gmr.created_at) AS first_reacted_at
          FROM group_message_reactions gmr
          WHERE gmr.message_id = gm.id
          GROUP BY gmr.reaction
        ) grouped
      ) reactions_agg ON true
      WHERE gm.group_chat_id = $1
        AND dgm.message_id IS NULL
      ORDER BY gm.created_at ASC
      `,
      [groupChatId, userId]
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
        group_image: groupChat.group_image,
        created_at: groupChat.created_at,
        created_by: groupChat.created_by,
        admin_user_ids: groupChat.admin_user_ids || [],
        member_add_requires_admin_approval: Boolean(groupChat.member_add_requires_admin_approval),
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
    const replyToMessageId = String(req.body?.replyToMessageId || "").trim() || null;
    const attachment = req.file || null;

    await ensureGroupChatSchema();
    await ensureGroupMessageRepliesSchema();
    await ensureGroupMessageReactionsSchema();
    await ensureDeletedGroupMessagesTable();
    await ensureAccountNameSchema();

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

    let replyTargetSenderId = null;

    if (replyToMessageId) {
      const replyTargetResult = await pool.query(
        `
        SELECT id, sender_id
        FROM group_messages
        WHERE id = $1
          AND group_chat_id = $2
        LIMIT 1
        `,
        [replyToMessageId, groupChatId]
      );

      if (replyTargetResult.rows.length === 0) {
        return res.status(400).json({ error: "Reply target was not found" });
      }

      replyTargetSenderId = replyTargetResult.rows[0].sender_id || null;
    }

    const messageId = uuidv4();

    await assertContentAllowedOrReport({
      userId: senderId,
      contentType: "group_message",
      contentId: messageId,
      text: content,
      media: getModerationAttachment(attachment),
      context: {
        surface: "group_message_send",
        group_chat_id: groupChatId,
        has_attachment: Boolean(attachment),
      },
    });

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

    const { rows } = await pool.query(
      `
      INSERT INTO group_messages (
        id,
        group_chat_id,
        sender_id,
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
        messageId,
        groupChatId,
        senderId,
        storedContent,
        replyToMessageId,
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
      SELECT username, account_name, profile_pic
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
      memberIdsResult.rows.map((row) => {
        const pushType =
          replyTargetSenderId && String(row.user_id) === String(replyTargetSenderId)
            ? "group_message_reply"
            : "group_message";

        return sendPushToUser(row.user_id, {
          title: senderResult.rows[0]?.account_name || senderResult.rows[0]?.username || "New group message",
          body: storedContent,
          categoryId: "messageReply",
          data: {
            type: pushType,
            groupChatId,
            senderId,
            messageId,
          },
        });
      })
    );

    const enrichedMessage = await fetchGroupMessageForUser(message.id, senderId);

    res.json(
      enrichedMessage || {
        ...message,
        sender_username: senderResult.rows[0]?.username || "Member",
        sender_account_name: senderResult.rows[0]?.account_name || null,
        sender_profile_pic: senderResult.rows[0]?.profile_pic || null,
      }
    );
  } catch (err) {
    console.error(err);
    if (err instanceof ContentModerationError) {
      return res.status(err.statusCode || 400).json({
        error: err.message,
        moderation: err.result,
      });
    }

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

router.get("/groups/messages/:messageId/reactions", authenticateToken, async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user.id;

  try {
    await ensureGroupChatSchema();
    await ensureGroupMessageReactionsSchema();
    await ensureAccountNameSchema();

    const messageResult = await pool.query(
      `
      SELECT gm.id
      FROM group_messages gm
      JOIN group_chat_members gcm
        ON gcm.group_chat_id = gm.group_chat_id
       AND gcm.user_id = $2
      WHERE gm.id = $1
      LIMIT 1
      `,
      [messageId, userId]
    );

    if (messageResult.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    const viewers = await fetchGroupMessageReactionViewers(messageId, userId);
    return res.json({ reactions: viewers });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to load reaction viewers" });
  }
});

router.post("/groups/messages/:messageId/react", authenticateToken, async (req, res) => {
  const { messageId } = req.params;
  const { reaction = null } = req.body || {};
  const userId = req.user.id;
  const allowedReactions = new Set(["like", "heart", "laugh", "wow", "sad", "angry", "care"]);

  if (reaction && !allowedReactions.has(reaction)) {
    return res.status(400).json({ error: "Invalid reaction" });
  }

  try {
    await ensureGroupChatSchema();
    await ensureGroupMessageReactionsSchema();

    const messageResult = await pool.query(
      `
      SELECT gm.id, gm.group_chat_id, gm.sender_id
      FROM group_messages gm
      JOIN group_chat_members gcm
        ON gcm.group_chat_id = gm.group_chat_id
       AND gcm.user_id = $2
      WHERE gm.id = $1
      LIMIT 1
      `,
      [messageId, userId]
    );

    if (messageResult.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    const targetMessage = messageResult.rows[0];

    if (!reaction) {
      await pool.query(
        `
        DELETE FROM group_message_reactions
        WHERE message_id = $1
          AND user_id = $2
        `,
        [messageId, userId]
      );
    } else {
      await pool.query(
        `
        INSERT INTO group_message_reactions (message_id, user_id, reaction)
        VALUES ($1, $2, $3)
        ON CONFLICT (message_id, user_id)
        DO UPDATE SET reaction = EXCLUDED.reaction, created_at = NOW()
        `,
        [messageId, userId, reaction]
      );

      await createNotification({
        recipientId: targetMessage.sender_id,
        actorId: userId,
        type: "message_reaction",
        groupChatId: targetMessage.group_chat_id,
        messageId,
        pushCategoryId: "messageReply",
        pushData: {
          type: "group_message_reaction",
          groupChatId: targetMessage.group_chat_id,
          messageId,
          reaction,
          actorId: userId,
        },
      });
    }

    const enrichedMessage = await fetchGroupMessageForUser(messageId, userId);
    return res.json({ success: true, message: enrichedMessage });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to update reaction" });
  }
});

router.delete("/groups/messages/:messageId", authenticateToken, async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user.id;

  try {
    const { rows } = await pool.query(
      `
      DELETE FROM group_messages
      WHERE id = $1
        AND sender_id = $2
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

router.post("/groups/messages/delete-for-me", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { messageId } = req.body || {};

  if (!messageId) {
    return res.status(400).json({ error: "messageId is required" });
  }

  try {
    await ensureDeletedGroupMessagesTable();

    const messageResult = await pool.query(
      `
      SELECT gm.id
      FROM group_messages gm
      JOIN group_chat_members gcm
        ON gcm.group_chat_id = gm.group_chat_id
       AND gcm.user_id = $2
      WHERE gm.id = $1
      LIMIT 1
      `,
      [messageId, userId]
    );

    if (messageResult.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    await pool.query(
      `
      INSERT INTO deleted_group_messages (user_id, message_id)
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

router.post("/groups/messages/report", authenticateToken, async (req, res) => {
  const reporterId = req.user.id;
  const { messageId, reason = "message", details = null } = req.body || {};

  if (!messageId) {
    return res.status(400).json({ error: "messageId is required" });
  }

  try {
    const messageResult = await pool.query(
      `
      SELECT gm.id, gm.group_chat_id
      FROM group_messages gm
      JOIN group_chat_members gcm
        ON gcm.group_chat_id = gm.group_chat_id
       AND gcm.user_id = $2
      WHERE gm.id = $1
      LIMIT 1
      `,
      [messageId, reporterId]
    );

    if (messageResult.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    const reportDetails = String(details || "").trim() || null;

    const { rows } = await pool.query(
      `
      INSERT INTO reports (reporter_id, content_type, content_id, reason, details)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [reporterId, "group_message", messageId, reason, reportDetails]
    );

    return res.status(201).json({ success: true, report: rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to report message" });
  }
});

router.patch("/groups/chats/:groupChatId/name", authenticateToken, async (req, res) => {
  const { groupChatId } = req.params;
  const userId = req.user.id;
  const groupName = String(req.body?.groupName || "").trim();

  if (groupName.length < 2) {
    return res.status(400).json({ error: "Group name is required" });
  }

  try {
    await ensureGroupChatSchema();

    const { rows } = await pool.query(
      `
      UPDATE group_chats
      SET group_name = $3
      WHERE id = $1
        AND $2 = ANY(admin_user_ids)
      RETURNING id, group_name
      `,
      [groupChatId, userId, groupName]
    );

    if (rows.length === 0) {
      return res.status(403).json({ error: "Only admins can change the group name" });
    }

    res.json({ success: true, group_name: rows[0].group_name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to change group name" });
  }
});

router.post("/groups/chats/:groupChatId/image", authenticateToken, async (req, res) => {
  const { groupChatId } = req.params;
  const userId = req.user.id;

  try {
    await parseGroupImage(req, res);
    await ensureGroupChatSchema();

    if (!req.file) {
      return res.status(400).json({ error: "Image is required" });
    }

    const adminResult = await pool.query(
      `
      SELECT id
      FROM group_chats
      WHERE id = $1
        AND $2 = ANY(admin_user_ids)
      LIMIT 1
      `,
      [groupChatId, userId]
    );

    if (adminResult.rows.length === 0) {
      return res.status(403).json({ error: "Only admins can change the group image" });
    }

    const extension = path.extname(req.file.originalname || "").toLowerCase() || ".jpg";
    const imageName = sanitizeFileName(path.basename(req.file.originalname || "group-image", extension));
    const key = `group-chats/${groupChatId}/image-${uuidv4()}-${imageName}${extension}`;

    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      })
    );

    const imageUrl = `${process.env.R2_PUBLIC_URL}/${key}`;

    await pool.query(
      `
      UPDATE group_chats
      SET group_image = $2
      WHERE id = $1
      `,
      [groupChatId, imageUrl]
    );

    res.json({ success: true, group_image: imageUrl });
  } catch (err) {
    console.error(err);
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Images must be 5MB or smaller" });
    }
    res.status(500).json({ error: err.message || "Failed to change group image" });
  }
});

router.get("/groups/chats/:groupChatId/members", authenticateToken, async (req, res) => {
  const { groupChatId } = req.params;
  const userId = req.user.id;

  try {
    await ensureGroupChatSchema();
    await ensureAccountNameSchema();

    const groupResult = await pool.query(
      `
      SELECT admin_user_ids
      FROM group_chats
      WHERE id = $1
        AND EXISTS (
          SELECT 1
          FROM group_chat_members gcm
          WHERE gcm.group_chat_id = group_chats.id
            AND gcm.user_id = $2
        )
      LIMIT 1
      `,
      [groupChatId, userId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: "Group chat not found" });
    }

    const adminUserIds = groupResult.rows[0].admin_user_ids || [];

    const membersResult = await pool.query(
      `
      SELECT
        u.id,
        u.username,
        u.account_name,
        u.profile_pic,
        gcm.joined_at,
        u.id = ANY($2::uuid[]) AS is_admin
      FROM group_chat_members gcm
      JOIN users u
        ON u.id = gcm.user_id
      WHERE gcm.group_chat_id = $1
      ORDER BY LOWER(u.username) ASC
      `,
      [groupChatId, adminUserIds]
    );

    res.json({
      members: membersResult.rows,
      admins: membersResult.rows.filter((member) => member.is_admin),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load group members" });
  }
});

router.post("/groups/chats/:groupChatId/members", authenticateToken, async (req, res) => {
  const { groupChatId } = req.params;
  const userId = req.user.id;
  const rawMemberIds = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];
  const memberIds = Array.from(new Set(rawMemberIds.map((id) => String(id || "").trim()).filter(Boolean)));

  if (memberIds.length === 0) {
    return res.status(400).json({ error: "Choose at least one member to add" });
  }

  try {
    await ensureGroupChatSchema();
    await ensureBlockedUsersTable();

    const groupResult = await pool.query(
      `
      SELECT admin_user_ids, member_add_requires_admin_approval
      FROM group_chats
      WHERE id = $1
        AND EXISTS (
          SELECT 1
          FROM group_chat_members gcm
          WHERE gcm.group_chat_id = group_chats.id
            AND gcm.user_id = $2
        )
      LIMIT 1
      `,
      [groupChatId, userId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: "Group chat not found" });
    }

    const group = groupResult.rows[0];
    const adminUserIds = (group.admin_user_ids || []).map((id) => String(id));
    const requesterIsAdmin = adminUserIds.includes(String(userId));
    const requiresAdminApproval = Boolean(group.member_add_requires_admin_approval);

    if (requiresAdminApproval && !requesterIsAdmin) {
      return res.status(403).json({ error: "Only admins can add members when approval is required" });
    }

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
      return res.status(400).json({ error: "Some selected users are unavailable" });
    }

    const blockedResult = await pool.query(
      `
      SELECT target_id
      FROM unnest($1::uuid[]) AS target_id
      WHERE EXISTS (
        SELECT 1
        FROM blocked_users bu
        WHERE (bu.blocker_id = $2 AND bu.blocked_id = target_id)
           OR (bu.blocker_id = target_id AND bu.blocked_id = $2)
      )
      `,
      [validMemberIds, userId]
    );

    if (blockedResult.rows.length > 0) {
      return res.status(403).json({ error: "You cannot add blocked users" });
    }

    const insertResult = await pool.query(
      `
      INSERT INTO group_chat_members (group_chat_id, user_id, joined_at, last_read_at)
      SELECT $1, member_id, NOW(), NOW()
      FROM unnest($2::uuid[]) AS member_id
      ON CONFLICT (group_chat_id, user_id) DO NOTHING
      RETURNING user_id
      `,
      [groupChatId, validMemberIds]
    );

    const membersResult = await pool.query(
      `
      SELECT
        u.id,
        u.username,
        u.account_name,
        u.profile_pic,
        gcm.joined_at,
        u.id = ANY($2::uuid[]) AS is_admin
      FROM group_chat_members gcm
      JOIN users u
        ON u.id = gcm.user_id
      WHERE gcm.group_chat_id = $1
      ORDER BY LOWER(u.username) ASC
      `,
      [groupChatId, adminUserIds]
    );

    return res.json({
      success: true,
      addedCount: insertResult.rows.length,
      members: membersResult.rows,
      admins: membersResult.rows.filter((member) => member.is_admin),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to add members" });
  }
});

router.patch("/groups/chats/:groupChatId/settings", authenticateToken, async (req, res) => {
  const { groupChatId } = req.params;
  const userId = req.user.id;
  const requiresApproval = Boolean(req.body?.memberAddRequiresAdminApproval);

  try {
    await ensureGroupChatSchema();

    const updateResult = await pool.query(
      `
      UPDATE group_chats
      SET member_add_requires_admin_approval = $3
      WHERE id = $1
        AND $2 = ANY(admin_user_ids)
      RETURNING member_add_requires_admin_approval
      `,
      [groupChatId, userId, requiresApproval]
    );

    if (updateResult.rows.length === 0) {
      return res.status(403).json({ error: "Only admins can change group settings" });
    }

    return res.json({
      success: true,
      member_add_requires_admin_approval: Boolean(
        updateResult.rows[0].member_add_requires_admin_approval
      ),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to update group settings" });
  }
});

router.post("/groups/chats/:groupChatId/member-add-requests", authenticateToken, async (req, res) => {
  const { groupChatId } = req.params;
  const userId = req.user.id;
  const rawMemberIds = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];
  const memberIds = Array.from(new Set(rawMemberIds.map((id) => String(id || "").trim()).filter(Boolean)));

  if (memberIds.length === 0) {
    return res.status(400).json({ error: "Choose at least one member to request" });
  }

  try {
    await ensureGroupChatSchema();
    await ensureGroupMemberAddRequestsSchema();
    await ensureAccountNameSchema();
    await ensureBlockedUsersTable();

    const groupResult = await pool.query(
      `
      SELECT admin_user_ids, member_add_requires_admin_approval
      FROM group_chats
      WHERE id = $1
        AND EXISTS (
          SELECT 1
          FROM group_chat_members gcm
          WHERE gcm.group_chat_id = group_chats.id
            AND gcm.user_id = $2
        )
      LIMIT 1
      `,
      [groupChatId, userId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: "Group chat not found" });
    }

    const group = groupResult.rows[0];
    const requesterIsAdmin = (group.admin_user_ids || []).some(
      (adminId) => String(adminId) === String(userId)
    );

    if (!group.member_add_requires_admin_approval) {
      return res.status(400).json({ error: "Admin approval is not required for this group" });
    }

    if (requesterIsAdmin) {
      return res.status(400).json({ error: "Admins can add members directly" });
    }

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
      return res.status(400).json({ error: "Some selected users are unavailable" });
    }

    const blockedResult = await pool.query(
      `
      SELECT target_id
      FROM unnest($1::uuid[]) AS target_id
      WHERE EXISTS (
        SELECT 1
        FROM blocked_users bu
        WHERE (bu.blocker_id = $2 AND bu.blocked_id = target_id)
           OR (bu.blocker_id = target_id AND bu.blocked_id = $2)
      )
      `,
      [validMemberIds, userId]
    );

    if (blockedResult.rows.length > 0) {
      return res.status(403).json({ error: "You cannot request blocked users" });
    }

    const requestId = uuidv4();

    await pool.query(
      `
      INSERT INTO group_member_add_requests (
        id,
        group_chat_id,
        requester_id,
        requested_member_ids,
        status,
        created_at
      )
      VALUES ($1, $2, $3, $4::uuid[], 'pending', NOW())
      `,
      [requestId, groupChatId, userId, validMemberIds]
    );

    return res.status(201).json({ success: true, requestId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to create add-member request" });
  }
});

router.get("/groups/chats/:groupChatId/member-add-requests", authenticateToken, async (req, res) => {
  const { groupChatId } = req.params;
  const userId = req.user.id;

  try {
    await ensureGroupChatSchema();
    await ensureGroupMemberAddRequestsSchema();

    const groupResult = await pool.query(
      `
      SELECT admin_user_ids
      FROM group_chats
      WHERE id = $1
        AND EXISTS (
          SELECT 1
          FROM group_chat_members gcm
          WHERE gcm.group_chat_id = group_chats.id
            AND gcm.user_id = $2
        )
      LIMIT 1
      `,
      [groupChatId, userId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: "Group chat not found" });
    }

    const isAdmin = (groupResult.rows[0].admin_user_ids || []).some(
      (adminId) => String(adminId) === String(userId)
    );

    if (!isAdmin) {
      return res.status(403).json({ error: "Only admins can view pending requests" });
    }

    const requestsResult = await pool.query(
      `
      SELECT
        r.id,
        r.requested_member_ids,
        r.created_at,
        requester.id AS requester_id,
        requester.username AS requester_username,
        requester.account_name AS requester_account_name,
        requester.profile_pic AS requester_profile_pic
      FROM group_member_add_requests r
      JOIN users requester
        ON requester.id = r.requester_id
      WHERE r.group_chat_id = $1
        AND r.status = 'pending'
      ORDER BY r.created_at DESC
      `,
      [groupChatId]
    );

    const requests = [];

    for (const row of requestsResult.rows) {
      const requestedIds = Array.isArray(row.requested_member_ids) ? row.requested_member_ids : [];
      const usersResult = await pool.query(
        `
        SELECT id, username, account_name, profile_pic
        FROM users
        WHERE id = ANY($1::uuid[])
          AND deactivated_at IS NULL
          AND deleted_at IS NULL
        ORDER BY LOWER(username) ASC
        `,
        [requestedIds]
      );

      requests.push({
        id: row.id,
        created_at: row.created_at,
        requester: {
          id: row.requester_id,
          username: row.requester_username,
          account_name: row.requester_account_name,
          profile_pic: row.requester_profile_pic,
        },
        requested_members: usersResult.rows,
      });
    }

    return res.json({ requests });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to load add-member requests" });
  }
});

router.patch("/groups/chats/:groupChatId/member-add-requests/:requestId", authenticateToken, async (req, res) => {
  const { groupChatId, requestId } = req.params;
  const userId = req.user.id;
  const action = String(req.body?.action || "").toLowerCase();

  if (!["approve", "reject"].includes(action)) {
    return res.status(400).json({ error: "Invalid action" });
  }

  try {
    await ensureGroupChatSchema();
    await ensureGroupMemberAddRequestsSchema();
    await ensureBlockedUsersTable();

    const groupResult = await pool.query(
      `
      SELECT admin_user_ids
      FROM group_chats
      WHERE id = $1
        AND EXISTS (
          SELECT 1
          FROM group_chat_members gcm
          WHERE gcm.group_chat_id = group_chats.id
            AND gcm.user_id = $2
        )
      LIMIT 1
      `,
      [groupChatId, userId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: "Group chat not found" });
    }

    const isAdmin = (groupResult.rows[0].admin_user_ids || []).some(
      (adminId) => String(adminId) === String(userId)
    );

    if (!isAdmin) {
      return res.status(403).json({ error: "Only admins can review requests" });
    }

    const requestResult = await pool.query(
      `
      SELECT requested_member_ids
      FROM group_member_add_requests
      WHERE id = $1
        AND group_chat_id = $2
        AND status = 'pending'
      LIMIT 1
      `,
      [requestId, groupChatId]
    );

    if (requestResult.rows.length === 0) {
      return res.status(404).json({ error: "Pending request not found" });
    }

    const requestedMemberIds = Array.isArray(requestResult.rows[0].requested_member_ids)
      ? requestResult.rows[0].requested_member_ids.map((id) => String(id))
      : [];

    if (action === "approve" && requestedMemberIds.length > 0) {
      const blockedResult = await pool.query(
        `
        SELECT target_id
        FROM unnest($1::uuid[]) AS target_id
        WHERE EXISTS (
          SELECT 1
          FROM blocked_users bu
          WHERE (bu.blocker_id = $2 AND bu.blocked_id = target_id)
             OR (bu.blocker_id = target_id AND bu.blocked_id = $2)
        )
        `,
        [requestedMemberIds, userId]
      );

      if (blockedResult.rows.length > 0) {
        return res.status(403).json({ error: "Cannot approve request containing blocked users" });
      }

      await pool.query(
        `
        INSERT INTO group_chat_members (group_chat_id, user_id, joined_at, last_read_at)
        SELECT $1, member_id, NOW(), NOW()
        FROM unnest($2::uuid[]) AS member_id
        ON CONFLICT (group_chat_id, user_id) DO NOTHING
        `,
        [groupChatId, requestedMemberIds]
      );
    }

    await pool.query(
      `
      UPDATE group_member_add_requests
      SET status = $3,
          reviewed_by = $4,
          reviewed_at = NOW()
      WHERE id = $1
        AND group_chat_id = $2
      `,
      [requestId, groupChatId, action === "approve" ? "approved" : "rejected", userId]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to review request" });
  }
});

router.patch("/groups/chats/:groupChatId/admins/:memberId", authenticateToken, async (req, res) => {
  const { groupChatId, memberId } = req.params;
  const userId = req.user.id;
  const makeAdmin = Boolean(req.body?.isAdmin);

  try {
    await ensureGroupChatSchema();

    const groupResult = await pool.query(
      `
      SELECT admin_user_ids
      FROM group_chats
      WHERE id = $1
        AND EXISTS (
          SELECT 1
          FROM group_chat_members gcm
          WHERE gcm.group_chat_id = group_chats.id
            AND gcm.user_id = $2
        )
      LIMIT 1
      `,
      [groupChatId, userId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: "Group chat not found" });
    }

    const currentAdmins = (groupResult.rows[0].admin_user_ids || []).map((id) => String(id));
    const requesterIsAdmin = currentAdmins.includes(String(userId));

    if (!requesterIsAdmin) {
      return res.status(403).json({ error: "Only admins can manage admins" });
    }

    const memberResult = await pool.query(
      `
      SELECT u.id, u.username, u.account_name
      FROM group_chat_members gcm
      JOIN users u
        ON u.id = gcm.user_id
      WHERE gcm.group_chat_id = $1
        AND gcm.user_id = $2
      LIMIT 1
      `,
      [groupChatId, memberId]
    );

    if (memberResult.rows.length === 0) {
      return res.status(404).json({ error: "Member not found" });
    }

    let nextAdmins;

    if (makeAdmin) {
      nextAdmins = Array.from(new Set([...currentAdmins, String(memberId)]));
    } else {
      if (String(memberId) === String(userId) && currentAdmins.length === 1) {
        return res.status(400).json({ error: "The group must keep at least one admin" });
      }

      nextAdmins = currentAdmins.filter((adminId) => adminId !== String(memberId));

      if (nextAdmins.length === 0) {
        return res.status(400).json({ error: "The group must keep at least one admin" });
      }
    }

    await pool.query(
      `
      UPDATE group_chats
      SET admin_user_ids = $2::uuid[]
      WHERE id = $1
      `,
      [groupChatId, nextAdmins]
    );

    const membersResult = await pool.query(
      `
      SELECT
        u.id,
        u.username,
        u.account_name,
        u.profile_pic,
        gcm.joined_at,
        u.id = ANY($2::uuid[]) AS is_admin
      FROM group_chat_members gcm
      JOIN users u
        ON u.id = gcm.user_id
      WHERE gcm.group_chat_id = $1
      ORDER BY LOWER(u.username) ASC
      `,
      [groupChatId, nextAdmins]
    );

    return res.json({
      success: true,
      members: membersResult.rows,
      admins: membersResult.rows.filter((member) => member.is_admin),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to update admin status" });
  }
});

router.post("/groups/chats/:groupChatId/leave", authenticateToken, async (req, res) => {
  const { groupChatId } = req.params;
  const userId = req.user.id;
  const successorAdminId = String(req.body?.successorAdminId || "").trim() || null;

  try {
    await ensureGroupChatSchema();

    const groupResult = await pool.query(
      `
      SELECT admin_user_ids
      FROM group_chats
      WHERE id = $1
      LIMIT 1
      `,
      [groupChatId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: "Group chat not found" });
    }

    const membersBeforeLeaveResult = await pool.query(
      `
      SELECT user_id
      FROM group_chat_members
      WHERE group_chat_id = $1
      ORDER BY joined_at ASC
      `,
      [groupChatId]
    );

    const remainingMemberIds = membersBeforeLeaveResult.rows
      .map((row) => String(row.user_id))
      .filter((memberId) => memberId !== String(userId));

    const currentAdmins = (groupResult.rows[0].admin_user_ids || []).filter(
      (adminId) => String(adminId) !== String(userId)
    );

    if (currentAdmins.length === 0 && remainingMemberIds.length > 0) {
      if (!successorAdminId) {
        return res.status(400).json({ error: "Choose a new admin before leaving the group" });
      }

      if (!remainingMemberIds.includes(String(successorAdminId))) {
        return res.status(400).json({ error: "Selected member must still be in the group" });
      }
    }

    await pool.query(
      `
      DELETE FROM group_chat_members
      WHERE group_chat_id = $1
        AND user_id = $2
      `,
      [groupChatId, userId]
    );

    if (remainingMemberIds.length === 0) {
      await pool.query(`DELETE FROM group_chats WHERE id = $1`, [groupChatId]);
      return res.json({ success: true, deleted: true });
    }

    const nextAdmins =
      currentAdmins.length > 0
        ? currentAdmins
        : [successorAdminId];

    await pool.query(
      `
      UPDATE group_chats
      SET admin_user_ids = $2::uuid[]
      WHERE id = $1
      `,
      [groupChatId, nextAdmins]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to leave group" });
  }
});

router.post("/groups/chats/:groupChatId/delete", authenticateToken, async (req, res) => {
  const { groupChatId } = req.params;
  const userId = req.user.id;

  try {
    await ensureGroupChatSchema();
    await ensureDeletedGroupChatsTable();

    const groupResult = await pool.query(
      `
      SELECT admin_user_ids
      FROM group_chats
      WHERE id = $1
      LIMIT 1
      `,
      [groupChatId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: "Group chat not found" });
    }

    const isAdmin = (groupResult.rows[0].admin_user_ids || []).some(
      (adminId) => String(adminId) === String(userId)
    );

    if (isAdmin) {
      await pool.query(`DELETE FROM group_chats WHERE id = $1`, [groupChatId]);
      return res.json({ success: true, deletedForEveryone: true });
    }

    await pool.query(
      `
      INSERT INTO deleted_group_chats (user_id, group_chat_id, deleted_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id, group_chat_id)
      DO UPDATE SET deleted_at = EXCLUDED.deleted_at
      `,
      [userId, groupChatId]
    );

    res.json({ success: true, deletedForEveryone: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete group chat" });
  }
});

export default router;
