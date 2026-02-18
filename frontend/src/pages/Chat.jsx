import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import "../css/Chat.css";

export default function Chat() {
  const { chatId } = useParams(); // e.g., /chat/1
  const navigate = useNavigate();

  // Example chat data
  const chatData = {
    1: {
      name: "SkyWave",
      messages: [
        { type: "received", text: "Hey! Are you online?" },
        { type: "sent", text: "Yes! Working on Fruityger 🌊✨" },
        { type: "received", text: "That name is iconic btw." },
      ],
    },
    2: {
      name: "AeroGlow",
      messages: [
        { type: "received", text: "Love the new update!" },
        { type: "sent", text: "Thanks! Glad you like it ✨" },
      ],
    },
    3: {
      name: "BlueVista",
      messages: [
        { type: "received", text: "Let’s collab soon!" },
        { type: "sent", text: "Absolutely, let’s plan it 💎" },
      ],
    },
  };

  const chat = chatData[chatId] || { name: "Unknown Chat", messages: [] };

  return (
    <div className="chat-window">
      <div className="chat-header">
        {/* Back Button */}
        <button
          className="back-btn"
          onClick={() => navigate(-1)}
        >
          ←
        </button>
        <h3>{chat.name}</h3>
      </div>

      <div className="chat-messages">
        {chat.messages.map((msg, idx) => (
          <div
            key={idx}
            className={`message ${msg.type}`}
          >
            {msg.text}
          </div>
        ))}
      </div>

      <div className="chat-input">
        <input type="text" placeholder="Type a message..." />
        <button>Send</button>
      </div>
    </div>
  );
}
