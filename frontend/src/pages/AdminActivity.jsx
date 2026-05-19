import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "../css/Admin.css";

const getAdminToken = () => localStorage.getItem("adminToken");

export default function AdminActivity() {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ totalPages: 1, total: 0 });

  const loadLogs = async (nextPage = 1) => {
    setError("");
    try {
      const params = new URLSearchParams({ page: String(nextPage), limit: "20" });
      const res = await fetch(`http://localhost:5000/api/admin/activity?${params.toString()}`, {
        headers: { Authorization: `Bearer ${getAdminToken()}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed to load activity logs");
        return;
      }
      setLogs(data.logs || []);
      setPagination(data.pagination || { totalPages: 1, total: 0 });
      setPage(nextPage);
    } catch {
      setError("Failed to load activity logs");
    }
  };

  useEffect(() => {
    loadLogs(1);
  }, []);

  return (
    <div className="admin-shell">
      <div className="admin-card">
        <div className="admin-topbar">
          <h1>Admin Activity</h1>
          <div className="admin-links">
            <Link to="/admin">Dashboard</Link>
            <Link to="/admin/reports">Reports</Link>
          </div>
        </div>

        {error && <div className="admin-error">{error}</div>}

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Admin</th>
                <th>Action</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{new Date(log.created_at).toLocaleString()}</td>
                  <td>{log.admin_username || log.admin_email || log.admin_id}</td>
                  <td>{log.action_type}</td>
                  <td>{`${log.target_type}:${log.target_id}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="admin-pagination">
          <button type="button" disabled={page <= 1} onClick={() => loadLogs(page - 1)}>
            Previous
          </button>
          <span>{`Page ${page} of ${pagination.totalPages || 1}`}</span>
          <button
            type="button"
            disabled={page >= (pagination.totalPages || 1)}
            onClick={() => loadLogs(page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
