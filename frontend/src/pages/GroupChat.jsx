import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  FaArrowLeft,
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

  const messagesContainerRef = useRef(null);
  const previousMessagesLengthRef = useRef(0);
  const shouldStickToBottomRef = useRef(true);
  const refreshTimeoutRef = useRef(null);
  const attachmentInputRef = useRef(null);

  const memberCount = groupChat?.members?.length || 0;

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
              <FaUsers />
            </div>
          </div>
          <div className="chat-user-heading">
            <h3>{groupChat?.group_name || "Group chat"}</h3>
            <span className="chat-user-status">{memberCount} members · {memberPreview}</span>
          </div>
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
    </div>
  );
}
