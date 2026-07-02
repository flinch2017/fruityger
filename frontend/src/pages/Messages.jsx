import React, { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { FaPlus, FaTimes, FaUser, FaUsers } from "react-icons/fa";
import supabase from "../lib/supabaseClient";
import "../css/Messages.css";
import { getSafeMediaUrl } from "../utils/mediaUrl";
import VerifiedBadge from "../components/VerifiedBadge";
import { getDisplayInitial, getDisplayName } from "../utils/displayName";

function buildGroupTitle(groupChat) {
  if (groupChat.group_name?.trim()) return groupChat.group_name.trim();
  return "Group chat";
}

const getMessageSenderName = (chat) =>
  String(chat?.last_message_sender_account_name || chat?.last_message_sender_username || "").trim();

export default function Messages() {
  const navigate = useNavigate();
  const token = localStorage.getItem("token");
  const userId = localStorage.getItem("userId");

  const [chats, setChats] = useState([]);
  const [groupChats, setGroupChats] = useState([]);
  const [messageRequests, setMessageRequests] = useState([]);
  const [activeView, setActiveView] = useState("inbox");
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedConversationKeys, setSelectedConversationKeys] = useState([]);
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

  const selectedConversationSet = useMemo(
    () => new Set(selectedConversationKeys),
    [selectedConversationKeys]
  );
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

  const fetchMessageRequests = async () => {
    const res = await fetch("http://localhost:5000/api/messages/requests", {
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
      const [directData, groupData, requestData] = await Promise.all([
        fetchDirectChats(),
        fetchGroupChats().catch(() => []),
        fetchMessageRequests().catch(() => []),
      ]);

      setChats(directData);
      setGroupChats(groupData);
      setMessageRequests(requestData);
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
      toggleSelectedConversation("direct", chatId);
      return;
    }

    navigate(`/chat/${chatId}`);
  };

  const handleGroupChatClick = (groupChatId) => {
    if (selectionMode) {
      toggleSelectedConversation("group", groupChatId);
      return;
    }
    navigate(`/group-chat/${groupChatId}`);
  };

  const handleRequestChatClick = (chatId) => {
    navigate(`/chat/${chatId}`);
  };

  const handleAcceptRequest = async (chatId) => {
    try {
      const res = await fetch(`http://localhost:5000/api/messages/requests/${chatId}/accept`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Failed to accept message request");
      }

      await fetchConversations({ silent: true });
      await broadcastInboxSync("accepted-message-request", { chatId });
      setActiveView("inbox");
      navigate(`/chat/${chatId}`);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteRequest = async (chatId) => {
    try {
      const res = await fetch(`http://localhost:5000/api/messages/requests/${chatId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Failed to delete message request");
      }

      setMessageRequests((prev) => prev.filter((request) => request.id !== chatId));
      await broadcastInboxSync("deleted-message-request", { chatId });
    } catch (err) {
      console.error(err);
    }
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
          return getDisplayName(a, "").localeCompare(getDisplayName(b, ""));
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

  const getConversationSelectionKey = (type, id) => `${type}:${id}`;

  const toggleSelectedConversation = (type, id) => {
    const key = getConversationSelectionKey(type, id);
    setSelectedConversationKeys((prev) =>
      prev.includes(key) ? prev.filter((entry) => entry !== key) : [...prev, key]
    );
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedConversationKeys([]);
  };

  const deleteSelectedChats = async () => {
    if (!token || selectedConversationKeys.length === 0) return;

    setDeletingChats(true);

    try {
      const directIds = selectedConversationKeys
        .filter((key) => key.startsWith("direct:"))
        .map((key) => key.slice("direct:".length));
      const groupIds = selectedConversationKeys
        .filter((key) => key.startsWith("group:"))
        .map((key) => key.slice("group:".length));

      let deletedDirectIds = [];

      if (directIds.length > 0) {
        const res = await fetch("http://localhost:5000/api/messages/delete-chats", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ chatIds: directIds }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to delete chats");
        }

        deletedDirectIds = data.chatIds || [];
      }

      if (groupIds.length > 0) {
        await Promise.all(
          groupIds.map(async (groupChatId) => {
            const res = await fetch(`http://localhost:5000/api/messages/groups/chats/${groupChatId}/delete`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
              },
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              throw new Error(data.error || "Failed to delete group chat");
            }
          })
        );
      }

      const deletedDirectSet = new Set(deletedDirectIds);
      const deletedGroupSet = new Set(groupIds);

      const nextChats = chats.filter((chat) => !deletedDirectSet.has(chat.id));
      const nextGroupChats = groupChats.filter((chat) => !deletedGroupSet.has(chat.id));

      setChats(nextChats);
      setGroupChats(nextGroupChats);
      updateUnreadEvent(nextChats, nextGroupChats);

      exitSelectionMode();
      await broadcastInboxSync("deleted-chat", { conversationKeys: selectedConversationKeys });
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

  const renderGroupAvatar = (chat) => {
    if (chat?.group_image) {
      return (
        <div className="chat-avatar group-avatar single-group-avatar">
          <img src={getSafeMediaUrl(chat.group_image)} alt="Group" />
        </div>
      );
    }

    const previewMembers = (chat?.members || [])
      .filter((member) => String(member.id) !== String(userId))
      .slice(0, 2);

    return (
      <div className="chat-avatar group-avatar">
        {previewMembers.length > 0 ? (
          previewMembers.map((member, index) => (
            <span
              key={member.id}
              className={`group-avatar-bubble group-avatar-bubble-${index + 1}`}
            >
              {member.profile_pic ? (
                <img src={getSafeMediaUrl(member.profile_pic)} alt={getDisplayName(member)} />
              ) : (
                getDisplayInitial(member)
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
          <h2>{activeView === "requests" ? "Message Requests" : "Chats"}</h2>

          <div className="messages-toolbar-actions">
            {!selectionMode && (
              <button
                className={`messages-action-btn ${activeView === "requests" ? "primary" : ""}`}
                onClick={() => {
                  setActiveView((current) => (current === "requests" ? "inbox" : "requests"));
                  exitSelectionMode();
                }}
              >
                Requests
                {messageRequests.length > 0 && (
                  <span className="messages-action-badge">{messageRequests.length}</span>
                )}
              </button>
            )}

            {!selectionMode && activeView === "inbox" && (
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
                  disabled={deletingChats || selectedConversationKeys.length === 0}
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
                disabled={activeView !== "inbox" || combinedConversations.length === 0}
              >
                Select
              </button>
            )}
          </div>
        </div>

        {activeView === "inbox" && (
          <input
            type="text"
            className="chat-search"
            placeholder="Search users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        )}

        {activeView === "inbox" && (
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
                      <img src={getSafeMediaUrl(user.profile_pic)} alt={getDisplayName(user)} />
                    ) : (
                      <FaUser />
                    )}
                  </span>
                  {user.is_online && <span className="messages-online-dot online"></span>}
                  <span className="messages-online-name">
                    <span className="username-with-badge">
                      {getDisplayName(user)}
                      <VerifiedBadge verified={user.is_verified} />
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="messages-online-empty">No chat or follow contacts to show yet.</div>
          )}
        </div>
        )}

        {activeView === "inbox" && searchResults.length > 0 && (
          <div className="search-results">
            {searchResults.map((user) => (
              <div
                key={user.id}
                className="chat-preview search-result"
                onClick={() => handleStartChat(user.id)}
              >
                <div className="chat-avatar">
                  {user.profile_pic ? (
                    <img src={getSafeMediaUrl(user.profile_pic)} alt={getDisplayName(user)} />
                  ) : (
                    <FaUser />
                  )}
                </div>
                <div className="chat-info">
                  <h4>
                    <span className="username-with-badge">
                      {getDisplayName(user)}
                      <VerifiedBadge verified={user.is_verified} />
                    </span>
                  </h4>
                  <p>Start a fresh conversation</p>
                </div>
                <div className="search-result-cta">Message</div>
              </div>
            ))}
          </div>
        )}

        <div className="chat-list">
          {activeView === "requests" ? (
            messageRequests.length === 0 ? (
              <div className="messages-empty-state">
                <h3>No message requests</h3>
                <p>New chats from people outside your mutual follows will appear here.</p>
              </div>
            ) : (
              messageRequests.map((chat) => {
                const requester = chat.user1?.id === userId ? chat.user2 : chat.user1;
                const previewText = chat.last_message || "Wants to send you a message";

                return (
                  <div
                    key={`request-${chat.id}`}
                    className="chat-preview message-request-preview"
                    onClick={() => handleRequestChatClick(chat.id)}
                  >
                    <div className="chat-avatar">
                      {requester?.profile_pic ? (
                        <img src={getSafeMediaUrl(requester.profile_pic)} alt={getDisplayName(requester)} />
                      ) : (
                        <span className="avatar-initial">
                          {getDisplayInitial(requester)}
                        </span>
                      )}
                    </div>

                    <div className="chat-info">
                      <div className="chat-top">
                        <h4>
                          <span className="username-with-badge">
                            {getDisplayName(requester, "Request")}
                            <VerifiedBadge verified={requester?.is_verified} />
                          </span>
                        </h4>
                        <span className="chat-date">{formatChatDate(chat.last_message_at || chat.requested_at)}</span>
                      </div>

                      <p>{previewText}</p>

                      <div className="message-request-actions" onClick={(event) => event.stopPropagation()}>
                        <button
                          type="button"
                          className="messages-action-btn primary"
                          onClick={() => handleAcceptRequest(chat.id)}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          className="messages-action-btn danger"
                          onClick={() => handleDeleteRequest(chat.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )
          ) : loading ? (
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
                  ? getMessageSenderName(chat)
                    ? `${getMessageSenderName(chat)}: ${chat.last_message}`
                    : chat.last_message
                  : "Group created";

                return (
                  <div
                    key={`group-${chat.id}`}
                    className={`chat-preview group-chat-preview ${isUnread ? "unread-chat" : ""} ${
                      selectedConversationSet.has(getConversationSelectionKey("group", chat.id))
                        ? "selected-chat"
                        : ""
                    }`}
                    onClick={() => handleGroupChatClick(chat.id)}
                  >
                    {selectionMode && (
                      <span className="selection-check">
                        {selectedConversationSet.has(getConversationSelectionKey("group", chat.id)) ? "✓" : ""}
                      </span>
                    )}
                    {renderGroupAvatar(chat)}

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
                    selectedConversationSet.has(getConversationSelectionKey("direct", chat.id))
                      ? "selected-chat"
                      : ""
                  }`}
                  onClick={() => handleDirectChatClick(chat.id)}
                >
                  {selectionMode && (
                    <span className="selection-check">
                      {selectedConversationSet.has(getConversationSelectionKey("direct", chat.id)) ? "✓" : ""}
                    </span>
                  )}

                  <div className="chat-avatar">
                    {otherUser?.profile_pic ? (
                      <img src={getSafeMediaUrl(otherUser.profile_pic)} alt={getDisplayName(otherUser)} />
                    ) : (
                      <span className="avatar-initial">
                        {getDisplayInitial(otherUser)}
                      </span>
                    )}
                  </div>

                  <div className="chat-info">
                    <div className="chat-top">
                      <h4>
                        <span className="username-with-badge">
                          {getDisplayName(otherUser, "Conversation")}
                          <VerifiedBadge verified={otherUser?.is_verified} />
                        </span>
                      </h4>

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
                    {getDisplayName(member)}
                    <button
                      type="button"
                      onClick={() => removeGroupMember(member.id)}
                      aria-label={`Remove ${getDisplayName(member)}`}
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
                        <img src={getSafeMediaUrl(user.profile_pic)} alt={getDisplayName(user)} />
                      ) : (
                        <FaUser />
                      )}
                    </span>
                    <span className="messages-group-result-copy">
                      <strong>
                        <span className="username-with-badge">
                          {getDisplayName(user)}
                          <VerifiedBadge verified={user.is_verified} />
                        </span>
                      </strong>
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
