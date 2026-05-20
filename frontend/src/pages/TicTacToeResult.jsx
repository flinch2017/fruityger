import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FaArrowLeft, FaCrown, FaRobot, FaUsers } from "react-icons/fa";
import "../css/GameLobby.css";

const API_BASE = "http://localhost:5000/api/game-lobbies";

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

export default function TicTacToeResult() {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadResult = useCallback(async () => {
    try {
      const data = await requestJson(`/matches/${matchId}`);
      setMatch(data.match);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load result");
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    loadResult();
  }, [loadResult]);

  const winnerLabel = useMemo(() => {
    if (!match) return "";
    if (match.is_draw) return "Draw";
    return match.winner_mark === match.my_mark ? "Victory" : "Defeat";
  }, [match]);

  const winnerTeamName =
    match?.winner_mark === "x"
      ? match?.lobby_x_title
      : match?.winner_mark === "o"
        ? match?.lobby_o_title
        : "";

  if (loading) {
    return (
      <div className="tic-match-page">
        <div className="game-lobby-status">Loading result...</div>
      </div>
    );
  }

  return (
    <div className="tic-result-page">
      <section className="tic-result-hero">
        <button type="button" className="game-secondary-action" onClick={() => navigate("/games")}>
          <FaArrowLeft />
          Game Hub
        </button>

        {error ? (
          <div className="game-lobby-alert error">{error}</div>
        ) : (
          <>
            <div className={`tic-result-medal ${match?.is_draw ? "draw" : ""}`}>
              <FaCrown />
            </div>
            <p>Match Result</p>
            <h1>{winnerLabel}</h1>
            <span>
              {match?.is_draw
                ? "Both teams held the board."
                : `${winnerTeamName} wins the match.`}
            </span>
          </>
        )}
      </section>

      {match && (
        <section className="tic-result-teams">
          {["x", "o"].map((mark) => {
            const teamName = mark === "x" ? match.lobby_x_title : match.lobby_o_title;
            const isWinner = match.winner_mark === mark;
            const players = match.teams?.[mark] || [];

            return (
              <div key={mark} className={`tic-result-team ${isWinner ? "winner" : ""}`}>
                <div className="tic-result-team-head">
                  <div>
                    <span>{mark.toUpperCase()} Team</span>
                    <h2>{teamName}</h2>
                  </div>
                  {isWinner && <FaCrown />}
                </div>

                <div className="tic-result-player-list">
                  {players.map((player) => (
                    <div key={player.id} className="tic-result-player">
                      <div className="game-team-avatar">
                        {player.username?.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <strong>@{player.username}</strong>
                        <span>Turn {player.turn_order}</span>
                      </div>
                      <div className="tic-result-player-meta">
                        {player.ai_turns_taken > 0 ? (
                          <span>
                            <FaRobot />
                            AI x{player.ai_turns_taken}
                          </span>
                        ) : (
                          <span>
                            <FaUsers />
                            Player
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
