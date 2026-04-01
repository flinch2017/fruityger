import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  FaArrowLeft,
  FaCog,
  FaEllipsisV,
  FaRegSmileBeam,
  FaReply,
  FaTimes,
  FaUserCircle,
} from "react-icons/fa";
import supabase from "../lib/supabaseClient";
import AeroNotice from "../components/AeroNotice";
import "../css/Chat.css";
import { getSafeMediaUrl } from "../utils/mediaUrl";

export default function Chat() {
  const reactionOptions = [
    { key: "heart", emoji: "\u2764\uFE0F", label: "Heart" },
    { key: "laugh", emoji: "\u{1F602}", label: "Laugh" },
    { key: "sad", emoji: "\u{1F622}", label: "Sad" },
    { key: "angry", emoji: "\u{1F621}", label: "Angry" },
    { key: "care", emoji: "\u{1F917}", label: "Care" },
  ];

  const { chatId } = useParams();
  const navigate = useNavigate();
  const token = localStorage.getItem("token");
  const userId = localStorage.getItem("userId");

  const [messages, setMessages] = useState([]);
  const [otherUser, setOtherUser] = useState({ username: "..." });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [blockedByMe, setBlockedByMe] = useState(false);
  const [blockedByThem, setBlockedByThem] = useState(false);
  const [notice, setNotice] = useState(null);
  const [sending, setSending] = useState(false);
  const [otherUserOnline, setOtherUserOnline] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [reactionTargetMessage, setReactionTargetMessage] = useState(null);
  const [reacting, setReacting] = useState(false);
  const [pendingReactionKey, setPendingReactionKey] = useState(null);
  const [reactionViewer, setReactionViewer] = useState(null);
  const [reactionViewerLoading, setReactionViewerLoading] = useState(false);

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const refreshTimeoutRef = useRef(null);
  const pollingIntervalRef = useRef(null);
  const presenceIntervalRef = useRef(null);
  const shouldStickToBottomRef = useRef(true);
  const previousMessagesLengthRef = useRef(0);

  const scrollToBottom = (behavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  const updateStickiness = () => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 120;
  };

  const dispatchMessagesRefresh = () => {
    window.dispatchEvent(new CustomEvent("fruityger:messages-refresh"));
  };

  const getReplyAuthorLabel = (message) => {
    if (!message) return "Message";
    return String(message.sender_id) === String(userId) ? "You" : otherUser.username;
  };

  const getReplyPreviewText = (content) => {
    const safeContent = (content || "Original message unavailable").trim();
    return safeContent.length > 90 ? `${safeContent.slice(0, 90)}...` : safeContent;
  };

  const getReactionEmoji = (reactionKey) =>
    reactionOptions.find((option) => option.key === reactionKey)?.emoji || "\u2764\uFE0F";

  const markChatRead = async () => {
    if (!token) return;

    try {
      await fetch(`http://localhost:5000/api/messages/${chatId}/read`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (err) {
      console.error(err);
    } finally {
      dispatchMessagesRefresh();
    }
  };

  const fetchOtherUserPresence = async (targetUserId) => {
    if (!token || !targetUserId) return;

    try {
      const res = await fetch(`http://localhost:5000/api/messages/presence/${targetUserId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to load presence");
      }

      setOtherUserOnline(Boolean(data.is_online));
    } catch (error) {
      console.error(error);
    }
  };

  const fetchChatSnapshot = async ({ showLoading = false } = {}) => {
    if (!token) return null;

    if (showLoading) {
      setLoading(true);
    }

    try {
      const res = await fetch(`http://localhost:5000/api/messages/${chatId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch chat");
      }

      const chat = data.chat;
      const other = chat.user1.id === userId ? chat.user2 : chat.user1;

      setOtherUser(other);
      fetchOtherUserPresence(other.id);
      setMessages(data.messages || []);
      setBlockedByMe(Boolean(chat.blocked_by_me));
      setBlockedByThem(Boolean(chat.blocked_by_them));
      dispatchMessagesRefresh();

      return data;
    } catch (err) {
      console.error(err);
      return null;
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

    if (
      currentLength > previousLength &&
      (shouldStickToBottomRef.current || isOwnLatestMessage)
    ) {
      scrollToBottom(previousLength === 0 ? "auto" : "smooth");
    }

    previousMessagesLengthRef.current = currentLength;
  }, [messages, userId]);

  const formatMessageTime = (dateString) => {
    const date = new Date(dateString);

    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  useEffect(() => {
    let channel;

    const initChat = async () => {
      await fetchChatSnapshot({ showLoading: true });
      scrollToBottom("auto");

      channel = supabase
        .channel(`chat-${chatId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `chat_id=eq.${chatId}`,
          },
          async (payload) => {
            const newMessage = payload.new;

            await fetchChatSnapshot();

            if (String(newMessage.receiver_id) === String(userId)) {
              await markChatRead();
            } else {
              dispatchMessagesRefresh();
            }

            setTimeout(scrollToBottom, 50);
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "messages",
            filter: `chat_id=eq.${chatId}`,
          },
          (payload) => {
            const updated = payload.new;

            setMessages((prev) =>
              prev.map((message) =>
                message.id === updated.id ? { ...message, ...updated } : message
              )
            );
          }
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "messages",
            filter: `chat_id=eq.${chatId}`,
          },
          (payload) => {
            const deleted = payload.old;

            setMessages((prev) =>
              prev.filter((message) => String(message.id) !== String(deleted.id))
            );

            dispatchMessagesRefresh();
          }
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "deleted_messages",
          },
          (payload) => {
            const deletedMessageId = payload.new?.message_id;
            if (!deletedMessageId) return;

            setMessages((prev) =>
              prev.filter((message) => String(message.id) !== String(deletedMessageId))
            );
            dispatchMessagesRefresh();
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "chats",
            filter: `id=eq.${chatId}`,
          },
          () => {
            if (refreshTimeoutRef.current) {
              clearTimeout(refreshTimeoutRef.current);
            }

            refreshTimeoutRef.current = setTimeout(() => {
              dispatchMessagesRefresh();
            }, 100);
          }
        )
        .subscribe();

      pollingIntervalRef.current = setInterval(() => {
        fetchChatSnapshot();
      }, 2500);
    };

    initChat();

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      if (presenceIntervalRef.current) {
        clearInterval(presenceIntervalRef.current);
      }
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      if (channel) supabase.removeChannel(channel);
    };
  }, [chatId, token, userId]);

  useEffect(() => {
    if (!otherUser?.id || !token) return;

    fetchOtherUserPresence(otherUser.id);

    presenceIntervalRef.current = setInterval(() => {
      fetchOtherUserPresence(otherUser.id);
    }, 2500);

    return () => {
      if (presenceIntervalRef.current) {
        clearInterval(presenceIntervalRef.current);
      }
    };
  }, [otherUser?.id, token]);

  const sendMessage = async () => {
    if (!input.trim() || blockedByMe || blockedByThem || sending) return;

    setSending(true);

    try {
      const res = await fetch("http://localhost:5000/api/messages/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          chatId,
          receiverId: otherUser.id,
          content: input,
          replyToMessageId: replyingTo?.id || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to send message");
      }

      setMessages((prev) => {
        if (prev.some((message) => message.id === data.id)) {
          return prev;
        }

        return [...prev, data];
      });

      setInput("");
      setReplyingTo(null);
      scrollToBottom("smooth");
      dispatchMessagesRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (msg) => {
    try {
      let res;

      if (String(msg.sender_id) === String(userId)) {
        res = await fetch(`http://localhost:5000/api/messages/${msg.id}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      } else {
        res = await fetch("http://localhost:5000/api/messages/delete-for-me", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            messageId: msg.id,
          }),
        });
      }

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to delete message");
      }

      setMessages((prev) => prev.filter((message) => message.id !== msg.id));
      if (replyingTo?.id === msg.id) {
        setReplyingTo(null);
      }
      setOpenMenuId(null);
      dispatchMessagesRefresh();
    } catch (err) {
      console.error(err);
      setNotice({ type: "error", message: "Failed to delete message." });
    }
  };

  const handleReport = (msg) => {
    setOpenMenuId(null);
    navigate(`/report?type=message&id=${msg.id}`);
  };

  const handleReact = async (message, reactionKey) => {
    if (reacting) return;

    setReacting(true);
    setPendingReactionKey(reactionKey);

    try {
      const currentReaction = Array.isArray(message.reactions)
        ? message.reactions.find((reaction) => reaction.reacted_by_me)?.reaction
        : null;
      const nextReaction = currentReaction === reactionKey ? null : reactionKey;

      const res = await fetch(`http://localhost:5000/api/messages/${message.id}/react`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reaction: nextReaction }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to react to message");
      }

      if (data.message) {
        setMessages((prev) =>
          prev.map((entry) => (entry.id === message.id ? data.message : entry))
        );
      }

      setReactionTargetMessage(null);
      dispatchMessagesRefresh();
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: "Failed to update reaction." });
    } finally {
      setReacting(false);
      setPendingReactionKey(null);
    }
  };

  const openReactionViewer = async (message) => {
    setReactionViewerLoading(true);
    setReactionViewer({
      messageId: message.id,
      reactions: [],
    });

    try {
      const res = await fetch(`http://localhost:5000/api/messages/${message.id}/reactions`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to load reactions");
      }

      setReactionViewer({
        messageId: message.id,
        reactions: data.reactions || [],
      });
    } catch (error) {
      console.error(error);
      setReactionViewer(null);
      setNotice({ type: "error", message: "Failed to load reaction viewers." });
    } finally {
      setReactionViewerLoading(false);
    }
  };

  const removeOwnReactionFromViewer = async () => {
    if (!reactionViewer?.messageId) return;

    try {
      const res = await fetch(
        `http://localhost:5000/api/messages/${reactionViewer.messageId}/react`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ reaction: null }),
        }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to remove reaction");
      }

      if (data.message) {
        setMessages((prev) =>
          prev.map((entry) => (entry.id === reactionViewer.messageId ? data.message : entry))
        );
      }

      setReactionViewer((prev) =>
        prev
          ? {
              ...prev,
              reactions: prev.reactions.filter((reaction) => !reaction.reacted_by_me),
            }
          : prev
      );
      dispatchMessagesRefresh();
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: "Failed to remove reaction." });
    }
  };

  const handleDeleteConversation = async () => {
    try {
      const res = await fetch("http://localhost:5000/api/messages/delete-chats", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ chatIds: [chatId] }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to delete conversation");
      }

      setHeaderMenuOpen(false);
      dispatchMessagesRefresh();
      navigate("/messages");
    } catch (err) {
      console.error(err);
      setNotice({ type: "error", message: err.message || "Failed to delete conversation." });
    }
  };

  const handleBlockUser = async () => {
    try {
      const endpoint = blockedByMe
        ? "http://localhost:5000/api/main/unblock-user"
        : "http://localhost:5000/api/main/block-user";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ blockedUserId: otherUser.id }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Failed to ${blockedByMe ? "unblock" : "block"} user`);
      }

      setHeaderMenuOpen(false);
      setBlockedByMe((prev) => !prev);
      setInput("");
      setReplyingTo(null);
    } catch (err) {
      console.error(err);
      setNotice({
        type: "error",
        message: err.message || `Failed to ${blockedByMe ? "unblock" : "block"} user.`,
      });
    }
  };

  const handleReportUser = () => {
    setHeaderMenuOpen(false);
    navigate(`/report?type=user&id=${otherUser.id}`);
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest(".message-options-wrapper")) {
        setOpenMenuId(null);
      }

      if (!e.target.closest(".message-reaction-wrap")) {
        return;
      }

      if (!e.target.closest(".message-reaction-modal") && !e.target.closest(".message-reaction-pill")) {
        setReactionViewer(null);
      }

      if (!e.target.closest(".chat-header-menu-wrap")) {
        setHeaderMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const closeMenu = () => setOpenMenuId(null);
    const closeOverlays = () => {
      closeMenu();
    };
    document.addEventListener("scroll", closeOverlays);

    return () => document.removeEventListener("scroll", closeOverlays);
  }, []);

  return (
    <div className="chat-window">
      <AeroNotice notice={notice ? { ...notice, inline: true } : null} onClose={() => setNotice(null)} />
      <div className="chat-header">
        <button className="back-btn" onClick={() => navigate(-1)} aria-label="Go back">
          <FaArrowLeft />
        </button>
        <button
          type="button"
          className="chat-user-link"
          onClick={() => navigate(`/profile/${otherUser.username}`)}
        >
          <div className="chat-user-avatar-wrap">
            <div className="chat-user-avatar">
              {otherUser.profile_pic ? (
                <img src={getSafeMediaUrl(otherUser.profile_pic)} alt={otherUser.username} />
              ) : (
                <FaUserCircle />
              )}
            </div>
            {otherUserOnline && <span className="chat-user-online-dot"></span>}
          </div>
          <div className="chat-user-heading">
            <h3>{otherUser.username}</h3>
            <span className={`chat-user-status ${otherUserOnline ? "online" : ""}`}>
              {otherUserOnline ? "Online" : "Offline"}
            </span>
          </div>
        </button>
        <div className="chat-header-menu-wrap">
          <button
            className="chat-header-menu-btn"
            onClick={() => setHeaderMenuOpen((prev) => !prev)}
            aria-label="Open conversation options"
          >
            <FaCog />
          </button>

          {headerMenuOpen && (
            <div className="chat-header-dropdown">
              <button className="chat-header-dropdown-item" onClick={handleDeleteConversation}>
                Delete this conversation
              </button>
              <button className="chat-header-dropdown-item danger" onClick={handleBlockUser}>
                {blockedByMe ? "Unblock this user" : "Block this user"}
              </button>
              <button className="chat-header-dropdown-item danger" onClick={handleReportUser}>
                Report
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
            const isLastMessage = index === messages.length - 1;
            const bubbleClass = `message-bubble ${
              isMine && isLastMessage ? "new-message" : ""
            }`;

            return (
              <div
                key={msg.id}
                className={`message-wrapper ${isMine ? "sent" : "received"}`}
              >
                <div className="message-row">
                  {isMine && (
                    <div className="message-options-wrapper">
                      <button
                        type="button"
                        className="message-options"
                        onClick={() => setOpenMenuId(openMenuId === msg.id ? null : msg.id)}
                        aria-label="Open message options"
                      >
                        <FaEllipsisV />
                      </button>

                      {openMenuId === msg.id && (
                        <div className="message-dropdown">
                          <div className="dropdown-item" onClick={() => handleDelete(msg)}>
                            Delete
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {isMine && (
                    <button
                      type="button"
                      className="message-reply-btn"
                      onClick={() => setReplyingTo(msg)}
                      aria-label="Reply to message"
                      title="Reply"
                    >
                      <FaReply />
                    </button>
                  )}

                  {isMine && (
                    <div className="message-reaction-wrap">
                      <button
                        type="button"
                        className="message-reaction-trigger"
                        onClick={() => setReactionTargetMessage(msg)}
                        aria-label="React to message"
                        title="React"
                      >
                        <FaRegSmileBeam />
                      </button>
                    </div>
                  )}

                  <div className={bubbleClass}>
                    {msg.reply_to_message_id && (
                      <div className="message-reply-preview">
                        <span className="message-reply-preview-label">
                          Replying to{" "}
                          {msg.reply_to_sender_id
                            ? String(msg.reply_to_sender_id) === String(userId)
                              ? "You"
                              : otherUser.username
                            : "Message"}
                        </span>
                        <p>{getReplyPreviewText(msg.reply_to_content)}</p>
                      </div>
                    )}
                    <div className="message-bubble-text">{msg.content}</div>
                  </div>

                  {!isMine && (
                    <div className="message-reaction-wrap">
                      <button
                        type="button"
                        className="message-reaction-trigger"
                        onClick={() => setReactionTargetMessage(msg)}
                        aria-label="React to message"
                        title="React"
                      >
                        <FaRegSmileBeam />
                      </button>
                    </div>
                  )}

                  {!isMine && (
                    <button
                      type="button"
                      className="message-reply-btn"
                      onClick={() => setReplyingTo(msg)}
                      aria-label="Reply to message"
                      title="Reply"
                    >
                      <FaReply />
                    </button>
                  )}

                  {!isMine && (
                    <div className="message-options-wrapper">
                      <button
                        type="button"
                        className="message-options"
                        onClick={() => setOpenMenuId(openMenuId === msg.id ? null : msg.id)}
                        aria-label="Open message options"
                      >
                        <FaEllipsisV />
                      </button>

                      {openMenuId === msg.id && (
                        <div className="message-dropdown">
                          <div className="dropdown-item" onClick={() => handleDelete(msg)}>
                            Delete
                          </div>

                          <div className="dropdown-item danger" onClick={() => handleReport(msg)}>
                            Report
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {Array.isArray(msg.reactions) && msg.reactions.length > 0 && (
                  <div className={`message-reactions ${isMine ? "sent" : "received"}`}>
                    {msg.reactions.map((reaction) => (
                    <button
                      key={reaction.reaction}
                      type="button"
                      className={`message-reaction-pill ${
                        reaction.reacted_by_me ? "active" : ""
                      }`}
                      disabled={reacting}
                      onClick={() => openReactionViewer(msg)}
                    >
                      <span>{getReactionEmoji(reaction.reaction)}</span>
                        <span>{reaction.count}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="message-meta">
                  <span className="message-time">
                    {formatMessageTime(msg.created_at)}
                  </span>

                  {isMine && isLastMessage && (
                    <span className="seen-status">
                      {msg.read_status ? "Seen" : "Sent"}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {blockedByMe || blockedByThem ? (
        <div className="chat-blocked-banner">
          Sorry you can&apos;t message this user
        </div>
      ) : (
        <div className="chat-composer">
          {replyingTo && (
            <div className="chat-replying-bar">
              <div className="chat-replying-copy">
                <span>Replying to {getReplyAuthorLabel(replyingTo)}</span>
                <p>{getReplyPreviewText(replyingTo.content)}</p>
              </div>
              <button
                type="button"
                className="chat-replying-close"
                onClick={() => setReplyingTo(null)}
                aria-label="Cancel reply"
              >
                <FaTimes />
              </button>
            </div>
          )}

          <div className="chat-input">
            <input
              type="text"
              placeholder={replyingTo ? "Write your reply..." : "Type a message..."}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !sending && sendMessage()}
            />
            <button onClick={sendMessage} disabled={sending || !input.trim()}>
              {sending ? "Sending..." : "Send"}
            </button>
          </div>
        </div>
      )}

      {reactionViewer && (
        <div className="message-reaction-modal-backdrop">
          <div className="message-reaction-modal">
            <div className="message-reaction-modal-header">
              <div>
                <h4>Reactions</h4>
                <p>See who reacted to this message.</p>
              </div>
              <button
                type="button"
                className="message-reaction-modal-close"
                onClick={() => setReactionViewer(null)}
                aria-label="Close reactions viewer"
              >
                <FaTimes />
              </button>
            </div>

            {reactionViewerLoading ? (
              <p className="message-reaction-modal-empty">Loading reactions...</p>
            ) : reactionViewer.reactions.length === 0 ? (
              <p className="message-reaction-modal-empty">No reactions yet.</p>
            ) : (
              <div className="message-reaction-modal-list">
                {reactionViewer.reactions.map((reaction) => (
                  <div key={`${reaction.user_id}-${reaction.reaction}`} className="message-reaction-modal-item">
                    <div className="message-reaction-modal-user">
                      <div className="message-reaction-modal-avatar">
                        {reaction.profile_pic ? (
                          <img
                            src={getSafeMediaUrl(reaction.profile_pic)}
                            alt={reaction.username}
                          />
                        ) : (
                          <FaUserCircle />
                        )}
                      </div>
                      <div className="message-reaction-modal-copy">
                        <strong>{reaction.username}</strong>
                        <span>
                          {getReactionEmoji(reaction.reaction)} {reaction.reaction}
                        </span>
                      </div>
                    </div>
                    {reaction.reacted_by_me && (
                      <button
                        type="button"
                        className="message-reaction-remove-btn"
                        onClick={removeOwnReactionFromViewer}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {reactionTargetMessage && (
        <div className="message-reaction-picker-modal-backdrop">
          <div className="message-reaction-picker-modal">
            <div className="message-reaction-picker-header">
              <div>
                <h4>React to message</h4>
                <p>Choose one reaction.</p>
              </div>
              <button
                type="button"
                className="message-reaction-modal-close"
                onClick={() => setReactionTargetMessage(null)}
                aria-label="Close reaction picker"
              >
                <FaTimes />
              </button>
            </div>
            <div className="message-reaction-picker-grid">
              {reactionOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className="message-reaction-choice-large"
                  disabled={reacting}
                  onClick={() => handleReact(reactionTargetMessage, option.key)}
                >
                  <span>{option.emoji}</span>
                  <span>{reacting && pendingReactionKey === option.key ? "Sending..." : option.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
