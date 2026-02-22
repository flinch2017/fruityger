import { useNavigate, useLocation } from "react-router-dom";
import React, { useState } from "react";
import "../css/Header.css";

export default function Header() {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const toggleDropdown = () => setDropdownOpen(!dropdownOpen);
  const navigate = useNavigate();
  const location = useLocation();

  const isCreatePage = location.pathname === "/create";

  return (
    <>
      <header className="top-header">
        {/* ===== HEADER CONTENT ONLY ===== */}

        <div 
          className="logo fruityger-font" 
          onClick={() => navigate("/feed")}
          style={{ cursor: "pointer" }}
        >
          Fruityger
        </div>

        <div className="nav-row">
          <nav className="nav-items">

            <button
              className="nav-button desktop-create-btn"
              onClick={() => navigate("/create")}
              title="Create Post"
            >
              ➕
            </button>

            <button className="nav-button" onClick={() => navigate("/feed")}>
              🏠
            </button>

            <button className="nav-button" onClick={() => navigate("/notifications")}>
              🔔
            </button>

            <button className="nav-button" onClick={() => navigate("/messages")}>
              ✉️
            </button>

            <div className="profile-container">
              <div className="profile-placeholder" onClick={toggleDropdown}>
                👤
              </div>

              {dropdownOpen && (
                <div className="profile-dropdown">
                  <button onClick={() => { navigate("/profile"); setDropdownOpen(false); }}>
                    Profile
                  </button>

                  <button onClick={() => { navigate("/settings"); setDropdownOpen(false); }}>
                    Settings
                  </button>

                  <button onClick={() => {
                    localStorage.removeItem("token");
                    setDropdownOpen(false);
                    navigate("/login");
                  }}>
                    Logout
                  </button>
                </div>
              )}
            </div>

          </nav>
        </div>
      </header>

      {/* ⭐ Floating Mobile FAB MUST BE OUTSIDE HEADER */}
      {!isCreatePage && (
        <button
          className="mobile-fab-create"
          onClick={() => navigate("/create")}
        >
          ➕
        </button>
      )}
    </>
  );
}
