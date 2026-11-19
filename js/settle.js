'use strict';
/* ---------- 11/19 정산서로 관세 납부 확인 (BSGC-Backup › 정산서 › 연도 › 월) ----------
   ① 목록 + 파일 이름(업체 B/L)으로 기록 연결 → '청구 완료' 근거 (글자 인식 없음, 비용 거의 없음)
   ② 글자 읽기는 '미처리 관세 납부기한'이 있는 수입 건만(또는 '세액도 모두 읽기'를 고른 수동 확인), 파일 앞쪽만
   ③ 판정: 납부영수증서 영수일 있음 → 대납 확인(기한 처리) / 납부서는 있는데 영수일 빈칸 → 영수 미확인(기한 유지)
            세금 대납 서류 없음 → 업체 자체 납부·세액 없음 후보(확인함, 자동 처리 안 함). 붙은 필증의 세액은 r.tax가 없을 때만 채움.
   db.settleSeen[파일 id] = {m:수정시각, s:'n'(연결)|'u'(미연결)|'x'(업무 아님), r:[기록 id], rd:읽은 수정시각}, db.settleUn = 미연결 파일(최근 2달) */
const SETTLE_MODE = {paid:'대납 · 영수 확인', billed:'대납 청구 · 영수 미확인', self:'세금 대납 서류 없음', none:'세액 못 읽음'};
const ymOf = d => String(d || '').slice(0, 7);
const openDuty = r => (r.deadlines || []).some(d => !d.done && d.kind === '관세 납부기한');
function settleRange(){ const t = today(); return [ymOf(addPeriod(t, -1, 'm')), ymOf(t)]; }
/* 파일 이름: '1053. 로이체일렉트로닉 KUL26003076.pdf', '티디에프 PO2606000016&PO2606000017.pdf', '티디에프 정산내역 일괄(11.02~11.06).pdf' */
function settleName(name){
  const base = String(name || '').replace(/\.[^.]+$/, '').replace(/^\s*\d+\s*\.\s*/, ''), up = base.toUpperCase();
  const toks = [...new Set((up.match(/[A-Z0-9]{6,}/g) || []).filter(t => /\d/.test(t) && (/[A-Z]/.test(t) ? /\d{3,}/.test(t) : t.length >= 9)))];
  const party = base.split(/\s+/).filter(w => w && !/\d/.test(w) && !/^(FTA|청구서|분할|최종|일괄|정산내역|&)$/i.test(w) && !/^[A-Z0-9&-]+$/i.test(w)).join(' ').replace(/\([^)]*\)/g, '').trim();
  return {toks, party, bundle:/일괄|정산내역/.test(base)};
}
function settleClient(party){ return party ? findClient(party) || (typeof fuzzyClient === 'function' ? fuzzyClient(party) : null) : null; }
/* 번호 하나로 기록 찾기 — 여러 건이면 이름의 업체·진행 중으로 좁히고, 그래도 여럿이면 고르지 않음 */
function settleFind(x, c){
  const hits = db.records.filter(r => refMatch(r, x) || (x.bl && x.bl.length >= 8 && String(r.title || '').toUpperCase().includes(x.bl)));
  let pick = hits.length > 1 && c ? hits.filter(r => r.clientId === c.id) : hits;
  if(pick.length > 1){ const op = pick.filter(r => r.status !== '완료'); if(op.length === 1) pick = op; }
  return pick.length === 1 ? pick[0] : null;
}
function settleNameRecs(f){
  const n = settleName(f.name), c = settleClient(n.party), out = [];
  n.toks.forEach(t => { const r = settleFind({bl:t}, c); if(r && !out.includes(r)) out.push(r); });
  return out;
}
function settleLink(r, f){
  r.settle = {...(r.settle || {}), fid:f.id, name:f.name, link:f.link || '', ym:f.ym, fat:f.created};
  if(r.status !== '완료' && r.status !== '보류' && !(r.stage || {}).settle) setStage(r, 'settle', f.created || today(), `정산서 폴더: ${f.name}`, 'ok');
  r.updatedAt = nowIso();
}
const settleNeedRead = (r, all) => isImp(r) && !(r.settle && r.settle.read) && (openDuty(r) || all);
/* 읽은 정산서 한 장을 기록에 반영 */
function settleApply(r, sec, f){
  const s = r.settle = {...(r.settle || {}), fid:f.id, name:f.name, link:f.link || '', ym:f.ym, read:today()};
  if(sec.written) s.at = sec.written;
  s.dep = sec.deposit || '';
  const dt = refTail(r.refNo), rc = (sec.receipts || []).filter(x => !x.declNo || !dt || refTail(x.declNo) === dt || dt.endsWith(refTail(x.declNo)) || refTail(x.declNo).endsWith(dt));
  const paid = rc.filter(x => x.paidAt), amt = rc.reduce((a, x) => a + (x.amount || 0), 0);
  s.tax = {amt:amt || null, due:(rc[0] || {}).due || '', paid:paid.length ? paid.map(x => x.paidAt).sort().slice(-1)[0] : '', n:rc.length, clct:sec.clct || ''};
  s.mode = rc.length ? (paid.length === rc.length ? 'paid' : 'billed') : sec.taxInv ? 'billed' : 'self';
  const ch = [];
  const ctaxOk = t => t && (t.vatDefer || t.clct || t.duty != null || t.vat != null || t.total != null);   // 필증 쪽을 안 읽어 빈 값이면 넣지 않음(나중에 필증 읽기가 채움)
  if(ctaxOk(sec.ctax) && !r.tax && (!sec.ctax.declNo || !dt || refTail(sec.ctax.declNo) === dt)){ r.tax = {...sec.ctax, file:f.name, at:today(), src:'정산서'}; ch.push('필증 세액'); }
  if(s.mode === 'paid'){
    const ds = (r.deadlines || []).filter(d => !d.done && d.kind === '관세 납부기한');
    ds.forEach(d => Object.assign(d, {done:true, doneAt:s.tax.paid, note:`정산서 영수일 ${s.tax.paid}${amt ? ` · ${amt.toLocaleString()}원` : ''} (대납)`}));
    if(ds.length) ch.push(`관세 납부기한 처리(영수일 ${s.tax.paid})`);
  }
  addHist(r, `정산서 읽기(${f.name}): ${SETTLE_MODE[s.mode]}${amt ? ` · 세액 ${amt.toLocaleString()}원` : ''}${s.tax.paid ? ` · 영수일 ${s.tax.paid}` : ''}${s.dep ? ` · 입금일자 ${s.dep}` : ''}${ch.length ? ` → ${ch.join('·')}` : ''}`);
  r.updatedAt = nowIso();
  return s.mode;
}
function settleUnAdd(f, why){
  const un = db.settleUn = (db.settleUn || []).filter(x => x.id !== f.id);
  un.push({id:f.id, name:f.name, link:f.link || '', ym:f.ym, created:f.created, why:why || ''});
  const cut = ymOf(addPeriod(today(), -2, 'm'));
  db.settleUn = un.filter(x => x.ym >= cut).slice(-80);
}
const settleUnDel = id => { db.settleUn = (db.settleUn || []).filter(x => x.id !== id); };
let settleBusy = false;
async function runSettle(opt = {}){
  if(settleBusy){ if(opt.manual) toast('정산서를 확인하는 중입니다. 끝나면 결과가 보입니다.'); return null; }
  settleBusy = true;
  const [f0, t0] = settleRange(), from = opt.from || f0, to = opt.to || t0, st = {files:0, linked:0, read:0, paid:0, billed:0, self:0, un:0, err:0};
  try{
    if(opt.manual) toast(`정산서 ${from} ~ ${to} 목록을 확인합니다…`);
    const j = await collectApi({settlelist:1, from, to});
    const seen = db.settleSeen = db.settleSeen || {}, q = [], byId = {};
    (j.items || []).filter(f => f.pdf).forEach(f => {
      st.files++; byId[f.id] = f;
      let o = seen[f.id];
      if(o && o.s === 'x') return;
      if(!o || o.m !== f.mod || o.s === 'u'){                             // 새 파일·고친 파일·아직 못 찾은 파일은 이름으로 다시 찾음
        const recs = settleNameRecs(f), changed = o && o.m && o.m !== f.mod;
        if(changed) recs.forEach(r => { if(r.settle && r.settle.fid === f.id) delete r.settle.read; });   // 정산서 파일을 고쳤으면 다시 읽음
        o = seen[f.id] = {...(o || {}), m:f.mod, s:recs.length ? 'n' : 'u', r:recs.map(r => r.id)};
        recs.forEach(r => { if(!r.settle || r.settle.fid !== f.id){ settleLink(r, f); st.linked++; } });
        if(recs.length) settleUnDel(f.id); else settleUnAdd(f, settleName(f.name).bundle ? '묶음 파일' : '이름의 번호로 기록을 찾지 못함');
      }
      if(o.rd === f.mod) return;
      const recs = (o.r || []).map(id => db.records.find(r => r.id === id)).filter(Boolean);
      if(o.s === 'n' ? recs.some(r => settleNeedRead(r, opt.all)) : (() => { const c = settleClient(settleName(f.name).party); return opt.all || (c && db.records.some(r => r.clientId === c.id && isImp(r) && openDuty(r))); })()) q.push(f);
    });
    const cap = opt.manual ? 40 : 12, todo = q.slice(0, cap);
    let left = todo.slice(), rounds = 0;
    while(left.length && rounds++ < Math.ceil(todo.length / 4) + 12){
      const batch = left.slice(0, 4);
      let r2;
      try{ r2 = await collectApi({settleread:batch.map(f => f.id).join(',')}); }
      catch(e){ st.err++; logProc('fail', `정산서 읽기 실패: ${e.message}`); break; }
      const later = new Set((r2.items || []).filter(i => i.later).map(i => i.id));
      (r2.items || []).filter(i => !i.later).forEach(res => {
        const f = byId[res.id]; if(!f) return;
        if(res.err){ st.err++; logProc('fail', `정산서 읽기 실패: ${f.name} — ${res.err}`); return; }
        const o = seen[f.id]; o.rd = f.mod; st.read++;
        const secs = res.secs || [], c = settleClient(settleName(f.name).party), hit = new Set();
        secs.forEach(sec => {
          let r = settleFind({declNo:sec.declNo, bl:sec.bl}, c);
          if(!r && secs.length === 1 && (o.r || []).length === 1) r = db.records.find(x => x.id === o.r[0]);
          if(!r) return;
          if(!r.settle || r.settle.fid !== f.id) settleLink(r, f);
          st[settleApply(r, sec, f)]++; hit.add(r.id);
        });
        if(hit.size){ o.s = 'n'; o.r = [...new Set([...(o.r || []), ...hit])]; settleUnDel(f.id); }
        else if(o.s === 'u') settleUnAdd(f, secs.length ? `읽었지만 기록 없음: ${secs.map(s => s.declNo || s.bl).filter(Boolean).slice(0, 3).join(', ')}` : '글자를 읽지 못함');
        else (o.r || []).forEach(id => { const r = db.records.find(x => x.id === id); if(r && isImp(r)) r.settle = {...(r.settle || {}), read:today(), mode:'none'}; });
      });
      left = left.filter(x => !batch.some(b => b.id === x.id) || later.has(x.id));
      if(batch.every(b => later.has(b.id))) await new Promise(ok => setTimeout(ok, 3000));
    }
    st.un = (db.settleUn || []).length; st.more = Math.max(0, q.length - cap);
    if(typeof fixDutyDues === 'function') fixDutyDues();                   // 정산서에 붙은 필증 세액(관세 0·납부유예)도 반영
    if(typeof evalStages === 'function') evalStages();                     // 청구 완료 + 통관완료 → 자동 완료
    db.settings.settleLast = {at:nowIso(), from, to, ...st};
    if(!opt.manual) db.settings.settleAt = today();
    const msg = `정산서 ${from}~${to}: 파일 ${st.files}개, 기록 연결 ${st.linked}건, 읽음 ${st.read}개(대납 확인 ${st.paid} · 영수 미확인 ${st.billed} · 대납 없음 ${st.self})${st.more ? `, 남은 읽기 ${st.more}개(다시 누르면 이어서)` : ''}, 미연결 ${st.un}개`;
    logProc('settle', msg); markRun('settle', true);
    commit();
    if(opt.manual || st.linked || st.paid) toast(msg);
    return st;
  }catch(e){ markRun('settle', false, e.message); if(opt.manual) toast('정산서를 확인하지 못했습니다: ' + e.message); return null; }
  finally{ settleBusy = false; }
}
/* 관리 › 자동 수집 화면의 정산서 칸 */
function settleSectionHTML(){
  const [f0, t0] = settleRange(), L = db.settings.settleLast;
  return `<section class="pay-sec stl-sec"><p><b>정산서로 관세 납부 확인</b> <span class="hint">BSGC-Backup › 정산서 › 연도 › 월 폴더</span></p>
    <p class="hint">매일 한 번 지난달·이번 달을 자동 확인합니다. 파일 이름(업체 B/L)으로 기록을 찾아 ‘청구 완료’ 근거로 붙이고, 글자 읽기는 <b>미처리 관세 납부기한이 있는 수입 건</b>만 합니다(비용 절약). 납부영수증서 영수일이 있으면 그 날짜로 관세 납부기한을 처리합니다.</p>
    <div class="btn-row stl-row"><label>시작 월 <input type="month" id="stlFrom" value="${esc(f0)}"></label><label>끝 월 <input type="month" id="stlTo" value="${esc(t0)}"></label>
      <label class="chk"><input type="checkbox" id="stlAll"> 세액도 모두 읽기(느림)</label><button class="primary" data-settle-run>정산서 확인</button></div>
    <p class="hint">권장 기간: <b>2026-10부터</b>(미처리 관세 납부기한이 있는 건). 그 전 달은 이름 연결만으로 충분하며 글자 읽기는 하지 않습니다. 한 번에 최대 40개 읽고, 남으면 다시 누르면 이어서 읽습니다.</p>
    ${L ? (() => { const rs = db.records.filter(r => r.settle && r.settle.fid), n = k => rs.filter(r => r.settle.mode === k).length;
      return `<p class="hint">최근 확인 ${esc(kstT(L.at))}(${esc(L.from)}~${esc(L.to)}, 파일 ${L.files}개) · 정산서가 연결된 기록 ${rs.length}건 — 대납 확인 ${n('paid')} · 영수 미확인 ${n('billed')} · 대납 없음 ${n('self')} · 미연결 정산서 ${(db.settleUn || []).length}개</p>`; })() : ''}</section>`;
}
/* 기록·업체 화면에 쓰는 한 줄 */
function settleTagHTML(r){
  const s = r.settle; if(!s || !s.fid) return '';
  const t = s.mode ? SETTLE_MODE[s.mode] : '청구 완료';
  return `<a class="tag how" href="${esc(safeUrl(s.link) ? s.link : '#')}" target="_blank" rel="noopener noreferrer" title="정산서 ${esc(s.name || '')}${s.tax && s.tax.amt ? ` · 세액 ${s.tax.amt.toLocaleString()}원` : ''}${s.dep ? ` · 입금일자 ${s.dep}` : ''}">정산서${s.mode ? ' · ' + esc(t) : ''}${s.tax && s.tax.paid ? ' ' + esc(s.tax.paid.slice(5)) : ''}</a>`;
}
function settleDutyCell(r){
  const s = r.settle; if(!s || !s.fid) return '<span class="hint">정산서 없음</span>';
  return `${settleTagHTML(r)}${s.mode === 'billed' && s.tax && s.tax.due ? ` <span class="hint">납부기한 ${esc(s.tax.due)}</span>` : ''}${!s.read && isImp(r) ? ` <button class="mini" data-stl-again="${esc(r.id)}">정산서 읽기</button>` : ''}`;
}
/* 확인함: 미연결 정산서 / 대납 없음(업체 자체 납부?) / 영수 미확인(기한 3일 안·지남) */
function settleCheckGroups(g){
  const un = (db.settleUn || []).filter(x => ((db.settleSeen || {})[x.id] || {}).s !== 'x');
  const recOpts = x => { const c = settleClient(settleName(x.name).party), cut = addPeriod(today(), -120, 'd');
    return db.records.filter(r => (!c || r.clientId === c.id) && recDate(r) >= cut).sort(byDateDesc).slice(0, 40).map(r => [r.id, `${r.caseNo || ''} ${r.bl || r.refNo || r.title}`.slice(0, 50)]); };
  if(un.length) g.push({k:'stlun', s:'정산서 미연결', title:'기록을 찾지 못한 정산서', why:'파일 이름의 번호(B/L·PO)로 기록을 찾지 못했습니다. 기록을 고르거나, 글자를 읽어 신고번호로 찾게 하세요', rows:un.map(x => ({key:'stl:' + x.id, t1:x.name, t2:`${x.ym} · ${x.why || ''}`, lvl:'ref',
    acts:`${safeUrl(x.link) ? `<a class="mini" href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">열기</a>` : ''}<select data-stl-rec="${esc(x.id)}"><option value="">기록 선택</option>${opts(recOpts(x), '')}</select>` + BTN.ok(`data-stl-pick="${esc(x.id)}"`) + BTN.link(`data-stl-read="${esc(x.id)}"`, '읽어서 연결') + BTN.later('stl:' + x.id) + BTN.no(`data-stl-ign="${esc(x.id)}"`)}))});
  const self = db.records.filter(r => r.settle && r.settle.mode === 'self' && openDuty(r) && recPayKind(r) !== 'monthly' && !vatDeferOf(r));
  const soon = addPeriod(today(), 3, 'd'), bill = db.records.filter(r => r.settle && r.settle.mode === 'billed' && (r.deadlines || []).some(d => !d.done && d.kind === '관세 납부기한' && d.due <= soon));
  if(self.length || bill.length) g.push({k:'stlduty', s:'관세 납부 확인', title:'정산서로 납부를 확인하지 못한 관세 납부기한', why:'대납 서류가 없는 건은 업체가 직접 냈는지, 영수일이 빈 건은 실제로 냈는지 확인하세요', rows:[
    ...self.map(r => ({key:'stls:' + r.id, t1:`${r.caseNo || ''} ${r.bl || r.refNo || r.title}`, t2:`${clientName(r.clientId)} · 정산서에 세금 대납 서류 없음 — 업체 자체 납부 또는 세액 없음?`, lvl:'chk',
      acts:BTN.ok(`data-stl-self="${esc(r.id)}"`, '업체 납부·세액 없음 확인') + BTN.link(`data-edit-rec="${esc(r.id)}"`, '기록 열기') + BTN.later('stls:' + r.id)})),
    ...bill.map(r => { const d = r.deadlines.find(x => !x.done && x.kind === '관세 납부기한');
      return {key:'stlb:' + r.id, t1:`${r.caseNo || ''} ${r.bl || r.refNo || r.title}`, t2:`${clientName(r.clientId)} · 대납 청구됨, 영수일 빈칸 · 기한 ${d.due}${r.settle.dep ? ` · 입금일자 ${r.settle.dep}` : ''}`, lvl:d.due < today() ? 'act' : 'chk',
        acts:BTN.ok(`data-stl-paid="${esc(r.id)}"`, '납부 확인') + BTN.link(`data-stl-again="${esc(r.id)}"`, '정산서 다시 읽기') + BTN.later('stlb:' + r.id)}; })]});
}
/* 한 파일만 읽기(확인함·업체 화면 버튼) */
async function settleReadOne(fid, rid){
  const o = (db.settleSeen || {})[fid] || {}, un = (db.settleUn || []).find(x => x.id === fid), r0 = rid ? db.records.find(x => x.id === rid) : null;
  const f = un || (r0 && r0.settle ? {id:fid, name:r0.settle.name, link:r0.settle.link, ym:r0.settle.ym, created:r0.settle.fat} : null);
  if(!f){ toast('정산서 파일 정보를 찾지 못했습니다.'); return; }
  toast('정산서를 읽습니다(1~2분)…');
  for(let i = 0; i < 8; i++){
    let j; try{ j = await collectApi({settleread:fid}); } catch(e){ toast('정산서를 읽지 못했습니다: ' + e.message); return; }
    const res = (j.items || [])[0] || {};
    if(res.later){ await new Promise(ok => setTimeout(ok, 3000)); continue; }
    if(res.err){ toast('정산서를 읽지 못했습니다: ' + res.err); return; }
    const secs = res.secs || [], c = settleClient(settleName(f.name).party), modes = [];
    secs.forEach(sec => { let r = settleFind({declNo:sec.declNo, bl:sec.bl}, c) || (secs.length === 1 ? r0 : null); if(!r) return; if(!r.settle || r.settle.fid !== fid) settleLink(r, f); modes.push(SETTLE_MODE[settleApply(r, sec, f)]);
      const s = db.settleSeen = db.settleSeen || {}; s[fid] = {...(s[fid] || {}), s:'n', r:[...new Set([...((s[fid] || {}).r || []), r.id])], rd:o.m || ''}; });
    if(modes.length){ settleUnDel(fid); if(typeof fixDutyDues === 'function') fixDutyDues(); if(typeof evalStages === 'function') evalStages(); }
    else if(un) un.why = secs.length ? `읽었지만 기록 없음: ${secs.map(s => s.declNo || s.bl).filter(Boolean).slice(0, 3).join(', ')}` : '글자를 읽지 못함';
    logProc('settle', `정산서 읽기 ${f.name}: ${modes.length ? modes.join(', ') : '연결할 기록 없음'}`);
    commit(); toast(modes.length ? `정산서 반영: ${modes.join(', ')}` : '읽었지만 연결할 기록을 찾지 못했습니다(확인함에서 기록을 고르세요).'); return;
  }
  toast('큰 파일이라 아직 읽는 중입니다. 잠시 뒤 다시 눌러 주세요.');
}
document.addEventListener('click', e => {
  if(!db || e.target.closest('dialog')) return;
  const el = e.target.closest('[data-settle-run],[data-stl-pick],[data-stl-read],[data-stl-ign],[data-stl-self],[data-stl-paid],[data-stl-again]');
  if(!el) return;
  const d = el.dataset, seen = db.settleSeen = db.settleSeen || {};
  if('settleRun' in d){
    const from = ($('#stlFrom') || {}).value || settleRange()[0], to = ($('#stlTo') || {}).value || settleRange()[1], all = !!($('#stlAll') || {}).checked;
    if(from > to){ toast('시작 월이 끝 월보다 늦습니다.'); return; }
    if(all && !confirm(`${from} ~ ${to} 정산서의 세액을 모두 읽습니다(파일당 10~30초, 한 번에 최대 40개). 계속할까요?`)) return;
    runSettle({manual:true, from, to, all}); return;
  }
  if(d.stlPick){
    const sel = document.querySelector(`[data-stl-rec="${CSS.escape(d.stlPick)}"]`), r = sel && db.records.find(x => x.id === sel.value), x = (db.settleUn || []).find(y => y.id === d.stlPick);
    if(!r || !x){ toast('기록을 고르세요.'); return; }
    settleLink(r, x); seen[x.id] = {...(seen[x.id] || {}), s:'n', r:[r.id]}; settleUnDel(x.id); addHist(r, `정산서 연결(직접): ${x.name}`);
    if(typeof evalStages === 'function') evalStages(); commit();
    if(settleNeedRead(r, false)) settleReadOne(x.id, r.id); else toast('연결했습니다.');
    return;
  }
  if(d.stlRead){ settleReadOne(d.stlRead); return; }
  if(d.stlIgn){ seen[d.stlIgn] = {...(seen[d.stlIgn] || {}), s:'x'}; settleUnDel(d.stlIgn); commit(); toast('정산서 목록에서 뺐습니다.'); return; }
  const r = db.records.find(x => x.id === (d.stlSelf || d.stlPaid || d.stlAgain));
  if(!r) return;
  if(d.stlAgain){ if(r.settle && r.settle.fid){ delete r.settle.read; settleReadOne(r.settle.fid, r.id); } return; }
  if(d.stlSelf){
    if(!confirm(`${r.bl || r.refNo || r.title}\n정산서에 세금 대납 서류가 없습니다. 업체가 직접 냈거나 낼 세액이 없는 건으로 보고 관세 납부기한을 처리할까요?`)) return;
    (r.deadlines || []).filter(x => !x.done && x.kind === '관세 납부기한').forEach(x => Object.assign(x, {done:true, doneAt:today(), note:'업체 자체 납부·세액 없음(정산서 대납 없음, 직접 확인)'}));
    r.settle.selfOk = today(); addHist(r, '관세 납부기한 처리: 업체 자체 납부·세액 없음(정산서에 대납 서류 없음 — 직접 확인)'); r.updatedAt = nowIso(); commit(); toast('처리했습니다.'); return;
  }
  if(d.stlPaid){
    openDialog({title:`납부 확인 — ${r.bl || r.refNo || ''}`, saveLabel:'처리',
      body:`<p class="hint">정산서의 납부서에 영수일이 비어 있습니다. 은행·UNI-PASS로 납부를 확인한 날을 넣으세요.</p><label>납부일<input type="date" name="at" value="${esc(today())}"></label>`,
      onSave(fd){ const at = fd.get('at') || today();
        (r.deadlines || []).filter(x => !x.done && x.kind === '관세 납부기한').forEach(x => Object.assign(x, {done:true, doneAt:at, note:`납부 확인 ${at}(직접 — 정산서 영수일 빈칸)`}));
        r.settle = {...r.settle, mode:'paid', tax:{...(r.settle.tax || {}), paid:at, by:'직접'}}; addHist(r, `관세 납부 확인(직접): ${at} — 정산서 영수일 빈칸`); r.updatedAt = nowIso(); }});
  }
});
