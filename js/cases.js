'use strict';
/* ---------- 케이스 번호 (C1) ----------
   연도-구분-일련번호. I 수입, E 수출, F FTA, R 환급, C 컨설팅·기타 자문, X 기타.
   번호가 없는 기록은 저장(commit)할 때 접수일 순서로 자동 부여한다. 한 번 붙은 번호는 유형을 바꿔도 그대로 둔다. */
const CASE_CODE = {'수입통관':'I', '요건확인·검역':'I', '화학물질':'I', '수출신고':'E', 'FTA원산지':'F', '관세환급':'R', 'AEO':'C', '품목분류':'C', '외환신고':'C'};
const CASE_RE = /\b(20\d{2})-([IEFRCX])-(\d{3,4})\b/;
function caseCode(type){ return CASE_CODE[type] || 'X'; }
function ensureCaseNos(d){
  const max = {};
  d.records.forEach(r => { const m = CASE_RE.exec(r.caseNo || ''); if(m){ const k = m[1] + '-' + m[2]; max[k] = Math.max(max[k] || 0, Number(m[3])); } });
  const todo = d.records.filter(r => !r.caseNo).sort((a, b) => (a.startDate || a.date || '').localeCompare(b.startDate || b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || ''));
  todo.forEach(r => {
    const y = (r.startDate || r.date || today()).slice(0, 4), k = y + '-' + caseCode(r.type);
    max[k] = (max[k] || 0) + 1;
    r.caseNo = `${k}-${String(max[k]).padStart(3, '0')}`;
  });
  return todo.length;
}
/* 두 PC가 같은 번호를 동시에 붙인 경우: 나중에 만든 기록의 번호를 비우고 다시 부여 */
function dedupeCaseNos(d){
  const seen = new Map();
  d.records.slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')).forEach(r => {
    if(!r.caseNo) return;
    if(seen.has(r.caseNo)) r.caseNo = ''; else seen.set(r.caseNo, r.id);
  });
  ensureCaseNos(d);
}
function caseTagHTML(r){
  return r.caseNo ? `<button class="case-no" data-copy-case="${esc(r.caseNo)}" title="눌러서 [${esc(r.caseNo)}] 복사 — 메일 제목에 넣으면 이 기록에 자동 연결됩니다">${hl(r.caseNo)}</button>` : '';
}

/* ---------- 담당자 ---------- */
function assigneeName(id){ const a = accounts.find(x => x.id === id); return a ? a.name : (id || ''); }

/* ---------- 서류 종류 판별과 누락 표시 (C2) ---------- */
const DOC_TYPES = [
  ['Invoice', /invoice|인보이스|(^|[^a-z])c\/?i([^a-z]|$)|commercial/i],
  ['Packing List', /packing|패킹|(^|[^a-z])p\/?l([^a-z]|$)/i],
  ['B/L', /(^|[^a-z])b\/?l([^a-z]|$)|선하증권|bill of lading|(^|[^a-z])awb([^a-z]|$)/i],
  ['원산지증명서', /원산지|(^|[^a-z])c\/?o([^a-z]|$)|certificate of origin|form\s?[ae]([^a-z]|$)/i],
  ['신고필증', /필증|면장|declaration/i],
  ['검역·검사', /검역|위생증명|phyto|health cert|검사성적|시험성적|분석/i],
  ['요건·확인서', /확인서|요건|msds|(^|[^a-z])sds([^a-z]|$)|(^|[^a-z])kc([^a-z]|$)|승인서|허가/i],
  ['정산서', /정산서|청구서|debit note/i]
];
const DEFAULT_DOCS = {'수입통관':['Invoice','Packing List','B/L'], '수출신고':['Invoice','Packing List']};
function docTypes(name){ const n = String(name || '').replace(/[_.-]+/g, ' '); return DOC_TYPES.filter(([, re]) => re.test(n)).map(t => t[0]); }   // CI_PL처럼 한 파일에 여러 서류가 든 경우
function docType(name){ return docTypes(name)[0] || ''; }
function recFiles(r){
  const fs = (r.files || []).map(f => ({...f, src:'drive'}));
  (r.mails || []).forEach(m => (m.files || []).forEach(n => fs.push({name:n, date:m.date, src:'mail'})));
  return fs;
}
function docStatus(r){
  const found = {};
  recFiles(r).forEach(f => docTypes(f.name).forEach(t => { if(!found[t] || (f.date || '') > (found[t].date || '')) found[t] = f; }));
  const req = (r.docs || []).length ? r.docs.map(x => ({label:x.text, type:docType(x.text) || x.text, done:x.done}))
    : (DEFAULT_DOCS[r.type] || []).map(t => ({label:t, type:t, done:false}));
  const list = req.map(x => ({...x, ok: x.done || !!found[x.type], file: found[x.type] || null}));
  const extra = Object.keys(found).filter(t => !list.some(x => x.type === t)).map(t => ({label:t, type:t, ok:true, file:found[t], extra:true}));
  return {list, extra};
}
function docsHTML(r){
  const {list, extra} = docStatus(r);
  if(!list.length && !extra.length) return '';
  const chip = x => `<span class="doc ${x.ok ? 'ok' : 'miss'}" title="${x.file ? esc(x.file.name) : (x.ok ? '체크리스트에서 확인함' : '아직 받지 않음')}">${x.ok ? '✓' : '✗'} ${esc(x.label)}</span>`;
  return `<div class="docs-row">${list.map(chip).join('')}${extra.map(chip).join('')}</div>`;
}
function filesHTML(r){
  const fs = (r.files || []).filter(f => f.name);
  if(!fs.length) return '';
  return `<details class="rec-mails"><summary>자료 ${fs.length}개</summary><ul>${fs.map(f => `<li>${safeUrl(f.link) ? `<a href="${esc(f.link)}" target="_blank" rel="noopener noreferrer">${hl(f.name)}</a>` : hl(f.name)} <span class="hint">${esc(f.date || '')}${docType(f.name) ? ' · ' + esc(docType(f.name)) : ''}</span></li>`).join('')}</ul></details>`;
}
function addFiles(r, items){
  r.files = r.files || [];
  let n = 0;
  items.forEach(x => { if(x.name && !r.files.some(f => f.id === x.id || (f.name === x.name && f.link === x.link))){ r.files.push({id:x.id || uid(), name:x.name, link:x.link || '', date:x.created || x.date || ''}); n++; } });
  return n;
}

/* ---------- 진행단계: 통관완료 → 정산완료 → 자동 완료 (G1) ----------
   r.stage = {customs:'YYYY-MM-DD', customsBy:'UNI-PASS…|메일|직접', settle:'YYYY-MM-DD', settleBy}
   수입: API001 수리 + (API049 납부 또는 반출신고) → 통관완료 (자동)
   수출: API002 수리일자 → 수리완료(stage.accept, 적재기한 등록) / 선적완료 → stage.customs('선적완료'로 표시) (자동)
   정산: customs@ 메일 제목에 '정산서' → 정산완료 (자동). 업체 정산 방식이 '월 정산'이면 통관완료만으로 완료.
   둘 다 되면 기록을 자동 완료하고(되돌리기 가능) r.autoDone에 근거를 남긴다. */
const SETTLE_RE = /정산서/;
const kDecl = s => String(s || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
function stageOf(r){ return r.stage || {}; }
const isExp = r => caseCode(r.type) === 'E';
function stageName(r, k){ return k === 'accept' ? '수리완료' : k === 'customs' ? (isExp(r) ? '선적완료' : '통관완료') : '정산완료'; }
/* 수출 적재기한: 수리일부터 30일(관세법 제251조). UNI-PASS 적재의무기한이 있으면 그 날짜를 쓴다 */
function setLoadDue(r, base, due){
  if(!base && !due) return;
  r.deadlines = r.deadlines || [];
  const d = r.deadlines.find(x => x.kind === '수출물품 적재기한');
  const val = due || addPeriod(base, 30, 'd');
  if(!d) r.deadlines.push({id:uid(), kind:'수출물품 적재기한', base:base || null, due:val, done:false, auto:true});
  else if(d.auto && due && d.due !== due) d.due = due;
}
function setStage(r, k, date, by){
  r.stage = r.stage || {};
  if(r.stage[k]) return false;
  r.stage[k] = String(date || today()).slice(0, 10); r.stage[k + 'By'] = by;
  addHist(r, `${stageName(r, k)} ${r.stage[k]} (${by})`);
  r.updatedAt = nowIso();
  return true;
}
function settleMode(r){ const c = db.clients.find(x => x.id === r.clientId); return (c && c.settleMode) || 'each'; }
function stageHTML(r){
  const st = stageOf(r), u = r.unipass || {}, out = [];
  const btn = (k, label) => `<button class="stg ok" data-unstage="${esc(r.id)}|${k}" title="${esc(st[k + 'By'] || '')} — 잘못 표시했으면 눌러서 취소">${label} ${esc(st[k].slice(5))}</button>`;
  if(isExp(r)){
    const ld = (r.deadlines || []).find(x => x.kind === '수출물품 적재기한');
    if(st.accept) out.push(btn('accept', '수리완료'));
    if(st.customs) out.push(btn('customs', '선적완료'));
    else if(st.accept || u.accepted) out.push(`<span class="stg">선적 전${ld && !ld.done ? ' · 적재기한 ' + esc(ld.due.slice(5)) : ''}</span>`);
  } else if(st.customs) out.push(btn('customs', '통관완료'));
  else if(u.cleared && !u.paid && !u.released) out.push('<span class="stg">수리 · 납부 확인 전</span>');
  if(st.settle) out.push(btn('settle', '정산완료'));
  if(u.mdfy) out.push(`<span class="stg">정정: ${esc(u.mdfy)}</span>`);
  if(u.req) out.push(`<span class="stg">요건: ${esc(u.req)}</span>`);
  if(u.reqRqst) out.push(`<span class="stg">요건신청: ${esc(u.reqRqst)}</span>`);
  if(u.ldp) out.push(`<span class="stg${u.ldp === '검사대상' ? ' warn' : ''}">적재지검사: ${esc(u.ldp)}</span>`);
  if(u.bond) out.push(`<span class="stg">담보해제: ${esc(u.bond)}</span>`);
  if(u.condTxt) out.push(`<span class="stg${r.cond && r.cond.zero ? ' ok' : ''}">${esc(u.condTxt)}</span>`);
  if(u.shedTxt && !u.released) out.push(`<span class="stg" title="${esc(u.shedNm || '')}">${esc(u.shedTxt)}</span>`);
  if(r.autoDone) out.push(`<span class="stg auto" title="${esc(r.autoDone.reason || '')}">자동 완료</span>`);
  return out.length ? `<span class="stages">${out.join('')}</span>` : '';
}
function stageActsHTML(r){
  if(r.status === '완료') return r.autoDone ? `<button class="mini" data-undo-auto="${esc(r.id)}">완료 되돌리기</button>` : '';
  const st = stageOf(r), b = [];
  if(isExp(r) && !st.accept && !st.customs) b.push(`<button class="mini" data-stage="${esc(r.id)}|accept">수리완료</button>`);
  if(!st.customs) b.push(`<button class="mini" data-stage="${esc(r.id)}|customs">${stageName(r, 'customs')}</button>`);
  if(!st.settle && settleMode(r) === 'each') b.push(`<button class="mini" data-stage="${esc(r.id)}|settle">정산완료</button>`);
  return b.join('');
}
function autoComplete(r, why){
  if(r.status === '완료' || r.autoDoneOff) return false;
  if(r.cond && r.cond.kind && !r.cond.zero) return false;            // 재수출·재수입 잔량 관리 건은 잔량이 0이 될 때까지 진행 중
  const st = stageOf(r);
  if(!st.customs || !(st.settle || settleMode(r) === 'monthly')) return false;
  r.status = '완료';
  r.date = [st.customs, st.settle].filter(Boolean).sort().slice(-1)[0];
  const reason = [`${stageName(r, 'customs')} ${st.customs} (${st.customsBy || ''})`, st.settle ? `정산완료 ${st.settle} (${st.settleBy || ''})` : '월 정산 업체'].join(', ');
  r.autoDone = {at:nowIso(), reason};
  addHist(r, '자동 완료: ' + reason);
  proposeFromRecord(r);
  if(!String(r.summary || '').trim()){
    const ck = (r.checklist || []);
    r.summary = `[자동 완료] ${reason}` + (ck.length ? '\n처리 단계\n' + ck.map(x => `${x.done ? '✓' : '–'} ${x.text}${x.doneAt ? ` (${x.doneAt})` : ''}`).join('\n') : '');
  }
  r.updatedAt = nowIso();
  return true;
}
/* 메일 기준 정산 판정 + 자동 완료. loadMail·refreshCustoms 뒤와 단계 버튼에서 부른다 */
function evalStages(){
  let n = 0, done = 0;
  db.records.filter(r => r.status !== '완료' && r.status !== '보류').forEach(r => {
    const m = (r.mails || []).filter(x => SETTLE_RE.test(x.subject || '')).slice(-1)[0];
    if(m && setStage(r, 'settle', m.date, `메일: ${m.subject}`)) n++;
    if(autoComplete(r)) done++;
  });
  return {n, done};
}
function unsetStage(r, k){
  if(!r.stage) return;
  delete r.stage[k]; delete r.stage[k + 'By'];
  addHist(r, `${stageName(r, k)} 표시 취소`);
  if(r.autoDone) undoAuto(r);
  r.updatedAt = nowIso();
}
function undoAuto(r){
  r.status = '진행중'; r.date = ''; r.autoDoneOff = true;
  addHist(r, '자동 완료 되돌림');
  if(String(r.summary || '').startsWith('[자동 완료]')) r.summary = '';
  delete r.autoDone; r.updatedAt = nowIso();
}

/* ---------- 제안 (자동으로 정하기 어려운 것만) ---------- */
const MAIL_HINTS = [
  {key:'mail-clear', re:/수리|필증|면허|면장 발급|cleared/i, not:/요청|신청|부탁|예정/, when:r => r.status !== '완료' && !stageOf(r).customs && !(isExp(r) && stageOf(r).accept), text:'수리·필증 관련 메일이 왔습니다', act:'customs', label:'통관완료로 표시'},
  {key:'mail-amend', re:/정정|보완|기각|반려/, when:r => !r.special, text:'정정·보완 관련 메일이 왔습니다', act:'special', label:'특이로 표시'},
  {key:'mail-insp', re:/검역.*(합격|완료|결과)|검사.*(완료|결과|합격)|합격/, when:r => (r.checklist || []).some(x => !x.done && /검역|검사/.test(x.text)), text:'검역·검사 결과 메일이 왔습니다', act:'check', label:'해당 단계 체크'}
];
function suggestions(r){
  if(r.status === '완료') return [];
  const off = new Set(r.sugOff || []), out = [];
  const recent = r.mails || [];
  MAIL_HINTS.forEach(h => {
    const m = recent.slice().reverse().find(x => h.re.test(x.subject || '') && !(h.not && h.not.test(x.subject || '')));
    const key = m ? `${h.key}:${m.id}` : '';
    const exA = h.act === 'customs' && isExp(r);                    // 수출은 수리·필증 메일 = 수리완료(선적은 UNI-PASS·직접)
    if(m && h.when(r) && !off.has(key)) out.push({key, text:`${h.text}: “${m.subject}” (${String(m.date).slice(5, 10)})`, act:exA ? 'accept' : h.act, label:exA ? '수리완료로 표시' : h.label, date:m.date});
  });
  const u = r.unipass || {};
  const k1 = 'up-req:' + (u.reqRqst || '');
  if(u.reqRqstDone && (r.checklist || []).some(x => !x.done && /검역|검사|요건/.test(x.text)) && !off.has(k1)) out.push({key:k1, text:`UNI-PASS 요건신청 처리: ${u.reqRqst}`, act:'check', label:'해당 단계 체크'});
  const k2 = 'up-zero:' + (u.condTxt || '');
  if(r.cond && r.cond.zero && !off.has(k2)) out.push({key:k2, text:`UNI-PASS 잔량 0 — ${u.condTxt}`, act:'complete', label:'완료 처리'});
  const k3 = 'up-ldp:' + (u.ldp || '');
  if(u.ldp === '검사대상' && !r.special && !off.has(k3)) out.push({key:k3, text:'수출 적재지 검사대상으로 지정됐습니다', act:'special', label:'특이로 표시'});
  return out;
}
function fmtDttm(s){ s = String(s || ''); return s.length >= 12 ? `${s.slice(4, 6)}/${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}` : s; }
function fmtYmd(s){ s = String(s || '').replace(/[^0-9]/g, ''); return s.length >= 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : ''; }
function suggestHTML(r){
  const ss = suggestions(r);
  if(!ss.length) return '';
  return `<div class="suggest">${ss.map(s => `<div><span class="sg-label">제안</span> ${esc(s.text)} <button class="mini strong" data-sug="${esc(r.id)}|${esc(s.key)}">${esc(s.label)}</button><button class="mini" data-sug-off="${esc(r.id)}|${esc(s.key)}">무시</button></div>`).join('')}</div>`;
}
function applySuggestion(r, key){
  const s = suggestions(r).find(x => x.key === key);
  if(!s) return;
  r.sugOff = [...new Set([...(r.sugOff || []), key])].slice(-50);
  if(s.act === 'special'){ r.special = true; openRecord(r); return; }
  if(s.act === 'complete'){ openRecord(r, {complete:true}); return; }
  if(s.act === 'customs'){ setStage(r, 'customs', s.date, '메일 확인(직접)'); autoComplete(r); }
  if(s.act === 'accept' && setStage(r, 'accept', s.date, '메일 확인(직접)')) setLoadDue(r, r.stage.accept);
  if(s.act === 'check'){ const i = (r.checklist || []).findIndex(x => !x.done && /검역|검사|요건/.test(x.text)); if(i >= 0){ r.checklist[i].done = true; r.checklist[i].doneAt = today(); } }
  r.updatedAt = nowIso(); commit(); toast('반영했습니다.');
}

/* ---------- UNI-PASS로 통관 단계 확인 (진행 중 수입·수출 건, 12시간마다, 한 번에 15건) ---------- */
async function uni(api, params){ return collectApi({uni:api, ...params}); }
const pick = (j, k) => { if(!j) return ''; if(j.info && j.info[k]) return j.info[k]; const it = (j.items || []).find(x => x[k]); return it ? it[k] : ''; };
async function checkImport(r, u){
  if(r.bl){
    let j = null;
    for(const blType of ['M', 'H']){
      try{ j = await collectApi({bl:r.bl, blType, year:(r.startDate || today()).slice(0, 4)}); if(j && (j.main || []).length) break; }
      catch(e){ j = {err:e.message}; if(/인증키|연결하지/.test(e.message)) break; }
    }
    if(j && !j.err && (j.main || []).length){
      const m = j.main[0], det = (j.details || []).slice().sort((a, b) => String(a.prcsDttm || '').localeCompare(String(b.prcsDttm || '')));
      const last = det[det.length - 1] || {};
      const all = det.map(x => x.cargTrcnRelaBsopTpcd || '').join(' ') + ' ' + (m.csclPrgsStts || '') + ' ' + (m.prgsStts || '');
      const dcl = det.slice().reverse().find(x => x.dclrNo && /수입신고/.test(x.cargTrcnRelaBsopTpcd || ''));
      Object.assign(u, {stts:m.prgsStts || '', cscl:m.csclPrgsStts || '', last:last.cargTrcnRelaBsopTpcd || '', lastAt:last.prcsDttm || m.prcsDttm || '',
        cleared:/수입신고수리|수리/.test(all), released:/반출신고/.test(all), dclrNo:dcl ? dcl.dclrNo : (u.dclrNo || '')});
      const rel = det.find(x => /반출신고/.test(x.cargTrcnRelaBsopTpcd || ''));
      if(rel) u.releasedAt = fmtYmd(rel.prcsDttm);
      const clr = det.find(x => /수입신고수리/.test(x.cargTrcnRelaBsopTpcd || ''));
      if(clr) u.clearedAt = fmtYmd(clr.prcsDttm);
      const inn = det.slice().reverse().find(x => x.shedSgn && /반입/.test(x.cargTrcnRelaBsopTpcd || ''));
      if(inn){ u.shedSgn = inn.shedSgn; u.shedNm = inn.shedNm || ''; u.shedIn = fmtYmd(inn.rlbrDttm || inn.prcsDttm); }
    } else if(j && j.err) u.err = j.err;
  }
  if(!r.refNo && u.dclrNo) r.refNo = u.dclrNo;                         // 신고번호는 관세청 값이므로 바로 넣음
  const decl = kDecl(r.refNo || u.dclrNo);
  if(decl && (u.cleared || !r.bl) && !u.paid){
    try{ const j = await uni('API049', {impDclrNo:decl}); if(pick(j, 'fpayYn') === 'Y'){ u.paid = true; u.paidAt = fmtYmd(pick(j, 'fpayDt')); } else if(pick(j, 'fpayYn')) u.paid = false; }
    catch(e){ u.err049 = e.message; }
  }
  if(u.shedSgn && u.shedIn && !u.released){                           // 장치기간 만료일을 기한에 자동 등록(반출되면 처리 표시)
    if(!u.shedPeriod || u.shedPeriodSgn !== u.shedSgn){
      try{ const j = await uni('API047', {snarSgn:u.shedSgn}); u.shedPeriod = pick(j, 'dvcePridval'); u.shedPeriodSgn = u.shedSgn; } catch(e){ u.err047 = e.message; }
    }
    const pm = /(\d+)\s*([DMY])/i.exec(u.shedPeriod || '');
    if(pm){
      const due = addPeriod(u.shedIn, Number(pm[1]), pm[2].toLowerCase());
      u.shedTxt = `장치기간 ${u.shedPeriod} · ${due.slice(5)}까지`;
      r.deadlines = r.deadlines || [];
      if(!r.deadlines.some(x => x.kind === '장치기간 만료')) r.deadlines.push({id:uid(), kind:'장치기간 만료', base:u.shedIn, due, done:false, auto:true});
    }
  }
  if(u.released) (r.deadlines || []).filter(x => x.kind === '장치기간 만료').forEach(x => x.done = true);
  r.deadlines = r.deadlines || [];
  if(u.shedIn && !u.cleared && !u.dclrNo && !r.deadlines.some(x => x.kind === '수입신고 기한(반입 후)'))   // 반입 후 30일 (지정 보세구역 물품, 넘기면 가산세)
    r.deadlines.push({id:uid(), kind:'수입신고 기한(반입 후)', base:u.shedIn, due:addPeriod(u.shedIn, 30, 'd'), done:false, auto:true});
  if(u.cleared || u.dclrNo) r.deadlines.filter(x => x.kind === '수입신고 기한(반입 후)' && x.auto).forEach(x => x.done = true);
  if(decl && /담보/.test([r.title, r.summary, (r.tags || []).join(' '), (r.causes || []).join(' ')].join(' '))){
    try{ const j = await uni('API050', {impDclrNo:decl}); const nm = pick(j, 'mgPrcsStcdNm'); if(nm) u.bond = nm + (pick(j, 'mgAprvDt') ? ' ' + fmtYmd(pick(j, 'mgAprvDt')).slice(5) : ''); }
    catch(e){ u.err050 = e.message; }
  }
  if(u.clearedAt && u.paid === false && !r.deadlines.some(x => x.kind === '관세 납부기한'))                 // 수리 후 미납이면 납부기한(수리일 + 15일), 납부 확인되면 처리 표시
    r.deadlines.push({id:uid(), kind:'관세 납부기한', base:u.clearedAt, due:addPeriod(u.clearedAt, 15, 'd'), done:false, auto:true});
  if(u.paid) r.deadlines.filter(x => x.kind === '관세 납부기한' && x.auto).forEach(x => x.done = true);
  if(u.cleared && (u.paid || u.released)) setStage(r, 'customs', u.paidAt || u.releasedAt || u.clearedAt || today(), `UNI-PASS: 수입신고수리${u.paid ? ', 납부 확인' : ''}${u.released ? ', 반출신고' : ''}`);
}
async function checkExport(r, u){
  const decl = kDecl(r.refNo);
  if(!decl && !r.bl) return;
  let j;
  try{ j = await uni('API002', decl ? {expDclrNo:decl} : {blNo:r.bl}); }
  catch(e){ u.err = e.message; return; }
  const yn = pick(j, 'shpmCmplYn') || pick(j, 'shpmcmplYn'), acpt = pick(j, 'acptDt'), due = pick(j, 'loadDtyTmIm'), tk = pick(j, 'tkofDt');
  Object.assign(u, {accepted:!!acpt, acceptedAt:fmtYmd(acpt), loaded:yn === 'Y', loadDue:fmtYmd(due), departAt:fmtYmd(tk), last:yn === 'Y' ? '선적완료' : (acpt ? '수출신고수리' : '')});
  if(u.accepted) setStage(r, 'accept', u.acceptedAt || today(), 'UNI-PASS: 수출신고수리');   // 수리 시점에 '수리완료' 단계
  if(u.accepted || u.loadDue) setLoadDue(r, u.acceptedAt, u.loadDue);  // 적재기한: UNI-PASS 적재의무기한, 없으면 수리일 + 30일
  if(u.loaded) (r.deadlines || []).filter(x => x.kind === '수출물품 적재기한').forEach(x => x.done = true);
  if(decl && u.accepted && !u.ldpDone){
    try{ const j = await uni('API053', {expDclrNo:decl}); const t = pick(j, 'expInscTrgtYn'), c = pick(j, 'expInscCmplYn');
      if(t) u.ldp = t === 'Y' ? (c === 'Y' ? '검사완료' : '검사대상') : '대상 아님'; u.ldpDone = t !== 'Y' || c === 'Y'; }
    catch(e){ u.err053 = e.message; }
  }
  if(u.loaded) setStage(r, 'customs', u.departAt || today(), 'UNI-PASS: 선적완료');
}
async function checkExtra(r, u){
  if(r.reqRqstNo){
    try{ const j = await uni('API025', {reqRqstNo:kDecl(r.reqRqstNo)}); const nm = pick(j, 'reqRqstPrcsSttsNm');
      if(nm){ u.reqRqst = nm + (pick(j, 'reqIttRsltInfmNo') ? ' (통보 ' + pick(j, 'reqIttRsltInfmNo') + ')' : ''); u.reqRqstDone = /완료|통보|발급|합격|승인|수리/.test(nm); } }
    catch(e){ u.err025 = e.message; }
  }
  const cd = r.cond || {}, decl = kDecl(r.refNo);
  if(cd.kind === 'reimp' && decl && cd.ln){                            // 재수입조건부 수출: 잔량
    try{ const j = await uni('API034', {expDclrNo:decl, expDclrLnNo:cd.ln, expDclrStszSrno:cd.stsz || '01'});
      const rs = pick(j, 'rsqty');
      if(rs !== ''){ u.condTxt = `재수입 잔량 ${Number(rs).toLocaleString('ko-KR')} ${pick(j, 'rsqtyUt')}`.trim() + (pick(j, 'ttwg') ? ` / ${Number(pick(j, 'ttwg')).toLocaleString('ko-KR')}` : ''); cd.zero = Number(rs) === 0; } }
    catch(e){ u.err034 = e.message; }
  }
  if(cd.kind === 'reexp' && decl){                                     // 재수출면세 수입: 잔량과 이행기한
    try{ const j = await uni('API042', {impDclrNo:decl});
      const rows = (j.items || []).filter(x => x.qtyRsqty !== undefined || x.wghtRsqty !== undefined).filter(x => !cd.ln || String(x.lnNo || '').replace(/^0+/, '') === String(cd.ln).replace(/^0+/, ''));
      if(rows.length){ const q = rows.reduce((a, x) => a + Number(x.qtyRsqty || 0), 0), w = rows.reduce((a, x) => a + Number(x.wghtRsqty || 0), 0);
        u.condTxt = `재수출 잔량 ${q.toLocaleString('ko-KR')}${w ? ` (중량 ${w.toLocaleString('ko-KR')})` : ''}`; cd.zero = q === 0 && w === 0; } }
    catch(e){ u.err042 = e.message; }
    if(cd.ln){
      try{ const j = await uni('API045', {impDclrNo:decl, lnNo:cd.ln}); const xs = (j.items || []).map(x => x.xtnsDt).concat(pick(j, 'xtnsDt')).filter(Boolean).sort();
        if(xs.length){ const due = fmtYmd(xs[xs.length - 1]); r.deadlines = r.deadlines || []; const d = r.deadlines.find(x => x.kind === '재수출 이행기한');
          if(d){ if(d.auto) d.due = due; } else r.deadlines.push({id:uid(), kind:'재수출 이행기한', base:null, due, done:false, auto:true}); } }
      catch(e){ u.err045 = e.message; }
    }
    if(cd.zero) (r.deadlines || []).filter(x => x.kind === '재수출 이행기한').forEach(x => x.done = true);
  }
  const md = r.mdfy || {};
  if(md.dcshSbmtNo && md.dgcnt && md.date){
    try{ const j = await uni('API052', {dcshSbmtNo:md.dcshSbmtNo, imexTpcd:caseCode(r.type) === 'E' ? 'E' : 'I', mdfyRqstDgcnt:md.dgcnt, mdfyRqstDt:md.date.replace(/-/g, '')}); u.mdfy = pick(j, 'mdfyRqstPrcsStcdNm') || u.mdfy || ''; }
    catch(e){ u.err052 = e.message; }
  }
  if(r.reqApreNo){
    try{ const j = await uni('API003', {imexTpcd:caseCode(r.type) === 'E' ? 'E' : 'I', reqApreNo:kDecl(r.reqApreNo)}); const iss = pick(j, 'issDt'); u.req = iss ? `승인 ${fmtYmd(iss)}` : (u.req || ''); }
    catch(e){ u.err003 = e.message; }
  }
}
async function refreshCustoms(force){
  const cfg = db.settings.mail || {};
  if(!cfg.endpoint || !cfg.token) return;
  const cutoff = new Date(Date.now() - 12 * 3600e3).toISOString();
  const list = db.records.filter(r => r.status !== '완료' && r.status !== '보류' && ['I', 'E'].includes(caseCode(r.type)) && (r.bl || r.refNo || r.mdfy || r.reqApreNo || r.reqRqstNo)
    && (force || !r.unipass || (r.unipass.at || '') < cutoff)).slice(0, 15);
  for(const r of list){
    const u = {...(r.unipass || {}), at:nowIso()};
    delete u.err;
    const before = JSON.stringify(r.stage || {}) + [(r.unipass || {}).last, (r.unipass || {}).mdfy, (r.unipass || {}).reqRqst, (r.unipass || {}).condTxt, (r.unipass || {}).ldp].join('|');
    if(caseCode(r.type) === 'E') await checkExport(r, u); else await checkImport(r, u);
    await checkExtra(r, u);
    r.unipass = u;
    if(before !== JSON.stringify(r.stage || {}) + [u.last, u.mdfy, u.reqRqst, u.condTxt, u.ldp].join('|')) r.updatedAt = nowIso();
  }
  const ev = evalStages();
  if(list.length || ev.n || ev.done){ commit(); if(ev.done) toast(`통관·정산이 확인된 ${ev.done}건을 자동으로 완료했습니다.`); }
}
const refreshUnipass = refreshCustoms;

/* ---------- 누락 방지: 오래된 미연결 대화, 새 의뢰 후보 ---------- */
const OVERDUE_H = 24;
/* 새 의뢰 후보: 대화의 첫 메일이 외부(또는 대표 전달)이고 회신(RE:)이 아니며, 제목이나 본문 첫머리에 의뢰 표현이 있을 때.
   본문은 '부탁드립니다' 같은 인사말에 걸리지 않도록 업무 단어와 붙은 경우만 본다. */
const REQ_SUBJ = /요청|의뢰|부탁|신청|문의|request|inquiry/i;
const REQ_BODY = /(신고|통관|면장|면허|수입|수출|검역|요건|진행|발급|확인)[^.\n]{0,15}(요청|부탁|의뢰|바랍니다)/;
const IS_REPLY = /^\s*(\[[^\]]*\]\s*)*(re|답장|회신)\s*(\[\d+\])?\s*[:：]/i;
function hoursSince(kst){ const t = new Date(String(kst).slice(0, 16) + ':00+09:00').getTime(); return isNaN(t) ? 0 : (Date.now() - t) / 3600e3; }
function isOwn(addr){ return /@bsgc\.co\.kr\b/i.test(String(addr || '')); }
/* 누락 경고 기준일: 이 날짜 이전에 끝난 대화는 '이전 메일'로 따로 두고 경고에 넣지 않는다(처음 연결할 때 쌓인 과거 메일 제외) */
function mailWatchFrom(){
  db.settings.mailWatchFrom = db.settings.mailWatchFrom || addPeriod(today(), -1, 'd');
  return db.settings.mailWatchFrom;
}
function threadFlags(t){
  const first = t.ms[0];
  const ext = !isOwn(first.from) || !!first.fwdFrom;
  const request = ext && !IS_REPLY.test(first.subject || '') && (REQ_SUBJ.test(first.subject || '') || REQ_BODY.test((first.snippet || '').slice(0, 200)));
  return {ageH:hoursSince(first.date), request, client:matchClient(t.ms), old:String(t.last.date).slice(0, 10) < mailWatchFrom()};
}
function mailAlerts(){
  const fl = (mailCache ? mailThreadsList() : []).map(threadFlags), cur = fl.filter(f => !f.old);
  return {total:cur.length, old:fl.length - cur.length, overdue:cur.filter(f => f.ageH >= OVERDUE_H).length, requests:cur.filter(f => f.request).length};
}

/* ---------- 홈 요약 (저장된 데이터만으로 계산, 추가 호출 없음) ---------- */
let lastCollectRun = '';
function weekStart(){ const d = new Date(today() + 'T00:00:00'), w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return d.toISOString().slice(0, 10); }
function homeWidgetsHTML(){
  const act = db.records.filter(r => r.status !== '완료' && r.status !== '보류');
  const waitP = act.filter(r => isExp(r) && stageOf(r).accept && !stageOf(r).customs).length;
  const waitC = act.filter(r => !stageOf(r).customs).length - waitP, waitS = act.filter(r => stageOf(r).customs && !stageOf(r).settle && settleMode(r) === 'each').length;
  const ws = weekStart(), doneW = db.records.filter(r => r.status === '완료' && (r.date || '') >= ws).length;
  const auto7 = db.records.filter(r => r.autoDone && r.status === '완료' && daysLeft((r.autoDone.at || '').slice(0, 10)) >= -7).length;
  const ma = mailAlerts(), dls = openDeadlines(), soon = dls.filter(x => { const n = daysLeft(x.d.due); return n >= 0 && n <= 7; }).length, over = dls.filter(x => daysLeft(x.d.due) < 0).length;
  const tile = (go, n, label, sub, warn) => `<button class="tile${warn ? ' warn' : ''}" ${go}><span class="t-n">${n}</span><span class="t-l">${label}</span><span class="t-s">${sub}</span></button>`;
  const tiles = [
    tile('data-go="active"', act.length, '진행 중', `통관 대기 ${waitC}${waitP ? ` · 선적 대기 ${waitP}` : ''} · 정산 대기 ${waitS}`),
    tile('data-go="report"', doneW, '이번 주 완료', `자동 완료(7일) ${auto7}`),
    tile('data-go="mail"', ma.total, '미연결 메일 대화', `24시간 경과 ${ma.overdue} · 새 의뢰 ${ma.requests}`, ma.overdue > 0),
    tile('data-go="active"', soon + over, '7일 내 기한', over ? `지난 기한 ${over}` : '지난 기한 없음', over > 0),
    tile('data-go="alerts"', openAlerts().length, '확인 알림', '법령·요건·관세율·화학물질·식품', openAlerts().length > 0)
  ].join('');
  // 시스템 상태: 이미 받아 둔 값으로만 표시
  const lastMail = (mailCache || []).map(m => m.collectedAt || '').sort().slice(-1)[0] || '';
  const mailAge = lastMail ? hoursSince(lastMail) : null;
  const uniAt = db.records.map(r => (r.unipass || {}).at || '').sort().slice(-1)[0] || '';
  const uniErr = db.records.map(r => r.unipass || {}).filter(u => u.at === uniAt).map(u => u.err).find(Boolean);
  const t16 = s => s ? String(s).replace('T', ' ').slice(5, 16) : '';
  const st = [
    mailCollectorAt   // 수집기가 15분마다 보고한 실행 시각 기준. 새 메일이 없는 주말·야간에는 경고하지 않음
      ? `메일 수집기 ${t16(mailCollectorAt)} 실행${hoursSince(mailCollectorAt) > 1 ? ' <b class="bad">(1시간 넘게 실행 안 됨 — 사무실 PC 수집기 확인)</b>' : ''} · 최근 메일 ${lastMail ? t16(lastMail) : '없음'}`
      : `최근 메일 수집 ${lastMail ? t16(lastMail) : '기록 없음'}${mailAge !== null && mailAge > 48 ? ' <b class="bad">(48시간 넘게 새 메일 없음 — 사무실 PC 수집기 확인)</b>' : ''}`,
    `UNI-PASS 확인 ${uniAt ? t16(new Date(uniAt).toLocaleString('sv-SE', {timeZone:'Asia/Seoul'})) : '아직 없음'}${uniErr ? ` <b class="bad">(${esc(uniErr)})</b>` : ''}`,
    `Drive 자료 수집 ${lastCollectRun ? t16(new Date(lastCollectRun).toLocaleString('sv-SE', {timeZone:'Asia/Seoul'})) : '기록 없음'}`
  ];
  const people = accounts.length > 1 ? accounts.map(a => [a.name, act.filter(r => r.assignee === a.id).length]).filter(x => x[1]) : [];
  return `<div class="tiles">${tiles}</div>
    <p class="sys-state">${st.join(' · ')}${people.length ? ` · 담당별 진행 ${people.map(([n, c]) => `${esc(n)} ${c}`).join(', ')}` : ''}</p>`;
}

/* ---------- 무변동 알림 (C4) ---------- */
const STALE_DAYS = 3;
function bizDaysSince(iso){
  if(!iso) return 99;
  let d = new Date(String(iso).slice(0, 10) + 'T00:00:00'), n = 0;
  const end = new Date(today() + 'T00:00:00');
  while(d < end){ d.setDate(d.getDate() + 1); const w = d.getDay(); if(w !== 0 && w !== 6) n++; }
  return n;
}
function lastActivity(r){
  const ds = [r.updatedAt, r.startDate, ...(r.mails || []).map(m => m.date), ...(r.checklist || []).map(x => x.doneAt), ...(r.files || []).map(f => f.date)].filter(Boolean).map(String);
  return ds.sort().slice(-1)[0] || '';
}
function staleRecords(){
  return db.records.filter(r => r.status !== '완료' && r.status !== '보류').map(r => ({r, n:bizDaysSince(lastActivity(r))})).filter(x => x.n >= STALE_DAYS).sort((a, b) => b.n - a.n);
}
