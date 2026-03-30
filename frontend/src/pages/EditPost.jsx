import React, { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import "../css/EditProfile.css";
import "../css/EditPost.css";

export default function EditPost() {
  const navigate = useNavigate();
  const location = useLocation();
  const { postId } = useParams();

  const [caption, setCaption] = useState(location.state?.post?.caption || "");
  const [loading, setLoading] = useState(!location.state?.post);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState({ message: "", type: "" });

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
              className="edit-post-textarea"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Write a caption..."
              rows={6}
            />
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
