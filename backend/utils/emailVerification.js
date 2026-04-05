import nodemailer from "nodemailer";
import pool from "../db.js";

const VERIFICATION_WINDOW_HOURS = 24;

let cachedTransporter = null;
let cachedTransporterPromise = null;

export const ensureEmailVerificationSchema = async () => {
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verification_code TEXT
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ
  `);
};

export const ensurePasswordResetSchema = async () => {
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_reset_code TEXT
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ
  `);
};

export const generateVerificationCode = () =>
  String(Math.floor(100000 + Math.random() * 900000));

const createTransporter = () => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    throw new Error("Email service is not configured");
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: SMTP_SECURE === "true" || Number(SMTP_PORT) === 465,
    requireTLS: Number(SMTP_PORT) === 587,
    pool: true,
    maxConnections: 3,
    maxMessages: 50,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
};

const getTransporter = async () => {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  if (!cachedTransporterPromise) {
    cachedTransporterPromise = (async () => {
      const transporter = createTransporter();

      try {
        await transporter.verify();
      } catch (error) {
        transporter.close();
        throw error;
      }

      cachedTransporter = transporter;
      return transporter;
    })().catch((error) => {
      cachedTransporterPromise = null;
      cachedTransporter = null;
      throw error;
    });
  }

  return cachedTransporterPromise;
};

const sendMailWithTimeout = async (mailOptions) => {
  const transporter = await getTransporter();

  try {
    await Promise.race([
      transporter.sendMail(mailOptions),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Email service timed out")), 20000);
      }),
    ]);
  } catch (error) {
    cachedTransporterPromise = null;
    cachedTransporter = null;
    transporter.close();
    throw error;
  }
};

export const sendVerificationEmail = async ({ to, username, code }) => {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!from) {
    throw new Error("Email sender is not configured");
  }

  await sendMailWithTimeout({
    from,
    to,
    subject: "Verify your Fruityger account",
    text: [
      `Hi ${username || "there"},`,
      "",
      "Welcome to Fruityger.",
      `Your verification code is: ${code}`,
      "",
      `This code expires in ${VERIFICATION_WINDOW_HOURS} hours.`,
      "",
      "If you did not create this account, you can ignore this email.",
    ].join("\n"),
    html: `
      <div style="font-family:Segoe UI,sans-serif;background:#f3fcff;padding:24px;color:#13566f">
        <div style="max-width:520px;margin:0 auto;background:rgba(255,255,255,0.96);border-radius:24px;padding:28px;border:1px solid rgba(255,255,255,0.9);box-shadow:0 18px 40px rgba(0,160,220,0.12)">
          <h2 style="margin:0 0 12px;color:#0f84ab">Verify your Fruityger account</h2>
          <p style="margin:0 0 18px;line-height:1.6">Hi ${username || "there"}, use this 6-digit code to finish verifying your email address.</p>
          <div style="margin:22px 0;padding:16px 18px;border-radius:18px;background:linear-gradient(160deg,#e8fbff,#c8f3ff);font-size:30px;font-weight:700;letter-spacing:10px;text-align:center;color:#0a6d90">
            ${code}
          </div>
          <p style="margin:0;line-height:1.6">This code expires in ${VERIFICATION_WINDOW_HOURS} hours.</p>
        </div>
      </div>
    `,
  });
};

export const sendEmailChangeConfirmationEmail = async ({
  to,
  username,
  confirmUrl,
}) => {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!from) {
    throw new Error("Email sender is not configured");
  }

  await sendMailWithTimeout({
    from,
    to,
    subject: "Confirm your new Fruityger email",
    text: [
      `Hi ${username || "there"},`,
      "",
      "We received a request to change the email on your Fruityger account.",
      "Click the link below to confirm your new email address:",
      confirmUrl,
      "",
      `This link expires in ${VERIFICATION_WINDOW_HOURS} hours.`,
      "",
      "If you did not request this change, you can ignore this email.",
    ].join("\n"),
    html: `
      <div style="font-family:Segoe UI,sans-serif;background:#f3fcff;padding:24px;color:#13566f">
        <div style="max-width:520px;margin:0 auto;background:rgba(255,255,255,0.96);border-radius:24px;padding:28px;border:1px solid rgba(255,255,255,0.9);box-shadow:0 18px 40px rgba(0,160,220,0.12)">
          <h2 style="margin:0 0 12px;color:#0f84ab">Confirm your new Fruityger email</h2>
          <p style="margin:0 0 18px;line-height:1.6">Hi ${username || "there"}, click the button below to finish changing the email on your account.</p>
          <div style="margin:24px 0;text-align:center">
            <a href="${confirmUrl}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:linear-gradient(145deg,#00e0ff,#00bfff,#4facfe);color:#ffffff;text-decoration:none;font-weight:700;box-shadow:0 10px 22px rgba(0,160,220,0.24)">
              Confirm new email
            </a>
          </div>
          <p style="margin:0;line-height:1.6">This link expires in ${VERIFICATION_WINDOW_HOURS} hours.</p>
        </div>
      </div>
    `,
  });
};

export const sendPasswordResetEmail = async ({
  to,
  username,
  code,
}) => {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!from) {
    throw new Error("Email sender is not configured");
  }

  await sendMailWithTimeout({
    from,
    to,
    subject: "Your Fruityger password reset code",
    text: [
      `Hi ${username || "there"},`,
      "",
      "We received a request to reset your Fruityger password.",
      `Your 6-digit reset code is: ${code}`,
      "",
      `This code expires in ${VERIFICATION_WINDOW_HOURS} hours.`,
      "",
      "If you did not request this reset, you can ignore this email.",
    ].join("\n"),
    html: `
      <div style="font-family:Segoe UI,sans-serif;background:#f3fcff;padding:24px;color:#13566f">
        <div style="max-width:520px;margin:0 auto;background:rgba(255,255,255,0.96);border-radius:24px;padding:28px;border:1px solid rgba(255,255,255,0.9);box-shadow:0 18px 40px rgba(0,160,220,0.12)">
          <h2 style="margin:0 0 12px;color:#0f84ab">Reset your Fruityger password</h2>
          <p style="margin:0 0 18px;line-height:1.6">Hi ${username || "there"}, use this 6-digit code to continue resetting your password.</p>
          <div style="margin:22px 0;padding:16px 18px;border-radius:18px;background:linear-gradient(160deg,#e8fbff,#c8f3ff);font-size:30px;font-weight:700;letter-spacing:10px;text-align:center;color:#0a6d90">
            ${code}
          </div>
          <p style="margin:0;line-height:1.6">This code expires in ${VERIFICATION_WINDOW_HOURS} hours.</p>
        </div>
      </div>
    `,
  });
};

const deleteUserCompletely = async (client, userId) => {
  const postIdsResult = await client.query(
    `SELECT post_id FROM posts WHERE user_id = $1`,
    [userId]
  );
  const commentIdsResult = await client.query(
    `SELECT comment_id FROM comments WHERE user_id = $1`,
    [userId]
  );
  const messageIdsResult = await client.query(
    `
    SELECT id
    FROM messages
    WHERE sender_id = $1
       OR receiver_id = $1
       OR chat_id IN (
         SELECT id
         FROM chats
         WHERE user1_id = $1 OR user2_id = $1
       )
    `,
    [userId]
  );
  const chatIdsResult = await client.query(
    `SELECT id FROM chats WHERE user1_id = $1 OR user2_id = $1`,
    [userId]
  );

  const postIds = postIdsResult.rows.map((row) => row.post_id);
  const commentIds = commentIdsResult.rows.map((row) => row.comment_id);
  const messageIds = messageIdsResult.rows.map((row) => row.id);
  const chatIds = chatIdsResult.rows.map((row) => row.id);

  if (messageIds.length > 0) {
    await client.query(
      `DELETE FROM deleted_messages WHERE message_id = ANY($1::uuid[])`,
      [messageIds]
    );
  }

  if (chatIds.length > 0) {
    await client.query(
      `DELETE FROM deleted_chats WHERE chat_id = ANY($1::uuid[])`,
      [chatIds]
    );
  }

  await client.query(
    `
    DELETE FROM reports
    WHERE reporter_id = $1
       OR (content_type = 'user' AND content_id = $1)
       OR (
         array_length($2::uuid[], 1) IS NOT NULL
         AND content_type = 'post'
         AND content_id = ANY($2::uuid[])
       )
       OR (
         array_length($3::uuid[], 1) IS NOT NULL
         AND content_type = 'comment'
         AND content_id = ANY($3::uuid[])
       )
       OR (
         array_length($4::uuid[], 1) IS NOT NULL
         AND content_type = 'message'
         AND content_id = ANY($4::uuid[])
       )
    `,
    [userId, postIds, commentIds, messageIds]
  );

  await client.query(
    `DELETE FROM messages WHERE sender_id = $1 OR receiver_id = $1`,
    [userId]
  );
  await client.query(
    `DELETE FROM chats WHERE user1_id = $1 OR user2_id = $1`,
    [userId]
  );
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
};

export const cleanupExpiredUnverifiedUsers = async () => {
  await ensureEmailVerificationSchema();

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
      SELECT id
      FROM users
      WHERE email_verified = FALSE
        AND (
          email_verification_expires_at IS NOT NULL
          AND email_verification_expires_at <= NOW()
        )
      `
    );

    for (const row of rows) {
      await deleteUserCompletely(client, row.id);
    }

    await client.query("COMMIT");
    return rows.length;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

export const getVerificationExpiry = () => {
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + VERIFICATION_WINDOW_HOURS);
  return expiry;
};
