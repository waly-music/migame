// ════════════════════════════════════════════════════════════════════════════
// VERITY — El juego de los secretos  /verity
// ════════════════════════════════════════════════════════════════════════════
// Social deduction game inspired by "Verity" by Colleen Hoover
// One hidden "Verity" must lie. Others must find them.
// ════════════════════════════════════════════════════════════════════════════

module.exports = function setupVerity(io) {
  const verityIo = io.of('/verity');
  const rooms = {};
  const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();

  const SCENARIOS = [
    { text: "Acabas de encontrar el diario secreto de tu mejor amigo/a. ¿Qué haces con él?", hint: "Todos deben revelar su reacción honesta" },
    { text: "Tu pareja te pregunta si has leído sus mensajes privados. ¿Cuál es tu respuesta?", hint: "¿Negarías algo que hiciste?" },
    { text: "Sabes que alguien en esta sala tiene un secreto oscuro. ¿Cómo actúas con esa persona?", hint: "Las acciones revelan la verdad" },
    { text: "Describes el peor secreto que alguien te ha confesado... sin decir quién era.", hint: "Los detalles delatan" },
    { text: "¿Qué harías si descubrieras que la persona que amas no es quien dice ser?", hint: "La respuesta revela mucho sobre ti" },
    { text: "Estás en una mansión con extraños. Alguien desaparece. ¿Cuál es tu primera reacción?", hint: "El miedo y la culpa se parecen" },
    { text: "Alguien te acusa de algo que no hiciste. ¿Cómo te defiendes?", hint: "O sí lo hiciste..." },
    { text: "Describes el momento en que guardaste un secreto que debiste contar.", hint: "¿Lo guardaste por ellos o por ti?" },
    { text: "¿Cuándo fue la última vez que mentiste para proteger a alguien?", hint: "¿O te protegías a ti mismo?" },
    { text: "Si pudieras reescribir un capítulo de tu pasado, ¿cuál sería y por qué?", hint: "Los arrepentimientos dicen la verdad" },
    { text: "Alguien cercano a ti ha muerto en circunstancias extrañas. Describes esa noche.", hint: "Los testigos siempre omiten algo" },
    { text: "¿Qué cosa nunca le contarías a nadie, sin importar las circunstancias?", hint: "Verity nunca diría la verdad aquí" },
    { text: "Tu casa tiene una habitación que nunca abres. ¿Qué hay dentro?", hint: "Las metáforas revelan secretos reales" },
    { text: "Alguien te ofrece leer la autobiografía secreta de tu ser querido. ¿La lees?", hint: "La curiosidad versus la lealtad" },
    { text: "Describes la última vez que alguien te miró como si supiera algo sobre ti.", hint: "¿Qué sabían?" },
  ];

  const VERITY_HINT = "⚠️ Eres VERITY. DEBES incluir una mentira, exageración o engaño en tu respuesta. Sé sutil — si te descubren pierdes puntos.";

  function getRoom(roomId) { return rooms[roomId]; }

  function broadcastLobby(room) {
    verityIo.to(room.id).emit('lobby', {
      players: Object.values(room.players),
      hostId: room.hostId,
      roomId: room.id,
    });
  }

  verityIo.on('connection', (socket) => {
    let myRoomId = null;

    socket.on('createRoom', ({ name }) => {
      const id = uid();
      rooms[id] = {
        id,
        hostId: socket.id,
        players: {
          [socket.id]: { id: socket.id, name: (name || 'Jugador').slice(0, 18), score: 0, ready: false }
        },
        state: 'lobby',
        round: 0,
        totalRounds: 5,
        scenario: null,
        verityId: null,
        answers: {},
        votes: {},
        timer: null,
      };
      myRoomId = id;
      socket.join(id);
      socket.emit('roomCreated', { roomId: id });
      broadcastLobby(rooms[id]);
    });

    socket.on('joinRoom', ({ name, roomId }) => {
      const room = rooms[roomId];
      if (!room) { socket.emit('err', 'Sala no encontrada'); return; }
      if (room.state !== 'lobby') { socket.emit('err', 'La partida ya empezó'); return; }
      if (Object.keys(room.players).length >= 8) { socket.emit('err', 'Sala llena'); return; }
      room.players[socket.id] = { id: socket.id, name: (name || 'Jugador').slice(0, 18), score: 0, ready: false };
      myRoomId = roomId;
      socket.join(roomId);
      broadcastLobby(room);
    });

    socket.on('startGame', () => {
      const room = rooms[myRoomId];
      if (!room || room.hostId !== socket.id) return;
      if (Object.keys(room.players).length < 3) { socket.emit('err', 'Necesitas al menos 3 jugadores'); return; }
      startRound(room);
    });

    socket.on('submitAnswer', ({ answer }) => {
      const room = rooms[myRoomId];
      if (!room || room.state !== 'answering') return;
      if (room.answers[socket.id]) return; // already answered
      const trimmed = answer.trim().slice(0, 280);
      if (!trimmed) return;
      room.answers[socket.id] = { playerId: socket.id, text: trimmed };
      verityIo.to(myRoomId).emit('answerCount', { count: Object.keys(room.answers).length, total: Object.keys(room.players).length });
      if (Object.keys(room.answers).length === Object.keys(room.players).length) {
        clearTimeout(room.timer);
        startVoting(room);
      }
    });

    socket.on('submitVote', ({ targetId }) => {
      const room = rooms[myRoomId];
      if (!room || room.state !== 'voting') return;
      if (room.votes[socket.id]) return;
      if (targetId === socket.id) return; // can't vote yourself
      room.votes[socket.id] = targetId;
      verityIo.to(myRoomId).emit('voteCount', { count: Object.keys(room.votes).length, total: Object.keys(room.players).length });
      if (Object.keys(room.votes).length === Object.keys(room.players).length) {
        clearTimeout(room.timer);
        resolveRound(room);
      }
    });

    socket.on('nextRound', () => {
      const room = rooms[myRoomId];
      if (!room || room.hostId !== socket.id) return;
      if (room.round >= room.totalRounds) {
        endGame(room);
      } else {
        startRound(room);
      }
    });

    socket.on('disconnect', () => {
      const room = rooms[myRoomId];
      if (!room) return;
      delete room.players[socket.id];
      if (Object.keys(room.players).length === 0) {
        clearTimeout(room.timer);
        delete rooms[myRoomId];
        return;
      }
      if (room.hostId === socket.id) {
        room.hostId = Object.keys(room.players)[0];
      }
      if (room.state === 'lobby') broadcastLobby(room);
      else verityIo.to(myRoomId).emit('playerLeft', { name: room.players[socket.id]?.name });
    });
  });

  function startRound(room) {
    room.round++;
    room.state = 'answering';
    room.answers = {};
    room.votes = {};

    // Pick scenario (avoid repeats)
    const used = room.usedScenarios || [];
    const available = SCENARIOS.filter((_, i) => !used.includes(i));
    const pool = available.length > 0 ? available : SCENARIOS;
    const idx = Math.floor(Math.random() * pool.length);
    const scenarioIdx = SCENARIOS.indexOf(pool[idx]);
    room.usedScenarios = [...used, scenarioIdx];
    room.scenario = SCENARIOS[scenarioIdx];

    // Pick Verity — rotate so everyone gets a turn
    const playerIds = Object.keys(room.players);
    const lastVerity = room.verityId;
    const notLast = playerIds.filter(id => id !== lastVerity);
    room.verityId = notLast[Math.floor(Math.random() * notLast.length)];

    // Send scenario to everyone
    verityIo.to(room.id).emit('roundStart', {
      round: room.round,
      totalRounds: room.totalRounds,
      scenario: room.scenario.text,
      hint: room.scenario.hint,
      timeLimit: 60,
    });

    // Send secret role privately
    verityIo.to(room.verityId).emit('secretRole', { isVerity: true, hint: VERITY_HINT });
    Object.keys(room.players).filter(id => id !== room.verityId).forEach(id => {
      verityIo.to(id).emit('secretRole', { isVerity: false, hint: '🔍 Eres investigador. Escribe honestamente y detecta al mentiroso.' });
    });

    // Auto-advance after 60s
    room.timer = setTimeout(() => {
      // Fill missing answers
      Object.keys(room.players).forEach(id => {
        if (!room.answers[id]) room.answers[id] = { playerId: id, text: '(sin respuesta)' };
      });
      startVoting(room);
    }, 60000);
  }

  function startVoting(room) {
    room.state = 'voting';
    clearTimeout(room.timer);

    // Shuffle answers + send with player names but no indication of who is who
    const shuffled = Object.values(room.answers).sort(() => Math.random() - 0.5);
    const namedAnswers = shuffled.map(a => ({
      playerId: a.playerId,
      playerName: room.players[a.playerId]?.name || '?',
      text: a.text,
    }));

    verityIo.to(room.id).emit('votingStart', {
      answers: namedAnswers,
      timeLimit: 45,
    });

    room.timer = setTimeout(() => {
      // Auto-vote randomly for non-voters
      Object.keys(room.players).forEach(id => {
        if (!room.votes[id]) {
          const others = Object.keys(room.players).filter(p => p !== id);
          room.votes[id] = others[Math.floor(Math.random() * others.length)];
        }
      });
      resolveRound(room);
    }, 45000);
  }

  function resolveRound(room) {
    room.state = 'reveal';
    clearTimeout(room.timer);

    // Count votes
    const voteCounts = {};
    Object.values(room.votes).forEach(targetId => {
      voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
    });

    const mostVotedId = Object.entries(voteCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
    const verityFound = mostVotedId === room.verityId;

    // Score
    if (verityFound) {
      // Investigators who voted correctly each get 100pts
      Object.entries(room.votes).forEach(([voterId, targetId]) => {
        if (targetId === room.verityId && voterId !== room.verityId) {
          room.players[voterId].score += 100;
        }
      });
    } else {
      // Verity survives — gets 150pts
      if (room.players[room.verityId]) room.players[room.verityId].score += 150;
    }

    // Build vote summary
    const voteSummary = Object.entries(room.votes).map(([voterId, targetId]) => ({
      voterName: room.players[voterId]?.name || '?',
      targetName: room.players[targetId]?.name || '?',
      correct: targetId === room.verityId,
    }));

    verityIo.to(room.id).emit('roundReveal', {
      verityId: room.verityId,
      verityName: room.players[room.verityId]?.name || '?',
      verityFound,
      verityAnswer: room.answers[room.verityId]?.text || '',
      voteSummary,
      voteCounts,
      scores: Object.values(room.players).map(p => ({ name: p.name, score: p.score, id: p.id })).sort((a, b) => b.score - a.score),
      isLastRound: room.round >= room.totalRounds,
    });
  }

  function endGame(room) {
    room.state = 'done';
    const scores = Object.values(room.players).sort((a, b) => b.score - a.score);
    verityIo.to(room.id).emit('gameOver', { scores });
    setTimeout(() => delete rooms[room.id], 60000);
  }
};
