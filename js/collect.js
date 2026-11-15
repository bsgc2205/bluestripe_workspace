'use strict';
/* ---------- 자동 수집 (수입·수출 폴더 신규 업로드 + 메일 매칭) ---------- */
function collectApi(params){
  const cfg = db.settings.mail || {};
  if(!cfg.endpoint || !cfg.token) return Promise.reject(new Error('Apps Script 주소와 토큰이 없습니다'));
  const u = new URL(cfg.endpoint); u.searchParams.set('token', cfg.token);
  Object.entries(params).forEach(([k,v]) => u.searchParams.set(k, v));
  return fetch(u.href).then(r => r.json()).then(j => { if(!j.ok) throw new Error(j.error || '응답 오류'); return j; });
}
function matchClientText(text){ return findClient(text); }
function caseFromItems(c, group){
  const f = group[0], specials = [...new Set(group.flatMap(x => x.special || []))];
  const mail = group.find(x => x.mail) ? group.find(x => x.mail).mail : null;
  const links = [...new Set([...group.map(x => x.link), mail && mail.link].filter(u => safeUrl(u)))];
  return {
    id:uid(), clientId:c.id, type: f.kind === '수출' ? '수출신고' : f.kind === '수입' ? '수입통관' : /FTA/.test(f.kind) ? 'FTA원산지' : '기타', status:'완료',
    startDate: f.created, date: group.map(x => x.created).sort().slice(-1)[0],
    bl: f.bl || '', refNo: f.declNo || '', fee:null, itemId:'',
    title: ['수입','수출'].includes(f.kind) ? `[${f.kind}] ${f.bl || f.declNo || f.name.replace(/\.[^.]+$/, '')}` : `[${f.kind}] 자료 갱신 ${group.length}건 (${today()})`,
    summary: (mail ? `메일: ${mail.subject} (${mail.date})\n${mail.snippet || ''}\n` : '') + '자료: ' + group.map(x => x.name).join(', '),
    special: specials.length > 0,
    specialNote: specials.length ? `자동 수집에서 특이 절차로 보이는 자료가 확인됨: ${specials.join(', ')}. 내용을 확인해 무엇이 달랐는지 보완하세요.` : '',
    tags: ['자동수집', ...specials], links, checklist:[], docs:[], deadlines:[], reflected:[],
    files: group.map(x => ({id:x.id, name:x.name, link:x.link || '', date:x.created || '', ...(x.ver ? {ver:x.ver} : {})})),
    assignee: clientAssignee(c.id), history: [{at:nowIso(), by:'', text:'자동 수집으로 생성'}],
    createdAt: nowIso(), updatedAt: nowIso(), createdBy: 'auto'
  };
}
/* 11/15: 폴더 자료로 새로 만든 기록 — 수리 후 필증 보관 폴더라 지난 자료는 '완료', 30일 안 자료는 진행 중(수입 통관완료·수출 수리완료 단계 = 정산 대기) */
const COLLECT_OPEN_DAYS = 30;
function collectNewRecord(c, group){
  const r = caseFromItems(c, group), last = String(r.date || '').slice(0, 10);
  if(!['수입통관','수출신고'].includes(r.type) || !last) return r;
  if(daysLeft(last) < -COLLECT_OPEN_DAYS){ r.history.push({at:nowIso(), by:'', text:`폴더 자료 기준 완료(${COLLECT_OPEN_DAYS}일 지난 보관 자료 — 실제 처리일·정산은 확인 전)`}); r.collectDone = true; return r; }
  /* 11/15 b ④: 단계는 '확인 필요'로 — 날짜는 자료를 올린 날일 뿐. UNI-PASS·필증 읽기 결과가 오면 그 날짜로 확정(setStage 등급 올림) */
  const k = r.type === '수출신고' ? 'accept' : 'customs';
  r.status = '진행중'; r.date = '';
  r.stage = {[k]:last, [k + 'By']:'자동 수집: 필증 자료(올린 날 기준, UNI-PASS 확인 전)', [k + 'Lv']:'chk', [k + 'Src']:{file:group.map(x => x.id).filter(Boolean)}};
  r.history.push({at:nowIso(), by:'', text:`${COLLECT_OPEN_DAYS}일 안 자료 — 진행 중으로 생성(${k === 'accept' ? '수리완료' : '통관완료'}? 확인 필요, 정산 대기). UNI-PASS·필증으로 확인되면 실제 날짜로 확정`});
  return r;
}
/* 신고번호·B/L로 기존 기록 찾기: 파일명이 '300777M.pdf'처럼 신고번호 뒷자리뿐이어도 UNI-PASS로 채워진 기록의 신고번호(13675-26-300777M)와 맞춤 */
const refTail = s => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
/* 기록의 식별번호 전부(대표 B/L·신고번호 + 분할·정정으로 추가된 refs). kind: 'decl' | 'bl' | 없으면 전부 */
function recKeys(r, kind){
  const refs = (r.refs || []).filter(x => !kind || x.kind === kind || (kind === 'bl' && x.kind === 'etc')).map(x => x.no);
  return (kind === 'decl' ? [r.refNo, ...refs] : kind === 'bl' ? [r.bl, ...refs] : [r.refNo, r.bl, ...refs]).filter(Boolean);
}
function refMatch(r, x){
  const d = refTail(x.declNo), b = refTail(x.bl);
  return (d.length >= 7 && recKeys(r, 'decl').map(refTail).some(rr => rr === d || rr.endsWith(d))) || (b.length >= 6 && recKeys(r, 'bl').map(refTail).includes(b));
}
/* 11/15 M-02: 같은 번호 기록이 여러 건이면 진행 중이 딱 1건일 때만 자동 선택. 그 밖에는 고르지 않음(cands로 확인함 '후보 여러 건') */
/* 11/15 b: 진행 중 1건이어도 자료의 업체(사업자번호·필증 수입자·파일명)가 그 기록 업체와 같다고 확인될 때만 자동. 모르면 확인함 */
function refLookup(x){
  const hits = db.records.filter(r => refMatch(r, x));
  if(hits.length <= 1) return {r:hits[0] || null, cands:hits};
  const open = hits.filter(r => r.status !== '완료');
  const c = clientByBiz(x.bizNo) || (x.party ? findClient(x.party) : null) || (x.name || x.path ? findClient(`${x.name || ''} ${x.path || ''} ${x.party || ''}`) : null);
  return {r:open.length === 1 && c && open[0].clientId === c.id ? open[0] : null, cands:hits.sort(byDateDesc)};
}
function recordByRef(x){ return refLookup(x).r; }
const ambCands = L => !L.r && L.cands.length > 1 ? L.cands.slice(0, 6).map(r => r.id) : null;
function collectText(x){ return `${x.name} ${x.path} ${x.party || ''} ${x.mail ? [x.mail.subject, x.mail.from, x.mail.snippet].filter(Boolean).join(' ') : ''}`; }
const bizDigits = s => String(s || '').replace(/[^0-9]/g, '');
function clientByBiz(biz){ const b = bizDigits(biz); return b.length === 10 ? db.clients.find(c => bizDigits(c.bizNo) === b) || null : null; }
/* 자료 묶음을 기록에 넣음: ① 신고번호·B/L이 같은 기록 → ② 파일명·폴더·연결 메일(보낸 사람 포함)로 업체 → ③ 못 찾으면 미분류 */
function assignItems(list){
  db.collectPending = db.collectPending || [];
  const groups = {}, attach = {}, logs = {};
  let pend = 0;
  list.forEach(x => {
    if(x.blockRec){ db.collectPending.push(x); pend++; return; }                                   // 사람이 기록에서 뗀 자료는 자동으로 다시 넣지 않음
    const L = refLookup(x), hit = L.r;
    if(hit){ (attach[hit.id] = attach[hit.id] || {r:hit, list:[]}).list.push(x); return; }
    if(ambCands(L)){ x.cands = ambCands(L); db.collectPending.push(x); pend++; return; }       // 후보 여러 건 → 사람이 고름
    const c = clientByBiz(x.bizNo) || matchClientText(collectText(x));
    if(!c){ db.collectPending.push(x); pend++; return; }
    const weekly = !['수입','수출'].includes(x.kind);
    if(weekly){ (logs[c.id + '|' + x.kind] = logs[c.id + '|' + x.kind] || {c, kind:x.kind, list:[]}).list.push(x); return; }   // BSGC-Backup = 백업: 케이스·실적 없이 업체 자료 갱신 이력만
    if(!refTail(x.bl) && !refTail(x.declNo)){ x.sug = c.id; db.collectPending.push(x); pend++; return; }               // 신고번호·B/L 없는 자료는 케이스를 만들지 않음(필증 읽기 뒤 다시 맞춤)
    const k = c.id + '|' + x.kind + '|' + (x.bl || x.declNo);
    (groups[k] = groups[k] || {c, list:[]}).list.push(x);
  });
  let made = 0, sp = 0, upd = 0, log = 0;
  Object.values(logs).forEach(g => { log += addClientUpdate(g.c, g.kind, g.list); });
  const merge = (ex, c, lst) => {
    markVersions(ex, lst);
    const nr = caseFromItems(c, lst);
    ex.links = [...new Set([...(ex.links || []), ...nr.links])];
    addFiles(ex, lst);
    if(nr.special && !ex.special){ ex.special = true; ex.specialNote = (ex.specialNote ? ex.specialNote + '\n' : '') + nr.specialNote; }
    ex.updatedAt = nowIso(); upd++;
  };
  Object.values(attach).forEach(({r, list:lst}) => merge(r, db.clients.find(c => c.id === r.clientId) || {id:r.clientId, name:''}, lst));
  Object.values(groups).forEach(({c, list:lst}) => {
    const f = lst[0];
    const ex = db.records.find(r => r.clientId === c.id && refMatch(r, f));
    if(ex) merge(ex, c, lst);
    else { const r = collectNewRecord(c, lst); db.records.push(r); made++; if(r.special) sp++; }
  });
  return {made, sp, upd, pend, log};
}
function applyCollected(items){
  db.collectSeen = db.collectSeen || [];
  const seen = new Set(db.collectSeen);
  const fresh = items.filter(x => !seen.has(x.id));
  if(!fresh.length) return null;
  const r = assignItems(fresh);
  fresh.forEach(x => db.collectSeen.push(x.id));
  if(db.collectSeen.length > 5000) db.collectSeen = db.collectSeen.slice(-5000);
  return r;
}
/* 미분류로 남은 자료를 지금 기준(업체 검색어·담당자 메일·UNI-PASS 신고번호)으로 다시 맞춰 봄 */
function rematchPending(){
  const p = db.collectPending || [];
  if(!p.length) return null;
  db.collectPending = [];
  const r = assignItems(p);
  return r.made || r.upd || r.log ? r : (db.collectPending = p, null);
}
/* ---------- 필증 읽기 (목표 5): 기록·미분류 자료의 PDF를 Apps Script가 글자 인식으로 읽어 신고번호·B/L·품목(품명·HS·원산지·순중량)을 채운다 ----------
   한 번에 6개씩, 로그인 때와 '지금 확인' 때. 같은 파일은 다시 읽지 않는다(gs 캐시 + r.certRead). */
const CERT_HINT = /필증|면장|신고서|\d{5}-?\d{2}-?\d{6}|\b\d{6}[A-Z]\b|(^|[^A-Z])(EXP|IMP)[_-]?\d/i;
function certQueue(){
  const cut = addPeriod(today(), -60, 'd'), q = [];
  const errWait = (o, id) => { const e = (o.certErr || {})[id]; return e && e.n >= 3 && e.at === today(); };   // 3번 넘게 실패한 파일은 하루 한 번만 다시
  (db.collectPending || []).forEach(x => { if(/\.pdf$/i.test(x.name || '') && !x.certTried && x.id && !errWait(x, x.id)) q.push({id:x.id, pend:x, hint:CERT_HINT.test(x.name)}); });
  db.records.filter(r => r.status !== '완료' || recDate(r) >= cut || r.certAgain).forEach(r => (r.files || []).forEach(f => {
    if(/\.pdf$/i.test(f.name || '') && f.id && String(f.id).length > 15 && !(r.certRead || {})[f.id] && !errWait(r, f.id)) q.push({id:f.id, rec:r, file:f, hint:CERT_HINT.test(f.name)});
  }));
  return q.sort((a, b) => b.hint - a.hint).slice(0, 6);
}
/* 필증의 수입자·수출화주 업체 (11/12): 사업자번호 → 이름. 기록의 업체와 다르면 품목은 필증 쪽 업체에 넣는다(다른 업체 필증이 잘못 붙은 경우) */
function certParty(d){ return (d.bizNo && clientByBiz(d.bizNo)) || (d.party ? findClient(d.party) || fuzzyClient(d.party) : null); }
/* 11/15: 필증 글자 인식이 업체 이름 한 글자를 틀린 경우(예: 가나다→가니다) — 4글자 이상 이름에서 한 글자만 다르고 후보가 하나일 때만 */
function fuzzyClient(name){
  const k = nameKey(name).replace(/\s/g, ''); if(k.length < 4) return null;
  const d1 = (a, b) => { if(a.length !== b.length) return 9; let n = 0; for(let i = 0; i < a.length; i++) if(a[i] !== b[i] && ++n > 1) return n; return n; };
  const hits = db.clients.filter(c => { const ck = nameKey(c.name).replace(/\s/g, ''); return ck.length >= 4 && d1(ck, k) === 1; });
  return hits.length === 1 ? hits[0] : null;
}
function itemFromLine(cid, ln, d){
  const nm = ln.trade || ln.name, hs = hsDigits(ln.hs);
  if(!nm && !hs) return null;
  const nk = nameKey(nm).replace(/\s/g, '');
  let it = db.items.find(i => i.clientId === cid && ((hs && hsDigits(i.hs) === hs && (!nk || nameKey(i.name).replace(/\s/g, '') === nk)) || (nk && nameKey(i.name).replace(/\s/g, '') === nk)));
  const k = d.kind === 'E' || d.kind === 'I' ? d.kind : '';
  if(it){ if(!it.hs && ln.hs){ it.hs = ln.hs; it.updatedAt = nowIso(); } if(!it.country && ln.origin) it.country = ln.origin; if(k && !(it.dirs || []).includes(k)){ it.dirs = [...(it.dirs || []), k]; it.updatedAt = nowIso(); } return {it, isNew:false}; }
  it = {id:uid(), clientId:cid, name:nm, hs:ln.hs || '', tariff:'', reqs:'', agency:'', model:ln.model || '', country:ln.origin || '', maker:'', dirs:k ? [k] : [],
    notes:`필증 ${d.declNo || ''}에서 자동 등록${ln.name && ln.name !== nm ? ` (품명 ${ln.name})` : ''}`, createdAt:nowIso(), updatedAt:nowIso(), createdBy:'auto'};
  db.items.push(it);
  return {it, isNew:true};
}
function applyCert2Rec(r, d, fname){
  const ch = [], pc0 = certParty(d), mine = !pc0 || pc0.id === r.clientId;
  if(d.declNo && !r.refNo){ r.refNo = d.declNo; ch.push('신고번호'); }
  else if(d.declNo && mine && addRef(r, d.declNo, 'decl', `필증 ${fname} — 분할·정정 신고번호`)) ch.push('추가 신고번호');   // 같은 케이스의 두 번째 신고번호는 버리지 않고 refs로
  if(d.bl && !r.bl){ r.bl = d.bl; ch.push('B/L'); }
  else if(d.bl && mine && addRef(r, d.bl, 'bl', `필증 ${fname}`)) ch.push('추가 B/L');
  if(d.cargoNo && !r.cargoNo){ r.cargoNo = d.cargoNo; ch.push('화물관리번호'); }
  const cl = db.clients.find(c => c.id === r.clientId);                  // 필증의 수입자·수출화주가 이 업체면 사업자번호를 업체 정보에 채움
  if(cl && d.bizNo && !bizDigits(cl.bizNo) && (findClient(d.party || '') === cl || clientByBiz(d.bizNo) === null && nameKey(d.party || '').replace(/\s/g, '').includes(nameKey(cl.name).replace(/\s/g, '')))){ cl.bizNo = d.bizNo; cl.updatedAt = nowIso(); ch.push('업체 사업자번호'); setTimeout(() => checkClientsExt([cl], true), 1500); }
  if(d.kind && caseCode(r.type) === 'X'){ r.type = d.kind === 'E' ? '수출신고' : '수입통관'; ch.push('유형'); }
  else if((d.kind === 'E' || d.kind === 'I') && caseCode(r.type) !== d.kind && mine && typeAuto(r) && retypeRecord(r, d.kind === 'E' ? '수출신고' : '수입통관', `필증 ${fname}`)) ch.push('유형 정정');   // 11/16
  r.certs = [...(r.certs || []).filter(x => x.declNo !== d.declNo), {file:fname, declNo:d.declNo, declDate:d.declDate, kind:d.kind, party:d.party, partner:d.partner, country:d.country, terms:d.terms, lines:(d.lines || []).slice(0, 12)}].slice(-10);
  let made = 0;
  const pc = certParty(d), other = pc && pc.id !== r.clientId ? pc : null;
  (d.lines || []).forEach((ln, i) => { const x = itemFromLine(other ? other.id : r.clientId, ln, d); if(!x) return; if(x.isNew) made++; if(i === 0 && !r.itemId && !other) { r.itemId = x.it.id; ch.push('품목'); } });
  if(other){ r.certMismatch = {file:fname, declNo:d.declNo || '', party:other.name, at:today()}; addHist(r, `확인 필요: 필증(${fname})의 ${d.kind === 'E' ? '수출화주' : '수입자'}가 ‘${d.party || other.name}’(${other.name})로 이 업체와 다릅니다. 품목은 ${other.name}에 넣었습니다 — 자료가 다른 기록에 잘못 붙었는지 확인하세요.`); }
  addHist(r, `필증 읽기(${fname}): 신고 ${d.declNo || '-'}${(d.lines || []).length ? `, 품목 ${d.lines.length}란(HS ${[...new Set(d.lines.map(l => l.hs).filter(Boolean))].slice(0, 4).join(', ')})` : ''}${ch.length ? ` → ${ch.join('·')} 채움` : ''}${made ? `, 품목 DB ${made}개 추가` : ''}`);
  r.updatedAt = nowIso();
  return {ch:ch.length, made};
}
/* 필증에서 자동 등록된 품목의 업체·수출입 구분 바로잡기 (11/12, 한 번): 그 필증의 수입자·수출화주가 다른 업체면 그 업체로 옮김 */
function fixCertItems(){
  if(db.settings.fixCertItems === '20261112') return 0;
  const certs = new Map();
  db.records.forEach(r => (r.certs || []).forEach(c => { if(c.declNo) certs.set(c.declNo, {r, c}); }));
  let n = 0;
  db.items.filter(it => it.createdBy === 'auto').forEach(it => {
    const m = /필증\s+(\S+)에서 자동 등록/.exec(it.notes || ''), hit = m && certs.get(m[1]);
    if(!hit) return;
    const k = hit.c.kind === 'E' || hit.c.kind === 'I' ? hit.c.kind : '';
    if(k && !(it.dirs || []).includes(k)) it.dirs = [...(it.dirs || []), k];
    const pc = hit.c.party ? findClient(hit.c.party) : null;
    if(!pc || pc.id === it.clientId) return;
    const was = clientName(it.clientId);
    db.records.forEach(r => { if(r.itemId === it.id && r.clientId !== pc.id) r.itemId = ''; });
    it.clientId = pc.id; it.notes = `${it.notes} · 업체 바로잡음(${was} → ${pc.name}, 필증 ${hit.c.kind === 'E' ? '수출화주' : '수입자'} 기준)`; it.ext = null; it.updatedAt = nowIso();
    openAlerts().filter(a => a.tid === it.id).forEach(a => { a.status = 'done'; a.doneAt = nowIso(); a.doneBy = 'auto'; a.doneNote = `품목 업체를 ${pc.name}(으)로 바로잡아 다시 확인합니다.`; });
    n++;
  });
  db.settings.fixCertItems = '20261112';
  return n;
}
/* ---------- 한 파일에 여러 업체 필증 (11/13 e) ----------
   수출 폴더는 하루치 수출신고필증·선적서류를 한 PDF(예: 20231112.pdf)로 묶어 두므로, 필증마다 수출화주·수입자로 업체를 나눈다.
   이 기록 업체의 필증만 이 기록에 반영, 다른 등록 업체의 필증은 그 업체의 같은 신고번호 기록(없으면 완료 기록 새로 — 신고 1건 = 1건)에,
   등록 안 된 업체의 필증은 미분류(확인함)로. 예전에 첫 업체로 잘못 들어간 품목은 그 품목이 실제로 나온 필증의 업체로 옮긴다. */
const partyKey = s => normName(String(s || '').replace(/\(?\s*\d{3}-\d{2}-\d{5}\s*\)?/g, '').replace(/[\s.,·()]/g, ''));
function partyIsClient(party, cid){
  const c = db.clients.find(x => x.id === cid); if(!c || !party) return false;
  const p = partyKey(party), n = partyKey(c.name);
  return !!n && n.length >= 2 && !!p && (p.includes(n) || (p.length >= 2 && n.includes(p)));
}
function lineKey(l){ return nameKey(l.trade || l.name || '').replace(/\s/g, ''); }
function splitPending(x, docs){
  const set = (o, d) => Object.assign(o, {declNo:d.declNo || o.declNo || '', bl:d.bl || o.bl || '', party:d.party || '', bizNo:d.bizNo || '', kind:d.kind === 'E' ? '수출' : d.kind === 'I' ? '수입' : o.kind});
  if(docs.length > 1){ x.declNo = ''; x.bl = ''; }
  set(x, docs[0]);
  docs.slice(1).forEach(d => { const y = set({...x, splitOf:x.id, path:(x.path || '') + ' (같은 파일의 다른 필증)'}, d); db.collectPending.push(y); });
}
/* 11/15: 묶음 필증 다시 읽기 정리 — ① 이 파일로 예전에 붙은 필증 요약·추가 신고번호를 지우고 새로 붙임 ② 예전 잘못 읽기로 엉뚱한 업체에 자동 생성된 기록
   (자동 생성·메일 없음·이 파일뿐)은 필증의 수출화주·수입자 업체로 옮기고, 그 업체에 같은 신고번호 기록이 있으면 합침(되돌리기 가능) */
function fixAutoRecParty(r, docs, fname){
  const own = docs.find(d => d.declNo && r.refNo && refTail(d.declNo) === refTail(r.refNo));
  if(!own || !(r.createdBy === 'auto' && !(r.mails || []).length && (r.files || []).every(f => f.name === fname))) return false;
  const pc = certParty(own), cid = pc ? pc.id : r.clientId;
  const t = db.records.filter(x => x.id !== r.id && x.clientId === cid && recKeys(x, 'decl').map(refTail).includes(refTail(own.declNo)))
    .sort((a, b) => (a.createdBy === 'auto') - (b.createdBy === 'auto') || String(a.createdAt || '').localeCompare(String(b.createdAt || '')))[0];   // 사람이 만든·먼저 만든 기록 우선
  if(t && typeof mergeRecords === 'function'){ mergeRecords(t.id, r.id); return 'merged'; }
  if(!pc || pc.id === r.clientId) return false;
  const old = clientName(r.clientId);
  r.clientId = pc.id; r.assignee = clientAssignee(pc.id) || r.assignee; addHist(r, `필증 다시 읽기(${fname}): 수출화주·수입자가 ${pc.name} — 업체를 ${old}에서 바로잡음`);
  return 'moved';
}
function applyCertDocs(r, docs, file){
  const fname = file.name, out = {made:0};
  if(docs.filter(d => !d.idx).length > 1){
    r.certs = (r.certs || []).filter(c => c.file !== fname);
    r.refs = (r.refs || []).filter(x => !String(x.why || '').includes(`필증 ${fname}`));
    const fx = fixAutoRecParty(r, docs, fname);
    if(fx === 'merged') return out;                                       // 합쳐진 기록은 남은 기록에서 다시 읽힘
  }
  const mine = [], others = [], listed = [];
  /* 색인표에만 있고 본문을 못 읽은 필증 (11/13 g): 같은 신고번호 기록이 있으면 파일만 붙이고, 이 기록 번호면 그대로, 없으면 미분류(업체 선택) */
  docs.filter(d => d.idx).forEach(d => {
    if(d.declNo && recKeys(r, 'decl').map(refTail).includes(refTail(d.declNo))) return;
    const L = refLookup({declNo:d.declNo}), t = L.r, amb = ambCands(L);
    if(t && t.id !== r.id){ addFiles(t, [{id:file.id, name:fname, link:file.link || '', created:file.date || ''}]); t.certRead = {...(t.certRead || {}), [file.id]:today()}; listed.push(`${clientName(t.clientId)} ${d.declNo}`); return; }
    if(t) return;
    db.collectPending = db.collectPending || [];
    if(!db.collectPending.some(x => x.id === file.id && x.declNo === d.declNo)) db.collectPending.push({...(amb ? {cands:amb} : {}), id:file.id, name:fname, link:file.link || '', created:file.date || '', kind:d.kind === 'I' ? '수입' : '수출', path:'(같은 파일 색인표에만 있는 필증 — 본문을 못 읽음)', declNo:d.declNo || '', bl:'', party:'', bizNo:'', certTried:true, splitOf:file.id});
    listed.push(`미분류 ${d.declNo}`);
  });
  if(listed.length) addHist(r, `필증 읽기(${fname}): 색인표에만 있는 신고번호 ${listed.length}건 — ${listed.join(', ')}`.slice(0, 280));
  docs = docs.filter(d => !d.idx);
  if(!docs.length){ r.updatedAt = nowIso(); return out; }
  docs.forEach(d => {
    const pc = certParty(d);
    const isMine = pc ? pc.id === r.clientId : (!d.party || partyIsClient(d.party, r.clientId) || (docs.length === 1 && !(d.lines || []).length));
    (isMine ? mine : others).push({d, pc});
  });
  /* 11/15: 여러 장 묶음 파일에서 같은 업체 필증이 둘 이상이면(같은 업체 2건) 이 기록의 신고번호와 같은 장만 이 기록에, 나머지는 자기 기록으로 */
  if(docs.length > 1 && mine.length > 1){
    const keys = recKeys(r, 'decl').map(refTail), own = d => d.declNo && keys.some(k => k === refTail(d.declNo) || k.endsWith(refTail(d.declNo)) || refTail(d.declNo).endsWith(k));
    const keep = mine.filter(x => own(x.d)), rest = keep.length ? mine.filter(x => !own(x.d)) : mine.slice(1);
    mine.splice(0, mine.length, ...(keep.length ? keep : mine.slice(0, 1)));
    rest.forEach(x => others.push({d:x.d, pc:x.pc || db.clients.find(c => c.id === r.clientId) || null}));
  }
  mine.forEach(({d}) => { const a = applyCert2Rec(r, d, fname); out.made += a.made; });
  const moved = [];
  others.forEach(({d, pc}) => {
    if(pc){
      const L = refLookup({declNo:d.declNo, bl:d.bl}); let t = L.r;
      if(t && t.clientId !== pc.id) t = null;
      if(!t){ const pcC = L.cands.filter(x => x.clientId === pc.id); if(pcC.length === 1) t = pcC[0]; }   // 같은 번호 기록이 여럿이어도 필증 업체 기록이 하나면 그 기록
      const amb = !t && L.cands.filter(x => x.clientId === pc.id).length > 1 ? L.cands.filter(x => x.clientId === pc.id).slice(0, 6).map(x => x.id) : null;
      if(amb){
        db.collectPending = db.collectPending || [];
        if(!db.collectPending.some(x => x.id === file.id && x.declNo === d.declNo)) db.collectPending.push({cands:amb, id:file.id, name:fname, link:file.link || '', created:file.date || '', kind:d.kind === 'E' ? '수출' : '수입', declNo:d.declNo || '', bl:d.bl || '', sug:pc.id, path:'(같은 파일의 다른 필증 — 같은 번호 기록 여러 건)'});
        moved.push(`${pc.name} ${d.declNo || ''} — 후보 여러 건(확인함)`);
        return;
      }
      if(!t){
        t = collectNewRecord(pc, [{id:file.id, name:fname, link:file.link || '', created:file.date || recDate(r), kind:d.kind === 'E' ? '수출' : '수입', declNo:d.declNo || '', bl:d.bl || ''}]);
        t.history.push({at:nowIso(), by:'', text:`같은 파일(${fname})에 묶인 필증에서 생성 — ${clientName(r.clientId)} 기록과 같은 파일`});
        db.records.push(t);
      } else addFiles(t, [{id:file.id, name:fname, link:file.link || '', created:file.date || ''}]);
      t.certRead = {...(t.certRead || {}), [file.id]:today()};
      const a = applyCert2Rec(t, d, fname); out.made += a.made;
      moved.push(`${pc.name} ${d.declNo || ''}`);
    } else {
      db.collectPending = db.collectPending || [];
      if(!db.collectPending.some(x => x.id === file.id && x.declNo === d.declNo)) db.collectPending.push({id:file.id, name:fname, link:file.link || '', created:file.date || '', kind:d.kind === 'E' ? '수출' : '수입', path:'(같은 파일의 다른 업체 필증)', declNo:d.declNo || '', bl:d.bl || '', party:d.party || '', bizNo:d.bizNo || '', certTried:true, splitOf:file.id});
      moved.push(`미등록 업체 ${d.party || '?'} ${d.declNo || ''}`);
    }
  });
  if(others.length){
    addHist(r, `필증 읽기(${fname}): 한 파일에 필증 ${docs.length}장 — 이 업체 ${mine.length}장만 반영, 다른 업체 ${others.length}장은 나눔: ${moved.join(', ')}`);
    if(!mine.length) r.certMismatch = {file:fname, declNo:others.map(x => x.d.declNo).filter(Boolean).join(', '), party:others.map(x => x.pc ? x.pc.name : x.d.party).join(', '), at:today()};
    out.fixed = fixMisplacedItems(r, mine.map(x => x.d), others);
  }
  r.updatedAt = nowIso();
  return out;
}
/* 예전에 파일 첫 필증의 업체(=이 기록 업체)로 들어간 품목 중, 실제로는 다른 업체 필증에만 나오는 품목을 그 업체로 옮김 */
function fixMisplacedItems(r, mineDocs, others){
  const mineKeys = new Set(mineDocs.flatMap(d => (d.lines || []).map(lineKey)).filter(Boolean));
  let n = 0;
  others.forEach(({d, pc}) => (d.lines || []).forEach(ln => {
    const k = lineKey(ln), hs = hsDigits(ln.hs);
    if(!k || mineKeys.has(k)) return;
    db.items.filter(it => it.clientId === r.clientId && it.createdBy === 'auto' && /필증/.test(it.notes || '') && nameKey(it.name).replace(/\s/g, '') === k && (!hs || !hsDigits(it.hs) || hsDigits(it.hs) === hs)).forEach(it => {
      const was = clientName(it.clientId);
      if(pc){
        const dup = db.items.find(x => x.id !== it.id && x.clientId === pc.id && nameKey(x.name).replace(/\s/g, '') === k);
        db.records.forEach(x => { if(x.itemId === it.id) x.itemId = x.clientId === pc.id && dup ? dup.id : (x.clientId === pc.id ? it.id : ''); });
        if(dup){ db.items = db.items.filter(x => x.id !== it.id); }
        else { it.clientId = pc.id; it.notes = `${it.notes} · 업체 바로잡음(${was} → ${pc.name}, 같은 파일의 ${d.kind === 'E' ? '수출화주' : '수입자'} 기준)`; it.ext = null; it.updatedAt = nowIso(); }
        openAlerts().filter(a => a.tid === it.id).forEach(a => { a.status = 'done'; a.doneAt = nowIso(); a.doneBy = 'auto'; a.doneNote = `품목이 ${pc.name} 필증에서 나온 것이어서 옮겼습니다.`; });
      } else {
        if(typeof addAlert === 'function') addAlert({key:`certmix|${it.id}|${d.declNo}`, kind:'certmix', ttype:'item', tid:it.id, title:`다른 업체 필증 품목으로 보임: ${it.name} (${was})`, text:`같은 파일 ${r.title}의 필증 ${d.declNo || ''}(${d.kind === 'E' ? '수출화주' : '수입자'} ${d.party || '?'})에서 나온 품목입니다. 그 업체를 등록해 옮기거나 품목을 지우세요.`});
      }
      n++;
    });
  }));
  return n;
}
/* 한 번만: 예전에 한 장짜리로 읽은 '날짜 이름' 같은 묶음 PDF(파일명에 신고번호·EXP/IMP 없음)를 다시 읽게 함 */
/* 11/13 g: 견본 필증('견본(수출)'로 시작, '수출신고필증' 제목 없음)과 색인표 신고번호를 잘못 나누던 것을 고쳐(Apps Script cert3_) 한 번 더 다시 읽음 */
function recheckCombined(){                                               // 11/15: 수출신고서(갑지·을지) 머리·신고번호 앞 배치 대응으로 묶음 PDF를 한 번 더 다시 읽음
  if(db.settings.certMulti === '20261115d') return 0;
  let n = 0;
  db.records.forEach(r => {
    const fs = (r.files || []).filter(f => /\.pdf$/i.test(f.name || '') && !CERT_HINT.test(f.name || '') && (r.certRead || {})[f.id]);
    if(!fs.length) return;
    fs.forEach(f => { delete r.certRead[f.id]; }); r.certAgain = true; n += fs.length;
  });
  (db.collectPending || []).forEach(x => { if(/\.pdf$/i.test(x.name || '') && !CERT_HINT.test(x.name || '') && x.certTried && !x.splitOf){ x.certTried = false; n++; } });
  db.settings.certMulti = '20261115d';
  return n;
}
let certBusy = false, certLaterN = 0;
async function certRead(manual){                                          // 11/15: 같은 필증을 동시에 두 번 읽지 않게
  if(certBusy){ if(manual) toast('필증을 읽는 중입니다.'); return null; }
  certBusy = true;
  try{ return await certRead0(manual); } finally { certBusy = false; }
}
async function certRead0(manual){
  const q = certQueue();
  if(!q.length){ if(manual) toast('새로 읽을 필증이 없습니다.'); return null; }
  let j;
  try{ j = await collectApi({certread:q.map(x => x.id).join(',')}); }
  catch(e){ typeof markRun === 'function' && markRun('cert', false, e.message); if(manual || !/허용|알 수 없/.test(e.message)) console.warn('필증 읽기', e.message); if(manual) toast('필증을 읽지 못했습니다: ' + e.message); return null; }
  let recs = 0, items = 0, pend = 0, later = 0;
  (j.items || []).forEach(res => {
    if(res.later){ later++; return; }                                    // 11/15 d: 큰 묶음 PDF 나눠 읽는 중 → 곧 이어서
    if(res.err){                                                         // 오류는 다음에 다시 시도 + 처리 기록에 남김(3번째부터는 하루 한 번만 다시)
      q.filter(x => x.id === res.id).forEach(x => { const o = x.pend || x.rec; const n = ((o.certErr || {})[res.id] || {}).n || 0; o.certErr = {...(o.certErr || {}), [res.id]:{n:n + 1, at:today(), err:res.err}};
        if(typeof logProc === 'function') logProc('fail', `필증 읽기 실패: ${(x.file || x.pend || {}).name || res.id} — ${res.err}`); });
      return;
    }
    q.filter(x => x.id === res.id).forEach(x => {
      const docs = (res.docs && res.docs.length ? res.docs : [res.doc]).filter(d => d && (d.declNo || (d.lines || []).length));   // 한 파일에 필증 여러 장(11/13 e)
      if(x.pend){ x.pend.certTried = true; if(docs.length){ splitPending(x.pend, docs); pend++; } return; }
      x.rec.certRead = {...(x.rec.certRead || {}), [res.id]:today()};
      if(x.rec.certAgain && (x.rec.files || []).every(f => !/\.pdf$/i.test(f.name || '') || (x.rec.certRead || {})[f.id])) delete x.rec.certAgain;
      if(docs.length){ const a = applyCertDocs(x.rec, docs, x.file); recs++; items += a.made; }
    });
  });
  const rm = pend ? rematchPending() : null;
  typeof markRun === 'function' && markRun('cert', true);
  if(later && (certLaterN = (certLaterN || 0) + 1) <= 12) setTimeout(() => certRead(false), 4000); else if(!later) certLaterN = 0;   // 나눠 읽기 이어서(최대 12번)
  commit();
  const cmsg = `필증 읽기: 기록 ${recs}건 반영, 품목 DB ${items}개 추가${rm && (rm.made || rm.upd) ? `, 미분류 자료 ${rm.made + rm.upd}건 업체 확인` : ''}`;
  if(recs || items || (rm && (rm.made || rm.upd))) logProc('cert', cmsg);
  if(recs || items || (rm && (rm.made || rm.upd)) || manual) toast(cmsg);
  return {recs, items};
}
let collectBusy = false;
async function runCollect(manual){
  if(collectBusy){ if(manual) toast('자료를 확인하는 중입니다. 끝나면 결과가 보입니다.'); return; }   // 11/15 U-01: 중복 실행 방지
  collectBusy = true;
  try{
    if(manual){ toast('수입·수출 폴더와 BSGC-Backup 변동사항을 확인하는 중입니다…'); await collectApi({collect:1}); await collectApi({weekly:1}); }
    const rc = recheckCombined(); if(rc) setTimeout(() => toast(`하루치를 한 파일로 묶은 필증 PDF ${rc}개를 필증별 업체로 다시 읽습니다(6개씩).`), 1500);
    const fx = fixCertItems(); if(fx) toast(`필증에서 등록된 품목 ${fx}개의 업체를 바로잡았습니다(필증의 수입자·수출화주 기준).`);
    const j = await collectApi({inbox:1});
    lastCollectRun = j.lastRun || lastCollectRun;
    const r0 = rematchPending(), r1 = applyCollected(j.items || []);
    const r = r0 || r1 ? {made:(r0 ? r0.made : 0) + (r1 ? r1.made : 0), sp:(r0 ? r0.sp : 0) + (r1 ? r1.sp : 0), upd:(r0 ? r0.upd : 0) + (r1 ? r1.upd : 0), log:(r0 ? r0.log || 0 : 0) + (r1 ? r1.log || 0 : 0), pend:(db.collectPending || []).length} : null;
    const s2 = applyStatus(j.status);
    if(r || s2){
      commit();
      const msg = [r && `새 케이스 ${r.made}건(특이 ${r.sp}건), 보완 ${r.upd}건${r.log ? `, 업체 자료 갱신 이력 ${r.log}개` : ''}, 미분류 ${r.pend}건`, s2 && `주간 진행현황 ${s2.date} 반영(새 ${s2.made}건, 갱신 ${s2.upd}건)`].filter(Boolean).join(' / ');
      toast('자동 수집: ' + msg); logProc('drive', msg);
    } else if(manual) toast('새로 반영할 자료가 없습니다.');
    typeof markRun === 'function' && markRun('drive', true);
    setTimeout(() => certRead(false), manual ? 2500 : 4000);
  }catch(e){ typeof markRun === 'function' && markRun('drive', false, e.message); if(manual) toast('자동 수집을 확인하지 못했습니다: ' + e.message); }
  finally{ collectBusy = false; }
}
function viewInbox(){
  const pend = db.collectPending || [];
  return `<header class="client-head"><div><h2>자동 수집</h2><p class="client-meta">매일 08시 수입·수출 폴더의 새 자료를 신고번호·B/L이 같은 케이스에 근거 자료로 붙입니다(같은 이름의 수정 자료는 새 버전). 신고번호·B/L이 없거나 업체를 알아보지 못한 자료는 여기 남습니다(업체를 알아본 자료는 추천 업체가 미리 선택됨). 매주 월요일 15시 BSGC-Backup 변동사항은 케이스·실적을 만들지 않고 업체 화면의 ‘자료 갱신 이력’에만 남깁니다.${db.settings.statusDate ? ` 진행현황 반영 기준일 ${esc(db.settings.statusDate)}.` : ''}</p></div>
      <div class="client-act"><button class="ghost" data-mail-audit>업체 미인식 점검</button><button class="primary" data-collect-now>지금 확인</button></div></header>
    ${updateRecsBanner()}
    ${pend.length ? `<div class="table-wrap" style="margin-top:1rem"><table class="grid"><thead><tr><th>자료</th><th>폴더</th><th>올린 날</th><th>메일</th><th>업체 지정</th></tr></thead><tbody>
      ${pend.map((x,i) => `<tr><td>${safeUrl(x.link) ? `<a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">${esc(x.name)}</a>` : esc(x.name)}${(x.special || []).length ? ` <span class="stamp sm">특이</span>` : ''}</td><td>${esc(x.kind)} / ${esc(x.path)}</td><td>${esc(x.created)}</td><td>${x.mail ? esc(x.mail.subject) : ''}</td>
        <td><div class="btn-row"><select data-pend-client="${esc(pendKey(x))}"><option value="">업체 선택</option>${opts(sortedClients().map(c => [c.id, c.name]), x.sug || '')}</select><button class="mini strong" data-pend-apply="${esc(pendKey(x))}">반영</button><button class="mini ghosty" data-pend-drop="${esc(pendKey(x))}">업무 아님</button></div></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="empty">미분류 자료가 없습니다.</p>'}
    <p class="hint">자료는 ① 신고번호·B/L이 같은 기록(파일명이 ‘300777M.pdf’처럼 신고번호 뒷자리뿐이어도 UNI-PASS로 채워진 신고번호와 맞춤) ② 파일명·폴더명·연결된 메일의 업체명·약칭·보낸 사람 메일 순으로 업체를 찾습니다. 업체 정보의 검색어에 약칭과 담당자 메일 주소를 넣고 ‘지금 확인’을 누르면 미분류 자료를 다시 맞춰 봅니다.</p>`;
}
function applyStatus(st){
  if(!st || !st.date || !(st.rows || []).length) return null;
  if(db.settings.statusDate === st.date) return null;
  let made = 0, upd = 0;
  st.rows.forEach(x => {
    const c = db.clients.find(y => normName(y.name) === normName(x.owner)); if(!c) return;
    const stg = Object.entries(x.stages || {}).map(([k,v]) => `${k} ${v}`).join(', ');
    const doneNow = /완료/.test(x.done || '');
    const line = `[진행현황 ${st.date}] ${x.done || ''}${x.inDate ? `, 반입 ${x.inDate}` : ''}${x.wh ? `, ${x.wh}` : ''}${stg ? `, 단계: ${stg}` : ''}${x.bill ? `, 청구 ${x.bill}` : ''}${x.paid ? `, 입금 ${x.paid}` : ''}`;
    const extra = [x.note && `특이: ${x.note}`, x.req && `요청: ${x.req}`].filter(Boolean).join(' / ');
    const sp = /정밀|검역|검사|반송|보세|FTA|사후|D&D|FREE|프리|지연|보류/i.test(extra);
    let r = db.records.find(y => y.clientId === c.id && y.bl === x.bl);
    if(!r){
      r = {id:uid(), clientId:c.id, type:'수입통관', status: doneNow ? '완료' : '진행중', startDate: st.date, date: doneNow ? st.date : '', bl:x.bl, refNo:'',
        title:`[수입] ${x.partner || ''} ${x.bl}`.trim(), summary:'', special:false, specialNote:'', tags:['주간현황'], links: safeUrl(st.link) ? [st.link] : [],
        fee:null, itemId:'', checklist:[], docs:[], deadlines:[], reflected:[], createdAt:nowIso(), updatedAt:nowIso(), createdBy:'auto'};
      db.records.push(r); made++;
    } else upd++;
    r.summary = [line, extra, (r.summary || '').split('\n').filter(l => !l.startsWith('[진행현황')).join('\n')].filter(Boolean).join('\n');
    if(doneNow && r.status !== '완료'){ r.status = '완료'; r.date = r.date || st.date; }
    if(sp){ r.special = true; if(!(r.specialNote || '').includes(extra)) r.specialNote = ((r.specialNote ? r.specialNote + '\n' : '') + `${st.date}: ${extra}`); }
    r.updatedAt = nowIso();
  });
  db.settings.statusDate = st.date;
  return {made, upd, date: st.date};
}

/* 11/15 b ⑤: 미분류 자료는 순서 번호 대신 고유 키(파일 id|신고번호)로 가리킴 — 목록이 바뀌어도 선택·버튼이 엉뚱한 자료를 가리키지 않게 */
const pendKey = x => `${x.id}|${x.declNo || ''}`;
function pendIdx(key){ return (db.collectPending || []).findIndex(x => pendKey(x) === key); }
function unblockFile(fid, rid){ const fb = db.fileBlock || {}; if(fid && fb[fid]){ fb[fid] = fb[fid].filter(x => x !== rid); if(!fb[fid].length) delete fb[fid]; } }   // 사람이 직접 넣으면 차단 풀기
function applyPendingRec(i, rid){                                         // 11/15 M-02: 후보 기록 중 하나로 확정
  const x = db.collectPending[i], r = db.records.find(y => y.id === rid);
  if(!x || !r){toast('기록을 고르세요.'); return;}
  unblockFile(x.id, r.id); markVersions(r, [x]); r.links = [...new Set([...(r.links || []), x.link].filter(u => safeUrl(u)))]; addFiles(r, [x]);
  addHist(r, `자료 ${x.name} — 같은 번호 후보 ${(x.cands || []).length}건 중 이 기록으로 확정${me ? ` (${me.name})` : ''}`);
  db.collectPending.splice(i, 1); commit(); toast(`${r.caseNo || ''} 기록에 넣었습니다.`);
}
function applyPending(i, cid){
  const x = db.collectPending[i], c = db.clients.find(y => y.id === cid);
  if(!x || !c){toast('업체를 고르세요.'); return;}
  const ex = db.records.find(r => r.clientId === c.id && refMatch(r, x));
  if(ex) unblockFile(x.id, ex.id);
  if(ex){ markVersions(ex, [x]); ex.links = [...new Set([...(ex.links || []), x.link].filter(u => safeUrl(u)))]; addFiles(ex, [x]); }
  else db.records.push(collectNewRecord(c, [x]));
  db.collectPending.splice(i, 1); commit(); toast(`${c.name} 기록으로 넣었습니다.`);
}
async function blInline(q){
  const el = $('#blInline'); if(!el) return;
  el.innerHTML = '<p class="hint">UNI-PASS 조회 중…</p>';
  try{ const j = await collectApi({bl:q.toUpperCase(), blType:'M', year:new Date().getFullYear()}); el.innerHTML = blResultHTML(j); }
  catch(e){ el.innerHTML = `<p class="msg">${esc(e.message)}</p>`; }
}
