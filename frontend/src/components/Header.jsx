import { useNavigate, useLocation } from "react-router-dom";
import React, { useState, useEffect, useRef } from "react";
import "../css/Header.css";
import { clearAuthStorage } from "../utils/authSession";

export default function Header() {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [messageUnreadCount, setMessageUnreadCount] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const profileRef = useRef(null);
  const searchRef = useRef(null);

  const isCreatePage = location.pathname === "/create";
  const storedProfilePic = localStorage.getItem("profile_pic") || "";
  const profileUsername = currentUser?.username || localStorage.getItem("username") || "You";
  const profileHandle = `@${profileUsername}`;

  const syncCurrentUserFromStorage = () => {
    const storedUsername = localStorage.getItem("username");
    const storedPic = localStorage.getItem("profile_pic");

    setCurrentUser((prev) => ({
      ...(prev || {}),
      ...(storedUsername ? { username: storedUsername } : {}),
      profile_pic: storedPic || prev?.profile_pic || "",
    }));
  };

  const toggleDropdown = () => setDropdownOpen((prev) => !prev);

  const handleFeedNav = () => {
    if (location.pathname === "/feed") {
      window.dispatchEvent(new CustomEvent("fruityger:feed-refresh"));
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    navigate("/feed");
  };

  useEffect(() => {
    const fetchCurrentUser = async () => {
      const token = localStorage.getItem("token");
      if (!token) return;

      syncCurrentUserFromStorage();

      try {
        const res = await fetch("http://localhost:5000/api/main/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();

        if (res.ok) {
          setCurrentUser(data.user);
        }
      } catch (err) {
        console.error(err);
      }
    };

    fetchCurrentUser();
  }, [location.pathname]);

  useEffect(() => {
    const handleProfileUpdated = () => {
      syncCurrentUserFromStorage();
    };

    window.addEventListener("fruityger:profile-updated", handleProfileUpdated);

    return () => {
      window.removeEventListener("fruityger:profile-updated", handleProfileUpdated);
    };
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    let isMounted = true;

    const fetchNotificationCount = async () => {
      try {
        const res = await fetch("http://localhost:5000/api/notifications/unread-count", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();

        if (res.ok && isMounted) {
          setNotificationUnreadCount(data.unreadCount || 0);
        }
      } catch (err) {
        console.error(err);
      }
    };

    const fetchMessageCount = async () => {
      try {
        const res = await fetch("http://localhost:5000/api/messages/unread-count", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();

        if (res.ok && isMounted) {
          setMessageUnreadCount(data.unreadCount || 0);
        }
      } catch (err) {
        console.error(err);
      }
    };

    const handleNotificationCountUpdate = (event) => {
      if (!isMounted) return;
      setNotificationUnreadCount(event.detail?.unreadCount || 0);
    };

    const handleMessagesRefresh = async (event) => {
      if (!isMounted) return;

      if (typeof event.detail?.unreadCount === "number") {
        setMessageUnreadCount(event.detail.unreadCount);
        return;
      }

      await fetchMessageCount();
    };

    const handleFocus = () => {
      fetchNotificationCount();
      fetchMessageCount();
    };

    fetchNotificationCount();
    fetchMessageCount();

    window.addEventListener("focus", handleFocus);
    window.addEventListener("fruityger:notifications-count", handleNotificationCountUpdate);
    window.addEventListener("fruityger:messages-refresh", handleMessagesRefresh);

    const intervalId = window.setInterval(() => {
      fetchNotificationCount();
      fetchMessageCount();
    }, 60000);

    return () => {
      isMounted = false;
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("fruityger:notifications-count", handleNotificationCountUpdate);
      window.removeEventListener("fruityger:messages-refresh", handleMessagesRefresh);
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }

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

    if (
      location.pathname === "/search" &&
      new URLSearchParams(location.search).get("q") === keyword
    ) {
      return;
    }

    navigate(`/search?q=${encoded}`);
    setSearchQuery("");
    setMobileSearchOpen(false);
  };

  return (
    <>
      <header className="top-header">
        <div
          className="logo fruityger-font"
          onClick={handleFeedNav}
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
              className={`nav-button desktop-create-btn ${location.pathname === "/create" ? "active" : ""}`}
              onClick={() => navigate("/create")}
              title="Create Post"
            >
              ➕
            </button>

            <button className={`nav-button ${location.pathname === "/feed" ? "active" : ""}`} onClick={handleFeedNav}>
              🏠
            </button>

            <button
              className="nav-button mobile-search-btn"
              onClick={() => setMobileSearchOpen((prev) => !prev)}
            >
              🔍
            </button>

            <button
              className={`nav-button nav-button-bell ${location.pathname === "/notifications" ? "active" : ""}`}
              onClick={() => navigate("/notifications")}
            >
              🔔
              {notificationUnreadCount > 0 && (
                <span className="nav-badge">
                  {notificationUnreadCount > 9 ? "9+" : notificationUnreadCount}
                </span>
              )}
            </button>

            <button
              className={`nav-button nav-button-message ${location.pathname === "/messages" ? "active" : ""}`}
              onClick={() => navigate("/messages")}
            >
              ✉️
              {messageUnreadCount > 0 && (
                <span className="nav-badge">
                  {messageUnreadCount > 9 ? "9+" : messageUnreadCount}
                </span>
              )}
            </button>

            <div className="profile-container" ref={profileRef}>
              <div className="profile-placeholder" onClick={toggleDropdown}>
                {currentUser?.profile_pic || storedProfilePic ? (
                  <img
                    src={currentUser?.profile_pic || storedProfilePic}
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
                  <div className="profile-dropdown-hero">
                    <div className="profile-dropdown-avatar">
                      {currentUser?.profile_pic || storedProfilePic ? (
                        <img src={currentUser?.profile_pic || storedProfilePic} alt="Avatar" />
                      ) : (
                        "👤"
                      )}
                    </div>
                    <div className="profile-dropdown-copy">
                      <strong>{profileUsername}</strong>
                      <span>{profileHandle}</span>
                    </div>
                  </div>

                  <div className="profile-dropdown-divider"></div>

                  <button
                    className="profile-dropdown-action"
                    onClick={() => {
                      const username = localStorage.getItem("username");
                      navigate(username ? `/profile/${username}` : "/feed");
                      setDropdownOpen(false);
                    }}
                  >
                    <span className="profile-dropdown-icon">👤</span>
                    <span>Profile</span>
                  </button>

                  <button
                    className="profile-dropdown-action"
                    onClick={() => {
                      navigate("/settings");
                      setDropdownOpen(false);
                    }}
                  >
                    <span className="profile-dropdown-icon">⚙️</span>
                    <span>Settings</span>
                  </button>

                  <button
                    className="profile-dropdown-action danger"
                    onClick={() => {
                      clearAuthStorage();
                      setDropdownOpen(false);
                      navigate("/login");
                    }}
                  >
                    <span className="profile-dropdown-icon">⏻</span>
                    <span>Logout</span>
                  </button>
                </div>
              )}
            </div>
          </nav>
        </div>

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
