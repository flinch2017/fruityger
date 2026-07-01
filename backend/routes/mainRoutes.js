
import express from "express";
import pool from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { authenticateToken } from "../middleware/auth.js";
import { deleteR2Object } from "../utils/r2Delete.js";
import { ensureUserOnboardingSchema, normalizeInterests } from "../utils/userOnboarding.js";
import { ensureRepostSchema } from "../utils/reposts.js";
import { ensurePushNotificationSubscriptionsTable } from "../utils/notifications.js";
import { ensureTapeViewEventsSchema } from "../utils/tapeViewEvents.js";
import { ensureHashtagSchema } from "../utils/hashtags.js";
import { ensurePrivateAccountSchema } from "../utils/privacy.js";
import { ensureVerificationBadgeSchema } from "../utils/verificationBadge.js";
import { ensureAccountNameSchema, normalizeAccountName } from "../utils/accountName.js";

const router = express.Router();

let blockedUsersTableReadyPromise = null;
let userProfileSchemaReadyPromise = null;
let notificationPreferencesSchemaReadyPromise = null;
let accountStatusSchemaReadyPromise = null;
let helpRequestsTableReadyPromise = null;

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
      await ensureAccountNameSchema();
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
          expo_push_token TEXT UNIQUE,
          platform TEXT,
          subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        ALTER TABLE push_notification_subscriptions
        ADD COLUMN IF NOT EXISTS expo_push_token TEXT
      `);

      await pool.query(`
        ALTER TABLE push_notification_subscriptions
        ADD COLUMN IF NOT EXISTS platform TEXT
      `);

      await pool.query(`
        ALTER TABLE push_notification_subscriptions
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

async function ensureHelpRequestsTable() {
  if (!helpRequestsTableReadyPromise) {
    helpRequestsTableReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS help_requests (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          subject TEXT NOT NULL,
          message TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          admin_response TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          responded_at TIMESTAMPTZ
        )
      `);
    })().catch((error) => {
      helpRequestsTableReadyPromise = null;
      throw error;
    });
  }

  await helpRequestsTableReadyPromise;
}



router.get("/user/:username", authenticateToken, async (req, res) => {
  try {
    await ensureBlockedUsersTable();
    await ensureUserOnboardingSchema();
    await ensureUserProfileSchema();
    await ensureAccountStatusSchema();
    await ensurePrivateAccountSchema();
    await ensureVerificationBadgeSchema();
    const { username } = req.params;

    const { rows } = await pool.query(
      `SELECT id, username, account_name, email, profile_pic, bio, interests, interests_completed, is_private, is_verified, created_at
       FROM users
       WHERE username = $1
         AND deactivated_at IS NULL
         AND deleted_at IS NULL`,
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
    await ensurePrivateAccountSchema();
    await ensureVerificationBadgeSchema();
    const { rows } = await pool.query(
      `SELECT id, username, account_name, email, profile_pic, profile_pic_key, bio, interests, interests_completed, is_private, is_verified, created_at
       FROM users
       WHERE id = $1
         AND deactivated_at IS NULL
         AND deleted_at IS NULL`,
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
    await ensurePrivateAccountSchema();
    await ensureVerificationBadgeSchema();
    const { username } = req.params;

    const { rows } = await pool.query(
      `
      SELECT id, username, account_name, profile_pic, bio, is_private, is_verified, created_at
      FROM users
      WHERE username = $1
        AND deactivated_at IS NULL
        AND deleted_at IS NULL
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

router.get("/settings/privacy", authenticateToken, async (req, res) => {
  try {
    await ensurePrivateAccountSchema();

    const { rows } = await pool.query(
      `
      SELECT COALESCE(is_private, false) AS is_private
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [req.user.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ isPrivate: rows[0].is_private });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load privacy settings" });
  }
});

router.put("/settings/privacy", authenticateToken, async (req, res) => {
  const isPrivate = Boolean(req.body?.isPrivate);

  try {
    await ensurePrivateAccountSchema();

    const { rows } = await pool.query(
      `
      UPDATE users
      SET is_private = $1
      WHERE id = $2
      RETURNING id, username, email, profile_pic, bio, interests, interests_completed, is_private, created_at
      `,
      [isPrivate, req.user.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ isPrivate: rows[0].is_private, user: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update privacy settings" });
  }
});

router.post("/settings/push-token", authenticateToken, async (req, res) => {
  const expoPushToken = String(req.body?.expoPushToken || "").trim();
  const platform = String(req.body?.platform || "").trim().toLowerCase();

  if (!expoPushToken) {
    return res.status(400).json({ error: "expoPushToken is required" });
  }

  try {
    await ensureNotificationPreferencesSchema();
    await ensurePushNotificationSubscriptionsTable();

    await pool.query(
      `
      DELETE FROM push_notification_subscriptions
      WHERE expo_push_token = $2
        AND user_id <> $1
      `,
      [req.user.id, expoPushToken]
    );

    await pool.query(
      `
      INSERT INTO push_notification_subscriptions (user_id, expo_push_token, platform, subscribed_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        expo_push_token = EXCLUDED.expo_push_token,
        platform = EXCLUDED.platform,
        subscribed_at = NOW(),
        updated_at = NOW()
      `,
      [req.user.id, expoPushToken, platform || null]
    );

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to register push token" });
  }
});

router.delete("/settings/push-token", authenticateToken, async (req, res) => {
  try {
    await ensureNotificationPreferencesSchema();
    await ensurePushNotificationSubscriptionsTable();

    await pool.query(
      `
      DELETE FROM push_notification_subscriptions
      WHERE user_id = $1
      `,
      [req.user.id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to unregister push token" });
  }
});

router.get("/post/:postId", authenticateToken, async (req, res) => {
  try {
    await ensureRepostSchema();
    await ensureTapeViewEventsSchema();
    await ensurePrivateAccountSchema();
    await ensureVerificationBadgeSchema();
    const userId = req.user.id;
    const { postId } = req.params;

    const { rows } = await pool.query(
      `
      SELECT
        p.*,
        u.username,
        u.profile_pic,
        u.is_verified,
        COALESCE(u.is_private, false) AS author_is_private,
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
        )::int AS comment_count,
        (
          SELECT COUNT(*)::int
          FROM tape_view_events tv
          WHERE tv.post_id = p.post_id
        ) AS view_count
      FROM posts p
      JOIN users u
        ON u.id = p.user_id
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
        WHERE p.post_id = $2
          AND (
            p.user_id = $1
            OR COALESCE(u.is_private, false) = false
            OR EXISTS (
              SELECT 1
              FROM follows viewer_follow
              WHERE viewer_follow.follower_id = $1
                AND viewer_follow.following_id = p.user_id
            )
          )
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
    await ensureTapeViewEventsSchema();
    await ensureHashtagSchema();
    await ensurePrivateAccountSchema();
    await ensureVerificationBadgeSchema();
    const userId = req.user.id;
    const limit = parseInt(req.query.limit, 10) || 5;
    const offset = parseInt(req.query.offset, 10) || 0;
    const mode = req.query.mode === "following" ? "following" : "discover";
    const surface = req.query.surface === "tapes" ? "tapes" : "feed";
    const startPostId = typeof req.query.start === "string" ? req.query.start.trim() : "";
    const feedScopeClause =
      mode === "following"
        ? `
          (
            p.user_id = $1
            OR p.user_id IN (
              SELECT following_id
              FROM follows
              WHERE follower_id = $1
            )
            OR latest_repost.reposter_id IS NOT NULL
          )
        `
        : `TRUE`;
    const mediaScopeClause =
      surface === "tapes"
        ? `
      AND EXISTS (
        SELECT 1
        FROM post_media tape_media
        WHERE tape_media.post_id = p.post_id
          AND tape_media.media_type = 'video'
      )
        `
        : "";
    const orderClause =
      surface === "tapes"
        ? mode === "following"
          ? `
      CASE
        WHEN $4 <> '' AND CAST(p.post_id AS TEXT) = $4 THEN 0
        ELSE 1
      END ASC,
      COALESCE(latest_repost.reposted_at, p.date_posted) DESC
          `
          : `
      CASE
        WHEN $4 <> '' AND CAST(p.post_id AS TEXT) = $4 THEN 0
        ELSE 1
      END ASC,
      (
        (
          LEAST((
            SELECT COUNT(*)::numeric
            FROM likes l2
            WHERE l2.post_id = p.post_id
          ), 300) * 0.45
        ) + (
          LEAST((
            SELECT COUNT(*)::numeric
            FROM comments c2
            WHERE c2.post_id = p.post_id
          ), 120) * 1.2
        ) + (
          LEAST((
            SELECT COUNT(*)::numeric
            FROM reposts r2
            WHERE r2.post_id = p.post_id
          ), 100) * 1.8
        ) - (
          EXTRACT(EPOCH FROM (NOW() - COALESCE(latest_repost.reposted_at, p.date_posted))) / 21600.0
        ) + (RANDOM() * 0.8)
      ) DESC,
      COALESCE(latest_repost.reposted_at, p.date_posted) DESC
          `
        : mode === "discover"
          ? `
      (
        (CASE
          WHEN p.user_id IN (
            SELECT following_id
            FROM follows
            WHERE follower_id = $1
          ) THEN 8
          ELSE 0
        END)
        + (
          LEAST((
            SELECT COUNT(*)::numeric
            FROM likes l2
            WHERE l2.post_id = p.post_id
          ), 250) * 0.28
        )
        + (
          LEAST((
            SELECT COUNT(*)::numeric
            FROM comments c2
            WHERE c2.post_id = p.post_id
          ), 140) * 0.62
        )
        + (
          LEAST((
            SELECT COUNT(*)::numeric
            FROM reposts r2
            WHERE r2.post_id = p.post_id
          ), 100) * 0.95
        )
        + (
          (
            SELECT COUNT(*)::numeric
            FROM post_hashtags ph
            JOIN LATERAL (
              SELECT LOWER(TRIM(value)) AS term
              FROM jsonb_array_elements_text(
                COALESCE((SELECT interests FROM users WHERE id = $1), '[]'::jsonb)
              ) AS value
            ) user_interest_terms
              ON ph.tag = REPLACE(user_interest_terms.term, ' ', '_')
            WHERE ph.post_id = p.post_id
          ) * 3.2
        )
        + (
          (
            SELECT COUNT(*)::numeric
            FROM LATERAL (
              SELECT LOWER(TRIM(value)) AS term
              FROM jsonb_array_elements_text(
                COALESCE((SELECT interests FROM users WHERE id = $1), '[]'::jsonb)
              ) AS value
            ) user_interest_terms
            WHERE user_interest_terms.term <> ''
              AND POSITION(user_interest_terms.term IN LOWER(COALESCE(p.caption, ''))) > 0
          ) * 1.8
        )
        + (
          (
            SELECT COUNT(*)::numeric
            FROM likes l3
            JOIN posts p3 ON p3.post_id = l3.post_id
            WHERE l3.liker = $1
              AND p3.user_id = p.user_id
          ) * 0.9
        )
        + (
          (
            SELECT COUNT(*)::numeric
            FROM comments c3
            JOIN posts p4 ON p4.post_id = c3.post_id
            WHERE c3.user_id = $1
              AND p4.user_id = p.user_id
          ) * 0.9
        )
        + (
          (
            SELECT COUNT(*)::numeric
            FROM reposts r3
            JOIN posts p5 ON p5.post_id = r3.post_id
            WHERE r3.user_id = $1
              AND p5.user_id = p.user_id
          ) * 1.1
        )
        + (
          (
            SELECT COUNT(*)::numeric
            FROM likes l4
            WHERE l4.post_id = p.post_id
              AND l4.liker IN (
                SELECT DISTINCT u2.id
                FROM users u2
                WHERE u2.id <> $1
                  AND u2.deactivated_at IS NULL
                  AND u2.deleted_at IS NULL
                  AND EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements_text(COALESCE(u2.interests, '[]'::jsonb)) i2(value)
                    WHERE LOWER(TRIM(i2.value)) IN (
                      SELECT LOWER(TRIM(i1.value))
                      FROM jsonb_array_elements_text(
                        COALESCE((SELECT interests FROM users WHERE id = $1), '[]'::jsonb)
                      ) i1(value)
                    )
                  )
              )
          ) * 0.34
        )
        + (
          (
            SELECT COUNT(*)::numeric
            FROM comments c4
            WHERE c4.post_id = p.post_id
              AND c4.user_id IN (
                SELECT DISTINCT u2.id
                FROM users u2
                WHERE u2.id <> $1
                  AND u2.deactivated_at IS NULL
                  AND u2.deleted_at IS NULL
                  AND EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements_text(COALESCE(u2.interests, '[]'::jsonb)) i2(value)
                    WHERE LOWER(TRIM(i2.value)) IN (
                      SELECT LOWER(TRIM(i1.value))
                      FROM jsonb_array_elements_text(
                        COALESCE((SELECT interests FROM users WHERE id = $1), '[]'::jsonb)
                      ) i1(value)
                    )
                  )
              )
          ) * 0.34
        )
        + (
          (
            SELECT COUNT(*)::numeric
            FROM reposts r4
            WHERE r4.post_id = p.post_id
              AND r4.user_id IN (
                SELECT DISTINCT u2.id
                FROM users u2
                WHERE u2.id <> $1
                  AND u2.deactivated_at IS NULL
                  AND u2.deleted_at IS NULL
                  AND EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements_text(COALESCE(u2.interests, '[]'::jsonb)) i2(value)
                    WHERE LOWER(TRIM(i2.value)) IN (
                      SELECT LOWER(TRIM(i1.value))
                      FROM jsonb_array_elements_text(
                        COALESCE((SELECT interests FROM users WHERE id = $1), '[]'::jsonb)
                      ) i1(value)
                    )
                  )
              )
          ) * 0.5
        )
        - (
          EXTRACT(EPOCH FROM (NOW() - COALESCE(latest_repost.reposted_at, p.date_posted))) / 21600.0
        )
        + (RANDOM() * 0.42)
      ) DESC,
      COALESCE(latest_repost.reposted_at, p.date_posted) DESC
          `
          : `COALESCE(latest_repost.reposted_at, p.date_posted) DESC`;

    const queryParams =
      surface === "tapes"
        ? [userId, limit, offset, startPostId]
        : [userId, limit, offset];

    const { rows } = await pool.query(
      `
      SELECT
        p.*,
        u.username,
        u.profile_pic,
        u.is_verified,
        COALESCE(u.is_private, false) AS author_is_private,
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
        )::int AS comment_count,
        (
          SELECT COUNT(*)::int
          FROM tape_view_events tv
          WHERE tv.post_id = p.post_id
        ) AS view_count

      FROM posts p
      JOIN users u
        ON u.id = p.user_id
       AND u.deactivated_at IS NULL
       AND u.deleted_at IS NULL
      LEFT JOIN LATERAL (
        WITH eligible_reposts AS (
          SELECT
            r.user_id AS reposter_id,
            ru.username AS reposter_username,
            ru.profile_pic AS reposter_profile_pic,
            ru.is_verified AS reposter_is_verified,
            r.created_at AS reposted_at
          FROM reposts r
          JOIN users ru
            ON ru.id = r.user_id
           AND ru.deactivated_at IS NULL
           AND ru.deleted_at IS NULL
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
          latest.reposter_is_verified,
          latest.reposted_at,
          COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'user_id', reposter_id,
                  'username', reposter_username,
                  'profile_pic', reposter_profile_pic,
                  'is_verified', reposter_is_verified,
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
      WHERE ${feedScopeClause}
        AND (
          p.user_id = $1
          OR COALESCE(u.is_private, false) = false
          OR EXISTS (
            SELECT 1
            FROM follows viewer_follow
            WHERE viewer_follow.follower_id = $1
              AND viewer_follow.following_id = p.user_id
          )
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
        ${mediaScopeClause}
      ORDER BY ${orderClause}
      LIMIT $2 OFFSET $3
      `,
      queryParams
    );

    res.json({ posts: rows, mode, surface });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/settings/help-requests", authenticateToken, async (req, res) => {
  const subject = String(req.body?.subject || "").trim();
  const message = String(req.body?.message || "").trim();

  if (!subject || subject.length < 3) {
    return res.status(400).json({ error: "Subject must be at least 3 characters" });
  }

  if (!message || message.length < 8) {
    return res.status(400).json({ error: "Message must be at least 8 characters" });
  }

  try {
    await ensureHelpRequestsTable();
    const { rows } = await pool.query(
      `
      INSERT INTO help_requests (id, user_id, subject, message)
      VALUES ($1, $2, $3, $4)
      RETURNING id, subject, message, status, created_at
      `,
      [uuidv4(), req.user.id, subject, message]
    );

    res.status(201).json({ request: rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to submit help request" });
  }
});

router.get("/settings/help-requests", authenticateToken, async (req, res) => {
  try {
    await ensureHelpRequestsTable();
    const { rows } = await pool.query(
      `
      SELECT id, subject, message, status, admin_response, created_at, updated_at, responded_at
      FROM help_requests
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 20
      `,
      [req.user.id]
    );

    res.json({ requests: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to load help requests" });
  }
});

router.post("/tapes/view", authenticateToken, async (req, res) => {
  const { postId } = req.body || {};

  if (!postId) {
    return res.status(400).json({ error: "postId is required" });
  }

  try {
    await ensureTapeViewEventsSchema();

    const postResult = await pool.query(
      `
      SELECT p.post_id
      FROM posts p
      WHERE p.post_id = $1
        AND EXISTS (
          SELECT 1
          FROM post_media pm
          WHERE pm.post_id = p.post_id
            AND pm.media_type = 'video'
        )
      LIMIT 1
      `,
      [postId]
    );

    if (!postResult.rows[0]) {
      return res.status(404).json({ error: "Tape not found" });
    }

    await pool.query(
      `
      INSERT INTO tape_view_events (post_id, viewer_id, viewed_at)
      VALUES ($1, $2, NOW())
      `,
      [postId, req.user.id]
    );

    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS view_count
      FROM tape_view_events
      WHERE post_id = $1
      `,
      [postId]
    );

    return res.json({
      success: true,
      view_count: countResult.rows[0]?.view_count || 0,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to record tape view" });
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
  const { username, account_name, profile_pic, profile_pic_key, bio } = req.body;
  const normalizedUsername = normalizeUsername(username);
  const normalizedAccountName = normalizeAccountName(account_name);
  const usernameValidationMessage = getUsernameValidationMessage(normalizedUsername);

  if (usernameValidationMessage) {
    return res.status(400).json({ error: usernameValidationMessage });
  }

  try {

    // ⭐ Get old profile picture key
    await ensureUserOnboardingSchema();
    await ensureUserProfileSchema();
    await ensurePrivateAccountSchema();

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
          bio=$4,
          account_name=$5
      WHERE id=$6
      RETURNING id, username, account_name, email, profile_pic, profile_pic_key, bio, interests, interests_completed, is_private, created_at
    `;

    const params = [
      normalizedUsername,
      nextProfilePic,
      nextProfilePicKey,
      typeof bio === "string" ? bio.trim().slice(0, 160) : null,
      normalizedAccountName,
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

