import express from "express";
import pool from "../db.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import axios from "axios";
import { authenticateTokenAllowUnverified } from "../middleware/auth.js";
import {
  cleanupExpiredUnverifiedUsers,
  ensureEmailVerificationSchema,
  generateVerificationCode,
  getVerificationExpiry,
  sendVerificationEmail,
} from "../utils/emailVerification.js";

const router = express.Router();
const SALT_ROUNDS = 10;

const verifyRecaptcha = async (recaptchaToken) => {
  if (!recaptchaToken) {
    return false;
  }

  const response = await axios.post(
    `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.RECAPTCHA_SECRET}&response=${recaptchaToken}`
  );

  return Boolean(response.data?.success);
};

const getAgeFromBirthDate = (birthDate) => {
  if (!birthDate) return null;

  const today = new Date();
  const dob = new Date(`${birthDate}T00:00:00`);

  if (Number.isNaN(dob.getTime())) {
    return null;
  }

  let age = today.getFullYear() - dob.getFullYear();
  const monthDifference = today.getMonth() - dob.getMonth();

  if (
    monthDifference < 0 ||
    (monthDifference === 0 && today.getDate() < dob.getDate())
  ) {
    age -= 1;
  }

  return age;
};

const getPasswordValidationMessage = (password) => {
  if (!password || password.length < 8) {
    return "Password must be at least 8 characters long";
  }

  if (!/[A-Z]/.test(password)) {
    return "Password must include at least one uppercase letter";
  }

  if (!/[a-z]/.test(password)) {
    return "Password must include at least one lowercase letter";
  }

  if (!/\d/.test(password)) {
    return "Password must include at least one number";
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    return "Password must include at least one special character";
  }

  if (/\s/.test(password)) {
    return "Password cannot contain spaces";
  }

  return "";
};

const signToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRY || "7d",
  });

const sanitizeUser = (user) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  profile_pic: user.profile_pic,
  birth_date: user.birth_date,
  email_verified: user.email_verified,
  created_at: user.created_at,
});

router.post("/signup", async (req, res) => {
  const { username, email, password, birthDate, recaptchaToken, profile_pic } = req.body;

  await ensureEmailVerificationSchema();
  await cleanupExpiredUnverifiedUsers();

  const age = getAgeFromBirthDate(birthDate);
  if (!birthDate || age === null) {
    return res.status(400).json({ error: "A valid birthday is required" });
  }

  if (age < 13) {
    return res.status(400).json({ error: "You must be at least 13 years old to sign up" });
  }

  const passwordValidationMessage = getPasswordValidationMessage(password);
  if (passwordValidationMessage) {
    return res.status(400).json({ error: passwordValidationMessage });
  }

  try {
    const isHuman = await verifyRecaptcha(recaptchaToken);
    if (!isHuman) {
      return res.status(400).json({ error: "reCAPTCHA verification failed" });
    }
  } catch (err) {
    return res.status(500).json({ error: "reCAPTCHA request failed" });
  }

  const verificationCode = generateVerificationCode();
  const verificationExpiry = getVerificationExpiry();

  try {
    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await pool.query(
      `
      INSERT INTO users (
        username,
        email,
        password,
        profile_pic,
        birth_date,
        email_verified,
        email_verification_code,
        email_verification_expires_at
      )
      VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7)
      RETURNING id, username, email, profile_pic, birth_date, email_verified, created_at
      `,
      [username, email, password_hash, profile_pic || null, birthDate, verificationCode, verificationExpiry]
    );

    const user = result.rows[0];

    try {
      await sendVerificationEmail({
        to: email,
        username,
        code: verificationCode,
      });
    } catch (mailError) {
      await pool.query(`DELETE FROM users WHERE id = $1`, [user.id]);
      return res.status(500).json({
        error:
          mailError.message === "Email service is not configured" ||
          mailError.message === "Email sender is not configured"
            ? "Email verification is not configured on the server yet"
            : "Failed to send verification email",
      });
    }

    const token = signToken(user.id);
    res.json({
      user: sanitizeUser(user),
      token,
      requiresVerification: true,
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(400).json({ error: "Email or username already exists" });
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/login", async (req, res) => {
  const { email, password, recaptchaToken } = req.body;

  await ensureEmailVerificationSchema();
  await cleanupExpiredUnverifiedUsers();

  try {
    const isHuman = await verifyRecaptcha(recaptchaToken);
    if (!isHuman) {
      return res.status(400).json({ error: "reCAPTCHA verification failed" });
    }
  } catch (err) {
    return res.status(500).json({ error: "reCAPTCHA request failed" });
  }

  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    const user = result.rows[0];

    if (!user) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    if (!user.email_verified && user.email_verification_expires_at && new Date(user.email_verification_expires_at) <= new Date()) {
      await cleanupExpiredUnverifiedUsers();
      return res.status(400).json({ error: "This verification window expired. Please sign up again." });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const token = signToken(user.id);

    res.json({
      user: sanitizeUser(user),
      token,
      requiresVerification: !user.email_verified,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/session", authenticateTokenAllowUnverified, async (req, res) => {
  await ensureEmailVerificationSchema();
  await cleanupExpiredUnverifiedUsers();

  const { rows } = await pool.query(
    `
    SELECT id, username, email, profile_pic, birth_date, email_verified, email_verification_expires_at, created_at
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [req.user.id]
  );

  const user = rows[0];
  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  res.json({
    user: sanitizeUser(user),
    requiresVerification: !user.email_verified,
    verificationExpiresAt: user.email_verification_expires_at,
  });
});

router.post("/verify-email", authenticateTokenAllowUnverified, async (req, res) => {
  const { code } = req.body;

  await ensureEmailVerificationSchema();
  await cleanupExpiredUnverifiedUsers();

  if (!code || !/^\d{6}$/.test(String(code))) {
    return res.status(400).json({ error: "Please enter a valid 6-digit code" });
  }

  const { rows } = await pool.query(
    `
    SELECT id, username, email, profile_pic, birth_date, email_verified, email_verification_code, email_verification_expires_at, created_at
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [req.user.id]
  );

  const user = rows[0];
  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  if (user.email_verified) {
    return res.json({
      user: sanitizeUser(user),
      verified: true,
    });
  }

  if (
    !user.email_verification_expires_at ||
    new Date(user.email_verification_expires_at) <= new Date()
  ) {
    await cleanupExpiredUnverifiedUsers();
    return res.status(400).json({ error: "This verification code expired. Please sign up again." });
  }

  if (String(user.email_verification_code) !== String(code)) {
    return res.status(400).json({ error: "That verification code is incorrect" });
  }

  const updateResult = await pool.query(
    `
    UPDATE users
    SET email_verified = TRUE,
        email_verification_code = NULL,
        email_verification_expires_at = NULL
    WHERE id = $1
    RETURNING id, username, email, profile_pic, birth_date, email_verified, created_at
    `,
    [req.user.id]
  );

  res.json({
    user: sanitizeUser(updateResult.rows[0]),
    verified: true,
  });
});

router.post("/resend-verification", authenticateTokenAllowUnverified, async (req, res) => {
  await ensureEmailVerificationSchema();
  await cleanupExpiredUnverifiedUsers();

  const { rows } = await pool.query(
    `
    SELECT id, username, email, profile_pic, birth_date, email_verified, created_at
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [req.user.id]
  );

  const user = rows[0];
  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  if (user.email_verified) {
    return res.json({ message: "Email already verified" });
  }

  const verificationCode = generateVerificationCode();
  const verificationExpiry = getVerificationExpiry();

  await pool.query(
    `
    UPDATE users
    SET email_verification_code = $2,
        email_verification_expires_at = $3
    WHERE id = $1
    `,
    [user.id, verificationCode, verificationExpiry]
  );

  try {
    await sendVerificationEmail({
      to: user.email,
      username: user.username,
      code: verificationCode,
    });
  } catch (mailError) {
    return res.status(500).json({
      error:
        mailError.message === "Email service is not configured" ||
        mailError.message === "Email sender is not configured"
          ? "Email verification is not configured on the server yet"
          : "Failed to send verification email",
    });
  }

  res.json({ message: "Verification code sent" });
});

export default router;
