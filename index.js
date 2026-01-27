import { WebSocketServer } from "ws";
import crypto from "crypto";

const wss = new WebSocketServer({ port: process.env.PORT || 8080 });

const WIDTH = 10;
const HEIGHT = 10;
const BASE_PRODUCTS = 6;

const rooms = {};

// Générer code 4 lettres
function genCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// Générer trous aléatoires
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

// Générer n produits aléatoires
function generateProducts(count = BASE_PRODUCTS, existing = []) {
  const products = [...existing];
  while (products.length < count) {
    const x = Math.floor(Math.random() * WIDTH);
    const y = Math.floor(Math.random() * HEIGHT);
    if (!products.some(p => p.x === x && p.y === y)) products.push({ x, y });
  }
  return products;
}

// Diffuser l'état aux clients
function broadcast(roomId, msg) {
  const room = rooms[roomId];
  if (!room) return;

  const data = msg || {
    type: "state",
    players: room.players,
    products: room.products,
    holes: room.holes,
    radiologist: room.radiologist,
    required: room.required
  };

  room.clients.forEach(ws => {
    if (ws.readyState === 1) ws.send(JSON.stringify(data));
  });
}

// Boucle radiologue
function startRadiologist(roomId) {
  const room = rooms[roomId];
  if (!room || room.holes.length < 2) return;

  // Choisir entrée/sortie
  const entry = room.holes[Math.floor(Math.random() * room.holes.length)];
  const exit  = room.holes[Math.floor(Math.random() * room.holes.length)];

  room.required = Math.max(1, Math.floor(2 + Math.random() * 3));
  room.radiologist = {
    x: entry.x,
    y: entry.y,
    dx: Math.sign(exit.x - entry.x) || 1,
    dy: Math.sign(exit.y - entry.y) || 0
  };

  // Reset collectedVisit pour tous les joueurs
  Object.values(room.players).forEach(p => p.collectedVisit = 0);

  const interval = setInterval(() => {
    if (!room.radiologist) return;

    const r = room.radiologist;
    // Mouvement aléatoire pour petits virages
    if (Math.random() < 0.2) {
      r.dx *= -1;
      r.dy *= -1;
    }

    r.x = Math.max(0, Math.min(WIDTH - 1, r.x + r.dx));
    r.y = Math.max(0, Math.min(HEIGHT - 1, r.y + r.dy));

    // Si sur un trou et min 3 sec écoulées => radiologue sort
    if (room.holes.some(h => h.x === r.x && h.y === r.y)) {
      clearInterval(interval);
      room.radiologist = null;

      // Vérifier quotas pour tous les joueurs
      Object.entries(room.players).forEach(([pid, p]) => {
        if (p.collectedVisit < room.required) p.lives--;
        p.collectedVisit = 0;
      });

      // Vérifier fin de partie
      const pIds = Object.keys(room.players);
      const p0 = room.players[pIds[0]];
      const p1 = room.players[pIds[1]];

      if (pIds.length === 2) {
        let gameOver = false, msg = {};
        if (p0.lives <= 0 && p1.lives <= 0) {
          // Égalité ou comparer produits
          gameOver = true;
          if (p0.collected < p1.collected) {
            msg = { type: "gameover", winnerId: p0.id, loserId: p1.id, tie:false, products:{[p0.id]:p0.collected,[p1.id]:p1.collected}};
          } else if (p1.collected < p0.collected) {
            msg = { type: "gameover", winnerId: p1.id, loserId: p0.id, tie:false, products:{[p0.id]:p0.collected,[p1.id]:p1.collected}};
          } else {
            msg = { type:"gameover", tie:true, winnerId:p0.id, loserId:p1.id, products:{[p0.id]:p0.collected,[p1.id]:p1.collected} };
          }
        } else if (p0.lives <=0 || p1.lives<=0){
          gameOver = true;
          const winner = p0.lives>0? p0.id : p1.id;
          const loser  = p0.lives<=0? p0.id : p1.id;
          msg = {type:"gameover", winnerId:winner, loserId:loser, tie:false, products:{[p0.id]:p0.collected,[p1.id]:p1.collected}};
        }
        if(gameOver){
          broadcast(roomId,msg);
          delete rooms[roomId];
          return;
        }
      }

      broadcast(roomId);
      setTimeout(()=> startRadiologist(roomId), 3000 + Math.random()*2000);
      return;
    }

    broadcast(roomId);
  }, 700);
}

// =================== Connexions ===================
wss.on("connection", ws => {
  let roomId=null;
  let playerId=null;

  ws.on("message", msg => {
    let data;
    try { data = JSON.parse(msg); } catch(e){ return; }

    if(data.type==="create"){
      roomId = genCode();
      playerId = crypto.randomUUID();

      rooms[roomId] = {
        players: { [playerId]: { id: playerId, x:5, y:5, lives:3, collected:0, collectedVisit:0 } },
        products: generateProducts(),
        holes: generateHoles(),
        radiologist: null,
        required: 0,
        clients: [ws]
      };

      ws.send(JSON.stringify({type:"created", roomId, playerId}));
    }

    if(data.type==="join"){
      const room = rooms[data.roomId];
      if(!room || room.clients.length>=2){
        ws.send(JSON.stringify({type:"error", message:"Partie invalide ou pleine"}));
        return;
      }

      roomId = data.roomId;
      playerId = crypto.randomUUID();
      room.players[playerId] = { id:playerId, x:4, y:5, lives:3, collected:0, collectedVisit:0 };
      room.clients.push(ws);

      ws.send(JSON.stringify({type:"joined", roomId, playerId}));

      broadcast(roomId);
      startRadiologist(roomId);
    }

    if(data.type==="move"){
      const room = rooms[roomId];
      if(!room) return;

      const p = room.players[playerId];
      if(!p) return;

      p.x = Math.max(0, Math.min(WIDTH-1, p.x + data.dx));
      p.y = Math.max(0, Math.min(HEIGHT-1, p.y + data.dy));

      // Vérifie si produit sur la case
      const idx = room.products.findIndex(pr => pr.x === p.x && pr.y === p.y);
      if(idx!==-1){
        room.products.splice(idx,1);
        p.collected++;
        p.collectedVisit++;

        // Respawn 1 produit
        let newProd;
        do {
          newProd = { x: Math.floor(Math.random()*WIDTH), y: Math.floor(Math.random()*HEIGHT) };
        } while(room.products.some(pr=>pr.x===newProd.x && pr.y===newProd.y));
        room.products.push(newProd);
      }

      broadcast(roomId);
    }
  });

  ws.on("close", () => {
    if(!roomId || !rooms[roomId]) return;
    delete rooms[roomId].players[playerId];
    rooms[roomId].clients = rooms[roomId].clients.filter(c => c!==ws);
    if(rooms[roomId].clients.length===0) delete rooms[roomId];
    else broadcast(roomId);
  });
});

console.log("🟢 Serveur WebSocket prêt !");
