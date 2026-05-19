import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "../css/Admin.css";

const getAdminToken = () => localStorage.getItem("adminToken");

export default function AdminReports() {
  const [reports, setReports] = useState([]);
  const [error, setError] = useState("");
  const [busyReportId, setBusyReportId] = useState("");

  useEffect(() => {
    const load = async () => {
      setError("");
      try {
        const res = await fetch("http://localhost:5000/api/admin/reports", {
          headers: { Authorization: `Bearer ${getAdminToken()}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "Failed to load reports");
          return;
        }
        setReports(data.reports || []);
      } catch {
        setError("Failed to load reports");
      }
    };
    load();
  }, []);

  const resolveReport = async (reportId, action = "resolved") => {
    setBusyReportId(reportId);
    setError("");

    try {
      const res = await fetch(`http://localhost:5000/api/admin/reports/${reportId}/resolve`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${getAdminToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed to resolve report");
        return;
      }

      setReports((prev) =>
        prev.map((item) =>
          item.id === reportId
            ? {
                ...item,
                resolved_at: data.report?.resolved_at || new Date().toISOString(),
                resolution_action: data.report?.resolution_action || action,
              }
            : item
        )
      );
    } catch {
      setError("Failed to resolve report");
    } finally {
      setBusyReportId("");
    }
  };

  const deleteReportedPost = async (report) => {
    if (String(report.content_type || "").toLowerCase() !== "post" || !report.content_id) {
      return;
    }

    setBusyReportId(report.id);
    setError("");

    try {
      const deleteRes = await fetch(`http://localhost:5000/api/admin/posts/${report.content_id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${getAdminToken()}` },
      });
      const deleteData = await deleteRes.json().catch(() => ({}));
      if (!deleteRes.ok) {
        setError(deleteData.error || "Failed to delete post");
        return;
      }

      await resolveReport(report.id, "deleted_post");
    } catch {
      setError("Failed to delete post");
    } finally {
      setBusyReportId("");
    }
  };

  return (
    <div className="admin-shell">
      <div className="admin-card">
        <div className="admin-topbar">
          <h1>Reports</h1>
          <div className="admin-links">
            <Link to="/admin">Dashboard</Link>
            <Link to="/admin/users">Users</Link>
          </div>
        </div>

        {error && <div className="admin-error">{error}</div>}

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Reporter</th>
                <th>Type</th>
                <th>Content ID</th>
                <th>Reason</th>
                <th>Details</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id}>
                  <td>{report.reporter_id}</td>
                  <td>{report.content_type}</td>
                  <td>{report.content_id}</td>
                  <td>{report.reason}</td>
                  <td>{report.details || "-"}</td>
                  <td>{report.resolved_at ? `Resolved (${report.resolution_action || "resolved"})` : "Open"}</td>
                  <td>{new Date(report.created_at).toLocaleString()}</td>
                  <td>
                    {!report.resolved_at && (
                      <>
                        <button
                          type="button"
                          className="admin-inline-btn"
                          disabled={busyReportId === report.id}
                          onClick={() => resolveReport(report.id, "resolved")}
                        >
                          {busyReportId === report.id ? "Saving..." : "Resolve"}
                        </button>
                        {String(report.content_type || "").toLowerCase() === "post" && (
                          <button
                            type="button"
                            className="admin-inline-btn admin-danger-btn"
                            disabled={busyReportId === report.id}
                            onClick={() => deleteReportedPost(report)}
                          >
                            Delete post
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
