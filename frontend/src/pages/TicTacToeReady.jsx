import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FaArrowLeft, FaBolt, FaCrown, FaPlay, FaUsers } from "react-icons/fa";
import "../css/GameLobby.css";

const API_BASE = "http://localhost:5000/api/game-lobbies";
const COUNTDOWN_SECONDS = 10;

const requestJson = async (path) => {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
};

function ReadyTeam({ mark, title, players = [], isMine }) {
  return (
    <div className={`tic-ready-team ${isMine ? "mine" : ""}`}>
      <div className="tic-result-team-head">
        <div>
          <span>{mark.toUpperCase()} Team</span>
          <h2>{title}</h2>
        </div>
        {isMine ? <FaCrown /> : <FaUsers />}
      </div>

      <div className="tic-result-player-list">
        {players.map((player) => (
          <div key={player.id} className="tic-result-player">
            <div className="game-team-avatar">{player.username?.slice(0, 2).toUpperCase()}</div>
            <div>
              <strong>@{player.username}</strong>
              <span>Turn {player.turn_order}</span>
            </div>
            <div className="tic-result-player-meta">
              <span>
                <FaBolt />
                Ready
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TicTacToeReady() {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);

  const matchPath = `/games/tic-tac-toe/match/${matchId}`;

  const loadMatch = useCallback(async () => {
    try {
      const data = await requestJson(`/matches/${matchId}`);
      setMatch(data.match);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load match");
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    loadMatch();
  }, [loadMatch]);

  useEffect(() => {
    if (loading || error) return undefined;

    const intervalId = window.setInterval(() => {
      setSecondsLeft((current) => Math.max(current - 1, 0));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [error, loading]);

  useEffect(() => {
    if (!loading && !error && secondsLeft === 0) {
      navigate(matchPath, { replace: true });
    }
  }, [error, loading, matchPath, navigate, secondsLeft]);

  const teamSummary = useMemo(() => {
    if (!match) return "";
    const xCount = match.teams?.x?.length || 0;
    const oCount = match.teams?.o?.length || 0;
    return `${xCount} vs ${oCount} players`;
  }, [match]);

  if (loading) {
    return (
      <div className="tic-ready-page">
        <div className="game-lobby-status">Loading match teams...</div>
      </div>
    );
  }

  return (
    <div className="tic-ready-page">
      <section className="tic-ready-hero">
        <button type="button" className="game-secondary-action" onClick={() => navigate("/games/tic-tac-toe")}>
          <FaArrowLeft />
          Lobby
        </button>

        {error ? (
          <div className="game-lobby-alert error">{error}</div>
        ) : (
          <>
            <div className="tic-ready-count" aria-live="polite">
              {secondsLeft}
            </div>
            <p>Match Found</p>
            <h1>{match.lobby_x_title} vs {match.lobby_o_title}</h1>
            <span>{teamSummary}. Starting automatically.</span>
            <button type="button" className="game-primary-action" onClick={() => navigate(matchPath, { replace: true })}>
              <FaPlay />
              Start Now
            </button>
          </>
        )}
      </section>

      {match && !error && (
        <section className="tic-ready-teams">
          <ReadyTeam
            mark="x"
            title={match.lobby_x_title}
            players={match.teams?.x}
            isMine={match.my_mark === "x"}
          />
          <ReadyTeam
            mark="o"
            title={match.lobby_o_title}
            players={match.teams?.o}
            isMine={match.my_mark === "o"}
          />
        </section>
      )}
    </div>
  );
}
