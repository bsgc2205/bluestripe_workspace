'use strict';
/* ---------- 포워더 의뢰 경로·청구처 (11/14 P2) ----------
   업체는 같은 레벨. 업체 구분 c.role: 'fwd'(포워더) / 'shipper'(화주) / ''(자동 — 업종에 포워더·물류 등이 있으면 포워더).
   기록 r.via = 이 건을 보낸 포워더 업체 id, r.billTo = 'self'(화주에 청구) / 'via'(포워더에 청구), r.billBy = 근거(manual·mail·pair·client·fwd).
   청구처 자동: ① 이 건의 [청구서]·[정산서]·청구내역 직원 메일의 받는 사람 도메인 ② 같은 화주+포워더 조합의 지난 결정 ③ 화주 기본(c.billDefault)
   ④ 포워더 기본(f.billDefault) ⑤ 못 정하면 확인함 '청구처 미정'(최근 60일). 직접 고친 값(manual)은 바꾸지 않는다.
   의뢰처 자동: 메일 대화에 포워더 업체의 메일 도메인이 나오거나 포워더 이름이 제목에 있으면(기록 업체가 그 포워더가 아닐 때). */
function isFwd(c){ if(!c) return false; if(c.role === 'fwd') return true; if(c.role === 'shipper') return false; return typeof isFwdClient === 'function' && isFwdClient(c); }
function fwdClients(){ return db.clients.filter(isFwd); }
function clientDomains(c){ return typeof dupDomains === 'function' ? dupDomains(c) : []; }
function mailDomainsOf(m){ return (String([m.from, m.fwdFrom, m.to].join(' ')).toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/g) || []).map(x => x.slice(1)).filter(d => !/bsgc\.co\.kr$/.test(d)); }
/* ---------- 11/21 1단계(F1~F5): 의뢰처·청구처 상태와 근거 ----------
   상태(따로 저장): r.viaSt / r.billSt = '' 미정 · 'guess' 추정 · 'auto' 자동 확인(객관적 근거) · 'sure' 수동 확인(사람) · 're' 재확인 · 'old' 기존 값(근거 기록 없음)
   원칙(DH 11/21): 명확한 건은 승인 없이 처리, 불확실하면 추가 근거로 자동 재판단, 해소되지 않는 예외만 담당자에게. 의뢰처·청구처 불확실성은 청구 업무에만 영향(단계·완료 자동 처리는 계속).
   근거: r.viaBy('auto'|'manual'), r.viaWhy, r.viaCands[](후보 id) / r.billBy('manual'|'mail'|'pair'|'client'|'fwd'|'move'), r.billWhy, r.billRef{mail|rec}
   자동 판단은 확정(sure)·재확인(re)을 덮어쓰지 않는다. 추정은 다른 추정의 근거가 되지 않는다(F4). */
const ST_LAB = {'':'미정', guess:'추정', auto:'자동 확인', sure:'수동 확인', re:'재확인', old:'기존'};   // 11/21 b: 객관적 근거(사건에 확실히 붙은 메일 등)로 정한 것은 '자동 확인'
const SURE_HOW = new Set(['case', 'decl', 'bl', 'manual']);
/* 청구처·의뢰처 확인이 필요한 시점 — 청구 단계(수리·선적·정산 근거가 있거나 완료). 그 전에는 불확실해도 다른 자동 처리를 막지 않고 확인함에도 올리지 않음 */
function billDue(r){ const s = r.stage || {}; return r.status === '완료' || !!(s.customs || s.accept || s.settle); }
function viaStOf(r){ return r.viaSt || (r.viaBy === 'manual' ? 'sure' : r.via ? (r.viaBy === 'auto' ? 'guess' : 'old') : ''); }
function billStOf(r){ return r.billSt || (r.billBy === 'manual' ? 'sure' : r.billTo ? 'guess' : ''); }
function billSure(r){ return billStOf(r) === 'sure'; }
/* F1: 후보를 근거 순서대로 좁힘 — ① 메일 주소 하나 ② 사건번호·신고번호·B/L로 붙은 메일의 주소 ③ 제목의 업체명 ④ 의뢰 메일(첫 메일) 보낸 곳 ⑤ 확인된 지난 거래 관계.
   그래도 여럿일 때만 후보로 남김(확인함). 후보 id 정렬로 순서와 무관 */
function forwarderPick(ms, clientId){
  const fs = fwdClients().filter(f => f.id !== clientId);
  if(!fs.length || !ms || !ms.length) return {f:null, cands:[]};
  const domOf = list => new Set(list.flatMap(mailDomainsOf)), hit = (cs, ds) => cs.filter(f => clientDomains(f).some(d => ds.has(d)));
  const sureMs = ms.filter(m => SURE_HOW.has(m.how));
  const byDom = hit(fs, domOf(ms));
  if(byDom.length === 1) return {f:byDom[0], cands:[], why:'메일 주소', st:hit(byDom, domOf(sureMs)).length ? 'auto' : 'guess'};
  if(byDom.length > 1 && sureMs.length){ const s = hit(byDom, domOf(sureMs)); if(s.length === 1) return {f:s[0], cands:[], why:'사건번호·신고번호·B/L로 붙은 메일의 주소', st:'auto'}; }
  const subj = ms.map(m => m.subject || '').join(' ');
  const byName = fs.filter(f => typeof clientCands === 'function' && clientCands(subj).some(x => x.id === f.id));
  const inDom = byDom.length ? byName.filter(f => byDom.includes(f)) : byName;
  if(inDom.length === 1) return {f:inDom[0], cands:[], why:byDom.length ? '메일 주소 여럿 중 제목의 업체명' : '제목의 업체명', st:'guess'};
  const cands = [...new Set([...byDom, ...byName])].sort((a, b) => a.id < b.id ? -1 : 1);
  if(cands.length > 1){
    const ext = ms.filter(m => m.from && m.date && !/@bsgc\.co\.kr/i.test(m.from)).sort((a, b) => String(a.date).localeCompare(String(b.date))), first = ext[0];
    /* 첫 메일이 분명할 때만(같은 시각이면 판단 안 함 — 순서에 따라 달라지지 않게) */
    if(first && !(ext[1] && String(ext[1].date) === String(first.date))){ const s = hit(cands, domOf([{from:first.from, fwdFrom:first.fwdFrom}])); if(s.length === 1) return {f:s[0], cands:[], why:'의뢰 메일(첫 메일)을 보낸 곳', st:'guess'}; }
    const known = new Set(db.records.filter(x => x.clientId === clientId && x.via && ['sure', 'auto'].includes(viaStOf(x))).map(x => x.via));
    const s = cands.filter(f => known.has(f.id)); if(s.length === 1) return {f:s[0], cands:[], why:'확인된 지난 거래 관계', st:'guess'};
  }
  return {f:null, cands:cands.length > 1 ? cands : [], why:cands.length > 1 ? `후보 ${cands.length}곳(${byDom.length ? '메일 주소' : '제목'}) — ${cands.map(f => f.name).join('·')}` : ''};
}
function forwarderOf(ms, clientId){ return forwarderPick(ms, clientId).f; }
/* 자동 판단 결과 적용 — 확정·재확인은 건드리지 않음. 같은 후보면 다시 기록하지 않음(확인 항목·이력 중복 방지) */
function applyViaPick(r, p){
  if(viaStOf(r) === 'sure' && r.via) return '';                           // 사람이 정한 것은 그대로(재확인은 새 근거로 자동 해소)
  if(p.f){ const st = p.st || 'guess'; if(r.via === p.f.id && r.viaSt === st && !r.viaCands) return ''; const was = r.via || ''; r.via = p.f.id; r.viaBy = 'auto'; r.viaSt = st; r.viaWhy = p.why; delete r.viaCands; if(was && was !== r.via) viaChanged(r, was); return 'set'; }
  const ids = (p.cands || []).map(f => f.id);
  if(ids.length > 1 && String(r.viaCands || '') !== ids.join(',')){ r.viaCands = ids; r.viaWhy = p.why; r.viaSt = r.via ? 're' : ''; return 'cands'; }
  return '';
}
function recMailsFull(r){ const byId = new Map((mailCache || []).map(m => [m.id, m])); return (r.mails || []).map(x => ({...(byId.get(x.id) || {id:x.id, subject:x.subject, from:x.from, date:x.date}), how:x.how})); }
const BILL_SUBJ = /청구서|정산서|청구\s*내역|정산\s*내역|자금\s*청구|invoice\s*for\s*customs/i;
/* F4: 청구서 메일은 이 사건에 확실히 연결된 메일(사건번호·신고번호·B/L·직접)이고 받는 사람이 포워더/화주 한쪽일 때만 근거 */
function billFromMails(r){
  const via = db.clients.find(c => c.id === r.via), cl = db.clients.find(c => c.id === r.clientId);
  if(!via) return null;
  const sure = typeof MAIL_HOW_SURE !== 'undefined' ? MAIL_HOW_SURE : new Set(['case', 'decl', 'bl', 'manual']);
  const fd = new Set(clientDomains(via)), cd = new Set(clientDomains(cl || {}));
  for(const m of recMailsFull(r).filter(m => sure.has(m.how) && /@bsgc\.co\.kr/i.test(String(m.from || '')) && BILL_SUBJ.test(m.subject || '')).reverse()){
    const to = (String(m.to || '').toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/g) || []).map(x => x.slice(1));
    if(!to.length) continue;
    if(to.some(d => fd.has(d)) && !to.some(d => cd.has(d))) return {v:'via', mail:m.id};
    if(to.some(d => cd.has(d)) && !to.some(d => fd.has(d))) return {v:'self', mail:m.id};
  }
  return null;
}
const BILL_WHY = {manual:'직접 지정', mail:'청구서 메일 받는 사람', pair:'같은 화주·포워더의 확정된 지난 건', client:'화주 기본값', fwd:'포워더 기본값', move:'화주로 옮길 때 넣은 값'};
function setBill(r, v, by, ref, st, why){
  const was = `${r.billTo || ''}/${billStOf(r)}`;
  r.billTo = v || ''; r.billBy = v ? by : ''; r.billSt = v ? st : ''; r.billWhy = why || (v ? BILL_WHY[by] || '' : '');
  if(ref) r.billRef = ref; else delete r.billRef;
  return was !== `${r.billTo}/${r.billSt}`;
}
function resolveBillTo(r){
  if(!r.via || billStOf(r) === 'sure') return false;
  const re = billStOf(r) === 're';
  let v = '', by = '', ref = null;
  const bm = billFromMails(r); if(bm){ v = bm.v; by = 'mail'; ref = {mail:bm.mail}; }
  if(re && !bm) return false;                                              // 재확인은 객관적 근거(청구서 메일)가 새로 생길 때만 자동 해소
  if(!v){ const p = db.records.filter(x => x !== r && x.clientId === r.clientId && x.via === r.via && x.billTo && billStOf(x) === 'sure').sort(byDateDesc)[0]; if(p){ v = p.billTo; by = 'pair'; ref = {rec:p.id}; } }   // F4: 사람이 확정한 지난 건만
  if(!v){ const c = db.clients.find(x => x.id === r.clientId); if(c && c.billDefault){ v = c.billDefault; by = 'client'; } }
  if(!v){ const f = db.clients.find(x => x.id === r.via); if(f && f.billDefault){ v = f.billDefault; by = 'fwd'; } }
  if(!v) return false;                                                     // 근거 없으면 그대로(옮길 때 넣은 추정 포함)
  const was = r.billTo ? `${billLabel(r)}(${ST_LAB[billStOf(r)]})` : '미정', st = by === 'mail' ? 'auto' : 'guess';
  if(r.billTo === v && r.billBy === by && r.billSt === st && JSON.stringify(r.billRef || null) === JSON.stringify(ref)) return false;
  setBill(r, v, by, ref, st);
  addHist(r, `청구처: ${was} → ${billLabel(r)}(${ST_LAB[st]} — ${BILL_WHY[by]}${ref && ref.rec ? ` ${caseLab(ref.rec)}` : ''}${ref && ref.mail ? ` 메일 ${ref.mail}` : ''})`);
  return true;
}
function caseLab(rid){ const x = db.records.find(y => y.id === rid); return x ? (x.caseNo || x.title || '').slice(0, 30) : ''; }
function billLabel(r){ return r.billTo === 'via' ? `${clientName(r.via)}(포워더)` : r.billTo === 'self' ? `${clientName(r.clientId)}(화주)` : '미정'; }
/* F5: 근거 메일이 옮겨지거나 떼이면 그 메일로 정한 청구처는 재확인 */
function billSrcLost(r, mailIds){
  if(!r || !r.billRef || !r.billRef.mail || !mailIds.includes(r.billRef.mail) || billStOf(r) === 'sure') return false;
  const was = billLabel(r); r.billSt = 're'; r.billWhy = `근거 메일이 옮겨지거나 떼어짐(예전 판단: ${was})`; delete r.billRef;
  addHist(r, `청구처 재확인: 근거 메일이 옮겨지거나 떼어짐 — 예전 판단 ${was}(추정)`);
  return true;
}
/* F5: 의뢰처가 바뀌면 청구처 재검토 — 확정이고 '포워더 청구'였으면 재확인, 아니면 다시 판단 */
function viaChanged(r, was){
  if(!r.billTo || (r.via || '') === (was || '')) return;
  if(!r.via){ addHist(r, `청구처: ${r.billTo === 'via' ? '포워더' : '화주'} → 미정 (의뢰처 없음)`); setBill(r, '', '', null, ''); return; }
  if(billStOf(r) === 'sure' && r.billTo === 'via'){ r.billSt = 're'; r.billWhy = `의뢰처가 ${clientName(was)} → ${clientName(r.via)}로 바뀜`; addHist(r, `청구처 재확인: 의뢰처가 바뀜(포워더 청구를 사람이 정했던 건)`); return; }
  if(billStOf(r) !== 'sure'){ setBill(r, '', '', null, ''); resolveBillTo(r); }
}
/* 메일을 불러올 때·기록을 저장할 때: 의뢰처 없는 최근 기록에 의뢰처 채우기 + 청구처 정하기 */
function routeRecords(){
  const cut = addPeriod(today(), -90, 'd');
  let n = fixRouteOnce() + autoMoveFwd();
  db.records.filter(r => recDate(r) >= cut || r.status !== '완료').forEach(r => {
    const c = db.clients.find(x => x.id === r.clientId);
    if((!r.via || (viaStOf(r) === 're' && (r.viaCands || []).length)) && !r.viaOff && c && !isFwd(c) && (r.mails || []).length){   // 미정·재확인은 메일이 늘 때마다 다시 판단
      const p = forwarderPick(recMailsFull(r), r.clientId), k = applyViaPick(r, p);
      if(k === 'set'){ addHist(r, `의뢰처: ${p.f.name}(${ST_LAB[r.viaSt]} — ${p.why})`); n++; }
      else if(k === 'cands'){ addHist(r, `의뢰처 미정: ${p.why} — 확인함에서 고르기`); n++; }
    }
    if(resolveBillTo(r)) n++;
  });
  return n;
}
/* 11/21 한 번(재실행해도 같은 결과, settings.routeFix): 기존 데이터 보정 — 바꾸기 전 값은 db.routeFixLog에 남기고 되돌릴 수 있음
   ① 의뢰처: 자동 근거(이력 '의뢰처: … (메일 주소·제목)' 또는 자동접수 기록)가 있으면 추정, 그 상태에서 후보가 여럿이면 재확인(값 유지). 사람 확정 흔적이 없고 자동 근거도 없으면 '기존'.
   ② 청구처 manual: '화주로 옮김' 처리가 넣은 값이 확실한 것(옮기기 전 의뢰처·청구처 이력 없음, 옮긴 뒤 직접 지정·기록 수정 없음)만 추정으로, 옮긴 뒤 기록을 고친 흔적이 있으면 재확인, 그 밖의 manual은 그대로 확정.
   ③ 청구처 pair: 근거가 된 지난 건이 확정이 아니었을 수 있으므로 다시 판단(근거 없으면 미정). */
function fixRouteOnce(){
  if(db.settings.routeFix) return 0;                                       // '20261121' 실행함 · 'undone' 되돌림 — 둘 다 다시 안 함
  const log = [], cut = addPeriod(today(), -90, 'd');
  const snap = r => ({via:r.via || '', viaBy:r.viaBy || '', viaSt:r.viaSt || '', viaCands:r.viaCands || null, viaWhy:r.viaWhy || '', billTo:r.billTo || '', billBy:r.billBy || '', billSt:r.billSt || '', billWhy:r.billWhy || '', billRef:r.billRef || null});
  let nFix = 0, nRe = 0;
  db.records.forEach(r => {
    const before = snap(r), H = (r.history || []).map(h => String(h.text || '')), notes = [];
    if(r.via && !r.viaBy){
      const auto = H.some(t => t.startsWith(`의뢰처: ${clientName(r.via)} (메일 주소`)) || ((r.tags || []).includes('자동접수') && !H.some(t => /^의뢰처: .*직접/.test(t)));
      r.viaBy = auto ? 'auto' : ''; r.viaSt = auto ? 'guess' : 'old';
      if(auto && (recDate(r) >= cut || r.status !== '완료') && (r.mails || []).length){
        const p = forwarderPick(recMailsFull(r), r.clientId), ids = (p.cands || []).map(f => f.id);
        if(!p.f && ids.length > 1 && ids.includes(r.via)){ r.viaCands = ids; r.viaSt = 're'; r.viaWhy = `자동으로 ${clientName(r.via)}로 정했지만 ${p.why}`; notes.push(`의뢰처 재확인(후보 ${ids.map(clientName).join('·')})`); nRe++; }
      }
    }
    if(r.billBy === 'manual' && !r.billSt){
      const iMv = H.map((t, i) => t.startsWith('화주로 옮김:') ? i : -1).filter(i => i >= 0).pop();
      if(iMv != null && r.billTo === 'via'){
        const pre = H.slice(0, iMv).some(t => /^청구처|^의뢰처/.test(t));
        const post = H.slice(iMv + 1).some(t => /^청구처: .*직접 지정/.test(t));
        const edited = H.slice(iMv + 1).some(t => /→|수정/.test(t) && !/^메일|^자료|^단계|^청구처 재확인/.test(t));
        if(!pre && !post && !edited){ setBill(r, 'via', 'move', null, 'guess', '화주로 옮길 때 자동으로 넣은 값(11/21 보정: 확정 → 추정)'); notes.push('청구처 확정 → 추정(옮길 때 자동 생성)'); nFix++; }
        else if(!post){ r.billSt = 're'; r.billWhy = '화주로 옮길 때 넣은 값인지 사람이 정한 값인지 구분 안 됨'; notes.push('청구처 재확인(구분 불가)'); nRe++; }
        else r.billSt = 'sure';
      } else r.billSt = 'sure';
    }
    if(r.billBy === 'pair'){ const was = billLabel(r); setBill(r, '', '', null, ''); resolveBillTo(r); notes.push(`청구처 다시 판단(지난 건 추정 연쇄 차단): ${was} → ${r.billTo ? billLabel(r) + '(추정)' : '미정'}`); nFix++; }
    if(notes.length){ log.push({id:r.id, at:nowIso(), before, after:snap(r), why:notes.join(' · ')}); addHist(r, `11/21 보정: ${notes.join(' · ')}`); }
  });
  db.routeFixLog = [...(db.routeFixLog || []), ...log].slice(-2000);
  db.settings.routeFix = '20261121';
  if(log.length && typeof logProc === 'function') logProc('mail', `의뢰처·청구처 보정: 보정 ${nFix}건 · 재확인 ${nRe}건 (되돌리기: 관리 › 수집 상태)`);
  return log.length;
}
function undoRouteFix(){
  const log = db.routeFixLog || []; let n = 0;
  log.forEach(x => { const r = db.records.find(y => y.id === x.id); if(!r) return; Object.entries(x.before).forEach(([k, v]) => { if(v === '' || v === null) delete r[k]; else r[k] = v; }); addHist(r, '11/21 보정 되돌림'); n++; });
  db.routeFixLog = []; db.settings.routeFix = 'undone';                     // 되돌린 뒤에는 다시 실행하지 않음(관리자가 다시 켤 때까지)
  return n;
}
/* 기존 정리: 포워더 업체로 접수된 기록 중 제목에 다른 화주가 보이는 건 → 화주로 옮기고 의뢰처는 그 포워더 */
/* 11/21 F2: 포워더로 접수된 기록 중 화주로 옮길 후보 — 근거별로
   제목의 업체명(강함) / 수하인 표기 C/…(수입 건만, 약함 — 수출의 수하인은 해외 구매자) / 둘이 다르거나 후보 여럿이면 기본 선택 안 함 */
function fwdMoveCands(fid){
  return db.records.filter(r => r.clientId === fid).map(r => {
    const io = typeof recIO === 'function' ? recIO(r) : '', exp = io === 'E';   // 'E' 수출 · 'I' 수입 · '' 불명확
    const ok = c => c && c.id !== fid && !isFwd(c);
    const cp = (r.certs || []).map(cd => typeof certParty === 'function' ? certParty(cd) : null).filter(Boolean);
    if(cp.some(c => c.id === fid)) return null;                             // 필증의 수입자·수출자가 포워더 자신 → 포워더 자기 일
    const cert = [...new Set(cp.filter(ok).map(c => c.id))].map(id => db.clients.find(c => c.id === id));   // 필증의 수입자·수출자(사업자번호) — 가장 강한 근거
    const title = String(r.title || '').replace(/(^|[\s\[(,])C\s*\/\s*[A-Z][A-Z0-9&.'\- ]{1,40}/g, ' ');   // 수하인 표기(C/…)는 '제목의 업체명' 근거에서 뺌
    const subj = [...new Set((typeof clientCands === 'function' ? clientCands(title) : []).filter(ok).map(c => c.id))].map(id => db.clients.find(c => c.id === id));
    let cn = [];
    if(io === 'I' && typeof consigneeNames === 'function'){                 // 수하인은 수입 건만(수출의 수하인 = 해외 구매자, 유형 불명확도 제외)
      const txt = [r.title, ...(r.mails || []).slice(0, 3).map(m => m.subject)].join(' ');
      cn = [...new Set(consigneeNames(txt).map(n => findClient(n)).filter(ok).map(c => c.id))].map(id => db.clients.find(c => c.id === id));
    }
    const all = [...new Set([...cert, ...subj, ...cn])];
    if(!all.length) return null;
    const why = c => [cert.includes(c) && `필증의 ${exp ? '수출자' : '수입자'}`, subj.includes(c) && '제목의 업체명', cn.includes(c) && '수하인 표기(C/)'].filter(Boolean).join('·');
    const others = c => [...subj, ...cn].filter(x => x !== c).length === 0;
    const sure = cert.length === 1 ? others(cert[0])                         // 필증 화주가 하나이고 다른 업체 단서가 없으면 확실
      : !cert.length && !!io && subj.length === 1 && (!cn.length || (cn.length === 1 && cn[0] === subj[0]));   // 유형이 분명하고 제목의 업체명이 하나
    const to = cert.length === 1 ? cert[0] : subj.length === 1 ? subj[0] : all.length === 1 ? all[0] : null;
    return {r, to, cands:all, sure, cert:cert.length === 1 && sure, why:(to ? why(to) : `후보 ${all.length}곳 — 고르세요`) + (io || cert.length ? '' : ' · 업무 유형 불명확'), exp, io};
  }).filter(Boolean);
}
/* 포워더 기록 → 화주 기록 (자동·직접 공통). 의뢰처 = 원래 기록 업체(포워더)라 객관적(자동 확인), 청구처는 비어 있으면 '포워더' 추정 */
function moveToShipper(r, f, to, why, auto){
  const wasVia = r.via || '', wasClient = r.clientId;
  r.clientId = to.id; r.via = f.id; r.viaBy = auto ? 'auto' : 'manual'; r.viaSt = auto ? 'auto' : 'sure'; r.viaWhy = `포워더 기록을 화주로 옮김(${auto ? '자동' : '직접'})`; delete r.viaCands;
  if(wasVia && wasVia !== f.id) viaChanged(r, wasVia);
  if(!r.billTo) setBill(r, 'via', 'move', null, 'guess');                  // F3: 추정으로만
  if(!r.assignee && typeof clientAssignee === 'function') r.assignee = clientAssignee(to.id) || '';
  r.updatedAt = nowIso();
  addHist(r, `화주로 옮김${auto ? '(자동)' : ''}: ${clientName(wasClient)} → ${to.name} (근거: ${why}, 의뢰처 ${f.name}, 청구처 ${billLabel(r)} ${ST_LAB[billStOf(r)]})`);
}
/* F2 자동: 근거가 분명한 건(필증 화주 하나, 또는 유형이 분명하고 제목의 업체명 하나)은 승인 없이 옮김 — 진행 중·최근 90일, 사람이 옮긴 적 없는 기록 */
function autoMoveFwd(){
  const cut = addPeriod(today(), -90, 'd'); let n = 0; const done = [];
  fwdClients().forEach(f => fwdMoveCands(f.id).forEach(x => {
    if(!x.sure || !x.to || (x.r.status === '완료' && recDate(x.r) < cut)) return;
    if((x.r.history || []).some(h => /^업체:|업체 .* → |화주로 옮김/.test(String(h.text || '')))) return;   // 사람이 업체를 바꾼 기록은 건드리지 않음
    moveToShipper(x.r, f, x.to, x.why, true); n++; done.push(`${x.r.caseNo || x.r.title} ${f.name} → ${x.to.name}`);
  }));
  if(n){ if(typeof autoLog === 'function') autoLog('fwdmoveAuto', n); if(typeof logProc === 'function') logProc('move', `포워더 기록을 화주로 자동 이동 ${n}건: ${done.slice(0, 5).join(' / ')}${n > 5 ? ' …' : ''}`); }
  return n;
}
function openFwdMove(fid){
  const f = db.clients.find(c => c.id === fid); if(!f) return;
  const list = fwdMoveCands(fid);
  const row = (x, i) => `<tr><td><input type="checkbox" name="mv" value="${i}"${x.sure ? ' checked' : ''}></td><td>${esc(x.r.caseNo || '')} ${esc(x.r.title)}<div class="hint">${x.io === 'E' ? '수출' : x.io === 'I' ? '수입' : '유형 불명확'} · ${esc(recDate(x.r))}</div></td>
    <td><select name="to${i}">${opts([...(x.to ? [] : [['', '— 화주 고르기 —']]), ...x.cands.map(c => [c.id, c.name])], x.to ? x.to.id : '')}</select><div class="hint">근거: ${esc(x.why)}${x.sure ? '' : ' — <b>확인 필요</b>(기본 선택 안 함)'}</div></td></tr>`;
  openDialog({title:`${f.name} 기록을 화주로 옮기기 — ${list.length}건`, saveLabel:'선택한 기록 옮기기',
    body:`<p class="hint">‘${esc(f.name)}’(포워더)로 접수된 기록 중 화주가 보이는 건입니다. <b>근거가 분명한 건(필증 화주 하나, 유형이 분명하고 제목의 업체명 하나)은 메일을 불러올 때 자동으로 옮겨지고</b>, 여기 남은 것은 그 밖의 건입니다. 기본 선택은 근거가 분명한 것만, 수하인 표기(C/)로만 찾은 건·후보가 여럿인 건은 고른 뒤 체크하세요(수하인 표기는 수입 건에서만 참고 — 수출의 수하인은 해외 구매자, 유형이 불명확한 건은 기본 선택 안 함). 옮기면 기록 업체는 화주로, <b>의뢰처는 ${esc(f.name)}</b>로 남습니다. 청구처가 비어 있으면 '포워더(추정)'로 두고, 확정은 기록에서 직접 고를 때만입니다.</p>
      ${list.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th></th><th>기록</th><th>옮길 화주</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>` : '<p class="empty">옮길 후보가 없습니다.</p>'}`,
    onSave(fd){
      const picks = fd.getAll('mv').map(Number); let n = 0, skip = 0;
      picks.forEach(i => { const x = list[i]; if(!x) return; const to = db.clients.find(c => c.id === fd.get('to' + i)); if(!to){ skip++; return; }
        moveToShipper(x.r, f, to, fd.get('to' + i) === (x.to || {}).id ? x.why : '직접 고름', false); n++; });
      if(typeof autoLog === 'function') autoLog('fwdmove', n);
      toast(`${n}건을 화주로 옮겼습니다.${skip ? ` 화주를 고르지 않은 ${skip}건은 그대로 둠.` : ''}`);
    }});
}
/* 업체 화면: 포워더면 보낸 화주 표, 화주면 의뢰 경로 한 줄 */
function clientRouteHTML(c){
  if(isFwd(c)){
    const rs = db.records.filter(r => r.via === c.id), m = today().slice(0, 7);
    const by = new Map(); rs.forEach(r => { const g = by.get(r.clientId) || {n:0, last:'', bill:0}; g.n++; if(recDate(r) > g.last) g.last = recDate(r); if(r.billTo === 'via' && recDate(r).startsWith(m)) g.bill++; by.set(r.clientId, g); });
    const mv = fwdMoveCands(c.id).length;
    const rows = [...by.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
    return `<section class="fwd-box"><div class="sec-head"><h3>이 포워더가 보낸 화주 <span class="cnt">${by.size}곳 · ${rs.length}건</span></h3>${mv ? `<button class="mini strong" data-fwd-move="${esc(c.id)}" title="포워더 업체로 접수된 기록 중 제목에 화주가 보이는 건">화주로 옮길 기록 ${mv}건</button>` : ''}</div>
      ${rows.length ? `<p class="route-line">${rows.map(([cid, g]) => `<button class="linkish" data-go="client" data-id="${esc(cid)}">${esc(clientName(cid))}</button> ${g.n}${g.bill ? `<span class="hint">(이번 달 포워더 청구 ${g.bill})</span>` : ''}`).join(' · ')}${by.size > 8 ? ` <span class="hint">외 ${by.size - 8}곳</span>` : ''}</p>` : '<p class="hint">아직 이 포워더를 의뢰처로 둔 기록이 없습니다.</p>'}
      <p class="hint">기본 청구처: ${c.billDefault === 'via' ? '포워더' : c.billDefault === 'self' ? '화주' : '지정 안 함'} (업체 정보 수정에서 바꿈)</p></section>`;
  }
  const rs = db.records.filter(r => r.clientId === c.id);
  if(!rs.some(r => r.via)) return '';
  const by = new Map(); rs.forEach(r => by.set(r.via || '', (by.get(r.via || '') || 0) + 1));
  return `<p class="route-line">의뢰 경로: ${[...by.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => v ? `<button class="linkish" data-go="client" data-id="${esc(v)}">${esc(clientName(v))}</button> ${n}` : `직거래 ${n}`).join(' · ')}</p>`;
}
/* 업체 리스트 '포워더별로 묶어 보기' */
let clientListByFwd = false;
function clientListFwdHTML(){
  const fs = fwdClients().sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const viaOf = new Map(); db.records.forEach(r => { if(!r.via) return; const s = viaOf.get(r.via) || new Map(); s.set(r.clientId, (s.get(r.clientId) || 0) + 1); viaOf.set(r.via, s); });
  const direct = db.clients.filter(c => !isFwd(c) && db.records.some(r => r.clientId === c.id && !r.via));
  const li = (cid, n) => `<li><button class="linkish" data-go="client" data-id="${esc(cid)}">${esc(clientName(cid))}</button> <span class="hint">${n}건</span></li>`;
  return `<div class="fwd-tree">${fs.map(f => { const s = viaOf.get(f.id) || new Map(); return `<details${s.size ? ' open' : ''}><summary><strong>${esc(f.name)}</strong> <span class="hint">포워더 · 화주 ${s.size}곳</span> <button class="mini" data-go="client" data-id="${esc(f.id)}">열기</button></summary><ul class="plain">${[...s.entries()].sort((a, b) => b[1] - a[1]).map(([cid, n]) => li(cid, n)).join('') || '<li class="hint">의뢰처로 지정된 기록 없음</li>'}</ul></details>`; }).join('')}
    <details><summary><strong>직거래</strong> <span class="hint">${direct.length}곳</span></summary><ul class="plain">${direct.map(c => li(c.id, db.records.filter(r => r.clientId === c.id && !r.via).length)).join('')}</ul></details></div>`;
}

/* ---------- 자동 처리 점검 (11/14 P2) ----------
   자동 접수·업체 추정이 맞았는지 주별로 본다. 근거: 기록(자동 접수 태그·이력의 '업체 추정'·'업체 A → B' 변경), db.autoLog(접수 취소·참고 메일 사용·화주로 옮김). */
function autoLog(kind, n = 1, extra){ db.autoLog = [...(db.autoLog || []), {at:nowIso(), kind, n, ...(extra || {})}].slice(-800); }
function weekKey(iso){ const d = new Date(String(iso || '').slice(0, 10) + 'T00:00:00'); if(isNaN(d)) return ''; const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return d.toISOString().slice(0, 10); }
function autoCheckRows(weeks = 6){
  const ks = []; { const d = new Date(today() + 'T00:00:00'); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); for(let i = 0; i < weeks; i++){ ks.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() - 7); } }
  const row = k => ({k, intake:0, infer:0, moved:0, inferBad:0, undo:0, refUsed:0, merged:0});
  const R = new Map(ks.map(k => [k, row(k)]));
  db.records.filter(r => (r.tags || []).includes('자동접수')).forEach(r => {
    const x = R.get(weekKey(r.createdAt)); if(!x) return;
    x.intake++;
    const h = (r.history || []).map(e => e.text || '').join('\n'), inf = /업체 추정:/.test(h), mv = /업체 (?!합치기)[^,\n]+ → /.test(h) || /화주로 옮김/.test(h);
    if(inf) x.infer++; if(mv) x.moved++; if(inf && mv) x.inferBad++;
  });
  (db.autoLog || []).forEach(e => { const x = R.get(weekKey(e.at)); if(!x) return; if(e.kind === 'undo'){ x.undo += e.n || 1; if(e.how) x.inferBad += 1; } else if(e.kind === 'refUsed') x.refUsed += e.n || 1; else if(e.kind === 'recmerge') x.merged += e.n || 1; });
  return ks.map(k => R.get(k));
}
function autoCheckHTML(){
  const rows = autoCheckRows();
  const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '–';
  return `<section class="auto-check"><div class="sec-head"><h3>자동 처리 점검 <span class="cnt">최근 6주</span></h3></div>
    <div class="table-wrap"><table class="grid"><thead><tr><th>주(월요일)</th><th class="num">자동 접수</th><th class="num">접수 취소</th><th class="num">업체 바꿈</th><th class="num">업체 추정</th><th class="num">추정 틀림</th><th class="num">참고 메일 다시 씀</th><th class="num">기록 합침</th></tr></thead><tbody>
      ${rows.map(x => `<tr><td>${esc(x.k)}</td><td class="num">${x.intake}</td><td class="num">${x.undo}${x.intake ? ` <span class="hint">${pct(x.undo, x.intake)}</span>` : ''}</td><td class="num">${x.moved}</td><td class="num">${x.infer}</td><td class="num">${x.inferBad}${x.infer ? ` <span class="hint">${pct(x.inferBad, x.infer)}</span>` : ''}</td><td class="num">${x.refUsed}</td><td class="num">${x.merged}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="hint">접수 취소·업체 바꿈·추정 틀림이 많은 주가 있으면 그 주의 기록 이력을 보고 규칙을 고칩니다. ‘참고 메일 다시 씀’ = 참고 메일로 뺀 대화를 직원이 기록에 붙이거나 기록으로 만든 수(많으면 참고 분류가 너무 넓음). 11/14 이후부터 셉니다.</p></section>`;
}
/* 11/21 F1·F5: 확인함 '의뢰처 확인'에서 고르기 → 확정, 청구처는 viaChanged로 재검토 */
document.addEventListener('click', e => {
  const b = db && e.target.closest('[data-via-set]'); if(!b || e.target.closest('dialog')) return;
  e.preventDefault();
  const [rid, fid] = b.dataset.viaSet.split('|'), r = db.records.find(x => x.id === rid); if(!r) return;
  const was = r.via || '', cands = (r.viaCands || []).map(clientName).join('·');
  r.via = fid || ''; r.viaOff = !fid; r.viaBy = 'manual'; r.viaSt = fid ? 'sure' : ''; r.viaWhy = fid ? `직접 지정(후보: ${cands})` : '직거래로 지정'; delete r.viaCands;
  viaChanged(r, was);
  if(fid && !r.billTo) resolveBillTo(r);
  addHist(r, fid ? `의뢰처: ${was ? clientName(was) + '(' + (was === fid ? '추정' : '자동') + ')' : '미정'} → ${clientName(fid)}(수동 확인 — 직접 지정)` : `의뢰처: ${was ? clientName(was) : '미정'} → 없음(직거래, 수동 확인)`);
  r.updatedAt = nowIso();
  if(typeof autoLog === 'function' && was && was !== fid) autoLog('viafix');
  commit(); toast(fid ? `의뢰처를 ${clientName(fid)}로 정했습니다(수동 확인).` : '직거래로 정했습니다.');
});
/* F5: 기록 카드의 의뢰처·청구처 표시 — 상태(미정/추정/확정/재확인/기존)와 근거(마우스를 올리면) */
function routeTagHTML(r){
  const vs = viaStOf(r), bs = billStOf(r), mark = s => `<small class="st-${s || 'none'}"> ${ST_LAB[s]}</small>`;
  if(!r.via) return (r.viaCands || []).length > 1 ? `<span class="tag via warn" title="${esc(r.viaWhy || '포워더 후보 여럿')} — 확인함 '의뢰처 확인'에서 고르기">의뢰처 미정 · 후보 ${r.viaCands.length}</span>` : '';
  const tip = `의뢰처: ${clientName(r.via)} — ${ST_LAB[vs]}${r.viaWhy ? ' · ' + r.viaWhy : ''}\n청구처: ${r.billTo ? billLabel(r) : '미정'} — ${ST_LAB[bs]}${r.billWhy ? ' · ' + r.billWhy : r.billBy ? ' · ' + (BILL_WHY[r.billBy] || '') : ''}${r.billRef && r.billRef.rec ? ` (${caseLab(r.billRef.rec)})` : ''}${r.billRef && r.billRef.mail ? ' (청구서 메일)' : ''}`;
  return `<span class="tag via${vs === 're' || bs === 're' ? ' warn' : ''}" title="${esc(tip)}">의뢰 ${esc(clientName(r.via))}${mark(vs)} · 청구 ${r.billTo ? (r.billTo === 'via' ? '포워더' : '화주') + mark(bs) : '<small class="st-none"> 미정</small>'}</span>`;
}
/* 11/21 보정 되돌리기(관리 › 수집 상태) */
function routeFixHTML(){
  const log = db.routeFixLog || []; if(!log.length) return '';
  return `<p class="hint">11/21 의뢰처·청구처 보정 ${log.length}건(${esc(log[0].at.slice(0, 10))}) — 바꾸기 전 값 보관 중 ${isAdmin() ? '<button class="mini" data-route-undo>보정 되돌리기</button>' : ''}</p>`;
}
document.addEventListener('click', e => {
  const b = db && e.target.closest('[data-route-undo]'); if(!b || !isAdmin()) return;
  if(!confirm('11/21 의뢰처·청구처 보정을 모두 되돌릴까요? 보정 전 값으로 돌아갑니다(그 뒤 직접 고른 값도 보정 전 값으로 바뀜).')) return;
  const n = undoRouteFix(); if(typeof logProc === 'function') logProc('move', `의뢰처·청구처 보정 되돌림 ${n}건`); commit(); toast(`${n}건을 되돌렸습니다.`);
});
