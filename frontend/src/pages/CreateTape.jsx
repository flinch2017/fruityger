import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/CreateTape.css";

export default function CreateTape() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [caption, setCaption] = useState("");
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

    const formData = new FormData();
    formData.append("caption", caption);
    formData.append("media", videoFile);

    const token = localStorage.getItem("token");
    setSubmitting(true);

    try {
      const res = await fetch("http://localhost:5000/api/posts/create", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const responseText = await res.text();
      let data = {};

      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        data = {};
      }

      if (data.success) {
        navigate("/feed");
        return;
      }

      showWarning(data.error || responseText || "Tape publishing failed.");
    } catch (error) {
      console.error(error);
      showWarning(error?.message || "Tape publishing failed.");
    } finally {
      setSubmitting(false);
    }
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
              <h1>Create your next short</h1>
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
                  <span>Choose one vertical video to start building your reel-style post.</span>
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
                  One video only. Reels-style tapes look best when they are vertical and punchy.
                </p>
              </div>

              <div className="create-tape-panel">
                <p className="create-tape-panel-label">Caption</p>
                <textarea
                  className="create-tape-caption"
                  placeholder="Write a caption that sets the vibe..."
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                  disabled={submitting}
                />
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
