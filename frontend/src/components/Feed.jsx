import React from "react";
import "../css/Feed.css";

export default function Feed() {
  return (
    <main className="feed">

      <div className="post-card">
        <div className="post-header">
          <div className="avatar">👤</div>
          <div>
            <strong>Fruityger Admin</strong>
            <p className="post-time">Just now</p>
          </div>
        </div>
        <p className="post-content">
          Welcome to Fruityger. The internet is colorful again ✨
        </p>
      </div>

      <div className="post-card">
        <div className="post-header">
          <div className="avatar">🌸</div>
          <div>
            <strong>NostalgiaGirl</strong>
            <p className="post-time">5 mins ago</p>
          </div>
        </div>
        <p className="post-content">
          Remember when websites had glitter GIFs everywhere? 🥹
        </p>
      </div>

    </main>
  );
}