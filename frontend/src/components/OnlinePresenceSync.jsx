import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import supabase from "../lib/supabaseClient";

export default function OnlinePresenceSync() {
  const location = useLocation();
  const [authVersion, setAuthVersion] = useState(0);
  const channelRef = useRef(null);

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
    const username = localStorage.getItem("username");
    const profilePic = localStorage.getItem("profile_pic");

    if (!token || !userId) {
      return undefined;
    }

    const trackPresence = async () => {
      if (!channelRef.current || document.visibilityState === "hidden") {
        return;
      }

      try {
        await channelRef.current.track({
          user_id: userId,
          username,
          profile_pic: profilePic || null,
          path: location.pathname,
          last_seen_at: new Date().toISOString(),
        });
      } catch (error) {
        console.error(error);
      }
    };

    const untrackPresence = async () => {
      if (!channelRef.current) return;

      try {
        await channelRef.current.untrack();
      } catch (error) {
        console.error(error);
      }
    };

    const channel = supabase.channel("fruityger-online", {
      config: {
        presence: {
          key: String(userId),
        },
      },
    });

    channelRef.current = channel;

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await trackPresence();
      }
    });

    const handleProfileUpdated = async () => {
      await trackPresence();
    };

    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible") {
        await trackPresence();
        return;
      }

      await untrackPresence();
    };

    const handleBeforeUnload = () => {
      if (!channelRef.current) return;
      channelRef.current.untrack().catch(() => null);
    };

    window.addEventListener("fruityger:profile-updated", handleProfileUpdated);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("fruityger:profile-updated", handleProfileUpdated);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      untrackPresence().catch(() => null);
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [authVersion, location.pathname]);

  return null;
}
