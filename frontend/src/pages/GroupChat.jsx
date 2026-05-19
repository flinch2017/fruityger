import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  FaArrowLeft,
  FaCog,
  FaEllipsisV,
  FaFileAlt,
  FaFilePdf,
  FaFileWord,
  FaPlayCircle,
  FaRegSmileBeam,
  FaReply,
  FaTimes,
  FaUserCircle,
  FaUserPlus,
  FaUsers,
} from "react-icons/fa";
import supabase from "../lib/supabaseClient";
import AeroNotice from "../components/AeroNotice";
import "../css/Chat.css";
import { getSafeMediaUrl } from "../utils/mediaUrl";

export default function GroupChat() {
  const reactionOptions = [
    { key: "heart", emoji: "\u2764\uFE0F", label: "Heart" },
    { key: "laugh", emoji: "\u{1F602}", label: "Laugh" },
    { key: "sad", emoji: "\u{1F622}", label: "Sad" },
    { key: "angry", emoji: "\u{1F621}", label: "Angry" },
    { key: "care", emoji: "\u{1F917}", label: "Care" },
  ];

  const { groupChatId } = useParams();
  const navigate = useNavigate();
  const token = localStorage.getItem("token");
  const userId = localStorage.getItem("userId");

  const [groupChat, setGroupChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [sending, setSending] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [openMenuDirection, setOpenMenuDirection] = useState("down");
  const [replyingTo, setReplyingTo] = useState(null);
  const [reactionTargetMessage, setReactionTargetMessage] = useState(null);
  const [reacting, setReacting] = useState(false);
  const [pendingReactionKey, setPendingReactionKey] = useState(null);
  const [reactionViewer, setReactionViewer] = useState(null);
  const [reactionViewerLoading, setReactionViewerLoading] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [nameModalOpen, setNameModalOpen] = useState(false);
  const [draftGroupName, setDraftGroupName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [membersModalOpen, setMembersModalOpen] = useState(false);
  const [membersTab, setMembersTab] = useState("members");
  const [membersPayload, setMembersPayload] = useState({ members: [], admins: [] });
  const [membersLoading, setMembersLoading] = useState(false);
  const [pendingMemberAddRequests, setPendingMemberAddRequests] = useState([]);
  const [pendingRequestsLoading, setPendingRequestsLoading] = useState(false);
  const [addMembersModalOpen, setAddMembersModalOpen] = useState(false);
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [memberSearchResults, setMemberSearchResults] = useState([]);
  const [selectedNewMembers, setSelectedNewMembers] = useState([]);
  const [searchingMembers, setSearchingMembers] = useState(false);
  const [addingMembers, setAddingMembers] = useState(false);
  const [savingGroupSettings, setSavingGroupSettings] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [selectedNextAdminId, setSelectedNextAdminId] = useState("");

  const messagesContainerRef = useRef(null);
  const previousMessagesLengthRef = useRef(0);
  const shouldStickToBottomRef = useRef(true);
  const refreshTimeoutRef = useRef(null);
  const attachmentInputRef = useRef(null);
  const groupImageInputRef = useRef(null);
  const headerMenuRef = useRef(null);
  const memberSearchTimeoutRef = useRef(null);
  const isMountedRef = useRef(true);

  const memberCount = groupChat?.members?.length || 0;
  const isAdmin = Array.isArray(groupChat?.admin_user_ids)
    ? groupChat.admin_user_ids.some((adminId) => String(adminId) === String(userId))
    : false;
  const adminCount = Array.isArray(groupChat?.admin_user_ids) ? groupChat.admin_user_ids.length : 0;
  const eligibleNextAdmins = (groupChat?.members || []).filter(
    (member) => String(member.id) !== String(userId)
  );
  const requiresAdminTransferBeforeLeaving = isAdmin && adminCount === 1 && eligibleNextAdmins.length > 0;
  const memberAddRequiresAdminApproval = Boolean(groupChat?.member_add_requires_admin_approval);
  const canDirectlyAddMembers = isAdmin || !memberAddRequiresAdminApproval;
  const canRequestAddMembers = !isAdmin && memberAddRequiresAdminApproval;

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

  const getReplyAuthorLabel = (message) => {
    if (!message) return "Message";
    return String(message.sender_id) === String(userId)
      ? "You"
      : message.sender_username || "Member";
  };

  const getReplyPreviewText = (content) => {
    const safeContent = (content || "Original message unavailable").trim();
    return safeContent.length > 90 ? `${safeContent.slice(0, 90)}...` : safeContent;
  };

  const getReactionEmoji = (reactionKey) =>
    reactionOptions.find((option) => option.key === reactionKey)?.emoji || "\u2764\uFE0F";

  const getAttachmentKindLabel = (attachment) => {
    if (!attachment) return "";
    if (attachment.attachment_type === "image" || attachment.type?.startsWith("image/")) return "Image";
    if (attachment.attachment_type === "video" || attachment.type?.startsWith("video/")) return "Video";
    if (attachment.attachment_type === "pdf" || attachment.type === "application/pdf") return "PDF";
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

  const fetchGroupChatSnapshot = async ({ showLoading = false } = {}) => {
    if (!token || !isMountedRef.current) return;

    if (showLoading) {
      setLoading(true);
    }

    try {
      const res = await fetch(`http://localhost:5000/api/messages/groups/chats/${groupChatId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch group chat");
      }

      if (!isMountedRef.current) return;
      setGroupChat(data.groupChat || null);
      setMessages([...(data.messages || [])].reverse());
      dispatchMessagesRefresh();
    } catch (error) {
      console.error(error);
      if (!isMountedRef.current) return;
      setNotice({ type: "error", message: error.message || "Failed to load group chat." });
    } finally {
      if (showLoading && isMountedRef.current) {
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

    if (currentLength > previousLength && (shouldStickToBottomRef.current || isOwnLatestMessage)) {
      scrollToBottom(previousLength === 0 ? "auto" : "smooth");
    }

    previousMessagesLengthRef.current = currentLength;
  }, [messages, userId]);

  useEffect(() => {
    isMountedRef.current = true;

    const init = async () => {
      await fetchGroupChatSnapshot({ showLoading: true });
      scrollToBottom("auto");
    };

    init();

    const channel = supabase
      .channel(`group-chat-${groupChatId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_messages", filter: `group_chat_id=eq.${groupChatId}` },
        async () => {
          await fetchGroupChatSnapshot();
          setTimeout(() => scrollToBottom("smooth"), 40);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_chat_members", filter: `group_chat_id=eq.${groupChatId}` },
        async () => {
          await fetchGroupChatSnapshot();
        }
      )
      .subscribe();

    return () => {
      isMountedRef.current = false;
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      try {
        supabase.removeChannel(channel);
      } catch (error) {
        console.error("Failed to cleanup group chat realtime channel:", error);
      }
    };
  }, [groupChatId, token]);

  useEffect(() => {
    if (!addMembersModalOpen) {
      setMemberSearchQuery("");
      setMemberSearchResults([]);
      setSelectedNewMembers([]);
      return;
    }

    const query = memberSearchQuery.trim();
    if (!query) {
      setMemberSearchResults([]);
      return;
    }

    if (memberSearchTimeoutRef.current) {
      clearTimeout(memberSearchTimeoutRef.current);
    }

    memberSearchTimeoutRef.current = setTimeout(async () => {
      setSearchingMembers(true);

      try {
        const res = await fetch(
          `http://localhost:5000/api/messages/search-users?q=${encodeURIComponent(query)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Failed to search users");
        }

        const selectedIds = new Set(selectedNewMembers.map((member) => String(member.id)));
        const existingIds = new Set((groupChat?.members || []).map((member) => String(member.id)));

        const users = Array.isArray(data) ? data : (data.users || []);

        setMemberSearchResults(
          users.filter((user) => {
            const id = String(user.id);
            return !selectedIds.has(id) && !existingIds.has(id);
          })
        );
      } catch (error) {
        console.error(error);
        setNotice({ type: "error", message: error.message || "Failed to search users." });
      } finally {
        setSearchingMembers(false);
      }
    }, 250);

    return () => {
      if (memberSearchTimeoutRef.current) {
        clearTimeout(memberSearchTimeoutRef.current);
      }
    };
  }, [addMembersModalOpen, memberSearchQuery, token, selectedNewMembers, groupChat?.members]);

  useEffect(() => {
    const updateKeyboardOffset = () => {
      if (!window.visualViewport) {
        setKeyboardOffset(0);
        return;
      }

      const viewport = window.visualViewport;
      const overlap = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setKeyboardOffset(overlap);
    };

    updateKeyboardOffset();

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", updateKeyboardOffset);
      window.visualViewport.addEventListener("scroll", updateKeyboardOffset);
    } else {
      window.addEventListener("resize", updateKeyboardOffset);
    }

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", updateKeyboardOffset);
        window.visualViewport.removeEventListener("scroll", updateKeyboardOffset);
      } else {
        window.removeEventListener("resize", updateKeyboardOffset);
      }
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      const target = event.target;
      const isElement = target instanceof Element;

      if (
        headerMenuOpen &&
        headerMenuRef.current &&
        (!isElement || !headerMenuRef.current.contains(target))
      ) {
        setHeaderMenuOpen(false);
      }

      if (openMenuId && (!isElement || !target.closest(".message-options-wrapper"))) {
        setOpenMenuId(null);
        setOpenMenuDirection("down");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [headerMenuOpen, openMenuId]);

  useEffect(() => {
    const closeOverlays = () => {
      setOpenMenuId(null);
      setOpenMenuDirection("down");
    };

    document.addEventListener("scroll", closeOverlays);

    return () => document.removeEventListener("scroll", closeOverlays);
  }, []);

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

  const sendMessage = async () => {
    if ((!input.trim() && !selectedAttachment) || sending) return;

    setSending(true);

    try {
      const formData = new FormData();
      formData.append("content", input);
      formData.append("replyToMessageId", replyingTo?.id || "");
      if (selectedAttachment) {
        formData.append("attachment", selectedAttachment);
      }

      const res = await fetch(`http://localhost:5000/api/messages/groups/chats/${groupChatId}/send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to send group message");
      }

      setMessages((prev) => [data, ...prev]);
      setInput("");
      setReplyingTo(null);
      setSelectedAttachment(null);
      if (attachmentInputRef.current) {
        attachmentInputRef.current.value = "";
      }
      scrollToBottom("smooth");
      dispatchMessagesRefresh();
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: error.message || "Failed to send group message." });
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (msg) => {
    try {
      let res;

      if (String(msg.sender_id) === String(userId)) {
        res = await fetch(`http://localhost:5000/api/messages/groups/messages/${msg.id}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      } else {
        res = await fetch("http://localhost:5000/api/messages/groups/messages/delete-for-me", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ messageId: msg.id }),
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
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: error.message || "Failed to delete message." });
    }
  };

  const handleReport = (msg) => {
    setOpenMenuId(null);
    navigate(`/report?type=group-message&id=${msg.id}`);
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

      const res = await fetch(`http://localhost:5000/api/messages/groups/messages/${message.id}/react`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reaction: nextReaction }),
      });

      const data = await res.json().catch(() => ({}));
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
      const res = await fetch(`http://localhost:5000/api/messages/groups/messages/${message.id}/reactions`, {
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
        `http://localhost:5000/api/messages/groups/messages/${reactionViewer.messageId}/react`,
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
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: "Failed to remove reaction." });
    }
  };

  const openMembersModal = async () => {
    setMembersLoading(true);
    setPendingRequestsLoading(isAdmin);
    setMembersModalOpen(true);
    setHeaderMenuOpen(false);

    try {
      const [membersRes, requestsRes] = await Promise.all([
        fetch(`http://localhost:5000/api/messages/groups/chats/${groupChatId}/members`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        isAdmin
          ? fetch(`http://localhost:5000/api/messages/groups/chats/${groupChatId}/member-add-requests`, {
              headers: { Authorization: `Bearer ${token}` },
            })
          : Promise.resolve(null),
      ]);

      const membersData = await membersRes.json().catch(() => ({}));
      if (!membersRes.ok) {
        throw new Error(membersData.error || "Failed to load group members");
      }
      applyMembersPayload(membersData);

      if (isAdmin && requestsRes) {
        const requestsData = await requestsRes.json().catch(() => ({}));
        if (!requestsRes.ok) {
          throw new Error(requestsData.error || "Failed to load member requests");
        }
        setPendingMemberAddRequests(Array.isArray(requestsData.requests) ? requestsData.requests : []);
      } else {
        setPendingMemberAddRequests([]);
      }
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: error.message || "Failed to load members." });
      setMembersModalOpen(false);
    } finally {
      setMembersLoading(false);
      setPendingRequestsLoading(false);
    }
  };

  const openNameModal = () => {
    setDraftGroupName(groupChat?.group_name || "");
    setNameModalOpen(true);
    setHeaderMenuOpen(false);
  };

  const openAddMembersModal = () => {
    if ((!canDirectlyAddMembers && !canRequestAddMembers) || actionLoading) return;
    setAddMembersModalOpen(true);
    setHeaderMenuOpen(false);
    setMemberSearchQuery("");
    setMemberSearchResults([]);
    setSelectedNewMembers([]);
  };

  const applyMembersPayload = (data) => {
    const nextMembers = data.members || [];
    const nextAdmins = data.admins || [];

    setMembersPayload({
      members: nextMembers,
      admins: nextAdmins,
    });

    setGroupChat((prev) =>
      prev
        ? {
            ...prev,
            admin_user_ids: nextAdmins.map((member) => member.id),
            members: nextMembers,
          }
        : prev
    );
  };

  const saveGroupName = async () => {
    if (!draftGroupName.trim() || savingName) return;

    setSavingName(true);

    try {
      const res = await fetch(`http://localhost:5000/api/messages/groups/chats/${groupChatId}/name`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ groupName: draftGroupName.trim() }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to change group name");
      }

      setGroupChat((prev) => (prev ? { ...prev, group_name: data.group_name } : prev));
      setNameModalOpen(false);
      dispatchMessagesRefresh();
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: error.message || "Failed to change group name." });
    } finally {
      setSavingName(false);
    }
  };

  const addMemberCandidate = (member) => {
    setSelectedNewMembers((prev) =>
      prev.some((entry) => String(entry.id) === String(member.id)) ? prev : [...prev, member]
    );
    setMemberSearchResults((prev) => prev.filter((entry) => String(entry.id) !== String(member.id)));
    setMemberSearchQuery("");
  };

  const removeSelectedNewMember = (memberId) => {
    setSelectedNewMembers((prev) => prev.filter((entry) => String(entry.id) !== String(memberId)));
  };

  const saveMemberAddSetting = async (value) => {
    if (!isAdmin || savingGroupSettings) return;

    setSavingGroupSettings(true);

    try {
      const res = await fetch(`http://localhost:5000/api/messages/groups/chats/${groupChatId}/settings`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ memberAddRequiresAdminApproval: value }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to update group settings");
      }

      setGroupChat((prev) =>
        prev
          ? {
              ...prev,
              member_add_requires_admin_approval: Boolean(data.member_add_requires_admin_approval),
            }
          : prev
      );
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: error.message || "Failed to update group settings." });
    } finally {
      setSavingGroupSettings(false);
    }
  };

  const submitAddMembers = async () => {
    if ((!canDirectlyAddMembers && !canRequestAddMembers) || addingMembers || selectedNewMembers.length === 0) return;

    setAddingMembers(true);

    try {
      const endpoint = canDirectlyAddMembers
        ? `http://localhost:5000/api/messages/groups/chats/${groupChatId}/members`
        : `http://localhost:5000/api/messages/groups/chats/${groupChatId}/member-add-requests`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          memberIds: selectedNewMembers.map((member) => member.id),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to add members");
      }

      if (canDirectlyAddMembers) {
        applyMembersPayload(data);
      } else {
        setNotice({ type: "success", message: "Request submitted. Admin approval is required." });
      }
      setAddMembersModalOpen(false);
      setSelectedNewMembers([]);
      setMemberSearchResults([]);
      setMemberSearchQuery("");
      dispatchMessagesRefresh();
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: error.message || "Failed to add members." });
    } finally {
      setAddingMembers(false);
    }
  };

  const reviewMemberAddRequest = async (requestId, action) => {
    if (!isAdmin || actionLoading) return;

    setActionLoading(true);

    try {
      const res = await fetch(
        `http://localhost:5000/api/messages/groups/chats/${groupChatId}/member-add-requests/${requestId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ action }),
        }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to review member request");
      }

      setPendingMemberAddRequests((prev) => prev.filter((entry) => entry.id !== requestId));
      const membersRes = await fetch(`http://localhost:5000/api/messages/groups/chats/${groupChatId}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const membersData = await membersRes.json().catch(() => ({}));
      if (membersRes.ok) {
        applyMembersPayload(membersData);
      }
      dispatchMessagesRefresh();
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: error.message || "Failed to review member request." });
    } finally {
      setActionLoading(false);
    }
  };

  const updateAdminStatus = async (memberId, shouldBeAdmin) => {
    if (!isAdmin || actionLoading) return;

    setActionLoading(true);

    try {
      const res = await fetch(
        `http://localhost:5000/api/messages/groups/chats/${groupChatId}/admins/${memberId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ isAdmin: shouldBeAdmin }),
        }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to update admin status");
      }

      applyMembersPayload(data);
      dispatchMessagesRefresh();
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: error.message || "Failed to update admin status." });
    } finally {
      setActionLoading(false);
    }
  };

  const handleGroupImageSelection = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setHeaderMenuOpen(false);
    setActionLoading(true);

    try {
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch(`http://localhost:5000/api/messages/groups/chats/${groupChatId}/image`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to change group image");
      }

      setGroupChat((prev) => (prev ? { ...prev, group_image: data.group_image } : prev));
      dispatchMessagesRefresh();
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: error.message || "Failed to change group image." });
    } finally {
      if (groupImageInputRef.current) {
        groupImageInputRef.current.value = "";
      }
      setActionLoading(false);
    }
  };

  const handleLeaveGroup = async () => {
    if (actionLoading) return;

    if (requiresAdminTransferBeforeLeaving) {
      setSelectedNextAdminId((currentValue) => currentValue || eligibleNextAdmins[0]?.id || "");
      setLeaveModalOpen(true);
      setHeaderMenuOpen(false);
      return;
    }

    await submitLeaveGroup();
  };

  const submitLeaveGroup = async (successorAdminId = null) => {
    if (actionLoading) return;

    setActionLoading(true);
    setHeaderMenuOpen(false);

    try {
      const res = await fetch(`http://localhost:5000/api/messages/groups/chats/${groupChatId}/leave`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(successorAdminId ? { successorAdminId } : {}),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to leave group");
      }

      setLeaveModalOpen(false);
      setSelectedNextAdminId("");
      dispatchMessagesRefresh();
      navigate("/messages");
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: error.message || "Failed to leave group." });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (actionLoading) return;

    setActionLoading(true);
    setHeaderMenuOpen(false);

    try {
      const res = await fetch(`http://localhost:5000/api/messages/groups/chats/${groupChatId}/delete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete group chat");
      }

      dispatchMessagesRefresh();
      navigate("/messages");
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", message: error.message || "Failed to delete group chat." });
    } finally {
      setActionLoading(false);
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
            src={getSafeMediaUrl(message.attachment_url)}
            alt={message.attachment_name || "Shared image"}
            className="chat-attachment-image"
          />
        </a>
      );
    }

    if (message.attachment_type === "video") {
      return (
        <video className="chat-attachment-video" controls playsInline preload="metadata">
          <source src={getSafeMediaUrl(message.attachment_url)} type={message.attachment_mime || "video/mp4"} />
        </video>
      );
    }

    return (
      <a
        href={getSafeMediaUrl(message.attachment_url)}
        target="_blank"
        rel="noreferrer"
        className="chat-attachment-file"
      >
        <span className="chat-attachment-file-icon">{getAttachmentIcon(message)}</span>
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

  const formatMessageTime = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const memberPreview = useMemo(() => {
    const names = (groupChat?.members || [])
      .map((member) => member.username)
      .slice(0, 4)
      .join(", ");

    return names || "Group conversation";
  }, [groupChat]);

  const handleBackNavigation = () => {
    navigate("/messages");
  };

  return (
    <div className="chat-window" style={{ "--chat-keyboard-offset": `${keyboardOffset}px` }}>
      <AeroNotice notice={notice ? { ...notice, inline: true } : null} onClose={() => setNotice(null)} />

      <div className="chat-header">
        <button className="back-btn" onClick={handleBackNavigation} aria-label="Go back">
          <FaArrowLeft />
        </button>

        <div className="chat-user-link group-chat-link">
          <div className="chat-user-avatar-wrap">
            <div className="chat-user-avatar">
              {groupChat?.group_image ? (
                <img src={getSafeMediaUrl(groupChat.group_image)} alt={groupChat.group_name || "Group chat"} />
              ) : (
                <FaUsers />
              )}
            </div>
          </div>
          <div className="chat-user-heading">
            <h3>{groupChat?.group_name || "Group chat"}</h3>
            <span className="chat-user-status">{memberCount} members · {memberPreview}</span>
          </div>
        </div>

        <div ref={headerMenuRef} className="chat-header-menu-wrap">
          <input
            ref={groupImageInputRef}
            type="file"
            accept="image/*"
            className="chat-attachment-input"
            onChange={handleGroupImageSelection}
          />
          <button
            className="chat-header-menu-btn"
            onClick={() => setHeaderMenuOpen((prev) => !prev)}
            aria-label="Open group options"
          >
            <FaCog />
          </button>

          {headerMenuOpen && (
            <div className="chat-header-dropdown">
              <button
                className="chat-header-dropdown-item"
                onClick={() => {
                  setHeaderMenuOpen(false);
                  groupImageInputRef.current?.click();
                }}
                disabled={!isAdmin || actionLoading}
              >
                Change group image
              </button>
              <button
                className="chat-header-dropdown-item"
                onClick={openNameModal}
                disabled={!isAdmin || actionLoading}
              >
                Change group name
              </button>
              <button className="chat-header-dropdown-item" onClick={openMembersModal}>
                View members
              </button>
              <button
                className="chat-header-dropdown-item"
                onClick={openAddMembersModal}
                disabled={(!canDirectlyAddMembers && !canRequestAddMembers) || actionLoading}
              >
                {canDirectlyAddMembers ? "Add members" : "Request add members"}
              </button>
              <button className="chat-header-dropdown-item danger" onClick={handleLeaveGroup} disabled={actionLoading}>
                Leave group
              </button>
              <button className="chat-header-dropdown-item danger" onClick={handleDeleteGroup} disabled={actionLoading}>
                Delete group chat
              </button>
            </div>
          )}
        </div>
      </div>

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
            const bubbleClass = `message-bubble ${isMine && isLastMessage ? "new-message" : ""}`;

            return (
              <div key={msg.id} className={`message-wrapper ${isMine ? "sent" : "received"}`}>
                <div className="message-row">
                  {isMine && (
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

                  {isMine && (
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
                    {!isMine && (
                      <button
                        type="button"
                        className="group-message-sender"
                        onClick={() => navigate(`/profile/${msg.sender_username}`)}
                      >
                        {msg.sender_username || "Member"}
                      </button>
                    )}
                    {msg.reply_to_message_id && (
                      <div className="message-reply-preview">
                        <span className="message-reply-preview-label">
                          Replying to {msg.reply_to_sender_id
                            ? String(msg.reply_to_sender_id) === String(userId)
                              ? "You"
                              : msg.reply_to_sender_username || "Member"
                            : "Message"}
                        </span>
                        <p>{getReplyPreviewText(msg.reply_to_content)}</p>
                      </div>
                    )}
                    {renderMessageAttachment(msg)}
                    {msg.content ? <div className="message-bubble-text">{msg.content}</div> : null}
                  </div>

                  {!isMine && (
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
                        className={`message-reaction-pill ${reaction.reacted_by_me ? "active" : ""}`}
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
                  <span className="message-time">{formatMessageTime(msg.created_at)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

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
                          <img src={getSafeMediaUrl(reaction.profile_pic)} alt={reaction.username} />
                        ) : (
                          <FaUserCircle />
                        )}
                      </div>
                      <div className="message-reaction-modal-copy">
                        <strong>{reaction.username}</strong>
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
                <h4>Pick a reaction</h4>
                <p>Choose one reaction for this message.</p>
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
                  className={`message-reaction-choice-large ${
                    pendingReactionKey === option.key ? "active" : ""
                  }`}
                  disabled={reacting}
                  onClick={() => handleReact(reactionTargetMessage, option.key)}
                >
                  <span>{option.emoji}</span>
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {nameModalOpen && (
        <div className="message-reaction-modal-backdrop">
          <div className="message-reaction-modal group-settings-modal">
            <div className="message-reaction-modal-header">
              <div>
                <h4>Change group name</h4>
                <p>Give the chat a fresher title.</p>
              </div>
              <button
                type="button"
                className="message-reaction-modal-close"
                onClick={() => setNameModalOpen(false)}
                aria-label="Close group name modal"
              >
                <FaTimes />
              </button>
            </div>

            <input
              type="text"
              className="group-settings-input"
              value={draftGroupName}
              onChange={(e) => setDraftGroupName(e.target.value)}
              placeholder="Weekend plans"
              maxLength={60}
            />

            <div className="group-settings-actions">
              <button type="button" className="messages-action-btn" onClick={() => setNameModalOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="messages-action-btn primary"
                onClick={saveGroupName}
                disabled={savingName || !draftGroupName.trim()}
              >
                {savingName ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {membersModalOpen && (
        <div className="message-reaction-modal-backdrop">
          <div className="message-reaction-modal group-settings-modal members-settings-modal">
            <div className="message-reaction-modal-header">
              <div>
                <h4>People in this group</h4>
                <p>Messenger-style member list for the room.</p>
              </div>
              <button
                type="button"
                className="message-reaction-modal-close"
                onClick={() => setMembersModalOpen(false)}
                aria-label="Close members modal"
              >
                <FaTimes />
              </button>
            </div>

            <div className="group-members-tabs">
              <button
                type="button"
                className={`group-members-tab ${membersTab === "members" ? "active" : ""}`}
                onClick={() => setMembersTab("members")}
              >
                Members
              </button>
              <button
                type="button"
                className={`group-members-tab ${membersTab === "admins" ? "active" : ""}`}
                onClick={() => setMembersTab("admins")}
              >
                Admins
              </button>
              {isAdmin && (
                <button
                  type="button"
                  className={`group-members-tab ${membersTab === "requests" ? "active" : ""}`}
                  onClick={() => setMembersTab("requests")}
                >
                  Requests
                </button>
              )}
            </div>

            {membersLoading ? (
              <p className="message-reaction-modal-empty">Loading people...</p>
            ) : membersTab === "requests" ? (
              pendingRequestsLoading ? (
                <p className="message-reaction-modal-empty">Loading requests...</p>
              ) : pendingMemberAddRequests.length === 0 ? (
                <p className="message-reaction-modal-empty">No pending member requests.</p>
              ) : (
                <div className="message-reaction-modal-list">
                  {pendingMemberAddRequests.map((request) => (
                    <div key={request.id} className="message-reaction-modal-item group-request-item">
                      <div className="message-reaction-modal-user">
                        <div className="message-reaction-modal-avatar">
                          {request.requester?.profile_pic ? (
                            <img src={getSafeMediaUrl(request.requester.profile_pic)} alt={request.requester.username} />
                          ) : (
                            <FaUserCircle />
                          )}
                        </div>
                        <div className="message-reaction-modal-copy">
                          <strong>{request.requester?.username || "Member"} requested</strong>
                          <span>
                            {(request.requested_members || []).map((member) => member.username).join(", ") || "No members"}
                          </span>
                        </div>
                      </div>
                      <div className="group-request-actions">
                        <button
                          type="button"
                          className="message-reaction-remove-btn"
                          onClick={() => reviewMemberAddRequest(request.id, "approve")}
                          disabled={actionLoading}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="message-reaction-remove-btn"
                          onClick={() => reviewMemberAddRequest(request.id, "reject")}
                          disabled={actionLoading}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div className="message-reaction-modal-list">
                {(membersTab === "admins" ? membersPayload.admins : membersPayload.members).map((member) => (
                  <div key={member.id} className="message-reaction-modal-item">
                    <div className="message-reaction-modal-user">
                      <div className="message-reaction-modal-avatar">
                        {member.profile_pic ? (
                          <img src={getSafeMediaUrl(member.profile_pic)} alt={member.username} />
                        ) : (
                          <FaUserCircle />
                        )}
                      </div>
                      <div className="message-reaction-modal-copy">
                        <strong>{member.username}</strong>
                        <span>{member.is_admin ? "Admin" : "Member"}</span>
                      </div>
                    </div>
                    {isAdmin && membersTab === "members" && !member.is_admin ? (
                      <button
                        type="button"
                        className="message-reaction-remove-btn"
                        onClick={() => updateAdminStatus(member.id, true)}
                        disabled={actionLoading}
                      >
                        Add as admin
                      </button>
                    ) : null}
                    {isAdmin && membersTab === "admins" ? (
                      <button
                        type="button"
                        className="message-reaction-remove-btn"
                        onClick={() => updateAdminStatus(member.id, false)}
                        disabled={actionLoading}
                      >
                        Remove as admin
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {addMembersModalOpen && (
        <div className="message-reaction-modal-backdrop">
          <div className="message-reaction-modal group-settings-modal members-settings-modal">
            <div className="message-reaction-modal-header">
              <div>
                <h4>Add members</h4>
                <p>Add people to this group chat.</p>
              </div>
              <button
                type="button"
                className="message-reaction-modal-close"
                onClick={() => setAddMembersModalOpen(false)}
                aria-label="Close add members modal"
              >
                <FaTimes />
              </button>
            </div>

            {isAdmin && (
              <label className="group-member-approval-toggle">
                <input
                  type="checkbox"
                  checked={memberAddRequiresAdminApproval}
                  disabled={savingGroupSettings}
                  onChange={(event) => saveMemberAddSetting(event.target.checked)}
                />
                <span>Require admin approval before adding members</span>
              </label>
            )}

            <input
              type="text"
              className="group-settings-input"
              placeholder="Search users to add..."
              value={memberSearchQuery}
              onChange={(event) => setMemberSearchQuery(event.target.value)}
            />

            {selectedNewMembers.length > 0 && (
              <div className="group-member-chip-list">
                {selectedNewMembers.map((member) => (
                  <span key={member.id} className="group-member-chip">
                    <span>{member.username}</span>
                    <button type="button" onClick={() => removeSelectedNewMember(member.id)} aria-label={`Remove ${member.username}`}>
                      <FaTimes />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="message-reaction-modal-list">
              {searchingMembers ? (
                <p className="message-reaction-modal-empty">Searching users...</p>
              ) : memberSearchResults.length === 0 ? (
                <p className="message-reaction-modal-empty">No users to add.</p>
              ) : (
                memberSearchResults.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    className="message-reaction-modal-item group-add-member-item"
                    onClick={() => addMemberCandidate(member)}
                  >
                    <div className="message-reaction-modal-user">
                      <div className="message-reaction-modal-avatar">
                        {member.profile_pic ? (
                          <img src={getSafeMediaUrl(member.profile_pic)} alt={member.username} />
                        ) : (
                          <FaUserCircle />
                        )}
                      </div>
                      <div className="message-reaction-modal-copy">
                        <strong>{member.username}</strong>
                        <span>Tap to add</span>
                      </div>
                    </div>
                    <FaUserPlus />
                  </button>
                ))
              )}
            </div>

            <div className="group-settings-actions">
              <button
                type="button"
                className="messages-action-btn"
                onClick={() => setAddMembersModalOpen(false)}
                disabled={addingMembers}
              >
                Cancel
              </button>
              <button
                type="button"
                className="messages-action-btn primary"
                onClick={submitAddMembers}
                disabled={addingMembers || selectedNewMembers.length === 0}
              >
                {addingMembers ? "Adding..." : "Add selected members"}
              </button>
            </div>
          </div>
        </div>
      )}

      {leaveModalOpen && (
        <div className="message-reaction-modal-backdrop">
          <div className="message-reaction-modal group-settings-modal members-settings-modal">
            <div className="message-reaction-modal-header">
              <div>
                <h4>Choose the next admin</h4>
                <p>Select a member to take over admin duties before you leave.</p>
              </div>
              <button
                type="button"
                className="message-reaction-modal-close"
                onClick={() => {
                  if (actionLoading) return;
                  setLeaveModalOpen(false);
                }}
                aria-label="Close leave group modal"
              >
                <FaTimes />
              </button>
            </div>

            <div className="message-reaction-modal-list">
              {eligibleNextAdmins.map((member) => (
                <label key={member.id} className="message-reaction-modal-item group-admin-option">
                  <div className="message-reaction-modal-user">
                    <div className="message-reaction-modal-avatar">
                      {member.profile_pic ? (
                        <img src={getSafeMediaUrl(member.profile_pic)} alt={member.username} />
                      ) : (
                        <FaUserCircle />
                      )}
                    </div>
                    <div className="message-reaction-modal-copy">
                      <strong>{member.username}</strong>
                      <span>{member.is_admin ? "Already an admin" : "Member"}</span>
                    </div>
                  </div>
                  <input
                    type="radio"
                    name="next-admin"
                    checked={String(selectedNextAdminId) === String(member.id)}
                    onChange={() => setSelectedNextAdminId(member.id)}
                    disabled={actionLoading}
                  />
                </label>
              ))}
            </div>

            <div className="group-settings-actions">
              <button
                type="button"
                className="messages-action-btn"
                onClick={() => setLeaveModalOpen(false)}
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="messages-action-btn danger"
                onClick={() => submitLeaveGroup(selectedNextAdminId)}
                disabled={actionLoading || !selectedNextAdminId}
              >
                {actionLoading ? "Leaving..." : "Leave group"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

