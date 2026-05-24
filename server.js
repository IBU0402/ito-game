const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';

const io = new Server(server, {
  cors: {
    origin: FRONTEND_ORIGIN,
    methods: ['GET', 'POST'],
  },
});

const PORT = process.env.PORT || 3000;
const MAX_ROOM_SIZE = 8;
const CHAT_CHAR_LIMIT = 20;
const GAME_DURATION_SEC = 180;

const CATEGORIES = [
  { id: 'character', label: 'キャラクター' },
  { id: 'food',      label: '食べ物' },
  { id: 'animal',    label: '動物' },
  { id: 'sport',     label: 'スポーツ' },
  { id: 'movie',     label: '映画・アニメ' },
  { id: 'country',   label: '国・地域' },
  { id: 'vehicle',   label: '乗り物' },
  { id: 'music',     label: '音楽' },
];

const ATTRIBUTES = [
  { id: 'strength',   label: '強さ',     description: '弱い ↔ 強い' },
  { id: 'popularity', label: '人気度',   description: '無名 ↔ 大人気' },
  { id: 'fame',       label: '知名度',   description: '知られていない ↔ 超有名' },
  { id: 'spicy',      label: '辛さ',     description: '辛くない ↔ 激辛' },
  { id: 'speed',      label: '速さ',     description: '遅い ↔ 速い' },
  { id: 'height',     label: '高さ',     description: '低い ↔ 高い' },
  { id: 'cute',       label: 'かわいさ', description: 'かわいくない ↔ 超かわいい' },
  { id: 'expensive',  label: '値段',     description: '安い ↔ 高い' },
  { id: 'scary',      label: '怖さ',     description: '怖くない ↔ 超怖い' },
  { id: 'difficult',  label: '難しさ',   description: '簡単 ↔ 超難しい' },
];

// rooms: Map<roomId, RoomState>
const rooms = new Map();

// socketId -> roomId
const socketRoom = new Map();

function findOrCreateRoom(categoryId, attributeId) {
  const category = CATEGORIES.find((c) => c.id === categoryId);
  const attribute = ATTRIBUTES.find((a) => a.id === attributeId);
  if (!category || !attribute) return null;

  const themeId = `${categoryId}_${attributeId}`;
  const themeLabel = `${category.label}の${attribute.label}`;
  const themeDescription = attribute.description;

  for (const [, room] of rooms) {
    if (
      room.themeId === themeId &&
      room.state === 'waiting' &&
      room.players.length < MAX_ROOM_SIZE
    ) {
      return room;
    }
  }

  const roomId = `${themeId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const room = {
    id: roomId,
    themeId,
    themeLabel,
    themeDescription,
    players: [],
    state: 'waiting',
    messages: [],
    submissionOrder: [],
    startTime: null,
    timer: null,
  };
  rooms.set(roomId, room);
  return room;
}

function publicPlayer(p) {
  return { id: p.id, name: p.name, isReady: p.isReady, hasSubmitted: p.hasSubmitted };
}

function broadcastRoomCounts() {
  const counts = {};
  for (const [, room] of rooms) {
    if (room.state === 'waiting' && room.players.length > 0) {
      counts[room.themeId] = room.players.length;
    }
  }
  io.emit('room-counts', counts);
}

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on('get-themes', () => {
    socket.emit('themes', { categories: CATEGORIES, attributes: ATTRIBUTES });
    // 接続時に現在の待機人数を送信
    const counts = {};
    for (const [, room] of rooms) {
      if (room.state === 'waiting' && room.players.length > 0) {
        counts[room.themeId] = room.players.length;
      }
    }
    socket.emit('room-counts', counts);
  });

  socket.on('join-room', ({ name, categoryId, attributeId }) => {
    if (!name || !categoryId || !attributeId) return;

    const room = findOrCreateRoom(categoryId, attributeId);
    if (!room) return;

    const player = {
      id: socket.id,
      name: String(name).slice(0, 20),
      number: null,
      isReady: false,
      hasSubmitted: false,
      submittedAt: null,
    };

    room.players.push(player);
    socket.join(room.id);
    socketRoom.set(socket.id, room.id);

    socket.emit('room-joined', {
      roomId: room.id,
      themeLabel: room.themeLabel,
      themeDescription: room.themeDescription,
      players: room.players.map(publicPlayer),
    });

    socket.to(room.id).emit('player-joined', {
      player: publicPlayer(player),
    });

    broadcastRoomCounts();
  });

  socket.on('player-ready', () => {
    const room = rooms.get(socketRoom.get(socket.id));
    if (!room || room.state !== 'waiting') return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player || player.isReady) return;

    player.isReady = true;

    io.to(room.id).emit('player-ready-updated', {
      playerId: socket.id,
      players: room.players.map(publicPlayer),
    });

    if (room.players.length >= 2 && room.players.every((p) => p.isReady)) {
      startGame(room);
    }
  });

  socket.on('chat-message', ({ text }) => {
    const room = rooms.get(socketRoom.get(socket.id));
    if (!room || room.state !== 'playing') return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    const trimmed = String(text).trim().slice(0, CHAT_CHAR_LIMIT);
    if (!trimmed) return;

    const message = {
      playerId: socket.id,
      playerName: player.name,
      text: trimmed,
      timestamp: Date.now(),
    };

    room.messages.push(message);
    io.to(room.id).emit('chat-message', message);
  });

  socket.on('submit-card', () => {
    const room = rooms.get(socketRoom.get(socket.id));
    if (!room || room.state !== 'playing') return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player || player.hasSubmitted) return;

    player.hasSubmitted = true;
    player.submittedAt = Date.now();
    room.submissionOrder.push(socket.id);

    io.to(room.id).emit('card-submitted', {
      playerId: socket.id,
      playerName: player.name,
      submissionCount: room.submissionOrder.length,
      totalPlayers: room.players.length,
    });

    if (room.players.every((p) => p.hasSubmitted)) {
      clearTimeout(room.timer);
      endGame(room);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`);
    const roomId = socketRoom.get(socket.id);
    socketRoom.delete(socket.id);

    const room = rooms.get(roomId);
    if (!room) return;

    const wasWaiting = room.state === 'waiting';
    room.players = room.players.filter((p) => p.id !== socket.id);
    io.to(room.id).emit('player-left', {
      playerId: socket.id,
      players: room.players.map(publicPlayer),
    });

    if (room.players.length === 0) {
      if (room.timer) clearTimeout(room.timer);
      rooms.delete(roomId);
    }

    if (wasWaiting) broadcastRoomCounts();
  });
});

function startGame(room) {
  room.state = 'playing';
  room.startTime = Date.now();

  broadcastRoomCounts();

  const numbers = shuffle(Array.from({ length: 100 }, (_, i) => i + 1)).slice(
    0,
    room.players.length,
  );
  room.players.forEach((player, i) => {
    player.number = numbers[i];
  });

  room.players.forEach((player) => {
    io.to(player.id).emit('game-started', {
      yourNumber: player.number,
      themeLabel: room.themeLabel,
      themeDescription: room.themeDescription,
      durationSec: GAME_DURATION_SEC,
      playerCount: room.players.length,
    });
  });

  room.timer = setTimeout(() => endGame(room), GAME_DURATION_SEC * 1000);
}

function endGame(room) {
  if (room.state === 'finished') return;
  room.state = 'finished';

  const orderedPlayers = room.submissionOrder
    .map((id) => room.players.find((p) => p.id === id))
    .filter(Boolean);

  const allSubmitted = room.players.length > 0 && room.players.every((p) => p.hasSubmitted);
  const isSuccess = allSubmitted && isAscending(orderedPlayers.map((p) => p.number));

  let firstViolationIndex = -1;
  for (let i = 1; i < orderedPlayers.length; i++) {
    if (orderedPlayers[i].number < orderedPlayers[i - 1].number) {
      firstViolationIndex = i;
      break;
    }
  }

  const results = room.players.map((player) => {
    const order = room.submissionOrder.indexOf(player.id);
    return {
      id: player.id,
      name: player.name,
      number: player.number,
      submittedAt: player.submittedAt,
      submissionOrder: order >= 0 ? order + 1 : null,
      isViolation: order >= 0 && order === firstViolationIndex,
    };
  });

  io.to(room.id).emit('game-ended', {
    isSuccess,
    results,
    submissionOrder: room.submissionOrder,
    firstViolationIndex,
  });
}

function isAscending(arr) {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < arr[i - 1]) return false;
  }
  return true;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

app.use(cors());
app.use(express.static('docs'));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
