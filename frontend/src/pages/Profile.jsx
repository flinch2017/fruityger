import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom"; // <- import
import "../css/Profile.css";

export default function Profile() {
  const [user, setUser] = useState(null);
  const navigate = useNavigate(); // <- initialize navigate

  useEffect(() => {
    const fetchUser = async () => {
      const token = localStorage.getItem("token");
      if (!token) return;

      try {
        const res = await fetch("http://localhost:5000/api/main/me", {
          headers: { Authorization: `Bearer ${token}` },
        });

        const data = await res.json();
        if (res.ok) {
          setUser(data.user);
        } else {
          console.error(data.error);
        }
      } catch (err) {
        console.error(err);
      }
    };

    fetchUser();
  }, []);

  if (!user) {
    return (
      <div className="profile-loading">
        <div className="profile-spinner"></div>
        <p>Loading profile...</p>
      </div>
    );
  }

  return (
    <div className="profile-page">
      <div className="profile-card">
        <div className="profile-info">
          <div className="profile-avatar">
            {user.profile_pic ? <img src={user.profile_pic} alt="Avatar" /> : "👤"}
          </div>
          <h2>{user.username}</h2>
          <p>Status: Feeling nostalgic ✨</p>

          <div className="profile-actions">
            <button
              className="profile-btn edit-btn"
              onClick={() => navigate("/edit-profile")} // <- handle edit
            >
              Edit Profile
            </button>
            <button className="profile-btn share-btn">Share Profile</button>
          </div>

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
          <p>This is my first post in Fruityger 🎮</p>
        </div>
      </div>
    </div>
  );
}