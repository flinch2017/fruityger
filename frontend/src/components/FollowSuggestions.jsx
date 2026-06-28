import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaUser } from "react-icons/fa";
import "../css/FollowSuggestions.css";
import { getSafeMediaUrl } from "../utils/mediaUrl";
import { formatCount } from "../utils/countFormatter";
import VerifiedBadge from "./VerifiedBadge";

export default function FollowSuggestions({ variant = "inline", limit = 5 }) {
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState({ creators: [], people: [] });
  const [loading, setLoading] = useState(false);
  const [busyUsername, setBusyUsername] = useState("");

  const hasSuggestions = suggestions.creators.length > 0 || suggestions.people.length > 0;

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem("token");
    if (!token) return undefined;

    const loadSuggestions = async () => {
      setLoading(true);

      try {
        const res = await fetch(`http://localhost:5000/api/follow/suggestions?limit=${limit}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.message || "Failed to load suggestions");
        }

        if (!cancelled) {
          const creators = Array.isArray(data.creators) ? data.creators : [];
          const creatorIds = new Set(creators.map((account) => account.id));
          setSuggestions({
            creators,
            people: (Array.isArray(data.people) ? data.people : []).filter(
              (account) => !creatorIds.has(account.id)
            ),
          });
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
  }, [limit]);

  const removeSuggestion = (username) => {
    setSuggestions((current) => ({
      creators: current.creators.filter((item) => item.username !== username),
      people: current.people.filter((item) => item.username !== username),
    }));
  };

  const handleFollow = async (event, account) => {
    event.stopPropagation();
    const token = localStorage.getItem("token");
    if (!token || busyUsername) return;

    setBusyUsername(account.username);

    try {
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

      if (data.following || data.requested) {
        removeSuggestion(account.username);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setBusyUsername("");
    }
  };

  const sections = useMemo(
    () => [
      {
        key: "creators",
        title: "Follow these creators",
        subtitle: "Fresh posters your feed can learn from.",
        accounts: suggestions.creators,
      },
      {
        key: "people",
        title: "People you may know",
        subtitle: "Shared circles, interests, and nearby taste.",
        accounts: suggestions.people,
      },
    ].filter((section) => section.accounts.length > 0),
    [suggestions]
  );

  if (loading && !hasSuggestions) {
    return (
      <aside className={`follow-suggestions ${variant}`}>
        <div className="follow-suggestions-loading">Finding people to follow...</div>
      </aside>
    );
  }

  if (!hasSuggestions) {
    return null;
  }

  return (
    <aside className={`follow-suggestions ${variant}`}>
      {sections.map((section) => (
        <section key={section.key} className="follow-suggestion-section">
          <div className="follow-suggestion-heading">
            <h2>{section.title}</h2>
            <p>{section.subtitle}</p>
          </div>

          <div className="follow-suggestion-list">
            {section.accounts.map((account) => (
              <div
                key={`${section.key}-${account.id}`}
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
                  className="follow-suggestion-action"
                  onClick={(event) => handleFollow(event, account)}
                >
                  {busyUsername === account.username
                    ? "..."
                    : account.is_private
                      ? "Request"
                      : "Follow"}
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </aside>
  );
}
