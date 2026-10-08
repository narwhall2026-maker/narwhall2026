const supabaseUrl = "https://ygqztfamrwrkoiyiuwmr.supabase.co";
const supabaseKey = "sb_publishable_d5xpbwqtmuKGhbf8vEGO2w_N4gP0SdA";
let supabaseClient = null;
let selectedPhoto = null;
let selectedPhotoUrl = null;
const MAX_CAPTION_CHARS = 15;

function chars(value) {
  return Array.from(value || "").slice(0, MAX_CAPTION_CHARS).join("");
}

function showScreen(screen) {
  const ids = ["wall", "friendsScreen", "profileScreen", "peekScreen", "signupScreen", "loginScreen"];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });

  if (screen === "wall") {
    document.getElementById("wall").style.display = "block";
    loadMoments();
  } else if (screen === "friends") {
    document.getElementById("friendsScreen").style.display = "block";
    loadFriendRequests();
    loadFriends();
    loadSharedMomentRequests();
  } else if (screen === "profile") {
    document.getElementById("profileScreen").style.display = "block";
    loadProfile();
  } else {
    const el = document.getElementById(screen + "Screen");
    if (el) el.style.display = "block";
  }
}

function handlePhotoSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  selectedPhoto = file;
  const preview = document.getElementById("photoPreview");
  if (preview) {
    if (selectedPhotoUrl) URL.revokeObjectURL(selectedPhotoUrl);
    selectedPhotoUrl = URL.createObjectURL(file);
    preview.innerHTML = `<img src="${selectedPhotoUrl}" alt="Photo preview">`;
  }
}

if (window.supabase) {
  supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
}

function openCapture() {
  document.getElementById("capturePanel").classList.add("open");
  document.getElementById("momentCaption").focus();
  updateWordCount();
  loadShareFriends();
}

function closeCapture() {
  document.getElementById("capturePanel").classList.remove("open");
}

function updateWordCount() {
  const input = document.getElementById("momentCaption");
  if (!input) return;
  const value = chars(input.value);
  if (input.value !== value) input.value = value;
  document.getElementById("wordCount").textContent = Array.from(value).length;
}

async function loadShareFriends() {
  const shareFriend = document.getElementById("shareFriend");
  if (!shareFriend || !supabaseClient) return;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  const { data: profile, error: profileError } = await supabaseClient.from("profiles").select("username").eq("id", user.id).single();
  if (profileError) return console.error(profileError);
  const { data: requests, error } = await supabaseClient.from("friend_requests").select("*").eq("status", "accepted").or(`sender_username.ilike.${profile.username},receiver_username.ilike.${profile.username}`);
  if (error) return console.error(error);
  shareFriend.innerHTML = '<option value="">Just me</option>';
  (requests || []).forEach(request => {
    const friend = request.sender_username.toLowerCase() === profile.username.toLowerCase() ? request.receiver_username : request.sender_username;
    const option = document.createElement("option");
    option.value = friend;
    option.textContent = friend;
    shareFriend.appendChild(option);
  });
}

async function saveMoment() {
  const captionInput = document.getElementById("momentCaption");
  const caption = chars(captionInput.value.trim());
  captionInput.value = caption;
  if (!selectedPhoto) return alert("Add a photo first 🐋");
  if (!caption) return alert("Add a caption first 🐋");
  if (Array.from(caption).length > MAX_CAPTION_CHARS) return alert("Keep your caption to 15 characters or less 🐋");

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return alert("Please log in first 🐋");

  const fileName = Date.now() + "-" + selectedPhoto.name.replace(/[^a-zA-Z0-9.-]/g, "-");
  const { error: uploadError } = await supabaseClient.storage.from("moments").upload(fileName, selectedPhoto);
  if (uploadError) {
    console.error(uploadError);
    return alert("Couldn't upload your photo yet.");
  }

  const { data: savedMoment, error: databaseError } = await supabaseClient.from("moments").insert({
    user_id: user.id,
    caption,
    photo_url: fileName,
    position_x: Math.floor(Math.random() * 55) + 8,
    position_y: Math.floor(Math.random() * 55) + 8,
    rotation: Math.floor(Math.random() * 13) - 6
  }).select().single();

  if (databaseError) {
    console.error(databaseError);
    return alert("Photo uploaded, but the moment couldn't be saved.");
  }

  const shareFriend = document.getElementById("shareFriend").value;
  if (shareFriend) {
    const { data: friendProfile, error: friendError } = await supabaseClient.from("profiles").select("id").ilike("username", shareFriend).single();
    if (friendError) return alert("Moment saved, but your friend couldn't be found.");
    const { error: shareError } = await supabaseClient.from("shared_moments").insert({ moment_id: savedMoment.id, from_user_id: user.id, to_user_id: friendProfile.id, status: "pending" });
    if (shareError) return alert("Moment saved, but the friend request couldn't be sent.");
  }

  alert("Moment saved! 🐋");
  document.getElementById("momentCaption").value = "";
  document.getElementById("momentPhoto").value = "";
  document.getElementById("photoPreview").innerHTML = "";
  if (selectedPhotoUrl) URL.revokeObjectURL(selectedPhotoUrl);
  selectedPhoto = null;
  selectedPhotoUrl = null;
  updateWordCount();
  closeCapture();
  loadMoments();
}

async function loadMoments() {
  if (!supabaseClient) return;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  const { data, error } = await supabaseClient.from("moments").select("*").eq("user_id", user.id).is("deleted_at", null).order("created_at", { ascending: false });
  if (error) return console.error("Couldn't load moments:", error);
  const wall = document.getElementById("wall");
  if (!wall) return;
  wall.innerHTML = "";
  if (!data || data.length === 0) {
    wall.innerHTML = '<div class="wall-empty">Your first moment is waiting to be captured ✦</div>';
    return;
  }

  for (let i = 0; i < data.length; i++) {
    const moment = data[i];
    const polaroid = document.createElement("div");
    polaroid.className = "polaroid";
    polaroid.style.zIndex = data.length - i;
    polaroid.style.left = Math.min(moment.position_x ?? 10, 70) + "%";
    polaroid.style.top = Math.min(moment.position_y ?? 10, 60) + "%";
    polaroid.style.transform = `rotate(${moment.rotation ?? 0}deg)`;
    polaroid.style.cursor = "grab";
    polaroid.style.touchAction = "none";

    const image = document.createElement("img");
    image.alt = "Moment photo";
    const { data: signedUrlData, error: signedUrlError } = await supabaseClient.storage.from("moments").createSignedUrl(moment.photo_url, 60 * 60);
    if (signedUrlError) continue;
    image.src = signedUrlData.signedUrl;

    const caption = document.createElement("div");
    caption.className = "polaroid-caption";
    caption.textContent = moment.caption || "";

    const deleteButton = document.createElement("button");
    deleteButton.className = "trash";
    deleteButton.textContent = "×";
    deleteButton.title = "Hide moment";
    deleteButton.addEventListener("click", async event => {
      event.stopPropagation();
      if (!confirm("Hide this moment from your wall?")) return;
      const { error: deleteError } = await supabaseClient.from("moments").update({ deleted_at: new Date().toISOString() }).eq("id", moment.id).eq("user_id", user.id);
      if (deleteError) return alert("Couldn't delete that moment.");
      loadMoments();
    });

    polaroid.appendChild(image);
    polaroid.appendChild(caption);
    polaroid.appendChild(deleteButton);
    wall.appendChild(polaroid);
    enableDrag(polaroid, wall, moment, user);
  }
}

function enableDrag(polaroid, wall, moment, user) {
  let dragging = false, startX = 0, startY = 0, originalLeft = moment.position_x || 10, originalTop = moment.position_y || 10;
  function startDrag(x, y) { dragging = true; startX = x; startY = y; originalLeft = parseFloat(polaroid.style.left); originalTop = parseFloat(polaroid.style.top); polaroid.style.cursor = "grabbing"; polaroid.style.zIndex = 9999; }
  function moveDrag(x, y) {
    if (!dragging) return;
    const rect = wall.getBoundingClientRect();
    const newLeft = Math.max(0, Math.min(75, originalLeft + ((x - startX) / rect.width) * 100));
    const newTop = Math.max(0, Math.min(70, originalTop + ((y - startY) / rect.height) * 100));
    polaroid.style.left = newLeft + "%";
    polaroid.style.top = newTop + "%";
  }
  async function endDrag() {
    if (!dragging) return;
    dragging = false;
    polaroid.style.cursor = "grab";
    const { error } = await supabaseClient.from("moments").update({ position_x: Math.round(parseFloat(polaroid.style.left)), position_y: Math.round(parseFloat(polaroid.style.top)) }).eq("id", moment.id).eq("user_id", user.id);
    if (error) console.error("Couldn't save photo position:", error);
  }
  polaroid.addEventListener("mousedown", e => { if (e.target.closest(".trash")) return; e.preventDefault(); startDrag(e.clientX, e.clientY); });
  const move = e => moveDrag(e.clientX, e.clientY);
  const up = () => endDrag();
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
  polaroid.addEventListener("touchstart", e => { if (e.target.closest(".trash")) return; const t = e.touches[0]; startDrag(t.clientX, t.clientY); }, { passive: true });
  polaroid.addEventListener("touchmove", e => { if (!dragging) return; const t = e.touches[0]; moveDrag(t.clientX, t.clientY); }, { passive: true });
  polaroid.addEventListener("touchend", endDrag);
}

async function loadProfile() {
  if (!supabaseClient) return;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  const { data } = await supabaseClient.from("profiles").select("username, display_name").eq("id", user.id).single();
  if (data) document.getElementById("username").value = data.username || "";
}

async function saveUsername() {
  if (!supabaseClient) return;
  const username = document.getElementById("username").value.trim().toLowerCase();
  if (!username) return alert("Please choose a username 🐋");
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return alert("Please log in first 🐋");
  const { error } = await supabaseClient.from("profiles").upsert({ id: user.id, username });
  if (error) return alert("Couldn't save username.");
  alert("Username saved 🐋");
}

async function signup() {
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;
  const username = document.getElementById("signupUsername").value.trim().toLowerCase();
  if (!email || !password || !username) return alert("Please fill everything in 🐋");
  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  if (error) return alert(error.message);
  if (!data.user) return alert("Please check your email to confirm your account.");
  const { error: profileError } = await supabaseClient.from("profiles").upsert({ id: data.user.id, username });
  if (profileError) return alert("Account created, but username could not be saved.");
  alert("Account created 🐋");
  showScreen("profile");
  await loadProfile();
}

async function login() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  if (!email || !password) return alert("Please enter your email and password.");
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) return alert(error.message);
  alert("Logged in 🐋");
  showScreen("wall");
  await loadProfile();
  await loadMoments();
  await loadFriendRequests();
  await loadFriends();
}

async function addFriend() {
  const username = prompt("Enter your friend's username:");
  if (!username) return;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return alert("Please log in first 🐋");
  const { data: profile } = await supabaseClient.from("profiles").select("username").ilike("username", username.trim()).maybeSingle();
  if (!profile) return alert("Couldn't find that username.");
  const { data: senderProfile } = await supabaseClient.from("profiles").select("username").eq("id", user.id).single();
  if (!senderProfile) return alert("Please save your username first.");
  const { error } = await supabaseClient.from("friend_requests").insert({ sender_username: senderProfile.username, receiver_username: profile.username, status: "pending" });
  if (error) return alert("Couldn't send friend request.");
  alert("Friend request sent 🐋");
  loadFriendRequests();
}

async function loadFriendRequests() {
  const container = document.getElementById("friendRequests");
  if (!container || !supabaseClient) return;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return container.innerHTML = "<p>Please log in first.</p>";
  const { data: profile } = await supabaseClient.from("profiles").select("username").eq("id", user.id).single();
  if (!profile) return container.innerHTML = "<p>Save your username first.</p>";
  const { data, error } = await supabaseClient.from("friend_requests").select("*").ilike("receiver_username", profile.username).order("created_at", { ascending: false });
  if (error) return container.innerHTML = "<p>Couldn't load requests.</p>";
  const pending = (data || []).filter(r => r.status === "pending");
  if (!pending.length) return container.innerHTML = "<p>No friend requests yet.</p>";
  container.innerHTML = "";
  pending.forEach(request => {
    const box = document.createElement("div");
    box.innerHTML = `<p><strong>${request.sender_username}</strong> wants to be your friend.</p><button onclick="acceptFriend(${request.id})">Accept</button><button onclick="declineFriend(${request.id})">Decline</button>`;
    container.appendChild(box);
  });
}

async function acceptFriend(id) {
  const { error } = await supabaseClient.from("friend_requests").update({ status: "accepted" }).eq("id", id);
  if (error) return alert("Couldn't accept friend request.");
  alert("Friend added 🐋");
  loadFriendRequests();
  loadFriends();
}

async function declineFriend(id) {
  const { error } = await supabaseClient.from("friend_requests").update({ status: "declined" }).eq("id", id);
  if (error) return alert("Couldn't decline request.");
  loadFriendRequests();
}

async function loadFriends() {
  const container = document.getElementById("friendsList");
  if (!container || !supabaseClient) return;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return container.innerHTML = "<p>Please log in first.</p>";
  const { data: profile } = await supabaseClient.from("profiles").select("username").eq("id", user.id).single();
  if (!profile) return;
  const { data: sent } = await supabaseClient.from("friend_requests").select("*").ilike("sender_username", profile.username).eq("status", "accepted");
  const { data: received } = await supabaseClient.from("friend_requests").select("*").ilike("receiver_username", profile.username).eq("status", "accepted");
  const friends = [...(sent || []).map(r => r.receiver_username), ...(received || []).map(r => r.sender_username)];
  const uniqueFriends = [...new Set(friends)];
  if (!uniqueFriends.length) return container.innerHTML = "<p>No friends yet 🐋</p>";
  container.innerHTML = "";
  uniqueFriends.forEach(friend => {
    const box = document.createElement("div");
    const p = document.createElement("p");
    p.innerHTML = `<strong>${friend}</strong>`;
    const button = document.createElement("button");
    button.textContent = "👀 Peek";
    button.onclick = () => openPeek(friend);
    p.appendChild(button);
    box.appendChild(p);
    container.appendChild(box);
  });
}

async function openPeek(friendUsername) {
  showScreen("peek");
  document.getElementById("peekTitle").textContent = `${friendUsername}'s Wall 👀`;
  const content = document.getElementById("peekContent");
  content.innerHTML = "<p>Loading their wall...</p>";
  const { data: friendProfile } = await supabaseClient.from("profiles").select("id").ilike("username", friendUsername).maybeSingle();
  if (!friendProfile) return content.innerHTML = "<p>Couldn't find that wall.</p>";
  const { data: moments, error } = await supabaseClient.from("moments").select("*").eq("user_id", friendProfile.id).is("deleted_at", null).order("created_at", { ascending: false }).limit(10);
  if (error) return content.innerHTML = "<p>Couldn't load their wall.</p>";
  if (!moments?.length) return content.innerHTML = "<p>No moments to peek at yet 🐋</p>";
  content.innerHTML = "";
  for (const moment of moments) {
    const card = document.createElement("div");
    card.className = "polaroid peek-card";
    const { data: signedData } = await supabaseClient.storage.from("moments").createSignedUrl(moment.photo_url, 3600);
    if (signedData?.signedUrl) {
      const img = document.createElement("img");
      img.src = signedData.signedUrl;
      img.alt = "Shared moment";
      card.appendChild(img);
    }
    const p = document.createElement("p");
    p.textContent = moment.caption || "";
    card.appendChild(p);
    content.appendChild(card);
  }
}

function closePeek() { showScreen("friends"); }

async function loadSharedMomentRequests() {
  const container = document.getElementById("sharedMomentRequests");
  if (!container || !supabaseClient) return;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return container.innerHTML = "<p>Please log in first.</p>";
  const { data, error } = await supabaseClient.from("shared_moments").select("*").or(`to_user_id.eq.${user.id},from_user_id.eq.${user.id}`).order("created_at", { ascending: false });
  if (error) return container.innerHTML = "<p>Couldn't load shared moments.</p>";
  if (!data?.length) return container.innerHTML = "<p>No shared moments yet 🐋</p>";
  container.innerHTML = "";
  data.forEach(request => {
    const box = document.createElement("div");
    if (request.to_user_id === user.id && request.status === "pending") box.innerHTML = `<p>Someone shared a moment with you 🐋</p><button onclick="acceptSharedMoment('${request.id}')">Accept</button><button onclick="declineSharedMoment('${request.id}')">Decline</button>`;
    else if (request.to_user_id === user.id && request.status === "accepted") box.innerHTML = `<p>🐋 Shared moment accepted!</p><p>This moment is pinned to your wall.</p>`;
    else if (request.from_user_id === user.id && request.status === "accepted") box.innerHTML = `<p>🐋 Your shared moment was accepted!</p><p>The moment is now pinned to their wall.</p>`;
    else if (request.from_user_id === user.id && request.status === "declined") box.innerHTML = `<p>Shared moment was declined.</p>`;
    else return;
    container.appendChild(box);
  });
}

async function acceptSharedMoment(id) {
  const { data: request } = await supabaseClient.from("shared_moments").select("*").eq("id", id).single();
  if (!request) return alert("Couldn't find that shared moment.");
  const { data: originalMoment } = await supabaseClient.from("moments").select("*").eq("id", request.moment_id).single();
  if (!originalMoment) return alert("Couldn't find the shared photo.");
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return alert("Please log in first.");
  const { error: copyError } = await supabaseClient.from("moments").insert({ user_id: user.id, caption: originalMoment.caption, photo_url: originalMoment.photo_url, position_x: originalMoment.position_x, position_y: originalMoment.position_y, rotation: originalMoment.rotation });
  if (copyError) return alert("Couldn't pin the shared moment.");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabaseClient.from("shared_moments").update({ status: "accepted", expires_at: expiresAt }).eq("id", id);
  if (error) return alert("Couldn't accept shared moment.");
  await supabaseClient.from("wall_peeks").insert({ owner_id: request.from_user_id, viewer_id: request.to_user_id, shared_moment_id: request.id, expires_at: expiresAt });
  alert("Shared moment pinned to your wall 🐋");
  await loadSharedMomentRequests();
  await loadMoments();
}

async function declineSharedMoment(id) {
  const { error } = await supabaseClient.from("shared_moments").update({ status: "declined" }).eq("id", id);
  if (error) return alert("Couldn't decline shared moment.");
  loadSharedMomentRequests();
}

document.addEventListener("DOMContentLoaded", async () => {
  const captionInput = document.getElementById("momentCaption");
  if (captionInput) captionInput.addEventListener("input", updateWordCount);
  const photoInput = document.getElementById("momentPhoto");
  if (photoInput) photoInput.addEventListener("change", handlePhotoSelect);
  const saveUsernameButton = document.getElementById("saveUsernameButton");
  if (saveUsernameButton) saveUsernameButton.addEventListener("click", saveUsername);
  const signupButton = document.getElementById("signupButton");
  if (signupButton) signupButton.addEventListener("click", signup);
  const loginButton = document.getElementById("loginButton");
  if (loginButton) loginButton.addEventListener("click", login);
  await loadProfile();
  await loadMoments();
  await loadFriendRequests();
  await loadFriends();
  await loadSharedMomentRequests();
});