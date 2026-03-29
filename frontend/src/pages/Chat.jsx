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

            // optional: auto scroll
            setTimeout(scrollToBottom, 50);
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
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`message ${msg.sender_id === userId ? "sent" : "received"}`}
            >
              {msg.content}
            </div>
          ))
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