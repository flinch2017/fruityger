import React from "react";
import "../css/Notifications.css";

export default function Notifications() {
  return (
    <div className="notifications-page">

      <h1>Notifications</h1>

      <div className="notification-card unread">
        <div className="notif-icon">🔔</div>
        <div className="notif-content">
          <h3>New follower</h3>
          <p>@skywave started following you.</p>
        </div>
        <span className="notif-time">2m ago</span>
      </div>

      <div className="notification-card">
        <div className="notif-icon">💬</div>
        <div className="notif-content">
          <h3>New message</h3>
          <p>You received a new message from @aeroglow.</p>
        </div>
        <span className="notif-time">1h ago</span>
      </div>

      <div className="notification-card">
        <div className="notif-icon">✨</div>
        <div className="notif-content">
          <h3>Profile liked</h3>
          <p>@bluevista liked your post.</p>
        </div>
        <span className="notif-time">Yesterday</span>
      </div>

    </div>
  );
}
