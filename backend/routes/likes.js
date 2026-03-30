import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";
import { createNotification } from "../utils/notifications.js";

const router = express.Router();

/* ===============================
   TOGGLE LIKE
================================ */
router.post("/toggle", authenticateToken, async (req, res) => {

  const userId = req.user.id; // must match what you store in JWT
  const { postId } = req.body;

  if (!postId) {
    return res.status(400).json({ error: "Missing postId" });
  }

  try {

    // Check if already liked
    const existing = await pool.query(
      `SELECT 1 FROM likes 
       WHERE post_id = $1 AND liker = $2`,
      [postId, userId]
    );

    if (existing.rows.length > 0) {

      // Unlike
      await pool.query(
        `DELETE FROM likes 
         WHERE post_id = $1 AND liker = $2`,
        [postId, userId]
      );

    } else {

      // Like
      await pool.query(
        `INSERT INTO likes (post_id, liker)
         VALUES ($1, $2)`,
        [postId, userId]
      );

      const ownerResult = await pool.query(
        `SELECT user_id FROM posts WHERE post_id = $1`,
        [postId]
      );

      await createNotification({
        recipientId: ownerResult.rows[0]?.user_id,
        actorId: userId,
        type: "post_like",
        postId,
      });
    }

    // Get updated count
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM likes WHERE post_id = $1`,
      [postId]
    );

    const likeCount = parseInt(countResult.rows[0].count);

    res.json({
      liked: existing.rows.length === 0,
      likeCount
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
