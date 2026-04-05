import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";
import { createNotification } from "../utils/notifications.js";

const router = express.Router();

router.post("/toggle", authenticateToken, async (req, res) => {
  const followerId = req.user.id;
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ message: "Username is required" });
  }

  try {
    const userRes = await pool.query(
      "SELECT id FROM users WHERE username = $1 AND deactivated_at IS NULL AND deleted_at IS NULL",
      [username]
    );

    if (userRes.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const followingId = userRes.rows[0].id;

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

      return res.json({ following: false });
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

    return res.json({ following: true });
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
    const userRes = await pool.query(
      "SELECT id FROM users WHERE username = $1 AND deactivated_at IS NULL AND deleted_at IS NULL",
      [username]
    );

    if (userRes.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const followingId = userRes.rows[0].id;

    const existsRes = await pool.query(
      "SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2",
      [followerId, followingId]
    );

    return res.json({ following: existsRes.rowCount > 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
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
    const userRes = await pool.query(
      "SELECT id, username FROM users WHERE username = $1 AND deactivated_at IS NULL AND deleted_at IS NULL",
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
          EXISTS (
            SELECT 1
            FROM follows current_follow
            WHERE current_follow.follower_id = $2
              AND current_follow.following_id = u.id
          ) AS is_following
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
          EXISTS (
            SELECT 1
            FROM follows current_follow
            WHERE current_follow.follower_id = $2
              AND current_follow.following_id = u.id
          ) AS is_following
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
