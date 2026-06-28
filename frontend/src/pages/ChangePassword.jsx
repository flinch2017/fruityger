import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/SettingsFlow.css";

export default function ChangePassword() {
  const navigate = useNavigate();
  const approvalToken = sessionStorage.getItem("accountChangeApprovalToken");
  const approvalPurpose = sessionStorage.getItem("accountChangePurpose");
  const [form, setForm] = useState({
    newPassword: "",
    confirmPassword: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });

  useEffect(() => {
    if (!approvalToken || approvalPurpose !== "password-change") {
      navigate("/settings/verify-current-password?action=password", { replace: true });
    }
  }, [approvalPurpose, approvalToken, navigate]);

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

    const token = localStorage.getItem("token");
    if (!token) {
      navigate("/login", { replace: true });
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("http://localhost:5000/api/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          approvalToken,
          newPassword: form.newPassword,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setFeedback({ type: "error", message: data.error || "Couldn't update password." });
        return;
      }

      sessionStorage.removeItem("accountChangeApprovalToken");
      sessionStorage.removeItem("accountChangePurpose");

      setFeedback({ type: "success", message: "Password updated successfully." });
      setTimeout(() => navigate("/settings", { replace: true }), 900);
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Couldn't update password." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="settings-flow-page">
      <div className="settings-flow-card">
        <p className="settings-flow-kicker">Password Update</p>
        <h1>Change password</h1>
        <p className="settings-flow-subtitle">
          Set a fresh password after this security check.
        </p>

        {feedback.message && (
          <div className={`settings-flow-feedback ${feedback.type}`}>
            {feedback.message}
          </div>
        )}

        <form className="settings-flow-form" onSubmit={handleSubmit}>
          <input
            id="change-password-new-password"
            name="newPassword"
            type="password"
            className="settings-flow-input"
            placeholder="New password"
            value={form.newPassword}
            onChange={(event) =>
              setForm((current) => ({ ...current, newPassword: event.target.value }))
            }
          />

          <input
            id="change-password-confirm-password"
            name="confirmPassword"
            type="password"
            className="settings-flow-input"
            placeholder="Confirm new password"
            value={form.confirmPassword}
            onChange={(event) =>
              setForm((current) => ({ ...current, confirmPassword: event.target.value }))
            }
          />

          <button type="submit" className="settings-flow-primary" disabled={submitting}>
            {submitting ? "Updating..." : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}
