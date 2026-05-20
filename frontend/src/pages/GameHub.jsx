import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaBolt,
  FaChessKnight,
  FaCrown,
  FaGamepad,
  FaPlay,
  FaSignal,
  FaUsers,
} from "react-icons/fa";
import "../css/GameLobby.css";
import { formatCount } from "../utils/countFormatter";

const API_BASE = "http://localhost:5000/api/game-lobbies";

const games = [
  {
    id: "tic-tac-toe",
    title: "Tic Tac Toe",
    genre: "Strategy",
    status: "Ready",
    accent: "green",
    icon: FaChessKnight,
    route: "/games/tic-tac-toe",
    description: "Team lobbies, same-size matchmaking, and a 5x5 board.",
  },
  {
    id: "fruit-rush",
    title: "Fruit Rush",
    genre: "Arcade",
    status: "Soon",
    accent: "cyan",
    icon: FaBolt,
    description: "Fast arcade rounds for quick party queues.",
  },
  {
    id: "aero-cards",
    title: "Aero Cards",
    genre: "Cards",
    status: "Soon",
    accent: "pink",
    icon: FaCrown,
    description: "Private tables, friend invites, and casual card play.",
  },
  {
    id: "night-rally",
    title: "Night Rally",
    genre: "Racing",
    status: "Soon",
    accent: "violet",
    icon: FaSignal,
    description: "Short racing heats built for small teams.",
  },
];

async function fetchTicTacToeSummary() {
  const token = localStorage.getItem("token");
  if (!token) {
    return null;
  }

  const res = await fetch(API_BASE, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Failed to load game hub");
  }

  return data;
}

export default function GameHub() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadHub = useCallback(async () => {
    try {
      const data = await fetchTicTacToeSummary();
      setSummary(data);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load game hub");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHub();
    const intervalId = window.setInterval(loadHub, 8000);
    return () => window.clearInterval(intervalId);
  }, [loadHub]);

  const activeMatch = summary?.activeMatches?.[0] || null;

  return (
    <div className="game-lobby-page">
      <section className="game-lobby-command">
        <div className="game-lobby-title">
          <span className="game-lobby-mark">
            <FaGamepad />
          </span>
          <div>
            <p>Game Hub</p>
            <h1>Choose a game</h1>
          </div>
        </div>

        {activeMatch && (
          <button
            type="button"
            className="game-primary-action game-hub-resume"
            onClick={() => navigate(`/games/tic-tac-toe/match/${activeMatch.id}`)}
          >
            <FaPlay />
            Resume Match
          </button>
        )}
      </section>

      {error && <div className="game-lobby-alert error">{error}</div>}

      <section className="game-lobby-overview">
        <div className="game-lobby-stat">
          <span>{loading ? "..." : formatCount(summary?.availableLobbies?.length || 0)}</span>
          <p>Tic tac toe lobbies</p>
        </div>
        <div className="game-lobby-stat">
          <span>{loading ? "..." : formatCount(summary?.activeMatches?.length || 0)}</span>
          <p>Active matches</p>
        </div>
        <div className="game-lobby-stat">
          <span>{loading ? "..." : formatCount(summary?.invites?.length || 0)}</span>
          <p>Game invites</p>
        </div>
      </section>

      <section className="game-lobby-catalog game-hub-catalog">
        <div className="game-grid">
          {games.map((game) => {
            const Icon = game.icon;
            const isReady = game.status === "Ready";

            return (
              <button
                key={game.id}
                type="button"
                className={`game-card ${game.accent}`}
                onClick={() => {
                  if (isReady) navigate(game.route);
                }}
                disabled={!isReady}
              >
                <span className="game-card-icon">
                  <Icon />
                </span>
                <span className="game-card-copy">
                  <strong>{game.title}</strong>
                  <span>{game.genre}</span>
                  <small>{game.description}</small>
                </span>
                <span className={`game-card-status ${game.status.toLowerCase()}`}>
                  {game.status}
                </span>
              </button>
            );
          })}
        </div>

        <div className="game-hub-footer">
          <FaUsers />
          Tic tac toe is live now. Other games can plug into the same lobby hub later.
        </div>
      </section>
    </div>
  );
}
