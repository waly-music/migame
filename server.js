const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));

const rnd    = (max) => Math.floor(Math.random() * max);
const uid    = ()    => Math.random().toString(36).slice(2, 8).toUpperCase();

// ════════════════════════════════════════════════════════════════════════════
// CELLWARS  /cellwars
// ════════════════════════════════════════════════════════════════════════════
const cwIo = io.of('/cellwars');
const cwPlayers = {}, cwFood = {};
let cwFoodId = 0;
const CW_W = 6000, CW_H = 6000, CW_FOOD = 600;
const CW_PAL = ['#FF6B6B','#FF8E53','#FFCB47','#4ECDC4','#45B7D1','#96CEB4','#DDA0DD','#FF69B4'];
const cwMass2r = m => Math.sqrt((m*100)/Math.PI);
const cwSpeed  = m => Math.max(1.8, 6.25*Math.pow(m,-0.44));

function cwSpawnFood(n=1){
  for(let i=0;i<n;i++){
    const id=cwFoodId++;
    cwFood[id]={id,x:Math.random()*CW_W,y:Math.random()*CW_H,r:7+Math.random()*3,color:CW_PAL[rnd(CW_PAL.length)]};
  }
}
cwSpawnFood(CW_FOOD);

cwIo.on('connection', socket=>{
  socket.on('join',({name})=>{
    const m=10;
    cwPlayers[socket.id]={id:socket.id,name:(name||'Cell').slice(0,20),x:Math.random()*CW_W,y:Math.random()*CW_H,mass:m,r:cwMass2r(m),color:CW_PAL[rnd(CW_PAL.length)],target:{x:CW_W/2,y:CW_H/2},score:0};
    socket.emit('joined',{id:socket.id,player:cwPlayers[socket.id],worldW:CW_W,worldH:CW_H});
  });
  socket.on('input',({tx,ty})=>{ if(cwPlayers[socket.id]){cwPlayers[socket.id].target.x=tx;cwPlayers[socket.id].target.y=ty;} });
  socket.on('disconnect',()=>delete cwPlayers[socket.id]);
});

setInterval(()=>{
  const ids=Object.keys(cwPlayers);
  for(const id of ids){
    const p=cwPlayers[id]; if(!p) continue;
    const dx=p.target.x-p.x,dy=p.target.y-p.y,dist=Math.sqrt(dx*dx+dy*dy);
    if(dist>2){const s=cwSpeed(p.mass),f=Math.min(1,dist/40);p.x+=(dx/dist)*s*f;p.y+=(dy/dist)*s*f;}
    p.x=Math.max(p.r,Math.min(CW_W-p.r,p.x));p.y=Math.max(p.r,Math.min(CW_H-p.r,p.y));
  }
  for(const id of ids){
    const p=cwPlayers[id]; if(!p) continue;
    const del=[];
    for(const fid in cwFood){const f=cwFood[fid],dx=p.x-f.x,dy=p.y-f.y;if(dx*dx+dy*dy<p.r*p.r){p.mass+=1.2;p.r=cwMass2r(p.mass);p.score++;del.push(fid);}}
    del.forEach(f=>delete cwFood[f]);
  }
  for(const id of ids){
    const p=cwPlayers[id]; if(!p) continue;
    for(const oid of ids){
      if(oid===id) continue;
      const o=cwPlayers[oid]; if(!o||p.r<=o.r*1.12) continue;
      const dx=p.x-o.x,dy=p.y-o.y;
      if(Math.sqrt(dx*dx+dy*dy)<p.r-o.r*0.35){p.mass+=o.mass*.8;p.r=cwMass2r(p.mass);p.score+=Math.floor(o.mass);cwIo.to(oid).emit('eaten',{by:p.name,score:o.score});delete cwPlayers[oid];}
    }
  }
  const fc=Object.keys(cwFood).length; if(fc<CW_FOOD) cwSpawnFood(Math.min(20,CW_FOOD-fc));
  const pa=Object.values(cwPlayers),fa=Object.values(cwFood);
  const lb=[...pa].sort((a,b)=>b.mass-a.mass).slice(0,10).map(p=>({name:p.name,mass:Math.floor(p.mass),color:p.color}));
  for(const id of Object.keys(cwPlayers)){
    const p=cwPlayers[id],vr=1400+p.r*4;
    cwIo.to(id).emit('state',{players:pa.filter(o=>Math.abs(o.x-p.x)<vr&&Math.abs(o.y-p.y)<vr),food:fa.filter(f=>Math.abs(f.x-p.x)<vr&&Math.abs(f.y-p.y)<vr),leaderboard:lb});
  }
},50);

// ════════════════════════════════════════════════════════════════════════════
// SNAKE  /snake
// ════════════════════════════════════════════════════════════════════════════
const snakeIo = io.of('/snake');
const snakeRooms = {};
const SN_GRID=25, SN_FOOD=12, SN_TICK=140;
const SN_PAL=['#FF6B6B','#4ECDC4','#FFCB47','#96CEB4','#DDA0DD','#45B7D1','#FF8E53','#FF69B4'];
const SN_DIRS={UP:{x:0,y:-1},DOWN:{x:0,y:1},LEFT:{x:-1,y:0},RIGHT:{x:1,y:0}};
const SN_OPP={UP:'DOWN',DOWN:'UP',LEFT:'RIGHT',RIGHT:'LEFT'};

function snakeGetRoom(){
  for(const id in snakeRooms){const r=snakeRooms[id];if(Object.keys(r.snakes).length<6&&r.state==='playing') return r;}
  const id=uid();
  snakeRooms[id]={id,snakes:{},food:[],state:'playing',interval:null};
  snakeSpawnFood(snakeRooms[id]);
  snakeRooms[id].interval=setInterval(()=>snakeTick(id),SN_TICK);
  return snakeRooms[id];
}
function snakeSpawnFood(room){
  while(room.food.length<SN_FOOD){room.food.push({x:rnd(SN_GRID),y:rnd(SN_GRID),color:SN_PAL[rnd(SN_PAL.length)]});}
}
function snakeFreePos(room){
  for(let i=0;i<100;i++){
    const pos={x:rnd(SN_GRID),y:rnd(SN_GRID)};
    let ok=true;
    for(const s of Object.values(room.snakes)) for(const seg of s.segs) if(seg.x===pos.x&&seg.y===pos.y){ok=false;break;}
    if(ok) return pos;
  }
  return {x:rnd(SN_GRID),y:rnd(SN_GRID)};
}
function snakeAddPlayer(room,socket,name){
  const start=snakeFreePos(room);
  const color=SN_PAL[Object.keys(room.snakes).length%SN_PAL.length];
  room.snakes[socket.id]={id:socket.id,name:(name||'Snake').slice(0,16),segs:[start,{x:start.x,y:start.y+1},{x:start.x,y:start.y+2}],dir:'UP',nextDir:'UP',alive:true,score:0,color,grow:0};
  socket.join(room.id);
  socket.emit('snakeJoined',{roomId:room.id,grid:SN_GRID,myId:socket.id});
}
function snakeTick(roomId){
  const room=snakeRooms[roomId]; if(!room) return;
  const alive=Object.values(room.snakes).filter(s=>s.alive);
  for(const s of alive){
    if(SN_OPP[s.nextDir]!==s.dir) s.dir=s.nextDir;
    const d=SN_DIRS[s.dir];
    const newHead={x:s.segs[0].x+d.x,y:s.segs[0].y+d.y};
    if(newHead.x<0||newHead.x>=SN_GRID||newHead.y<0||newHead.y>=SN_GRID){s.alive=false;continue;}
    let ate=false;
    room.food=room.food.filter(f=>{if(f.x===newHead.x&&f.y===newHead.y){s.score++;s.grow+=2;ate=true;return false;}return true;});
    let hitBody=false;
    for(const os of Object.values(room.snakes)){
      const checkSegs=os.id===s.id?os.segs.slice(0,-1):os.segs;
      for(const seg of checkSegs) if(seg.x===newHead.x&&seg.y===newHead.y){hitBody=true;break;}
      if(hitBody) break;
    }
    if(hitBody){s.alive=false;continue;}
    s.segs.unshift(newHead);
    if(s.grow>0) s.grow--;
    else s.segs.pop();
  }
  snakeSpawnFood(room);
  const state={snakes:Object.values(room.snakes),food:room.food};
  snakeIo.to(roomId).emit('snakeState',state);
  const activePlayers=Object.values(room.snakes);
  if(activePlayers.length>0&&activePlayers.every(s=>!s.alive)){
    setTimeout(()=>{ for(const s of activePlayers){s.alive=true;s.grow=0;const pos=snakeFreePos(room);s.segs=[pos,{x:pos.x,y:pos.y+1},{x:pos.x,y:pos.y+2}];s.dir='UP';s.nextDir='UP';} },2000);
  }
}

snakeIo.on('connection',socket=>{
  let myRoom=null;
  socket.on('join',({name})=>{
    myRoom=snakeGetRoom();
    snakeAddPlayer(myRoom,socket,name);
  });
  socket.on('dir',({dir})=>{
    if(myRoom&&myRoom.snakes[socket.id]) myRoom.snakes[socket.id].nextDir=dir;
  });
  socket.on('disconnect',()=>{
    if(myRoom){
      delete myRoom.snakes[socket.id];
      if(Object.keys(myRoom.snakes).length===0){clearInterval(myRoom.interval);delete snakeRooms[myRoom.id];}
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// WORDLE  /wordle
// ════════════════════════════════════════════════════════════════════════════
const wordleIo = io.of('/wordle');
const wordleQueue=[], wordleRooms={};
const WORDS=['CRANE','LIGHT','STONE','FLINT','BRAVE','CLOUD','DREAM','FLAME','GHOST','HEART','MAGIC','NIGHT','PIANO','QUICK','RIVER','SHARP','STORM','TIGER','ULTRA','VIVID','WITCH','XENON','YACHT','ZEBRA','ACORN','BLOOM','CRISP','DEPTH','ELITE','FRESH','GRAIL','HONEY','IONIC','JOKER','KNEEL','LUNAR','MAPLE','NOVEL','OLIVE','PIXEL','QUEST','RADAR','SOLAR','TREND','UNDER','VAPOR','WALTZ','OXIDE','YOUTH','ZONAL'];
const WL_VALID=new Set(WORDS);

function wordleCheck(guess,word){
  const res=Array(5).fill('absent');
  const wArr=[...word],gArr=[...guess];
  const used=Array(5).fill(false);
  for(let i=0;i<5;i++) if(gArr[i]===wArr[i]){res[i]='correct';used[i]=true;}
  for(let i=0;i<5;i++){
    if(res[i]==='correct') continue;
    for(let j=0;j<5;j++) if(!used[j]&&gArr[i]===wArr[j]){res[i]='present';used[j]=true;break;}
  }
  return res;
}

wordleIo.on('connection',socket=>{
  let myRoom=null;
  socket.on('join',({name})=>{
    wordleQueue.push({socket,name:(name||'Player').slice(0,16)});
    socket.emit('waiting');
    if(wordleQueue.length>=2){
      const [p1,p2]=wordleQueue.splice(0,2);
      const id=uid();
      const word=WORDS[rnd(WORDS.length)];
      const room={id,word,players:{[p1.socket.id]:{name:p1.name,guesses:[],solved:false},[p2.socket.id]:{name:p2.name,guesses:[],solved:false}},done:false};
      wordleRooms[id]=room;
      [p1,p2].forEach(p=>{ p.socket.join(id); p.socket.emit('wordleStart',{roomId:id,myId:p.socket.id,opponent:p===p1?p2.name:p1.name}); });
    }
  });
  socket.on('guess',({guess})=>{
    const room=Object.values(wordleRooms).find(r=>r.players[socket.id]);
    if(!room||room.done) return;
    const g=guess.toUpperCase();
    if(g.length!==5) return;
    const player=room.players[socket.id];
    if(player.solved||player.guesses.length>=6) return;
    const result=wordleCheck(g,room.word);
    player.guesses.push({word:g,result});
    const solved=result.every(r=>r==='correct');
    if(solved) player.solved=true;
    socket.emit('guessResult',{guess:g,result,guessNum:player.guesses.length});
    const oppId=Object.keys(room.players).find(id=>id!==socket.id);
    wordleIo.to(oppId).emit('opponentProgress',{guesses:player.guesses.length,solved});
    const allDone=Object.values(room.players).every(p=>p.solved||p.guesses.length>=6);
    if(allDone||solved){
      room.done=true;
      const scores=Object.entries(room.players).map(([id,p])=>({id,name:p.name,guesses:p.guesses.length,solved:p.solved}));
      scores.sort((a,b)=>{if(a.solved&&!b.solved)return -1;if(!a.solved&&b.solved)return 1;return a.guesses-b.guesses;});
      wordleIo.to(room.id).emit('wordleEnd',{winner:scores[0].name,word:room.word,scores});
      setTimeout(()=>delete wordleRooms[room.id],30000);
    }
  });
  socket.on('disconnect',()=>{
    const qi=wordleQueue.findIndex(p=>p.socket.id===socket.id);
    if(qi!==-1) wordleQueue.splice(qi,1);
    const room=Object.values(wordleRooms).find(r=>r.players[socket.id]);
    if(room&&!room.done){room.done=true;wordleIo.to(room.id).emit('wordleEnd',{winner:'?',word:room.word,scores:[],abandoned:true});}
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TRIVIA  /trivia
// ════════════════════════════════════════════════════════════════════════════
const triviaIo = io.of('/trivia');
const triviaRooms={};
const QUESTIONS=[
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

triviaIo.on('connection',socket=>{
  let myRoomId=null;
  socket.on('createRoom',({name})=>{
    const id=uid();
    triviaRooms[id]={id,host:socket.id,players:{[socket.id]:{name:(name||'Host').slice(0,16),score:0,answered:false}},state:'lobby',q:0,questions:[],timer:null};
    myRoomId=id;
    socket.join(id);
    socket.emit('roomCreated',{roomId:id});
    triviaIo.to(id).emit('triviaLobby',{players:Object.values(triviaRooms[id].players),roomId:id});
  });
  socket.on('joinRoom',({name,roomId})=>{
    const room=triviaRooms[roomId];
    if(!room||room.state!=='lobby'){socket.emit('error','Sala no disponible');return;}
    room.players[socket.id]={name:(name||'Player').slice(0,16),score:0,answered:false};
    myRoomId=roomId;
    socket.join(roomId);
    triviaIo.to(roomId).emit('triviaLobby',{players:Object.values(room.players),roomId});
  });
  socket.on('startGame',()=>{
    const room=triviaRooms[myRoomId];
    if(!room||room.host!==socket.id) return;
    const shuffled=[...QUESTIONS].sort(()=>Math.random()-.5).slice(0,10);
    room.questions=shuffled;
    room.state='playing';
    room.q=0;
    triviaNextQ(myRoomId);
  });
  socket.on('answer',({idx})=>{
    const room=triviaRooms[myRoomId];
    if(!room||room.state!=='question') return;
    const player=room.players[socket.id];
    if(!player||player.answered) return;
    player.answered=true;
    const correct=idx===room.questions[room.q].a;
    const timeLeft=room.timeLeft||0;
    if(correct) player.score+=Math.max(10,100+timeLeft*4);
    socket.emit('answerResult',{correct,correct_idx:room.questions[room.q].a});
    const allAnswered=Object.values(room.players).every(p=>p.answered);
    if(allAnswered){clearTimeout(room.timer);triviaReveal(myRoomId);}
  });
  socket.on('disconnect',()=>{
    if(myRoomId){
      const room=triviaRooms[myRoomId];
      if(room){delete room.players[socket.id];if(Object.keys(room.players).length===0){clearTimeout(room.timer);delete triviaRooms[myRoomId];}}
    }
  });
});

function triviaNextQ(roomId){
  const room=triviaRooms[roomId]; if(!room) return;
  if(room.q>=room.questions.length){triviaEnd(roomId);return;}
  const q=room.questions[room.q];
  Object.values(room.players).forEach(p=>{p.answered=false;});
  room.state='question';
  room.timeLeft=15;
  triviaIo.to(roomId).emit('triviaQuestion',{q:q.q,opts:q.opts,num:room.q+1,total:room.questions.length,time:15});
  const tick=setInterval(()=>{room.timeLeft--;if(room.timeLeft<=0){clearInterval(tick);triviaReveal(roomId);}},1000);
  room.timer=tick;
}
function triviaReveal(roomId){
  const room=triviaRooms[roomId]; if(!room) return;
  room.state='reveal';
  const q=room.questions[room.q];
  triviaIo.to(roomId).emit('triviaReveal',{correct_idx:q.a,scores:Object.values(room.players).map(p=>({name:p.name,score:p.score})).sort((a,b)=>b.score-a.score)});
  room.q++;
  setTimeout(()=>triviaNextQ(roomId),3500);
}
function triviaEnd(roomId){
  const room=triviaRooms[roomId]; if(!room) return;
  room.state='done';
  const scores=Object.values(room.players).map(p=>({name:p.name,score:p.score})).sort((a,b)=>b.score-a.score);
  triviaIo.to(roomId).emit('triviaEnd',{scores});
  setTimeout(()=>delete triviaRooms[roomId],60000);
}

// ════════════════════════════════════════════════════════════════════════════
// PONG  /pong
// ════════════════════════════════════════════════════════════════════════════
const pongIo = io.of('/pong');
const pongQueue=[], pongRooms={};
const PW=800,PH=500,PR=10,PSPD=5,PPAD=30,PPWD=12,PPHT=80;

function pongNewBall(dir=1){return{x:PW/2,y:PH/2,vx:(4+Math.random()*2)*dir,vy:(3+Math.random()*2)*(Math.random()<.5?1:-1)};}

pongIo.on('connection',socket=>{
  let myRoom=null;
  socket.on('join',({name})=>{
    pongQueue.push({socket,name:(name||'Player').slice(0,16)});
    socket.emit('waiting');
    if(pongQueue.length>=2){
      const [p1,p2]=pongQueue.splice(0,2);
      const id=uid();
      const ball=pongNewBall(1);
      const room={id,p1:p1.socket.id,p2:p2.socket.id,names:{[p1.socket.id]:p1.name,[p2.socket.id]:p2.name},paddles:{[p1.socket.id]:PH/2,[p2.socket.id]:PH/2},score:{[p1.socket.id]:0,[p2.socket.id]:0},ball,interval:null,done:false};
      pongRooms[id]=room;
      [p1,p2].forEach((p,i)=>{ p.socket.join(id); p.socket.emit('pongStart',{roomId:id,side:i===0?'left':'right',myId:p.socket.id,names:room.names}); });
      room.interval=setInterval(()=>pongTick(id),16);
    }
  });
  socket.on('paddle',({y})=>{
    const room=Object.values(pongRooms).find(r=>r.p1===socket.id||r.p2===socket.id);
    if(room) room.paddles[socket.id]=Math.max(PPHT/2,Math.min(PH-PPHT/2,y));
  });
  socket.on('disconnect',()=>{
    const qi=pongQueue.findIndex(p=>p.socket.id===socket.id);
    if(qi!==-1) pongQueue.splice(qi,1);
    const room=Object.values(pongRooms).find(r=>r.p1===socket.id||r.p2===socket.id);
    if(room&&!room.done){clearInterval(room.interval);pongIo.to(room.id).emit('pongEnd',{winner:'?',abandoned:true});delete pongRooms[room.id];}
  });
});

function pongTick(roomId){
  const room=pongRooms[roomId]; if(!room||room.done) return;
  const b=room.ball;
  b.x+=b.vx; b.y+=b.vy;
  if(b.y-PR<0){b.y=PR;b.vy=Math.abs(b.vy);}
  if(b.y+PR>PH){b.y=PH-PR;b.vy=-Math.abs(b.vy);}
  const p1y=room.paddles[room.p1], p2y=room.paddles[room.p2];
  if(b.x-PR<=PPAD+PPWD&&b.y>=p1y-PPHT/2&&b.y<=p1y+PPHT/2&&b.vx<0){b.vx=Math.abs(b.vx)*1.05;b.x=PPAD+PPWD+PR;}
  if(b.x+PR>=PW-PPAD-PPWD&&b.y>=p2y-PPHT/2&&b.y<=p2y+PPHT/2&&b.vx>0){b.vx=-Math.abs(b.vx)*1.05;b.x=PW-PPAD-PPWD-PR;}
  if(b.x<0){room.score[room.p2]++;pongReset(room,-1);}
  if(b.x>PW){room.score[room.p1]++;pongReset(room,1);}
  const sc=room.score;
  if(sc[room.p1]>=7||sc[room.p2]>=7){
    room.done=true;clearInterval(room.interval);
    const winner=sc[room.p1]>=7?room.p1:room.p2;
    pongIo.to(roomId).emit('pongEnd',{winner:room.names[winner],score:sc});
    setTimeout(()=>delete pongRooms[roomId],30000);
    return;
  }
  pongIo.to(roomId).emit('pongState',{ball:b,paddles:room.paddles,score:room.score});
}
function pongReset(room,dir){Object.assign(room.ball,pongNewBall(dir));}

// ════════════════════════════════════════════════════════════════════════════
const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`\n  🟢  GameHub → http://localhost:${PORT}\n`));
