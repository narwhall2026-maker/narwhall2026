import {newWallSnake,snakeStep,newWallBounce,moveBouncePaddle,bounceStep} from './game-rules.js';
const allowed=new Set(['https://narwhall.app','https://www.narwhall.app','https://narwhall2026.vercel.app']);
const directions=[{x:0,y:-1},{x:1,y:0},{x:0,y:1},{x:-1,y:0}];
export function replayGame(game,seed,proof,elapsed){
 if(!Array.isArray(proof)||proof.length===0||proof.length>(game==='snake'?3750:72000))throw Error('Play a round before saving a score.');
 const played=proof.length*(game==='snake'?.16:1/120);
 if(played>elapsed+3)throw Error('The replay is longer than the round.');
 if(game==='snake'){
  const s=newWallSnake();s.rng=seed;s.running=true;
  for(const move of proof){if(!Number.isInteger(move)||!directions[move]||s.over)throw Error('Invalid Snake replay.');const d=directions[move];if(d.x===-s.direction.x&&d.y===-s.direction.y)throw Error('Invalid Snake turn.');s.next=d;snakeStep(s);}
  return s.score;
 }
 if(game!=='bounce')throw Error('Unknown game.');
 const s=newWallBounce();s.running=true;
 for(const entry of proof){
  if(!Array.isArray(entry)||entry.length!==2||!Number.isInteger(entry[0])||entry[0]<580||entry[0]>5420||![-1,0,1].includes(entry[1])||s.over)throw Error('Invalid Bubble Bounce replay.');
  if(s.ready){moveBouncePaddle(s,entry[0]/10);s.running=true;s.ready=false;}
  moveBouncePaddle(s,entry[0]/10);bounceStep(s,1/120,entry[1]);
 }
 return s.score;
}
const base=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
async function database(path,method='GET',body){
 const response=await fetch(base+'/rest/v1/'+path,{method,headers:{apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!response.ok)throw Error('Could not save this game. Please try again.');const text=await response.text();return text?JSON.parse(text):null;
}
Deno.serve(async request=>{
 const origin=request.headers.get('origin');const headers={'Access-Control-Allow-Origin':allowed.has(origin)?origin:'https://narwhall.app','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
 const reply=(body,status=200)=>Response.json(body,{status,headers});
 if(origin&&!allowed.has(origin))return reply({error:'Origin not allowed.'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST')return reply({error:'Use POST.'},405);
 try{
  const authorization=request.headers.get('authorization');if(!authorization?.startsWith('Bearer '))return reply({error:'Please log in to save scores.'},401);
  const auth=await fetch(base+'/auth/v1/user',{headers:{apikey:anon,Authorization:authorization}});if(!auth.ok)return reply({error:'Please log in again.'},401);const user=await auth.json();
  if(Number(request.headers.get('content-length'))>1500000)return reply({error:'Round replay is too large.'},413);
  const reader=request.body?.getReader();if(!reader)return reply({error:'Missing request.'},400);let total=0;const chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>1500000){await reader.cancel();return reply({error:'Round replay is too large.'},413);}chunks.push(value);}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}const data=JSON.parse(new TextDecoder().decode(bytes));
  if(data.action==='start'){
   if(!['snake','bounce'].includes(data.game))return reply({error:'Unknown game.'},400);
   const recent=await database('game_runs?user_id=eq.'+user.id+'&created_at=gte.'+encodeURIComponent(new Date(Date.now()-60000).toISOString())+'&select=id&limit=10');
   if(recent.length>=10)return reply({error:'Too many rounds started. Wait a minute and try again.'},429);
   const seed=crypto.getRandomValues(new Uint32Array(1))[0];const rows=await database('game_runs','POST',{user_id:user.id,game:data.game,seed});return reply({id:rows[0].id,seed});
  }
  if(data.action==='finish'){
   if(typeof data.runId!=='string'||!/^[0-9a-f-]{36}$/.test(data.runId))return reply({error:'Invalid round.'},400);
   const rows=await database('game_runs?id=eq.'+data.runId+'&user_id=eq.'+user.id+'&select=*');const run=rows[0];
   if(!run||run.completed_at)return reply({error:'This round is unavailable or already saved.'},409);
   const elapsed=(Date.now()-Date.parse(run.created_at))/1000;if(elapsed<0||elapsed>7200)return reply({error:'This round has expired. Start another.'},400);
   const score=replayGame(run.game,Number(run.seed),data.proof,elapsed);
   await database('rpc/finish_verified_game','POST',{p_run:run.id,p_user:user.id,p_score:score});return reply({score,runId:run.id,game:run.game});
  }
  return reply({error:'Unknown action.'},400);
 }catch(error){return reply({error:error.message||'Game service unavailable.'},400);}
});
