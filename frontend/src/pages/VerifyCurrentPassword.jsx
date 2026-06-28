import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "../css/SettingsFlow.css";

const getActionConfig = (action) => {
  if (action === "password") {
    return {
      purpose: "password-change",
      title: "Confirm your password",
      subtitle: "Enter your current password before choosing a new one.",
      nextPath: "/settings/change-password",
    };
  }

  return {
    purpose: "email-change",
    title: "Confirm your password",
    subtitle: "Enter your current password before changing your email.",
    nextPath: "/settings/change-email",
  };
};

export default function VerifyCurrentPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const action = new URLSearchParams(location.search).get("action") || "email";
  const config = useMemo(() => getActionConfig(action), [action]);

  const [currentPassword, setCurrentPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFeedback({ type: "", message: "" });

    if (!currentPassword) {
      setFeedback({ type: "error", message: "Enter your current password first." });
      return;
    }

    const token = localStorage.getItem("token");
    if (!token) {
      navigate("/login", { replace: true });
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("http://localhost:5000/api/auth/verify-current-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          currentPassword,
          purpose: config.purpose,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setFeedback({ type: "error", message: data.error || "Password check failed." });
        return;
      }

      sessionStorage.setItem("accountChangeApprovalToken", data.approvalToken);
      sessionStorage.setItem("accountChangePurpose", config.purpose);

      navigate(config.nextPath, { replace: true });
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Password check failed." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="settings-flow-page">
      <div className="settings-flow-card">
        <p className="settings-flow-kicker">Security Check</p>
        <h1>{config.title}</h1>
        <p className="settings-flow-subtitle">{config.subtitle}</p>

        {feedback.message && (
          <div className={`settings-flow-feedback ${feedback.type}`}>
            {feedback.message}
          </div>
        )}

        <form className="settings-flow-form" onSubmit={handleSubmit}>
          <input
            id="verify-current-password"
            name="currentPassword"
            type="password"
            className="settings-flow-input"
            placeholder="Current password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />

          <button type="submit" className="settings-flow-primary" disabled={submitting}>
            {submitting ? "Checking..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
