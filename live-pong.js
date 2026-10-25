// The browser sends paddle targets only. Cloudflare owns the ball and outcomes.
const PONG_SERVICE='https://narwhall-live.narwhall2026.workers.dev';
let pongLobbyTimer=null,pongLobbyLoading=false,pongLobbyGeneration=0,pongSession=null;
async function loadPongLobby(){
 if(pongLobbyLoading||currentScreen!=='games')return;
 pongLobbyLoading=true;const generation=pongLobbyGeneration;
 try{
  const session=check(await supabaseClient.auth.getSession()).session;
  $('pongInviteButton').disabled=!session;
  if(!session){empty($('pongInvitations'),'Log in to invite a friend to a live match.');$('pongFriend').replaceChildren(new Option('Log in first',''));return;}
  const [result,friends]=await Promise.all([supabaseClient.from('live_pong_invites').select('*').in('status',['pending','accepted']).gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false}).limit(20),friendships()]);
  const invitations=check(result),ids=friends.rows.map(f=>f.sender_id===session.user.id?f.receiver_id:f.sender_id);
  const names=await profileMap([...ids,...invitations.flatMap(i=>[i.host_id,i.guest_id])]);
  if(generation!==pongLobbyGeneration||currentScreen!=='games')return;
  const selected=$('pongFriend').value;$('pongFriend').replaceChildren(new Option(ids.length?'Choose a friend':'Add a friend first',''));
  ids.forEach(id=>$('pongFriend').add(new Option(names.get(id)||'Friend',id)));if(ids.includes(selected))$('pongFriend').value=selected;
  $('pongInvitations').replaceChildren();if(!invitations.length)empty($('pongInvitations'),'Invite a friend, then keep Games open while they accept.');
  for(const invitation of invitations){
   const incoming=invitation.guest_id===session.user.id,name=names.get(incoming?invitation.host_id:invitation.guest_id)||'Friend';
   const buttons=invitation.status==='accepted'?[['Join live match',()=>joinLivePong(invitation)],['Cancel match',()=>closePongInvitation(invitation.id)]]:
    incoming?[['Accept & join',async()=>{check(await supabaseClient.rpc('reply_live_pong',{p_invite:invitation.id,p_accept:true}));await joinLivePong({...invitation,status:'accepted'});}],['Decline',async()=>{check(await supabaseClient.rpc('reply_live_pong',{p_invite:invitation.id,p_accept:false}));await loadPongLobby();}]]:[['Cancel invitation',()=>closePongInvitation(invitation.id)]];
   row($('pongInvitations'),(incoming?'From ':'To ')+name+' · '+(invitation.status==='accepted'?'Ready to join':'Waiting for acceptance')+' · expires '+new Date(invitation.expires_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),buttons);
  }
 }finally{pongLobbyLoading=false;}
}
function startPongLobby(){clearInterval(pongLobbyTimer);pongLobbyGeneration++;action(loadPongLobby);pongLobbyTimer=setInterval(()=>action(loadPongLobby),7000);}
function stopPongLobby(){clearInterval(pongLobbyTimer);pongLobbyTimer=null;pongLobbyGeneration++;}
async function inviteLivePong(){const friend=$('pongFriend').value;if(!friend)throw Error('Choose an accepted friend first.');await requireUser();check(await supabaseClient.rpc('invite_live_pong',{p_friend:friend}));notice('Live Pong invitation sent. Your friend can accept in Games or Inbox.');await loadPongLobby();}
async function closePongInvitation(id){check(await supabaseClient.rpc('close_live_pong',{p_invite:id}));await loadPongLobby();}
async function pongTicket(id){
 const session=check(await supabaseClient.auth.getSession()).session;if(!session)throw Error('Please log in first.');
 const response=await fetch(PONG_SERVICE+'/ticket?room='+encodeURIComponent(id),{method:'POST',headers:{Authorization:'Bearer '+session.access_token}});
 let data;try{data=await response.json();}catch{throw Error('Live Pong is unavailable. Try again.');}if(!response.ok)throw Error(data.error||'Could not join this match.');return data;
}
async function joinLivePong(invitation){
 const generation=socialGeneration;const ticket=await pongTicket(invitation.id);
 if(generation!==socialGeneration)return;
 if(currentScreen!=='games'&&currentScreen!=='pong')return;
 if(pongSession)endPongSession(false);
 showScreen('pong');
 const ws=new WebSocket(PONG_SERVICE.replace('https:','wss:')+'/connect?room='+encodeURIComponent(invitation.id)+'&ticket='+encodeURIComponent(ticket.ticket));
 const p={invitation,ws,seat:null,state:null,frame:0,intended:false,lastMove:0,target:250,held:0,lastFrame:performance.now(),closed:false};pongSession=p;void loadPongBackground(p);
 $('pongMatchStatus').textContent='Connecting to your friend…';$('pongReadyButton').disabled=true;$('pongReconnectButton').hidden=true;$('pongPlayers').textContent='One shared ball. Two Narwhall accounts.';
 ws.onmessage=event=>{
  if(pongSession!==p)return;let data;try{data=JSON.parse(event.data);}catch{return;}
  if(data.type==='seat'){p.seat=data.seat;$('pongPlayers').textContent='You: '+(p.seat===0?'left':'right')+' paddle · Friend: '+(p.seat===0?'right':'left')+' paddle';}
  if(data.type==='state'){p.state=data;p.closed=false;updatePongMatch(p);}
  if(data.type==='closed'){p.closed=true;$('pongMatchStatus').textContent=data.reason||'Match ended.';$('pongReadyButton').disabled=true;$('pongReconnectButton').hidden=true;}
 };
 ws.onclose=()=>{if(pongSession!==p||p.intended)return;$('pongReadyButton').disabled=true;if(!p.closed){$('pongMatchStatus').textContent='Connection lost. Tap Reconnect within 15 seconds to restart the rally, or send a new invitation.';$('pongReconnectButton').hidden=false;}};
 ws.onerror=()=>{if(pongSession===p)$('pongMatchStatus').textContent='Could not connect. Check your connection and try Reconnect.';};
 function frame(now){if(pongSession!==p)return;const dt=Math.min((now-p.lastFrame)/1000,.05);p.lastFrame=now;if(p.held)sendPongTarget(p.target+p.held*600*dt);drawLivePong(p,now);p.frame=requestAnimationFrame(frame);}p.frame=requestAnimationFrame(frame);
}
function updatePongMatch(p){
 const s=p.state,button=$('pongReadyButton');button.disabled=p.seat===null||!s.connected.every(Boolean)||!['waiting','finished'].includes(s.phase)||s.ready[p.seat];
 button.textContent=s.phase==='finished'?'Ready for rematch':s.ready[p.seat]?'Waiting for friend…':'Ready to play';
 let message='Waiting for both people to join.';
 if(s.phase==='waiting'&&s.connected.every(Boolean))message='Both here! Tap Ready when you want to start.';
 if(s.phase==='countdown')message='Get ready…';if(s.phase==='playing')message='Keep the ball moving. First miss loses!';
 if(s.phase==='paused')message='Your friend disconnected. Paused for up to 15 seconds.';
 if(s.phase==='finished')message=s.round.winner===null?'Two-minute rally! Call it a draw.':s.round.winner===p.seat?'You won! Fancy a rematch?':'Your friend won! Go again?';
 $('pongMatchStatus').textContent=message;$('pongScore').textContent=(s.wins||[0,0]).join(' : ');
}
function readyLivePong(){const p=pongSession;if(p?.ws.readyState===WebSocket.OPEN){p.ws.send(JSON.stringify({type:'ready'}));$('pongReadyButton').disabled=true;}}
function sendPongTarget(y){const p=pongSession;if(!p||p.seat===null)return;p.target=Math.max(58,Math.min(442,y));if(p.ws.readyState===WebSocket.OPEN&&performance.now()-p.lastMove>=25){p.lastMove=performance.now();p.ws.send(JSON.stringify({type:'move',y:p.target}));}}
function drawLivePong(p){
 const canvas=$('pongCanvas'),ctx=canvas.getContext('2d'),s=p.state;
 ctx.clearRect(0,0,800,500);ctx.fillStyle='#321c45';ctx.fillRect(0,0,800,500);if(p.background){const image=p.background,scale=Math.max(800/image.naturalWidth,500/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;ctx.drawImage(image,(800-w)/2,(500-h)/2,w,h);ctx.fillStyle='#281637aa';ctx.fillRect(0,0,800,500);}ctx.strokeStyle='#ffffff16';ctx.setLineDash([8,14]);ctx.beginPath();ctx.moveTo(400,20);ctx.lineTo(400,480);ctx.stroke();ctx.setLineDash([]);
 const paddles=s?.round.paddles||[250,250];for(let i=0;i<2;i++){ctx.fillStyle=p.seat===i?'#bce8db':'#d7bbf4';ctx.fillRect(i===0?18:770,paddles[i]-58,12,116);}
 const ball=s?.round.ball||{x:400,y:250};ctx.fillStyle='#fff6df';ctx.beginPath();ctx.arc(ball.x,ball.y,8,0,Math.PI*2);ctx.fill();
 if(!s||s.phase!=='playing'){ctx.fillStyle='#281637bb';ctx.fillRect(100,180,600,140);ctx.fillStyle='#f4f0e9';ctx.textAlign='center';ctx.font='600 34px sans-serif';ctx.fillText(s?.phase==='countdown'?String(Math.max(1,Math.ceil((s.startsAt-Date.now())/1000))):s?.phase==='finished'?(s.round.winner===null?'A brilliant rally':s.round.winner===p.seat?'You won!':'Next round?'):s?.phase==='paused'?'Connection paused':'Ready when you both are',400,260);}
}
function endPongSession(notify=true){
 const p=pongSession;if(!p)return;pongSession=null;p.intended=true;cancelAnimationFrame(p.frame);
 if(notify&&p.ws.readyState===WebSocket.OPEN)p.ws.send(JSON.stringify({type:'leave'}));p.ws.close();
 if(p.backgroundUrl){URL.revokeObjectURL(p.backgroundUrl);imageUrls.delete(p.backgroundUrl);}
 if(notify)void supabaseClient.rpc('close_live_pong',{p_invite:p.invitation.id}).then(result=>{if(result.error)console.error('Could not close live invitation');});
}
function leaveLivePong(){endPongSession();showScreen('games');}
function setupLivePong(){
 const canvas=$('pongCanvas');let dragging=false;
 const move=event=>{const rect=canvas.getBoundingClientRect();sendPongTarget((event.clientY-rect.top)/rect.height*500);};
 canvas.addEventListener('pointerdown',event=>{dragging=true;canvas.setPointerCapture(event.pointerId);canvas.focus({preventScroll:true});move(event);});
 canvas.addEventListener('pointermove',event=>{if(dragging)move(event);});for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,()=>{dragging=false;});
 canvas.addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown','w','s'].includes(event.key)){event.preventDefault();if(pongSession)pongSession.held=['ArrowUp','w'].includes(event.key)?-1:1;}});
 canvas.addEventListener('keyup',()=>{if(pongSession)pongSession.held=0;});canvas.addEventListener('blur',()=>{if(pongSession)pongSession.held=0;});
 document.querySelectorAll('[data-pong-move]').forEach(button=>{button.addEventListener('pointerdown',event=>{button.setPointerCapture(event.pointerId);if(pongSession)pongSession.held=Number(button.dataset.pongMove);});for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,()=>{if(pongSession)pongSession.held=0;});button.addEventListener('click',()=>sendPongTarget((pongSession?.target||250)+Number(button.dataset.pongMove)*45));});
 window.addEventListener('pagehide',()=>endPongSession());
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&pongSession){pongSession.held=0;pongSession.ws.close();}});
}
document.addEventListener('DOMContentLoaded',setupLivePong);

async function loadPongBackground(p){
 if(!p.invitation.background_key)return;
 let url;
 try{url=await photoUrl(p.invitation.background_key);if(pongSession!==p){URL.revokeObjectURL(url);imageUrls.delete(url);return;}
 const image=new Image();image.src=url;await image.decode();if(pongSession!==p){URL.revokeObjectURL(url);imageUrls.delete(url);return;}p.background=image;p.backgroundUrl=url;
 }catch{if(url){URL.revokeObjectURL(url);imageUrls.delete(url);}}
}

function resetPongState(){endPongSession();stopPongLobby();$('pongInvitations').replaceChildren();$('pongFriend').replaceChildren(new Option('Choose a friend',''));$('pongInviteButton').disabled=true;}
