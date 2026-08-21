
const STORAGE_KEY = "chordVaultSongsV1";

let songs = loadSongs();
let editingId = null;
let readingId = null;
let activeRole = localStorage.getItem("chordVaultActiveRole") || "Singers";
const ROLES = ["Singers","Electric Guitar","Acoustic Guitar","Bass Guitar"];

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
  qsa(".role-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.role === activeRole));
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
  qsa(".role-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.role === role));
  renderLibrary();
}
qsa(".role-tab").forEach(btn => btn.addEventListener("click",()=>setActiveRole(btn.dataset.role)));
qsa(".role-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.role === activeRole));

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

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js", {scope:"./"}).catch(()=>{}));
}
renderLibrary();
