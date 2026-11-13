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
/* 메일 묶음(기록의 메일 또는 대화)에서 포워더 찾기 — 기록 업체 자신은 제외 */
function forwarderOf(ms, clientId){
  const fs = fwdClients().filter(f => f.id !== clientId);
  if(!fs.length || !ms || !ms.length) return null;
  const doms = new Set(ms.flatMap(mailDomainsOf));
  const byDom = fs.filter(f => clientDomains(f).some(d => doms.has(d)));
  if(byDom.length === 1) return byDom[0];
  const subj = ms.map(m => m.subject || '').join(' ');
  const byName = fs.filter(f => typeof clientCands === 'function' && clientCands(subj).some(x => x.id === f.id));
  return byName.length === 1 ? byName[0] : byDom[0] || null;
}
function recMailsFull(r){ const byId = new Map((mailCache || []).map(m => [m.id, m])); return (r.mails || []).map(x => byId.get(x.id) || {id:x.id, subject:x.subject, from:x.from, date:x.date}); }
const BILL_SUBJ = /청구서|정산서|청구\s*내역|정산\s*내역|자금\s*청구|invoice\s*for\s*customs/i;
function billFromMails(r){
  const via = db.clients.find(c => c.id === r.via), cl = db.clients.find(c => c.id === r.clientId);
  if(!via) return '';
  const fd = new Set(clientDomains(via)), cd = new Set(clientDomains(cl || {}));
  for(const m of recMailsFull(r).filter(m => /@bsgc\.co\.kr/i.test(String(m.from || '')) && BILL_SUBJ.test(m.subject || '')).reverse()){
    const to = (String(m.to || '').toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/g) || []).map(x => x.slice(1));
    if(!to.length) continue;
    if(to.some(d => fd.has(d)) && !to.some(d => cd.has(d))) return 'via';
    if(to.some(d => cd.has(d)) && !to.some(d => fd.has(d))) return 'self';
  }
  return '';
}
function resolveBillTo(r){
  if(!r.via || r.billBy === 'manual') return false;
  const was = r.billTo || '';
  let v = billFromMails(r), by = 'mail';
  if(!v){ const p = db.records.filter(x => x !== r && x.clientId === r.clientId && x.via === r.via && x.billTo).sort(byDateDesc)[0]; if(p){ v = p.billTo; by = 'pair'; } }
  if(!v){ const c = db.clients.find(x => x.id === r.clientId); if(c && c.billDefault){ v = c.billDefault; by = 'client'; } }
  if(!v){ const f = db.clients.find(x => x.id === r.via); if(f && f.billDefault){ v = f.billDefault; by = 'fwd'; } }
  if(!v || (v === was && r.billBy === by)) return false;
  r.billTo = v; r.billBy = by;
  if(v !== was) addHist(r, `청구처: ${billLabel(r)} (${{mail:'청구서 메일 받는 사람', pair:'같은 화주·포워더의 지난 건', client:'화주 기본값', fwd:'포워더 기본값'}[by]})`);
  return true;
}
function billLabel(r){ return r.billTo === 'via' ? `${clientName(r.via)}(포워더)` : r.billTo === 'self' ? `${clientName(r.clientId)}(화주)` : '미정'; }
/* 메일을 불러올 때·기록을 저장할 때: 의뢰처 없는 최근 기록에 의뢰처 채우기 + 청구처 정하기 */
function routeRecords(){
  const cut = addPeriod(today(), -90, 'd');
  let n = 0;
  db.records.filter(r => recDate(r) >= cut || r.status !== '완료').forEach(r => {
    const c = db.clients.find(x => x.id === r.clientId);
    if(!r.via && !r.viaOff && c && !isFwd(c) && (r.mails || []).length){
      const f = forwarderOf(recMailsFull(r), r.clientId);
      if(f){ r.via = f.id; addHist(r, `의뢰처: ${f.name} (메일 주소·제목)`); n++; }
    }
    if(resolveBillTo(r)) n++;
  });
  return n;
}
/* 기존 정리: 포워더 업체로 접수된 기록 중 제목에 다른 화주가 보이는 건 → 화주로 옮기고 의뢰처는 그 포워더 */
function fwdMoveCands(fid){
  return db.records.filter(r => r.clientId === fid).map(r => {
    const txt = [r.title, ...(r.mails || []).slice(0, 3).map(m => m.subject)].join(' ');
    const cn = typeof consigneeNames === 'function' ? consigneeNames(txt) : [];
    let to = null;
    for(const n of cn){ const c = findClient(n); if(c && c.id !== fid && !isFwd(c)){ to = c; break; } }
    if(!to){ const cs = (typeof clientCands === 'function' ? clientCands(r.title || '') : []).filter(c => c.id !== fid && !isFwd(c)); if(cs.length === 1) to = cs[0]; }
    return to ? {r, to} : null;
  }).filter(Boolean);
}
function openFwdMove(fid){
  const f = db.clients.find(c => c.id === fid); if(!f) return;
  const list = fwdMoveCands(fid);
  openDialog({title:`${f.name} 기록을 화주로 옮기기 — ${list.length}건`, saveLabel:'선택한 기록 옮기기',
    body:`<p class="hint">‘${esc(f.name)}’(포워더)로 접수된 기록 중 제목에 다른 등록 업체(화주)가 보이는 건입니다. 옮기면 기록 업체는 화주로, <b>의뢰처는 ${esc(f.name)}</b>로 남고, 청구처는 <b>포워더</b>로 둡니다(나중에 건마다 바꿀 수 있음). 화주가 영문 수하인명으로만 나오면 그 업체 검색어에 영문명을 넣은 뒤 다시 여세요.</p>
      ${list.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th></th><th>기록</th><th>옮길 화주</th></tr></thead><tbody>${list.map((x, i) => `<tr><td><input type="checkbox" name="mv" value="${i}" checked></td><td>${esc(x.r.caseNo || '')} ${esc(x.r.title)}<div class="hint">${esc(recDate(x.r))} · ${esc(x.r.status)}</div></td><td>${esc(x.to.name)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">옮길 기록이 없습니다.</p>'}`,
    onSave(fd){
      const picks = fd.getAll('mv').map(Number);
      picks.forEach(i => { const x = list[i]; if(!x) return; const b = histSnap(x.r); x.r.clientId = x.to.id; x.r.via = f.id; if(!x.r.billTo){ x.r.billTo = 'via'; x.r.billBy = 'manual'; } x.r.updatedAt = nowIso(); addHist(x.r, `화주로 옮김: ${f.name} → ${x.to.name} (의뢰처 ${f.name}, 청구처 ${billLabel(x.r)})`); });
      autoLog('fwdmove', picks.length);
      toast(`${picks.length}건을 화주로 옮겼습니다.`);
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
