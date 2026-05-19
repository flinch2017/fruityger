import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "../css/Admin.css";

const getAdminToken = () => localStorage.getItem("adminToken");

export default function AdminUsers() {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");

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

  return (
    <div className="admin-shell">
      <div className="admin-card">
        <div className="admin-topbar">
          <h1>Users</h1>
          <div className="admin-links">
            <Link to="/admin">Dashboard</Link>
            <Link to="/admin/reports">Reports</Link>
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
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.username}</td>
                  <td>{user.email}</td>
                  <td>{user.email_verified ? "Yes" : "No"}</td>
                  <td>{user.is_admin ? "Yes" : "No"}</td>
                  <td>{new Date(user.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
