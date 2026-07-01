import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AeroNotice from "../components/AeroNotice";
import "../css/ReportPage.css";

const REPORT_REASONS = [
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Harassment" },
  { value: "sexual_abuse_exploitation", label: "Sexual abuse or exploitation" },
  { value: "offensive", label: "Offensive content" },
  { value: "misinformation", label: "Misinformation" },
  { value: "other", label: "Other" },
];

export default function ReportPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  const contentId = query.get("id");
  const contentType = query.get("type"); // 'comment'

  const [selectedReasons, setSelectedReasons] = useState([]);
  const [details, setDetails] = useState("");
  const [notice, setNotice] = useState(null);
  const token = localStorage.getItem("token");

  const toggleReason = (value) => {
    setSelectedReasons((prev) =>
      prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value]
    );
  };

  const submitReport = async () => {
    if (selectedReasons.length === 0) {
      setNotice({ type: "info", message: "Please select at least one reason." });
      return;
    }

    if (!contentType || !contentId) {
      setNotice({ type: "error", message: "Missing report target." });
      return;
    }

    try {
      const reason = selectedReasons.join(", ");
      const requestUrl =
        contentType === "message"
          ? "http://localhost:5000/api/messages/report"
          : contentType === "group-message"
            ? "http://localhost:5000/api/messages/groups/messages/report"
          : "http://localhost:5000/api/reports/submit";
      const requestBody =
        contentType === "message"
          ? {
              messageId: contentId,
              reason,
              details,
            }
          : contentType === "group-message"
            ? {
                messageId: contentId,
                reason,
                details,
              }
          : {
              contentType,
              contentId,
              reason,
              details,
            };

      const res = await fetch(requestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to report");

      setNotice({ type: "success", message: "Report submitted successfully." });
      window.setTimeout(() => navigate(-1), 900);
    } catch (err) {
      console.error(err);
      setNotice({ type: "error", message: err.message || "Failed to submit report." });
    }
  };

  const cancelReport = () => navigate(-1);

  return (
    <div className="report-page">
      <div className="report-card">
        <AeroNotice notice={notice ? { ...notice, inline: true } : null} onClose={() => setNotice(null)} />
        <h2 className="report-title">Report {contentType}</h2>
        <p className="report-subtitle">Select all reasons that apply</p>

        <div className="report-options">
          {REPORT_REASONS.map((option) => {
            const checked = selectedReasons.includes(option.value);

            return (
              <label
                key={option.value}
                className={`report-option ${checked ? "checked" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleReason(option.value)}
                />
                <span className="report-option-check" aria-hidden="true">
                  {checked ? "✓" : ""}
                </span>
                <span className="report-option-label">{option.label}</span>
              </label>
            );
          })}
        </div>

        <textarea
          className="report-textarea"
          placeholder="Additional details (optional)"
          value={details}
          onChange={(e) => setDetails(e.target.value)}
        />

        <div className="report-actions">
          <button className="cancel-btn" onClick={cancelReport}>
            Cancel
          </button>
          <button className="submit-btn" onClick={submitReport}>
            Submit Report
          </button>
        </div>
      </div>
    </div>
  );
}
