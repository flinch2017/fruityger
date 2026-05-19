import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "../css/Admin.css";

const getAdminToken = () => localStorage.getItem("adminToken");
const formatCreatedAt = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.toISOString()} (UTC)`;
};

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      setError("");
      try {
        const res = await fetch("http://localhost:5000/api/admin/dashboard", {
          headers: { Authorization: `Bearer ${getAdminToken()}` },
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(payload.error || "Failed to load dashboard");
          return;
        }
        setData(payload);
      } catch {
        setError("Failed to load dashboard");
      }
    };

    load();
  }, []);

  return (
    <div className="admin-shell">
      <div className="admin-card">
        <div className="admin-topbar">
          <h1>Admin Dashboard</h1>
          <div className="admin-links">
            <Link to="/admin/users">Users</Link>
            <Link to="/admin/reports">Reports</Link>
            <Link to="/admin/activity">Activity</Link>
          </div>
        </div>

        {error && <div className="admin-error">{error}</div>}

        <div className="admin-stats">
          <div className="admin-stat">
            <strong>{data?.stats?.users ?? "-"}</strong>
            <span>Total users</span>
          </div>
          <div className="admin-stat">
            <strong>{data?.stats?.posts ?? "-"}</strong>
            <span>Total posts</span>
          </div>
          <div className="admin-stat">
            <strong>{data?.stats?.reports ?? "-"}</strong>
            <span>Total reports</span>
          </div>
        </div>

        <h2>Latest users</h2>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Email</th>
                <th>Verified</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {(data?.latestUsers || []).map((user) => (
                <tr key={user.id}>
                  <td>{user.username}</td>
                  <td>{user.email}</td>
                  <td>{user.email_verified ? "Yes" : "No"}</td>
                  <td>{formatCreatedAt(user.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
