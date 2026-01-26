import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: process.env.PORT || 8080 });

const gameState = {
  players: {},
  products: [],
  radiologist: null,
  time: 0
};

wss.on('connection', ws => {
  const id = crypto.randomUUID();
  gameState.players[id] = { x: 5, y: 5 };

  ws.send(JSON.stringify({
    type: 'init',
    id,
    state: gameState
  }));

  ws.on('message', msg => {
    const data = JSON.parse(msg);

    if (data.type === 'move') {
      const p = gameState.players[id];
      p.x += data.dx;
      p.y += data.dy;
    }

    broadcast();
  });

  ws.on('close', () => {
    delete gameState.players[id];
    broadcast();
  });

  const data = JSON.parse(msg);
  if(data.type === "create") {
    const c = code();             // génère le code de partie
    rooms[c] = { players: {}, sockets: [] };
    const id = crypto.randomUUID();
    rooms[c].players[id] = { x:5, y:5 };
    rooms[c].sockets.push(ws);

    ws.send(JSON.stringify({
      type: "created",
      code: c,       // <--- le code ici
      id: id
    }));
  }
});


function broadcast() {
  const payload = JSON.stringify({
    type: 'state',
    state: gameState
  });
  wss.clients.forEach(c => c.send(payload));
}

console.log('🟢 Serveur lancé');
