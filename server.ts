import http from 'http';
import path from 'path';
import express, { Request, Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

interface PlayerInfo {
  token: string;
  name: string;
  connected: boolean;
}

interface ChessMove {
  seq: number;
  color: 'w' | 'b';
  from: { r: number; c: number };
  to: { r: number; c: number };
  promotion?: string;
  san?: string;
  ts: number;
}

interface ChatMessage {
  id: string;
  color: 'w' | 'b' | 'system';
  name: string;
  text: string;
  ts: number;
}

interface RoomData {
  code: string;
  status: 'waiting' | 'playing' | 'checkmate' | 'draw';
  white: PlayerInfo | null;
  black: PlayerInfo | null;
  whiteJoined: boolean;
  blackJoined: boolean;
  turn: 'w' | 'b';
  moves: ChessMove[];
  messages: ChatMessage[];
  resetCount: number;
  createdAt: number;
  updatedAt: number;
}

const rooms = new Map<string, RoomData>();
const roomSockets = new Map<string, Set<WebSocket>>();
const socketRooms = new WeakMap<WebSocket, { code: string; token: string }>();

function generateRoomCode(): string {
  const words = ['MAGE', 'RUNE', 'CASTLE', 'BISHOP', 'KNIGHT', 'SANCTUM', 'SPIRE', 'ALTAR', 'CROWN', 'CHESS'];
  const base = words[Math.floor(Math.random() * words.length)];
  const num = Math.floor(10 + Math.random() * 90);
  const code = `${base}${num}`;
  if (rooms.has(code)) return generateRoomCode();
  return code;
}

function getSafeRoomPayload(room: RoomData) {
  return {
    code: room.code,
    status: room.status,
    whiteJoined: room.whiteJoined,
    blackJoined: room.blackJoined,
    turn: room.turn,
    moves: room.moves,
    messages: room.messages.slice(-30),
    resetCount: room.resetCount,
    whiteName: room.white?.name || 'White Wizard',
    blackName: room.black?.name || 'Black Wizard',
    whiteConnected: Boolean(room.white?.connected),
    blackConnected: Boolean(room.black?.connected),
    updatedAt: room.updatedAt,
  };
}

function broadcastRoom(code: string, event: { type: string; [key: string]: unknown }) {
  const sockets = roomSockets.get(code);
  if (!sockets) return;
  const payload = JSON.stringify(event);
  for (const client of sockets) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  // WebSocket connections
  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', (data: string | Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        if (msg.type === 'join') {
          const { code, playerToken, playerName } = msg;
          if (!code) return;
          const room = rooms.get(code.toUpperCase());
          if (!room) {
            ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
            return;
          }

          socketRooms.set(ws, { code: room.code, token: playerToken || '' });
          if (!roomSockets.has(room.code)) {
            roomSockets.set(room.code, new Set());
          }
          roomSockets.get(room.code)!.add(ws);

          // Mark player connection status
          if (room.white && room.white.token === playerToken) {
            room.white.connected = true;
            if (playerName) room.white.name = playerName;
          } else if (room.black && room.black.token === playerToken) {
            room.black.connected = true;
            if (playerName) room.black.name = playerName;
          }
          room.updatedAt = Date.now();

          // Send current room state
          ws.send(
            JSON.stringify({
              type: 'room_state',
              room: getSafeRoomPayload(room),
            })
          );
          broadcastRoom(room.code, {
            type: 'player_status',
            room: getSafeRoomPayload(room),
          });
          return;
        }

        if (msg.type === 'move') {
          const { code, playerToken, color, from, to, promotion, san } = msg;
          const room = rooms.get(code?.toUpperCase());
          if (!room) return;

          // Validate player color & turn
          const isWhite = room.white && room.white.token === playerToken;
          const isBlack = room.black && room.black.token === playerToken;
          if (!isWhite && !isBlack) return;

          const playerColor = isWhite ? 'w' : 'b';
          if (color && color !== playerColor) return;
          if (room.turn !== playerColor) return;

          const newMove: ChessMove = {
            seq: room.moves.length + 1,
            color: playerColor,
            from,
            to,
            promotion: promotion || 'queen',
            san: san || '',
            ts: Date.now(),
          };

          room.moves.push(newMove);
          room.turn = playerColor === 'w' ? 'b' : 'w';
          room.updatedAt = Date.now();

          broadcastRoom(room.code, {
            type: 'move',
            move: newMove,
            room: getSafeRoomPayload(room),
          });
          return;
        }

        if (msg.type === 'chat') {
          const { code, playerToken, text } = msg;
          const room = rooms.get(code?.toUpperCase());
          if (!room || !text) return;

          const isWhite = room.white && room.white.token === playerToken;
          const isBlack = room.black && room.black.token === playerToken;
          const senderColor = isWhite ? 'w' : isBlack ? 'b' : 'system';
          const senderName = isWhite
            ? room.white?.name || 'White Wizard'
            : isBlack
            ? room.black?.name || 'Black Wizard'
            : 'Watcher';

          const chatMsg: ChatMessage = {
            id: 'msg_' + Math.random().toString(36).slice(2, 9),
            color: senderColor,
            name: senderName,
            text: String(text).slice(0, 140),
            ts: Date.now(),
          };

          room.messages.push(chatMsg);
          room.updatedAt = Date.now();

          broadcastRoom(room.code, {
            type: 'chat',
            message: chatMsg,
            room: getSafeRoomPayload(room),
          });
          return;
        }

        if (msg.type === 'reset') {
          const { code, playerToken } = msg;
          const room = rooms.get(code?.toUpperCase());
          if (!room) return;

          room.moves = [];
          room.turn = 'w';
          room.resetCount += 1;
          room.status = room.whiteJoined && room.blackJoined ? 'playing' : 'waiting';
          room.updatedAt = Date.now();

          room.messages.push({
            id: 'sys_' + Date.now(),
            color: 'system',
            name: 'Sanctum Altar',
            text: 'The cathedral board has been reset for a fresh duel!',
            ts: Date.now(),
          });

          broadcastRoom(room.code, {
            type: 'reset',
            room: getSafeRoomPayload(room),
          });
          return;
        }
      } catch (err) {
        console.error('WS Message Error:', err);
      }
    });

    ws.on('close', () => {
      const info = socketRooms.get(ws);
      if (info) {
        const { code, token } = info;
        const set = roomSockets.get(code);
        if (set) {
          set.delete(ws);
          if (set.size === 0) roomSockets.delete(code);
        }
        const room = rooms.get(code);
        if (room) {
          if (room.white && room.white.token === token) {
            room.white.connected = false;
          }
          if (room.black && room.black.token === token) {
            room.black.connected = false;
          }
          room.updatedAt = Date.now();
          broadcastRoom(code, {
            type: 'player_status',
            room: getSafeRoomPayload(room),
          });
        }
      }
    });
  });

  // REST API Routes
  app.post('/api/rooms/create', (req: Request, res: Response) => {
    const { preferredColor, playerToken, playerName } = req.body || {};
    const code = generateRoomCode();
    const token = playerToken || 'tok_' + Math.random().toString(36).slice(2, 10);
    const name = playerName || (preferredColor === 'b' ? 'Black Wizard' : 'White Wizard');

    let assignedColor: 'w' | 'b' = preferredColor === 'b' ? 'b' : 'w';
    if (preferredColor === 'random') {
      assignedColor = Math.random() < 0.5 ? 'w' : 'b';
    }

    const room: RoomData = {
      code,
      status: 'waiting',
      white: assignedColor === 'w' ? { token, name, connected: true } : null,
      black: assignedColor === 'b' ? { token, name, connected: true } : null,
      whiteJoined: assignedColor === 'w',
      blackJoined: assignedColor === 'b',
      turn: 'w',
      moves: [],
      messages: [
        {
          id: 'sys_' + Date.now(),
          color: 'system',
          name: 'Sanctum Chamber',
          text: `Chamber created! Share Room Code "${code}" with your rival.`,
          ts: Date.now(),
        },
      ],
      resetCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    rooms.set(code, room);
    res.json({
      ok: true,
      code,
      color: assignedColor,
      playerToken: token,
      room: getSafeRoomPayload(room),
    });
  });

  app.post('/api/rooms/join', (req: Request, res: Response) => {
    const { code, playerToken, playerName } = req.body || {};
    const formattedCode = String(code || '').trim().toUpperCase();
    const room = rooms.get(formattedCode);

    if (!room) {
      res.status(404).json({ ok: false, error: 'Sanctum Room not found. Please check the code.' });
      return;
    }

    const token = playerToken || 'tok_' + Math.random().toString(36).slice(2, 10);
    const name = playerName || 'Guest Wizard';

    let assignedColor: 'w' | 'b' = 'w';
    // Check if returning player
    if (room.white && room.white.token === token) {
      assignedColor = 'w';
      room.white.connected = true;
      if (playerName) room.white.name = playerName;
    } else if (room.black && room.black.token === token) {
      assignedColor = 'b';
      room.black.connected = true;
      if (playerName) room.black.name = playerName;
    } else if (!room.whiteJoined) {
      assignedColor = 'w';
      room.white = { token, name, connected: true };
      room.whiteJoined = true;
    } else if (!room.blackJoined) {
      assignedColor = 'b';
      room.black = { token, name, connected: true };
      room.blackJoined = true;
    } else {
      // Both seats filled; allow join as spectator or reassign if disconnected
      assignedColor = 'b';
      if (!room.black?.connected) {
        room.black = { token, name, connected: true };
      }
    }

    room.status = room.whiteJoined && room.blackJoined ? 'playing' : 'waiting';
    room.updatedAt = Date.now();

    room.messages.push({
      id: 'sys_' + Date.now(),
      color: 'system',
      name: 'Sanctum Altar',
      text: `${name} entered the sanctum playing as ${assignedColor === 'w' ? 'White' : 'Black'}!`,
      ts: Date.now(),
    });

    broadcastRoom(room.code, {
      type: 'player_joined',
      room: getSafeRoomPayload(room),
    });

    res.json({
      ok: true,
      code: room.code,
      color: assignedColor,
      playerToken: token,
      room: getSafeRoomPayload(room),
    });
  });

  app.get('/api/rooms/public', (_req: Request, res: Response) => {
    const activeList = Array.from(rooms.values())
      .filter((r) => Date.now() - r.updatedAt < 1000 * 60 * 60 * 2) // active in last 2 hours
      .map((r) => ({
        code: r.code,
        status: r.status,
        whiteJoined: r.whiteJoined,
        blackJoined: r.blackJoined,
        moveCount: r.moves.length,
        updatedAt: r.updatedAt,
      }))
      .slice(0, 12);
    res.json({ ok: true, rooms: activeList });
  });

  app.get('/api/rooms/:code/state', (req: Request, res: Response) => {
    const room = rooms.get(req.params.code.toUpperCase());
    if (!room) {
      res.status(404).json({ ok: false, error: 'Room not found' });
      return;
    }
    res.json({ ok: true, room: getSafeRoomPayload(room) });
  });

  app.post('/api/rooms/:code/move', (req: Request, res: Response) => {
    const room = rooms.get(req.params.code.toUpperCase());
    if (!room) {
      res.status(404).json({ ok: false, error: 'Room not found' });
      return;
    }

    const { playerToken, color, from, to, promotion, san } = req.body || {};
    const newMove: ChessMove = {
      seq: room.moves.length + 1,
      color: color || room.turn,
      from,
      to,
      promotion: promotion || 'queen',
      san: san || '',
      ts: Date.now(),
    };

    room.moves.push(newMove);
    room.turn = room.turn === 'w' ? 'b' : 'w';
    room.updatedAt = Date.now();

    broadcastRoom(room.code, {
      type: 'move',
      move: newMove,
      room: getSafeRoomPayload(room),
    });

    res.json({ ok: true, room: getSafeRoomPayload(room) });
  });

  app.post('/api/rooms/:code/reset', (req: Request, res: Response) => {
    const room = rooms.get(req.params.code.toUpperCase());
    if (!room) {
      res.status(404).json({ ok: false, error: 'Room not found' });
      return;
    }
    room.moves = [];
    room.turn = 'w';
    room.resetCount += 1;
    room.updatedAt = Date.now();

    broadcastRoom(room.code, {
      type: 'reset',
      room: getSafeRoomPayload(room),
    });

    res.json({ ok: true, room: getSafeRoomPayload(room) });
  });

  app.get('/api/rooms/:code/events', (req: Request, res: Response) => {
    const room = rooms.get(req.params.code.toUpperCase());
    if (!room) {
      res.status(404).end();
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const interval = setInterval(() => {
      res.write(`data: ${JSON.stringify({ room: getSafeRoomPayload(room) })}\n\n`);
    }, 2000);

    req.on('close', () => {
      clearInterval(interval);
    });
  });

  // Vite middleware in dev or static files in production
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Wizard Chess Sanctum server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
