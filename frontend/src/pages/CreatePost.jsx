import React, { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/CreatePost.css";
import { useUploadManager } from "../context/UploadManagerContext";

const MAX_HASHTAGS = 5;
const HASHTAG_MATCHER = /#[A-Za-z0-9_]+/g;

const extractHashtags = (text = "") => {
  const matches = String(text).match(HASHTAG_MATCHER) || [];
  return [...new Set(matches.map((tag) => tag.slice(1).toLowerCase()))];
};

const getActiveHashtagQuery = (text = "", cursor = 0) => {
  const uptoCursor = String(text).slice(0, cursor);
  const match = uptoCursor.match(/(?:^|\s)#([A-Za-z0-9_]*)$/);
  if (!match) return null;

  const query = match[1] || "";
  const start = uptoCursor.length - query.length - 1;
  return { query: query.toLowerCase(), start, end: cursor };
};

const getActiveMentionQuery = (text = "", cursor = 0) => {
  const uptoCursor = String(text).slice(0, cursor);
  const match = uptoCursor.match(/(?:^|\s)@([A-Za-z0-9._]*)$/);
  if (!match) return null;

  const query = match[1] || "";
  const start = uptoCursor.length - query.length - 1;
  return { query: query.toLowerCase(), start, end: cursor };
};

export default function CreatePost() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const { enqueueUpload } = useUploadManager();

  const [text, setText] = useState("");
  const [hashtagSuggestions, setHashtagSuggestions] = useState([]);
  const [mentionSuggestions, setMentionSuggestions] = useState([]);
  const [showHashtagSuggestions, setShowHashtagSuggestions] = useState(false);
  const [showMentionSuggestions, setShowMentionSuggestions] = useState(false);
  const [activeHashtagRange, setActiveHashtagRange] = useState(null);
  const [activeMentionRange, setActiveMentionRange] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [warning, setWarning] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const MAX_ATTACHMENTS = 4;
  const MAX_TOTAL_SIZE_MB = 50;

  const showWarning = (message) => {
    setWarning(message);

    setTimeout(() => {
      setWarning("");
    }, 3000);
  };

  const getTotalAttachmentSizeMB = (files) => {
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    return totalBytes / (1024 * 1024);
  };

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files || []);

    if (!files.length) return;

    if (attachments.length >= MAX_ATTACHMENTS) {
      showWarning(`Attachment limit reached (${MAX_ATTACHMENTS}/4)`);
      return;
    }

    if (attachments.length + files.length > MAX_ATTACHMENTS) {
      showWarning(`You can only attach up to ${MAX_ATTACHMENTS} files.`);
      return;
    }

    const totalSizeMB = getTotalAttachmentSizeMB([
      ...attachments.map((attachment) => attachment.file),
      ...files,
    ]);

    if (totalSizeMB > MAX_TOTAL_SIZE_MB) {
      showWarning(`Total upload size cannot exceed ${MAX_TOTAL_SIZE_MB}MB.`);
      return;
    }

    setWarning("");

    const previews = files.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      type: file.type.startsWith("video") ? "video" : "image",
    }));

    setAttachments((current) => [...current, ...previews]);
    event.target.value = "";
  };

  const removeAttachment = (indexToRemove) => {
    setAttachments((current) =>
      current.filter((_, index) => index !== indexToRemove)
    );
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handlePost = async () => {
    if ((!text.trim() && attachments.length === 0) || submitting) {
      return;
    }

    if (extractHashtags(text).length > MAX_HASHTAGS) {
      showWarning(`You can only use up to ${MAX_HASHTAGS} hashtags.`);
      return;
    }

    try {
      setSubmitting(true);
      enqueueUpload({
        kind: "post",
        caption: text,
        files: attachments.map((attachment) => attachment.file),
      });
      navigate("/feed");
    } catch (error) {
      console.error(error);
      showWarning(error?.message || "Post creation failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const fetchHashtagSuggestions = async (query) => {
    const token = localStorage.getItem("token");
    if (!token || !query) {
      setHashtagSuggestions([]);
      return;
    }

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setHashtagSuggestions([]);
        return;
      }

      setHashtagSuggestions((data.hashtags || []).slice(0, 6));
    } catch {
      setHashtagSuggestions([]);
    }
  };

  const fetchMentionSuggestions = async (query) => {
    const token = localStorage.getItem("token");
    if (!token || !query) {
      setMentionSuggestions([]);
      return;
    }

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setMentionSuggestions([]);
        return;
      }

      setMentionSuggestions((data.users || []).slice(0, 6));
    } catch {
      setMentionSuggestions([]);
    }
  };

  const handleCaptionChange = async (value) => {
    setText(value);
    const cursor = textareaRef.current?.selectionStart ?? value.length;
    const activeQuery = getActiveHashtagQuery(value, cursor);
    const activeMention = getActiveMentionQuery(value, cursor);
    setActiveHashtagRange(activeQuery);
    setActiveMentionRange(activeMention);

    if (activeQuery?.query) {
      await fetchHashtagSuggestions(activeQuery.query);
      setShowHashtagSuggestions(true);
      setShowMentionSuggestions(false);
      return;
    }

    if (activeMention?.query) {
      await fetchMentionSuggestions(activeMention.query);
      setShowMentionSuggestions(true);
      setShowHashtagSuggestions(false);
      return;
    }

    if (!activeQuery || !activeQuery.query) {
      setShowHashtagSuggestions(false);
      setShowMentionSuggestions(false);
      setHashtagSuggestions([]);
      setMentionSuggestions([]);
      return;
    }
  };

  const applyHashtagSuggestion = (tag) => {
    if (!activeHashtagRange) return;

    const nextValue = `${text.slice(0, activeHashtagRange.start)}#${tag} ${text.slice(activeHashtagRange.end)}`;
    setText(nextValue);
    setShowHashtagSuggestions(false);
    setHashtagSuggestions([]);
  };

  const applyMentionSuggestion = (username) => {
    if (!activeMentionRange) return;

    const nextValue = `${text.slice(0, activeMentionRange.start)}@${username} ${text.slice(activeMentionRange.end)}`;
    setText(nextValue);
    setShowMentionSuggestions(false);
    setMentionSuggestions([]);
  };

  return (
    <main className="create-post-page">
      <div className="create-post-card">
        <div className="create-post-header">
          <button
            type="button"
            className="cancel-btn create-header-btn"
            onClick={() => navigate("/feed")}
            disabled={submitting}
          >
            Cancel
          </button>

          <h2 className="create-title">Create Post</h2>

          <button
            type="button"
            className="submit-btn create-header-btn"
            onClick={handlePost}
            disabled={submitting}
          >
            <span className="submit-btn-content">
              {submitting && <span className="submit-spinner" aria-hidden="true"></span>}
              <span>{submitting ? "Posting..." : "Post"}</span>
            </span>
          </button>
        </div>

        <textarea
          ref={textareaRef}
          className="create-textarea"
          placeholder="What's happening in your world today?"
          value={text}
          onChange={(event) => handleCaptionChange(event.target.value)}
          onBlur={() => {
            window.setTimeout(() => {
              setShowHashtagSuggestions(false);
              setShowMentionSuggestions(false);
            }, 120);
          }}
          onFocus={() => {
            const cursor = textareaRef.current?.selectionStart ?? text.length;
            const activeQuery = getActiveHashtagQuery(text, cursor);
            const activeMention = getActiveMentionQuery(text, cursor);
            if (activeQuery?.query) {
              setActiveHashtagRange(activeQuery);
              fetchHashtagSuggestions(activeQuery.query);
              setShowHashtagSuggestions(true);
              setShowMentionSuggestions(false);
            } else if (activeMention?.query) {
              setActiveMentionRange(activeMention);
              fetchMentionSuggestions(activeMention.query);
              setShowMentionSuggestions(true);
              setShowHashtagSuggestions(false);
            }
          }}
        />

        {showHashtagSuggestions && hashtagSuggestions.length > 0 && (
          <div className="hashtag-suggest-dropdown">
            {hashtagSuggestions.map((item) => (
              <button
                key={item.tag}
                type="button"
                className="hashtag-suggest-item"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyHashtagSuggestion(item.tag)}
              >
                <strong>#{item.tag}</strong>
                <span>{(item.post_count || 0).toLocaleString()} posts</span>
              </button>
            ))}
          </div>
        )}

        {showMentionSuggestions && mentionSuggestions.length > 0 && (
          <div className="hashtag-suggest-dropdown">
            {mentionSuggestions.map((item) => (
              <button
                key={item.id}
                type="button"
                className="hashtag-suggest-item"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyMentionSuggestion(item.username)}
              >
                <strong>@{item.username}</strong>
                <span>Profile</span>
              </button>
            ))}
          </div>
        )}

        {warning && <div className="composer-warning">{warning}</div>}

        <div className="attachment-area">
          <button
            type="button"
            className={`attachment-btn ${attachments.length >= MAX_ATTACHMENTS ? "shake" : ""}`}
            onClick={openFilePicker}
            disabled={attachments.length >= MAX_ATTACHMENTS || submitting}
          >
            +
          </button>

          <span className="attachment-count-badge">
            {attachments.length} / {MAX_ATTACHMENTS}
          </span>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            onChange={handleFileChange}
          />
        </div>

        {attachments.length > 0 && (
          <div className="preview-grid">
            {attachments.map((attachment, index) => (
              <div key={index} className="preview-item">
                {attachment.type === "image" ? (
                  <img src={attachment.preview} alt="preview" />
                ) : (
                  <video src={attachment.preview} controls />
                )}

                <button
                  type="button"
                  className="remove-preview-btn"
                  onClick={() => removeAttachment(index)}
                  disabled={submitting}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}

      </div>
    </main>
  );
}
