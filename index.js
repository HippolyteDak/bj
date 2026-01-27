import { WebSocketServer } from "ws";
import crypto from "crypto";

const wss = new WebSocketServer({ port: process.env.PORT || 8080 });
const WIDTH = 10, HEIGHT = 10, BASE_PRODUCTS = 8;
const rooms = {};

// Générer code 4 lettres
function code() { return Math.random().toString(36).substring(2,6).toUpperCase(); }

// Créer trous aléatoires
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

// Créer produits aléatoires
function generateProducts(existing=[], lastProduct=null){
  const products = [...existing];
  while(products.length < BASE_PRODUCTS){
    let x,y;
    do{
      x=Math.floor(Math.random()*WIDTH);
      y=Math.floor(Math.random()*HEIGHT);
    } while(products.some(p=>p.x===x&&p.y===y) || (lastProduct && lastProduct.x===x && lastProduct.y===y));
    products.push({x,y});
    lastProduct={x,y};
  }
  return products;
}

// Boucle radiologue
function startRadiologistLoop(roomId){
  const room = rooms[roomId];
  if(!room || room.holes.length<2) return;

  setTimeout(()=>{
    if(!rooms[roomId]) return;

    const entry = room.holes[Math.floor(Math.random()*room.holes.length)];
    const exit  = room.holes[Math.floor(Math.random()*room.holes.length)];
    room.radiologist = {
      x: entry.x, y: entry.y,
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
  if(!room) return;

  // Sécurité : stop si déjà fini
  if(!room.radiologist) return;

  // Pour chaque joueur, vérifier s'il a respecté le quota
  for(const [playerId, player] of Object.entries(room.players)){

    if(player.collectedVisit < room.required){
      player.lives--;

      // GAME OVER si plus de vies
      if(player.lives <= 0){
        room.radiologist = null;
        broadcast(roomId);
        endGame(roomId, playerId);
        return;
      }
    }

    // Reset compteur pour la prochaine visite
    player.collectedVisit = 0;
  }

  // Fin normale du radiologue
  room.radiologist = null;
  room.required = 0;

  // Envoi de l'état à tous les joueurs
  broadcast(roomId);

  // Relance un nouveau radiologue après un délai aléatoire
  startRadiologistLoop(roomId);
}

// Diffuser état complet
function broadcast(roomId, msg){
  const room = rooms[roomId];
  if(!room) return;

  const data = msg || {
    type:"state",
    players: room.players,
    products: room.products,
    holes: room.holes,
    radiologist: room.radiologist,
    required: room.required
  };

  room.clients.forEach(ws=>{
    if(ws.readyState===1){
      ws.send(JSON.stringify(data));
    }
  });
}


function endGame(roomId, loserId){
  const room = rooms[roomId];
  if(!room) return;

  const playersIds = Object.keys(room.players);
  const winnerId = playersIds.find(id => id !== loserId) || loserId;

  broadcast(roomId, {
    type: "gameover",
    winnerId,
    loserId
  });

  delete rooms[roomId]; // ferme la partie
}


// ================== Connexions ==================
wss.on("connection", ws=>{
  let roomId=null, id=null;

  ws.on("message", msg=>{
    let data;
    try{ data=JSON.parse(msg); } catch(e){ return; }

    if(data.type==="create"){
      roomId = code();
      id = crypto.randomUUID();
      const holes = generateHoles();
      const products = generateProducts([], null);
      rooms[roomId] = {
        players:{ [id]: {x:5,y:5,lives:3,collectedVisit:0} },
        sockets:[ws],
        holes,
        products,
        radiologist:null
      };
      ws.send(JSON.stringify({type:"created", code:roomId, id}));
      startRadiologistLoop(roomId);
      return;
    }

    if(data.type==="join"){
      const c = data.code;
      if(!rooms[c] || rooms[c].sockets.length >= 2){
        ws.send(JSON.stringify({type:"error", message:"Partie invalide ou pleine"}));
        return;
      }
      roomId = c;
      id = crypto.randomUUID();
      rooms[c].players[id] = {x:5,y:5,lives:3,collectedVisit:0};
      rooms[c].sockets.push(ws);
      ws.send(JSON.stringify({type:"joined", code:c, id}));
      broadcast(c);
      return;
    }

    if(data.type==="move" && roomId){
      const p = rooms[roomId].players[data.id];
      if(!p) return;

      p.x = Math.max(0, Math.min(WIDTH-1, p.x + data.dx));
      p.y = Math.max(0, Math.min(HEIGHT-1, p.y + data.dy));

      const idx = rooms[roomId].products.findIndex(
        prod => prod.x === p.x && prod.y === p.y
      );

      if(idx !== -1){
        rooms[roomId].products.splice(idx,1);
        p.collectedVisit++;
        rooms[roomId].products = generateProducts(
          rooms[roomId].products,
          {x:p.x, y:p.y}
        );
      }

      broadcast(roomId);
    }
  });

  ws.on("close", ()=>{
    if(!roomId || !rooms[roomId]) return;
    delete rooms[roomId].players[id];
    rooms[roomId].sockets = rooms[roomId].sockets.filter(s=>s!==ws);
    if(rooms[roomId].sockets.length===0) delete rooms[roomId];
    else broadcast(roomId);
  });
});

console.log("🟢 Serveur WebSocket prêt !");
