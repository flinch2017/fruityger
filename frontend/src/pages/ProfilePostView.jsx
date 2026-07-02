import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { FaChevronLeft, FaChevronRight, FaCommentDots, FaHeart, FaRegHeart, FaRetweet, FaUser, FaVolumeMute, FaVolumeUp } from "react-icons/fa";
import CommentSheet from "../components/CommentSheet";
import "../css/Profile.css";
import "../css/CommentSheet.css";
import { getSafeMediaUrl } from "../utils/mediaUrl";
import { formatCount } from "../utils/countFormatter";
import { getVideoPosterUrl } from "../utils/mediaThumbnail";
import CaptionWithHashtags from "../components/CaptionWithHashtags";
import VerifiedBadge from "../components/VerifiedBadge";

const VALID_PROFILE_TABS = new Set(["general", "posts", "reposts", "tapes"]);

export default function ProfilePostView() {
  const { username, tab = "general", postId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const token = localStorage.getItem("token");
  const initialPosts = Array.isArray(location.state?.profilePosts)
    ? location.state.profilePosts
    : [];

  const [posts, setPosts] = useState(initialPosts);
  const [loading, setLoading] = useState(initialPosts.length === 0);
  const [activeIndexMap, setActiveIndexMap] = useState({});
  const [videoMutedMap, setVideoMutedMap] = useState({});
  const [activeCommentPost, setActiveCommentPost] = useState(null);
  const [likingMap, setLikingMap] = useState({});
  const [repostingMap, setRepostingMap] = useState({});

  const activeTab = VALID_PROFILE_TABS.has(tab) ? tab : "general";

  const isTapePost = (post) =>
    Array.isArray(post?.media) && post.media.some((media) => media.media_type === "video");

  const tabPosts = useMemo(() => {
    if (activeTab === "posts") return posts.filter((post) => post.activity_type !== "repost");
    if (activeTab === "reposts") return posts.filter((post) => post.activity_type === "repost");
    if (activeTab === "tapes") return posts.filter(isTapePost);
    return posts;
  }, [activeTab, posts]);

  useEffect(() => {
    if (tabPosts.length === 0) return;

    const target = tabPosts.find((post) => String(post.post_id) === String(postId));
    if (!target) return;

    window.setTimeout(() => {
      document
        .getElementById(`profile-post-view-${postId}`)
        ?.scrollIntoView({ behavior: "auto", block: "start" });
    }, 80);
  }, [postId, activeTab, tabPosts.length]);

  useEffect(() => {
    if (initialPosts.length > 0) return;

    const fetchProfilePosts = async () => {
      setLoading(true);

      try {
        const params = new URLSearchParams({
          username,
          limit: "100",
          offset: "0",
        });
        const endpoint = token
          ? `http://localhost:5000/api/profile/posts?${params.toString()}`
          : `http://localhost:5000/api/profile/public-posts?${params.toString()}`;
        const res = await fetch(
          endpoint,
          token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to load profile posts");
        setPosts(Array.isArray(data.posts) ? data.posts : []);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    fetchProfilePosts();
  }, [initialPosts.length, token, username]);

  const formatDate = (dateString) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const moveSlide = (targetPostId, direction, mediaLength) => {
    setActiveIndexMap((prev) => {
      const current = prev[targetPostId] || 0;
      let nextIndex = current + direction;
      if (nextIndex < 0) nextIndex = mediaLength - 1;
      if (nextIndex >= mediaLength) nextIndex = 0;
      return { ...prev, [targetPostId]: nextIndex };
    });
  };

  const toggleVideoMuted = (targetPostId, index) => {
    const key = `${targetPostId}-${index}`;
    setVideoMutedMap((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));
  };

  const toggleLike = async (targetPostId) => {
    if (!token || likingMap[targetPostId]) return;
    const currentPost = posts.find((post) => post.post_id === targetPostId);
    if (!currentPost) return;

    const wasLiked = currentPost.is_liked;
    setLikingMap((prev) => ({ ...prev, [targetPostId]: true }));
    setPosts((prev) =>
      prev.map((post) =>
        post.post_id === targetPostId
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
        body: JSON.stringify({ postId: targetPostId }),
      });
      if (!res.ok) throw new Error("Failed to like post");
    } catch (error) {
      console.error(error);
      setPosts((prev) =>
        prev.map((post) => (post.post_id === targetPostId ? currentPost : post))
      );
    } finally {
      setLikingMap((prev) => {
        const next = { ...prev };
        delete next[targetPostId];
        return next;
      });
    }
  };

  const toggleRepost = async (targetPostId) => {
    if (!token || repostingMap[targetPostId]) return;
    const currentPost = posts.find((post) => post.post_id === targetPostId);
    if (!currentPost) return;

    setRepostingMap((prev) => ({ ...prev, [targetPostId]: true }));

    try {
      const res = await fetch("http://localhost:5000/api/reposts/toggle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ postId: targetPostId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to repost post");
      setPosts((prev) =>
        prev.map((post) =>
          post.post_id === targetPostId
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
    } finally {
      setRepostingMap((prev) => {
        const next = { ...prev };
        delete next[targetPostId];
        return next;
      });
    }
  };

  return (
    <div className="profile-page">
      {activeCommentPost && token && (
        <CommentSheet
          postId={activeCommentPost.postId}
          postAuthorId={activeCommentPost.postAuthorId}
          onClose={() => setActiveCommentPost(null)}
        />
      )}

      <div className="profile-posts profile-post-view">
        <div className="profile-content-header">
          <h3>{username}</h3>
          <button
            type="button"
            className="profile-grid-back"
            onClick={() => navigate(`/profile/${username}`)}
          >
            Grid
          </button>
        </div>

        {loading ? (
          <div className="post-loader">Loading post...</div>
        ) : tabPosts.length === 0 ? (
          <p className="no-posts-message">Post not found</p>
        ) : (
          tabPosts.map((post) => {
            const activeIndex = activeIndexMap[post.post_id] || 0;
            const activeMedia = post.media?.[activeIndex];
            const videoKey = `${post.post_id}-${activeIndex}`;

            return (
              <div
                key={`${activeTab}-${post.post_id}`}
                id={`profile-post-view-${post.post_id}`}
                className="post-card fade-in"
              >
                <div className="post-header">
                  <div className="post-user-info">
                    <button
                      type="button"
                      className="post-user-link"
                      onClick={() => navigate(`/profile/${post.username || username}`)}
                    >
                      <div className="post-user-avatar">
                        {post.profile_pic ? (
                          <img src={getSafeMediaUrl(post.profile_pic)} alt="pfp" />
                        ) : (
                          <FaUser />
                        )}
                      </div>
                      <div className="post-user-text">
                        <span className="post-username">
                          <span className="username-with-badge">
                            {post.username || username}
                            <VerifiedBadge verified={post.is_verified} />
                          </span>
                        </span>
                        <span className="post-date">{formatDate(post.date_posted)}</span>
                      </div>
                    </button>
                  </div>
                </div>

                {post.activity_type === "repost" && (
                  <p className="profile-repost-label">Repost</p>
                )}

                {post.caption && (
                  <CaptionWithHashtags className="post-content" text={post.caption} />
                )}

                {post.media?.length > 0 && (
                  <div className="instagram-carousel">
                    {post.media.length > 1 && (
                      <>
                        <button
                          type="button"
                          className="carousel-arrow left"
                          onClick={() => moveSlide(post.post_id, -1, post.media.length)}
                        >
                          <FaChevronLeft />
                        </button>
                        <button
                          type="button"
                          className="carousel-arrow right"
                          onClick={() => moveSlide(post.post_id, 1, post.media.length)}
                        >
                          <FaChevronRight />
                        </button>
                      </>
                    )}

                    <div
                      className="carousel-track"
                      style={{ transform: `translateX(-${activeIndex * 100}%)` }}
                    >
                      {post.media.map((media, index) => (
                        <div className="carousel-item" key={`${post.post_id}-${index}`}>
                          {media.media_type === "video" ? (
                            <video
                              src={getSafeMediaUrl(media.media_url)}
                              poster={getVideoPosterUrl(media) ? getSafeMediaUrl(getVideoPosterUrl(media)) : undefined}
                              playsInline
                              controls
                              muted={videoMutedMap[`${post.post_id}-${index}`] ?? true}
                              className="auto-video"
                            />
                          ) : (
                            <img src={getSafeMediaUrl(media.media_url)} alt="" />
                          )}
                        </div>
                      ))}
                    </div>

                    {activeMedia?.media_type === "video" && (
                      <button
                        type="button"
                        className={`post-video-sound-btn ${(videoMutedMap[videoKey] ?? true) ? "muted" : ""}`}
                        onClick={() => toggleVideoMuted(post.post_id, activeIndex)}
                        aria-label={(videoMutedMap[videoKey] ?? true) ? "Turn on sound" : "Mute video"}
                      >
                        {(videoMutedMap[videoKey] ?? true) ? <FaVolumeMute /> : <FaVolumeUp />}
                      </button>
                    )}
                  </div>
                )}

                <div className="post-footer">
                  <div className="post-actions-left">
                    <div className="like-wrapper">
                      <button
                        type="button"
                        className={`post-action-btn ${post.is_liked ? "liked" : ""}`}
                        onClick={() => toggleLike(post.post_id)}
                      >
                        {post.is_liked ? <FaHeart /> : <FaRegHeart />}
                      </button>
                      <span className="like-count">{formatCount(post.like_count)}</span>
                    </div>
                    <div className="like-wrapper">
                      <button
                        type="button"
                        className="post-action-btn"
                        onClick={() =>
                          token &&
                          setActiveCommentPost({
                            postId: post.post_id,
                            postAuthorId: post.user_id,
                          })
                        }
                      >
                        <FaCommentDots />
                      </button>
                      <span className="like-count">{formatCount(post.comment_count)}</span>
                    </div>
                    <div className="like-wrapper">
                      <button
                        type="button"
                        className={`post-action-btn ${post.is_reposted ? "reposted" : ""}`}
                        onClick={() => toggleRepost(post.post_id)}
                      >
                        <FaRetweet />
                      </button>
                      <span className="like-count">{formatCount(post.repost_count)}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
