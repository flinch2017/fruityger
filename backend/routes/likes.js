import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";
import { createNotification } from "../utils/notifications.js";
import { canViewUserActivity, ensurePrivateAccountSchema } from "../utils/privacy.js";

const router = express.Router();

async function getPostLikePreview(postId, viewerId) {
  const { rows } = await pool.query(
    `
    WITH ranked_likes AS (
      SELECT
        u.id AS user_id,
        u.username,
        u.profile_pic,
        u.is_verified,
        ROW_NUMBER() OVER (
          ORDER BY
            CASE
              WHEN EXISTS (
                SELECT 1
                FROM follows f
                WHERE f.follower_id = $2
                  AND f.following_id = u.id
              ) THEN 0
              WHEN u.id = $2 THEN 1
              WHEN EXISTS (
                SELECT 1
                FROM follows f
                WHERE f.follower_id = u.id
                  AND f.following_id = $2
              ) THEN 2
              ELSE 3
            END,
            CASE
              WHEN EXISTS (
                SELECT 1
                FROM follows f
                WHERE f.follower_id = $2
                  AND f.following_id = u.id
              ) THEN (
                (
                  SELECT COUNT(*)::int
                  FROM likes viewer_likes
                  JOIN posts liked_posts
                    ON liked_posts.post_id = viewer_likes.post_id
                  WHERE viewer_likes.liker = $2
                    AND liked_posts.user_id = u.id
                ) * 3
                + (
                  SELECT COUNT(*)::int
                  FROM comments viewer_comments
                  JOIN posts commented_posts
                    ON commented_posts.post_id = viewer_comments.post_id
                  WHERE viewer_comments.user_id = $2
                    AND commented_posts.user_id = u.id
                ) * 4
                + (
                  SELECT COUNT(*)::int
                  FROM reposts viewer_reposts
                  JOIN posts reposted_posts
                    ON reposted_posts.post_id = viewer_reposts.post_id
                  WHERE viewer_reposts.user_id = $2
                    AND reposted_posts.user_id = u.id
                ) * 5
                + (
                  SELECT COUNT(*)::int
                  FROM likes their_likes
                  JOIN posts my_liked_posts
                    ON my_liked_posts.post_id = their_likes.post_id
                  WHERE their_likes.liker = u.id
                    AND my_liked_posts.user_id = $2
                ) * 2
                + (
                  SELECT COUNT(*)::int
                  FROM comments their_comments
                  JOIN posts my_commented_posts
                    ON my_commented_posts.post_id = their_comments.post_id
                  WHERE their_comments.user_id = u.id
                    AND my_commented_posts.user_id = $2
                ) * 3
                + (
                  SELECT COUNT(*)::int
                  FROM reposts their_reposts
                  JOIN posts my_reposted_posts
                    ON my_reposted_posts.post_id = their_reposts.post_id
                  WHERE their_reposts.user_id = u.id
                    AND my_reposted_posts.user_id = $2
                ) * 4
              )
              ELSE 0
            END DESC,
            l.like_id DESC
        ) AS rank,
        COUNT(*) OVER ()::int AS total_count
      FROM likes l
      JOIN users u
        ON u.id = l.liker
       AND u.deactivated_at IS NULL
       AND u.deleted_at IS NULL
      WHERE l.post_id = $1
    )
    SELECT
      user_id,
      username,
      profile_pic,
      is_verified,
      GREATEST(total_count - 1, 0)::int AS other_count
    FROM ranked_likes
    WHERE rank = 1
    LIMIT 1
    `,
    [postId, viewerId]
  );

  return rows[0] || null;
}

/* ===============================
   VIEW LIKES
================================ */
router.get("/:postId", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { postId } = req.params;

  try {
    await ensurePrivateAccountSchema();

    const postResult = await pool.query(
      `SELECT user_id FROM posts WHERE post_id = $1 LIMIT 1`,
      [postId]
    );

    const postOwnerId = postResult.rows[0]?.user_id;
    if (!postOwnerId) {
      return res.status(404).json({ error: "Post not found" });
    }

    if (!(await canViewUserActivity(userId, postOwnerId))) {
      return res.status(403).json({ error: "This post is private" });
    }

    const { rows } = await pool.query(
      `
      SELECT
        u.id AS user_id,
        u.username,
        u.profile_pic,
        u.is_verified,
        EXISTS (
          SELECT 1
          FROM follows f
          WHERE f.follower_id = $1
            AND f.following_id = u.id
        ) AS is_following,
        EXISTS (
          SELECT 1
          FROM follows f
          WHERE f.follower_id = u.id
            AND f.following_id = $1
        ) AS follows_you
      FROM likes l
      JOIN users u
        ON u.id = l.liker
       AND u.deactivated_at IS NULL
       AND u.deleted_at IS NULL
      WHERE l.post_id = $2
      ORDER BY
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM follows f
            WHERE f.follower_id = $1
              AND f.following_id = u.id
          ) THEN 0
          WHEN u.id = $1 THEN 1
          WHEN EXISTS (
            SELECT 1
            FROM follows f
            WHERE f.follower_id = u.id
              AND f.following_id = $1
          ) THEN 2
          ELSE 3
        END,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM follows f
            WHERE f.follower_id = $1
              AND f.following_id = u.id
          ) THEN (
            (
              SELECT COUNT(*)::int
              FROM likes viewer_likes
              JOIN posts liked_posts
                ON liked_posts.post_id = viewer_likes.post_id
              WHERE viewer_likes.liker = $1
                AND liked_posts.user_id = u.id
            ) * 3
            + (
              SELECT COUNT(*)::int
              FROM comments viewer_comments
              JOIN posts commented_posts
                ON commented_posts.post_id = viewer_comments.post_id
              WHERE viewer_comments.user_id = $1
                AND commented_posts.user_id = u.id
            ) * 4
            + (
              SELECT COUNT(*)::int
              FROM reposts viewer_reposts
              JOIN posts reposted_posts
                ON reposted_posts.post_id = viewer_reposts.post_id
              WHERE viewer_reposts.user_id = $1
                AND reposted_posts.user_id = u.id
            ) * 5
            + (
              SELECT COUNT(*)::int
              FROM likes their_likes
              JOIN posts my_liked_posts
                ON my_liked_posts.post_id = their_likes.post_id
              WHERE their_likes.liker = u.id
                AND my_liked_posts.user_id = $1
            ) * 2
            + (
              SELECT COUNT(*)::int
              FROM comments their_comments
              JOIN posts my_commented_posts
                ON my_commented_posts.post_id = their_comments.post_id
              WHERE their_comments.user_id = u.id
                AND my_commented_posts.user_id = $1
            ) * 3
            + (
              SELECT COUNT(*)::int
              FROM reposts their_reposts
              JOIN posts my_reposted_posts
                ON my_reposted_posts.post_id = their_reposts.post_id
              WHERE their_reposts.user_id = u.id
                AND my_reposted_posts.user_id = $1
            ) * 4
          )
          ELSE 0
        END DESC,
        l.like_id DESC
      LIMIT 100
      `,
      [userId, postId]
    );

    res.json({ likes: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

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
    await ensurePrivateAccountSchema();

    const postResult = await pool.query(
      `SELECT user_id FROM posts WHERE post_id = $1 LIMIT 1`,
      [postId]
    );

    const postOwnerId = postResult.rows[0]?.user_id;
    if (!postOwnerId) {
      return res.status(404).json({ error: "Post not found" });
    }

    if (!(await canViewUserActivity(userId, postOwnerId))) {
      return res.status(403).json({ error: "This post is private" });
    }

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

      await createNotification({
        recipientId: postOwnerId,
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
    const likedByPreview = await getPostLikePreview(postId, userId);

    res.json({
      liked: existing.rows.length === 0,
      likeCount,
      likedByPreview,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
