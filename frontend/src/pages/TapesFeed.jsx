import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  FaArrowLeft,
  FaCommentDots,
  FaHeart,
  FaRegHeart,
  FaRetweet,
  FaUser,
} from "react-icons/fa";
import CommentSheet from "../components/CommentSheet";
import "../css/CommentSheet.css";
import "../css/TapesFeed.css";
import { getSafeMediaUrl } from "../utils/mediaUrl";

export default function TapesFeed() {
  const navigate = useNavigate();
  const location = useLocation();
  const feedContainerRef = useRef(null);
  const loaderRef = useRef(null);
  const videoRefs = useRef({});
  const observerRef = useRef(null);
  const isFetchingRef = useRef(false);
  const lastScrollTopRef = useRef(0);

  const [tapes, setTapes] = useState([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingTapes, setLoadingTapes] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [likingMap, setLikingMap] = useState({});
  const [repostingMap, setRepostingMap] = useState({});
  const [activeCommentPost, setActiveCommentPost] = useState(null);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [videoMutedMap, setVideoMutedMap] = useState({});

  const LIMIT = 4;
  const handleExitTapes = () => {
    navigate("/");
  };

  const feedMode = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("mode") === "following" ? "following" : "discover";
  }, [location.search]);

  const mergeUniqueTapes = (existingTapes, incomingTapes) => {
    const seen = new Set();
    const merged = [];

    [...existingTapes, ...incomingTapes].forEach((post) => {
      if (!post?.post_id || seen.has(post.post_id)) return;

      const videoMedia = Array.isArray(post.media)
        ? post.media.find((media) => media.media_type === "video")
        : null;

      if (!videoMedia) return;

      seen.add(post.post_id);
      merged.push({
        ...post,
        primaryVideo: videoMedia,
      });
    });

    return merged;
  };

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

  const fetchTapes = async ({ initial = false, refresh = false } = {}) => {
    if (isFetchingRef.current) return;

    const token = localStorage.getItem("token");
    if (!token) return;

    isFetchingRef.current = true;
    setLoadingTapes(true);
    if (refresh) setRefreshing(true);

    const currentOffset = initial || refresh ? 0 : offset;

    try {
      const res = await fetch(
        `http://localhost:5000/api/main/feed?limit=${LIMIT}&offset=${currentOffset}&mode=${feedMode}&surface=tapes`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch tapes");
      }

      if ((data.posts || []).length === 0) {
        if (initial || refresh) {
          setTapes([]);
        }
        setHasMore(false);
        return;
      }

      if (initial || refresh) {
        setTapes(mergeUniqueTapes([], data.posts || []));
        setOffset((data.posts || []).length);
      } else {
        setTapes((prev) => mergeUniqueTapes(prev, data.posts || []));
        setOffset((prev) => prev + (data.posts || []).length);
      }

      setHasMore((data.posts || []).length >= LIMIT);
    } catch (error) {
      console.error(error);
    } finally {
      isFetchingRef.current = false;
      setLoadingTapes(false);
      if (refresh) setRefreshing(false);
    }
  };

  useEffect(() => {
    setTapes([]);
    setOffset(0);
    setHasMore(true);
    fetchTapes({ initial: true });
  }, [feedMode]);

  useEffect(() => {
    const handleExternalRefresh = () => {
      setOffset(0);
      setHasMore(true);
      fetchTapes({ refresh: true });
    };

    window.addEventListener("fruityger:feed-refresh", handleExternalRefresh);
    return () => {
      window.removeEventListener("fruityger:feed-refresh", handleExternalRefresh);
    };
  }, [offset, feedMode]);

  useEffect(() => {
    if (!loaderRef.current || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingTapes) {
          fetchTapes();
        }
      },
      { root: null, rootMargin: "600px", threshold: 0 }
    );

    observer.observe(loaderRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadingTapes, offset]);

  useEffect(() => {
    const feedElement = feedContainerRef.current;
    if (!feedElement) return undefined;

    const handleScroll = () => {
      const currentTop = feedElement.scrollTop;
      const previousTop = lastScrollTopRef.current;

      if (currentTop <= 24) {
        setChromeHidden(false);
      } else if (currentTop > previousTop + 10) {
        setChromeHidden(true);
      } else if (currentTop < previousTop - 10) {
        setChromeHidden(false);
      }

      lastScrollTopRef.current = currentTop;
    };

    feedElement.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      feedElement.removeEventListener("scroll", handleScroll);
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
            const tryPlay = async () => {
              try {
                await video.play();
              } catch {
                video.muted = true;
                await video.play().catch(() => {});
              }
            };
            tryPlay();
          } else {
            video.pause();
          }
        });
      },
      {
        threshold: 0.72,
      }
    );

    Object.values(videoRefs.current).forEach((video) => {
      if (video) observerRef.current.observe(video);
    });

    return () => observerRef.current?.disconnect();
  }, [tapes]);

  const toggleLike = async (postId) => {
    const token = localStorage.getItem("token");
    if (!token || likingMap[postId]) return;

    const currentTape = tapes.find((post) => post.post_id === postId);
    if (!currentTape) return;

    const wasLiked = currentTape.is_liked;
    setLikingMap((prev) => ({ ...prev, [postId]: true }));
    setTapes((prev) =>
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
        throw new Error("Failed to like tape");
      }
    } catch (error) {
      console.error(error);
      setTapes((prev) =>
        prev.map((post) =>
          post.post_id === postId
            ? {
                ...post,
                is_liked: wasLiked,
                like_count: currentTape.like_count,
              }
            : post
        )
      );
    } finally {
      setLikingMap((prev) => {
        const next = { ...prev };
        delete next[postId];
        return next;
      });
    }
  };

  const toggleRepost = async (postId) => {
    const token = localStorage.getItem("token");
    if (!token || repostingMap[postId]) return;

    const currentTape = tapes.find((post) => post.post_id === postId);
    if (!currentTape) return;

    const wasReposted = currentTape.is_reposted;
    const previousCount = currentTape.repost_count || 0;

    setRepostingMap((prev) => ({ ...prev, [postId]: true }));
    setTapes((prev) =>
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
        throw new Error(data.error || "Failed to repost tape");
      }

      setTapes((prev) =>
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
    } catch (error) {
      console.error(error);
      setTapes((prev) =>
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
    } finally {
      setRepostingMap((prev) => {
        const next = { ...prev };
        delete next[postId];
        return next;
      });
    }
  };

  const toggleVideoMute = (postId) => {
    setVideoMutedMap((prev) => {
      const nextMuted = !(prev[postId] ?? true);
      const video = videoRefs.current[postId];
      if (video) {
        video.muted = nextMuted;
      }
      return {
        ...prev,
        [postId]: nextMuted,
      };
    });
  };

  return (
    <main ref={feedContainerRef} className="tapes-feed-page">
      {activeCommentPost && (
        <CommentSheet
          postId={activeCommentPost.postId}
          postAuthorId={activeCommentPost.postAuthorId}
          onClose={() => setActiveCommentPost(null)}
        />
      )}

      <button
        type="button"
        className="tapes-back-btn"
        onClick={handleExitTapes}
        aria-label="Exit tapes feed"
      >
        <FaArrowLeft />
      </button>

      <div className={`tapes-top-chrome ${chromeHidden ? "hidden" : ""}`}>
        <div className="tapes-mode-tabs" role="tablist" aria-label="Tape feed mode">
          <button
            type="button"
            role="tab"
            aria-selected={feedMode === "discover"}
            className={`tapes-mode-tab ${feedMode === "discover" ? "active" : ""}`}
            onClick={() => navigate("/tapes?mode=discover")}
          >
            Discover
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={feedMode === "following"}
            className={`tapes-mode-tab ${feedMode === "following" ? "active" : ""}`}
            onClick={() => navigate("/tapes?mode=following")}
          >
            Following
          </button>
        </div>
      </div>

      <div className="tapes-feed-shell">
        {refreshing && <div className="tapes-refresh-banner">Refreshing tapes...</div>}

        {tapes.length === 0 && !loadingTapes && (
          <div className="tapes-empty-state">
            <div className="tapes-empty-orb"></div>
            <h2>No tapes yet</h2>
            <p>
              {feedMode === "following"
                ? "Follow more people and their tapes will start rolling in here."
                : "The tapes lane is quiet right now. Publish one or check back soon."}
            </p>
          </div>
        )}

        {tapes.map((tape) => (
          <section key={tape.post_id} className="tape-slide">
            <div className="tape-stage">
              <div className="tape-video-frame">
                <video
                  ref={(element) => {
                    if (!element) return;
                    videoRefs.current[tape.post_id] = element;
                    element.muted = videoMutedMap[tape.post_id] ?? true;
                  }}
                  className="tape-video"
                  src={getSafeMediaUrl(tape.primaryVideo.media_url)}
                  loop
                  playsInline
                  autoPlay
                  muted={videoMutedMap[tape.post_id] ?? true}
                  preload="auto"
                />
                <div className="tape-gradient"></div>
                {(videoMutedMap[tape.post_id] ?? true) && (
                  <button
                    type="button"
                    className="tape-unmute-overlay"
                    onClick={() => toggleVideoMute(tape.post_id)}
                  >
                    Tap to unmute
                  </button>
                )}

                <div className="tape-meta">
                  <button
                    type="button"
                    className="tape-author"
                    onClick={() => navigate(`/profile/${tape.username}`)}
                  >
                    <span className="tape-author-avatar">
                      {tape.profile_pic ? (
                        <img src={getSafeMediaUrl(tape.profile_pic)} alt={tape.username} />
                      ) : (
                        <FaUser />
                      )}
                    </span>
                    <span className="tape-author-copy">
                      <strong>@{tape.username}</strong>
                      <span>{formatDate(tape.date_posted)}</span>
                    </span>
                  </button>

                  {tape.caption && <p className="tape-caption">{tape.caption}</p>}
                </div>

                <div className="tape-actions">
                  <button
                    type="button"
                    className={`tape-action-btn ${(videoMutedMap[tape.post_id] ?? true) ? "" : "active"}`}
                    onClick={() => toggleVideoMute(tape.post_id)}
                  >
                    <span>{(videoMutedMap[tape.post_id] ?? true) ? "Unmute" : "Mute"}</span>
                  </button>

                  <button
                    type="button"
                    className={`tape-action-btn ${tape.is_liked ? "liked" : ""}`}
                    onClick={() => toggleLike(tape.post_id)}
                  >
                    {tape.is_liked ? <FaHeart /> : <FaRegHeart />}
                    <span>{tape.like_count || 0}</span>
                  </button>

                  <button
                    type="button"
                    className="tape-action-btn"
                    onClick={() =>
                      setActiveCommentPost({
                        postId: tape.post_id,
                        postAuthorId: tape.user_id,
                      })
                    }
                  >
                    <FaCommentDots />
                    <span>{tape.comment_count || 0}</span>
                  </button>

                  <button
                    type="button"
                    className={`tape-action-btn ${tape.is_reposted ? "reposted" : ""}`}
                    onClick={() => toggleRepost(tape.post_id)}
                  >
                    <FaRetweet />
                    <span>{tape.repost_count || 0}</span>
                  </button>
                </div>
              </div>
            </div>
          </section>
        ))}

        {hasMore && <div ref={loaderRef} className="tapes-loader" aria-hidden="true" />}
      </div>
    </main>
  );
}
