const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  // Short recovery window — enough for mobile network hiccup
  // but avoids state desync in fast-paced games
  connectionStateRecovery: { maxDisconnectionDuration: 5000 },
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Load game modules ─────────────────────────────────────────────────────────
require('./games/cellwars')(io);
require('./games/snake')(io);
require('./games/wordle')(io);
require('./games/trivia')(io);
require('./games/pong')(io);
require('./verity-server')(io);
require('./tictactoe-server')(io);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ── Global error handlers — prevent server crash ──────────────────────────────
process.on('uncaughtException',  err => console.error('[uncaughtException]',  err.message));
process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`\n  🟢  GameHub → http://localhost:${PORT}\n`));
