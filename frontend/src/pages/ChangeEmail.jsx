import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/SettingsFlow.css";
import { persistAuthSession } from "../utils/authSession";

export default function ChangeEmail() {
  const navigate = useNavigate();
  const approvalToken = sessionStorage.getItem("accountChangeApprovalToken");
  const approvalPurpose = sessionStorage.getItem("accountChangePurpose");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });

  useEffect(() => {
    if (!approvalToken || approvalPurpose !== "email-change") {
      navigate("/settings/verify-current-password?action=email", { replace: true });
    }
  }, [approvalPurpose, approvalToken, navigate]);

  const currentEmail = useMemo(
    () => localStorage.getItem("verificationEmail") || "",
    []
  );

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFeedback({ type: "", message: "" });

    if (!email) {
      setFeedback({ type: "error", message: "Enter your new email address." });
      return;
    }

    const token = localStorage.getItem("token");
    if (!token) {
      navigate("/login", { replace: true });
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("http://localhost:5000/api/auth/request-email-change", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          approvalToken,
          newEmail: email,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setFeedback({ type: "error", message: data.error || "Couldn't start email change." });
        return;
      }

      persistAuthSession({ user: { pending_email: email } });
      navigate("/settings", { replace: true });
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Couldn't start email change." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="settings-flow-page">
      <div className="settings-flow-card">
        <p className="settings-flow-kicker">Email Update</p>
        <h1>Change email</h1>
        <p className="settings-flow-subtitle">
          Current email: <strong>{currentEmail || "unknown"}</strong>
        </p>

        {feedback.message && (
          <div className={`settings-flow-feedback ${feedback.type}`}>
            {feedback.message}
          </div>
        )}

        <form className="settings-flow-form" onSubmit={handleSubmit}>
          <input
            type="email"
            className="settings-flow-input"
            placeholder="New email address"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <button type="submit" className="settings-flow-primary" disabled={submitting}>
            {submitting ? "Sending..." : "Send confirmation email"}
          </button>
        </form>
      </div>
    </div>
  );
}
