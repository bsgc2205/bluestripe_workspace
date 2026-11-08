'use strict';
const ITER = 310000;
const LS_KEY = 'bsgc-ledger-v1';
const DEFAULT_TYPES = ['수입통관','수출신고','요건확인·검역','화학물질','품목분류','관세환급','외환신고','AEO','FTA원산지','기타'];
const STATUSES = ['진행중','보류','완료'];
// 법정 기한 계산 규칙 (일반 규정 기준 참고값)
const DL_RULES = [
  {kind:'FTA 사후적용 신청', base:'수입신고 수리일', n:1, u:'y'},
  {kind:'세액 보정신청', base:'신고납부일', n:6, u:'m'},
  {kind:'경정청구', base:'최초 신고납부일', n:5, u:'y'},
  {kind:'수출물품 적재기한', base:'수출신고 수리일', n:30, u:'d'},
  {kind:'관세환급 신청', base:'수출 이행일', n:2, u:'y'},
  {kind:'직접 입력', base:null}
];
// 정정·보완 원인과 신고 전 점검 문구
const CAUSES = ['중량','수량','단가·금액','품명·규격','HS 코드','주소','제조자','거래구분','원산지','선적일','증빙 보완'];
const CAUSE_HINTS = {
  '중량':'출고 시 계근한 실중량(순중량·총중량)으로 신고했는가',
  '수량':'Invoice, Packing List, 실제 출고 수량이 서로 맞는가',
  '단가·금액':'Invoice 단가, 통화, 결제금액이 신고 내용과 맞는가',
  '품명·규격':'품명·모델·규격이 Invoice와 포장 표기와 일치하는가',
  'HS 코드':'HS 코드가 품목·요건 표와 지난 신고와 일치하는가',
  '주소':'수출입자·해외 거래처 주소가 최신 정보인가',
  '제조자':'제조자 상호와 통관고유부호가 맞는가',
  '거래구분':'거래구분(유상·무상·위탁 등)이 실제 거래와 맞는가',
  '원산지':'원산지 표기와 결정기준이 원산지증명서·소명서와 맞는가',
  '선적일':'선적 일정이 확정됐는가 (C/O 신청 전 선적일 재확인)',
  '증빙 보완':'정정을 뒷받침할 출고·실물 증빙(ERP 캡처, S/N 목록, 서명 P/I)을 준비했는가'
};
const CAUSE_WORDS = {
  '중량':['중량'], '수량':['수량'], '단가·금액':['단가','결제금액','가격'], '품명·규격':['품명','규격'],
  'HS 코드':['hs 코드','hs-code','hs코드','세번'], '주소':['주소'], '제조자':['제조자','제조사'], '거래구분':['거래구분'],
  '원산지':['원산지'], '선적일':['선적일','선적 연기'], '증빙 보완':['기각','보완','증빙','erp','s/n']
};
// 사유서 종류
const LETTER_TYPES = {
  co_after:{name:'C/O 선적 후 발급 사유서', title:'원산지증명서 선적 후 발급신청 사유서', numLabel:'C/O 신청번호', to:'서울세관 구로비즈니스센터', recType:'FTA원산지',
    reasons:['수입자 측과 확인절차 지연','선적 서류 확정 지연','해외 거래처의 서류 요청 지연']},
  co_amend:{name:'C/O 정정발급 사유서', title:'원산지증명서 정정 발급신청 사유서', numLabel:'C/O 발급번호', to:'서울세관 구로비즈니스센터', recType:'FTA원산지',
    reasons:['선적일 지연','선박 변경','수량 변경','수입자 정보 변경']},
  exp_amend:{name:'수출신고 정정 사유서', title:'수출신고 정정신청 사유서', numLabel:'수출신고번호', to:'', recType:'수출신고',
    reasons:['출고 시 실중량 확정','해외 거래처 요청','서류 작성 착오','선적 일정 변경']}
};
const TO_LIST = ['서울세관 구로비즈니스센터','서울세관장','수원세관장','인천세관장','평택세관장','부산세관장','대한상공회의소'];
const enc = new TextEncoder(), dec = new TextDecoder();
const $ = s => document.querySelector(s);

let db = null, key = null, salt = null, iterUsed = ITER;
let dekRaw = null, dataKey = null, accounts = [], me = null;
let contactCat = '전체', feeState = {amount:'', pid:'', rate:'', min:'', max:'', extras:''}, blResult = null, blBusy = false;
const CONTACT_CATS = ['선사','포워더','창고','터미널','세관','운송','택배','기타'];
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
let remoteBlob = null, localBlob = null, serverBlob = null, serverPre = null, remoteUpdatedAt = null, exportedAt = null;
let route = {name:'home', id:null}, typeFilter = '전체';
let sOpt = {type:'', special:false}, hlRe = null;
let openCk = new Set(), rptMonth = null, folderOpen = {long:true, other:false};
let mailCache = null, mailLoading = false, mailErr = '';

/* ---------- helpers ---------- */
function esc(s){return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function uid(){return Date.now().toString(36) + Math.random().toString(36).slice(2,8);}
function today(){const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,10);}
function nowIso(){return new Date().toISOString();}
function b64(buf){const b = new Uint8Array(buf); let s = ''; for(let i=0;i<b.length;i+=0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i+0x8000)); return btoa(s);}
function unb64(s){const bin = atob(s); const u = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i] = bin.charCodeAt(i); return u;}
function hl(t){const s = esc(t); return hlRe ? s.replace(hlRe, '<mark>$1</mark>') : s;}
function safeUrl(u){try{const x = new URL(String(u).trim()); return /^https?:$/.test(x.protocol) ? x.href : null;}catch{return null;}}
function linkLabel(u){try{const h = new URL(u).hostname; if(h.includes('mail.google')) return 'Gmail'; if(h.includes('drive.google')||h.includes('docs.google')) return 'Drive'; return h.replace(/^www\./,'');}catch{return '링크';}}
function clientName(id){if(!id) return '공통'; const c = db.clients.find(c => c.id === id); return c ? c.name : '(삭제된 업체)';}
function typeOrder(t){const i = db.settings.taskTypes.indexOf(t); return i < 0 ? 999 : i;}
function recDate(r){return r.status === '완료' ? (r.date || r.startDate || '') : (r.startDate || r.date || '');}
function byDateDesc(a,b){return recDate(b).localeCompare(recDate(a)) || (b.createdAt||'').localeCompare(a.createdAt||'');}
function hay(...a){return a.map(v => Array.isArray(v) ? v.map(x => typeof x === 'object' ? (x.text||'') : x).join(' ') : (v || '')).join(' ').toLowerCase();}
function lines(s){return String(s||'').split('\n').map(x => x.trim()).filter(Boolean);}
function splitDocs(s){return String(s||'').split(/[,\n]/).map(x => x.trim()).filter(Boolean);}
function opts(list, sel){return list.map(v => {const [val,lab] = Array.isArray(v) ? v : [v,v]; return `<option value="${esc(val)}"${val===sel?' selected':''}>${esc(lab)}</option>`;}).join('');}
function typeList(sel){const t = [...db.settings.taskTypes]; if(sel && !t.includes(sel)) t.push(sel); return t;}
function sortedClients(){return [...db.clients].sort((a,b) => a.name.localeCompare(b.name,'ko'));}
function won(n){return (n||0).toLocaleString('ko-KR') + '원';}
function toast(msg){const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 3600);}
function download(name, text, mime = 'application/json'){const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type:mime})); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);}

/* 기간 계산: 초일 불산입 기준으로 '기준일 + 기간'의 같은 날짜를 말일로 봄 (월말은 해당 월 말일로 맞춤) */
function addPeriod(iso, n, u){
  const [y,m,d] = iso.split('-').map(Number);
  if(u === 'd') return new Date(Date.UTC(y, m-1, d+n)).toISOString().slice(0,10);
  const tm = (m-1) + (u === 'y' ? n*12 : n);
  const ty = y + Math.floor(tm/12), mm = ((tm % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, mm+1, 0)).getUTCDate();
  return `${ty}-${String(mm+1).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`;
}
function daysLeft(due){return Math.round((Date.parse(due) - Date.parse(today())) / 864e5);}
function ddayHTML(due){
  const n = daysLeft(due);
  const cls = n < 0 ? 'over' : n <= 7 ? 'soon' : '';
  return `<span class="dday ${cls}">${n < 0 ? 'D+' + (-n) : n === 0 ? 'D-day' : 'D-' + n}</span>`;
}
function isAmend(r){return /정정|수정신고|보완|기각|경정/.test(hay(r.title, r.tags, r.summary));}
function causesOf(r){
  if(Array.isArray(r.causes)) return r.causes;
  if(!isAmend(r)) return [];
  const h = hay(r.title, r.summary, r.specialNote, r.tags);
  return CAUSES.filter(c => CAUSE_WORDS[c].some(w => h.includes(w)));
}
function clientCauses(cid){
  const m = {}, recs = db.records.filter(r => r.clientId === cid);
  let n = 0;
  recs.forEach(r => { const cs = causesOf(r); if(cs.length) n++; cs.forEach(c => m[c] = (m[c] || 0) + 1); });
  return {list: Object.entries(m).sort((a,b) => b[1] - a[1] || CAUSES.indexOf(a[0]) - CAUSES.indexOf(b[0])), records: n};
}
function josa(w, a){
  const ch = String(w).trim().slice(-1), code = ch.charCodeAt(0) - 0xAC00;
  const has = code >= 0 && code <= 11171 ? code % 28 : -1;
  if(a === '으로') return has === 0 || has === 8 || has === -1 ? '로' : '으로';
  return has > 0 ? a : ({'이':'가','을':'를','은':'는'}[a] || a);
}
function monthsBetween(a, b){const [y1,m1] = a.split('-').map(Number), [y2,m2] = b.split('-').map(Number); return (y2-y1)*12 + (m2-m1);}
/* 거래 기간: 업체 정보의 거래 시작·최근 업무 월과 기록 날짜를 합쳐 계산. 1년 이상 유지 = 기간 12개월 이상 + 최근 12개월 안에 업무 */
function relationOf(c){
  const rel = c.relation || {};
  const ds = db.records.filter(r => r.clientId === c.id).map(recDate).filter(Boolean).map(d => d.slice(0,7)).sort();
  const firsts = [rel.since, ds[0]].filter(Boolean).sort(), lasts = [rel.last, ds[ds.length-1]].filter(Boolean).sort();
  const first = firsts[0] || '', last = lasts[lasts.length-1] || '';
  const months = first && last ? monthsBetween(first, last) : 0;
  const recent = !!last && monthsBetween(last, today().slice(0,7)) <= 12;
  return {first, last, months, recent, longTerm: months >= 12 && recent, basis: rel.basis || ''};
}
function relationText(r){
  if(!r.first) return '거래 기간 정보 없음';
  const span = r.months >= 12 ? `${Math.floor(r.months/12)}년${r.months % 12 ? ' ' + (r.months % 12) + '개월' : ''}` : `${r.months}개월`;
  return `${r.first} ~ ${r.last} (${span})${r.recent ? '' : ', 최근 1년 업무 없음'}`;
}
function openDeadlines(){
  const out = [];
  db.records.forEach(r => (r.deadlines||[]).forEach(d => { if(!d.done) out.push({r, d}); }));
  return out.sort((a,b) => a.d.due.localeCompare(b.d.due));
}

/* ---------- crypto ---------- */
async function deriveKey(pw, s, iter){
  const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', salt:s, iterations:iter, hash:'SHA-256'}, base, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
}
async function importDek(raw){return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt','decrypt']);}
/* 계정 방식: 데이터는 무작위 데이터 키로 암호화하고, 계정마다 자기 비밀번호로 그 키를 감싸 둔다 */
async function wrapFor(id, name, role, pw){
  const sl = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const kek = await deriveKey(pw, sl, ITER);
  const w = await crypto.subtle.encrypt({name:'AES-GCM', iv}, kek, dekRaw);
  return {id, name, role, salt:b64(sl), iter:ITER, iv:b64(iv), wrapped:b64(w)};
}
async function encryptDb(text){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, dataKey, enc.encode(text || JSON.stringify(db)));
  return {format:'bsgc-ledger', v:3, accounts, iv:b64(iv), ct:b64(ct)};
}
async function openBlob(blob, id, pw){
  if(Array.isArray(blob.accounts)){
    const a = blob.accounts.find(x => x.id.toLowerCase() === String(id || '').trim().toLowerCase());
    if(!a) throw new Error('no account');
    const kek = await deriveKey(pw, unb64(a.salt), a.iter || ITER);
    const raw = new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM', iv:unb64(a.iv)}, kek, unb64(a.wrapped)));
    const k = await importDek(raw);
    const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv:unb64(blob.iv)}, k, unb64(blob.ct));
    return {data:JSON.parse(dec.decode(pt)), raw, key:k, accounts:blob.accounts, me:{id:a.id, name:a.name, role:a.role}};
  }
  const sl = unb64(blob.salt), it = blob.iter || ITER;
  const k = await deriveKey(pw, sl, it);
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv:unb64(blob.iv)}, k, unb64(blob.ct));
  return {data:JSON.parse(dec.decode(pt)), legacy:true};
}
function accountName(id){const a = accounts.find(x => x.id === id); return a ? a.name : id;}
async function persistLocal(){
  try{const b = await encryptDb(); localStorage.setItem(LS_KEY, JSON.stringify(b)); localBlob = b;}
  catch(e){toast('브라우저 저장에 실패했습니다. 지금 암호화 파일을 받아 두세요.');}
}

/* ---------- data ---------- */
function migrate(d){
  d.meta = d.meta || {}; d.settings = d.settings || {};
  if(!Array.isArray(d.settings.taskTypes) || !d.settings.taskTypes.length) d.settings.taskTypes = [...DEFAULT_TYPES];
  d.settings.mail = d.settings.mail || {endpoint:'', token:''};
  ['clients','procedures','records','items','mailSeen','contacts','inquiries'].forEach(k => { if(!Array.isArray(d[k])) d[k] = []; });
  if(!Array.isArray(d.settings.feeProfiles)) d.settings.feeProfiles = [];
  if(!Array.isArray(d.kc)) d.kc = [];
  d.kcMeta = d.kcMeta || {};
  d.records.forEach(r => {
    if(!STATUSES.includes(r.status)) r.status = '완료';
    r.startDate = r.startDate || r.date || '';
    ['checklist','docs','deadlines','tags','links','reflected'].forEach(k => { if(!Array.isArray(r[k])) r[k] = []; });
  });
  d.meta.version = 2;
  d.meta.updatedAt = d.meta.updatedAt || nowIso();
  return d;
}
function newDb(){
  const t = nowIso();
  return migrate({meta:{version:2, createdAt:t, updatedAt:t}, settings:{taskTypes:[...DEFAULT_TYPES], mail:{endpoint:'', token:''}}, clients:[], procedures:[], records:[], items:[], mailSeen:[]});
}

/* ---------- gate ---------- */
async function boot(){
  if(!(window.crypto && crypto.subtle)){
    $('#gateUnlock').hidden = false;
    $('#gateMsg').textContent = '이 화면에서는 암호화를 쓸 수 없습니다. https 주소(GitHub Pages)나 최신 브라우저로 여세요.';
    return;
  }
  try{const s = localStorage.getItem(LS_KEY); if(s) localBlob = JSON.parse(s);}catch{}
  const sc = storedSync();
  if(sc){
    $('#gateMsg').textContent = 'Drive에서 최신 Workspace를 확인하는 중…';
    try{const res = await syncGet(sc, {load:1}); serverPre = {endpoint: sc.endpoint, res}; if(res.blob && res.blob.ct && Array.isArray(res.blob.accounts)) serverBlob = res.blob;}catch{}
    $('#gateMsg').textContent = '';
  }
  showGate(remoteBlob || localBlob || serverBlob ? 'unlock' : 'new');
}
function showGate(mode){
  const u = mode === 'unlock';
  $('#gateUnlock').hidden = !u; $('#gateNew').hidden = u;
  $('#gateToNew').hidden = !u; $('#gateToUnlock').hidden = u || !(remoteBlob || localBlob || serverBlob);
  $('#gateFileLink').hidden = !u;
  try{const lu = localStorage.getItem(LS_KEY + '-uid'); if(lu && !$('#uid').value) $('#uid').value = lu;}catch{}
  (u ? ($('#uid').value ? $('#pw') : $('#uid')) : $('#nid')).focus();
}
async function unlock(){
  const id = $('#uid').value.trim(), pw = $('#pw').value, msg = $('#gateMsg');
  if(!pw){msg.textContent = '비밀번호를 입력하세요.'; return;}
  msg.textContent = '여는 중…';
  let remote = null, local = null, server = null;
  if(remoteBlob) try{remote = await openBlob(remoteBlob, id, pw);}catch{}
  if(localBlob) try{local = await openBlob(localBlob, id, pw);}catch{}
  if(serverBlob) try{server = await openBlob(serverBlob, id, pw);}catch{}
  if(!remote && !local && !server){msg.textContent = '아이디 또는 비밀번호가 맞지 않습니다.'; return;}
  let pick = remote || local || server;
  if(remote && local && (local.data.meta?.updatedAt || '') > (remote.data.meta?.updatedAt || '')) pick = local;
  remoteUpdatedAt = remote ? (remote.data.meta?.updatedAt || null) : null;
  db = migrate(pick.data);
  let migrated = false;
  if(pick.legacy){
    dekRaw = crypto.getRandomValues(new Uint8Array(32)); dataKey = await importDek(dekRaw);
    const aid = id || 'admin';
    accounts = [await wrapFor(aid, '관리자', 'admin', pw)]; me = {id:aid, name:'관리자', role:'admin'};
    db.meta.updatedAt = nowIso(); migrated = true;
  } else { dekRaw = pick.raw; dataKey = pick.key; accounts = pick.accounts; me = pick.me; }
  try{localStorage.setItem(LS_KEY + '-uid', me.id); exportedAt = localStorage.getItem(LS_KEY + '-exported');}catch{}
  await persistLocal();
  if(syncCfg()){ msg.textContent = 'Drive의 Workspace와 맞추는 중…'; await syncStart(serverPre); }
  enterApp();
  if(migrated) toast(`계정 로그인 방식으로 바뀌었습니다. 다음부터 아이디 ‘${me.id}’와 같은 비밀번호로 로그인하고, ${sync.on ? '' : '파일을 새로 받아 Drive에 저장하세요.'}`);
  else if(remoteBlob && !remote) toast('고른 파일은 이 계정으로 열리지 않아, 이 브라우저에 저장된 사본을 열었습니다.');
  else if(remote && pick === local && !sync.on) toast('이 브라우저에 있는 내용이 고른 파일보다 최신이라 그것을 열었습니다. 작업 후 Drive 파일을 새로 저장하세요.');
}
async function createNew(){
  const id = $('#nid').value.trim(), name = $('#nname').value.trim() || id, a = $('#pw1').value, b = $('#pw2').value, msg = $('#gateMsg2');
  if(!/^[A-Za-z0-9._-]{3,20}$/.test(id)){msg.textContent = '아이디는 영문·숫자 3~20자로 정하세요.'; return;}
  if(a.length < 10){msg.textContent = '비밀번호는 10자 이상으로 정하세요.'; return;}
  if(a !== b){msg.textContent = '두 비밀번호가 다릅니다.'; return;}
  if(localBlob && !confirm('이 브라우저에 저장된 기존 Workspace를 새것으로 덮어씁니다. Drive에 저장한 파일은 그대로 남습니다. 계속할까요?')) return;
  msg.textContent = '만드는 중…';
  dekRaw = crypto.getRandomValues(new Uint8Array(32)); dataKey = await importDek(dekRaw);
  accounts = [await wrapFor(id, name, 'admin', a)]; me = {id, name, role:'admin'};
  db = newDb(); remoteUpdatedAt = null; remoteBlob = null;
  try{localStorage.setItem(LS_KEY + '-uid', id); localStorage.removeItem(LS_KEY + '-base');}catch{}
  serverBlob = null; serverPre = null;
  await persistLocal();
  enterApp();
  toast('새 Workspace를 만들었습니다. ‘암호화 파일 받기’로 받은 파일을 Drive 유틸 폴더에 저장하세요.');
}
/* 예전 버전이 만들던 '(예시)' 업체와 그 기록·절차·품목은 언제 다시 섞여 들어와도 지운다 */
function purgeSamples(d){
  const ids = new Set(d.clients.filter(c => /\(예시\)/.test(c.name)).map(c => c.id));
  if(!ids.size) return 0;
  d.clients = d.clients.filter(c => !ids.has(c.id));
  ['records','procedures','items','inquiries'].forEach(k => { d[k] = (d[k] || []).filter(x => !ids.has(x.clientId)); });
  d.records = d.records.filter(r => !/^예시-/.test(r.refNo || ''));
  return ids.size;
}
function enterApp(){
  $('#gate').hidden = true; $('#app').hidden = false;
  const n = purgeSamples(db);
  if(n){ commit(); setTimeout(() => toast(`예시 업체 ${n}곳과 관련 기록을 지웠습니다.`), 600); }
  render();
  if(ensureCaseNos(db)) commit();
  if((db.settings.mail || {}).endpoint){ setTimeout(() => runCollect(false), 1200); setTimeout(() => loadMail(false), 2500); setTimeout(() => refreshCustoms(false), 6000); }
}

/* ---------- save state ---------- */
function commit(){ensureCaseNos(db); db.meta.updatedAt = nowIso(); render(); persistLocal(); scheduleSync();}
let mineOnly = false;
function updateSaveState(){
  const el = $('#saveState'); let text, dirty = false;
  const bx = $('#btnExport');
  if(bx){ bx.textContent = sync.on ? '파일 백업' : '암호화 파일 받기'; bx.className = sync.on ? 'ghost' : 'primary'; }
  if(sync.on || sync.state === 'mismatch'){
    const d = sync.at ? new Date(sync.at) : null, p2 = n => String(n).padStart(2, '0');
    const at = d && !isNaN(d) ? `${d.getMonth() + 1}/${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())}` : '';
    const by = sync.by && me && sync.by !== me.name && sync.by !== me.id ? ` · ${sync.by}` : '';
    const map = {busy:'저장 중…', wait:'저장 대기 중', fail:'Drive 저장 실패, 잠시 뒤 다시 시도', offline:'서버 연결 안 됨 (이 PC에 보관 중)', mismatch:'Drive 자동 저장 꺼짐'};
    text = map[sync.state] || `Drive 저장됨${at ? ' ' + at : ''}${by}`;
    dirty = ['fail','offline','mismatch'].includes(sync.state);
    el.textContent = text; el.classList.toggle('dirty', dirty); el.title = sync.err || '';
    return;
  }
  if(remoteUpdatedAt && db.meta.updatedAt === remoteUpdatedAt) text = '연 파일과 같습니다';
  else if(exportedAt === db.meta.updatedAt) text = '최신 파일을 받아 두었습니다';
  else {text = 'Drive에 저장할 변경이 있습니다'; dirty = true;}
  el.textContent = text; el.classList.toggle('dirty', dirty);
}
async function exportEnc(){
  const b = await encryptDb();
  download('data.enc.json', JSON.stringify(b));
  exportedAt = db.meta.updatedAt; updateSaveState();
  try{localStorage.setItem(LS_KEY + '-exported', exportedAt);}catch{}
  toast('data.enc.json을 받았습니다. Drive 유틸 폴더의 기존 파일에 같은 이름으로 덮어쓰세요.');
}
