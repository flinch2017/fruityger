import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "../css/ReportPage.css";

const REPORT_REASONS = [
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Harassment" },
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
  const token = localStorage.getItem("token");

  const toggleReason = (value) => {
    setSelectedReasons((prev) =>
      prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value]
    );
  };

  const submitReport = async () => {
    if (selectedReasons.length === 0) return alert("Please select at least one reason");
    if (!contentType || !contentId) return alert("Missing report target");

    try {
      const res = await fetch("http://localhost:5000/api/reports/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          contentType,
          contentId,
          reason: selectedReasons.join(", "),
          details,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to report");

      alert("Report submitted successfully!");
      navigate(-1); // go back to previous page
    } catch (err) {
      console.error(err);
      alert(err.message);
    }
  };

  const cancelReport = () => navigate(-1);

  return (
    <div className="report-page">
      <div className="report-card">
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
