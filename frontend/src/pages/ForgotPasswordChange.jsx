import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/ForgotPassword.css";
import {
  clearForgotPasswordSession,
  getForgotPasswordResetToken,
} from "../utils/forgotPasswordSession";

export default function ForgotPasswordChange() {
  const navigate = useNavigate();
  const resetToken = getForgotPasswordResetToken();
  const [form, setForm] = useState({
    newPassword: "",
    confirmPassword: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });

  useEffect(() => {
    document.body.classList.add("welcome");
    return () => document.body.classList.remove("welcome");
  }, []);

  useEffect(() => {
    if (!resetToken) {
      navigate("/forgot-password", { replace: true });
    }
  }, [navigate, resetToken]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFeedback({ type: "", message: "" });

    if (!form.newPassword || !form.confirmPassword) {
      setFeedback({ type: "error", message: "Fill in both password fields." });
      return;
    }

    if (form.newPassword !== form.confirmPassword) {
      setFeedback({ type: "error", message: "Passwords do not match." });
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("http://localhost:5000/api/auth/forgot-password/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resetToken,
          newPassword: form.newPassword,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({ type: "error", message: data.error || "Couldn't update password." });
        return;
      }

      clearForgotPasswordSession();
      setFeedback({ type: "success", message: "Password updated. You can log in now." });
      setTimeout(() => navigate("/login", { replace: true }), 900);
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Couldn't update password." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="forgot-password-page">
      <div className="forgot-password-card">
        <p className="forgot-password-kicker">Password Reset</p>
        <h1>Choose a new password</h1>
        <p className="forgot-password-subtitle">
          Set a fresh password after your passkey check.
        </p>

        {feedback.message && (
          <div className={`forgot-password-feedback ${feedback.type}`}>
            {feedback.message}
          </div>
        )}

        <form className="forgot-password-form" onSubmit={handleSubmit}>
          <input
            id="forgot-password-new-password"
            name="newPassword"
            type="password"
            className="forgot-password-input"
            placeholder="New password"
            value={form.newPassword}
            onChange={(event) =>
              setForm((current) => ({ ...current, newPassword: event.target.value }))
            }
          />

          <input
            id="forgot-password-confirm-password"
            name="confirmPassword"
            type="password"
            className="forgot-password-input"
            placeholder="Confirm new password"
            value={form.confirmPassword}
            onChange={(event) =>
              setForm((current) => ({ ...current, confirmPassword: event.target.value }))
            }
          />

          <button type="submit" className="forgot-password-primary" disabled={submitting}>
            {submitting ? "Updating..." : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}
