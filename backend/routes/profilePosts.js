import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

/* ============================================
   GET USER POSTS
============================================ */

router.get("/posts", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 5;
    const offset = parseInt(req.query.offset) || 0;

    const query = `
      SELECT 
        p.post_id,
        p.caption,
        p.date_posted,
        COALESCE(
          json_agg(
            json_build_object(
              'media_url', pm.media_url,
              'media_type', pm.media_type,
              'media_order', pm.media_order
            )
            ORDER BY pm.media_order
          ) FILTER (WHERE pm.media_id IS NOT NULL),
          '[]'
        ) AS media
      FROM posts p
      LEFT JOIN post_media pm 
        ON p.post_id = pm.post_id
      WHERE p.user_id = $1
      GROUP BY p.post_id, p.caption, p.date_posted
      ORDER BY p.date_posted DESC
      LIMIT $2 OFFSET $3
    `;

    const { rows } = await pool.query(query, [
      userId,
      limit,
      offset
    ]);

    res.json({ posts: rows });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;