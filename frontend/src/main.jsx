import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import OnlinePresenceSync from "./components/OnlinePresenceSync";
import "./css/index.css";
import { applyTheme, getStoredTheme } from "./utils/theme";

const AUTH_STORAGE_KEYS = new Set([
  "token",
  "userId",
  "username",
  "profile_pic",
  "emailVerified",
  "interestsCompleted",
  "pendingEmail",
  "verificationEmail",
]);
const TAB_ID_STORAGE_KEY = "__fruityger_tab_id__";
const TAB_NAME_PREFIX = "fruityger-tab:";
const TAB_HISTORY_STATE_KEY = "__fruityger_tab_id__";

const normalizeBaseUrl = (value) => String(value || "").trim().replace(/\/+$/, "");
const configuredApiBaseUrl = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);

const mapApiUrl = (url) => {
  if (typeof url !== "string") {
    return url;
  }

  if (url.startsWith("/api")) {
    return configuredApiBaseUrl ? `${configuredApiBaseUrl}${url}` : url;
  }

  if (!url.startsWith("http://localhost:5000") && !url.startsWith("https://localhost:5000")) {
    return url;
  }

  try {
    const parsedUrl = new URL(url);
    const apiPath = `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
    return configuredApiBaseUrl ? `${configuredApiBaseUrl}${apiPath}` : apiPath;
  } catch {
    return url;
  }
};

if (typeof window !== "undefined" && typeof window.fetch === "function") {
  const nativeFetch = window.fetch.bind(window);

  window.fetch = (input, init) => {
    if (typeof input === "string") {
      return nativeFetch(mapApiUrl(input), init);
    }

    if (input instanceof Request) {
      const nextUrl = mapApiUrl(input.url);
      if (nextUrl !== input.url) {
        return nativeFetch(new Request(nextUrl, input), init);
      }
    }

    return nativeFetch(input, init);
  };
}

if (typeof window !== "undefined" && window.localStorage && window.sessionStorage) {
  const nativeLocalGetItem = window.localStorage.getItem.bind(window.localStorage);
  const nativeLocalSetItem = window.localStorage.setItem.bind(window.localStorage);
  const nativeLocalRemoveItem = window.localStorage.removeItem.bind(window.localStorage);
  const nativeSessionGetItem = window.sessionStorage.getItem.bind(window.sessionStorage);
  const nativeSessionSetItem = window.sessionStorage.setItem.bind(window.sessionStorage);
  const nativeSessionRemoveItem = window.sessionStorage.removeItem.bind(window.sessionStorage);
  const userAgent = String(window.navigator?.userAgent || "");
  const isIPhoneWebKit =
    /iPhone|iPad|iPod/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && Number(window.navigator?.maxTouchPoints || 0) > 1);
  const shouldUseSharedAuthStorage = isIPhoneWebKit;
  const createTabId = () =>
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const readTabIdFromHistoryState = () => {
    try {
      return String(window.history.state?.[TAB_HISTORY_STATE_KEY] || "").trim();
    } catch {
      return "";
    }
  };
  const readTabIdFromWindowName = () =>
    String(window.name || "").startsWith(TAB_NAME_PREFIX)
      ? String(window.name).slice(TAB_NAME_PREFIX.length)
      : "";

  let tabId =
    nativeSessionGetItem(TAB_ID_STORAGE_KEY) ||
    readTabIdFromHistoryState() ||
    readTabIdFromWindowName() ||
    createTabId();

  nativeSessionSetItem(TAB_ID_STORAGE_KEY, tabId);
  window.name = `${TAB_NAME_PREFIX}${tabId}`;
  try {
    window.history.replaceState(
      {
        ...(window.history.state || {}),
        [TAB_HISTORY_STATE_KEY]: tabId,
      },
      "",
      window.location.href
    );
  } catch {
    // Ignore history-state write failures.
  }

  const getScopedAuthKey = (key) => `__fruityger_auth__${tabId}__${String(key)}`;
  const readScopedAuthValue = (key) => {
    if (shouldUseSharedAuthStorage) {
      const sharedLocalValue = nativeLocalGetItem(String(key));
      const sessionValue = nativeSessionGetItem(String(key));

      if (sharedLocalValue != null) {
        return sharedLocalValue;
      }

      if (sessionValue != null) {
        nativeLocalSetItem(String(key), sessionValue);
        return sessionValue;
      }

      return null;
    }

    const scopedKey = getScopedAuthKey(key);
    const scopedLocalValue = nativeLocalGetItem(scopedKey);
    const sessionValue = nativeSessionGetItem(String(key));
    const legacyLocalValue = nativeLocalGetItem(String(key));

    if (scopedLocalValue != null) {
      return scopedLocalValue;
    }

    if (sessionValue != null) {
      nativeLocalSetItem(scopedKey, sessionValue);
      return sessionValue;
    }

    if (legacyLocalValue != null) {
      nativeLocalSetItem(scopedKey, legacyLocalValue);
      return legacyLocalValue;
    }

    return null;
  };

  for (const key of AUTH_STORAGE_KEYS) {
    const scopedValue = readScopedAuthValue(key);
    const localValue = nativeLocalGetItem(key);

    if (scopedValue != null) {
      nativeSessionSetItem(key, scopedValue);
    }

    if (localValue != null && !shouldUseSharedAuthStorage) {
      nativeLocalRemoveItem(key);
    }
  }

  window.localStorage.getItem = (key) => {
    if (AUTH_STORAGE_KEYS.has(String(key))) {
      return readScopedAuthValue(String(key));
    }

    return nativeLocalGetItem(key);
  };

  window.localStorage.setItem = (key, value) => {
    if (AUTH_STORAGE_KEYS.has(String(key))) {
      const normalizedValue = String(value);
      nativeSessionSetItem(String(key), normalizedValue);
      if (shouldUseSharedAuthStorage) {
        nativeLocalSetItem(String(key), normalizedValue);
      } else {
        nativeLocalSetItem(getScopedAuthKey(String(key)), normalizedValue);
        nativeLocalRemoveItem(String(key));
      }
      return;
    }

    nativeLocalSetItem(key, value);
  };

  window.localStorage.removeItem = (key) => {
    if (AUTH_STORAGE_KEYS.has(String(key))) {
      nativeSessionRemoveItem(String(key));
      if (shouldUseSharedAuthStorage) {
        nativeLocalRemoveItem(String(key));
      } else {
        nativeLocalRemoveItem(getScopedAuthKey(String(key)));
      }
      nativeLocalRemoveItem(String(key));
      return;
    }

    nativeLocalRemoveItem(key);
  };
}

applyTheme(getStoredTheme());

ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <OnlinePresenceSync />
    <App />
  </BrowserRouter>
);
