import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";
import { createNotification } from "../utils/notifications.js";
import { ensurePrivateAccountSchema } from "../utils/privacy.js";
import { ensureVerificationBadgeSchema } from "../utils/verificationBadge.js";

const router = express.Router();

const findActiveUserByUsername = async (username) =>
  pool.query(
    `
    SELECT id, username, COALESCE(is_private, false) AS is_private
    FROM users
    WHERE username = $1
      AND deactivated_at IS NULL
      AND deleted_at IS NULL
    LIMIT 1
    `,
    [username]
  );

router.post("/toggle", authenticateToken, async (req, res) => {
  const followerId = req.user.id;
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ message: "Username is required" });
  }

  try {
    await ensurePrivateAccountSchema();

    const userRes = await findActiveUserByUsername(username);

    if (userRes.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const targetUser = userRes.rows[0];
    const followingId = targetUser.id;

    if (followerId === followingId) {
      return res.status(400).json({ message: "You cannot follow yourself" });
    }

    const existsRes = await pool.query(
      "SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2",
      [followerId, followingId]
    );

    if (existsRes.rowCount > 0) {
      await pool.query(
        "DELETE FROM follows WHERE follower_id = $1 AND following_id = $2",
        [followerId, followingId]
      );

      return res.json({ following: false, requested: false, is_private: targetUser.is_private });
    }

    const requestRes = await pool.query(
      `
      SELECT 1
      FROM follow_requests
      WHERE requester_id = $1
        AND requested_id = $2
      LIMIT 1
      `,
      [followerId, followingId]
    );

    if (requestRes.rowCount > 0) {
      await pool.query(
        `
        DELETE FROM follow_requests
        WHERE requester_id = $1
          AND requested_id = $2
        `,
        [followerId, followingId]
      );

      await pool.query(
        `
        DELETE FROM notifications
        WHERE recipient_id = $1
          AND actor_id = $2
          AND type = 'follow_request'
        `,
        [followingId, followerId]
      );

      return res.json({ following: false, requested: false, is_private: targetUser.is_private });
    }

    if (targetUser.is_private) {
      await pool.query(
        `
        INSERT INTO follow_requests (requester_id, requested_id)
        VALUES ($1, $2)
        ON CONFLICT (requester_id, requested_id) DO NOTHING
        `,
        [followerId, followingId]
      );

      await createNotification({
        recipientId: followingId,
        actorId: followerId,
        type: "follow_request",
      });

      return res.json({ following: false, requested: true, is_private: true });
    }

    await pool.query(
      "INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)",
      [followerId, followingId]
    );

    await createNotification({
      recipientId: followingId,
      actorId: followerId,
      type: "new_follower",
    });

    return res.json({ following: true, requested: false, is_private: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/status", authenticateToken, async (req, res) => {
  const followerId = req.user.id;
  const { username } = req.query;

  if (!username) {
    return res.status(400).json({ message: "Username is required" });
  }

  try {
    await ensurePrivateAccountSchema();

    const userRes = await findActiveUserByUsername(username);

    if (userRes.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const targetUser = userRes.rows[0];
    const followingId = targetUser.id;

    const statusRes = await pool.query(
      `
      SELECT
        EXISTS (
          SELECT 1
          FROM follows
          WHERE follower_id = $1
            AND following_id = $2
        ) AS following,
        EXISTS (
          SELECT 1
          FROM follow_requests
          WHERE requester_id = $1
            AND requested_id = $2
        ) AS requested
      `,
      [followerId, followingId]
    );

    return res.json({
      following: statusRes.rows[0]?.following || false,
      requested: statusRes.rows[0]?.requested || false,
      is_private: targetUser.is_private,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/requests/:requesterId/accept", authenticateToken, async (req, res) => {
  const requestedId = req.user.id;
  const { requesterId } = req.params;

  try {
    await ensurePrivateAccountSchema();

    const requestRes = await pool.query(
      `
      DELETE FROM follow_requests
      WHERE requester_id = $1
        AND requested_id = $2
      RETURNING requester_id
      `,
      [requesterId, requestedId]
    );

    if (requestRes.rowCount === 0) {
      return res.status(404).json({ message: "Follow request not found" });
    }

    await pool.query(
      `
      DELETE FROM notifications
      WHERE recipient_id = $1
        AND actor_id = $2
        AND type = 'follow_request'
      `,
      [requestedId, requesterId]
    );

    await pool.query(
      `
      INSERT INTO follows (follower_id, following_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      `,
      [requesterId, requestedId]
    );

    await createNotification({
      recipientId: requesterId,
      actorId: requestedId,
      type: "follow_request_accepted",
    });

    return res.json({ accepted: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/requests/:requesterId/reject", authenticateToken, async (req, res) => {
  const requestedId = req.user.id;
  const { requesterId } = req.params;

  try {
    await ensurePrivateAccountSchema();

    const requestRes = await pool.query(
      `
      DELETE FROM follow_requests
      WHERE requester_id = $1
        AND requested_id = $2
      RETURNING requester_id
      `,
      [requesterId, requestedId]
    );

    if (requestRes.rowCount === 0) {
      return res.status(404).json({ message: "Follow request not found" });
    }

    await pool.query(
      `
      DELETE FROM notifications
      WHERE recipient_id = $1
        AND actor_id = $2
        AND type = 'follow_request'
      `,
      [requestedId, requesterId]
    );

    return res.json({ rejected: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/list", authenticateToken, async (req, res) => {
  const currentUserId = req.user.id;
  const { username, type } = req.query;

  if (!username) {
    return res.status(400).json({ message: "Username is required" });
  }

  if (type !== "followers" && type !== "following") {
    return res.status(400).json({ message: "Type must be followers or following" });
  }

  try {
    await ensurePrivateAccountSchema();
    await ensureVerificationBadgeSchema();

    const userRes = await pool.query(
      "SELECT id, username, is_verified FROM users WHERE username = $1 AND deactivated_at IS NULL AND deleted_at IS NULL",
      [username]
    );

    if (userRes.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const targetUser = userRes.rows[0];

    const listQuery = type === "followers"
      ? `
        SELECT
          u.id,
          u.username,
          u.profile_pic,
          u.is_verified,
          COALESCE(u.is_private, false) AS is_private,
          EXISTS (
            SELECT 1
            FROM follows current_follow
            WHERE current_follow.follower_id = $2
              AND current_follow.following_id = u.id
          ) AS is_following,
          EXISTS (
            SELECT 1
            FROM follow_requests current_request
            WHERE current_request.requester_id = $2
              AND current_request.requested_id = u.id
          ) AS requested
        FROM follows f
        JOIN users u
          ON u.id = f.follower_id
         AND u.deactivated_at IS NULL
         AND u.deleted_at IS NULL
        WHERE f.following_id = $1
        ORDER BY f.created_at DESC, u.username ASC
      `
      : `
        SELECT
          u.id,
          u.username,
          u.profile_pic,
          u.is_verified,
          COALESCE(u.is_private, false) AS is_private,
          EXISTS (
            SELECT 1
            FROM follows current_follow
            WHERE current_follow.follower_id = $2
              AND current_follow.following_id = u.id
          ) AS is_following,
          EXISTS (
            SELECT 1
            FROM follow_requests current_request
            WHERE current_request.requester_id = $2
              AND current_request.requested_id = u.id
          ) AS requested
        FROM follows f
        JOIN users u
          ON u.id = f.following_id
         AND u.deactivated_at IS NULL
         AND u.deleted_at IS NULL
        WHERE f.follower_id = $1
        ORDER BY f.created_at DESC, u.username ASC
      `;

    const { rows } = await pool.query(listQuery, [targetUser.id, currentUserId]);

    return res.json({
      user: targetUser,
      type,
      accounts: rows.map((row) => ({
        ...row,
        is_self: row.id === currentUserId,
      })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
