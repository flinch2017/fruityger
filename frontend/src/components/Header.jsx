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
        className="logo pixel-font" 
        onClick={() => navigate("/")}
        style={{ cursor: "pointer" }}
      >
        Pixetown
      </div>

      <div className="nav-row">
        <nav className="nav-items">

          {/* 🏠 Home Button */}
          <button 
            className="nav-button"
            onClick={() => navigate("/")}
            title="Home"
          >
            🏠
          </button>

          <button className="nav-button" title="Notifications">
            🔔
          </button>

          <button className="nav-button" title="Messages">
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

    <button>Logout</button>
  </div>
)}

          </div>

        </nav>
      </div>
    </header>
  );
}
