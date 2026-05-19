import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "../css/Admin.css";

const getAdminToken = () => localStorage.getItem("adminToken");

export default function AdminHelpCenter() {
  const [requests, setRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState("open");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [responses, setResponses] = useState({});

  const loadRequests = async (status = statusFilter) => {
    setError("");
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      const res = await fetch(`http://localhost:5000/api/admin/help-requests?${params.toString()}`, {
        headers: { Authorization: `Bearer ${getAdminToken()}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed to load help requests");
        return;
      }
      setRequests(Array.isArray(data.requests) ? data.requests : []);
    } catch {
      setError("Failed to load help requests");
    }
  };

  useEffect(() => {
    loadRequests(statusFilter);
  }, [statusFilter]);

  const updateRequest = async (requestId, status) => {
    setBusyId(requestId);
    setError("");
    try {
      const res = await fetch(`http://localhost:5000/api/admin/help-requests/${requestId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${getAdminToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status,
          adminResponse: responses[requestId] || "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed to update request");
        return;
      }

      setRequests((prev) =>
        prev.map((item) =>
          item.id === requestId
            ? {
                ...item,
                status: data.request?.status || status,
                admin_response: data.request?.admin_response || item.admin_response,
              }
            : item
        )
      );
    } catch {
      setError("Failed to update request");
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="admin-shell">
      <div className="admin-card">
        <div className="admin-topbar">
          <h1>Help Center</h1>
          <div className="admin-links">
            <Link to="/admin">Dashboard</Link>
            <Link to="/admin/users">Users</Link>
            <Link to="/admin/reports">Reports</Link>
          </div>
        </div>

        <div className="admin-toolbar">
          <label className="admin-filter">
            Status
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="admin-select"
            >
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="resolved">Resolved</option>
            </select>
          </label>
        </div>

        {error && <div className="admin-error">{error}</div>}

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Subject</th>
                <th>Message</th>
                <th>Status</th>
                <th>Admin Response</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id}>
                  <td>{request.username || request.email || request.user_id}</td>
                  <td>{request.subject}</td>
                  <td>{request.message}</td>
                  <td>{String(request.status || "").replace(/_/g, " ")}</td>
                  <td>
                    <textarea
                      className="admin-response-input"
                      value={responses[request.id] ?? request.admin_response ?? ""}
                      onChange={(event) =>
                        setResponses((prev) => ({ ...prev, [request.id]: event.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="admin-inline-btn"
                      disabled={busyId === request.id}
                      onClick={() => updateRequest(request.id, "in_progress")}
                    >
                      In progress
                    </button>
                    <button
                      type="button"
                      className="admin-inline-btn"
                      disabled={busyId === request.id}
                      onClick={() => updateRequest(request.id, "resolved")}
                    >
                      Resolve
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
