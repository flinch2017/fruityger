import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";
import { createNotification } from "../utils/notifications.js";
import { extractMentionUsernames } from "../utils/mentions.js";
import { canViewUserActivity, ensurePrivateAccountSchema } from "../utils/privacy.js";
import { ensureVerificationBadgeSchema } from "../utils/verificationBadge.js";
import { assertContentAllowedOrReport, ContentModerationError } from "../utils/contentModeration.js";

const router = express.Router();

router.get("/:postId", authenticateToken, async (req, res) => {
  try {
    await ensurePrivateAccountSchema();
    await ensureVerificationBadgeSchema();
    const { postId } = req.params;
    const userId = req.user.id;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = (page - 1) * limit;

    const postResult = await pool.query(
      `SELECT user_id FROM posts WHERE post_id = $1 LIMIT 1`,
      [postId]
    );

    const postOwnerId = postResult.rows[0]?.user_id;
    if (!postOwnerId) {
      return res.status(404).json({ error: "Post not found" });
    }

    if (!(await canViewUserActivity(userId, postOwnerId))) {
      return res.status(403).json({ error: "This post is private" });
    }

    const result = await pool.query(
      `
      SELECT
        c.comment_id,
        c.post_id,
        c.user_id,
        c.commented_text,
        c.parent_comment_id,
        c.date_commented,
        u.username,
        u.profile_pic,
        u.is_verified,
        COUNT(DISTINCT cl.comment_id)::int AS like_count,
        EXISTS (
          SELECT 1
          FROM comment_likes
          WHERE comment_id = c.comment_id
            AND user_id = $2
        ) AS is_liked
      FROM comments c
      JOIN users u
        ON u.id = c.user_id
      LEFT JOIN comment_likes cl
        ON cl.comment_id = c.comment_id
      WHERE c.post_id = $1
      GROUP BY
        c.comment_id,
        c.post_id,
        c.user_id,
        c.commented_text,
        c.parent_comment_id,
        c.date_commented,
        u.username,
        u.profile_pic,
        u.is_verified
      ORDER BY c.date_commented ASC
      LIMIT $3 OFFSET $4
      `,
      [postId, userId, limit, offset]
    );

    res.json({ comments: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

router.post("/", authenticateToken, async (req, res) => {
  try {
    await ensurePrivateAccountSchema();
    await ensureVerificationBadgeSchema();
    const { postId, text, parentId } = req.body;
    const userId = req.user.id;

    let finalParentId = null;
    let replyTarget = null;

    if (parentId) {
      const parent = await pool.query(
        `
        SELECT comment_id, parent_comment_id, user_id
        FROM comments
        WHERE comment_id = $1
        `,
        [parentId]
      );

      if (parent.rows.length === 0) {
        return res.status(400).json({ error: "Invalid parent comment" });
      }

      replyTarget = parent.rows[0];
      finalParentId = replyTarget.parent_comment_id || parentId;
    }

    const postOwnerResult = await pool.query(
      `SELECT user_id FROM posts WHERE post_id = $1`,
      [postId]
    );

    const postOwnerId = postOwnerResult.rows[0]?.user_id;
    if (!postOwnerId) {
      return res.status(404).json({ error: "Post not found" });
    }

    if (!(await canViewUserActivity(userId, postOwnerId))) {
      return res.status(403).json({ error: "This post is private" });
    }

    const normalizedText = String(text || "").trim();
    await assertContentAllowedOrReport({
      userId,
      contentType: "comment",
      contentId: postId,
      text: normalizedText,
      context: {
        surface: parentId ? "comment_reply_create" : "comment_create",
        post_id: postId,
        parent_comment_id: finalParentId,
        reply_target_comment_id: parentId || null,
      },
    });

    const insert = await pool.query(
      `
      INSERT INTO comments
        (post_id, user_id, commented_text, parent_comment_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [postId, userId, normalizedText, finalParentId]
    );

    const newComment = insert.rows[0];

    const recipients = new Map();

    if (postOwnerId && postOwnerId !== userId) {
      recipients.set(postOwnerId, "post_comment");
    }

    if (replyTarget?.user_id && replyTarget.user_id !== userId) {
      recipients.set(replyTarget.user_id, "comment_reply");
    }

    for (const [recipientId, type] of recipients.entries()) {
      await createNotification({
        recipientId,
        actorId: userId,
        type,
        postId,
        commentId: newComment.comment_id,
      });
    }

    const mentionUsernames = extractMentionUsernames(normalizedText);
    if (mentionUsernames.length > 0) {
      const mentionTargets = await pool.query(
        `
        SELECT id
        FROM users
        WHERE LOWER(username) = ANY($1::text[])
          AND deactivated_at IS NULL
          AND deleted_at IS NULL
        `,
        [mentionUsernames]
      );

      const seenMentionIds = new Set();
      for (const row of mentionTargets.rows) {
        const recipientId = row.id;
        if (!recipientId || String(recipientId) === String(userId)) {
          continue;
        }

        if (seenMentionIds.has(String(recipientId))) {
          continue;
        }

        seenMentionIds.add(String(recipientId));
        await createNotification({
          recipientId,
          actorId: userId,
          type: "comment_mention",
          postId,
          commentId: newComment.comment_id,
        });
      }
    }

    const full = await pool.query(
      `
      SELECT
        c.comment_id,
        c.post_id,
        c.user_id,
        c.commented_text,
        c.parent_comment_id,
        c.date_commented,
        u.username,
        u.profile_pic,
        u.is_verified,
        0::int AS like_count,
        false AS is_liked
      FROM comments c
      JOIN users u
        ON u.id = c.user_id
      WHERE c.comment_id = $1
      `,
      [newComment.comment_id]
    );

    res.status(201).json(full.rows[0]);
  } catch (err) {
    console.error(err);
    if (err instanceof ContentModerationError) {
      return res.status(err.statusCode || 400).json({
        error: err.message,
        moderation: err.result,
      });
    }

    res.status(500).json({ error: "Failed to create comment" });
  }
});

router.get("/single/:commentId", authenticateToken, async (req, res) => {
  try {
    await ensureVerificationBadgeSchema();
    const { commentId } = req.params;
    const result = await pool.query(
      `
      SELECT
        c.comment_id,
        c.post_id,
        c.user_id,
        c.commented_text,
        c.parent_comment_id,
        c.date_commented,
        u.username,
        u.profile_pic,
        u.is_verified,
        0::int AS like_count,
        false AS is_liked
      FROM comments c
      JOIN users u
        ON u.id = c.user_id
      WHERE c.comment_id = $1
      `,
      [commentId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Comment not found" });
    }

    res.json({ comment: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch comment" });
  }
});

router.delete("/:commentId", authenticateToken, async (req, res) => {
  const { commentId } = req.params;
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT user_id, post_id FROM comments WHERE comment_id = $1`,
      [commentId]
    );

    const comment = result.rows[0];

    if (!comment) {
      return res.status(404).json({ error: "Comment not found" });
    }

    const postResult = await pool.query(
      `SELECT user_id FROM posts WHERE post_id = $1`,
      [comment.post_id]
    );

    const postAuthorId = postResult.rows[0]?.user_id;

    if (comment.user_id !== userId && postAuthorId !== userId) {
      return res.status(403).json({ error: "Not authorized to delete this comment" });
    }

    await pool.query(`DELETE FROM comments WHERE comment_id = $1`, [commentId]);

    res.json({ success: true, commentId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
