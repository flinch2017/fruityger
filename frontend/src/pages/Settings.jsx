import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/Settings.css";
import { persistAuthSession } from "../utils/authSession";
import { applyTheme } from "../utils/theme";
import { createPasskeyCredential } from "../utils/webauthn";

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
  const [theme, setTheme] = useState(() => localStorage.getItem("appearanceTheme") || "light");
  const [newsletterEnabled, setNewsletterEnabled] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [privateProfile, setPrivateProfile] = useState(false);
  const [privacySaving, setPrivacySaving] = useState(false);
  const [passkeys, setPasskeys] = useState([]);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyFeedback, setPasskeyFeedback] = useState({ type: "", message: "" });

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
    const fetchPrivacySettings = async () => {
      const token = localStorage.getItem("token");
      if (!token) return;

      try {
        const res = await fetch("http://localhost:5000/api/main/settings/privacy", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;

        setPrivateProfile(Boolean(data.isPrivate));
      } catch (error) {
        console.error(error);
      }
    };

    fetchPrivacySettings();
  }, []);

  useEffect(() => {
    sessionStorage.removeItem("accountChangeApprovalToken");
    sessionStorage.removeItem("accountChangePurpose");
  }, []);

  const maskedEmail = useMemo(() => maskEmail(email), [email]);

  const loadPasskeys = async () => {
    const token = localStorage.getItem("token");
    if (!token) return;

    try {
      const res = await fetch("http://localhost:5000/api/auth/passkeys", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to load passkeys");
      }

      setPasskeys(Array.isArray(data.passkeys) ? data.passkeys : []);
    } catch (error) {
      console.error(error);
      setPasskeyFeedback({ type: "error", message: error.message || "Failed to load passkeys." });
    }
  };

  useEffect(() => {
    loadPasskeys();
  }, []);

  const handleAddPasskey = async () => {
    const token = localStorage.getItem("token");
    if (!token || passkeyBusy) return;

    setPasskeyBusy(true);
    setPasskeyFeedback({ type: "", message: "" });

    try {
      const optionsRes = await fetch("http://localhost:5000/api/auth/passkeys/register/options", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const optionsData = await optionsRes.json().catch(() => ({}));
      if (!optionsRes.ok) {
        throw new Error(optionsData.error || "Couldn't start passkey setup.");
      }

      const credential = await createPasskeyCredential(optionsData.options);

      const verifyRes = await fetch("http://localhost:5000/api/auth/passkeys/register/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          credential,
          name: "Fruityger passkey",
        }),
      });

      const verifyData = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok) {
        throw new Error(verifyData.error || "Couldn't save this passkey.");
      }

      setPasskeys((current) => [verifyData.passkey, ...current.filter((item) => item.id !== verifyData.passkey.id)]);
      setPasskeyFeedback({ type: "success", message: "Passkey added. You can use it for password recovery." });
    } catch (error) {
      console.error(error);
      setPasskeyFeedback({ type: "error", message: error.message || "Passkey setup failed." });
    } finally {
      setPasskeyBusy(false);
    }
  };

  const handleRemovePasskey = async (passkeyId) => {
    const token = localStorage.getItem("token");
    if (!token || passkeyBusy) return;

    setPasskeyBusy(true);
    setPasskeyFeedback({ type: "", message: "" });

    try {
      const res = await fetch(`http://localhost:5000/api/auth/passkeys/${passkeyId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Couldn't remove this passkey.");
      }

      setPasskeys((current) => current.filter((item) => item.id !== passkeyId));
      setPasskeyFeedback({ type: "success", message: "Passkey removed." });
    } catch (error) {
      console.error(error);
      setPasskeyFeedback({ type: "error", message: error.message || "Couldn't remove this passkey." });
    } finally {
      setPasskeyBusy(false);
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

  const updatePrivacyPreference = async (nextPrivateProfile) => {
    const token = localStorage.getItem("token");
    if (!token || privacySaving) {
      return;
    }

    const previousPrivateProfile = privateProfile;
    setPrivateProfile(nextPrivateProfile);
    setPrivacySaving(true);

    try {
      const res = await fetch("http://localhost:5000/api/main/settings/privacy", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          isPrivate: nextPrivateProfile,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Failed to update privacy settings");
      }

      setPrivateProfile(Boolean(data.isPrivate));
      if (data.user) {
        persistAuthSession({ user: data.user });
      }
    } catch (error) {
      console.error(error);
      setPrivateProfile(previousPrivateProfile);
    } finally {
      setPrivacySaving(false);
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
            </div>

            <button
              type="button"
              className="settings-row-btn"
              onClick={() => navigate("/settings/verify-current-password?action=email")}
            >
              Change
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

          <div className="settings-row settings-passkey-row">
            <div className="settings-row-copy">
              <span className="settings-row-label">Passkeys</span>
              <span className="settings-row-value">
                {passkeys.length
                  ? `${passkeys.length} passkey${passkeys.length === 1 ? "" : "s"} ready for password recovery`
                  : "Add a passkey to reset your password without email codes"}
              </span>
            </div>

            <button
              type="button"
              className="settings-row-btn"
              onClick={handleAddPasskey}
              disabled={passkeyBusy}
            >
              {passkeyBusy ? "Working..." : "Add passkey"}
            </button>
          </div>

          {passkeyFeedback.message && (
            <div className={`settings-verify-feedback ${passkeyFeedback.type}`}>
              {passkeyFeedback.message}
            </div>
          )}

          {passkeys.map((passkey) => (
            <div key={passkey.id} className="settings-row settings-passkey-item">
              <div className="settings-row-copy">
                <span className="settings-row-label">{passkey.name || "Passkey"}</span>
                <span className="settings-row-value">
                  Added {passkey.created_at ? new Date(passkey.created_at).toLocaleDateString() : "recently"}
                </span>
              </div>

              <button
                type="button"
                className="settings-row-btn settings-row-btn-secondary"
                onClick={() => handleRemovePasskey(passkey.id)}
                disabled={passkeyBusy}
              >
                Remove
              </button>
            </div>
          ))}
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
              id="newsletter-enabled"
              name="newsletterEnabled"
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
              id="push-enabled"
              name="pushEnabled"
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
          <h2>Privacy</h2>
          <p>Private profiles require approval before new people can see your posts and reposts.</p>
        </div>

        <div className="settings-toggle-list">
          <label className="settings-toggle-row">
            <span className="settings-toggle-text">Private profile</span>
            <input
              id="private-profile"
              name="privateProfile"
              type="checkbox"
              checked={privateProfile}
              disabled={privacySaving}
              onChange={(event) => updatePrivacyPreference(event.target.checked)}
            />
            <span className="settings-toggle-ui" aria-hidden="true"></span>
          </label>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-header">
          <h2>Help Center</h2>
          <p>Need assistance? Open the user help center to send a concern and track replies.</p>
        </div>

        <div className="settings-list">
          <div className="settings-row">
            <div className="settings-row-copy">
              <span className="settings-row-label">User Help Center</span>
              <span className="settings-row-value">
                Submit a support request or review admin responses.
              </span>
            </div>

            <button
              type="button"
              className="settings-row-btn"
              onClick={() => navigate("/help-center")}
            >
              Open
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
