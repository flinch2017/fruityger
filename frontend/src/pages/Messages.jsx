import React, { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { FaCheck, FaPlus, FaTimes, FaUser, FaUsers } from "react-icons/fa";
import supabase from "../lib/supabaseClient";
import "../css/Messages.css";
import { getSafeMediaUrl } from "../utils/mediaUrl";

function buildDirectChatMeta(chat, currentUserId) {
  const members = Array.isArray(chat.members) ? chat.members : [];
  const otherUser =
    members.find((member) => String(member.id) !== String(currentUserId)) || members[0] || null;

  return {
    isGroup: false,
    otherUser,
    title: otherUser?.username || "Conversation",
    subtitle: "Direct message",
    avatarType: "direct",
    avatarUsers: otherUser ? [otherUser] : [],
  };
}

function buildGroupChatMeta(chat, currentUserId) {
  const members = Array.isArray(chat.members) ? chat.members : [];
  const otherMembers = members.filter((member) => String(member.id) !== String(currentUserId));
  const title =
    chat.group_name?.trim() ||
    otherMembers.map((member) => member.username).slice(0, 3).join(", ") ||
    "Group chat";
  const subtitle =
    members.length > 0 ? `${members.length} members` : "Group conversation";

  return {
    isGroup: true,
    otherUser: null,
    title,
    subtitle,
    avatarType: "group",
    avatarUsers: otherMembers.slice(0, 2),
  };
}

function buildChatMeta(chat, currentUserId) {
  return chat?.is_group
    ? buildGroupChatMeta(chat, currentUserId)
    : buildDirectChatMeta(chat, currentUserId);
}

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
  const [onlineLoading, setOnlineLoading] = useState(true);
  const [onlineUserIds, setOnlineUserIds] = useState([]);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupSearchQuery, setGroupSearchQuery] = useState("");
  const [groupSearchResults, setGroupSearchResults] = useState([]);
  const [selectedGroupMembers, setSelectedGroupMembers] = useState([]);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const sidebarRef = useRef(null);
  const groupModalRef = useRef(null);
  const refreshTimeoutRef = useRef(null);
  const inboxChannelRef = useRef(null);

  const syncPresenceState = (channel) => {
    const nextOnlineIds = new Set();
    const state = channel.presenceState();

    Object.values(state).forEach((entries = []) => {
      entries.forEach((entry) => {
        if (entry?.user_id) {
          nextOnlineIds.add(String(entry.user_id));
        }
      });
    });

    setOnlineUserIds(Array.from(nextOnlineIds));
  };

  const selectedChatSet = useMemo(() => new Set(selectedChatIds), [selectedChatIds]);
  const selectedGroupMemberSet = useMemo(
    () => new Set(selectedGroupMembers.map((member) => String(member.id))),
    [selectedGroupMembers]
  );

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
      setChats(Array.isArray(data) ? data : []);
      updateUnreadEvent(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const fetchOnlineCandidates = async ({ silent = false } = {}) => {
    if (!token) return;

    try {
      if (!silent) {
        setOnlineLoading(true);
      }
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
    } finally {
      if (!silent) {
        setOnlineLoading(false);
      }
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

  const broadcastInboxSync = async (reason = "refresh", extra = {}) => {
    if (!inboxChannelRef.current) return;

    try {
      await inboxChannelRef.current.send({
        type: "broadcast",
        event: "inbox-sync",
        payload: {
          actorUserId: userId,
          reason,
          at: Date.now(),
          ...extra,
        },
      });
    } catch (error) {
      console.error("Failed to broadcast inbox sync:", error);
    }
  };

  useEffect(() => {
    fetchChats();
    fetchOnlineCandidates();
  }, [token]);

  useEffect(() => {
    const handleRefresh = (event) => {
      if (typeof event.detail?.unreadCount === "number") return;
      fetchChats({ silent: true });
      fetchOnlineCandidates({ silent: true });
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
        setSearchResults(Array.isArray(data) ? data.filter((user) => user.id !== userId) : []);
      } catch (err) {
        console.error(err);
      }
    };

    fetchUsers();
  }, [searchQuery, token, userId]);

  useEffect(() => {
    if (!groupModalOpen || !groupSearchQuery.trim()) {
      setGroupSearchResults([]);
      return;
    }

    const fetchUsers = async () => {
      try {
        const res = await fetch(
          `http://localhost:5000/api/messages/search-users?q=${encodeURIComponent(groupSearchQuery)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json();
        setGroupSearchResults(
          Array.isArray(data)
            ? data.filter(
                (user) =>
                  user.id !== userId && !selectedGroupMemberSet.has(String(user.id))
              )
            : []
        );
      } catch (err) {
        console.error(err);
      }
    };

    fetchUsers();
  }, [groupModalOpen, groupSearchQuery, token, userId, selectedGroupMemberSet]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (groupModalOpen) {
        if (groupModalRef.current && !groupModalRef.current.contains(event.target)) {
          setGroupModalOpen(false);
        }
        return;
      }

      if (sidebarRef.current && !sidebarRef.current.contains(event.target)) {
        setSearchResults([]);
        setSearchQuery("");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [groupModalOpen]);

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
          fetchOnlineCandidates({ silent: true });
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
    if (!userId) return undefined;

    const channel = supabase
      .channel("fruityger-messages-live")
      .on("broadcast", { event: "inbox-sync" }, ({ payload }) => {
        if (!payload) return;
        scheduleRealtimeRefresh();

        if (
          payload.reason === "created-chat" ||
          payload.reason === "deleted-chat" ||
          payload.reason === "membership-changed"
        ) {
          fetchOnlineCandidates({ silent: true });
        }
      })
      .subscribe();

    inboxChannelRef.current = channel;

    return () => {
      inboxChannelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;

    const channel = supabase
      .channel("fruityger-online")
      .on("presence", { event: "sync" }, () => {
        syncPresenceState(channel);
      })
      .on("presence", { event: "join" }, () => {
        syncPresenceState(channel);
      })
      .on("presence", { event: "leave" }, () => {
        syncPresenceState(channel);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          syncPresenceState(channel);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

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

      fetchOnlineCandidates({ silent: true });
      await broadcastInboxSync("created-chat", { chatId: data.chatId });
      navigate(`/chat/${data.chatId}`);
    } catch (err) {
      console.error(err);
    }
  };

  const openGroupModal = () => {
    setGroupModalOpen(true);
    setGroupName("");
    setGroupSearchQuery("");
    setGroupSearchResults([]);
    setSelectedGroupMembers([]);
  };

  const closeGroupModal = () => {
    if (creatingGroup) return;
    setGroupModalOpen(false);
    setGroupName("");
    setGroupSearchQuery("");
    setGroupSearchResults([]);
    setSelectedGroupMembers([]);
  };

  const addGroupMember = (user) => {
    setSelectedGroupMembers((prev) =>
      prev.some((member) => String(member.id) === String(user.id)) ? prev : [...prev, user]
    );
    setGroupSearchQuery("");
    setGroupSearchResults([]);
  };

  const removeGroupMember = (userIdToRemove) => {
    setSelectedGroupMembers((prev) =>
      prev.filter((member) => String(member.id) !== String(userIdToRemove))
    );
  };

  const handleCreateGroup = async () => {
    if (creatingGroup || !groupName.trim() || selectedGroupMembers.length === 0) return;

    setCreatingGroup(true);

    try {
      const res = await fetch("http://localhost:5000/api/messages/group-create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          groupName: groupName.trim(),
          memberIds: selectedGroupMembers.map((member) => member.id),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to create group chat");
      }

      await fetchChats({ silent: true });
      await broadcastInboxSync("created-chat", { chatId: data.chatId });
      closeGroupModal();
      navigate(`/chat/${data.chatId}`);
    } catch (error) {
      console.error(error);
    } finally {
      setCreatingGroup(false);
    }
  };

  const onlineVisibleUsers = useMemo(
    () =>
      onlineCandidates
        .map((user) => ({
          ...user,
          is_online: onlineUserIds.includes(String(user.id)),
        }))
        .sort((a, b) => {
          const aOnline = Boolean(a.is_online);
          const bOnline = Boolean(b.is_online);

          if (aOnline !== bOnline) {
            return aOnline ? -1 : 1;
          }

          return String(a.username || "").localeCompare(String(b.username || ""));
        }),
    [onlineCandidates, onlineUserIds]
  );

  const toggleSelectedChat = (chatId) => {
    setSelectedChatIds((prev) =>
      prev.includes(chatId) ? prev.filter((id) => id !== chatId) : [...prev, chatId]
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
      await broadcastInboxSync("deleted-chat", { chatIds: selectedChatIds });
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

  const renderChatAvatar = (meta) => {
    if (meta.avatarType === "group") {
      return (
        <div className="chat-avatar group-avatar">
          {meta.avatarUsers.length > 0 ? (
            <>
              {meta.avatarUsers.slice(0, 2).map((member, index) => (
                <span
                  key={member.id}
                  className={`group-avatar-bubble group-avatar-bubble-${index + 1}`}
                >
                  {member.profile_pic ? (
                    <img src={getSafeMediaUrl(member.profile_pic)} alt={member.username} />
                  ) : (
                    member.username?.[0]?.toUpperCase() || "?"
                  )}
                </span>
              ))}
              {meta.avatarUsers.length === 1 && (
                <span className="group-avatar-bubble group-avatar-bubble-2 fallback">
                  <FaUsers />
                </span>
              )}
            </>
          ) : (
            <FaUsers />
          )}
        </div>
      );
    }

    return (
      <div className="chat-avatar">
        {meta.otherUser?.profile_pic ? (
          <img src={getSafeMediaUrl(meta.otherUser.profile_pic)} alt={meta.title} />
        ) : (
          <span className="avatar-initial">{meta.title?.[0]?.toUpperCase() || "?"}</span>
        )}
      </div>
    );
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
            {!selectionMode && (
              <button className="messages-action-btn" onClick={openGroupModal}>
                <FaPlus />
                <span>New Group</span>
              </button>
            )}

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

        <div className="messages-online-strip">
          <div className="messages-online-header">
            <h3>Active</h3>
            <span>
              {onlineVisibleUsers.some((user) => user.is_online)
                ? `${onlineVisibleUsers.filter((user) => user.is_online).length} online`
                : "Quick access"}
            </span>
          </div>

          {onlineLoading ? (
            <div className="messages-online-empty">Loading active people...</div>
          ) : onlineVisibleUsers.length > 0 ? (
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
                  <span className={`messages-online-avatar ${user.is_online ? "online" : "offline"}`}>
                    {user.profile_pic ? (
                      <img src={getSafeMediaUrl(user.profile_pic)} alt={user.username} />
                    ) : (
                      <FaUser />
                    )}
                  </span>
                  {user.is_online && <span className="messages-online-dot online"></span>}

                  <span className="messages-online-name">{user.username}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="messages-online-empty">No chat or follow contacts to show yet.</div>
          )}
        </div>

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
                    <FaUser />
                  )}
                </div>
                <div className="chat-info">
                  <h4>{user.username}</h4>
                  <p>Start a fresh conversation</p>
                </div>
                <div className="search-result-cta">Message</div>
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
                  <span className="buddy-face">o_o</span>
                </div>
                <div className="buddy-shadow"></div>
              </div>
              <h3>Your inbox is empty</h3>
              <p>Search for a friend above or start a group chat to get things glowing.</p>
            </div>
          ) : (
            chats.map((chat) => {
              const meta = buildChatMeta(chat, userId);
              const isMine = String(chat.last_message_sender_id) === String(userId);
              const isUnread = Number(chat.unread_count || 0) > 0;
              const isSeen = chat.last_message_read && isMine;
              const senderName = chat.members?.find(
                (member) => String(member.id) === String(chat.last_message_sender_id)
              )?.username;
              const previewText = chat.last_message
                ? isMine
                  ? `You: ${chat.last_message}`
                  : meta.isGroup && senderName
                    ? `${senderName}: ${chat.last_message}`
                    : chat.last_message
                : "Say hi!";

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
                      {selectedChatSet.has(chat.id) ? <FaCheck /> : ""}
                    </span>
                  )}

                  {renderChatAvatar(meta)}

                  <div className="chat-info">
                    <div className="chat-top">
                      <div className="chat-title-stack">
                        <h4>{meta.title}</h4>
                        {meta.isGroup && <span className="chat-subtitle">{meta.subtitle}</span>}
                      </div>

                      <div className="chat-meta">
                        <span className="chat-date">{formatChatDate(chat.last_message_at)}</span>

                        {isUnread && (
                          <span className="chat-unread-badge">
                            {chat.unread_count > 9 ? "9+" : chat.unread_count}
                          </span>
                        )}

                        {isSeen && <span className="seen-label">Seen</span>}
                      </div>
                    </div>

                    <p className={isUnread ? "unread" : ""}>{previewText}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {groupModalOpen && (
        <div className="messages-group-modal-backdrop">
          <div ref={groupModalRef} className="messages-group-modal">
            <div className="messages-group-modal-header">
              <div>
                <h3>New Group</h3>
                <p>Pick members first, then give the conversation a name.</p>
              </div>
              <button
                type="button"
                className="messages-group-modal-close"
                onClick={closeGroupModal}
                aria-label="Close group creator"
              >
                <FaTimes />
              </button>
            </div>

            <label className="messages-group-label">
              Group name
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Weekend plans"
                maxLength={60}
              />
            </label>

            <label className="messages-group-label">
              Add members
              <input
                type="text"
                value={groupSearchQuery}
                onChange={(e) => setGroupSearchQuery(e.target.value)}
                placeholder="Search followers or chat contacts"
              />
            </label>

            {selectedGroupMembers.length > 0 && (
              <div className="messages-group-selected">
                {selectedGroupMembers.map((member) => (
                  <span key={member.id} className="messages-group-chip">
                    {member.username}
                    <button
                      type="button"
                      onClick={() => removeGroupMember(member.id)}
                      aria-label={`Remove ${member.username}`}
                    >
                      <FaTimes />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {groupSearchResults.length > 0 && (
              <div className="messages-group-results">
                {groupSearchResults.map((user) => (
                  <button
                    type="button"
                    key={user.id}
                    className="messages-group-result"
                    onClick={() => addGroupMember(user)}
                  >
                    <span className="messages-group-result-avatar">
                      {user.profile_pic ? (
                        <img src={getSafeMediaUrl(user.profile_pic)} alt={user.username} />
                      ) : (
                        <FaUser />
                      )}
                    </span>
                    <span className="messages-group-result-copy">
                      <strong>{user.username}</strong>
                      <small>Add to group</small>
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="messages-group-modal-footer">
              <button type="button" className="messages-action-btn" onClick={closeGroupModal}>
                Cancel
              </button>
              <button
                type="button"
                className="messages-action-btn primary"
                onClick={handleCreateGroup}
                disabled={creatingGroup || !groupName.trim() || selectedGroupMembers.length === 0}
              >
                {creatingGroup ? "Creating..." : "Create Group"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
