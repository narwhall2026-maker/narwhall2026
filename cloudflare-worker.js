const MAX_BYTES = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
const allowed = new Set(['https://narwhall2026.vercel.app','https://narwhall2026-narwhall2026-maker.vercel.app']);
function json(data,status=200) { return Response.json(data,{status}); }
export default {
 async fetch(request,env,ctx) {
  const origin=request.headers.get('Origin');
  const cors={'Vary':'Origin','Access-Control-Allow-Methods':'GET,PUT,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Max-Age':'86400'};
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
 if(url.pathname==='/upload' && request.method==='PUT') {
  const auth=await fetch(`${env.SUPABASE_URL}/auth/v1/user`,{headers});
  if(!auth.ok) return json({error:'Your session expired. Please log in again.'},401);
  const user=await auth.json();
  if(!UUID.test(user.id)) return json({error:'Invalid user'},401);
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
