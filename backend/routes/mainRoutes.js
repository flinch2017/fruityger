// routes/auth.js
import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";

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

router.put("/edit-profile", authenticateToken, async (req, res) => {
  const { username, email, password, profile_pic } = req.body;

  try {
    // Start building query and params
    let query = `UPDATE users SET username=$1, email=$2, profile_pic=$3`;
    const params = [username, email, profile_pic];

    // If password is provided, add it to query
    if (password) {
      const hashed = await bcrypt.hash(password, 10);
      query += `, password=$4 WHERE user_id=$5 RETURNING user_id, username, email, profile_pic, created_at`;
      params.push(hashed, req.user.id); // $4 = hashed password, $5 = user_id
    } else {
      query += ` WHERE user_id=$4 RETURNING user_id, username, email, profile_pic, created_at`;
      params.push(req.user.id); // $4 = user_id
    }

    const { rows } = await pool.query(query, params);

    if (!rows[0]) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ user: rows[0], message: "Profile updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;