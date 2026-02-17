import React, { useState } from "react";
import "../css/Header.css";

export default function Header() {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const toggleDropdown = () => setDropdownOpen(!dropdownOpen);

  return (
    <header className="top-header">
      <div className="logo">Pixetown</div>

      <div className="nav-row">
        <nav className="nav-items">
          <button className="nav-button">🔔</button>
          <button className="nav-button">✉️</button>

          <div className="profile-container">
            <div className="profile-placeholder" onClick={toggleDropdown}>
              👤
            </div>
            {dropdownOpen && (
              <div className="profile-dropdown">
                <button>Profile</button>
                <button>Settings</button>
                <button>Logout</button>
              </div>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
