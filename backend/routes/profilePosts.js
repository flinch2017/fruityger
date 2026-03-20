import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

/* ============================================
   GET USER POSTS
============================================ */

router.get("/posts", authenticateToken, async (req, res) => {
  

  try {

    let userId = req.user.id;

    // ⭐ If frontend sends username, override profile owner
    const username = req.query.username;

    if (username) {

      const userResult = await pool.query(
        "SELECT id FROM users WHERE username=$1",
        [username]
      );

      if (!userResult.rows[0]) {
        return res.json({ posts: [] });
      }

      userId = userResult.rows[0].id;
    }
    const limit = parseInt(req.query.limit) || 5;
    const offset = parseInt(req.query.offset) || 0;

    const query = `
      SELECT 
        p.*,

        -- ✅ ORDERED MEDIA ARRAY (IMPORTANT)
        COALESCE(
          json_agg(
            json_build_object(
              'media_url', pm.media_url,
              'media_type', pm.media_type,
              'media_order', pm.media_order
            )
            ORDER BY pm.media_order ASC
          )
          FILTER (WHERE pm.media_url IS NOT NULL),
          '[]'
        ) AS media,

        -- ✅ LIKE COUNT
        COUNT(DISTINCT l.like_id)::int AS like_count,

        -- ✅ IS LIKED
        EXISTS (
          SELECT 1 FROM likes
          WHERE post_id = p.post_id
          AND liker = $1
        ) AS is_liked,

         -- ⭐ COMMENT COUNT (ADD THIS)
        (
            SELECT COUNT(*)
            FROM comments c
            WHERE c.post_id = p.post_id
        ) AS comment_count

      FROM posts p

      LEFT JOIN post_media pm
        ON pm.post_id = p.post_id

      LEFT JOIN likes l
        ON l.post_id = p.post_id

      WHERE p.user_id = $1

      GROUP BY p.post_id

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

router.delete("/:postId", authenticateToken, async (req, res) => {
  console.log("Authenticated user:", req.user);
  const { postId } = req.params;
  const userId = req.user.id;

  try {
    // ✅ Check if post exists + ownership
    const postCheck = await pool.query(
      "SELECT user_id FROM posts WHERE post_id = $1",
      [postId]
    );

    if (postCheck.rows.length === 0) {
      return res.status(404).json({ message: "Post not found" });
    }

    if (postCheck.rows[0].user_id !== userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // 🔥 IMPORTANT: delete dependencies first (if no CASCADE yet)

    await pool.query("DELETE FROM comments WHERE post_id = $1", [postId]);
    await pool.query("DELETE FROM likes WHERE post_id = $1", [postId]);
    await pool.query("DELETE FROM post_media WHERE post_id = $1", [postId]);

    // ✅ Delete the post
    await pool.query("DELETE FROM posts WHERE post_id = $1", [postId]);

    res.json({ message: "Post deleted successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});


export default router;