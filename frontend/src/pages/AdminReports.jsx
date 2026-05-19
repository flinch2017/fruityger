import { useEffect, useState } from "react";
import AdminNav from "../components/AdminNav";
import "../css/Admin.css";

const getAdminToken = () => localStorage.getItem("adminToken");
const formatBytes = (value) => {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

export default function AdminReports() {
  const [reports, setReports] = useState([]);
  const [error, setError] = useState("");
  const [busyReportId, setBusyReportId] = useState("");
  const [unresolvedOnly, setUnresolvedOnly] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ totalPages: 1, total: 0 });

  const loadReports = async (nextPage = 1, nextUnresolvedOnly = unresolvedOnly) => {
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: "20",
        unresolved: String(nextUnresolvedOnly),
      });
      const res = await fetch(`http://localhost:5000/api/admin/reports?${params.toString()}`, {
        headers: { Authorization: `Bearer ${getAdminToken()}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed to load reports");
        return;
      }
      setReports(data.reports || []);
      setPagination(data.pagination || { totalPages: 1, total: 0 });
      setPage(nextPage);
    } catch {
      setError("Failed to load reports");
    }
  };

  useEffect(() => {
    loadReports(1, unresolvedOnly);
  }, [unresolvedOnly]);

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
      loadReports(page, unresolvedOnly);
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
      loadReports(page, unresolvedOnly);
    } catch {
      setError("Failed to delete post");
    } finally {
      setBusyReportId("");
    }
  };

  return (
    <div className="admin-shell">
      <div className="admin-card">
        <AdminNav title="Reports" />

        <div className="admin-toolbar">
          <label className="admin-filter">
            <input
              type="checkbox"
              checked={unresolvedOnly}
              onChange={(event) => {
                setPage(1);
                setUnresolvedOnly(event.target.checked);
              }}
            />
            Unresolved only
          </label>
          <span>{`Total: ${pagination.total || 0}`}</span>
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
                <th>Preview</th>
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
                  <td>
                    <div className="admin-preview-cell">
                      <div>{report.preview?.text || "(Content unavailable or deleted)"}</div>
                      {report.preview?.media_url && (
                        <a
                          href={report.preview.media_url}
                          target="_blank"
                          rel="noreferrer"
                          className="admin-media-link"
                        >
                          Open media
                        </a>
                      )}
                      {report.preview?.attachment_name && (
                        <div className="admin-file-meta">
                          {report.preview.attachment_name}
                          {report.preview.attachment_mime ? ` (${report.preview.attachment_mime})` : ""}
                          {report.preview.attachment_size ? ` • ${formatBytes(report.preview.attachment_size)}` : ""}
                        </div>
                      )}
                      {report.preview?.media_url && report.preview?.media_type === "image" && (
                        <img
                          src={report.preview.media_url}
                          alt="Reported media preview"
                          className="admin-media-thumb"
                        />
                      )}
                      {report.preview?.media_url && report.preview?.media_type === "video" && (
                        <video
                          src={report.preview.media_url}
                          className="admin-media-thumb"
                          controls
                          preload="metadata"
                        />
                      )}
                    </div>
                  </td>
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
        <div className="admin-pagination">
          <button type="button" disabled={page <= 1} onClick={() => loadReports(page - 1, unresolvedOnly)}>
            Previous
          </button>
          <span>{`Page ${page} of ${pagination.totalPages || 1}`}</span>
          <button
            type="button"
            disabled={page >= (pagination.totalPages || 1)}
            onClick={() => loadReports(page + 1, unresolvedOnly)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
