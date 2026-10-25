import {DurableObject} from 'cloudflare:workers';
import {newPongRound,stepPong,clamp} from './pong-rules.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ORIGINS=new Set(['https://narwhall.app','https://www.narwhall.app','https://narwhall2026.vercel.app','https://narwhall2026-narwhall2026-maker.vercel.app']);
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export default {async fetch(request,env){
 const origin=request.headers.get('Origin'),url=new URL(request.url);
 if(origin&&!ORIGINS.has(origin))return json({error:'Origin not allowed'},403);
 if(url.pathname==='/health')return json({ok:true,game:'live-pong'});
 const cors={'Access-Control-Allow-Origin':origin||'https://narwhall.app','Access-Control-Allow-Methods':'POST,GET,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Vary':'Origin'};
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 try{
  const id=url.searchParams.get('room');if(!UUID.test(id||''))return json({error:'Invalid invitation'},400);
  if(url.pathname==='/connect'&&request.method==='GET'){
   if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return json({error:'WebSocket required'},426);
   return await env.PONG_ROOMS.getByName(id).fetch(request);
  }
  if(url.pathname!=='/ticket'||request.method!=='POST')return json({error:'Not found'},404);
  const authorization=request.headers.get('Authorization');if(!authorization?.startsWith('Bearer '))return new Response(JSON.stringify({error:'Please log in first'}),{status:401,headers:{...cors,'Content-Type':'application/json'}});
  const headers={apikey:env.SUPABASE_KEY,Authorization:authorization};
  const auth=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers});if(!auth.ok)return new Response(JSON.stringify({error:'Please log in again'}),{status:401,headers:{...cors,'Content-Type':'application/json'}});
  const user=await auth.json();
  const invites=await fetch(env.SUPABASE_URL+'/rest/v1/live_pong_invites?id=eq.'+id+'&select=id,host_id,guest_id,status,expires_at',{headers});
  const rows=invites.ok?await invites.json():[],invite=rows[0];
  if(!invite||invite.status!=='accepted'||Date.parse(invite.expires_at)<=Date.now()||![invite.host_id,invite.guest_id].includes(user.id))return new Response(JSON.stringify({error:'Ask your friend to accept an unexpired invitation first.'}),{status:403,headers:{...cors,'Content-Type':'application/json'}});
  const result=await env.PONG_ROOMS.getByName(id).ticket(invite,user.id);
  return new Response(JSON.stringify(result),{headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
 }catch(error){console.error('pong_request_failed');return new Response(JSON.stringify({error:'Live game unavailable. Please retry.'}),{status:503,headers:{...cors,'Content-Type':'application/json'}});}
}};
export class PongRoom extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.timer=null;this.seats=[null,null];this.ready=[false,false];this.targets=[250,250];
  ctx.blockConcurrencyWhile(async()=>{ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS tickets(token TEXT PRIMARY KEY,seat INTEGER,expires INTEGER)');this.room=await ctx.storage.get('room')||null;this.round=await ctx.storage.get('round')||newPongRound();this.phase=await ctx.storage.get('phase')||'waiting';
   for(const ws of ctx.getWebSockets()){const a=ws.deserializeAttachment();if(a&&[0,1].includes(a.seat)){this.seats[a.seat]=ws;}}
   if(['playing','countdown','paused'].includes(this.phase)){this.phase='waiting';this.ready=[false,false];await ctx.storage.put('phase','waiting');}
  });
 }
 async ticket(invite,user){
  if(this.room&&this.room.id!==invite.id)throw Error('Wrong room');
  if(!this.room){await this.ctx.storage.put('room',invite);this.room=invite;await this.ctx.storage.setAlarm(Date.parse(invite.expires_at));}
  if(Date.parse(this.room.expires_at)<=Date.now()||this.phase==='closed')throw Error('Room closed');
  const seat=invite.host_id===user?0:1,token=crypto.randomUUID();
  this.ctx.storage.sql.exec('DELETE FROM tickets WHERE expires<? OR seat=?',Date.now(),seat);
  this.ctx.storage.sql.exec('INSERT INTO tickets VALUES(?,?,?)',token,seat,Date.now()+30000);return {ticket:token,expires_at:invite.expires_at};
 }
 async fetch(request){
  const url=new URL(request.url),token=url.searchParams.get('ticket'),permit=this.ctx.storage.sql.exec('SELECT seat,expires FROM tickets WHERE token=?',token||'').toArray()[0];this.ctx.storage.sql.exec('DELETE FROM tickets WHERE token=?',token||'');
  if(!permit||permit.expires<Date.now()||!this.room||Date.parse(this.room.expires_at)<=Date.now()||this.phase==='closed')return json({error:'Invalid or expired game ticket'},403);
  const seat=permit.seat,previous=this.seats[seat];if(previous){this.seats[seat]=null;previous.close(4001,'Opened on another device');}
  const pair=new WebSocketPair(),client=pair[0],server=pair[1];this.ctx.acceptWebSocket(server);server.serializeAttachment({seat,last:0,count:0,window:Date.now()});this.seats[seat]=server;this.ready[seat]=false;
  server.send(JSON.stringify({type:'seat',seat}));
  if(this.phase==='paused'){this.phase='waiting';this.ready=[false,false];await this.ctx.storage.put('phase',this.phase);clearInterval(this.timer);this.timer=null;}
  this.broadcast();return new Response(null,{status:101,webSocket:client});
 }
 snapshot(){return {type:'state',phase:this.phase,round:this.round,connected:this.seats.map(Boolean),ready:this.ready,startsAt:this.startsAt||0,expiresAt:Date.parse(this.room.expires_at),wins:this.wins||[0,0]};}
 broadcast(){const message=JSON.stringify(this.snapshot());for(const ws of this.seats)if(ws){try{ws.send(message);}catch{}}}
 async webSocketMessage(ws,message){
  const a=ws.deserializeAttachment();if(!a||this.seats[a.seat]!==ws)return;
  if(typeof message!=='string'||message.length>180){ws.close(1009,'Invalid message');return;}
  const now=Date.now();if(now-a.window>1000){a.window=now;a.count=0;}if(++a.count>80){ws.close(1008,'Too many updates');return;}ws.serializeAttachment(a);
  let data;try{data=JSON.parse(message);}catch{return;}
  if(data.type==='move'&&Number.isFinite(data.y)){this.targets[a.seat]=clamp(data.y,58,442);return;}
  if(data.type==='leave'){await this.closeRoom('Your friend left the match.');return;}
  if(data.type==='ready'&&['waiting','finished'].includes(this.phase)&&this.seats.every(Boolean)){
   this.ready[a.seat]=true;this.broadcast();
   if(this.ready.every(Boolean)){this.round=newPongRound(crypto.getRandomValues(new Uint8Array(1))[0]%2?1:-1);this.targets=[250,250];this.startsAt=Date.now()+3000;this.phase='countdown';await this.save();this.startLoop();this.broadcast();}
  }
 }
 async save(){await this.ctx.storage.put({round:this.round,phase:this.phase});}
 startLoop(){if(this.timer)return;this.last=Date.now();this.timer=setInterval(()=>{void this.tick().catch(()=>this.closeRoom('Connection interrupted. Send a new invitation.'));},1000/30);}
 async tick(){
  const now=Date.now();if(now>=Date.parse(this.room.expires_at)){await this.closeRoom('This room has expired.');return;}
  if(this.phase==='paused'){if(now-this.disconnectedAt>15000)await this.closeRoom('Your friend disconnected. Send a new invitation.');return;}
  if(this.phase==='countdown'){if(now<this.startsAt)return;this.phase='playing';this.playedAt=now;this.last=now;await this.save();}
  if(this.phase!=='playing')return;
  // Fixed substeps prevent the ball passing through paddles on a delayed tick.
  let remaining=Math.min((now-this.last)/1000,.1);this.last=now;this.round.targets=this.targets;
  while(remaining>0){const dt=Math.min(remaining,1/120);stepPong(this.round,dt);remaining-=dt;}
  if(this.round.winner!==null||now-this.playedAt>120000){this.phase='finished';this.ready=[false,false];this.wins||=[0,0];if(this.round.winner!==null)this.wins[this.round.winner]++;clearInterval(this.timer);this.timer=null;await this.save();}
  this.broadcast();
 }
 async webSocketClose(ws){const a=ws.deserializeAttachment();if(!a||this.seats[a.seat]!==ws)return;this.seats[a.seat]=null;this.ready=[false,false];
  if(['playing','countdown'].includes(this.phase)){this.phase='paused';this.disconnectedAt=Date.now();await this.save();this.startLoop();}this.broadcast();
 }
 async webSocketError(ws){await this.webSocketClose(ws);}
 async closeRoom(reason){if(this.phase==='closed')return;this.phase='closed';clearInterval(this.timer);this.timer=null;await this.save();for(const ws of this.seats)if(ws){try{ws.send(JSON.stringify({type:'closed',reason}));ws.close(1000,'Match closed');}catch{}}this.seats=[null,null];}
 async alarm(){await this.closeRoom('This room has expired.');await this.ctx.storage.deleteAll();}
}
