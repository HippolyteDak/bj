import { WebSocketServer } from "ws";
import crypto from "crypto";

const WIDTH=10, HEIGHT=10, BASE_PRODUCTS=8;
const rooms = {};

function code(){ return Math.random().toString(36).substring(2,6).toUpperCase(); }

function generateHoles(){
  const holes=[];
  for(let i=0;i<WIDTH;i++){ if(Math.random()<0.25) holes.push({x:i,y:0}); if(Math.random()<0.25) holes.push({x:i,y:HEIGHT-1}); }
  for(let i=0;i<HEIGHT;i++){ if(Math.random()<0.25) holes.push({x:0,y:i}); if(Math.random()<0.25) holes.push({x:WIDTH-1,y:i}); }
  return holes;
}

function generateProducts(existing=[], lastProduct=null){
  const products=[...existing];
  while(products.length<BASE_PRODUCTS){
    let x,y;
    do{x=Math.floor(Math.random()*WIDTH); y=Math.floor(Math.random()*HEIGHT);}
    while(products.some(p=>p.x===x && p.y===y) || (lastProduct && lastProduct.x===x && lastProduct.y===y));
    products.push({x,y}); lastProduct={x,y};
  }
  return products;
}

function broadcast(roomId){
  const room = rooms[roomId];
  if(!room) return;
  const data = {
    type:"state",
    players: room.players,
    products: room.products,
    holes: room.holes,
    radiologist: room.radiologist,
    required: room.required
  };
  room.sockets.forEach(ws=>{ if(ws.readyState===1) ws.send(JSON.stringify(data)); });
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
      x: entry.x,
      y: entry.y,
      dx: Math.sign(exit.x-entry.x) || 1,
      dy: Math.sign(exit.y-entry.y) || 0,
      start: Date.now(),
      duration: 6000 + Math.random()*4000,
      required: 1
    };
    room.radiologist.required = Math.max(1, Math.floor(room.radiologist.duration/3000));

    const interval = setInterval(()=>{
      if(!room.radiologist) return;

      // Déplacement d'une seule case par tick
      room.radiologist.x += room.radiologist.dx;
      room.radiologist.y += room.radiologist.dy;
      room.radiologist.x = Math.max(0, Math.min(WIDTH-1, room.radiologist.x));
      room.radiologist.y = Math.max(0, Math.min(HEIGHT-1, room.radiologist.y));

      // Petit effet aléatoire demi-tour
      if(Math.random()<0.1){ room.radiologist.dx*=-1; room.radiologist.dy*=-1; }

      broadcast(roomId);

      // Radiologue peut sortir uniquement si sur un trou ET après 3s
      if(room.holes.some(h=>h.x===room.radiologist.x && h.y===room.radiologist.y) &&
         Date.now()-room.radiologist.start >= 3000){
        endRadiologist(roomId, interval);
      }

    }, 1200); // <- plus lent, 1.2s par case

    setTimeout(()=>endRadiologist(roomId, interval), room.radiologist.duration);

  }, 3000 + Math.random()*4000);
}

function endRadiologist(roomId, interval){
  clearInterval(interval);
  const room = rooms[roomId];
  if(!room || !room.radiologist) return;

  // Vérifie chaque joueur
  for(const [playerId, player] of Object.entries(room.players)){
    if((player.collectedVisit || 0) < room.radiologist.required){
      player.lives = Math.max(0, (player.lives||3)-1); // vie ≥ 0
    }
    player.collectedVisit = 0; // reset compteur
  }

  room.radiologist = null;
  room.required = 0;
  broadcast(roomId);

  // Fin de partie si un joueur est à 0 vie
  const losers = Object.entries(room.players).filter(([_,p])=>p.lives===0);
  if(losers.length > 0){
    const loserId = losers[0][0];
    const winnerId = Object.keys(room.players).find(id=>id!==loserId) || loserId;
    broadcast(roomId, { type:"gameover", winnerId, loserId });
    delete rooms[roomId]; // ferme la partie
    return;
  }

  // Sinon on relance un nouveau radiologue
  startRadiologistLoop(roomId);
}


function resetRoom(roomId){
  const room = rooms[roomId];
  if(!room) return;
  for(const [pid,player] of Object.entries(room.players)){
    player.x=5; player.y=5; player.lives=3; player.collectedVisit=0;
  }
  room.products=generateProducts([], null);
  room.holes=generateHoles();
  room.radiologist=null;
  room.required=0;
  startRadiologistLoop(roomId);
  broadcast(roomId);
}

function endGame(roomId, loserId){
  const room = rooms[roomId];
  if(!room) return;
  const playerIds = Object.keys(room.players);
  const winnerId = playerIds.find(id=>id!==loserId) || loserId;

  room.sockets.forEach(ws=>{
    if(ws.readyState===1){
      ws.send(JSON.stringify({type:"gameover", winnerId, loserId}));
    }
  });
}

// ================= WebSocket =================
const wss = new WebSocketServer({ port: process.env.PORT || 8080 });
wss.on("connection", ws=>{
  let roomId=null, id=null;

  ws.on("message", msg=>{
    let data;
    try{ data=JSON.parse(msg); } catch(e){ return; }

    if(data.type==="create"){
      roomId=code(); id=crypto.randomUUID();
      rooms[roomId]={
        players:{ [id]:{x:5,y:5,lives:3,collectedVisit:0} },
        sockets:[ws],
        products: generateProducts([], null),
        holes: generateHoles(),
        radiologist:null,
        required:0
      };
      ws.send(JSON.stringify({type:"created", code:roomId, id}));
      startRadiologistLoop(roomId);
      return;
    }

    if(data.type==="join"){
      const c = data.code;
      if(!rooms[c] || rooms[c].sockets.length>=2){ ws.send(JSON.stringify({type:"error", message:"Partie invalide ou pleine"})); return; }
      roomId=c; id=crypto.randomUUID();
      rooms[c].players[id]={x:5,y:5,lives:3,collectedVisit:0};
      rooms[c].sockets.push(ws);
      ws.send(JSON.stringify({type:"joined", code:c, id}));
      broadcast(c);
      return;
    }

    if(data.type==="move" && roomId){
      const p = rooms[roomId].players[data.id];
      if(!p) return;
      p.x=Math.max(0, Math.min(WIDTH-1,p.x+data.dx));
      p.y=Math.max(0, Math.min(HEIGHT-1,p.y+data.dy));

      // Ramassage produit
      const idx = rooms[roomId].products.findIndex(prod=>prod.x===p.x && prod.y===p.y);
      if(idx!==-1){
        rooms[roomId].products.splice(idx,1);
        p.collectedVisit++;
        rooms[roomId].products = generateProducts(rooms[roomId].products,{x:p.x,y:p.y});
      }

      // Vérifie si radiologue est présent et produit requis non collecté
      if(rooms[roomId].radiologist && p.collectedVisit<rooms[roomId].required){
        p.lives--;
        if(p.lives<=0) endGame(roomId, data.id);
      }

      broadcast(roomId);
    }

    if(data.type==="reset" && roomId){
      resetRoom(roomId);
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
