import { useNavigate } from "react-router-dom";
import React, { useState } from "react";
import "../css/Header.css";

export default function Header() {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const toggleDropdown = () => setDropdownOpen(!dropdownOpen);
  const navigate = useNavigate();

  return (
    <header className="top-header">
      {/* Make logo clickable too */}
      <div 
        className="logo fruityger-font" 
        onClick={() => navigate("/feed")}
        style={{ cursor: "pointer" }}
      >
        Fruityger
      </div>

      <div className="nav-row">
        <nav className="nav-items">

          {/* 🏠 Home Button */}
          <button 
            className="nav-button"
            onClick={() => navigate("/feed")}
            title="Home"
          >
            🏠
          </button>

          <button className="nav-button" onClick={() => navigate("/notifications")} title="Notifications">
            🔔
          </button>

          <button className="nav-button" onClick={() => navigate("/messages")} title="Messages">
            ✉️
          </button>

          <div className="profile-container">
            <div 
              className="profile-placeholder" 
              onClick={toggleDropdown}
            >
              👤
            </div>

            {dropdownOpen && (
              <div className="profile-dropdown">
                <button
                  onClick={() => {
                    navigate("/profile");
                    setDropdownOpen(false);
                  }}
                >
                  Profile
                </button>

                <button
                  onClick={() => {
                    navigate("/settings");
                    setDropdownOpen(false);
                  }}
                >
                  Settings
                </button>

                <button
                  onClick={() => {
                    localStorage.removeItem("token"); // remove JWT
                    setDropdownOpen(false);
                    navigate("/login"); // redirect to login
                  }}
                >
                  Logout
                </button>
              </div>
            )}

          </div>

        </nav>
      </div>
    </header>
  );
}
