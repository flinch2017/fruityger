// routes/auth.js
import express from "express";
import pool from "../db.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import axios from "axios";

const router = express.Router();
const SALT_ROUNDS = 10;



// ================== Signup ==================
router.post("/signup", async (req, res) => {
  const { username, email, password, recaptchaToken, profile_pic } = req.body;

  // 1️⃣ Verify reCAPTCHA
  try {
    const response = await axios.post(
      `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.RECAPTCHA_SECRET}&response=${recaptchaToken}`
    );

    if (!response.data.success) {
      return res.status(400).json({ error: "reCAPTCHA verification failed" });
    }
  } catch (err) {
    return res.status(500).json({ error: "reCAPTCHA request failed" });
  }

  try {
    // 2️⃣ Hash password
    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    // 3️⃣ Insert user into DB
    const result = await pool.query(
      "INSERT INTO users (username, email, password, profile_pic) VALUES ($1, $2, $3, $4) RETURNING id, username, email, profile_pic, created_at",
      [username, email, password_hash, profile_pic || null]
    );

    const user = result.rows[0];

    // 4️⃣ Generate JWT
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRY || "7d",
    });

    res.json({ user, token });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(400).json({ error: "Email or username already exists" });
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ================== Login ==================
router.post("/login", async (req, res) => {
  const { email, password, recaptchaToken } = req.body;

  // 1️⃣ Verify reCAPTCHA
  try {
    const response = await axios.post(
      `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.RECAPTCHA_SECRET}&response=${recaptchaToken}`
    );

    if (!response.data.success) {
      return res.status(400).json({ error: "reCAPTCHA verification failed" });
    }
  } catch (err) {
    return res.status(500).json({ error: "reCAPTCHA request failed" });
  }

  try {
    // 2️⃣ Find user by email
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    const user = result.rows[0];

    if (!user) return res.status(400).json({ error: "Invalid email or password" });

    // 3️⃣ Compare password
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: "Invalid email or password" });

    // 4️⃣ Generate JWT
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRY || "7d",
    });

    res.json({ user: { id: user.id, username: user.username, email: user.email, profile_pic: user.profile_pic }, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;