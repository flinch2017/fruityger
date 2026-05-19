import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/Notifications.css";
import { formatRelativeTime } from "../utils/timeFormatter";

const TYPE_COPY = {
  post_like: {
    icon: "L",
    title: "Post liked",
    body: (username) => `@${username} liked your post.`,
  },
  post_comment: {
    icon: "C",
    title: "New comment",
    body: (username) => `@${username} commented on your post.`,
  },
  comment_reply: {
    icon: "R",
    title: "New reply",
    body: (username) => `@${username} replied to your comment.`,
  },
  comment_like: {
    icon: "CL",
    title: "Comment liked",
    body: (username) => `@${username} liked your comment.`,
  },
  post_repost: {
    icon: "RP",
    title: "Post reposted",
    body: (username) => `@${username} reposted your post.`,
  },
  post_mention: {
    icon: "@",
    title: "Mentioned you",
    body: (username) => `@${username} mentioned you in a post.`,
  },
  comment_mention: {
    icon: "@",
    title: "Mentioned you",
    body: (username) => `@${username} mentioned you in a comment.`,
  },
  new_follower: {
    icon: "F",
    title: "New follower",
    body: (username) => `@${username} started following you.`,
  },
  direct_message: {
    icon: "M",
    title: "New message",
    body: (username) => `@${username} sent you a message.`,
  },
  group_message: {
    icon: "G",
    title: "Group message",
    body: (username) => `@${username} sent a message in your group.`,
  },
  group_message_reply: {
    icon: "GR",
    title: "Group reply",
    body: (username) => `@${username} replied to your message.`,
  },
  message_reaction: {
    icon: "MR",
    title: "Message reaction",
    body: (username) => `@${username} reacted to your message.`,
  },
  content_removed: {
    icon: "!",
    title: "Content removed",
    body: () => "One of your content violated our community rules and was removed.",
  },
};

export default function Notifications() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [clearing, setClearing] = useState(false);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const fetchNotifications = async (showRefreshState = false) => {
    const token = localStorage.getItem("token");
    if (!token) {
      setLoading(false);
      return;
    }

    if (showRefreshState) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      setError("");

      const res = await fetch("http://localhost:5000/api/notifications", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to load notifications");
      }

      const nextNotifications = data.notifications || [];
      setNotifications(nextNotifications);

      if (nextNotifications.some((item) => !item.is_read)) {
        await fetch("http://localhost:5000/api/notifications/read-all", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        window.dispatchEvent(
          new CustomEvent("fruityger:notifications-count", {
            detail: { unreadCount: 0 },
          })
        );
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to load notifications");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchNotifications(false);
  }, []);

  const handleNotificationClick = (notification) => {
    if (selectionMode) {
      toggleSelected(notification.notification_id);
      return;
    }

    if (notification.type === "new_follower") {
      navigate(`/profile/${notification.actor_username}`);
      return;
    }

    if (notification.chat_id) {
      navigate(`/chat/${notification.chat_id}`);
      return;
    }

    if (notification.group_chat_id) {
      navigate(`/group-chat/${notification.group_chat_id}`);
      return;
    }

    if (notification.type === "content_removed") {
      return;
    }

    if (notification.post_id) {
      navigate(`/post/${notification.post_id}`, {
        state: {
          openComments:
            notification.type === "post_comment" ||
            notification.type === "comment_reply" ||
            notification.type === "comment_like" ||
            notification.type === "comment_mention",
        },
      });
    }
  };

  const toggleSelected = (notificationId) => {
    setSelectedIds((prev) =>
      prev.includes(notificationId)
        ? prev.filter((id) => id !== notificationId)
        : [...prev, notificationId]
    );
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds([]);
  };

  const clearNotifications = async ({ clearAll = false } = {}) => {
    const token = localStorage.getItem("token");
    if (!token) return;
    if (!clearAll && selectedIds.length === 0) return;

    setClearing(true);

    try {
      const res = await fetch("http://localhost:5000/api/notifications/clear", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          clearAll,
          notificationIds: clearAll ? [] : selectedIds,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to clear notifications");
      }

      setNotifications((prev) =>
        clearAll
          ? []
          : prev.filter((notification) => !selectedSet.has(notification.notification_id))
      );

      exitSelectionMode();
      window.dispatchEvent(
        new CustomEvent("fruityger:notifications-count", {
          detail: { unreadCount: 0 },
        })
      );
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to clear notifications");
    } finally {
      setClearing(false);
    }
  };

  if (loading) {
    return (
      <div className="notifications-page">
        <h1>Notifications</h1>
        <div className="notifications-status">Loading notifications...</div>
      </div>
    );
  }

  return (
    <div className="notifications-page">
      <div className="notifications-topbar">
        <h1>Notifications</h1>
        <div className="notifications-actions">
          {selectionMode ? (
            <>
              <button
                className="notifications-refresh-btn alt"
                type="button"
                onClick={() => clearNotifications({ clearAll: false })}
                disabled={clearing || selectedIds.length === 0}
              >
                Clear Selected
              </button>
              <button
                className="notifications-refresh-btn alt"
                type="button"
                onClick={() => clearNotifications({ clearAll: true })}
                disabled={clearing || notifications.length === 0}
              >
                Clear All
              </button>
              <button
                className="notifications-refresh-btn alt"
                type="button"
                onClick={exitSelectionMode}
                disabled={clearing}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                className="notifications-refresh-btn alt"
                type="button"
                onClick={() => setSelectionMode(true)}
                disabled={notifications.length === 0}
              >
                Select
              </button>
              <button
                className="notifications-refresh-btn"
                type="button"
                onClick={() => fetchNotifications(true)}
                disabled={refreshing}
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="notifications-status error">{error}</div>}

      {!error && notifications.length === 0 && (
        <div className="notifications-status">No notifications yet.</div>
      )}

      {notifications.map((notification) => {
        const meta = TYPE_COPY[notification.type] || {
          icon: ".",
          title: "New activity",
          body: (username) => `@${username} interacted with your content.`,
        };

        const preview =
          notification.comment_text?.trim() ||
          notification.post_caption?.trim() ||
          "";

        return (
          <button
            key={notification.notification_id}
            className={`notification-card ${
              notification.is_read ? "" : "unread"
            } ${selectedSet.has(notification.notification_id) ? "selected" : ""}`.trim()}
            type="button"
            onClick={() => handleNotificationClick(notification)}
          >
            {selectionMode && (
              <span className="selection-check">
                {selectedSet.has(notification.notification_id) ? "\u2713" : ""}
              </span>
            )}

            <div className="notif-icon">{meta.icon}</div>

            <div className="notif-content">
              <h3>{meta.title}</h3>
              <p>{meta.body(notification.actor_username)}</p>
              {preview && <div className="notif-preview">{preview}</div>}
            </div>

            <span className="notif-time">
              {formatRelativeTime(notification.created_at)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
