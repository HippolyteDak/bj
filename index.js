import { WebSocketServer } from "ws";
import crypto from "crypto";

const wss = new WebSocketServer({ port: process.env.PORT || 8080 });

const WIDTH = 10;
const HEIGHT = 10;
const BASE_PRODUCTS = 6;

const rooms = {};

function genCode() {
  return Math.random().toString(36).substring(2,6).toUpperCase();
}

function generateHoles() {
  const holes = [];
  for (let i = 0; i < WIDTH; i++) {
    if (Math.random() < 0.3) holes.push({ x: i, y: 0 });
    if (Math.random() < 0.3) holes.push({ x: i, y: HEIGHT - 1 });
  }
  for (let i = 0; i < HEIGHT; i++) {
    if (Math.random() < 0.3) holes.push({ x: 0, y: i });
    if (Math.random() < 0.3) holes.push({ x: WIDTH - 1, y: i });
  }
  return holes;
}

function generateProducts(existing = []) {
  const products = [...existing];
  while (products.length < BASE_PRODUCTS) {
    const x = Math.floor(Math.random() * WIDTH);
    const y = Math.floor(Math.random() * HEIGHT);
    if (!products.some(p => p.x === x && p.y === y)) {
      products.push({ x, y });
    }
  }
  return products;
}

function broadcast(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const data = JSON.stringify({
    type: "state",
    players: room.players,
    products: room.products,
    holes: room.holes,
    radiologist: room.radiologist,
    required: room.required
  });

  room.clients.forEach(ws => {
    if (ws.readyState === 1) ws.send(data);
  });
}

function startRadiologist(roomId) {
  const room = rooms[roomId];
  if (!room || room.holes.length < 2) return;

  const entry = room.holes[Math.floor(Math.random() * room.holes.length)];
  const exit  = room.holes[Math.floor(Math.random() * room.holes.length)];

  room.required = 2;
  room.radiologist = {
    x: entry.x,
    y: entry.y,
    dx: Math.sign(exit.x - entry.x) || 1,
    dy: Math.sign(exit.y - entry.y) || 0,
    active: true,
    start: Date.now()
  };

  broadcast(roomId);

  const interval = setInterval(() => {
    const r = room.radiologist;
    if (!r || !r.active) return;

    // mouvement aléatoire possible
    if (Math.random() < 0.2) {
      r.dx *= -1;
      r.dy *= -1;
    }

    r.x = Math.max(0, Math.min(WIDTH - 1, r.x + r.dx));
    r.y = Math.max(0, Math.min(HEIGHT - 1, r.y + r.dy));

    // sortie par un trou après 3s minimum
    if (room.holes.some(h => h.x === r.x && h.y === r.y) && (Date.now() - r.start > 3000)) {
      r.active = false;
      clearInterval(interval);

      // pénalité joueurs
      Object.values(room.players).forEach(p => {
        if (p.collected < room.required) p.lives--;
        p.collected = 0;
      });

      room.radiologist = null;
      room.required = 0;
      broadcast(roomId);

      // relance radiologue après délai
      setTimeout(() => startRadiologist(roomId), 3000);
      return;
    }

    broadcast(roomId);

  }, 700);
}

wss.on("connection", ws => {
  let roomId = null;
  let playerId = null;

  ws.on("message", msg => {
    const data = JSON.parse(msg);

    if (data.type === "create") {
      roomId = genCode();
      playerId = crypto.randomUUID();

      rooms[roomId] = {
        players: {
          [playerId]: { x: 5, y: 5, lives: 3, collected: 0 }
        },
        products: generateProducts(),
        holes: generateHoles(),
        radiologist: null,
        required: 0,
        clients: [ws]
      };

      ws.send(JSON.stringify({ type: "created", roomId, playerId }));

      // si on veut le radiologue dès le début :
      setTimeout(() => startRadiologist(roomId), 3000);
    }

    if (data.type === "join") {
      const room = rooms[data.roomId];
      if (!room || room.clients.length >= 2) return;

      roomId = data.roomId;
      playerId = crypto.randomUUID();

      room.players[playerId] = { x: 4, y: 5, lives: 3, collected: 0 };
      room.clients.push(ws);

      ws.send(JSON.stringify({ type: "joined", roomId, playerId }));

      broadcast(roomId);

      // démarrer le radiologue si pas déjà présent
      if (!room.radiologist) startRadiologist(roomId);
    }

    if (data.type === "move") {
      const room = rooms[roomId];
      if (!room) return;

      const p = room.players[playerId];
      if (!p) return;

      p.x = Math.max(0, Math.min(WIDTH - 1, p.x + data.dx));
      p.y = Math.max(0, Math.min(HEIGHT - 1, p.y + data.dy));

      const idx = room.products.findIndex(pr => pr.x === p.x && pr.y === p.y);
      if (idx !== -1) {
        room.products.splice(idx, 1);
        p.collected++;
        room.products.push(generateProducts()[0]);
      }

      broadcast(roomId);
    }
  });

  ws.on("close", () => {
    if (!rooms[roomId]) return;
    delete rooms[roomId].players[playerId];
    rooms[roomId].clients = rooms[roomId].clients.filter(c => c !== ws);
    if (rooms[roomId].clients.length === 0) delete rooms[roomId];
    else broadcast(roomId);
  });
});

console.log("🟢 Serveur prêt");
