
import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";
import { deleteR2Object } from "../utils/r2Delete.js";
import { ensureUserOnboardingSchema, normalizeInterests } from "../utils/userOnboarding.js";
import { ensureRepostSchema } from "../utils/reposts.js";

const router = express.Router();

let blockedUsersTableReadyPromise = null;
let userProfileSchemaReadyPromise = null;
let notificationPreferencesSchemaReadyPromise = null;
let accountStatusSchemaReadyPromise = null;

const normalizeUsername = (value = "") =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-+/g, "")
    .replace(/[^a-z0-9._]/g, "")
    .replace(/_+/g, "_")
    .replace(/\.+/g, ".")
    .replace(/^[^a-z]+/, "")
    .replace(/\.$/g, "");

const getUsernameValidationMessage = (username) => {
  if (!username) {
    return "Username is required";
  }

  if (username.length < 3) {
    return "Username must be at least 3 characters long";
  }

  if (username.length > 30) {
    return "Username must be 30 characters or fewer";
  }

  if (!/^[a-z]/.test(username)) {
    return "Username must start with a letter";
  }

  if (username.endsWith(".")) {
    return "Username cannot end with a period";
  }

  if (!/^[a-z0-9._]+$/.test(username)) {
    return "Username can only use lowercase letters, numbers, periods, and underscores";
  }

  return "";
};

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

async function ensureUserProfileSchema() {
  if (!userProfileSchemaReadyPromise) {
    userProfileSchemaReadyPromise = (async () => {
      await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS bio TEXT
      `);
    })().catch((error) => {
      userProfileSchemaReadyPromise = null;
      throw error;
    });
  }

  await userProfileSchemaReadyPromise;
}

async function ensureNotificationPreferencesSchema() {
  if (!notificationPreferencesSchemaReadyPromise) {
    notificationPreferencesSchemaReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
          user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          email TEXT NOT NULL UNIQUE,
          subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS push_notification_subscriptions (
          user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    })().catch((error) => {
      notificationPreferencesSchemaReadyPromise = null;
      throw error;
    });
  }

  await notificationPreferencesSchemaReadyPromise;
}

async function ensureAccountStatusSchema() {
  if (!accountStatusSchemaReadyPromise) {
    accountStatusSchemaReadyPromise = (async () => {
      await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ
      `);
    })().catch((error) => {
      accountStatusSchemaReadyPromise = null;
      throw error;
    });
  }

  await accountStatusSchemaReadyPromise;
}



router.get("/user/:username", authenticateToken, async (req, res) => {
  try {
    await ensureBlockedUsersTable();
    await ensureUserOnboardingSchema();
    await ensureUserProfileSchema();
    await ensureAccountStatusSchema();
    const { username } = req.params;

    const { rows } = await pool.query(
      `SELECT id, username, email, profile_pic, bio, interests, interests_completed, created_at
       FROM users
       WHERE username = $1
         AND deactivated_at IS NULL`,
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
    await ensureUserOnboardingSchema();
    await ensureUserProfileSchema();
    await ensureAccountStatusSchema();
    const { rows } = await pool.query(
      `SELECT id, username, email, profile_pic, profile_pic_key, bio, interests, interests_completed, created_at
       FROM users
       WHERE id = $1
         AND deactivated_at IS NULL`,
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

router.get("/public/user/:username", async (req, res) => {
  try {
    await ensureUserProfileSchema();
    await ensureAccountStatusSchema();
    const { username } = req.params;

    const { rows } = await pool.query(
      `
      SELECT id, username, profile_pic, bio, created_at
      FROM users
      WHERE username = $1
        AND deactivated_at IS NULL
      LIMIT 1
      `,
      [username]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = rows[0];
    const countRes = await pool.query(
      `
      SELECT
        (SELECT COUNT(*) FROM follows WHERE following_id = $1) AS followers_count,
        (SELECT COUNT(*) FROM follows WHERE follower_id = $1) AS following_count
      `,
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

router.put("/onboarding/interests", authenticateToken, async (req, res) => {
  const interests = normalizeInterests(req.body?.interests);

  if (interests.length === 0) {
    return res.status(400).json({ error: "Choose at least one interest" });
  }

  try {
    await ensureUserOnboardingSchema();

    const { rows } = await pool.query(
      `
      UPDATE users
      SET interests = $1::jsonb,
          interests_completed = TRUE
      WHERE id = $2
      RETURNING id, username, email, profile_pic, interests, interests_completed, created_at
      `,
      [JSON.stringify(interests), req.user.id]
    );

    res.json({
      user: rows[0],
      message: "Interests saved successfully",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/settings/notifications", authenticateToken, async (req, res) => {
  try {
    await ensureNotificationPreferencesSchema();

    const [newsletterResult, pushResult] = await Promise.all([
      pool.query(
        `
        SELECT email
        FROM newsletter_subscriptions
        WHERE user_id = $1
        LIMIT 1
        `,
        [req.user.id]
      ),
      pool.query(
        `
        SELECT user_id
        FROM push_notification_subscriptions
        WHERE user_id = $1
        LIMIT 1
        `,
        [req.user.id]
      ),
    ]);

    res.json({
      newsletterEnabled: newsletterResult.rows.length > 0,
      pushEnabled: pushResult.rows.length > 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load notification settings" });
  }
});

router.put("/settings/notifications", authenticateToken, async (req, res) => {
  const newsletterEnabled = Boolean(req.body?.newsletterEnabled);
  const pushEnabled = Boolean(req.body?.pushEnabled);

  try {
    await ensureNotificationPreferencesSchema();

    const userResult = await pool.query(
      `
      SELECT email
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [req.user.id]
    );

    const user = userResult.rows[0];
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (newsletterEnabled) {
      await pool.query(
        `
        INSERT INTO newsletter_subscriptions (user_id, email)
        VALUES ($1, $2)
        ON CONFLICT (user_id)
        DO UPDATE SET email = EXCLUDED.email, subscribed_at = NOW()
        `,
        [req.user.id, user.email]
      );
    } else {
      await pool.query(
        `
        DELETE FROM newsletter_subscriptions
        WHERE user_id = $1
        `,
        [req.user.id]
      );
    }

    if (pushEnabled) {
      await pool.query(
        `
        INSERT INTO push_notification_subscriptions (user_id)
        VALUES ($1)
        ON CONFLICT (user_id)
        DO UPDATE SET subscribed_at = NOW()
        `,
        [req.user.id]
      );
    } else {
      await pool.query(
        `
        DELETE FROM push_notification_subscriptions
        WHERE user_id = $1
        `,
        [req.user.id]
      );
    }

    res.json({
      newsletterEnabled,
      pushEnabled,
      message: "Notification settings updated",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update notification settings" });
  }
});

router.get("/post/:postId", authenticateToken, async (req, res) => {
  try {
    await ensureRepostSchema();
    const userId = req.user.id;
    const { postId } = req.params;

    const { rows } = await pool.query(
      `
      SELECT
        p.*,
        u.username,
        u.profile_pic,
        COALESCE(( SELECT json_agg( json_build_object( 'media_url', pm.media_url, 'media_type', pm.media_type, 'media_order', pm.media_order ) ORDER BY pm.media_order ASC ) FROM post_media pm WHERE pm.post_id = p.post_id ), '[]') AS media,
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
            AND liker = $1
        ) AS is_liked,
        EXISTS (
          SELECT 1
          FROM reposts
          WHERE post_id = p.post_id
            AND user_id = $1
        ) AS is_reposted,
        (
          SELECT COUNT(*)
          FROM comments c
          WHERE c.post_id = p.post_id
        )::int AS comment_count
      FROM posts p
      JOIN users u
        ON u.id = p.user_id
        LEFT JOIN LATERAL (
          WITH eligible_reposts AS (
            SELECT
              r.user_id,
              ru.username,
              ru.profile_pic,
              r.created_at AS reposted_at
            FROM reposts r
            JOIN users ru
              ON ru.id = r.user_id
            WHERE r.post_id = p.post_id
              AND (
                r.user_id = $1
                OR r.user_id IN (
                  SELECT following_id
                  FROM follows
                  WHERE follower_id = $1
                )
              )
              AND NOT EXISTS (
                SELECT 1
                FROM blocked_users bu_rep
                WHERE (
                  bu_rep.blocker_id = $1
                  AND bu_rep.blocked_id = ru.id
                ) OR (
                  bu_rep.blocker_id = ru.id
                  AND bu_rep.blocked_id = $1
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
        WHERE p.post_id = $2
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
    await ensureRepostSchema();
    const userId = req.user.id;
    const limit = parseInt(req.query.limit, 10) || 5;
    const offset = parseInt(req.query.offset, 10) || 0;

    const { rows } = await pool.query(
      `
      SELECT
        p.*,
        u.username,
        u.profile_pic,
        latest_repost.reposter_id,
        latest_repost.reposter_username,
        latest_repost.reposter_profile_pic,
        latest_repost.reposted_at,
        latest_repost.reposters,
        latest_repost.reposter_count,
        CASE
          WHEN latest_repost.reposter_id IS NOT NULL THEN 'repost'
          ELSE 'post'
        END AS feed_activity_type,
        COALESCE(( SELECT json_agg( json_build_object( 'media_url', pm.media_url, 'media_type', pm.media_type, 'media_order', pm.media_order ) ORDER BY pm.media_order ASC ) FROM post_media pm WHERE pm.post_id = p.post_id ), '[]') AS media,
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

        EXISTS (
          SELECT 1
          FROM likes
          WHERE post_id = p.post_id
            AND liker = $1
        ) AS is_liked,
        EXISTS (
          SELECT 1
          FROM reposts
          WHERE post_id = p.post_id
            AND user_id = $1
        ) AS is_reposted,

        (
          SELECT COUNT(*)
          FROM comments c
          WHERE c.post_id = p.post_id
        )::int AS comment_count

      FROM posts p
      JOIN users u
        ON u.id = p.user_id
      LEFT JOIN LATERAL (
        WITH eligible_reposts AS (
          SELECT
            r.user_id AS reposter_id,
            ru.username AS reposter_username,
            ru.profile_pic AS reposter_profile_pic,
            r.created_at AS reposted_at
          FROM reposts r
          JOIN users ru
            ON ru.id = r.user_id
          WHERE r.post_id = p.post_id
            AND (
              r.user_id = $1
              OR r.user_id IN (
                SELECT following_id
                FROM follows
                WHERE follower_id = $1
              )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM blocked_users bu_rep
              WHERE (
                bu_rep.blocker_id = $1
                AND bu_rep.blocked_id = ru.id
              ) OR (
                bu_rep.blocker_id = ru.id
                AND bu_rep.blocked_id = $1
              )
            )
        )
        SELECT
          latest.reposter_id,
          latest.reposter_username,
          latest.reposter_profile_pic,
          latest.reposted_at,
          COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'user_id', reposter_id,
                  'username', reposter_username,
                  'profile_pic', reposter_profile_pic,
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
        FROM LATERAL (
          SELECT *
          FROM eligible_reposts
          ORDER BY reposted_at DESC
          LIMIT 1
        ) latest
      ) latest_repost ON TRUE
      WHERE (
          p.user_id = $1
          OR p.user_id IN (
            SELECT following_id
            FROM follows
            WHERE follower_id = $1
          )
          OR latest_repost.reposter_id IS NOT NULL
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
      ORDER BY COALESCE(latest_repost.reposted_at, p.date_posted) DESC
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
  const { username, profile_pic, profile_pic_key, bio } = req.body;
  const normalizedUsername = normalizeUsername(username);
  const usernameValidationMessage = getUsernameValidationMessage(normalizedUsername);

  if (usernameValidationMessage) {
    return res.status(400).json({ error: usernameValidationMessage });
  }

  try {

    // ⭐ Get old profile picture key
    await ensureUserOnboardingSchema();
    await ensureUserProfileSchema();

    const userResult = await pool.query(
      "SELECT profile_pic, profile_pic_key FROM users WHERE id=$1",
      [req.user.id]
    );

    const existingUser = userResult.rows[0];
    const oldKey = existingUser?.profile_pic_key || null;
    const nextProfilePic = typeof profile_pic === "string" ? profile_pic : existingUser?.profile_pic || null;
    const nextProfilePicKey =
      typeof profile_pic_key === "string" && profile_pic_key.trim()
        ? profile_pic_key.trim()
        : oldKey;

    if (oldKey && nextProfilePicKey !== oldKey) {
      await deleteR2Object(process.env.R2_BUCKET, oldKey);
    }

    const query = `
      UPDATE users 
      SET username=$1,
          profile_pic=$2,
          profile_pic_key=$3,
          bio=$4
      WHERE id=$5
      RETURNING id, username, email, profile_pic, profile_pic_key, bio, interests, interests_completed, created_at
    `;

    const params = [
      normalizedUsername,
      nextProfilePic,
      nextProfilePicKey,
      typeof bio === "string" ? bio.trim().slice(0, 160) : null,
      req.user.id
    ];

    const { rows } = await pool.query(query, params);

    res.json({
      user: rows[0],
      message: "Profile updated successfully"
    });

  } catch (err) {
    if (err.code === "23505") {
      return res.status(400).json({ error: "Username already exists" });
    }
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;

