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

function generateProducts(existing=[]) {
  const products = [...existing];
  while(products.length < BASE_PRODUCTS) {
    const x = Math.floor(Math.random() * WIDTH);
    const y = Math.floor(Math.random() * HEIGHT);
    if(!products.some(p=>p.x===x&&p.y===y)) products.push({x,y});
  }
  return products;
}

function broadcast(roomId) {
  const room = rooms[roomId];
  if(!room) return;

  const data = JSON.stringify({
    type: "state",
    players: room.players,
    products: room.products,
    holes: room.holes,
    radiologist: room.radiologist,
    required: room.required
  });

  room.clients.forEach(ws => {
    if(ws.readyState===1) ws.send(data);
  });
}

// Radiologue
function startRadiologist(roomId) {
  const room = rooms[roomId];
  if(!room || room.holes.length<2) return;

  const entry = room.holes[Math.floor(Math.random()*room.holes.length)];
  const exit  = room.holes[Math.floor(Math.random()*room.holes.length)];

  room.required = Math.max(1, Math.floor(Math.random()*3)+1);
  room.radiologist = {
    x: entry.x,
    y: entry.y,
    dx: Math.sign(exit.x - entry.x) || 1,
    dy: Math.sign(exit.y - entry.y) || 0,
    start: Date.now()
  };

  // Reset collectedVisit pour tous les joueurs
  Object.values(room.players).forEach(p => p.collectedVisit = 0);

  room.timer = setInterval(() => {
    const r = room.radiologist;
    if(!r) return;

    r.x += r.dx;
    r.y += r.dy;

    // Sortie si sur un trou
    if(room.holes.some(h=>h.x===r.x && h.y===r.y) && Date.now()-r.start>=2000){
      clearInterval(room.timer);
      room.radiologist = null;

      // Vérification produits pris
      Object.values(room.players).forEach(p=>{
        if(p.collectedVisit < room.required) p.lives--;
      });

      broadcast(roomId);

      // Vérifier GameOver
      const playersArray = Object.values(room.players);
      if(playersArray.every(p=>p.lives<=0)){
        // Comparer collected pour déterminer gagnant
        const ids = Object.keys(room.players);
        const p1 = room.players[ids[0]];
        const p2 = room.players[ids[1]];

        let winnerId=null, loserId=null, tie=false;
        if(!p1 || !p2){ winnerId=ids[0]; loserId=null; }
        else if(p1.collected === p2.collected){ tie=true; winnerId=ids[0]; loserId=ids[1]; }
        else if(p1.collected < p2.collected){ winnerId=ids[0]; loserId=ids[1]; }
        else { winnerId=ids[1]; loserId=ids[0]; }

        broadcast(roomId,{
          type:"gameover",
          winnerId,
          loserId,
          tie,
          products: { [ids[0]]: p1.collected, [ids[1]]: p2.collected }
        });

        delete rooms[roomId];
        return;
      }

      // Nouveau radiologue après délai
      setTimeout(()=>startRadiologist(roomId), 3000);
      return;
    }

    broadcast(roomId);
  }, 800); // vitesse modérée
}

// Connexions
wss.on("connection", ws => {
  let roomId=null, playerId=null;

  ws.on("message", msg => {
    const data = JSON.parse(msg);

    // Création
    if(data.type==="create"){
      roomId = genCode();
      playerId = crypto.randomUUID();

      rooms[roomId] = {
        players: { [playerId]: { x:5, y:5, lives:3, collected:0, collectedVisit:0 } },
        products: generateProducts(),
        holes: generateHoles(),
        radiologist: null,
        required: 0,
        clients: [ws]
      };

      ws.send(JSON.stringify({ type:"created", roomId, playerId }));
      return;
    }

    // Rejoindre
    if(data.type==="join"){
      const room = rooms[data.roomId];
      if(!room || room.clients.length>=2){
        ws.send(JSON.stringify({type:"error", message:"Partie invalide ou pleine"}));
        return;
      }

      roomId = data.roomId;
      playerId = crypto.randomUUID();
      room.players[playerId] = { x:4, y:5, lives:3, collected:0, collectedVisit:0 };
      room.clients.push(ws);

      ws.send(JSON.stringify({type:"joined", roomId, playerId}));
      broadcast(roomId);
      startRadiologist(roomId);
      return;
    }

    // Déplacement
    if(data.type==="move"){
      const room = rooms[roomId];
      if(!room) return;

      const p = room.players[playerId];
      if(!p) return;

      p.x = Math.max(0, Math.min(WIDTH-1, p.x + data.dx));
      p.y = Math.max(0, Math.min(HEIGHT-1, p.y + data.dy));

      const idx = room.products.findIndex(pr=>pr.x===p.x && pr.y===p.y);
      if(idx!==-1){
        room.products.splice(idx,1);
        p.collected++;        // total accumulé
        p.collectedVisit++;   // pour le radiologue
        // Respawn produit ailleurs
        const newProd = generateProducts(room.products)[0];
        room.products.push(newProd);
      }

      broadcast(roomId);
    }
  });

  ws.on("close", () => {
    if(!rooms[roomId]) return;
    delete rooms[roomId].players[playerId];
    rooms[roomId].clients = rooms[roomId].clients.filter(c=>c!==ws);
    if(rooms[roomId].clients.length===0) delete rooms[roomId];
    else broadcast(roomId);
  });
});

console.log("🟢 Serveur prêt !");
