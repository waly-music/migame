// ── Pong /pong ────────────────────────────────────────────────────────────────
module.exports = function setupPong(io) {
  const pongIo     = io.of('/pong');
  const queue      = [];
  const rooms      = {};
  const socketRoom = {}; // FIX: O(1) lookup replaces O(n) scan
  const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();

  const W = 800, H = 500, R = 10, PAD_X = 30, PAD_W = 12, PAD_H = 80;
  const MAX_SPEED = 18; // FIX: cap ball speed to prevent tunneling
  const WIN_SCORE = 7;

  function newBall(dir = 1) {
    return {
      x: W / 2, y: H / 2,
      vx: (4 + Math.random() * 2) * dir,
      vy: (3 + Math.random() * 2) * (Math.random() < .5 ? 1 : -1),
    };
  }

  pongIo.on('connection', socket => {
    socket.on('join', ({ name }) => {
      try {
        queue.push({ socket, name: String(name || 'Player').slice(0, 16) });
        socket.emit('waiting');
        if (queue.length >= 2) {
          const [p1, p2] = queue.splice(0, 2);
          const id   = uid();
          const room = {
            id, p1: p1.socket.id, p2: p2.socket.id,
            names:   { [p1.socket.id]: p1.name, [p2.socket.id]: p2.name },
            paddles: { [p1.socket.id]: H / 2,   [p2.socket.id]: H / 2 },
            score:   { [p1.socket.id]: 0,        [p2.socket.id]: 0 },
            ball: newBall(1), interval: null, done: false,
          };
          rooms[id] = room;
          socketRoom[p1.socket.id] = id;
          socketRoom[p2.socket.id] = id;
          [p1, p2].forEach((p, i) => {
            p.socket.join(id);
            p.socket.emit('pongStart', { roomId: id, side: i === 0 ? 'left' : 'right', myId: p.socket.id, names: room.names });
          });
          room.interval = setInterval(() => tick(id), 16);
        }
      } catch (e) { console.error('[pong] join error:', e.message); }
    });

    socket.on('paddle', ({ y }) => {
      try {
        if (typeof y !== 'number' || !isFinite(y)) return;
        const roomId = socketRoom[socket.id]; // FIX: O(1) lookup
        const room   = rooms[roomId];
        if (room) room.paddles[socket.id] = Math.max(PAD_H / 2, Math.min(H - PAD_H / 2, y));
      } catch (e) {}
    });

    socket.on('disconnect', () => {
      try {
        const qi = queue.findIndex(p => p.socket.id === socket.id);
        if (qi !== -1) queue.splice(qi, 1);
        const roomId = socketRoom[socket.id];
        if (roomId) {
          const room = rooms[roomId];
          if (room && !room.done) {
            clearInterval(room.interval);
            pongIo.to(roomId).emit('pongEnd', { winner: '?', abandoned: true });
            // FIX: clean socketRoom for BOTH players
            delete socketRoom[room.p1];
            delete socketRoom[room.p2];
            delete rooms[roomId];
          } else {
            delete socketRoom[socket.id];
          }
        }
      } catch (e) {}
    });
  });

  function tick(roomId) {
    try {
      const room = rooms[roomId]; if (!room || room.done) return;
      const b = room.ball;

      b.x += b.vx; b.y += b.vy;

      // Wall bounces
      if (b.y - R < 0)  { b.y = R;     b.vy =  Math.abs(b.vy); }
      if (b.y + R > H)  { b.y = H - R; b.vy = -Math.abs(b.vy); }

      const p1y = room.paddles[room.p1], p2y = room.paddles[room.p2];

      // Paddle collisions — FIX: cap speed after each bounce
      if (b.x - R <= PAD_X + PAD_W && b.y >= p1y - PAD_H / 2 && b.y <= p1y + PAD_H / 2 && b.vx < 0) {
        b.vx = Math.min(Math.abs(b.vx) * 1.05, MAX_SPEED); // FIX: cap speed
        b.x  = PAD_X + PAD_W + R;
      }
      if (b.x + R >= W - PAD_X - PAD_W && b.y >= p2y - PAD_H / 2 && b.y <= p2y + PAD_H / 2 && b.vx > 0) {
        b.vx = -Math.min(Math.abs(b.vx) * 1.05, MAX_SPEED); // FIX: cap speed
        b.x  = W - PAD_X - PAD_W - R;
      }

      // Scoring
      if (b.x < 0)  { room.score[room.p2]++; Object.assign(b, newBall(-1)); }
      if (b.x > W)  { room.score[room.p1]++; Object.assign(b, newBall(1)); }

      const sc = room.score;
      if (sc[room.p1] >= WIN_SCORE || sc[room.p2] >= WIN_SCORE) {
        room.done = true; clearInterval(room.interval);
        const winner = sc[room.p1] >= WIN_SCORE ? room.p1 : room.p2;
        pongIo.to(roomId).emit('pongEnd', { winner: room.names[winner], score: sc });
        setTimeout(() => {
          delete socketRoom[room.p1];
          delete socketRoom[room.p2];
          delete rooms[roomId];
        }, 30000);
        return;
      }

      pongIo.to(roomId).emit('pongState', { ball: b, paddles: room.paddles, score: room.score });
    } catch (e) { console.error('[pong] tick error:', e.message); }
  }
};
