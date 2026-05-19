import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import RouteLoadingScreen from "./RouteLoadingScreen";
import { fetchAdminSession } from "../utils/adminSession";

export default function AdminRoute({ children }) {
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      const session = await fetchAdminSession();
      if (!mounted) return;
      setStatus(session.ok ? "ready" : "guest");
    };

    check();

    return () => {
      mounted = false;
    };
  }, []);

  if (status === "loading") {
    return <RouteLoadingScreen />;
  }

  if (status === "guest") {
    return <Navigate to="/admin/login" replace />;
  }

  return children;
}
