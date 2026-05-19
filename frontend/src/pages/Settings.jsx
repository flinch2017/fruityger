import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/Settings.css";
import { persistAuthSession } from "../utils/authSession";
import { applyTheme } from "../utils/theme";

const maskEmail = (email = "") => {
  const [localPart = "", domainPart = ""] = String(email).split("@");

  if (!localPart || !domainPart) {
    return "n***@e***.com";
  }

  const localHint = localPart.slice(0, 2);
  const domainPieces = domainPart.split(".");
  const domainName = domainPieces[0] || "";
  const extension = domainPieces.slice(1).join(".") || "com";
  const domainHint = domainName.slice(0, 2);

  return `${localHint || "u"}****@${domainHint || "m"}****.${extension}`;
};

const maskPassword = () => "************";

export default function Settings() {
  const navigate = useNavigate();
  const [email, setEmail] = useState(localStorage.getItem("verificationEmail") || "");
  const [pendingEmail, setPendingEmail] = useState(localStorage.getItem("pendingEmail") || "");
  const [theme, setTheme] = useState(() => localStorage.getItem("appearanceTheme") || "light");
  const [newsletterEnabled, setNewsletterEnabled] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [emailVerified, setEmailVerified] = useState(localStorage.getItem("emailVerified") === "true");
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationSubmitting, setVerificationSubmitting] = useState(false);
  const [verificationResending, setVerificationResending] = useState(false);
  const [verificationFeedback, setVerificationFeedback] = useState({ type: "", message: "" });
  const [helpSubject, setHelpSubject] = useState("");
  const [helpMessage, setHelpMessage] = useState("");
  const [helpSubmitting, setHelpSubmitting] = useState(false);
  const [helpFeedback, setHelpFeedback] = useState({ type: "", message: "" });
  const [helpRequests, setHelpRequests] = useState([]);

  useEffect(() => {
    const fetchUser = async () => {
      const token = localStorage.getItem("token");
      if (!token) return;

      try {
        const res = await fetch("http://localhost:5000/api/auth/session", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok && data.user) {
          if (data.user.email) {
            setEmail(data.user.email);
          }
          setEmailVerified(Boolean(data.user.email_verified));
          setPendingEmail(data.user.pending_email || "");
          persistAuthSession({ user: data.user });
        }
      } catch (error) {
        console.error(error);
      }
    };

    fetchUser();
  }, []);

  useEffect(() => {
    const loadHelpRequests = async () => {
      const token = localStorage.getItem("token");
      if (!token) return;

      try {
        const res = await fetch("http://localhost:5000/api/main/settings/help-requests", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        setHelpRequests(Array.isArray(data.requests) ? data.requests : []);
      } catch (error) {
        console.error(error);
      }
    };

    loadHelpRequests();
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const fetchNotificationSettings = async () => {
      const token = localStorage.getItem("token");
      if (!token) return;

      try {
        const res = await fetch("http://localhost:5000/api/main/settings/notifications", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;

        setNewsletterEnabled(Boolean(data.newsletterEnabled));
        setPushEnabled(Boolean(data.pushEnabled));
      } catch (error) {
        console.error(error);
      }
    };

    fetchNotificationSettings();
  }, []);

  useEffect(() => {
    sessionStorage.removeItem("accountChangeApprovalToken");
    sessionStorage.removeItem("accountChangePurpose");
  }, []);

  const maskedEmail = useMemo(() => maskEmail(email), [email]);
  const maskedPendingEmail = useMemo(() => maskEmail(pendingEmail), [pendingEmail]);
  const formattedVerificationCode = useMemo(
    () => verificationCode.replace(/\D/g, "").slice(0, 6),
    [verificationCode]
  );

  const handleCancelPendingEmailChange = async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      navigate("/login", { replace: true });
      return;
    }

    try {
      const res = await fetch("http://localhost:5000/api/auth/cancel-email-change", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        return;
      }

      setPendingEmail("");
      persistAuthSession({ user: data.user });
    } catch (error) {
      console.error(error);
    }
  };

  const updateNotificationPreferences = async (nextNewsletterEnabled, nextPushEnabled) => {
    const token = localStorage.getItem("token");
    if (!token || notificationSaving) {
      return;
    }

    const previousState = {
      newsletterEnabled,
      pushEnabled,
    };

    setNewsletterEnabled(nextNewsletterEnabled);
    setPushEnabled(nextPushEnabled);
    setNotificationSaving(true);

    try {
      const res = await fetch("http://localhost:5000/api/main/settings/notifications", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          newsletterEnabled: nextNewsletterEnabled,
          pushEnabled: nextPushEnabled,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Failed to update notification settings");
      }

      setNewsletterEnabled(Boolean(data.newsletterEnabled));
      setPushEnabled(Boolean(data.pushEnabled));
    } catch (error) {
      console.error(error);
      setNewsletterEnabled(previousState.newsletterEnabled);
      setPushEnabled(previousState.pushEnabled);
    } finally {
      setNotificationSaving(false);
    }
  };

  const handleVerifyEmail = async () => {
    const token = localStorage.getItem("token");
    if (!token || verificationSubmitting) return;

    if (formattedVerificationCode.length !== 6) {
      setVerificationFeedback({ type: "error", message: "Enter the full 6-digit code." });
      return;
    }

    setVerificationSubmitting(true);
    setVerificationFeedback({ type: "", message: "" });

    try {
      const res = await fetch("http://localhost:5000/api/auth/verify-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: formattedVerificationCode }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setVerificationFeedback({
          type: "error",
          message: data.error || "Verification failed.",
        });
        return;
      }

      setEmailVerified(Boolean(data.user?.email_verified));
      persistAuthSession({ user: data.user });
      setVerificationFeedback({ type: "success", message: "Email verified successfully." });
      setVerificationCode("");
    } catch (error) {
      console.error(error);
      setVerificationFeedback({ type: "error", message: "Verification request failed." });
    } finally {
      setVerificationSubmitting(false);
    }
  };

  const handleResendVerificationCode = async () => {
    const token = localStorage.getItem("token");
    if (!token || verificationResending) return;

    setVerificationResending(true);
    setVerificationFeedback({ type: "", message: "" });

    try {
      const res = await fetch("http://localhost:5000/api/auth/resend-verification", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setVerificationFeedback({
          type: "error",
          message: data.error || "Failed to resend code.",
        });
        return;
      }

      setVerificationFeedback({
        type: "success",
        message: data.message || "A new verification code was sent.",
      });
    } catch (error) {
      console.error(error);
      setVerificationFeedback({ type: "error", message: "Failed to resend code." });
    } finally {
      setVerificationResending(false);
    }
  };

  const handleSubmitHelpRequest = async () => {
    const token = localStorage.getItem("token");
    if (!token || helpSubmitting) return;

    const trimmedSubject = helpSubject.trim();
    const trimmedMessage = helpMessage.trim();

    if (trimmedSubject.length < 3) {
      setHelpFeedback({ type: "error", message: "Please add a short subject (at least 3 characters)." });
      return;
    }

    if (trimmedMessage.length < 8) {
      setHelpFeedback({ type: "error", message: "Please describe your issue in at least 8 characters." });
      return;
    }

    setHelpSubmitting(true);
    setHelpFeedback({ type: "", message: "" });

    try {
      const res = await fetch("http://localhost:5000/api/main/settings/help-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          subject: trimmedSubject,
          message: trimmedMessage,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setHelpFeedback({ type: "error", message: data.error || "Failed to submit request." });
        return;
      }

      setHelpFeedback({ type: "success", message: "Help request submitted. An admin will review it shortly." });
      setHelpSubject("");
      setHelpMessage("");
      setHelpRequests((prev) => [data.request, ...prev].slice(0, 20));
    } catch (error) {
      console.error(error);
      setHelpFeedback({ type: "error", message: "Failed to submit request." });
    } finally {
      setHelpSubmitting(false);
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-hero">
        <p className="settings-kicker">Control Deck</p>
        <h1>Settings</h1>
        <p className="settings-subtitle">
          Tune your Fruityger account, your screen mood, and how the app reaches you.
        </p>
      </div>

      <section className="settings-section">
        <div className="settings-section-header">
          <h2>Fruityger Account</h2>
          <p>Important account details with quick ways to update them.</p>
        </div>

        <div className="settings-list">
          <div className="settings-row">
            <div className="settings-row-copy">
              <span className="settings-row-label">Email</span>
              <span className="settings-row-value">{maskedEmail}</span>
              <span className={`settings-verify-status ${emailVerified ? "verified" : "unverified"}`}>
                {emailVerified ? "Verified" : "Not verified"}
              </span>
              {pendingEmail && (
                <span className="settings-row-pending">
                  Pending: {maskedPendingEmail}
                </span>
              )}
            </div>

            {pendingEmail ? (
              <div className="settings-row-actions">
                <button
                  type="button"
                  className="settings-row-btn"
                  onClick={() => navigate("/settings/confirm-email-change")}
                >
                  Enter code
                </button>

                <button
                  type="button"
                  className="settings-row-btn settings-row-btn-secondary"
                  onClick={handleCancelPendingEmailChange}
                >
                  Cancel changes
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="settings-row-btn"
                onClick={() => navigate("/settings/verify-current-password?action=email")}
              >
                Change
              </button>
            )}
          </div>

          {!emailVerified && (
            <div className="settings-verify-panel">
              <p className="settings-verify-title">Verify your email</p>
              <p className="settings-verify-subtitle">
                Enter the 6-digit code sent to your email. You can resend a new code anytime.
              </p>

              {verificationFeedback.message && (
                <div className={`settings-verify-feedback ${verificationFeedback.type}`}>
                  {verificationFeedback.message}
                </div>
              )}

              <div className="settings-verify-actions">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  className="settings-verify-input"
                  value={formattedVerificationCode}
                  onChange={(event) => {
                    setVerificationFeedback({ type: "", message: "" });
                    setVerificationCode(event.target.value);
                  }}
                />
                <button
                  type="button"
                  className="settings-row-btn"
                  onClick={handleVerifyEmail}
                  disabled={verificationSubmitting}
                >
                  {verificationSubmitting ? "Verifying..." : "Verify email"}
                </button>
                <button
                  type="button"
                  className="settings-row-btn settings-row-btn-secondary"
                  onClick={handleResendVerificationCode}
                  disabled={verificationResending}
                >
                  {verificationResending ? "Sending..." : "Resend code"}
                </button>
              </div>
            </div>
          )}

          <div className="settings-row">
            <div className="settings-row-copy">
              <span className="settings-row-label">Password</span>
              <span className="settings-row-value">{maskPassword()}</span>
            </div>

            <button
              type="button"
              className="settings-row-btn"
              onClick={() => navigate("/settings/verify-current-password?action=password")}
            >
              Change
            </button>
          </div>
        </div>

        <button
          type="button"
          className="settings-more-btn"
          onClick={() => navigate("/settings/danger")}
        >
          More options
        </button>
      </section>

      <section className="settings-section">
        <div className="settings-section-header">
          <h2>Appearance</h2>
          <p>Choose how the app feels on your screen.</p>
        </div>

        <div className="theme-toggle">
          <button
            type="button"
            className={`theme-chip ${theme === "light" ? "active" : ""}`}
            onClick={() => setTheme("light")}
          >
            Light
          </button>

          <button
            type="button"
            className={`theme-chip ${theme === "dark" ? "active" : ""}`}
            onClick={() => setTheme("dark")}
          >
            Dark
          </button>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-header">
          <h2>Notifications</h2>
          <p>Pick which updates you want us to surface.</p>
        </div>

        <div className="settings-toggle-list">
          <label className="settings-toggle-row">
            <span className="settings-toggle-text">Email newsletter</span>
            <input
              type="checkbox"
              checked={newsletterEnabled}
              disabled={notificationSaving}
              onChange={(event) =>
                updateNotificationPreferences(event.target.checked, pushEnabled)
              }
            />
            <span className="settings-toggle-ui" aria-hidden="true"></span>
          </label>

          <label className="settings-toggle-row">
            <span className="settings-toggle-text">Push notifications</span>
            <input
              type="checkbox"
              checked={pushEnabled}
              disabled={notificationSaving}
              onChange={(event) =>
                updateNotificationPreferences(newsletterEnabled, event.target.checked)
              }
            />
            <span className="settings-toggle-ui" aria-hidden="true"></span>
          </label>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-header">
          <h2>Help Center</h2>
          <p>Need assistance? Send your concern and our admin team will respond.</p>
        </div>

        <div className="settings-help-form">
          {helpFeedback.message && (
            <div className={`settings-verify-feedback ${helpFeedback.type}`}>
              {helpFeedback.message}
            </div>
          )}

          <input
            type="text"
            className="settings-help-input"
            placeholder="Subject (e.g. Can't upload profile photo)"
            value={helpSubject}
            onChange={(event) => {
              setHelpFeedback({ type: "", message: "" });
              setHelpSubject(event.target.value);
            }}
          />
          <textarea
            className="settings-help-textarea"
            placeholder="Tell us what happened and what you need help with."
            value={helpMessage}
            onChange={(event) => {
              setHelpFeedback({ type: "", message: "" });
              setHelpMessage(event.target.value);
            }}
          />
          <button
            type="button"
            className="settings-row-btn"
            disabled={helpSubmitting}
            onClick={handleSubmitHelpRequest}
          >
            {helpSubmitting ? "Sending..." : "Send to Admin"}
          </button>
        </div>

        {helpRequests.length > 0 && (
          <div className="settings-help-history">
            <p className="settings-verify-title">Your recent requests</p>
            <div className="settings-list">
              {helpRequests.map((request) => (
                <div key={request.id} className="settings-row settings-help-row">
                  <div className="settings-row-copy">
                    <span className="settings-row-label">{request.subject}</span>
                    <span className="settings-row-value">{request.message}</span>
                    <span className="settings-row-pending">
                      Status: {String(request.status || "open").replace(/_/g, " ")}
                    </span>
                    {request.admin_response && (
                      <span className="settings-help-response">
                        Admin response: {request.admin_response}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
