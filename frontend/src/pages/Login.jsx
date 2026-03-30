import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ReCAPTCHA from "react-google-recaptcha";
import "../css/Login.css";
import { persistAuthSession } from "../utils/authSession";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const captchaRef = useRef(null);
  const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearMessage();

    if (!email || !password) {
      setCustomMessage("error", "Please enter your email and password.");
      return;
    }

    if (!siteKey || !captchaRef.current) {
      setCustomMessage("error", "reCAPTCHA is not configured properly.");
      return;
    }

    setSubmitting(true);

    try {
      const recaptchaToken = await captchaRef.current.executeAsync();
      captchaRef.current.reset();

      if (!recaptchaToken) {
        setCustomMessage("error", "Please verify that you are not a robot.");
        return;
      }

      const response = await fetch("http://localhost:5000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, recaptchaToken }),
      });

      const data = await response.json();

      if (!response.ok) {
        setCustomMessage("error", data.error || "Login failed.");
        return;
      }

      persistAuthSession(data);
      const requiresVerification = data.requiresVerification || !data.user?.email_verified;
      const requiresInterests = !requiresVerification && !data.user?.interests_completed;

      setCustomMessage(
        "success",
        requiresVerification
          ? "Login successful. Please verify your email to continue."
          : requiresInterests
            ? "Login successful. Let's tune your interests first."
            : "Login successful. Redirecting to your feed..."
      );

      setTimeout(() => {
        navigate(
          requiresVerification
            ? "/verify-email"
            : requiresInterests
              ? "/onboarding/interests"
              : "/feed",
          { replace: true }
        );
      }, 500);
    } catch (err) {
      console.error(err);
      setCustomMessage("error", "Login request failed.");
      captchaRef.current?.reset();
    } finally {
      setSubmitting(false);
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
              type="email"
              placeholder="Email"
              className="login-aero-input"
              value={email}
              onChange={(e) => {
                clearMessage();
                setEmail(e.target.value);
              }}
              required
            />

            <input
              type="password"
              placeholder="Password"
              className="login-aero-input"
              value={password}
              onChange={(e) => {
                clearMessage();
                setPassword(e.target.value);
              }}
              required
            />

            <ReCAPTCHA
              ref={captchaRef}
              sitekey={siteKey}
              size="invisible"
              badge="inline"
              theme="light"
            />

            <button type="submit" className="login-aero-btn" disabled={submitting}>
              {submitting ? "Logging in..." : "Log In"}
            </button>

            <div className="login-aero-create">
              <Link to="/signup">Create an account</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
