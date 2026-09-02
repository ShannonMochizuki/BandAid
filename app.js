const SUPABASE_URL = "https://qxfcpkbggzhvqapzwflf.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_pXykwrt70vDqIGQdhmGMwQ_yz3KCUU5";
const LEGACY_STORAGE_KEY = "chordVaultSongsV1";
const MASTER_CACHE_KEY = "bandaidMasterSongsV2";
const LIVE_SESSION_STORAGE_KEY = "bandaidLiveSessionV1";
const LIVE_CUE_KEY = "bandaidLiveCueV1";
const ACCOUNT_TOKEN_KEY = "bandaidAccountTokenV213";
const ROLES = ["Worship Leader","Singers","Electric Guitar","Acoustic Guitar","Bass Guitar","Drum"];

const $ = id => document.getElementById(id);
const qsa = sel => [...document.querySelectorAll(sel)];
let supabaseClient = null;
let currentUser = null;
let transportUser = null;
let accountToken = localStorage.getItem(ACCOUNT_TOKEN_KEY) || "";
let currentProfile = null;
let isAdmin = false;
let masterSongs = [];
let personalCopies = new Map();
let songLists = [];
let songListItems = [];
let savedChords = [];
let editingKind = "master";
let editingId = null;
let editingMasterId = null;
let readingId = null;
let readingMode = "official";
let activeRole = localStorage.getItem("chordVaultActiveRole") || "Singers";
if(!ROLES.includes(activeRole)) activeRole = "Singers";
let liveSession = loadLiveSession();
let realtimeChannel = null;
let leaderHeartbeatTimer = null;
let cueChannel = null;
try { cueChannel = new BroadcastChannel("bandaid-live-cues-v1"); } catch(e) {}

function esc(s=""){
  return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function safeId(s=""){ return String(s).replace(/[^a-zA-Z0-9_-]/g,""); }
function showView(id){
  qsa(".view").forEach(v=>v.classList.remove("active"));
  $(id)?.classList.add("active");
  window.scrollTo({top:0,behavior:"smooth"});
}
function roleSlug(role){
  return ({"Worship Leader":"worship-leader","Singers":"singer","Electric Guitar":"electric-guitar","Acoustic Guitar":"acoustic-guitar","Bass Guitar":"bass-guitar","Drum":"drum"})[role] || "singer";
}
function normalizeUsername(raw){ return raw.trim().toLowerCase().replace(/[^a-z0-9_]/g,""); }
function legacySongs(){
  try{
    const rows=JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY)||"[]");
    return Array.isArray(rows) ? rows.map(s=>({...s,role:s.role||"Acoustic Guitar",bpm:s.bpm||""})) : [];
  }catch(e){ return []; }
}
function copyCacheKey(){ return currentUser ? `bandaidPersonalCopiesV2:${currentUser.id}` : ""; }
function cacheCloudData(){
  try{
    localStorage.setItem(MASTER_CACHE_KEY,JSON.stringify(masterSongs));
    if(currentUser) localStorage.setItem(copyCacheKey(),JSON.stringify([...personalCopies.values()]));
  }catch(e){}
}
function loadCachedCloudData(){
  try{
    masterSongs=JSON.parse(localStorage.getItem(MASTER_CACHE_KEY)||"[]")||[];
    const copies=currentUser ? JSON.parse(localStorage.getItem(copyCacheKey())||"[]")||[] : [];
    personalCopies=new Map(copies.map(c=>[c.song_id,c]));
  }catch(e){ masterSongs=[]; personalCopies=new Map(); }
}
function initSupabase(){
  if(!window.supabase?.createClient) throw new Error("Supabase library could not load.");
  if(!supabaseClient){
    supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  }
  return supabaseClient;
}
function setAuthStatus(message,error=false){
  const el=$("authStatus"); if(!el)return;
  el.textContent=message||""; el.classList.toggle("error",!!error);
}
let authMode="login";
function setAuthMode(mode){
  authMode=mode;
  $("loginTabBtn")?.classList.toggle("active",mode==="login");
  $("signupTabBtn")?.classList.toggle("active",mode==="signup");
  $("confirmPasswordLabel")?.classList.toggle("hidden",mode!=="signup");
  $("inviteCodeLabel")?.classList.toggle("hidden",mode!=="signup");
  $("authSubmitBtn").textContent=mode==="signup"?"Create account":"Log in";
  $("authPassword").autocomplete=mode==="signup"?"new-password":"current-password";
  setAuthStatus("");
}
async function ensureTransportAuth(){
  initSupabase();
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(session?.user){ transportUser=session.user; return transportUser; }
  const {data,error}=await supabaseClient.auth.signInAnonymously();
  if(error) throw error;
  transportUser=data?.user||data?.session?.user||null;
  if(!transportUser) throw new Error("Could not establish a secure BandAid connection.");
  return transportUser;
}
async function submitAuth(){
  const username=normalizeUsername($("authUsername").value);
  const password=$("authPassword").value;
  if(!/^[a-z0-9_]{3,24}$/.test(username)) return setAuthStatus("Username must be 3–24 characters using letters, numbers or underscore.",true);
  if(!/^\d{6}$/.test(password)) return setAuthStatus("PIN must be exactly 6 digits.",true);
  if(authMode==="signup" && password!==$("authPasswordConfirm").value) return setAuthStatus("PINs do not match.",true);
  const inviteCode=authMode==="signup" ? $("authInviteCode").value.trim() : "";
  if(authMode==="signup" && !inviteCode) return setAuthStatus("Enter the beta access code provided by the BandAid administrator.",true);
  try{
    await ensureTransportAuth();
    setAuthStatus(authMode==="signup"?"Creating account…":"Signing in…");
    const fn=authMode==="signup"?"bandaid_signup":"bandaid_login";
    const args=authMode==="signup"?{p_username:username,p_pin:password,p_beta_code:inviteCode}:{p_username:username,p_pin:password};
    const {data,error}=await supabaseClient.rpc(fn,args);
    if(error) throw error;
    if(!data?.ok) throw new Error(data?.error||"Could not sign in.");
    accountToken=data.token;
    localStorage.setItem(ACCOUNT_TOKEN_KEY,accountToken);
    await enterAuthenticatedApp({id:data.id,username:data.username,display_username:data.display_username,is_admin:data.is_admin,pin_reset_required:data.pin_reset_required});
  }catch(err){ setAuthStatus(err.message||"Could not sign in.",true); }
}
async function enterAuthenticatedApp(user){
  currentUser=user;
  currentProfile={id:user.id,username:user.username,display_username:user.display_username,is_admin:!!user.is_admin,pin_reset_required:!!user.pin_reset_required};
  isAdmin=!!currentProfile.is_admin;
  $("accountName").textContent=currentProfile.display_username||currentProfile.username||"User";
  $("accountChip").classList.remove("hidden");
  $("adminBadge").classList.toggle("hidden",!isAdmin);
  $("adminBtn")?.classList.toggle("hidden",!isAdmin);
  $("backupBtn").classList.remove("hidden");
  $("listsBtn")?.classList.remove("hidden");
  $("chordLibraryBtn")?.classList.remove("hidden");
  $("newSongBtn").classList.toggle("hidden",!isAdmin);
  $("emptyAddBtn").classList.toggle("hidden",!isAdmin);
  $("importLocalMasterBtn")?.classList.toggle("hidden",!isAdmin || legacySongs().length===0);
  await loadSongLibrary();
  await Promise.allSettled([loadSongLists(), loadSavedChords()]);
  if($("currentRoleLabel")) $("currentRoleLabel").textContent=activeRole;
  updateRoleTools();
  showView("roleView");
  await initLiveBackend();
  if(currentProfile?.pin_reset_required) openAccountDialog(true);
}
async function loadProfile(){
  if(!accountToken) throw new Error("Please log in again.");
  const {data,error}=await supabaseClient.rpc("bandaid_me",{p_token:accountToken});
  if(error) throw error;
  if(!data?.ok) throw new Error(data?.error||"Session expired");
  currentUser={id:data.id,username:data.username,display_username:data.display_username,is_admin:data.is_admin,pin_reset_required:data.pin_reset_required};
  currentProfile={...currentUser}; isAdmin=!!data.is_admin;
}
async function logout(){
  try{ if(liveSession) await leaveLiveSession(); }catch(e){}
  try{ if(accountToken) await supabaseClient.rpc("bandaid_logout",{p_token:accountToken}); }catch(e){}
  accountToken=""; localStorage.removeItem(ACCOUNT_TOKEN_KEY);
  currentUser=null; currentProfile=null; isAdmin=false; masterSongs=[]; personalCopies=new Map();
  $("accountChip").classList.add("hidden"); $("backupBtn").classList.add("hidden"); $("listsBtn")?.classList.add("hidden"); $("chordLibraryBtn")?.classList.add("hidden"); $("newSongBtn").classList.add("hidden");
  showView("authView");
}
async function bootstrapAuth(){
  try{
    await ensureTransportAuth();
    if(accountToken){
      const {data,error}=await supabaseClient.rpc("bandaid_me",{p_token:accountToken});
      if(!error && data?.ok){
        await enterAuthenticatedApp({id:data.id,username:data.username,display_username:data.display_username,is_admin:data.is_admin,pin_reset_required:data.pin_reset_required});
        return;
      }
      accountToken=""; localStorage.removeItem(ACCOUNT_TOKEN_KEY);
    }
    showView("authView");
  }catch(err){ setAuthStatus(`Could not connect to BandAid: ${err.message}`,true); showView("authView"); }
}

function fromMasterRow(r){ return {id:r.id,legacy_id:r.legacy_id,title:r.title||"",artist:r.artist||"",role:r.role||"Acoustic Guitar",key:r.song_key||"",capo:r.capo||"",bpm:r.bpm||"",chords:r.chords||"",chordLayout:r.chord_layout||null,tabs:r.tabs||"",notes:r.notes||"",shapes:Array.isArray(r.shapes)?r.shapes:[],createdAt:r.created_at,updatedAt:r.updated_at}; }
function fromCopyRow(r){ return {...r,key:r.song_key||"",chordLayout:r.chord_layout||null,shapes:Array.isArray(r.shapes)?r.shapes:[]}; }
async function loadSongLibrary(){
  loadCachedCloudData(); renderLibrary();
  try{
    const [m,c]=await Promise.all([
      supabaseClient.rpc("bandaid_list_master_songs",{p_token:accountToken}),
      supabaseClient.rpc("bandaid_list_personal_copies",{p_token:accountToken})
    ]);
    if(m.error) throw m.error; if(c.error) throw c.error;
    masterSongs=(m.data||[]).map(fromMasterRow);
    personalCopies=new Map((c.data||[]).map(fromCopyRow).map(x=>[x.song_id,x]));
    cacheCloudData(); renderLibrary();
  }catch(err){ if(!masterSongs.length) alert(`Could not load the shared song library: ${err.message}`); }
}

async function loadSongLists(){
  if(!accountToken)return;
  const [l,i]=await Promise.all([
    supabaseClient.rpc("bandaid_list_song_lists",{p_token:accountToken}),
    supabaseClient.rpc("bandaid_list_song_list_items",{p_token:accountToken})
  ]);
  if(l.error) throw l.error;
  if(i.error) throw i.error;
  songLists=l.data||[];
  songListItems=i.data||[];
}
async function loadSavedChords(){
  if(!accountToken)return;
  const {data,error}=await supabaseClient.rpc("bandaid_list_saved_chords",{p_token:accountToken});
  if(error) throw error;
  savedChords=data||[];
}
function listItemsFor(listId){
  return songListItems.filter(x=>x.list_id===listId).sort((a,b)=>(a.position||0)-(b.position||0));
}
function songForListItem(item){
  const master=masterSongs.find(s=>s.id===item.song_id);
  if(!master)return null;
  const mode=item.version==="mine"&&personalCopies.has(master.id)?"mine":"official";
  return {master,mode,data:dataForSong(master,mode)};
}
function renderSongLists(){
  const host=$("songListsContainer"); if(!host)return;
  if(!songLists.length){host.innerHTML='<div class="empty-mini">No lists yet. Create one above.</div>';return;}
  host.innerHTML=songLists.map(list=>{
    const items=listItemsFor(list.id);
    const rows=items.map(item=>{
      const resolved=songForListItem(item);
      if(!resolved)return '';
      const {master,mode,data}=resolved;
      const key=effectiveSongKey(data)||"—";
      return `<div class="list-song-row" data-item-id="${safeId(item.id)}">
        <button class="list-song-open" data-song-id="${safeId(master.id)}" data-mode="${mode}">
          <strong>${esc(master.title)}</strong>
          <span>${esc(master.artist||"")} · Key ${esc(key)} · ${mode==="mine"?"My Copy":"Official"}</span>
        </button>
        <button class="ghost compact remove-list-item" data-item-id="${safeId(item.id)}">Remove</button>
      </div>`;
    }).join("");
    return `<section class="song-list-card" data-list-id="${safeId(list.id)}">
      <div class="song-list-card-head"><div><strong>${esc(list.name)}</strong><span>${items.length} song${items.length===1?"":"s"}</span></div><button class="ghost compact delete-song-list" data-list-id="${safeId(list.id)}">Delete</button></div>
      <div class="song-list-items">${rows||'<div class="empty-mini">No songs in this list yet.</div>'}</div>
    </section>`;
  }).join("");
  qsa(".list-song-open").forEach(btn=>btn.addEventListener("click",()=>{closeListsDialog();openReader(btn.dataset.songId,btn.dataset.mode);}));
  qsa(".remove-list-item").forEach(btn=>btn.addEventListener("click",()=>removeSongListItem(btn.dataset.itemId)));
  qsa(".delete-song-list").forEach(btn=>btn.addEventListener("click",()=>deleteSongList(btn.dataset.listId)));
}
async function openListsDialog(){
  try{await loadSongLists();renderSongLists();$("listsDialog").classList.remove("hidden");}catch(err){alert(`Could not load lists: ${err.message}`);}
}
function closeListsDialog(){$("listsDialog")?.classList.add("hidden");}
async function createSongList(){
  const name=$("newListName").value.trim(); if(!name)return;
  const {data,error}=await supabaseClient.rpc("bandaid_create_song_list",{p_token:accountToken,p_name:name});
  if(error)return $("listsStatus").textContent=error.message;
  $("newListName").value=""; await loadSongLists(); renderSongLists();
}
async function deleteSongList(id){
  if(!confirm("Delete this list? The songs themselves will not be deleted."))return;
  const {error}=await supabaseClient.rpc("bandaid_delete_song_list",{p_token:accountToken,p_list_id:id});
  if(error)return alert(error.message); await loadSongLists();renderSongLists();
}
async function removeSongListItem(id){
  const {error}=await supabaseClient.rpc("bandaid_remove_song_from_list",{p_token:accountToken,p_item_id:id});
  if(error)return alert(error.message); await loadSongLists();renderSongLists();
}
async function openAddToListDialog(){
  const master=masterSongs.find(s=>s.id===readingId);if(!master)return;
  try{await loadSongLists();}catch(err){return alert(`Could not load lists: ${err.message}`);}
  if(!songLists.length){if(confirm("You do not have a list yet. Create one now?"))openListsDialog();return;}
  const version=readingMode==="mine"&&personalCopies.has(master.id)?"mine":"official";
  $("addToListSummary").textContent=`Add “${master.title}” (${version==="mine"?"My Copy":"Official"})`;
  $("addToListChoices").innerHTML=songLists.map(l=>`<button class="secondary add-list-choice" data-list-id="${safeId(l.id)}">${esc(l.name)}</button>`).join("");
  qsa(".add-list-choice").forEach(btn=>btn.addEventListener("click",()=>addCurrentSongToList(btn.dataset.listId,version)));
  $("addToListDialog").classList.remove("hidden");
}
function closeAddToListDialog(){$("addToListDialog")?.classList.add("hidden");}
async function addCurrentSongToList(listId,version){
  const master=masterSongs.find(s=>s.id===readingId);if(!master)return;
  const {error}=await supabaseClient.rpc("bandaid_add_song_to_list",{p_token:accountToken,p_list_id:listId,p_song_id:master.id,p_version:version});
  if(error)return alert(error.message); closeAddToListDialog(); await loadSongLists();
}
function renderSavedChords(){
  const host=$("savedChordList");if(!host)return;
  if(!savedChords.length){host.innerHTML='<div class="empty-mini">No saved chords yet.</div>';return;}
  host.innerHTML=savedChords.map(c=>`<div class="saved-chord-row">
    <div class="saved-chord-preview">${makeDiagram(c.name,c.frets,c.fingers)}<div class="hint mono">${esc(c.frets)}${c.fingers?" · fingers "+esc(c.fingers):""}</div></div>
    <button class="ghost compact delete-saved-chord" data-id="${safeId(c.id)}">Delete</button>
  </div>`).join("");
  qsa(".delete-saved-chord").forEach(btn=>btn.addEventListener("click",()=>deleteSavedChord(btn.dataset.id)));
}
async function openChordLibrary(){
  try{await loadSavedChords();renderSavedChords();$("chordLibraryDialog").classList.remove("hidden");}catch(err){alert(`Could not load chords: ${err.message}`);}
}
function closeChordLibrary(){$("chordLibraryDialog")?.classList.add("hidden");}
async function saveChordToLibrary(shape){
  const name=(shape?.name??$("savedChordName")?.value??"").trim();
  const frets=(shape?.frets??$("savedChordFrets")?.value??"").trim();
  const fingers=(shape?.fingers??$("savedChordFingers")?.value??"").trim();
  if(!name||!frets)return alert("Enter a chord name and fret pattern.");
  const {data,error}=await supabaseClient.rpc("bandaid_save_chord",{p_token:accountToken,p_payload:{name,frets,fingers}});
  if(error)return alert(error.message);
  if($("savedChordName")){$("savedChordName").value="";$("savedChordFrets").value="";$("savedChordFingers").value="";}
  await loadSavedChords();renderSavedChords();
}
async function deleteSavedChord(id){
  const {error}=await supabaseClient.rpc("bandaid_delete_saved_chord",{p_token:accountToken,p_chord_id:id});
  if(error)return alert(error.message);await loadSavedChords();renderSavedChords();
}

function normalizeFrets(raw=""){ raw=raw.trim(); if(!raw)return[]; if(raw.includes("-")||raw.includes(" "))return raw.split(/[-\s,]+/).filter(Boolean); return raw.split(""); }
function makeDiagram(name,fretsRaw,fingersRaw){
  const frets=normalizeFrets(fretsRaw),fingers=normalizeFrets(fingersRaw);
  if(frets.length!==6)return `<span class="hint">Enter 6 strings to preview.</span>`;
  const nums=frets.map(x=>(/^\d+$/.test(x)?Number(x):null)).filter(x=>x!==null&&x>0);
  if(!nums.length)return `<span class="hint">Open/muted chord shape saved.</span>`;
  const minFret=Math.max(1,Math.min(...nums)); let cells="";
  for(let string=0;string<6;string++){
    const f=frets[string]; if(/^\d+$/.test(f)&&Number(f)>0){ const row=Math.min(5,Math.max(1,Number(f)-minFret+1)); const finger=fingers[string]&&fingers[string]!=="0"&&fingers[string].toLowerCase()!=="x"?fingers[string]:""; cells+=`<span class="fret-dot" style="grid-column:${string+1};grid-row:${row}">${esc(finger)}</span>`; }
  }
  return `<span class="shape-label">${esc(name||"")}</span><div class="chord-diagram">${cells}</div><span class="hint">base fret ${minFret}</span>`;
}
function addShapeCard(shape={name:"",frets:"",fingers:""}){
  const node=$("shapeTemplate").content.firstElementChild.cloneNode(true);
  node.querySelector(".shape-name").value=shape.name||""; node.querySelector(".shape-frets").value=shape.frets||""; node.querySelector(".shape-fingers").value=shape.fingers||"";
  const render=()=>node.querySelector(".shape-preview").innerHTML=makeDiagram(node.querySelector(".shape-name").value,node.querySelector(".shape-frets").value,node.querySelector(".shape-fingers").value);
  node.querySelectorAll("input").forEach(i=>i.addEventListener("input",render)); node.querySelector(".remove-shape").addEventListener("click",()=>node.remove()); $("shapeList").appendChild(node); render();
}
function currentShapes(){ return qsa("#shapeList .shape-card").map(card=>({name:card.querySelector(".shape-name").value.trim(),frets:card.querySelector(".shape-frets").value.trim(),fingers:card.querySelector(".shape-fingers").value.trim()})).filter(s=>s.name||s.frets||s.fingers); }
function dataForSong(master,mode=readingMode){
  if(mode==="mine"){
    const copy=personalCopies.get(master.id); if(copy) return {...master,key:copy.key,capo:copy.capo,bpm:copy.bpm,chords:copy.chords,chordLayout:copy.chordLayout||copy.chord_layout||null,tabs:copy.tabs,notes:copy.notes,shapes:copy.shapes||[],copyId:copy.id};
  }
  return master;
}

function isLikelyChordLine(line=""){
  const trimmed=String(line).trim();
  if(!trimmed || /^\[.*\]$/.test(trimmed)) return false;
  const parts=trimmed.split(/\s+/).filter(Boolean);
  if(!parts.length)return false;
  const chordish=parts.filter(p=>isChordToken(p.replace(/^[|([{]+|[|,;:.)\]}]+$/g,""))).length;
  return chordish>0 && chordish/parts.length>=0.6;
}
function chordPositionsFromLine(line=""){
  const result=[];
  const rx=/\S+/g; let m;
  while((m=rx.exec(line))){
    const raw=m[0], core=raw.replace(/^[|([{]+|[|,;:.)\]}]+$/g,"");
    if(isChordToken(core)) result.push({chord:core,index:m.index});
  }
  return result;
}
function buildChordLayout(text=""){
  const lines=String(text||"").replace(/\r\n?/g,"\n").split("\n");
  const items=[];
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(/^\s*\[.*\]\s*$/.test(line)){items.push({type:"section",text:line.trim()});continue;}
    if(isLikelyChordLine(line)){
      const next=lines[i+1];
      if(next!=null && next.trim()!=="" && !isLikelyChordLine(next) && !/^\s*\[.*\]\s*$/.test(next)){
        items.push({type:"lyric",lyric:next,chords:chordPositionsFromLine(line)});
        i++; continue;
      }
      items.push({type:"chords",text:line}); continue;
    }
    if(line.trim()===""){items.push({type:"blank"});continue;}
    items.push({type:"text",text:line});
  }
  return {version:1,items};
}
function transposeLayout(layout,fromKey,toKey){
  if(!layout?.items)return layout;
  return {version:1,items:layout.items.map(item=>{
    if(item.type==="lyric")return {...item,chords:(item.chords||[]).map(c=>({...c,chord:transposeChord(c.chord,fromKey,toKey)}))};
    if(item.type==="chords")return {...item,text:transposeChordChart(item.text,fromKey,toKey)};
    return {...item};
  })};
}
function renderChordLayout(target,layout){
  if(!target)return;
  const items=layout?.items||[];
  target.innerHTML=items.map(item=>{
    if(item.type==="blank")return '<div class="chart-blank" aria-hidden="true">&nbsp;</div>';
    if(item.type==="section")return `<div class="chart-section">${esc(item.text.replace(/^\[|\]$/g,""))}</div>`;
    if(item.type==="lyric"){
      const chords=(item.chords||[]).map(c=>`<span class="anchored-chord" style="left:${Math.max(0,Number(c.index)||0)}ch">${esc(c.chord)}</span>`).join("");
      return `<div class="chart-pair"><div class="chart-chord-row">${chords}</div><div class="chart-lyric-row">${esc(item.lyric)}</div></div>`;
    }
    if(item.type==="chords")return `<div class="chart-raw chord-only">${esc(item.text)}</div>`;
    return `<div class="chart-raw">${esc(item.text||"")}</div>`;
  }).join("");
}
function updateEditorChartPreview(){
  const el=$("songChordsPreview"); if(!el)return;
  renderChordLayout(el,buildChordLayout($("songChords")?.value||""));
}

function configureEditorFields(kind){
  const personal=kind==="copy";
  ["songTitle","songArtist","songRole"].forEach(id=>$(id).disabled=personal);
  $("editorModeBadge").textContent=personal?"My Private Copy":"Official Master";
  $("editorModeBadge").classList.toggle("personal",personal);
  $("deleteBtn").textContent=personal?"Delete My Copy":"Delete";
}
function openEditor(master=null,kind="master"){
  if(kind==="master"&&!isAdmin){ if(master) return openEditor(master,"copy"); return; }
  editingKind=kind; editingMasterId=master?.id||null;
  const copy=master?personalCopies.get(master.id):null;
  const source=kind==="copy"?(copy?dataForSong(master,"mine"):master):master;
  editingId=kind==="copy"?(copy?.id||null):(master?.id||null);
  $("songTitle").value=source?.title||""; $("songArtist").value=source?.artist||""; $("songRole").value=source?.role||activeRole;
  $("songKey").value=source?.key||""; $("songCapo").value=source?.capo||""; $("songBpm").value=source?.bpm||""; $("songChords").value=source?.chords||""; $("songTabs").value=source?.tabs||""; $("songNotes").value=source?.notes||""; updateEditorChartPreview();
  $("shapeList").innerHTML=""; (source?.shapes||[]).forEach(addShapeCard);
  $("deleteBtn").style.visibility=editingId?"visible":"hidden"; configureEditorFields(kind);
  qsa(".tab").forEach((b,i)=>b.classList.toggle("active",i===0)); qsa(".panel").forEach((p,i)=>p.classList.toggle("active",i===0)); showView("editorView");
}
async function saveEditor(){
  try{
    const title=$("songTitle").value.trim(); if(!title){alert("Please enter a song title.");return;}
    if(editingKind==="master"){
      if(!isAdmin) throw new Error("Only the BandAid administrator can edit the Master Library.");
      const chartText=$("songChords").value, detectedKey=inferKeyFromChordChart(chartText), enteredKey=canonicalKey($("songKey").value.trim()), chordLayout=buildChordLayout(chartText); const payload={id:editingId||"",title,artist:$("songArtist").value.trim(),role:$("songRole").value,song_key:detectedKey||enteredKey||"",capo:$("songCapo").value.trim(),bpm:$("songBpm").value.trim(),chords:chartText,chord_layout:chordLayout,tabs:$("songTabs").value,notes:$("songNotes").value,shapes:currentShapes()};
      const {data,error}=await supabaseClient.rpc("bandaid_save_master_song",{p_token:accountToken,p_payload:payload});
      if(error) throw error; if(data?.ok===false) throw new Error(data.error);
      const saved=fromMasterRow(data); const idx=masterSongs.findIndex(s=>s.id===saved.id); if(idx>=0)masterSongs[idx]=saved;else masterSongs.unshift(saved);
      activeRole=saved.role; localStorage.setItem("chordVaultActiveRole",activeRole); cacheCloudData(); renderLibrary(); openReader(saved.id);
    }else{
      const master=masterSongs.find(s=>s.id===editingMasterId); if(!master)throw new Error("Master song not found.");
      const chartText=$("songChords").value, detectedKey=inferKeyFromChordChart(chartText), enteredKey=canonicalKey($("songKey").value.trim()), chordLayout=buildChordLayout(chartText); const payload={song_key:detectedKey||enteredKey||"",capo:$("songCapo").value.trim(),bpm:$("songBpm").value.trim(),chords:chartText,chord_layout:chordLayout,tabs:$("songTabs").value,notes:$("songNotes").value,shapes:currentShapes()};
      const {data,error}=await supabaseClient.rpc("bandaid_save_personal_copy",{p_token:accountToken,p_song_id:master.id,p_payload:payload});
      if(error)throw error;if(data?.ok===false)throw new Error(data.error);
      personalCopies.set(master.id,fromCopyRow(data)); cacheCloudData(); readingMode="mine"; renderLibrary(); openReader(master.id,"mine");
    }
  }catch(err){ alert(`Could not save: ${err.message}`); }
}
async function deleteEditing(){
  if(!editingId)return;
  try{
    if(editingKind==="master"){
      if(!isAdmin)return; const master=masterSongs.find(s=>s.id===editingId); if(!confirm(`Delete official song “${master?.title||"this song"}”? This also removes all users’ personal copies.`))return;
      const {data,error}=await supabaseClient.rpc("bandaid_delete_master_song",{p_token:accountToken,p_song_id:editingId}); if(error)throw error; masterSongs=masterSongs.filter(s=>s.id!==editingId); personalCopies.delete(editingId);
    }else{
      const master=masterSongs.find(s=>s.id===editingMasterId); if(!confirm(`Delete your private copy of “${master?.title||"this song"}”? The official song will remain.`))return;
      const {error}=await supabaseClient.rpc("bandaid_delete_personal_copy",{p_token:accountToken,p_song_id:editingMasterId}); if(error)throw error; personalCopies.delete(editingMasterId);
    }
    cacheCloudData(); renderLibrary(); showView("libraryView");
  }catch(err){ alert(`Could not delete: ${err.message}`); }
}
function renderReader(master,mode){
  const s=dataForSong(master,mode); const hasCopy=personalCopies.has(master.id);
  $("readerTitle").textContent=master.title; $("readerArtist").textContent=master.artist||"NO ARTIST";
  const pills=[]; const actualKey=effectiveSongKey(s); if(master.role)pills.push(`<span class="meta-pill">${esc(master.role)}</span>`); if(actualKey)pills.push(`<span class="meta-pill">Key ${esc(actualKey)}</span>`); if(s.capo)pills.push(`<span class="meta-pill">Capo ${esc(s.capo)}</span>`); if(s.bpm)pills.push(`<span class="meta-pill">${esc(s.bpm)} BPM</span>`); $("readerMeta").innerHTML=pills.join("");
  const sourceKey=inferredSongKey(s); const targetKey=canonicalKey($("transposeKeySelect")?.value)||sourceKey;
  const baseLayout=s.chordLayout||s.chord_layout||buildChordLayout(s.chords); const shownLayout=(sourceKey&&targetKey)?transposeLayout(baseLayout,sourceKey,targetKey):baseLayout; renderChordLayout($("readerChords"),shownLayout); applySongFontScale(); $("readerTabs").textContent=s.tabs||"No guitar tab saved."; $("readerNotes").textContent=s.notes||"No notes saved.";
  if($("transposeKeySelect")){ const preferred=sourceKey||"C"; if(!$("transposeKeySelect").dataset.touched && [...$("transposeKeySelect").options].some(o=>o.value===preferred)) $("transposeKeySelect").value=preferred; $("transposeKeySelect").disabled=!sourceKey; $("transposeSourceLabel").textContent=sourceKey?`Key ${sourceKey}`:"Key —"; $("saveTransposeCopyBtn").disabled=!sourceKey; }
  $("readerShapes").innerHTML=s.shapes?.length?s.shapes.map((shape,i)=>`<div class="reader-shape">${makeDiagram(shape.name,shape.frets,shape.fingers)}<div class="hint mono">${esc(shape.frets)}${shape.fingers?" · fingers "+esc(shape.fingers):""}</div><button class="secondary compact save-reader-chord" data-shape-index="${i}" type="button">Save to My Chords</button></div>`).join(""):"No chord shapes saved."; qsa(".save-reader-chord").forEach(btn=>btn.addEventListener("click",()=>saveChordToLibrary((s.shapes||[])[Number(btn.dataset.shapeIndex)])));
  $("versionModeLabel").textContent=mode==="mine"?"My Private Copy":"Official Master"; $("versionModeHelp").textContent=mode==="mine"?"Only you can see and edit this version":"Shared read-only version for regular users";
  $("copyToggleBtn").textContent=mode==="mine"?"Official Version":(hasCopy?"My Copy":"Create My Copy");
  $("editBtn").textContent=mode==="official"&&isAdmin?"Edit Official":"Edit My Copy";
  const tester=$("singerKeyTester"); if(tester){ tester.classList.toggle("hidden",activeRole!=="Singers"); const preferred=inferredSongKey(s)||"C"; if(!$("testKeySelect").dataset.touched && [...$("testKeySelect").options].some(o=>o.value===preferred))$("testKeySelect").value=preferred; $("keyTestProgression").textContent=keyTestProgression(s,$("testKeySelect").value).join("  ·  "); }
}
function openReader(id,mode="official"){
  const master=masterSongs.find(s=>s.id===id); if(!master)return; readingId=id; readingMode=mode==="mine"&&personalCopies.has(id)?"mine":"official"; if($("testKeySelect"))delete $("testKeySelect").dataset.touched;if($("transposeKeySelect"))delete $("transposeKeySelect").dataset.touched;
  qsa(".reader-tab").forEach((b,i)=>b.classList.toggle("active",i===0)); qsa(".reader-panel").forEach((p,i)=>p.classList.toggle("active",i===0)); renderReader(master,readingMode); showView("readerView");
}
async function togglePersonalCopy(){
  const master=masterSongs.find(s=>s.id===readingId); if(!master)return;
  if(readingMode==="mine"){ readingMode="official"; return renderReader(master,readingMode); }
  if(!personalCopies.has(master.id)){
    try{
      const payload={song_key:master.key,capo:master.capo,bpm:master.bpm,chords:master.chords,chord_layout:master.chordLayout||buildChordLayout(master.chords),tabs:master.tabs,notes:master.notes,shapes:master.shapes||[]};
      const {data,error}=await supabaseClient.rpc("bandaid_save_personal_copy",{p_token:accountToken,p_song_id:master.id,p_payload:payload}); if(error)throw error;
      personalCopies.set(master.id,fromCopyRow(data)); cacheCloudData(); renderLibrary();
    }catch(err){ return alert(`Could not create your copy: ${err.message}`); }
  }
  readingMode="mine"; renderReader(master,readingMode);
}
function renderLibrary(){
  if(!$("songList"))return;
  const term=$("searchInput").value.trim().toLowerCase(),sort=$("sortSelect").value;
  let filtered=masterSongs.filter(s=>s.role===activeRole&&[s.title,s.artist,s.key,s.bpm,s.chords,s.notes].join(" ").toLowerCase().includes(term));
  filtered.sort((a,b)=>sort==="title"?a.title.localeCompare(b.title):sort==="artist"?(a.artist||"").localeCompare(b.artist||""):new Date(b.updatedAt)-new Date(a.updatedAt));
  $("songList").innerHTML=filtered.map(s=>{const mine=personalCopies.has(s.id),displayKey=effectiveSongKey(s);const badges=[displayKey?`<span class="badge">Key ${esc(displayKey)}</span>`:"",s.bpm?`<span class="badge">${esc(s.bpm)} BPM</span>`:"",mine?`<span class="badge personal-badge">My Copy</span>`:""].join("");const snippet=(s.chords||s.notes||"").trim().slice(0,150);return `<div class="song-card" data-id="${safeId(s.id)}"><div class="eyebrow">${esc(s.artist||"NO ARTIST")}</div><h3>${esc(s.title)}</h3><div class="badge-row">${badges}</div>${snippet?`<div class="snippet mono">${esc(snippet)}</div>`:""}</div>`;}).join("");
  qsa(".song-card").forEach(c=>c.addEventListener("click",()=>openReader(c.dataset.id)));
  $("stats").textContent=`${filtered.length} shared song${filtered.length===1?"":"s"} in ${activeRole}${isAdmin?" · Admin":""}`;
  $("emptyState").classList.toggle("hidden",filtered.length>0||term); $("emptyAddBtn").classList.toggle("hidden",!isAdmin);
}
function setActiveRole(role){ if(!ROLES.includes(role))return; activeRole=role; localStorage.setItem("chordVaultActiveRole",role); $("currentRoleLabel").textContent=role; updateRoleTools(); renderLibrary(); showView("libraryView"); }

// ---------- Live sessions ----------
function loadLiveSession(){ try{return JSON.parse(localStorage.getItem(LIVE_SESSION_STORAGE_KEY)||"null");}catch(e){return null;} }
function saveLiveSession(session){ liveSession=session; if(session)localStorage.setItem(LIVE_SESSION_STORAGE_KEY,JSON.stringify(session));else localStorage.removeItem(LIVE_SESSION_STORAGE_KEY); renderLiveSessionUI(); }
function makeSessionCode(){ const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from({length:6},()=>chars[Math.floor(Math.random()*chars.length)]).join(""); }
function setSessionStatus(message,state=""){
  $("sessionStatus").textContent=message; const badge=$("liveSessionBadge"); if(badge){badge.classList.remove("live","connecting","error");if(state)badge.classList.add(state);badge.textContent=state==="live"?"● Live":state==="connecting"?"Connecting…":state==="error"?"Error":"Offline";}
}
function renderLiveSessionUI(){
  if(!$("leaderSessionActions"))return; const isLeader=activeRole==="Worship Leader";
  $("leaderSessionActions").classList.toggle("hidden",!!liveSession||!isLeader); $("memberSessionActions").classList.toggle("hidden",!!liveSession||isLeader); $("connectedSession").classList.toggle("hidden",!liveSession);
  if(liveSession){$("connectedSessionCode").textContent=liveSession.code||"LIVE";$("liveSessionTitle").textContent="Band connected";$("liveSessionHelp").textContent=isLeader?"Your cue buttons will broadcast to this session.":"Worship Leader cues will appear on this device.";setSessionStatus(`Connected as ${activeRole}.`,"live");}
  else{$("liveSessionTitle").textContent=isLeader?"Start a live session":"Join the live session";$("liveSessionHelp").textContent=isLeader?"Create a short session code and share it with the band.":"Enter the session code shown by your Worship Leader.";setSessionStatus("Not connected.");}
  $("cueConnectionBadge").textContent=liveSession?"● Live":"Not connected"; qsa(".cue-btn").forEach(btn=>btn.disabled=isLeader&&!liveSession);
}
function updateRoleTools(){ $("worshipCuePanel")?.classList.toggle("hidden",activeRole!=="Worship Leader"); if(activeRole==="Worship Leader")$("liveCueBanner")?.classList.add("hidden"); renderLiveSessionUI(); }
function showLiveCue(cue){ if(!cue||activeRole==="Worship Leader")return; const banner=$("liveCueBanner"); if(!banner)return; const label=cue.label||cue.cue||cue; $("liveCueText").textContent=label; const sentAt=cue.sentAt||cue.created_at; $("liveCueTime").textContent=sentAt?new Date(sentAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"now"; banner.classList.remove("hidden","cue-pulse");void banner.offsetWidth;banner.classList.add("cue-pulse");if(navigator.vibrate)navigator.vibrate(80); }
function requireUser(){ if(!currentUser)throw new Error("Please log in first."); if(!transportUser)throw new Error("Live connection unavailable."); return transportUser; }
async function subscribeToLiveSession(){
  if(!liveSession?.id)return; if(realtimeChannel){try{await supabaseClient.removeChannel(realtimeChannel);}catch(e){}}
  realtimeChannel=supabaseClient.channel(`bandaid-session-${liveSession.id}`)
    .on("postgres_changes",{event:"INSERT",schema:"public",table:"worship_cues",filter:`session_id=eq.${liveSession.id}`},p=>showLiveCue(p.new))
    .on("postgres_changes",{event:"UPDATE",schema:"public",table:"band_sessions",filter:`id=eq.${liveSession.id}`},p=>{if(p.new?.is_active===false)handleSessionEnded();})
    .subscribe(status=>{if(status==="SUBSCRIBED")setSessionStatus(`Connected as ${activeRole}.`,"live");else if(status==="CHANNEL_ERROR"||status==="TIMED_OUT")setSessionStatus("Realtime connection problem. Retrying…","error");});
}
async function handleSessionEnded(){ stopLeaderHeartbeat(); if(realtimeChannel){try{await supabaseClient.removeChannel(realtimeChannel);}catch(e){}} realtimeChannel=null;saveLiveSession(null);setSessionStatus("Live session ended.","error");$("lastCueSent").textContent="The live session has ended."; }
function stopLeaderHeartbeat(){ if(leaderHeartbeatTimer){ clearInterval(leaderHeartbeatTimer); leaderHeartbeatTimer=null; } }
async function sendLeaderHeartbeat(){
  if(!liveSession?.id || liveSession.role!=="worship-leader" || !currentUser) return;
  try{ await supabaseClient.rpc("heartbeat_band_session",{target_session:liveSession.id}); }catch(e){}
}
function startLeaderHeartbeat(){
  stopLeaderHeartbeat();
  if(liveSession?.role!=="worship-leader") return;
  sendLeaderHeartbeat();
  leaderHeartbeatTimer=setInterval(sendLeaderHeartbeat,60000);
}
async function createLiveSession(){ try{setSessionStatus("Creating live session…","connecting");const user=requireUser();let lastError=null;for(let i=0;i<4;i++){const code=makeSessionCode();const {data,error}=await supabaseClient.rpc("create_band_session",{session_code:code,account_token:accountToken});if(!error&&data){saveLiveSession({id:data,code,role:"worship-leader",userId:user.id});await subscribeToLiveSession();startLeaderHeartbeat();return;}lastError=error;if(!String(error?.message||"").toLowerCase().includes("duplicate"))break;}throw lastError||new Error("Could not create session.");}catch(err){setSessionStatus(`Could not create session: ${err.message}`,"error");} }
async function joinLiveSession(){const code=$("sessionCodeInput").value.trim().toUpperCase();if(!code)return $("sessionCodeInput").focus();if(activeRole==="Worship Leader")return;try{setSessionStatus("Joining session…","connecting");const user=requireUser();const {data,error}=await supabaseClient.rpc("join_band_session",{join_code:code,selected_role:roleSlug(activeRole)});if(error)throw error;saveLiveSession({id:data,code,role:roleSlug(activeRole),userId:user.id});await subscribeToLiveSession();}catch(err){setSessionStatus(err.message?.includes("Session not found")?"Session code not found.":`Could not join: ${err.message}`,"error");}}
async function leaveLiveSession(){stopLeaderHeartbeat();const s=liveSession;if(!s){saveLiveSession(null);return;}try{requireUser();const {data,error}=await supabaseClient.rpc("leave_band_session",{target_session:s.id});if(error)throw error;if(data==="ended")setSessionStatus("Live session ended for everyone.","error");}catch(err){setSessionStatus(`Could not leave session: ${err.message}`,"error");return;}if(realtimeChannel){try{await supabaseClient.removeChannel(realtimeChannel);}catch(e){}}realtimeChannel=null;saveLiveSession(null);}
async function sendLiveCue(label){const cue={label,sentAt:new Date().toISOString(),from:"Worship Leader"};localStorage.setItem(LIVE_CUE_KEY,JSON.stringify(cue));if(cueChannel)cueChannel.postMessage(cue);if(!liveSession)return setSessionStatus("Create a live session before sending cues.","error");try{const user=requireUser();const {error}=await supabaseClient.from("worship_cues").insert({session_id:liveSession.id,cue:label,created_by:user.id});if(error)throw error;$("lastCueSent").textContent=`Sent: ${label} · ${new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`;qsa(".cue-btn").forEach(btn=>btn.classList.toggle("active",btn.dataset.cue===label));}catch(err){setSessionStatus(`Cue failed: ${err.message}`,"error");}}
async function initLiveBackend(){renderLiveSessionUI();if(!liveSession||!currentUser)return;try{const {data,error}=await supabaseClient.from("band_sessions").select("id,is_active").eq("id",liveSession.id).maybeSingle();if(error)throw error;if(!data||data.is_active===false){saveLiveSession(null);setSessionStatus("This live session has ended.","error");return;}await subscribeToLiveSession();if(liveSession?.role==="worship-leader")startLeaderHeartbeat();}catch(err){setSessionStatus("Saved session found, but live connection is unavailable.","error");}}


// ---------- Account PIN + Admin controls ----------
function setDialogStatus(id,message,error=false){const el=$(id);if(!el)return;el.textContent=message||"";el.classList.toggle("error",!!error);}
function openAccountDialog(forced=false){
  $("accountDialog")?.classList.remove("hidden");
  $("accountDialogHelp").innerHTML=forced?'<span class="pin-required-note">Your administrator reset your PIN. Choose a new 6-digit PIN before continuing.</span>':'Choose a new 6-digit numeric PIN.';
  $("closeAccountDialogBtn")?.classList.toggle("hidden",forced);
  $("newPinInput").value="";$("newPinConfirmInput").value="";setDialogStatus("accountDialogStatus","");
  setTimeout(()=>$("newPinInput")?.focus(),50);
}
function closeAccountDialog(){if(currentProfile?.pin_reset_required)return;$("accountDialog")?.classList.add("hidden");}
async function saveOwnPin(){
  const pin=$("newPinInput").value, confirmPin=$("newPinConfirmInput").value;
  if(!/^\d{6}$/.test(pin)) return setDialogStatus("accountDialogStatus","PIN must be exactly 6 digits.",true);
  if(pin!==confirmPin) return setDialogStatus("accountDialogStatus","PINs do not match.",true);
  try{
    setDialogStatus("accountDialogStatus","Saving new PIN…");
    const {data,error}=await supabaseClient.rpc("bandaid_change_pin",{p_token:accountToken,p_new_pin:pin}); if(error)throw error; if(!data?.ok)throw new Error(data?.error||"Could not update PIN.");
    currentProfile.pin_reset_required=false; setDialogStatus("accountDialogStatus","PIN updated.");
    $("closeAccountDialogBtn")?.classList.remove("hidden"); setTimeout(()=>$("accountDialog")?.classList.add("hidden"),450);
  }catch(err){setDialogStatus("accountDialogStatus",err.message||"Could not update PIN.",true);}
}
function fmtAgo(value){if(!value)return"never";const secs=Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/1000));if(secs<60)return`${secs}s ago`;if(secs<3600)return`${Math.floor(secs/60)}m ago`;return`${Math.floor(secs/3600)}h ago`;}
async function openAdminDialog(){if(!isAdmin)return;$("adminDialog")?.classList.remove("hidden");await refreshAdminDashboard();}
function closeAdminDialog(){$("adminDialog")?.classList.add("hidden");}
async function refreshAdminDashboard(){
  if(!isAdmin)return;
  setDialogStatus("adminStatus","Loading…");
  try{
    const [sessionsRes,usersRes]=await Promise.all([supabaseClient.rpc("bandaid_admin_live_sessions",{p_token:accountToken}),supabaseClient.rpc("bandaid_admin_list_users",{p_token:accountToken})]);
    if(sessionsRes.error)throw sessionsRes.error;if(usersRes.error)throw usersRes.error;
    const sessions=sessionsRes.data||[],users=usersRes.data||[];
    $("adminActiveCount").textContent=sessions.length;$("adminStaleCount").textContent=sessions.filter(x=>x.is_stale).length;$("adminUserCount").textContent=users.length;
    $("adminSessionList").innerHTML=sessions.length?sessions.map(x=>`<div class="admin-session-row" data-session-id="${safeId(x.session_id)}"><div class="admin-session-main"><div><span class="admin-session-code">${esc(x.code)}</span> <span class="admin-session-status ${x.is_stale?'stale':''}">${x.is_stale?'STALE':'LIVE'}</span></div><div class="admin-session-meta">Leader: ${esc(x.leader_username||'Unknown')} · ${Number(x.member_count||0)} member${Number(x.member_count||0)===1?'':'s'} · started ${new Date(x.created_at).toLocaleString()} · leader seen ${fmtAgo(x.leader_last_seen)}</div></div><button class="secondary compact admin-end-session" type="button">End session</button></div>`).join(""):'<div class="admin-help">No active sessions.</div>';
    qsa(".admin-end-session").forEach(btn=>btn.addEventListener("click",async()=>{const row=btn.closest(".admin-session-row");if(!row||!confirm("End this live session for everyone?"))return;btn.disabled=true;const r=await supabaseClient.rpc("bandaid_admin_end_session",{p_token:accountToken,p_session_id:row.dataset.sessionId});if(r.error){alert(r.error.message);btn.disabled=false;}else refreshAdminDashboard();}));
    const select=$("adminUserSelect");select.innerHTML='<option value="">Choose user…</option>'+users.filter(u=>!u.is_admin).map(u=>`<option value="${safeId(u.id)}">${esc(u.username)}${u.pin_reset_required?' · reset pending':''}</option>`).join("");
    setDialogStatus("adminStatus","");
  }catch(err){setDialogStatus("adminStatus",err.message||"Could not load admin dashboard.",true);}
}
async function adminResetPin(){
  const userId=$("adminUserSelect").value,pin=$("adminTempPin").value;
  if(!userId)return setDialogStatus("adminStatus","Choose a user.",true);
  if(!/^\d{6}$/.test(pin))return setDialogStatus("adminStatus","Temporary PIN must be exactly 6 digits.",true);
  if(!confirm("Reset this user's PIN? They will be required to choose a new PIN after logging in."))return;
  try{
    setDialogStatus("adminStatus","Resetting PIN…");
    const {data,error}=await supabaseClient.rpc("bandaid_admin_reset_pin",{p_token:accountToken,p_user_id:userId,p_new_pin:pin});if(error)throw error;if(!data?.ok)throw new Error(data?.error||"PIN reset failed.");
    $("adminTempPin").value="";await refreshAdminDashboard();setDialogStatus("adminStatus","Temporary PIN set. Give it to the user privately.");
  }catch(err){setDialogStatus("adminStatus",err.message||"PIN reset failed. Make sure the admin-reset-pin Edge Function is deployed.",true);}
}

// ---------- Singer key tester ----------
const NOTE_INDEX={"C":0,"C#":1,"Db":1,"D":2,"D#":3,"Eb":3,"E":4,"F":5,"F#":6,"Gb":6,"G":7,"G#":8,"Ab":8,"A":9,"A#":10,"Bb":10,"B":11,"Cb":11};
const SHARP_NAMES=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"],FLAT_NAMES=["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"];
const KEY_OPTIONS=["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"];
let audioContext=null,keyTestNodes=[],keyTestTimers=[];
function canonicalKey(raw=""){const m=String(raw).trim().match(/(?:^|\b)([A-Ga-g])([#b]?)(?:\s*(?:major|maj))?(?:$|\b)/);if(!m)return null;const key=m[1].toUpperCase()+(m[2]||"");return NOTE_INDEX[key]!=null?key:null;}
function chordTokens(text=""){const tokens=[],regex=/^(?:[A-G](?:#|b)?)(?:m|maj|min|dim|aug|sus|add)?(?:2|4|5|6|7|9|11|13)?(?:\([^)]*\))?(?:\/[A-G](?:#|b)?)?$/;text.split(/\n/).forEach(line=>line.trim().split(/\s+/).forEach(token=>{const clean=token.replace(/[|,:;]+$/g,"");if(regex.test(clean))tokens.push(clean);}));return tokens.slice(0,8);}
function parseRoot(chord){const m=chord.match(/^([A-G](?:#|b)?)(.*)$/);return m?{root:m[1],rest:m[2]}:null;}
function transposeChord(chord,fromKey,toKey){fromKey=canonicalKey(fromKey);toKey=canonicalKey(toKey);const p=parseRoot(chord);if(!p||fromKey==null||toKey==null)return chord;const shift=(NOTE_INDEX[toKey]-NOTE_INDEX[fromKey]+12)%12;const preferFlats=/b/.test(toKey);const names=preferFlats?FLAT_NAMES:SHARP_NAMES;const newRoot=names[(NOTE_INDEX[p.root]+shift)%12];const rest=p.rest.replace(/\/([A-G](?:#|b)?)/g,(m,bass)=>{const idx=NOTE_INDEX[bass];return idx==null?m:`/${names[(idx+shift)%12]}`;});return newRoot+rest;}
function chordQuality(chord){
  const p=parseRoot(chord); if(!p)return "";
  const r=(p.rest||"").toLowerCase();
  if(/^m(?!aj)/.test(r)||/^min/.test(r))return "minor";
  if(/dim|°/.test(r))return "dim";
  return "major";
}
function inferKeyFromChordChart(text){
  const tokens=chordTokens(text||"").slice(0,20);
  if(!tokens.length)return null;
  const majorNames=SHARP_NAMES;
  let best=null,bestScore=-1,second=-1;
  for(let tonic=0;tonic<12;tonic++){
    const degrees=[0,2,4,5,7,9,11].map(x=>(tonic+x)%12);
    const qualities=["major","minor","minor","major","major","minor","dim"];
    let score=0;
    tokens.forEach((ch,i)=>{
      const p=parseRoot(ch); if(!p)return;
      const root=NOTE_INDEX[p.root]; const idx=degrees.indexOf(root); if(idx<0)return;
      score+=2;
      if(chordQuality(ch)===qualities[idx])score+=1.15;
      if(idx===0)score+=.45;
      if(i===0&&idx===0)score+=.7;
    });
    if(score>bestScore){second=bestScore;bestScore=score;best=majorNames[tonic];}
    else if(score>second)second=score;
  }
  return bestScore>=4 && bestScore-second>=.35 ? canonicalKey(best) : null;
}
function inferredSongKey(song){
  const chartKey=inferKeyFromChordChart(song?.chords||"");
  const explicit=canonicalKey(song?.key);
  // The chord chart is authoritative when it provides a confident key.
  return chartKey||explicit||null;
}
function effectiveSongKey(song){return inferredSongKey(song)||canonicalKey(song?.key)||"";}
function keyTestProgression(song,targetKey){const sourceKey=effectiveSongKey(song)||canonicalKey(targetKey)||"C";const target=canonicalKey(targetKey)||sourceKey;const chords=chordTokens(song.chords);return (chords.length?chords:[sourceKey]).slice(0,4).map(c=>transposeChord(c,sourceKey,target));}
function isChordToken(token){return /^(?:[A-G](?:#|b)?)(?:m|maj|min|dim|aug|sus|add)?(?:2|4|5|6|7|9|11|13)?(?:\([^)]*\))?(?:\/[A-G](?:#|b)?)?$/.test(token);}
function transposeChordChart(text,fromKey,toKey){fromKey=canonicalKey(fromKey);toKey=canonicalKey(toKey);if(!fromKey||!toKey||fromKey===toKey)return text||"";return String(text||"").split("\n").map(line=>{const parts=line.split(/(\s+)/);const candidates=parts.filter(x=>x.trim()).map(x=>x.replace(/^[|([{]+|[|,;:.)\]}]+$/g,""));const chordCount=candidates.filter(isChordToken).length;if(!chordCount||chordCount/Math.max(1,candidates.length)<0.5)return line;return parts.map(part=>{if(/^\s+$/.test(part))return part;const lead=(part.match(/^[|([{]+/)||[""])[0],trail=(part.match(/[|,;:.)\]}]+$/)||[""])[0];const core=part.slice(lead.length,part.length-trail.length||undefined);return isChordToken(core)?lead+transposeChord(core,fromKey,toKey)+trail:part;}).join("");}).join("\n");}
function stopKeyTest(){keyTestTimers.forEach(clearTimeout);keyTestTimers=[];keyTestNodes.forEach(n=>{try{n.stop();}catch(e){}try{n.disconnect();}catch(e){}});keyTestNodes=[];}
function chordMidi(root){return 48+(NOTE_INDEX[root]??0);}
async function playKeyTest(){const master=masterSongs.find(s=>s.id===readingId);if(!master)return;const song=dataForSong(master,readingMode);stopKeyTest();audioContext=audioContext||new (window.AudioContext||window.webkitAudioContext)();if(audioContext.state==="suspended")await audioContext.resume();const target=$("testKeySelect").value,prog=keyTestProgression(song,target);$("keyTestProgression").textContent=prog.join("  ·  ");const bpm=Math.max(40,Math.min(180,Number(song.bpm)||72)),beat=60/bpm;prog.forEach((chord,i)=>{const p=parseRoot(chord),start=audioContext.currentTime+i*beat*2;if(!p)return;const root=chordMidi(p.root),minor=/^m(?!aj)/.test(p.rest),intervals=minor?[0,3,7]:[0,4,7];intervals.forEach(semi=>{const osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.type="sine";osc.frequency.value=440*Math.pow(2,(root+semi-69)/12);gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(.05,start+.03);gain.gain.exponentialRampToValueAtTime(.0001,start+beat*1.7);osc.connect(gain).connect(audioContext.destination);osc.start(start);osc.stop(start+beat*1.8);keyTestNodes.push(osc);});});}

async function saveTransposedCopy(){
  const master=masterSongs.find(s=>s.id===readingId);if(!master)return;const current=dataForSong(master,readingMode);const sourceKey=inferredSongKey(current),targetKey=canonicalKey($("transposeKeySelect")?.value);if(!sourceKey||!targetKey)return alert("Set a valid song key first.");
  const transposed=transposeChordChart(current.chords,sourceKey,targetKey);if(sourceKey===targetKey)return alert("Choose a different key to transpose.");
  if(personalCopies.has(master.id)&&!confirm(`Replace the chords in your private copy with a ${targetKey} transposition?`))return;
  const payload={song_key:targetKey,capo:current.capo||"",bpm:current.bpm||"",chords:transposed,tabs:current.tabs||"",notes:current.notes||"",shapes:current.shapes||[]};
  const {data,error}=await supabaseClient.rpc("bandaid_save_personal_copy",{p_token:accountToken,p_song_id:master.id,p_payload:payload});if(error)return alert(`Could not save transposed copy: ${error.message}`);personalCopies.set(master.id,fromCopyRow(data));cacheCloudData();readingMode="mine";renderLibrary();openReader(master.id,"mine");
}

// ---------- Backup + legacy migration ----------
function backupStatus(message,isError=false){const el=$("backupStatus");el.textContent=message;el.classList.remove("hidden");el.classList.toggle("error",!!isError);}
function exportBackup(){const payload={format:"BandAid v2 Backup",version:"2.3.0",exportedAt:new Date().toISOString(),username:currentProfile?.username,personalCopies:[...personalCopies.values()],legacySongs:legacySongs()};const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`BandAid_Backup_${new Date().toISOString().slice(0,10)}.json`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);backupStatus("Backup exported.");}
async function prepareRestore(file){if(!file)return;try{const raw=JSON.parse(await file.text());const rows=raw.legacySongs||raw.songs||raw.data?.songs||[];if(!Array.isArray(rows))throw new Error("No compatible legacy songs found.");localStorage.setItem(LEGACY_STORAGE_KEY,JSON.stringify(rows));backupStatus(`Restored ${rows.length} legacy song${rows.length===1?"":"s"}. ${isAdmin?"Use ‘Import Local Songs to Master’ to publish them.":"They remain local until an admin imports them."}`);$("importLocalMasterBtn")?.classList.toggle("hidden",!isAdmin||rows.length===0);}catch(err){backupStatus(`Restore failed: ${err.message}`,true);}finally{$("backupFileInput").value="";}}
async function importLocalSongsToMaster(){
  if(!isAdmin)return;const rows=legacySongs();if(!rows.length)return backupStatus("No legacy local songs found.",true);if(!confirm(`Import ${rows.length} local song${rows.length===1?"":"s"} into the shared Master Library?`))return;
  backupStatus("Importing local songs…");let ok=0;
  for(const s of rows){const payload={legacy_id:String(s.id||`${s.title}-${s.artist}-${s.role}`),title:s.title||"Untitled",artist:s.artist||"",role:ROLES.includes(s.role)?s.role:"Acoustic Guitar",song_key:s.key||"",capo:s.capo||"",bpm:String(s.bpm||""),chords:s.chords||"",tabs:s.tabs||"",notes:s.notes||"",shapes:Array.isArray(s.shapes)?s.shapes:[]};const {data,error}=await supabaseClient.rpc("bandaid_save_master_song",{p_token:accountToken,p_payload:payload});if(!error&&data?.id)ok++;}
  backupStatus(`Imported ${ok} of ${rows.length} songs into the Master Library.`);await loadSongLibrary();
}

// ---------- UI wiring ----------
qsa(".role-card").forEach(card=>card.addEventListener("click",()=>setActiveRole(card.dataset.role)));
$("changeRoleBtn")?.addEventListener("click",()=>showView("roleView"));
$("newSongBtn")?.addEventListener("click",()=>openEditor(null,"master")); $("emptyAddBtn")?.addEventListener("click",()=>openEditor(null,"master"));
$("backBtn")?.addEventListener("click",()=>{renderLibrary();showView("libraryView")}); $("readerBackBtn")?.addEventListener("click",()=>{renderLibrary();showView("libraryView")});
$("saveBtn")?.addEventListener("click",saveEditor); $("deleteBtn")?.addEventListener("click",deleteEditing);
$("editBtn")?.addEventListener("click",()=>{const m=masterSongs.find(s=>s.id===readingId);if(!m)return;if(readingMode==="official"&&isAdmin)openEditor(m,"master");else openEditor(m,"copy");});
$("copyToggleBtn")?.addEventListener("click",togglePersonalCopy); $("addShapeBtn")?.addEventListener("click",()=>addShapeCard());
$("searchInput")?.addEventListener("input",renderLibrary); $("sortSelect")?.addEventListener("change",renderLibrary);
qsa(".tab").forEach(btn=>btn.addEventListener("click",()=>{qsa(".tab").forEach(b=>b.classList.remove("active"));qsa(".panel").forEach(p=>p.classList.remove("active"));btn.classList.add("active");$(btn.dataset.panel).classList.add("active");}));
qsa(".reader-tab").forEach(btn=>btn.addEventListener("click",()=>{qsa(".reader-tab").forEach(b=>b.classList.remove("active"));qsa(".reader-panel").forEach(p=>p.classList.remove("active"));btn.classList.add("active");$(btn.dataset.rpanel).classList.add("active");}));
$("loginTabBtn")?.addEventListener("click",()=>setAuthMode("login")); $("signupTabBtn")?.addEventListener("click",()=>setAuthMode("signup")); $("authSubmitBtn")?.addEventListener("click",submitAuth); $("authPassword")?.addEventListener("keydown",e=>{if(e.key==="Enter")submitAuth();}); $("authPasswordConfirm")?.addEventListener("keydown",e=>{if(e.key==="Enter")submitAuth();}); $("logoutBtn")?.addEventListener("click",logout);
$("createSessionBtn")?.addEventListener("click",createLiveSession); $("joinSessionBtn")?.addEventListener("click",joinLiveSession); $("leaveSessionBtn")?.addEventListener("click",leaveLiveSession); $("sessionCodeInput")?.addEventListener("keydown",e=>{if(e.key==="Enter")joinLiveSession();}); qsa(".cue-btn").forEach(btn=>btn.addEventListener("click",()=>sendLiveCue(btn.dataset.cue)));
if(cueChannel)cueChannel.addEventListener("message",e=>showLiveCue(e.data));window.addEventListener("storage",e=>{if(e.key===LIVE_CUE_KEY&&e.newValue){try{showLiveCue(JSON.parse(e.newValue));}catch(x){}}});
$("testKeySelect")?.addEventListener("change",()=>{stopKeyTest();$("testKeySelect").dataset.touched="1";const m=masterSongs.find(s=>s.id===readingId);if(m){const selectedKey=$("testKeySelect").value;$("keyTestProgression").textContent=keyTestProgression(dataForSong(m,readingMode),selectedKey).join("  ·  ");}}); $("playKeyTestBtn")?.addEventListener("click",playKeyTest); $("stopKeyTestBtn")?.addEventListener("click",stopKeyTest);
$("transposeKeySelect")?.addEventListener("change",()=>{$("transposeKeySelect").dataset.touched="1";const m=masterSongs.find(s=>s.id===readingId);if(m)renderReader(m,readingMode);}); $("resetTransposeBtn")?.addEventListener("click",()=>{const m=masterSongs.find(s=>s.id===readingId);if(!m)return;const s=dataForSong(m,readingMode),source=inferredSongKey(s)||"C";$("transposeKeySelect").value=source;$("transposeKeySelect").dataset.touched="1";renderReader(m,readingMode);}); $("saveTransposeCopyBtn")?.addEventListener("click",saveTransposedCopy);
$("backupBtn")?.addEventListener("click",()=>{$("backupPanel").classList.toggle("hidden");if(!$("backupPanel").classList.contains("hidden"))$("backupPanel").scrollIntoView({behavior:"smooth",block:"nearest"});}); $("closeBackupBtn")?.addEventListener("click",()=>$("backupPanel").classList.add("hidden")); $("exportBackupBtn")?.addEventListener("click",exportBackup); $("importBackupBtn")?.addEventListener("click",()=>$("backupFileInput").click()); $("backupFileInput")?.addEventListener("change",e=>prepareRestore(e.target.files?.[0])); $("importLocalMasterBtn")?.addEventListener("click",importLocalSongsToMaster);


$("listsBtn")?.addEventListener("click",openListsDialog);
$("closeListsDialogBtn")?.addEventListener("click",closeListsDialog);
$("createListBtn")?.addEventListener("click",createSongList);
$("newListName")?.addEventListener("keydown",e=>{if(e.key==="Enter")createSongList();});
$("addToListBtn")?.addEventListener("click",openAddToListDialog);
$("closeAddToListDialogBtn")?.addEventListener("click",closeAddToListDialog);
$("chordLibraryBtn")?.addEventListener("click",openChordLibrary);
$("closeChordLibraryDialogBtn")?.addEventListener("click",closeChordLibrary);
$("saveChordBtn")?.addEventListener("click",()=>saveChordToLibrary());


const SONG_FONT_STORAGE_KEY="bandaid_song_font_scale";
let songFontScale=Math.max(0.8,Math.min(1.6,Number(localStorage.getItem(SONG_FONT_STORAGE_KEY))||1));
function applySongFontScale(){
  if($("readerChords")) $("readerChords").style.fontSize=`${songFontScale}rem`;
  if($("songChordsPreview")) $("songChordsPreview").style.fontSize=`${songFontScale}rem`;
  if($("songFontSizeLabel")) $("songFontSizeLabel").textContent=`${Math.round(songFontScale*100)}%`;
}
function changeSongFont(delta){
  songFontScale=Math.max(0.8,Math.min(1.6,Math.round((songFontScale+delta)*10)/10));
  localStorage.setItem(SONG_FONT_STORAGE_KEY,String(songFontScale));
  applySongFontScale();
}

$("songChords")?.addEventListener("input",updateEditorChartPreview);
$("songFontDownBtn")?.addEventListener("click",()=>changeSongFont(-0.1));
$("songFontUpBtn")?.addEventListener("click",()=>changeSongFont(0.1));
applySongFontScale();
$("accountBtn")?.addEventListener("click",()=>openAccountDialog(false)); $("closeAccountDialogBtn")?.addEventListener("click",closeAccountDialog); $("saveNewPinBtn")?.addEventListener("click",saveOwnPin); $("newPinConfirmInput")?.addEventListener("keydown",e=>{if(e.key==="Enter")saveOwnPin();});
$("adminBtn")?.addEventListener("click",openAdminDialog); $("closeAdminDialogBtn")?.addEventListener("click",closeAdminDialog); $("refreshAdminBtn")?.addEventListener("click",refreshAdminDashboard); $("adminResetPinBtn")?.addEventListener("click",adminResetPin); $("adminTempPin")?.addEventListener("keydown",e=>{if(e.key==="Enter")adminResetPin();});
window.addEventListener("beforeunload",()=>stopLeaderHeartbeat());

setAuthMode("login"); bootstrapAuth();
