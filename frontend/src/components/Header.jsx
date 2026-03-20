import { useNavigate, useLocation } from "react-router-dom";
import React, { useState, useEffect, useRef } from "react";
import "../css/Header.css";

export default function Header() {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const toggleDropdown = () => setDropdownOpen(!dropdownOpen);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const profileRef = useRef(null);
  const searchRef = useRef(null);

  const isCreatePage = location.pathname === "/create";

  useEffect(() => {
    const fetchCurrentUser = async () => {
      const token = localStorage.getItem("token");
      if (!token) return;

      try {
        const res = await fetch("http://localhost:5000/api/main/me", {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (res.ok) setCurrentUser(data.user);
      } catch (err) {
        console.error(err);
      }
    };

    fetchCurrentUser();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      // Close profile dropdown if click is outside
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
      // Close mobile search dropdown if click is outside
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setMobileSearchOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

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

            {/* PROFILE */}
            <div className="profile-container" ref={profileRef}>
              <div className="profile-placeholder" onClick={toggleDropdown}>
                {currentUser?.profile_pic ? (
                  <img
                    src={currentUser.profile_pic}
                    alt="Avatar"
                    style={{
                      width: "100%",
                      height: "100%",
                      borderRadius: "50%",
                      objectFit: "cover",
                    }}
                  />
                ) : (
                  "👤"
                )}
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

        {/* MOBILE SEARCH */}
        {mobileSearchOpen && (
          <div className="mobile-search-dropdown" ref={searchRef}>
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
