import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";
import { backfillPostHashtags, ensureHashtagSchema } from "../utils/hashtags.js";
import { ensureRepostSchema } from "../utils/reposts.js";
import { ensurePrivateAccountSchema } from "../utils/privacy.js";
import { ensureVerificationBadgeSchema } from "../utils/verificationBadge.js";

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
    await ensureVerificationBadgeSchema();
    await ensureRepostSchema();
    await ensurePrivateAccountSchema();
    await ensureVerificationBadgeSchema();
    await ensureRepostSchema();
    await ensurePrivateAccountSchema();

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
        u.is_verified,
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
       AND u.deactivated_at IS NULL
       AND u.deleted_at IS NULL
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
        AND (
          p.user_id = $2
          OR COALESCE(u.is_private, false) = false
          OR EXISTS (
            SELECT 1
            FROM follows viewer_follow
            WHERE viewer_follow.follower_id = $2
              AND viewer_follow.following_id = p.user_id
          )
        )
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
        u.is_verified,
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
      SELECT id, username, profile_pic, is_verified
      FROM users u
      WHERE u.username ILIKE $1
        AND u.id <> $2
        AND u.deactivated_at IS NULL
        AND u.deleted_at IS NULL
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
        u.is_verified,
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
        (
          SELECT COUNT(*)::int
          FROM likes
          WHERE post_id = p.post_id
        ) AS like_count,
        (
          SELECT COUNT(*)::int
          FROM reposts
          WHERE post_id = p.post_id
        ) AS repost_count,
        relevant_reposts.reposters,
        relevant_reposts.reposter_count,
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
       AND u.deactivated_at IS NULL
       AND u.deleted_at IS NULL
      LEFT JOIN LATERAL (
        WITH eligible_reposts AS (
          SELECT
            r.user_id,
            ru.username,
            ru.profile_pic,
            ru.is_verified,
            r.created_at AS reposted_at
          FROM reposts r
          JOIN users ru
            ON ru.id = r.user_id
           AND ru.deactivated_at IS NULL
           AND ru.deleted_at IS NULL
          WHERE r.post_id = p.post_id
            AND (
              r.user_id = $2
              OR r.user_id IN (
                SELECT following_id
                FROM follows
                WHERE follower_id = $2
              )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM blocked_users bu_rep
              WHERE (
                bu_rep.blocker_id = $2
                AND bu_rep.blocked_id = ru.id
              ) OR (
                bu_rep.blocker_id = ru.id
                AND bu_rep.blocked_id = $2
              )
            )
        )
        SELECT
          COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'user_id', user_id,
                  'username', username,
                  'profile_pic', profile_pic,
                  'is_verified', is_verified,
                  'reposted_at', reposted_at
                )
                ORDER BY reposted_at DESC
              )
              FROM eligible_reposts
            ),
            '[]'::jsonb
          ) AS reposters,
          (
            SELECT COUNT(*)::int
            FROM eligible_reposts
          ) AS reposter_count
      ) relevant_reposts ON TRUE
      WHERE p.caption ILIKE $1
        AND (
          p.user_id = $2
          OR COALESCE(u.is_private, false) = false
          OR EXISTS (
            SELECT 1
            FROM follows viewer_follow
            WHERE viewer_follow.follower_id = $2
              AND viewer_follow.following_id = p.user_id
          )
        )
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
