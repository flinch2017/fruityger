import { useEffect } from "react";
import supabase from "../lib/supabaseClient";

const CHANNEL_NAME = "fruityger-online";

export default function OnlinePresenceSync() {
  useEffect(() => {
    const token = localStorage.getItem("token");
    const userId = localStorage.getItem("userId");

    if (!token || !userId) {
      return undefined;
    }

    const dispatchPresence = (channel) => {
      const state = channel.presenceState();
      const users = Object.values(state)
        .flat()
        .map((entry) => ({
          userId: String(entry.userId || ""),
          username: entry.username || "",
          profile_pic: entry.profile_pic || "",
        }))
        .filter((entry) => entry.userId);

      window.dispatchEvent(
        new CustomEvent("fruityger:online-presence", {
          detail: { users },
        })
      );
    };

    const channel = supabase.channel(CHANNEL_NAME, {
      config: {
        presence: {
          key: String(userId),
        },
      },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        dispatchPresence(channel);
      })
      .subscribe(async (status) => {
        if (status !== "SUBSCRIBED") return;

        await channel.track({
          userId: String(userId),
          username: localStorage.getItem("username") || "",
          profile_pic: localStorage.getItem("profile_pic") || "",
          path: window.location.pathname,
          at: new Date().toISOString(),
        });

        dispatchPresence(channel);
      });

    const handleProfileUpdated = async () => {
      await channel.track({
        userId: String(userId),
        username: localStorage.getItem("username") || "",
        profile_pic: localStorage.getItem("profile_pic") || "",
        path: window.location.pathname,
        at: new Date().toISOString(),
      });
      dispatchPresence(channel);
    };

    const handleVisibilityChange = async () => {
      if (document.visibilityState !== "visible") return;

      await channel.track({
        userId: String(userId),
        username: localStorage.getItem("username") || "",
        profile_pic: localStorage.getItem("profile_pic") || "",
        path: window.location.pathname,
        at: new Date().toISOString(),
      });
      dispatchPresence(channel);
    };

    window.addEventListener("fruityger:profile-updated", handleProfileUpdated);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("fruityger:profile-updated", handleProfileUpdated);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      supabase.removeChannel(channel);
      window.dispatchEvent(
        new CustomEvent("fruityger:online-presence", {
          detail: { users: [] },
        })
      );
    };
  }, []);

  return null;
}
