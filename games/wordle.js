// ── Wordle /wordle ────────────────────────────────────────────────────────────
module.exports = function setupWordle(io) {
  const wordleIo   = io.of('/wordle');
  const queue      = [];
  const rooms      = {};
  const socketRoom = {}; // FIX: O(1) lookup instead of O(n) scan
  const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();

  const WORDS = ['CRANE','LIGHT','STONE','FLINT','BRAVE','CLOUD','DREAM','FLAME','GHOST','HEART',
    'MAGIC','NIGHT','PIANO','QUICK','RIVER','SHARP','STORM','TIGER','ULTRA','VIVID',
    'WITCH','XENON','YACHT','ZEBRA','ACORN','BLOOM','CRISP','DEPTH','ELITE','FRESH',
    'GRAIL','HONEY','IONIC','JOKER','KNEEL','LUNAR','MAPLE','NOVEL','OLIVE','PIXEL',
    'QUEST','RADAR','SOLAR','TREND','UNDER','VAPOR','WALTZ','OXIDE','YOUTH','ZONAL'];

  // FIX: WL_VALID is now actually used to validate guesses
  const WL_VALID = new Set(WORDS);

  function check(guess, word) {
    const res  = Array(5).fill('absent');
    const wArr = [...word], gArr = [...guess];
    const used = Array(5).fill(false);
    for (let i = 0; i < 5; i++) if (gArr[i] === wArr[i]) { res[i] = 'correct'; used[i] = true; }
    for (let i = 0; i < 5; i++) {
      if (res[i] === 'correct') continue;
      for (let j = 0; j < 5; j++) if (!used[j] && gArr[i] === wArr[j]) { res[i] = 'present'; used[j] = true; break; }
    }
    return res;
  }

  wordleIo.on('connection', socket => {
    socket.on('join', ({ name }) => {
      try {
        queue.push({ socket, name: String(name || 'Player').slice(0, 16) });
        socket.emit('waiting');
        if (queue.length >= 2) {
          const [p1, p2] = queue.splice(0, 2);
          const id   = uid();
          const word = WORDS[Math.floor(Math.random() * WORDS.length)];
          const room = {
            id, word,
            players: {
              [p1.socket.id]: { name: p1.name, guesses: [], solved: false },
              [p2.socket.id]: { name: p2.name, guesses: [], solved: false },
            },
            done: false,
          };
          rooms[id] = room;
          socketRoom[p1.socket.id] = id;
          socketRoom[p2.socket.id] = id;
          [p1, p2].forEach(p => {
            p.socket.join(id);
            p.socket.emit('wordleStart', { roomId: id, myId: p.socket.id, opponent: p === p1 ? p2.name : p1.name });
          });
        }
      } catch (e) { console.error('[wordle] join error:', e.message); }
    });

    socket.on('guess', ({ guess }) => {
      try {
        const roomId = socketRoom[socket.id]; // FIX: O(1)
        const room   = rooms[roomId];
        if (!room || room.done) return;

        const g = String(guess).toUpperCase();
        if (g.length !== 5 || !/^[A-Z]{5}$/.test(g)) return;

        // FIX: actually validate the word exists
        if (!WL_VALID.has(g)) { socket.emit('invalidWord'); return; }

        const player = room.players[socket.id];
        if (!player || player.solved || player.guesses.length >= 6) return;

        const result = check(g, room.word);
        player.guesses.push({ word: g, result });
        const solved = result.every(r => r === 'correct');
        if (solved) player.solved = true;

        socket.emit('guessResult', { guess: g, result, guessNum: player.guesses.length });
        const oppId = Object.keys(room.players).find(id => id !== socket.id);
        if (oppId) wordleIo.to(oppId).emit('opponentProgress', { guesses: player.guesses.length, solved });

        const allDone = Object.values(room.players).every(p => p.solved || p.guesses.length >= 6);
        if (allDone || solved) {
          room.done = true;
          const scores = Object.entries(room.players)
            .map(([id, p]) => ({ id, name: p.name, guesses: p.guesses.length, solved: p.solved }))
            .sort((a, b) => {
              if (a.solved && !b.solved) return -1;
              if (!a.solved && b.solved) return 1;
              return a.guesses - b.guesses;
            });
          wordleIo.to(roomId).emit('wordleEnd', { winner: scores[0].name, word: room.word, scores });
          setTimeout(() => {
            if (rooms[roomId]) Object.keys(rooms[roomId].players).forEach(pid => delete socketRoom[pid]);
            delete rooms[roomId];
          }, 30000);
        }
      } catch (e) { console.error('[wordle] guess error:', e.message); }
    });

    socket.on('disconnect', () => {
      try {
        const qi = queue.findIndex(p => p.socket.id === socket.id);
        if (qi !== -1) queue.splice(qi, 1);

        const roomId = socketRoom[socket.id];
        if (roomId) {
          const room = rooms[roomId];
          if (room && !room.done) {
            room.done = true;
            wordleIo.to(roomId).emit('wordleEnd', { winner: '?', word: room.word, scores: [], abandoned: true });
          }
          // FIX: clean socketRoom for BOTH players, not just the disconnecting one
          if (room) Object.keys(room.players).forEach(pid => delete socketRoom[pid]);
          else delete socketRoom[socket.id];
          delete rooms[roomId];
        }
      } catch (e) {}
    });
  });
};
