import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import CommentSheet from "../components/CommentSheet";
import "../css/Search.css";
import "../css/CommentSheet.css";
import { getSafeMediaUrl } from "../utils/mediaUrl";

const SEARCH_TABS = [
  { key: "profiles", label: "Profiles", resultKey: "users" },
  { key: "posts", label: "Posts", resultKey: "posts" },
  { key: "hashtags", label: "Hashtags", resultKey: "hashtags" },
];

export default function Search() {
  const location = useLocation();
  const query = new URLSearchParams(location.search).get("q");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const videoRefs = useRef({});
  const observerRef = useRef(null);
  const dropdownRef = useRef(null);
  const gestureAxisRef = useRef(null);
  const currentUserId = localStorage.getItem("userId");

  const [activeTab, setActiveTab] = useState("profiles");
  const [result, setResult] = useState({
    users: [],
    posts: [],
    hashtags: []
  });
  const [activeIndexMap, setActiveIndexMap] = useState({});
  const [dragging, setDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [touchStartY, setTouchStartY] = useState(0);
  const [likingMap, setLikingMap] = useState({});
  const [activeCommentPost, setActiveCommentPost] = useState(null);
  const [activeMenuPostId, setActiveMenuPostId] = useState(null);
  const [deleteModal, setDeleteModal] = useState({
    visible: false,
    postId: null
  });
  const [deletingPost, setDeletingPost] = useState(false);
  const [actionResult, setActionResult] = useState(null);

  const orderedTabs = [...SEARCH_TABS].sort((a, b) => {
    const aCount = result[a.resultKey]?.length || 0;
    const bCount = result[b.resultKey]?.length || 0;

    if (bCount !== aCount) {
      return bCount - aCount;
    }

    return SEARCH_TABS.findIndex((tab) => tab.key === a.key) -
      SEARCH_TABS.findIndex((tab) => tab.key === b.key);
  });

  const formatDate = (dateString) => {
    if (!dateString) return "";

    const now = new Date();
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return "";

    const diffMs = now - date;
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffWeeks = Math.floor(diffDays / 7);

    if (diffSeconds < 60) return "Just now";
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffWeeks < 4) return `${diffWeeks}w ago`;

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  };

  const moveSlide = (postId, direction, mediaLength) => {
    setActiveIndexMap((prev) => {
      const current = prev[postId] || 0;
      let nextIndex = current + direction;

      if (nextIndex < 0) nextIndex = mediaLength - 1;
      if (nextIndex >= mediaLength) nextIndex = 0;

      return { ...prev, [postId]: nextIndex };
    });
  };

  const handlePointerStart = (e) => {
    const touch = e.touches ? e.touches[0] : e;
    gestureAxisRef.current = null;
    setDragging(true);
    setDragStartX(touch.clientX);
    setTouchStartY(touch.clientY);
  };

  const handlePointerMove = (e, postId, mediaLength) => {
    if (!dragging) return;

    const touch = e.touches ? e.touches[0] : e;
    const dx = dragStartX - touch.clientX;
    const dy = touch.clientY - touchStartY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (!gestureAxisRef.current) {
      if (absDx < 10 && absDy < 10) return;
      gestureAxisRef.current = absDx > absDy ? "x" : "y";
    }

    if (gestureAxisRef.current === "y") {
      setDragging(false);
      return;
    }

    if (absDx > 80) {
      moveSlide(postId, dx > 0 ? 1 : -1, mediaLength);
      setDragStartX(touch.clientX);
    }
  };

  const handlePointerEnd = () => {
    gestureAxisRef.current = null;
    setDragging(false);
  };

  useEffect(() => {
    if (!query) return;

    setLoading(true);
    const token = localStorage.getItem("token");

    fetch(`/api/search?q=${encodeURIComponent(query)}`, {
      headers: token
        ? {
            Authorization: `Bearer ${token}`
          }
        : undefined
    })
      .then(res => res.json())
      .then(data => {
        setResult(data);

        const topTab = [...SEARCH_TABS].sort((a, b) => {
          const aCount = data[a.resultKey]?.length || 0;
          const bCount = data[b.resultKey]?.length || 0;

          if (bCount !== aCount) {
            return bCount - aCount;
          }

          return SEARCH_TABS.findIndex((tab) => tab.key === a.key) -
            SEARCH_TABS.findIndex((tab) => tab.key === b.key);
        })[0];

        if (topTab) {
          setActiveTab(topTab.key);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const video = entry.target;
          if (!video) return;

          if (entry.isIntersecting) {
            video.play().catch(() => {});
          } else {
            video.pause();
            video.currentTime = 0;
          }
        });
      },
      { threshold: 0.75 }
    );

    Object.values(videoRefs.current).forEach((list) => {
      list?.forEach((video) => {
        if (video) observerRef.current.observe(video);
      });
    });

    return () => observerRef.current?.disconnect();
  }, [result.posts, activeIndexMap]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setActiveMenuPostId(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const toggleLike = async (postId) => {
    const token = localStorage.getItem("token");
    if (!token || likingMap[postId]) return;

    const currentPost = result.posts.find((post) => post.post_id === postId);
    if (!currentPost) return;

    const wasLiked = currentPost.is_liked;
    setLikingMap((prev) => ({ ...prev, [postId]: true }));

    setResult((prev) => ({
      ...prev,
      posts: prev.posts.map((post) =>
        post.post_id === postId
          ? {
              ...post,
              is_liked: !wasLiked,
              like_count: wasLiked
                ? Math.max((post.like_count || 1) - 1, 0)
                : (post.like_count || 0) + 1
            }
          : post
      )
    }));

    try {
      const res = await fetch("http://localhost:5000/api/likes/toggle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ postId })
      });

      if (!res.ok) {
        throw new Error("Failed to toggle like");
      }
    } catch (err) {
      console.error(err);
      setResult((prev) => ({
        ...prev,
        posts: prev.posts.map((post) =>
          post.post_id === postId
            ? {
                ...post,
                is_liked: wasLiked,
                like_count: currentPost.like_count
              }
            : post
        )
      }));
    } finally {
      setLikingMap((prev) => {
        const updated = { ...prev };
        delete updated[postId];
        return updated;
      });
    }
  };

  const toggleMenu = (postId) => {
    setActiveMenuPostId((prev) => (prev === postId ? null : postId));
  };

  const handleEditPost = (post) => {
    setActiveMenuPostId(null);
    navigate(`/edit-post/${post.post_id}`, {
      state: { post }
    });
  };

  const handleReportPost = (postId) => {
    setActiveMenuPostId(null);
    navigate(`/report?type=post&id=${postId}`);
  };

  const promptDeletePost = (postId) => {
    setActiveMenuPostId(null);
    setDeleteModal({ visible: true, postId });
  };

  const handleCancelDelete = () => {
    if (!deletingPost) {
      setDeleteModal({ visible: false, postId: null });
    }
  };

  const handleConfirmDelete = async () => {
    const token = localStorage.getItem("token");
    if (!token || !deleteModal.postId) return;

    setDeletingPost(true);

    try {
      const res = await fetch(
        `http://localhost:5000/api/profile/${deleteModal.postId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      if (!res.ok) {
        throw new Error("Delete failed");
      }

      setResult((prev) => ({
        ...prev,
        posts: prev.posts.filter((post) => post.post_id !== deleteModal.postId)
      }));
      setActionResult({ type: "success", message: "Post deleted successfully!" });
    } catch (err) {
      console.error(err);
      setActionResult({ type: "error", message: "Failed to delete post!" });
    } finally {
      setDeletingPost(false);
      setDeleteModal({ visible: false, postId: null });
      setTimeout(() => setActionResult(null), 3000);
    }
  };

  return (
    <div className="search-page">
      {deleteModal.visible && (
        <div className="search-post-modal-overlay">
          <div className={`search-post-modal-card ${deletingPost ? "loading" : "animate-in"}`}>
            <h3>Confirm Delete</h3>
            <p>Are you sure you want to delete this post?</p>

            {deletingPost && <div className="search-post-spinner"></div>}

            {!deletingPost && (
              <div className="search-post-modal-actions">
                <button className="search-post-modal-btn cancel" onClick={handleCancelDelete}>
                  Cancel
                </button>
                <button className="search-post-modal-btn confirm" onClick={handleConfirmDelete}>
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {actionResult && (
        <div className={`search-post-toast ${actionResult.type}`}>
          {actionResult.message}
        </div>
      )}

      {activeCommentPost && (
        <CommentSheet
          postId={activeCommentPost.postId}
          postAuthorId={activeCommentPost.postAuthorId}
          onClose={() => setActiveCommentPost(null)}
        />
      )}

      <div className="search-header">
        <h2 className="search-title">Results for "{query}"</h2>
      </div>

      {/* 🔥 Tabs */}
      <div className="search-tabs">
        {orderedTabs.map(tab => (
          <button
            key={tab.key}
            className={activeTab === tab.key ? "active" : ""}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 🔥 Tab Content */}
      <section className={`search-section ${loading ? "loading" : ""}`}>
        {loading ? (
          <div className="search-loading">
            <div className="spinner"></div>
          </div>
        ) : (
          <>
            {activeTab === "profiles" && (
              <>
                {result.users.length === 0 ? (
                  <p className="empty-text">No profiles found</p>
                ) : (
                  result.users.map(u => (
                    <div
                      key={u.id}
                      className="search-user-card aero-card clickable"
                      onClick={() => navigate(`/profile/${u.username}`)}
                    >
                      <div className="avatar-placeholder">
                        {u.profile_pic ? (
                          <img src={getSafeMediaUrl(u.profile_pic)} alt={u.username} />
                        ) : (
                          "👤"
                        )}
                      </div>
                      <span>{u.username}</span>
                    </div>
                  ))
                )}
              </>
            )}

            {activeTab === "posts" && (
              <>
                {result.posts.length === 0 ? (
                  <p className="empty-text">No posts found</p>
                ) : (
                  result.posts.map(p => (
                    <div key={p.post_id} className="search-post-feed-card">
                      <div
                        className="search-post-more-wrapper"
                        ref={activeMenuPostId === p.post_id ? dropdownRef : null}
                      >
                        <div
                          className="search-post-more"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleMenu(p.post_id);
                          }}
                        >
                          ⋮
                        </div>

                        {activeMenuPostId === p.post_id && (
                          <div className="search-post-dropdown">
                            {String(p.user_id) === String(currentUserId) ? (
                              <>
                                <div
                                  className="search-post-dropdown-item edit"
                                  onClick={() => handleEditPost(p)}
                                >
                                  Edit
                                </div>
                                <div
                                  className="search-post-dropdown-item delete"
                                  onClick={() => promptDeletePost(p.post_id)}
                                >
                                  Delete
                                </div>
                              </>
                            ) : (
                              <div
                                className="search-post-dropdown-item report"
                                onClick={() => handleReportPost(p.post_id)}
                              >
                                Report
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="search-post-header">
                        <div
                          className="search-post-avatar clickable"
                          onClick={() => navigate(`/profile/${p.username}`)}
                        >
                          {p.profile_pic ? (
                            <img src={getSafeMediaUrl(p.profile_pic)} alt={p.username} />
                          ) : (
                            "👤"
                          )}
                        </div>

                        <div className="search-post-user-text">
                          <span
                            className="search-post-username clickable"
                            onClick={() => navigate(`/profile/${p.username}`)}
                          >
                            {p.username}
                          </span>
                          <span className="search-post-date">
                            {formatDate(p.date_posted)}
                          </span>
                        </div>
                      </div>

                      {p.caption && (
                        <p className="search-post-content">{p.caption}</p>
                      )}

                      {p.media?.length > 0 && (
                        <div className="search-post-carousel">
                          {p.media.length > 1 && (
                            <>
                              <button
                                className="search-post-carousel-arrow left"
                                onClick={() => moveSlide(p.post_id, -1, p.media.length)}
                              >
                                ‹
                              </button>

                              <button
                                className="search-post-carousel-arrow right"
                                onClick={() => moveSlide(p.post_id, 1, p.media.length)}
                              >
                                ›
                              </button>
                            </>
                          )}

                          <div
                            className="search-post-carousel-track"
                            style={{
                              transform: `translateX(-${(activeIndexMap[p.post_id] || 0) * 100}%)`
                            }}
                            onMouseDown={handlePointerStart}
                            onMouseMove={(e) => handlePointerMove(e, p.post_id, p.media.length)}
                            onMouseUp={handlePointerEnd}
                            onMouseLeave={handlePointerEnd}
                            onTouchStart={handlePointerStart}
                            onTouchMove={(e) => handlePointerMove(e, p.post_id, p.media.length)}
                            onTouchEnd={handlePointerEnd}
                          >
                            {p.media.map((media, index) => (
                              <div className="search-post-carousel-item" key={`${p.post_id}-${index}`}>
                                {media.media_type === "video" ? (
                                  <video
                                    ref={(el) => {
                                      if (!el) return;
                                      if (!videoRefs.current[p.post_id]) {
                                        videoRefs.current[p.post_id] = [];
                                      }
                                      videoRefs.current[p.post_id][index] = el;
                                    }}
                                    src={getSafeMediaUrl(media.media_url)}
                                    playsInline
                                    loop
                                    muted
                                    preload="metadata"
                                    className="search-post-video"
                                  />
                                ) : (
                                  <img
                                    src={getSafeMediaUrl(media.media_url)}
                                    alt=""
                                    className="search-post-image"
                                  />
                                )}
                              </div>
                            ))}
                          </div>

                          {p.media.length > 1 && (
                            <div className="search-post-carousel-indicator">
                              {p.media.map((_, index) => (
                                <span
                                  key={`${p.post_id}-dot-${index}`}
                                  className={
                                    (activeIndexMap[p.post_id] || 0) === index
                                      ? "search-post-indicator-dot active"
                                      : "search-post-indicator-dot"
                                  }
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="search-post-footer">
                        <div className="search-post-actions">
                          <div className="search-post-count-group">
                            <button
                              className={`search-post-action-btn ${p.is_liked ? "liked" : ""}`}
                              onClick={() => toggleLike(p.post_id)}
                            >
                              ❤️
                            </button>
                            <span>{p.like_count || 0}</span>
                          </div>

                          <div className="search-post-count-group">
                            <button
                              className="search-post-action-btn"
                              onClick={() =>
                                setActiveCommentPost({
                                  postId: p.post_id,
                                  postAuthorId: p.user_id
                                })
                              }
                            >
                              💬
                            </button>
                            <span>{p.comment_count || 0}</span>
                          </div>

                          <button
                            className="search-post-action-btn"
                            onClick={() => navigate(`/post/${p.post_id}`)}
                          >
                            🔗
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </>
            )}

            {activeTab === "hashtags" && (
              <>
                {result.hashtags.length === 0 ? (
                  <p className="empty-text">No hashtags found</p>
                ) : (
                  <div className="search-hashtags-list">
                    {result.hashtags.map(h => (
                      <button
                        key={h.tag}
                        type="button"
                        className="search-hashtag-card"
                        onClick={() => navigate(`/hashtag/${h.tag}`)}
                      >
                        <div className="search-hashtag-card-main">
                          <span className="search-hashtag-tag">#{h.tag}</span>
                          <span className="search-hashtag-count">
                            {(h.post_count || 0).toLocaleString()} posts
                          </span>
                        </div>

                        {h.is_saved && (
                          <span className="search-hashtag-saved">Saved</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
