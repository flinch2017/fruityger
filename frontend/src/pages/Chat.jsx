import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import supabase from "../lib/supabaseClient";
import "../css/Chat.css";

export default function Chat() {
  const menuRef = useRef(null);
  const { chatId } = useParams();
  const navigate = useNavigate();
  const token = localStorage.getItem("token");
  const userId = localStorage.getItem("userId");

  const [messages, setMessages] = useState([]);
  const [otherUser, setOtherUser] = useState({ username: "..." });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [openMenuId, setOpenMenuId] = useState(null);

  const messagesEndRef = useRef(null);

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
      setLoading(true);

      try {
        const res = await fetch(`http://localhost:5000/api/messages/${chatId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        const data = await res.json();
        const chat = data.chat;
        const other = chat.user1.id === userId ? chat.user2 : chat.user1;

        setOtherUser(other);
        setMessages(data.messages || []);
        dispatchMessagesRefresh();
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
        scrollToBottom();
      }

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
        .subscribe();
    };

    initChat();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [chatId, token, userId]);

  const sendMessage = async () => {
    if (!input.trim()) return;

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
      alert("Failed to delete message.");
    }
  };

  const handleReport = (msg) => {
    setOpenMenuId(null);
    navigate(`/report?type=message&id=${msg.id}`);
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpenMenuId(null);
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
      <div className="chat-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          ←
        </button>
        <h3>{otherUser.username}</h3>
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

      <div className="chat-input">
        <input
          type="text"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
        />
        <button onClick={sendMessage}>Send</button>
      </div>
    </div>
  );
}
