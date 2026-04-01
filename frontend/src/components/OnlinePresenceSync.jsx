import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

export default function OnlinePresenceSync() {
  const location = useLocation();
  const [authVersion, setAuthVersion] = useState(0);

  useEffect(() => {
    const handleAuthChanged = () => {
      setAuthVersion((current) => current + 1);
    };

    window.addEventListener("fruityger:auth-changed", handleAuthChanged);

    return () => {
      window.removeEventListener("fruityger:auth-changed", handleAuthChanged);
    };
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const userId = localStorage.getItem("userId");

    if (!token || !userId) {
      return undefined;
    }

    let heartbeatIntervalId = null;

    const sendHeartbeat = async () => {
      try {
        await fetch("http://localhost:5000/api/messages/presence/heartbeat", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      } catch (error) {
        console.error(error);
      }
    };

    sendHeartbeat();
    heartbeatIntervalId = window.setInterval(sendHeartbeat, 10000);

    const handleProfileUpdated = async () => {
      await sendHeartbeat();
    };

    const handleVisibilityChange = async () => {
      if (document.visibilityState !== "visible") return;
      await sendHeartbeat();
    };

    window.addEventListener("fruityger:profile-updated", handleProfileUpdated);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("fruityger:profile-updated", handleProfileUpdated);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (heartbeatIntervalId) {
        window.clearInterval(heartbeatIntervalId);
      }
    };
  }, [authVersion, location.pathname]);

  return null;
}
