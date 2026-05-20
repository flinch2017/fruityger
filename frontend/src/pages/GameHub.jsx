import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaChessKnight,
  FaGamepad,
  FaPlay,
  FaUsers,
} from "react-icons/fa";
import "../css/GameLobby.css";
import supabase from "../lib/supabaseClient";

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
  const refreshTimeoutRef = useRef(null);
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
  }, [loadHub]);

  useEffect(() => {
    const scheduleRealtimeRefresh = () => {
      window.clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = window.setTimeout(() => {
        loadHub();
      }, 120);
    };

    const channel = supabase
      .channel("game-hub-live")
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
  }, [loadHub]);

  const activeMatch = summary?.activeMatches?.[0] || null;

  return (
    <div className="game-lobby-page" aria-busy={loading}>
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
          <div className="game-card game-card-soon-note">
            <span className="game-card-icon">
              <FaGamepad />
            </span>
            <span className="game-card-copy">
              <strong>More games coming soon...</strong>
              <span>New modes</span>
              <small>Fresh games will appear here as they are added.</small>
            </span>
          </div>
        </div>

        <div className="game-hub-footer">
          <FaUsers />
          Tic tac toe is live now. Other games can plug into the same lobby hub later.
        </div>
      </section>
    </div>
  );
}
