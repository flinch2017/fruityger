import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";
import { ensureHashtagSchema, removePostHashtags, syncPostHashtags } from "../utils/hashtags.js";
import { ensureRepostSchema } from "../utils/reposts.js";

const router = express.Router();

router.get("/posts", authenticateToken, async (req, res) => {
  try {
    await ensureRepostSchema();

    const viewerId = req.user.id;
    let userId = viewerId;
    const username = req.query.username;

    if (username) {
      const userResult = await pool.query(
        "SELECT id FROM users WHERE username = $1 LIMIT 1",
        [username]
      );

      if (!userResult.rows[0]) {
        return res.json({ posts: [] });
      }

      userId = userResult.rows[0].id;
    }

    if (userId !== viewerId) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS blocked_users (
          blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (blocker_id, blocked_id)
        )
      `);

      const blockResult = await pool.query(
        `
        SELECT 1
        FROM blocked_users
        WHERE (blocker_id = $1 AND blocked_id = $2)
           OR (blocker_id = $2 AND blocked_id = $1)
        LIMIT 1
        `,
        [viewerId, userId]
      );

      if (blockResult.rows.length > 0) {
        return res.json({ posts: [], isBlocked: true });
      }
    }

    const limit = parseInt(req.query.limit, 10) || 5;
    const offset = parseInt(req.query.offset, 10) || 0;

    const { rows } = await pool.query(
      `
      WITH profile_activity AS (
        SELECT
          p.post_id,
          p.user_id,
          p.caption,
          p.date_posted,
          'post'::text AS activity_type,
          NULL::timestamptz AS reposted_at
        FROM posts p
        WHERE p.user_id = $2

        UNION ALL

        SELECT
          p.post_id,
          p.user_id,
          p.caption,
          p.date_posted,
          'repost'::text AS activity_type,
          rp.created_at AS reposted_at
        FROM reposts rp
        JOIN posts p
          ON p.post_id = rp.post_id
        WHERE rp.user_id = $2
      )
      SELECT
        activity.post_id,
        activity.user_id,
        activity.caption,
        activity.date_posted,
        activity.activity_type,
        activity.reposted_at,
        author.username,
        author.profile_pic,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'media_url', pm.media_url,
                'media_type', pm.media_type,
                'media_order', pm.media_order
              )
              ORDER BY pm.media_order ASC
            )
            FROM post_media pm
            WHERE pm.post_id = activity.post_id
          ),
          '[]'
        ) AS media,
        COUNT(DISTINCT l.like_id)::int AS like_count,
        COUNT(DISTINCT r.user_id)::int AS repost_count,
        EXISTS (
          SELECT 1
          FROM likes
          WHERE post_id = activity.post_id
            AND liker = $1
        ) AS is_liked,
        EXISTS (
          SELECT 1
          FROM reposts
          WHERE post_id = activity.post_id
            AND user_id = $1
        ) AS is_reposted,
        (
          SELECT COUNT(*)
          FROM comments c
          WHERE c.post_id = activity.post_id
        )::int AS comment_count
      FROM profile_activity activity
      JOIN users author
        ON author.id = activity.user_id
      LEFT JOIN likes l
        ON l.post_id = activity.post_id
      LEFT JOIN reposts r
        ON r.post_id = activity.post_id
      GROUP BY
        activity.post_id,
        activity.user_id,
        activity.caption,
        activity.date_posted,
        activity.activity_type,
        activity.reposted_at,
        author.username,
        author.profile_pic
      ORDER BY COALESCE(activity.reposted_at, activity.date_posted) DESC
      LIMIT $3 OFFSET $4
      `,
      [viewerId, userId, limit, offset]
    );

    res.json({ posts: rows, isBlocked: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/public-posts", async (req, res) => {
  try {
    await ensureRepostSchema();
    const username = req.query.username;

    if (!username) {
      return res.status(400).json({ error: "username is required" });
    }

    const userResult = await pool.query(
      "SELECT id FROM users WHERE username = $1 LIMIT 1",
      [username]
    );

    if (!userResult.rows[0]) {
      return res.json({ posts: [], isBlocked: false });
    }

    const userId = userResult.rows[0].id;
    const limit = parseInt(req.query.limit, 10) || 5;
    const offset = parseInt(req.query.offset, 10) || 0;

    const { rows } = await pool.query(
      `
      WITH profile_activity AS (
        SELECT
          p.post_id,
          p.user_id,
          p.caption,
          p.date_posted,
          'post'::text AS activity_type,
          NULL::timestamptz AS reposted_at
        FROM posts p
        WHERE p.user_id = $1

        UNION ALL

        SELECT
          p.post_id,
          p.user_id,
          p.caption,
          p.date_posted,
          'repost'::text AS activity_type,
          rp.created_at AS reposted_at
        FROM reposts rp
        JOIN posts p
          ON p.post_id = rp.post_id
        WHERE rp.user_id = $1
      )
      SELECT
        activity.post_id,
        activity.user_id,
        activity.caption,
        activity.date_posted,
        activity.activity_type,
        activity.reposted_at,
        author.username,
        author.profile_pic,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'media_url', pm.media_url,
                'media_type', pm.media_type,
                'media_order', pm.media_order
              )
              ORDER BY pm.media_order ASC
            )
            FROM post_media pm
            WHERE pm.post_id = activity.post_id
          ),
          '[]'
        ) AS media,
        COUNT(DISTINCT l.like_id)::int AS like_count,
        COUNT(DISTINCT r.user_id)::int AS repost_count,
        FALSE AS is_liked,
        FALSE AS is_reposted,
        (
          SELECT COUNT(*)
          FROM comments c
          WHERE c.post_id = activity.post_id
        )::int AS comment_count
      FROM profile_activity activity
      JOIN users author
        ON author.id = activity.user_id
      LEFT JOIN likes l
        ON l.post_id = activity.post_id
      LEFT JOIN reposts r
        ON r.post_id = activity.post_id
      GROUP BY
        activity.post_id,
        activity.user_id,
        activity.caption,
        activity.date_posted,
        activity.activity_type,
        activity.reposted_at,
        author.username,
        author.profile_pic
      ORDER BY COALESCE(activity.reposted_at, activity.date_posted) DESC
      LIMIT $2 OFFSET $3
      `,
      [userId, limit, offset]
    );

    res.json({ posts: rows, isBlocked: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/post/:postId", authenticateToken, async (req, res) => {
  const { postId } = req.params;

  try {
    const { rows } = await pool.query(
      `
      SELECT
        p.post_id,
        p.user_id,
        p.caption,
        p.date_posted
      FROM posts p
      WHERE p.post_id = $1
      `,
      [postId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }

    return res.json({ post: rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/:postId", authenticateToken, async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;
  const { caption } = req.body;

  try {
    await ensureHashtagSchema();
    const postCheck = await pool.query(
      "SELECT user_id FROM posts WHERE post_id = $1",
      [postId]
    );

    if (postCheck.rows.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }

    if (postCheck.rows[0].user_id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const { rows } = await pool.query(
      `
      UPDATE posts
      SET caption = $1
      WHERE post_id = $2
      RETURNING post_id, user_id, caption, date_posted
      `,
      [caption ?? "", postId]
    );

    await syncPostHashtags(postId, caption ?? "");

    return res.json({ post: rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:postId", authenticateToken, async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;

  try {
    await ensureHashtagSchema();
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

    await pool.query("DELETE FROM comments WHERE post_id = $1", [postId]);
    await pool.query("DELETE FROM likes WHERE post_id = $1", [postId]);
    await pool.query("DELETE FROM reposts WHERE post_id = $1", [postId]);
    await removePostHashtags(postId);
    await pool.query("DELETE FROM post_media WHERE post_id = $1", [postId]);
    await pool.query("DELETE FROM posts WHERE post_id = $1", [postId]);

    res.json({ message: "Post deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
