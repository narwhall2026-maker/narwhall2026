const MAX_BYTES = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
const allowed = new Set(['https://narwhall.app','https://www.narwhall.app','https://narwhall2026.vercel.app','https://narwhall2026-narwhall2026-maker.vercel.app']);
function json(data,status=200) { return Response.json(data,{status}); }
export default {
 async fetch(request,env,ctx) {
  const origin=request.headers.get('Origin');
  const cors={'Vary':'Origin','Access-Control-Allow-Methods':'GET,PUT,POST,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Max-Age':'86400'};
  if(origin && !allowed.has(origin)) return json({error:'Origin not allowed'},403);
  if(origin) cors['Access-Control-Allow-Origin']=origin;
  let response;
  try {
   if(request.method==='OPTIONS') response=new Response(null,{status:204});
   else response=await handle(request,env,ctx);
  } catch(e) { console.error('Media request failed:',e.message); response=json({error:'Photo service is temporarily unavailable. Please try again.'},503); }
  const headers=new Headers(response.headers);
  Object.entries(cors).forEach(([k,v])=>headers.set(k,v));
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('Cache-Control','no-store');
  return new Response(response.body,{status:response.status,headers});
 }
};
async function handle(request,env,ctx) {
 const url=new URL(request.url);
 if(url.pathname==='/health' && request.method==='GET') return json({ok:true,storage:'cloudflare-r2'});
 const token=request.headers.get('Authorization');
 if(!token?.startsWith('Bearer ')) return json({error:'Please log in first.'},401);
 const headers={apikey:env.SUPABASE_KEY,Authorization:token,'Content-Type':'application/json'};
 if(url.pathname==='/account-delete' && request.method==='POST')return json({error:'Immediate deletion is no longer available. Refresh Narwhall and request deletion from Profile. There is a 30-day wait and admin review.'},410);
 if(url.pathname==='/admin-account-delete' && request.method==='POST') {
  const auth=await fetch(`${env.SUPABASE_URL}/auth/v1/user`,{headers});
  if(!auth.ok)return json({error:'Please sign in again.'},401);
  const admin=await auth.json();if(!UUID.test(admin.id))return json({error:'Invalid account.'},401);
  const role=await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/is_narwhall_admin`,{method:'POST',headers,body:'{}'});
  if(!role.ok || await role.json()!==true)return json({error:'Admin access required.'},403);
  if(Number(request.headers.get('Content-Length'))>2048)return json({error:'Invalid confirmation.'},400);
  const reader=request.body?.getReader();if(!reader)return json({error:'Confirmation required.'},400);
  let total=0,parts=[];while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>2048){await reader.cancel();return json({error:'Invalid confirmation.'},400);}parts.push(value);}
  const bytes=new Uint8Array(total);let index=0;for(const part of parts){bytes.set(part,index);index+=part.byteLength;}
  let data;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{return json({error:'Invalid confirmation.'},400);}
  if(data.confirmation!=='DELETE'||!UUID.test(data.request_id||''))return json({error:'Confirm DELETE and a valid review request.'},403);
  const start=await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/begin_reviewed_deletion`,{method:'POST',headers,body:JSON.stringify({p_request:data.request_id,confirmation:'DELETE'})});
  if(!start.ok)return json({error:'Deletion is blocked. Confirm your admin password, complete the photo review, and wait the full 30 days.'},403);
  const permit=await start.json(),owner=permit.user_id;
  if(!UUID.test(owner||'')||!UUID.test(permit.token||''))return json({error:'Invalid deletion authorisation.'},503);
  let empty=false;
  for(let batch=0;batch<20;batch++){
   const listed=await env.PHOTOS.list({prefix:owner+'/',limit:100});if(!listed.objects.length){empty=true;break;}
   const keys=listed.objects.map(o=>o.key);if(keys.some(key=>!key.startsWith(owner+'/')))return json({error:'Photo cleanup could not be completed.'},503);
   await env.PHOTOS.delete(keys);
  }
  if(!empty)return json({error:'Photo cleanup is in progress. Resume final deletion to finish.'},503);
  const removed=await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/finish_reviewed_deletion`,{method:'POST',headers,body:JSON.stringify({p_request:data.request_id,p_token:permit.token})});
  if(!removed.ok || await removed.json()!==true)return json({error:'Photo cleanup started, but the account still needs finalisation. Resume final deletion to finish.'},503);
  return json({deleted:true});
 }
 if(url.pathname==='/upload' && request.method==='PUT') {
  const auth=await fetch(`${env.SUPABASE_URL}/auth/v1/user`,{headers});
  if(!auth.ok) return json({error:'Your session expired. Please log in again.'},401);
  const user=await auth.json();
  if(!UUID.test(user.id)) return json({error:'Invalid user'},401);
  const available=await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/account_available`,{method:'POST',headers,body:'{}'});
  if(!available.ok || await available.json()!==true)return json({error:'This account is being deleted. New uploads are paused.'},403);
  const existing=await env.PHOTOS.list({prefix:user.id+'/',limit:100});
  if(existing.objects.length>=100 || existing.truncated) return json({error:'Your wall has reached its 100-photo limit.'},429);
  const length=Number(request.headers.get('Content-Length'));
  if(length>MAX_BYTES) return json({error:'Photos must be 2 MB or smaller.'},413);
  const reader=request.body?.getReader();
  if(!reader) return json({error:'Choose a photo.'},400);
  let size=0; const chunks=[];
  while(true) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>MAX_BYTES){await reader.cancel();return json({error:'Photos must be 2 MB or smaller.'},413);} chunks.push(value); }
  const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}
  if(bytes.length<12) return json({error:'Invalid image'},415);
  let ext,type;
  if(bytes[0]===255 && bytes[1]===216 && bytes[2]===255){ext='jpg';type='image/jpeg';}
  else if(bytes[0]===137 && bytes[1]===80 && bytes[2]===78 && bytes[3]===71){ext='png';type='image/png';}
  else if(new TextDecoder().decode(bytes.slice(0,4))==='RIFF' && new TextDecoder().decode(bytes.slice(8,12))==='WEBP'){ext='webp';type='image/webp';}
  else return json({error:'Use a JPEG, PNG, or WebP photo.'},415);
  const key=`${user.id}/${crypto.randomUUID()}.${ext}`;
  await env.PHOTOS.put(key,bytes,{httpMetadata:{contentType:type}});
  const stillAvailable=await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/account_available`,{method:'POST',headers,body:'{}'});
  if(!stillAvailable.ok || await stillAvailable.json()!==true){await env.PHOTOS.delete(key);return json({error:'This account is being deleted. The upload was cancelled.'},403);}
  return json({key,bytes:size});
 }
 if(url.pathname.startsWith('/photo/') && request.method==='GET') {
  const key=url.pathname.slice(7);
  if(!KEY.test(key)) return json({error:'Invalid photo'},400);
  // Recheck RLS on every request, including cache hits and expiring wall peeks.
  const permission=await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/photo_access`,{method:'POST',headers,body:JSON.stringify({photo_key:key})});
  if(!permission.ok) return json({error:'Please log in to view this photo.'},401);
  if(await permission.json()!==true) return json({error:'Photo unavailable'},404);
  const cacheKey=new Request(url.origin+'/cached/'+key);
  const cached=await caches.default.match(cacheKey);
  if(cached) return cached;
  const object=await env.PHOTOS.get(key);
  if(!object) return json({error:'Photo unavailable'},404);
  const h=new Headers();object.writeHttpMetadata(h);h.set('ETag',object.httpEtag);h.set('Cache-Control','public,max-age=86400');
  const response=new Response(object.body,{headers:h});
  ctx.waitUntil(caches.default.put(cacheKey,response.clone()));
  return response;
 }
 return json({error:'Not found'},404);
}
