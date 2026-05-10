import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/CreateTape.css";
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

export default function CreateTape() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const captionRef = useRef(null);
  const { enqueueUpload } = useUploadManager();

  const [caption, setCaption] = useState("");
  const [hashtagSuggestions, setHashtagSuggestions] = useState([]);
  const [showHashtagSuggestions, setShowHashtagSuggestions] = useState(false);
  const [activeHashtagRange, setActiveHashtagRange] = useState(null);
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreview, setVideoPreview] = useState("");
  const [warning, setWarning] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const MAX_VIDEO_SIZE_MB = 50;

  useEffect(() => {
    return () => {
      if (videoPreview) {
        URL.revokeObjectURL(videoPreview);
      }
    };
  }, [videoPreview]);

  const showWarning = (message) => {
    setWarning(message);
    window.setTimeout(() => setWarning(""), 3200);
  };

  const openVideoPicker = () => {
    fileInputRef.current?.click();
  };

  const handleVideoChange = (event) => {
    const file = event.target.files?.[0];

    if (!file) return;

    if (!file.type.startsWith("video/")) {
      showWarning("Tape only supports video uploads.");
      event.target.value = "";
      return;
    }

    if (file.size > MAX_VIDEO_SIZE_MB * 1024 * 1024) {
      showWarning(`Tape video size cannot exceed ${MAX_VIDEO_SIZE_MB}MB.`);
      event.target.value = "";
      return;
    }

    if (videoPreview) {
      URL.revokeObjectURL(videoPreview);
    }

    setVideoFile(file);
    setVideoPreview(URL.createObjectURL(file));
    setWarning("");
    event.target.value = "";
  };

  const clearSelectedVideo = () => {
    if (videoPreview) {
      URL.revokeObjectURL(videoPreview);
    }

    setVideoFile(null);
    setVideoPreview("");
  };

  const handlePublishTape = async () => {
    if (!videoFile || submitting) {
      if (!videoFile) {
        showWarning("Choose a video first.");
      }
      return;
    }

    if (extractHashtags(caption).length > MAX_HASHTAGS) {
      showWarning(`You can only use up to ${MAX_HASHTAGS} hashtags.`);
      return;
    }

    try {
      setSubmitting(true);
      enqueueUpload({
        kind: "tape",
        caption,
        files: [videoFile],
      });
      navigate("/feed");
    } catch (error) {
      console.error(error);
      showWarning(error?.message || "Tape publishing failed.");
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

  const handleCaptionChange = async (value) => {
    setCaption(value);
    const cursor = captionRef.current?.selectionStart ?? value.length;
    const activeQuery = getActiveHashtagQuery(value, cursor);
    setActiveHashtagRange(activeQuery);

    if (!activeQuery || !activeQuery.query) {
      setShowHashtagSuggestions(false);
      setHashtagSuggestions([]);
      return;
    }

    await fetchHashtagSuggestions(activeQuery.query);
    setShowHashtagSuggestions(true);
  };

  const applyHashtagSuggestion = (tag) => {
    if (!activeHashtagRange) return;

    const nextValue = `${caption.slice(0, activeHashtagRange.start)}#${tag} ${caption.slice(activeHashtagRange.end)}`;
    setCaption(nextValue);
    setShowHashtagSuggestions(false);
    setHashtagSuggestions([]);
  };

  return (
    <main className="create-tape-page">
      <section className="create-tape-shell">
        <div className="create-tape-stage">
          <div className="create-tape-topbar">
            <button
              type="button"
              className="create-tape-pill secondary"
              onClick={() => navigate("/feed")}
              disabled={submitting}
            >
              Cancel
            </button>

            <div className="create-tape-heading">
              <p className="create-tape-kicker">Tape</p>
              <h1>Create your next tape</h1>
            </div>

            <button
              type="button"
              className="create-tape-pill primary"
              onClick={handlePublishTape}
              disabled={submitting}
            >
              {submitting ? "Publishing..." : "Publish"}
            </button>
          </div>

          <div className="create-tape-layout">
            <div className="create-tape-preview-card">
              {videoPreview ? (
                <>
                  <video
                    className="create-tape-preview-video"
                    src={videoPreview}
                    controls
                    playsInline
                  />
                  <button
                    type="button"
                    className="create-tape-clear"
                    onClick={clearSelectedVideo}
                    disabled={submitting}
                  >
                    Remove video
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="create-tape-dropzone"
                  onClick={openVideoPicker}
                  disabled={submitting}
                >
                  <span className="create-tape-dropzone-badge">9:16</span>
                  <strong>Drop in your tape</strong>
                  <span>Choose one vertical video to start building your tape.</span>
                </button>
              )}
            </div>

            <aside className="create-tape-sidebar">
              <div className="create-tape-panel">
                <p className="create-tape-panel-label">Video</p>
                <button
                  type="button"
                  className="create-tape-action"
                  onClick={openVideoPicker}
                  disabled={submitting}
                >
                  {videoFile ? "Replace video" : "Choose video"}
                </button>
                <p className="create-tape-panel-hint">
                  One video only. Tapes look best when they are vertical and punchy.
                </p>
              </div>

              <div className="create-tape-panel">
                <p className="create-tape-panel-label">Caption</p>
                <textarea
                  ref={captionRef}
                  className="create-tape-caption"
                  placeholder="Write a caption that sets the vibe..."
                  value={caption}
                  onChange={(event) => handleCaptionChange(event.target.value)}
                  disabled={submitting}
                  onBlur={() => {
                    window.setTimeout(() => setShowHashtagSuggestions(false), 120);
                  }}
                  onFocus={() => {
                    const cursor = captionRef.current?.selectionStart ?? caption.length;
                    const activeQuery = getActiveHashtagQuery(caption, cursor);
                    if (activeQuery?.query) {
                      setActiveHashtagRange(activeQuery);
                      fetchHashtagSuggestions(activeQuery.query);
                      setShowHashtagSuggestions(true);
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
              </div>

              <div className="create-tape-stats">
                <div className="create-tape-stat">
                  <span>Status</span>
                  <strong>{videoFile ? "Ready to publish" : "Waiting for video"}</strong>
                </div>
                <div className="create-tape-stat">
                  <span>Format</span>
                  <strong>Video only</strong>
                </div>
                <div className="create-tape-stat">
                  <span>Limit</span>
                  <strong>{MAX_VIDEO_SIZE_MB}MB max</strong>
                </div>
              </div>

              {warning && <div className="create-tape-warning">{warning}</div>}
            </aside>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            hidden
            onChange={handleVideoChange}
          />
        </div>
      </section>
    </main>
  );
}
