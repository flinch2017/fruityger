import express from "express";

const router = express.Router();

const getTurnstileSiteKey = () =>
  String(
    process.env.TURNSTILE_SITE_KEY ||
      process.env.VITE_TURNSTILE_SITE_KEY ||
      process.env.RECAPTCHA_SITE_KEY ||
      ""
  ).trim();

router.get("/turnstile", (req, res) => {
  const siteKey = getTurnstileSiteKey();

  if (!siteKey) {
    return res.status(503).send("Turnstile site key is not configured.");
  }

  const callbackUrl = String(
    req.query.callback_url || req.query.redirect_uri || ""
  ).trim();
  const state = String(req.query.state || "").trim();
  const mode = String(req.query.mode || "login").trim().toLowerCase();

  const title =
    mode === "signup" ? "Create your Fruityger account" : "Continue to Fruityger";
  const subtitle =
    mode === "signup"
      ? "Complete the quick cloud check to finish signing up in the app."
      : "Complete the quick cloud check to finish logging in inside the app.";

  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Fruityger Security Check</title>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
    <style>
      :root {
        color-scheme: light;
        font-family: "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        overflow: hidden;
        background:
          radial-gradient(circle at top left, rgba(255,255,255,0.94), transparent 34%),
          radial-gradient(circle at 82% 14%, rgba(112, 233, 255, 0.42), transparent 22%),
          linear-gradient(160deg, #dffaff, #c7f3ff 36%, #eafcff 100%);
        color: #0a6f90;
      }

      body::before,
      body::after {
        content: "";
        position: fixed;
        inset: auto;
        border-radius: 999px;
        pointer-events: none;
        filter: blur(6px);
      }

      body::before {
        width: 180px;
        height: 180px;
        top: 10%;
        left: 8%;
        background: radial-gradient(circle, rgba(255,255,255,0.52), rgba(255,255,255,0));
      }

      body::after {
        width: 220px;
        height: 220px;
        right: -40px;
        bottom: 3%;
        background: radial-gradient(circle, rgba(74, 218, 255, 0.18), rgba(74, 218, 255, 0));
      }

      .shell {
        width: min(420px, calc(100% - 28px));
        padding: 30px 24px 24px;
        border-radius: 32px;
        background:
          linear-gradient(165deg, rgba(255,255,255,0.88), rgba(206,242,255,0.72));
        border: 1px solid rgba(255,255,255,0.96);
        box-shadow:
          0 20px 46px rgba(0, 165, 255, 0.14),
          inset 0 1px 0 rgba(255,255,255,0.94);
        backdrop-filter: blur(22px);
        text-align: center;
      }

      .kicker {
        margin: 0 0 8px;
        color: #2393b6;
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0;
        font-size: clamp(1.9rem, 4vw, 2.4rem);
        color: #0b7b9d;
        text-shadow: 0 0 14px rgba(0, 214, 255, 0.18);
      }

      .subtitle {
        margin: 12px 0 0;
        color: #577985;
        line-height: 1.6;
      }

      .orb-wrap {
        position: relative;
        width: 120px;
        height: 120px;
        margin: 24px auto 18px;
      }

      .orb,
      .orb-glow {
        position: absolute;
        inset: 0;
        border-radius: 50%;
      }

      .orb {
        background:
          radial-gradient(circle at 30% 28%, rgba(255,255,255,0.96), rgba(255,255,255,0.18) 34%, rgba(55,198,255,0.2) 58%, rgba(55,198,255,0.58));
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,0.94),
          0 12px 28px rgba(0, 182, 255, 0.18);
        animation: bob 3.6s ease-in-out infinite;
      }

      .orb-glow {
        inset: -16px;
        background: radial-gradient(circle, rgba(111,230,255,0.22), rgba(111,230,255,0));
        animation: pulse 4s ease-in-out infinite;
      }

      .status {
        min-height: 48px;
        margin: 0 0 18px;
        color: #4d7584;
        font-size: 0.95rem;
        line-height: 1.6;
      }

      .widget-shell {
        display: inline-flex;
        justify-content: center;
        width: 100%;
      }

      .retry {
        margin-top: 14px;
        border: none;
        border-radius: 999px;
        padding: 12px 18px;
        font-weight: 700;
        color: #fff;
        cursor: pointer;
        background: linear-gradient(145deg, #00ddff, #00bfff, #4facfe);
        box-shadow:
          0 10px 20px rgba(0, 183, 255, 0.26),
          inset 0 0 14px rgba(255,255,255,0.28);
      }

      .hidden {
        display: none !important;
      }

      @keyframes bob {
        0%, 100% { transform: translateY(0px); }
        50% { transform: translateY(-8px); }
      }

      @keyframes pulse {
        0%, 100% { opacity: 0.72; transform: scale(0.94); }
        50% { opacity: 1; transform: scale(1.03); }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <p class="kicker">Mobile Security</p>
      <h1>${title}</h1>
      <p class="subtitle">${subtitle}</p>

      <div class="orb-wrap" aria-hidden="true">
        <div class="orb-glow"></div>
        <div class="orb"></div>
      </div>

      <p class="status" id="status">Hold on for a second while Fruityger checks the clouds.</p>

      <div class="widget-shell">
        <div id="turnstile-widget"></div>
      </div>

      <button type="button" class="retry hidden" id="retry-button">Try again</button>
    </main>

    <script>
      const siteKey = ${JSON.stringify(siteKey)};
      const callbackUrl = ${JSON.stringify(callbackUrl)};
      const state = ${JSON.stringify(state)};
      const retryButton = document.getElementById("retry-button");
      const statusEl = document.getElementById("status");
      let widgetId = null;

      const postResult = (payload) => {
        const message = JSON.stringify(payload);

        if (window.ReactNativeWebView?.postMessage) {
          window.ReactNativeWebView.postMessage(message);
        }

        if (window.parent && window.parent !== window) {
          window.parent.postMessage(payload, "*");
        }

        if (window.opener && typeof window.opener.postMessage === "function") {
          window.opener.postMessage(payload, "*");
        }
      };

      const redirectToCallback = (payload) => {
        if (!callbackUrl) return;

        try {
          const hasQuery = callbackUrl.includes("?");
          const url = new URL(callbackUrl);
          Object.entries(payload).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== "") {
              url.searchParams.set(key, String(value));
            }
          });
          window.location.replace(url.toString());
        } catch (error) {
          const separator = hasQuery ? "&" : "?";
          const query = Object.entries(payload)
            .filter(([, value]) => value !== undefined && value !== null && value !== "")
            .map(([key, value]) => \`\${encodeURIComponent(key)}=\${encodeURIComponent(String(value))}\`)
            .join("&");

          window.location.replace(query ? \`\${callbackUrl}\${separator}\${query}\` : callbackUrl);
        }
      };

      const complete = (status, extra = {}) => {
        const payload = {
          source: "fruityger-turnstile",
          status,
          state,
          ...extra,
        };

        postResult(payload);
        redirectToCallback(payload);
      };

      const startRender = () => {
        if (!window.turnstile || widgetId !== null) return;

        widgetId = window.turnstile.render("#turnstile-widget", {
          sitekey: siteKey,
          size: "normal",
          theme: "light",
          callback(token) {
            statusEl.textContent = "Security check finished. Sending you back to Fruityger...";
            retryButton.classList.add("hidden");
            complete("success", { token });
          },
          "error-callback"() {
            statusEl.textContent = "That cloud check did not go through. Please try again.";
            retryButton.classList.remove("hidden");
            complete("error", { error: "turnstile-error" });
          },
          "expired-callback"() {
            statusEl.textContent = "That check expired. Please try again.";
            retryButton.classList.remove("hidden");
            complete("expired", { error: "turnstile-expired" });
          },
        });
      };

      retryButton.addEventListener("click", () => {
        retryButton.classList.add("hidden");
        statusEl.textContent = "Trying the cloud check again...";

        if (window.turnstile && widgetId !== null) {
          window.turnstile.reset(widgetId);
          return;
        }

        startRender();
      });

      const boot = () => {
        if (window.turnstile) {
          startRender();
          return;
        }

        window.setTimeout(boot, 120);
      };

      boot();
    </script>
  </body>
</html>`);
});

export default router;
