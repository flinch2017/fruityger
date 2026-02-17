import React from "react";
import "../css/Feed.css";

export default function Feed() {
  return (
    <main className="feed">
      <div className="create-post">
        <input
          type="text"
          placeholder="What's happening in Pixetown?"
        />
        <button>Post</button>
      </div>

      <div className="post-card">
        <div className="post-header">
          <div className="avatar">👤</div>
          <div>
            <strong>Pixetown Admin</strong>
            <p className="post-time">Just now</p>
          </div>
        </div>
        <p className="post-content">
          Welcome to Pixetown. The internet is colorful again ✨
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
