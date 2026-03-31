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
  sendEmailChangeConfirmationEmail,
  sendVerificationEmail,
} from "../utils/emailVerification.js";
import { ensureUserOnboardingSchema } from "../utils/userOnboarding.js";

const router = express.Router();
const SALT_ROUNDS = 10;
const ACCOUNT_CHANGE_TOKEN_MINUTES = 15;
const getFrontendBaseUrl = () =>
  String(
    process.env.FRONTEND_URL ||
      process.env.ALLOWED_ORIGINS?.split(",")[0] ||
      "http://localhost:5173"
  )
    .trim()
    .replace(/\/+$/, "");

const ensureAccountChangeSchema = async () => {
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS pending_email TEXT
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_change_token TEXT
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_change_expires_at TIMESTAMPTZ
  `);
};

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

const signAccountChangeToken = (userId, purpose) =>
  jwt.sign({ id: userId, purpose }, process.env.JWT_SECRET, {
    expiresIn: `${ACCOUNT_CHANGE_TOKEN_MINUTES}m`,
  });

const verifyAccountChangeToken = (token, userId, purpose) => {
  if (!token) {
    throw new Error("Missing verification token");
  }

  const decoded = jwt.verify(token, process.env.JWT_SECRET);

  if (decoded.id !== userId || decoded.purpose !== purpose) {
    throw new Error("Invalid verification token");
  }
};

const sanitizeUser = (user) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  pending_email: user.pending_email || null,
  profile_pic: user.profile_pic,
  birth_date: user.birth_date,
  email_verified: user.email_verified,
  interests: Array.isArray(user.interests) ? user.interests : [],
  interests_completed: Boolean(user.interests_completed),
  created_at: user.created_at,
});

router.post("/signup", async (req, res) => {
  const { username, email, password, birthDate, recaptchaToken, profile_pic } = req.body;

  await ensureEmailVerificationSchema();
  await ensureUserOnboardingSchema();
  await ensureAccountChangeSchema();
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
        email_verification_expires_at,
        interests,
        interests_completed
      )
      VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7, '[]'::jsonb, FALSE)
      RETURNING id, username, email, profile_pic, birth_date, email_verified, interests, interests_completed, created_at
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
  await ensureUserOnboardingSchema();
  await ensureAccountChangeSchema();
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
  await ensureUserOnboardingSchema();
  await ensureAccountChangeSchema();
  await cleanupExpiredUnverifiedUsers();

  const { rows } = await pool.query(
    `
    SELECT id, username, email, pending_email, profile_pic, birth_date, email_verified, interests, interests_completed, email_verification_expires_at, created_at
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
  await ensureUserOnboardingSchema();
  await ensureAccountChangeSchema();
  await cleanupExpiredUnverifiedUsers();

  if (!code || !/^\d{6}$/.test(String(code))) {
    return res.status(400).json({ error: "Please enter a valid 6-digit code" });
  }

  const { rows } = await pool.query(
    `
    SELECT id, username, email, profile_pic, birth_date, email_verified, interests, interests_completed, email_verification_code, email_verification_expires_at, created_at
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
    RETURNING id, username, email, profile_pic, birth_date, email_verified, interests, interests_completed, created_at
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
  await ensureUserOnboardingSchema();
  await ensureAccountChangeSchema();
  await cleanupExpiredUnverifiedUsers();

  const { rows } = await pool.query(
    `
    SELECT id, username, email, profile_pic, birth_date, email_verified, interests, interests_completed, created_at
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

router.post("/verify-current-password", authenticateTokenAllowUnverified, async (req, res) => {
  const { currentPassword, purpose } = req.body || {};

  if (!currentPassword) {
    return res.status(400).json({ error: "Current password is required" });
  }

  if (!["email-change", "password-change"].includes(purpose)) {
    return res.status(400).json({ error: "Invalid verification purpose" });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT password
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

    const matches = await bcrypt.compare(currentPassword, user.password);
    if (!matches) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }

    res.json({
      approvalToken: signAccountChangeToken(req.user.id, purpose),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to verify current password" });
  }
});

router.post("/request-email-change", authenticateTokenAllowUnverified, async (req, res) => {
  const { approvalToken, newEmail } = req.body || {};

  if (!newEmail) {
    return res.status(400).json({ error: "New email is required" });
  }

  try {
    await ensureAccountChangeSchema();
    verifyAccountChangeToken(approvalToken, req.user.id, "email-change");

    const normalizedEmail = String(newEmail).trim().toLowerCase();
    if (!normalizedEmail) {
      return res.status(400).json({ error: "New email is required" });
    }

    const existingEmail = await pool.query(
      `
      SELECT id
      FROM users
      WHERE LOWER(email) = $1
        AND id <> $2
      LIMIT 1
      `,
      [normalizedEmail, req.user.id]
    );

    if (existingEmail.rows.length > 0) {
      return res.status(400).json({ error: "That email is already in use" });
    }

    const { rows } = await pool.query(
      `
      SELECT username, pending_email
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

    if (user.pending_email) {
      return res.status(400).json({ error: "You already have a pending email change" });
    }

    const emailChangeToken = jwt.sign(
      { id: req.user.id, newEmail: normalizedEmail, purpose: "confirm-email-change" },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );
    const emailChangeExpiry = getVerificationExpiry();
    const confirmUrl = `${getFrontendBaseUrl()}/confirm-email-change?token=${encodeURIComponent(emailChangeToken)}`;

    await pool.query(
      `
      UPDATE users
      SET pending_email = $2,
          email_change_token = $3,
          email_change_expires_at = $4
      WHERE id = $1
      `,
      [req.user.id, normalizedEmail, emailChangeToken, emailChangeExpiry]
    );

    await sendEmailChangeConfirmationEmail({
      to: normalizedEmail,
      username: user.username,
      confirmUrl,
    });

    res.json({
      message: "Confirmation email sent to your new address",
    });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError || error.message === "Missing verification token" || error.message === "Invalid verification token") {
      return res.status(403).json({ error: "Password confirmation expired. Please verify again." });
    }

    console.error(error);
    res.status(500).json({ error: "Failed to start email change" });
  }
});

router.post("/confirm-email-change", async (req, res) => {
  const { token } = req.body || {};

  if (!token) {
    return res.status(400).json({ error: "Confirmation token is required" });
  }

  try {
    await ensureAccountChangeSchema();

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.purpose !== "confirm-email-change") {
      return res.status(400).json({ error: "Invalid confirmation token" });
    }

    const { rows } = await pool.query(
      `
      SELECT id, username, email, profile_pic, birth_date, email_verified, interests, interests_completed, pending_email, email_change_token, email_change_expires_at, created_at
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [decoded.id]
    );

    const user = rows[0];
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (
      user.email_change_token !== token ||
      !user.pending_email ||
      user.pending_email !== decoded.newEmail ||
      !user.email_change_expires_at ||
      new Date(user.email_change_expires_at) <= new Date()
    ) {
      return res.status(400).json({ error: "This email change request is invalid or expired" });
    }

    const duplicateEmail = await pool.query(
      `
      SELECT id
      FROM users
      WHERE LOWER(email) = LOWER($1)
        AND id <> $2
      LIMIT 1
      `,
      [user.pending_email, user.id]
    );

    if (duplicateEmail.rows.length > 0) {
      return res.status(400).json({ error: "That email is already in use" });
    }

    const updateResult = await pool.query(
      `
      UPDATE users
      SET email = pending_email,
          pending_email = NULL,
          email_change_token = NULL,
          email_change_expires_at = NULL
      WHERE id = $1
      RETURNING id, username, email, pending_email, profile_pic, birth_date, email_verified, interests, interests_completed, created_at
      `,
      [user.id]
    );

    await pool.query(
      `
      UPDATE newsletter_subscriptions
      SET email = $2
      WHERE user_id = $1
      `,
      [user.id, updateResult.rows[0].email]
    ).catch(() => null);

    res.json({
      user: sanitizeUser(updateResult.rows[0]),
      message: "Email updated successfully",
    });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return res.status(400).json({ error: "This confirmation link is invalid or expired" });
    }

    console.error(error);
    res.status(500).json({ error: "Failed to confirm email change" });
  }
});

router.post("/change-password", authenticateTokenAllowUnverified, async (req, res) => {
  const { approvalToken, newPassword } = req.body || {};

  try {
    verifyAccountChangeToken(approvalToken, req.user.id, "password-change");
  } catch (error) {
    return res.status(403).json({ error: "Password confirmation expired. Please verify again." });
  }

  const validationError = getPasswordValidationMessage(newPassword);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  try {
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await pool.query(
      `
      UPDATE users
      SET password = $2
      WHERE id = $1
      `,
      [req.user.id, passwordHash]
    );

    res.json({ message: "Password updated successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update password" });
  }
});

router.post("/cancel-email-change", authenticateTokenAllowUnverified, async (req, res) => {
  try {
    await ensureAccountChangeSchema();

    const result = await pool.query(
      `
      UPDATE users
      SET pending_email = NULL,
          email_change_token = NULL,
          email_change_expires_at = NULL
      WHERE id = $1
      RETURNING id, username, email, pending_email, profile_pic, birth_date, email_verified, interests, interests_completed, created_at
      `,
      [req.user.id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      user: sanitizeUser(result.rows[0]),
      message: "Pending email change cancelled",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to cancel email change" });
  }
});

export default router;
