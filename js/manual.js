'use strict';
/* ---------- 업무 매뉴얼(절차서) 자동 갱신 (G2) ----------
   - 완료된 기록을 절차와 비교해 '개정 제안'을 쌓는다: 추가된 단계, 건너뛴 단계, 새 필요 서류, 특이 처리 내용.
   - 관리자가 매뉴얼 화면에서 항목을 골라 반영하면 절차가 바뀌고 개정 이력이 남는다.
   - 절차가 없는 업체×업무유형은 완료 기록에서 자주 나온 단계로 초안을 만든다.
   - 매뉴얼마다 실제 처리 통계(건수, 평균 소요일, 자주 받은 서류, 특이 사례)와 근거 법령·최종 검토일을 보여 준다. */
const normStep = s => String(s || '').replace(/^\[점검\]\s*/, '').replace(/\s*\(필요 시\)$/, '').replace(/\s+/g, ' ').trim();
const stepKey = s => normStep(s).replace(/[\s.,·()\-]/g, '').toLowerCase();
function procFor(r){
  return db.procedures.find(p => p.id === r.procId)
    || db.procedures.find(p => p.clientId === r.clientId && p.type === r.type)
    || db.procedures.find(p => !p.clientId && p.type === r.type) || null;
}
function procRecords(p){
  return db.records.filter(r => r.status === '완료' && r.type === p.type && (r.procId === p.id || (!r.procId && (procFor(r) || {}).id === p.id)));
}
function proposeFromRecord(r){
  db.procProposals = db.procProposals || [];
  if(db.procProposals.some(x => x.recId === r.id)) return null;
  const p = procFor(r);
  const steps = (r.checklist || []).filter(x => !/^\[점검\]/.test(x.text));
  const pp = {id:uid(), recId:r.id, caseNo:r.caseNo || '', clientId:r.clientId, type:r.type, procId:p ? p.id : null, at:nowIso(), by:me ? me.id : 'auto', status:'pending', add:[], skip:[], docs:[], caution:''};
  if(p){
    const pk = new Set((p.steps || []).map(stepKey)), rk = new Set(steps.map(x => stepKey(x.text)));
    pp.add = steps.filter(x => !pk.has(stepKey(x.text))).map(x => normStep(x.text));
    pp.skip = (p.steps || []).filter(s => rk.has(stepKey(s)) && steps.some(x => stepKey(x.text) === stepKey(s) && !x.done) && !/\(필요 시\)$/.test(s)).map(normStep);
    const pd = new Set(splitDocs(p.docs).map(stepKey));
    pp.docs = (r.docs || []).map(x => normStep(x.text)).filter(t => t && !pd.has(stepKey(t)));
  } else {
    pp.add = steps.map(x => normStep(x.text));
    pp.docs = (r.docs || []).map(x => normStep(x.text));
  }
  if(r.special && r.specialNote && !(r.reflected || []).length) pp.caution = r.specialNote.trim();
  if(!pp.add.length && !pp.skip.length && !pp.docs.length && !pp.caution) return null;
  if(!p && !pp.add.length) return null;                                  // 절차도 없고 단계도 없으면 만들 게 없음
  db.procProposals.push(pp);
  if(db.procProposals.length > 300) db.procProposals = db.procProposals.filter(x => x.status === 'pending').slice(-300);
  return pp;
}
function applyProposal(pp, pick){
  const r = db.records.find(x => x.id === pp.recId);
  const tag = `${today()}${pp.caseNo ? ' ' + pp.caseNo : ''}`;
  let p = pp.procId ? db.procedures.find(x => x.id === pp.procId) : null;
  const changes = [];
  if(!p){
    p = {id:uid(), clientId:pp.clientId || null, type:pp.type, title:`${clientName(pp.clientId)} ${pp.type} 절차`, steps:[], docs:'', cautions:'', createdAt:nowIso()};
    db.procedures.push(p); changes.push('완료 기록으로 새 절차 작성');
  }
  const add = pp.add.filter((_, i) => pick.add[i]), skip = pp.skip.filter((_, i) => pick.skip[i]), docs = pp.docs.filter((_, i) => pick.docs[i]);
  if(add.length){                                                         // 기록에서의 위치를 살려, 바로 앞 단계 뒤에 끼워 넣는다
    const steps = [...(p.steps || [])], rsteps = r ? (r.checklist || []).map(x => normStep(x.text)) : [];
    add.filter(s => !steps.some(x => stepKey(x) === stepKey(s))).forEach(s => {
      const i = rsteps.findIndex(x => stepKey(x) === stepKey(s));
      let at = steps.length;
      for(let j = i - 1; j >= 0; j--){ const k = steps.findIndex(x => stepKey(x) === stepKey(rsteps[j])); if(k >= 0){ at = k + 1; break; } }
      steps.splice(at, 0, s);
    });
    p.steps = steps; changes.push(`단계 추가: ${add.join(', ')}`);
  }
  if(skip.length){ p.steps = (p.steps || []).map(s => skip.some(k => stepKey(k) === stepKey(s)) && !/\(필요 시\)$/.test(s) ? s + ' (필요 시)' : s); changes.push(`필요 시 단계로 변경: ${skip.join(', ')}`); }
  if(docs.length){ p.docs = [...splitDocs(p.docs), ...docs].filter((v, i, a) => a.findIndex(x => stepKey(x) === stepKey(v)) === i).join(', '); changes.push(`필요 서류 추가: ${docs.join(', ')}`); }
  if(pp.caution && pick.caution){ p.cautions = (p.cautions ? p.cautions + '\n' : '') + `[${tag}] ${pp.caution}`; changes.push('특이 사례를 주의사항에 추가'); if(r){ r.reflected = [...(r.reflected || []), {procId:p.id, at:today()}]; } }
  if(!changes.length) return false;
  p.history = [...(p.history || []), {at:nowIso(), by:me ? me.id : '', from:pp.caseNo || '', text:changes.join(' / ')}].slice(-50);
  p.updatedAt = nowIso();
  pp.status = 'applied'; pp.doneAt = nowIso();
  return true;
}
/* 절차가 없는 업체×업무유형: 완료 기록의 체크리스트에서 절반 이상 나온 단계로 초안 */
function draftFromRecords(clientId, type){
  const recs = db.records.filter(r => r.status === '완료' && r.clientId === clientId && r.type === type && (r.checklist || []).length);
  const cnt = new Map(), order = new Map();
  recs.forEach(r => r.checklist.forEach((x, i) => { const k = stepKey(x.text); if(!k || /^\[점검\]/.test(x.text)) return; cnt.set(k, (cnt.get(k) || 0) + 1); if(!order.has(k)) order.set(k, [i, normStep(x.text)]); }));
  const steps = [...cnt.entries()].filter(([, n]) => n >= Math.max(1, Math.ceil(recs.length / 2))).sort((a, b) => order.get(a[0])[0] - order.get(b[0])[0]).map(([k]) => order.get(k)[1]);
  return {steps, n:recs.length};
}

/* ---------- 통계 ---------- */
const dayDiff = (a, b) => (a && b) ? Math.round((Date.parse(b) - Date.parse(a)) / 864e5) : null;
function procStats(p){
  const recs = procRecords(p);
  const days = recs.map(r => dayDiff(r.startDate, r.date)).filter(x => x !== null && x >= 0);
  const toCustoms = recs.map(r => dayDiff(r.startDate, (r.stage || {}).customs)).filter(x => x !== null && x >= 0);
  const docCnt = {};
  recs.forEach(r => { const ts = new Set(); recFiles(r).forEach(f => docTypes(f.name).forEach(t => ts.add(t))); ts.forEach(t => docCnt[t] = (docCnt[t] || 0) + 1); });
  const docs = Object.entries(docCnt).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${Math.round(n / recs.length * 100)}%`);
  const sp = recs.filter(r => r.special).sort(byDateDesc);
  const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-';
  return {n:recs.length, avg:avg(days), avgCustoms:avg(toCustoms), last:recs.map(r => r.date).sort().slice(-1)[0] || '', docs, sp, spRate:recs.length ? Math.round(sp.length / recs.length * 100) : 0};
}

/* ---------- 화면 ---------- */
let manualQ = '';
function proposalHTML(pp){
  const p = pp.procId ? db.procedures.find(x => x.id === pp.procId) : null, r = db.records.find(x => x.id === pp.recId);
  const box = (k, i, t) => `<label class="check"><input type="checkbox" data-pp-pick="${k}|${i}" checked> ${esc(t)}</label>`;
  return `<article class="pp" data-pp="${esc(pp.id)}">
    <div class="pp-head"><strong>${esc(p ? p.title : `새 절차: ${clientName(pp.clientId)} ${pp.type}`)}</strong> <span class="hint">${esc(pp.caseNo)} ${r ? esc(r.title) : ''} · ${esc(pp.at.slice(0, 10))}</span></div>
    ${pp.add.length ? `<div class="pp-sec"><span class="lbl">추가된 단계</span>${pp.add.map((t, i) => box('add', i, t)).join('')}</div>` : ''}
    ${pp.skip.length ? `<div class="pp-sec"><span class="lbl">이번에 하지 않은 단계 → '필요 시'로 표시</span>${pp.skip.map((t, i) => box('skip', i, t)).join('')}</div>` : ''}
    ${pp.docs.length ? `<div class="pp-sec"><span class="lbl">새 필요 서류</span>${pp.docs.map((t, i) => box('docs', i, t)).join('')}</div>` : ''}
    ${pp.caution ? `<div class="pp-sec"><span class="lbl">특이 처리 → 주의사항</span>${box('caution', 0, pp.caution.length > 160 ? pp.caution.slice(0, 160) + '…' : pp.caution)}</div>` : ''}
    <div class="btn-row"><button class="mini strong" data-pp-apply="${esc(pp.id)}">고른 항목 반영</button><button class="mini" data-pp-drop="${esc(pp.id)}">무시</button></div>
  </article>`;
}
function manualHTML(p){
  const s = procStats(p);
  const reviewOld = !p.reviewedAt || daysLeft(p.reviewedAt) < -365;
  return `<section class="manual" data-man="${esc(p.id)}">
    <header><span class="tag type">${esc(p.type)}</span><h4>${esc(p.title)}</h4><span class="note">${p.clientId ? esc(clientName(p.clientId)) : '공통'}</span>
      <span class="p-act"><button class="mini" data-man-print="${esc(p.id)}">인쇄</button><button class="mini" data-edit-proc="${esc(p.id)}">수정</button></span></header>
    <p class="man-stat">완료 ${s.n}건${s.n ? ` · 평균 소요 ${s.avg}일${s.avgCustoms !== '-' ? ` (통관완료까지 ${s.avgCustoms}일)` : ''} · 특이 ${s.spRate}% · 최근 ${esc(s.last)}` : ' · 아직 이 절차로 완료한 기록이 없습니다'}</p>
    ${(p.steps || []).length ? `<ol>${p.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : '<p class="hint">단계가 없습니다.</p>'}
    <div class="man-grid">
      <div><span class="lbl">필요 서류</span>${esc(p.docs || '-')}${s.docs.length ? `<div class="hint">실제로 받은 서류: ${esc(s.docs.slice(0, 6).join(', '))}</div>` : ''}</div>
      <div><span class="lbl">근거 법령</span>${p.laws ? lawLinesHTML(p) : '<span class="hint">미입력</span>'}<div class="hint${reviewOld ? ' bad' : ''}">최종 검토 ${esc(p.reviewedAt || '없음')} <button class="mini" data-man-review="${esc(p.id)}">오늘 검토함</button></div></div>
    </div>
    ${p.cautions ? `<div class="proc-caution"><strong>주의</strong><p class="pre">${esc(p.cautions)}</p></div>` : ''}
    ${s.sp.length ? `<details><summary>특이 사례 ${s.sp.length}건</summary><ul>${s.sp.slice(0, 10).map(r => `<li><button class="linkish" data-edit-rec="${esc(r.id)}">${esc(r.caseNo || '')} ${esc(r.title)}</button> <span class="hint">${esc(r.date || '')}${causesOf(r).length ? ' · ' + esc(causesOf(r).join(', ')) : ''}</span>${r.specialNote ? `<div class="hint">${esc(r.specialNote.slice(0, 140))}</div>` : ''}</li>`).join('')}</ul></details>` : ''}
    ${(p.history || []).length ? `<details><summary>개정 이력 ${p.history.length}건</summary><ul>${p.history.slice().reverse().slice(0, 10).map(h => `<li><span class="hint">${esc(h.at.slice(0, 10))} ${esc(accountName(h.by))}${h.from ? ' · ' + esc(h.from) : ''}</span> ${esc(h.text)}</li>`).join('')}</ul></details>` : ''}
  </section>`;
}
function viewManual(){
  const pend = (db.procProposals || []).filter(x => x.status === 'pending');
  const q = manualQ.trim().toLowerCase();
  const ps = db.procedures.filter(p => !q || hay(p.title, p.type, clientName(p.clientId), p.steps, p.docs, p.cautions, p.laws).includes(q))
    .sort((a, b) => (!!a.clientId - !!b.clientId) || typeOrder(a.type) - typeOrder(b.type) || clientName(a.clientId).localeCompare(clientName(b.clientId)));
  // 절차 없는 업체×유형 중 완료 기록 2건 이상
  const combos = {};
  db.records.filter(r => r.status === '완료' && !procFor(r)).forEach(r => { const k = r.clientId + '|' + r.type; combos[k] = (combos[k] || 0) + 1; });
  const missing = Object.entries(combos).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 15);
  return `<header class="client-head"><div><h2>업무 매뉴얼</h2><p class="client-meta">절차마다 실제 처리 통계와 특이 사례, 근거 법령을 모았습니다. 업무를 완료하면 절차와 달랐던 점이 아래 '개정 제안'으로 쌓이고, 고른 항목만 반영됩니다.</p></div>
      <div class="client-act"><input type="search" id="manQ" value="${esc(manualQ)}" placeholder="절차·업체·법령 검색"><button class="ghost" data-law-check title="국가법령정보로 근거 법령의 공포·시행일을 확인 (7일마다 자동)">법령 시행일 확인</button><button class="primary" data-new-proc>절차 추가</button></div></header>
    <p class="hint">법령 확인 ${esc(db.settings.lawCheckedAt ? db.settings.lawCheckedAt.slice(0, 10) : '아직 없음')} · 근거 법령은 한 줄에 ‘법령명 제00조’ 형식으로 적고, 고시는 정식 명칭으로 적어야 찾아집니다.</p>
    ${pend.length ? `<section class="pps"><div class="sec-head"><h3>개정 제안 ${pend.length}건</h3></div>${pend.slice().reverse().map(proposalHTML).join('')}</section>` : ''}
    ${missing.length ? `<section class="pps"><div class="sec-head"><h3>절차서가 없는 업무</h3></div><ul>${missing.map(([k, n]) => { const [cid, ty] = k.split('|'); return `<li>${esc(clientName(cid))} · ${esc(ty)} <span class="hint">완료 ${n}건</span> <button class="mini" data-man-draft="${esc(k)}">완료 기록으로 초안 만들기</button></li>`; }).join('')}</ul></section>` : ''}
    <div class="narrow">${ps.length ? ps.map(manualHTML).join('') : '<p class="empty">절차가 없습니다.</p>'}</div>`;
}
function readPick(id){
  const pick = {add:{}, skip:{}, docs:{}, caution:false};
  document.querySelectorAll(`[data-pp="${CSS.escape(id)}"] [data-pp-pick]`).forEach(el => { const [k, i] = el.dataset.ppPick.split('|'); if(k === 'caution') pick.caution = el.checked; else pick[k][i] = el.checked; });
  return pick;
}
function printManual(p){
  const s = procStats(p), w = window.open('', '_blank');
  if(!w){ toast('팝업이 막혀 있습니다. 이 사이트의 팝업을 허용하세요.'); return; }
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(p.title)}</title><style>body{font-family:sans-serif;margin:24mm 18mm;line-height:1.6;font-size:11pt}h1{font-size:16pt;margin:0 0 4pt}.m{color:#555;font-size:9.5pt}h2{font-size:12pt;margin:14pt 0 4pt;border-bottom:1px solid #999}pre{white-space:pre-wrap;font-family:inherit;margin:0}</style>
    <h1>${esc(p.title)}</h1><div class="m">${esc(p.type)} · ${p.clientId ? esc(clientName(p.clientId)) : '공통'} · 최종 수정 ${esc((p.updatedAt || '').slice(0, 10))} · 법령 검토 ${esc(p.reviewedAt || '없음')} · 완료 ${s.n}건, 평균 ${s.avg}일</div>
    <h2>처리 단계</h2><ol>${(p.steps || []).map(x => `<li>${esc(x)}</li>`).join('')}</ol>
    <h2>필요 서류</h2><p>${esc(p.docs || '-')}</p>
    ${p.laws ? `<h2>근거 법령</h2><pre>${esc(p.laws)}</pre>` : ''}
    ${p.cautions ? `<h2>주의사항</h2><pre>${esc(p.cautions)}</pre>` : ''}
    ${s.sp.length ? `<h2>특이 사례</h2><ul>${s.sp.slice(0, 10).map(r => `<li>${esc(r.date || '')} ${esc(r.caseNo || '')} ${esc(r.title)}${r.specialNote ? `<br><span class="m">${esc(r.specialNote.slice(0, 200))}</span>` : ''}</li>`).join('')}</ul>` : ''}`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}
