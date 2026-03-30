
import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";
import { deleteR2Object } from "../utils/r2Delete.js";

const router = express.Router();

let blockedUsersTableReadyPromise = null;

async function ensureBlockedUsersTable() {
  if (!blockedUsersTableReadyPromise) {
    blockedUsersTableReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS blocked_users (
          blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (blocker_id, blocked_id)
        )
      `);
    })().catch((error) => {
      blockedUsersTableReadyPromise = null;
      throw error;
    });
  }

  await blockedUsersTableReadyPromise;
}



router.get("/user/:username", authenticateToken, async (req, res) => {
  try {
    await ensureBlockedUsersTable();
    const { username } = req.params;

    const { rows } = await pool.query(
      `SELECT id, username, email, profile_pic, created_at
       FROM users
       WHERE username = $1`,
      [username]
    );

    if (!rows[0]) return res.status(404).json({ error: "User not found" });

    const user = rows[0];

    const blockRes = await pool.query(
      `
      SELECT
        EXISTS (
          SELECT 1
          FROM blocked_users
          WHERE blocker_id = $1
            AND blocked_id = $2
        ) AS blocked_by_me,
        EXISTS (
          SELECT 1
          FROM blocked_users
          WHERE blocker_id = $2
            AND blocked_id = $1
        ) AS blocked_by_them
      `,
      [req.user.id, user.id]
    );

    const countRes = await pool.query(
      `SELECT
          (SELECT COUNT(*) FROM follows WHERE following_id=$1) AS followers_count,
          (SELECT COUNT(*) FROM follows WHERE follower_id=$1) AS following_count`,
      [user.id]
    );

    user.followers_count = parseInt(countRes.rows[0].followers_count, 10);
    user.following_count = parseInt(countRes.rows[0].following_count, 10);
    user.blocked_by_me = blockRes.rows[0]?.blocked_by_me || false;
    user.blocked_by_them = blockRes.rows[0]?.blocked_by_them || false;

    res.json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/me", authenticateToken, async (req, res) => {
  try {
    await ensureBlockedUsersTable();
    const { rows } = await pool.query(
      `SELECT id, username, email, profile_pic, created_at
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );

    if (!rows[0]) return res.status(404).json({ error: "User not found" });

    const user = rows[0];

    const countRes = await pool.query(
      `SELECT
          (SELECT COUNT(*) FROM follows WHERE following_id=$1) AS followers_count,
          (SELECT COUNT(*) FROM follows WHERE follower_id=$1) AS following_count`,
      [user.id]
    );

    user.followers_count = parseInt(countRes.rows[0].followers_count, 10);
    user.following_count = parseInt(countRes.rows[0].following_count, 10);
    user.blocked_by_me = false;
    user.blocked_by_them = false;

    res.json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/post/:postId", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { postId } = req.params;

    const { rows } = await pool.query(
      `
      SELECT
        p.*,
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
          )
          FILTER (WHERE pm.media_url IS NOT NULL),
          '[]'
        ) AS media,
        COUNT(DISTINCT l.like_id)::int AS like_count,
        EXISTS (
          SELECT 1
          FROM likes
          WHERE post_id = p.post_id
            AND liker = $1
        ) AS is_liked,
        (
          SELECT COUNT(*)
          FROM comments c
          WHERE c.post_id = p.post_id
        )::int AS comment_count
      FROM posts p
      JOIN users u
        ON u.id = p.user_id
      LEFT JOIN post_media pm
        ON pm.post_id = p.post_id
      LEFT JOIN likes l
        ON l.post_id = p.post_id
      WHERE p.post_id = $2
      GROUP BY p.post_id, u.id, u.username, u.profile_pic
      `,
      [userId, postId]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: "Post not found" });
    }

    res.json({ post: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/feed", authenticateToken, async (req, res) => {
  try {
    await ensureBlockedUsersTable();
    const userId = req.user.id;
    const limit = parseInt(req.query.limit, 10) || 5;
    const offset = parseInt(req.query.offset, 10) || 0;

    const { rows } = await pool.query(
      `
      SELECT
        p.*,
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
          )
          FILTER (WHERE pm.media_url IS NOT NULL),
          '[]'
        ) AS media,

        COUNT(DISTINCT l.like_id)::int AS like_count,

        EXISTS (
          SELECT 1
          FROM likes
          WHERE post_id = p.post_id
            AND liker = $1
        ) AS is_liked,

        (
          SELECT COUNT(*)
          FROM comments c
          WHERE c.post_id = p.post_id
        )::int AS comment_count

      FROM posts p
      JOIN users u
        ON u.id = p.user_id
      LEFT JOIN post_media pm
        ON pm.post_id = p.post_id
      LEFT JOIN likes l
        ON l.post_id = p.post_id
      WHERE p.user_id = $1
         OR p.user_id IN (
           SELECT following_id
           FROM follows
           WHERE follower_id = $1
         )
        AND NOT EXISTS (
          SELECT 1
          FROM blocked_users bu
          WHERE (
            bu.blocker_id = $1
            AND bu.blocked_id = p.user_id
          ) OR (
            bu.blocker_id = p.user_id
            AND bu.blocked_id = $1
          )
        )
      GROUP BY p.post_id, u.id, u.username, u.profile_pic
      ORDER BY p.date_posted DESC
      LIMIT $2 OFFSET $3
      `,
      [userId, limit, offset]
    );

    res.json({ posts: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/block-user", authenticateToken, async (req, res) => {
  const blockerId = req.user.id;
  const { blockedUserId } = req.body || {};

  if (!blockedUserId) {
    return res.status(400).json({ error: "blockedUserId is required" });
  }

  if (blockedUserId === blockerId) {
    return res.status(400).json({ error: "You cannot block yourself" });
  }

  try {
    await ensureBlockedUsersTable();

    await pool.query(
      `
      INSERT INTO blocked_users (blocker_id, blocked_id)
      VALUES ($1, $2)
      ON CONFLICT (blocker_id, blocked_id) DO NOTHING
      `,
      [blockerId, blockedUserId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to block user" });
  }
});

router.post("/unblock-user", authenticateToken, async (req, res) => {
  const blockerId = req.user.id;
  const { blockedUserId } = req.body || {};

  if (!blockedUserId) {
    return res.status(400).json({ error: "blockedUserId is required" });
  }

  try {
    await ensureBlockedUsersTable();

    await pool.query(
      `
      DELETE FROM blocked_users
      WHERE blocker_id = $1
        AND blocked_id = $2
      `,
      [blockerId, blockedUserId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to unblock user" });
  }
});



router.put("/edit-profile", authenticateToken, async (req, res) => {
  const { username, profile_pic, profile_pic_key } = req.body;

  try {

    // ⭐ Get old profile picture key
    const userResult = await pool.query(
      "SELECT profile_pic_key FROM users WHERE id=$1",
      [req.user.id]
    );

    const oldKey = userResult.rows[0]?.profile_pic_key;

    // ⭐ Delete old R2 image
    await deleteR2Object(process.env.R2_BUCKET, oldKey);

    // ⭐ Update profile
    const query = `
      UPDATE users 
      SET username=$1,
          profile_pic=$2,
          profile_pic_key=$3
      WHERE id=$4
      RETURNING id, username, email, profile_pic, created_at
    `;

    const params = [
      username,
      profile_pic,
      profile_pic_key,
      req.user.id
    ];

    const { rows } = await pool.query(query, params);

    res.json({
      user: rows[0],
      message: "Profile updated successfully"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
