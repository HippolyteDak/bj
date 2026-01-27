import { WebSocketServer } from "ws";
import crypto from "crypto";

const wss = new WebSocketServer({ port: process.env.PORT || 8080 });

// Toutes les parties
const rooms = {};

// Paramètres du jeu
const WIDTH = 10, HEIGHT = 10, BASE_PRODUCTS = 8;

// Générer code 4 lettres
function code() {
  return Math.random().toString(36).substring(2,6).toUpperCase();
}

// Création de trous aléatoires
function generateHoles() {
  const holes = [];
  for(let i=0;i<WIDTH;i++){
    if(Math.random()<0.25) holes.push({x:i,y:0});
    if(Math.random()<0.25) holes.push({x:i,y:HEIGHT-1});
  }
  for(let i=0;i<HEIGHT;i++){
    if(Math.random()<0.25) holes.push({x:0,y:i});
    if(Math.random()<0.25) holes.push({x:WIDTH-1,y:i});
  }
  return holes;
}

// Création de produits aléatoires
function generateProducts(existing=[], lastProduct=null){
  const products = [...existing];
  while(products.length < BASE_PRODUCTS){
    let x,y;
    do{
      x = Math.floor(Math.random()*WIDTH);
      y = Math.floor(Math.random()*HEIGHT);
    } while(products.some(p=>p.x===x&&p.y===y) || (lastProduct && lastProduct.x===x && lastProduct.y===y));
    products.push({x,y});
    lastProduct = {x,y};
  }
  return products;
}

// Boucle radiologue
function startRadiologistLoop(roomId){
  const room = rooms[roomId];
  if(!room) return;
  if(room.holes.length < 2) return;
  
  setTimeout(()=>{
    if(!rooms[roomId]) return;

    const entry = room.holes[Math.floor(Math.random()*room.holes.length)];
    const exit = room.holes[Math.floor(Math.random()*room.holes.length)];
    room.radiologist = {
      x: entry.x,
      y: entry.y,
      dx: Math.sign(exit.x-entry.x)||1,
      dy: Math.sign(exit.y-entry.y)||0,
      start: Date.now(),
      duration: 6000 + Math.random()*4000,
      required: 1
    };
    room.radiologist.required = Math.max(1, Math.floor(room.radiologist.duration/3000));

    const interval = setInterval(()=>{
      if(!room.radiologist) return;
      if(Math.random()<0.3){ room.radiologist.dx*=-1; room.radiologist.dy*=-1; }
      room.radiologist.x = Math.max(0, Math.min(WIDTH-1, room.radiologist.x+room.radiologist.dx));
      room.radiologist.y = Math.max(0, Math.min(HEIGHT-1, room.radiologist.y+room.radiologist.dy));
      broadcast(roomId);
      // sortie si sur trou et au moins 3s
      if(room.holes.some(h=>h.x===room.radiologist.x&&h.y===room.radiologist.y) &&
         Date.now()-room.radiologist.start>=3000){
        endRadiologist(roomId, interval);
      }
    }, 700);

    setTimeout(()=> endRadiologist(roomId, interval), room.radiologist.duration);

  }, 3000 + Math.random()*4000);
}

function endRadiologist(roomId, interval){
  clearInterval(interval);
  const room = rooms[roomId];
  if(!room || !room.radiologist) return;
  // si les joueurs n'ont pas collecté assez, enlever vie
  Object.values(room.players).forEach(p=>{
    if((p.collectedVisit||0) < room.radiologist.required){
      p.lives = (p.lives||3) - 1;
    }
  });
  room.radiologist = null;
  broadcast(roomId);
  startRadiologistLoop(roomId);
}

// Diffuser état complet
function broadcast(roomId){
  const room = rooms[roomId];
  if(!room) return;
  const payload = JSON.stringify({
    type: "state",
    players: room.players,
    products: room.products,
    holes: room.holes,
    radiologist: room.radiologist
  });
  room.sockets.forEach(s=>s.send(payload));
}

// ================== Connexions ==================
wss.on("connection", ws=>{
  let roomId=null, id=null;
  console.log("🔹 Client connecté");

  ws.on("message", msg=>{
    let data;
    try{ data=JSON.parse(msg); } catch(e){ return; }

    // ========== Créer une partie ==========
    if(data.type==="create"){
      roomId = code();
      id = crypto.randomUUID();
      const holes = generateHoles();
      const products = generateProducts([], null);
      rooms[roomId] = {
        players: { [id]: { x:5,y:5, lives:3, collectedVisit:0 } },
        sockets: [ws],
        holes,
        products,
        radiologist: null
      };
      ws.send(JSON.stringify({type:"created", code:roomId, id}));
      startRadiologistLoop(roomId);
      return;
    }

    // ========== Rejoindre une partie ==========
    if(data.type==="join"){
      const c = data.code;
      if(!rooms[c] || rooms[c].sockets.length >= 2){
        ws.send(JSON.stringify({type:"error", message:"Partie invalide ou pleine"}));
        return;
      }
      roomId = c;
      id = crypto.randomUUID();
      rooms[c].players[id] = { x:5,y:5, lives:3, collectedVisit:0 };
      rooms[c].sockets.push(ws);
      ws.send(JSON.stringify({type:"joined", code:c, id}));
      broadcast(c);
      return;
    }

    // ========== Déplacement ==========
    if(data.type==="move" && roomId){
      const p = rooms[roomId].players[id];
      if(!p) return;
      p.x = Math.max(0, Math.min(WIDTH-1, p.x+data.dx));
      p.y = Math.max(0, Math.min(HEIGHT-1, p.y+data.dy));
      // ramasser produit si présent
      const idx = rooms[roomId].products.findIndex(prod=>prod.x===p.x && prod.y===p.y);
      if(idx!==-1){
        rooms[roomId].products.splice(idx,1);
        p.collectedVisit = (p.collectedVisit||0) + 1;
        // réapparaît
        rooms[roomId].products = generateProducts(rooms[roomId].products, {x:p.x,y:p.y});
      }
      broadcast(roomId);
    }

  });

  ws.on("close", ()=>{
    if(!roomId || !rooms[roomId]) return;
    console.log(`⚠️ Client déconnecté id=${id} room=${roomId}`);
    delete rooms[roomId].players[id];
    rooms[roomId].sockets = rooms[roomId].sockets.filter(s=>s!==ws);
    if(rooms[roomId].sockets.length===0){
      delete rooms[roomId];
    } else broadcast(roomId);
  });
});

console.log("🟢 Serveur WebSocket prêt !");
