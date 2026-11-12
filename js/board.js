'use strict';
/* ---------- 진행 업무 보드 (11/11 d) ----------
   칸: 접수 → 서류대기 → 신고진행 → 보완요청 → 검사 → 수리완료 → 종결(최근 14일 완료).
   단계는 기록에 쌓인 근거로 자동으로 정한다(받은 서류, UNI-PASS 신고·정정·검사·수리, 필증 송부 메일).
   직원이 카드를 옮기면(끌어 놓기 또는 단계 선택) 그 단계를 쓰고, 그 뒤 새 근거로 자동 단계가 바뀌면 다시 자동을 따른다(r.phase = {k, auto, at, by}). */
const PHASES = [['recv', '접수'], ['docs', '서류대기'], ['decl', '신고진행'], ['fix', '보완요청'], ['insp', '검사'], ['accept', '수리완료'], ['done', '종결']];
const phaseLabel = k => (PHASES.find(p => p[0] === k) || [, ''])[1];
const PH_INSP = /검사\s*(대상|지정|입회|중|선별)|현품\s*검사|정밀\s*검사|정밀\s*검역|검역\s*(중|대상)/;
const PH_FIX = /보완\s*(요구|요청|통보)|정정\s*(요구|요청|신청|중)/;
const PH_DONE_DAYS = 14;
function autoPhase(r){
  if(r.status === '완료') return 'done';
  const u = r.unipass || {}, st = stageOf(r), ev = recEvents(r);
  if(ev.accept || st.accept || st.customs || u.cleared || u.accepted) return 'accept';
  const uni = [u.last, u.cscl, u.stts, u.condTxt, u.ldp === '검사대상' ? '검사대상' : '', u.req].filter(Boolean).join(' ');
  if(PH_FIX.test(uni) || (u.mdfy && !/승인|완료|수리|취하|반려/.test(u.mdfy))) return 'fix';
  if(PH_INSP.test(uni)) return 'insp';
  if(ev.decl || u.dclrNo) return 'decl';
  const {list, extra} = docStatus(r);
  if(!list.length) return ['I', 'E'].includes(caseCode(r.type)) ? 'recv' : (ev.docs ? 'decl' : 'recv');
  const got = list.filter(x => x.ok).length + extra.length;
  if(got === 0) return 'recv';
  return list.every(x => x.ok) ? 'decl' : 'docs';
}
function recPhase(r){
  const a = autoPhase(r), p = r.phase;
  if(r.status === '완료') return {k:'done', auto:true, a};
  if(p && p.k && p.auto === a) return {k:p.k, auto:false, a, by:p.by, at:p.at};
  return {k:a, auto:true, a};
}
function setPhase(r, k){
  if(!PHASES.some(p => p[0] === k) || k === 'done') return;
  const a = autoPhase(r);
  if(k === a){ delete r.phase; }
  else r.phase = {k, auto:a, at:today(), by:me ? me.id : ''};
  addHist(r, `진행 단계: ${phaseLabel(k)}${k === a ? ' (자동 판정과 같음)' : ' (직접 옮김)'}`);
  r.updatedAt = nowIso();
  commit();
}
function boardCardHTML(r){
  const c = db.clients.find(x => x.id === r.clientId), ph = recPhase(r);
  const d = (r.deadlines || []).filter(x => !x.done).sort((a, b) => a.due.localeCompare(b.due))[0], q = bizDaysSince(lastActivity(r));
  const ref = r.bl || r.refNo || '';
  return `<article class="bd-card${r.status === '보류' ? ' hold' : ''}${q >= STALE_DAYS && r.status !== '완료' ? ' stale' : ''}" draggable="${r.status === '완료' ? 'false' : 'true'}" data-bd-id="${esc(r.id)}">
    <div class="bd-top">${r.caseNo ? `<span class="hs">${esc(r.caseNo)}</span>` : ''}<span class="tag type">${esc(r.type || '')}</span>${r.status === '보류' ? '<span class="tag">보류</span>' : ''}${c ? cautionBadge(c) : ''}</div>
    <button class="linkish bd-title" data-edit-rec="${esc(r.id)}">${esc(r.title || '(제목 없음)')}</button>
    <div class="hint">${esc(c ? c.name : '업체 미지정')}${r.assignee ? ' · ' + esc(assigneeName(r.assignee)) : ''}${ref ? ' · ' + esc(ref) : ''}</div>
    <div class="bd-foot">${d ? `${ddayHTML(d.due)} <span class="hint">${esc(d.kind)}</span>` : ''}${r.status !== '완료' ? `<span class="hint${q >= STALE_DAYS ? ' bad' : ''}">${q === 0 ? '오늘 변동' : q + '영업일 전'}</span>` : `<span class="hint">완료 ${esc(r.date || '')}</span>`}</div>
    ${r.status !== '완료' ? `<label class="bd-move"><span class="hint">${ph.auto ? '자동' : '직접'}</span><select data-bd-phase="${esc(r.id)}" aria-label="단계 옮기기">${opts(PHASES.filter(p => p[0] !== 'done'), ph.k)}</select></label>` : ''}
  </article>`;
}
function boardHTML(rows){
  const cut = addPeriod(today(), -PH_DONE_DAYS, 'd');
  const done = db.records.filter(r => r.status === '완료' && (r.date || '') >= cut && rows.mine(r) && !isUpdateRec(r)).sort(byDateDesc);
  const by = Object.fromEntries(PHASES.map(([k]) => [k, []]));
  rows.list.forEach(r => by[recPhase(r).k].push(r));
  by.done = done;
  return `<p class="legend"><span class="hint">단계는 받은 서류·UNI-PASS(신고·정정·검사·수리)·필증 메일로 자동으로 정합니다. 카드를 끌어 옮기거나 단계를 고르면 그 단계로 두고, 새 근거가 생기면 다시 자동으로 따라갑니다. 종결 칸은 최근 ${PH_DONE_DAYS}일 완료 건입니다.</span></p>
    <div class="board" role="list">${PHASES.map(([k, label]) => `<section class="bd-col" data-bd-col="${k}" role="listitem"><header><h4>${label}</h4><span class="cnt">${by[k].length}</span></header>
      <div class="bd-list">${by[k].length ? by[k].map(boardCardHTML).join('') : '<p class="hint bd-empty">없음</p>'}</div></section>`).join('')}</div>`;
}

/* ---------- 회신 대기 (11/11 d): 우리가 보낸 메일에 상대 답이 아직 없는 대화 ----------
   customs@가 참조된 대화(최근 21일) 중 마지막 메일이 우리 직원이 외부로 보낸 것이고, 우리가 쓴 부분에 요청·확인 부탁이 있을 때:
   제목 맨 앞에 직원이 붙인 [확인요청]·[DO요청] 같은 머리말, 또는 본문에서 서명('감사합니다'·회사명) 앞까지의 글.
   제목 뒤쪽의 '…요청'은 상대가 처음 보낸 제목이라 보지 않는다. 필증 송부·청구서·정산서 메일, 완료된 기록의 대화는 뺀다.
   '해결됨'을 누르면 그 대화에 새 메일이 올 때까지 뺀다(db.waitDone). */
const WAIT_ASK = /요청|부탁|확인\s*(바랍|요망|주시|해\s*주)|회신|답변|보내\s*주|송부\s*(해\s*주|바랍)|전달\s*(해\s*주|바랍)|주시기\s*바랍|주시면|알려\s*주|please|kindly|advise|confirm|let\s+us\s+know/i;
const WAIT_CLOSING = /(잘|늘|항상|앞으로도|계속)\s*(좀\s*)?부탁|참고\s*(부탁|바랍)/g;
const WAIT_SUBJ = /^\s*\[[^\]]*(요청|부탁|회신)[^\]]*\]/;   // [확인요청]·[DO요청]·[견적요청]. [확인안내]는 알림이라 제외
const WAIT_SIGN = /감사합니다|감사드립니다|BSGC\s*Customs|best\s*regards|thank\s*you/i;
function ownPart(snippet){
  const t = String(snippet || '').replace(/^.*?(입니다|입니다\.)\s*/, '').slice(0, 400);   // '안녕하세요 BSGC ○○○ 입니다' 인사 다음부터
  const m = WAIT_SIGN.exec(t);
  return (m ? t.slice(0, m.index) : t).replace(WAIT_CLOSING, ' ');
}
function waitList(){
  if(!mailCache) return [];
  const done = db.waitDone || {}, cut = addPeriod(today(), -21, 'd');
  return threadsOf(mailCache.filter(m => String(m.date).slice(0, 10) >= cut)).map(t => {
    const last = t.last;
    if(!isOwn(last.from) || last.fwdFrom) return null;
    const ext = String([last.to, last.cc].join(' ')).toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || [];
    if(!ext.some(a => !isOwn(a))) return null;                                   // 우리끼리 주고받은 메일
    if(certMail(last) || billMail(last) || SETTLE_RE.test(last.subject || '')) return null;
    if(!WAIT_SUBJ.test(last.subject || '') && !WAIT_ASK.test(ownPart(last.snippet))) return null;
    if(done[t.key] === last.id) return null;
    const rec = mailRecord(last);
    if(rec && rec.status === '완료') return null;
    return {t, last, days:Math.floor(hoursSince(last.date) / 24), rec, client:rec ? db.clients.find(c => c.id === rec.clientId) : threadClient(t)};
  }).filter(Boolean).sort((a, b) => b.days - a.days);
}
function waitSummary(){
  const w = waitList();
  return {n:w.length, d3:w.filter(x => x.days >= 3).length, d7:w.filter(x => x.days >= 7).length};
}
function openWaitList(){
  if(!mailCache){ toast('메일을 먼저 불러오는 중입니다. 잠시 뒤 다시 누르세요.'); loadMail(false); return; }
  const list = waitList();
  const to1 = m => { const x = String(m.to || '').split(',').find(a => !isOwn(a)) || ''; return x.replace(/<.*>/, '').replace(/"/g, '').trim() || x; };
  const row = (x, i) => `<tr><td class="num${x.days >= 7 ? ' bad' : ''}">${x.days}일</td><td>${esc(x.client ? x.client.name : '-')}</td>
    <td>${esc(x.last.subject || '')}<div class="hint">${esc(x.last.fromName || x.last.from)} → ${esc(to1(x.last))} · ${esc(String(x.last.date).slice(5, 16).replace('T', ' '))}${x.rec ? ` · ${esc(x.rec.caseNo || '')} ${esc(x.rec.title || '')}` : ''}</div></td>
    <td><button type="button" class="mini" data-x-wait-done="${i}" title="답을 받았거나 더 기다릴 필요가 없으면 목록에서 뺍니다(새 메일이 오가면 다시 판단)">해결됨</button></td></tr>`;
  openDialog({title:`회신 대기 ${list.length}건`, saveLabel:'닫기',
    body:`<p class="hint">최근 21일 customs@ 대화 중 <strong>우리가 마지막으로 보낸 요청·확인 부탁 메일에 아직 답이 없는 것</strong>입니다(필증 송부·청구서·정산서 제외). 오래된 순서입니다.</p>
      ${list.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th class="num">경과</th><th>업체</th><th>마지막으로 보낸 메일</th><th></th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>` : '<p class="empty">기다리는 회신이 없습니다.</p>'}`,
    onSave(){ return true; },
    onOpen(f){
      f.addEventListener('click', e => {
        const b = e.target.closest('[data-x-wait-done]'); if(!b) return;
        const x = list[Number(b.dataset.xWaitDone)]; if(!x) return;
        db.waitDone = {...(db.waitDone || {}), [x.t.key]:x.last.id};
        b.closest('tr').style.opacity = .4; b.closest('td').innerHTML = '<span class="hint">해결됨</span>'; commit();
      });
    }});
}

/* ---------- 업체 업무 처리 내역서 (11/11 d): 업체·기간을 골라 PDF(인쇄)·메일 본문 표로 ----------
   내부 메모(특이 처리 내용·요약)는 넣지 않는다. 진행 상태는 보드 단계와 같고, 완료 건은 완료일. */
function reportRows(cid, from, to, withOpen, withDone){
  return db.records.filter(r => r.clientId === cid && !isUpdateRec(r)).filter(r => {
    if(r.status === '완료') return withDone && (r.date || '') >= from && (r.date || '') <= to;
    return withOpen && (r.startDate || '') <= to;
  }).sort((a, b) => (a.startDate || '').localeCompare(b.startDate || '') || (a.caseNo || '').localeCompare(b.caseNo || ''));
}
function reportStatus(r){
  if(r.status === '완료') return `완료 ${r.date || ''}`;
  const st = stageOf(r), ph = recPhase(r).k;
  const bits = [r.status === '보류' ? '보류' : phaseLabel(ph)];
  if(st.accept) bits.push(`수리 ${st.accept}`);
  if(st.customs) bits.push(`${stageName(r, 'customs')} ${st.customs}`);
  return bits.join(' · ');
}
function reportNext(r){
  const d = (r.deadlines || []).filter(x => !x.done).sort((a, b) => a.due.localeCompare(b.due))[0];
  return r.status === '완료' ? '' : d ? `${d.kind} ${d.due}` : '';
}
function openClientReport(cid){
  const c = db.clients.find(x => x.id === cid); if(!c) return;
  const ws = weekStart();
  openDialog({title:`${c.name} 업무 처리 내역서`, saveLabel:'PDF·인쇄',
    body:`<div class="row2"><label>시작일<input type="date" name="from" value="${esc(ws)}"></label><label>종료일<input type="date" name="to" value="${esc(today())}"></label></div>
      <div class="chips"><button type="button" class="chip" data-x-rp="w0">이번 주</button><button type="button" class="chip" data-x-rp="w1">지난주</button><button type="button" class="chip" data-x-rp="m0">이번 달</button><button type="button" class="chip" data-x-rp="m1">지난달</button></div>
      <label class="inline"><input type="checkbox" name="open" checked> 진행 중인 업무 포함(기간 끝까지 접수된 건)</label>
      <label class="inline"><input type="checkbox" name="done" checked> 기간 안에 완료한 업무 포함</label>
      <p class="hint" id="rpCount"></p>
      <p class="hint">내부 메모(특이 처리 내용·요약)는 넣지 않습니다. 메일로 보낼 때는 ‘메일 본문 복사’ 후 한비로 메일에 붙여 넣으세요.</p>
      <button type="button" class="ghost" data-x-rp-copy>메일 본문 복사</button>`,
    onSave(fd){
      const rows = reportRows(cid, fd.get('from'), fd.get('to'), !!fd.get('open'), !!fd.get('done'));
      if(!rows.length){ toast('이 기간에 해당하는 업무가 없습니다.'); return false; }
      reportPrint(c, fd.get('from'), fd.get('to'), rows);
      return false;
    },
    onOpen(f){
      const N = n => f.elements.namedItem(n);
      const upd = () => { const rows = reportRows(cid, N('from').value, N('to').value, N('open').checked, N('done').checked); $('#rpCount').textContent = `해당 업무 ${rows.length}건 (완료 ${rows.filter(r => r.status === '완료').length}, 진행 중 ${rows.filter(r => r.status !== '완료').length})`; };
      f.addEventListener('input', upd); f.addEventListener('change', upd); upd();
      f.addEventListener('click', e => {
        const p = e.target.closest('[data-x-rp]');
        if(p){
          const k = p.dataset.xRp, t = today();
          if(k === 'w0'){ N('from').value = weekStart(); N('to').value = t; }
          if(k === 'w1'){ const s = addPeriod(weekStart(), -7, 'd'); N('from').value = s; N('to').value = addPeriod(s, 6, 'd'); }
          if(k === 'm0'){ N('from').value = t.slice(0, 8) + '01'; N('to').value = t; }
          if(k === 'm1'){ const s = addPeriod(t.slice(0, 8) + '01', -1, 'm'); N('from').value = s; N('to').value = addPeriod(t.slice(0, 8) + '01', -1, 'd'); }
          upd(); return;
        }
        if(e.target.closest('[data-x-rp-copy]')){
          const rows = reportRows(cid, N('from').value, N('to').value, N('open').checked, N('done').checked);
          if(!rows.length){ toast('이 기간에 해당하는 업무가 없습니다.'); return; }
          reportCopy(c, N('from').value, N('to').value, rows);
        }
      });
    }});
}
function reportTable(rows, inline){
  const th = inline ? ' style="background:#E8EEF4"' : '';
  return `<table${inline ? ' border="1" cellpadding="4" style="border-collapse:collapse;font-size:12px"' : ''}><thead><tr${th}><th>No</th><th>케이스</th><th>접수일</th><th>업무</th><th>B/L · 신고번호</th><th>내용</th><th>진행 상태</th><th>다음 기한</th></tr></thead><tbody>${rows.map((r, i) =>
    `<tr><td class="c">${i + 1}</td><td class="c">${esc(r.caseNo || '')}</td><td class="c">${esc(r.startDate || '')}</td><td>${esc(r.type || '')}</td><td>${esc([r.bl, r.refNo].filter(Boolean).join(' / '))}</td><td>${esc(r.title || '')}</td><td>${esc(reportStatus(r))}</td><td>${esc(reportNext(r))}</td></tr>`).join('')}</tbody></table>`;
}
function reportPrint(c, from, to, rows){
  const co = (typeof qset === 'function' ? qset().company : null) || {name:'BSGC Customs Networks'};
  const w = window.open('', '_blank'); if(!w){ toast('팝업이 막혀 있습니다. 이 사이트의 팝업을 허용하세요.'); return; }
  const base = location.href.replace(/[^/]*$/, ''), nDone = rows.filter(r => r.status === '완료').length;
  w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><base href="${esc(base)}"><title>${esc(c.name)} 업무 처리 내역서 ${esc(from)}~${esc(to)}</title><style>
    @page{size:A4 landscape;margin:12mm} body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#111;font-size:11px;margin:0}
    .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1E4E79;padding-bottom:8px} .top img{height:42px} h1{font-size:21px;letter-spacing:6px;margin:6px 0 0;color:#1E4E79}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0} .box{border:1px solid #bbb;padding:7px 10px;line-height:1.7} .box b{display:inline-block;width:56px;color:#444}
    table{width:100%;border-collapse:collapse} th,td{border:1px solid #999;padding:4px 5px;vertical-align:top} th{background:#E8EEF4} .c{text-align:center;white-space:nowrap}
    .foot{margin-top:18px;text-align:right;line-height:1.7} @media print{.noprint{display:none}}</style></head><body>
    <div class="noprint" style="padding:8px;background:#FFF8E1;font-size:12px">인쇄 창에서 ‘PDF로 저장’을 고르면 PDF로 저장됩니다. <button onclick="print()">인쇄</button></div>
    <div class="top"><div><img src="logo.png" alt="" onerror="this.remove()"><h1>업무 처리 내역서</h1></div><div style="text-align:right;line-height:1.7"><div>기간 <b>${esc(from)} ~ ${esc(to)}</b></div><div>작성일 ${esc(today())}</div></div></div>
    <div class="meta"><div class="box"><div><b>수 신</b>${esc(c.name)} 귀중</div><div><b>건 수</b>완료 ${nDone}건 · 진행 중 ${rows.length - nDone}건</div></div>
      <div class="box"><div><b>발 신</b>${esc(co.name || '')}</div>${co.tel || co.email ? `<div><b>연락처</b>${esc([co.tel && 'T. ' + co.tel, co.email].filter(Boolean).join('  '))}</div>` : ''}</div></div>
    ${reportTable(rows, false)}
    <div class="foot">${esc(co.name || '')}</div>
    <script>window.onload=()=>setTimeout(()=>print(),400)<\/script></body></html>`);
  w.document.close();
}
function reportCopy(c, from, to, rows){
  const nDone = rows.filter(r => r.status === '완료').length;
  const intro = `${c.name} 업무 처리 내역 (${from} ~ ${to}) — 완료 ${nDone}건, 진행 중 ${rows.length - nDone}건`;
  const html = `<p>${esc(intro)}</p>${reportTable(rows, true)}`;
  const txt = intro + '\n' + rows.map((r, i) => [i + 1, r.caseNo, r.startDate, r.type, [r.bl, r.refNo].filter(Boolean).join(' / '), r.title, reportStatus(r), reportNext(r)].join('\t')).join('\n');
  try{ navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html], {type:'text/html'}), 'text/plain':new Blob([txt], {type:'text/plain'})})]).then(() => toast('메일에 붙여 넣을 표를 복사했습니다.'), () => { navigator.clipboard.writeText(txt); toast('표를 글자로 복사했습니다.'); }); }
  catch{ navigator.clipboard.writeText(txt); toast('표를 글자로 복사했습니다.'); }
}

/* 업체 화면의 세관 질의 이력 (11/11 d): 업체로 지정했거나 그 업체 기록에 연결한 질의 */
function clientInqSection(c){
  const rids = new Set(db.records.filter(r => r.clientId === c.id).map(r => r.id));
  const qs = (db.inquiries || []).filter(q => q.clientId === c.id || (q.recId && rids.has(q.recId))).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if(!qs.length) return '';
  return `<section class="inq-client"><div class="sec-head"><h3>세관 질의 이력 <span class="cnt">${qs.length}건</span></h3></div>
    <div class="card-grid">${qs.slice(0, 2).map(inquiryHTML).join('')}</div>
    ${qs.length > 2 ? `<details class="more fold"><summary>나머지 ${qs.length - 2}건 펼치기</summary><div class="card-grid">${qs.slice(2).map(inquiryHTML).join('')}</div></details>` : ''}</section>`;
}

/* ---------- 이벤트 (보드·회신 대기·내역서) ---------- */
let bdDrag = '';
document.addEventListener('click', e => {
  if(!db || e.target.closest('dialog')) return;
  const w = e.target.closest('[data-wait-list]'); if(w){ openWaitList(); return; }
  const rp = e.target.closest('[data-client-report]'); if(rp){ openClientReport(rp.dataset.clientReport); return; }
});
document.addEventListener('change', e => {
  const s = e.target.closest && e.target.closest('[data-bd-phase]'); if(!s || !db) return;
  const r = db.records.find(x => x.id === s.dataset.bdPhase); if(r) setPhase(r, s.value);
});
document.addEventListener('dragstart', e => { const c = e.target.closest && e.target.closest('[data-bd-id]'); if(!c) return; bdDrag = c.dataset.bdId; e.dataTransfer.effectAllowed = 'move'; try{ e.dataTransfer.setData('text/plain', bdDrag); }catch{} c.classList.add('dragging'); });
document.addEventListener('dragend', e => { const c = e.target.closest && e.target.closest('[data-bd-id]'); if(c) c.classList.remove('dragging'); document.querySelectorAll('.bd-col.over').forEach(x => x.classList.remove('over')); });
document.addEventListener('dragover', e => { const col = e.target.closest && e.target.closest('[data-bd-col]'); if(!col || !bdDrag || col.dataset.bdCol === 'done') return; e.preventDefault(); document.querySelectorAll('.bd-col.over').forEach(x => x !== col && x.classList.remove('over')); col.classList.add('over'); });
document.addEventListener('drop', e => {
  const col = e.target.closest && e.target.closest('[data-bd-col]'); if(!col || !bdDrag || !db) return;
  e.preventDefault(); col.classList.remove('over');
  const r = db.records.find(x => x.id === bdDrag); bdDrag = '';
  if(r && col.dataset.bdCol !== 'done' && recPhase(r).k !== col.dataset.bdCol) setPhase(r, col.dataset.bdCol);
});
