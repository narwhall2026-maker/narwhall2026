const supabaseUrl = "https://vjugsidfdovuwtxgcvrz.supabase.co";
const supabaseKey = "sb_publishable_Q_HeljHf6jSNZm7nONcazw_JIlEZRVS";
const MEDIA = "https://narwhall-media.narwhall2026.workers.dev";
const supabaseClient = window.supabase?.createClient(supabaseUrl, supabaseKey);
let selectedPhoto = null, selectedPhotoUrl = null, saving = false, wallGeneration = 0;
let currentWall="main", captureScope="main", peekGeneration=0, activePrivatePeek=null, privatePeekTimer=null;
const imageUrls = new Set();
const $ = id => document.getElementById(id);
function notice(message, error=false) {
  const box=$("appNotice"); box.textContent=message; box.classList.toggle("error",error); box.hidden=false;
}
function check(result) { if(result.error) throw result.error; return result.data; }
async function action(task, button) {
  if(button?.disabled) return;
  if(button) button.disabled=true;
  try { return await task(); } catch(error) { console.error(error); notice(error.message || "Something went wrong. Please try again.",true); }
  finally { if(button) button.disabled=false; }
}
async function requireUser() {
  if(!supabaseClient) throw new Error("Could not load the account service. Refresh to try again.");
  const data=check(await supabaseClient.auth.getUser());
  if(!data.user) throw new Error("Please log in first 🐋");
  return data.user;
}
function clearImages(container) {
  container.querySelectorAll("img").forEach(img=>{if(imageUrls.has(img.src)){URL.revokeObjectURL(img.src);imageUrls.delete(img.src);}});
}
function clearPeek() {
  peekGeneration++;activePrivatePeek=null;clearInterval(privatePeekTimer);privatePeekTimer=null;
  clearImages($("peekContent"));$("peekContent").replaceChildren();delete $("peekContent").dataset.signature;
}
function showScreen(screen) {
  if(screen!=="peek") clearPeek();
  $("wallControls").hidden=screen!=="wall";
  ["wall","friendsScreen","profileScreen","peekScreen","signupScreen","loginScreen","resetScreen"].forEach(id=>{if($(id)) $(id).style.display="none";});
  const target=screen==="wall"?"wall":screen+"Screen"; if($(target)) $(target).style.display="block";
  $("intro").hidden=screen!=="wall"; $("captureButton").hidden=screen!=="wall";
  document.querySelectorAll("nav button").forEach(b=>b.classList.toggle("active",b.dataset.screen===screen));
  if(screen==="wall") action(async()=>{await loadMoments();if(currentWall==="private")await loadPrivateAccess();});
  if(screen==="friends") action(async()=>{await Promise.all([loadFriendRequests(),loadFriends(),loadSharedMomentRequests(),loadPrivateInvites()]);});
  if(screen==="profile") action(loadProfile);
}
function updateWordCount() {
  const input=$("momentCaption"); const value=Array.from(input.value).slice(0,15).join("");
  input.value=value; $("wordCount").textContent=Array.from(value).length;
}
async function compressPhoto(file) {
  if(!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if(file.size>20*1024*1024) throw new Error("Choose a photo smaller than 20 MB.");
  const url=URL.createObjectURL(file);
  try {
    const image=new Image();image.src=url;await image.decode();
    const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement("canvas");canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
    const context=canvas.getContext("2d");context.fillStyle="#fff";context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",0.82));
    if(!blob || blob.size>2*1024*1024) throw new Error("This photo is too large. Try a smaller image.");
    return blob;
  } catch(e) { if(e.name==="EncodingError") throw new Error("Your browser cannot open this image. Try a JPEG or PNG."); throw e; }
  finally {URL.revokeObjectURL(url);}
}
let photoSelection=0;
async function handlePhotoSelect(event) {
  const generation=++photoSelection; const file=event.target.files[0]; selectedPhoto=null;
  if(selectedPhotoUrl) URL.revokeObjectURL(selectedPhotoUrl); selectedPhotoUrl=null;$("photoPreview").replaceChildren();
  if(!file) return;
  $("pinButton").disabled=true;
  try { const blob=await compressPhoto(file); if(generation!==photoSelection) return;
    selectedPhoto=blob;selectedPhotoUrl=URL.createObjectURL(blob);
    const image=document.createElement("img");image.src=selectedPhotoUrl;image.alt="Photo preview";$("photoPreview").append(image);
  } finally {if(generation===photoSelection) $("pinButton").disabled=false;}
}
function openCapture() { action(async()=>{await requireUser();captureScope=currentWall;$("captureTitle").textContent=captureScope==="private"?"A private moment 🔒":"Capture a moment";$("captureShare").hidden=captureScope==="private";$("shareFriend").value="";$("capturePanel").classList.add("open");$("momentCaption").focus();updateWordCount();if(captureScope==="main")await loadShareFriends();}); }
function closeCapture() { $("capturePanel").classList.remove("open");$("captureButton").focus(); }
async function mediaRequest(path, options={}) {
  const session=check(await supabaseClient.auth.getSession()).session;
  if(!session) throw new Error("Please log in first.");
  const response=await fetch(MEDIA+path,{...options,headers:{...options.headers,Authorization:"Bearer "+session.access_token}});
  if(!response.ok) {let message="Photo service is unavailable.";try{message=(await response.json()).error || message;}catch{}throw new Error(message);}
  return response;
}
async function photoUrl(key) {
  const response=await mediaRequest("/photo/"+key);
  const url=URL.createObjectURL(await response.blob());imageUrls.add(url);return url;
}
async function saveMoment() {
  if(saving) return; saving=true;
  try {await action(async()=>{
    const user=await requireUser();const scope=captureScope;const friend=scope==="main"?$("shareFriend").value:"";const caption=$("momentCaption").value.trim();
    if(!selectedPhoto) throw new Error("Add a photo first 🐋");
    if(!caption || Array.from(caption).length>15) throw new Error("Add a caption of 1–15 characters.");
    const upload=await (await mediaRequest("/upload",{method:"PUT",body:selectedPhoto,headers:{"Content-Type":"image/jpeg"}})).json();
    const moment=check(await supabaseClient.from("moments").insert({user_id:user.id,wall_scope:scope,caption,photo_url:upload.key,position_x:5+Math.random()*35,position_y:5+Math.random()*40,rotation:Math.random()*12-6}).select().single());
    let message=scope==="private"?"Private moment saved 🔒":"Moment saved! 🐋";
    if(friend) {
      const result=await supabaseClient.from("shared_moments").insert({moment_id:moment.id,from_user_id:user.id,to_user_id:friend});
      if(result.error) message="Moment saved. Sharing failed — you can retry with Share on the card.";
    }
    selectedPhoto=null;if(selectedPhotoUrl) URL.revokeObjectURL(selectedPhotoUrl);selectedPhotoUrl=null;
    $("momentPhoto").value="";$("momentCaption").value="";$("photoPreview").replaceChildren();updateWordCount();closeCapture();notice(message);await loadMoments();
  },$("pinButton"));} finally {saving=false;}
}
function empty(container, message) { clearImages(container);container.replaceChildren();const p=document.createElement("p");p.className="wall-message";p.textContent=message;container.append(p); }
async function loadMoments() {
  const generation=++wallGeneration;const scope=currentWall;const wall=$("wall");
  const session=check(await supabaseClient.auth.getSession()).session;
  if(!session) {empty(wall,"Log in or sign up to start your wall 🐋");return;}
  const moments=check(await supabaseClient.from("moments").select("*").eq("user_id",session.user.id).eq("wall_scope",scope).is("deleted_at",null).order("created_at",{ascending:false}));
  if(generation!==wallGeneration) return;
  empty(wall,moments.length?"Loading your photos…":"Your first moment is waiting to be captured ✦");
  if(!moments.length) return;
  const cards=await Promise.all(moments.map(async m=>{try{return await makeCard(m,wall,true);}catch(e){return {error:e};}}));
  if(generation!==wallGeneration) {cards.forEach(c=>{if(c instanceof Element)clearImages(c);});return;}
  wall.replaceChildren();
  cards.forEach(c=>{if(c instanceof Element)wall.append(c);});
  if(cards.some(c=>c.error)) notice("Some photos could not load. Refresh your wall to try again.",true);
}
async function makeCard(moment,container,editable=false) {
  const card=document.createElement("div");card.className="polaroid";
  const img=document.createElement("img");img.alt=moment.caption;img.draggable=false;img.src=await photoUrl(moment.photo_url);
  const caption=document.createElement("div");caption.className="polaroid-caption";caption.textContent=moment.caption;
  card.append(img,caption);
  if(editable) {
    const remove=document.createElement("button");remove.className="trash";remove.textContent="×";remove.title="Hide moment";remove.setAttribute("aria-label","Hide "+moment.caption);
    remove.onclick=()=>action(async()=>{if(!confirm("Hide this moment from your wall?"))return;check(await supabaseClient.from("moments").update({deleted_at:new Date().toISOString()}).eq("id",moment.id).select("id").single());await loadMoments();},remove);
    const share=document.createElement("button");share.className="share-card";share.textContent="Share";share.onclick=()=>action(async()=>{const user=await requireUser();const username=prompt("Share with which friend's username?");if(!username)return;const friend=check(await supabaseClient.from("profiles").select("id").eq("username",username.trim().toLowerCase()).single());check(await supabaseClient.from("shared_moments").insert({moment_id:moment.id,from_user_id:user.id,to_user_id:friend.id}));notice("Moment shared 🐋");},share);
    card.append(remove);if(moment.wall_scope!=="private")card.append(share);card.style.left=moment.position_x+"%";card.style.top=moment.position_y+"%";card.style.transform="rotate("+moment.rotation+"deg)";enableDrag(card,container,moment);
  } else card.classList.add("peek-card");
  return card;
}
function enableDrag(card,wall,moment) {
  let drag=null;
  const clamp=()=>{const xMax=Math.max(0,(wall.clientWidth-card.offsetWidth-8)/wall.clientWidth*100);const yMax=Math.max(0,(wall.clientHeight-card.offsetHeight-8)/wall.clientHeight*100);card.style.left=Math.min(parseFloat(card.style.left),xMax)+"%";card.style.top=Math.min(parseFloat(card.style.top),yMax)+"%";};
  requestAnimationFrame(clamp);
  card.style.touchAction="none";
  card.onpointerdown=e=>{if(e.target.closest("button") || e.button!==0)return;e.preventDefault();drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:parseFloat(card.style.left),top:parseFloat(card.style.top)};card.setPointerCapture(e.pointerId);card.style.zIndex=9999;card.style.cursor="grabbing";};
  card.onpointermove=e=>{if(!drag || drag.id!==e.pointerId)return;const r=wall.getBoundingClientRect();const maxX=Math.max(0,100-(card.offsetWidth+8)/r.width*100);const maxY=Math.max(0,100-(card.offsetHeight+8)/r.height*100);card.style.left=Math.max(0,Math.min(maxX,drag.left+(e.clientX-drag.x)/r.width*100))+"%";card.style.top=Math.max(0,Math.min(maxY,drag.top+(e.clientY-drag.y)/r.height*100))+"%";};
  const end=e=>{if(!drag || e.pointerId!==drag.id)return;drag=null;card.style.cursor="grab";action(async()=>{check(await supabaseClient.from("moments").update({position_x:parseFloat(card.style.left),position_y:parseFloat(card.style.top)}).eq("id",moment.id).select("id").single());});};
  card.onpointerup=end;card.onpointercancel=end;
}
async function profileMap(ids) {if(!ids.length)return new Map();const rows=check(await supabaseClient.from("profiles").select("id,username").in("id",[...new Set(ids)]));return new Map(rows.map(p=>[p.id,p.username]));}
async function friendships() {const user=await requireUser();return {user,rows:check(await supabaseClient.from("friend_requests").select("*").or("sender_id.eq."+user.id+",receiver_id.eq."+user.id).eq("status","accepted"))};}
async function loadShareFriends() {
  const {user,rows}=await friendships();const ids=rows.map(r=>r.sender_id===user.id?r.receiver_id:r.sender_id);const profiles=await profileMap(ids);
  $("shareFriend").replaceChildren(new Option("Just me",""));ids.forEach(id=>$("shareFriend").add(new Option(profiles.get(id) || "Friend",id)));
}
async function loadProfile() {
  const session=check(await supabaseClient.auth.getSession()).session;
  $("accountStatus").textContent=session?"Logged in as "+session.user.email:"Create an account to keep your moments.";
  $("signedOutActions").hidden=!!session;$("logoutButton").hidden=!session;$("username").disabled=!session;$("saveUsernameButton").disabled=!session;
  if(session){const profile=check(await supabaseClient.from("profiles").select("username").eq("id",session.user.id).single());$("username").value=profile.username;}else $("username").value="";
}
async function saveUsername() {const user=await requireUser();const username=$("username").value.trim().toLowerCase();validateUsername(username);check(await supabaseClient.from("profiles").update({username}).eq("id",user.id).select("id").single());notice("Username saved 🐋");}
function validateUsername(username) {if(!/^[a-z0-9_]{3,24}$/.test(username))throw new Error("Use 3–24 letters, numbers, or underscores for your username.");}
async function signup() {
  const email=$("signupEmail").value.trim(),password=$("signupPassword").value,username=$("signupUsername").value.trim().toLowerCase();
  validateUsername(username);if(!email || password.length<8)throw new Error("Enter your email and a password of at least 8 characters.");
  const data=check(await supabaseClient.auth.signUp({email,password,options:{data:{username},emailRedirectTo:location.origin}}));
  $("signupPassword").value="";
  if(data.session){showScreen("wall");notice("Account created 🐋");}else{showScreen("login");notice("Check your email to confirm your account, then log in.");}
}
async function login() {
  const email=$("loginEmail").value.trim(),password=$("loginPassword").value;if(!email||!password)throw new Error("Enter your email and password.");
  check(await supabaseClient.auth.signInWithPassword({email,password}));$("loginPassword").value="";showScreen("wall");notice("Welcome back 🐋");
}
async function logout() {currentWall="main";updateWallControls();clearPeek();check(await supabaseClient.auth.signOut());wallGeneration++;clearImages($("wall"));clearImages($("peekContent"));empty($("wall"),"Log in to see your moments 🐋");showScreen("profile");notice("Logged out.");}
async function resetPassword() {const email=$("loginEmail").value.trim();if(!email)throw new Error("Enter your email first.");check(await supabaseClient.auth.resetPasswordForEmail(email,{redirectTo:location.origin}));notice("Check your email for a password reset link.");}
async function updatePassword() {const password=$("newPassword").value;if(password.length<8)throw new Error("Use at least 8 characters.");check(await supabaseClient.auth.updateUser({password}));$("newPassword").value="";showScreen("wall");notice("Password updated.");}
async function addFriend() {
  const user=await requireUser();const username=prompt("Enter your friend's username:");if(!username)return;
  const friend=check(await supabaseClient.from("profiles").select("id").eq("username",username.trim().toLowerCase()).maybeSingle());
  if(!friend)throw new Error("Couldn't find that username.");if(friend.id===user.id)throw new Error("That's your own username.");
  check(await supabaseClient.from("friend_requests").insert({sender_id:user.id,receiver_id:friend.id}));notice("Friend request sent 🐋");await loadFriendRequests();
}
function row(container,text,buttons=[]) {const box=document.createElement("div"),p=document.createElement("p");p.textContent=text;box.append(p);buttons.forEach(([label,task])=>{const b=document.createElement("button");b.textContent=label;b.onclick=()=>action(task,b);box.append(b);});container.append(box);}
async function loadFriendRequests() {
  const container=$("friendRequests");const session=check(await supabaseClient.auth.getSession()).session;if(!session){empty(container,"Please log in first.");return;}
  const rows=check(await supabaseClient.from("friend_requests").select("*").eq("receiver_id",session.user.id).eq("status","pending").order("created_at",{ascending:false}));
  const profiles=await profileMap(rows.map(r=>r.sender_id));container.replaceChildren();
  if(!rows.length)row(container,"No friend requests yet.");
  rows.forEach(r=>row(container,(profiles.get(r.sender_id)||"Someone")+" wants to be your friend.",[["Accept",()=>replyFriend(r.id,"accepted")],["Decline",()=>replyFriend(r.id,"declined")]]));
}
async function replyFriend(id,status) {check(await supabaseClient.from("friend_requests").update({status}).eq("id",id).select("id").single());await Promise.all([loadFriendRequests(),loadFriends()]);}
async function loadFriends() {
  const container=$("friendsList");const session=check(await supabaseClient.auth.getSession()).session;if(!session){empty(container,"Please log in first.");return;}
  const {user,rows}=await friendships();const ids=rows.map(r=>r.sender_id===user.id?r.receiver_id:r.sender_id);const profiles=await profileMap(ids);
  const peeks=check(await supabaseClient.from("wall_peeks").select("owner_id,expires_at").eq("viewer_id",user.id).gt("expires_at",new Date().toISOString()));const owners=new Set(peeks.map(p=>p.owner_id));
  container.replaceChildren();if(!ids.length)row(container,"No friends yet 🐋");
  ids.forEach(id=>row(container,profiles.get(id)||"Friend",owners.has(id)?[["👀 Peek",()=>openPeek(id,profiles.get(id))]]:[]));
  if(ids.length)row(container,"Accept a shared moment to unlock a 24-hour peek at your friend's wall.");
}
async function openPeek(id,username) {
  const user=await requireUser();const peeks=check(await supabaseClient.from("wall_peeks").select("expires_at").eq("owner_id",id).eq("viewer_id",user.id).gt("expires_at",new Date().toISOString()).limit(1));
  if(!peeks.length)throw new Error("This peek has expired. Accept a new shared moment to unlock it.");
  clearPeek();const generation=++peekGeneration;showScreen("peek");$("peekTitle").textContent=(username||"Friend")+"'s Wall 👀";
  const content=$("peekContent");empty(content,"Loading their wall…");
  const moments=check(await supabaseClient.from("moments").select("*").eq("user_id",id).eq("wall_scope","main").is("deleted_at",null).order("created_at",{ascending:false}).limit(10));
  if(!moments.length){empty(content,"No moments to peek at yet 🐋");return;}
  const cards=await Promise.all(moments.map(m=>makeCard(m,content)));if(generation!==peekGeneration){cards.forEach(clearImages);return;}content.replaceChildren(...cards);
}
function closePeek() {clearImages($("peekContent"));$("peekContent").replaceChildren();showScreen("friends");}
async function loadSharedMomentRequests() {
  const container=$("sharedMomentRequests");const session=check(await supabaseClient.auth.getSession()).session;if(!session){empty(container,"Please log in first.");return;}
  const rows=check(await supabaseClient.from("shared_moments").select("*").or("to_user_id.eq."+session.user.id+",from_user_id.eq."+session.user.id).order("created_at",{ascending:false}));
  const profiles=await profileMap(rows.flatMap(r=>[r.from_user_id,r.to_user_id]));container.replaceChildren();if(!rows.length)row(container,"No shared moments yet 🐋");
  rows.forEach(r=>{const incoming=r.to_user_id===session.user.id;const other=profiles.get(incoming?r.from_user_id:r.to_user_id)||"Friend";
    if(incoming && r.status==="pending")row(container,other+" shared a moment with you.",[["Accept",()=>replyShared(r.id,true)],["Decline",()=>replyShared(r.id,false)]]);
    else row(container,incoming?other+"'s shared moment: "+r.status:"Shared with "+other+": "+r.status);
  });
}
async function replyShared(id,accept) {check(await supabaseClient.rpc("reply_shared_moment",{request_id:id,accept}));notice(accept?"Shared moment pinned! Your 24-hour peek is open 🐋":"Shared moment declined.");await Promise.all([loadSharedMomentRequests(),loadFriends()]);}
document.addEventListener("DOMContentLoaded",()=>{
  if(!supabaseClient){notice("Account service failed to load. Refresh to try again.",true);return;}
  $("momentCaption").addEventListener("input",updateWordCount);
  $("momentPhoto").addEventListener("change",e=>action(()=>handlePhotoSelect(e)));
  for(const [id,handler] of [["privateInviteButton",invitePrivate],["saveUsernameButton",saveUsername],["signupButton",signup],["loginButton",login],["logoutButton",logout],["resetPasswordButton",resetPassword],["newPasswordButton",updatePassword]]) $(id).onclick=()=>action(handler,$(id));
  $("profileButton").onclick=()=>showScreen("profile");
  $("capturePanel").onclick=e=>{if(e.target===$("capturePanel"))closeCapture();};
  $("appNotice").onclick=()=>{$("appNotice").hidden=true;};
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeCapture();});
  supabaseClient.auth.onAuthStateChange((event)=>{
    // Defer API work to avoid the auth client's session lock.
    setTimeout(()=>{if(event==="PASSWORD_RECOVERY")showScreen("reset");else if(event==="SIGNED_OUT"){wallGeneration++;currentWall="main";updateWallControls();clearPeek();empty($("wall"),"Log in to see your moments 🐋");action(loadProfile);}},0);
  });
  document.addEventListener("visibilitychange",()=>{if(document.hidden && activePrivatePeek){clearImages($("peekContent"));$("peekContent").replaceChildren();delete $("peekContent").dataset.signature;peekGeneration++;}else if(activePrivatePeek)action(refreshPrivatePeek);});
  updateWallControls();action(async()=>{await loadProfile();await loadMoments();});
});
function updateWallControls() {
  $("mainWallTab").setAttribute("aria-pressed",currentWall==="main");
  $("privateWallTab").setAttribute("aria-pressed",currentWall==="private");
  $("privateControls").hidden=currentWall!=="private";
  $("wallTitle").textContent=currentWall==="private"?"my Private wall 🔒":"my Moments!";
}
function setWall(scope) {
  if(scope!=="main" && scope!=="private")return;
  currentWall=scope;wallGeneration++;empty($("wall"),"Loading your wall…");updateWallControls();
  action(async()=>{await loadMoments();if(scope==="private" && currentWall===scope)await loadPrivateAccess();});
}
async function loadPrivateAccess() {
  const session=check(await supabaseClient.auth.getSession()).session;
  $("privateFriend").replaceChildren(new Option("Choose a friend",""));
  const container=$("privateAccessList");container.replaceChildren();
  if(!session){row(container,"Log in to manage access.");return;}
  const {user,rows}=await friendships();const ids=rows.map(r=>r.sender_id===user.id?r.receiver_id:r.sender_id);
  const invites=check(await supabaseClient.from("private_wall_invites").select("*").eq("owner_id",user.id).is("revoked_at",null).gt("expires_at",new Date().toISOString()).order("expires_at",{ascending:false}));
  const names=await profileMap([...ids,...invites.map(i=>i.viewer_id)]);
  ids.forEach(id=>$("privateFriend").add(new Option(names.get(id)||"Friend",id)));
  const seen=new Set();
  invites.forEach(i=>{if(seen.has(i.viewer_id))return;seen.add(i.viewer_id);row(container,(names.get(i.viewer_id)||"Friend")+" can view until "+new Date(i.expires_at).toLocaleString(),[["Revoke access",async()=>{
    check(await supabaseClient.from("private_wall_invites").update({revoked_at:new Date().toISOString()}).eq("owner_id",user.id).eq("viewer_id",i.viewer_id).is("revoked_at",null));
    notice("Private wall access revoked.");await loadPrivateAccess();
  }]]);});
  if(!seen.size)row(container,"Only you can see this wall.");
}
async function invitePrivate() {
  const user=await requireUser();const viewer=$("privateFriend").value;
  if(!viewer)throw new Error("Choose a friend to invite.");
  check(await supabaseClient.from("private_wall_invites").insert({owner_id:user.id,viewer_id:viewer}));
  notice("Your friend can view your private wall for 24 hours 🔒");await loadPrivateAccess();
}
async function loadPrivateInvites() {
  const container=$("privateWallInvites");const session=check(await supabaseClient.auth.getSession()).session;
  if(!session){empty(container,"Please log in first.");return;}
  const invites=check(await supabaseClient.from("private_wall_invites").select("*").eq("viewer_id",session.user.id).is("revoked_at",null).gt("expires_at",new Date().toISOString()).order("expires_at",{ascending:false}));
  const names=await profileMap(invites.map(i=>i.owner_id));container.replaceChildren();const seen=new Set();
  invites.forEach(i=>{if(seen.has(i.owner_id))return;seen.add(i.owner_id);row(container,(names.get(i.owner_id)||"Friend")+" invited you until "+new Date(i.expires_at).toLocaleString(),[["🔒 View private wall",()=>openPrivatePeek(i.owner_id,names.get(i.owner_id))]]);});
  if(!seen.size)row(container,"No active private wall invitations.");
}
async function privatePermission(owner) {
  const user=await requireUser();
  const rows=check(await supabaseClient.from("private_wall_invites").select("expires_at").eq("owner_id",owner).eq("viewer_id",user.id).is("revoked_at",null).gt("expires_at",new Date().toISOString()).order("expires_at",{ascending:false}).limit(1));
  if(!rows.length)throw new Error("This private wall invitation has expired or been revoked.");
  return new Date(rows[0].expires_at).getTime();
}
async function openPrivatePeek(owner,username) {
  const expiry=await privatePermission(owner);clearPeek();showScreen("peek");
  activePrivatePeek={owner,username,expiry};
  $("peekTitle").textContent=(username||"Friend")+"'s Private wall 🔒";
  await refreshPrivatePeek();
  if(activePrivatePeek)privatePeekTimer=setInterval(()=>{
    if(Date.now()>=activePrivatePeek.expiry){clearPeek();notice("Private wall access has expired.");showScreen("friends");}
    else if(!document.hidden)action(refreshPrivatePeek);
  },15000);
}
async function refreshPrivatePeek() {
  const access=activePrivatePeek;if(!access)return;const generation=++peekGeneration;const content=$("peekContent");
  try {
    access.expiry=await privatePermission(access.owner);
    const moments=check(await supabaseClient.from("moments").select("*").eq("user_id",access.owner).eq("wall_scope","private").is("deleted_at",null).order("created_at",{ascending:false}));
    if(generation!==peekGeneration || activePrivatePeek!==access || document.hidden)return;
    // Recheck access regularly without downloading unchanged photos.
    const signature=JSON.stringify(moments.map(m=>[m.id,m.caption,m.photo_url]));
    if(content.dataset.signature===signature && content.children.length)return;
    empty(content,"Loading their private wall…");
    const cards=[];
    try {for(const m of moments)cards.push(await makeCard(m,content));await privatePermission(access.owner);}
    catch(error){cards.forEach(clearImages);throw error;}
    if(generation!==peekGeneration || activePrivatePeek!==access || document.hidden){cards.forEach(clearImages);return;}
    clearImages(content);content.replaceChildren(...cards);content.dataset.signature=signature;
    if(!cards.length)empty(content,"No private moments yet.");
  } catch(error) {
    if(generation===peekGeneration && activePrivatePeek===access){clearPeek();showScreen("friends");notice(error.message,true);}
  }
}
