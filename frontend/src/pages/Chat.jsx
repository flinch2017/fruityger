import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import supabase from "../lib/supabaseClient";
import AeroNotice from "../components/AeroNotice";
import "../css/Chat.css";
import { getSafeMediaUrl } from "../utils/mediaUrl";

export default function Chat() {
  const menuRef = useRef(null);
  const headerMenuRef = useRef(null);
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

  const messagesEndRef = useRef(null);
  const refreshTimeoutRef = useRef(null);
  const pollingIntervalRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const dispatchMessagesRefresh = () => {
    window.dispatchEvent(new CustomEvent("fruityger:messages-refresh"));
  };

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
    scrollToBottom();
  }, [messages]);

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
      scrollToBottom();

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

            setMessages((prev) => {
              if (prev.some((message) => message.id === newMessage.id)) {
                return prev;
              }

              return [...prev, newMessage];
            });

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
              prev.map((message) => (message.id === updated.id ? updated : message))
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
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      if (channel) supabase.removeChannel(channel);
    };
  }, [chatId, token, userId]);

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
      scrollToBottom();
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
    document.addEventListener("scroll", closeMenu);

    return () => document.removeEventListener("scroll", closeMenu);
  }, []);

  return (
    <div className="chat-window">
      <AeroNotice notice={notice ? { ...notice, inline: true } : null} onClose={() => setNotice(null)} />
      <div className="chat-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          ←
        </button>
        <button
          type="button"
          className="chat-user-link"
          onClick={() => navigate(`/profile/${otherUser.username}`)}
        >
          <div className="chat-user-avatar">
            {otherUser.profile_pic ? (
              <img src={getSafeMediaUrl(otherUser.profile_pic)} alt={otherUser.username} />
            ) : (
              "👤"
            )}
          </div>
          <h3>{otherUser.username}</h3>
        </button>
        <div className="chat-header-menu-wrap" ref={headerMenuRef}>
          <button
            className="chat-header-menu-btn"
            onClick={() => setHeaderMenuOpen((prev) => !prev)}
          >
            ⚙
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

      <div className="chat-messages">
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
                    <div className="message-options-wrapper" ref={menuRef}>
                      <div
                        className="message-options"
                        onClick={() => setOpenMenuId(openMenuId === msg.id ? null : msg.id)}
                      >
                        ⋯
                      </div>

                      {openMenuId === msg.id && (
                        <div className="message-dropdown">
                          <div className="dropdown-item" onClick={() => handleDelete(msg)}>
                            Delete
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className={bubbleClass}>{msg.content}</div>

                  {!isMine && (
                    <div className="message-options-wrapper" ref={menuRef}>
                      <div
                        className="message-options"
                        onClick={() => setOpenMenuId(openMenuId === msg.id ? null : msg.id)}
                      >
                        ⋯
                      </div>

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
          Sorry you can't message this user
        </div>
      ) : (
        <div className="chat-input">
          <input
            type="text"
            placeholder="Type a message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !sending && sendMessage()}
          />
          <button onClick={sendMessage} disabled={sending || !input.trim()}>
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
      )}
    </div>
  );
}
