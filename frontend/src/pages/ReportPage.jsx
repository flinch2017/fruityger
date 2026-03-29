import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "../css/ReportPage.css";

export default function ReportPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  const contentId = query.get("id");
  const contentType = query.get("type"); // 'comment'

  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const token = localStorage.getItem("token");
  const reporterId = localStorage.getItem("userId");

  const submitReport = async () => {
    if (!reason) return alert("Please select a reason");

    try {
      const res = await fetch("http://localhost:5000/api/reports/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reporterId,
          contentType,
          contentId,
          reason,
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

        <select
          className="report-select"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        >
          <option value="">Select reason</option>
          <option value="spam">Spam</option>
          <option value="harassment">Harassment</option>
          <option value="offensive">Offensive content</option>
          <option value="other">Other</option>
        </select>

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