import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FaUser } from "react-icons/fa";
import "../css/FollowListPage.css";
import { getSafeMediaUrl } from "../utils/mediaUrl";
import VerifiedBadge from "../components/VerifiedBadge";
import FollowSuggestions from "../components/FollowSuggestions";

export default function FollowListPage() {
  const navigate = useNavigate();
  const { username, type } = useParams();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [togglingMap, setTogglingMap] = useState({});
  const [ownerUsername, setOwnerUsername] = useState(username);
  const [ownerVerified, setOwnerVerified] = useState(false);

  const pageTitle = type === "following" ? "Following" : "Followers";

  useEffect(() => {
    const fetchAccounts = async () => {
      const token = localStorage.getItem("token");
      if (!token) return;

      setLoading(true);

      try {
        const res = await fetch(
          `http://localhost:5000/api/follow/list?username=${encodeURIComponent(username)}&type=${type}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.message || "Failed to fetch follow list");
        }

        setOwnerUsername(data.user?.username || username);
        setOwnerVerified(Boolean(data.user?.is_verified));
        setAccounts(data.accounts || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchAccounts();
  }, [username, type]);

  const toggleFollow = async (account) => {
    const token = localStorage.getItem("token");
    if (!token || account.is_self || togglingMap[account.id]) return;

    setTogglingMap((prev) => ({ ...prev, [account.id]: true }));

    const previous = account.is_following;
    const previousRequested = account.requested;

    setAccounts((prev) =>
      prev.map((item) =>
        item.id === account.id
          ? { ...item, is_following: !previous, requested: false }
          : item
      )
    );

    try {
      const res = await fetch("http://localhost:5000/api/follow/toggle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username: account.username }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Failed to update follow status");
      }

      setAccounts((prev) =>
        prev.map((item) =>
          item.id === account.id
            ? {
                ...item,
                is_following: Boolean(data.following),
                requested: Boolean(data.requested),
              }
            : item
        )
      );
    } catch (err) {
      console.error(err);
      setAccounts((prev) =>
        prev.map((item) =>
          item.id === account.id
            ? { ...item, is_following: previous, requested: previousRequested }
            : item
        )
      );
    } finally {
      setTogglingMap((prev) => {
        const next = { ...prev };
        delete next[account.id];
        return next;
      });
    }
  };

  return (
    <div className="follow-list-page">
      <div className="follow-list-card">
        <div className="follow-list-header">
          <button className="follow-list-back" onClick={() => navigate(-1)}>
            &larr;
          </button>

          <div className="follow-list-header-text">
            <h2>{pageTitle}</h2>
            <p className="follow-list-owner">
              <span className="username-with-badge">
                @{ownerUsername}
                <VerifiedBadge verified={ownerVerified} />
              </span>
            </p>
          </div>
        </div>

        {loading ? (
          <div className="follow-list-loading">
            <div className="follow-list-spinner"></div>
            <p>Loading {pageTitle.toLowerCase()}...</p>
          </div>
        ) : (
          <>
            <FollowSuggestions
              variant="follow-list"
              limit={10}
              contextUsername={ownerUsername}
            />

            {accounts.length === 0 ? (
              <p className="follow-list-empty">No {pageTitle.toLowerCase()} yet</p>
            ) : (
              <div className="follow-list-items">
                {accounts.map((account) => (
                  <div key={account.id} className="follow-list-item">
                    <div
                      className="follow-list-user"
                      onClick={() => navigate(`/profile/${account.username}`)}
                    >
                      <div className="follow-list-avatar">
                        {account.profile_pic ? (
                          <img src={getSafeMediaUrl(account.profile_pic)} alt={account.username} />
                        ) : (
                          <FaUser />
                        )}
                      </div>

                      <div className="follow-list-user-text">
                        <span className="follow-list-username">
                          <span className="username-with-badge">
                            {account.username}
                            <VerifiedBadge verified={account.is_verified} />
                          </span>
                        </span>
                        <span className="follow-list-subtitle">
                          {account.is_self ? "You" : `@${account.username}`}
                        </span>
                      </div>
                    </div>

                    {!account.is_self && (
                      <button
                        className={`follow-list-action ${account.is_following ? "following" : ""}`}
                        onClick={() => toggleFollow(account)}
                        disabled={!!togglingMap[account.id]}
                      >
                        {togglingMap[account.id]
                          ? "..."
                          : account.is_following
                            ? "Unfollow"
                            : account.requested
                              ? "Requested"
                              : account.is_private
                                ? "Request"
                                : "Follow"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
