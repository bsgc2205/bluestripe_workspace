'use strict';
/* ---------- Drive 자동 저장 (Apps Script 웹 앱 → Drive의 data.enc.json) ----------
   암호화는 지금처럼 브라우저에서 하고, 암호문만 Apps Script로 보낸다.
   서버 파일에는 저장 번호(rev)가 있어, 내가 마지막으로 받은 번호와 다르면 저장을 거절하고 최신 파일을 돌려준다.
   그때는 '마지막으로 맞춘 내용(base)'을 기준으로 내 변경과 다른 계정의 변경을 항목·칸 단위로 합친 뒤 다시 저장한다. */
const SYNC_DELAY = 4000, SYNC_POLL = 90000, SYNC_TIMEOUT = 20000;
const sync = {on:false, rev:0, base:null, baseAcc:null, busy:false, again:false, timer:null, state:'', at:'', by:'', err:''};
const jstr = x => JSON.stringify(x);
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const saveTip = () => sync.on ? '' : ' 암호화 파일을 새로 받아 Drive에 저장하세요.';
function syncCfg(){ const m = (db && db.settings.mail) || {}; return m.endpoint && m.token ? m : null; }
function storedSync(){ try{ const s = JSON.parse(localStorage.getItem(LS_KEY + '-sync') || 'null'); return s && s.endpoint && s.token ? s : null; }catch{ return null; } }
function rememberSync(){
  try{ const c = syncCfg(); if(c) localStorage.setItem(LS_KEY + '-sync', jstr({endpoint:c.endpoint, token:c.token})); else localStorage.removeItem(LS_KEY + '-sync'); }catch{}
}
async function syncFetch(url, opt = {}){
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), SYNC_TIMEOUT);
  try{
    const r = await fetch(url, {...opt, cache:'no-store', signal:ac.signal});
    const j = await r.json().catch(() => { throw new Error('Apps Script 응답을 읽지 못했습니다. 새 버전으로 재배포했는지 확인하세요.'); });
    return j;
  }catch(e){ throw new Error(e.name === 'AbortError' ? '서버 응답이 늦습니다' : e.message); }
  finally{ clearTimeout(t); }
}
async function syncGet(cfg, params){
  const u = new URL(cfg.endpoint); u.searchParams.set('token', cfg.token);
  Object.entries(params).forEach(([k,v]) => u.searchParams.set(k, v));
  const j = await syncFetch(u.href);
  if(!j.ok) throw new Error(j.error || '응답 오류');
  return j;
}
function syncPost(cfg, body){
  // text/plain으로 보내야 브라우저의 사전 확인(CORS preflight) 없이 Apps Script에 닿는다
  return syncFetch(cfg.endpoint, {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:jstr({token:cfg.token, ...body})});
}
async function decryptServer(blob){
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv:unb64(blob.iv)}, dataKey, unb64(blob.ct));
  return JSON.parse(dec.decode(pt));
}
function isDirty(){
  if(!db) return false;
  if(!sync.base) return true;
  return jstr(db) !== jstr(sync.base) || jstr(accounts) !== jstr(sync.baseAcc);
}
function setBase(blob, data){
  sync.rev = blob.rev || 0; sync.base = data; sync.baseAcc = clone(blob.accounts);
  sync.at = blob.savedAt || sync.at; sync.by = blob.savedBy || sync.by;
  try{ localStorage.setItem(LS_KEY + '-base', jstr(blob)); }catch{ try{ localStorage.removeItem(LS_KEY + '-base'); }catch{} }
}

/* 3자 병합: 기준(base)에서 한쪽만 바뀐 값은 바뀐 쪽, 둘 다 바뀐 항목은 칸 단위로 합치고 같은 칸이면 내 값.
   지운 항목은 상대가 고치지 않았을 때만 지운다. */
function mergeVal(b, l, r){
  if(jstr(l) === jstr(r)) return l;
  if(jstr(b) === jstr(l)) return r;
  if(jstr(b) === jstr(r)) return l;
  if(l === undefined) return r;
  if(r === undefined) return l;
  if(Array.isArray(l) && Array.isArray(r)){
    const all = l.concat(r);
    if(all.length && all.every(x => x && typeof x === 'object' && x.id)) return mergeById(Array.isArray(b) ? b : [], l, r);
    if(all.every(x => typeof x === 'string')) return [...new Set(r.concat(l))];
    return l;
  }
  if(l && r && typeof l === 'object' && typeof r === 'object'){
    const bb = b && typeof b === 'object' && !Array.isArray(b) ? b : {}, out = {};
    new Set([...Object.keys(r), ...Object.keys(l)]).forEach(k => { const v = mergeVal(bb[k], l[k], r[k]); if(v !== undefined) out[k] = v; });
    return out;
  }
  return l;
}
function mergeById(b, l, r){
  const B = new Map(b.filter(x => x && x.id).map(x => [x.id, x])), L = new Map(l.map(x => [x.id, x])), R = new Map(r.map(x => [x.id, x]));
  const out = [];
  [...new Set([...l.map(x => x.id), ...r.map(x => x.id)])].forEach(id => { const v = mergeVal(B.get(id), L.get(id), R.get(id)); if(v !== undefined) out.push(v); });
  return out;
}
/* 기준이 없을 때(이 PC에서 처음 맞출 때): 최신 쪽을 바탕으로, 다른 쪽에만 있는 항목을 더하고 같은 항목은 수정 시각이 늦은 것 */
function mergeNoBase(l, r){
  const newer = (l.meta?.updatedAt || '') > (r.meta?.updatedAt || '') ? l : r, older = newer === l ? r : l;
  const out = clone(newer), stamp = x => x.updatedAt || x.createdAt || '';
  const uni = (n, o) => {
    if(!Array.isArray(n) || !Array.isArray(o)) return n;
    const all = n.concat(o);
    if(all.length && all.every(x => x && typeof x === 'object' && x.id)){ const m = new Map(n.map(x => [x.id, x])); o.forEach(x => { const y = m.get(x.id); if(!y || stamp(x) > stamp(y)) m.set(x.id, x); }); return [...m.values()]; }
    if(all.every(x => typeof x === 'string')) return [...new Set(all)];
    return n;
  };
  Object.keys(out).forEach(k => { if(Array.isArray(out[k])) out[k] = uni(out[k], clone(older[k])); });
  Object.keys(older).forEach(k => { if(!(k in out)) out[k] = clone(older[k]); });
  if(out.settings && older.settings) out.settings.feeProfiles = uni(out.settings.feeProfiles, clone(older.settings.feeProfiles));
  return out;
}
function mergeAccounts(baseAcc, mine, theirs){
  if(baseAcc) return clone(mergeVal(baseAcc, mine, theirs));
  const out = clone(theirs);                                   // 기준이 없으면 서버 계정 목록을 따르되
  if(me && !out.some(a => a.id === me.id)){ const a = mine.find(x => x.id === me.id); if(a) out.push(clone(a)); }  // 지금 로그인한 계정은 남김
  return out;
}
function tidyMerged(d){
  d = migrate(d);
  purgeSamples(d);
  dedupeCaseNos(d);
  const ids = new Set(d.clients.map(c => c.id));
  ['records','procedures','items'].forEach(k => { d[k] = d[k].filter(x => !x.clientId || ids.has(x.clientId)); });
  const seen = new Map();   // 두 PC가 같은 자동 수집 자료로 각각 만든 기록은 하나로
  d.records = d.records.filter(r => {
    if(r.createdBy !== 'auto') return true;
    const k = [r.clientId, r.title, r.bl || '', r.refNo || ''].join('|');
    const keep = seen.get(k);
    if(!keep){ seen.set(k, r); return true; }
    keep.links = [...new Set([...(keep.links || []), ...(r.links || [])])];
    return false;
  });
  return d;
}
/* 서버에 더 새 저장본이 있을 때 내 변경과 합친다 */
async function absorb(blob){
  const srv = migrate(await decryptServer(blob));
  const before = jstr(db);
  db = tidyMerged(clone(sync.base ? mergeVal(sync.base, db, srv) : mergeNoBase(db, srv)));
  accounts = mergeAccounts(sync.baseAcc, accounts, blob.accounts);
  setBase(blob, srv);
  if(me && !accounts.some(a => a.id === me.id)) toast('이 계정이 다른 PC에서 삭제되었습니다. 작업을 마치고 관리자에게 확인하세요.');
  if(jstr(db) !== before){
    await persistLocal(); render();
    toast(`${blob.savedBy || '다른 계정'}님이 저장한 변경을 합쳤습니다.`);
  }
}
/* 로그인 직후 한 번: 서버 파일과 이 PC의 내용을 맞춘다 */
async function syncStart(pre){
  const cfg = syncCfg();
  rememberSync();
  sync.on = !!cfg;
  if(!cfg){ updateSaveState(); return; }
  sync.state = 'busy'; updateSaveState();
  try{
    const j = pre && pre.endpoint === cfg.endpoint ? pre.res : await syncGet(cfg, {load:1});
    serverPre = null;
    const blob = j.exists && j.blob && j.blob.ct && Array.isArray(j.blob.accounts) ? j.blob : null;
    let srv = null;
    if(blob){
      try{ srv = migrate(await decryptServer(blob)); }
      catch{ sync.on = false; sync.state = 'mismatch'; updateSaveState(); toast('Drive의 Workspace 파일이 지금 연 Workspace와 달라 자동 저장을 멈췄습니다. 관리자에게 확인하세요.'); return; }
    }
    let base = null, baseAcc = null, baseRev = -1;
    try{ const bb = JSON.parse(localStorage.getItem(LS_KEY + '-base') || 'null'); if(bb && bb.ct){ base = migrate(await decryptServer(bb)); baseAcc = bb.accounts; baseRev = bb.rev || 0; } }catch{ base = null; }
    if(!blob){ sync.rev = 0; sync.base = null; sync.baseAcc = null; }     // 서버에 파일이 없거나 예전 형식이면 내 내용을 올린다
    else{
      if(!(base && baseRev === (blob.rev || 0))){                         // 마지막으로 맞춘 뒤 서버가 바뀌었으면 합친다
        db = tidyMerged(clone(base ? mergeVal(base, db, srv) : mergeNoBase(db, srv)));
        accounts = mergeAccounts(base ? baseAcc : null, accounts, blob.accounts);
      }
      setBase(blob, srv);
    }
    sync.state = 'ok';
    await persistLocal();
    if(isDirty()) await syncNow(); else updateSaveState();
  }catch(e){ sync.state = 'offline'; sync.err = e.message; updateSaveState(); }
}
function scheduleSync(){
  if(!sync.on) return;
  clearTimeout(sync.timer);
  sync.state = 'wait'; updateSaveState();
  sync.timer = setTimeout(syncNow, SYNC_DELAY);
}
async function syncNow(){
  const cfg = syncCfg();
  if(!sync.on || !cfg || !db) return;
  if(sync.busy){ sync.again = true; return; }
  if($('#dlg').open){ clearTimeout(sync.timer); sync.timer = setTimeout(syncNow, 3000); return; }  // 입력 창이 열려 있으면 닫힌 뒤에
  clearTimeout(sync.timer); sync.busy = true;
  try{
    for(let i = 0; i < 4; i++){
      if(!isDirty()){ sync.state = 'ok'; sync.err = ''; break; }
      sync.state = 'busy'; updateSaveState();
      const text = jstr(db), who = me.name || me.id;
      const blob = await encryptDb(text);
      const res = await syncPost(cfg, {op:'save', baseRev:sync.rev, by:who, blob});
      if(res.ok){ blob.rev = res.rev; blob.savedAt = res.savedAt; blob.savedBy = who; setBase(blob, JSON.parse(text)); continue; }
      if(res.conflict && res.blob){ await absorb(res.blob); continue; }
      if(res.busy){ await new Promise(r => setTimeout(r, 1500)); continue; }
      throw new Error(res.error || '저장하지 못했습니다');
    }
  }catch(e){
    sync.state = /연결|늦습니다|fetch/i.test(e.message) ? 'offline' : 'fail'; sync.err = e.message;
    sync.timer = setTimeout(syncNow, 30000);
  }finally{
    sync.busy = false; updateSaveState();
    if(sync.again){ sync.again = false; scheduleSync(); }
  }
}
/* 화면을 보고 있는 동안 90초마다 다른 계정의 저장을 확인 */
async function pollSync(){
  const cfg = syncCfg();
  if(!sync.on || !cfg || sync.busy || document.hidden || $('#dlg').open) return;
  try{
    const h = await syncGet(cfg, {head:1});
    if(!h.exists || (h.rev || 0) === sync.rev){ if(sync.state === 'offline'){ sync.state = isDirty() ? 'wait' : 'ok'; updateSaveState(); if(isDirty()) scheduleSync(); } return; }
    if(sync.busy || $('#dlg').open) return;
    sync.busy = true;
    try{ const j = await syncGet(cfg, {load:1}); if(j.blob && j.blob.ct && (j.blob.rev || 0) !== sync.rev) await absorb(j.blob); }
    finally{ sync.busy = false; }
    if(isDirty()) scheduleSync(); else { sync.state = 'ok'; updateSaveState(); }
  }catch(e){ sync.state = 'offline'; sync.err = e.message; updateSaveState(); }
}
setInterval(pollSync, SYNC_POLL);
document.addEventListener('visibilitychange', () => { if(!db || !sync.on) return; if(document.hidden){ if(isDirty()) syncNow(); } else pollSync(); });
window.addEventListener('beforeunload', e => { if(db && sync.on && (sync.busy || isDirty())){ e.preventDefault(); e.returnValue = ''; } });
