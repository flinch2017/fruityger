import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/ForgotPassword.css";
import {
  getForgotPasswordAccount,
  setForgotPasswordResetToken,
} from "../utils/forgotPasswordSession";

export default function ForgotPasswordVerify() {
  const navigate = useNavigate();
  const account = getForgotPasswordAccount();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });

  useEffect(() => {
    document.body.classList.add("welcome");
    return () => document.body.classList.remove("welcome");
  }, []);

  useEffect(() => {
    if (!account?.id) {
      navigate("/forgot-password", { replace: true });
    }
  }, [account, navigate]);

  const formattedCode = useMemo(() => code.replace(/\D/g, "").slice(0, 6), [code]);

  const handleVerify = async (event) => {
    event.preventDefault();
    setFeedback({ type: "", message: "" });

    if (formattedCode.length !== 6) {
      setFeedback({ type: "error", message: "Enter the full 6-digit code from your email." });
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("http://localhost:5000/api/auth/forgot-password/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: account.id,
          code: formattedCode,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({ type: "error", message: data.error || "Couldn't verify that code." });
        return;
      }

      setForgotPasswordResetToken(data.resetToken);
      navigate("/forgot-password/change-password", { replace: true });
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Couldn't verify that code." });
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (!account?.id) return;
    setFeedback({ type: "", message: "" });
    setResending(true);

    try {
      const res = await fetch("http://localhost:5000/api/auth/forgot-password/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: account.id }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Couldn't resend reset code.");
      }

      setFeedback({ type: "success", message: "A fresh code was sent to your email." });
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: error.message || "Couldn't resend reset code." });
    } finally {
      setResending(false);
    }
  };

  if (!account?.id) {
    return null;
  }

  return (
    <div className="forgot-password-page">
      <div className="forgot-password-card">
        <p className="forgot-password-kicker">Password Reset</p>
        <h1>Check your email</h1>
        <p className="forgot-password-subtitle">
          Enter the 6-digit code sent to <strong>{account.masked_email}</strong> for @{account.username}.
        </p>

        {feedback.message && (
          <div className={`forgot-password-feedback ${feedback.type}`}>
            {feedback.message}
          </div>
        )}

        <form className="forgot-password-form" onSubmit={handleVerify}>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            className="forgot-password-code-input"
            value={formattedCode}
            onChange={(event) => setCode(event.target.value)}
          />

          <button type="submit" className="forgot-password-primary" disabled={submitting}>
            {submitting ? "Verifying..." : "Verify code"}
          </button>
        </form>

        <button
          type="button"
          className="forgot-password-link"
          onClick={handleResend}
          disabled={resending}
        >
          {resending ? "Sending..." : "Resend code"}
        </button>
      </div>
    </div>
  );
}
