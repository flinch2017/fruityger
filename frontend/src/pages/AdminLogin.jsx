import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { persistAdminSession } from "../utils/adminSession";
import "../css/Admin.css";

export default function AdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const res = await fetch("http://localhost:5000/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Admin login failed");
        return;
      }

      persistAdminSession(data);
      navigate("/admin", { replace: true });
    } catch {
      setError("Login request failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-shell">
      <div className="admin-card admin-login-card">
        <h1>Admin Login</h1>
        <p>Secure administrator access</p>

        {error && <div className="admin-error">{error}</div>}

        <form onSubmit={handleSubmit} className="admin-form">
          <input
            type="text"
            placeholder="Email or username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <button type="submit" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <Link to="/login" className="admin-link">
          Back to user login
        </Link>
      </div>
    </div>
  );
}
