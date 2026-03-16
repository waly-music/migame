// ── Socket & state ────────────────────────────────────────────────────────────
const socket = io();

const canvas    = document.getElementById('gameCanvas');
const ctx       = canvas.getContext('2d');
const mmCanvas  = document.getElementById('minimapCanvas');
const mmCtx     = mmCanvas.getContext('2d');

let myId        = null;
let players     = {};        // id → player snapshot from server
let food        = {};        // id → food pellet
let leaderboard = [];
let worldW      = 6000;
let worldH      = 6000;
let gameActive  = false;

// camera in world-space
const cam = { x: 0, y: 0, scale: 1, targetScale: 1 };
const mouse = { x: 0, y: 0 };  // screen coords

// ── Canvas resize ─────────────────────────────────────────────────────────────
function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// ── Mouse ─────────────────────────────────────────────────────────────────────
canvas.addEventListener('mousemove', e => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

// ── Input loop: send mouse target 20 fps ──────────────────────────────────────
setInterval(() => {
  if (!myId || !gameActive) return;
  const me = players[myId];
  if (!me) return;

  const tx = me.x + (mouse.x - canvas.width  / 2) / cam.scale;
  const ty = me.y + (mouse.y - canvas.height / 2) / cam.scale;
  socket.emit('input', { tx, ty });
}, 50);

// ── Socket events ─────────────────────────────────────────────────────────────
socket.on('joined', ({ id, player, worldW: w, worldH: h }) => {
  myId    = id;
  worldW  = w;
  worldH  = h;
  players = { [id]: player };
  gameActive = true;
  document.getElementById('startScreen').style.display = 'none';
  document.getElementById('deathMessage').textContent  = '';
});

socket.on('state', data => {
  const next = {};
  data.players.forEach(p => {
    next[p.id] = players[p.id]
      ? { ...players[p.id], ...p }   // keep prev pos for lerp
      : { ...p };
  });
  players     = next;
  const fNext = {};
  data.food.forEach(f => { fNext[f.id] = f; });
  food        = fNext;
  leaderboard = data.leaderboard;
});

socket.on('eaten', ({ by, score }) => {
  gameActive = false;
  const msg = document.getElementById('deathMessage');
  msg.textContent = `💀 Fuiste comido por ${by}  |  Score: ${score}`;
  document.getElementById('startScreen').style.display = 'flex';
  players = {};
});

// ── Camera ────────────────────────────────────────────────────────────────────
function updateCamera() {
  const me = players[myId];
  if (!me) return;

  // zoom out as we grow
  cam.targetScale = Math.max(0.12, Math.min(1.1, 60 / (me.r + 55)));
  cam.scale += (cam.targetScale - cam.scale) * 0.06;

  const tx = me.x - (canvas.width  / 2) / cam.scale;
  const ty = me.y - (canvas.height / 2) / cam.scale;
  cam.x += (tx - cam.x) * 0.1;
  cam.y += (ty - cam.y) * 0.1;
}

// world → screen
function ws(x, y) {
  return { x: (x - cam.x) * cam.scale, y: (y - cam.y) * cam.scale };
}

// ── Grid ──────────────────────────────────────────────────────────────────────
function drawGrid() {
  const gridSize = 50;
  const sx0 = Math.floor(cam.x / gridSize) * gridSize;
  const sy0 = Math.floor(cam.y / gridSize) * gridSize;
  const ex  = cam.x + canvas.width  / cam.scale;
  const ey  = cam.y + canvas.height / cam.scale;

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth   = 1;
  for (let x = sx0; x < ex; x += gridSize) {
    const sx = (x - cam.x) * cam.scale;
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, canvas.height); ctx.stroke();
  }
  for (let y = sy0; y < ey; y += gridSize) {
    const sy = (y - cam.y) * cam.scale;
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(canvas.width, sy); ctx.stroke();
  }
  ctx.restore();
}

// ── World border ──────────────────────────────────────────────────────────────
function drawBorder() {
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 90, 90, 0.35)';
  ctx.lineWidth   = 5;
  const bx = -cam.x * cam.scale;
  const by = -cam.y * cam.scale;
  ctx.strokeRect(bx, by, worldW * cam.scale, worldH * cam.scale);
  ctx.restore();
}

// ── Food ──────────────────────────────────────────────────────────────────────
function drawFood() {
  for (const id in food) {
    const f  = food[id];
    const sc = ws(f.x, f.y);
    const sr = f.r * cam.scale;
    if (sr < 1) continue;

    ctx.save();
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, sr, 0, Math.PI * 2);
    ctx.fillStyle   = f.color;
    ctx.shadowColor = f.color;
    ctx.shadowBlur  = 10;
    ctx.fill();
    ctx.restore();
  }
}

// Color helpers (input: css color string)
function lighten(color, pct) {
  // works on hsl strings from server
  return color.replace(/(\d+)(?=%\))/, m => Math.min(100, +m + pct));
}
function darken(color, pct) {
  return color.replace(/(\d+)(?=%\))/, m => Math.max(0, +m - pct));
}

// ── Player cell ───────────────────────────────────────────────────────────────
function drawCell(p) {
  const sc = ws(p.x, p.y);
  const sr = p.r * cam.scale;
  if (sr < 2) return;

  const isMe = p.id === myId;

  // outer glow ring (larger for self)
  ctx.save();
  const glowR = sr * (isMe ? 1.25 : 1.18);
  const glow  = ctx.createRadialGradient(sc.x, sc.y, sr * .4, sc.x, sc.y, glowR);
  glow.addColorStop(0, p.color + '30');
  glow.addColorStop(1, 'transparent');
  ctx.beginPath();
  ctx.arc(sc.x, sc.y, glowR, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();
  ctx.restore();

  // cell body gradient
  ctx.save();
  ctx.beginPath();
  ctx.arc(sc.x, sc.y, sr, 0, Math.PI * 2);

  const g = ctx.createRadialGradient(
    sc.x - sr * 0.28, sc.y - sr * 0.28, 0,
    sc.x, sc.y, sr
  );
  g.addColorStop(0,   lighten(p.color, 40));
  g.addColorStop(0.55, p.color);
  g.addColorStop(1,   darken(p.color, 25));
  ctx.fillStyle   = g;
  ctx.shadowColor = p.color;
  ctx.shadowBlur  = isMe ? 28 : 16;
  ctx.fill();

  // border
  ctx.strokeStyle = darken(p.color, 20) + 'cc';
  ctx.lineWidth   = Math.max(1, sr * 0.045);
  if (isMe) {
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth   = Math.max(1.5, sr * 0.055);
  }
  ctx.stroke();
  ctx.restore();

  // highlight bubble (top-left)
  if (sr > 10) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(sc.x - sr * 0.28, sc.y - sr * 0.28, sr * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fill();
    ctx.restore();
  }

  // name & mass label
  if (sr > 14) {
    const nameSize = Math.max(10, Math.min(sr * 0.32, 22));
    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    ctx.font        = `700 ${nameSize}px 'Syne', sans-serif`;
    ctx.fillStyle   = 'rgba(255,255,255,0.95)';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur  = 5;
    ctx.fillText(p.name.substring(0, 14), sc.x, sc.y - (sr > 22 ? nameSize * 0.45 : 0));

    if (sr > 22) {
      ctx.font      = `600 ${nameSize * 0.62}px 'JetBrains Mono', monospace`;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(Math.floor(p.mass), sc.x, sc.y + nameSize * 0.72);
    }
    ctx.restore();
  }
}

// ── HUD update ────────────────────────────────────────────────────────────────
function updateHUD() {
  const me = players[myId];
  if (!me) return;
  document.getElementById('massDisplay').textContent  = `Mass: ${Math.floor(me.mass)}`;
  document.getElementById('scoreDisplay').textContent = `Score: ${me.score || 0}`;

  const lb = document.getElementById('leaderboardList');
  if (!lb) return;
  lb.innerHTML = leaderboard.map((p, i) =>
    `<li class="${p.name === me.name ? 'me' : ''}">
      <span style="color:${p.color};margin-right:5px">●</span>${p.name.substring(0,12)}
      <span>${p.mass}</span>
    </li>`
  ).join('');
}

// ── Minimap ───────────────────────────────────────────────────────────────────
function drawMinimap() {
  const mw  = mmCanvas.width;
  const mh  = mmCanvas.height;
  const scx = mw / worldW;
  const scy = mh / worldH;

  mmCtx.clearRect(0, 0, mw, mh);

  // food dots (tiny)
  for (const id in food) {
    const f = food[id];
    mmCtx.fillStyle = f.color + '88';
    mmCtx.fillRect(f.x * scx - 0.5, f.y * scy - 0.5, 1.5, 1.5);
  }

  // players
  for (const id in players) {
    const p  = players[id];
    const r  = Math.max(2, p.r * scx);
    const mx = p.x * scx;
    const my = p.y * scy;
    mmCtx.beginPath();
    mmCtx.arc(mx, my, r, 0, Math.PI * 2);
    mmCtx.fillStyle = id === myId ? '#7df3e1' : p.color;
    mmCtx.fill();
  }

  // camera viewport rect
  if (myId && players[myId]) {
    const vx = cam.x * scx;
    const vy = cam.y * scy;
    const vw = (canvas.width  / cam.scale) * scx;
    const vh = (canvas.height / cam.scale) * scy;
    mmCtx.strokeStyle = 'rgba(255,255,255,0.3)';
    mmCtx.lineWidth   = 1;
    mmCtx.strokeRect(vx, vy, vw, vh);
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────
function loop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (gameActive && myId && players[myId]) {
    updateCamera();
    drawGrid();
    drawBorder();
    drawFood();

    // draw smaller cells first so big ones render on top
    Object.values(players)
      .sort((a, b) => a.mass - b.mass)
      .forEach(p => drawCell(p));

    drawMinimap();
    updateHUD();
  }

  requestAnimationFrame(loop);
}

loop();

// ── UI bindings ───────────────────────────────────────────────────────────────
document.getElementById('startBtn').addEventListener('click', () => {
  const name = document.getElementById('nicknameInput').value.trim() || 'Cell';
  socket.emit('join', { name });
});

document.getElementById('nicknameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('startBtn').click();
});
