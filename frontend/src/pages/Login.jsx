import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import "../css/Login.css";
import { persistAuthSession } from "../utils/authSession";
import TurnstileWidget from "../components/TurnstileWidget";
import { getPasskeyCredential } from "../utils/webauthn";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [passkeySubmitting, setPasskeySubmitting] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const captchaRef = useRef(null);
  const siteKey =
    import.meta.env.VITE_TURNSTILE_SITE_KEY || import.meta.env.VITE_RECAPTCHA_SITE_KEY;

  useEffect(() => {
    document.body.classList.add("welcome");
    return () => document.body.classList.remove("welcome");
  }, []);

  const setCustomMessage = (type, message) => {
    setFeedback({ type, message });
  };

  const clearMessage = () => {
    setFeedback({ type: "", message: "" });
  };

  const finishLogin = (data) => {
    persistAuthSession(data);
    const requiresInterests = !data.user?.interests_completed;

    setCustomMessage(
      "success",
      requiresInterests
        ? "Login successful. Let's tune your interests first."
        : "Login successful. Redirecting to your feed..."
    );

    setTimeout(() => {
      navigate(
        requiresInterests ? "/onboarding/interests" : "/feed",
        { replace: true }
      );
    }, 500);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearMessage();

    if (!email || !password) {
      setCustomMessage("error", "Please enter your email or username and password.");
      return;
    }

    if (!siteKey || !captchaRef.current) {
      setCustomMessage("error", "Turnstile is not configured properly.");
      return;
    }

    setSubmitting(true);

    try {
      const turnstileToken = await captchaRef.current.executeAsync();
      captchaRef.current.reset();

      if (!turnstileToken) {
        setCustomMessage("error", "Please complete the security check.");
        return;
      }

      const response = await fetch("http://localhost:5000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, turnstileToken }),
      });

      const data = await response.json();

      if (!response.ok) {
        setCustomMessage("error", data.error || "Login failed.");
        return;
      }

      finishLogin(data);
    } catch (err) {
      console.error(err);
      setCustomMessage("error", "Login request failed.");
      captchaRef.current?.reset();
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasskeyLogin = async () => {
    clearMessage();

    if (!email) {
      setCustomMessage("error", "Enter your email or username first.");
      return;
    }

    setPasskeySubmitting(true);

    try {
      const optionsRes = await fetch("http://localhost:5000/api/auth/login/passkey/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: email }),
      });

      const optionsData = await optionsRes.json().catch(() => ({}));
      if (!optionsRes.ok) {
        setCustomMessage("error", optionsData.error || "Couldn't start passkey login.");
        return;
      }

      const credential = await getPasskeyCredential(optionsData.options);

      const verifyRes = await fetch("http://localhost:5000/api/auth/login/passkey/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: optionsData.userId,
          credential,
        }),
      });

      const verifyData = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok) {
        setCustomMessage("error", verifyData.error || "Passkey login failed.");
        return;
      }

      finishLogin(verifyData);
    } catch (error) {
      console.error(error);
      setCustomMessage("error", error.message || "Passkey login failed.");
    } finally {
      setPasskeySubmitting(false);
    }
  };

  return (
    <div className="welcome">
      <div className="login-aero-page">
        <div className="login-aero-card">
          <h2 className="login-aero-title">Login</h2>

          {feedback.message && (
            <div className={`login-feedback ${feedback.type}`}>
              {feedback.message}
            </div>
          )}

          <form className="login-aero-form" onSubmit={handleSubmit}>
            <input
              type="text"
              placeholder="Email or Username"
              className="login-aero-input"
              value={email}
              onChange={(e) => {
                clearMessage();
                setEmail(e.target.value);
              }}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck="false"
              required
            />

            <div className="login-password-field">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                className="login-aero-input login-password-input"
                value={password}
                onChange={(e) => {
                  clearMessage();
                  setPassword(e.target.value);
                }}
                required
              />

              <button
                type="button"
                className="login-password-toggle"
                onClick={() => setShowPassword((prev) => !prev)}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>

            <TurnstileWidget
              ref={captchaRef}
              siteKey={siteKey}
            />

            <button type="submit" className="login-aero-btn" disabled={submitting}>
              {submitting ? "Logging in..." : "Log In"}
            </button>

            <button
              type="button"
              className="login-aero-btn login-passkey-btn"
              onClick={handlePasskeyLogin}
              disabled={passkeySubmitting || submitting}
            >
              {passkeySubmitting ? "Checking passkey..." : "Login with passkey"}
            </button>

            <div className="login-aero-forgot">
              <Link to="/forgot-password">Forgot password?</Link>
            </div>

            <div className="login-aero-create">
              <Link to="/signup">Create an account</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
