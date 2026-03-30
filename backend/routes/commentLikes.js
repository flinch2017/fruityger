import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";
import { createNotification } from "../utils/notifications.js";

const router = express.Router();

/* =========================================
   TOGGLE COMMENT LIKE
========================================= */
router.post("/toggle", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { commentId } = req.body;

    if (!commentId) {
      return res.status(400).json({ error: "commentId required" });
    }

    // Check if already liked
    const existing = await pool.query(
      `SELECT * FROM comment_likes
       WHERE comment_id = $1
       AND user_id = $2`,
      [commentId, userId]
    );

    // If exists → unlike
    if (existing.rows.length > 0) {
      await pool.query(
        `DELETE FROM comment_likes
         WHERE comment_id = $1
         AND user_id = $2`,
        [commentId, userId]
      );

      return res.json({
        liked: false,
        message: "Unliked"
      });
    }

    // If not exists → like
    await pool.query(
      `INSERT INTO comment_likes
       (comment_id, user_id)
       VALUES ($1, $2)`,
      [commentId, userId]
    );

    const commentOwnerResult = await pool.query(
      `
      SELECT user_id, post_id
      FROM comments
      WHERE comment_id = $1
      `,
      [commentId]
    );

    await createNotification({
      recipientId: commentOwnerResult.rows[0]?.user_id,
      actorId: userId,
      type: "comment_like",
      postId: commentOwnerResult.rows[0]?.post_id || null,
      commentId,
    });

    res.json({
      liked: true,
      message: "Liked"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Toggle like failed" });
  }
});

export default router;
