import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/VerifyEmail.css";
import { clearAuthStorage, fetchAuthSession, persistAuthSession } from "../utils/authSession";

export default function VerifyEmail() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [email, setEmail] = useState(localStorage.getItem("verificationEmail") || "");
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    document.body.classList.add("welcome");
    return () => document.body.classList.remove("welcome");
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadSession = async () => {
      const session = await fetchAuthSession();

      if (!isMounted) return;

      if (!session.ok) {
        clearAuthStorage();
        navigate("/login", { replace: true });
        return;
      }

      if (session.data?.user?.email_verified) {
        navigate("/feed", { replace: true });
        return;
      }

      setEmail(session.data?.user?.email || localStorage.getItem("verificationEmail") || "");
      setLoading(false);
    };

    loadSession();

    return () => {
      isMounted = false;
    };
  }, [navigate]);

  const formattedCode = useMemo(
    () => code.replace(/\D/g, "").slice(0, 6),
    [code]
  );

  const handleVerify = async (e) => {
    e.preventDefault();
    setFeedback({ type: "", message: "" });

    if (formattedCode.length !== 6) {
      setFeedback({ type: "error", message: "Enter the full 6-digit code from your email." });
      return;
    }

    const token = localStorage.getItem("token");
    if (!token) {
      clearAuthStorage();
      navigate("/login", { replace: true });
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("http://localhost:5000/api/auth/verify-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: formattedCode }),
      });

      const data = await res.json();

      if (!res.ok) {
        setFeedback({ type: "error", message: data.error || "Verification failed." });
        if (String(data.error || "").toLowerCase().includes("sign up again")) {
          clearAuthStorage();
          setTimeout(() => navigate("/signup", { replace: true }), 1200);
        }
        return;
      }

      persistAuthSession({ user: data.user });
      setFeedback({ type: "success", message: "Email verified. Redirecting to your feed..." });
      setTimeout(() => navigate("/feed", { replace: true }), 700);
    } catch (err) {
      console.error(err);
      setFeedback({ type: "error", message: "Verification request failed." });
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      clearAuthStorage();
      navigate("/login", { replace: true });
      return;
    }

    setResending(true);
    setFeedback({ type: "", message: "" });

    try {
      const res = await fetch("http://localhost:5000/api/auth/resend-verification", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();

      if (!res.ok) {
        setFeedback({ type: "error", message: data.error || "Failed to resend code." });
        if (String(data.error || "").toLowerCase().includes("sign up again")) {
          clearAuthStorage();
          setTimeout(() => navigate("/signup", { replace: true }), 1200);
        }
        return;
      }

      setFeedback({ type: "success", message: data.message || "A new verification code was sent." });
    } catch (err) {
      console.error(err);
      setFeedback({ type: "error", message: "Failed to resend code." });
    } finally {
      setResending(false);
    }
  };

  if (loading) {
    return null;
  }

  return (
    <div className="verify-email-page">
      <div className="verify-email-card">
        <h2 className="verify-email-title">Check your email</h2>
        <p className="verify-email-subtitle">
          Enter the 6-digit code sent to <strong>{email || "your email address"}</strong>.
        </p>

        {feedback.message && (
          <div className={`verify-email-feedback ${feedback.type}`}>
            {feedback.message}
          </div>
        )}

        <form className="verify-email-form" onSubmit={handleVerify}>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            className="verify-email-code-input"
            value={formattedCode}
            onChange={(e) => setCode(e.target.value)}
          />

          <button type="submit" className="verify-email-btn" disabled={submitting}>
            {submitting ? "Verifying..." : "Verify Email"}
          </button>
        </form>

        <button
          type="button"
          className="verify-email-resend"
          onClick={handleResend}
          disabled={resending}
        >
          {resending ? "Sending..." : "Resend code"}
        </button>
      </div>
    </div>
  );
}
