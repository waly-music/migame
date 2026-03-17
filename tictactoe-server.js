module.exports = function setupTicTacToe(io) {
  const tttIo = io.of('/tictactoe');
  const queue  = [];
  const rooms  = {};
  const socketRoom = {};
  const uid = () => Math.random().toString(36).slice(2,7).toUpperCase();

  const TRUTHS = [
    '¿Cuál es la mentira más grande que le has dicho a alguien cercano?',
    '¿A quién le tienes más envidia ahora mismo y por qué?',
    '¿Cuál es la cosa más vergonzosa que has buscado en Google?',
    '¿Has llorado viendo una película infantil? ¿Cuál fue la última vez?',
    '¿Cuándo fue la última vez que mentiste y saliste bien librado?',
    '¿Cuál es la cosa más estúpida que has hecho por impresionar a alguien?',
    '¿Si pudieras borrar un recuerdo tuyo de la memoria de todos cuál sería?',
    '¿Cuál fue tu crush más vergonzoso de toda tu vida?',
    '¿Qué harías con un millón de euros que no le contarías a nadie?',
    '¿A quién llamarías a las 3am si tuvieras un problema grave?',
    '¿Cuál es la peor decisión que has tomado en los últimos 12 meses?',
    '¿Cuál es tu mayor miedo que nunca has confesado a nadie?',
    '¿Cuánto tiempo llevas sin bañarte? Sé totalmente honesto.',
    '¿Cuál es el secreto más oscuro que guardas de alguien cercano?',
    '¿Cuál es tu peor manía que nadie conoce?',
    '¿Cuál fue el momento más humillante de tu vida?',
  ];

  const DARES = [
    'Habla durante 30 segundos usando solo palabras de una sílaba.',
    'Imita a tu personaje de dibujos favorito durante 20 segundos.',
    'Di el nombre de tu crush actual o más reciente en voz alta.',
    'Haz 10 flexiones ahora mismo. Si no puedes confiesa un secreto.',
    'Llama a alguien de tus contactos y cántale Cumpleaños Feliz.',
    'Di 5 cosas positivas sobre la persona que más te cae mal.',
    'Describe tu semana como si fuera el tráiler de una película de terror.',
    'Muestra las últimas 3 fotos de tu galería del móvil.',
    'Haz una pose de superhéroe y mantente así 15 segundos sin reírte.',
    'Dile algo bonito y sincero al rival.',
    'Imita a un famoso o político hasta que el rival adivine quién es.',
    'Bebe un vaso de agua completo sin parar y sin respirar.',
    'Escribe en el aire con la nariz la palabra PATATA.',
    'Habla durante 1 minuto completo con voz de personaje de anime.',
    'Actúa como robot durante los próximos 2 turnos completos.',
    'Camina de espaldas durante 30 segundos sin chocarte con nada.',
  ];

  function generateBoard() {
    const pool = [
      ...TRUTHS.map(t => ({ type:'truth', text:t })),
      ...DARES.map(d  => ({ type:'dare',  text:d })),
    ].sort(() => Math.random()-.5);
    return Array.from({length:9},(_,i) => ({
      index:i, owner:null, pending:false,
      challenge: pool[i % pool.length],
    }));
  }

  function checkWinner(board) {
    const W = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for (const [a,b,c] of W)
      if (board[a].owner && board[a].owner===board[b].owner && board[b].owner===board[c].owner)
        return { winner:board[a].owner, line:[a,b,c] };
    if (board.every(c=>c.owner)) return { winner:'draw', line:[] };
    return null;
  }

  tttIo.on('connection', socket => {
    socket.on('join', ({ name }) => {
      queue.push({ socket, name:(name||'Jugador').slice(0,16) });
      socket.emit('waiting');
      if (queue.length >= 2) {
        const [p1,p2] = queue.splice(0,2);
        const id = uid();
        const room = {
          id, board:generateBoard(),
          players:{X:p1.socket.id, O:p2.socket.id},
          names:  {X:p1.name,      O:p2.name},
          turn:'X', pendingCell:null, pendingPlayer:null, done:false,
        };
        rooms[id] = room;
        socketRoom[p1.socket.id] = id;
        socketRoom[p2.socket.id] = id;
        [p1,p2].forEach((p,i) => {
          p.socket.join(id);
          p.socket.emit('gameStart',{
            roomId:id, mySymbol:i===0?'X':'O',
            names:room.names, board:room.board, turn:room.turn,
          });
        });
      }
    });

    socket.on('claimCell', ({ cellIndex }) => {
      const room = rooms[socketRoom[socket.id]];
      if (!room||room.done) return;
      const sym = Object.entries(room.players).find(([,id])=>id===socket.id)?.[0];
      if (!sym||room.turn!==sym) return;
      const cell = room.board[cellIndex];
      if (cell.owner||cell.pending) return;
      cell.pending=true; room.pendingCell=cellIndex; room.pendingPlayer=sym;
      tttIo.to(socketRoom[socket.id]).emit('challengeReveal',{
        cellIndex, challenge:cell.challenge,
        playerName:room.names[sym], symbol:sym,
      });
    });

    socket.on('challengeDone', ({ success }) => {
      const roomId = socketRoom[socket.id];
      const room = rooms[roomId];
      if (!room||room.pendingCell===null) return;
      const sym = Object.entries(room.players).find(([,id])=>id===socket.id)?.[0];
      if (sym!==room.pendingPlayer) return;
      const cell = room.board[room.pendingCell];
      const opp  = sym==='X'?'O':'X';
      cell.pending=false;
      cell.owner = success ? sym : opp;
      if (!success) tttIo.to(roomId).emit('challengeFailed',{
        failedName:room.names[sym], opponentName:room.names[opp],
      });
      const result = checkWinner(room.board);
      if (result) {
        room.done=true;
        tttIo.to(roomId).emit('gameOver',{
          board:room.board, winner:result.winner, line:result.line,
          winnerName:result.winner==='draw'?null:room.names[result.winner],
        });
      } else {
        room.turn = opp;
        tttIo.to(roomId).emit('boardUpdate',{ board:room.board, turn:room.turn });
      }
      room.pendingCell=null; room.pendingPlayer=null;
    });

    socket.on('playAgain', () => {
      const roomId = socketRoom[socket.id];
      const room = rooms[roomId];
      if (!room) return;
      room.board=generateBoard(); room.turn='X';
      room.done=false; room.pendingCell=null; room.pendingPlayer=null;
      tttIo.to(roomId).emit('gameReset',{ board:room.board, turn:room.turn });
    });

    // ── WebRTC signaling ──────────────────────────────────────────────────────
    socket.on('rtc-offer', ({ offer }) => {
      const roomId = socketRoom[socket.id];
      const room = rooms[roomId]; if (!room) return;
      const other = Object.values(room.players).find(id => id !== socket.id);
      if (other) tttIo.to(other).emit('rtc-offer', { offer });
    });
    socket.on('rtc-answer', ({ answer }) => {
      const roomId = socketRoom[socket.id];
      const room = rooms[roomId]; if (!room) return;
      const other = Object.values(room.players).find(id => id !== socket.id);
      if (other) tttIo.to(other).emit('rtc-answer', { answer });
    });
    socket.on('rtc-ice', ({ candidate }) => {
      const roomId = socketRoom[socket.id];
      const room = rooms[roomId]; if (!room) return;
      const other = Object.values(room.players).find(id => id !== socket.id);
      if (other) tttIo.to(other).emit('rtc-ice', { candidate });
    });

    socket.on('disconnect', () => {
      const qi = queue.findIndex(p=>p.socket.id===socket.id);
      if (qi!==-1) queue.splice(qi,1);
      const roomId = socketRoom[socket.id];
      if (roomId) {
        const room=rooms[roomId];
        if (room&&!room.done) tttIo.to(roomId).emit('opponentLeft');
        delete rooms[roomId]; delete socketRoom[socket.id];
      }
    });
  });
};
