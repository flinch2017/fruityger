import React, { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/CreatePost.css";

export default function CreatePost() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [text, setText] = useState("");
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

    const formData = new FormData();
    formData.append("caption", text);

    attachments.forEach((attachment) => {
      formData.append("media", attachment.file);
    });

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

      const data = await res.json();

      if (data.success) {
        navigate("/feed");
        return;
      }

      showWarning(data.error || "Post creation failed.");
    } catch (error) {
      console.error(error);
      showWarning("Post creation failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="create-post-page">
      <div className="create-post-card">
        <h2 className="create-title">Create Post</h2>

        <textarea
          className="create-textarea"
          placeholder="What's happening in your world today?"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />

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

        <div className="create-actions">
          <button
            type="button"
            className="cancel-btn"
            onClick={() => navigate("/feed")}
            disabled={submitting}
          >
            Cancel
          </button>

          <button
            type="button"
            className="submit-btn"
            onClick={handlePost}
            disabled={submitting}
          >
            <span className="submit-btn-content">
              {submitting && <span className="submit-spinner" aria-hidden="true"></span>}
              <span>{submitting ? "Posting..." : "Post"}</span>
            </span>
          </button>
        </div>
      </div>
    </main>
  );
}
