import { useNavigate, useLocation } from "react-router-dom";
import React, { useState } from "react";
import "../css/Header.css";

export default function Header() {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const toggleDropdown = () => setDropdownOpen(!dropdownOpen);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  const isCreatePage = location.pathname === "/create";

  const handleSearch = (e) => {
    e.preventDefault();

    const keyword = searchQuery.trim();
    if (!keyword) return;

    const encoded = encodeURIComponent(keyword);

    // Prevent redundant navigation
    if (location.pathname === "/search" &&
        new URLSearchParams(location.search).get("q") === keyword) {
      return;
    }

    navigate(`/search?q=${encoded}`);

    setSearchQuery("");
    setMobileSearchOpen(false);
  };

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

        <form className="search-form" onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="Search accounts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </form>

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

            <button
              className="nav-button mobile-search-btn"
              onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
            >
              🔍
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
                  <button
                    onClick={() => {
                      const username = localStorage.getItem("username");
                      navigate(username ? `/profile/${username}` : "/feed");
                      setDropdownOpen(false);
                    }}
                  >
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

        {mobileSearchOpen && (
          <div className="mobile-search-dropdown">
            <form
              onSubmit={(e) => {
                handleSearch(e);
                setMobileSearchOpen(false);
              }}
              className="mobile-search-form"
            >
              <input
                type="text"
                placeholder="Search accounts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="mobile-search-input"
                autoFocus
              />
            </form>
          </div>
        )}
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
