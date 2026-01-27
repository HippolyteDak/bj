import { WebSocketServer } from "ws";
import crypto from "crypto";

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

const WIDTH = 10;
const HEIGHT = 10;
const BASE_PRODUCTS = 8;

const rooms = {};

// ===== UTILS =====
function genCode(){
  return Math.random().toString(36).substring(2,6).toUpperCase();
}

function generateHoles(){
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

function generateProducts(existing=[], last=null){
  const products=[...existing];
  while(products.length<BASE_PRODUCTS){
    let x,y;
    do{
      x=Math.floor(Math.random()*WIDTH);
      y=Math.floor(Math.random()*HEIGHT);
    }while(
      products.some(p=>p.x===x&&p.y===y) ||
      (last && last.x===x && last.y===y)
    );
    products.push({x,y});
    last={x,y};
  }
  return products;
}

function broadcast(roomId, data){
  const room = rooms[roomId];
  if(!room) return;
  const payload = data || {
    type:"state",
    players: room.players,
    products: room.products,
    holes: room.holes,
    radiologist: room.radiologist,
    required: room.required,
    started: room.started
  };
  room.sockets.forEach(ws=>{
    if(ws.readyState===1){
      ws.send(JSON.stringify(payload));
    }
  });
}

// ===== RADIOLOGUE =====
function startRadiologist(roomId){
  const room = rooms[roomId];
  if(!room || !room.started) return;

  const entry = room.holes[Math.floor(Math.random()*room.holes.length)];
  const exit  = room.holes[Math.floor(Math.random()*room.holes.length)];

  room.radiologist = {
    x: entry.x,
    y: entry.y,
    dx: Math.sign(exit.x-entry.x)||1,
    dy: Math.sign(exit.y-entry.y)||0,
    start: Date.now()
  };

  room.required = 2 + Math.floor(Math.random()*2); // 2–3
  broadcast(roomId);

  const interval = setInterval(()=>{
    if(!room.radiologist){ clearInterval(interval); return; }

    room.radiologist.x += room.radiologist.dx;
    room.radiologist.y += room.radiologist.dy;

    room.radiologist.x=Math.max(0,Math.min(WIDTH-1,room.radiologist.x));
    room.radiologist.y=Math.max(0,Math.min(HEIGHT-1,room.radiologist.y));

    broadcast(roomId);

    const canExit =
      Date.now()-room.radiologist.start > 5000 &&
      room.holes.some(h=>h.x===room.radiologist.x && h.y===room.radiologist.y);

    if(canExit){
      endRadiologist(roomId);
      clearInterval(interval);
    }
  }, 1200);
}

function endRadiologist(roomId){
  const room = rooms[roomId];
  if(!room) return;

  for(const p of Object.values(room.players)){
    if(p.collectedVisit < room.required){
      p.lives = Math.max(0, p.lives-1);
    }
    p.collectedVisit = 0;
  }

  room.radiologist=null;
  room.required=0;
  broadcast(roomId);
  checkGameOver(roomId);

  if(room.started){
    setTimeout(()=>startRadiologist(roomId), 4000);
  }
}

function checkGameOver(roomId){
  const room = rooms[roomId];
  const alive = Object.entries(room.players).filter(([_,p])=>p.lives>0);
  if(alive.length<=1){
    broadcast(roomId,{
      type:"gameover",
      winnerId: alive[0]?.[0]||null
    });
    room.started=false;
  }
}

function resetRoom(roomId){
  const room = rooms[roomId];
  room.holes = generateHoles();
  room.products = generateProducts();
  room.radiologist=null;
  room.required=0;
  room.started=false;

  for(const p of Object.values(room.players)){
    p.x=5; p.y=5;
    p.lives=3;
    p.collectedVisit=0;
    p.ready=false;
  }
  broadcast(roomId);
}

// ===== SOCKET =====
wss.on("connection", ws=>{
  let roomId=null;
  let id=null;

  ws.on("message", raw=>{
    const msg = JSON.parse(raw);

    if(msg.type==="create"){
      roomId = genCode();
      id = crypto.randomUUID();
      rooms[roomId]={
        players:{[id]:{x:5,y:5,lives:3,collectedVisit:0,ready:false}},
        sockets:[ws],
        holes:generateHoles(),
        products:generateProducts(),
        radiologist:null,
        required:0,
        started:false
      };
      ws.send(JSON.stringify({type:"created", code:roomId, id}));
      broadcast(roomId);
    }

    if(msg.type==="join"){
      const room=rooms[msg.code];
      if(!room||room.sockets.length>=2){
        ws.send(JSON.stringify({type:"error",message:"Partie invalide"}));
        return;
      }
      roomId=msg.code;
      id=crypto.randomUUID();
      room.players[id]={x:5,y:5,lives:3,collectedVisit:0,ready:false};
      room.sockets.push(ws);
      ws.send(JSON.stringify({type:"joined", code:roomId, id}));
      broadcast(roomId);
    }

    if(msg.type==="move" && roomId){
      const room=rooms[roomId];
      const p=room.players[id];
      if(!room.started||!p) return;

      p.x=Math.max(0,Math.min(WIDTH-1,p.x+msg.dx));
      p.y=Math.max(0,Math.min(HEIGHT-1,p.y+msg.dy));

      const idx=room.products.findIndex(pr=>pr.x===p.x&&pr.y===p.y);
      if(idx!==-1){
        room.products.splice(idx,1);
        p.collectedVisit++;
        room.products=generateProducts(room.products,{x:p.x,y:p.y});
      }
      broadcast(roomId);
    }

    if(msg.type==="ready" && roomId){
      const room=rooms[roomId];
      room.players[id].ready=true;

      if(Object.values(room.players).every(p=>p.ready)){
        room.started=true;
        broadcast(roomId,{type:"start"});
        startRadiologist(roomId);
      }
    }

    if(msg.type==="reset" && roomId){
      resetRoom(roomId);
    }
  });

  ws.on("close",()=>{
    if(!roomId||!rooms[roomId])return;
    delete rooms[roomId].players[id];
    rooms[roomId].sockets=rooms[roomId].sockets.filter(s=>s!==ws);
    if(rooms[roomId].sockets.length===0) delete rooms[roomId];
    else broadcast(roomId);
  });
});

console.log("🟢 WebSocket ready on",PORT);
