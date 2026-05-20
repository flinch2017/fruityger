import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FaArrowLeft, FaGamepad, FaSignal, FaUsers } from "react-icons/fa";
import "../css/GameLobby.css";
import supabase from "../lib/supabaseClient";

const API_BASE = "http://localhost:5000/api/game-lobbies";

const getToken = () => localStorage.getItem("token");

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

export default function TicTacToeMatch() {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const channelRef = useRef(null);
  const refreshTimeoutRef = useRef(null);
  const matchStatusRef = useRef("active");
  const currentUserId = localStorage.getItem("userId") || "";
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyCell, setBusyCell] = useState(null);
  const [error, setError] = useState("");
  const [exiting, setExiting] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState("CONNECTING");
  const [aiThinking, setAiThinking] = useState(false);

  const loadMatch = useCallback(
    async ({ quiet = false } = {}) => {
      if (!matchId || !getToken()) return;
      if (quiet) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const data = await requestJson(`/matches/${matchId}`);
        setMatch(data.match);
        setError("");
      } catch (err) {
        setError(err.message || "Failed to load match");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [matchId]
  );

  useEffect(() => {
    loadMatch();
  }, [loadMatch]);

  useEffect(() => {
    if (match?.status) {
      matchStatusRef.current = match.status;
    }
  }, [match?.status]);

  const updatePresence = useCallback(
    async (status, { keepalive = false } = {}) => {
      if (!matchId || !getToken()) return;
      if (status === "afk" && matchStatusRef.current === "finished") return;

      const token = getToken();
      fetch(`${API_BASE}/matches/${matchId}/presence`, {
        method: "POST",
        keepalive,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status }),
      })
        .then((res) => (keepalive ? null : res.json().catch(() => null)))
        .then((data) => {
          if (data?.match) {
            setMatch(data.match);
          }
        })
        .catch(() => null);
    },
    [matchId]
  );

  useEffect(() => {
    updatePresence("active");

    return () => {
      updatePresence("afk", { keepalive: true });
    };
  }, [updatePresence]);

  useEffect(() => {
    if (!matchId) return undefined;

    const scheduleRealtimeRefresh = () => {
      window.clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = window.setTimeout(() => {
        loadMatch({ quiet: true });
      }, 90);
    };

    const channel = supabase
      .channel(`tic-tac-toe-match-${matchId}`)
      .on("broadcast", { event: "match-updated" }, ({ payload }) => {
        if (!payload || String(payload.matchId) !== String(matchId)) return;
        if (String(payload.actorId) === String(currentUserId)) return;
        scheduleRealtimeRefresh();
      })
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "game_matches",
          filter: `id=eq.${matchId}`,
        },
        scheduleRealtimeRefresh
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "game_match_moves",
          filter: `match_id=eq.${matchId}`,
        },
        scheduleRealtimeRefresh
      )
      .subscribe((status) => {
        setRealtimeStatus(status);
        if (status === "SUBSCRIBED") {
          scheduleRealtimeRefresh();
        }
      });

    channelRef.current = channel;

    return () => {
      channelRef.current = null;
      window.clearTimeout(refreshTimeoutRef.current);
      supabase.removeChannel(channel);
    };
  }, [currentUserId, loadMatch, matchId]);

  useEffect(() => {
    const handleFocus = () => {
      updatePresence("active");
      loadMatch({ quiet: true });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        updatePresence("active");
        loadMatch({ quiet: true });
      } else {
        updatePresence("afk", { keepalive: true });
      }
    };
    const handlePageHide = () => updatePresence("afk", { keepalive: true });

    window.addEventListener("focus", handleFocus);
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadMatch, updatePresence]);

  useEffect(() => {
    if (!match || match.status !== "finished") return undefined;

    setExiting(true);
    const timeoutId = window.setTimeout(() => {
      navigate(`/games/tic-tac-toe/match/${match.id}/result`, { replace: true });
    }, 1800);

    return () => window.clearTimeout(timeoutId);
  }, [match, navigate]);

  useEffect(() => {
    if (!match || match.status !== "active" || !match.current_turn_is_afk || aiThinking) {
      return undefined;
    }

    const timeoutId = window.setTimeout(async () => {
      setAiThinking(true);
      try {
        const data = await requestJson(`/matches/${match.id}/ai-move`, { method: "POST" });
        setMatch(data.match);
        channelRef.current
          ?.send({
            type: "broadcast",
            event: "match-updated",
            payload: {
              matchId: match.id,
              actorId: `ai-${match.current_turn_user_id}`,
              moveCount: data.match?.moves?.length || 0,
              status: data.match?.status,
            },
          })
          .catch(() => null);
      } catch {
        await loadMatch({ quiet: true });
      } finally {
        setAiThinking(false);
      }
    }, 1200);

    return () => window.clearTimeout(timeoutId);
  }, [aiThinking, loadMatch, match]);

  const boardSize = match?.board_size || 5;
  const board = useMemo(() => {
    const cells = Array(boardSize * boardSize).fill("");
    (match?.moves || []).forEach((move) => {
      cells[move.cell_index] = move.mark.toUpperCase();
    });
    return cells;
  }, [boardSize, match]);

  const playMove = async (cellIndex) => {
    if (!match?.can_move || match.status !== "active" || board[cellIndex]) return;
    setBusyCell(cellIndex);
    setError("");

    try {
      const data = await requestJson(`/matches/${match.id}/move`, {
        method: "POST",
        body: JSON.stringify({ cellIndex }),
      });
      setMatch(data.match);
      channelRef.current
        ?.send({
          type: "broadcast",
          event: "match-updated",
          payload: {
            matchId: match.id,
            actorId: currentUserId,
            moveCount: data.match?.moves?.length || 0,
            status: data.match?.status,
          },
        })
        .catch(() => null);
    } catch (err) {
      setError(err.message || "Failed to play move");
      await loadMatch({ quiet: true });
    } finally {
      setBusyCell(null);
    }
  };

  const statusText = (() => {
    if (!match) return "";
    if (match.status === "finished") {
      if (match.is_draw) return "Draw game";
      const won = match.winner_mark === match.my_mark;
      return won ? "Your team wins" : "Your team lost";
    }
    if (match.can_move) return "Your turn";
    if (match.current_turn_is_afk) {
      return aiThinking
        ? `AI is playing for @${match.current_turn_username}`
        : `@${match.current_turn_username} is AFK`;
    }
    return `Waiting for @${match.current_turn_username}`;
  })();

  if (loading) {
    return (
      <div className="tic-match-page">
        <div className="game-lobby-status">Loading match...</div>
      </div>
    );
  }

  return (
    <div className="tic-match-page">
      <header className="tic-match-topbar">
        <button type="button" className="game-secondary-action" onClick={() => navigate("/games")}>
          <FaArrowLeft />
          Hub
        </button>
        <div className="tic-match-title">
          <span className="game-lobby-mark">
            <FaGamepad />
          </span>
          <div>
            <p>Tic Tac Toe</p>
            <h1>{match ? `${match.lobby_x_title} vs ${match.lobby_o_title}` : "Match"}</h1>
          </div>
        </div>
        <div className="game-secondary-action tic-live-indicator" aria-live="polite">
          <FaSignal />
          {refreshing
            ? "Updating"
            : realtimeStatus === "SUBSCRIBED"
              ? "Live sync"
              : "Connecting"}
        </div>
      </header>

      {error && <div className="game-lobby-alert error">{error}</div>}

      {match && (
        <main className="tic-match-shell">
          <section className="tic-match-score">
            <div>
              <span>X Team</span>
              <strong>{match.lobby_x_title}</strong>
            </div>
            <div className="tic-match-status">
              <span>You are {match.my_mark.toUpperCase()}</span>
              <strong>{statusText}</strong>
              {exiting && <small>Opening match results...</small>}
            </div>
            <div>
              <span>O Team</span>
              <strong>{match.lobby_o_title}</strong>
            </div>
          </section>

          <section className="tic-board-stage">
            <div
              className="tic-tac-toe-board tic-tac-toe-board-large"
              style={{ "--tic-board-size": boardSize }}
              aria-label="Tic tac toe board"
            >
              {board.map((value, index) => (
                <button
                  key={index}
                  type="button"
                  className={`tic-cell ${
                    match.winning_line?.includes(index) ? "winner" : ""
                  }`.trim()}
                  onClick={() => playMove(index)}
                  disabled={
                    Boolean(value) ||
                    !match.can_move ||
                    match.status !== "active" ||
                    busyCell !== null
                  }
                >
                  {busyCell === index ? "" : value}
                </button>
              ))}
            </div>
          </section>

          <footer className="tic-match-bottom">
            <span>
              <FaUsers />
              5x5 board
            </span>
            <span>First team to connect {match.win_length || 4} wins</span>
            <span>
              Turn: @{match.current_turn_username || "waiting"}
              {match.current_turn_is_afk ? " (AFK)" : ""}
            </span>
          </footer>
        </main>
      )}
    </div>
  );
}
