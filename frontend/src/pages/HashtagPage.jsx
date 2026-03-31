import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "../css/HashtagPage.css";
import { getSafeMediaUrl } from "../utils/mediaUrl";

export default function HashtagPage() {
  const { tag } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState({
    hashtag: null,
    posts: [],
  });

  useEffect(() => {
    const fetchHashtag = async () => {
      const token = localStorage.getItem("token");

      if (!token) {
        navigate("/login", { replace: true });
        return;
      }

      setLoading(true);
      setError("");

      try {
        const res = await fetch(`http://localhost:5000/api/search/hashtags/${encodeURIComponent(tag)}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const result = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(result.error || "Failed to load hashtag");
        }

        setData({
          hashtag: result.hashtag,
          posts: result.posts || [],
        });
      } catch (err) {
        console.error(err);
        setError(err.message || "Failed to load hashtag");
      } finally {
        setLoading(false);
      }
    };

    fetchHashtag();
  }, [navigate, tag]);

  const toggleSave = async () => {
    const token = localStorage.getItem("token");
    if (!token || !data.hashtag || saving) return;

    setSaving(true);

    try {
      const res = await fetch(
        `http://localhost:5000/api/search/hashtags/${encodeURIComponent(data.hashtag.tag)}/save`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const result = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(result.error || "Failed to save hashtag");
      }

      setData((current) => ({
        ...current,
        hashtag: current.hashtag
          ? { ...current.hashtag, is_saved: result.saved }
          : current.hashtag,
      }));
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to save hashtag");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="hashtag-page">
        <div className="hashtag-state">Loading hashtag...</div>
      </div>
    );
  }

  if (error && !data.hashtag) {
    return (
      <div className="hashtag-page">
        <div className="hashtag-state">{error}</div>
      </div>
    );
  }

  return (
    <div className="hashtag-page">
      <div className="hashtag-hero">
        <div className="hashtag-hero-copy">
          <p className="hashtag-kicker">Hashtag</p>
          <h1>#{data.hashtag?.tag}</h1>
          <p className="hashtag-meta">
            {(data.hashtag?.post_count || 0).toLocaleString()} posts
          </p>
        </div>

        <button
          type="button"
          className={`hashtag-save-btn ${data.hashtag?.is_saved ? "saved" : ""}`}
          onClick={toggleSave}
          disabled={saving}
        >
          {saving ? "Saving..." : data.hashtag?.is_saved ? "Saved" : "Save hashtag"}
        </button>
      </div>

      {error && <div className="hashtag-inline-error">{error}</div>}

      {data.posts.length === 0 ? (
        <div className="hashtag-empty">No posts with this hashtag yet.</div>
      ) : (
        <div className="hashtag-grid">
          {data.posts.map((post) => (
            <button
              key={post.post_id}
              type="button"
              className="hashtag-tile"
              onClick={() => navigate(`/post/${post.post_id}`)}
            >
              <div className="hashtag-tile-media">
                {post.preview_media_url ? (
                  post.preview_media_type === "video" ? (
                    <video
                      src={getSafeMediaUrl(post.preview_media_url)}
                      muted
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    <img src={getSafeMediaUrl(post.preview_media_url)} alt="" />
                  )
                ) : (
                  <div className="hashtag-text-fallback">
                    <span>{post.caption || `#${data.hashtag?.tag}`}</span>
                  </div>
                )}

                <div className="hashtag-tile-overlay" />
                <div className="hashtag-tile-stats">
                  <span>{post.like_count || 0} likes</span>
                  <span>{post.comment_count || 0} comments</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
