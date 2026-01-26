import { WebSocketServer } from "ws";
import crypto from "crypto";

// Crée le serveur WebSocket sur le port Render
const wss = new WebSocketServer({ port: process.env.PORT || 8080 });

// Stockage des parties
// rooms = { CODE_PARTIE: { players:{id:{x,y}}, sockets:[ws1, ws2] } }
const rooms = {};

// Génère un code de 4 lettres pour la partie
function code() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

wss.on("connection", ws => {
  let room = null;
  let id = null;

  console.log("🔹 Nouveau client connecté");

  ws.on("message", msg => {
    console.log("📨 Message reçu:", msg.toString());

    let data;
    try { data = JSON.parse(msg); } 
    catch(e){ return; }

    // ========== CRÉER UNE PARTIE ==========
    if(data.type === "create") {
      const c = code();
      id = crypto.randomUUID();
      rooms[c] = { players:{ [id]: {x:5,y:5} }, sockets:[ws] };
      room = c;

      ws.send(JSON.stringify({ type:"created", code:c, id }));

      console.log(`🟢 Partie créée: ${c}, id=${id}`);
      return;
    }

    // ========== REJOINDRE UNE PARTIE ==========
    if(data.type === "join") {
      const c = data.code;
      if(!rooms[c] || rooms[c].sockets.length >= 2) {
        ws.send(JSON.stringify({ type:"error", message:"Partie invalide ou complète" }));
        return;
      }

      id = crypto.randomUUID();
      room = c;
      rooms[c].players[id] = { x:5, y:5 };
      rooms[c].sockets.push(ws);

      ws.send(JSON.stringify({ type:"joined", code:c, id }));
      broadcast(room);
      console.log(`🟢 Client rejoint la partie ${c}, id=${id}`);
      return;
    }

    // ========== DÉPLACEMENT ==========
    if(data.type === "move" && room) {
      const p = rooms[room].players[id];
      if(!p) return;
      p.x += data.dx;
      p.y += data.dy;

      // limite la grille (0..9)
      p.x = Math.max(0, Math.min(9, p.x));
      p.y = Math.max(0, Math.min(9, p.y));

      broadcast(room);
    }
  });

  ws.on("close", () => {
    if(!room || !rooms[room]) return;

    console.log(`⚠️ Client déconnecté id=${id} room=${room}`);

    delete rooms[room].players[id];
    rooms[room].sockets = rooms[room].sockets.filter(s => s !== ws);

    if(rooms[room].sockets.length === 0) {
      delete rooms[room];
      console.log(`❌ Partie ${room} supprimée`);
    } else {
      broadcast(room);
    }
  });
});

// ========== DIFFUSION AUX JOUEURS ==========
function broadcast(room) {
  if(!rooms[room]) return;

  const payload = JSON.stringify({ type:"state", players: rooms[room].players });
  rooms[room].sockets.forEach(s => s.send(payload));
}

console.log("🟢 Serveur WebSocket prêt !");
