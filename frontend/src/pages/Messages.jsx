import React, { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { FaUser } from "react-icons/fa";
import supabase from "../lib/supabaseClient";
import "../css/Messages.css";
import { getSafeMediaUrl } from "../utils/mediaUrl";

export default function Messages() {
  const navigate = useNavigate();
  const token = localStorage.getItem("token");
  const userId = localStorage.getItem("userId");

  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedChatIds, setSelectedChatIds] = useState([]);
  const [deletingChats, setDeletingChats] = useState(false);
  const [onlineCandidates, setOnlineCandidates] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const sidebarRef = useRef(null);
  const refreshTimeoutRef = useRef(null);
  const pollingIntervalRef = useRef(null);

  const selectedChatSet = useMemo(() => new Set(selectedChatIds), [selectedChatIds]);

  const updateUnreadEvent = (chatList) => {
    const unreadCount = (chatList || []).reduce(
      (total, chat) => total + Number(chat.unread_count || 0),
      0
    );

    window.dispatchEvent(
      new CustomEvent("fruityger:messages-refresh", {
        detail: { unreadCount },
      })
    );
  };

  const fetchChats = async ({ silent = false } = {}) => {
    if (!token) return;

    if (!silent) {
      setLoading(true);
    }
    try {
      const res = await fetch("http://localhost:5000/api/messages/chats", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setChats(data);
      updateUnreadEvent(data);
    } catch (err) {
      console.error(err);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const fetchOnlineCandidates = async () => {
    if (!token) return;

    try {
      const res = await fetch("http://localhost:5000/api/messages/online-candidates", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Failed to load online candidates");
      }

      setOnlineCandidates(data.users || []);
    } catch (err) {
      console.error(err);
    }
  };

  const scheduleRealtimeRefresh = () => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }

    refreshTimeoutRef.current = setTimeout(() => {
      fetchChats({ silent: true });
    }, 120);
  };

  useEffect(() => {
    fetchChats();
    fetchOnlineCandidates();
  }, [token]);

  useEffect(() => {
    const handleRefresh = (event) => {
      if (typeof event.detail?.unreadCount === "number") return;
      fetchChats({ silent: true });
      fetchOnlineCandidates();
    };

    const handleFocus = () => fetchChats({ silent: true });

    window.addEventListener("focus", handleFocus);
    window.addEventListener("fruityger:messages-refresh", handleRefresh);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("fruityger:messages-refresh", handleRefresh);
    };
  }, [token]);

  useEffect(() => {
    const handlePresence = (event) => {
      setOnlineUsers(event.detail?.users || []);
    };

    window.addEventListener("fruityger:online-presence", handlePresence);

    return () => {
      window.removeEventListener("fruityger:online-presence", handlePresence);
    };
  }, []);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const fetchUsers = async () => {
      try {
        const res = await fetch(
          `http://localhost:5000/api/messages/search-users?q=${encodeURIComponent(searchQuery)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json();
        setSearchResults(data.filter((user) => user.id !== userId));
      } catch (err) {
        console.error(err);
      }
    };

    fetchUsers();
  }, [searchQuery, token, userId]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (sidebarRef.current && !sidebarRef.current.contains(event.target)) {
        setSearchResults([]);
        setSearchQuery("");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!token || !userId) return;

    const channel = supabase
      .channel(`messages-sidebar-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        () => {
          scheduleRealtimeRefresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chats" },
        () => {
          scheduleRealtimeRefresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deleted_messages" },
        () => {
          scheduleRealtimeRefresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deleted_chats" },
        () => {
          scheduleRealtimeRefresh();
        }
      )
      .subscribe();

    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      supabase.removeChannel(channel);
    };
  }, [token, userId]);

  useEffect(() => {
    if (!token) return;

    pollingIntervalRef.current = setInterval(() => {
      fetchChats({ silent: true });
    }, 4000);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [token]);

  const handleChatClick = (chatId) => {
    if (selectionMode) {
      toggleSelectedChat(chatId);
      return;
    }

    navigate(`/chat/${chatId}`);
  };

  const handleStartChat = async (targetUserId) => {
    try {
      const res = await fetch("http://localhost:5000/api/messages/get-or-create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ targetUserId }),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error(data.error);
        return;
      }

      navigate(`/chat/${data.chatId}`);
    } catch (err) {
      console.error(err);
    }
  };

  const onlineMap = useMemo(
    () => new Map(onlineUsers.map((entry) => [String(entry.userId), entry])),
    [onlineUsers]
  );

  const onlineVisibleUsers = useMemo(
    () =>
      onlineCandidates
        .filter((user) => onlineMap.has(String(user.id)))
        .map((user) => ({
          ...user,
          profile_pic: onlineMap.get(String(user.id))?.profile_pic || user.profile_pic,
        })),
    [onlineCandidates, onlineMap]
  );

  const toggleSelectedChat = (chatId) => {
    setSelectedChatIds((prev) =>
      prev.includes(chatId)
        ? prev.filter((id) => id !== chatId)
        : [...prev, chatId]
    );
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedChatIds([]);
  };

  const deleteSelectedChats = async () => {
    if (!token || selectedChatIds.length === 0) return;

    setDeletingChats(true);

    try {
      const res = await fetch("http://localhost:5000/api/messages/delete-chats", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ chatIds: selectedChatIds }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to delete chats");
      }

      const allowedSet = new Set(data.chatIds || []);

      setChats((prev) => {
        const nextChats = prev.filter((chat) => !allowedSet.has(chat.id));
        updateUnreadEvent(nextChats);
        return nextChats;
      });

      exitSelectionMode();
    } catch (err) {
      console.error(err);
    } finally {
      setDeletingChats(false);
    }
  };

  const formatChatDate = (dateString) => {
    if (!dateString) return "";

    const date = new Date(dateString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = yesterday.toDateString() === date.toDateString();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    if (isYesterday) {
      return "Yesterday";
    }

    return date.toLocaleDateString();
  };

  return (
    <div className="messages-page">
      <div
        ref={sidebarRef}
        className={`messages-sidebar ${searchResults.length > 0 ? "searching" : ""}`}
      >
        <div className="messages-toolbar">
          <h2>Chats</h2>

          <div className="messages-toolbar-actions">
            {selectionMode ? (
              <>
                <button
                  className="messages-action-btn danger"
                  onClick={deleteSelectedChats}
                  disabled={deletingChats || selectedChatIds.length === 0}
                >
                  Delete Selected
                </button>
                <button
                  className="messages-action-btn"
                  onClick={exitSelectionMode}
                  disabled={deletingChats}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="messages-action-btn"
                onClick={() => setSelectionMode(true)}
                disabled={chats.length === 0}
              >
                Select
              </button>
            )}
          </div>
        </div>

        <input
          type="text"
          className="chat-search"
          placeholder="Search users..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        {onlineVisibleUsers.length > 0 && (
          <div className="messages-online-strip">
            <div className="messages-online-header">
              <h3>Online now</h3>
              <span>{onlineVisibleUsers.length} active</span>
            </div>

            <div className="messages-online-list">
              {onlineVisibleUsers.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  className="messages-online-item"
                  onClick={() =>
                    user.chat_id ? navigate(`/chat/${user.chat_id}`) : handleStartChat(user.id)
                  }
                >
                  <span className="messages-online-avatar">
                    {user.profile_pic ? (
                      <img src={getSafeMediaUrl(user.profile_pic)} alt={user.username} />
                    ) : (
                      <FaUser />
                    )}
                    <span className="messages-online-dot"></span>
                  </span>

                  <span className="messages-online-name">{user.username}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {searchResults.length > 0 && (
          <div className="search-results">
            {searchResults.map((user) => (
              <div
                key={user.id}
                className="chat-preview search-result"
                onClick={() => handleStartChat(user.id)}
              >
                <div className="chat-avatar">
                  {user.profile_pic ? (
                    <img src={getSafeMediaUrl(user.profile_pic)} alt={user.username} />
                  ) : (
                    "👤"
                  )}
                </div>
                <div className="chat-info">
                  <h4>{user.username}</h4>
                  <p>Start a fresh conversation</p>
                </div>
                <div className="search-result-cta">
                  Message
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="chat-list">
          {loading ? (
            <div className="spinner-alpha-container">
              <div className="spinner-alpha"></div>
            </div>
          ) : chats.length === 0 ? (
            <div className="messages-empty-state">
              <div className="messages-empty-buddy" aria-hidden="true">
                <div className="buddy-orb">
                  <span className="buddy-face">◕‿◕</span>
                </div>
                <div className="buddy-shadow"></div>
              </div>
              <h3>Your inbox is empty</h3>
              <p>
                Search for a friend above and start a bright little conversation.
              </p>
            </div>
          ) : (
            chats.map((chat) => {
              const otherUser = chat.user1?.id === userId ? chat.user2 : chat.user1;
              const isMine = String(chat.last_message_sender_id) === String(userId);
              const isUnread = Number(chat.unread_count || 0) > 0;
              const isSeen = chat.last_message_read && isMine;

              return (
                <div
                  key={chat.id}
                  className={`chat-preview ${isUnread ? "unread-chat" : ""} ${
                    selectedChatSet.has(chat.id) ? "selected-chat" : ""
                  }`}
                  onClick={() => handleChatClick(chat.id)}
                >
                  {selectionMode && (
                    <span className="selection-check">
                      {selectedChatSet.has(chat.id) ? "✓" : ""}
                    </span>
                  )}

                  <div className="chat-avatar">
                    {otherUser?.profile_pic ? (
                      <img src={getSafeMediaUrl(otherUser.profile_pic)} alt={otherUser.username} />
                    ) : (
                      <span className="avatar-initial">
                        {otherUser?.username?.[0]?.toUpperCase() || "?"}
                      </span>
                    )}
                  </div>

                  <div className="chat-info">
                    <div className="chat-top">
                      <h4>{otherUser.username}</h4>

                      <div className="chat-meta">
                        <span className="chat-date">
                          {formatChatDate(chat.last_message_at)}
                        </span>

                        {isUnread && (
                          <span className="chat-unread-badge">
                            {chat.unread_count > 9 ? "9+" : chat.unread_count}
                          </span>
                        )}

                        {isSeen && <span className="seen-label">Seen</span>}
                      </div>
                    </div>

                    <p className={isUnread ? "unread" : ""}>
                      {chat.last_message
                        ? isMine
                          ? `You: ${chat.last_message}`
                          : chat.last_message
                        : "Say hi!"}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
