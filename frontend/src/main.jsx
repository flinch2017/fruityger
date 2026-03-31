import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./css/index.css";
import { applyTheme, getStoredTheme } from "./utils/theme";

const normalizeBaseUrl = (value) => String(value || "").trim().replace(/\/+$/, "");
const configuredApiBaseUrl = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);

const mapApiUrl = (url) => {
  if (typeof url !== "string") {
    return url;
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

applyTheme(getStoredTheme());

ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
