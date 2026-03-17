const socket=io('/cellwars');
const canvas=document.getElementById('gameCanvas'),ctx=canvas.getContext('2d');
const mmCanvas=document.getElementById('mmCanvas'),mmCtx=mmCanvas.getContext('2d');
let myId=null,players={},food={},leaderboard=[],worldW=6000,worldH=6000,gameActive=false;
const cam={x:0,y:0,scale:1,targetScale:1},mouse={x:0,y:0};
function resize(){canvas.width=window.innerWidth;canvas.height=window.innerHeight;}
window.addEventListener('resize',resize);resize();
canvas.addEventListener('mousemove',e=>{mouse.x=e.clientX;mouse.y=e.clientY;});
setInterval(()=>{
  if(!myId||!gameActive) return;
  const me=players[myId]; if(!me) return;
  socket.emit('input',{tx:me.x+(mouse.x-canvas.width/2)/cam.scale,ty:me.y+(mouse.y-canvas.height/2)/cam.scale});
},50);
socket.on('joined',({id,player,worldW:w,worldH:h})=>{myId=id;worldW=w;worldH=h;players={[id]:player};gameActive=true;document.getElementById('startScreen').style.display='none';document.getElementById('deathMessage').textContent='';});
socket.on('state',data=>{const n={};data.players.forEach(p=>{n[p.id]=players[p.id]?{...players[p.id],...p}:{...p};});players=n;const fn={};data.food.forEach(f=>{fn[f.id]=f;});food=fn;leaderboard=data.leaderboard;});
socket.on('eaten',({by,score})=>{gameActive=false;document.getElementById('deathMessage').textContent=`💀 ${by} te comió | Score: ${score}`;document.getElementById('startScreen').style.display='flex';players={};});
function updateCamera(){const me=players[myId];if(!me)return;cam.targetScale=Math.max(.12,Math.min(1.1,60/(me.r+55)));cam.scale+=(cam.targetScale-cam.scale)*.06;const tx=me.x-(canvas.width/2)/cam.scale,ty=me.y-(canvas.height/2)/cam.scale;cam.x+=(tx-cam.x)*.1;cam.y+=(ty-cam.y)*.1;}
function ws(x,y){return{x:(x-cam.x)*cam.scale,y:(y-cam.y)*cam.scale};}
function drawGrid(){const g=50,sx0=Math.floor(cam.x/g)*g,sy0=Math.floor(cam.y/g)*g,ex=cam.x+canvas.width/cam.scale,ey=cam.y+canvas.height/cam.scale;ctx.save();ctx.strokeStyle='rgba(255,255,255,.035)';ctx.lineWidth=1;for(let x=sx0;x<ex;x+=g){const sx=(x-cam.x)*cam.scale;ctx.beginPath();ctx.moveTo(sx,0);ctx.lineTo(sx,canvas.height);ctx.stroke();}for(let y=sy0;y<ey;y+=g){const sy=(y-cam.y)*cam.scale;ctx.beginPath();ctx.moveTo(0,sy);ctx.lineTo(canvas.width,sy);ctx.stroke();}ctx.restore();}
function drawBorder(){ctx.save();ctx.strokeStyle='rgba(255,90,90,.35)';ctx.lineWidth=5;ctx.strokeRect(-cam.x*cam.scale,-cam.y*cam.scale,worldW*cam.scale,worldH*cam.scale);ctx.restore();}
function drawFood(){for(const id in food){const f=food[id],sc=ws(f.x,f.y),sr=f.r*cam.scale;if(sr<1)continue;ctx.save();ctx.beginPath();ctx.arc(sc.x,sc.y,sr,0,Math.PI*2);ctx.fillStyle=f.color;ctx.shadowColor=f.color;ctx.shadowBlur=8;ctx.fill();ctx.restore();}}
function lighten(c,p){return c.replace(/(\d+)(?=%\))/,m=>Math.min(100,+m+p));}
function darken(c,p){return c.replace(/(\d+)(?=%\))/,m=>Math.max(0,+m-p));}
function drawCell(p){const sc=ws(p.x,p.y),sr=p.r*cam.scale;if(sr<2)return;const isMe=p.id===myId;ctx.save();const gr=ctx.createRadialGradient(sc.x-sr*.28,sc.y-sr*.28,0,sc.x,sc.y,sr);gr.addColorStop(0,lighten(p.color,40));gr.addColorStop(.55,p.color);gr.addColorStop(1,darken(p.color,25));ctx.beginPath();ctx.arc(sc.x,sc.y,sr,0,Math.PI*2);ctx.fillStyle=gr;ctx.shadowColor=p.color;ctx.shadowBlur=isMe?24:12;ctx.fill();ctx.strokeStyle=isMe?'rgba(255,255,255,.45)':darken(p.color,20)+'cc';ctx.lineWidth=Math.max(1,sr*(isMe?.055:.045));ctx.stroke();if(sr>10){ctx.beginPath();ctx.arc(sc.x-sr*.28,sc.y-sr*.28,sr*.18,0,Math.PI*2);ctx.fillStyle='rgba(255,255,255,.18)';ctx.fill();}if(sr>14){const ns=Math.max(10,Math.min(sr*.32,22));ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`700 ${ns}px Syne,sans-serif`;ctx.fillStyle='rgba(255,255,255,.95)';ctx.shadowColor='rgba(0,0,0,.9)';ctx.shadowBlur=5;ctx.fillText(p.name.slice(0,14),sc.x,sc.y-(sr>22?ns*.45:0));if(sr>22){ctx.font=`600 ${ns*.62}px 'JetBrains Mono',monospace`;ctx.fillStyle='rgba(255,255,255,.6)';ctx.fillText(Math.floor(p.mass),sc.x,sc.y+ns*.72);}}ctx.restore();}
function updateHUD(){const me=players[myId];if(!me)return;document.getElementById('massEl').textContent=`Mass: ${Math.floor(me.mass)}`;document.getElementById('scoreEl').textContent=`Score: ${me.score||0}`;const lb=document.getElementById('lbList');lb.innerHTML=leaderboard.map(p=>`<li class="${p.name===me.name?'me':''}"><span style="color:${p.color}">●</span> ${p.name.slice(0,11)}<span>${p.mass}</span></li>`).join('');}
function drawMinimap(){const mw=mmCanvas.width,mh=mmCanvas.height,scx=mw/worldW,scy=mh/worldH;mmCtx.clearRect(0,0,mw,mh);for(const id in food){const f=food[id];mmCtx.fillStyle=f.color+'88';mmCtx.fillRect(f.x*scx-.5,f.y*scy-.5,1.5,1.5);}for(const id in players){const p=players[id],r=Math.max(2,p.r*scx);mmCtx.beginPath();mmCtx.arc(p.x*scx,p.y*scy,r,0,Math.PI*2);mmCtx.fillStyle=id===myId?'#7df3e1':p.color;mmCtx.fill();}if(myId&&players[myId]){mmCtx.strokeStyle='rgba(255,255,255,.3)';mmCtx.lineWidth=1;mmCtx.strokeRect(cam.x*scx,cam.y*scy,(canvas.width/cam.scale)*scx,(canvas.height/cam.scale)*scy);}}
function loop(){ctx.clearRect(0,0,canvas.width,canvas.height);if(gameActive&&myId&&players[myId]){updateCamera();drawGrid();drawBorder();drawFood();Object.values(players).sort((a,b)=>a.mass-b.mass).forEach(p=>drawCell(p));drawMinimap();updateHUD();}requestAnimationFrame(loop);}
loop();
document.getElementById('startBtn').onclick=()=>{const n=document.getElementById('nick').value.trim()||'Cell';socket.emit('join',{name:n});};
document.getElementById('nick').onkeydown=e=>{if(e.key==='Enter')document.getElementById('startBtn').click();};
