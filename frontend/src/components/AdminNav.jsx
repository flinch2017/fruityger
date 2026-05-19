import { Link, useNavigate } from "react-router-dom";
import { clearAdminSession } from "../utils/adminSession";

export default function AdminNav({ title }) {
  const navigate = useNavigate();

  const handleLogout = () => {
    clearAdminSession();
    navigate("/admin/login", { replace: true });
  };

  return (
    <div className="admin-topbar">
      <h1>{title}</h1>
      <div className="admin-links">
        <Link to="/admin">Dashboard</Link>
        <Link to="/admin/users">Users</Link>
        <Link to="/admin/reports">Reports</Link>
        <Link to="/admin/activity">Activity</Link>
        <Link to="/admin/help-center">Help Center</Link>
        <button type="button" className="admin-logout-btn" onClick={handleLogout}>
          Log out
        </button>
      </div>
    </div>
  );
}
