// ── Snake /snake ──────────────────────────────────────────────────────────────
module.exports = function setupSnake(io) {
  const snakeIo = io.of('/snake');
  const rooms   = {};
  const socketRoom = {}; // socketId → roomId
  const GRID = 25, MAX_FOOD = 12, TICK = 140;
  const PAL  = ['#FF6B6B','#4ECDC4','#FFCB47','#96CEB4','#DDA0DD','#45B7D1','#FF8E53','#FF69B4'];
  const DIRS = { UP:{x:0,y:-1}, DOWN:{x:0,y:1}, LEFT:{x:-1,y:0}, RIGHT:{x:1,y:0} };
  const OPP  = { UP:'DOWN', DOWN:'UP', LEFT:'RIGHT', RIGHT:'LEFT' };
  const uid  = () => Math.random().toString(36).slice(2, 7).toUpperCase();
  const rnd  = n => Math.floor(Math.random() * n);

  function getOrCreateRoom() {
    for (const id in rooms) {
      const r = rooms[id];
      if (Object.keys(r.snakes).length < 6 && r.state === 'playing') return r;
    }
    const id = uid();
    rooms[id] = { id, snakes: {}, food: [], state: 'playing', interval: null };
    spawnFood(rooms[id]);
    rooms[id].interval = setInterval(() => tick(id), TICK);
    return rooms[id];
  }

  function spawnFood(room) {
    while (room.food.length < MAX_FOOD)
      room.food.push({ x: rnd(GRID), y: rnd(GRID), color: PAL[rnd(PAL.length)] });
  }

  function freePos(room) {
    for (let i = 0; i < 100; i++) {
      const pos = { x: rnd(GRID), y: rnd(GRID) };
      let ok = true;
      for (const s of Object.values(room.snakes))
        for (const seg of s.segs) if (seg.x === pos.x && seg.y === pos.y) { ok = false; break; }
      if (ok) return pos;
    }
    return { x: rnd(GRID), y: rnd(GRID) };
  }

  function addPlayer(room, socket, name) {
    const start = freePos(room);
    const color = PAL[Object.keys(room.snakes).length % PAL.length];
    room.snakes[socket.id] = {
      id: socket.id, name: String(name || 'Snake').slice(0, 16),
      segs: [start, { x: start.x, y: start.y + 1 }, { x: start.x, y: start.y + 2 }],
      dir: 'UP', nextDir: 'UP', alive: true, score: 0, color, grow: 0,
    };
    socket.join(room.id);
    socket.emit('snakeJoined', { roomId: room.id, grid: GRID, myId: socket.id });
  }

  function tick(roomId) {
    try {
      const room = rooms[roomId]; if (!room) return;
      const alive = Object.values(room.snakes).filter(s => s.alive);

      for (const s of alive) {
        if (OPP[s.nextDir] !== s.dir) s.dir = s.nextDir;
        const d = DIRS[s.dir];
        const newHead = { x: s.segs[0].x + d.x, y: s.segs[0].y + d.y };

        if (newHead.x < 0 || newHead.x >= GRID || newHead.y < 0 || newHead.y >= GRID) { s.alive = false; continue; }

        room.food = room.food.filter(f => {
          if (f.x === newHead.x && f.y === newHead.y) { s.score++; s.grow += 2; return false; }
          return true;
        });

        let hitBody = false;
        for (const os of Object.values(room.snakes)) {
          const segs = os.id === s.id ? os.segs.slice(0, -1) : os.segs;
          for (const seg of segs) if (seg.x === newHead.x && seg.y === newHead.y) { hitBody = true; break; }
          if (hitBody) break;
        }
        if (hitBody) { s.alive = false; continue; }

        s.segs.unshift(newHead);
        if (s.grow > 0) s.grow--;
        else s.segs.pop();
      }

      spawnFood(room);
      snakeIo.to(roomId).emit('snakeState', { snakes: Object.values(room.snakes), food: room.food });

      // FIX: check all snakes dead for respawn — but verify they still exist in room
      const allPlayers = Object.values(room.snakes);
      if (allPlayers.length > 0 && allPlayers.every(s => !s.alive)) {
        setTimeout(() => {
          const currentRoom = rooms[roomId]; if (!currentRoom) return;
          for (const s of Object.values(currentRoom.snakes)) {
            // FIX: only respawn snakes whose socket is still connected
            if (!socketRoom[s.id]) continue;
            s.alive = true; s.grow = 0;
            const pos = freePos(currentRoom);
            s.segs = [pos, { x: pos.x, y: pos.y + 1 }, { x: pos.x, y: pos.y + 2 }];
            s.dir = 'UP'; s.nextDir = 'UP';
          }
        }, 2000);
      }
    } catch (e) { console.error('[snake] tick error:', e.message); }
  }

  snakeIo.on('connection', socket => {
    let myRoomId = null;

    socket.on('join', ({ name }) => {
      try {
        const room = getOrCreateRoom();
        myRoomId = room.id;
        socketRoom[socket.id] = room.id;
        addPlayer(room, socket, name);
      } catch (e) { console.error('[snake] join error:', e.message); }
    });

    socket.on('dir', ({ dir }) => {
      try {
        if (!['UP','DOWN','LEFT','RIGHT'].includes(dir)) return;
        const room = rooms[myRoomId];
        if (room && room.snakes[socket.id]) room.snakes[socket.id].nextDir = dir;
      } catch (e) {}
    });

    socket.on('disconnect', () => {
      try {
        delete socketRoom[socket.id];
        const room = rooms[myRoomId]; if (!room) return;
        delete room.snakes[socket.id];
        if (Object.keys(room.snakes).length === 0) {
          clearInterval(room.interval);
          delete rooms[myRoomId];
        }
      } catch (e) {}
    });
  });
};
