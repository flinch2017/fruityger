import React from "react";
import { useNavigate } from "react-router-dom";

const HASHTAG_REGEX = /#[A-Za-z0-9_]+/g;

export default function CaptionWithHashtags({ text = "", className = "" }) {
  const navigate = useNavigate();
  const content = String(text || "");
  const parts = content.split(HASHTAG_REGEX);
  const tags = content.match(HASHTAG_REGEX) || [];

  return (
    <p className={className}>
      {parts.map((part, index) => {
        const tag = tags[index];
        return (
          <React.Fragment key={`${index}-${tag || "plain"}`}>
            {part}
            {tag ? (
              <button
                type="button"
                className="caption-hashtag-link"
                onClick={() => navigate(`/hashtag/${tag.slice(1).toLowerCase()}`)}
              >
                {tag}
              </button>
            ) : null}
          </React.Fragment>
        );
      })}
    </p>
  );
}
