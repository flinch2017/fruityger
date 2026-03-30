import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import "../css/Messages.css";

export default function Messages() {
  const navigate = useNavigate();
  const token = localStorage.getItem("token");
  const userId = localStorage.getItem("userId");

  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  

  // Ref for the sidebar/search area
  const sidebarRef = useRef(null);

  useEffect(() => {
    const fetchChats = async () => {
      setLoading(true);
      try {
        const res = await fetch("http://localhost:5000/api/messages/chats", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        setChats(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchChats();
  }, [token]);

  // Search users to start new chats
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const fetchUsers = async () => {
      try {
        const res = await fetch(
          `http://localhost:5000/api/messages/search-users?q=${encodeURIComponent(
            searchQuery
          )}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json();
        // Filter out yourself
        setSearchResults(data.filter((u) => u.id !== userId));
      } catch (err) {
        console.error(err);
      }
    };

    fetchUsers();
  }, [searchQuery, token, userId]);

  // Handle click outside to close search results
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

  const handleChatClick = (chatId) => {
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


  const formatChatDate = (dateString) => {
    if (!dateString) return "";

    const date = new Date(dateString);
    const now = new Date();

    const isToday =
      date.toDateString() === now.toDateString();

    const isYesterday =
      new Date(now.setDate(now.getDate() - 1)).toDateString() ===
      date.toDateString();

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
        <h2>Chats</h2>

        {/* Search bar */}
        <input
          type="text"
          className="chat-search"
          placeholder="Search users..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        {/* Search results for new chats */}
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
                    <img src={user.profile_pic} alt={user.username} />
                  ) : (
                    "👤"
                  )}
                </div>
                <div className="chat-info">
                  <h4>{user.username}</h4>
                  <p>Tap to chat</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Existing chats */}
        <div className="chat-list">
          {loading ? (
            <div className="spinner-alpha-container">
              <div className="spinner-alpha"></div>
            </div>
          ) : chats.length === 0 ? (
            <p className="empty-text">No chats yet</p>
          ) : (
            chats.map((chat) => {
              const otherUser = chat.user1?.id === userId ? chat.user2 : chat.user1;
              const isMine = String(chat.last_message_sender_id) === String(userId);
              const isUnread = !chat.last_message_read && !isMine;
              const isSeen = chat.last_message_read && isMine;
              return (
                <div
                  key={chat.id}
                  className={`chat-preview ${isUnread ? "unread-chat" : ""}`}
                  onClick={() => handleChatClick(chat.id)}
                >
                  <div className="chat-avatar">
                    {otherUser?.profile_pic ? (
                      <img src={otherUser.profile_pic} alt={otherUser.username} />
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