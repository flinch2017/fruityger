import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { fetchAuthSession } from "../utils/authSession";

export default function VerificationRoute({ children }) {
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

      setStatus(session.data?.user?.email_verified ? "verified" : "unverified");
    };

    checkSession();

    return () => {
      isMounted = false;
    };
  }, []);

  if (status === "loading") {
    return null;
  }

  if (status === "guest") {
    return <Navigate to="/login" replace />;
  }

  if (status === "verified") {
    return <Navigate to="/feed" replace />;
  }

  return children;
}
