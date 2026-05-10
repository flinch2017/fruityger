import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { fetchAuthSession } from "../utils/authSession";
import RouteLoadingScreen from "./RouteLoadingScreen";

export default function OnboardingRoute({ children }) {
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let isMounted = true;

    const checkSession = async () => {
      const session = await fetchAuthSession();
      if (!isMounted) return;

      if (!session.ok) {
        setStatus("guest");
        return;
      }

      const user = session.data?.user;

      setStatus(user?.interests_completed ? "complete" : "incomplete");
    };

    checkSession();

    return () => {
      isMounted = false;
    };
  }, []);

  if (status === "loading") {
    return <RouteLoadingScreen />;
  }

  if (status === "guest") {
    return <Navigate to="/login" replace />;
  }

  if (status === "complete") {
    return <Navigate to="/feed" replace />;
  }

  return children;
}
