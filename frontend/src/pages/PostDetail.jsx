import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import CommentSheet from "../components/CommentSheet";
import "../css/Feed.css";
import "../css/CommentSheet.css";
import "../css/PostDetail.css";
import { getSafeMediaUrl } from "../utils/mediaUrl";

export default function PostDetail() {
  const { postId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const videoRefs = useRef({});
  const observerRef = useRef(null);

  const [post, setPost] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [liking, setLiking] = useState(false);
  const [commentOpen, setCommentOpen] = useState(Boolean(location.state?.openComments));

  const formatDate = (dateString) => {
    if (!dateString) return "";

    const now = new Date();
    const date = new Date(dateString);
    if (isNaN(date)) return "";

    const diffMs = now - date;
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSeconds < 60) return "Just now";
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  useEffect(() => {
    const fetchPost = async () => {
      const token = localStorage.getItem("token");
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`http://localhost:5000/api/main/post/${postId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to load post");
        }

        setPost(data.post);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchPost();
  }, [postId]);

  useEffect(() => {
    if (location.state?.openComments) {
      setCommentOpen(true);
    }
  }, [location.state]);

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

    Object.values(videoRefs.current).forEach((video) => {
      if (video) observerRef.current.observe(video);
    });

    return () => observerRef.current?.disconnect();
  }, [post, activeIndex]);

  const moveSlide = (direction) => {
    if (!post?.media?.length) return;

    setActiveIndex((prev) => {
      let nextIndex = prev + direction;

      if (nextIndex < 0) nextIndex = post.media.length - 1;
      if (nextIndex >= post.media.length) nextIndex = 0;

      return nextIndex;
    });
  };

  const toggleLike = async () => {
    const token = localStorage.getItem("token");
    if (!token || !post || liking) return;

    const wasLiked = post.is_liked;
    const previousCount = post.like_count || 0;

    setLiking(true);
    setPost((prev) => ({
      ...prev,
      is_liked: !wasLiked,
      like_count: wasLiked ? Math.max(previousCount - 1, 0) : previousCount + 1,
    }));

    try {
      const res = await fetch("http://localhost:5000/api/likes/toggle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ postId }),
      });

      if (!res.ok) {
        throw new Error("Failed");
      }
    } catch (err) {
      console.error(err);
      setPost((prev) => ({
        ...prev,
        is_liked: wasLiked,
        like_count: previousCount,
      }));
    } finally {
      setLiking(false);
    }
  };

  if (loading) {
    return (
      <div className="post-detail-page">
        <div className="post-detail-status">Loading post...</div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="post-detail-page">
        <div className="post-detail-status">Post not found.</div>
      </div>
    );
  }

  return (
    <div className="post-detail-page">
      {commentOpen && (
        <CommentSheet
          postId={post.post_id}
          postAuthorId={post.user_id}
          onClose={() => setCommentOpen(false)}
        />
      )}

      <div className="post-detail-shell">
        <button className="post-detail-back" onClick={() => navigate(-1)}>
          Back
        </button>

        <div className="feed-post-card post-detail-card">
          <div className="feed-post-header">
            <div className="feed-post-user-info">
              <div
                className="feed-post-user-avatar clickable"
                onClick={() => navigate(`/profile/${post.username}`)}
              >
                {post.profile_pic ? <img src={getSafeMediaUrl(post.profile_pic)} alt="pfp" /> : "👤"}
              </div>

              <div className="feed-post-user-text">
                <span
                  className="feed-post-username clickable"
                  onClick={() => navigate(`/profile/${post.username}`)}
                >
                  {post.username}
                </span>
                <span className="feed-post-date">{formatDate(post.date_posted)}</span>
              </div>
            </div>
          </div>

          {post.caption && <p className="feed-post-content">{post.caption}</p>}

          {post.media?.length > 0 && (
            <div className="feed-carousel">
              {post.media.length > 1 && (
                <>
                  <button className="feed-carousel-arrow left" onClick={() => moveSlide(-1)}>
                    ‹
                  </button>
                  <button className="feed-carousel-arrow right" onClick={() => moveSlide(1)}>
                    ›
                  </button>
                </>
              )}

              <div
                className="feed-carousel-track"
                style={{ transform: `translateX(-${activeIndex * 100}%)` }}
              >
                {post.media.map((media, index) => (
                  <div className="feed-carousel-item" key={index}>
                    {media.media_type === "video" ? (
                      <video
                        ref={(el) => {
                          if (!el) return;
                          videoRefs.current[index] = el;
                        }}
                        src={getSafeMediaUrl(media.media_url)}
                        playsInline
                        loop
                        preload="metadata"
                        className="feed-auto-video"
                      />
                    ) : (
                      <img src={getSafeMediaUrl(media.media_url)} alt="" />
                    )}
                  </div>
                ))}
              </div>

              {post.media.length > 1 && (
                <div className="feed-carousel-indicator">
                  {post.media.map((_, index) => (
                    <span
                      key={index}
                      className={activeIndex === index ? "feed-indicator-dot active" : "feed-indicator-dot"}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="feed-post-footer">
            <div className="feed-post-actions-left">
              <div className="feed-like-wrapper">
                <button
                  className={`feed-post-action-btn ${post.is_liked ? "liked" : ""}`}
                  onClick={toggleLike}
                >
                  ❤️
                </button>
                <span className="feed-like-count">{post.like_count || 0}</span>
              </div>

              <div className="feed-like-wrapper">
                <button
                  className="feed-post-action-btn"
                  onClick={() => setCommentOpen(true)}
                >
                  💬
                </button>
                <span className="feed-like-count">{post.comment_count || 0}</span>
              </div>

              <button
                className="feed-post-action-btn"
                onClick={() => navigate(`/profile/${post.username}`)}
              >
                🔗
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
