import React from "react";
import { useNavigate } from "react-router-dom";

const TOKEN_REGEX = /(#[A-Za-z0-9_]+|@[A-Za-z0-9._]+)/g;

export default function CaptionWithHashtags({ text = "", className = "" }) {
  const navigate = useNavigate();
  const content = String(text || "");
  const parts = content.split(TOKEN_REGEX);

  return (
    <p className={className}>
      {parts.map((part, index) => {
        if (/^#[A-Za-z0-9_]+$/.test(part)) {
          return (
            <button
              key={`${index}-${part}`}
              type="button"
              className="caption-hashtag-link"
              onClick={() => navigate(`/hashtag/${part.slice(1).toLowerCase()}`)}
            >
              {part}
            </button>
          );
        }

        if (/^@[A-Za-z0-9._]+$/.test(part)) {
          return (
            <button
              key={`${index}-${part}`}
              type="button"
              className="caption-mention-link"
              onClick={() => navigate(`/profile/${part.slice(1)}`)}
            >
              {part}
            </button>
          );
        }

        return <React.Fragment key={`${index}-plain`}>{part}</React.Fragment>;
      })}
    </p>
  );
}
