import React from "react";
import "../css/Profile.css";

export default function Profile() {
  return (
    <div className="profile-page">
      <div className="profile-card">
        {/* Banner removed */}

        <div className="profile-info">
          <div className="profile-avatar">👤</div>
          <h2>Fruityger User</h2>
          <p>Status: Feeling nostalgic ✨</p>

          {/* Action Buttons */}
          <div className="profile-actions">
            <button className="profile-btn edit-btn">Edit Profile</button>
            <button className="profile-btn share-btn">Share Profile</button>
          </div>

          {/* Followers / Following */}
          <div className="profile-stats">
            <div className="stat">
              <span className="stat-number">128</span>
              <span className="stat-label">Followers</span>
            </div>

            <div className="stat">
              <span className="stat-number">76</span>
              <span className="stat-label">Following</span>
            </div>
          </div>
        </div>
      </div>

      <div className="profile-posts">
        <h3>Your Posts</h3>

        <div className="post-card">
          <p>This is my first post in Pixetown 🎮</p>
        </div>
      </div>
    </div>
  );
}
