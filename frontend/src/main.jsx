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

  for (const key of AUTH_STORAGE_KEYS) {
    const sessionValue = nativeSessionGetItem(key);
    const localValue = nativeLocalGetItem(key);

    if (sessionValue == null && localValue != null) {
      nativeSessionSetItem(key, localValue);
    }

    if (localValue != null) {
      nativeLocalRemoveItem(key);
    }
  }

  window.localStorage.getItem = (key) => {
    if (AUTH_STORAGE_KEYS.has(String(key))) {
      return nativeSessionGetItem(String(key));
    }

    return nativeLocalGetItem(key);
  };

  window.localStorage.setItem = (key, value) => {
    if (AUTH_STORAGE_KEYS.has(String(key))) {
      nativeSessionSetItem(String(key), String(value));
      nativeLocalRemoveItem(String(key));
      return;
    }

    nativeLocalSetItem(key, value);
  };

  window.localStorage.removeItem = (key) => {
    if (AUTH_STORAGE_KEYS.has(String(key))) {
      nativeSessionRemoveItem(String(key));
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
