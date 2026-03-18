// ── Trivia /trivia ────────────────────────────────────────────────────────────
module.exports = function setupTrivia(io) {
  const triviaIo = io.of('/trivia');
  const rooms    = {};
  const socketRoom = {}; // socketId → roomId
  const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();

  const QUESTIONS = [
    {q:'¿Cuál es el planeta más grande del sistema solar?',opts:['Saturno','Júpiter','Neptuno','Urano'],a:1},
    {q:'¿En qué año llegó el hombre a la Luna?',opts:['1965','1967','1969','1971'],a:2},
    {q:'¿Cuántos lados tiene un hexágono?',opts:['5','6','7','8'],a:1},
    {q:'¿Cuál es el país más grande del mundo por área?',opts:['China','Canadá','EEUU','Rusia'],a:3},
    {q:'¿Quién pintó la Mona Lisa?',opts:['Picasso','Da Vinci','Rembrandt','Van Gogh'],a:1},
    {q:'¿Cuál es el elemento químico con símbolo "O"?',opts:['Oro','Osmio','Oxígeno','Ozono'],a:2},
    {q:'¿Cuántos continentes hay en la Tierra?',opts:['5','6','7','8'],a:2},
    {q:'¿Cuál es la capital de Japón?',opts:['Osaka','Kyoto','Tokio','Hiroshima'],a:2},
    {q:'¿Qué animal es el más rápido en tierra?',opts:['León','Guepardo','Visón','Antílope'],a:1},
    {q:'¿Cuántos huesos tiene el cuerpo humano adulto?',opts:['196','206','216','226'],a:1},
    {q:'¿Cuál es el océano más grande del mundo?',opts:['Atlántico','Índico','Ártico','Pacífico'],a:3},
    {q:'¿Quién escribió "Don Quijote de la Mancha"?',opts:['Lope de Vega','Cervantes','Quevedo','Góngora'],a:1},
    {q:'¿Cuántos jugadores hay en un equipo de fútbol?',opts:['9','10','11','12'],a:2},
    {q:'¿Cuál es el metal más abundante en la corteza terrestre?',opts:['Hierro','Aluminio','Cobre','Plata'],a:1},
    {q:'¿En qué país se originó el sushi?',opts:['China','Corea','Japón','Vietnam'],a:2},
    {q:'¿Cuál es el río más largo del mundo?',opts:['Amazonas','Nilo','Yangtsé','Misisipi'],a:1},
    {q:'¿Cuántas teclas tiene un piano estándar?',opts:['76','82','88','92'],a:2},
    {q:'¿Cuál es el gas más abundante en la atmósfera terrestre?',opts:['Oxígeno','CO2','Nitrógeno','Argón'],a:2},
    {q:'¿Qué lenguaje de programación creó Guido van Rossum?',opts:['Java','Ruby','Python','Perl'],a:2},
    {q:'¿Cuántos colores tiene el arcoíris?',opts:['5','6','7','8'],a:2},
  ];

  function clearRoom(roomId) {
    const room = rooms[roomId]; if (!room) return;
    if (room.timer) { clearTimeout(room.timer); clearInterval(room.timer); room.timer = null; }
    // FIX: clean socketRoom for every player in the room, not just the one who disconnected
    Object.keys(room.players).forEach(pid => delete socketRoom[pid]);
    delete rooms[roomId];
  }

  triviaIo.on('connection', socket => {
    socket.on('createRoom', ({ name }) => {
      try {
        const id = uid();
        rooms[id] = {
          id, host: socket.id,
          players: { [socket.id]: { name: String(name || 'Host').slice(0, 16), score: 0, answered: false } },
          state: 'lobby', q: 0, questions: [], timer: null, timeLeft: 0,
        };
        socketRoom[socket.id] = id;
        socket.join(id);
        socket.emit('roomCreated', { roomId: id });
        triviaIo.to(id).emit('triviaLobby', { players: Object.values(rooms[id].players), roomId: id });
      } catch (e) { console.error('[trivia] createRoom error:', e.message); }
    });

    socket.on('joinRoom', ({ name, roomId }) => {
      try {
        if (socketRoom[socket.id]) { socket.emit('error', 'Ya estás en una sala'); return; }
        const room = rooms[roomId];
        if (!room || room.state !== 'lobby') { socket.emit('error', 'Sala no disponible'); return; }
        room.players[socket.id] = { name: String(name || 'Player').slice(0, 16), score: 0, answered: false };
        socketRoom[socket.id] = roomId;
        socket.join(roomId);
        triviaIo.to(roomId).emit('triviaLobby', { players: Object.values(room.players), roomId });
      } catch (e) { console.error('[trivia] joinRoom error:', e.message); }
    });

    socket.on('startGame', () => {
      try {
        const roomId = socketRoom[socket.id];
        const room   = rooms[roomId];
        // FIX: verify host using server-side data, not trusting client
        if (!room || room.host !== socket.id) return;
        if (Object.keys(room.players).length < 1) return;
        const shuffled = [...QUESTIONS].sort(() => Math.random() - .5).slice(0, 10);
        room.questions = shuffled; room.state = 'playing'; room.q = 0;
        nextQuestion(roomId);
      } catch (e) { console.error('[trivia] startGame error:', e.message); }
    });

    socket.on('answer', ({ idx }) => {
      try {
        const roomId = socketRoom[socket.id];
        const room   = rooms[roomId];
        if (!room || room.state !== 'question') return;
        const player = room.players[socket.id];
        if (!player || player.answered) return;
        if (typeof idx !== 'number' || idx < 0 || idx > 3) return;
        player.answered = true;
        const correct  = idx === room.questions[room.q].a;
        if (correct) player.score += Math.max(10, 100 + room.timeLeft * 4);
        socket.emit('answerResult', { correct, correct_idx: room.questions[room.q].a });
        if (Object.values(room.players).every(p => p.answered)) {
          // FIX: clear timer when all answered
          if (room.timer) { clearTimeout(room.timer); room.timer = null; }
          reveal(roomId);
        }
      } catch (e) { console.error('[trivia] answer error:', e.message); }
    });

    socket.on('disconnect', () => {
      try {
        const roomId = socketRoom[socket.id];
        if (!roomId) return;
        const room = rooms[roomId];
        if (room) {
          const name = room.players[socket.id]?.name;
          delete room.players[socket.id];
          if (Object.keys(room.players).length === 0) {
            clearRoom(roomId); // cleans socketRoom for all
          } else {
            delete socketRoom[socket.id];
            // Notify remaining players
            triviaIo.to(roomId).emit('playerLeft', { name });
            // If host left, assign new host
            if (room.host === socket.id) {
              room.host = Object.keys(room.players)[0];
              triviaIo.to(roomId).emit('newHost', { hostId: room.host });
            }
          }
        } else {
          delete socketRoom[socket.id];
        }
      } catch (e) {}
    });
  });

  function nextQuestion(roomId) {
    try {
      const room = rooms[roomId]; if (!room) return;
      if (room.q >= room.questions.length) { endGame(roomId); return; }
      const q = room.questions[room.q];
      Object.values(room.players).forEach(p => { p.answered = false; });
      room.state    = 'question';
      room.timeLeft = 15;
      triviaIo.to(roomId).emit('triviaQuestion', { q: q.q, opts: q.opts, num: room.q + 1, total: room.questions.length, time: 15 });
      // FIX: use single timeout countdown, store ref for cleanup
      let t = 15;
      const tick = setInterval(() => {
        if (!rooms[roomId]) { clearInterval(tick); return; } // room deleted
        t--; room.timeLeft = t;
        if (t <= 0) { clearInterval(tick); reveal(roomId); }
      }, 1000);
      room.timer = tick;
    } catch (e) { console.error('[trivia] nextQuestion error:', e.message); }
  }

  function reveal(roomId) {
    try {
      const room = rooms[roomId]; if (!room) return;
      if (room.timer) { clearInterval(room.timer); room.timer = null; }
      room.state = 'reveal';
      const q = room.questions[room.q];
      triviaIo.to(roomId).emit('triviaReveal', {
        correct_idx: q.a,
        scores: Object.values(room.players).map(p => ({ name: p.name, score: p.score })).sort((a, b) => b.score - a.score),
      });
      room.q++;
      room.timer = setTimeout(() => nextQuestion(roomId), 3500);
    } catch (e) { console.error('[trivia] reveal error:', e.message); }
  }

  function endGame(roomId) {
    try {
      const room = rooms[roomId]; if (!room) return;
      room.state = 'done';
      const scores = Object.values(room.players).map(p => ({ name: p.name, score: p.score })).sort((a, b) => b.score - a.score);
      triviaIo.to(roomId).emit('triviaEnd', { scores });
      setTimeout(() => clearRoom(roomId), 60000);
    } catch (e) { console.error('[trivia] endGame error:', e.message); }
  }
};
