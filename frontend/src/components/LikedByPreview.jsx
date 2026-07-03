import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaUser } from "react-icons/fa";
import { getSafeMediaUrl } from "../utils/mediaUrl";
import VerifiedBadge from "./VerifiedBadge";

export default function LikedByPreview({ postId, likeCount = 0, preview = null, className = "" }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [likers, setLikers] = useState([]);
  const [error, setError] = useState("");

  const count = Number(likeCount || 0);
  if (!postId || count <= 0 || !preview?.username) {
    return null;
  }

  const otherCount =
    Number.isFinite(Number(preview.other_count))
      ? Number(preview.other_count)
      : Math.max(count - 1, 0);

  const openLikes = async () => {
    setOpen(true);
    if (likers.length > 0 || loading) return;

    const token = localStorage.getItem("token");
    if (!token) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`http://localhost:5000/api/likes/${postId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Failed to load likes");
      }

      setLikers(Array.isArray(data.likes) ? data.likes : []);
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to load likes");
    } finally {
      setLoading(false);
    }
  };

  const goToProfile = (username) => {
    if (!username) return;
    setOpen(false);
    navigate(`/profile/${username}`);
  };

  return (
    <>
      <button
        type="button"
        className={`liked-by-preview ${className}`.trim()}
        onClick={openLikes}
      >
        Liked by <strong>@{preview.username}</strong>
        {otherCount > 0 ? ` and ${otherCount === 1 ? "1 other" : `${otherCount} others`}` : ""}
      </button>

      {open && (
        <div className="liked-by-modal-overlay" onClick={() => setOpen(false)}>
          <div className="liked-by-modal" onClick={(event) => event.stopPropagation()}>
            <div className="liked-by-modal-header">
              <h3>Likes</h3>
              <button type="button" onClick={() => setOpen(false)}>Close</button>
            </div>

            {loading ? (
              <div className="liked-by-state">Loading likes...</div>
            ) : error ? (
              <div className="liked-by-state error">{error}</div>
            ) : likers.length === 0 ? (
              <div className="liked-by-state">No likes to show yet.</div>
            ) : (
              <div className="liked-by-list">
                {likers.map((liker) => (
                  <button
                    key={liker.user_id}
                    type="button"
                    className="liked-by-row"
                    onClick={() => goToProfile(liker.username)}
                  >
                    <span className="liked-by-avatar">
                      {liker.profile_pic ? (
                        <img src={getSafeMediaUrl(liker.profile_pic)} alt="" />
                      ) : (
                        <FaUser />
                      )}
                    </span>
                    <span className="liked-by-copy">
                      <span>
                        @{liker.username}
                        <VerifiedBadge verified={liker.is_verified} />
                      </span>
                      {liker.follows_you ? <small>Follows you</small> : null}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
