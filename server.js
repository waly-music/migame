const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
 
const app    = express();
const server = http.createServer(app);
const io     = new Server(server);
 
app.use(express.static(path.join(__dirname, 'public')));
 
// ── World config ─────────────────────────────────────────────────────────────
const WORLD_W      = 6000;
const WORLD_H      = 6000;
const MAX_FOOD     = 900;
const FOOD_VALUE   = 1.2;
const TICK_RATE    = 20;
const EAT_RATIO    = 1.12;
const ABSORB_DEPTH = 0.35;
 
const players   = {};
const food      = {};
let   foodIdCtr = 0;
 
const massToRadius = (mass) => Math.sqrt((mass * 100) / Math.PI);
const getSpeed     = (mass) => Math.max(1.8, 6.25 * Math.pow(mass, -0.44));
const rnd          = (max)  => Math.random() * max;
const PALETTE = [
  '#FF6B6B','#FF8E53','#FFCB47','#4ECDC4','#45B7D1',
  '#96CEB4','#DDA0DD','#FF69B4','#7EC8E3','#98FB98',
];
 
function spawnFood(count = 1) {
  for (let i = 0; i < count; i++) {
    const id = foodIdCtr++;
    food[id] = {
      id,
      x:     rnd(WORLD_W),
      y:     rnd(WORLD_H),
      r:     7 + Math.random() * 3,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    };
  }
}
spawnFood(MAX_FOOD);
 
io.on('connection', (socket) => {
  socket.on('join', ({ name }) => {
    const startMass = 10;
    players[socket.id] = {
      id:     socket.id,
      name:   (name || 'Cell').substring(0, 20),
      x:      rnd(WORLD_W),
      y:      rnd(WORLD_H),
      mass:   startMass,
      r:      massToRadius(startMass),
      color:  PALETTE[Math.floor(Math.random() * PALETTE.length)],
      target: { x: WORLD_W / 2, y: WORLD_H / 2 },
      score:  0,
    };
    socket.emit('joined', {
      id:     socket.id,
      player: players[socket.id],
      worldW: WORLD_W,
      worldH: WORLD_H,
    });
  });
 
  socket.on('input', ({ tx, ty }) => {
    if (players[socket.id]) {
      players[socket.id].target.x = tx;
      players[socket.id].target.y = ty;
    }
  });
 
  socket.on('disconnect', () => { delete players[socket.id]; });
});
 
setInterval(() => {
  const ids = Object.keys(players);
 
  for (const id of ids) {
    const p = players[id];
    if (!p) continue;
    const dx = p.target.x - p.x, dy = p.target.y - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 2) {
      const spd = getSpeed(p.mass), factor = Math.min(1, dist / 40);
      p.x += (dx / dist) * spd * factor;
      p.y += (dy / dist) * spd * factor;
    }
    p.x = Math.max(p.r, Math.min(WORLD_W - p.r, p.x));
    p.y = Math.max(p.r, Math.min(WORLD_H - p.r, p.y));
  }
 
  for (const id of ids) {
    const p = players[id];
    if (!p) continue;
    const toDelete = [];
    for (const fid in food) {
      const f = food[fid];
      const dx = p.x - f.x, dy = p.y - f.y;
      if (dx * dx + dy * dy < p.r * p.r) {
        p.mass += FOOD_VALUE; p.r = massToRadius(p.mass); p.score++;
        toDelete.push(fid);
      }
    }
    for (const fid of toDelete) delete food[fid];
  }
 
  for (const id of ids) {
    const p = players[id];
    if (!p) continue;
    for (const oid of ids) {
      if (oid === id) continue;
      const o = players[oid];
      if (!o || p.r <= o.r * EAT_RATIO) continue;
      const dx = p.x - o.x, dy = p.y - o.y;
      if (Math.sqrt(dx*dx + dy*dy) < p.r - o.r * ABSORB_DEPTH) {
        p.mass += o.mass * 0.8; p.r = massToRadius(p.mass);
        p.score += Math.floor(o.mass);
        io.to(oid).emit('eaten', { by: p.name, score: o.score });
        delete players[oid];
      }
    }
  }
 
  const fc = Object.keys(food).length;
  if (fc < MAX_FOOD) spawnFood(Math.min(20, MAX_FOOD - fc));
 
  const playerArr   = Object.values(players);
  const foodArr     = Object.values(food);
  const leaderboard = [...playerArr].sort((a,b) => b.mass - a.mass).slice(0,10)
    .map(p => ({ name: p.name, mass: Math.floor(p.mass), color: p.color }));
 
  for (const id of Object.keys(players)) {
    const p = players[id], vr = 1400 + p.r * 4;
    io.to(id).emit('state', {
      players:     playerArr.filter(o => Math.abs(o.x-p.x) < vr && Math.abs(o.y-p.y) < vr),
      food:        foodArr.filter(f => Math.abs(f.x-p.x) < vr && Math.abs(f.y-p.y) < vr),
      leaderboard,
    });
  }
}, 1000 / TICK_RATE);
 
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`\n  🟢  CellWars → http://localhost:${PORT}\n`));