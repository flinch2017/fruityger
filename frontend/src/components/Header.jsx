import { useNavigate, useLocation } from "react-router-dom";
import React, { useState, useEffect, useRef } from "react";
import "../css/Header.css";
import { clearAuthStorage } from "../utils/authSession";
import { getSafeMediaUrl } from "../utils/mediaUrl";

export default function Header() {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [messageUnreadCount, setMessageUnreadCount] = useState(0);
  const [searchSuggestions, setSearchSuggestions] = useState({
    users: [],
    hashtags: [],
    posts: [],
  });
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const profileRef = useRef(null);
  const searchRef = useRef(null);

  const isCreatePage = location.pathname === "/create";
  const storedProfilePic = localStorage.getItem("profile_pic") || "";
  const profileUsername = currentUser?.username || localStorage.getItem("username") || "You";
  const profileHandle = `@${profileUsername}`;
  const mergedProfilePic = currentUser?.profile_pic || storedProfilePic || "";

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
          setCurrentUser((prev) => ({
            ...(prev || {}),
            ...(data.user || {}),
            profile_pic:
              data.user?.profile_pic ||
              localStorage.getItem("profile_pic") ||
              prev?.profile_pic ||
              "",
          }));
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
        setSearchFocused(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const keyword = searchQuery.trim();

    if (!token || !keyword) {
      setSearchSuggestions({ users: [], hashtags: [], posts: [] });
      setSearchLoading(false);
      return undefined;
    }

    let isCancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setSearchLoading(true);

      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(keyword)}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Search failed");
        }

        if (!isCancelled) {
          setSearchSuggestions({
            users: (data.users || []).slice(0, 4),
            hashtags: (data.hashtags || []).slice(0, 4),
            posts: (data.posts || []).slice(0, 3),
          });
        }
      } catch (error) {
        if (!isCancelled) {
          console.error(error);
          setSearchSuggestions({ users: [], hashtags: [], posts: [] });
        }
      } finally {
        if (!isCancelled) {
          setSearchLoading(false);
        }
      }
    }, 180);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [searchQuery]);

  useEffect(() => {
    setSearchFocused(false);
    setMobileSearchOpen(false);
  }, [location.pathname, location.search]);

  const hasSuggestions =
    searchSuggestions.users.length > 0 ||
    searchSuggestions.hashtags.length > 0 ||
    searchSuggestions.posts.length > 0;
  const showSuggestions = Boolean(
    searchQuery.trim() && searchFocused && (searchLoading || hasSuggestions)
  );

  const submitSearch = (keyword) => {
    const trimmedKeyword = keyword.trim();
    if (!trimmedKeyword) return;

    const encoded = encodeURIComponent(trimmedKeyword);

    if (
      location.pathname === "/search" &&
      new URLSearchParams(location.search).get("q") === trimmedKeyword
    ) {
      setSearchFocused(false);
      setMobileSearchOpen(false);
      return;
    }

    navigate(`/search?q=${encoded}`);
    setSearchQuery("");
    setSearchSuggestions({ users: [], hashtags: [], posts: [] });
    setSearchFocused(false);
    setMobileSearchOpen(false);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    submitSearch(searchQuery);
  };

  const renderSuggestionContent = () => (
    <div className="search-suggestions">
      <button
        type="button"
        className="search-suggestion-item search-suggestion-primary"
        onClick={() => submitSearch(searchQuery)}
      >
        <span className="search-suggestion-icon">🔎</span>
        <span className="search-suggestion-copy">
          <strong>Search for "{searchQuery.trim()}"</strong>
          <span>See all matching profiles, posts, and hashtags</span>
        </span>
      </button>

      {searchLoading && (
        <div className="search-suggestion-state">Finding matches...</div>
      )}

      {!searchLoading && searchSuggestions.users.length > 0 && (
        <div className="search-suggestion-group">
          <p className="search-suggestion-label">People</p>
          {searchSuggestions.users.map((user) => (
            <button
              key={user.id}
              type="button"
              className="search-suggestion-item"
              onClick={() => {
                navigate(`/profile/${user.username}`);
                setSearchQuery("");
                setSearchFocused(false);
                setMobileSearchOpen(false);
              }}
            >
              <span className="search-suggestion-avatar">
                {user.profile_pic ? (
                  <img src={getSafeMediaUrl(user.profile_pic)} alt={user.username} />
                ) : (
                  "👤"
                )}
              </span>
              <span className="search-suggestion-copy">
                <strong>{user.username}</strong>
                <span>Open profile</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {!searchLoading && searchSuggestions.hashtags.length > 0 && (
        <div className="search-suggestion-group">
          <p className="search-suggestion-label">Hashtags</p>
          {searchSuggestions.hashtags.map((hashtag) => (
            <button
              key={hashtag.tag}
              type="button"
              className="search-suggestion-item"
              onClick={() => {
                navigate(`/hashtag/${hashtag.tag}`);
                setSearchQuery("");
                setSearchFocused(false);
                setMobileSearchOpen(false);
              }}
            >
              <span className="search-suggestion-icon">#</span>
              <span className="search-suggestion-copy">
                <strong>#{hashtag.tag}</strong>
                <span>{(hashtag.post_count || 0).toLocaleString()} posts</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {!searchLoading && searchSuggestions.posts.length > 0 && (
        <div className="search-suggestion-group">
          <p className="search-suggestion-label">Posts</p>
          {searchSuggestions.posts.map((post) => (
            <button
              key={post.post_id}
              type="button"
              className="search-suggestion-item"
              onClick={() => {
                navigate(`/post/${post.post_id}`);
                setSearchQuery("");
                setSearchFocused(false);
                setMobileSearchOpen(false);
              }}
            >
              <span className="search-suggestion-icon">✦</span>
              <span className="search-suggestion-copy">
                <strong>{post.username}</strong>
                <span>{post.caption ? post.caption.slice(0, 56) : "Open post"}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

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

        <div className="search-shell" ref={searchRef}>
          <form className="search-form" onSubmit={handleSearch}>
            <input
              type="text"
              placeholder="Search people, posts, hashtags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              className="search-input"
            />
          </form>

          {showSuggestions && renderSuggestionContent()}
        </div>

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
                {mergedProfilePic ? (
                  <img
                    src={getSafeMediaUrl(mergedProfilePic)}
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
                      {mergedProfilePic ? (
                        <img src={getSafeMediaUrl(mergedProfilePic)} alt="Avatar" />
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
                placeholder="Search people, posts, hashtags..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                className="mobile-search-input"
                autoFocus
              />
            </form>

            {showSuggestions && renderSuggestionContent()}
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

