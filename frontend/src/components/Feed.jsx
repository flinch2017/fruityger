import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FaChevronLeft, FaChevronRight, FaCommentDots, FaEllipsisV, FaHeart, FaRegHeart, FaRetweet, FaUser, FaVolumeMute, FaVolumeUp } from "react-icons/fa";
import CommentSheet from "./CommentSheet";
import "../css/Feed.css";
import "../css/CommentSheet.css";
import { getSafeMediaUrl } from "../utils/mediaUrl";
import CaptionWithHashtags from "./CaptionWithHashtags";

export default function Feed() {
  const navigate = useNavigate();
  const location = useLocation();
  const loaderRef = useRef(null);
  const videoRefs = useRef({});
  const observerRef = useRef(null);
  const isFetchingRef = useRef(false);
  const pullStartYRef = useRef(0);
  const isPullingRef = useRef(false);
  const dropdownRef = useRef(null);
  const repostDropdownRef = useRef(null);
  const gestureAxisRef = useRef(null);
  const videoTapStartRef = useRef(null);

  const [posts, setPosts] = useState([]);
  const [activeIndexMap, setActiveIndexMap] = useState({});
  const [dragging, setDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [touchStartY, setTouchStartY] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [likingMap, setLikingMap] = useState({});
  const [repostingMap, setRepostingMap] = useState({});
  const [videoMutedMap, setVideoMutedMap] = useState({});
  const [activeCommentPost, setActiveCommentPost] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [activeMenuPostId, setActiveMenuPostId] = useState(null);
  const [activeRepostListPostId, setActiveRepostListPostId] = useState(null);
  const [deleteModal, setDeleteModal] = useState({
    visible: false,
    postId: null,
  });
  const [actionResult, setActionResult] = useState(null);
  const [deletingPost, setDeletingPost] = useState(false);
  const [disappearingPosts, setDisappearingPosts] = useState([]);

  const LIMIT = 5;
  const currentUserId = localStorage.getItem("userId");
  const feedMode = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("mode") === "following" ? "following" : "discover";
  }, [location.search]);

  const mergeUniquePosts = (existingPosts, incomingPosts) => {
    const seen = new Set();
    const merged = [];

    [...existingPosts, ...incomingPosts].forEach((post) => {
      if (!post?.post_id || seen.has(post.post_id)) return;
      seen.add(post.post_id);
      merged.push(post);
    });

    return merged;
  };

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
    const diffWeeks = Math.floor(diffDays / 7);

    if (diffSeconds < 60) return "Just now";
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffWeeks < 4) return `${diffWeeks}w ago`;

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getVideoControlKey = (postId, index) => `${postId}-${index}`;

  const getRelevantReposters = (post) =>
    Array.isArray(post?.reposters) ? post.reposters : [];

  const getFeedRepostLabel = (post) => {
    const reposters = getRelevantReposters(post);
    if (reposters.length === 0) return "";

    const [firstReposter] = reposters;
    if (reposters.length === 1) {
      return `Reposted by @${firstReposter.username}`;
    }

    return `Reposted by @${firstReposter.username} + ${reposters.length - 1} others`;
  };

  const fetchPosts = async ({ initial = false, refresh = false } = {}) => {
    if (isFetchingRef.current) return;

    const token = localStorage.getItem("token");
    if (!token) return;

    isFetchingRef.current = true;
    setLoadingPosts(true);
    if (refresh) setRefreshing(true);

    const currentOffset = initial || refresh ? 0 : offset;

    try {
      const res = await fetch(
        `http://localhost:5000/api/main/feed?limit=${LIMIT}&offset=${currentOffset}&mode=${feedMode}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch feed");
      }

      const nextPosts = data.posts || [];

      if (nextPosts.length === 0) {
        if (initial || refresh) {
          setPosts([]);
        }
        setHasMore(false);
        return;
      }

      if (initial || refresh) {
        setPosts(mergeUniquePosts([], nextPosts));
        setOffset(nextPosts.length);
      } else {
        setPosts((prev) => mergeUniquePosts(prev, nextPosts));
        setOffset((prev) => prev + nextPosts.length);
      }

      setHasMore(true);
      if (nextPosts.length < LIMIT) {
        setHasMore(false);
      }
    } catch (err) {
      console.error(err);
    } finally {
      isFetchingRef.current = false;
      setLoadingPosts(false);
      if (refresh) setRefreshing(false);
    }
  };

  const refreshFeed = async () => {
    setOffset(0);
    setHasMore(true);
    setActiveIndexMap({});
    await fetchPosts({ refresh: true });
  };

  useEffect(() => {
    setPosts([]);
    setOffset(0);
    setHasMore(true);
    fetchPosts({ initial: true });
  }, [feedMode]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest(".feed-post-more-wrapper")) {
        setActiveMenuPostId(null);
      }

      if (!e.target.closest(".feed-repost-banner-wrap")) {
        setActiveRepostListPostId(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const handleExternalRefresh = () => {
      refreshFeed();
    };

    window.addEventListener("fruityger:feed-refresh", handleExternalRefresh);
    return () => {
      window.removeEventListener("fruityger:feed-refresh", handleExternalRefresh);
    };
  }, [offset]);

  useEffect(() => {
    if (!loaderRef.current || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && !loadingPosts) {
          fetchPosts();
        }
      },
      {
        root: null,
        rootMargin: "500px",
        threshold: 0,
      }
    );

    observer.observe(loaderRef.current);

    return () => observer.disconnect();
  }, [hasMore, loadingPosts, offset]);

  useEffect(() => {
    const handleScroll = () => {
      if (!hasMore || loadingPosts) return;

      const scrollPosition = window.innerHeight + window.scrollY;
      const bottomThreshold = document.documentElement.offsetHeight - 400;

      if (scrollPosition >= bottomThreshold) {
        fetchPosts();
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [hasMore, loadingPosts, offset]);

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
  }, [posts, activeIndexMap]);

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

  const handleFeedTouchStart = (e) => {
    if (e.target.closest(".feed-carousel")) return;
    if (window.scrollY > 0 || refreshing || loadingPosts) return;

    pullStartYRef.current = e.touches[0].clientY;
    isPullingRef.current = true;
  };

  const toggleVideoMuted = (postId, index) => {
    const videoKey = getVideoControlKey(postId, index);
    setVideoMutedMap((prev) => {
      const nextMuted = !(prev[videoKey] ?? true);
      const next = { ...prev, [videoKey]: nextMuted };
      const video = videoRefs.current[postId]?.[index];
      if (video) {
        video.muted = nextMuted;
        if (!nextMuted) {
          video.play().catch(() => {});
        }
      }
      return next;
    });
  };

  const handleFeedTouchMove = (e) => {
    if (e.target.closest(".feed-carousel")) return;
    if (!isPullingRef.current || window.scrollY > 0) return;

    const currentY = e.touches[0].clientY;
    const distance = currentY - pullStartYRef.current;

    if (distance <= 0) {
      setPullDistance(0);
      return;
    }

    const nextDistance = Math.min(distance * 0.45, 90);
    setPullDistance(nextDistance);
  };

  const handleFeedTouchEnd = async () => {
    if (!isPullingRef.current) return;

    isPullingRef.current = false;

    if (pullDistance >= 60) {
      setPullDistance(52);
      await refreshFeed();
    }

    setPullDistance(0);
  };

  const toggleLike = async (postId) => {
    const token = localStorage.getItem("token");
    if (!token || likingMap[postId]) return;

    const currentPost = posts.find((post) => post.post_id === postId);
    if (!currentPost) return;

    const wasLiked = currentPost.is_liked;
    setLikingMap((prev) => ({ ...prev, [postId]: true }));

    setPosts((prev) =>
      prev.map((post) =>
        post.post_id === postId
          ? {
              ...post,
              is_liked: !wasLiked,
              like_count: wasLiked
                ? Math.max((post.like_count || 1) - 1, 0)
                : (post.like_count || 0) + 1,
            }
          : post
      )
    );

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
      setPosts((prev) =>
        prev.map((post) =>
          post.post_id === postId
            ? {
                ...post,
                is_liked: wasLiked,
                like_count: currentPost.like_count,
              }
            : post
        )
      );
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

  const toggleRepostList = (postId) => {
    setActiveRepostListPostId((prev) => (prev === postId ? null : postId));
  };

  const toggleRepost = async (postId) => {
    const token = localStorage.getItem("token");
    if (!token || repostingMap[postId]) return;

    const currentPost = posts.find((post) => post.post_id === postId);
    if (!currentPost) return;

    const wasReposted = currentPost.is_reposted;
    const previousCount = currentPost.repost_count || 0;

    setRepostingMap((prev) => ({ ...prev, [postId]: true }));
    setPosts((prev) =>
      prev.map((post) =>
        post.post_id === postId
          ? {
              ...post,
              is_reposted: !wasReposted,
              repost_count: wasReposted ? Math.max(previousCount - 1, 0) : previousCount + 1,
            }
          : post
      )
    );

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

      setPosts((prev) =>
        prev.map((post) =>
          post.post_id === postId
            ? {
                ...post,
                is_reposted: data.reposted,
                repost_count: data.repost_count ?? post.repost_count,
              }
            : post
        )
      );
    } catch (err) {
      console.error(err);
      setPosts((prev) =>
        prev.map((post) =>
          post.post_id === postId
            ? {
                ...post,
                is_reposted: wasReposted,
                repost_count: previousCount,
              }
            : post
        )
      );
      setActionResult({ type: "error", message: err.message || "Failed to repost post!" });
      setTimeout(() => setActionResult(null), 3000);
    } finally {
      setRepostingMap((prev) => {
        const updated = { ...prev };
        delete updated[postId];
        return updated;
      });
    }
  };

  const promptDeletePost = (postId) => {
    setActiveMenuPostId(null);
    setDeleteModal({ visible: true, postId });
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
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!res.ok) throw new Error("Delete failed");

      setDisappearingPosts((prev) => [...prev, deleteModal.postId]);

      setTimeout(() => {
        setPosts((prev) =>
          prev.filter((post) => post.post_id !== deleteModal.postId)
        );
        setDisappearingPosts((prev) =>
          prev.filter((postId) => postId !== deleteModal.postId)
        );
      }, 300);

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

  const handleCancelDelete = () => {
    if (!deletingPost) {
      setDeleteModal({ visible: false, postId: null });
    }
  };

  const handleEditPost = (post) => {
    setActiveMenuPostId(null);
    navigate(`/edit-post/${post.post_id}`, {
      state: { post },
    });
  };

  const handleReportPost = (postId) => {
    setActiveMenuPostId(null);
    navigate(`/report?type=post&id=${postId}`);
  };

  const handleOpenTapeFeed = (post) => {
    if (!post?.post_id) return;
    const params = new URLSearchParams();
    params.set("mode", feedMode);
    params.set("start", post.post_id);
    navigate(`/tapes?${params.toString()}`, {
      state: { seedTape: post },
    });
  };

  const handleVideoTapStart = (event) => {
    const point = event.touches?.[0] || event;
    videoTapStartRef.current = {
      x: point.clientX,
      y: point.clientY,
      time: Date.now(),
    };
  };

  const handleVideoTapEnd = (event, post) => {
    const start = videoTapStartRef.current;
    videoTapStartRef.current = null;
    if (!start) return;

    const point = event.changedTouches?.[0] || event;
    const dx = Math.abs(point.clientX - start.x);
    const dy = Math.abs(point.clientY - start.y);
    const elapsed = Date.now() - start.time;

    if (dx > 10 || dy > 10 || elapsed > 450) return;
    handleOpenTapeFeed(post);
  };

  return (
    <main className="feed-page">
      {deleteModal.visible && (
        <div className="feed-modal-overlay">
          <div className={`feed-modal-card ${deletingPost ? "loading" : "animate-in"}`}>
            <h3>Confirm Delete</h3>
            <p>Are you sure you want to delete this post?</p>

            {deletingPost && <div className="feed-spinner"></div>}

            {!deletingPost && (
              <div className="feed-modal-actions">
                <button className="feed-modal-btn cancel" onClick={handleCancelDelete}>
                  Cancel
                </button>
                <button className="feed-modal-btn confirm" onClick={handleConfirmDelete}>
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {actionResult && (
        <div className={`feed-toast ${actionResult.type}`}>
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

      <div
        className="feed"
        onTouchStart={handleFeedTouchStart}
        onTouchMove={handleFeedTouchMove}
        onTouchEnd={handleFeedTouchEnd}
      >
        <div
          className={`feed-pull-indicator ${
            pullDistance > 0 || refreshing ? "visible" : ""
          }`}
          style={{
            height: `${refreshing ? 52 : pullDistance}px`,
          }}
        >
          <span>
            {refreshing
              ? "Refreshing..."
              : pullDistance >= 60
                ? "Release to refresh"
                : "Pull to refresh"}
          </span>
        </div>

        {posts.length === 0 && !loadingPosts && (
          <div className="feed-empty-state">
            <div className="feed-empty-orb-wrap">
              <div className="feed-empty-orb">
                <div className="feed-empty-orb-highlight"></div>
                <div className="feed-empty-face">
                  <span className="feed-empty-eye left"></span>
                  <span className="feed-empty-eye right"></span>
                  <span className="feed-empty-smile"></span>
                </div>
                <div className="feed-empty-wing left"></div>
                <div className="feed-empty-wing right"></div>
                <div className="feed-empty-shadow"></div>
              </div>
            </div>

            <div className="feed-empty-text">
              <h3>It&apos;s a little quiet here</h3>
              <p>
                {feedMode === "following"
                  ? "Follow more fruity people and their posts will start drifting in here."
                  : "Your discover feed is still empty right now. Come back soon for fresh posts drifting in."}
              </p>
            </div>
          </div>
        )}

        {posts.map((post) => (
          <div
            key={post.post_id}
            className={`feed-post-card ${
              disappearingPosts.includes(post.post_id) ? "feed-fade-out" : "feed-fade-in"
            }`}
          >
            <div
              className="feed-post-more-wrapper"
              ref={activeMenuPostId === post.post_id ? dropdownRef : null}
            >
              <div
                className="feed-post-more"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleMenu(post.post_id);
                }}
              >
                <FaEllipsisV />
              </div>

              {activeMenuPostId === post.post_id && (
                <div className="feed-post-dropdown">
                  {String(post.user_id) === String(currentUserId) ? (
                    <>
                      <div
                        className="feed-dropdown-item edit"
                        onClick={() => handleEditPost(post)}
                      >
                        Edit
                      </div>

                      <div
                        className="feed-dropdown-item delete"
                        onClick={() => promptDeletePost(post.post_id)}
                      >
                        Delete
                      </div>
                    </>
                  ) : (
                    <div
                      className="feed-dropdown-item report"
                      onClick={() => handleReportPost(post.post_id)}
                    >
                      Report
                    </div>
                  )}
                </div>
              )}
            </div>

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
                    {post.username}
                  </span>
                  <span className="feed-post-date">{formatDate(post.date_posted)}</span>
                </div>
              </div>
            </div>

            {post.feed_activity_type === "repost" && getRelevantReposters(post).length > 0 && (
              <div
                className="feed-repost-banner-wrap"
                ref={activeRepostListPostId === post.post_id ? repostDropdownRef : null}
              >
                <button
                  type="button"
                  className="feed-repost-banner"
                  onClick={() => toggleRepostList(post.post_id)}
                >
                  {getFeedRepostLabel(post)}
                </button>

                {activeRepostListPostId === post.post_id && (
                  <div className="feed-repost-dropdown">
                    <div className="feed-repost-dropdown-title">Reposted by</div>
                    {getRelevantReposters(post).map((reposter) => (
                      <button
                        key={`${post.post_id}-${reposter.user_id}`}
                        type="button"
                        className="feed-repost-dropdown-item"
                        onClick={() => {
                          setActiveRepostListPostId(null);
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
                          <strong>@{reposter.username}</strong>
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
                    <button
                      className="feed-carousel-arrow left"
                      onClick={() => moveSlide(post.post_id, -1, post.media.length)}
                    >
                      <FaChevronLeft />
                    </button>

                    <button
                      className="feed-carousel-arrow right"
                      onClick={() => moveSlide(post.post_id, 1, post.media.length)}
                    >
                      <FaChevronRight />
                    </button>
                  </>
                )}

                <div
                  className="feed-carousel-track"
                  style={{
                    transform: `translateX(-${(activeIndexMap[post.post_id] || 0) * 100}%)`,
                  }}
                  onMouseDown={handlePointerStart}
                  onMouseMove={(e) => handlePointerMove(e, post.post_id, post.media.length)}
                  onMouseUp={handlePointerEnd}
                  onMouseLeave={handlePointerEnd}
                  onTouchStart={handlePointerStart}
                  onTouchMove={(e) => handlePointerMove(e, post.post_id, post.media.length)}
                  onTouchEnd={handlePointerEnd}
                >
                  {post.media.map((media, index) => (
                    <div className="feed-carousel-item" key={index}>
                      {media.media_type === "video" ? (
                        <>
                          <video
                            ref={(el) => {
                              if (!el) return;
                              if (!videoRefs.current[post.post_id]) {
                                videoRefs.current[post.post_id] = [];
                              }
                              videoRefs.current[post.post_id][index] = el;
                              el.muted = videoMutedMap[getVideoControlKey(post.post_id, index)] ?? true;
                            }}
                            src={getSafeMediaUrl(media.media_url)}
                            playsInline
                            loop
                            muted={videoMutedMap[getVideoControlKey(post.post_id, index)] ?? true}
                            preload="metadata"
                            className="feed-auto-video"
                            onMouseDown={handleVideoTapStart}
                            onMouseUp={(event) => handleVideoTapEnd(event, post)}
                            onTouchStart={handleVideoTapStart}
                            onTouchEnd={(event) => handleVideoTapEnd(event, post)}
                          />
                        </>
                      ) : (
                        <img src={getSafeMediaUrl(media.media_url)} alt="" />
                      )}
                    </div>
                  ))}
                </div>

                {post.media[(activeIndexMap[post.post_id] || 0)]?.media_type === "video" && (
                  <button
                    type="button"
                    className={`post-video-sound-btn ${
                      (videoMutedMap[getVideoControlKey(post.post_id, activeIndexMap[post.post_id] || 0)] ?? true) ? "muted" : ""
                    }`}
                    onClick={() => toggleVideoMuted(post.post_id, activeIndexMap[post.post_id] || 0)}
                    aria-label={(videoMutedMap[getVideoControlKey(post.post_id, activeIndexMap[post.post_id] || 0)] ?? true) ? "Turn on sound" : "Mute video"}
                  >
                    {(videoMutedMap[getVideoControlKey(post.post_id, activeIndexMap[post.post_id] || 0)] ?? true) ? <FaVolumeMute /> : <FaVolumeUp />}
                  </button>
                )}

                {post.media.length > 1 && (
                  <div className="feed-carousel-indicator">
                    {post.media.map((_, index) => (
                      <span
                        key={index}
                        className={
                          (activeIndexMap[post.post_id] || 0) === index
                            ? "feed-indicator-dot active"
                            : "feed-indicator-dot"
                        }
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
                    onClick={() => toggleLike(post.post_id)}
                  >
                    {post.is_liked ? <FaHeart /> : <FaRegHeart />}
                  </button>

                  <span className="feed-like-count">{post.like_count || 0}</span>
                </div>

                <div className="feed-like-wrapper">
                  <button
                    className="feed-post-action-btn"
                    onClick={() =>
                      setActiveCommentPost({
                        postId: post.post_id,
                        postAuthorId: post.user_id,
                      })
                    }
                  >
                    <FaCommentDots />
                  </button>

                  <span className="feed-like-count">{post.comment_count || 0}</span>
                </div>

                <div className="feed-like-wrapper">
                  <button
                    className={`feed-post-action-btn ${post.is_reposted ? "reposted" : ""}`}
                    onClick={() => toggleRepost(post.post_id)}
                  >
                    <FaRetweet />
                  </button>
                  <span className="feed-like-count">{post.repost_count || 0}</span>
                </div>
              </div>
            </div>
          </div>
        ))}

        {hasMore && (
          <div ref={loaderRef} className="feed-post-loader">
            {loadingPosts && <p>Loading more posts...</p>}
          </div>
        )}
      </div>
    </main>
  );
}
