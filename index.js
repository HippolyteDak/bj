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
});

function broadcast() {
  const payload = JSON.stringify({
    type: 'state',
    state: gameState
  });
  wss.clients.forEach(c => c.send(payload));
}

console.log('🟢 Serveur lancé');
