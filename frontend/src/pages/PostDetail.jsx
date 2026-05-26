import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { FaChevronLeft, FaChevronRight, FaCommentDots, FaHeart, FaRegHeart, FaRetweet, FaUser, FaVolumeMute, FaVolumeUp } from "react-icons/fa";
import CommentSheet from "../components/CommentSheet";
import "../css/Feed.css";
import "../css/CommentSheet.css";
import "../css/PostDetail.css";
import { getSafeMediaUrl } from "../utils/mediaUrl";
import { formatCount } from "../utils/countFormatter";
import CaptionWithHashtags from "../components/CaptionWithHashtags";
import VerifiedBadge from "../components/VerifiedBadge";

export default function PostDetail() {
  const { postId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const videoRefs = useRef({});
  const observerRef = useRef(null);
  const repostDropdownRef = useRef(null);
  const gestureAxisRef = useRef(null);

  const [post, setPost] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [liking, setLiking] = useState(false);
  const [reposting, setReposting] = useState(false);
  const [repostDropdownOpen, setRepostDropdownOpen] = useState(false);
  const [videoMutedMap, setVideoMutedMap] = useState({});
  const [commentOpen, setCommentOpen] = useState(Boolean(location.state?.openComments));
  const [dragging, setDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [touchStartY, setTouchStartY] = useState(0);

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

  const getVideoControlKey = (index) => `detail-${index}`;

  const getRelevantReposters = () =>
    Array.isArray(post?.reposters) ? post.reposters : [];

  const getRepostLabel = () => {
    const reposters = getRelevantReposters();
    if (reposters.length === 0) return "";

    const [firstReposter] = reposters;
    if (reposters.length === 1) {
      return `Reposted by @${firstReposter.username}`;
    }

    return `Reposted by @${firstReposter.username} + ${reposters.length - 1} others`;
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
    const handleClickOutside = (event) => {
      if (!event.target.closest(".feed-repost-banner-wrap")) {
        setRepostDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

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

  const handlePointerStart = (e) => {
    const touch = e.touches ? e.touches[0] : e;
    gestureAxisRef.current = null;
    setDragging(true);
    setDragStartX(touch.clientX);
    setTouchStartY(touch.clientY);
  };

  const handlePointerMove = (e) => {
    if (!dragging || !post?.media?.length) return;

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
      moveSlide(dx > 0 ? 1 : -1);
      setDragStartX(touch.clientX);
    }
  };

  const handlePointerEnd = () => {
    gestureAxisRef.current = null;
    setDragging(false);
  };

  const toggleVideoMuted = (index) => {
    const videoKey = getVideoControlKey(index);
    setVideoMutedMap((prev) => {
      const nextMuted = !(prev[videoKey] ?? true);
      const next = { ...prev, [videoKey]: nextMuted };
      const video = videoRefs.current[index];
      if (video) {
        video.muted = nextMuted;
        if (!nextMuted) {
          video.play().catch(() => {});
        }
      }
      return next;
    });
  };

  const toggleRepost = async () => {
    const token = localStorage.getItem("token");
    if (!token || !post || reposting) return;

    const wasReposted = post.is_reposted;
    const previousCount = post.repost_count || 0;

    setReposting(true);
    setPost((prev) => ({
      ...prev,
      is_reposted: !wasReposted,
      repost_count: wasReposted ? Math.max(previousCount - 1, 0) : previousCount + 1,
    }));

    try {
      const res = await fetch("http://localhost:5000/api/reposts/toggle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ postId }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to repost post");
      }

      setPost((prev) => ({
        ...prev,
        is_reposted: data.reposted,
        repost_count: data.repost_count ?? prev.repost_count,
      }));
    } catch (err) {
      console.error(err);
      setPost((prev) => ({
        ...prev,
        is_reposted: wasReposted,
        repost_count: previousCount,
      }));
    } finally {
      setReposting(false);
    }
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
                {post.profile_pic ? <img src={getSafeMediaUrl(post.profile_pic)} alt="pfp" /> : <FaUser />}
              </div>

              <div className="feed-post-user-text">
                <span
                  className="feed-post-username clickable"
                  onClick={() => navigate(`/profile/${post.username}`)}
                >
                  <span className="username-with-badge">
                    {post.username}
                    <VerifiedBadge verified={post.is_verified} />
                  </span>
                </span>
                <span className="feed-post-date">{formatDate(post.date_posted)}</span>
              </div>
            </div>
          </div>

          {getRelevantReposters().length > 0 && (
            <div
              className="feed-repost-banner-wrap"
              ref={repostDropdownOpen ? repostDropdownRef : null}
            >
              <button
                type="button"
                className="feed-repost-banner"
                onClick={() => setRepostDropdownOpen((prev) => !prev)}
              >
                {getRepostLabel()}
              </button>

              {repostDropdownOpen && (
                <div className="feed-repost-dropdown">
                  <div className="feed-repost-dropdown-title">Reposted by</div>
                  {getRelevantReposters().map((reposter) => (
                    <button
                      key={`${post.post_id}-${reposter.user_id}`}
                      type="button"
                      className="feed-repost-dropdown-item"
                      onClick={() => {
                        setRepostDropdownOpen(false);
                        navigate(`/profile/${reposter.username}`);
                      }}
                    >
                      <span className="feed-repost-dropdown-avatar">
                        {reposter.profile_pic ? (
                          <img
                            src={getSafeMediaUrl(reposter.profile_pic)}
                            alt={reposter.username}
                          />
                        ) : (
                          <FaUser />
                        )}
                      </span>
                      <span className="feed-repost-dropdown-copy">
                        <strong>
                          <span className="username-with-badge">
                            @{reposter.username}
                            <VerifiedBadge verified={reposter.is_verified} />
                          </span>
                        </strong>
                        <span>{formatDate(reposter.reposted_at)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {post.caption && <CaptionWithHashtags className="feed-post-content" text={post.caption} />}

          {post.media?.length > 0 && (
            <div className="feed-carousel">
              {post.media.length > 1 && (
                <>
                  <button className="feed-carousel-arrow left" onClick={() => moveSlide(-1)}>
                    <FaChevronLeft />
                  </button>
                  <button className="feed-carousel-arrow right" onClick={() => moveSlide(1)}>
                    <FaChevronRight />
                  </button>
                </>
              )}

              <div
                className="feed-carousel-track"
                style={{ transform: `translateX(-${activeIndex * 100}%)` }}
                onMouseDown={handlePointerStart}
                onMouseMove={handlePointerMove}
                onMouseUp={handlePointerEnd}
                onMouseLeave={handlePointerEnd}
                onTouchStart={handlePointerStart}
                onTouchMove={handlePointerMove}
                onTouchEnd={handlePointerEnd}
              >
                {post.media.map((media, index) => (
                  <div className="feed-carousel-item" key={index}>
                    {media.media_type === "video" ? (
                      <>
                        <video
                          ref={(el) => {
                            if (!el) return;
                            videoRefs.current[index] = el;
                            el.muted = videoMutedMap[getVideoControlKey(index)] ?? true;
                          }}
                          src={getSafeMediaUrl(media.media_url)}
                          playsInline
                          loop
                          muted={videoMutedMap[getVideoControlKey(index)] ?? true}
                          preload="metadata"
                          className="feed-auto-video"
                        />
                      </>
                    ) : (
                      <img src={getSafeMediaUrl(media.media_url)} alt="" />
                    )}
                  </div>
                ))}
              </div>

              {post.media[activeIndex]?.media_type === "video" && (
                <button
                  type="button"
                  className={`post-video-sound-btn ${(videoMutedMap[getVideoControlKey(activeIndex)] ?? true) ? "muted" : ""}`}
                  onClick={() => toggleVideoMuted(activeIndex)}
                  aria-label={(videoMutedMap[getVideoControlKey(activeIndex)] ?? true) ? "Turn on sound" : "Mute video"}
                >
                  {(videoMutedMap[getVideoControlKey(activeIndex)] ?? true) ? <FaVolumeMute /> : <FaVolumeUp />}
                </button>
              )}

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
                  {post.is_liked ? <FaHeart /> : <FaRegHeart />}
                </button>
                <span className="feed-like-count">{formatCount(post.like_count)}</span>
              </div>

              <div className="feed-like-wrapper">
                <button
                  className="feed-post-action-btn"
                  onClick={() => setCommentOpen(true)}
                >
                  <FaCommentDots />
                </button>
                <span className="feed-like-count">{formatCount(post.comment_count)}</span>
              </div>

              <div className="feed-like-wrapper">
                <button
                  className={`feed-post-action-btn ${post.is_reposted ? "reposted" : ""}`}
                  onClick={toggleRepost}
                >
                  <FaRetweet />
                </button>
                <span className="feed-like-count">{formatCount(post.repost_count)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
