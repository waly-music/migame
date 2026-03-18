// ── CellWars /cellwars ────────────────────────────────────────────────────────
module.exports = function setupCellWars(io) {
  const cwIo     = io.of('/cellwars');
  const players  = {};
  const food     = {};
  let   foodId   = 0;

  const W = 6000, H = 6000, MAX_FOOD = 600, TICK = 50;
  const PAL = ['#FF6B6B','#FF8E53','#FFCB47','#4ECDC4','#45B7D1','#96CEB4','#DDA0DD','#FF69B4'];
  const mass2r = m => Math.sqrt((m * 100) / Math.PI);
  const speed  = m => Math.max(1.8, 6.25 * Math.pow(m, -0.44));
  const rnd    = n => Math.random() * n;

  // Rate limiter: max events per socket per second
  const rateLimits = {};
  function rateOk(id, key, max = 30) {
    const k = `${id}:${key}`;
    const now = Date.now();
    if (!rateLimits[k] || now - rateLimits[k].t > 1000) {
      rateLimits[k] = { t: now, n: 1 };
      return true;
    }
    rateLimits[k].n++;
    return rateLimits[k].n <= max;
  }

  function spawnFood(n = 1) {
    for (let i = 0; i < n; i++) {
      const id = foodId++;
      food[id] = { id, x: rnd(W), y: rnd(H), r: 7 + Math.random() * 3, color: PAL[Math.floor(Math.random() * PAL.length)] };
    }
  }
  spawnFood(MAX_FOOD);

  cwIo.on('connection', socket => {
    socket.on('join', ({ name }) => {
      try {
        if (players[socket.id]) return; // already playing
        const m = 10;
        players[socket.id] = {
          id: socket.id,
          name: String(name || 'Cell').slice(0, 20),
          x: rnd(W), y: rnd(H), mass: m, r: mass2r(m),
          color: PAL[Math.floor(Math.random() * PAL.length)],
          target: { x: W / 2, y: H / 2 }, score: 0,
        };
        socket.emit('joined', { id: socket.id, player: players[socket.id], worldW: W, worldH: H });
      } catch (e) { console.error('[cellwars] join error:', e.message); }
    });

    socket.on('input', ({ tx, ty }) => {
      try {
        // Input validation — reject bad values
        if (typeof tx !== 'number' || typeof ty !== 'number') return;
        if (!isFinite(tx) || !isFinite(ty)) return;
        if (!rateOk(socket.id, 'input', 60)) return;
        const p = players[socket.id];
        if (p) { p.target.x = Math.max(0, Math.min(W, tx)); p.target.y = Math.max(0, Math.min(H, ty)); }
      } catch (e) {}
    });

    socket.on('disconnect', () => {
      delete players[socket.id];
      // FIX: clean ALL rate limit entries for this socket, not just 'input'
      Object.keys(rateLimits)
        .filter(k => k.startsWith(socket.id + ':'))
        .forEach(k => delete rateLimits[k]);
    });
  });

  setInterval(() => {
    try {
      const ids = Object.keys(players);
      // FIX: skip entirely when empty — saves CPU when server is idle
      if (ids.length === 0) return;

      // 1. Move
      for (const id of ids) {
        const p = players[id]; if (!p) continue;
        const dx = p.target.x - p.x, dy = p.target.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 2) {
          const s = speed(p.mass), f = Math.min(1, dist / 40);
          p.x += (dx / dist) * s * f; p.y += (dy / dist) * s * f;
        }
        p.x = Math.max(p.r, Math.min(W - p.r, p.x));
        p.y = Math.max(p.r, Math.min(H - p.r, p.y));
      }

      // 2. Eat food
      for (const id of ids) {
        const p = players[id]; if (!p) continue;
        const del = [];
        for (const fid in food) {
          const f = food[fid], dx = p.x - f.x, dy = p.y - f.y;
          if (dx * dx + dy * dy < p.r * p.r) { p.mass += 1.2; p.r = mass2r(p.mass); p.score++; del.push(fid); }
        }
        del.forEach(fid => delete food[fid]);
      }

      // 3. Player vs player — FIX: collect eliminations first, apply after
      const toEliminate = []; // { eaterId, eatenId }
      const eliminated  = new Set();
      for (const id of ids) {
        const p = players[id]; if (!p || eliminated.has(id)) continue;
        for (const oid of ids) {
          if (oid === id || eliminated.has(oid)) continue;
          const o = players[oid]; if (!o || p.r <= o.r * 1.12) continue;
          const dx = p.x - o.x, dy = p.y - o.y;
          if (Math.sqrt(dx * dx + dy * dy) < p.r - o.r * 0.35) {
            toEliminate.push({ eaterId: id, eatenId: oid });
            eliminated.add(oid);
          }
        }
      }
      for (const { eaterId, eatenId } of toEliminate) {
        const p = players[eaterId], o = players[eatenId];
        if (!p || !o) continue;
        p.mass += o.mass * 0.8; p.r = mass2r(p.mass); p.score += Math.floor(o.mass);
        cwIo.to(eatenId).emit('eaten', { by: p.name, score: o.score });
        delete players[eatenId];
      }

      // 4. Respawn food
      const fc = Object.keys(food).length;
      if (fc < MAX_FOOD) spawnFood(Math.min(20, MAX_FOOD - fc));

      // 5. Broadcast — only to current players
      const pa = Object.values(players), fa = Object.values(food);
      const lb = [...pa].sort((a, b) => b.mass - a.mass).slice(0, 10).map(p => ({ name: p.name, mass: Math.floor(p.mass), color: p.color }));
      for (const id of Object.keys(players)) {
        const p = players[id], vr = 1400 + p.r * 4;
        cwIo.to(id).emit('state', {
          players: pa.filter(o => Math.abs(o.x - p.x) < vr && Math.abs(o.y - p.y) < vr),
          food:    fa.filter(f => Math.abs(f.x - p.x) < vr && Math.abs(f.y - p.y) < vr),
          leaderboard: lb,
        });
      }
    } catch (e) { console.error('[cellwars] tick error:', e.message); }
  }, TICK);
};
