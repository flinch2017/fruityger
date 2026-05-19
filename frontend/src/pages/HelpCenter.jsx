import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/Settings.css";

export default function HelpCenter() {
  const navigate = useNavigate();
  const [helpSubject, setHelpSubject] = useState("");
  const [helpMessage, setHelpMessage] = useState("");
  const [helpSubmitting, setHelpSubmitting] = useState(false);
  const [helpFeedback, setHelpFeedback] = useState({ type: "", message: "" });
  const [helpRequests, setHelpRequests] = useState([]);

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
        <p className="settings-kicker">User Support</p>
        <h1>Help Center</h1>
        <p className="settings-subtitle">
          Send your concern to the Fruityger admin team and keep track of recent responses.
        </p>
      </div>

      <section className="settings-section">
        <div className="settings-section-header">
          <h2>Contact Admin</h2>
          <p>Share what happened, what you expected, and any detail that can help us review it faster.</p>
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
          <div className="settings-row-actions settings-help-actions">
            <button
              type="button"
              className="settings-row-btn"
              disabled={helpSubmitting}
              onClick={handleSubmitHelpRequest}
            >
              {helpSubmitting ? "Sending..." : "Send to Admin"}
            </button>
            <button
              type="button"
              className="settings-row-btn settings-row-btn-secondary"
              onClick={() => navigate("/settings")}
            >
              Back to Settings
            </button>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-header">
          <h2>Your Recent Requests</h2>
          <p>Review the latest support tickets and admin responses linked to your account.</p>
        </div>

        {helpRequests.length > 0 ? (
          <div className="settings-help-history">
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
        ) : (
          <div className="settings-empty-state">No help requests yet.</div>
        )}
      </section>
    </div>
  );
}
