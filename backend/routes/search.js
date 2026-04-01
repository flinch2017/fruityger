import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";
import { backfillPostHashtags, ensureHashtagSchema } from "../utils/hashtags.js";
import { ensureRepostSchema } from "../utils/reposts.js";

const router = express.Router();

const ensureBlockedUsersTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocked_users (
      blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (blocker_id, blocked_id)
    )
  `);
};

const normalizeTag = (value = "") => String(value).trim().replace(/^#+/, "").toLowerCase();

router.get("/hashtags/:tag", authenticateToken, async (req, res) => {
  try {
    await ensureHashtagSchema();
    await backfillPostHashtags();
    await ensureBlockedUsersTable();
    await ensureRepostSchema();

    const tag = normalizeTag(req.params.tag);
    const userId = req.user.id;

    if (!tag) {
      return res.status(400).json({ error: "A hashtag is required" });
    }

    const summaryResult = await pool.query(
      `
      SELECT
        h.tag,
        h.post_count,
        EXISTS (
          SELECT 1
          FROM saved_hashtags sh
          WHERE sh.user_id = $2
            AND sh.tag = h.tag
        ) AS is_saved
      FROM hashtags h
      WHERE h.tag = $1
      LIMIT 1
      `,
      [tag, userId]
    );

    if (summaryResult.rows.length === 0 || summaryResult.rows[0].post_count === 0) {
      return res.status(404).json({ error: "Hashtag not found" });
    }

    const postsResult = await pool.query(
      `
      SELECT
        p.post_id,
        p.caption,
        p.date_posted,
        p.user_id,
        u.username,
        u.profile_pic,
        preview.media_url AS preview_media_url,
        preview.media_type AS preview_media_type,
        COUNT(DISTINCT l.like_id)::int AS like_count,
        (
          SELECT COUNT(*)
          FROM comments c
          WHERE c.post_id = p.post_id
        )::int AS comment_count
      FROM post_hashtags ph
      JOIN posts p
        ON p.post_id = ph.post_id
      JOIN users u
        ON u.id = p.user_id
      LEFT JOIN LATERAL (
        SELECT pm.media_url, pm.media_type
        FROM post_media pm
        WHERE pm.post_id = p.post_id
        ORDER BY pm.media_order ASC
        LIMIT 1
      ) preview ON TRUE
      LEFT JOIN likes l
        ON l.post_id = p.post_id
      WHERE ph.tag = $1
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
      GROUP BY
        p.post_id,
        p.caption,
        p.date_posted,
        p.user_id,
        u.username,
        u.profile_pic,
        preview.media_url,
        preview.media_type
      ORDER BY like_count DESC, comment_count DESC, p.date_posted DESC
      LIMIT 60
      `,
      [tag, userId]
    );

    res.json({
      hashtag: summaryResult.rows[0],
      posts: postsResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load hashtag" });
  }
});

router.post("/hashtags/:tag/save", authenticateToken, async (req, res) => {
  try {
    await ensureHashtagSchema();

    const tag = normalizeTag(req.params.tag);
    const userId = req.user.id;

    if (!tag) {
      return res.status(400).json({ error: "A hashtag is required" });
    }

    await pool.query(
      `
      INSERT INTO hashtags (tag)
      VALUES ($1)
      ON CONFLICT (tag) DO NOTHING
      `,
      [tag]
    );

    const existingSave = await pool.query(
      `
      SELECT 1
      FROM saved_hashtags
      WHERE user_id = $1
        AND tag = $2
      LIMIT 1
      `,
      [userId, tag]
    );

    if (existingSave.rows.length > 0) {
      await pool.query(
        `
        DELETE FROM saved_hashtags
        WHERE user_id = $1
          AND tag = $2
        `,
        [userId, tag]
      );

      return res.json({ saved: false });
    }

    await pool.query(
      `
      INSERT INTO saved_hashtags (user_id, tag)
      VALUES ($1, $2)
      ON CONFLICT (user_id, tag) DO NOTHING
      `,
      [userId, tag]
    );

    res.json({ saved: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save hashtag" });
  }
});

router.get("/", authenticateToken, async (req, res) => {
  try {
    await ensureHashtagSchema();
    await backfillPostHashtags();
    await ensureBlockedUsersTable();

    const keyword = req.query.q?.trim();
    const normalizedKeyword = normalizeTag(keyword);
    const userId = req.user.id;

    if (!normalizedKeyword) {
      return res.json({
        users: [],
        posts: [],
        hashtags: [],
      });
    }

    const likePattern = `%${normalizedKeyword}%`;

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
      ORDER BY
        CASE
          WHEN LOWER(u.username) = $3 THEN 0
          WHEN LOWER(u.username) LIKE $4 THEN 1
          ELSE 2
        END,
        u.username ASC
      LIMIT 20
      `,
      [likePattern, userId, normalizedKeyword, `${normalizedKeyword}%`]
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
            WHERE pm.post_id = p.post_id
          ),
          '[]'
        ) AS media,
        COUNT(DISTINCT l.like_id)::int AS like_count,
        COUNT(DISTINCT r.user_id)::int AS repost_count,
        EXISTS (
          SELECT 1
          FROM likes
          WHERE post_id = p.post_id
            AND liker = $2
        ) AS is_liked,
        EXISTS (
          SELECT 1
          FROM reposts
          WHERE post_id = p.post_id
            AND user_id = $2
        ) AS is_reposted,
        (
          SELECT COUNT(*)
          FROM comments c
          WHERE c.post_id = p.post_id
        )::int AS comment_count
      FROM posts p
      JOIN users u
        ON p.user_id = u.id
      LEFT JOIN likes l
        ON l.post_id = p.post_id
      LEFT JOIN reposts r
        ON r.post_id = p.post_id
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
      SELECT
        h.tag,
        h.post_count,
        EXISTS (
          SELECT 1
          FROM saved_hashtags sh
          WHERE sh.user_id = $2
            AND sh.tag = h.tag
        ) AS is_saved
      FROM hashtags h
      WHERE h.post_count > 0
        AND h.tag ILIKE $1
      ORDER BY
        CASE
          WHEN h.tag = $3 THEN 0
          WHEN h.tag LIKE $4 THEN 1
          ELSE 2
        END,
        h.post_count DESC,
        h.tag ASC
      LIMIT 20
      `,
      [likePattern, userId, normalizedKeyword, `${normalizedKeyword}%`]
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
