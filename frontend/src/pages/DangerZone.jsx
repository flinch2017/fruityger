import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/DangerZone.css";
import { clearAuthStorage } from "../utils/authSession";

export default function DangerZone() {
  const navigate = useNavigate();
  const username = localStorage.getItem("username") || "your account";

  const [deactivateInput, setDeactivateInput] = useState("");
  const [deleteInput, setDeleteInput] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [feedback, setFeedback] = useState({ type: "", message: "" });

  const canDeactivate = useMemo(
    () => deactivateInput.trim().toUpperCase() === "DEACTIVATE",
    [deactivateInput]
  );
  const canDelete = useMemo(
    () => deleteInput.trim() === username,
    [deleteInput, username]
  );

  const runDangerAction = async (endpoint, method, successMessage, actionKey) => {
    const token = localStorage.getItem("token");
    if (!token) {
      navigate("/login", { replace: true });
      return;
    }

    setBusyAction(actionKey);
    setFeedback({ type: "", message: "" });

    try {
      const res = await fetch(`http://localhost:5000${endpoint}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "That account action could not be completed.");
      }

      setFeedback({ type: "success", message: successMessage });
      clearAuthStorage();
      setTimeout(() => {
        navigate("/", { replace: true });
      }, 650);
    } catch (error) {
      console.error(error);
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
          These options affect your entire Fruityger account. Deactivation hides your
          access for now. Deletion permanently removes the account.
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
              This disables sign-in for this account and removes it from normal profile
              access until you decide otherwise later on the backend side.
            </p>
          </div>

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
            onClick={() =>
              runDangerAction(
                "/api/auth/deactivate-account",
                "POST",
                "Account deactivated. Redirecting you out of Fruityger...",
                "deactivate"
              )
            }
          >
            {busyAction === "deactivate" ? "Deactivating..." : "Deactivate account"}
          </button>
        </section>

        <section className="danger-card danger-card-delete">
          <div className="danger-card-copy">
            <p className="danger-card-eyebrow">Permanent removal</p>
            <h2>Delete account</h2>
            <p>
              This permanently removes <strong>@{username}</strong> and cannot be undone.
              Type your username exactly to confirm.
            </p>
          </div>

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
            onClick={() =>
              runDangerAction(
                "/api/auth/delete-account",
                "DELETE",
                "Account deleted. Redirecting you out of Fruityger...",
                "delete"
              )
            }
          >
            {busyAction === "delete" ? "Deleting..." : "Delete account"}
          </button>
        </section>
      </div>
    </div>
  );
}
