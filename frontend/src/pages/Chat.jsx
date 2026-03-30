import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import supabase from "../lib/supabaseClient";
import "../css/Chat.css";

export default function Chat() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const token = localStorage.getItem("token");
  const userId = localStorage.getItem("userId");

  const [messages, setMessages] = useState([]);
  const [otherUser, setOtherUser] = useState({ username: "..." });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
        const other =
          chat.user1.id === userId ? chat.user2 : chat.user1;

        setOtherUser(other);
        setMessages(data.messages);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
        scrollToBottom();
      }

      // 🔥 REALTIME SUBSCRIPTION
      channel = supabase
        .channel(`chat-${chatId}`)

        // 🟢 NEW MESSAGES
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `chat_id=eq.${chatId}`,
          },
          (payload) => {
            const newMessage = payload.new;

            setMessages((prev) => [...prev, newMessage]);

            setTimeout(scrollToBottom, 50);
          }
        )

        // 🔵 MESSAGE UPDATES (READ STATUS)
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
              prev.map((m) => (m.id === updated.id ? updated : m))
            );
          }
        )

        .subscribe();
    };

    initChat();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [chatId, token]);

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
      setMessages((prev) => [...prev, data]);
      setInput("");
      scrollToBottom();
    } catch (err) {
      console.error(err);
    }
  };

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

            // Add 'new-message' only to the last message sent by me
            const bubbleClass = `message-bubble ${isMine && isLastMessage ? "new-message" : ""}`;

            return (
              <div
                key={msg.id}
                className={`message-wrapper ${isMine ? "sent" : "received"}`}
              >
                <div className={bubbleClass}>
                  {msg.content}
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