const base64UrlToBuffer = (value = "") => {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = window.atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
};

const bufferToBase64Url = (value) => {
  const bytes = new Uint8Array(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const decodeCreationOptions = (options) => ({
  ...options,
  challenge: base64UrlToBuffer(options.challenge),
  user: {
    ...options.user,
    id: base64UrlToBuffer(options.user.id),
  },
  excludeCredentials: (options.excludeCredentials || []).map((credential) => ({
    ...credential,
    id: base64UrlToBuffer(credential.id),
  })),
});

const decodeAssertionOptions = (options) => ({
  ...options,
  challenge: base64UrlToBuffer(options.challenge),
  allowCredentials: (options.allowCredentials || []).map((credential) => ({
    ...credential,
    id: base64UrlToBuffer(credential.id),
  })),
});

const serializeCredential = (credential) => ({
  id: credential.id,
  rawId: bufferToBase64Url(credential.rawId),
  type: credential.type,
  authenticatorAttachment: credential.authenticatorAttachment || "",
});

const getTransports = (response) => {
  try {
    return typeof response.getTransports === "function" ? response.getTransports() : [];
  } catch {
    return [];
  }
};

const serializeRegistration = (credential) => ({
  ...serializeCredential(credential),
  response: {
    clientDataJSON: bufferToBase64Url(credential.response.clientDataJSON),
    attestationObject: bufferToBase64Url(credential.response.attestationObject),
    transports: getTransports(credential.response),
  },
});

const serializeAssertion = (credential) => ({
  ...serializeCredential(credential),
  response: {
    clientDataJSON: bufferToBase64Url(credential.response.clientDataJSON),
    authenticatorData: bufferToBase64Url(credential.response.authenticatorData),
    signature: bufferToBase64Url(credential.response.signature),
    userHandle: credential.response.userHandle
      ? bufferToBase64Url(credential.response.userHandle)
      : "",
  },
});

const ensureWebAuthnSupport = () => {
  if (!window.PublicKeyCredential || !navigator.credentials) {
    throw new Error("This browser does not support passkeys.");
  }
};

export const createPasskeyCredential = async (options) => {
  ensureWebAuthnSupport();
  const credential = await navigator.credentials.create({
    publicKey: decodeCreationOptions(options),
  });

  if (!credential) {
    throw new Error("Passkey setup was cancelled.");
  }

  return serializeRegistration(credential);
};

export const getPasskeyCredential = async (options) => {
  ensureWebAuthnSupport();
  const credential = await navigator.credentials.get({
    publicKey: decodeAssertionOptions(options),
  });

  if (!credential) {
    throw new Error("Passkey verification was cancelled.");
  }

  return serializeAssertion(credential);
};
