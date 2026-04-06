import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  FaArrowLeft,
  FaCog,
  FaFileAlt,
  FaFilePdf,
  FaFileWord,
  FaPlayCircle,
  FaTimes,
  FaUserCircle,
  FaUsers,
} from "react-icons/fa";
import supabase from "../lib/supabaseClient";
import AeroNotice from "../components/AeroNotice";
import "../css/Chat.css";
import { getSafeMediaUrl } from "../utils/mediaUrl";

export default function GroupChat() {
  const { groupChatId } = useParams();
  const navigate = useNavigate();
  const token = localStorage.getItem("token");
  const userId = localStorage.getItem("userId");

  const [groupChat, setGroupChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [sending, setSending] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [nameModalOpen, setNameModalOpen] = useState(false);
  const [draftGroupName, setDraftGroupName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [membersModalOpen, setMembersModalOpen] = useState(false);
  const [membersTab, setMembersTab] = useState("members");
  const [membersPayload, setMembersPayload] = useState({ members: [], admins: [] });
  const [membersLoading, setMembersLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const messagesContainerRef = useRef(null);
  const previousMessagesLengthRef = useRef(0);
  const shouldStickToBottomRef = useRef(true);
  const refreshTimeoutRef = useRef(null);
  const attachmentInputRef = useRef(null);
  const groupImageInputRef = useRef(null);
  const headerMenuRef = useRef(null);

  const memberCount = groupChat?.members?.length || 0;
  const isAdmin = Array.isArray(groupChat?.admin_user_ids)
    ? groupChat.admin_user_ids.some((adminId) => String(adminId) === String(userId))
    : false;

  const scrollToBottom = (behavior = "smooth") => {
    messagesContainerRef.current?.scrollTo({ top: 0, behavior });
  };

  const updateStickiness = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    shouldStickToBottomRef.current = container.scrollTop < 120;
  };

  const dispatchMessagesRefresh = () => {
    window.dispatchEvent(new CustomEvent("fruityger:messages-refresh"));
  };

  const getAttachmentKindLabel = (attachment) => {
    if (!attachment) return "";
    if (attachment.attachment_type === "image" || attachment.type?.startsWith("image/")) return "Image";
    if (attachment.attachment_type === "video" || attachment.type?.startsWith("video/")) return "Video";
    if (attachment.attachment_type === "pdf" || attachment.type === "application/pdf") return "PDF";
    if (
      attachment.attachment_type === "docx" ||
      attachment.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      return "DOCX";
    }
    return "File";
  };

  const getAttachmentIcon = (attachment) => {
    const kind = getAttachmentKindLabel(attachment);
    if (kind === "PDF") return <FaFilePdf />;
    if (kind === "DOCX") return <FaFileWord />;
    if (kind === "Video") return <FaPlayCircle />;
    return <FaFileAlt />;
  };

  const formatFileSize = (bytes) => {
    const size = Number(bytes || 0);
    if (!size) return "";
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  const attachmentIcon = (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8.5 12.5 15 6a3 3 0 1 1 4.24 4.24l-8.13 8.13a5 5 0 1 1-7.07-7.07l8.84-8.84"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );

  const fetchGroupChatSnapshot = async ({ showLoading = false } = {}) => {
    if (!token) return;

    if (showLoading) {
      setLoading(true);
    }

    try {
      const res = await fetch(`http://localhost:5000/api/messages/groups/chats/${groupChatId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch group chat");
      }

      setGroupChat(data.groupChat || null);
      setMessages([...(data.messages || [])].reverse());
      dispatchMessagesRefresh();
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: error.message || "Failed to load group chat." });
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    const previousLength = previousMessagesLengthRef.current;
    const currentLength = messages.length;
    const lastMessage = currentLength > 0 ? messages[currentLength - 1] : null;
    const isOwnLatestMessage =
      lastMessage && String(lastMessage.sender_id) === String(userId);

    if (currentLength > previousLength && (shouldStickToBottomRef.current || isOwnLatestMessage)) {
      scrollToBottom(previousLength === 0 ? "auto" : "smooth");
    }

    previousMessagesLengthRef.current = currentLength;
  }, [messages, userId]);

  useEffect(() => {
    const init = async () => {
      await fetchGroupChatSnapshot({ showLoading: true });
      scrollToBottom("auto");
    };

    init();

    const channel = supabase
      .channel(`group-chat-${groupChatId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_messages", filter: `group_chat_id=eq.${groupChatId}` },
        async () => {
          await fetchGroupChatSnapshot();
          setTimeout(() => scrollToBottom("smooth"), 40);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_chat_members", filter: `group_chat_id=eq.${groupChatId}` },
        async () => {
          await fetchGroupChatSnapshot();
        }
      )
      .subscribe();

    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      supabase.removeChannel(channel);
    };
  }, [groupChatId, token]);

  useEffect(() => {
    const updateKeyboardOffset = () => {
      if (!window.visualViewport) {
        setKeyboardOffset(0);
        return;
      }

      const viewport = window.visualViewport;
      const overlap = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setKeyboardOffset(overlap);
    };

    updateKeyboardOffset();

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", updateKeyboardOffset);
      window.visualViewport.addEventListener("scroll", updateKeyboardOffset);
    } else {
      window.addEventListener("resize", updateKeyboardOffset);
    }

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", updateKeyboardOffset);
        window.visualViewport.removeEventListener("scroll", updateKeyboardOffset);
      } else {
        window.removeEventListener("resize", updateKeyboardOffset);
      }
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(event.target)) {
        setHeaderMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleAttachmentSelection = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const allowedMimeTypes = new Set([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]);
    const lowerName = String(file.name || "").toLowerCase();
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    const isDocument =
      allowedMimeTypes.has(file.type) || lowerName.endsWith(".pdf") || lowerName.endsWith(".docx");

    if (!isImage && !isVideo && !isDocument) {
      setNotice({
        type: "error",
        message: "Only images, videos, PDF, and DOCX files are allowed.",
      });
      event.target.value = "";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setNotice({
        type: "error",
        message: "Attachments must be 5MB or smaller.",
      });
      event.target.value = "";
      return;
    }

    setSelectedAttachment(file);
  };

  const clearSelectedAttachment = () => {
    setSelectedAttachment(null);
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = "";
    }
  };

  const sendMessage = async () => {
    if ((!input.trim() && !selectedAttachment) || sending) return;

    setSending(true);

    try {
      const formData = new FormData();
      formData.append("content", input);
      if (selectedAttachment) {
        formData.append("attachment", selectedAttachment);
      }

      const res = await fetch(`http://localhost:5000/api/messages/groups/chats/${groupChatId}/send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to send group message");
      }

      setMessages((prev) => [data, ...prev]);
      setInput("");
      setSelectedAttachment(null);
      if (attachmentInputRef.current) {
        attachmentInputRef.current.value = "";
      }
      scrollToBottom("smooth");
      dispatchMessagesRefresh();
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: error.message || "Failed to send group message." });
    } finally {
      setSending(false);
    }
  };

  const openMembersModal = async () => {
    setMembersLoading(true);
    setMembersModalOpen(true);
    setHeaderMenuOpen(false);

    try {
      const res = await fetch(`http://localhost:5000/api/messages/groups/chats/${groupChatId}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to load group members");
      }

      applyMembersPayload(data);
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: error.message || "Failed to load members." });
      setMembersModalOpen(false);
    } finally {
      setMembersLoading(false);
    }
  };

  const openNameModal = () => {
    setDraftGroupName(groupChat?.group_name || "");
    setNameModalOpen(true);
    setHeaderMenuOpen(false);
  };

  const applyMembersPayload = (data) => {
    const nextMembers = data.members || [];
    const nextAdmins = data.admins || [];

    setMembersPayload({
      members: nextMembers,
      admins: nextAdmins,
    });

    setGroupChat((prev) =>
      prev
        ? {
            ...prev,
            admin_user_ids: nextAdmins.map((member) => member.id),
            members: nextMembers,
          }
        : prev
    );
  };

  const saveGroupName = async () => {
    if (!draftGroupName.trim() || savingName) return;

    setSavingName(true);

    try {
      const res = await fetch(`http://localhost:5000/api/messages/groups/chats/${groupChatId}/name`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ groupName: draftGroupName.trim() }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to change group name");
      }

      setGroupChat((prev) => (prev ? { ...prev, group_name: data.group_name } : prev));
      setNameModalOpen(false);
      dispatchMessagesRefresh();
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: error.message || "Failed to change group name." });
    } finally {
      setSavingName(false);
    }
  };

  const updateAdminStatus = async (memberId, shouldBeAdmin) => {
    if (!isAdmin || actionLoading) return;

    setActionLoading(true);

    try {
      const res = await fetch(
        `http://localhost:5000/api/messages/groups/chats/${groupChatId}/admins/${memberId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ isAdmin: shouldBeAdmin }),
        }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to update admin status");
      }

      applyMembersPayload(data);
      dispatchMessagesRefresh();
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: error.message || "Failed to update admin status." });
    } finally {
      setActionLoading(false);
    }
  };

  const handleGroupImageSelection = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setHeaderMenuOpen(false);
    setActionLoading(true);

    try {
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch(`http://localhost:5000/api/messages/groups/chats/${groupChatId}/image`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to change group image");
      }

      setGroupChat((prev) => (prev ? { ...prev, group_image: data.group_image } : prev));
      dispatchMessagesRefresh();
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: error.message || "Failed to change group image." });
    } finally {
      if (groupImageInputRef.current) {
        groupImageInputRef.current.value = "";
      }
      setActionLoading(false);
    }
  };

  const handleLeaveGroup = async () => {
    if (actionLoading) return;

    setActionLoading(true);
    setHeaderMenuOpen(false);

    try {
      const res = await fetch(`http://localhost:5000/api/messages/groups/chats/${groupChatId}/leave`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to leave group");
      }

      dispatchMessagesRefresh();
      navigate("/messages");
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: error.message || "Failed to leave group." });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (actionLoading) return;

    setActionLoading(true);
    setHeaderMenuOpen(false);

    try {
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

      dispatchMessagesRefresh();
      navigate("/messages");
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: error.message || "Failed to delete group chat." });
    } finally {
      setActionLoading(false);
    }
  };

  const renderMessageAttachment = (message) => {
    if (!message?.attachment_url) return null;

    if (message.attachment_type === "image") {
      return (
        <a
          href={getSafeMediaUrl(message.attachment_url)}
          target="_blank"
          rel="noreferrer"
          className="chat-attachment-image-link"
        >
          <img
            src={getSafeMediaUrl(message.attachment_url)}
            alt={message.attachment_name || "Shared image"}
            className="chat-attachment-image"
          />
        </a>
      );
    }

    if (message.attachment_type === "video") {
      return (
        <video className="chat-attachment-video" controls playsInline preload="metadata">
          <source src={getSafeMediaUrl(message.attachment_url)} type={message.attachment_mime || "video/mp4"} />
        </video>
      );
    }

    return (
      <a
        href={getSafeMediaUrl(message.attachment_url)}
        target="_blank"
        rel="noreferrer"
        className="chat-attachment-file"
      >
        <span className="chat-attachment-file-icon">{getAttachmentIcon(message)}</span>
        <span className="chat-attachment-file-copy">
          <strong>{message.attachment_name || "Attachment"}</strong>
          <span>
            {getAttachmentKindLabel(message)}
            {message.attachment_size ? ` · ${formatFileSize(message.attachment_size)}` : ""}
          </span>
        </span>
      </a>
    );
  };

  const formatMessageTime = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const memberPreview = useMemo(() => {
    const names = (groupChat?.members || [])
      .map((member) => member.username)
      .slice(0, 4)
      .join(", ");

    return names || "Group conversation";
  }, [groupChat]);

  return (
    <div className="chat-window" style={{ "--chat-keyboard-offset": `${keyboardOffset}px` }}>
      <AeroNotice notice={notice ? { ...notice, inline: true } : null} onClose={() => setNotice(null)} />

      <div className="chat-header">
        <button className="back-btn" onClick={() => navigate(-1)} aria-label="Go back">
          <FaArrowLeft />
        </button>

        <div className="chat-user-link group-chat-link">
          <div className="chat-user-avatar-wrap">
            <div className="chat-user-avatar">
              {groupChat?.group_image ? (
                <img src={getSafeMediaUrl(groupChat.group_image)} alt={groupChat.group_name || "Group chat"} />
              ) : (
                <FaUsers />
              )}
            </div>
          </div>
          <div className="chat-user-heading">
            <h3>{groupChat?.group_name || "Group chat"}</h3>
            <span className="chat-user-status">{memberCount} members · {memberPreview}</span>
          </div>
        </div>

        <div ref={headerMenuRef} className="chat-header-menu-wrap">
          <input
            ref={groupImageInputRef}
            type="file"
            accept="image/*"
            className="chat-attachment-input"
            onChange={handleGroupImageSelection}
          />
          <button
            className="chat-header-menu-btn"
            onClick={() => setHeaderMenuOpen((prev) => !prev)}
            aria-label="Open group options"
          >
            <FaCog />
          </button>

          {headerMenuOpen && (
            <div className="chat-header-dropdown">
              <button
                className="chat-header-dropdown-item"
                onClick={() => {
                  setHeaderMenuOpen(false);
                  groupImageInputRef.current?.click();
                }}
                disabled={!isAdmin || actionLoading}
              >
                Change group image
              </button>
              <button
                className="chat-header-dropdown-item"
                onClick={openNameModal}
                disabled={!isAdmin || actionLoading}
              >
                Change group name
              </button>
              <button className="chat-header-dropdown-item" onClick={openMembersModal}>
                View members
              </button>
              <button className="chat-header-dropdown-item danger" onClick={handleLeaveGroup} disabled={actionLoading}>
                Leave group
              </button>
              <button className="chat-header-dropdown-item danger" onClick={handleDeleteGroup} disabled={actionLoading}>
                Delete group chat
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="chat-messages" ref={messagesContainerRef} onScroll={updateStickiness}>
        {loading ? (
          <div className="spinner-alpha-container">
            <div className="spinner-alpha"></div>
          </div>
        ) : messages.length === 0 ? (
          <p className="empty-text">No messages yet</p>
        ) : (
          messages.map((msg, index) => {
            const isMine = String(msg.sender_id) === String(userId);
            const isLastMessage = index === 0;
            const bubbleClass = `message-bubble ${isMine && isLastMessage ? "new-message" : ""}`;

            return (
              <div key={msg.id} className={`message-wrapper ${isMine ? "sent" : "received"}`}>
                <div className="message-row">
                  <div className={bubbleClass}>
                    {!isMine && (
                      <button
                        type="button"
                        className="group-message-sender"
                        onClick={() => navigate(`/profile/${msg.sender_username}`)}
                      >
                        {msg.sender_username || "Member"}
                      </button>
                    )}
                    {renderMessageAttachment(msg)}
                    {msg.content ? <div className="message-bubble-text">{msg.content}</div> : null}
                  </div>
                </div>

                <div className="message-meta">
                  <span className="message-time">{formatMessageTime(msg.created_at)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="chat-composer">
        {selectedAttachment && (
          <div className="chat-attachment-preview">
            <div className="chat-attachment-preview-copy">
              <span className="chat-attachment-preview-label">
                {getAttachmentKindLabel(selectedAttachment)} ready to send
              </span>
              <strong>{selectedAttachment.name}</strong>
              <span>{formatFileSize(selectedAttachment.size)}</span>
            </div>
            <button
              type="button"
              className="chat-attachment-preview-remove"
              onClick={clearSelectedAttachment}
              aria-label="Remove selected attachment"
            >
              <FaTimes />
            </button>
          </div>
        )}

        <div className="chat-input">
          <input
            ref={attachmentInputRef}
            type="file"
            className="chat-attachment-input"
            accept="image/*,video/*,.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleAttachmentSelection}
          />
          <button
            type="button"
            className="chat-attachment-trigger"
            onClick={() => attachmentInputRef.current?.click()}
            disabled={sending}
            aria-label="Attach a file"
            title="Attach"
          >
            {attachmentIcon}
          </button>

          <input
            type="text"
            placeholder="Type a message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => {
              setTimeout(() => scrollToBottom("auto"), 120);
            }}
            onKeyDown={(e) => e.key === "Enter" && !sending && sendMessage()}
          />

          <button
            type="button"
            className="chat-send-btn"
            onClick={sendMessage}
            disabled={sending || (!input.trim() && !selectedAttachment)}
          >
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>

      {nameModalOpen && (
        <div className="message-reaction-modal-backdrop">
          <div className="message-reaction-modal group-settings-modal">
            <div className="message-reaction-modal-header">
              <div>
                <h4>Change group name</h4>
                <p>Give the chat a fresher title.</p>
              </div>
              <button
                type="button"
                className="message-reaction-modal-close"
                onClick={() => setNameModalOpen(false)}
                aria-label="Close group name modal"
              >
                <FaTimes />
              </button>
            </div>

            <input
              type="text"
              className="group-settings-input"
              value={draftGroupName}
              onChange={(e) => setDraftGroupName(e.target.value)}
              placeholder="Weekend plans"
              maxLength={60}
            />

            <div className="group-settings-actions">
              <button type="button" className="messages-action-btn" onClick={() => setNameModalOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="messages-action-btn primary"
                onClick={saveGroupName}
                disabled={savingName || !draftGroupName.trim()}
              >
                {savingName ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {membersModalOpen && (
        <div className="message-reaction-modal-backdrop">
          <div className="message-reaction-modal group-settings-modal members-settings-modal">
            <div className="message-reaction-modal-header">
              <div>
                <h4>People in this group</h4>
                <p>Messenger-style member list for the room.</p>
              </div>
              <button
                type="button"
                className="message-reaction-modal-close"
                onClick={() => setMembersModalOpen(false)}
                aria-label="Close members modal"
              >
                <FaTimes />
              </button>
            </div>

            <div className="group-members-tabs">
              <button
                type="button"
                className={`group-members-tab ${membersTab === "members" ? "active" : ""}`}
                onClick={() => setMembersTab("members")}
              >
                Members
              </button>
              <button
                type="button"
                className={`group-members-tab ${membersTab === "admins" ? "active" : ""}`}
                onClick={() => setMembersTab("admins")}
              >
                Admins
              </button>
            </div>

            {membersLoading ? (
              <p className="message-reaction-modal-empty">Loading people...</p>
            ) : (
              <div className="message-reaction-modal-list">
                {(membersTab === "admins" ? membersPayload.admins : membersPayload.members).map((member) => (
                  <div key={member.id} className="message-reaction-modal-item">
                    <div className="message-reaction-modal-user">
                      <div className="message-reaction-modal-avatar">
                        {member.profile_pic ? (
                          <img src={getSafeMediaUrl(member.profile_pic)} alt={member.username} />
                        ) : (
                          <FaUserCircle />
                        )}
                      </div>
                      <div className="message-reaction-modal-copy">
                        <strong>{member.username}</strong>
                        <span>{member.is_admin ? "Admin" : "Member"}</span>
                      </div>
                    </div>
                    {isAdmin && membersTab === "members" && !member.is_admin ? (
                      <button
                        type="button"
                        className="message-reaction-remove-btn"
                        onClick={() => updateAdminStatus(member.id, true)}
                        disabled={actionLoading}
                      >
                        Add as admin
                      </button>
                    ) : null}
                    {isAdmin && membersTab === "admins" ? (
                      <button
                        type="button"
                        className="message-reaction-remove-btn"
                        onClick={() => updateAdminStatus(member.id, false)}
                        disabled={actionLoading}
                      >
                        Remove as admin
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
