import { useMemo, useState } from "react";
import {
  FaBolt,
  FaChessKnight,
  FaClock,
  FaCrown,
  FaGamepad,
  FaLock,
  FaPlay,
  FaSearch,
  FaSignal,
  FaUsers,
} from "react-icons/fa";
import "../css/GameLobby.css";
import { formatCount } from "../utils/countFormatter";

const games = [
  {
    id: "fruit-rush",
    title: "Fruit Rush",
    genre: "Arcade",
    status: "Ready",
    players: 1840,
    rooms: 28,
    accent: "cyan",
    icon: FaBolt,
    description: "Fast rounds, quick reactions, and leaderboard climbs.",
  },
  {
    id: "tile-tactics",
    title: "Tile Tactics",
    genre: "Strategy",
    status: "Ready",
    players: 920,
    rooms: 14,
    accent: "green",
    icon: FaChessKnight,
    description: "Turn-based matches for friends who like a slower burn.",
  },
  {
    id: "aero-cards",
    title: "Aero Cards",
    genre: "Cards",
    status: "Soon",
    players: 0,
    rooms: 0,
    accent: "pink",
    icon: FaCrown,
    description: "Casual table play with private rooms and invite links.",
  },
  {
    id: "night-rally",
    title: "Night Rally",
    genre: "Racing",
    status: "Soon",
    players: 0,
    rooms: 0,
    accent: "violet",
    icon: FaSignal,
    description: "Short racing heats built for quick group sessions.",
  },
];

const rooms = [
  {
    id: "rush-open-1",
    gameId: "fruit-rush",
    title: "Open Sprint",
    host: "mika",
    players: 6,
    maxPlayers: 8,
    mode: "Public",
    pace: "Live",
  },
  {
    id: "tactics-duo-7",
    gameId: "tile-tactics",
    title: "Quiet Strategy",
    host: "nori",
    players: 2,
    maxPlayers: 4,
    mode: "Friends",
    pace: "Waiting",
  },
  {
    id: "rush-party-4",
    gameId: "fruit-rush",
    title: "After Class Party",
    host: "kei",
    players: 4,
    maxPlayers: 8,
    mode: "Public",
    pace: "Waiting",
  },
];

const filters = ["All", "Ready", "Soon"];

export default function GameLobby() {
  const [activeFilter, setActiveFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [selectedGameId, setSelectedGameId] = useState(games[0].id);

  const selectedGame = games.find((game) => game.id === selectedGameId) || games[0];
  const SelectedGameIcon = selectedGame.icon;
  const selectedGameRooms = rooms.filter((room) => room.gameId === selectedGame.id);

  const filteredGames = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return games.filter((game) => {
      const matchesFilter = activeFilter === "All" || game.status === activeFilter;
      const matchesQuery =
        !normalizedQuery ||
        game.title.toLowerCase().includes(normalizedQuery) ||
        game.genre.toLowerCase().includes(normalizedQuery);

      return matchesFilter && matchesQuery;
    });
  }, [activeFilter, query]);

  return (
    <div className="game-lobby-page">
      <section className="game-lobby-command">
        <div className="game-lobby-title">
          <span className="game-lobby-mark">
            <FaGamepad />
          </span>
          <div>
            <p>Game Lobby</p>
            <h1>Play with Fruityger friends</h1>
          </div>
        </div>

        <div className="game-lobby-search">
          <FaSearch />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search games"
          />
        </div>
      </section>

      <section className="game-lobby-overview">
        <div className="game-lobby-stat">
          <span>{formatCount(games.reduce((sum, game) => sum + game.players, 0))}</span>
          <p>Online</p>
        </div>
        <div className="game-lobby-stat">
          <span>{formatCount(rooms.length)}</span>
          <p>Rooms</p>
        </div>
        <div className="game-lobby-stat">
          <span>{formatCount(games.filter((game) => game.status === "Ready").length)}</span>
          <p>Ready</p>
        </div>
      </section>

      <section className="game-lobby-main">
        <div className="game-lobby-catalog">
          <div className="game-lobby-tabs" aria-label="Game filters">
            {filters.map((filter) => (
              <button
                key={filter}
                type="button"
                className={activeFilter === filter ? "active" : ""}
                onClick={() => setActiveFilter(filter)}
              >
                {filter}
              </button>
            ))}
          </div>

          <div className="game-grid">
            {filteredGames.map((game) => {
              const Icon = game.icon;
              const isSelected = selectedGame.id === game.id;

              return (
                <button
                  key={game.id}
                  type="button"
                  className={`game-card ${game.accent} ${isSelected ? "selected" : ""}`}
                  onClick={() => setSelectedGameId(game.id)}
                >
                  <span className="game-card-icon">
                    <Icon />
                  </span>
                  <span className="game-card-copy">
                    <strong>{game.title}</strong>
                    <span>{game.genre}</span>
                  </span>
                  <span className={`game-card-status ${game.status.toLowerCase()}`}>
                    {game.status}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <aside className={`game-lobby-detail ${selectedGame.accent}`}>
          <div className="game-detail-top">
            <span className="game-detail-icon">
              <SelectedGameIcon />
            </span>
            <div>
              <p>{selectedGame.genre}</p>
              <h2>{selectedGame.title}</h2>
            </div>
          </div>

          <p className="game-detail-description">{selectedGame.description}</p>

          <div className="game-detail-metrics">
            <span>
              <FaUsers />
              {formatCount(selectedGame.players)} online
            </span>
            <span>
              <FaSignal />
              {formatCount(selectedGame.rooms)} rooms
            </span>
          </div>

          <button
            type="button"
            className="game-primary-action"
            disabled={selectedGame.status !== "Ready"}
          >
            {selectedGame.status === "Ready" ? (
              <>
                <FaPlay />
                Enter Lobby
              </>
            ) : (
              <>
                <FaLock />
                Coming Soon
              </>
            )}
          </button>

          <div className="game-room-list">
            <div className="game-room-heading">
              <h3>Rooms</h3>
              <span>{formatCount(selectedGameRooms.length)}</span>
            </div>

            {selectedGameRooms.length === 0 ? (
              <div className="game-room-empty">No active rooms yet.</div>
            ) : (
              selectedGameRooms.map((room) => (
                <div key={room.id} className="game-room-row">
                  <div>
                    <strong>{room.title}</strong>
                    <span>Hosted by @{room.host}</span>
                  </div>
                  <div className="game-room-meta">
                    <span>
                      <FaUsers />
                      {room.players}/{room.maxPlayers}
                    </span>
                    <span>
                      <FaClock />
                      {room.pace}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}
