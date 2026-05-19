import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "../css/Admin.css";

const getAdminToken = () => localStorage.getItem("adminToken");

export default function AdminReports() {
  const [reports, setReports] = useState([]);
  const [error, setError] = useState("");

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
                <th>Created</th>
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
                  <td>{new Date(report.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
