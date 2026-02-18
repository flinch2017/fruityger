import React from "react";
import { useNavigate } from "react-router-dom";
import "../css/Messages.css";

export default function Messages() {
  const navigate = useNavigate();

  const chats = [
    { id: 1, name: "SkyWave", avatar: "🌊", lastMessage: "Hey! Are you online?" },
    { id: 2, name: "AeroGlow", avatar: "✨", lastMessage: "Love the new update!" },
    { id: 3, name: "BlueVista", avatar: "💎", lastMessage: "Let’s collab soon!" },
  ];

  const handleChatClick = (chatId) => {
    // Navigate to the chat window page for the clicked user
    navigate(`/chat/${chatId}`);
  };

  return (
    <div className="messages-page">
      <div className="messages-sidebar">
        <h2>Chats</h2>

        {chats.map((chat) => (
          <div
            key={chat.id}
            className="chat-preview"
            onClick={() => handleChatClick(chat.id)}
            style={{ cursor: "pointer" }}
          >
            <div className="chat-avatar">{chat.avatar}</div>
            <div>
              <h4>{chat.name}</h4>
              <p>{chat.lastMessage}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
