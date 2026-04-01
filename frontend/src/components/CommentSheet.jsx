import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import AeroNotice from "./AeroNotice";
import "../css/CommentSheet.css";
import { formatRelativeTime } from "../utils/timeFormatter";
import supabase from "../lib/supabaseClient";
import { getSafeMediaUrl } from "../utils/mediaUrl";

export default function CommentSheet({
  postId,
  postAuthorId,
  onClose
}) {

  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [likingMap, setLikingMap] = useState({});
  const [replyingTo, setReplyingTo] = useState(null);
  const [expandedThreads, setExpandedThreads] = useState({});
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const listRef = useRef(null);
  const [replyPageMap, setReplyPageMap] = useState({});
  const [initialLoading, setInitialLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const REPLY_PAGE_SIZE = 5;

  const [activeMenu, setActiveMenu] = useState(null);
  

  const inputRef = useRef(null);
  const userId = localStorage.getItem("userId"); // or fetch it from token payload
  const token = localStorage.getItem("token");
  

  const toggleMenu = (id) => {
    setActiveMenu(prev => (prev === id ? null : id));
  };

  const closeMenu = () => setActiveMenu(null);

  useEffect(() => {
    const handleClick = () => setActiveMenu(null);
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);






  function CommentMenu({ comment, postAuthorId, userId, deleteComment, closeMenu }) {
    const navigate = useNavigate();
    const canDelete = comment.user_id === userId || postAuthorId === userId;
    const canReport = comment.user_id !== userId;

    return (
      <div className="comment-menu-dropdown">
        {canDelete && (
          <div
            className="comment-menu-item"
            onClick={() => {
              deleteComment(comment.comment_id);
              closeMenu();
            }}
          >
            Delete
          </div>
        )}

        {canReport && (
          <div
            className="comment-menu-item"
            onClick={() => {
              navigate(`/report?type=comment&id=${comment.comment_id}`);
              closeMenu();
            }}
          >
            Report
          </div>
        )}
      </div>
    );
  }
  

  /* ===============================
     FETCH COMMENTS
  =============================== */


  async function fetchComments(pageNumber = 1) {

    try {

      if (pageNumber === 1) {
        setInitialLoading(true);
      }

      const res = await fetch(
        `http://localhost:5000/api/comments/${postId}?page=${pageNumber}&limit=20`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      const data = await res.json();

      if (pageNumber === 1) {
        setComments(data.comments || []);
      } else {
        setComments(prev => [
          ...prev,
          ...(data.comments || [])
        ]);
      }

      if (!data.comments || data.comments.length < 20) {
        setHasMore(false);
      }

    } finally {
      setInitialLoading(false);
    }
  }


  const deleteComment = async (commentId) => {
    if (!token) return;

    try {
      const res = await fetch(`http://localhost:5000/api/comments/${commentId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: "error", message: data.error || "Failed to delete comment." });
        return;
      }

      // Remove comment from state
      setComments(prev => prev.filter(c => c.comment_id !== commentId));

      closeMenu();
    } catch (err) {
      console.error(err);
      setNotice({ type: "error", message: "Failed to delete comment." });
    }
  };

  /* ===============================
     REALTIME SUBSCRIPTION
  =============================== */

  useEffect(() => {

    fetchComments();

    const channel = supabase
      .channel("comments-live")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "comments",
          filter: `post_id=eq.${postId}`
        },
        async (payload) => {
          const newComment = payload.new;

          try {
            // 🔥 fetch FULL comment with username + profile_pic
            const res = await fetch(
              `http://localhost:5000/api/comments/single/${newComment.comment_id}`,
              {
                headers: {
                  Authorization: `Bearer ${token}`
                }
              }
            );

            const data = await res.json();

            const fullComment = data.comment;

            setComments(prev => {
              if (prev.some(c => c.comment_id === fullComment.comment_id)) {
                return prev;
              }

              return [fullComment, ...prev];
            });

          } catch (err) {
            console.error(err);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };

  }, [postId]);

  useEffect(() => {

  const list = listRef.current;
  if (!list) return;

  const handleScroll = () => {

    if (!hasMore) return;

    const bottom =
      list.scrollTop + list.clientHeight >=
      list.scrollHeight - 100;

    if (bottom) {
      const nextPage = page + 1;

      setPage(nextPage);
      fetchComments(nextPage);
    }
  };

  list.addEventListener("scroll", handleScroll);

  return () => list.removeEventListener("scroll", handleScroll);

}, [page, hasMore]);

  /* ===============================
     COMMENT SEND
  =============================== */

  const sendComment = async () => {
    if (!text.trim()) return;

    setLoading(true);

    try {

      let parentId = null;

      if (replyingTo) {
        parentId =
          replyingTo.parent_comment_id ||
          replyingTo.comment_id;
      }

      const res = await fetch("http://localhost:5000/api/comments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          postId,
          text,
          parentId
        })
      });

      const newComment = await res.json();

      

      setText("");
      setReplyingTo(null);

    } catch (err) {
      console.error(err);
    }

    setLoading(false);
  };

  /* ===============================
     LIKE TOGGLE
  =============================== */

  const toggleCommentLike = async (commentId) => {

    if (!token || likingMap[commentId]) return;

    setLikingMap(prev => ({
      ...prev,
      [commentId]: true
    }));

    try {

      setComments(prev =>
        prev.map(c => {

          if (c.comment_id !== commentId) return c;

          const liked = !c.is_liked;

          const currentCount = Number(c.like_count || 0);

          return {
            ...c,
            is_liked: liked,
            like_count: liked
              ? currentCount + 1
              : Math.max(currentCount - 1, 0)
          };

        })
      );

      await fetch(
        "http://localhost:5000/api/commentLikes/toggle",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ commentId })
        }
      );

    } finally {
      setLikingMap(prev => {
        const copy = { ...prev };
        delete copy[commentId];
        return copy;
      });
    }
  };

  /* ===============================
     THREAD HELPERS
  =============================== */

  const toggleThreadExpand = (id) => {
    setExpandedThreads(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const getVisibleReplies = (commentId) => {

  const replies = replyMap[commentId] || [];

  const page = replyPageMap[commentId] || 1;

  return replies.slice(0, page * REPLY_PAGE_SIZE);
};

const loadMoreReplies = (commentId) => {

  setReplyPageMap(prev => ({
    ...prev,
    [commentId]: (prev[commentId] || 1) + 1
  }));

};

  const mainComments = comments.filter(
    c => !c.parent_comment_id
  );

  const replyMap = {};

  comments
    .filter(c => c.parent_comment_id)
    .forEach(reply => {
      if (!replyMap[reply.parent_comment_id])
        replyMap[reply.parent_comment_id] = [];

      replyMap[reply.parent_comment_id].push(reply);
    });

  /* ===============================
     RENDER
  =============================== */

  return (
    <div className="comment-overlay" onClick={onClose}>

      <div className="comment-sheet" onClick={e => e.stopPropagation()}>
        <AeroNotice notice={notice ? { ...notice, inline: true } : null} onClose={() => setNotice(null)} />

        <div className="comment-header">
          Comments
          <div className="comment-close-btn" onClick={onClose}>✕</div>
        </div>

        <div className="comment-list" ref={listRef}>

          {/* ===============================
                COMMENT LOADING SKELETON
              ================================ */}

              {initialLoading && (
                <>
                  {[1,2,3].map(i => (
                    <div key={i} className="comment-item skeleton">

                      <div className="comment-avatar skeleton-box" />

                      <div style={{ flex: 1 }}>

                        <div className="skeleton-line short" />
                        <div className="skeleton-line" />
                        <div className="skeleton-line small" />

                      </div>

                    </div>
                  ))}
                </>
              )}


              {/* ===============================
                NO COMMENTS STATE
              ================================ */}

              {!initialLoading && mainComments.length === 0 && (
                <div className="no-comments-state">
                  No comments yet
                </div>
              )}

          {mainComments.map(c => {

            const replies = replyMap[c.comment_id] || [];
            const expanded = expandedThreads[c.comment_id];

            return (
              <div key={c.comment_id} className="comment-item">

                <div className="comment-content">

                

                  <div className="comment-username">

                    <div className="comment-avatar">
                      {c.profile_pic ? (
                        <img
                          src={getSafeMediaUrl(c.profile_pic)}
                          alt="pfp"
                          loading="lazy"
                          onError={(e) => {
                            e.target.style.display = "none";
                          }}
                        />
                      ) : (
                        "👤"
                      )}
                    </div>

                    <div className="comment-user-meta">
                      <span className="comment-user-name">
                        {c.username}

                        {c.user_id === postAuthorId && (
                          <span className="comment-author-badge">
                            Author
                          </span>
                        )}
                      </span>

                      {c.date_commented && (
                        <span className="comment-date">
                          • {formatRelativeTime(c.date_commented)}
                        </span>
                      )}
                    </div>

                  </div>

                  <p className="comment-text">
                    {c.commented_text}
                  </p>

                  <div className="comment-actions">

                    <button
                      className="comment-reply-btn"
                      onClick={() => {
                        setReplyingTo(c);
                        setText(`@${c.username} `);
                        inputRef.current?.focus();
                      }}
                    >
                      ↩ Reply
                    </button>

                    <button
                      className="comment-like-btn"
                      onClick={() =>
                        toggleCommentLike(c.comment_id)
                      }
                    >
                      ❤️ {c.like_count || 0}
                    </button>

                    <div
                      className="comment-menu-wrapper"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="comment-menu-btn"
                        onClick={() => toggleMenu(c.comment_id)}
                      >
                        ⋯
                      </button>

                      {activeMenu === c.comment_id && (
                        <CommentMenu
                          comment={c}
                          postAuthorId={postAuthorId}
                          userId={userId}
                          deleteComment={deleteComment}
                          closeMenu={closeMenu}
                        />
                      )}
                    </div>

                  </div>

                  {replies.length > 0 && !expanded && (
                    <div
                      className="thread-teaser"
                      onClick={() =>
                        toggleThreadExpand(c.comment_id)
                      }
                    >
                      ↳ View {replies.length}
                      {replies.length > 1 ? " replies" : " reply"}
                    </div>
                  )}

                  {expanded && (() => {

                    const visibleReplies = getVisibleReplies(c.comment_id);
                    const totalReplies = replies.length;

                    return (
                      <>
                        {visibleReplies.map(r => (
                          <div key={r.comment_id} className="thread-wrapper">

                          

                            <div className="thread-author">

                              <div className="comment-avatar small">
                                {r.profile_pic ? (
                                  <img
                                    src={getSafeMediaUrl(r.profile_pic)}
                                    alt="pfp"
                                    loading="lazy"
                                    onError={(e) => {
                                      e.target.style.display = "none";
                                    }}
                                  />
                                ) : (
                                  "👤"
                                )}
                              </div>

                              <span>
                                @{r.username}

                                {r.user_id === postAuthorId && (
                                  <span className="comment-author-badge">
                                    Author
                                  </span>
                                )}
                              </span>

                            </div>

                            <div className="thread-text">
                              {r.commented_text}
                            </div>

                            <div className="thread-actions">

                              <button
                                className="thread-reply-btn"
                                onClick={() => {
                                  setReplyingTo(r);
                                  setText(`@${r.username} `);
                                  inputRef.current?.focus();
                                }}
                              >
                                ↩ Reply
                              </button>

                              <button
                                className="thread-reply-btn"
                                onClick={() => toggleCommentLike(r.comment_id)}
                              >
                                ❤️ {r.like_count || 0}
                              </button>

                              <div
                                className="comment-menu-wrapper"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  className="comment-menu-btn"
                                  onClick={() => toggleMenu(r.comment_id)}
                                >
                                  ⋯
                                </button>

                                {activeMenu === r.comment_id && (
                                  <CommentMenu
                                    comment={r}
                                    postAuthorId={postAuthorId}
                                    userId={userId}
                                    deleteComment={deleteComment}
                                    closeMenu={closeMenu}
                                  />
                                )}
                              </div>

                            </div>

                          </div>
                        ))}

                        {/* ⭐ Load More Replies Button */}

                        {visibleReplies.length < totalReplies && (
                          <div
                            className="thread-teaser"
                            style={{ marginLeft: "40px" }}
                            onClick={() => loadMoreReplies(c.comment_id)}
                          >
                            Load more replies
                          </div>
                        )}

                      </>
                    );

                  })()}

                </div>
              </div>
            );

          })}

        </div>

        {replyingTo && (
          <div className="replying-banner">
            
            <div className="replying-left">
              <div className="replying-avatar">
                {replyingTo.profile_pic ? (
                  <img src={getSafeMediaUrl(replyingTo.profile_pic)} alt="pfp" />
                ) : (
                  "👤"
                )}
              </div>

              <div className="replying-text">
                <span className="replying-label">Replying to</span>
                <span className="replying-username">
                  @{replyingTo.username}
                </span>
              </div>
            </div>

            <button
              className="reply-cancel-btn"
              onClick={() => setReplyingTo(null)}
            >
              ✕
            </button>

          </div>
        )}

        <div className="comment-input-wrapper">

          <input
            ref={inputRef}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Write a comment..."
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading) {
                e.preventDefault();
                sendComment();
              }
            }}
          />

          <button onClick={sendComment} disabled={loading}>
            {loading ? <span className="spinner" /> : "Post"}
          </button>

        </div>

      </div>
    </div>
  );
}
