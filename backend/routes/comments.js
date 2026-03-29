import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

/* =========================================
   GET COMMENTS FOR POST
========================================= */
router.get("/:postId", authenticateToken, async (req, res) => {
  try {

    const { postId } = req.params;
    const userId = req.user.id;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const offset = (page - 1) * limit;

    const result = await pool.query(`
      SELECT
        c.comment_id,
        c.post_id,
        c.user_id,
        c.commented_text,
        c.parent_comment_id,
        c.date_commented,

        u.username,
        u.profile_pic,

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
        u.profile_pic

      ORDER BY c.date_commented ASC
      LIMIT $3 OFFSET $4
    `, [
      postId,
      userId,
      limit,
      offset
    ]);

    res.json({
      comments: result.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});


/* =========================================
   CREATE COMMENT / REPLY
========================================= */
router.post("/", authenticateToken, async (req, res) => {
  try {
    const { postId, text, parentId } = req.body;
    const userId = req.user.id;

    let finalParentId = null;

    if (parentId) {
      // Check if parent exists
      const parent = await pool.query(
        `SELECT parent_comment_id
         FROM comments
         WHERE comment_id = $1`,
        [parentId]
      );

      if (parent.rows.length === 0) {
        return res.status(400).json({ error: "Invalid parent comment" });
      }

      // 🔥 If replying to reply, attach to root parent
      finalParentId =
        parent.rows[0].parent_comment_id || parentId;
    }

    // 1. Insert comment
    const insert = await pool.query(`
      INSERT INTO comments
      (post_id, user_id, commented_text, parent_comment_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [postId, userId, text, finalParentId]);

    const newComment = insert.rows[0];

    // 2. Get full data (JOIN users + likes)
    const full = await pool.query(`
      SELECT
        c.comment_id,
        c.post_id,
        c.user_id,
        c.commented_text,
        c.parent_comment_id,
        c.date_commented,

        u.username,
        u.profile_pic,

        0::int AS like_count,
        false AS is_liked

      FROM comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.comment_id = $1
    `, [newComment.comment_id]);

    res.status(201).json(full.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create comment" });
  }
});

// Add to your comments router
router.get("/single/:commentId", authenticateToken, async (req, res) => {
  try {
    const { commentId } = req.params;
    const result = await pool.query(`
      SELECT
        c.comment_id,
        c.post_id,
        c.user_id,
        c.commented_text,
        c.parent_comment_id,
        c.date_commented,
        u.username,
        u.profile_pic,
        0::int AS like_count,
        false AS is_liked
      FROM comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.comment_id = $1
    `, [commentId]);

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
    // Check if comment exists and fetch its owner + post author
    const result = await pool.query(
      `SELECT user_id, post_id FROM comments WHERE comment_id = $1`,
      [commentId]
    );

    const comment = result.rows[0];
    if (!comment) return res.status(404).json({ error: "Comment not found" });

    // Check if requester is comment author OR post author
    const postResult = await pool.query(
      `SELECT user_id FROM posts WHERE post_id = $1`,
      [comment.post_id]
    );
    const postAuthorId = postResult.rows[0].user_id;

    if (comment.user_id !== userId && postAuthorId !== userId) {
      return res.status(403).json({ error: "Not authorized to delete this comment" });
    }

    // Delete the comment (will cascade to replies)
    await pool.query(`DELETE FROM comments WHERE comment_id = $1`, [commentId]);

    res.json({ success: true, commentId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;