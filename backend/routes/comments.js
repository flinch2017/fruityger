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

        COUNT(cl.comment_id) AS like_count,
        BOOL_OR(cl.user_id = $2) AS is_liked

      FROM comments c

      JOIN users u ON u.id = c.user_id
      LEFT JOIN comment_likes cl
        ON cl.comment_id = c.comment_id

      WHERE c.post_id = $1

      GROUP BY
        c.comment_id,
        u.username

      ORDER BY c.date_commented ASC

      LIMIT $3 OFFSET $4
    `, [postId, userId, limit, offset]);

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

    const result = await pool.query(`
      INSERT INTO comments
      (post_id, user_id, commented_text, parent_comment_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [postId, userId, text, finalParentId]);

    res.status(201).json(result.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create comment" });
  }
});

export default router;