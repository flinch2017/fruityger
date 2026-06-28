import crypto from "crypto";
import pool from "../db.js";

const CHALLENGE_TTL_MINUTES = 10;

const toBase64Url = (value) =>
  Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const fromBase64Url = (value = "") => {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64");
};

const readLength = (buffer, offset, additionalInfo) => {
  if (additionalInfo < 24) return { length: additionalInfo, offset };
  if (additionalInfo === 24) return { length: buffer[offset], offset: offset + 1 };
  if (additionalInfo === 25) return { length: buffer.readUInt16BE(offset), offset: offset + 2 };
  if (additionalInfo === 26) return { length: buffer.readUInt32BE(offset), offset: offset + 4 };
  throw new Error("Unsupported CBOR length");
};

const decodeCborItem = (buffer, offset = 0) => {
  const initial = buffer[offset++];
  const majorType = initial >> 5;
  const additionalInfo = initial & 0x1f;

  if (majorType === 0 || majorType === 1) {
    const read = readLength(buffer, offset, additionalInfo);
    const value = majorType === 0 ? read.length : -1 - read.length;
    return { value, offset: read.offset };
  }

  if (majorType === 2) {
    const read = readLength(buffer, offset, additionalInfo);
    return {
      value: buffer.subarray(read.offset, read.offset + read.length),
      offset: read.offset + read.length,
    };
  }

  if (majorType === 3) {
    const read = readLength(buffer, offset, additionalInfo);
    return {
      value: buffer.subarray(read.offset, read.offset + read.length).toString("utf8"),
      offset: read.offset + read.length,
    };
  }

  if (majorType === 4) {
    const read = readLength(buffer, offset, additionalInfo);
    const value = [];
    let nextOffset = read.offset;
    for (let index = 0; index < read.length; index += 1) {
      const decoded = decodeCborItem(buffer, nextOffset);
      value.push(decoded.value);
      nextOffset = decoded.offset;
    }
    return { value, offset: nextOffset };
  }

  if (majorType === 5) {
    const read = readLength(buffer, offset, additionalInfo);
    const value = new Map();
    let nextOffset = read.offset;
    for (let index = 0; index < read.length; index += 1) {
      const key = decodeCborItem(buffer, nextOffset);
      const decodedValue = decodeCborItem(buffer, key.offset);
      value.set(key.value, decodedValue.value);
      nextOffset = decodedValue.offset;
    }
    return { value, offset: nextOffset };
  }

  if (majorType === 6) {
    return decodeCborItem(buffer, readLength(buffer, offset, additionalInfo).offset);
  }

  if (majorType === 7) {
    if (additionalInfo === 20) return { value: false, offset };
    if (additionalInfo === 21) return { value: true, offset };
    if (additionalInfo === 22) return { value: null, offset };
  }

  throw new Error("Unsupported CBOR value");
};

const decodeCbor = (buffer) => decodeCborItem(buffer).value;

const mapToObject = (value) => {
  if (value instanceof Map) {
    const result = {};
    for (const [key, entry] of value.entries()) {
      result[key] = mapToObject(entry);
    }
    return result;
  }

  if (Array.isArray(value)) {
    return value.map(mapToObject);
  }

  if (Buffer.isBuffer(value)) {
    return value;
  }

  return value;
};

const decodeAttestationObject = (attestationObject) =>
  mapToObject(decodeCbor(fromBase64Url(attestationObject)));

const getRpId = (req) => {
  const origin = getExpectedOrigin(req);
  return new URL(origin).hostname;
};

const getExpectedOrigin = (req) => {
  const requestOrigin = String(req?.get?.("origin") || "").trim();
  if (requestOrigin) return requestOrigin;

  const configured = String(
    process.env.FRONTEND_URL || process.env.ALLOWED_ORIGINS?.split(",")[0] || "http://localhost:5173"
  ).trim();
  return configured.replace(/\/+$/, "");
};

const parseAuthenticatorData = (authData) => {
  if (authData.length < 37) {
    throw new Error("Invalid authenticator data");
  }

  return {
    rpIdHash: authData.subarray(0, 32),
    flags: authData[32],
    counter: authData.readUInt32BE(33),
    rest: authData.subarray(37),
  };
};

const getCredentialFromAuthData = (authData) => {
  const parsed = parseAuthenticatorData(authData);
  const credentialData = parsed.rest;
  const credentialIdLength = credentialData.readUInt16BE(16);
  const credentialId = credentialData.subarray(18, 18 + credentialIdLength);
  const publicKeyBytes = credentialData.subarray(18 + credentialIdLength);
  const coseKey = decodeCbor(publicKeyBytes);

  return {
    ...parsed,
    credentialId: toBase64Url(credentialId),
    publicKeyJwk: coseToJwk(coseKey),
  };
};

const coseToJwk = (coseKey) => {
  const kty = coseKey.get(1);
  const alg = coseKey.get(3);
  const crv = coseKey.get(-1);
  const x = coseKey.get(-2);
  const y = coseKey.get(-3);

  if (kty !== 2 || alg !== -7 || crv !== 1 || !Buffer.isBuffer(x) || !Buffer.isBuffer(y)) {
    throw new Error("Only ES256 passkeys are supported");
  }

  return {
    kty: "EC",
    crv: "P-256",
    x: toBase64Url(x),
    y: toBase64Url(y),
    ext: true,
  };
};

export const ensurePasskeySchema = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_passkeys (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT NOT NULL UNIQUE,
      public_key_jwk JSONB NOT NULL,
      counter BIGINT NOT NULL DEFAULT 0,
      name TEXT NOT NULL DEFAULT 'Passkey',
      transports JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS user_passkeys_user_id_idx
    ON user_passkeys(user_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS webauthn_challenges (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      challenge TEXT NOT NULL,
      purpose TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS webauthn_challenges_lookup_idx
    ON webauthn_challenges(user_id, purpose, challenge)
  `);
};

export const createChallenge = async (userId, purpose) => {
  await ensurePasskeySchema();

  const challenge = toBase64Url(crypto.randomBytes(32));
  await pool.query(
    `
    INSERT INTO webauthn_challenges (user_id, challenge, purpose, expires_at)
    VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 minute'))
    `,
    [userId, challenge, purpose, CHALLENGE_TTL_MINUTES]
  );

  return challenge;
};

const consumeChallenge = async (userId, purpose, challenge) => {
  const { rows } = await pool.query(
    `
    DELETE FROM webauthn_challenges
    WHERE id = (
      SELECT id
      FROM webauthn_challenges
      WHERE user_id = $1
        AND purpose = $2
        AND challenge = $3
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    )
    RETURNING id
    `,
    [userId, purpose, challenge]
  );

  return Boolean(rows[0]);
};

const validateClientData = async ({ clientDataJSON, type, challenge, req, userId, purpose }) => {
  const clientData = JSON.parse(fromBase64Url(clientDataJSON).toString("utf8"));

  if (clientData.type !== type) {
    throw new Error("Invalid passkey response type");
  }

  if (clientData.challenge !== challenge) {
    throw new Error("Invalid passkey challenge");
  }

  if (clientData.origin !== getExpectedOrigin(req)) {
    throw new Error("Invalid passkey origin");
  }

  const consumed = await consumeChallenge(userId, purpose, challenge);
  if (!consumed) {
    throw new Error("Passkey challenge expired. Please try again.");
  }

  return clientData;
};

const validateAuthenticatorData = ({ authenticatorData, req, requireUserVerification = true }) => {
  const parsed = parseAuthenticatorData(authenticatorData);
  const expectedRpIdHash = crypto.createHash("sha256").update(getRpId(req)).digest();

  if (!crypto.timingSafeEqual(parsed.rpIdHash, expectedRpIdHash)) {
    throw new Error("Invalid passkey relying party");
  }

  const userPresent = Boolean(parsed.flags & 0x01);
  const userVerified = Boolean(parsed.flags & 0x04);

  if (!userPresent || (requireUserVerification && !userVerified)) {
    throw new Error("Passkey user verification failed");
  }

  return parsed;
};

export const getRegistrationOptions = async ({ req, user }) => {
  const challenge = await createChallenge(user.id, "passkey-registration");
  const rpId = getRpId(req);

  const { rows } = await pool.query(
    `
    SELECT credential_id, transports
    FROM user_passkeys
    WHERE user_id = $1
    `,
    [user.id]
  );

  return {
    challenge,
    rp: {
      id: rpId,
      name: "Fruityger",
    },
    user: {
      id: toBase64Url(Buffer.from(String(user.id))),
      name: user.email || user.username,
      displayName: user.username,
    },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    timeout: 60000,
    attestation: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
    excludeCredentials: rows.map((row) => ({
      type: "public-key",
      id: row.credential_id,
      transports: Array.isArray(row.transports) ? row.transports : [],
    })),
  };
};

export const verifyRegistration = async ({ req, userId, credential, name }) => {
  const response = credential?.response || {};
  const clientData = JSON.parse(fromBase64Url(response.clientDataJSON).toString("utf8"));

  await validateClientData({
    clientDataJSON: response.clientDataJSON,
    type: "webauthn.create",
    challenge: clientData.challenge,
    req,
    userId,
    purpose: "passkey-registration",
  });

  const attestation = decodeAttestationObject(response.attestationObject);
  const authData = Buffer.from(attestation.authData);
  const credentialData = getCredentialFromAuthData(authData);

  validateAuthenticatorData({ authenticatorData: authData, req });

  if (credential.id !== credentialData.credentialId) {
    throw new Error("Passkey credential mismatch");
  }

  const { rows } = await pool.query(
    `
    INSERT INTO user_passkeys (user_id, credential_id, public_key_jwk, counter, name, transports)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (credential_id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          public_key_jwk = EXCLUDED.public_key_jwk,
          counter = EXCLUDED.counter,
          name = EXCLUDED.name,
          transports = EXCLUDED.transports
    RETURNING id, credential_id, name, transports, created_at, last_used_at
    `,
    [
      userId,
      credentialData.credentialId,
      credentialData.publicKeyJwk,
      credentialData.counter,
      String(name || "Passkey").slice(0, 80),
      JSON.stringify(credential.response?.transports || []),
    ]
  );

  return rows[0];
};

export const getAssertionOptions = async ({ req, userId, purpose }) => {
  await ensurePasskeySchema();

  const { rows } = await pool.query(
    `
    SELECT credential_id, transports
    FROM user_passkeys
    WHERE user_id = $1
    ORDER BY created_at DESC
    `,
    [userId]
  );

  if (rows.length === 0) {
    throw new Error("No passkey is set up for this account");
  }

  const challenge = await createChallenge(userId, purpose);

  return {
    challenge,
    rpId: getRpId(req),
    timeout: 60000,
    userVerification: "required",
    allowCredentials: rows.map((row) => ({
      type: "public-key",
      id: row.credential_id,
      transports: Array.isArray(row.transports) ? row.transports : [],
    })),
  };
};

export const verifyAssertion = async ({ req, userId, purpose, credential }) => {
  await ensurePasskeySchema();

  const response = credential?.response || {};
  const clientData = JSON.parse(fromBase64Url(response.clientDataJSON).toString("utf8"));

  await validateClientData({
    clientDataJSON: response.clientDataJSON,
    type: "webauthn.get",
    challenge: clientData.challenge,
    req,
    userId,
    purpose,
  });

  const { rows } = await pool.query(
    `
    SELECT id, public_key_jwk, counter
    FROM user_passkeys
    WHERE user_id = $1
      AND credential_id = $2
    LIMIT 1
    `,
    [userId, credential.id]
  );

  const passkey = rows[0];
  if (!passkey) {
    throw new Error("Passkey not found");
  }

  const authenticatorData = fromBase64Url(response.authenticatorData);
  const parsedAuthData = validateAuthenticatorData({ authenticatorData, req });
  const clientDataHash = crypto.createHash("sha256").update(fromBase64Url(response.clientDataJSON)).digest();
  const signedData = Buffer.concat([authenticatorData, clientDataHash]);
  const verifier = crypto.createVerify("SHA256");
  verifier.update(signedData);
  verifier.end();

  const publicKey = crypto.createPublicKey({
    key: passkey.public_key_jwk,
    format: "jwk",
  });

  const verified = verifier.verify(publicKey, fromBase64Url(response.signature));
  if (!verified) {
    throw new Error("Passkey signature verification failed");
  }

  if (parsedAuthData.counter > Number(passkey.counter || 0)) {
    await pool.query(
      `
      UPDATE user_passkeys
      SET counter = $2,
          last_used_at = NOW()
      WHERE id = $1
      `,
      [passkey.id, parsedAuthData.counter]
    );
  } else {
    await pool.query(`UPDATE user_passkeys SET last_used_at = NOW() WHERE id = $1`, [passkey.id]);
  }

  return true;
};

export const sanitizePasskey = (passkey) => ({
  id: passkey.id,
  name: passkey.name,
  created_at: passkey.created_at,
  last_used_at: passkey.last_used_at,
  transports: Array.isArray(passkey.transports) ? passkey.transports : [],
});
