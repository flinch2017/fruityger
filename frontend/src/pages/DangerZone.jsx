import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/DangerZone.css";
import { clearAuthStorage } from "../utils/authSession";

const ACTION_CONFIG = {
  deactivate: {
    purpose: "account-deactivate",
    successMessage: "Account deactivated. Log in again anytime to reactivate it.",
    verifyLabel: "Verify password",
    pendingVerifyLabel: "Verifying...",
    actionLabel: "Deactivate account",
    pendingActionLabel: "Deactivating...",
    endpoint: "/api/auth/deactivate-account",
    method: "POST",
  },
  delete: {
    purpose: "account-delete",
    successMessage: "Account deleted. You can recover it by logging in again within 30 days.",
    verifyLabel: "Verify password",
    pendingVerifyLabel: "Verifying...",
    actionLabel: "Delete account",
    pendingActionLabel: "Deleting...",
    endpoint: "/api/auth/delete-account",
    method: "DELETE",
  },
};

export default function DangerZone() {
  const navigate = useNavigate();
  const username = localStorage.getItem("username") || "your account";

  const [deactivatePassword, setDeactivatePassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deactivateInput, setDeactivateInput] = useState("");
  const [deleteInput, setDeleteInput] = useState("");
  const [deactivateApprovalToken, setDeactivateApprovalToken] = useState("");
  const [deleteApprovalToken, setDeleteApprovalToken] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [verifiedActions, setVerifiedActions] = useState({
    deactivate: false,
    delete: false,
  });

  const canDeactivate = useMemo(
    () => verifiedActions.deactivate && deactivateInput.trim().toUpperCase() === "DEACTIVATE",
    [deactivateInput, verifiedActions.deactivate]
  );
  const canDelete = useMemo(
    () => verifiedActions.delete && deleteInput.trim() === username,
    [deleteInput, username, verifiedActions.delete]
  );

  const getToken = () => {
    const token = localStorage.getItem("token");
    if (!token) {
      navigate("/login", { replace: true });
      return "";
    }
    return token;
  };

  const resetActionApproval = (actionKey) => {
    if (actionKey === "deactivate") {
      setDeactivateApprovalToken("");
      setVerifiedActions((current) => ({ ...current, deactivate: false }));
      return;
    }

    setDeleteApprovalToken("");
    setVerifiedActions((current) => ({ ...current, delete: false }));
  };

  const verifyPasswordForAction = async (actionKey, currentPassword) => {
    const token = getToken();
    if (!token) return;

    if (!currentPassword.trim()) {
      setFeedback({ type: "error", message: "Please enter your current password first." });
      return;
    }

    setBusyAction(`${actionKey}-verify`);
    setFeedback({ type: "", message: "" });

    try {
      const res = await fetch("http://localhost:5000/api/auth/verify-current-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          currentPassword,
          purpose: ACTION_CONFIG[actionKey].purpose,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "That account action could not be completed.");
      }

      if (actionKey === "deactivate") {
        setDeactivateApprovalToken(data.approvalToken || "");
      } else {
        setDeleteApprovalToken(data.approvalToken || "");
      }

      setVerifiedActions((current) => ({ ...current, [actionKey]: true }));
      setFeedback({
        type: "success",
        message: "Password confirmed. You can finish this account action now.",
      });
    } catch (error) {
      console.error(error);
      resetActionApproval(actionKey);
      setFeedback({
        type: "error",
        message: error.message || "We could not verify your current password.",
      });
    } finally {
      setBusyAction("");
    }
  };

  const runDangerAction = async (actionKey) => {
    const token = getToken();
    if (!token) return;

    const approvalToken =
      actionKey === "deactivate" ? deactivateApprovalToken : deleteApprovalToken;

    setBusyAction(actionKey);
    setFeedback({ type: "", message: "" });

    try {
      const res = await fetch(`http://localhost:5000${ACTION_CONFIG[actionKey].endpoint}`, {
        method: ACTION_CONFIG[actionKey].method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ approvalToken }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "That account action could not be completed.");
      }

      setFeedback({ type: "success", message: ACTION_CONFIG[actionKey].successMessage });
      clearAuthStorage();
      setTimeout(() => {
        navigate("/", { replace: true });
      }, 650);
    } catch (error) {
      console.error(error);
      resetActionApproval(actionKey);
      setFeedback({
        type: "error",
        message: error.message || "That account action could not be completed.",
      });
    } finally {
      setBusyAction("");
    }
  };

  return (
    <div className="danger-page">
      <div className="danger-hero">
        <p className="danger-kicker">Account Control</p>
        <h1>Danger Zone</h1>
        <p className="danger-subtitle">
          These options affect your entire Fruityger account. Deactivation pauses your
          access until you log in again. Deletion starts a 30-day recovery window before
          the account is gone for good.
        </p>
      </div>

      {feedback.message && (
        <div className={`danger-feedback ${feedback.type}`}>{feedback.message}</div>
      )}

      <div className="danger-grid">
        <section className="danger-card">
          <div className="danger-card-copy">
            <p className="danger-card-eyebrow">Pause everything</p>
            <h2>Deactivate account</h2>
            <p>
              This hides your account and signs you out for now. Logging in again later
              will reactivate it automatically.
            </p>
          </div>

          <label className="danger-confirm">
            <span>Enter your current password first</span>
            <input
              type="password"
              value={deactivatePassword}
              onChange={(event) => {
                setDeactivatePassword(event.target.value);
                if (deactivateApprovalToken) {
                  resetActionApproval("deactivate");
                }
              }}
              placeholder="Current password"
              autoComplete="current-password"
            />
          </label>

          <button
            type="button"
            className="danger-secondary-btn"
            disabled={
              !deactivatePassword.trim() ||
              busyAction === "deactivate" ||
              busyAction === "delete" ||
              busyAction === "deactivate-verify"
            }
            onClick={() => verifyPasswordForAction("deactivate", deactivatePassword)}
          >
            {busyAction === "deactivate-verify"
              ? ACTION_CONFIG.deactivate.pendingVerifyLabel
              : verifiedActions.deactivate
                ? "Password confirmed"
                : ACTION_CONFIG.deactivate.verifyLabel}
          </button>

          <label className="danger-confirm">
            <span>Type <strong>DEACTIVATE</strong> to continue</span>
            <input
              type="text"
              value={deactivateInput}
              onChange={(event) => setDeactivateInput(event.target.value)}
              placeholder="DEACTIVATE"
              autoComplete="off"
            />
          </label>

          <button
            type="button"
            className="danger-action-btn danger-action-warn"
            disabled={!canDeactivate || busyAction === "delete" || busyAction === "deactivate"}
            onClick={() => runDangerAction("deactivate")}
          >
            {busyAction === "deactivate"
              ? ACTION_CONFIG.deactivate.pendingActionLabel
              : ACTION_CONFIG.deactivate.actionLabel}
          </button>
        </section>

        <section className="danger-card danger-card-delete">
          <div className="danger-card-copy">
            <p className="danger-card-eyebrow">Permanent removal</p>
            <h2>Delete account</h2>
            <p>
              This starts deletion for <strong>@{username}</strong>. You can still recover
              the account by logging back in within 30 days. After that, it is gone for
              good. Type your username exactly to confirm.
            </p>
          </div>

          <label className="danger-confirm">
            <span>Enter your current password first</span>
            <input
              type="password"
              value={deletePassword}
              onChange={(event) => {
                setDeletePassword(event.target.value);
                if (deleteApprovalToken) {
                  resetActionApproval("delete");
                }
              }}
              placeholder="Current password"
              autoComplete="current-password"
            />
          </label>

          <button
            type="button"
            className="danger-secondary-btn"
            disabled={
              !deletePassword.trim() ||
              busyAction === "deactivate" ||
              busyAction === "delete" ||
              busyAction === "delete-verify"
            }
            onClick={() => verifyPasswordForAction("delete", deletePassword)}
          >
            {busyAction === "delete-verify"
              ? ACTION_CONFIG.delete.pendingVerifyLabel
              : verifiedActions.delete
                ? "Password confirmed"
                : ACTION_CONFIG.delete.verifyLabel}
          </button>

          <label className="danger-confirm">
            <span>
              Type <strong>{username}</strong> to continue
            </span>
            <input
              type="text"
              value={deleteInput}
              onChange={(event) => setDeleteInput(event.target.value)}
              placeholder={username}
              autoComplete="off"
            />
          </label>

          <button
            type="button"
            className="danger-action-btn danger-action-delete"
            disabled={!canDelete || busyAction === "delete" || busyAction === "deactivate"}
            onClick={() => runDangerAction("delete")}
          >
            {busyAction === "delete"
              ? ACTION_CONFIG.delete.pendingActionLabel
              : ACTION_CONFIG.delete.actionLabel}
          </button>
        </section>
      </div>
    </div>
  );
}
