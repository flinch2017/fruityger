import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

// Toggle follow/unfollow
router.post("/toggle", authenticateToken, async (req, res) => {
  const followerId = req.user.id; // from token
  const { username } = req.body;

  if (!username) return res.status(400).json({ message: "Username is required" });

  try {
    // 1️⃣ Get the target user's ID
    const userRes = await pool.query(
      "SELECT id FROM users WHERE username = $1",
      [username]
    );

    if (userRes.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const followingId = userRes.rows[0].id;

    if (followerId === followingId) {
      return res.status(400).json({ message: "You cannot follow yourself" });
    }

    // 2️⃣ Check if already following
    const existsRes = await pool.query(
      "SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2",
      [followerId, followingId]
    );

    if (existsRes.rowCount > 0) {
      // Already following → unfollow
      await pool.query(
        "DELETE FROM follows WHERE follower_id = $1 AND following_id = $2",
        [followerId, followingId]
      );
      return res.json({ following: false });
    } else {
      // Not following → follow
      await pool.query(
        "INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)",
        [followerId, followingId]
      );
      return res.json({ following: true });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Check if current user is following another user
router.get("/status", authenticateToken, async (req, res) => {
  const followerId = req.user.id;
  const { username } = req.query;

  if (!username) return res.status(400).json({ message: "Username is required" });

  try {
    // Get the user ID of the profile we're viewing
    const userRes = await pool.query(
      "SELECT id FROM users WHERE username = $1",
      [username]
    );

    if (userRes.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const followingId = userRes.rows[0].id;

    // Check follow status
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

export default router;