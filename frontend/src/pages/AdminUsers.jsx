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

export default function AdminUsers() {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [busyUserId, setBusyUserId] = useState("");

  const loadUsers = async (search = "") => {
    setError("");
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      const res = await fetch(`http://localhost:5000/api/admin/users?${params.toString()}`, {
        headers: { Authorization: `Bearer ${getAdminToken()}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed to load users");
        return;
      }
      setUsers(data.users || []);
    } catch {
      setError("Failed to load users");
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleBanToggle = async (user) => {
    const isBanned = Boolean(user.deactivated_at);
    const endpoint = isBanned ? "unban" : "ban";
    setBusyUserId(user.id);
    setError("");

    try {
      const res = await fetch(`http://localhost:5000/api/admin/users/${user.id}/${endpoint}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${getAdminToken()}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed to update user status");
        return;
      }

      setUsers((prev) =>
        prev.map((item) =>
          item.id === user.id
            ? { ...item, deactivated_at: isBanned ? null : new Date().toISOString() }
            : item
        )
      );
    } catch {
      setError("Failed to update user status");
    } finally {
      setBusyUserId("");
    }
  };

  return (
    <div className="admin-shell">
      <div className="admin-card">
        <div className="admin-topbar">
          <h1>Users</h1>
          <div className="admin-links">
            <Link to="/admin">Dashboard</Link>
            <Link to="/admin/reports">Reports</Link>
            <Link to="/admin/activity">Activity</Link>
          </div>
        </div>

        <form
          className="admin-search"
          onSubmit={(event) => {
            event.preventDefault();
            loadUsers(q.trim());
          }}
        >
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search username or email"
          />
          <button type="submit">Search</button>
        </form>

        {error && <div className="admin-error">{error}</div>}

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Email</th>
                <th>Verified</th>
                <th>Admin</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.username}</td>
                  <td>{user.email}</td>
                  <td>{user.email_verified ? "Yes" : "No"}</td>
                  <td>{user.is_admin ? "Yes" : "No"}</td>
                  <td>{user.deactivated_at ? "Banned" : "Active"}</td>
                  <td>{formatCreatedAt(user.created_at)}</td>
                  <td>
                    <button
                      type="button"
                      className="admin-inline-btn"
                      disabled={busyUserId === user.id}
                      onClick={() => handleBanToggle(user)}
                    >
                      {busyUserId === user.id
                        ? "Saving..."
                        : user.deactivated_at
                          ? "Unban"
                          : "Ban"}
                    </button>
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
