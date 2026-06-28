import express from "express";
import pool from "../db.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import axios from "axios";
import { authenticateTokenAllowUnverified } from "../middleware/auth.js";
import {
  cleanupExpiredUnverifiedUsers,
  ensureEmailVerificationSchema,
  ensurePasswordResetSchema,
  getFriendlyEmailErrorMessage,
} from "../utils/emailVerification.js";
import { ensureUserOnboardingSchema } from "../utils/userOnboarding.js";
import { deleteR2Object } from "../utils/r2Delete.js";
import {
  ensurePasskeySchema,
  getAssertionOptions,
  getRegistrationOptions,
  sanitizePasskey,
  verifyAssertion,
  verifyRegistration,
} from "../utils/webauthn.js";

const router = express.Router();
const SALT_ROUNDS = 10;
const ACCOUNT_CHANGE_TOKEN_MINUTES = 15;
const ACCOUNT_DELETION_RECOVERY_DAYS = 30;
const normalizeBaseUrl = (value = "") => String(value).trim().replace(/\/+$/, "");

const getMobileAppBaseUrl = () =>
  normalizeBaseUrl(
    process.env.MOBILE_APP_URL ||
      process.env.APP_DEEP_LINK_URL ||
      process.env.REACT_NATIVE_APP_URL ||
      ""
  );

const isMobileClientRequest = (req) => {
  const explicitClient =
    req?.get?.("x-fruityger-client") ||
    req?.get?.("x-client-platform") ||
    req?.body?.client ||
    req?.body?.platform ||
    "";

  if (/mobile|native|react-native|ios|android/i.test(String(explicitClient))) {
    return true;
  }

  const userAgent = String(req?.get?.("user-agent") || "");
  const hasBrowserOrigin = Boolean(req?.get?.("origin"));

  return /reactnative|expo|okhttp/i.test(userAgent) && !hasBrowserOrigin;
};

const getFrontendBaseUrl = (req) => {
  const mobileAppUrl = getMobileAppBaseUrl();
  if (mobileAppUrl && isMobileClientRequest(req)) {
    return mobileAppUrl;
  }

  const configuredUrl = normalizeBaseUrl(
    process.env.FRONTEND_URL || process.env.ALLOWED_ORIGINS?.split(",")[0] || ""
  );

  if (configuredUrl && !/localhost|127\.0\.0\.1/i.test(configuredUrl)) {
    return configuredUrl;
  }

  const requestOrigin = normalizeBaseUrl(req?.get?.("origin") || "");
  if (requestOrigin) {
    return requestOrigin;
  }

  const referer = normalizeBaseUrl(req?.get?.("referer") || "");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return referer;
    }
  }

  if (configuredUrl) {
    return configuredUrl;
  }

  return "http://localhost:5173";
};

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

const ensureAccountStatusSchema = async () => {
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS deletion_recovery_expires_at TIMESTAMPTZ
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS admin_banned_at TIMESTAMPTZ
  `);
};

const ensureUserCreatedAtSchema = async () => {
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ
  `);

  await pool.query(`
    ALTER TABLE users
    ALTER COLUMN created_at SET DEFAULT NOW()
  `);

  await pool.query(`
    UPDATE users
    SET created_at = NOW()
    WHERE created_at IS NULL
  `);
};

const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;

const cleanupUserDependencies = async (client, userId) => {
  const { rows } = await client.query(
    `
    SELECT DISTINCT
      ns.nspname AS schema_name,
      cls.relname AS table_name,
      att.attname AS column_name,
      con.confdeltype
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    JOIN unnest(con.conkey) WITH ORDINALITY AS cols(attnum, ordinality) ON TRUE
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = cols.attnum
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.users'::regclass
      AND cardinality(con.conkey) = 1
      AND ns.nspname = 'public'
      AND cls.relname <> 'users'
      AND con.confdeltype IN ('a', 'r')
    `
  );

  for (const dependency of rows) {
    const tableName = `${quoteIdentifier(dependency.schema_name)}.${quoteIdentifier(
      dependency.table_name
    )}`;
    const columnName = quoteIdentifier(dependency.column_name);

    await client.query(`DELETE FROM ${tableName} WHERE ${columnName} = $1`, [userId]);
  }
};

const getDeletionRecoveryExpiry = () => {
  const value = new Date();
  value.setDate(value.getDate() + ACCOUNT_DELETION_RECOVERY_DAYS);
  return value;
};

const reactivateUserAccount = async (userId) => {
  const { rows } = await pool.query(
    `
    UPDATE users
    SET deactivated_at = NULL,
        deleted_at = NULL,
        deletion_recovery_expires_at = NULL
    WHERE id = $1
      AND admin_banned_at IS NULL
    RETURNING id, username, email, pending_email, profile_pic, birth_date, email_verified, interests, interests_completed, created_at
    `,
    [userId]
  );

  return rows[0] || null;
};

const cleanupExpiredDeletedUsers = async () => {
  await ensureAccountStatusSchema();

  const client = await pool.connect();

  try {
    const { rows } = await client.query(
      `
      SELECT id, profile_pic_key
      FROM users
      WHERE deleted_at IS NOT NULL
        AND deletion_recovery_expires_at IS NOT NULL
        AND deletion_recovery_expires_at <= NOW()
      `
    );

    for (const row of rows) {
      await client.query("BEGIN");
      try {
        await cleanupUserDependencies(client, row.id);
        await client.query(`DELETE FROM users WHERE id = $1`, [row.id]);
        await client.query("COMMIT");

        if (row.profile_pic_key) {
          await deleteR2Object(row.profile_pic_key).catch(() => null);
        }
      } catch (error) {
        await client.query("ROLLBACK").catch(() => null);
        throw error;
      }
    }
  } finally {
    client.release();
  }
};

const maskEmail = (email = "") => {
  const normalized = String(email).trim().toLowerCase();
  const [localPart, domainPart] = normalized.split("@");

  if (!localPart || !domainPart) {
    return normalized;
  }

  const domainSections = domainPart.split(".");
  const domainName = domainSections.shift() || "";
  const domainSuffix = domainSections.length ? `.${domainSections.join(".")}` : "";

  const maskedLocal =
    localPart.length <= 2
      ? `${localPart[0] || ""}*`
      : `${localPart.slice(0, 2)}${"*".repeat(Math.max(localPart.length - 2, 2))}`;

  const maskedDomain =
    domainName.length <= 1
      ? domainName
      : `${domainName[0]}${"*".repeat(Math.max(domainName.length - 1, 2))}`;

  return `${maskedLocal}@${maskedDomain}${domainSuffix}`;
};

const verifyTurnstile = async (challengeToken, remoteIp) => {
  if (!challengeToken) {
    return false;
  }

  const secret =
    process.env.TURNSTILE_SECRET_KEY ||
    process.env.TURNSTILE_SECRET ||
    process.env.RECAPTCHA_SECRET;

  if (!secret) {
    throw new Error("Missing Turnstile secret");
  }

  const payload = new URLSearchParams({
    secret,
    response: challengeToken,
  });

  if (remoteIp) {
    payload.set("remoteip", remoteIp);
  }

  const response = await axios.post(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    payload.toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
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
  const {
    username,
    email,
    password,
    birthDate,
    turnstileToken,
    recaptchaToken,
    profile_pic,
  } = req.body;
  const challengeToken = turnstileToken || recaptchaToken;

  await ensureEmailVerificationSchema();
  await ensureUserOnboardingSchema();
  await ensureAccountChangeSchema();
  await ensureAccountStatusSchema();
  await ensureUserCreatedAtSchema();
  await cleanupExpiredUnverifiedUsers();
  await cleanupExpiredDeletedUsers();

  const normalizedUsername = normalizeUsername(username);
  const usernameValidationMessage = getUsernameValidationMessage(normalizedUsername);
  if (usernameValidationMessage) {
    return res.status(400).json({ error: usernameValidationMessage });
  }

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
    const isHuman = await verifyTurnstile(challengeToken, req.ip);
    if (!isHuman) {
      return res.status(400).json({ error: "Turnstile verification failed" });
    }
  } catch (err) {
    return res.status(500).json({ error: "Turnstile request failed" });
  }

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
        created_at,
        email_verified,
        interests,
        interests_completed
      )
      VALUES ($1, $2, $3, $4, $5, NOW(), TRUE, '[]'::jsonb, FALSE)
      RETURNING id, username, email, profile_pic, birth_date, email_verified, interests, interests_completed, created_at
      `,
      [normalizedUsername, email, password_hash, profile_pic || null, birthDate]
    );

    const user = result.rows[0];

    const token = signToken(user.id);
    res.json({
      user: sanitizeUser(user),
      token,
      requiresVerification: false,
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
  const { email, password, turnstileToken, recaptchaToken } = req.body;
  const identifier = String(email || "").trim();
  const normalizedIdentifier = identifier.toLowerCase();
  const challengeToken = turnstileToken || recaptchaToken;

  await ensureEmailVerificationSchema();
  await ensureUserOnboardingSchema();
  await ensureAccountChangeSchema();
  await ensureAccountStatusSchema();
  await ensureUserCreatedAtSchema();
  await cleanupExpiredUnverifiedUsers();
  await cleanupExpiredDeletedUsers();

  try {
    const isHuman = await verifyTurnstile(challengeToken, req.ip);
    if (!isHuman) {
      return res.status(400).json({ error: "Turnstile verification failed" });
    }
  } catch (err) {
    return res.status(500).json({ error: "Turnstile request failed" });
  }

  try {
    const result = await pool.query(
      `
      SELECT *
      FROM users
      WHERE LOWER(email) = $1
         OR LOWER(username) = $1
      LIMIT 1
      `,
      [normalizedIdentifier]
    );
    const user = result.rows[0];

    if (!user) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    let sessionUser = user;

    if (
      user.deleted_at &&
      user.deletion_recovery_expires_at &&
      new Date(user.deletion_recovery_expires_at) > new Date()
    ) {
      const restoredUser = await reactivateUserAccount(user.id);
      if (!restoredUser) {
        return res.status(404).json({ error: "Account not found" });
      }
      sessionUser = restoredUser;
    } else if (user.deleted_at) {
      return res.status(403).json({ error: "This account can no longer be recovered" });
    } else if (user.admin_banned_at) {
      return res.status(403).json({
        error: "This account has been banned for violating community rules.",
      });
    } else if (user.deactivated_at) {
      const reactivatedUser = await reactivateUserAccount(user.id);
      if (!reactivatedUser) {
        return res.status(403).json({
          error: "This account has been banned for violating community rules.",
        });
      }
      sessionUser = reactivatedUser;
    }

    const token = signToken(sessionUser.id);

    res.json({
      user: sanitizeUser(sessionUser),
      token,
      requiresVerification: false,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/login/passkey/options", async (req, res) => {
  const { identifier } = req.body || {};
  const normalizedIdentifier = String(identifier || "").trim().toLowerCase();

  await ensureEmailVerificationSchema();
  await ensureUserOnboardingSchema();
  await ensureAccountChangeSchema();
  await ensureAccountStatusSchema();
  await ensureUserCreatedAtSchema();
  await ensurePasskeySchema();
  await cleanupExpiredUnverifiedUsers();
  await cleanupExpiredDeletedUsers();

  if (!normalizedIdentifier) {
    return res.status(400).json({ error: "Enter your email or username first" });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT *
      FROM users
      WHERE LOWER(email) = $1
         OR LOWER(username) = $1
      LIMIT 1
      `,
      [normalizedIdentifier]
    );

    const user = rows[0];
    if (!user) {
      return res.status(404).json({ error: "Account not found" });
    }

    if (user.deleted_at && (!user.deletion_recovery_expires_at || new Date(user.deletion_recovery_expires_at) <= new Date())) {
      return res.status(403).json({ error: "This account can no longer be recovered" });
    }

    if (user.admin_banned_at) {
      return res.status(403).json({
        error: "This account has been banned for violating community rules.",
      });
    }

    const options = await getAssertionOptions({
      req,
      userId: user.id,
      purpose: "passkey-login",
    });

    res.json({
      userId: user.id,
      options,
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || "Couldn't start passkey login" });
  }
});

router.post("/login/passkey/verify", async (req, res) => {
  const { userId, credential } = req.body || {};

  await ensureEmailVerificationSchema();
  await ensureUserOnboardingSchema();
  await ensureAccountChangeSchema();
  await ensureAccountStatusSchema();
  await ensureUserCreatedAtSchema();
  await ensurePasskeySchema();
  await cleanupExpiredUnverifiedUsers();
  await cleanupExpiredDeletedUsers();

  if (!userId || !credential) {
    return res.status(400).json({ error: "Passkey response is required" });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT *
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [userId]
    );

    const user = rows[0];
    if (!user) {
      return res.status(404).json({ error: "Account not found" });
    }

    await verifyAssertion({
      req,
      userId: user.id,
      purpose: "passkey-login",
      credential,
    });

    let sessionUser = user;

    if (
      user.deleted_at &&
      user.deletion_recovery_expires_at &&
      new Date(user.deletion_recovery_expires_at) > new Date()
    ) {
      const restoredUser = await reactivateUserAccount(user.id);
      if (!restoredUser) {
        return res.status(404).json({ error: "Account not found" });
      }
      sessionUser = restoredUser;
    } else if (user.deleted_at) {
      return res.status(403).json({ error: "This account can no longer be recovered" });
    } else if (user.admin_banned_at) {
      return res.status(403).json({
        error: "This account has been banned for violating community rules.",
      });
    } else if (user.deactivated_at) {
      const reactivatedUser = await reactivateUserAccount(user.id);
      if (!reactivatedUser) {
        return res.status(403).json({
          error: "This account has been banned for violating community rules.",
        });
      }
      sessionUser = reactivatedUser;
    }

    res.json({
      user: sanitizeUser(sessionUser),
      token: signToken(sessionUser.id),
      requiresVerification: false,
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || "Passkey login failed" });
  }
});

router.post("/forgot-password/search", async (req, res) => {
  const { query } = req.body || {};
  const normalizedQuery = String(query || "").trim().toLowerCase();

  await ensureEmailVerificationSchema();
  await ensurePasswordResetSchema();
  await ensureAccountChangeSchema();
  await ensureAccountStatusSchema();
  await ensurePasskeySchema();
  await cleanupExpiredUnverifiedUsers();
  await cleanupExpiredDeletedUsers();

  if (normalizedQuery.length < 2) {
    return res.json({ accounts: [] });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT
        users.id,
        users.username,
        users.email,
        users.profile_pic,
        EXISTS (
          SELECT 1
          FROM user_passkeys
          WHERE user_passkeys.user_id = users.id
        ) AS has_passkey
      FROM users
      WHERE email_verified = TRUE
        AND pending_email IS NULL
        AND deactivated_at IS NULL
        AND deleted_at IS NULL
        AND (
          LOWER(username) LIKE $1
          OR LOWER(email) LIKE $1
        )
      ORDER BY
        CASE
          WHEN LOWER(username) = $2 THEN 0
          WHEN LOWER(email) = $2 THEN 1
          WHEN LOWER(username) LIKE $3 THEN 2
          ELSE 3
        END,
        username ASC
      LIMIT 8
      `,
      [`%${normalizedQuery}%`, normalizedQuery, `${normalizedQuery}%`]
    );

    res.json({
      accounts: rows.map((row) => ({
        id: row.id,
        username: row.username,
        profile_pic: row.profile_pic,
        masked_email: maskEmail(row.email),
        has_passkey: Boolean(row.has_passkey),
      })),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to search accounts" });
  }
});

router.post("/forgot-password/send-code", async (req, res) => {
  return res.status(410).json({
    error: "Email reset codes are no longer supported. Use your passkey to reset your password.",
  });
});

router.post("/forgot-password/passkey/options", async (req, res) => {
  const { userId } = req.body || {};

  await ensureEmailVerificationSchema();
  await ensurePasswordResetSchema();
  await ensureAccountChangeSchema();
  await ensureAccountStatusSchema();
  await ensurePasskeySchema();
  await cleanupExpiredUnverifiedUsers();
  await cleanupExpiredDeletedUsers();

  if (!userId) {
    return res.status(400).json({ error: "User is required" });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT id, username, email, pending_email, email_verified, deactivated_at, deleted_at
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [userId]
    );

    const user = rows[0];
    if (!user || !user.email_verified || user.pending_email || user.deactivated_at || user.deleted_at) {
      return res.status(404).json({ error: "Account not found" });
    }

    const options = await getAssertionOptions({
      req,
      userId: user.id,
      purpose: "forgot-password",
    });

    res.json({
      options,
      account: {
        id: user.id,
        username: user.username,
        masked_email: maskEmail(user.email),
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ error: err.message || "Couldn't start passkey reset." });
  }
});

router.post("/forgot-password/verify-code", async (req, res) => {
  return res.status(410).json({
    error: "Email reset codes are no longer supported. Use your passkey to reset your password.",
  });
});

router.post("/forgot-password/passkey/verify", async (req, res) => {
  const { userId, credential } = req.body || {};

  await ensureEmailVerificationSchema();
  await ensurePasswordResetSchema();
  await ensureAccountChangeSchema();
  await ensureAccountStatusSchema();
  await ensurePasskeySchema();
  await cleanupExpiredUnverifiedUsers();
  await cleanupExpiredDeletedUsers();

  if (!userId || !credential) {
    return res.status(400).json({ error: "Passkey response is required" });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT id, email_verified, pending_email, deactivated_at, deleted_at
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [userId]
    );

    const user = rows[0];
    if (!user || !user.email_verified || user.pending_email || user.deactivated_at || user.deleted_at) {
      return res.status(404).json({ error: "Account not found" });
    }

    await verifyAssertion({
      req,
      userId: user.id,
      purpose: "forgot-password",
      credential,
    });

    res.json({
      resetToken: signAccountChangeToken(user.id, "forgot-password"),
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || "Passkey verification failed" });
  }
});

router.post("/forgot-password/change-password", async (req, res) => {
  const { resetToken, newPassword } = req.body || {};

  const validationError = getPasswordValidationMessage(newPassword);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  try {
    const decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    if (decoded.purpose !== "forgot-password") {
      return res.status(403).json({ error: "Reset session expired. Please start again." });
    }

    await ensurePasswordResetSchema();
    await ensureAccountStatusSchema();

    const { rows } = await pool.query(
      `
      SELECT id, deactivated_at, deleted_at
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [decoded.id]
    );

    if (!rows[0] || rows[0].deactivated_at || rows[0].deleted_at) {
      return res.status(404).json({ error: "Account not found" });
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await pool.query(
      `
      UPDATE users
      SET password = $2,
          password_reset_code = NULL,
          password_reset_expires_at = NULL
      WHERE id = $1
      `,
      [decoded.id, passwordHash]
    );

    res.json({ message: "Password updated successfully" });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return res.status(403).json({ error: "Reset session expired. Please start again." });
    }

    console.error(error);
    res.status(500).json({ error: "Failed to update password" });
  }
});

router.get("/session", authenticateTokenAllowUnverified, async (req, res) => {
  await ensureEmailVerificationSchema();
  await ensureUserOnboardingSchema();
  await ensureAccountChangeSchema();
  await ensureAccountStatusSchema();
  await cleanupExpiredUnverifiedUsers();
  await cleanupExpiredDeletedUsers();

  const { rows } = await pool.query(
    `
    SELECT id, username, email, pending_email, profile_pic, birth_date, email_verified, interests, interests_completed, email_verification_expires_at, created_at, deactivated_at, deleted_at, admin_banned_at
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

  if (user.admin_banned_at) {
    return res.status(403).json({ error: "This account has been banned for violating community rules." });
  }

  if (user.deactivated_at || user.deleted_at) {
    return res.status(403).json({ error: "Account unavailable" });
  }

  res.json({
    user: sanitizeUser(user),
    requiresVerification: false,
    verificationExpiresAt: null,
  });
});

router.get("/passkeys", authenticateTokenAllowUnverified, async (req, res) => {
  try {
    await ensurePasskeySchema();

    const { rows } = await pool.query(
      `
      SELECT id, name, transports, created_at, last_used_at
      FROM user_passkeys
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [req.user.id]
    );

    res.json({
      passkeys: rows.map(sanitizePasskey),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to load passkeys" });
  }
});

router.post("/passkeys/register/options", authenticateTokenAllowUnverified, async (req, res) => {
  try {
    await ensurePasskeySchema();

    const options = await getRegistrationOptions({
      req,
      user: {
        id: req.user.id,
        username: req.user.username,
        email: req.user.email,
      },
    });

    res.json({ options });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to start passkey setup" });
  }
});

router.post("/passkeys/register/verify", authenticateTokenAllowUnverified, async (req, res) => {
  const { credential, name } = req.body || {};

  if (!credential) {
    return res.status(400).json({ error: "Passkey response is required" });
  }

  try {
    await ensurePasskeySchema();

    const passkey = await verifyRegistration({
      req,
      userId: req.user.id,
      credential,
      name,
    });

    res.json({
      passkey: sanitizePasskey(passkey),
      message: "Passkey added successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || "Failed to add passkey" });
  }
});

router.delete("/passkeys/:passkeyId", authenticateTokenAllowUnverified, async (req, res) => {
  try {
    await ensurePasskeySchema();

    const { rows } = await pool.query(
      `
      DELETE FROM user_passkeys
      WHERE id = $1
        AND user_id = $2
      RETURNING id
      `,
      [req.params.passkeyId, req.user.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: "Passkey not found" });
    }

    res.json({ message: "Passkey removed" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to remove passkey" });
  }
});

router.post("/verify-email", authenticateTokenAllowUnverified, async (req, res) => {
  await ensureEmailVerificationSchema();
  await ensureUserOnboardingSchema();
  await ensureAccountChangeSchema();
  await ensureAccountStatusSchema();
  await cleanupExpiredDeletedUsers();

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

  const user = updateResult.rows[0];
  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  res.json({
    user: sanitizeUser(user),
    verified: true,
  });
});

router.post("/resend-verification", authenticateTokenAllowUnverified, async (req, res) => {
  await ensureEmailVerificationSchema();
  await ensureUserOnboardingSchema();
  await ensureAccountChangeSchema();
  await ensureAccountStatusSchema();
  await cleanupExpiredDeletedUsers();

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

  const user = updateResult.rows[0];
  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  res.json({
    user: sanitizeUser(user),
    message: "Email verification is no longer required",
  });
});

router.post("/verify-current-password", authenticateTokenAllowUnverified, async (req, res) => {
  const { currentPassword, purpose } = req.body || {};

  if (!currentPassword) {
    return res.status(400).json({ error: "Current password is required" });
  }

  if (
    ![
      "email-change",
      "password-change",
      "account-deactivate",
      "account-delete",
    ].includes(purpose)
  ) {
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

    const updateResult = await pool.query(
      `
      UPDATE users
      SET email = $2,
          pending_email = NULL,
          email_change_token = NULL,
          email_change_expires_at = NULL,
          email_verified = TRUE,
          email_verification_code = NULL,
          email_verification_expires_at = NULL
      WHERE id = $1
      RETURNING id, username, email, pending_email, profile_pic, birth_date, email_verified, interests, interests_completed, created_at
      `,
      [req.user.id, normalizedEmail]
    );

    await pool.query(
      `
      UPDATE newsletter_subscriptions
      SET email = $2
      WHERE user_id = $1
      `,
      [req.user.id, updateResult.rows[0].email]
    ).catch(() => null);

    res.json({
      user: sanitizeUser(updateResult.rows[0]),
      message: "Email updated successfully",
    });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError || error.message === "Missing verification token" || error.message === "Invalid verification token") {
      return res.status(403).json({ error: "Password confirmation expired. Please verify again." });
    }

    console.error(error);
    res.status(500).json({
      error: getFriendlyEmailErrorMessage(error),
    });
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

router.post("/deactivate-account", authenticateTokenAllowUnverified, async (req, res) => {
  const { approvalToken } = req.body || {};

  try {
    await ensureAccountStatusSchema();
    await ensureAccountChangeSchema();
    await ensurePasswordResetSchema();
    await cleanupExpiredDeletedUsers();
    verifyAccountChangeToken(approvalToken, req.user.id, "account-deactivate");

    const result = await pool.query(
      `
      UPDATE users
      SET deactivated_at = NOW(),
          pending_email = NULL,
          email_change_token = NULL,
          email_change_expires_at = NULL,
          password_reset_code = NULL,
          password_reset_expires_at = NULL
      WHERE id = $1
        AND deleted_at IS NULL
      RETURNING id
      `,
      [req.user.id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: "Account not found" });
    }

    await pool
      .query(`DELETE FROM newsletter_subscriptions WHERE user_id = $1`, [req.user.id])
      .catch(() => null);
    await pool
      .query(`DELETE FROM push_notification_subscriptions WHERE user_id = $1`, [req.user.id])
      .catch(() => null);
    await pool.query(`DELETE FROM active_users WHERE user_id = $1`, [req.user.id]).catch(() => null);

    res.json({ message: "Account deactivated. Log in again anytime to reactivate it." });
  } catch (error) {
    if (
      error instanceof jwt.JsonWebTokenError ||
      error instanceof jwt.TokenExpiredError ||
      error.message === "Missing verification token" ||
      error.message === "Invalid verification token"
    ) {
      return res
        .status(403)
        .json({ error: "Password confirmation expired. Please verify again." });
    }

    console.error(error);
    res.status(500).json({ error: "Failed to deactivate account" });
  }
});

router.delete("/delete-account", authenticateTokenAllowUnverified, async (req, res) => {
  const { approvalToken } = req.body || {};

  try {
    await ensureAccountStatusSchema();
    await ensureAccountChangeSchema();
    await ensurePasswordResetSchema();
    await cleanupExpiredDeletedUsers();
    verifyAccountChangeToken(approvalToken, req.user.id, "account-delete");

    const result = await pool.query(
      `
      UPDATE users
      SET deleted_at = NOW(),
          deletion_recovery_expires_at = $2,
          deactivated_at = NOW(),
          pending_email = NULL,
          email_change_token = NULL,
          email_change_expires_at = NULL,
          password_reset_code = NULL,
          password_reset_expires_at = NULL
      WHERE id = $1
        AND deleted_at IS NULL
      RETURNING id
      `,
      [req.user.id, getDeletionRecoveryExpiry()]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: "Account not found" });
    }

    await pool
      .query(`DELETE FROM newsletter_subscriptions WHERE user_id = $1`, [req.user.id])
      .catch(() => null);
    await pool
      .query(`DELETE FROM push_notification_subscriptions WHERE user_id = $1`, [req.user.id])
      .catch(() => null);
    await pool.query(`DELETE FROM active_users WHERE user_id = $1`, [req.user.id]).catch(() => null);

    res.json({ message: "Account deleted. You can recover it by logging in again within 30 days." });
  } catch (error) {

    if (
      error instanceof jwt.JsonWebTokenError ||
      error instanceof jwt.TokenExpiredError ||
      error.message === "Missing verification token" ||
      error.message === "Invalid verification token"
    ) {
      return res
        .status(403)
        .json({ error: "Password confirmation expired. Please verify again." });
    }

    console.error(error);
    res.status(500).json({ error: "Failed to delete account" });
  }
});

export default router;
