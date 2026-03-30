import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

router.get("/", authenticateToken, async (req, res) => {
  try {
    const keyword = req.query.q?.trim();
    const userId = req.user.id;

    if (!keyword) {
      return res.json({
        users: [],
        posts: [],
        hashtags: [],
      });
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS blocked_users (
        blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (blocker_id, blocked_id)
      )
    `);

    const likePattern = `%${keyword}%`;

    const users = await pool.query(
      `
      SELECT id, username, profile_pic
      FROM users u
      WHERE u.username ILIKE $1
        AND u.id <> $2
        AND NOT EXISTS (
          SELECT 1
          FROM blocked_users bu
          WHERE (
            bu.blocker_id = $2
            AND bu.blocked_id = u.id
          ) OR (
            bu.blocker_id = u.id
            AND bu.blocked_id = $2
          )
        )
      LIMIT 20
      `,
      [likePattern, userId]
    );

    const posts = await pool.query(
      `
      SELECT
        p.post_id,
        p.caption,
        p.user_id,
        p.date_posted,
        u.username,
        u.profile_pic,
        COALESCE(
          json_agg(
            json_build_object(
              'media_url', pm.media_url,
              'media_type', pm.media_type,
              'media_order', pm.media_order
            )
            ORDER BY pm.media_order ASC
          ) FILTER (WHERE pm.media_url IS NOT NULL),
          '[]'
        ) AS media,
        COUNT(DISTINCT l.like_id)::int AS like_count,
        EXISTS (
          SELECT 1
          FROM likes
          WHERE post_id = p.post_id
            AND liker = $2
        ) AS is_liked,
        (
          SELECT COUNT(*)
          FROM comments c
          WHERE c.post_id = p.post_id
        )::int AS comment_count
      FROM posts p
      JOIN users u
        ON p.user_id = u.id
      LEFT JOIN post_media pm
        ON pm.post_id = p.post_id
      LEFT JOIN likes l
        ON l.post_id = p.post_id
      WHERE p.caption ILIKE $1
        AND NOT EXISTS (
          SELECT 1
          FROM blocked_users bu
          WHERE (
            bu.blocker_id = $2
            AND bu.blocked_id = u.id
          ) OR (
            bu.blocker_id = u.id
            AND bu.blocked_id = $2
          )
        )
      GROUP BY p.post_id, u.id, u.username, u.profile_pic
      ORDER BY p.date_posted DESC
      LIMIT 20
      `,
      [likePattern, userId]
    );

    const hashtags = await pool.query(
      `
      SELECT tag
      FROM hashtags
      WHERE tag ILIKE $1
      LIMIT 20
      `,
      [likePattern]
    );

    res.json({
      users: users.rows,
      posts: posts.rows,
      hashtags: hashtags.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Search failed" });
  }
});

export default router;
