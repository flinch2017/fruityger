import React, { useState, useRef } from "react";
import "../css/CreatePost.css";
import { useNavigate } from "react-router-dom";

export default function CreatePost() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [warning, setWarning] = useState("");

  const MAX_ATTACHMENTS = 4;
  const MAX_TOTAL_SIZE_MB = 50;

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);

    if (!files.length) return;

    // Attachment count limit
    if (attachments.length >= MAX_ATTACHMENTS) {
        showWarning(`Attachment limit reached (${MAX_ATTACHMENTS}/4)`);
        return;
    }

    if (attachments.length + files.length > MAX_ATTACHMENTS) {
        showWarning(`You can only attach up to ${MAX_ATTACHMENTS} files.`);
        return;
    }

    // Total size limit check 🔥
    const totalSizeMB =
        getTotalAttachmentSizeMB([
        ...attachments.map(a => a.file),
        ...files
        ]);

    if (totalSizeMB > MAX_TOTAL_SIZE_MB) {
        showWarning(`Total upload size cannot exceed ${MAX_TOTAL_SIZE_MB}MB.`);
        return;
    }

    setWarning("");

    const previews = files.map(file => ({
        file,
        preview: URL.createObjectURL(file),
        type: file.type.startsWith("video") ? "video" : "image"
    }));

    setAttachments(prev => [...prev, ...previews]);
    };

  const removeAttachment = (index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handlePost = async () => {

  if (!text.trim() && attachments.length === 0) return;

  const formData = new FormData();

  formData.append("caption", text);

  attachments.forEach(att => {
    formData.append("media", att.file);
  });

  const token = localStorage.getItem("token");

  const res = await fetch("http://localhost:5000/api/posts/create", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: formData
  });

  const data = await res.json();

  if (data.success) {
    navigate("/feed");
  }
};

  const showWarning = (msg) => {
    setWarning(msg);

    setTimeout(() => {
        setWarning("");
    }, 3000);
  };

  const getTotalAttachmentSizeMB = (files) => {
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  return totalBytes / (1024 * 1024);
};

  return (
    <main className="create-post-page">

      <div className="create-post-card">

        <h2 className="create-title">✨ Create Post</h2>

        <textarea
          className="create-textarea"
          placeholder="What's happening in your world today?"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        {/* Warning UI Message */}
        {warning && (
        <div className="composer-warning">
            ⚠️ {warning}
        </div>
        )}

        {/* Attachment Section */}
        <div className="attachment-area">

        <button
            className={`attachment-btn ${attachments.length >= MAX_ATTACHMENTS ? "shake" : ""}`}
            onClick={openFilePicker}
            disabled={attachments.length >= MAX_ATTACHMENTS}
        >
            📎
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

        {/* Preview Grid */}
        {attachments.length > 0 && (
          <div className="preview-grid">
            {attachments.map((att, index) => (
              <div key={index} className="preview-item">

                {att.type === "image" ? (
                  <img src={att.preview} alt="preview" />
                ) : (
                  <video src={att.preview} controls />
                )}

                <button
                  className="remove-preview-btn"
                  onClick={() => removeAttachment(index)}
                >
                  ✕
                </button>

              </div>
            ))}
          </div>
        )}

        <div className="create-actions">
          <button className="cancel-btn" onClick={() => navigate("/feed")}>
            Cancel
          </button>

          <button className="submit-btn" onClick={handlePost}>
            Post ✨
          </button>
        </div>

      </div>
    </main>
  );
}