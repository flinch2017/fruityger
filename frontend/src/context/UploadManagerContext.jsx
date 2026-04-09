import React, { createContext, useContext, useMemo, useRef, useState } from "react";
import "../css/UploadManager.css";

const UploadManagerContext = createContext(null);

const normalizeBaseUrl = (value) => String(value || "").trim().replace(/\/+$/, "");
const configuredApiBaseUrl = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);

const mapApiUrl = (url) => {
  if (!url.startsWith("/api")) {
    return url;
  }

  return configuredApiBaseUrl ? `${configuredApiBaseUrl}${url}` : url;
};

function formatUploadLabel(kind) {
  return kind === "tape" ? "Tape" : "Post";
}

function UploadOverlay({ uploads, onDismiss }) {
  if (!uploads.length) {
    return null;
  }

  return (
    <div className="upload-overlay">
      {uploads.map((upload) => (
        <div
          key={upload.id}
          className={`upload-card ${upload.status}`}
        >
          <div className="upload-card-top">
            <div>
              <p className="upload-card-kicker">{formatUploadLabel(upload.kind)}</p>
              <strong className="upload-card-title">
                {upload.status === "uploading"
                  ? `${formatUploadLabel(upload.kind)} uploading`
                  : upload.status === "success"
                    ? `${formatUploadLabel(upload.kind)} posted`
                    : `${formatUploadLabel(upload.kind)} failed`}
              </strong>
            </div>

            {(upload.status === "success" || upload.status === "error") && (
              <button
                type="button"
                className="upload-dismiss"
                onClick={() => onDismiss(upload.id)}
              >
                Close
              </button>
            )}
          </div>

          <p className="upload-card-copy">
            {upload.status === "uploading"
              ? "You can keep browsing while this finishes in the background."
              : upload.status === "success"
                ? "Finished successfully."
                : upload.error || "Upload failed."}
          </p>

          {upload.status === "uploading" && (
            <>
              <div className="upload-progress-track">
                <div
                  className="upload-progress-fill"
                  style={{ width: `${Math.max(upload.progress, 8)}%` }}
                />
              </div>
              <span className="upload-progress-label">{upload.progress}%</span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export function UploadManagerProvider({ children }) {
  const [uploads, setUploads] = useState([]);
  const timeoutsRef = useRef(new Map());

  const dismissUpload = (id) => {
    const timeoutId = timeoutsRef.current.get(id);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      timeoutsRef.current.delete(id);
    }

    setUploads((current) => current.filter((upload) => upload.id !== id));
  };

  const enqueueUpload = ({ kind = "post", caption = "", files = [] }) => {
    const normalizedFiles = Array.from(files || []).filter(Boolean);
    if (!normalizedFiles.length && !String(caption || "").trim()) {
      throw new Error("Nothing to upload.");
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const nextUpload = {
      id,
      kind,
      status: "uploading",
      progress: 0,
      error: "",
    };

    setUploads((current) => [...current, nextUpload]);

    const formData = new FormData();
    formData.append("caption", caption);
    normalizedFiles.forEach((file) => {
      formData.append("media", file);
    });

    const token = localStorage.getItem("token");

    const request = new XMLHttpRequest();
    request.open("POST", mapApiUrl("/api/posts/create"), true);
    if (token) {
      request.setRequestHeader("Authorization", `Bearer ${token}`);
    }

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }

      const progress = Math.min(99, Math.round((event.loaded / event.total) * 100));
      setUploads((current) =>
        current.map((upload) =>
          upload.id === id ? { ...upload, progress } : upload
        )
      );
    };

    request.onload = () => {
      let data = {};

      try {
        data = request.responseText ? JSON.parse(request.responseText) : {};
      } catch {
        data = {};
      }

      if (request.status >= 200 && request.status < 300 && data.success) {
        setUploads((current) =>
          current.map((upload) =>
            upload.id === id ? { ...upload, status: "success", progress: 100 } : upload
          )
        );

        const timeoutId = window.setTimeout(() => {
          dismissUpload(id);
        }, 4500);
        timeoutsRef.current.set(id, timeoutId);
        return;
      }

      setUploads((current) =>
        current.map((upload) =>
          upload.id === id
            ? {
                ...upload,
                status: "error",
                error: data.error || request.responseText || "Upload failed.",
              }
            : upload
        )
      );
    };

    request.onerror = () => {
      setUploads((current) =>
        current.map((upload) =>
          upload.id === id
            ? {
                ...upload,
                status: "error",
                error: "Network error while uploading.",
              }
            : upload
        )
      );
    };

    request.send(formData);
    return id;
  };

  const value = useMemo(
    () => ({
      enqueueUpload,
      uploads,
      dismissUpload,
    }),
    [uploads]
  );

  return (
    <UploadManagerContext.Provider value={value}>
      {children}
      <UploadOverlay uploads={uploads} onDismiss={dismissUpload} />
    </UploadManagerContext.Provider>
  );
}

export function useUploadManager() {
  const context = useContext(UploadManagerContext);

  if (!context) {
    throw new Error("useUploadManager must be used within UploadManagerProvider");
  }

  return context;
}
