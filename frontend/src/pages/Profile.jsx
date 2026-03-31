import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useParams } from "react-router-dom";
import "../css/Profile.css";
import CommentSheet from "../components/CommentSheet";
import "../css/CommentSheet.css";

export default function Profile() {

  const { username } = useParams();

  const [user, setUser] = useState(null);
  const [posts, setPosts] = useState([]);
  const [activeIndexMap, setActiveIndexMap] = useState({});

  const [dragging, setDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [touchStartY, setTouchStartY] = useState(0);

  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(false);

  const [likingMap, setLikingMap] = useState({});

  const loaderRef = useRef(null);
  const videoRefs = useRef({});
  const observerRef = useRef(null);
  const [activeCommentPost, setActiveCommentPost] = useState(null);

  const [activeMenuPostId, setActiveMenuPostId] = useState(null);
  const dropdownRef = useRef(null);
  const [currentUser, setCurrentUser] = useState(null);
  
  const [deleteModal, setDeleteModal] = useState({
    visible: false,
    postId: null,
  });
  const [actionResult, setActionResult] = useState(null); 
  const [deletingPost, setDeletingPost] = useState(false); 
  const [disappearingPosts, setDisappearingPosts] = useState([]); 
  const [following, setFollowing] = useState(false); // new state
  const [followLoading, setFollowLoading] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef(null);
  const [isBlockedProfile, setIsBlockedProfile] = useState(false);

  const LIMIT = 5;
  const navigate = useNavigate();
  

  /* ================= FETCH DATA ================= */

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
      year: "numeric"
    });
  };

  const handleEditPost = (post) => {
    // Option 1: navigate to edit page
    navigate(`/edit-post/${post.post_id}`, {
      state: { post }
    });

    // Option 2 (later): open modal instead
  };

  const fetchCurrentUser = async () => {
    const token = localStorage.getItem("token");
    if (!token) return;

    try {
      const res = await fetch("http://localhost:5000/api/main/me", {
        headers: { Authorization: `Bearer ${token}` }
      });

      const data = await res.json();

      if (res.ok) setCurrentUser(data.user);

    } catch (err) {
      console.error(err);
    }
  };

  const isOwnProfile = currentUser?.id === user?.id;

  const toggleMenu = (postId) => {
    setActiveMenuPostId(prev => (prev === postId ? null : postId));
  };

  const promptDeletePost = (postId) => {
    setDeleteModal({ visible: true, postId });
  };

  const handleConfirmDelete = async () => {
    const { postId } = deleteModal;
    const token = localStorage.getItem("token");
    if (!token) return;

    setDeletingPost(true); // show spinner

    try {
      const res = await fetch(`http://localhost:5000/api/profile/${postId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) throw new Error("Delete failed");

      // Animate card disappearance
      setDisappearingPosts(prev => [...prev, postId]);

      setTimeout(() => {
        setPosts(prev => prev.filter(p => p.post_id !== postId));
        setDisappearingPosts(prev => prev.filter(id => id !== postId));
      }, 300); // match CSS animation duration

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
    if (!deletingPost) setDeleteModal({ visible: false, postId: null });
  };

  const handleReportPost = (postId) => {
    setActiveMenuPostId(null);
    navigate(`/report?type=post&id=${postId}`);
  };

  const handleBlockUser = async () => {
    const token = localStorage.getItem("token");
    if (!token || !user?.id) return;

    try {
      const endpoint = user?.blocked_by_me
        ? "http://localhost:5000/api/main/unblock-user"
        : "http://localhost:5000/api/main/block-user";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ blockedUserId: user.id }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Failed to ${user?.blocked_by_me ? "unblock" : "block"} user`);
      }

      setProfileMenuOpen(false);
      const nextBlockedByMe = !user?.blocked_by_me;

      setUser(prev => ({
        ...prev,
        blocked_by_me: nextBlockedByMe,
      }));

      const nextBlockedState = nextBlockedByMe || Boolean(user?.blocked_by_them);
      setIsBlockedProfile(nextBlockedState);

      if (nextBlockedState) {
        setPosts([]);
        setOffset(0);
        setHasMore(false);
      } else {
        setOffset(0);
        setHasMore(true);
        fetchPosts(true);
      }
    } catch (err) {
      console.error(err);
      alert(err.message || `Failed to ${user?.blocked_by_me ? "unblock" : "block"} user`);
    }
  };

  const handleReportUser = () => {
    setProfileMenuOpen(false);
    navigate(`/report?type=user&id=${user.id}`);
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target)
      ) {
        setActiveMenuPostId(null);
      }

      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(e.target)
      ) {
        setProfileMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const fetchUser = async () => {
    const token = localStorage.getItem("token");
    if (!token) return;

    try {

      let url = username
      ? `http://localhost:5000/api/main/user/${username}`
      : "http://localhost:5000/api/main/me";

      

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const data = await res.json();

      if (res.ok) {
        setUser(data.user);
        setIsBlockedProfile(Boolean(data.user?.blocked_by_me || data.user?.blocked_by_them));
      }

    } catch (err) {
      console.error(err);
    }
  };

  

  const fetchPosts = async (initial = false) => {

    if (loadingPosts) return;

    setLoadingPosts(true);

    const token = localStorage.getItem("token");
    if (!token) return;

    const currentOffset = initial ? 0 : offset;

    try {

      const profileQuery = username
        ? `&username=${username}`
        : "";

      const res = await fetch(
        `http://localhost:5000/api/profile/posts?limit=${LIMIT}&offset=${currentOffset}${profileQuery}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      const data = await res.json();

      if (res.ok) {
        if (data.isBlocked) {
          setPosts([]);
          setOffset(0);
          setHasMore(false);
          setLoadingPosts(false);
          return;
        }

        if (!data.posts || data.posts.length === 0) {
          setHasMore(false);
          setLoadingPosts(false);
          return;
        }

        if (initial) {
          setPosts(data.posts);
          setOffset(data.posts.length);
        } else {
          setPosts(prev => [...prev, ...data.posts]);
          setOffset(prev => prev + data.posts.length);
        }

      }

    } catch (err) {
      console.error(err);
    }

    setLoadingPosts(false);
  };

  useEffect(() => {
    fetchCurrentUser();
    fetchUser();
    fetchPosts(true);
  }, [username]);

  /* ================= FIXED INFINITE SCROLL ================= */

  useEffect(() => {
    if (!loaderRef.current || !hasMore) return;

    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[0];
        if (entry.isIntersecting && !loadingPosts) {
          fetchPosts();
        }
      },
      {
        root: null,
        rootMargin: "500px",
        threshold: 0
      }
    );

    observer.observe(loaderRef.current);

    return () => observer.disconnect();

  }, [hasMore, loadingPosts, offset]);

  /* ===== MOBILE SAFETY FALLBACK (VERY IMPORTANT) ===== */

  useEffect(() => {
    const handleScroll = () => {
      if (!hasMore || loadingPosts) return;

      const scrollPosition =
        window.innerHeight + window.scrollY;

      const bottomThreshold =
        document.documentElement.offsetHeight - 400;

      if (scrollPosition >= bottomThreshold) {
        fetchPosts();
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);

  }, [hasMore, loadingPosts, offset]);

  /* ================= VIDEO AUTO PLAY OBSERVER ================= */

  useEffect(() => {

    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
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

    Object.values(videoRefs.current).forEach(list => {
      list?.forEach(video => {
        if (video) observerRef.current.observe(video);
      });
    });

    return () => observerRef.current?.disconnect();

  }, [posts, activeIndexMap]);

  /* ================= CAROUSEL CONTROL ================= */

  const moveSlide = (postId, direction, mediaLength) => {
    setActiveIndexMap(prev => {
      const current = prev[postId] || 0;
      let nextIndex = current + direction;

      if (nextIndex < 0) nextIndex = mediaLength - 1;
      if (nextIndex >= mediaLength) nextIndex = 0;

      return { ...prev, [postId]: nextIndex };
    });
  };

  /* ================= SWIPE GESTURE ================= */

  const handlePointerStart = (e) => {
    const touch = e.touches ? e.touches[0] : e;
    setDragging(true);
    setDragStartX(touch.clientX);
    setTouchStartY(touch.clientY);
  };

  const handlePointerMove = (e, postId, mediaLength) => {
    if (!dragging) return;

    const touch = e.touches ? e.touches[0] : e;
    const dx = dragStartX - touch.clientX;
    const dy = touch.clientY - touchStartY;

    if (Math.abs(dy) > Math.abs(dx)) return;

    if (Math.abs(dx) > 80) {
      moveSlide(postId, dx > 0 ? 1 : -1, mediaLength);
      setDragStartX(touch.clientX);
    }
  };

  const handlePointerEnd = () => setDragging(false);

  const toggleLike = async (postId) => {
    const token = localStorage.getItem("token");
    if (!token) return;

    // 🚫 Prevent spam clicking
    if (likingMap[postId]) return;

    const currentPost = posts.find(p => p.post_id === postId);
    if (!currentPost) return;

    const wasLiked = currentPost.is_liked;

    // Mark as processing
    setLikingMap(prev => ({ ...prev, [postId]: true }));

    // ✨ Optimistic UI update
    setPosts(prev =>
      prev.map(post =>
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
    );

    try {
      const res = await fetch(
        "http://localhost:5000/api/likes/toggle",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ postId })
        }
      );

      if (!res.ok) {
        throw new Error("Failed");
      }

    } catch (err) {
      console.error(err);

      // 🔄 Revert on failure
      setPosts(prev =>
        prev.map(post =>
          post.post_id === postId
            ? {
                ...post,
                is_liked: wasLiked,
                like_count: currentPost.like_count
              }
            : post
        )
      );
    } finally {
      // ✅ Unlock button
      setLikingMap(prev => {
        const updated = { ...prev };
        delete updated[postId];
        return updated;
      });
    }
  };


  // Check if current user follows this profile
  const fetchFollowingStatus = async () => {
    if (isOwnProfile) return; // no need

    const token = localStorage.getItem("token");
    if (!token) return;

    try {
      const res = await fetch(
        `http://localhost:5000/api/follow/status?username=${username}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (res.ok) setFollowing(data.following);
    } catch (err) {
      console.error(err);
    }
  };

  // Call it when user or username changes
  useEffect(() => {
    if (user && !isOwnProfile) {
      fetchFollowingStatus();
    }
  }, [user, isOwnProfile]);

  // Follow / Unfollow action
  const toggleFollow = async () => {
    const token = localStorage.getItem("token");
    if (!token) return;

    setFollowLoading(true);

    try {
      const res = await fetch(
        `http://localhost:5000/api/follow/toggle`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ username })
        }
      );

      if (!res.ok) throw new Error("Failed");

      // ✅ Optimistic UI: toggle state and update followers count
      setFollowing(prev => !prev);
      setUser(prev => ({
        ...prev,
        followers_count: prev.followers_count + (following ? -1 : 1)
      }));
    } catch (err) {
      console.error(err);
      alert("Failed to update follow status");
    } finally {
      setFollowLoading(false);
    }
  };

  /* ================= RENDER ================= */

  if (!user) {
    return (
      <div className="profile-loading">
        <div className="profile-spinner"></div>
        <p>Loading profile...</p>
      </div>
    );
  }

  
  return (
    <div className="profile-page">

      {/* ===== DELETE CONFIRM MODAL ===== */}
      {deleteModal.visible && (
        <div className="modal-overlay">
          <div className={`modal-card ${deletingPost ? "loading" : "animate-in"}`}>
            <h3>Confirm Delete</h3>
            <p>Are you sure you want to delete this post?</p>

            {deletingPost && (
              <div className="spinner"></div>
            )}

            {!deletingPost && (
              <div className="modal-actions">
                <button className="modal-btn cancel" onClick={handleCancelDelete}>Cancel</button>
                <button className="modal-btn confirm" onClick={handleConfirmDelete}>Delete</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== ACTION RESULT TOAST ===== */}
      {actionResult && (
        <div className={`toast ${actionResult.type}`}>
          {actionResult.message}
        </div>
      )}

      {activeCommentPost && (
        <CommentSheet
          postId={activeCommentPost}
          user={user}

          // ✅ Add this (VERY IMPORTANT)
          postAuthorId={user?.id}

          onClose={() => setActiveCommentPost(null)}
        />
      )}


      <div className="profile-card">
        {!isOwnProfile && (
          <div className="profile-card-menu-wrap" ref={profileMenuRef}>
            <button
              className="profile-card-menu-btn"
              onClick={() => setProfileMenuOpen(prev => !prev)}
            >
              ⋯
            </button>

            {profileMenuOpen && (
              <div className="profile-card-dropdown">
                <button className="profile-card-dropdown-item danger" onClick={handleBlockUser}>
                  {user?.blocked_by_me ? "Unblock this user" : "Block this user"}
                </button>
                <button className="profile-card-dropdown-item danger" onClick={handleReportUser}>
                  Report
                </button>
              </div>
            )}
          </div>
        )}

        <div className="profile-info">
          <div className="profile-avatar">
            {user.profile_pic ?
              <img src={user.profile_pic} alt="Avatar" />
              : "👤"}
          </div>

          <h2>{user.username}</h2>
          {user.bio ? (
            <p className="profile-bio">{user.bio}</p>
          ) : isOwnProfile ? (
            <p className="profile-bio profile-bio-empty">
              Add a bio to tell people a little about you.
            </p>
          ) : null}

          <div className="profile-actions">
            {isOwnProfile ? (
              <button
                className="profile-btn edit-btn"
                onClick={() => navigate("/edit-profile")}
              >
                Edit Profile
              </button>
            ) : !isBlockedProfile ? (
              <button
                className="profile-btn follow-btn"
                onClick={toggleFollow}
                disabled={followLoading} // disable while loading
              >
                {followLoading ? (
                  <div className="button-spinner"></div>
                ) : (
                  following ? "Unfollow" : "Follow"
                )}
              </button>
            ) : user?.blocked_by_me ? (
              <button
                className="profile-btn follow-btn"
                onClick={handleBlockUser}
              >
                Unblock
              </button>
            ) : null}

            {!(isBlockedProfile && !user?.blocked_by_me) && (
              <button className="profile-btn share-btn">
                Share Profile
              </button>
            )}
          </div>

          <div className="profile-stats">
            <div className="stat">
              <span
                className="stat-number stat-clickable"
                onClick={() => navigate(`/profile/${user.username}/followers`)}
              >
                {user.followers_count || 0}
              </span>
              <span className="stat-label">Followers</span>
            </div>

            <div className="stat">
              <span
                className="stat-number stat-clickable"
                onClick={() => navigate(`/profile/${user.username}/following`)}
              >
                {user.following_count || 0}
              </span>
              <span className="stat-label">Following</span>
            </div>
          </div>
        </div>
      </div>

      <div className="profile-posts">
        <h3>Posts</h3>

        {isBlockedProfile && !isOwnProfile ? (
          <p className="no-posts-message">
            {user?.blocked_by_me
              ? "You blocked this user, so their posts are hidden."
              : "You can't view this user's posts."}
          </p>
        ) : posts.length === 0 && !loadingPosts && (
          <p className="no-posts-message">No posts yet</p>
        )}

        {!isBlockedProfile && posts.map(post => (
          <div
            key={post.post_id}
            className={`post-card ${disappearingPosts.includes(post.post_id) ? "fade-out" : "fade-in"}`}
          >
            {/* ===== MORE OPTIONS (TOP RIGHT) ===== */}
            <div
              className="post-more-wrapper"
              ref={activeMenuPostId === post.post_id ? dropdownRef : null}
            >

            <div
              className="post-more"
              onClick={(e) => {
                e.stopPropagation();
                toggleMenu(post.post_id);
              }}
            >
              ⋮
            </div>

            {activeMenuPostId === post.post_id && (
              <div className="post-dropdown">

                {/* ✅ YOUR PROFILE ONLY */}
                {isOwnProfile && (
                  <>
                    <div
                      className="dropdown-item edit"
                      onClick={() => handleEditPost(post)}
                    >
                    Edit
                    </div>

                    <div
                      className="dropdown-item delete"
                      onClick={() => promptDeletePost(post.post_id)}
                    >
                      Delete
                    </div>
                  </>
                )}

                {/* ✅ OTHER PEOPLE'S PROFILE */}
                {!isOwnProfile && (
                  <div
                    className="dropdown-item report"
                    onClick={() => handleReportPost(post.post_id)}
                  >
                  Report
                  </div>
                )}

              </div>
            )}

          </div>

            <div className="post-header">
              <div className="post-user-info">
                <div className="post-user-avatar">
                  {user.profile_pic ? (
                    <img src={user.profile_pic} alt="pfp" />
                  ) : "👤"}
                </div>

                <div className="post-user-text">
                  <span className="post-username">
                    {user.username}
                  </span>
                  <span className="post-date">
                    {formatDate(post.date_posted)}
                  </span>
                </div>
              </div>
            </div>

            {post.caption && (
              <p className="post-content">{post.caption}</p>
            )}

            {/* ===== CAROUSEL ===== */}
            {post.media?.length > 0 && (
              <div className="instagram-carousel">
                {post.media.length > 1 && (
                  <>
                    <button
                      className="carousel-arrow left"
                      onClick={() =>
                        moveSlide(post.post_id, -1, post.media.length)
                      }
                    >‹</button>

                    <button
                      className="carousel-arrow right"
                      onClick={() =>
                        moveSlide(post.post_id, 1, post.media.length)
                      }
                    >›</button>
                  </>
                )}

                <div
                  className="carousel-track"
                  style={{
                    transform: `translateX(-${
                      (activeIndexMap[post.post_id] || 0) * 100
                    }%)`
                  }}
                  onMouseDown={handlePointerStart}
                  onMouseMove={(e) =>
                    handlePointerMove(e, post.post_id, post.media.length)
                  }
                  onMouseUp={handlePointerEnd}
                  onMouseLeave={handlePointerEnd}
                  onTouchStart={handlePointerStart}
                  onTouchMove={(e) =>
                    handlePointerMove(e, post.post_id, post.media.length)
                  }
                  onTouchEnd={handlePointerEnd}
                >
                  {post.media.map((m, i) => (
                    <div className="carousel-item" key={i}>
                      {m.media_type === "video" ? (
                        <video
                          ref={el => {
                            if (!el) return;
                            if (!videoRefs.current[post.post_id]) {
                              videoRefs.current[post.post_id] = [];
                            }
                            videoRefs.current[post.post_id][i] = el;
                          }}
                          src={m.media_url}
                          playsInline
                          loop
                          preload="metadata"
                          className="auto-video"
                        />
                      ) : (
                        <img src={m.media_url} alt="" />
                      )}
                    </div>
                  ))}
                </div>

                {post.media.length > 1 && (
                  <div className="carousel-indicator">
                    {post.media.map((_, i) => (
                      <span
                        key={i}
                        className={
                          (activeIndexMap[post.post_id] || 0) === i
                            ? "indicator-dot active"
                            : "indicator-dot"
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ===== POST FOOTER ACTIONS ===== */}
            <div className="post-footer">

              <div className="post-actions-left">
                <div className="like-wrapper">

                  <button
                    className={`post-action-btn ${post.is_liked ? "liked" : ""}`}
                    onClick={() => toggleLike(post.post_id)}
                  >
                    ❤️
                  </button>

                  <span className="like-count">
                    {post.like_count || 0}
                  </span>

                </div>

                <div className="like-wrapper">

                  <button
                    className="post-action-btn"
                    onClick={() => setActiveCommentPost(post.post_id)}
                  >
                    💬
                  </button>

                  <span className="like-count">
                    {post.comment_count || 0}
                  </span>

                </div>

                <button className="post-action-btn">
                  🔗
                </button>
              </div>

            </div>
          </div>
        ))}

        {hasMore && (
          <div ref={loaderRef} className="post-loader">
            {loadingPosts && <p>Loading more posts...</p>}
          </div>
        )}

      </div>
    </div>
  );
}
