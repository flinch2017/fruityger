import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  FaArrowLeft,
  FaFileAlt,
  FaFilePdf,
  FaFileWord,
  FaCog,
  FaEllipsisV,
  FaRegSmileBeam,
  FaReply,
  FaTimes,
  FaUserCircle,
  FaPlayCircle,
} from "react-icons/fa";
import supabase from "../lib/supabaseClient";
import AeroNotice from "../components/AeroNotice";
import "../css/Chat.css";
import { getSafeMediaUrl } from "../utils/mediaUrl";
import VerifiedBadge from "../components/VerifiedBadge";
import { getDisplayName } from "../utils/displayName";

export default function Chat() {
  const reactionOptions = [
    { key: "like", emoji: "\u{1F44D}", label: "Like" },
    { key: "heart", emoji: "\u2764\uFE0F", label: "Heart" },
    { key: "laugh", emoji: "\u{1F602}", label: "Laugh" },
    { key: "wow", emoji: "\u{1F62E}", label: "Wow" },
    { key: "sad", emoji: "\u{1F622}", label: "Sad" },
    { key: "angry", emoji: "\u{1F621}", label: "Angry" },
    { key: "care", emoji: "\u{1F917}", label: "Care" },
  ];

  const { chatId } = useParams();
  const navigate = useNavigate();
  const token = localStorage.getItem("token");
  const userId = localStorage.getItem("userId");

  const [messages, setMessages] = useState([]);
  const [otherUser, setOtherUser] = useState({ username: "..." });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [openMenuDirection, setOpenMenuDirection] = useState("down");
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [blockedByMe, setBlockedByMe] = useState(false);
  const [blockedByThem, setBlockedByThem] = useState(false);
  const [requestStatus, setRequestStatus] = useState("accepted");
  const [requestedBy, setRequestedBy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [sending, setSending] = useState(false);
  const [otherUserOnline, setOtherUserOnline] = useState(false);
  const [otherUserTyping, setOtherUserTyping] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [selectedAttachment, setSelectedAttachment] = useState(null);
  const [reactionTargetMessage, setReactionTargetMessage] = useState(null);
  const [reacting, setReacting] = useState(false);
  const [pendingReactionKey, setPendingReactionKey] = useState(null);
  const [reactionViewer, setReactionViewer] = useState(null);
  const [reactionViewerLoading, setReactionViewerLoading] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [onlineUserIds, setOnlineUserIds] = useState([]);
  const otherUserDisplayName = getDisplayName(otherUser, "Conversation");
  const isIncomingRequest =
    requestStatus === "pending" &&
    requestedBy &&
    String(requestedBy) !== String(userId);

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const refreshTimeoutRef = useRef(null);
  const shouldStickToBottomRef = useRef(true);
  const previousMessagesLengthRef = useRef(0);
  const channelRef = useRef(null);
  const presenceChannelRef = useRef(null);
  const inboxChannelRef = useRef(null);
  const typingStopTimeoutRef = useRef(null);
  const typingIndicatorTimeoutRef = useRef(null);
  const attachmentInputRef = useRef(null);

  const scrollToBottom = (behavior = "smooth") => {
    messagesContainerRef.current?.scrollTo({ top: 0, behavior });
  };

  const updateStickiness = () => {
    const container = messagesContainerRef.current;
    if (!container) return;

    shouldStickToBottomRef.current = container.scrollTop < 120;
  };

  const dispatchMessagesRefresh = () => {
    window.dispatchEvent(new CustomEvent("fruityger:messages-refresh"));
  };

  const broadcastInboxSync = async (reason = "refresh") => {
    if (!inboxChannelRef.current) return;

    try {
      await inboxChannelRef.current.send({
        type: "broadcast",
        event: "inbox-sync",
        payload: {
          chatId,
          actorUserId: userId,
          reason,
          at: Date.now(),
        },
      });
    } catch (error) {
      console.error("Failed to broadcast inbox sync:", error);
    }
  };

  const broadcastChatSync = async (reason = "refresh") => {
    if (!channelRef.current) return;

    try {
      await channelRef.current.send({
        type: "broadcast",
        event: "message-sync",
        payload: {
          chatId,
          actorUserId: userId,
          reason,
          at: Date.now(),
        },
      });
    } catch (error) {
      console.error("Failed to broadcast chat sync:", error);
    }
  };

  const toggleMessageMenu = (messageId, event) => {
    if (openMenuId === messageId) {
      setOpenMenuId(null);
      setOpenMenuDirection("down");
      return;
    }

    const triggerRect = event.currentTarget.getBoundingClientRect();
    const estimatedMenuHeight = 96;
    const containerRect = messagesContainerRef.current?.getBoundingClientRect();
    const spaceBelow = containerRect
      ? containerRect.bottom - triggerRect.bottom
      : window.innerHeight - triggerRect.bottom;
    setOpenMenuDirection(spaceBelow < estimatedMenuHeight ? "up" : "down");
    setOpenMenuId(messageId);
  };

  const syncPresenceState = (channel) => {
    const nextOnlineIds = new Set();
    const state = channel.presenceState();

    Object.values(state).forEach((entries = []) => {
      entries.forEach((entry) => {
        if (entry?.user_id) {
          nextOnlineIds.add(String(entry.user_id));
        }
      });
    });

    setOnlineUserIds(Array.from(nextOnlineIds));
  };

  const getReplyAuthorLabel = (message) => {
    if (!message) return "Message";
    return String(message.sender_id) === String(userId) ? "You" : otherUser.username;
  };

  const getReplyPreviewText = (content) => {
    const safeContent = (content || "Original message unavailable").trim();
    return safeContent.length > 90 ? `${safeContent.slice(0, 90)}...` : safeContent;
  };

  const getReactionEmoji = (reactionKey) =>
    reactionOptions.find((option) => option.key === reactionKey)?.emoji || "\u2764\uFE0F";

  const attachmentIcon = (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8.5 12.5 15 6a3 3 0 1 1 4.24 4.24l-8.13 8.13a5 5 0 1 1-7.07-7.07l8.84-8.84"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );

  const getAttachmentKindLabel = (attachment) => {
    if (!attachment) return "";
    if (attachment.attachment_type === "image" || attachment.type?.startsWith("image/")) {
      return "Image";
    }
    if (attachment.attachment_type === "video" || attachment.type?.startsWith("video/")) {
      return "Video";
    }
    if (attachment.attachment_type === "pdf" || attachment.type === "application/pdf") {
      return "PDF";
    }
    if (
      attachment.attachment_type === "docx" ||
      attachment.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      return "DOCX";
    }
    return "File";
  };

  const getAttachmentIcon = (attachment) => {
    const kind = getAttachmentKindLabel(attachment);
    if (kind === "PDF") return <FaFilePdf />;
    if (kind === "DOCX") return <FaFileWord />;
    if (kind === "Video") return <FaPlayCircle />;
    return <FaFileAlt />;
  };

  const formatFileSize = (bytes) => {
    const size = Number(bytes || 0);
    if (!size) return "";
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  const sendTypingState = async (isTyping) => {
    if (!channelRef.current || !userId) return;

    try {
      await channelRef.current.send({
        type: "broadcast",
        event: "typing",
        payload: {
          chatId,
          userId,
          isTyping,
        },
      });
    } catch (error) {
      console.error("Failed to send typing state:", error);
    }
  };

  const markChatRead = async () => {
    if (!token) return;

    try {
      await fetch(`http://localhost:5000/api/messages/${chatId}/read`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (err) {
      console.error(err);
    } finally {
      dispatchMessagesRefresh();
    }
  };

  const fetchChatSnapshot = async ({ showLoading = false } = {}) => {
    if (!token) return null;

    if (showLoading) {
      setLoading(true);
    }

    try {
      const res = await fetch(`http://localhost:5000/api/messages/${chatId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch chat");
      }

      const chat = data.chat;
      const other = chat.user1.id === userId ? chat.user2 : chat.user1;
      setOtherUser(other);
      setMessages([...(data.messages || [])].reverse());
      setBlockedByMe(Boolean(chat.blocked_by_me));
      setBlockedByThem(Boolean(chat.blocked_by_them));
      setRequestStatus(chat.request_status || "accepted");
      setRequestedBy(chat.requested_by || null);
      dispatchMessagesRefresh();

      return data;
    } catch (err) {
      console.error(err);
      return null;
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    const previousLength = previousMessagesLengthRef.current;
    const currentLength = messages.length;
    const lastMessage = currentLength > 0 ? messages[currentLength - 1] : null;
    const isOwnLatestMessage =
      lastMessage && String(lastMessage.sender_id) === String(userId);

    if (
      currentLength > previousLength &&
      (shouldStickToBottomRef.current || isOwnLatestMessage)
    ) {
      scrollToBottom(previousLength === 0 ? "auto" : "smooth");
    }

    previousMessagesLengthRef.current = currentLength;
  }, [messages, userId]);

  const formatMessageTime = (dateString) => {
    const date = new Date(dateString);

    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  useEffect(() => {
    let channel;

    const initChat = async () => {
      await fetchChatSnapshot({ showLoading: true });
      scrollToBottom("auto");

      channel = supabase
        .channel(`chat-${chatId}`)
        .on("broadcast", { event: "typing" }, ({ payload }) => {
          if (!payload) return;
          if (String(payload.chatId) !== String(chatId)) return;
          if (String(payload.userId) === String(userId)) return;

          setOtherUserTyping(Boolean(payload.isTyping));

          if (typingIndicatorTimeoutRef.current) {
            clearTimeout(typingIndicatorTimeoutRef.current);
          }

          if (payload.isTyping) {
            typingIndicatorTimeoutRef.current = setTimeout(() => {
              setOtherUserTyping(false);
            }, 1800);
          }
        })
        .on("broadcast", { event: "message-sync" }, async ({ payload }) => {
          if (!payload) return;
          if (String(payload.chatId) !== String(chatId)) return;

          await fetchChatSnapshot();

          if (String(payload.actorUserId) !== String(userId)) {
            await markChatRead();
          } else {
            dispatchMessagesRefresh();
          }
        })
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `chat_id=eq.${chatId}`,
          },
          async (payload) => {
            const newMessage = payload.new;

            if (String(newMessage.sender_id) !== String(userId)) {
              setOtherUserTyping(false);
            }

            await fetchChatSnapshot();

            if (String(newMessage.receiver_id) === String(userId)) {
              await markChatRead();
            } else {
              dispatchMessagesRefresh();
            }

            setTimeout(scrollToBottom, 50);
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "messages",
            filter: `chat_id=eq.${chatId}`,
          },
          (payload) => {
            const updated = payload.new;

            setMessages((prev) =>
              prev.map((message) =>
                message.id === updated.id ? { ...message, ...updated } : message
              )
            );
          }
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "messages",
            filter: `chat_id=eq.${chatId}`,
          },
          (payload) => {
            const deleted = payload.old;

            setMessages((prev) =>
              prev.filter((message) => String(message.id) !== String(deleted.id))
            );

            dispatchMessagesRefresh();
          }
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "deleted_messages",
          },
          (payload) => {
            const deletedMessageId = payload.new?.message_id;
            if (!deletedMessageId) return;

            setMessages((prev) =>
              prev.filter((message) => String(message.id) !== String(deletedMessageId))
            );
            dispatchMessagesRefresh();
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "chats",
            filter: `id=eq.${chatId}`,
          },
          () => {
            if (refreshTimeoutRef.current) {
              clearTimeout(refreshTimeoutRef.current);
            }

            refreshTimeoutRef.current = setTimeout(() => {
              dispatchMessagesRefresh();
            }, 100);
          }
        )
        .subscribe();

      channelRef.current = channel;
    };

    initChat();

    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      if (typingStopTimeoutRef.current) {
        clearTimeout(typingStopTimeoutRef.current);
      }
      if (typingIndicatorTimeoutRef.current) {
        clearTimeout(typingIndicatorTimeoutRef.current);
      }
      channelRef.current = null;
      if (channel) supabase.removeChannel(channel);
    };
  }, [chatId, token, userId]);

  useEffect(() => {
    if (!userId) return undefined;

    const channel = supabase.channel("fruityger-messages-live").subscribe();
    inboxChannelRef.current = channel;

    return () => {
      inboxChannelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    const updateKeyboardOffset = () => {
      if (!window.visualViewport) {
        setKeyboardOffset(0);
        return;
      }

      const viewport = window.visualViewport;
      const overlap = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop
      );

      setKeyboardOffset(overlap);
    };

    updateKeyboardOffset();

    if (!window.visualViewport) return undefined;

    window.visualViewport.addEventListener("resize", updateKeyboardOffset);
    window.visualViewport.addEventListener("scroll", updateKeyboardOffset);
    window.addEventListener("orientationchange", updateKeyboardOffset);

    return () => {
      window.visualViewport.removeEventListener("resize", updateKeyboardOffset);
      window.visualViewport.removeEventListener("scroll", updateKeyboardOffset);
      window.removeEventListener("orientationchange", updateKeyboardOffset);
    };
  }, []);

  useEffect(() => {
    setOtherUserTyping(false);
  }, [chatId]);

  useEffect(() => {
    if (!userId) return undefined;

    const channel = supabase
      .channel("fruityger-online")
      .on("presence", { event: "sync" }, () => {
        syncPresenceState(channel);
      })
      .on("presence", { event: "join" }, () => {
        syncPresenceState(channel);
      })
      .on("presence", { event: "leave" }, () => {
        syncPresenceState(channel);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          syncPresenceState(channel);
        }
      });

    presenceChannelRef.current = channel;

    return () => {
      presenceChannelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    if (!channelRef.current) return undefined;

    const hasText = input.trim().length > 0;

    if (!hasText) {
      if (typingStopTimeoutRef.current) {
        clearTimeout(typingStopTimeoutRef.current);
      }
      sendTypingState(false);
      return undefined;
    }

    sendTypingState(true);

    if (typingStopTimeoutRef.current) {
      clearTimeout(typingStopTimeoutRef.current);
    }

    typingStopTimeoutRef.current = setTimeout(() => {
      sendTypingState(false);
    }, 1200);

    return () => {
      if (typingStopTimeoutRef.current) {
        clearTimeout(typingStopTimeoutRef.current);
      }
    };
  }, [input]);

  useEffect(() => {
    if (!otherUser?.id) {
      setOtherUserOnline(false);
      return;
    }

    setOtherUserOnline(onlineUserIds.includes(String(otherUser.id)));
  }, [otherUser?.id, onlineUserIds]);

  const acceptMessageRequest = async () => {
    try {
      const res = await fetch(`http://localhost:5000/api/messages/requests/${chatId}/accept`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Failed to accept message request");
      }

      setRequestStatus("accepted");
      setRequestedBy(null);
      setNotice({ type: "success", message: "Message request accepted." });
      dispatchMessagesRefresh();
      await broadcastInboxSync("accepted-message-request");
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: error.message || "Failed to accept request." });
    }
  };

  const deleteMessageRequest = async () => {
    try {
      const res = await fetch(`http://localhost:5000/api/messages/requests/${chatId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Failed to delete message request");
      }

      dispatchMessagesRefresh();
      await broadcastInboxSync("deleted-message-request");
      navigate("/messages", { replace: true });
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: error.message || "Failed to delete request." });
    }
  };

  const sendMessage = async () => {
    if ((!input.trim() && !selectedAttachment) || blockedByMe || blockedByThem || isIncomingRequest || sending) {
      return;
    }

    setSending(true);
    const draftContent = input.trim();
    const draftAttachment = selectedAttachment;
    const draftReply = replyingTo;
    const tempMessageId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimisticMessage = {
      id: tempMessageId,
      chat_id: chatId,
      sender_id: userId,
      receiver_id: otherUser.id,
      content: draftContent || (draftAttachment ? getAttachmentKindLabel(draftAttachment) : ""),
      reply_to_message_id: draftReply?.id || null,
      reply_to_content: draftReply?.content || null,
      reply_to_sender_id: draftReply?.sender_id || null,
      attachment_url: null,
      attachment_type: null,
      attachment_name: draftAttachment?.name || null,
      attachment_size: draftAttachment?.size || null,
      read_status: false,
      reactions: [],
      created_at: new Date().toISOString(),
      send_status: "sending",
    };

    setMessages((prev) => [optimisticMessage, ...prev]);
    setInput("");
    setSelectedAttachment(null);
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = "";
    }
    setReplyingTo(null);
    scrollToBottom("smooth");

    try {
      const formData = new FormData();
      formData.append("chatId", chatId);
      formData.append("receiverId", otherUser.id);
      formData.append("content", draftContent);
      formData.append("replyToMessageId", draftReply?.id || "");
      if (draftAttachment) {
        formData.append("attachment", draftAttachment);
      }

      const res = await fetch("http://localhost:5000/api/messages/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Failed to send message");
      }

      setMessages((prev) => {
        let replacedPending = false;
        const nextMessages = prev.map((message) => {
          if (message.id !== tempMessageId) return message;
          replacedPending = true;
          return data;
        });

        if (nextMessages.some((message) => message.id === data.id)) {
          return nextMessages;
        }

        return replacedPending ? nextMessages : [data, ...nextMessages];
      });

      dispatchMessagesRefresh();
      await broadcastChatSync("sent-message");
      await broadcastInboxSync("sent-message");
    } catch (err) {
      console.error(err);
      setMessages((prev) => prev.filter((message) => message.id !== tempMessageId));
      setInput(draftContent);
      setSelectedAttachment(draftAttachment);
      setReplyingTo(draftReply);
      setNotice({ type: "error", message: err.message || "Failed to send message." });
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (msg) => {
    try {
      let res;

      if (String(msg.sender_id) === String(userId)) {
        res = await fetch(`http://localhost:5000/api/messages/${msg.id}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      } else {
        res = await fetch("http://localhost:5000/api/messages/delete-for-me", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            messageId: msg.id,
          }),
        });
      }

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to delete message");
      }

      setMessages((prev) => prev.filter((message) => message.id !== msg.id));
      if (replyingTo?.id === msg.id) {
        setReplyingTo(null);
      }
      setOpenMenuId(null);
      dispatchMessagesRefresh();
      await broadcastChatSync("deleted-message");
      await broadcastInboxSync("deleted-message");
    } catch (err) {
      console.error(err);
      setNotice({ type: "error", message: "Failed to delete message." });
    }
  };

  const handleReport = (msg) => {
    setOpenMenuId(null);
    navigate(`/report?type=message&id=${msg.id}`);
  };

  const handleReact = async (message, reactionKey) => {
    if (reacting) return;

    setReacting(true);
    setPendingReactionKey(reactionKey);

    try {
      const currentReaction = Array.isArray(message.reactions)
        ? message.reactions.find((reaction) => reaction.reacted_by_me)?.reaction
        : null;
      const nextReaction = currentReaction === reactionKey ? null : reactionKey;

      const res = await fetch(`http://localhost:5000/api/messages/${message.id}/react`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reaction: nextReaction }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to react to message");
      }

      if (data.message) {
        setMessages((prev) =>
          prev.map((entry) => (entry.id === message.id ? data.message : entry))
        );
      }

      setReactionTargetMessage(null);
      dispatchMessagesRefresh();
      await broadcastChatSync("reacted-message");
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: "Failed to update reaction." });
    } finally {
      setReacting(false);
      setPendingReactionKey(null);
    }
  };

  const openReactionViewer = async (message) => {
    setReactionViewerLoading(true);
    setReactionViewer({
      messageId: message.id,
      reactions: [],
    });

    try {
      const res = await fetch(`http://localhost:5000/api/messages/${message.id}/reactions`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to load reactions");
      }

      setReactionViewer({
        messageId: message.id,
        reactions: data.reactions || [],
      });
    } catch (error) {
      console.error(error);
      setReactionViewer(null);
      setNotice({ type: "error", message: "Failed to load reaction viewers." });
    } finally {
      setReactionViewerLoading(false);
    }
  };

  const removeOwnReactionFromViewer = async () => {
    if (!reactionViewer?.messageId) return;

    try {
      const res = await fetch(
        `http://localhost:5000/api/messages/${reactionViewer.messageId}/react`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ reaction: null }),
        }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to remove reaction");
      }

      if (data.message) {
        setMessages((prev) =>
          prev.map((entry) => (entry.id === reactionViewer.messageId ? data.message : entry))
        );
      }

      setReactionViewer((prev) =>
        prev
          ? {
              ...prev,
              reactions: prev.reactions.filter((reaction) => !reaction.reacted_by_me),
            }
          : prev
      );
      dispatchMessagesRefresh();
      await broadcastChatSync("removed-reaction");
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: "Failed to remove reaction." });
    }
  };

  const handleDeleteConversation = async () => {
    try {
      const res = await fetch("http://localhost:5000/api/messages/delete-chats", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ chatIds: [chatId] }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to delete conversation");
      }

      setHeaderMenuOpen(false);
      dispatchMessagesRefresh();
      await broadcastInboxSync("deleted-chat");
      navigate("/messages");
    } catch (err) {
      console.error(err);
      setNotice({ type: "error", message: err.message || "Failed to delete conversation." });
    }
  };

  const handleBlockUser = async () => {
    try {
      const endpoint = blockedByMe
        ? "http://localhost:5000/api/main/unblock-user"
        : "http://localhost:5000/api/main/block-user";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ blockedUserId: otherUser.id }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Failed to ${blockedByMe ? "unblock" : "block"} user`);
      }

      setHeaderMenuOpen(false);
      setBlockedByMe((prev) => !prev);
      setInput("");
      setReplyingTo(null);
    } catch (err) {
      console.error(err);
      setNotice({
        type: "error",
        message: err.message || `Failed to ${blockedByMe ? "unblock" : "block"} user.`,
      });
    }
  };

  const handleReportUser = () => {
    setHeaderMenuOpen(false);
    navigate(`/report?type=user&id=${otherUser.id}`);
  };

  const handleAttachmentSelection = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const allowedMimeTypes = new Set([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]);
    const lowerName = String(file.name || "").toLowerCase();
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    const isDocument =
      allowedMimeTypes.has(file.type) || lowerName.endsWith(".pdf") || lowerName.endsWith(".docx");

    if (!isImage && !isVideo && !isDocument) {
      setNotice({
        type: "error",
        message: "Only images, videos, PDF, and DOCX files are allowed.",
      });
      event.target.value = "";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setNotice({
        type: "error",
        message: "Attachments must be 5MB or smaller.",
      });
      event.target.value = "";
      return;
    }

    setSelectedAttachment(file);
  };

  const clearSelectedAttachment = () => {
    setSelectedAttachment(null);
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = "";
    }
  };

  const renderMessageAttachment = (message) => {
    if (!message?.attachment_url) return null;

    if (message.attachment_type === "image") {
      return (
        <a
          href={getSafeMediaUrl(message.attachment_url)}
          target="_blank"
          rel="noreferrer"
          className="chat-attachment-image-link"
        >
          <img
            className="chat-attachment-image"
            src={getSafeMediaUrl(message.attachment_url)}
            alt={message.attachment_name || "Shared image"}
          />
        </a>
      );
    }

    if (message.attachment_type === "video") {
      return (
        <video
          className="chat-attachment-video"
          src={getSafeMediaUrl(message.attachment_url)}
          controls
          playsInline
          preload="metadata"
        />
      );
    }

    return (
      <a
        href={getSafeMediaUrl(message.attachment_url)}
        target="_blank"
        rel="noreferrer"
        className="chat-attachment-file"
      >
        <span className={`chat-attachment-file-icon ${message.attachment_type || "file"}`}>
          {getAttachmentIcon(message)}
        </span>
        <span className="chat-attachment-file-copy">
          <strong>{message.attachment_name || "Attachment"}</strong>
          <span>
            {getAttachmentKindLabel(message)}
            {message.attachment_size ? ` · ${formatFileSize(message.attachment_size)}` : ""}
          </span>
        </span>
      </a>
    );
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest(".message-options-wrapper")) {
        setOpenMenuId(null);
        setOpenMenuDirection("down");
      }

      if (!e.target.closest(".message-reaction-wrap")) {
        return;
      }

      if (!e.target.closest(".message-reaction-modal") && !e.target.closest(".message-reaction-pill")) {
        setReactionViewer(null);
      }

      if (!e.target.closest(".chat-header-menu-wrap")) {
        setHeaderMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const closeMenu = () => {
      setOpenMenuId(null);
      setOpenMenuDirection("down");
    };
    const closeOverlays = () => {
      closeMenu();
    };
    document.addEventListener("scroll", closeOverlays);

    return () => document.removeEventListener("scroll", closeOverlays);
  }, []);

  return (
    <div
      className="chat-window"
      style={{ "--chat-keyboard-offset": `${keyboardOffset}px` }}
    >
      <AeroNotice notice={notice ? { ...notice, inline: true } : null} onClose={() => setNotice(null)} />
      <div className="chat-header">
        <button className="back-btn" onClick={() => navigate(-1)} aria-label="Go back">
          <FaArrowLeft />
        </button>
        <button
          type="button"
          className="chat-user-link"
          onClick={() => navigate(`/profile/${otherUser.username}`)}
        >
          <div className="chat-user-avatar-wrap">
            <div className="chat-user-avatar">
              {otherUser.profile_pic ? (
                <img src={getSafeMediaUrl(otherUser.profile_pic)} alt={otherUserDisplayName} />
              ) : (
                <FaUserCircle />
              )}
            </div>
            {otherUserOnline && <span className="chat-user-online-dot"></span>}
          </div>
          <div className="chat-user-heading">
            <h3>
              <span className="username-with-badge">
                {otherUserDisplayName}
                <VerifiedBadge verified={otherUser.is_verified} />
              </span>
            </h3>
            <span
              className={`chat-user-status ${
                otherUserTyping ? "typing" : otherUserOnline ? "online" : ""
              }`}
            >
              {otherUserTyping ? "Typing..." : otherUserOnline ? "Online" : "Offline"}
            </span>
          </div>
        </button>
        <div className="chat-header-menu-wrap">
          <button
            className="chat-header-menu-btn"
            onClick={() => setHeaderMenuOpen((prev) => !prev)}
            aria-label="Open conversation options"
          >
            <FaCog />
          </button>

          {headerMenuOpen && (
            <div className="chat-header-dropdown">
              <button className="chat-header-dropdown-item" onClick={handleDeleteConversation}>
                Delete this conversation
              </button>
              <button className="chat-header-dropdown-item danger" onClick={handleBlockUser}>
                {blockedByMe ? "Unblock this user" : "Block this user"}
              </button>
              <button className="chat-header-dropdown-item danger" onClick={handleReportUser}>
                Report
              </button>
            </div>
          )}
        </div>
      </div>

      {isIncomingRequest && (
        <div className="chat-request-banner">
          <div>
            <strong>{otherUserDisplayName} wants to message you.</strong>
            <p>Accept the request to reply and move this conversation to your inbox.</p>
          </div>
          <div className="chat-request-actions">
            <button type="button" className="chat-request-accept" onClick={acceptMessageRequest}>
              Accept
            </button>
            <button type="button" className="chat-request-delete" onClick={deleteMessageRequest}>
              Delete
            </button>
          </div>
        </div>
      )}

      <div className="chat-messages" ref={messagesContainerRef} onScroll={updateStickiness}>
        {loading ? (
          <div className="spinner-alpha-container">
            <div className="spinner-alpha"></div>
          </div>
        ) : messages.length === 0 ? (
          <p className="empty-text">No messages yet</p>
        ) : (
          messages.map((msg, index) => {
            const isMine = String(msg.sender_id) === String(userId);
            const isLastMessage = index === 0;
            const isSendingMessage = msg.send_status === "sending";
            const bubbleClass = `message-bubble ${
              isMine && isLastMessage ? "new-message" : ""
            }`;

            return (
              <div
                key={msg.id}
                className={`message-wrapper ${isMine ? "sent" : "received"}`}
              >
                <div className="message-row">
                  {isMine && !isSendingMessage && (
                    <div className="message-options-wrapper">
                      <button
                        type="button"
                        className="message-options"
                        onClick={(event) => toggleMessageMenu(msg.id, event)}
                        aria-label="Open message options"
                      >
                        <FaEllipsisV />
                      </button>

                      {openMenuId === msg.id && (
                        <div className={`message-dropdown ${openMenuDirection === "up" ? "flip-up" : ""}`}>
                          <div className="dropdown-item" onClick={() => handleDelete(msg)}>
                            Delete
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {isMine && (
                    <button
                      type="button"
                      className="message-reply-btn"
                      onClick={() => setReplyingTo(msg)}
                      aria-label="Reply to message"
                      title="Reply"
                    >
                      <FaReply />
                    </button>
                  )}

                  {isMine && !isSendingMessage && (
                    <div className="message-reaction-wrap">
                      <button
                        type="button"
                        className="message-reaction-trigger"
                        onClick={() => setReactionTargetMessage(msg)}
                        aria-label="React to message"
                        title="React"
                      >
                        <FaRegSmileBeam />
                      </button>
                    </div>
                  )}

                  <div className={bubbleClass}>
                    {msg.reply_to_message_id && (
                      <div className="message-reply-preview">
                        <span className="message-reply-preview-label">
                          Replying to{" "}
                          {msg.reply_to_sender_id
                            ? String(msg.reply_to_sender_id) === String(userId)
                              ? "You"
                              : otherUserDisplayName
                            : "Message"}
                        </span>
                        <p>{getReplyPreviewText(msg.reply_to_content)}</p>
                      </div>
                    )}
                    {renderMessageAttachment(msg)}
                    {msg.content ? (
                      <div className="message-bubble-text">{msg.content}</div>
                    ) : null}
                  </div>

                  {!isMine && !isSendingMessage && (
                    <div className="message-reaction-wrap">
                      <button
                        type="button"
                        className="message-reaction-trigger"
                        onClick={() => setReactionTargetMessage(msg)}
                        aria-label="React to message"
                        title="React"
                      >
                        <FaRegSmileBeam />
                      </button>
                    </div>
                  )}

                  {!isMine && (
                    <button
                      type="button"
                      className="message-reply-btn"
                      onClick={() => setReplyingTo(msg)}
                      aria-label="Reply to message"
                      title="Reply"
                    >
                      <FaReply />
                    </button>
                  )}

                  {!isMine && (
                    <div className="message-options-wrapper">
                      <button
                        type="button"
                        className="message-options"
                        onClick={(event) => toggleMessageMenu(msg.id, event)}
                        aria-label="Open message options"
                      >
                        <FaEllipsisV />
                      </button>

                      {openMenuId === msg.id && (
                        <div className={`message-dropdown ${openMenuDirection === "up" ? "flip-up" : ""}`}>
                          <div className="dropdown-item" onClick={() => handleDelete(msg)}>
                            Delete
                          </div>

                          <div className="dropdown-item danger" onClick={() => handleReport(msg)}>
                            Report
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {Array.isArray(msg.reactions) && msg.reactions.length > 0 && (
                  <div className={`message-reactions ${isMine ? "sent" : "received"}`}>
                    {msg.reactions.map((reaction) => (
                    <button
                      key={reaction.reaction}
                      type="button"
                      className={`message-reaction-pill ${
                        reaction.reacted_by_me ? "active" : ""
                      }`}
                      disabled={reacting}
                      onClick={() => openReactionViewer(msg)}
                    >
                      <span>{getReactionEmoji(reaction.reaction)}</span>
                        <span>{reaction.count}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="message-meta">
                  <span className="message-time">
                    {formatMessageTime(msg.created_at)}
                  </span>

                  {isMine && (isLastMessage || isSendingMessage) && (
                    <span className="seen-status">
                      {isSendingMessage ? "Sending..." : msg.read_status ? "Seen" : "Sent"}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {isIncomingRequest ? (
        <div className="chat-blocked-banner">
          Accept this message request before replying.
        </div>
      ) : blockedByMe || blockedByThem ? (
        <div className="chat-blocked-banner">
          Sorry you can&apos;t message this user
        </div>
      ) : (
        <div className="chat-composer">
          {replyingTo && (
            <div className="chat-replying-bar">
              <div className="chat-replying-copy">
                <span>Replying to {getReplyAuthorLabel(replyingTo)}</span>
                <p>{getReplyPreviewText(replyingTo.content)}</p>
              </div>
              <button
                type="button"
                className="chat-replying-close"
                onClick={() => setReplyingTo(null)}
                aria-label="Cancel reply"
              >
                <FaTimes />
              </button>
            </div>
          )}

          {selectedAttachment && (
            <div className="chat-attachment-preview">
              <div className="chat-attachment-preview-copy">
                <span className="chat-attachment-preview-label">
                  {getAttachmentKindLabel(selectedAttachment)} ready to send
                </span>
                <strong>{selectedAttachment.name}</strong>
                <span>{formatFileSize(selectedAttachment.size)}</span>
              </div>
              <button
                type="button"
                className="chat-attachment-preview-remove"
                onClick={clearSelectedAttachment}
                aria-label="Remove selected attachment"
              >
                <FaTimes />
              </button>
            </div>
          )}

          <div className="chat-input">
            <input
              ref={attachmentInputRef}
              type="file"
              className="chat-attachment-input"
              accept="image/*,video/*,.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={handleAttachmentSelection}
            />
            <button
              type="button"
              className="chat-attachment-trigger"
              onClick={() => attachmentInputRef.current?.click()}
              disabled={sending}
              aria-label="Attach a file"
              title="Attach"
            >
              {attachmentIcon}
              
            </button>
            <input
              type="text"
              placeholder={replyingTo ? "Write your reply..." : "Type a message..."}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => {
                setTimeout(() => scrollToBottom("auto"), 120);
              }}
              onKeyDown={(e) => e.key === "Enter" && !sending && sendMessage()}
            />
            <button
              type="button"
              className="chat-send-btn"
              onClick={sendMessage}
              disabled={sending || (!input.trim() && !selectedAttachment)}
            >
              {sending ? "Sending..." : "Send"}
            </button>
          </div>
        </div>
      )}

      {reactionViewer && (
        <div className="message-reaction-modal-backdrop">
          <div className="message-reaction-modal">
            <div className="message-reaction-modal-header">
              <div>
                <h4>Reactions</h4>
                <p>See who reacted to this message.</p>
              </div>
              <button
                type="button"
                className="message-reaction-modal-close"
                onClick={() => setReactionViewer(null)}
                aria-label="Close reactions viewer"
              >
                <FaTimes />
              </button>
            </div>

            {reactionViewerLoading ? (
              <p className="message-reaction-modal-empty">Loading reactions...</p>
            ) : reactionViewer.reactions.length === 0 ? (
              <p className="message-reaction-modal-empty">No reactions yet.</p>
            ) : (
              <div className="message-reaction-modal-list">
                {reactionViewer.reactions.map((reaction) => (
                  <div key={`${reaction.user_id}-${reaction.reaction}`} className="message-reaction-modal-item">
                    <div className="message-reaction-modal-user">
                      <div className="message-reaction-modal-avatar">
                        {reaction.profile_pic ? (
                          <img
                            src={getSafeMediaUrl(reaction.profile_pic)}
                            alt={getDisplayName(reaction)}
                          />
                        ) : (
                          <FaUserCircle />
                        )}
                      </div>
                      <div className="message-reaction-modal-copy">
                        <strong>{getDisplayName(reaction)}</strong>
                        <span>
                          {getReactionEmoji(reaction.reaction)} {reaction.reaction}
                        </span>
                      </div>
                    </div>
                    {reaction.reacted_by_me && (
                      <button
                        type="button"
                        className="message-reaction-remove-btn"
                        onClick={removeOwnReactionFromViewer}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {reactionTargetMessage && (
        <div className="message-reaction-picker-modal-backdrop">
          <div className="message-reaction-picker-modal">
            <div className="message-reaction-picker-header">
              <div>
                <h4>React to message</h4>
                <p>Choose one reaction.</p>
              </div>
              <button
                type="button"
                className="message-reaction-modal-close"
                onClick={() => setReactionTargetMessage(null)}
                aria-label="Close reaction picker"
              >
                <FaTimes />
              </button>
            </div>
            <div className="message-reaction-picker-grid">
              {reactionOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className="message-reaction-choice-large"
                  disabled={reacting}
                  onClick={() => handleReact(reactionTargetMessage, option.key)}
                >
                  <span>{option.emoji}</span>
                  <span>{reacting && pendingReactionKey === option.key ? "Sending..." : option.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
