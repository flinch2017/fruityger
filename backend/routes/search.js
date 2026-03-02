import express from "express";
import pool from "../db.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const keyword = req.query.q?.trim();

    if (!keyword) {
      return res.json({
        users: [],
        posts: [],
        hashtags: []
      });
    }

    const likePattern = `%${keyword}%`;

    const users = await pool.query(`
      SELECT id, username, profile_pic
      FROM users
      WHERE username ILIKE $1
      LIMIT 20
    `, [likePattern]);

    const posts = await pool.query(`
      SELECT 
        p.post_id,
        p.caption,
        p.media_json,
        u.username,
        u.profile_pic
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.caption ILIKE $1
      ORDER BY p.date_posted DESC
      LIMIT 20
    `, [likePattern]);

    const hashtags = await pool.query(`
      SELECT tag
      FROM hashtags
      WHERE tag ILIKE $1
      LIMIT 20
    `, [likePattern]);

    res.json({
      users: users.rows,
      posts: posts.rows,
      hashtags: hashtags.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Search failed" });
  }
});

export default router;