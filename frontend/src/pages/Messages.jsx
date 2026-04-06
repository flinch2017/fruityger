import React, { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { FaPlus, FaTimes, FaUser, FaUsers } from "react-icons/fa";
import supabase from "../lib/supabaseClient";
import "../css/Messages.css";
import { getSafeMediaUrl } from "../utils/mediaUrl";

function buildGroupTitle(groupChat) {
  if (groupChat.group_name?.trim()) return groupChat.group_name.trim();
  return "Group chat";
}

export default function Messages() {
  const navigate = useNavigate();
  const token = localStorage.getItem("token");
  const userId = localStorage.getItem("userId");

  const [chats, setChats] = useState([]);
  const [groupChats, setGroupChats] = useState([]);
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

  const updateUnreadEvent = (chatList, groupChatList = []) => {
    const unreadCount =
      (chatList || []).reduce((total, chat) => total + Number(chat.unread_count || 0), 0) +
      (groupChatList || []).reduce((total, chat) => total + Number(chat.unread_count || 0), 0);

    window.dispatchEvent(
      new CustomEvent("fruityger:messages-refresh", {
        detail: { unreadCount },
      })
    );
  };

  const fetchDirectChats = async () => {
    const res = await fetch("http://localhost:5000/api/messages/chats", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  };

  const fetchGroupChats = async () => {
    const res = await fetch("http://localhost:5000/api/messages/groups/chats", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  };

  const fetchConversations = async ({ silent = false } = {}) => {
    if (!token) return;

    if (!silent) {
      setLoading(true);
    }

    try {
      const [directData, groupData] = await Promise.all([
        fetchDirectChats(),
        fetchGroupChats().catch(() => []),
      ]);

      setChats(directData);
      setGroupChats(groupData);
      updateUnreadEvent(directData, groupData);
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
      fetchConversations({ silent: true });
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
    fetchConversations();
    fetchOnlineCandidates();
  }, [token]);

  useEffect(() => {
    const handleRefresh = (event) => {
      if (typeof event.detail?.unreadCount === "number") return;
      fetchConversations({ silent: true });
      fetchOnlineCandidates({ silent: true });
    };

    const handleFocus = () => fetchConversations({ silent: true });

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
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, scheduleRealtimeRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "chats" }, () => {
        scheduleRealtimeRefresh();
        fetchOnlineCandidates({ silent: true });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "deleted_messages" }, scheduleRealtimeRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "deleted_chats" }, scheduleRealtimeRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "group_chats" }, scheduleRealtimeRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "group_messages" }, scheduleRealtimeRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "group_chat_members" }, scheduleRealtimeRefresh)
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
      .on("broadcast", { event: "inbox-sync" }, () => {
        scheduleRealtimeRefresh();
        fetchOnlineCandidates({ silent: true });
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
      .on("presence", { event: "sync" }, () => syncPresenceState(channel))
      .on("presence", { event: "join" }, () => syncPresenceState(channel))
      .on("presence", { event: "leave" }, () => syncPresenceState(channel))
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          syncPresenceState(channel);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const handleDirectChatClick = (chatId) => {
    if (selectionMode) {
      toggleSelectedChat(chatId);
      return;
    }

    navigate(`/chat/${chatId}`);
  };

  const handleGroupChatClick = (groupChatId) => {
    if (selectionMode) return;
    navigate(`/group-chat/${groupChatId}`);
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

  const removeGroupMember = (memberId) => {
    setSelectedGroupMembers((prev) =>
      prev.filter((member) => String(member.id) !== String(memberId))
    );
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim() || selectedGroupMembers.length === 0 || creatingGroup) return;

    setCreatingGroup(true);

    try {
      const res = await fetch("http://localhost:5000/api/messages/groups/chats", {
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

      await fetchConversations({ silent: true });
      await broadcastInboxSync("created-group-chat", { groupChatId: data.groupChatId });
      closeGroupModal();
      navigate(`/group-chat/${data.groupChatId}`);
    } catch (err) {
      console.error(err);
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
          if (Boolean(a.is_online) !== Boolean(b.is_online)) {
            return a.is_online ? -1 : 1;
          }
          return String(a.username || "").localeCompare(String(b.username || ""));
        }),
    [onlineCandidates, onlineUserIds]
  );

  const combinedConversations = useMemo(() => {
    const direct = chats.map((chat) => ({
      type: "direct",
      id: chat.id,
      sortKey: chat.last_message_at || "",
      data: chat,
    }));

    const groups = groupChats.map((chat) => ({
      type: "group",
      id: chat.id,
      sortKey: chat.last_message_at || chat.created_at || "",
      data: chat,
    }));

    return [...direct, ...groups].sort((a, b) => {
      const aTime = a.sortKey ? new Date(a.sortKey).getTime() : 0;
      const bTime = b.sortKey ? new Date(b.sortKey).getTime() : 0;
      return bTime - aTime;
    });
  }, [chats, groupChats]);

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
        updateUnreadEvent(nextChats, groupChats);
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

  const renderGroupAvatar = (members) => {
    const previewMembers = (members || []).filter((member) => String(member.id) !== String(userId)).slice(0, 2);

    return (
      <div className="chat-avatar group-avatar">
        {previewMembers.length > 0 ? (
          previewMembers.map((member, index) => (
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
          ))
        ) : (
          <FaUsers />
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
          ) : combinedConversations.length === 0 ? (
            <div className="messages-empty-state">
              <div className="messages-empty-buddy" aria-hidden="true">
                <div className="buddy-orb">
                  <span className="buddy-face">o_o</span>
                </div>
                <div className="buddy-shadow"></div>
              </div>
              <h3>Your inbox is empty</h3>
              <p>Search for a friend above or build a new group chat to get things glowing.</p>
            </div>
          ) : (
            combinedConversations.map((entry) => {
              if (entry.type === "group") {
                const chat = entry.data;
                const isUnread = Number(chat.unread_count || 0) > 0;
                const previewText = chat.last_message
                  ? chat.last_message_sender_username
                    ? `${chat.last_message_sender_username}: ${chat.last_message}`
                    : chat.last_message
                  : "Group created";

                return (
                  <div
                    key={`group-${chat.id}`}
                    className={`chat-preview group-chat-preview ${isUnread ? "unread-chat" : ""}`}
                    onClick={() => handleGroupChatClick(chat.id)}
                  >
                    {renderGroupAvatar(chat.members)}

                    <div className="chat-info">
                      <div className="chat-top">
                        <div className="chat-title-stack">
                          <h4>{buildGroupTitle(chat)}</h4>
                          <span className="chat-subtitle">
                            {(chat.members || []).length} members
                          </span>
                        </div>

                        <div className="chat-meta">
                          <span className="chat-date">{formatChatDate(chat.last_message_at || chat.created_at)}</span>
                          {isUnread && (
                            <span className="chat-unread-badge">
                              {chat.unread_count > 9 ? "9+" : chat.unread_count}
                            </span>
                          )}
                        </div>
                      </div>

                      <p className={isUnread ? "unread" : ""}>{previewText}</p>
                    </div>
                  </div>
                );
              }

              const chat = entry.data;
              const otherUser = chat.user1?.id === userId ? chat.user2 : chat.user1;
              const isMine = String(chat.last_message_sender_id) === String(userId);
              const isUnread = Number(chat.unread_count || 0) > 0;
              const isSeen = chat.last_message_read && isMine;

              return (
                <div
                  key={`direct-${chat.id}`}
                  className={`chat-preview ${isUnread ? "unread-chat" : ""} ${
                    selectedChatSet.has(chat.id) ? "selected-chat" : ""
                  }`}
                  onClick={() => handleDirectChatClick(chat.id)}
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
                      <h4>{otherUser?.username || "Conversation"}</h4>

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
                placeholder="Search friends to add"
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
