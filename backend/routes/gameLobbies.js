import express from "express";
import { v4 as uuidv4 } from "uuid";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";
import { createNotification } from "../utils/notifications.js";

const router = express.Router();
const GAME_KEY = "tic-tac-toe";
const BOARD_SIZE = 5;
const WIN_LENGTH = 4;
const OPEN_LOBBY_STATUSES = ["open", "matchmaking"];
const REALTIME_TABLES = [
  "game_lobbies",
  "game_lobby_members",
  "game_lobby_invites",
  "game_lobby_join_requests",
  "game_matches",
  "game_match_moves",
  "game_match_player_states",
];

let gameLobbySchemaReadyPromise = null;

async function ensureGameLobbySchema() {
  if (!gameLobbySchemaReadyPromise) {
    gameLobbySchemaReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS game_lobbies (
          id UUID PRIMARY KEY,
          game_key TEXT NOT NULL DEFAULT 'tic-tac-toe',
          host_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          max_team_size INTEGER NOT NULL DEFAULT 1 CHECK (max_team_size BETWEEN 1 AND 5),
          status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'matchmaking', 'matched', 'cancelled')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS game_lobby_members (
          lobby_id UUID NOT NULL REFERENCES game_lobbies(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('host', 'member')),
          joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (lobby_id, user_id)
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS game_lobby_invites (
          id UUID PRIMARY KEY,
          lobby_id UUID NOT NULL REFERENCES game_lobbies(id) ON DELETE CASCADE,
          inviter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          invitee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (lobby_id, invitee_id)
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS game_lobby_join_requests (
          id UUID PRIMARY KEY,
          lobby_id UUID NOT NULL REFERENCES game_lobbies(id) ON DELETE CASCADE,
          requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (lobby_id, requester_id)
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS game_matches (
          id UUID PRIMARY KEY,
          game_key TEXT NOT NULL DEFAULT 'tic-tac-toe',
          lobby_x_id UUID NOT NULL REFERENCES game_lobbies(id) ON DELETE CASCADE,
          lobby_o_id UUID NOT NULL REFERENCES game_lobbies(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
          current_mark TEXT NOT NULL DEFAULT 'x' CHECK (current_mark IN ('x', 'o')),
          current_turn_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
          board_size INTEGER NOT NULL DEFAULT 5,
          win_length INTEGER NOT NULL DEFAULT 4,
          winner_mark TEXT CHECK (winner_mark IN ('x', 'o')),
          winning_line INTEGER[],
          is_draw BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS game_match_moves (
          id UUID PRIMARY KEY,
          match_id UUID NOT NULL REFERENCES game_matches(id) ON DELETE CASCADE,
          player_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          lobby_id UUID NOT NULL REFERENCES game_lobbies(id) ON DELETE CASCADE,
          mark TEXT NOT NULL CHECK (mark IN ('x', 'o')),
          cell_index INTEGER NOT NULL CHECK (cell_index BETWEEN 0 AND 24),
          move_number INTEGER NOT NULL,
          is_ai_move BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (match_id, cell_index),
          UNIQUE (match_id, move_number)
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS game_match_player_states (
          match_id UUID NOT NULL REFERENCES game_matches(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          lobby_id UUID NOT NULL REFERENCES game_lobbies(id) ON DELETE CASCADE,
          mark TEXT NOT NULL CHECK (mark IN ('x', 'o')),
          turn_order INTEGER NOT NULL,
          is_afk BOOLEAN NOT NULL DEFAULT false,
          ai_turns_taken INTEGER NOT NULL DEFAULT 0,
          last_seen_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (match_id, user_id),
          UNIQUE (match_id, mark, turn_order)
        )
      `);

      await pool.query(`
        ALTER TABLE game_matches
        ADD COLUMN IF NOT EXISTS board_size INTEGER NOT NULL DEFAULT 5
      `);

      await pool.query(`
        ALTER TABLE game_matches
        ADD COLUMN IF NOT EXISTS win_length INTEGER NOT NULL DEFAULT 4
      `);

      await pool.query(`
        ALTER TABLE game_matches
        ADD COLUMN IF NOT EXISTS current_turn_user_id UUID REFERENCES users(id) ON DELETE SET NULL
      `);

      await pool.query(`
        ALTER TABLE game_match_moves
        ADD COLUMN IF NOT EXISTS is_ai_move BOOLEAN NOT NULL DEFAULT false
      `);

      await pool.query(`
        DO $$
        BEGIN
          ALTER TABLE game_match_moves
          DROP CONSTRAINT IF EXISTS game_match_moves_cell_index_check;

          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'game_match_moves_cell_index_range_check'
          ) THEN
            ALTER TABLE game_match_moves
            ADD CONSTRAINT game_match_moves_cell_index_range_check
            CHECK (cell_index BETWEEN 0 AND 24);
          END IF;
        END $$;
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_game_lobbies_status_size
        ON game_lobbies(game_key, status, max_team_size, updated_at DESC)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_game_lobby_members_user
        ON game_lobby_members(user_id)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_game_matches_lobbies
        ON game_matches(lobby_x_id, lobby_o_id, created_at DESC)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_game_match_player_states_match
        ON game_match_player_states(match_id, mark, turn_order)
      `);

      await ensureGameRealtimePublication();
    })().catch((error) => {
      gameLobbySchemaReadyPromise = null;
      throw error;
    });
  }

  await gameLobbySchemaReadyPromise;
}

async function ensureGameRealtimePublication() {
  for (const tableName of REALTIME_TABLES) {
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM pg_publication
            WHERE pubname = 'supabase_realtime'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = '${tableName}'
          ) THEN
            EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.${tableName}';
          END IF;
        END $$;
      `);
    } catch (error) {
      console.warn(`Could not enable Supabase Realtime for ${tableName}:`, error.message);
    }
  }
}

const normalizeTeamSize = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(parsed, 1), 5);
};

const normalizeTitle = (value, username) => {
  const trimmed = String(value || "").trim().replace(/\s+/g, " ");
  if (trimmed) return trimmed.slice(0, 60);
  return `${username}'s Tic Tac Toe Lobby`;
};

const memberSelectSql = `
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'id', u.id,
        'username', u.username,
        'profile_pic', u.profile_pic,
        'role', gm.role,
        'joined_at', gm.joined_at
      )
      ORDER BY CASE WHEN gm.role = 'host' THEN 0 ELSE 1 END, gm.joined_at ASC
    ) FILTER (WHERE u.id IS NOT NULL),
    '[]'
  )
  FROM game_lobby_members gm
  JOIN users u ON u.id = gm.user_id
  WHERE gm.lobby_id = l.id
`;

async function getLobby(lobbyId) {
  const { rows } = await pool.query(
    `
    SELECT
      l.id,
      l.game_key,
      l.title,
      l.max_team_size,
      l.status,
      l.created_at,
      l.updated_at,
      h.id AS host_id,
      h.username AS host_username,
      h.profile_pic AS host_profile_pic,
      (${memberSelectSql}) AS members
    FROM game_lobbies l
    JOIN users h ON h.id = l.host_id
    WHERE l.id = $1
    LIMIT 1
    `,
    [lobbyId]
  );

  return rows[0] || null;
}

async function getLobbyMembers(lobbyId) {
  const { rows } = await pool.query(
    `
    SELECT u.id, u.username
    FROM game_lobby_members gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.lobby_id = $1
    ORDER BY gm.joined_at ASC
    `,
    [lobbyId]
  );

  return rows;
}

function getBoardFromMoves(moves = [], boardSize = BOARD_SIZE) {
  const board = Array(boardSize * boardSize).fill(null);
  moves.forEach((move) => {
    board[move.cell_index] = move.mark;
  });
  return board;
}

function getGameResult(board, boardSize = BOARD_SIZE, winLength = WIN_LENGTH) {
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];

  for (let row = 0; row < boardSize; row += 1) {
    for (let col = 0; col < boardSize; col += 1) {
      const startIndex = row * boardSize + col;
      const mark = board[startIndex];
      if (!mark) continue;

      for (const [rowStep, colStep] of directions) {
        const line = [startIndex];

        for (let offset = 1; offset < winLength; offset += 1) {
          const nextRow = row + rowStep * offset;
          const nextCol = col + colStep * offset;
          if (
            nextRow < 0 ||
            nextRow >= boardSize ||
            nextCol < 0 ||
            nextCol >= boardSize
          ) {
            break;
          }

          const nextIndex = nextRow * boardSize + nextCol;
          if (board[nextIndex] !== mark) break;
          line.push(nextIndex);
        }

        if (line.length === winLength) {
          return { winnerMark: mark, winningLine: line, isDraw: false };
        }
      }
    }
  }

  return { winnerMark: null, winningLine: null, isDraw: board.every(Boolean) };
}

async function ensureMatchPlayerStates(matchId, client = pool) {
  const matchResult = await client.query(
    `
    SELECT id, lobby_x_id, lobby_o_id, current_turn_user_id
    FROM game_matches
    WHERE id = $1
    LIMIT 1
    `,
    [matchId]
  );
  const match = matchResult.rows[0];
  if (!match) return;

  const existing = await client.query(
    `
    SELECT COUNT(*)::int AS count
    FROM game_match_player_states
    WHERE match_id = $1
    `,
    [matchId]
  );

  if (existing.rows[0]?.count === 0) {
    await client.query(
      `
      INSERT INTO game_match_player_states (match_id, user_id, lobby_id, mark, turn_order)
      SELECT $1, gm.user_id, gm.lobby_id, 'x', ROW_NUMBER() OVER (ORDER BY gm.joined_at ASC)
      FROM game_lobby_members gm
      WHERE gm.lobby_id = $2
      ON CONFLICT (match_id, user_id) DO NOTHING
      `,
      [matchId, match.lobby_x_id]
    );

    await client.query(
      `
      INSERT INTO game_match_player_states (match_id, user_id, lobby_id, mark, turn_order)
      SELECT $1, gm.user_id, gm.lobby_id, 'o', ROW_NUMBER() OVER (ORDER BY gm.joined_at ASC)
      FROM game_lobby_members gm
      WHERE gm.lobby_id = $2
      ON CONFLICT (match_id, user_id) DO NOTHING
      `,
      [matchId, match.lobby_o_id]
    );
  }

  if (!match.current_turn_user_id) {
    const firstTurn = await client.query(
      `
      SELECT user_id
      FROM game_match_player_states
      WHERE match_id = $1
        AND mark = 'x'
      ORDER BY turn_order ASC
      LIMIT 1
      `,
      [matchId]
    );

    if (firstTurn.rows[0]?.user_id) {
      await client.query(
        `
        UPDATE game_matches
        SET current_turn_user_id = $2,
            updated_at = NOW()
        WHERE id = $1
          AND current_turn_user_id IS NULL
        `,
        [matchId, firstTurn.rows[0].user_id]
      );
    }
  }
}

async function getNextTurnUserId(client, matchId, nextMark) {
  const lastMove = await client.query(
    `
    SELECT gps.turn_order
    FROM game_match_moves mv
    JOIN game_match_player_states gps
      ON gps.match_id = mv.match_id
     AND gps.user_id = mv.player_id
    WHERE mv.match_id = $1
      AND mv.mark = $2
    ORDER BY mv.move_number DESC
    LIMIT 1
    `,
    [matchId, nextMark]
  );
  const lastTurnOrder = lastMove.rows[0]?.turn_order || 0;

  const nextPlayer = await client.query(
    `
    SELECT user_id
    FROM game_match_player_states
    WHERE match_id = $1
      AND mark = $2
      AND turn_order > $3
    ORDER BY turn_order ASC
    LIMIT 1
    `,
    [matchId, nextMark, lastTurnOrder]
  );

  if (nextPlayer.rows[0]?.user_id) {
    return nextPlayer.rows[0].user_id;
  }

  const wrappedPlayer = await client.query(
    `
    SELECT user_id
    FROM game_match_player_states
    WHERE match_id = $1
      AND mark = $2
    ORDER BY turn_order ASC
    LIMIT 1
    `,
    [matchId, nextMark]
  );

  return wrappedPlayer.rows[0]?.user_id || null;
}

function getAiMoveIndex(board, mark, boardSize, winLength) {
  const opponentMark = mark === "x" ? "o" : "x";
  const emptyIndexes = board
    .map((value, index) => (value ? null : index))
    .filter((index) => index !== null);

  const findWinningMove = (candidateMark) =>
    emptyIndexes.find((index) => {
      const nextBoard = [...board];
      nextBoard[index] = candidateMark;
      return getGameResult(nextBoard, boardSize, winLength).winnerMark === candidateMark;
    });

  const winningMove = findWinningMove(mark);
  if (winningMove !== undefined) return winningMove;

  const blockingMove = findWinningMove(opponentMark);
  if (blockingMove !== undefined) return blockingMove;

  const centerIndex = Math.floor((boardSize * boardSize) / 2);
  if (!board[centerIndex]) return centerIndex;

  return emptyIndexes[0] ?? null;
}

async function applyMatchMove({ client, match, playerState, cellIndex, isAiMove = false }) {
  const boardSize = match.board_size || BOARD_SIZE;
  const winLength = match.win_length || WIN_LENGTH;

  if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= boardSize * boardSize) {
    const error = new Error("Choose a valid square");
    error.statusCode = 400;
    throw error;
  }

  const movesResult = await client.query(
    `
    SELECT mark, cell_index, move_number
    FROM game_match_moves
    WHERE match_id = $1
    ORDER BY move_number ASC
    `,
    [match.id]
  );
  const board = getBoardFromMoves(movesResult.rows, boardSize);
  if (board[cellIndex]) {
    const error = new Error("That square is already taken");
    error.statusCode = 400;
    throw error;
  }

  const moveNumber = movesResult.rows.length + 1;
  await client.query(
    `
    INSERT INTO game_match_moves
      (id, match_id, player_id, lobby_id, mark, cell_index, move_number, is_ai_move)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      uuidv4(),
      match.id,
      playerState.user_id,
      playerState.lobby_id,
      playerState.mark,
      cellIndex,
      moveNumber,
      isAiMove,
    ]
  );

  if (isAiMove) {
    await client.query(
      `
      UPDATE game_match_player_states
      SET ai_turns_taken = ai_turns_taken + 1,
          updated_at = NOW()
      WHERE match_id = $1
        AND user_id = $2
      `,
      [match.id, playerState.user_id]
    );
  }

  board[cellIndex] = playerState.mark;
  const result = getGameResult(board, boardSize, winLength);
  const nextMark = playerState.mark === "x" ? "o" : "x";
  const nextTurnUserId =
    result.winnerMark || result.isDraw
      ? null
      : await getNextTurnUserId(client, match.id, nextMark);

  await client.query(
    `
    UPDATE game_matches
    SET status = $2,
        current_mark = $3,
        current_turn_user_id = $4,
        winner_mark = $5,
        winning_line = $6,
        is_draw = $7,
        updated_at = NOW()
    WHERE id = $1
    `,
    [
      match.id,
      result.winnerMark || result.isDraw ? "finished" : "active",
      result.winnerMark || result.isDraw ? match.current_mark : nextMark,
      nextTurnUserId,
      result.winnerMark,
      result.winningLine,
      result.isDraw,
    ]
  );
}

async function notifyLobbyMembers({ lobbyId, actorId, type, gameLobbyId, gameMatchId, skipUserIds = [] }) {
  const members = await getLobbyMembers(lobbyId);
  const skipped = new Set(skipUserIds);

  await Promise.all(
    members
      .filter((member) => !skipped.has(member.id))
      .map((member) =>
        createNotification({
          recipientId: member.id,
          actorId,
          type,
          gameLobbyId,
          gameMatchId,
          pushData: {
            type: "game",
            notificationType: type,
            gameLobbyId,
            gameMatchId,
          },
        })
      )
  );
}

async function getMatchForUser(matchId, userId, client = pool) {
  await ensureMatchPlayerStates(matchId, client);

  const { rows } = await client.query(
    `
    SELECT
      m.id,
      m.status,
      m.current_mark,
      m.current_turn_user_id,
      turn_user.username AS current_turn_username,
      COALESCE(turn_state.is_afk, false) AS current_turn_is_afk,
      m.board_size,
      m.win_length,
      m.winner_mark,
      m.winning_line,
      m.is_draw,
      m.created_at,
      m.updated_at,
      m.lobby_x_id,
      m.lobby_o_id,
      lx.title AS lobby_x_title,
      lo.title AS lobby_o_title,
      EXISTS (
        SELECT 1 FROM game_lobby_members gm
        WHERE gm.lobby_id = m.lobby_x_id AND gm.user_id = $2
      ) AS user_on_x,
      EXISTS (
        SELECT 1 FROM game_lobby_members gm
        WHERE gm.lobby_id = m.lobby_o_id AND gm.user_id = $2
      ) AS user_on_o,
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'id', mv.id,
              'player_id', mv.player_id,
              'player_username', u.username,
              'lobby_id', mv.lobby_id,
              'mark', mv.mark,
              'cell_index', mv.cell_index,
              'move_number', mv.move_number,
              'is_ai_move', mv.is_ai_move,
              'created_at', mv.created_at
            )
            ORDER BY mv.move_number ASC
          )
          FROM game_match_moves mv
          JOIN users u ON u.id = mv.player_id
          WHERE mv.match_id = m.id
        ),
        '[]'
      ) AS moves,
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'id', u.id,
              'username', u.username,
              'profile_pic', u.profile_pic,
              'mark', gps.mark,
              'lobby_id', gps.lobby_id,
              'turn_order', gps.turn_order,
              'is_afk', gps.is_afk,
              'ai_turns_taken', gps.ai_turns_taken,
              'last_seen_at', gps.last_seen_at
            )
            ORDER BY gps.mark ASC, gps.turn_order ASC
          )
          FROM game_match_player_states gps
          JOIN users u ON u.id = gps.user_id
          WHERE gps.match_id = m.id
        ),
        '[]'
      ) AS players
    FROM game_matches m
    JOIN game_lobbies lx ON lx.id = m.lobby_x_id
    JOIN game_lobbies lo ON lo.id = m.lobby_o_id
    LEFT JOIN users turn_user ON turn_user.id = m.current_turn_user_id
    LEFT JOIN game_match_player_states turn_state
      ON turn_state.match_id = m.id
     AND turn_state.user_id = m.current_turn_user_id
    WHERE m.id = $1
    LIMIT 1
    `,
    [matchId, userId]
  );

  const match = rows[0];
  if (!match || (!match.user_on_x && !match.user_on_o)) return null;

  const myMark = match.user_on_x ? "x" : "o";
  const players = Array.isArray(match.players) ? match.players : [];
  const myState = players.find((player) => player.id === userId);
  const teams = {
    x: players.filter((player) => player.mark === "x"),
    o: players.filter((player) => player.mark === "o"),
  };

  return {
    ...match,
    teams,
    my_mark: myMark,
    my_player_state: myState || null,
    can_move:
      match.status === "active" &&
      match.current_turn_user_id === userId &&
      !myState?.is_afk,
  };
}

async function createMatchFromLobbies({ lobbyA, lobbyB, actorId, client }) {
  const matchId = uuidv4();

  await client.query(
    `
    INSERT INTO game_matches (id, lobby_x_id, lobby_o_id)
    VALUES ($1, $2, $3)
    `,
    [matchId, lobbyA.id, lobbyB.id]
  );

  await ensureMatchPlayerStates(matchId, client);

  await client.query(
    `
    UPDATE game_lobbies
    SET status = 'matched',
        updated_at = NOW()
    WHERE id = ANY($1::uuid[])
    `,
    [[lobbyA.id, lobbyB.id]]
  );

  await notifyLobbyMembers({
    lobbyId: lobbyA.id,
    actorId,
    type: "game_match_found",
    gameLobbyId: lobbyA.id,
    gameMatchId: matchId,
    skipUserIds: [actorId],
  });

  await notifyLobbyMembers({
    lobbyId: lobbyB.id,
    actorId,
    type: "game_match_found",
    gameLobbyId: lobbyB.id,
    gameMatchId: matchId,
  });

  return matchId;
}

router.get("/", authenticateToken, async (req, res) => {
  try {
    await ensureGameLobbySchema();
    const userId = req.user.id;

    const availableLobbies = await pool.query(
      `
      SELECT
        l.id,
        l.title,
        l.max_team_size,
        l.status,
        l.created_at,
        h.id AS host_id,
        h.username AS host_username,
        h.profile_pic AS host_profile_pic,
        (${memberSelectSql}) AS members,
        EXISTS (
          SELECT 1 FROM game_lobby_join_requests jr
          WHERE jr.lobby_id = l.id AND jr.requester_id = $1 AND jr.status = 'pending'
        ) AS has_pending_request
      FROM game_lobbies l
      JOIN users h ON h.id = l.host_id
      WHERE l.game_key = $2
        AND l.status = ANY($3::text[])
        AND NOT EXISTS (
          SELECT 1 FROM game_lobby_members gm
          WHERE gm.lobby_id = l.id AND gm.user_id = $1
        )
      ORDER BY l.updated_at DESC
      LIMIT 40
      `,
      [userId, GAME_KEY, OPEN_LOBBY_STATUSES]
    );

    const myLobbies = await pool.query(
      `
      SELECT
        l.id,
        l.title,
        l.max_team_size,
        l.status,
        l.created_at,
        l.updated_at,
        h.id AS host_id,
        h.username AS host_username,
        h.profile_pic AS host_profile_pic,
        (${memberSelectSql}) AS members,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', gi.id,
                'invitee_id', iu.id,
                'invitee_username', iu.username,
                'invitee_profile_pic', iu.profile_pic,
                'status', gi.status,
                'created_at', gi.created_at
              )
              ORDER BY gi.created_at DESC
            )
            FROM game_lobby_invites gi
            JOIN users iu ON iu.id = gi.invitee_id
            WHERE gi.lobby_id = l.id AND gi.status = 'pending'
          ),
          '[]'
        ) AS pending_invites,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', jr.id,
                'requester_id', ru.id,
                'requester_username', ru.username,
                'requester_profile_pic', ru.profile_pic,
                'status', jr.status,
                'created_at', jr.created_at
              )
              ORDER BY jr.created_at DESC
            )
            FROM game_lobby_join_requests jr
            JOIN users ru ON ru.id = jr.requester_id
            WHERE jr.lobby_id = l.id AND jr.status = 'pending'
          ),
          '[]'
        ) AS pending_requests
      FROM game_lobbies l
      JOIN game_lobby_members own_member ON own_member.lobby_id = l.id AND own_member.user_id = $1
      JOIN users h ON h.id = l.host_id
      WHERE l.game_key = $2
        AND l.status <> 'cancelled'
      ORDER BY l.updated_at DESC
      LIMIT 8
      `,
      [userId, GAME_KEY]
    );

    const matches = await pool.query(
      `
      SELECT m.id
      FROM game_matches m
      WHERE m.status = 'active'
        AND EXISTS (
          SELECT 1 FROM game_lobby_members gm
          WHERE gm.user_id = $1 AND gm.lobby_id IN (m.lobby_x_id, m.lobby_o_id)
        )
      ORDER BY m.updated_at DESC
      LIMIT 5
      `,
      [userId]
    );

    const activeMatches = (
      await Promise.all(matches.rows.map((row) => getMatchForUser(row.id, userId)))
    ).filter(Boolean);

    const invites = await pool.query(
      `
      SELECT
        gi.id,
        gi.created_at,
        l.id AS lobby_id,
        l.title,
        l.max_team_size,
        l.status,
        inviter.id AS inviter_id,
        inviter.username AS inviter_username,
        (${memberSelectSql}) AS members
      FROM game_lobby_invites gi
      JOIN game_lobbies l ON l.id = gi.lobby_id
      JOIN users inviter ON inviter.id = gi.inviter_id
      WHERE gi.invitee_id = $1
        AND gi.status = 'pending'
        AND l.status = ANY($2::text[])
      ORDER BY gi.created_at DESC
      `,
      [userId, OPEN_LOBBY_STATUSES]
    );

    res.json({
      game: { id: GAME_KEY, title: "Tic Tac Toe" },
      availableLobbies: availableLobbies.rows,
      myLobbies: myLobbies.rows,
      activeMatches,
      invites: invites.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load game lobbies" });
  }
});

router.get("/users", authenticateToken, async (req, res) => {
  try {
    const keyword = String(req.query.q || "").trim().toLowerCase();
    if (keyword.length < 2) {
      return res.json({ users: [] });
    }

    const { rows } = await pool.query(
      `
      SELECT id, username, profile_pic
      FROM users
      WHERE id <> $1
        AND deactivated_at IS NULL
        AND deleted_at IS NULL
        AND username ILIKE $2
      ORDER BY
        CASE WHEN LOWER(username) = $3 THEN 0 WHEN LOWER(username) LIKE $4 THEN 1 ELSE 2 END,
        username ASC
      LIMIT 8
      `,
      [req.user.id, `%${keyword}%`, keyword, `${keyword}%`]
    );

    res.json({ users: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to search users" });
  }
});

router.post("/", authenticateToken, async (req, res) => {
  try {
    await ensureGameLobbySchema();

    const existing = await pool.query(
      `
      SELECT 1
      FROM game_lobby_members gm
      JOIN game_lobbies l ON l.id = gm.lobby_id
      WHERE gm.user_id = $1
        AND l.status = ANY($2::text[])
      LIMIT 1
      `,
      [req.user.id, OPEN_LOBBY_STATUSES]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Leave or finish your current lobby before creating another one" });
    }

    const lobbyId = uuidv4();
    const maxTeamSize = normalizeTeamSize(req.body?.maxTeamSize);
    const title = normalizeTitle(req.body?.title, req.user.username);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
        INSERT INTO game_lobbies (id, host_id, title, max_team_size)
        VALUES ($1, $2, $3, $4)
        `,
        [lobbyId, req.user.id, title, maxTeamSize]
      );

      await client.query(
        `
        INSERT INTO game_lobby_members (lobby_id, user_id, role)
        VALUES ($1, $2, 'host')
        `,
        [lobbyId, req.user.id]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => null);
      throw error;
    } finally {
      client.release();
    }

    res.status(201).json({ lobby: await getLobby(lobbyId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create lobby" });
  }
});

router.delete("/:lobbyId", authenticateToken, async (req, res) => {
  try {
    await ensureGameLobbySchema();
    const { lobbyId } = req.params;
    const lobby = await getLobby(lobbyId);

    if (!lobby) return res.status(404).json({ error: "Lobby not found" });
    if (!lobby.members.some((member) => member.id === req.user.id)) {
      return res.status(403).json({ error: "You are not in this lobby" });
    }
    if (lobby.status === "matched") {
      return res.status(400).json({ error: "Matched lobbies cannot be left" });
    }

    if (lobby.host_id === req.user.id) {
      await pool.query(
        `
        UPDATE game_lobbies
        SET status = 'cancelled', updated_at = NOW()
        WHERE id = $1
        `,
        [lobbyId]
      );
    } else {
      await pool.query(
        `
        DELETE FROM game_lobby_members
        WHERE lobby_id = $1 AND user_id = $2
        `,
        [lobbyId, req.user.id]
      );

      await pool.query(
        `
        UPDATE game_lobbies
        SET status = 'open', updated_at = NOW()
        WHERE id = $1
        `,
        [lobbyId]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to leave lobby" });
  }
});

router.post("/:lobbyId/invite", authenticateToken, async (req, res) => {
  try {
    await ensureGameLobbySchema();
    const { lobbyId } = req.params;
    const inviteeId = req.body?.userId;
    const lobby = await getLobby(lobbyId);

    if (!lobby) return res.status(404).json({ error: "Lobby not found" });
    if (lobby.host_id !== req.user.id) {
      return res.status(403).json({ error: "Only the host can invite players" });
    }
    if (!OPEN_LOBBY_STATUSES.includes(lobby.status)) {
      return res.status(400).json({ error: "This lobby is no longer accepting players" });
    }
    if (!inviteeId || inviteeId === req.user.id) {
      return res.status(400).json({ error: "Choose another user to invite" });
    }
    if (lobby.members.some((member) => member.id === inviteeId)) {
      return res.status(400).json({ error: "That user is already in the lobby" });
    }

    const inviteId = uuidv4();
    const { rows } = await pool.query(
      `
      INSERT INTO game_lobby_invites (id, lobby_id, inviter_id, invitee_id, status, updated_at)
      VALUES ($1, $2, $3, $4, 'pending', NOW())
      ON CONFLICT (lobby_id, invitee_id)
      DO UPDATE SET inviter_id = EXCLUDED.inviter_id, status = 'pending', updated_at = NOW()
      RETURNING *
      `,
      [inviteId, lobbyId, req.user.id, inviteeId]
    );

    await createNotification({
      recipientId: inviteeId,
      actorId: req.user.id,
      type: "game_lobby_invite",
      gameLobbyId: lobbyId,
      pushData: {
        type: "game",
        notificationType: "game_lobby_invite",
        gameLobbyId: lobbyId,
      },
    });

    res.status(201).json({ invite: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to invite player" });
  }
});

router.post("/invites/:inviteId/respond", authenticateToken, async (req, res) => {
  try {
    await ensureGameLobbySchema();
    const action = req.body?.action === "accept" ? "accepted" : "declined";
    const { inviteId } = req.params;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const inviteResult = await client.query(
        `
        SELECT gi.*, l.status AS lobby_status, l.max_team_size
        FROM game_lobby_invites gi
        JOIN game_lobbies l ON l.id = gi.lobby_id
        WHERE gi.id = $1 AND gi.invitee_id = $2
        FOR UPDATE
        `,
        [inviteId, req.user.id]
      );
      const invite = inviteResult.rows[0];

      if (!invite || invite.status !== "pending") {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Invite not found" });
      }

      if (action === "accepted") {
        const activeLobbyResult = await client.query(
          `
          SELECT 1
          FROM game_lobby_members gm
          JOIN game_lobbies l ON l.id = gm.lobby_id
          WHERE gm.user_id = $1
            AND l.id <> $2
            AND l.status = ANY($3::text[])
          LIMIT 1
          `,
          [req.user.id, invite.lobby_id, OPEN_LOBBY_STATUSES]
        );
        if (activeLobbyResult.rows.length > 0) {
          await client.query("ROLLBACK");
          return res.status(409).json({ error: "Leave your current lobby before joining another one" });
        }

        const memberCountResult = await client.query(
          `SELECT COUNT(*)::int AS count FROM game_lobby_members WHERE lobby_id = $1`,
          [invite.lobby_id]
        );
        if (!OPEN_LOBBY_STATUSES.includes(invite.lobby_status) || memberCountResult.rows[0].count >= invite.max_team_size) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "This lobby is full or unavailable" });
        }

        await client.query(
          `
          INSERT INTO game_lobby_members (lobby_id, user_id, role)
          VALUES ($1, $2, 'member')
          ON CONFLICT (lobby_id, user_id) DO NOTHING
          `,
          [invite.lobby_id, req.user.id]
        );
      }

      await client.query(
        `
        UPDATE game_lobby_invites
        SET status = $2, updated_at = NOW()
        WHERE id = $1
        `,
        [inviteId, action]
      );

      await client.query("COMMIT");
      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => null);
      throw error;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to respond to invite" });
  }
});

router.post("/:lobbyId/join-requests", authenticateToken, async (req, res) => {
  try {
    await ensureGameLobbySchema();
    const { lobbyId } = req.params;
    const lobby = await getLobby(lobbyId);

    if (!lobby) return res.status(404).json({ error: "Lobby not found" });
    if (!OPEN_LOBBY_STATUSES.includes(lobby.status)) {
      return res.status(400).json({ error: "This lobby is not accepting requests" });
    }
    if (lobby.members.some((member) => member.id === req.user.id)) {
      return res.status(400).json({ error: "You are already in this lobby" });
    }
    if (lobby.members.length >= lobby.max_team_size) {
      return res.status(400).json({ error: "This lobby is full" });
    }

    const activeLobby = await pool.query(
      `
      SELECT 1
      FROM game_lobby_members gm
      JOIN game_lobbies l ON l.id = gm.lobby_id
      WHERE gm.user_id = $1
        AND l.status = ANY($2::text[])
      LIMIT 1
      `,
      [req.user.id, OPEN_LOBBY_STATUSES]
    );
    if (activeLobby.rows.length > 0) {
      return res.status(409).json({ error: "Leave your current lobby before joining another one" });
    }

    const requestId = uuidv4();
    const { rows } = await pool.query(
      `
      INSERT INTO game_lobby_join_requests (id, lobby_id, requester_id, status, updated_at)
      VALUES ($1, $2, $3, 'pending', NOW())
      ON CONFLICT (lobby_id, requester_id)
      DO UPDATE SET status = 'pending', updated_at = NOW()
      RETURNING *
      `,
      [requestId, lobbyId, req.user.id]
    );

    await createNotification({
      recipientId: lobby.host_id,
      actorId: req.user.id,
      type: "game_lobby_request",
      gameLobbyId: lobbyId,
      pushData: {
        type: "game",
        notificationType: "game_lobby_request",
        gameLobbyId: lobbyId,
      },
    });

    res.status(201).json({ request: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to request lobby access" });
  }
});

router.post("/join-requests/:requestId/respond", authenticateToken, async (req, res) => {
  try {
    await ensureGameLobbySchema();
    const action = req.body?.action === "accept" ? "accepted" : "declined";
    const { requestId } = req.params;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const requestResult = await client.query(
        `
        SELECT jr.*, l.host_id, l.status AS lobby_status, l.max_team_size
        FROM game_lobby_join_requests jr
        JOIN game_lobbies l ON l.id = jr.lobby_id
        WHERE jr.id = $1
        FOR UPDATE
        `,
        [requestId]
      );
      const joinRequest = requestResult.rows[0];

      if (!joinRequest || joinRequest.status !== "pending") {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Join request not found" });
      }
      if (joinRequest.host_id !== req.user.id) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Only the host can answer this request" });
      }

      if (action === "accepted") {
        const activeLobbyResult = await client.query(
          `
          SELECT 1
          FROM game_lobby_members gm
          JOIN game_lobbies l ON l.id = gm.lobby_id
          WHERE gm.user_id = $1
            AND l.id <> $2
            AND l.status = ANY($3::text[])
          LIMIT 1
          `,
          [joinRequest.requester_id, joinRequest.lobby_id, OPEN_LOBBY_STATUSES]
        );
        if (activeLobbyResult.rows.length > 0) {
          await client.query("ROLLBACK");
          return res.status(409).json({ error: "That player is already in another active lobby" });
        }

        const memberCountResult = await client.query(
          `SELECT COUNT(*)::int AS count FROM game_lobby_members WHERE lobby_id = $1`,
          [joinRequest.lobby_id]
        );
        if (!OPEN_LOBBY_STATUSES.includes(joinRequest.lobby_status) || memberCountResult.rows[0].count >= joinRequest.max_team_size) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "This lobby is full or unavailable" });
        }

        await client.query(
          `
          INSERT INTO game_lobby_members (lobby_id, user_id, role)
          VALUES ($1, $2, 'member')
          ON CONFLICT (lobby_id, user_id) DO NOTHING
          `,
          [joinRequest.lobby_id, joinRequest.requester_id]
        );
      }

      await client.query(
        `
        UPDATE game_lobby_join_requests
        SET status = $2, updated_at = NOW()
        WHERE id = $1
        `,
        [requestId, action]
      );

      await client.query("COMMIT");

      if (action === "accepted") {
        await createNotification({
          recipientId: joinRequest.requester_id,
          actorId: req.user.id,
          type: "game_lobby_request_accepted",
          gameLobbyId: joinRequest.lobby_id,
          pushData: {
            type: "game",
            notificationType: "game_lobby_request_accepted",
            gameLobbyId: joinRequest.lobby_id,
          },
        });
      }

      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => null);
      throw error;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to respond to join request" });
  }
});

router.post("/:lobbyId/matchmake", authenticateToken, async (req, res) => {
  try {
    await ensureGameLobbySchema();
    const { lobbyId } = req.params;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const ownLobbyResult = await client.query(
        `
        SELECT
          l.*,
          (
            SELECT COUNT(*)::int
            FROM game_lobby_members gm
            WHERE gm.lobby_id = l.id
          ) AS member_count
        FROM game_lobbies l
        WHERE l.id = $1
        FOR UPDATE OF l
        `,
        [lobbyId]
      );
      const ownLobby = ownLobbyResult.rows[0];

      if (!ownLobby) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Lobby not found" });
      }
      if (ownLobby.host_id !== req.user.id) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Only the host can start matchmaking" });
      }
      if (!OPEN_LOBBY_STATUSES.includes(ownLobby.status)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "This lobby cannot be matched" });
      }

      await client.query(
        `
        UPDATE game_lobbies
        SET status = 'matchmaking', updated_at = NOW()
        WHERE id = $1
        `,
        [lobbyId]
      );

      const opponentResult = await client.query(
        `
        SELECT
          l.*,
          (
            SELECT COUNT(*)::int
            FROM game_lobby_members gm
            WHERE gm.lobby_id = l.id
          ) AS member_count
        FROM game_lobbies l
        WHERE l.id <> $1
          AND l.game_key = $2
          AND l.status = 'matchmaking'
          AND (
            SELECT COUNT(*)::int
            FROM game_lobby_members gm
            WHERE gm.lobby_id = l.id
          ) = $3
        ORDER BY l.updated_at ASC
        LIMIT 1
        FOR UPDATE OF l
        `,
        [lobbyId, GAME_KEY, ownLobby.member_count]
      );

      const opponent = opponentResult.rows[0];
      if (!opponent) {
        await client.query("COMMIT");
        return res.json({ waiting: true, message: "Waiting for a same-size team" });
      }

      const matchId = await createMatchFromLobbies({
        lobbyA: ownLobby,
        lobbyB: opponent,
        actorId: req.user.id,
        client,
      });
      await client.query("COMMIT");

      res.json({ waiting: false, match: await getMatchForUser(matchId, req.user.id) });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => null);
      throw error;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to match lobby" });
  }
});

router.get("/matches/:matchId", authenticateToken, async (req, res) => {
  try {
    await ensureGameLobbySchema();
    const match = await getMatchForUser(req.params.matchId, req.user.id);
    if (!match) {
      return res.status(404).json({ error: "Match not found" });
    }

    res.json({ match });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load match" });
  }
});

router.post("/matches/:matchId/presence", authenticateToken, async (req, res) => {
  try {
    await ensureGameLobbySchema();
    const status = req.body?.status === "afk" ? "afk" : "active";

    await ensureMatchPlayerStates(req.params.matchId);

    const matchStatusResult = await pool.query(
      `
      SELECT status
      FROM game_matches
      WHERE id = $1
      LIMIT 1
      `,
      [req.params.matchId]
    );

    if (!matchStatusResult.rows[0]) {
      return res.status(404).json({ error: "Match not found" });
    }

    if (status === "afk" && matchStatusResult.rows[0].status !== "active") {
      const match = await getMatchForUser(req.params.matchId, req.user.id);
      if (!match) {
        return res.status(404).json({ error: "Match player not found" });
      }
      return res.json({ match });
    }

    const result = await pool.query(
      `
      UPDATE game_match_player_states
      SET is_afk = $3,
          last_seen_at = CASE WHEN $3 = false THEN NOW() ELSE last_seen_at END,
          updated_at = NOW()
      WHERE match_id = $1
        AND user_id = $2
      RETURNING user_id
      `,
      [req.params.matchId, req.user.id, status === "afk"]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: "Match player not found" });
    }

    const match = await getMatchForUser(req.params.matchId, req.user.id);
    res.json({ match });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update match presence" });
  }
});

router.post("/matches/:matchId/ai-move", authenticateToken, async (req, res) => {
  try {
    await ensureGameLobbySchema();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await ensureMatchPlayerStates(req.params.matchId, client);

      const matchResult = await client.query(
        `
        SELECT *
        FROM game_matches
        WHERE id = $1
        FOR UPDATE
        `,
        [req.params.matchId]
      );
      const match = matchResult.rows[0];

      if (!match) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Match not found" });
      }
      if (match.status !== "active") {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "This match is already finished" });
      }

      const requesterMembership = await client.query(
        `
        SELECT 1
        FROM game_match_player_states
        WHERE match_id = $1
          AND user_id = $2
        LIMIT 1
        `,
        [match.id, req.user.id]
      );
      if (requesterMembership.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "You are not in this match" });
      }

      const currentTurnState = await client.query(
        `
        SELECT *
        FROM game_match_player_states
        WHERE match_id = $1
          AND user_id = $2
        LIMIT 1
        `,
        [match.id, match.current_turn_user_id]
      );
      const playerState = currentTurnState.rows[0];

      if (!playerState || !playerState.is_afk) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "AI can only move for an AFK player" });
      }

      const movesResult = await client.query(
        `
        SELECT mark, cell_index, move_number
        FROM game_match_moves
        WHERE match_id = $1
        ORDER BY move_number ASC
        `,
        [match.id]
      );
      const boardSize = match.board_size || BOARD_SIZE;
      const winLength = match.win_length || WIN_LENGTH;
      const board = getBoardFromMoves(movesResult.rows, boardSize);
      const aiCellIndex = getAiMoveIndex(board, playerState.mark, boardSize, winLength);

      if (aiCellIndex === null) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "No moves available" });
      }

      await applyMatchMove({
        client,
        match,
        playerState,
        cellIndex: aiCellIndex,
        isAiMove: true,
      });

      await client.query("COMMIT");
      res.json({ match: await getMatchForUser(match.id, req.user.id) });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => null);
      throw error;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "That move was already played" });
    }
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || "Failed to play AI move" });
  }
});

router.post("/matches/:matchId/move", authenticateToken, async (req, res) => {
  try {
    await ensureGameLobbySchema();
    const cellIndex = Number.parseInt(req.body?.cellIndex, 10);
    if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= BOARD_SIZE * BOARD_SIZE) {
      return res.status(400).json({ error: "Choose a valid square" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await ensureMatchPlayerStates(req.params.matchId, client);

      const matchResult = await client.query(
        `
        SELECT *
        FROM game_matches
        WHERE id = $1
        FOR UPDATE
        `,
        [req.params.matchId]
      );
      const match = matchResult.rows[0];
      if (!match) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Match not found" });
      }
      if (match.status !== "active") {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "This match is already finished" });
      }

      const stateResult = await client.query(
        `
        SELECT *
        FROM game_match_player_states
        WHERE match_id = $1
          AND user_id = $2
        LIMIT 1
        `,
        [match.id, req.user.id]
      );
      const playerState = stateResult.rows[0];
      if (!playerState) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "You are not in this match" });
      }
      if (match.current_turn_user_id !== req.user.id || playerState.mark !== match.current_mark) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "It is not your player turn" });
      }
      if (playerState.is_afk) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "You are marked AFK. Rejoin the match to take control." });
      }

      await applyMatchMove({ client, match, playerState, cellIndex });

      await client.query("COMMIT");
      res.json({ match: await getMatchForUser(match.id, req.user.id) });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => null);
      throw error;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "That move was already played" });
    }
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || "Failed to play move" });
  }
});

export default router;
