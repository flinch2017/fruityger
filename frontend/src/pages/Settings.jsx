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
              {pendingEmail && (
                <span className="settings-row-pending">
                  Pending: {maskedPendingEmail}
                </span>
              )}
            </div>

            <button
              type="button"
              className="settings-row-btn"
              onClick={() =>
                pendingEmail
                  ? handleCancelPendingEmailChange()
                  : navigate("/settings/verify-current-password?action=email")
              }
            >
              {pendingEmail ? "Cancel changes" : "Change"}
            </button>
          </div>

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
    </div>
  );
}
