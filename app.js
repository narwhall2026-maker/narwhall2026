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
let currentScreen="home", communityGeneration=0, communityLoading=false, communityCursor=null, communityHasMore=true;
const communitySeen=new Set();
const COMMUNITY_PAGE=20;
const imageUrls = new Set();
const $ = id => document.getElementById(id);
let noticeTimer;
function notice(message, error=false) {
  const box=$("appNotice"); box.textContent=message; box.classList.toggle("error",error); box.hidden=false;
  clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{box.hidden=true;},error?9000:4500);
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
  if(typeof stopPongLobby==='function'&&screen!=='games')stopPongLobby();
  if(typeof endPongSession==='function'&&screen!=='pong')endPongSession();
  if(screen!=="home")stopHomeCamera();
  if($("capturePanel").classList.contains("open"))closeCapture(false);
  closeWallSnake();closeWallBounce();
  clearAdminReview();
  if(currentScreen==="community" && screen!=="community")clearCommunity();
  const screenChanged=currentScreen!==screen;
  currentScreen=screen;document.body.dataset.screen=screen;
  $("photoWallFrame").hidden=screen!=="wall";
  if(screen!=="peek") clearPeek();
  $("wallControls").hidden=screen!=="wall";
  $("wallBrowseControls").hidden=screen!=="wall";
  $("privateControls").hidden=screen!=="wall" || currentWall!=="private";
  $("moreMemoriesButton").hidden=true;
  ["pongScreen","homeScreen","inboxScreen","gamesScreen","guideScreen","rulesScreen","wall","adminScreen","communityScreen","friendsScreen","profileScreen","peekScreen","signupScreen","loginScreen","resetScreen"].forEach(id=>{if($(id)) $(id).style.display="none";});
  const target=screen==="wall"?"wall":screen+"Screen"; if($(target)) $(target).style.display="block";
  $("intro").hidden=screen!=="wall"; $("captureButton").hidden=screen!=="wall";
  document.querySelectorAll("[data-screen]").forEach(b=>b.classList.toggle("active",b.dataset.screen===screen));
  $("communityButton").setAttribute("aria-pressed",screen==="community");
  document.querySelectorAll('#primaryNavigation [data-screen]').forEach(button=>{
    const selected=button.dataset.screen===screen || (screen==='peek' && button.dataset.screen==='friends') || (screen==='pong' && button.dataset.screen==='games');
    button.classList.toggle('active',selected);
    if(selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  });
  $('profileButton').setAttribute('aria-pressed',['profile','admin','rules','login','signup','reset'].includes(screen));
  $('inboxButton').setAttribute('aria-pressed',screen==='inbox');
  if(screenChanged)window.scrollTo?.({top:0,behavior:'instant'});
  if(screen==="home")resumeHomeCamera();
  if(screen==="inbox")action(()=>loadNotifications(true));
  if(screen==="games"){action(loadGameHub);if(typeof startPongLobby==='function')startPongLobby();}
  if(screen==="wall") action(async()=>{await loadMoments();if(currentWall==="private")await loadPrivateAccess();});
  if(screen==="friends") action(async()=>{await Promise.all([loadFriendRequests(),loadFriends(),loadSharedMomentRequests(),loadPrivateInvites()]);});
  if(screen==="profile") action(loadProfile);
  if(screen==="admin")action(async()=>{await loadAdminAccounts();await loadDeletionReviewQueue(0,true);});
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
function openCapture(scope=currentWall) { closeWallSnake();closeWallBounce(); return action(async()=>{await requireUser();if(scope==="community")await requireCommunityAccess();
  if(!["main","private","community"].includes(scope))return;
  $("captureDestination").value=scope;updateCaptureAudience(scope);
  if(captureScope!==scope){photoSelection++;selectedPhoto=null;if(selectedPhotoUrl)URL.revokeObjectURL(selectedPhotoUrl);selectedPhotoUrl=null;$("momentPhoto").value="";$("momentCaption").value="";}
  stopHomeCamera();homeCaptureOrigin=false;captureScope=scope;$("captureTitle").textContent=captureScope==="community"?"Post to Community 🌍":captureScope==="private"?"A locked-wall moment 🔒":"Capture a moment";$("captureShare").hidden=captureScope!=="main";$("shareFriend").value="";$("capturePanel").classList.add("open");document.body.classList.add("capture-open");updateVisibleHeight();updateCapturePreview();if(selectedPhoto)$("momentCaption").focus();else $("choosePhotoButton").focus();updateWordCount();if(captureScope==="main")await loadShareFriends();return true;}); }
function closeCapture(resume=true) {
  const wasOpen=$("capturePanel").classList.contains("open");
  document.body.classList.remove("capture-open");$("capturePanel").classList.remove("open");
  if(wasOpen){(currentScreen==="home"?$("homeShutter"):captureScope==="community"?$("communityCaptureButton"):$("captureButton")).focus();if(resume && currentScreen==="home")resumeHomeCamera();}
}
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
    const user=await requireUser();const scope=captureScope;if(scope==="community")await requireCommunityAccess();const friend=scope==="main"?$("shareFriend").value:"";const caption=$("momentCaption").value.trim();
    if(!selectedPhoto) throw new Error("Add a photo first 🐋");
    if(Array.from(caption).length>15) throw new Error("Keep your caption to 15 characters or fewer.");
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
  const img=document.createElement("img");img.alt=moment.caption||"Wall photo";img.draggable=false;img.src=await photoUrl(moment.photo_url);
  const caption=document.createElement("div");caption.className="polaroid-caption";caption.textContent=moment.caption;
  card.append(img,caption);
  if(editable) {
    const remove=document.createElement("button");remove.className="trash";remove.textContent="×";remove.title="Hide moment";remove.setAttribute("aria-label",moment.caption?"Hide "+moment.caption:"Hide photo");
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
  await loadAccountPreferences(session?.user);
  if(session){const profile=check(await supabaseClient.from("profiles").select("username").eq("id",session.user.id).single());$("username").value=profile.username;}else $("username").value="";
}
async function saveUsername() {const user=await requireUser();const username=$("username").value.trim().toLowerCase();validateUsername(username);check(await supabaseClient.from("profiles").update({username}).eq("id",user.id).select("id").single());notice("Username saved 🐋");}
function validateUsername(username) {if(!/^[a-z0-9_]{3,24}$/.test(username))throw new Error("Use 3–24 letters, numbers, or underscores for your username.");}
async function signup() {
  const email=$("signupEmail").value.trim(),password=$("signupPassword").value,username=$("signupUsername").value.trim().toLowerCase();
  validateUsername(username);if(!email || password.length<8)throw new Error("Enter your email and a password of at least 8 characters.");
  const data=check(await supabaseClient.auth.signUp({email,password,options:{data:{username},emailRedirectTo:location.origin}}));
  $("signupPassword").value="";
  if(data.session){showScreen("home");notice("Account created 🐋");}else{showScreen("login");notice("Check your email to confirm your account, then log in.");}
}
async function login() {
  const email=$("loginEmail").value.trim(),password=$("loginPassword").value;if(!email||!password)throw new Error("Enter your email and password.");
  check(await supabaseClient.auth.signInWithPassword({email,password}));$("loginPassword").value="";showScreen("home");notice("Welcome back 🐋");
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
  const rows=check(await supabaseClient.from("shared_moments").select("*").or("to_user_id.eq."+session.user.id+",from_user_id.eq."+session.user.id).eq("status","pending").order("created_at",{ascending:false}));
  const profiles=await profileMap(rows.flatMap(r=>[r.from_user_id,r.to_user_id]));container.replaceChildren();if(!rows.length)row(container,"No shared moments yet 🐋");
  rows.forEach(r=>{const incoming=r.to_user_id===session.user.id;const other=profiles.get(incoming?r.from_user_id:r.to_user_id)||"Friend";
    if(incoming && r.status==="pending")row(container,other+" · shared photo",[["Accept",()=>replyShared(r.id,true)],["Decline",()=>replyShared(r.id,false)]]);
    else if(r.status==="pending")row(container,"⏳ "+other+" · awaiting reply");
  });
}
async function replyShared(id,accept) {check(await supabaseClient.rpc("reply_shared_moment",{request_id:id,accept}));notice(accept?"Pinned! Your peeks are open 👀":"Shared moment declined.");await Promise.all([loadSharedMomentRequests(),loadFriends()]);}
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
  updateVisibleHeight();updateMemoryControls();updateWallControls();showScreen("home");action(loadProfile);
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
  $("wallViewHint").textContent=memoryView?"Only you · browse by week":"Newest 10";
  $("memoryDate").max=localDate(new Date());$("memoryDate").value=localDate(memoryWeek);
  const end=new Date(memoryWeek);end.setDate(end.getDate()+6);
  $("memoryWeekLabel").textContent=memoryWeek.toLocaleDateString()+" – "+end.toLocaleDateString();
  $("newerWeekButton").disabled=memoryWeek>=startOfWeek(new Date());
}
function setMemoryView(value){closeWallSnake();closeWallBounce();memoryView=!!value;wallGeneration++;empty($("wall"),"Loading your moments…");updateMemoryControls();action(loadMoments);}
function moveMemoryWeek(direction){const next=new Date(memoryWeek);next.setDate(next.getDate()+direction*7);if(next>startOfWeek(new Date()))return;memoryWeek=next;action(loadMoments);}

function chooseCapturePhoto() {
  if(saving)return;
  if(currentScreen==="home" && homeCaptureOrigin){
    photoSelection++;selectedPhoto=null;if(selectedPhotoUrl)URL.revokeObjectURL(selectedPhotoUrl);selectedPhotoUrl=null;homeCaptureOrigin=false;
    $("momentPhoto").value="";$("photoPreview").replaceChildren();updateCapturePreview();closeCapture();return;
  }
  $("momentPhoto").value="";$("momentPhoto").click();
}
function updateCapturePreview() {
  const hasPhoto=!!selectedPhoto;
  updateCaptureAudience(captureScope);
  $("capturePanel").classList.toggle("has-photo",hasPhoto);
  $("retakeButton").textContent=hasPhoto?"Retake":"Choose photo";
  $("retakeButton").disabled=saving;
  $("pinButton").disabled=!hasPhoto || saving;
  $("pinButton").textContent=captureScope==="community"?"Post publicly":"Pin";
  $("captureHint").textContent=captureScope==="community"?"Members who unlock Community can see this photo and your username.":captureScope==="private"?"This moment goes on your locked wall 🔒":"Pick a photo, add a caption if you like, then pin it.";
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
  $("communityUnlock").hidden=true;$("communityAudienceControls").hidden=true;$("communityCaptureButton").hidden=true;
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
    if(!session){showCommunityUnlock(0,false);communityHasMore=false;$("communityStatus").textContent="";return;}
    const access=check(await supabaseClient.rpc("community_access_status"));
    if(generation!==communityGeneration)return;
    if(!access.unlocked){showCommunityUnlock(access.photo_count,true);communityHasMore=false;$("communityStatus").textContent="";return;}
    $("communityUnlock").hidden=true;$("communityAudienceControls").hidden=false;$("communityCaptureButton").hidden=false;
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
  const img=document.createElement("img");img.alt=post.caption||"Community photo";img.decoding="async";
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
  const random=state.rng===undefined?Math.random():((state.rng=(Math.imul(1664525,state.rng)+1013904223)>>>0)/4294967296);
  return free.length?free[Math.floor(random*free.length)]:null;
}
function snakeTurn(name){
  const s=wallSnakeState,d=SNAKE_DIRS[name];if(!s || !s.running || !d || s.turned)return;
  if(d.x===-s.direction.x && d.y===-s.direction.y)return;
  s.next=d;s.turned=true;
}
function snakeStep(s){
  if(s.run){if(s.run.proof.length>=3750){s.over=true;s.running=false;return;}s.run.proof.push(s.next.y<0?0:s.next.x>0?1:s.next.y>0?2:3);}
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
  if(s.over && s.run && !s.run.submitting)void saveVerifiedRound(s);
  $("snakeScore").textContent=s.score;
  $("snakePause").textContent=s.over?"Play again":s.running?"Pause":s.score||s.body[0].x!==7||s.body[0].y!==10?"Resume":"Start";
  $("snakeStatus").textContent=s.over?(s.food?"Game over! Try again.":"You filled the wall!"):s.running?"Swipe, tap arrows, or use arrow keys / WASD.":"Tap Start or Resume. Space pauses the game.";
}
async function toggleWallSnake(){
  if(!wallSnakeState)return;
  if(wallSnakeState.over)wallSnakeState=newWallSnake();
  const state=wallSnakeState;if(state.starting)return;
  if(!state.started){state.starting=true;await beginVerifiedRound(state,"snake");state.starting=false;if(wallSnakeState!==state)return;state.started=true;}
  state.running=!state.running;drawWallSnake();
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
  if(wallSnakeState.run)void saveVerifiedRound(wallSnakeState);
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
  deletionQueueGeneration++;$("adminDeletionList").replaceChildren();$("adminDeletionPassword").value="";
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


let wallBounceState=null,wallBounceFrame=null,wallBounceLast=0,wallBounceAccumulator=0,wallBounceFocus=null;
const bounceKeys=new Set();
function newWallBounce(){
  const bubbles=[];
  for(let row=0;row<4;row++)for(let col=0;col<6;col++)bubbles.push({x:65+col*94,y:65+row*62,r:24,alive:true});
  return {paddle:300,ball:{x:300,y:535,vx:125,vy:-265},bubbles,score:0,lives:3,running:false,ready:true,over:false};
}
function moveBouncePaddle(s,x){s.paddle=Math.max(58,Math.min(542,x));if(s.ready)s.ball.x=s.paddle;}
function bounceStep(s,dt,input=0){
  if(!s.running||s.over)return;
  moveBouncePaddle(s,Math.round(s.paddle*10)/10);
  if(s.run){if(s.run.proof.length>=72000){s.over=true;s.running=false;return;}s.run.proof.push([Math.round(s.paddle*10),input]);}
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
  if(s.over && s.run && !s.run.submitting)void saveVerifiedRound(s);
  $("bounceScore").textContent=s.score;$("bounceLives").textContent=Array.from({length:s.lives},()=>"♥").join(" ")||"0 lives";
  $("bouncePause").textContent=s.over?"Play again":s.running?"Pause":s.ready?"Launch":"Resume";
  $("bounceStatus").textContent=s.over?(s.lives?"All bubbles popped! Play again?":"Game over! Try again."):s.running?"Drag anywhere on the board, or hold the arrows.":s.ready?(s.lives<3?"One life lost. Tap Launch to try again!":"Pop the narwhal bubbles. Tap Launch!"):"Paused. Tap Resume when you're ready.";
}
async function toggleWallBounce(){
  if(!wallBounceState)return;if(wallBounceState.over)wallBounceState=newWallBounce();
  const state=wallBounceState;if(state.starting)return;
  if(!state.started){state.starting=true;await beginVerifiedRound(state,"bounce");state.starting=false;if(wallBounceState!==state)return;state.started=true;}
  state.running=!state.running;if(state.running)state.ready=false;
  wallBounceLast=0;drawWallBounce();
}
function animateWallBounce(now){
  if(!wallBounceState)return;
  const elapsed=wallBounceLast?Math.min((now-wallBounceLast)/1000,0.05):0;wallBounceLast=now;
  const input=(bounceKeys.has("right")?1:0)-(bounceKeys.has("left")?1:0);
  wallBounceAccumulator+=elapsed;while(wallBounceAccumulator>=1/120){bounceStep(wallBounceState,1/120,input);wallBounceAccumulator-=1/120;}
  drawWallBounce();wallBounceFrame=requestAnimationFrame(animateWallBounce);
}
function openWallBounce(){
  closeWallSnake();$("wallGameMenu").open=false;if(wallBounceState)return;
  wallBounceFocus=document.activeElement;wallBounceState=newWallBounce();wallBounceLast=0;wallBounceAccumulator=0;bounceKeys.clear();
  $("wallBounce").hidden=false;$("wallBounce").scrollIntoView({block:"nearest",behavior:"auto"});drawWallBounce();$("bounceCanvas").focus({preventScroll:true});
  wallBounceFrame=requestAnimationFrame(animateWallBounce);
}
function closeWallBounce(){
  if(!wallBounceState)return;if(wallBounceState.run)void saveVerifiedRound(wallBounceState);cancelAnimationFrame(wallBounceFrame);wallBounceFrame=null;wallBounceState=null;bounceKeys.clear();$("wallBounce").hidden=true;wallBounceFocus?.focus({preventScroll:true});
}
function pauseWallBounce(){bounceKeys.clear();if(wallBounceState){wallBounceState.running=false;wallBounceLast=0;drawWallBounce();}}
document.addEventListener("DOMContentLoaded",()=>{
  $("bouncePause").addEventListener("click",toggleWallBounce);$("bounceClose").addEventListener("click",closeWallBounce);
  const canvas=$("bounceCanvas");let dragId=null;
  const drag=event=>{if(!wallBounceState)return;const r=canvas.getBoundingClientRect();const side=Math.min(r.width,r.height),left=r.left+(r.width-side)/2;moveBouncePaddle(wallBounceState,(event.clientX-left)/side*600);drawWallBounce();};
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


function showCommunityUnlock(count,loggedIn){
  $("communityUnlock").hidden=false;$("communityAudienceControls").hidden=true;$("communityCaptureButton").hidden=true;
  $("communityUnlockProgress").value=count;
  $("communityUnlockHint").textContent=loggedIn?count+" of 5 photos saved on My moments. Add "+(5-count)+" more to unlock Community. Older photos in Memories count too; locked-wall photos don’t.":"Log in, then add 5 photos to My moments to unlock Community.";
  $("communityUnlockAction").textContent=loggedIn?"Add photos to My moments":"Log in to get started";
}
async function requireCommunityAccess(){
  const access=check(await supabaseClient.rpc("community_access_status"));
  if(!access.unlocked)throw new Error("Add 5 photos to My moments to unlock Community ("+access.photo_count+"/5).");
}
function goUnlockCommunity(){action(async()=>{const session=check(await supabaseClient.auth.getSession()).session;if(!session){showScreen("login");return;}setWall("main");showScreen("wall");});}


// Coarse account administration details; no raw user-agent, IP or device identifier is stored.
let activityLastInput=Date.now(),activityLastAttempt=0,activityPending=false;
async function recordAccountActivity(){
  if(!allowAccountActivity || !supabaseClient || document.hidden || activityPending || Date.now()-activityLastInput>120000 || Date.now()-activityLastAttempt<60000)return;
  activityPending=true;
  try{
    const session=check(await supabaseClient.auth.getSession()).session;
    if(!session)return;
    activityLastAttempt=Date.now();
    await supabaseClient.rpc("record_account_activity");
  }catch{/* Activity reporting must never interrupt normal app use. */}
  finally{activityPending=false;}
}
document.addEventListener("DOMContentLoaded",()=>{
  const activity=()=>{activityLastInput=Date.now();void recordAccountActivity();};
  ["pointerdown","keydown","scroll"].forEach(type=>document.addEventListener(type,activity,{passive:true}));
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)activity();});
  supabaseClient?.auth.onAuthStateChange(event=>{if(event==="SIGNED_IN"){activityLastAttempt=0;setTimeout(activity,0);}});
  setInterval(()=>void recordAccountActivity(),120000);
  void recordAccountActivity();
});



// Camera-first home: local preview only, snapshots enter the existing review-and-pin flow.
let homeCameraStream=null,homeCameraGeneration=0,homeCameraWanted=false,homeCameraFacing="environment",homeCameraOpening=false,homeCaptureOrigin=false;
function stopHomeCamera(){
  stopHomeEffects();homeCameraGeneration++;homeCameraOpening=false;
  if(homeCameraStream)homeCameraStream.getTracks().forEach(track=>track.stop());
  homeCameraStream=null;const video=$("homeCameraVideo");video.srcObject=null;video.hidden=true;
  $("homeCameraPlaceholder").hidden=false;$("homeCameraLive").hidden=true;$("homeFlipCamera").disabled=true;$("homeEnableCamera").disabled=false;
}
async function startHomeCamera(){
  if(currentScreen!=="home" || document.hidden || homeCameraOpening || $("capturePanel").classList.contains("open"))return;
  if(!navigator.mediaDevices?.getUserMedia){$("homeCameraStatus").textContent="Live camera isn’t available in this browser. You can still choose a photo from Gallery.";return;}
  stopHomeCamera();const generation=homeCameraGeneration;homeCameraOpening=true;
  $("homeEnableCamera").disabled=true;$("homeCameraStatus").textContent="Opening your camera…";
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:homeCameraFacing},width:{ideal:1600},height:{ideal:1600}}});
    if(generation!==homeCameraGeneration || currentScreen!=="home" || document.hidden){stream.getTracks().forEach(track=>track.stop());return;}
    homeCameraStream=stream;homeCameraWanted=true;
    const video=$("homeCameraVideo");video.srcObject=stream;
    const facing=stream.getVideoTracks()[0]?.getSettings?.().facingMode||homeCameraFacing;
    video.classList.toggle("selfie",facing==="user");video.hidden=false;await video.play();
    if(generation!==homeCameraGeneration)return;
    $("homeCameraPlaceholder").hidden=true;$("homeCameraLive").hidden=false;$("homeFlipCamera").disabled=false;
    $("homeCameraStatus").textContent="Ready when you are. Your photo won’t post until you tap Pin.";startHomeEffects();
    stream.getVideoTracks()[0]?.addEventListener("ended",()=>{if(generation===homeCameraGeneration){stopHomeCamera();$("homeCameraStatus").textContent="Camera stopped. Tap Enable camera to start again, or use Gallery.";}},{once:true});
  }catch(error){
    if(generation!==homeCameraGeneration)return;stopHomeCamera();
    $("homeCameraStatus").textContent=error.name==="NotAllowedError"?"Camera access wasn’t allowed. Enable it in your browser’s site settings, or choose a photo from Gallery.":error.name==="NotFoundError"?"No camera found. Choose a photo from Gallery instead.":"Couldn’t start the camera. Try Enable camera again, or use Gallery.";
  }finally{if(generation===homeCameraGeneration){homeCameraOpening=false;$("homeEnableCamera").disabled=false;}}
}
async function resumeHomeCamera(){
  if(!homeCameraAutoStart)return;
  if(currentScreen!=="home" || document.hidden || homeCameraStream || homeCameraOpening || $("capturePanel").classList.contains("open"))return;
  if(homeCameraWanted){void startHomeCamera();return;}
  try{const permission=await navigator.permissions?.query({name:"camera"});if(permission?.state==="granted" && currentScreen==="home")void startHomeCamera();}catch{/* First visit and unsupported browsers use the explicit Enable camera button. */}
}
async function flipHomeCamera(){
  if(!homeCameraStream || homeCameraOpening)return;
  homeCameraFacing=homeCameraFacing==="environment"?"user":"environment";await startHomeCamera();
}
async function takeHomePhoto(){
  if(!homeCameraStream){await startHomeCamera();return;}
  await requireUser();const generation=homeCameraGeneration,video=$("homeCameraVideo");
  if(!video.videoWidth || !video.videoHeight)throw new Error("The camera is still getting ready. Try again in a moment.");
  const frame=$("homeViewfinder").getBoundingClientRect(),ratio=frame.width/frame.height;
  const width=Math.min(video.videoWidth,video.videoHeight*ratio),height=width/ratio;
  const scale=Math.min(1,1600/Math.max(width,height));
  const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Couldn’t capture this photo. Try Gallery instead.");
  drawHomeFrame(canvas,video,homeColourFilter,homeHatEnabled);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",0.9));
  if(generation!==homeCameraGeneration || currentScreen!=="home")return;
  if(!blob)throw new Error("Couldn’t capture this photo. Try again.");
  if(await openCapture("main")){await handlePhotoSelect({target:{files:[blob]}});homeCaptureOrigin=true;}
}
async function homeGallerySelected(event){
  const file=event.target.files?.[0];event.target.value="";if(!file)return;
  if(await openCapture("main"))await handlePhotoSelect({target:{files:[file]}});
}
document.addEventListener("DOMContentLoaded",()=>{
  $("homeGalleryInput").addEventListener("change",event=>action(()=>homeGallerySelected(event)));
  document.addEventListener("visibilitychange",()=>{if(document.hidden)stopHomeCamera();else resumeHomeCamera();});
  window.addEventListener("pagehide",stopHomeCamera);window.addEventListener("pageshow",()=>resumeHomeCamera());
});


// The same pixel pipeline renders previews and saved photos, including Safari.
let homeColourFilter="original",homeHatEnabled=false,homeEffectsFrame=null,homeEffectsLast=0,homeHatTracker=null,homeHatPoses=[],homeHatSeenAt=0;
function setHomeFilter(filter){
  if(!["original","vintage","mono"].includes(filter))return;homeColourFilter=filter;
  document.querySelectorAll("[data-camera-filter]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.cameraFilter===filter)));
  if(homeCameraStream)startHomeEffects();
}
function toggleHomeHat(){
  homeHatEnabled=!homeHatEnabled;$("homeNarwhalHat").setAttribute("aria-pressed",String(homeHatEnabled));
  homeHatPoses=[];homeHatSeenAt=0;
  if(!homeHatEnabled){stopHatTracker();$("homeEffectsStatus").textContent="";}
  else if(!homeCameraStream)ensureHatTracker();
  if(homeCameraStream)startHomeEffects();
}
function colourHomePixels(image,filter){
  if(filter==="original")return image;
  const d=image.data,w=image.width,h=image.height;
  for(let i=0;i<d.length;i+=4){
    const r=d[i],g=d[i+1],b=d[i+2],lum=.2126*r+.7152*g+.0722*b;
    if(filter==="mono"){d[i]=d[i+1]=d[i+2]=lum;continue;}
    // A warm fade, restrained grain and a soft vignette.
    const pixel=i/4,x=(pixel%w)/w-.5,y=Math.floor(pixel/w)/h-.5;
    const shade=1-.2*(x*x+y*y),grain=(((pixel*13+17)%11)-5)*.45;
    d[i]=((r*.78+lum*.22)*.91+24+grain)*shade;
    d[i+1]=((g*.8+lum*.2)*.85+17+grain)*shade;
    d[i+2]=((b*.72+lum*.28)*.74+15+grain)*shade;
  }return image;
}
function drawNarwhalHat(ctx,x,y,width,angle){
  ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.scale(width/100,width/100);
  ctx.shadowColor="#11182770";ctx.shadowBlur=5;ctx.lineJoin="round";ctx.lineWidth=2.5;ctx.strokeStyle="#e7f9ff";
  // Small blue narwhal, with flukes, a fin and an ivory tusk.
  ctx.fillStyle="#7dd4ef";ctx.beginPath();ctx.moveTo(-31,7);ctx.bezierCurveTo(-48,10,-51,-2,-49,-13);ctx.lineTo(-39,-5);ctx.lineTo(-32,-15);ctx.bezierCurveTo(-28,-5,-34,0,-31,7);ctx.fill();ctx.stroke();
  ctx.beginPath();ctx.ellipse(4,4,34,21,-.12,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.shadowBlur=0;ctx.fillStyle="#dcf5ff";ctx.beginPath();ctx.ellipse(7,12,24,10,0,0,Math.PI);ctx.fill();
  ctx.fillStyle="#55acd3";ctx.beginPath();ctx.moveTo(-2,10);ctx.quadraticCurveTo(11,27,16,18);ctx.lineTo(9,9);ctx.fill();
  ctx.fillStyle="#fff1cf";ctx.beginPath();ctx.moveTo(24,-12);ctx.lineTo(39,-42);ctx.lineTo(32,-9);ctx.closePath();ctx.fill();ctx.strokeStyle="#d4b98a";ctx.lineWidth=1;ctx.stroke();
  ctx.fillStyle="#123952";ctx.beginPath();ctx.arc(23,0,2.5,0,Math.PI*2);ctx.fill();ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(23.7,-.8,.8,0,Math.PI*2);ctx.fill();
  ctx.restore();
}
function drawHomeFrame(canvas,video,filter,hat){
  const ctx=canvas.getContext("2d",{willReadFrequently:filter!=="original"});if(!ctx)return;
  const ratio=canvas.width/canvas.height,sw=Math.min(video.videoWidth,video.videoHeight*ratio),sh=sw/ratio;
  const sx=(video.videoWidth-sw)/2,sy=(video.videoHeight-sh)/2,mirror=video.classList.contains("selfie");
  ctx.save();if(mirror){ctx.translate(canvas.width,0);ctx.scale(-1,1);}
  ctx.drawImage(video,sx,sy,sw,sh,0,0,canvas.width,canvas.height);ctx.restore();
  if(filter!=="original")ctx.putImageData(colourHomePixels(ctx.getImageData(0,0,canvas.width,canvas.height),filter),0,0);
  if(hat && performance.now()-homeHatSeenAt<700){
    homeHatPoses.forEach(face=>{
      let x=(face.x*video.videoWidth-sx)/sw*canvas.width;
      const y=(face.y*video.videoHeight-sy)/sh*canvas.height,width=face.width*video.videoWidth/sw*canvas.width;
      if(mirror)x=canvas.width-x;
      drawNarwhalHat(ctx,x,y,width,mirror?-face.angle:face.angle);
    });
  }
}
function stopHatTracker(){
  const t=homeHatTracker;homeHatTracker=null;if(t){clearTimeout(t.timeout);clearTimeout(t.frameTimeout);t.worker.terminate();}
  homeHatPoses=[];homeHatSeenAt=0;
}
function failHomeHat(){
  stopHatTracker();homeHatEnabled=false;$("homeNarwhalHat").setAttribute("aria-pressed","false");
  $("homeEffectsStatus").textContent="Face tracking isn’t available right now. You can still use Original, Vintage or Black & white.";
}
function ensureHatTracker(){
  if(homeHatTracker || !homeHatEnabled)return;
  if(typeof Worker==="undefined" || typeof createImageBitmap==="undefined"){failHomeHat();return;}
  $("homeEffectsStatus").textContent="Loading the narwhal hat… The first load may take a moment.";
  try{
    const worker=new Worker("camera-face-worker.js?v=2");
    const tracker={worker,ready:false,busy:false,last:0,sequence:0,timeout:null};homeHatTracker=tracker;
    tracker.timeout=setTimeout(()=>{if(homeHatTracker===tracker)failHomeHat();},25000);
    worker.onerror=()=>{if(homeHatTracker===tracker)failHomeHat();};
    worker.onmessage=event=>{
      if(homeHatTracker!==tracker)return;const result=event.data;
      if(result.type==="ready"){clearTimeout(tracker.timeout);tracker.ready=true;$("homeEffectsStatus").textContent=homeCameraStream?"Face the camera to wear your narwhal. Try Flip for a selfie.":"Narwhal hat is ready. Enable the camera and try Flip for a selfie.";}
      else if(result.type==="faces"){
        clearTimeout(tracker.frameTimeout);tracker.busy=false;homeHatPoses=result.faces;homeHatSeenAt=performance.now();
        const text=result.faces.length?"Narwhal hat is following your face. Ready for a photo!":"No face in view. Face the camera to try the hat.";
        if($("homeEffectsStatus").textContent!==text)$("homeEffectsStatus").textContent=text;
      }else if(result.type==="error"){console.warn("Narwhal tracker:",result.stage,result.message);failHomeHat();}
    };
  }catch{failHomeHat();}
}
async function detectHomeHat(video,now){
  const t=homeHatTracker;if(!t?.ready || t.busy || now-t.last<160)return;
  t.busy=true;t.last=now;
  try{
    const bitmap=await createImageBitmap(video,{resizeWidth:320,resizeHeight:Math.max(1,Math.round(video.videoHeight*320/video.videoWidth))});
    if(homeHatTracker!==t || !homeHatEnabled || !homeCameraStream){bitmap.close();return;}
    t.frameTimeout=setTimeout(()=>{if(homeHatTracker===t)failHomeHat();},5000);
    t.worker.postMessage({type:"frame",bitmap,timestamp:now,sequence:++t.sequence},[bitmap]);
  }catch{if(homeHatTracker===t)failHomeHat();}
}
function stopHomeEffects(){
  if(homeEffectsFrame!==null)cancelAnimationFrame(homeEffectsFrame);homeEffectsFrame=null;homeEffectsLast=0;
  stopHatTracker();const canvas=$("homeEffectsCanvas");canvas.hidden=true;
  const ctx=canvas.getContext("2d");ctx?.clearRect(0,0,canvas.width,canvas.height);
}
function startHomeEffects(){
  if(homeEffectsFrame!==null)cancelAnimationFrame(homeEffectsFrame);homeEffectsFrame=null;
  if(!homeCameraStream || currentScreen!=="home" || document.hidden)return;
  if(homeHatEnabled)ensureHatTracker();
  const canvas=$("homeEffectsCanvas"),video=$("homeCameraVideo");
  const loop=now=>{
    if(!homeCameraStream || currentScreen!=="home" || document.hidden){stopHomeEffects();return;}
    const active=homeColourFilter!=="original" || homeHatEnabled;
    if(active && video.readyState>=2 && video.videoWidth && now-homeEffectsLast>=80){
      const rect=$("homeViewfinder").getBoundingClientRect(),width=Math.min(480,Math.round(rect.width)),height=Math.round(width*rect.height/rect.width);
      if(canvas.width!==width || canvas.height!==height){canvas.width=width;canvas.height=height;}
      try{drawHomeFrame(canvas,video,homeColourFilter,homeHatEnabled);canvas.hidden=false;}catch{canvas.hidden=true;}
      homeEffectsLast=now;if(homeHatEnabled)void detectHomeHat(video,now);
    }else if(!active)canvas.hidden=true;
    homeEffectsFrame=requestAnimationFrame(loop);
  };
  homeEffectsFrame=requestAnimationFrame(loop);
}

let socialGeneration=0,notificationsSeenAt=null,onboardingUser=null,lastGuideUser=null,activeGameChallenge=null;
function browserSetting(key,fallback){try{const value=localStorage.getItem(key);return value===null?fallback:value==='true';}catch{return fallback;}}
let homeCameraAutoStart=browserSetting('narwhall-camera-auto',true),allowAccountActivity=browserSetting('narwhall-activity',true);
function setCameraAutoStart(value){homeCameraAutoStart=!!value;try{localStorage.setItem('narwhall-camera-auto',String(homeCameraAutoStart));}catch{}$('cameraAutoStart').checked=homeCameraAutoStart;}
function stopCameraFromSettings(){setCameraAutoStart(false);homeCameraWanted=false;stopHomeCamera();notice('Camera stopped. You can still enable it manually on the camera screen.');}
function setActivityOptIn(value){allowAccountActivity=!!value;try{localStorage.setItem('narwhall-activity',String(allowAccountActivity));}catch{}notice(value?'Basic activity reporting enabled on this browser.':'New activity reporting stopped on this browser.');}
function resetSocialState(){if(typeof resetPongState==='function')resetPongState();photoSelection++;selectedPhoto=null;if(selectedPhotoUrl)URL.revokeObjectURL(selectedPhotoUrl);selectedPhotoUrl=null;$('momentPhoto').value='';$('momentCaption').value='';updateWordCount();updateCapturePreview();closeCapture(false);socialGeneration++;notificationsSeenAt=null;onboardingUser=null;activeGameChallenge=null;$('inboxBadge').hidden=true;['notificationList','gameLeaderboard','gameChallengeList','challengeFriend'].forEach(id=>$(id).replaceChildren());const option=document.createElement('option');option.value='';option.textContent='Choose a friend';$('challengeFriend').append(option);$('gameServiceStatus').textContent='';$('deleteAccountSettings').hidden=true;$('deleteEmail').value='';$('deletePassword').value='';$('deleteConfirm').value='';$('deletionRequestStatus').replaceChildren();$('cancelDeletionButton').hidden=true;ownDeletionRequest=null;}
async function loadAccountPreferences(user){
 $('deleteAccountSettings').hidden=!user;$('cameraAutoStart').checked=homeCameraAutoStart;$('activityOptIn').checked=allowAccountActivity;if(onboardingUser&&onboardingUser!==user?.id)resetSocialState();onboardingUser=user?.id||null;$('deleteAccountSettings').hidden=!user;
 if(!user){resetSocialState();return;}
 const generation=socialGeneration;
 const prefs=check(await supabaseClient.from('account_preferences').select('*').eq('user_id',user.id).maybeSingle());
 if(generation!==socialGeneration)return;
 notificationsSeenAt=prefs?.notifications_seen_at||null;$('deleteEmail').value=user.email||'';
 if(!prefs)check(await supabaseClient.from('account_preferences').upsert({user_id:user.id},{onConflict:'user_id',ignoreDuplicates:true}));
 void action(()=>loadNotifications(false));
 await loadOwnDeletionRequest();
 if(!prefs?.onboarding_done&&currentScreen==='home'&&lastGuideUser!==user.id){lastGuideUser=user.id;showScreen('guide');}
}
async function finishGuide(){const session=check(await supabaseClient.auth.getSession()).session;if(session){check(await supabaseClient.from('account_preferences').upsert({user_id:session.user.id},{onConflict:'user_id',ignoreDuplicates:true}));check(await supabaseClient.from('account_preferences').update({onboarding_done:true}).eq('user_id',session.user.id));}showScreen('home');}
function updateCaptureAudience(scope){
 if(!$('captureAudience'))return;
 const friend=scope==='main'&&$('shareFriend').value;
 $('captureAudience').textContent=scope==='community'?'Public Community post: visible to members who unlock Community, including people who aren’t your friends.':scope==='private'?'Locked wall: visible to you, admins for moderation, and friends with an active locked-wall invitation.':friend?'Your main wall + a request to your selected friend. If they accept, it pins to both walls and opens mutual main-wall peeks for 24 hours. Admins can review for moderation.':'Your main wall: visible to you, admins for moderation, and friends with an active 24-hour peek.';
 $('captureDestination').disabled=saving;$('shareFriend').disabled=saving;
}
async function changeCaptureDestination(){
 const destination=$('captureDestination').value,previous=captureScope;if(saving){$('captureDestination').value=previous;return;}
 try{
  if(destination==='community'){await requireCommunityAccess();if(previous==='private'&&!confirm('Move this locked-wall draft to a public Community post? Eligible Community members will be able to see it.')){$('captureDestination').value=previous;return;}}
  captureScope=destination;$('shareFriend').value='';$('captureShare').hidden=destination!=='main';$('captureTitle').textContent=destination==='community'?'Post to Community 🌍':destination==='private'?'A locked-wall moment 🔒':'Capture a moment';
  if(destination==='main')await loadShareFriends();updateCapturePreview();
 }catch(error){captureScope=previous;$('captureDestination').value=previous;$('captureShare').hidden=previous!=='main';$('captureTitle').textContent=previous==='community'?'Post to Community 🌍':previous==='private'?'A locked-wall moment 🔒':'Capture a moment';updateCapturePreview();throw error;}
}
async function loadNotifications(markSeen=false){
 const generation=socialGeneration;const session=check(await supabaseClient.auth.getSession()).session;
 if(!session){$('inboxBadge').hidden=true;if(currentScreen==='inbox')empty($('notificationList'),'Log in to see your notifications.');return;}
 const items=check(await supabaseClient.rpc('notification_inbox'));const names=await profileMap(items.map(i=>i.actor_id));
 if(generation!==socialGeneration)return;
 const unseen=items.filter(i=>!notificationsSeenAt||Date.parse(i.created_at)>Date.parse(notificationsSeenAt));$('inboxBadge').textContent=unseen.length>99?'99+':unseen.length;$('inboxBadge').hidden=!unseen.length;
 if(currentScreen==='inbox'){
  const list=$('notificationList');list.replaceChildren();if(!items.length)empty(list,'You’re all caught up. New requests and invitations will appear here.');
  items.forEach(item=>{
   const name=names.get(item.actor_id)||'Friend',after=async task=>{await task();await loadNotifications(true);};let text='',buttons=[];
   if(item.kind==='friend'){text=name+' wants to be your friend.';buttons=[['Accept',()=>after(()=>replyFriend(item.reference_id,'accepted'))],['Decline',()=>after(()=>replyFriend(item.reference_id,'declined'))]];}
   if(item.kind==='share'){text=name+' shared a photo for your wall.';buttons=[['Accept & pin',()=>after(()=>replyShared(item.reference_id,true))],['Decline',()=>after(()=>replyShared(item.reference_id,false))]];}
   if(item.kind==='locked'){text=name+' invited you to their locked wall until '+new Date(item.expires_at).toLocaleString();buttons=[['View locked wall',()=>openPrivatePeek(item.actor_id,name)]];}
   if(item.kind==='peek'){text='Your peek at '+name+'’s main wall is open until '+new Date(item.expires_at).toLocaleString();buttons=[['Peek',()=>openPeek(item.actor_id,name)]];}
   if(item.kind==='pong'){text=name+' has a live Pong invitation for you.';buttons=[['Open live Pong',()=>showScreen('games')]];}
   if(item.kind==='challenge'){text=name+' sent you a game challenge.';buttons=[['View challenge',()=>showScreen('games')]];}
   if(item.kind==='result'){text=name+' responded to your game challenge.';buttons=[['View result',()=>showScreen('games')]];}
   if(item.kind==='deletion'){text=name+' requested account deletion. An account and photo review is required.';buttons=[['Review request',()=>showScreen('admin')]];}
   if(item.kind==='deletion_update'){text='Your account deletion request has been reviewed.';buttons=[['View deletion status',()=>showScreen('profile')]];}
   notificationCard(list,name,item,text,buttons);
  });
 }
 if(markSeen){const latest=items.reduce((max,i)=>Date.parse(i.created_at)>Date.parse(max)?i.created_at:max,notificationsSeenAt||'1970-01-01T00:00:00Z');check(await supabaseClient.from('account_preferences').upsert({user_id:session.user.id},{onConflict:'user_id',ignoreDuplicates:true}));check(await supabaseClient.from('account_preferences').update({notifications_seen_at:latest}).eq('user_id',session.user.id));notificationsSeenAt=latest;$('inboxBadge').hidden=true;}
}
async function gameService(body){
 const session=check(await supabaseClient.auth.getSession()).session;if(!session)throw new Error('Log in to save scores and challenge friends.');
 const response=await fetch(supabaseUrl+'/functions/v1/narwhall-games',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:supabaseKey,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const result=await response.json();if(!response.ok)throw new Error(result.error||'Game service unavailable.');return result;
}
async function beginVerifiedRound(state,game){
 try{
  const session=check(await supabaseClient.auth.getSession()).session;if(!session)return;
  const ticket=await gameService({action:'start',game});state.rng=ticket.seed;state.run={id:ticket.id,game,proof:[],userId:session.user.id,challenge:activeGameChallenge?.game===game?activeGameChallenge.id:null,submitting:false};
 }catch(error){notice('This round can still be played, but its score won’t be saved: '+error.message,true);}
}
async function saveVerifiedRound(state){
 const run=state.run;if(!run||run.submitting||!run.proof.length)return;run.submitting=true;
 try{
  const result=await gameService({action:'finish',runId:run.id,proof:run.proof});
  let message='Score saved: '+result.score+' in '+(run.game==='snake'?'Snake':'Bubble Bounce')+'.';
  if(run.challenge){const outcome=check(await supabaseClient.rpc('reply_game_challenge',{p_challenge:run.challenge,p_run:result.runId}));message+=' Challenge '+outcome+'!';activeGameChallenge=null;}
  notice(message);if(currentScreen==='games')await loadGameHub();
 }catch(error){notice('Couldn’t save this score: '+error.message,true);}
 finally{run.proof=[];}
}
function launchChallengeGame(game,challenge=null){activeGameChallenge=challenge;showScreen('wall');if(game==='snake')openWallSnake();else openWallBounce();}
async function loadGameHub(){
 const generation=socialGeneration;const session=check(await supabaseClient.auth.getSession()).session;
 if(!session){empty($('gameLeaderboard'),'Log in to save best scores and challenge your friends.');$('gameChallengeList').replaceChildren();return;}
 const game=$('leaderboardGame').value;
 const [scores,challenges,friendData]=await Promise.all([supabaseClient.from('game_scores').select('*').eq('game',game).order('score',{ascending:false}).limit(100),supabaseClient.from('game_challenges').select('*').or('challenger_id.eq.'+session.user.id+',recipient_id.eq.'+session.user.id).order('created_at',{ascending:false}).limit(50),friendships()]);
 const rows=check(scores),requests=check(challenges),friendIds=friendData.rows.map(f=>f.sender_id===session.user.id?f.receiver_id:f.sender_id);
 const names=await profileMap([...rows.map(r=>r.user_id),...friendIds,...requests.flatMap(c=>[c.challenger_id,c.recipient_id])]);
 if(generation!==socialGeneration||currentScreen!=='games')return;
 $('gameServiceStatus').textContent='🏆 Friends’ best scores';
 $('gameLeaderboard').replaceChildren();if(!rows.length)empty($('gameLeaderboard'),'No saved scores yet. Play a round to get started.');rows.forEach((score,index)=>row($('gameLeaderboard'),(index+1)+'. '+(score.user_id===session.user.id?'You':names.get(score.user_id)||'Friend')+' · '+score.score));
 $('challengeFriend').replaceChildren(new Option('Choose a friend',''));friendIds.forEach(id=>$('challengeFriend').add(new Option(names.get(id)||'Friend',id)));
 $('gameChallengeList').replaceChildren();if(!requests.length)empty($('gameChallengeList'),'No challenges yet. Save a score, then send “Beat my score” to a friend.');
 requests.forEach(c=>{
  const incoming=c.recipient_id===session.user.id,name=names.get(incoming?c.challenger_id:c.recipient_id)||'Friend',pending=c.status==='pending'&&Date.parse(c.expires_at)>Date.now();
  const text=(c.game==='snake'?'🐍 Snake':'🐋 Bubble Bounce')+' · '+(incoming?'From ':'To ')+name+' · target '+c.target_score+' · '+(pending?'Open for 7 days':c.status==='pending'?'Expired':c.status)+(c.response_score===null?'':' · reply '+c.response_score);
  row($('gameChallengeList'),text,incoming&&pending?[['Play challenge',()=>launchChallengeGame(c.game,c)],['Decline',async()=>{check(await supabaseClient.rpc('reply_game_challenge',{p_challenge:c.id,p_run:null}));await loadGameHub();}]]:[]);
 });
}
async function sendGameChallenge(){
 const user=await requireUser(),friend=$('challengeFriend').value,game=$('challengeGame').value;if(!friend)throw new Error('Choose a friend.');
 const score=check(await supabaseClient.from('game_scores').select('run_id,score').eq('user_id',user.id).eq('game',game).maybeSingle());if(!score||score.score===0)throw new Error('Save a score above zero in this game first.');
 check(await supabaseClient.rpc('challenge_friend',{p_run:score.run_id,p_friend:friend}));notice('Beat my score challenge sent!');await loadGameHub();
}
async function deleteMyAccount(){
 const user=await requireUser(),email=$('deleteEmail').value.trim(),password=$('deletePassword').value,confirmation=$('deleteConfirm').value;
 if(email.toLowerCase()!==user.email.toLowerCase()||confirmation!=='DELETE'||!password)throw new Error('Enter your account email, password and DELETE.');
 if(!confirm('Request account deletion? Nothing is deleted now. There is a minimum 30-day wait and an admin must review your account and photos. You can cancel until final deletion starts.'))return;
 const auth=await supabaseClient.auth.signInWithPassword({email,password});$('deletePassword').value='';check(auth);
 check(await supabaseClient.rpc('request_account_deletion',{confirmation,account_email:email}));
 $('deleteConfirm').value='';await loadOwnDeletionRequest();notice('Deletion requested. Your account stays available during the 30-day wait and admin review.');
}
document.addEventListener('DOMContentLoaded',()=>{
 $('shareFriend').addEventListener('change',()=>updateCaptureAudience(captureScope));
 $('deleteAccountForm').addEventListener('submit',event=>{event.preventDefault();action(deleteMyAccount,$('deleteAccountButton'));});
 supabaseClient?.auth.onAuthStateChange((event,session)=>{setTimeout(()=>{if(event==='SIGNED_OUT')resetSocialState();else if(event==='SIGNED_IN'&&session?.user)action(()=>loadAccountPreferences(session.user));},0);});
 setInterval(()=>{if(!document.hidden)action(()=>loadNotifications(false));},60000);
});


let ownDeletionRequest=null,deletionQueuePage=0,deletionQueueGeneration=0;
async function loadOwnDeletionRequest(){
 const generation=socialGeneration,session=check(await supabaseClient.auth.getSession()).session;
 if(!session)return;
 const request=check(await supabaseClient.from('account_deletion_requests').select('id,requested_at,delete_after,status,reviewed_at,review_notes,processing_started_at').eq('user_id',session.user.id).order('requested_at',{ascending:false}).limit(1).maybeSingle());
 if(generation!==socialGeneration)return;ownDeletionRequest=request;
 const active=request&&['requested','approved','processing'].includes(request.status);
 $('deleteAccountForm').hidden=!!active;$('cancelDeletionButton').hidden=!request||!['requested','approved'].includes(request.status);
 const box=$('deletionRequestStatus');box.replaceChildren();if(!request)return;
 const text=document.createElement('p');
 text.textContent=request.status==='requested'?'Request received. Earliest deletion date: '+new Date(request.delete_after).toLocaleString()+'. Waiting for admin account/photo review.':request.status==='approved'?'Admin review approved. Earliest deletion date: '+new Date(request.delete_after).toLocaleString()+'. An admin must complete deletion after the wait. You may still cancel before final deletion starts.':request.status==='processing'?'Final deletion is now in progress. New photo uploads are paused, and this request can no longer be cancelled.':request.status==='cancelled'?'Your deletion request was cancelled. Your account and photos are still available.':request.status==='declined'?'The admin did not approve this deletion request. Your account is still available.':'This request has been completed.';
 box.append(text);if(request.review_notes){const notes=document.createElement('p');notes.textContent='Admin note: '+request.review_notes;box.append(notes);}
}
async function cancelMyDeletion(){
 if(!ownDeletionRequest)throw new Error('No deletion request found.');
 check(await supabaseClient.rpc('cancel_account_deletion',{p_request:ownDeletionRequest.id}));
 await loadOwnDeletionRequest();notice('Deletion request cancelled. Your account and photos are kept.');
}
async function loadDeletionReviewQueue(delta=0,reset=false){
 if(currentScreen!=='admin')return;const generation=++deletionQueueGeneration;
 if(reset)deletionQueuePage=0;else deletionQueuePage=Math.max(0,deletionQueuePage+delta);
 const rows=check(await supabaseClient.rpc('admin_deletion_queue',{p_page:deletionQueuePage}));
 if(generation!==deletionQueueGeneration||currentScreen!=='admin')return;
 const list=$('adminDeletionList');list.replaceChildren();if(!rows.length)empty(list,'No active account deletion requests on this page.');
 $('deletionQueuePrevious').hidden=deletionQueuePage===0;$('deletionQueueNext').hidden=rows.length<25;
 rows.forEach(request=>{
  const card=document.createElement('article');card.className='admin-account';
  const name=document.createElement('strong');name.textContent='@'+(request.username||'Member')+' · '+request.email;
  const summary=document.createElement('p');summary.textContent='Requested '+new Date(request.requested_at).toLocaleString()+' · earliest deletion '+new Date(request.delete_after).toLocaleString()+' · '+request.status;
  card.append(name,summary);
  const wallButtons=document.createElement('div');wallButtons.className='admin-pages';
  [['main','Review main wall',request.main_photo_count],['private','Review locked wall',request.private_photo_count]].forEach(([scope,label,count])=>{const button=document.createElement('button');button.textContent=label+' · '+count;button.onclick=()=>action(async()=>{adminWall={userId:request.user_id,scope,name:request.username||'Member'};await loadAdminWall(true);$('adminReview').scrollIntoView({block:'nearest'});},button);wallButtons.append(button);});card.append(wallButtons);
  const reviewedLabel=document.createElement('label');reviewedLabel.className='setting-check';const reviewed=document.createElement('input');reviewed.type='checkbox';reviewed.checked=request.photos_reviewed;const labelText=document.createElement('span');labelText.textContent='I reviewed this account and its main/locked-wall photos.';reviewedLabel.append(reviewed,labelText);card.append(reviewedLabel);
  const notes=document.createElement('textarea');notes.maxLength=500;notes.rows=2;notes.placeholder='Review note (visible to the person)';notes.setAttribute('aria-label','Review note for '+(request.username||'account'));notes.value=request.review_notes||'';card.append(notes);
  if(request.status!=='processing'){
   const approve=document.createElement('button');approve.textContent=request.status==='approved'?'Update approval':'Approve after photo review';approve.onclick=()=>action(async()=>{if(!reviewed.checked)throw new Error('Review the account and photos, then tick the review confirmation.');check(await supabaseClient.rpc('review_account_deletion',{p_request:request.id,p_approve:true,p_photos_reviewed:true,p_notes:notes.value.trim()}));notice('Review approved. The 30-day wait still applies.');await loadDeletionReviewQueue(0);},approve);
   const decline=document.createElement('button');decline.textContent='Do not approve';decline.onclick=()=>action(async()=>{check(await supabaseClient.rpc('review_account_deletion',{p_request:request.id,p_approve:false,p_photos_reviewed:reviewed.checked,p_notes:notes.value.trim()}));notice('Deletion was not approved. No photos or account data were deleted.');await loadDeletionReviewQueue(0);},decline);card.append(approve,decline);
  }else{reviewed.disabled=true;notes.disabled=true;}
  if(request.status==='approved'||request.status==='processing'){
   const remove=document.createElement('button');remove.textContent=request.status==='processing'?'Resume final deletion':'Complete permanent deletion';remove.disabled=Date.parse(request.delete_after)>Date.now();remove.onclick=()=>action(()=>completeReviewedDeletion(request),remove);card.append(remove);
   if(remove.disabled){const waiting=document.createElement('p');waiting.textContent='Final deletion is blocked until '+new Date(request.delete_after).toLocaleString()+'.';card.append(waiting);}
  }
  list.append(card);
 });
}
async function completeReviewedDeletion(request){
 if(Date.parse(request.delete_after)>Date.now())throw new Error('The full 30-day waiting period has not passed.');
 const admin=await requireUser(),password=$('adminDeletionPassword').value;if(!password)throw new Error('Enter your admin password below the review queue.');
 const confirmation=prompt('Type DELETE to permanently remove '+request.email+' and their uploaded photos, including shared copies. This cannot be undone.');if(confirmation!=='DELETE')return;
 const auth=await supabaseClient.auth.signInWithPassword({email:admin.email,password});$('adminDeletionPassword').value='';check(auth);
 await mediaRequest('/admin-account-delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:request.id,confirmation})});
 if(request.user_id===admin.id){setCameraAutoStart(false);homeCameraWanted=false;stopHomeCamera();await supabaseClient.auth.signOut({scope:'local'});resetSocialState();clearAdminReview();clearPeek();clearCommunity();showScreen('home');notice('Your reviewed account deletion has been completed.');return;}
 clearAdminReview();await loadAdminAccounts();await loadDeletionReviewQueue(0,true);notice('Reviewed account and uploaded photos permanently deleted.');
}

function notificationCard(list,name,item,text,buttons){
 const labels={friend:'Friend request',share:'Shared photo',locked:'Locked-wall invitation',peek:'Peek open',pong:'Live Pong',challenge:'Game challenge',result:'Challenge result',deletion:'Account review',deletion_update:'Deletion update'};
 const icons={friend:'👋',share:'📸',locked:'🔒',peek:'👀',pong:'🏓',challenge:'🎮',result:'🏆',deletion:'🛡',deletion_update:'🛡'};
 const card=document.createElement('div');card.className='notification-card';
 const avatar=document.createElement('span');avatar.className='notification-avatar';avatar.textContent=icons[item.kind]||'🐋';avatar.setAttribute('aria-hidden','true');
 const body=document.createElement('div');body.className='notification-body';const title=document.createElement('strong');title.textContent=name;
 const label=document.createElement('span');label.className='notification-label';label.textContent=labels[item.kind]||'Update';body.append(title,label);
 const actions=document.createElement('div');actions.className='notification-actions';buttons.forEach(([label,task])=>{const button=document.createElement('button');button.textContent=label;button.onclick=()=>action(task,button);actions.append(button);});
 const details=document.createElement('details');details.className='notification-details';const summary=document.createElement('summary');summary.textContent='Details';const description=document.createElement('p');description.textContent=text;details.append(summary,description);body.append(details);
 card.append(avatar,body,actions);list.append(card);
}
