import { useEffect, useState } from "react";
import AdminNav from "../components/AdminNav";
import "../css/Admin.css";

const getAdminToken = () => localStorage.getItem("adminToken");
const formatCreatedAt = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.toISOString()} (UTC)`;
};

const formatBirthDate = (value) => {
  if (!value) return "-";
  const normalized = String(value);
  return normalized.includes("T") ? normalized.split("T")[0] : normalized;
};

export default function AdminUsers() {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [busyUserId, setBusyUserId] = useState("");
  const [busyAction, setBusyAction] = useState("");

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
    const isBanned = Boolean(user.admin_banned_at);
    const endpoint = isBanned ? "unban" : "ban";
    setBusyUserId(user.id);
    setBusyAction(endpoint);
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
            ? {
                ...item,
                deactivated_at: data.user?.deactivated_at || (isBanned ? null : new Date().toISOString()),
                admin_banned_at: data.user?.admin_banned_at || (isBanned ? null : new Date().toISOString()),
              }
            : item
        )
      );
    } catch {
      setError("Failed to update user status");
    } finally {
      setBusyUserId("");
      setBusyAction("");
    }
  };

  const handleVerificationBadgeToggle = async (user) => {
    const nextVerified = !user.is_verified;
    setBusyUserId(user.id);
    setBusyAction("verification-badge");
    setError("");

    try {
      const res = await fetch(`http://localhost:5000/api/admin/users/${user.id}/verification-badge`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getAdminToken()}`,
        },
        body: JSON.stringify({ verified: nextVerified }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed to update verification badge");
        return;
      }

      setUsers((prev) =>
        prev.map((item) =>
          item.id === user.id
            ? {
                ...item,
                is_verified: Boolean(data.user?.is_verified),
              }
            : item
        )
      );
    } catch {
      setError("Failed to update verification badge");
    } finally {
      setBusyUserId("");
      setBusyAction("");
    }
  };

  const handleDeleteUser = async (user) => {
    const confirmed = window.confirm(
      `Delete @${user.username}? This will deactivate and hide the account from the app.`
    );
    if (!confirmed) return;

    setBusyUserId(user.id);
    setBusyAction("delete");
    setError("");

    try {
      const res = await fetch(`http://localhost:5000/api/admin/users/${user.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${getAdminToken()}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed to delete user");
        return;
      }

      setUsers((prev) => prev.filter((item) => item.id !== user.id));
    } catch {
      setError("Failed to delete user");
    } finally {
      setBusyUserId("");
      setBusyAction("");
    }
  };

  return (
    <div className="admin-shell">
      <div className="admin-card">
        <AdminNav title="Users" />

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
                <th>User ID</th>
                <th>Username</th>
                <th>Email</th>
                <th>Birthdate</th>
                <th>Verified</th>
                <th>Badge</th>
                <th>Admin</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.id}</td>
                  <td>{user.username}</td>
                  <td>{user.email}</td>
                  <td>{formatBirthDate(user.birth_date)}</td>
                  <td>{user.email_verified ? "Yes" : "No"}</td>
                  <td>{user.is_verified ? "Verified" : "None"}</td>
                  <td>{user.is_admin ? "Yes" : "No"}</td>
                  <td>
                    {user.admin_banned_at
                      ? "Banned"
                      : user.deactivated_at
                        ? "Deactivated"
                        : "Active"}
                  </td>
                  <td>{formatCreatedAt(user.created_at)}</td>
                  <td>
                    <div className="admin-row-actions">
                      <button
                        type="button"
                        className="admin-inline-btn"
                        disabled={busyUserId === user.id}
                        onClick={() => handleBanToggle(user)}
                      >
                        {busyUserId === user.id && ["ban", "unban"].includes(busyAction)
                          ? "Saving..."
                          : user.admin_banned_at
                            ? "Unban"
                            : "Ban"}
                      </button>
                      <button
                        type="button"
                        className="admin-inline-btn"
                        disabled={busyUserId === user.id}
                        onClick={() => handleVerificationBadgeToggle(user)}
                      >
                        {busyUserId === user.id && busyAction === "verification-badge"
                          ? "Saving..."
                          : user.is_verified
                            ? "Remove Badge"
                            : "Give Badge"}
                      </button>
                      <button
                        type="button"
                        className="admin-inline-btn admin-danger-btn"
                        disabled={busyUserId === user.id || user.is_admin}
                        onClick={() => handleDeleteUser(user)}
                      >
                        {busyUserId === user.id && busyAction === "delete" ? "Deleting..." : "Delete"}
                      </button>
                    </div>
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
