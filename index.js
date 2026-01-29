import { WebSocketServer } from "ws";
import crypto from "crypto";

const wss = new WebSocketServer({ port: process.env.PORT || 8080 });

const WIDTH = 10;
const HEIGHT = 10;
const BASE_PRODUCTS = 6;
const RADIO_MIN_TIME = 4000; // 2 secondes minimum par radiologue
const RADIO_MAX_TIME = 10000; // 5 secondes maximum par radiologue

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

function nearestHole(x, y, holes) {
  let best = null;
  let bestDist = Infinity;

  for (const h of holes) {
    const d = Math.abs(h.x - x) + Math.abs(h.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = h;
    }
  }
  return best;
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
    required: room.required,
    clope: room.clope,
    stretcher: room.stretcher,
    stretcherWarning: room.stretcherWarning
  };

  room.clients.forEach(ws => {
    if (ws.readyState === 1) ws.send(JSON.stringify(data));
  });
}

// Boucle radiologue
function startRadiologist(roomId) {
  const room = rooms[roomId];
  if(!room) return;
  room.clope = null;
  
  if (!room || room.holes.length < 2) return;

  // Choisir entrée/sortie
  const entry = room.holes[Math.floor(Math.random() * room.holes.length)];
  const exit  = room.holes[Math.floor(Math.random() * room.holes.length)];

  const spawnTime = Date.now();
  const maxDuration = RADIO_MIN_TIME + Math.random() * (RADIO_MAX_TIME - RADIO_MIN_TIME);
  room.required = Math.max(1, Math.floor(2 + Math.random() * 3));
  room.radiologist = {
    x: entry.x,
    y: entry.y,
    spawnTime,
    maxDuration,
    exiting: false,
    targetHole: null
  };

  // Reset collectedVisit pour tous les joueurs
  Object.values(room.players).forEach(p => p.collectedVisit = 0);

  const interval = setInterval(() => {
    if (!room.radiologist) return;

    const r = room.radiologist;
    // déplacements possibles
    const elapsed = Date.now() - r.spawnTime;

    // phase sortie
    if (elapsed >= r.maxDuration && !r.exiting) {
      r.exiting = true;
      r.targetHole = nearestHole(r.x, r.y, room.holes);
    }

    // mouvements
    if (r.exiting && r.targetHole) {
      // se diriger vers le trou
      if (r.x < r.targetHole.x) r.x++;
      else if (r.x > r.targetHole.x) r.x--;
      else if (r.y < r.targetHole.y) r.y++;
      else if (r.y > r.targetHole.y) r.y--;
    } else {
      // déplacement libre
      const moves = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 }
      ];

      const valid = moves.filter(m => {
        const nx = r.x + m.dx;
        const ny = r.y + m.dy;
        return nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT;
      });

      if (valid.length) {
        const m = valid[Math.floor(Math.random() * valid.length)];
        r.x += m.dx;
        r.y += m.dy;
      }
    }

    // Si sur un trou et min 3 sec écoulées => radiologue sort
    if (room.holes.some(h => h.x === r.x && h.y === r.y) && elapsed >= RADIO_MIN_TIME) {
      clearInterval(interval);
      room.radiologist = null;

      //check si un joueur a la clope
      Object.values(room.players).forEach(p => {
      if(p.clopeBonus){
        // joueur immunisé, ne perd pas de vie
        p.collectedVisit = room.required; // reset produits collectés
        p.clopeBonus = false;
    
        // déplacer automatiquement sur une case libre adjacente
        const freeCells = [
          {x:p.x+1,y:p.y},{x:p.x-1,y:p.y},
          {x:p.x,y:p.y+1},{x:p.x,y:p.y-1}
        ].filter(c => c.x>=0 && c.x<WIDTH && c.y>=0 && c.y<HEIGHT && !room.holes.some(h=>h.x===c.x && h.y===c.y));
    
        if(freeCells.length) {
          const target = freeCells[Math.floor(Math.random() * freeCells.length)];
          p.x = target.x;
          p.y = target.y;
        }
      }
    });

      
      // Vérifier quotas pour tous les joueurs
      Object.entries(room.players).forEach(([pid, p]) => {
        if (p.collectedVisit < room.required) p.lives--;
        p.collectedVisit = 0;
      });

      // Vérifier fin de partie
      endGame(roomId);

      if (room){
        // 25% de chance de spawn une clope
        if (Math.random() < 0.25) {
          spawnClope(room);
        }
        if (Math.random() < 1) {
          spawnStretcherWarning(roomId);
        }
  
        broadcast(roomId);
        setTimeout(()=> startRadiologist(roomId), 3000 + Math.random()*2000);
      }
      return;
    }

    broadcast(roomId);
  }, 700);
}

function endGame(roomId){
  const room = rooms[roomId];
  if (!room) return;
  
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
}

function spawnClope(room) {
  room.clope = findFreeCell(room);
}

function spawnProduct(room) {
  room.products.push(findFreeCell(room));
}

function findFreeCell(room) {
  let x, y;
  do {
    x = Math.floor(Math.random() * WIDTH);
    y = Math.floor(Math.random() * HEIGHT);
  } while (
    room.products.some(p => p.x === x && p.y === y) ||
    room.holes.some(h => h.x === x && h.y === y) ||
    Object.values(room.players).some(p => p.x === x && p.y === y) ||
    (room.clope && room.clope.x === x && room.clope.y === y)
  );
  return { x, y };
}

function pickStretcherDoor(room) {
  const door = room.holes[Math.floor(Math.random() * room.holes.length)];

  if (door.x === 0)       return { ...door, dir: "right" };
  if (door.x === WIDTH-1) return { ...door, dir: "left" };
  if (door.y === 0)       return { ...door, dir: "down" };
  if (door.y === HEIGHT-1)return { ...door, dir: "up" };
}

function spawnStretcherWarning(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const door = pickStretcherDoor(room);

  room.stretcherWarning = {
    x: door.x,
    y: door.y,
    dir: door.dir
  };

  broadcast(roomId);

  // après 1,5s → brancard arrive
  setTimeout(() => {
    if (rooms[roomId]) spawnStretcher(roomId, door);
  }, 1500);
}

function spawnStretcher(roomId, door) {
  const room = rooms[roomId];
  if (!room) return;

  room.stretcherWarning = null;

  let stretcher;

  if (door.dir === "right") {
    stretcher = { x: 0, y: door.y, dx: 1, dy: 0, orientation: "horizontal" };
  }
  if (door.dir === "left") {
    stretcher = { x: WIDTH-2, y: door.y, dx: -1, dy: 0, orientation: "horizontal" };
  }
  if (door.dir === "down") {
    stretcher = { x: door.x, y: 0, dx: 0, dy: 1, orientation: "vertical" };
  }
  if (door.dir === "up") {
    stretcher = { x: door.x, y: HEIGHT-2, dx: 0, dy: -1, orientation: "vertical" };
  }

  room.stretcher = stretcher;
  broadcast(roomId);

  moveStretcher(roomId);
}

function moveStretcher(roomId) {
  const room = rooms[roomId];
  if (!room || !room.stretcher) return;

  const interval = setInterval(() => {
    const s = room.stretcher;
    if (!s) return clearInterval(interval);

    s.x += s.dx;
    s.y += s.dy;

    // 🧍 collision joueurs
    Object.values(room.players).forEach(p => {
      const hit =
        (p.x === s.x && p.y === s.y) ||
        (s.orientation === "horizontal" && p.x === s.x + 1 && p.y === s.y) ||
        (s.orientation === "vertical" && p.x === s.x && p.y === s.y + 1);

      if (hit && !p.immune) {
        p.lives--;
      }
    });

    // sortie de map
    if (
      s.x < -2 || s.y < -2 ||
      s.x > WIDTH+1 || s.y > HEIGHT+1
    ) {
      clearInterval(interval);
      room.stretcher = null;
    }

    broadcast(roomId);
  }, 300);
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
        clope: null,
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
      setTimeout(() => {startRadiologist(roomId);}, 4000);
    }

    if(data.type==="move"){
      const room = rooms[roomId];
      if(!room) return;

      const p = room.players[playerId];
      if(!p) return;

      p.x = Math.max(0, Math.min(WIDTH-1, p.x + data.dx));
      p.y = Math.max(0, Math.min(HEIGHT-1, p.y + data.dy));

      // Vérifie clope sur la case
      // clope
      if (room.clope && p.x === room.clope.x && p.y === room.clope.y) {
        p.clopeBonus = true;      // ou autre bonus si tu veux plus tard
        broadcast(roomId);
        room.clope = null;
      }
      
      // Vérifie si produit sur la case
      const idx = room.products.findIndex(pr => pr.x === p.x && pr.y === p.y);
      if(idx!==-1){
        room.products.splice(idx,1);
        p.collected++;
        p.collectedVisit++;

        // Respawn 1 produit
        spawnProduct(room);
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
