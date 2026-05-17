import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import "../css/EditProfile.css";
import "../css/EditPost.css";
import { getSafeMediaUrl } from "../utils/mediaUrl";

const getActiveMentionQuery = (text = "", cursor = 0) => {
  const uptoCursor = String(text).slice(0, cursor);
  const match = uptoCursor.match(/(?:^|\s)@([A-Za-z0-9._]*)$/);
  if (!match) return null;

  const query = match[1] || "";
  const start = uptoCursor.length - query.length - 1;
  return { query: query.toLowerCase(), start, end: cursor };
};

export default function EditPost() {
  const navigate = useNavigate();
  const location = useLocation();
  const { postId } = useParams();
  const textareaRef = useRef(null);

  const [caption, setCaption] = useState(location.state?.post?.caption || "");
  const [loading, setLoading] = useState(!location.state?.post);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState({ message: "", type: "" });
  const [mentionSuggestions, setMentionSuggestions] = useState([]);
  const [showMentionSuggestions, setShowMentionSuggestions] = useState(false);
  const [activeMentionRange, setActiveMentionRange] = useState(null);

  const showAlert = (message, type = "success", duration = 3000) => {
    setAlert({ message, type });
    setTimeout(() => setAlert({ message: "", type: "" }), duration);
  };

  useEffect(() => {
    if (location.state?.post) return;

    const fetchPost = async () => {
      const token = localStorage.getItem("token");
      if (!token) return;

      setLoading(true);

      try {
        const res = await fetch(`http://localhost:5000/api/profile/post/${postId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to load post");
        }

        setCaption(data.post?.caption || "");
      } catch (err) {
        console.error(err);
        showAlert(err.message || "Failed to load post", "error");
      } finally {
        setLoading(false);
      }
    };

    fetchPost();
  }, [location.state, postId]);

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
    setCaption(value);
    const cursor = textareaRef.current?.selectionStart ?? value.length;
    const activeMention = getActiveMentionQuery(value, cursor);
    setActiveMentionRange(activeMention);

    if (activeMention?.query) {
      await fetchMentionSuggestions(activeMention.query);
      setShowMentionSuggestions(true);
      return;
    }

    setShowMentionSuggestions(false);
    setMentionSuggestions([]);
  };

  const applyMentionSuggestion = (username) => {
    if (!activeMentionRange) return;
    const nextValue = `${caption.slice(0, activeMentionRange.start)}@${username} ${caption.slice(activeMentionRange.end)}`;
    setCaption(nextValue);
    setShowMentionSuggestions(false);
    setMentionSuggestions([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const token = localStorage.getItem("token");
    if (!token) return;

    setSaving(true);

    try {
      const res = await fetch(`http://localhost:5000/api/profile/${postId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ caption }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to update post");
      }

      showAlert("Caption updated successfully!", "success");

      const username = localStorage.getItem("username");
      setTimeout(() => {
        navigate(username ? `/profile/${username}` : "/feed");
      }, 900);
    } catch (err) {
      console.error(err);
      showAlert(err.message || "Failed to update post", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="edit-post-page">
        <div className="profile-loading">
          <div className="profile-spinner"></div>
          <p>Loading post...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="edit-post-page">
      <div className="edit-post-card">
        {alert.message && (
          <div className={`custom-alert ${alert.type}`}>
            {alert.message}
          </div>
        )}

        <button className="edit-close-btn" onClick={() => navigate(-1)}>
          ×
        </button>

        <h2 className="edit-profile-title">Edit Caption</h2>

        <form className="edit-profile-form" onSubmit={handleSubmit}>
          <label>
            Caption
            <textarea
              ref={textareaRef}
              className="edit-post-textarea"
              value={caption}
              onChange={(e) => handleCaptionChange(e.target.value)}
              placeholder="Write a caption..."
              rows={6}
              onBlur={() => {
                window.setTimeout(() => {
                  setShowMentionSuggestions(false);
                }, 120);
              }}
              onFocus={() => {
                const cursor = textareaRef.current?.selectionStart ?? caption.length;
                const activeMention = getActiveMentionQuery(caption, cursor);
                if (activeMention?.query) {
                  setActiveMentionRange(activeMention);
                  fetchMentionSuggestions(activeMention.query);
                  setShowMentionSuggestions(true);
                }
              }}
            />

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
                    <span className="mention-suggest-main">
                      <span className="mention-suggest-avatar" aria-hidden="true">
                        {item.profile_pic ? (
                          <img src={getSafeMediaUrl(item.profile_pic)} alt="" />
                        ) : (
                          (item.username || "?").slice(0, 1).toUpperCase()
                        )}
                      </span>
                      <strong>@{item.username}</strong>
                    </span>
                    <span>Profile</span>
                  </button>
                ))}
              </div>
            )}
          </label>

          <button type="submit" disabled={saving}>
            <span className="button-label">
              {saving && <span className="spinner" aria-hidden="true"></span>}
              <span>Save Caption</span>
            </span>
          </button>
        </form>
      </div>
    </div>
  );
}
