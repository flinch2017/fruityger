import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useParams } from "react-router-dom";
import { FaChevronLeft, FaChevronRight, FaCommentDots, FaEllipsisV, FaHeart, FaRegHeart, FaRetweet, FaTimes, FaUser, FaVolumeMute, FaVolumeUp } from "react-icons/fa";
import AeroNotice from "../components/AeroNotice";
import "../css/Profile.css";
import CommentSheet from "../components/CommentSheet";
import "../css/CommentSheet.css";
import { getSafeMediaUrl } from "../utils/mediaUrl";
import { formatCount } from "../utils/countFormatter";
import CaptionWithHashtags from "../components/CaptionWithHashtags";
import VerifiedBadge from "../components/VerifiedBadge";

export default function Profile() {

  const { username } = useParams();
  const token = localStorage.getItem("token");

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
  const [repostingMap, setRepostingMap] = useState({});
  const [videoMutedMap, setVideoMutedMap] = useState({});

  const loaderRef = useRef(null);
  const videoRefs = useRef({});
  const observerRef = useRef(null);
  const gestureAxisRef = useRef(null);
  const videoTapStartRef = useRef(null);
  const profileVideoWatchStateRef = useRef({});
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
  const [followRequested, setFollowRequested] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef(null);
  const [isBlockedProfile, setIsBlockedProfile] = useState(false);
  const [guestPromptOpen, setGuestPromptOpen] = useState(false);
  const [avatarViewerOpen, setAvatarViewerOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  const [privatePostsHidden, setPrivatePostsHidden] = useState(false);

  const LIMIT = 5;
  const navigate = useNavigate();

  const goToProfile = (targetUsername) => {
    if (!targetUsername) return;
    window.scrollTo({ top: 0, behavior: "smooth" });
    navigate(`/profile/${targetUsername}`);
  };
  

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

  const openGuestPrompt = () => {
    setGuestPromptOpen(true);
    setProfileMenuOpen(false);
    setActiveMenuPostId(null);
  };

  const fetchCurrentUser = async () => {
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
    if (!token) {
      openGuestPrompt();
      return;
    }

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
      setNotice({
        type: "error",
        message: err.message || `Failed to ${user?.blocked_by_me ? "unblock" : "block"} user.`,
      });
    }
  };

  const handleReportUser = () => {
    if (!token) {
      openGuestPrompt();
      return;
    }

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
    try {
      const url = token
        ? username
          ? `http://localhost:5000/api/main/user/${username}`
          : "http://localhost:5000/api/main/me"
        : `http://localhost:5000/api/main/public/user/${username}`;

      const res = await fetch(
        url,
        token
          ? {
              headers: { Authorization: `Bearer ${token}` }
            }
          : undefined
      );

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

    const currentOffset = initial ? 0 : offset;

    try {
      const profileQuery = username ? `username=${username}` : "";
      const baseUrl = token
        ? "http://localhost:5000/api/profile/posts"
        : "http://localhost:5000/api/profile/public-posts";
      const res = await fetch(
        `${baseUrl}?limit=${LIMIT}&offset=${currentOffset}${profileQuery ? `&${profileQuery}` : ""}`,
        token
          ? {
              headers: {
                Authorization: `Bearer ${token}`
              }
            }
          : undefined
      );

      const data = await res.json();

      if (res.ok) {
        setPrivatePostsHidden(Boolean(data.isPrivate && data.canViewPrivateProfile === false));

        if (data.isBlocked) {
          setPosts([]);
          setOffset(0);
          setHasMore(false);
          setLoadingPosts(false);
          return;
        }

        if (data.isPrivate && data.canViewPrivateProfile === false) {
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
    window.scrollTo({ top: 0, behavior: "auto" });
    setPosts([]);
    setOffset(0);
    setHasMore(true);
    setActiveIndexMap({});
    setActiveMenuPostId(null);
    setActiveCommentPost(null);
    setFollowRequested(false);
    setPrivatePostsHidden(false);
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

  const getVideoControlKey = (postId, index) => `${postId}-${index}`;

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

  const tryAutoplayProfileVideo = (video) => {
    if (!video) return;

    const rect = video.getBoundingClientRect();
    const viewportHeight =
      window.innerHeight || document.documentElement.clientHeight || 0;
    const visibleHeight =
      Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
    const visibilityRatio =
      rect.height > 0 ? Math.max(0, visibleHeight) / rect.height : 0;

    if (visibilityRatio >= 0.75) {
      video.play().catch(() => {});
    }
  };

  /* ================= SWIPE GESTURE ================= */

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

  const handleOpenTapeFeed = (post) => {
    if (!post?.post_id) return;
    const params = new URLSearchParams();
    params.set("mode", "discover");
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

  const getProfileVideoWatchKey = (postId, mediaIndex) => `${postId}-${mediaIndex}`;

  const recordProfileVideoCompletedView = async (postId) => {
    const authToken = localStorage.getItem("token");
    if (!authToken || !postId) return;

    try {
      const res = await fetch("http://localhost:5000/api/main/tapes/view", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ postId }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to record tape view");
      }

      if (typeof data.view_count === "number") {
        setPosts((prev) =>
          prev.map((post) =>
            post.post_id === postId
              ? {
                  ...post,
                  view_count: data.view_count,
                }
              : post
          )
        );
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleProfileVideoPlay = (postId, mediaIndex, event) => {
    const video = event?.currentTarget;
    if (!video) return;
    const key = getProfileVideoWatchKey(postId, mediaIndex);
    const state = profileVideoWatchStateRef.current[key] || {
      startedFromBeginning: false,
      completionSent: false,
      startTimestampMs: 0,
      completedCount: 0,
      manualReplayArmed: false,
    };

    const isNearStart = video.currentTime <= 0.35;
    const canStartCycle = state.completedCount === 0 || state.manualReplayArmed;
    if (isNearStart && canStartCycle) {
      state.startedFromBeginning = true;
      state.completionSent = false;
      state.startTimestampMs = Date.now();
      if (state.completedCount > 0) {
        state.manualReplayArmed = false;
      }
      profileVideoWatchStateRef.current[key] = state;
    }
  };

  const handleProfileVideoProgress = (postId, mediaIndex, event) => {
    const video = event?.currentTarget;
    if (!video) return;

    const duration = Number(video.duration);
    const currentTime = Number(video.currentTime);
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(currentTime)) return;

    const key = getProfileVideoWatchKey(postId, mediaIndex);
    const state = profileVideoWatchStateRef.current[key] || {
      startedFromBeginning: false,
      completionSent: false,
      startTimestampMs: 0,
      completedCount: 0,
      manualReplayArmed: false,
    };
    const elapsedMs = state.startTimestampMs > 0 ? Date.now() - state.startTimestampMs : 0;
    const minimumWatchMs = Math.max(duration * 500, 1500);

    if (
      currentTime >= duration - 0.2 &&
      state.startedFromBeginning &&
      !state.completionSent &&
      elapsedMs >= minimumWatchMs
    ) {
      state.completionSent = true;
      state.completedCount = Number(state.completedCount || 0) + 1;
      profileVideoWatchStateRef.current[key] = state;
      recordProfileVideoCompletedView(postId);
    }
  };

  const handleProfileVideoEnded = (postId, mediaIndex, event) => {
    const key = getProfileVideoWatchKey(postId, mediaIndex);
    const state = profileVideoWatchStateRef.current[key] || {
      startedFromBeginning: false,
      completionSent: false,
      startTimestampMs: 0,
      completedCount: 0,
      manualReplayArmed: false,
    };
    state.startedFromBeginning = false;
    state.startTimestampMs = 0;
    if (state.completedCount > 0) {
      state.manualReplayArmed = false;
    }
    profileVideoWatchStateRef.current[key] = state;

    const video = event?.currentTarget;
    if (video) {
      video.currentTime = 0;
      video.play().catch(() => {});
    }
  };

  const handleProfileVideoManualReplayIntent = (postId, mediaIndex) => {
    const key = getProfileVideoWatchKey(postId, mediaIndex);
    const state = profileVideoWatchStateRef.current[key] || {
      startedFromBeginning: false,
      completionSent: false,
      startTimestampMs: 0,
      completedCount: 0,
      manualReplayArmed: false,
    };
    if (state.completedCount > 0) {
      state.manualReplayArmed = true;
      profileVideoWatchStateRef.current[key] = state;
    }
  };

  const toggleLike = async (postId) => {
    const token = localStorage.getItem("token");
    if (!token) return;

    // ?? Prevent spam clicking
    if (likingMap[postId]) return;

    const currentPost = posts.find(p => p.post_id === postId);
    if (!currentPost) return;

    const wasLiked = currentPost.is_liked;

    // Mark as processing
    setLikingMap(prev => ({ ...prev, [postId]: true }));

    // ? Optimistic UI update
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

      // ?? Revert on failure
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
      // ? Unlock button
      setLikingMap(prev => {
        const updated = { ...prev };
        delete updated[postId];
        return updated;
      });
    }
  };

  const toggleRepost = async (postId) => {
    if (!token) {
      openGuestPrompt();
      return;
    }

    if (repostingMap[postId]) return;

    const currentPost = posts.find((p) => p.post_id === postId);
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
              repost_count: wasReposted
                ? Math.max(previousCount - 1, 0)
                : previousCount + 1,
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
    } finally {
      setRepostingMap((prev) => {
        const updated = { ...prev };
        delete updated[postId];
        return updated;
      });
    }
  };


  // Check if current user follows this profile
  const fetchFollowingStatus = async () => {
    if (isOwnProfile || !token) return; // no need

    try {
      const res = await fetch(
        `http://localhost:5000/api/follow/status?username=${username}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (res.ok) {
        setFollowing(Boolean(data.following));
        setFollowRequested(Boolean(data.requested));
      }
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
    if (!token) {
      openGuestPrompt();
      return;
    }

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

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Failed");

      const wasFollowing = following;
      const nextFollowing = Boolean(data.following);
      const nextRequested = Boolean(data.requested);

      setFollowing(nextFollowing);
      setFollowRequested(nextRequested);
      setUser(prev => ({
        ...prev,
        followers_count: Math.max(
          0,
          (prev.followers_count || 0) +
            (!wasFollowing && nextFollowing ? 1 : wasFollowing && !nextFollowing ? -1 : 0)
        ),
      }));

      if (!wasFollowing && nextFollowing) {
        setPrivatePostsHidden(false);
        setOffset(0);
        setHasMore(true);
        fetchPosts(true);
      }
    } catch (err) {
      console.error(err);
      setNotice({ type: "error", message: "Failed to update follow status." });
    } finally {
      setFollowLoading(false);
    }
  };

  const handleMessageProfile = async () => {
    if (!token) {
      openGuestPrompt();
      return;
    }

    if (!user?.id) return;

    try {
      const res = await fetch("http://localhost:5000/api/messages/get-or-create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ targetUserId: user.id }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to open chat");
      }

      navigate(`/chat/${data.chatId}`);
    } catch (err) {
      console.error(err);
      setNotice({
        type: "error",
        message: err.message || "Failed to open chat.",
      });
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
      <AeroNotice notice={notice ? { ...notice, inline: true } : null} onClose={() => setNotice(null)} />

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

      {guestPromptOpen && (
        <div className="profile-guest-overlay">
          <div className="profile-guest-card">
            <h3>Create an account to interact</h3>
            <p>You should create an account to interact.</p>
            <button
              type="button"
              className="profile-guest-cta"
              onClick={() => navigate("/signup")}
            >
              Create an account
            </button>
            <button
              type="button"
              className="profile-guest-dismiss"
              onClick={() => setGuestPromptOpen(false)}
            >
              Maybe later
            </button>
          </div>
        </div>
      )}

      {avatarViewerOpen && user?.profile_pic && (
        <div
          className="profile-avatar-overlay"
          onClick={() => setAvatarViewerOpen(false)}
        >
          <div
            className="profile-avatar-viewer"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="profile-avatar-close"
              onClick={() => setAvatarViewerOpen(false)}
            >
              <FaTimes />
            </button>

            <img
              src={getSafeMediaUrl(user.profile_pic)}
              alt={`${user.username} profile`}
              className="profile-avatar-expanded"
            />

            <p className="profile-avatar-caption">@{user.username}</p>
          </div>
        </div>
      )}

      {activeCommentPost && token && (
        <CommentSheet
          postId={activeCommentPost}
          user={user}

          // ? Add this (VERY IMPORTANT)
          postAuthorId={user?.id}

          onClose={() => setActiveCommentPost(null)}
        />
      )}


      <div className="profile-card">
        {!isOwnProfile && token && (
          <div className="profile-card-menu-wrap" ref={profileMenuRef}>
            <button
              className="profile-card-menu-btn"
              onClick={() => setProfileMenuOpen(prev => !prev)}
            >
              <FaEllipsisV />
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
          <button
            type="button"
            className={`profile-avatar ${user.profile_pic ? "clickable" : ""}`}
            onClick={() => {
              if (user.profile_pic) {
                setAvatarViewerOpen(true);
              }
            }}
          >
            {user.profile_pic ?
              <img src={getSafeMediaUrl(user.profile_pic)} alt="Avatar" />
              : <FaUser />}
          </button>

          <h2>
            <span className="username-with-badge">
              {user.username}
              <VerifiedBadge verified={user.is_verified} />
            </span>
          </h2>
          {user.is_private && (
            <span className="profile-private-badge">Private</span>
          )}
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
                disabled={token ? followLoading : false} // disable while loading
              >
                {token && followLoading ? (
                  <div className="button-spinner"></div>
                ) : (
                  following ? "Unfollow" : followRequested ? "Requested" : user?.is_private ? "Request" : "Follow"
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
              <button
                className="profile-btn share-btn"
                onClick={() => navigate(`/profile/${user.username}/share`)}
              >
                Share Profile
              </button>
            )}

            {!isOwnProfile && !isBlockedProfile && following && !followRequested && (
              <button
                type="button"
                className="profile-btn message-btn"
                onClick={handleMessageProfile}
                aria-label="Message this user"
                title="Message"
              >
                <FaCommentDots />
              </button>
            )}
          </div>

          <div className="profile-stats">
            <div className="stat">
              <span
                className="stat-number stat-clickable"
                onClick={() =>
                  token
                    ? navigate(`/profile/${user.username}/followers`)
                    : openGuestPrompt()
                }
              >
                {formatCount(user.followers_count)}
              </span>
              <span className="stat-label">Followers</span>
            </div>

            <div className="stat">
              <span
                className="stat-number stat-clickable"
                onClick={() =>
                  token
                    ? navigate(`/profile/${user.username}/following`)
                    : openGuestPrompt()
                }
              >
                {formatCount(user.following_count)}
              </span>
              <span className="stat-label">Following</span>
            </div>
          </div>
        </div>
      </div>

      <div className="profile-posts">
        <h3>Posts & Reposts</h3>

        {isBlockedProfile && !isOwnProfile ? (
          <p className="no-posts-message">
            {user?.blocked_by_me
              ? "You blocked this user, so their posts are hidden."
              : "You can't view this user's posts."}
          </p>
        ) : privatePostsHidden && !isOwnProfile ? (
          <p className="no-posts-message">
            This profile is private. Follow @{user.username} to see their posts and reposts.
          </p>
        ) : posts.length === 0 && !loadingPosts && (
          <p className="no-posts-message">No posts yet</p>
        )}

        {!isBlockedProfile && !privatePostsHidden && posts.map(post => (
          <div
            key={post.post_id}
            className={`post-card ${disappearingPosts.includes(post.post_id) ? "fade-out" : "fade-in"}`}
          >
            {/* ===== MORE OPTIONS (TOP RIGHT) ===== */}
            {token && (
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
              <FaEllipsisV />
            </div>

            {activeMenuPostId === post.post_id && (
              <div className="post-dropdown">

                {/* ? YOUR PROFILE ONLY */}
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

                {/* ? OTHER PEOPLE'S PROFILE */}
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
            )}

            <div className="post-header">
              <div className="post-user-info">
                <button
                  type="button"
                  className="post-user-link"
                  onClick={() => goToProfile(post.username || user.username)}
                >
                  <div className="post-user-avatar">
                    {post.profile_pic ? (
                      <img src={getSafeMediaUrl(post.profile_pic)} alt="pfp" />
                    ) : <FaUser />}
                  </div>

                  <div className="post-user-text">
                    <span className="post-username">
                      <span className="username-with-badge">
                        {post.username || user.username}
                        <VerifiedBadge verified={post.is_verified ?? user.is_verified} />
                      </span>
                    </span>
                    <span className="post-date">
                      {formatDate(post.date_posted)}
                    </span>
                  </div>
                </button>
              </div>
            </div>

            {post.activity_type === "repost" && (
              <p className="profile-repost-label">
                Reposted by @{user.username}
              </p>
            )}

            {post.caption && (
              <CaptionWithHashtags className="post-content" text={post.caption} />
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
                    ><FaChevronLeft /></button>

                    <button
                      className="carousel-arrow right"
                      onClick={() =>
                        moveSlide(post.post_id, 1, post.media.length)
                      }
                    ><FaChevronRight /></button>
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
                        <>
                          <video
                            ref={el => {
                              if (!videoRefs.current[post.post_id]) {
                                videoRefs.current[post.post_id] = [];
                              }
                              if (!el) {
                                delete videoRefs.current[post.post_id][i];
                                return;
                              }
                              videoRefs.current[post.post_id][i] = el;
                              el.muted = videoMutedMap[getVideoControlKey(post.post_id, i)] ?? true;
                              if (observerRef.current) {
                                observerRef.current.observe(el);
                              }
                              if ((activeIndexMap[post.post_id] || 0) === i) {
                                requestAnimationFrame(() => {
                                  tryAutoplayProfileVideo(el);
                                });
                              }
                            }}
                            src={getSafeMediaUrl(m.media_url)}
                            playsInline
                            muted={videoMutedMap[getVideoControlKey(post.post_id, i)] ?? true}
                            preload="metadata"
                            className="auto-video"
                            onPlay={(event) => handleProfileVideoPlay(post.post_id, i, event)}
                            onTimeUpdate={(event) => handleProfileVideoProgress(post.post_id, i, event)}
                            onEnded={(event) => handleProfileVideoEnded(post.post_id, i, event)}
                            onLoadedData={(e) => {
                              if ((activeIndexMap[post.post_id] || 0) === i) {
                                tryAutoplayProfileVideo(e.currentTarget);
                              }
                            }}
                            onMouseDown={handleVideoTapStart}
                            onMouseUp={(event) => {
                              handleProfileVideoManualReplayIntent(post.post_id, i);
                              handleVideoTapEnd(event, post);
                            }}
                            onTouchStart={handleVideoTapStart}
                            onTouchEnd={(event) => {
                              handleProfileVideoManualReplayIntent(post.post_id, i);
                              handleVideoTapEnd(event, post);
                            }}
                          />
                        </>
                      ) : (
                        <img src={getSafeMediaUrl(m.media_url)} alt="" />
                      )}
                    </div>
                  ))}
                </div>

                {post.media[(activeIndexMap[post.post_id] || 0)]?.media_type === "video" && (
                  <button
                    type="button"
                    className={`post-video-sound-btn ${(
                      videoMutedMap[getVideoControlKey(post.post_id, activeIndexMap[post.post_id] || 0)] ?? true
                    ) ? "muted" : ""}`}
                    onClick={() => toggleVideoMuted(post.post_id, activeIndexMap[post.post_id] || 0)}
                    aria-label={(videoMutedMap[getVideoControlKey(post.post_id, activeIndexMap[post.post_id] || 0)] ?? true) ? "Turn on sound" : "Mute video"}
                  >
                    {(videoMutedMap[getVideoControlKey(post.post_id, activeIndexMap[post.post_id] || 0)] ?? true) ? <FaVolumeMute /> : <FaVolumeUp />}
                  </button>
                )}

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
                    onClick={() => (token ? toggleLike(post.post_id) : openGuestPrompt())}
                  >
                    {post.is_liked ? <FaHeart /> : <FaRegHeart />}
                  </button>

                  <span className="like-count">
                    {formatCount(post.like_count)}
                  </span>

                </div>

                <div className="like-wrapper">

                  <button
                    className="post-action-btn"
                    onClick={() => (token ? setActiveCommentPost(post.post_id) : openGuestPrompt())}
                  >
                    <FaCommentDots />
                  </button>

                  <span className="like-count">
                    {formatCount(post.comment_count)}
                  </span>

                </div>

                <div className="like-wrapper">
                  <button
                    className={`post-action-btn ${post.is_reposted ? "reposted" : ""}`}
                    onClick={() => toggleRepost(post.post_id)}
                  >
                    <FaRetweet />
                  </button>

                  <span className="like-count">
                    {formatCount(post.repost_count)}
                  </span>
                </div>
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
