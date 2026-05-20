import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaCheck,
  FaClock,
  FaCrown,
  FaGamepad,
  FaPaperPlane,
  FaPlay,
  FaPlus,
  FaSearch,
  FaSignOutAlt,
  FaTimes,
  FaUsers,
} from "react-icons/fa";
import "../css/GameLobby.css";
import { formatCount } from "../utils/countFormatter";
import supabase from "../lib/supabaseClient";

const API_BASE = "http://localhost:5000/api/game-lobbies";

const getToken = () => localStorage.getItem("token");

const memberCount = (lobby) => lobby?.members?.length || 0;

const requestJson = async (path, options = {}) => {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
};

function TeamAvatars({ members = [] }) {
  return (
    <div className="game-team-avatars">
      {members.slice(0, 5).map((member) => (
        <span key={member.id} className="game-team-avatar" title={`@${member.username}`}>
          {member.username?.slice(0, 2).toUpperCase()}
        </span>
      ))}
    </div>
  );
}

function LobbyRow({ lobby, action, actionLabel, disabled }) {
  return (
    <div className="game-room-row">
      <div className="game-room-main">
        <strong>{lobby.title}</strong>
        <span>Hosted by @{lobby.host_username}</span>
        <TeamAvatars members={lobby.members} />
      </div>
      <div className="game-room-meta">
        <span>
          <FaUsers />
          {memberCount(lobby)}/{lobby.max_team_size}
        </span>
        <span>
          <FaClock />
          {lobby.status === "matchmaking" ? "Finding match" : "Open"}
        </span>
        {action && (
          <button type="button" className="game-mini-action" onClick={action} disabled={disabled}>
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export default function GameLobby() {
  const navigate = useNavigate();
  const refreshTimeoutRef = useRef(null);
  const [dashboard, setDashboard] = useState({
    availableLobbies: [],
    myLobbies: [],
    activeMatches: [],
    invites: [],
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [title, setTitle] = useState("");
  const [maxTeamSize, setMaxTeamSize] = useState(1);
  const [inviteQuery, setInviteQuery] = useState("");
  const [userResults, setUserResults] = useState([]);
  const [searchingUsers, setSearchingUsers] = useState(false);

  const currentUserId = localStorage.getItem("userId");

  const activeMatches = dashboard.activeMatches || [];
  const activeMatchId = activeMatches[0]?.id || "";
  const currentLobby = useMemo(
    () => (dashboard.myLobbies || []).find((lobby) => lobby.status !== "matched") || null,
    [dashboard.myLobbies]
  );
  const isHost = currentLobby?.host_id === currentUserId;

  const fetchDashboard = useCallback(async ({ quiet = false } = {}) => {
    if (!getToken()) return;
    if (quiet) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const data = await requestJson("");
      setDashboard(data);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load lobbies");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    const scheduleRealtimeRefresh = () => {
      window.clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = window.setTimeout(() => {
        fetchDashboard({ quiet: true });
      }, 120);
    };

    const channel = supabase
      .channel("tic-tac-toe-lobby-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "game_lobbies" }, scheduleRealtimeRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_lobby_members" }, scheduleRealtimeRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_lobby_invites" }, scheduleRealtimeRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_lobby_join_requests" }, scheduleRealtimeRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_matches" }, scheduleRealtimeRefresh)
      .subscribe();

    return () => {
      window.clearTimeout(refreshTimeoutRef.current);
      supabase.removeChannel(channel);
    };
  }, [fetchDashboard]);

  useEffect(() => {
    if (activeMatchId) {
      navigate(`/games/tic-tac-toe/match/${activeMatchId}/ready`, { replace: true });
    }
  }, [activeMatchId, navigate]);

  useEffect(() => {
    const keyword = inviteQuery.trim();
    if (!keyword || keyword.length < 2 || !currentLobby) {
      setUserResults([]);
      setSearchingUsers(false);
      return undefined;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setSearchingUsers(true);
      try {
        const data = await requestJson(`/users?q=${encodeURIComponent(keyword)}`);
        if (!cancelled) {
          const existingMemberIds = new Set(currentLobby.members?.map((member) => member.id));
          setUserResults((data.users || []).filter((user) => !existingMemberIds.has(user.id)));
        }
      } catch {
        if (!cancelled) setUserResults([]);
      } finally {
        if (!cancelled) setSearchingUsers(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [inviteQuery, currentLobby]);

  const runAction = async (key, action, successMessage) => {
    setBusyKey(key);
    setError("");
    setNotice("");

    try {
      const result = await action();
      if (successMessage) setNotice(successMessage);
      if (!result?.skipRefresh) {
        await fetchDashboard({ quiet: true });
      }
    } catch (err) {
      setError(err.message || "Action failed");
    } finally {
      setBusyKey("");
    }
  };

  const createLobby = () =>
    runAction(
      "create",
      async () => {
        const data = await requestJson("", {
          method: "POST",
          body: JSON.stringify({ title, maxTeamSize }),
        });
        setTitle("");
        setMaxTeamSize(data.lobby?.max_team_size || maxTeamSize);
      },
      "Lobby created."
    );

  const inviteUser = (user) =>
    runAction(
      `invite-${user.id}`,
      async () => {
        await requestJson(`/${currentLobby.id}/invite`, {
          method: "POST",
          body: JSON.stringify({ userId: user.id }),
        });
        setInviteQuery("");
        setUserResults([]);
      },
      `Invite sent to @${user.username}.`
    );

  const respondToInvite = (invite, action) =>
    runAction(
      `invite-${invite.id}-${action}`,
      () =>
        requestJson(`/invites/${invite.id}/respond`, {
          method: "POST",
          body: JSON.stringify({ action }),
        }),
      action === "accept" ? "Joined lobby." : "Invite declined."
    );

  const requestToJoin = (lobby) =>
    runAction(
      `request-${lobby.id}`,
      () => requestJson(`/${lobby.id}/join-requests`, { method: "POST" }),
      "Join request sent."
    );

  const respondToJoinRequest = (request, action) =>
    runAction(
      `join-${request.id}-${action}`,
      () =>
        requestJson(`/join-requests/${request.id}/respond`, {
          method: "POST",
          body: JSON.stringify({ action }),
        }),
      action === "accept" ? "Player added to the lobby." : "Request declined."
    );

  const startMatchmaking = () =>
    runAction(
      `matchmake-${currentLobby.id}`,
      async () => {
        const data = await requestJson(`/${currentLobby.id}/matchmake`, { method: "POST" });
        if (data.match?.id) {
          navigate(`/games/tic-tac-toe/match/${data.match.id}/ready`, { replace: true });
          return { skipRefresh: true };
        }
        if (data.waiting) {
          setNotice("Matchmaking started. Waiting for a same-size team.");
        }
        return null;
      },
      ""
    );

  const leaveLobby = () =>
    runAction(
      `leave-${currentLobby.id}`,
      () => requestJson(`/${currentLobby.id}`, { method: "DELETE" }),
      isHost ? "Lobby closed." : "Left lobby."
    );

  if (loading) {
    return (
      <div className="game-lobby-page">
        <div className="game-lobby-status">Loading game lobby...</div>
      </div>
    );
  }

  return (
    <div className="game-lobby-page">
      <section className="game-lobby-command">
        <div className="game-lobby-title">
          <span className="game-lobby-mark">
            <FaGamepad />
          </span>
          <div>
            <p>Tic Tac Toe</p>
            <h1>Build your team</h1>
          </div>
        </div>

        <button
          type="button"
          className="game-secondary-action"
          onClick={() => fetchDashboard({ quiet: true })}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </section>

      {(error || notice) && (
        <div className={`game-lobby-alert ${error ? "error" : ""}`}>{error || notice}</div>
      )}

      <section className="game-lobby-overview">
        <div className="game-lobby-stat">
          <span>{formatCount(dashboard.availableLobbies?.length || 0)}</span>
          <p>Open lobbies</p>
        </div>
        <div className="game-lobby-stat">
          <span>{formatCount(activeMatches.length)}</span>
          <p>Live matches</p>
        </div>
        <div className="game-lobby-stat">
          <span>{formatCount(dashboard.invites?.length || 0)}</span>
          <p>Invites</p>
        </div>
      </section>

      <section className="game-lobby-main">
        <div className="game-lobby-catalog">
          {!currentLobby && (
            <div className="game-create-panel">
              <div className="game-section-heading">
                <div>
                  <p>Create lobby</p>
                  <h2>Host a tic tac toe team</h2>
                </div>
                <FaPlus />
              </div>

              <div className="game-create-form">
                <label>
                  Lobby name
                  <input
                    type="text"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Weekend tic tac toe"
                    maxLength={60}
                  />
                </label>
                <label>
                  Team slots
                  <select
                    value={maxTeamSize}
                    onChange={(event) => setMaxTeamSize(Number(event.target.value))}
                  >
                    {[1, 2, 3, 4, 5].map((size) => (
                      <option key={size} value={size}>
                        {size} {size === 1 ? "player" : "players"}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="game-primary-action"
                  onClick={createLobby}
                  disabled={busyKey === "create"}
                >
                  <FaPlus />
                  {busyKey === "create" ? "Creating..." : "Create Lobby"}
                </button>
              </div>
            </div>
          )}

          {dashboard.invites?.length > 0 && (
            <div className="game-list-panel">
              <div className="game-room-heading">
                <h3>Your invites</h3>
                <span>{dashboard.invites.length}</span>
              </div>
              {dashboard.invites.map((invite) => (
                <div key={invite.id} className="game-request-row">
                  <div>
                    <strong>{invite.title}</strong>
                    <span>Invited by @{invite.inviter_username}</span>
                  </div>
                  <div className="game-request-actions">
                    <button
                      type="button"
                      className="game-icon-action accept"
                      onClick={() => respondToInvite(invite, "accept")}
                      disabled={busyKey === `invite-${invite.id}-accept`}
                    >
                      <FaCheck />
                    </button>
                    <button
                      type="button"
                      className="game-icon-action decline"
                      onClick={() => respondToInvite(invite, "decline")}
                      disabled={busyKey === `invite-${invite.id}-decline`}
                    >
                      <FaTimes />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="game-list-panel">
            <div className="game-room-heading">
              <h3>Available lobbies</h3>
              <span>{dashboard.availableLobbies?.length || 0}</span>
            </div>
            {dashboard.availableLobbies?.length ? (
              dashboard.availableLobbies.map((lobby) => (
                <LobbyRow
                  key={lobby.id}
                  lobby={lobby}
                  action={() => requestToJoin(lobby)}
                  actionLabel={lobby.has_pending_request ? "Requested" : "Request"}
                  disabled={lobby.has_pending_request || busyKey === `request-${lobby.id}`}
                />
              ))
            ) : (
              <div className="game-room-empty">No open tic tac toe lobbies right now.</div>
            )}
          </div>
        </div>

        <aside className="game-lobby-detail green">
          <div className="game-detail-top">
            <span className="game-detail-icon">
              <FaCrown />
            </span>
            <div>
              <p>Your team</p>
              <h2>{currentLobby ? currentLobby.title : "No lobby yet"}</h2>
            </div>
          </div>

          {currentLobby ? (
            <>
              <div className="game-detail-metrics">
                <span>
                  <FaUsers />
                  {memberCount(currentLobby)}/{currentLobby.max_team_size}
                </span>
                <span>
                  <FaClock />
                  {currentLobby.status}
                </span>
              </div>

              <div className="game-member-list">
                {currentLobby.members?.map((member) => (
                  <div key={member.id} className="game-member-row">
                    <span className="game-team-avatar">{member.username?.slice(0, 2).toUpperCase()}</span>
                    <div>
                      <strong>@{member.username}</strong>
                      <span>{member.role === "host" ? "Host" : "Member"}</span>
                    </div>
                  </div>
                ))}
              </div>

              {isHost && currentLobby.status !== "matched" && (
                <>
                  <div className="game-invite-box">
                    <div className="game-lobby-search compact">
                      <FaSearch />
                      <input
                        type="search"
                        value={inviteQuery}
                        onChange={(event) => setInviteQuery(event.target.value)}
                        placeholder="Invite by username"
                      />
                    </div>
                    {searchingUsers && <div className="game-room-empty">Searching...</div>}
                    {userResults.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        className="game-user-result"
                        onClick={() => inviteUser(user)}
                        disabled={busyKey === `invite-${user.id}`}
                      >
                        <span>@{user.username}</span>
                        <FaPaperPlane />
                      </button>
                    ))}
                  </div>

                  {currentLobby.pending_requests?.length > 0 && (
                    <div className="game-pending-box">
                      <div className="game-room-heading">
                        <h3>Join requests</h3>
                        <span>{currentLobby.pending_requests.length}</span>
                      </div>
                      {currentLobby.pending_requests.map((request) => (
                        <div key={request.id} className="game-request-row">
                          <div>
                            <strong>@{request.requester_username}</strong>
                            <span>wants to join</span>
                          </div>
                          <div className="game-request-actions">
                            <button
                              type="button"
                              className="game-icon-action accept"
                              onClick={() => respondToJoinRequest(request, "accept")}
                              disabled={busyKey === `join-${request.id}-accept`}
                            >
                              <FaCheck />
                            </button>
                            <button
                              type="button"
                              className="game-icon-action decline"
                              onClick={() => respondToJoinRequest(request, "decline")}
                              disabled={busyKey === `join-${request.id}-decline`}
                            >
                              <FaTimes />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {currentLobby.pending_invites?.length > 0 && (
                    <div className="game-pending-box">
                      <div className="game-room-heading">
                        <h3>Pending invites</h3>
                        <span>{currentLobby.pending_invites.length}</span>
                      </div>
                      {currentLobby.pending_invites.map((invite) => (
                        <div key={invite.id} className="game-request-row muted">
                          <div>
                            <strong>@{invite.invitee_username}</strong>
                            <span>invited</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              <div className="game-detail-actions">
                {isHost && currentLobby.status !== "matched" && (
                  <button
                    type="button"
                    className="game-primary-action"
                    onClick={startMatchmaking}
                    disabled={
                      busyKey === `matchmake-${currentLobby.id}` ||
                      currentLobby.status === "matchmaking"
                    }
                  >
                    <FaPlay />
                    {currentLobby.status === "matchmaking"
                      ? "Finding Match..."
                      : "Start Matchmaking"}
                  </button>
                )}
                {currentLobby.status !== "matched" && (
                  <button
                    type="button"
                    className="game-secondary-action danger"
                    onClick={leaveLobby}
                    disabled={busyKey === `leave-${currentLobby.id}`}
                  >
                    <FaSignOutAlt />
                    {isHost ? "Close Lobby" : "Leave Lobby"}
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="game-detail-description">
              Create a lobby or request to join one. Hosts approve manual requests before players
              are added.
            </p>
          )}
        </aside>
      </section>
    </div>
  );
}
