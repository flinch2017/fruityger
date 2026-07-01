import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaUser } from "react-icons/fa";
import "../css/FollowSuggestions.css";
import { getSafeMediaUrl } from "../utils/mediaUrl";
import { formatCount } from "../utils/countFormatter";
import VerifiedBadge from "./VerifiedBadge";

export default function FollowSuggestions({
  variant = "inline",
  limit = 8,
  contextUsername = "",
  onFollowed,
}) {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyUsername, setBusyUsername] = useState("");

  const hasSuggestions = accounts.length > 0;

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem("token");
    if (!token) return undefined;

    const loadSuggestions = async () => {
      setLoading(true);

      try {
        const params = new URLSearchParams({ limit: String(limit) });
        if (contextUsername) {
          params.set("contextUsername", contextUsername);
        }

        const res = await fetch(
          `http://localhost:5000/api/follow/suggestions?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.message || "Failed to load suggestions");
        }

        if (!cancelled) {
          const incomingAccounts = Array.isArray(data.accounts)
            ? data.accounts
            : [
                ...(Array.isArray(data.creators) ? data.creators : []),
                ...(Array.isArray(data.people) ? data.people : []),
              ];
          const seen = new Set();

          setAccounts(
            incomingAccounts.filter((account) => {
              if (!account?.id || seen.has(account.id)) return false;
              seen.add(account.id);
              return true;
            })
          );
        }
      } catch (error) {
        if (!cancelled) {
          console.error(error);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadSuggestions();

    return () => {
      cancelled = true;
    };
  }, [contextUsername, limit]);

  const removeSuggestion = (username) => {
    setAccounts((current) => current.filter((item) => item.username !== username));
  };

  const updateSuggestion = (username, updates) => {
    setAccounts((current) =>
      current.map((item) => (item.username === username ? { ...item, ...updates } : item))
    );
  };

  const getActionLabel = (account) => {
    if (busyUsername === account.username) return "...";
    if (account.requested) return "Requested";
    if (account.requested_me) return "Accept";
    return account.is_private ? "Request" : "Follow";
  };

  const handleFollow = async (event, account) => {
    event.stopPropagation();
    const token = localStorage.getItem("token");
    if (!token || busyUsername) return;
    if (account.requested) return;

    setBusyUsername(account.username);

    try {
      if (account.requested_me) {
        const res = await fetch(`http://localhost:5000/api/follow/requests/${account.id}/accept`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.message || "Failed to accept follow request");
        }

        removeSuggestion(account.username);
        onFollowed?.(account, { accepted: true });
        return;
      }

      const res = await fetch("http://localhost:5000/api/follow/toggle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username: account.username }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "Failed to follow account");
      }

      if (data.following) {
        removeSuggestion(account.username);
        onFollowed?.(account, data);
      } else if (data.requested) {
        updateSuggestion(account.username, { requested: true, reason: "Request pending" });
        onFollowed?.(account, data);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setBusyUsername("");
    }
  };

  const suggestionCards = useMemo(
    () =>
      accounts.map((account) => (
        <div
          key={account.id}
          className="follow-suggestion-card"
          onClick={() => navigate(`/profile/${account.username}`)}
        >
          <span className="follow-suggestion-avatar">
            {account.profile_pic ? (
              <img src={getSafeMediaUrl(account.profile_pic)} alt={account.username} />
            ) : (
              <FaUser />
            )}
          </span>

          <span className="follow-suggestion-copy">
            <strong className="username-with-badge">
              {account.username}
              <VerifiedBadge verified={account.is_verified} />
            </strong>
            <span>{account.reason || "Suggested for you"}</span>
            <small>
              {formatCount(account.followers_count)} followers
              {account.posts_count ? ` · ${formatCount(account.posts_count)} posts` : ""}
            </small>
          </span>

          <button
            type="button"
            className={`follow-suggestion-action ${account.requested ? "disabled" : ""}`}
            onClick={(event) => handleFollow(event, account)}
            disabled={busyUsername === account.username || account.requested}
          >
            {getActionLabel(account)}
          </button>
        </div>
      )),
    [accounts, busyUsername, navigate]
  );

  if (loading && !hasSuggestions) {
    return (
      <aside className={`follow-suggestions ${variant}`}>
        <div className="follow-suggestions-loading">Finding suggested accounts...</div>
      </aside>
    );
  }

  if (!hasSuggestions) {
    return null;
  }

  return (
    <aside className={`follow-suggestions ${variant}`}>
      <section className="follow-suggestion-section">
        <div className="follow-suggestion-heading">
          <h2>Suggested accounts</h2>
          <p>Based on your follows, interests, and recent posts.</p>
        </div>

        <div className="follow-suggestion-list">{suggestionCards}</div>
      </section>
    </aside>
  );
}
