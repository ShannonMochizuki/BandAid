
const STORAGE_KEY = "chordVaultSongsV1";

let songs = loadSongs();
let editingId = null;
let readingId = null;
let activeRole = localStorage.getItem("chordVaultActiveRole") || "Singers";
const ROLES = ["Worship Leader","Singers","Electric Guitar","Acoustic Guitar","Bass Guitar","Drum"];
if(!ROLES.includes(activeRole)) activeRole = "Singers";

const $ = (id) => document.getElementById(id);
const qsa = (sel) => [...document.querySelectorAll(sel)];

function loadSongs(){
  try {
    const loaded = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    // v1.4 migration: keep existing songs visible by assigning older entries
    // to Acoustic Guitar unless they already have a role.
    return loaded.map(song => ({...song, role: song.role || "Acoustic Guitar", bpm: song.bpm || ""}));
  }
  catch(e){ return []; }
}
function persist(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
}
function uid(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2,8);
}
function esc(s=""){
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function showView(id){
  qsa(".view").forEach(v=>v.classList.remove("active"));
  $(id).classList.add("active");
  window.scrollTo({top:0,behavior:"smooth"});
}
function normalizeFrets(raw=""){
  raw = raw.trim();
  if(!raw) return [];
  if(raw.includes("-") || raw.includes(" ")) return raw.split(/[-\s,]+/).filter(Boolean);
  return raw.split("");
}
function makeDiagram(name, fretsRaw, fingersRaw){
  const frets = normalizeFrets(fretsRaw);
  const fingers = normalizeFrets(fingersRaw);
  if(frets.length !== 6) return `<span class="hint">Enter 6 strings to preview.</span>`;
  const nums = frets.map(x => (/^\d+$/.test(x) ? Number(x) : null)).filter(x=>x!==null && x>0);
  if(!nums.length) return `<span class="hint">Open/muted chord shape saved.</span>`;
  const minFret = Math.max(1, Math.min(...nums.filter(n=>n>0)));
  let cells = "";
  for(let string=0; string<6; string++){
    const f = frets[string];
    if(/^\d+$/.test(f) && Number(f)>0){
      const row = Math.min(5, Math.max(1, Number(f)-minFret+1));
      const finger = fingers[string] && fingers[string] !== "0" && fingers[string].toLowerCase() !== "x" ? fingers[string] : "";
      cells += `<span class="fret-dot" style="grid-column:${string+1};grid-row:${row}">${esc(finger)}</span>`;
    }
  }
  return `<span class="shape-label">${esc(name || "")}</span><div class="chord-diagram">${cells}</div><span class="hint">base fret ${minFret}</span>`;
}
function addShapeCard(shape={name:"",frets:"",fingers:""}){
  const node = $("shapeTemplate").content.firstElementChild.cloneNode(true);
  node.querySelector(".shape-name").value = shape.name || "";
  node.querySelector(".shape-frets").value = shape.frets || "";
  node.querySelector(".shape-fingers").value = shape.fingers || "";
  const render = () => {
    node.querySelector(".shape-preview").innerHTML = makeDiagram(
      node.querySelector(".shape-name").value,
      node.querySelector(".shape-frets").value,
      node.querySelector(".shape-fingers").value
    );
  };
  node.querySelectorAll("input").forEach(i=>i.addEventListener("input",render));
  node.querySelector(".remove-shape").addEventListener("click",()=>node.remove());
  $("shapeList").appendChild(node);
  render();
}
function currentShapes(){
  return qsa("#shapeList .shape-card").map(card=>({
    name: card.querySelector(".shape-name").value.trim(),
    frets: card.querySelector(".shape-frets").value.trim(),
    fingers: card.querySelector(".shape-fingers").value.trim()
  })).filter(s=>s.name || s.frets || s.fingers);
}
function openEditor(song=null){
  editingId = song?.id || null;
  $("songTitle").value = song?.title || "";
  $("songArtist").value = song?.artist || "";
  $("songRole").value = song?.role || activeRole;
  $("songKey").value = song?.key || "";
  $("songCapo").value = song?.capo || "";
  $("songBpm").value = song?.bpm || "";
  $("songChords").value = song?.chords || "";
  $("songTabs").value = song?.tabs || "";
  $("songNotes").value = song?.notes || "";
  $("shapeList").innerHTML = "";
  (song?.shapes || []).forEach(addShapeCard);
  $("deleteBtn").style.visibility = song ? "visible" : "hidden";
  qsa(".tab").forEach((b,i)=>b.classList.toggle("active",i===0));
  qsa(".panel").forEach((p,i)=>p.classList.toggle("active",i===0));
  showView("editorView");
}
function saveEditor(){
  const title = $("songTitle").value.trim();
  if(!title){
    alert("Please enter a song title.");
    $("songTitle").focus();
    return;
  }
  const now = new Date().toISOString();
  const obj = {
    id: editingId || uid(),
    title,
    artist:$("songArtist").value.trim(),
    role:$("songRole").value,
    key:$("songKey").value.trim(),
    capo:$("songCapo").value.trim(),
    bpm:$("songBpm").value.trim(),
    chords:$("songChords").value,
    tabs:$("songTabs").value,
    notes:$("songNotes").value,
    shapes:currentShapes(),
    createdAt: editingId ? (songs.find(s=>s.id===editingId)?.createdAt || now) : now,
    updatedAt: now
  };
  const idx = songs.findIndex(s=>s.id===obj.id);
  if(idx>=0) songs[idx] = obj; else songs.unshift(obj);
  persist();
  activeRole = obj.role;
  localStorage.setItem("chordVaultActiveRole", activeRole);
  if($("currentRoleLabel")) $("currentRoleLabel").textContent = activeRole;
updateRoleTools();
  renderLibrary();
  openReader(obj.id);
}
function deleteEditing(){
  if(!editingId) return;
  const song = songs.find(s=>s.id===editingId);
  if(confirm(`Delete "${song?.title || "this song"}"?`)){
    songs = songs.filter(s=>s.id!==editingId);
    persist();
    renderLibrary();
    showView("libraryView");
  }
}
function openReader(id){
  const s = songs.find(x=>x.id===id);
  if(!s) return;
  readingId = id;
  $("readerTitle").textContent = s.title;
  $("readerArtist").textContent = s.artist || "UNTITLED ARTIST";
  const pills = [];
  if(s.role) pills.push(`<span class="meta-pill">${esc(s.role)}</span>`);
  if(s.key) pills.push(`<span class="meta-pill">Key ${esc(s.key)}</span>`);
  if(s.capo) pills.push(`<span class="meta-pill">Capo ${esc(s.capo)}</span>`);
  if(s.bpm) pills.push(`<span class="meta-pill">${esc(String(s.bpm))} BPM</span>`);
  $("readerMeta").innerHTML = pills.join("");
  $("readerChords").textContent = s.chords || "No chord chart saved.";
  $("readerTabs").textContent = s.tabs || "No guitar tab saved.";
  $("readerNotes").textContent = s.notes || "No notes saved.";
  $("readerShapes").innerHTML = (s.shapes?.length ? s.shapes.map(shape => 
    `<div class="reader-shape">${makeDiagram(shape.name,shape.frets,shape.fingers)}
     <div class="hint mono">${esc(shape.frets)}${shape.fingers ? " · fingers " + esc(shape.fingers) : ""}</div></div>`
  ).join("") : "No chord shapes saved.");
  qsa(".reader-tab").forEach((b,i)=>b.classList.toggle("active",i===0));
  qsa(".reader-panel").forEach((p,i)=>p.classList.toggle("active",i===0));
  const tester = $("singerKeyTester");
  if(tester){
    tester.classList.toggle("hidden", activeRole !== "Singers");
    const preferred = NOTE_INDEX[s.key] != null ? s.key : "C";
    const select = $("testKeySelect");
    if([...select.options].some(o=>o.value===preferred)) select.value = preferred;
    $("keyTestProgression").textContent = keyTestProgression(s, select.value).join("  ·  ");
  }
  showView("readerView");
}
function renderLibrary(){
  const term = $("searchInput").value.trim().toLowerCase();
  const sort = $("sortSelect").value;
  let filtered = songs.filter(s =>
    (s.role || "Acoustic Guitar") === activeRole &&
    [s.title,s.artist,s.key,s.bpm,s.chords,s.notes].join(" ").toLowerCase().includes(term)
  );
  filtered.sort((a,b)=>{
    if(sort==="title") return a.title.localeCompare(b.title);
    if(sort==="artist") return (a.artist||"").localeCompare(b.artist||"");
    return new Date(b.updatedAt)-new Date(a.updatedAt);
  });
  $("songList").innerHTML = filtered.map(s=>{
    const badges = [
      s.key ? `<span class="badge">Key ${esc(s.key)}</span>`:"",
      s.capo ? `<span class="badge">Capo ${esc(s.capo)}</span>`:"",
      s.bpm ? `<span class="badge">${esc(String(s.bpm))} BPM</span>`:"",
      s.tabs ? `<span class="badge">Tab</span>`:"",
      s.shapes?.length ? `<span class="badge">${s.shapes.length} shape${s.shapes.length>1?"s":""}</span>`:""
    ].join("");
    const snippet = (s.chords || s.tabs || s.notes || "").trim().slice(0,130);
    return `<div class="song-card" data-id="${s.id}">
      <div class="eyebrow">${esc(s.artist || "NO ARTIST")}</div>
      <h3>${esc(s.title)}</h3>
      <div class="badge-row">${badges}</div>
      ${snippet ? `<div class="snippet mono">${esc(snippet)}</div>`:""}
    </div>`;
  }).join("");
  qsa(".song-card").forEach(c=>c.addEventListener("click",()=>openReader(c.dataset.id)));
  const roleCount = songs.filter(s => (s.role || "Acoustic Guitar") === activeRole).length;
  $("stats").textContent = `${roleCount} song${roleCount===1?"":"s"} in ${activeRole}`;
  $("emptyState").classList.toggle("hidden", roleCount>0 || term);
}
function setActiveRole(role){
  if(!ROLES.includes(role)) return;
  activeRole = role;
  localStorage.setItem("chordVaultActiveRole", role);
  if($("currentRoleLabel")) $("currentRoleLabel").textContent = role;
  updateRoleTools();
  renderLibrary();
  showView("libraryView");
}

qsa(".role-card").forEach(card => card.addEventListener("click",()=>setActiveRole(card.dataset.role)));
$("changeRoleBtn").addEventListener("click",()=>showView("roleView"));
if($("currentRoleLabel")) $("currentRoleLabel").textContent = activeRole;

$("newSongBtn").addEventListener("click",()=>openEditor());
$("emptyAddBtn").addEventListener("click",()=>openEditor());
$("backBtn").addEventListener("click",()=>{renderLibrary();showView("libraryView")});
$("readerBackBtn").addEventListener("click",()=>{renderLibrary();showView("libraryView")});
$("saveBtn").addEventListener("click",saveEditor);
$("deleteBtn").addEventListener("click",deleteEditing);
$("editBtn").addEventListener("click",()=>openEditor(songs.find(s=>s.id===readingId)));
$("addShapeBtn").addEventListener("click",()=>addShapeCard());
$("searchInput").addEventListener("input",renderLibrary);
$("sortSelect").addEventListener("change",renderLibrary);

qsa(".tab").forEach(btn=>btn.addEventListener("click",()=>{
  qsa(".tab").forEach(b=>b.classList.remove("active"));
  qsa(".panel").forEach(p=>p.classList.remove("active"));
  btn.classList.add("active");
  $(btn.dataset.panel).classList.add("active");
}));
qsa(".reader-tab").forEach(btn=>btn.addEventListener("click",()=>{
  qsa(".reader-tab").forEach(b=>b.classList.remove("active"));
  qsa(".reader-panel").forEach(p=>p.classList.remove("active"));
  btn.classList.add("active");
  $(btn.dataset.rpanel).classList.add("active");
}));


// v1.9 — Supabase live sessions + Worship Leader cues
const SUPABASE_URL = "https://qxfcpkbggzhvqapzwflf.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_pXykwrt70vDqIGQdhmGMwQ_yz3KCUU5";
const LIVE_SESSION_STORAGE_KEY = "bandaidLiveSessionV1";
const LIVE_CUE_KEY = "bandaidLiveCueV1";

let supabaseClient = null;
let supabaseUser = null;
let realtimeChannel = null;
let liveSession = loadLiveSession();
let cueChannel = null;
try { cueChannel = new BroadcastChannel("bandaid-live-cues-v1"); } catch(e) {}

function loadLiveSession(){
  try { return JSON.parse(localStorage.getItem(LIVE_SESSION_STORAGE_KEY)) || null; }
  catch(e){ return null; }
}
function saveLiveSession(session){
  liveSession = session;
  if(session) localStorage.setItem(LIVE_SESSION_STORAGE_KEY, JSON.stringify(session));
  else localStorage.removeItem(LIVE_SESSION_STORAGE_KEY);
  renderLiveSessionUI();
}
function roleSlug(role){
  return ({
    "Worship Leader":"worship-leader",
    "Singers":"singer",
    "Electric Guitar":"electric-guitar",
    "Acoustic Guitar":"acoustic-guitar",
    "Bass Guitar":"bass-guitar",
    "Drum":"drum"
  })[role] || "singer";
}
function makeSessionCode(){
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  crypto.getRandomValues(new Uint8Array(6)).forEach(n => code += alphabet[n % alphabet.length]);
  return code;
}
function setSessionStatus(message, state=""){
  const status = $("sessionStatus");
  const badge = $("liveSessionBadge");
  if(status) status.textContent = message;
  if(badge){
    badge.classList.remove("live","connecting","error");
    if(state) badge.classList.add(state);
    badge.textContent = state === "live" ? "● Live" : state === "connecting" ? "Connecting…" : state === "error" ? "Error" : "Offline";
  }
}
function renderLiveSessionUI(){
  const leaderActions = $("leaderSessionActions");
  const memberActions = $("memberSessionActions");
  const connected = $("connectedSession");
  if(!leaderActions || !memberActions || !connected) return;
  const isLeader = activeRole === "Worship Leader";
  leaderActions.classList.toggle("hidden", !!liveSession || !isLeader);
  memberActions.classList.toggle("hidden", !!liveSession || isLeader);
  connected.classList.toggle("hidden", !liveSession);
  if(liveSession){
    $("connectedSessionCode").textContent = liveSession.code || "LIVE";
    $("liveSessionTitle").textContent = "Band connected";
    $("liveSessionHelp").textContent = isLeader ? "Your cue buttons will broadcast to this session." : "Worship Leader cues will appear on this device.";
    setSessionStatus(`Connected as ${activeRole}.`, "live");
  }else{
    $("liveSessionTitle").textContent = isLeader ? "Start a live session" : "Join the live session";
    $("liveSessionHelp").textContent = isLeader ? "Create a short session code and share it with the band." : "Enter the session code shown by your Worship Leader.";
    setSessionStatus("Not connected.");
  }
  const cueBadge = $("cueConnectionBadge");
  if(cueBadge) cueBadge.textContent = liveSession ? "● Live" : "Not connected";
  qsa(".cue-btn").forEach(btn => btn.disabled = isLeader && !liveSession);
}

function updateRoleTools(){
  const worshipPanel = $("worshipCuePanel");
  if(worshipPanel) worshipPanel.classList.toggle("hidden", activeRole !== "Worship Leader");
  const banner = $("liveCueBanner");
  if(banner && activeRole === "Worship Leader") banner.classList.add("hidden");
  renderLiveSessionUI();
}

function showLiveCue(cue, source="Worship Leader"){
  if(!cue || activeRole === "Worship Leader") return;
  const banner = $("liveCueBanner");
  if(!banner) return;
  const label = cue.label || cue.cue || cue;
  $("liveCueText").textContent = label;
  const sentAt = cue.sentAt || cue.created_at;
  $("liveCueTime").textContent = sentAt ? new Date(sentAt).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}) : "now";
  banner.classList.remove("hidden");
  banner.classList.remove("cue-pulse");
  void banner.offsetWidth;
  banner.classList.add("cue-pulse");
  if(navigator.vibrate) navigator.vibrate(80);
}

async function ensureSupabaseAuth(){
  if(!window.supabase?.createClient) throw new Error("Supabase library could not load. Check your internet connection.");
  if(!supabaseClient){
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
    });
  }
  const {data:{session}} = await supabaseClient.auth.getSession();
  if(session?.user){ supabaseUser = session.user; return session.user; }
  const {data,error} = await supabaseClient.auth.signInAnonymously();
  if(error) throw error;
  supabaseUser = data.user;
  return data.user;
}

async function subscribeToLiveSession(){
  if(!supabaseClient || !liveSession?.id) return;
  if(realtimeChannel){
    try { await supabaseClient.removeChannel(realtimeChannel); } catch(e) {}
    realtimeChannel = null;
  }
  realtimeChannel = supabaseClient
    .channel(`bandaid-cues-${liveSession.id}`)
    .on("postgres_changes", {
      event:"INSERT", schema:"public", table:"worship_cues", filter:`session_id=eq.${liveSession.id}`
    }, payload => showLiveCue(payload.new))
    .subscribe(status => {
      if(status === "SUBSCRIBED") setSessionStatus(`Connected as ${activeRole}.`, "live");
      else if(status === "CHANNEL_ERROR" || status === "TIMED_OUT") setSessionStatus("Realtime connection problem. Retrying…", "error");
    });
}

async function createLiveSession(){
  try{
    setSessionStatus("Creating live session…", "connecting");
    const user = await ensureSupabaseAuth();
    let lastError = null;
    for(let attempt=0; attempt<4; attempt++){
      const code = makeSessionCode();
      const {data,error} = await supabaseClient.rpc("create_band_session", {session_code:code});
      if(!error && data){
        saveLiveSession({id:data, code, role:"worship-leader", userId:user.id});
        await subscribeToLiveSession();
        return;
      }
      lastError = error;
      if(!String(error?.message||"").toLowerCase().includes("duplicate")) break;
    }
    throw lastError || new Error("Could not create the session.");
  }catch(err){
    console.error(err);
    setSessionStatus(`Could not create session: ${err.message}`, "error");
  }
}

async function joinLiveSession(){
  const code = $("sessionCodeInput").value.trim().toUpperCase();
  if(!code){ $("sessionCodeInput").focus(); return; }
  if(activeRole === "Worship Leader") return;
  try{
    setSessionStatus("Joining session…", "connecting");
    const user = await ensureSupabaseAuth();
    const {data,error} = await supabaseClient.rpc("join_band_session", {join_code:code, selected_role:roleSlug(activeRole)});
    if(error) throw error;
    saveLiveSession({id:data, code, role:roleSlug(activeRole), userId:user.id});
    await subscribeToLiveSession();
  }catch(err){
    console.error(err);
    setSessionStatus(err.message?.includes("Session not found") ? "Session code not found." : `Could not join: ${err.message}`, "error");
  }
}

async function leaveLiveSession(){
  if(realtimeChannel && supabaseClient){
    try { await supabaseClient.removeChannel(realtimeChannel); } catch(e) {}
  }
  realtimeChannel = null;
  saveLiveSession(null);
}

async function sendLiveCue(label){
  const cue = {label, sentAt:new Date().toISOString(), from:"Worship Leader"};
  localStorage.setItem(LIVE_CUE_KEY, JSON.stringify(cue));
  if(cueChannel) cueChannel.postMessage(cue);
  if(!liveSession){
    setSessionStatus("Create a live session before sending cues.", "error");
    return;
  }
  try{
    const user = await ensureSupabaseAuth();
    const {error} = await supabaseClient.from("worship_cues").insert({
      session_id:liveSession.id,
      cue:label,
      created_by:user.id
    });
    if(error) throw error;
    const status = $("lastCueSent");
    if(status) status.textContent = `Sent: ${label} · ${new Date(cue.sentAt).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}`;
    qsa(".cue-btn").forEach(btn=>btn.classList.toggle("active", btn.dataset.cue === label));
  }catch(err){
    console.error(err);
    setSessionStatus(`Cue failed: ${err.message}`, "error");
  }
}

$("createSessionBtn")?.addEventListener("click",createLiveSession);
$("joinSessionBtn")?.addEventListener("click",joinLiveSession);
$("leaveSessionBtn")?.addEventListener("click",leaveLiveSession);
$("sessionCodeInput")?.addEventListener("keydown",e=>{ if(e.key === "Enter") joinLiveSession(); });
qsa(".cue-btn").forEach(btn => btn.addEventListener("click",()=>sendLiveCue(btn.dataset.cue)));
if(cueChannel) cueChannel.addEventListener("message",event=>showLiveCue(event.data));
window.addEventListener("storage",event=>{
  if(event.key === LIVE_CUE_KEY && event.newValue){
    try { showLiveCue(JSON.parse(event.newValue)); } catch(e) {}
  }
});

async function initLiveBackend(){
  renderLiveSessionUI();
  if(!liveSession) return;
  try{
    await ensureSupabaseAuth();
    await subscribeToLiveSession();
  }catch(err){
    console.error(err);
    setSessionStatus("Saved session found, but live connection is unavailable.", "error");
  }
}
initLiveBackend();

const NOTE_INDEX = {"C":0,"C#":1,"Db":1,"D":2,"D#":3,"Eb":3,"E":4,"F":5,"F#":6,"Gb":6,"G":7,"G#":8,"Ab":8,"A":9,"A#":10,"Bb":10,"B":11,"Cb":11};
const SHARP_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const FLAT_NAMES = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"];
let audioContext = null;
let keyTestNodes = [];
let keyTestTimers = [];

function chordTokens(text=""){
  const tokens = [];
  const regex = /^(?:[A-G](?:#|b)?)(?:m|maj|min|dim|aug|sus|add)?(?:2|4|5|6|7|9|11|13)?(?:\([^)]*\))?(?:\/[A-G](?:#|b)?)?$/;
  text.split(/\n/).forEach(line=>{
    line.trim().split(/\s+/).forEach(token=>{
      const clean = token.replace(/[|,:;]+$/g,"");
      if(regex.test(clean)) tokens.push(clean);
    });
  });
  return tokens.slice(0,8);
}
function parseRoot(chord){
  const m = chord.match(/^([A-G](?:#|b)?)(.*)$/);
  return m ? {root:m[1], suffix:m[2]} : null;
}
function transposeChord(chord, semitones, preferFlats=false){
  const parsed = parseRoot(chord);
  if(!parsed || NOTE_INDEX[parsed.root] == null) return chord;
  const names = preferFlats ? FLAT_NAMES : SHARP_NAMES;
  const idx = (NOTE_INDEX[parsed.root] + semitones + 120) % 12;
  let suffix = parsed.suffix;
  suffix = suffix.replace(/\/([A-G](?:#|b)?)/,(_,bass)=>{
    if(NOTE_INDEX[bass] == null) return "/"+bass;
    return "/"+names[(NOTE_INDEX[bass] + semitones + 120)%12];
  });
  return names[idx] + suffix;
}
function chordMidiNotes(chord){
  const parsed = parseRoot(chord);
  if(!parsed || NOTE_INDEX[parsed.root] == null) return [60,64,67];
  const root = 60 + NOTE_INDEX[parsed.root];
  const suffix = parsed.suffix.toLowerCase();
  let intervals = [0,4,7];
  if(/^m(?!aj)|min/.test(suffix)) intervals=[0,3,7];
  if(suffix.includes("dim")) intervals=[0,3,6];
  if(suffix.includes("aug")) intervals=[0,4,8];
  if(suffix.includes("sus2")) intervals=[0,2,7];
  if(suffix.includes("sus") || suffix.includes("sus4")) intervals=[0,5,7];
  if(suffix.includes("7")) intervals.push(/^maj7/.test(suffix)?11:10);
  return intervals.map(i=>root+i);
}
function midiFreq(note){ return 440 * Math.pow(2,(note-69)/12); }
function stopKeyTest(){
  keyTestTimers.forEach(clearTimeout); keyTestTimers=[];
  keyTestNodes.forEach(node=>{ try{ node.stop?.(); node.disconnect?.(); }catch(e){} }); keyTestNodes=[];
}
function playChord(chord, when, duration){
  if(!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const master = audioContext.createGain();
  master.gain.setValueAtTime(0.0001, when);
  master.gain.exponentialRampToValueAtTime(0.10, when+0.04);
  master.gain.setValueAtTime(0.10, Math.max(when+0.05, when+duration-0.12));
  master.gain.exponentialRampToValueAtTime(0.0001, when+duration);
  master.connect(audioContext.destination);
  keyTestNodes.push(master);
  chordMidiNotes(chord).forEach((note,i)=>{
    const osc = audioContext.createOscillator();
    osc.type = i===0 ? "triangle" : "sine";
    osc.frequency.setValueAtTime(midiFreq(note-12),when);
    osc.connect(master); osc.start(when); osc.stop(when+duration+0.03); keyTestNodes.push(osc);
  });
}
function keyTestProgression(song, targetKey){
  const sourceKey = song?.key && NOTE_INDEX[song.key] != null ? song.key : "C";
  const shift = NOTE_INDEX[targetKey] - NOTE_INDEX[sourceKey];
  const preferFlats = targetKey.includes("b");
  let chords = chordTokens(song?.chords || "");
  if(!chords.length){
    const base = ["C","G","Am","F"];
    const srcShift = NOTE_INDEX[sourceKey];
    chords = base.map(c=>transposeChord(c,srcShift,sourceKey.includes("b")));
  }
  return chords.slice(0,8).map(c=>transposeChord(c,shift,preferFlats));
}
async function playKeyTest(){
  const song = songs.find(s=>s.id===readingId);
  if(!song) return;
  stopKeyTest();
  const targetKey = $("testKeySelect").value;
  const progression = keyTestProgression(song,targetKey);
  $("keyTestProgression").textContent = progression.join("  ·  ");
  if(!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if(audioContext.state === "suspended") await audioContext.resume();
  const bpm = Math.max(40,Math.min(220,Number(song.bpm)||72));
  const chordDur = (60/bpm)*2;
  const start = audioContext.currentTime + 0.05;
  progression.forEach((chord,i)=>playChord(chord,start+i*chordDur,chordDur*0.95));
}

$("playKeyTestBtn").addEventListener("click",playKeyTest);
$("stopKeyTestBtn").addEventListener("click",stopKeyTest);


// v1.6 — Backup & Restore
const BACKUP_FORMAT = "BandAid Chord Vault Backup";
const BACKUP_SCHEMA_VERSION = 1;
const APP_VERSION = "1.9";
let pendingRestore = null;

function backupStatus(message, isError=false){
  const el = $("backupStatus");
  el.textContent = message;
  el.classList.remove("hidden");
  el.style.color = isError ? "#a12a2a" : "";
}

function normalizeImportedSong(song){
  if(!song || typeof song !== "object") return null;
  const now = new Date().toISOString();
  const role = ROLES.includes(song.role) ? song.role : "Acoustic Guitar";
  return {
    id: String(song.id || uid()),
    title: String(song.title || "").trim(),
    artist: String(song.artist || ""),
    role,
    key: String(song.key || ""),
    capo: String(song.capo || ""),
    bpm: String(song.bpm || ""),
    chords: String(song.chords || ""),
    tabs: String(song.tabs || ""),
    notes: String(song.notes || ""),
    shapes: Array.isArray(song.shapes) ? song.shapes.map(shape => ({
      name: String(shape?.name || ""),
      frets: String(shape?.frets || ""),
      fingers: String(shape?.fingers || "")
    })) : [],
    createdAt: song.createdAt || now,
    updatedAt: song.updatedAt || now
  };
}

function exportBackup(){
  const payload = {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    source: {
      app: "Chord Vault",
      repository: "BandAid",
      storageKey: STORAGE_KEY
    },
    data: {
      songs,
      activeRole
    }
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = new Date().toISOString().slice(0,10);
  a.href = url;
  a.download = `BandAid_ChordVault_Backup_${date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
  backupStatus(`Backup exported successfully: ${songs.length} song${songs.length===1?"":"s"}.`);
}

function extractBackup(raw){
  // Current structured BandAid backup format.
  if(raw && typeof raw === "object" && Array.isArray(raw.data?.songs)){
    if(raw.format && raw.format !== BACKUP_FORMAT){
      throw new Error("This JSON file is not a BandAid Chord Vault backup.");
    }
    return {
      songs: raw.data.songs,
      activeRole: ROLES.includes(raw.data.activeRole) ? raw.data.activeRole : null,
      schemaVersion: raw.schemaVersion || 1,
      exportedAt: raw.exportedAt || null
    };
  }
  // Compatibility with a simple/raw song-array export if one is ever used.
  if(Array.isArray(raw)){
    return {songs:raw, activeRole:null, schemaVersion:0, exportedAt:null};
  }
  // Compatibility with an object that directly contains songs.
  if(raw && typeof raw === "object" && Array.isArray(raw.songs)){
    return {songs:raw.songs, activeRole:raw.activeRole || null, schemaVersion:0, exportedAt:raw.exportedAt || null};
  }
  throw new Error("No BandAid song library was found in this file.");
}

async function prepareRestore(file){
  try{
    if(!file) return;
    const text = await file.text();
    const raw = JSON.parse(text);
    const parsed = extractBackup(raw);
    const imported = parsed.songs.map(normalizeImportedSong).filter(s => s && s.title);
    if(!imported.length && parsed.songs.length){
      throw new Error("The backup did not contain any valid songs with titles.");
    }
    pendingRestore = {...parsed, songs: imported, fileName:file.name};
    const dateText = parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString() : "unknown date";
    $("restoreSummary").textContent = `${file.name} contains ${imported.length} song${imported.length===1?"":"s"} (backup date: ${dateText}). Your current library has ${songs.length}.`;
    $("restoreDialog").classList.remove("hidden");
  }catch(err){
    pendingRestore = null;
    backupStatus(`Restore failed: ${err.message}`, true);
  }finally{
    $("backupFileInput").value = "";
  }
}

function closeRestoreDialog(){
  $("restoreDialog").classList.add("hidden");
  pendingRestore = null;
}

function mergeRestoredSongs(importedSongs){
  const byId = new Map(songs.map(song => [song.id, song]));
  importedSongs.forEach(imported => {
    const current = byId.get(imported.id);
    if(!current){
      byId.set(imported.id, imported);
      return;
    }
    const currentTime = Date.parse(current.updatedAt || "") || 0;
    const importedTime = Date.parse(imported.updatedAt || "") || 0;
    if(importedTime >= currentTime) byId.set(imported.id, imported);
  });
  songs = [...byId.values()];
}

function finishRestore(mode){
  if(!pendingRestore) return;
  const restored = pendingRestore;
  if(mode === "replace"){
    songs = restored.songs;
  }else{
    mergeRestoredSongs(restored.songs);
  }
  if(restored.activeRole && ROLES.includes(restored.activeRole)){
    activeRole = restored.activeRole;
    localStorage.setItem("chordVaultActiveRole", activeRole);
  }
  persist();
  if($("currentRoleLabel")) $("currentRoleLabel").textContent = activeRole;
  updateRoleTools();
  renderLibrary();
  $("restoreDialog").classList.add("hidden");
  pendingRestore = null;
  backupStatus(`${mode === "replace" ? "Restore" : "Merge"} complete. BandAid now has ${songs.length} song${songs.length===1?"":"s"}.`);
}

$("backupBtn").addEventListener("click",()=>{
  $("backupPanel").classList.toggle("hidden");
  if(!$("backupPanel").classList.contains("hidden")) $("backupPanel").scrollIntoView({behavior:"smooth",block:"nearest"});
});
$("closeBackupBtn").addEventListener("click",()=>$("backupPanel").classList.add("hidden"));
$("exportBackupBtn").addEventListener("click",exportBackup);
$("importBackupBtn").addEventListener("click",()=>$("backupFileInput").click());
$("backupFileInput").addEventListener("change",event=>prepareRestore(event.target.files?.[0]));
$("mergeBackupBtn").addEventListener("click",()=>finishRestore("merge"));
$("replaceBackupBtn").addEventListener("click",()=>finishRestore("replace"));
$("cancelRestoreBtn").addEventListener("click",closeRestoreDialog);
$("restoreDialog").addEventListener("click",event=>{ if(event.target === $("restoreDialog")) closeRestoreDialog(); });
document.addEventListener("keydown",event=>{ if(event.key === "Escape" && !$("restoreDialog").classList.contains("hidden")) closeRestoreDialog(); });

if("serviceWorker" in navigator){
  window.addEventListener("load", async ()=>{
    try{
      const registration = await navigator.serviceWorker.register("./sw.js?v=1.9", {scope:"./", updateViaCache:"none"});
      await registration.update();
    }catch(_err){}
  });
}
renderLibrary();
