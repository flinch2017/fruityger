import React, { useEffect, useState, useRef } from "react";
import "../css/CommentSheet.css";
import { formatRelativeTime } from "../utils/timeFormatter";
import supabase from "../lib/supabaseClient";

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

  const inputRef = useRef(null);
  const token = localStorage.getItem("token");

  /* ===============================
     FETCH COMMENTS
  =============================== */

  async function fetchComments(pageNumber = 1) {

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
}

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
        () => {
          fetchComments();
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

      await fetch("http://localhost:5000/api/comments", {
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

        <div className="comment-header">
          Comments
          <div className="comment-close-btn" onClick={onClose}>✕</div>
        </div>

        <div className="comment-list" ref={listRef}>

          {mainComments.map(c => {

            const replies = replyMap[c.comment_id] || [];
            const expanded = expandedThreads[c.comment_id];

            return (
              <div key={c.comment_id} className="comment-item">

                <div className="comment-content">

                  <div className="comment-username">
                    {c.username}

                    {c.date_commented && (
                      <span className="comment-date">
                        • {formatRelativeTime(c.date_commented)}
                      </span>
                    )}
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

                  {expanded && replies.map(r => (
                    <div key={r.comment_id} className="thread-wrapper">

                      <div className="thread-author">
                        @{r.username}
                      </div>

                      <div className="thread-text">
                        {r.commented_text}
                      </div>

                      {/* ⭐ Reply + Like Actions */}
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

                      </div>

                    </div>
                  ))}

                </div>
              </div>
            );

          })}

        </div>

        {replyingTo && (
          <div className="replying-banner">
            Replying to @{replyingTo.username}
            <span
              className="reply-cancel"
              onClick={() => setReplyingTo(null)}
            >
              ✕
            </span>
          </div>
        )}

        <div className="comment-input-wrapper">

          <input
            ref={inputRef}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Write a comment..."
          />

          <button onClick={sendComment} disabled={loading}>
            Post
          </button>

        </div>

      </div>
    </div>
  );
}