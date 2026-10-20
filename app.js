const supabaseUrl = "https://vjugsidfdovuwtxgcvrz.supabase.co";
const supabaseKey = "sb_publishable_Q_HeljHf6jSNZm7nONcazw_JIlEZRVS";
const MEDIA = "https://narwhall-media.narwhall2026.workers.dev";
const supabaseClient = window.supabase?.createClient(supabaseUrl, supabaseKey);
let selectedPhoto = null, selectedPhotoUrl = null, saving = false, wallGeneration = 0;
let currentWall="main", captureScope="main", peekGeneration=0, activePrivatePeek=null, privatePeekTimer=null;
let memoryView=false, memoryWeek=startOfWeek(new Date()), memoryOffset=0;
const MEMORY_PAGE=24;
let wallNames={main:"My moments",private:"Locked wall"};
let wallColours={main:"dark",private:"dark"};
let wallStyles={main:{background:"plain",frame:"classic"},private:{background:"plain",frame:"classic"}};
const WALL_COLOURS={dark:"#13161d",cream:"#eee3cf",blush:"#e7c4cc",lavender:"#d4c9eb",sky:"#c4deed",sage:"#cadbc5"};
let communityAudience="everyone";
let currentScreen="wall", communityGeneration=0, communityLoading=false, communityCursor=null, communityHasMore=true;
const communitySeen=new Set();
const COMMUNITY_PAGE=20;
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
  closeWallSnake();closeWallBounce();
  clearAdminReview();
  if(currentScreen==="community" && screen!=="community")clearCommunity();
  currentScreen=screen;document.body.dataset.screen=screen;
  $("photoWallFrame").hidden=screen!=="wall";
  if(screen!=="peek") clearPeek();
  $("wallControls").hidden=screen!=="wall";
  $("wallBrowseControls").hidden=screen!=="wall";
  $("privateControls").hidden=screen!=="wall" || currentWall!=="private";
  $("moreMemoriesButton").hidden=true;
  ["wall","adminScreen","communityScreen","friendsScreen","profileScreen","peekScreen","signupScreen","loginScreen","resetScreen"].forEach(id=>{if($(id)) $(id).style.display="none";});
  const target=screen==="wall"?"wall":screen+"Screen"; if($(target)) $(target).style.display="block";
  $("intro").hidden=screen!=="wall"; $("captureButton").hidden=screen!=="wall";
  document.querySelectorAll("[data-screen]").forEach(b=>b.classList.toggle("active",b.dataset.screen===screen));
  $("communityButton").setAttribute("aria-pressed",screen==="community");
  if(screen==="wall") action(async()=>{await loadMoments();if(currentWall==="private")await loadPrivateAccess();});
  if(screen==="friends") action(async()=>{await Promise.all([loadFriendRequests(),loadFriends(),loadSharedMomentRequests(),loadPrivateInvites()]);});
  if(screen==="profile") action(loadProfile);
  if(screen==="admin")action(()=>loadAdminAccounts());
  if(screen==="community")action(()=>loadCommunity(true));
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
  updateCapturePreview();
  if(!file) return;
  $("pinButton").disabled=true;
  try { const blob=await compressPhoto(file); if(generation!==photoSelection) return;
    selectedPhoto=blob;selectedPhotoUrl=URL.createObjectURL(blob);
    const image=document.createElement("img");image.src=selectedPhotoUrl;image.alt="Photo preview";$("photoPreview").replaceChildren(image);updateCapturePreview();
  } finally {if(generation===photoSelection) $("pinButton").disabled=!selectedPhoto;}
}
function openCapture(scope=currentWall) { closeWallSnake();closeWallBounce(); action(async()=>{await requireUser();
  if(!["main","private","community"].includes(scope))return;
  if(captureScope!==scope){photoSelection++;selectedPhoto=null;if(selectedPhotoUrl)URL.revokeObjectURL(selectedPhotoUrl);selectedPhotoUrl=null;$("momentPhoto").value="";$("momentCaption").value="";}
  captureScope=scope;$("captureTitle").textContent=captureScope==="community"?"Post to Community 🌍":captureScope==="private"?"A locked-wall moment 🔒":"Capture a moment";$("captureShare").hidden=captureScope!=="main";$("shareFriend").value="";$("capturePanel").classList.add("open");document.body.classList.add("capture-open");updateVisibleHeight();updateCapturePreview();if(selectedPhoto)$("momentCaption").focus();else $("choosePhotoButton").focus();updateWordCount();if(captureScope==="main")await loadShareFriends();}); }
function closeCapture() { document.body.classList.remove("capture-open");$("capturePanel").classList.remove("open");(captureScope==="community"?$("communityCaptureButton"):$("captureButton")).focus(); }
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
    let moment;
    if(scope==="community") check(await supabaseClient.from("community_posts").insert({user_id:user.id,caption,photo_url:upload.key}));
    else moment=check(await supabaseClient.from("moments").insert({user_id:user.id,wall_scope:scope,caption,photo_url:upload.key,position_x:5+Math.random()*35,position_y:5+Math.random()*40,rotation:Math.random()*12-6}).select().single());
    let message=scope==="community"?(communityAudience==="friends"?"Posted publicly. Switch to Everyone to see your moment.":"Posted to the Community wall 🌍"):scope==="private"?"Locked-wall moment saved 🔒":"Moment saved! 🐋";
    if(friend) {
      const result=await supabaseClient.from("shared_moments").insert({moment_id:moment.id,from_user_id:user.id,to_user_id:friend});
      if(result.error) message="Moment saved. Sharing failed — you can retry with Share on the card.";
    }
    selectedPhoto=null;if(selectedPhotoUrl) URL.revokeObjectURL(selectedPhotoUrl);selectedPhotoUrl=null;
    $("momentPhoto").value="";$("momentCaption").value="";$("photoPreview").replaceChildren();updateWordCount();updateCapturePreview();closeCapture();notice(message);if(scope==="community"){if(currentScreen==="community")await loadCommunity(true);}else await loadMoments();
  },$("pinButton"));} finally {saving=false;updateCapturePreview();}
}
function empty(container, message) { clearImages(container);container.replaceChildren();const p=document.createElement("p");p.className="wall-message";p.textContent=message;container.append(p); }
async function loadMoments(append=false) {
  const generation=++wallGeneration;const scope=currentWall;const archive=memoryView;const wall=$("wall");
  $("moreMemoriesButton").hidden=true;wall.classList.toggle("memory-grid",archive);updateMemoryControls();
  const session=check(await supabaseClient.auth.getSession()).session;
  if(generation!==wallGeneration)return;
  if(!session) {empty(wall,"Log in or sign up to start your wall 🐋");return;}
  await loadWallNames(session.user.id);if(generation!==wallGeneration)return;
  if(!append)memoryOffset=0;
  let query=supabaseClient.from("moments").select("*").eq("user_id",session.user.id).eq("wall_scope",scope).is("deleted_at",null).order("created_at",{ascending:false}).order("id",{ascending:false});
  if(archive){const end=new Date(memoryWeek);end.setDate(end.getDate()+7);query=query.gte("created_at",memoryWeek.toISOString()).lt("created_at",end.toISOString()).range(memoryOffset,memoryOffset+MEMORY_PAGE);}
  else query=query.limit(10);
  const result=check(await query);
  if(generation!==wallGeneration) return;
  const hasMore=archive && result.length>MEMORY_PAGE;const moments=hasMore?result.slice(0,MEMORY_PAGE):result;
  if(!append)empty(wall,moments.length?"Loading your photos…":archive?"No moments this week. Try an older week or choose a date.":"Your first moment is waiting to be captured ✦");
  if(!moments.length)return;
  const cards=await Promise.all(moments.map(async m=>{try{
    const card=await makeCard(m,wall,!archive);
    if(archive){const date=document.createElement("time");date.dateTime=m.created_at;date.textContent=new Date(m.created_at).toLocaleString();card.append(date);}
    return card;
  }catch(e){return {error:e};}}));
  if(generation!==wallGeneration) {cards.forEach(c=>{if(c instanceof Element)clearImages(c);});return;}
  if(!append)wall.replaceChildren();
  cards.forEach((c,index)=>{if(c instanceof Element){if(!archive)c.style.zIndex=String(10-index);wall.append(c);}});fitWallCards(wall);memoryOffset+=moments.length;
  $("moreMemoriesButton").hidden=!hasMore;
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
  } else {card.classList.add("peek-card");if(container.id==="peekContent"){card.style.left=moment.position_x+"%";card.style.top=moment.position_y+"%";card.style.transform="rotate("+moment.rotation+"deg)";}}
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
  $("adminAreaButton").hidden=true;
  if(session)$("adminAreaButton").hidden=!check(await supabaseClient.rpc("is_narwhall_admin"));
  await loadCommunityBlocks();
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
async function logout() {clearAdminReview();$("adminAreaButton").hidden=true;clearCommunity();wallStyles={main:{background:"plain",frame:"classic"},private:{background:"plain",frame:"classic"}};wallColours={main:"dark",private:"dark"};wallNames={main:"My moments",private:"Locked wall"};currentWall="main";memoryView=false;updateMemoryControls();updateWallControls();clearPeek();check(await supabaseClient.auth.signOut());wallGeneration++;clearImages($("wall"));clearImages($("peekContent"));empty($("wall"),"Log in to see your moments 🐋");showScreen("profile");notice("Logged out.");}
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
  if(ids.length)row(container,"When a shared moment is accepted and pinned to both walls, you both get a 24-hour peek.");
}
async function openPeek(id,username) {
  const user=await requireUser();const peeks=check(await supabaseClient.from("wall_peeks").select("expires_at").eq("owner_id",id).eq("viewer_id",user.id).gt("expires_at",new Date().toISOString()).limit(1));
  if(!peeks.length)throw new Error("This peek has expired. Accept a new shared moment to unlock it.");
  const title=await readWallName(id,"main");clearPeek();const generation=++peekGeneration;showScreen("peek");$("peekTitle").textContent=(username||"Friend")+" · "+title+" 👀";
  const content=$("peekContent");empty(content,"Loading their wall…");
  const moments=check(await supabaseClient.from("moments").select("*").eq("user_id",id).eq("wall_scope","main").is("deleted_at",null).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(10));
  if(!moments.length){empty(content,"No moments to peek at yet 🐋");return;}
  const cards=await Promise.all(moments.map(m=>makeCard(m,content)));if(generation!==peekGeneration){cards.forEach(clearImages);return;}content.replaceChildren(...cards);fitWallCards(content);
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
async function replyShared(id,accept) {check(await supabaseClient.rpc("reply_shared_moment",{request_id:id,accept}));notice(accept?"Shared moment pinned! Both of your 24-hour peeks are open 🐋":"Shared moment declined.");await Promise.all([loadSharedMomentRequests(),loadFriends()]);}
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
    setTimeout(()=>{if(event==="PASSWORD_RECOVERY")showScreen("reset");else if(event==="SIGNED_OUT"){clearAdminReview();$("adminAreaButton").hidden=true;clearCommunity();wallStyles={main:{background:"plain",frame:"classic"},private:{background:"plain",frame:"classic"}};wallColours={main:"dark",private:"dark"};wallGeneration++;wallNames={main:"My moments",private:"Locked wall"};currentWall="main";memoryView=false;updateMemoryControls();updateWallControls();clearPeek();empty($("wall"),"Log in to see your moments 🐋");action(loadProfile);}},0);
  });
  document.addEventListener("visibilitychange",()=>{if(document.hidden && activePrivatePeek){clearImages($("peekContent"));$("peekContent").replaceChildren();delete $("peekContent").dataset.signature;peekGeneration++;}else if(activePrivatePeek)action(refreshPrivatePeek);});
  $("memoryDate").onchange=()=>{const date=new Date($("memoryDate").value+"T12:00:00");if(!Number.isNaN(date.getTime()) && $("memoryDate").value<=localDate(new Date())){memoryWeek=startOfWeek(date);action(loadMoments);}else updateMemoryControls();};
  if("IntersectionObserver" in window){const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting) && currentScreen==="community" && communityHasMore && !communityLoading)action(()=>loadCommunity(false));},{rootMargin:"350px"});observer.observe($("communitySentinel"));}
  window.addEventListener("resize",()=>{updateVisibleHeight();requestAnimationFrame(()=>{fitWallCards($("wall"));fitWallCards($("peekContent"));});});
  window.visualViewport?.addEventListener("resize",updateVisibleHeight);
  updateVisibleHeight();updateMemoryControls();updateWallControls();action(async()=>{await loadProfile();await loadMoments();});
});
function updateWallControls() {
  applyWallColour($("wall"),wallColours[currentWall],wallStyles[currentWall]);$("wallColour").value=wallColours[currentWall];$("wallBackground").value=wallStyles[currentWall].background;$("wallFrame").value=wallStyles[currentWall].frame;
  $("mainWallTab").textContent=wallNames.main;$("privateWallTab").textContent="🔒 "+wallNames.private;
  $("mainWallTab").setAttribute("aria-pressed",currentWall==="main");
  $("privateWallTab").setAttribute("aria-pressed",currentWall==="private");
  $("privateControls").hidden=currentScreen!=="wall" || currentWall!=="private";
}
function setWall(scope) {
  closeWallSnake();closeWallBounce();
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
    notice("Locked wall access revoked.");await loadPrivateAccess();
  }]]);});
  if(!seen.size)row(container,"Only you can see this wall.");
}
async function invitePrivate() {
  const user=await requireUser();const viewer=$("privateFriend").value;
  if(!viewer)throw new Error("Choose a friend to invite.");
  check(await supabaseClient.from("private_wall_invites").insert({owner_id:user.id,viewer_id:viewer}));
  notice("Your friend can view your locked wall for 24 hours 🔒");await loadPrivateAccess();
}
async function loadPrivateInvites() {
  const container=$("privateWallInvites");const session=check(await supabaseClient.auth.getSession()).session;
  if(!session){empty(container,"Please log in first.");return;}
  const invites=check(await supabaseClient.from("private_wall_invites").select("*").eq("viewer_id",session.user.id).is("revoked_at",null).gt("expires_at",new Date().toISOString()).order("expires_at",{ascending:false}));
  const names=await profileMap(invites.map(i=>i.owner_id));container.replaceChildren();const seen=new Set();
  invites.forEach(i=>{if(seen.has(i.owner_id))return;seen.add(i.owner_id);row(container,(names.get(i.owner_id)||"Friend")+" invited you until "+new Date(i.expires_at).toLocaleString(),[["🔒 View locked wall",()=>openPrivatePeek(i.owner_id,names.get(i.owner_id))]]);});
  if(!seen.size)row(container,"No active locked wall invitations.");
}
async function privatePermission(owner) {
  const user=await requireUser();
  const rows=check(await supabaseClient.from("private_wall_invites").select("expires_at").eq("owner_id",owner).eq("viewer_id",user.id).is("revoked_at",null).gt("expires_at",new Date().toISOString()).order("expires_at",{ascending:false}).limit(1));
  if(!rows.length)throw new Error("This locked wall invitation has expired or been revoked.");
  return new Date(rows[0].expires_at).getTime();
}
async function openPrivatePeek(owner,username) {
  const expiry=await privatePermission(owner);const title=await readWallName(owner,"private");clearPeek();showScreen("peek");
  activePrivatePeek={owner,username,expiry};
  $("peekTitle").textContent=(username||"Friend")+" · "+title+" 🔒";
  await refreshPrivatePeek();
  if(activePrivatePeek)privatePeekTimer=setInterval(()=>{
    if(Date.now()>=activePrivatePeek.expiry){clearPeek();notice("Locked wall access has expired.");showScreen("friends");}
    else if(!document.hidden)action(refreshPrivatePeek);
  },15000);
}
async function refreshPrivatePeek() {
  const access=activePrivatePeek;if(!access)return;const generation=++peekGeneration;const content=$("peekContent");
  try {
    access.expiry=await privatePermission(access.owner);
    const moments=check(await supabaseClient.from("moments").select("*").eq("user_id",access.owner).eq("wall_scope","private").is("deleted_at",null).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(10));
    if(generation!==peekGeneration || activePrivatePeek!==access || document.hidden)return;
    // Recheck access regularly without downloading unchanged photos.
    const signature=JSON.stringify(moments.map(m=>[m.id,m.caption,m.photo_url]));
    if(content.dataset.signature===signature && content.children.length)return;
    empty(content,"Loading their locked wall…");
    const cards=[];
    try {for(const m of moments)cards.push(await makeCard(m,content));await privatePermission(access.owner);}
    catch(error){cards.forEach(clearImages);throw error;}
    if(generation!==peekGeneration || activePrivatePeek!==access || document.hidden){cards.forEach(clearImages);return;}
    clearImages(content);content.replaceChildren(...cards);fitWallCards(content);content.dataset.signature=signature;
    if(!cards.length)empty(content,"No private moments yet.");
  } catch(error) {
    if(generation===peekGeneration && activePrivatePeek===access){clearPeek();showScreen("friends");notice(error.message,true);}
  }
}

function startOfWeek(date) {
  const result=new Date(date);result.setHours(0,0,0,0);result.setDate(result.getDate()-((result.getDay()+6)%7));return result;
}
function localDate(date){return [date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("-");}
function updateMemoryControls() {
  $("memoryControls").hidden=!memoryView;
  $("recentTab").setAttribute("aria-pressed",!memoryView);$("memoriesTab").setAttribute("aria-pressed",memoryView);
  $("wallViewHint").textContent=memoryView?"Your memories, week by week. Only you can browse your full history.":"Your newest 10 moments. Older photos stay in Memories.";
  $("memoryDate").max=localDate(new Date());$("memoryDate").value=localDate(memoryWeek);
  const end=new Date(memoryWeek);end.setDate(end.getDate()+6);
  $("memoryWeekLabel").textContent=memoryWeek.toLocaleDateString()+" – "+end.toLocaleDateString();
  $("newerWeekButton").disabled=memoryWeek>=startOfWeek(new Date());
}
function setMemoryView(value){closeWallSnake();closeWallBounce();memoryView=!!value;wallGeneration++;empty($("wall"),"Loading your moments…");updateMemoryControls();action(loadMoments);}
function moveMemoryWeek(direction){const next=new Date(memoryWeek);next.setDate(next.getDate()+direction*7);if(next>startOfWeek(new Date()))return;memoryWeek=next;action(loadMoments);}

function chooseCapturePhoto() {
  if(saving)return;
  $("momentPhoto").value="";$("momentPhoto").click();
}
function updateCapturePreview() {
  const hasPhoto=!!selectedPhoto;
  $("capturePanel").classList.toggle("has-photo",hasPhoto);
  $("retakeButton").textContent=hasPhoto?"Retake":"Choose photo";
  $("retakeButton").disabled=saving;
  $("pinButton").disabled=!hasPhoto || saving;
  $("pinButton").textContent=captureScope==="community"?"Post publicly":"Pin";
  $("captureHint").textContent=captureScope==="community"?"Everyone logged in can see this photo and your username.":captureScope==="private"?"This moment goes on your locked wall 🔒":"Pick a photo, add a little caption, then pin it.";
  if(!hasPhoto){
    const button=document.createElement("button");button.id="choosePhotoButton";button.className="choose-photo";button.textContent="📷 Choose a photo";button.onclick=chooseCapturePhoto;
    $("photoPreview").replaceChildren(button);
  }
}

async function loadWallNames(userId) {
  const rows=check(await supabaseClient.from("wall_names").select("wall_scope,name,colour,background_style,frame_style").eq("user_id",userId));
  const session=check(await supabaseClient.auth.getSession()).session;if(session?.user.id!==userId)return;
  wallNames={main:"My moments",private:"Locked wall"};wallColours={main:"dark",private:"dark"};wallStyles={main:{background:"plain",frame:"classic"},private:{background:"plain",frame:"classic"}};rows.forEach(r=>{wallNames[r.wall_scope]=r.name;wallColours[r.wall_scope]=r.colour || "dark";wallStyles[r.wall_scope]={background:r.background_style || "plain",frame:r.frame_style || "classic"};});updateWallControls();
}
async function readWallName(userId,scope) {
  const data=check(await supabaseClient.from("wall_names").select("name,colour,background_style,frame_style").eq("user_id",userId).eq("wall_scope",scope).maybeSingle());
  applyWallColour($("peekContent"),data?.colour || "dark",{background:data?.background_style || "plain",frame:data?.frame_style || "classic"});
  return data?.name || (scope==="private"?"Locked wall":"My moments");
}
async function renameWall() {
  const user=await requireUser();const scope=currentWall;
  const input=prompt("Name this wall (up to 30 characters):",wallNames[scope]);if(input===null)return;
  const name=input.trim();if(!name || Array.from(name).length>30)throw new Error("Choose a wall name of 1–30 characters.");
  const existing=check(await supabaseClient.from("wall_names").select("name").eq("user_id",user.id).eq("wall_scope",scope).maybeSingle());
  if(existing)check(await supabaseClient.from("wall_names").update({name}).eq("user_id",user.id).eq("wall_scope",scope).select("name").single());
  else check(await supabaseClient.from("wall_names").insert({user_id:user.id,wall_scope:scope,name}));
  wallNames[scope]=name;updateWallControls();notice("Wall renamed 🐋");
}


function applyWallColour(container,colour,style={background:"plain",frame:"classic"}) {
  container.dataset.background=["plain","cork","paper","dots"].includes(style.background)?style.background:"plain";container.dataset.frame=["classic","cream","wood","pastel","neon"].includes(style.frame)?style.frame:"classic";
  const chosen=Object.hasOwn(WALL_COLOURS,colour)?colour:"dark";
  container.style.backgroundColor=WALL_COLOURS[chosen];container.classList.toggle("light-wall",chosen!=="dark" || style.background==="cork");
}
async function saveWallColour() {
  const scope=currentWall;const colour=$("wallColour").value;const background_style=$("wallBackground").value,frame_style=$("wallFrame").value;
  try {
    const user=await requireUser();if(!Object.hasOwn(WALL_COLOURS,colour))throw new Error("Choose a wall colour.");
    if(!["plain","cork","paper","dots"].includes(background_style)||!["classic","cream","wood","pastel","neon"].includes(frame_style))throw new Error("Choose a background and frame.");
    const existing=check(await supabaseClient.from("wall_names").select("name").eq("user_id",user.id).eq("wall_scope",scope).maybeSingle());
    if(existing)check(await supabaseClient.from("wall_names").update({colour,background_style,frame_style}).eq("user_id",user.id).eq("wall_scope",scope).select("colour").single());
    else check(await supabaseClient.from("wall_names").insert({user_id:user.id,wall_scope:scope,name:wallNames[scope],colour,background_style,frame_style}));
    wallColours[scope]=colour;wallStyles[scope]={background:background_style,frame:frame_style};updateWallControls();notice("Wall style saved 🎨");
  }catch(error){$("wallColour").value=wallColours[currentWall];throw error;}
}


function clearCommunity() {
  communityGeneration++;communityLoading=false;communityCursor=null;communityHasMore=true;communitySeen.clear();
  clearImages($("communityWall"));$("communityWall").replaceChildren();$("communityMoreButton").hidden=true;$("communityStatus").textContent="";
}
async function setCommunityAudience(audience) {
  if(!["everyone","friends"].includes(audience) || audience===communityAudience)return;
  communityAudience=audience;
  $("communityEveryone").setAttribute("aria-pressed",String(audience==="everyone"));
  $("communityFriends").setAttribute("aria-pressed",String(audience==="friends"));
  await action(()=>loadCommunity(true));
}
async function loadCommunity(reset=true) {
  if(currentScreen!=="community")return;
  if(reset)clearCommunity();
  if(communityLoading || !communityHasMore)return;
  const generation=communityGeneration;communityLoading=true;$("communityMoreButton").hidden=true;$("communityStatus").textContent="Loading moments…";
  try {
    const session=check(await supabaseClient.auth.getSession()).session;
    if(generation!==communityGeneration)return;
    if(!session){communityHasMore=false;empty($("communityWall"),"Log in to explore and post to the Community wall 🌍");$("communityStatus").textContent="";return;}
    let friendIds=null;
    if(communityAudience==="friends"){
      const {user,rows}=await friendships();
      if(generation!==communityGeneration)return;
      friendIds=[...new Set(rows.map(r=>r.sender_id===user.id?r.receiver_id:r.sender_id))];
      if(!friendIds.length){communityHasMore=false;empty($("communityWall"),"Add friends to see their public moments here. Everyone still shows the whole Community wall 🌍");$("communityStatus").textContent="";return;}
    }
    let query=supabaseClient.from("community_posts").select("id,user_id,caption,photo_url,created_at").is("deleted_at",null).is("removed_at",null).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(COMMUNITY_PAGE+1);
    if(friendIds)query=query.in("user_id",friendIds);
    if(communityCursor)query=query.or("created_at.lt."+communityCursor.created_at+",and(created_at.eq."+communityCursor.created_at+",id.lt."+communityCursor.id+")");
    const result=check(await query);if(generation!==communityGeneration)return;
    const posts=result.slice(0,COMMUNITY_PAGE);communityHasMore=result.length>COMMUNITY_PAGE;
    const names=await profileMap(posts.map(p=>p.user_id));
    if(generation!==communityGeneration)return;
    const cards=await Promise.all(posts.filter(p=>!communitySeen.has(p.id)).map(p=>makeCommunityCard(p,names.get(p.user_id)||"Member",session.user.id)));
    if(generation!==communityGeneration){cards.forEach(clearImages);return;}
    const wall=$("communityWall");if(!communitySeen.size)wall.replaceChildren();
    cards.forEach(card=>wall.append(card));posts.forEach(p=>communitySeen.add(p.id));
    if(posts.length)communityCursor={created_at:posts.at(-1).created_at,id:posts.at(-1).id};
    if(!communitySeen.size)empty(wall,communityAudience==="friends"?"Your friends haven’t posted any public moments yet.":"Be the first to pin a Community moment 🌍");
    $("communityStatus").textContent=communityHasMore?"Keep scrolling for more moments…":communitySeen.size?"You're all caught up. More moments will appear as people post.":"";
    $("communityMoreButton").hidden=!communityHasMore;
  } catch(error) {
    if(generation===communityGeneration){communityHasMore=true;$("communityStatus").textContent="Couldn't load moments. Tap below to try again.";$("communityMoreButton").hidden=false;throw error;}
  } finally {
    if(generation===communityGeneration){communityLoading=false;
      if(currentScreen==="community" && communityHasMore && $("communitySentinel").getBoundingClientRect().top<window.innerHeight+350 && $("communityStatus").textContent.startsWith("Keep scrolling"))setTimeout(()=>action(()=>loadCommunity(false)),100);
    }
  }
}
async function makeCommunityCard(post,username,userId) {
  const card=document.createElement("article");card.className="community-card";card.dataset.postId=post.id;
  card.style.setProperty("--card-tilt",((parseInt(post.id.slice(-2),16)%7)-3)+"deg");
  const img=document.createElement("img");img.alt=post.caption;img.decoding="async";
  try{img.src=await photoUrl(post.photo_url);card.append(img);}catch{const missing=document.createElement("div");missing.className="community-photo-error";missing.textContent="Photo couldn't load. Refresh to try again.";card.append(missing);}
  const caption=document.createElement("p");caption.className="community-caption";caption.textContent=post.caption;
  const author=document.createElement("p");author.className="community-author";author.textContent="@"+username;
  const date=document.createElement("time");date.dateTime=post.created_at;date.textContent=new Date(post.created_at).toLocaleString();
  const controls=document.createElement("div");controls.className="community-card-actions";
  const add=(label,task)=>{const b=document.createElement("button");b.textContent=label;b.onclick=()=>action(task,b);controls.append(b);};
  if(post.user_id===userId)add("Remove",async()=>{
    if(!confirm("Remove this photo from the Community wall?"))return;
    check(await supabaseClient.from("community_posts").update({deleted_at:new Date().toISOString()}).eq("id",post.id).eq("user_id",userId));
    notice("Community photo removed.");await loadCommunity(true);
  });
  else {
    add("Report",()=>reportCommunityPost(post));
    add("Block",async()=>{
      if(!confirm("Block @"+username+" on Community? You won't see each other's Community posts."))return;
      const user=await requireUser();const result=await supabaseClient.from("community_blocks").insert({blocker_id:user.id,blocked_id:post.user_id});
      if(result.error && result.error.code!=="23505")throw result.error;
      notice("Account blocked on Community. Manage blocks in Profile.");await loadCommunity(true);
    });
  }
  card.append(caption,author,date,controls);return card;
}
async function reportCommunityPost(post) {
  const reason=prompt("Why are you reporting this photo?\n1 · Spam\n2 · Harassment\n3 · Inappropriate content\n4 · Other\nEnter 1, 2, 3 or 4:");if(reason===null)return;
  const reasons={1:"spam",2:"harassment",3:"inappropriate",4:"other"};const selected=reasons[reason.trim()];if(!selected)throw new Error("Choose a report reason from 1 to 4.");
  const user=await requireUser();const result=await supabaseClient.from("community_reports").insert({post_id:post.id,reporter_id:user.id,reason:selected});
  if(result.error?.code==="23505"){notice("You've already reported this photo.");return;}check(result);notice("Report received for review. Thank you.");
}
async function loadCommunityBlocks() {
  const container=$("communityBlockedList");const session=check(await supabaseClient.auth.getSession()).session;container.replaceChildren();
  if(!session){row(container,"Log in to manage blocked accounts.");return;}
  const blocks=check(await supabaseClient.from("community_blocks").select("blocked_id").eq("blocker_id",session.user.id));
  const names=await profileMap(blocks.map(b=>b.blocked_id));if(!blocks.length)row(container,"No blocked Community accounts.");
  blocks.forEach(b=>row(container,"@"+(names.get(b.blocked_id)||"Member"),[["Unblock",async()=>{check(await supabaseClient.from("community_blocks").delete().eq("blocker_id",session.user.id).eq("blocked_id",b.blocked_id));await loadCommunityBlocks();notice("Account unblocked on Community.");}]]));
}


function updateVisibleHeight() {
  document.documentElement.style.setProperty("--visible-height",Math.round(window.visualViewport?.height || window.innerHeight)+"px");
}
function fitWallCards(container) {
  if(container.classList.contains("memory-grid") || !container.clientWidth || !container.clientHeight)return;
  container.querySelectorAll(".polaroid").forEach(card=>{
    const maxX=Math.max(0,100-(card.offsetWidth+12)/container.clientWidth*100);
    const maxY=Math.max(0,100-(card.offsetHeight+12)/container.clientHeight*100);
    card.style.left=Math.max(2,Math.min(maxX,parseFloat(card.style.left)||0))+"%";
    card.style.top=Math.max(2,Math.min(maxY,parseFloat(card.style.top)||0))+"%";
  });
}


// Local, optional game: the existing wall stays behind this transparent canvas.
let wallSnakeState=null, wallSnakeTimer=null, wallSnakeReturnFocus=null;
const SNAKE_DIRS={up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}};
function newWallSnake(){
  return {body:[{x:7,y:10},{x:6,y:10},{x:5,y:10}],direction:SNAKE_DIRS.right,next:SNAKE_DIRS.right,food:{x:14,y:10},score:0,running:false,over:false,turned:false};
}
function placeSnakeFood(state){
  const free=[];
  for(let y=0;y<20;y++)for(let x=0;x<20;x++)if(!state.body.some(p=>p.x===x&&p.y===y))free.push({x,y});
  return free.length?free[Math.floor(Math.random()*free.length)]:null;
}
function snakeTurn(name){
  const s=wallSnakeState,d=SNAKE_DIRS[name];if(!s || !s.running || !d || s.turned)return;
  if(d.x===-s.direction.x && d.y===-s.direction.y)return;
  s.next=d;s.turned=true;
}
function snakeStep(s){
  s.direction=s.next;s.turned=false;
  const head={x:s.body[0].x+s.direction.x,y:s.body[0].y+s.direction.y};
  const eats=head.x===s.food.x&&head.y===s.food.y;
  const obstacles=eats?s.body:s.body.slice(0,-1);
  if(head.x<0||head.x>=20||head.y<0||head.y>=20||obstacles.some(p=>p.x===head.x&&p.y===head.y)){s.running=false;s.over=true;return;}
  s.body.unshift(head);
  if(eats){s.score++;s.food=placeSnakeFood(s);if(!s.food){s.running=false;s.over=true;}}
  else s.body.pop();
}
function drawWallSnake(){
  const s=wallSnakeState;if(!s)return;
  const canvas=$("snakeCanvas"),ctx=canvas.getContext("2d"),size=600;
  if(canvas.width!==size){canvas.width=size;canvas.height=size;}
  ctx.clearRect(0,0,size,size);
  ctx.strokeStyle="#ffffff12";ctx.lineWidth=1;
  for(let i=1;i<20;i++){ctx.beginPath();ctx.moveTo(i*30,0);ctx.lineTo(i*30,600);ctx.moveTo(0,i*30);ctx.lineTo(600,i*30);ctx.stroke();}
  s.body.forEach((p,i)=>{ctx.fillStyle=i?"#93f5bd":"#f4ffe8";ctx.shadowColor="#10251c";ctx.shadowBlur=5;ctx.fillRect(p.x*30+2,p.y*30+2,26,26);});ctx.shadowBlur=0;
  if(s.food){ctx.fillStyle="#ff899d";ctx.beginPath();ctx.arc(s.food.x*30+15,s.food.y*30+15,10,0,Math.PI*2);ctx.fill();}
  $("snakeScore").textContent=s.score;
  $("snakePause").textContent=s.over?"Play again":s.running?"Pause":s.score||s.body[0].x!==7||s.body[0].y!==10?"Resume":"Start";
  $("snakeStatus").textContent=s.over?(s.food?"Game over! Try again.":"You filled the wall!"):s.running?"Swipe, tap arrows, or use arrow keys / WASD.":"Tap Start or Resume. Space pauses the game.";
}
function toggleWallSnake(){
  if(!wallSnakeState)return;
  if(wallSnakeState.over)wallSnakeState=newWallSnake();
  wallSnakeState.running=!wallSnakeState.running;drawWallSnake();
}
function openWallSnake(){
  closeWallBounce();$("wallGameMenu").open=false;
  if(wallSnakeState)return;
  wallSnakeReturnFocus=document.activeElement;wallSnakeState=newWallSnake();$("wallSnake").hidden=false;
  $("wallSnake").scrollIntoView({block:"nearest",behavior:"auto"});drawWallSnake();$("snakeCanvas").focus({preventScroll:true});
  wallSnakeTimer=setInterval(()=>{if(wallSnakeState?.running){snakeStep(wallSnakeState);drawWallSnake();}},160);
}
function closeWallSnake(){
  if(!wallSnakeState)return;
  clearInterval(wallSnakeTimer);wallSnakeTimer=null;wallSnakeState=null;$("wallSnake").hidden=true;
  wallSnakeReturnFocus?.focus({preventScroll:true});
}
document.addEventListener("DOMContentLoaded",()=>{
  $("snakePause").addEventListener("click",toggleWallSnake);
  $("snakeClose").addEventListener("click",closeWallSnake);
  document.querySelectorAll("[data-snake-dir]").forEach(b=>{
    b.addEventListener("pointerdown",event=>{event.preventDefault();snakeTurn(b.dataset.snakeDir);});
    b.addEventListener("click",event=>{if(event.detail===0)snakeTurn(b.dataset.snakeDir);});
  });
  document.addEventListener("keydown",event=>{
    if(!wallSnakeState)return;
    const keys={ArrowUp:"up",w:"up",ArrowDown:"down",s:"down",ArrowLeft:"left",a:"left",ArrowRight:"right",d:"right"};
    if(event.key==="Escape"){event.preventDefault();closeWallSnake();}
    else if(event.key===" " && event.target===$("snakeCanvas")){event.preventDefault();toggleWallSnake();}
    else if(keys[event.key]){event.preventDefault();snakeTurn(keys[event.key]);}
  });
  document.addEventListener("visibilitychange",()=>{if(document.hidden&&wallSnakeState){wallSnakeState.running=false;drawWallSnake();}});
  window.addEventListener("blur",()=>{if(wallSnakeState){wallSnakeState.running=false;drawWallSnake();}});
  let start=null;
  $("snakeCanvas").addEventListener("pointerdown",event=>{start={x:event.clientX,y:event.clientY};$("snakeCanvas").setPointerCapture(event.pointerId);});
  $("snakeCanvas").addEventListener("pointerup",event=>{
    if(!start)return;const dx=event.clientX-start.x,dy=event.clientY-start.y;start=null;
    if(Math.max(Math.abs(dx),Math.abs(dy))<15)return;
    snakeTurn(Math.abs(dx)>Math.abs(dy)?dx>0?"right":"left":dy>0?"down":"up");
  });
  $("snakeCanvas").addEventListener("pointercancel",()=>{start=null;});
});


let adminGeneration=0,adminPage=0,adminSearchText="",adminWall=null,adminOffset=0,adminWallLoading=false;
function clearAdminReview(){
  adminGeneration++;adminWall=null;adminWallLoading=false;adminOffset=0;
  clearImages($("adminPhotos"));$("adminPhotos").replaceChildren();$("adminAccountList").replaceChildren();
  $("adminReview").hidden=true;$("adminMorePhotos").hidden=true;$("adminWallTitle").textContent="";$("adminStatus").textContent="";
}
async function loadAdminAccounts(delta=0){
  const generation=++adminGeneration;adminWall=null;adminWallLoading=false;
  clearImages($("adminPhotos"));$("adminPhotos").replaceChildren();$("adminReview").hidden=true;
  $("adminAccountList").replaceChildren();$("adminNext").hidden=true;$("adminPrevious").hidden=true;
  $("adminStatus").textContent="Checking admin access…";
  try{
    await requireUser();if(!check(await supabaseClient.rpc("is_narwhall_admin")))throw new Error("Admin access required.");
    const search=$("adminSearch").value.trim();const page=search!==adminSearchText?0:Math.max(0,adminPage+delta);
    const accounts=check(await supabaseClient.rpc("admin_account_list",{search_text:search,page_number:page}));
    if(generation!==adminGeneration || currentScreen!=="admin")return;
    adminPage=page;adminSearchText=search;
    accounts.forEach(account=>{
      const card=document.createElement("article");card.className="admin-account";
      const name=document.createElement("strong");name.textContent="@"+(account.username||"Member");
      const email=document.createElement("p");email.textContent=account.email;card.append(name,email);
      const buttons=document.createElement("div");buttons.className="admin-pages";
      [["main","Main wall",account.main_photo_count],["private","Locked wall",account.private_photo_count]].forEach(([scope,label,count])=>{
        const b=document.createElement("button");b.textContent=label+" · "+count;b.onclick=()=>action(async()=>{adminWall={userId:account.user_id,scope,name:account.username||"Member"};await loadAdminWall(true);},b);buttons.append(b);
      });card.append(buttons);$("adminAccountList").append(card);
    });
    $("adminPrevious").hidden=page===0;$("adminNext").hidden=accounts.length<25;
    $("adminStatus").textContent=accounts.length?"Accounts · page "+(page+1):"No matching accounts.";
  }catch(error){if(generation===adminGeneration){$("adminStatus").textContent=error.message;throw error;}}
}
async function loadAdminWall(reset=true){
  if(!adminWall || currentScreen!=="admin" || (!reset&&adminWallLoading))return;
  if(reset){adminGeneration++;adminOffset=0;clearImages($("adminPhotos"));$("adminPhotos").replaceChildren();}
  const generation=adminGeneration,wall={...adminWall};adminWallLoading=true;$("adminMorePhotos").hidden=true;
  $("adminReview").hidden=false;$("adminWallTitle").textContent="@"+wall.name+" · "+(wall.scope==="private"?"Locked wall":"Main wall");
  $("adminStatus").textContent="Loading wall photos…";
  try{
    if(!check(await supabaseClient.rpc("is_narwhall_admin")))throw new Error("Admin access required.");
    const posts=check(await supabaseClient.from("moments").select("id,caption,photo_url,created_at").eq("user_id",wall.userId).eq("wall_scope",wall.scope).is("deleted_at",null).order("created_at",{ascending:false}).order("id",{ascending:false}).range(adminOffset,adminOffset+19));
    if(generation!==adminGeneration)return;
    const cards=await Promise.all(posts.map(async post=>{
      const card=document.createElement("article");card.className="admin-photo";
      const img=document.createElement("img");img.alt=post.caption||"Wall photo";
      try{img.src=await photoUrl(post.photo_url);card.append(img);}catch{const message=document.createElement("p");message.textContent="Photo unavailable. Reopen this wall to retry.";card.append(message);}
      const caption=document.createElement("p");caption.textContent=post.caption;const time=document.createElement("time");time.dateTime=post.created_at;time.textContent=new Date(post.created_at).toLocaleString();card.append(caption,time);return card;
    }));
    if(generation!==adminGeneration){cards.forEach(clearImages);return;}
    cards.forEach(card=>$("adminPhotos").append(card));adminOffset+=posts.length;
    $("adminMorePhotos").hidden=posts.length<20;$("adminStatus").textContent=adminOffset?"Showing "+adminOffset+" photos. Read-only review.":"This wall has no photos.";
  }catch(error){if(generation===adminGeneration){$("adminStatus").textContent=error.message;throw error;}}
  finally{if(generation===adminGeneration)adminWallLoading=false;}
}
document.addEventListener("DOMContentLoaded",()=>{$("adminSearchForm").addEventListener("submit",event=>{event.preventDefault();adminPage=0;action(()=>loadAdminAccounts());});});


let wallBounceState=null,wallBounceFrame=null,wallBounceLast=0,wallBounceFocus=null;
const bounceKeys=new Set();
function newWallBounce(){
  const bubbles=[];
  for(let row=0;row<4;row++)for(let col=0;col<6;col++)bubbles.push({x:65+col*94,y:65+row*62,r:24,alive:true});
  return {paddle:300,ball:{x:300,y:535,vx:125,vy:-265},bubbles,score:0,lives:3,running:false,ready:true,over:false};
}
function moveBouncePaddle(s,x){s.paddle=Math.max(58,Math.min(542,x));if(s.ready)s.ball.x=s.paddle;}
function bounceStep(s,dt,input=0){
  if(!s.running||s.over)return;
  moveBouncePaddle(s,s.paddle+input*440*dt);
  const b=s.ball,previousY=b.y;b.x+=b.vx*dt;b.y+=b.vy*dt;
  if(b.x<9){b.x=9;b.vx=Math.abs(b.vx);}if(b.x>591){b.x=591;b.vx=-Math.abs(b.vx);}
  if(b.y<9){b.y=9;b.vy=Math.abs(b.vy);}
  if(b.vy>0&&previousY+9<=553&&b.y+9>=550&&b.x>=s.paddle-65&&b.x<=s.paddle+65){
    b.y=541;const angle=Math.max(-1,Math.min(1,(b.x-s.paddle)/62))*1.05;
    const speed=Math.min(390,Math.hypot(b.vx,b.vy)+3);b.vx=Math.sin(angle)*speed;b.vy=-Math.cos(angle)*speed;
  }
  for(const bubble of s.bubbles){
    if(!bubble.alive)continue;const dx=b.x-bubble.x,dy=b.y-bubble.y,distance=Math.hypot(dx,dy);
    if(distance<bubble.r+9){
      const nx=distance?dx/distance:0,ny=distance?dy/distance:1,dot=b.vx*nx+b.vy*ny;
      if(dot<0){b.vx-=2*dot*nx;b.vy-=2*dot*ny;}
      b.x=bubble.x+nx*(bubble.r+10);b.y=bubble.y+ny*(bubble.r+10);bubble.alive=false;s.score+=10;break;
    }
  }
  if(s.bubbles.every(p=>!p.alive)){s.over=true;s.running=false;}
  else if(b.y>620){s.lives--;s.running=false;s.ready=true;s.over=s.lives===0;s.ball={x:s.paddle,y:535,vx:125,vy:-265};}
}
function drawWallBounce(){
  const s=wallBounceState;if(!s)return;const canvas=$("bounceCanvas"),ctx=canvas.getContext("2d");
  if(canvas.width!==600){canvas.width=600;canvas.height=600;}ctx.clearRect(0,0,600,600);
  s.bubbles.forEach((bubble,i)=>{if(!bubble.alive)return;ctx.beginPath();ctx.arc(bubble.x,bubble.y,bubble.r,0,Math.PI*2);ctx.fillStyle=["#b8a5ffb8","#99e5ffb8","#ffb3d0b8","#97f2cfb8"][Math.floor(i/6)];ctx.fill();ctx.strokeStyle="#ffffffb0";ctx.lineWidth=2;ctx.stroke();ctx.font="27px sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText("🐋",bubble.x,bubble.y+1);});
  ctx.fillStyle="#e6d8ff";ctx.shadowColor="#332459";ctx.shadowBlur=10;ctx.fillRect(s.paddle-58,550,116,14);ctx.shadowBlur=0;
  ctx.beginPath();ctx.arc(s.ball.x,s.ball.y,9,0,Math.PI*2);ctx.fillStyle="#fff9d6";ctx.fill();
  $("bounceScore").textContent=s.score;$("bounceLives").textContent=Array.from({length:s.lives},()=>"♥").join(" ")||"0 lives";
  $("bouncePause").textContent=s.over?"Play again":s.running?"Pause":s.ready?"Launch":"Resume";
  $("bounceStatus").textContent=s.over?(s.lives?"All bubbles popped! Play again?":"Game over! Try again."):s.running?"Drag anywhere on the board, or hold the arrows.":s.ready?(s.lives<3?"One life lost. Tap Launch to try again!":"Pop the narwhal bubbles. Tap Launch!"):"Paused. Tap Resume when you're ready.";
}
function toggleWallBounce(){
  if(!wallBounceState)return;if(wallBounceState.over)wallBounceState=newWallBounce();
  wallBounceState.running=!wallBounceState.running;if(wallBounceState.running)wallBounceState.ready=false;
  wallBounceLast=0;drawWallBounce();
}
function animateWallBounce(now){
  if(!wallBounceState)return;
  const elapsed=wallBounceLast?Math.min((now-wallBounceLast)/1000,0.05):0;wallBounceLast=now;
  const input=(bounceKeys.has("right")?1:0)-(bounceKeys.has("left")?1:0);
  for(let left=elapsed;left>0;left-=1/120)bounceStep(wallBounceState,Math.min(left,1/120),input);
  drawWallBounce();wallBounceFrame=requestAnimationFrame(animateWallBounce);
}
function openWallBounce(){
  closeWallSnake();$("wallGameMenu").open=false;if(wallBounceState)return;
  wallBounceFocus=document.activeElement;wallBounceState=newWallBounce();wallBounceLast=0;bounceKeys.clear();
  $("wallBounce").hidden=false;$("wallBounce").scrollIntoView({block:"nearest",behavior:"auto"});drawWallBounce();$("bounceCanvas").focus({preventScroll:true});
  wallBounceFrame=requestAnimationFrame(animateWallBounce);
}
function closeWallBounce(){
  if(!wallBounceState)return;cancelAnimationFrame(wallBounceFrame);wallBounceFrame=null;wallBounceState=null;bounceKeys.clear();$("wallBounce").hidden=true;wallBounceFocus?.focus({preventScroll:true});
}
function pauseWallBounce(){bounceKeys.clear();if(wallBounceState){wallBounceState.running=false;wallBounceLast=0;drawWallBounce();}}
document.addEventListener("DOMContentLoaded",()=>{
  $("bouncePause").addEventListener("click",toggleWallBounce);$("bounceClose").addEventListener("click",closeWallBounce);
  const canvas=$("bounceCanvas");let dragId=null;
  const drag=event=>{if(!wallBounceState)return;const r=canvas.getBoundingClientRect();moveBouncePaddle(wallBounceState,(event.clientX-r.left)/r.width*600);drawWallBounce();};
  canvas.addEventListener("pointerdown",event=>{event.preventDefault();dragId=event.pointerId;canvas.setPointerCapture(event.pointerId);drag(event);});
  canvas.addEventListener("pointermove",event=>{if(event.pointerId===dragId)drag(event);});
  canvas.addEventListener("pointerup",()=>{dragId=null;});canvas.addEventListener("pointercancel",()=>{dragId=null;});
  document.querySelectorAll("[data-bounce-dir]").forEach(button=>{
    button.addEventListener("pointerdown",event=>{event.preventDefault();button.setPointerCapture(event.pointerId);bounceKeys.add(button.dataset.bounceDir);});
    ["pointerup","pointercancel","lostpointercapture"].forEach(type=>button.addEventListener(type,()=>bounceKeys.delete(button.dataset.bounceDir)));
    button.addEventListener("click",event=>{if(event.detail===0&&wallBounceState)moveBouncePaddle(wallBounceState,wallBounceState.paddle+(button.dataset.bounceDir==="left"?-45:45));});
  });
  document.addEventListener("keydown",event=>{
    if(!wallBounceState)return;
    if(["ArrowLeft","ArrowRight","a","d"].includes(event.key)){event.preventDefault();bounceKeys.add(["ArrowLeft","a"].includes(event.key)?"left":"right");}
    else if(event.key===" "&&event.target===canvas){event.preventDefault();if(!event.repeat)toggleWallBounce();}
    else if(event.key==="Escape"){event.preventDefault();closeWallBounce();}
  });
  document.addEventListener("keyup",event=>{if(["ArrowLeft","a"].includes(event.key))bounceKeys.delete("left");if(["ArrowRight","d"].includes(event.key))bounceKeys.delete("right");});
  document.addEventListener("visibilitychange",()=>{if(document.hidden)pauseWallBounce();});window.addEventListener("blur",pauseWallBounce);
});
