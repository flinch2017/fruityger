
import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";
import { deleteR2Object } from "../utils/r2Delete.js";

const router = express.Router();

// Get current user info
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, username, email, profile_pic, created_at
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );

    if (!rows[0]) return res.status(404).json({ error: "User not found" });

    res.json({ user: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/user/:username", authenticateToken, async (req, res) => {
  try {

    const { username } = req.params;

    const { rows } = await pool.query(
      `SELECT id, username, email, profile_pic, created_at
       FROM users
       WHERE username = $1`,
      [username]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ user: rows[0] });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
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