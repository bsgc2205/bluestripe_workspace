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
   수입: API001 수리 + (API049 납부 또는 반출신고) / 수출: API002 선적완료 → 통관완료 (자동)
   정산: customs@ 메일 제목에 '정산서' → 정산완료 (자동). 업체 정산 방식이 '월 정산'이면 통관완료만으로 완료.
   둘 다 되면 기록을 자동 완료하고(되돌리기 가능) r.autoDone에 근거를 남긴다. */
const SETTLE_RE = /정산서/;
const kDecl = s => String(s || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
function stageOf(r){ return r.stage || {}; }
function setStage(r, k, date, by){
  r.stage = r.stage || {};
  if(r.stage[k]) return false;
  r.stage[k] = String(date || today()).slice(0, 10); r.stage[k + 'By'] = by;
  r.updatedAt = nowIso();
  return true;
}
function settleMode(r){ const c = db.clients.find(x => x.id === r.clientId); return (c && c.settleMode) || 'each'; }
function stageHTML(r){
  const st = stageOf(r), u = r.unipass || {}, out = [];
  if(st.customs) out.push(`<span class="stg ok" title="${esc(st.customsBy || '')}">통관완료 ${esc(st.customs.slice(5))}</span>`);
  else if(u.cleared && !u.paid && !u.released) out.push('<span class="stg">수리 · 납부 확인 전</span>');
  else if(u.accepted && !u.loaded) out.push(`<span class="stg">수리 · 선적 전${u.loadDue ? ' (적재기한 ' + esc(u.loadDue.slice(5)) + ')' : ''}</span>`);
  if(st.settle) out.push(`<span class="stg ok" title="${esc(st.settleBy || '')}">정산완료 ${esc(st.settle.slice(5))}</span>`);
  if(u.mdfy) out.push(`<span class="stg">정정: ${esc(u.mdfy)}</span>`);
  if(u.req) out.push(`<span class="stg">요건: ${esc(u.req)}</span>`);
  if(r.autoDone) out.push(`<span class="stg auto" title="${esc(r.autoDone.reason || '')}">자동 완료</span>`);
  return out.length ? `<span class="stages">${out.join('')}</span>` : '';
}
function stageActsHTML(r){
  if(r.status === '완료') return r.autoDone ? `<button class="mini" data-undo-auto="${esc(r.id)}">완료 되돌리기</button>` : '';
  const st = stageOf(r), b = [];
  if(!st.customs) b.push(`<button class="mini" data-stage="${esc(r.id)}|customs">통관완료</button>`);
  if(!st.settle && settleMode(r) === 'each') b.push(`<button class="mini" data-stage="${esc(r.id)}|settle">정산완료</button>`);
  return b.join('');
}
function autoComplete(r, why){
  if(r.status === '완료' || r.autoDoneOff) return false;
  const st = stageOf(r);
  if(!st.customs || !(st.settle || settleMode(r) === 'monthly')) return false;
  r.status = '완료';
  r.date = [st.customs, st.settle].filter(Boolean).sort().slice(-1)[0];
  const reason = [`통관완료 ${st.customs} (${st.customsBy || ''})`, st.settle ? `정산완료 ${st.settle} (${st.settleBy || ''})` : '월 정산 업체'].join(', ');
  r.autoDone = {at:nowIso(), reason};
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
function undoAuto(r){
  r.status = '진행중'; r.date = ''; r.autoDoneOff = true;
  if(String(r.summary || '').startsWith('[자동 완료]')) r.summary = '';
  delete r.autoDone; r.updatedAt = nowIso();
}

/* ---------- 제안 (자동으로 정하기 어려운 것만) ---------- */
const MAIL_HINTS = [
  {key:'mail-clear', re:/수리|필증|면허|면장 발급|cleared/i, not:/요청|신청|부탁|예정/, when:r => r.status !== '완료' && !stageOf(r).customs, text:'수리·필증 관련 메일이 왔습니다', act:'customs', label:'통관완료로 표시'},
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
    if(m && h.when(r) && !off.has(key)) out.push({key, text:`${h.text}: “${m.subject}” (${String(m.date).slice(5, 10)})`, act:h.act, label:h.label, date:m.date});
  });
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
  if(s.act === 'customs'){ setStage(r, 'customs', s.date, '메일 확인(직접)'); autoComplete(r); }
  if(s.act === 'check'){ const i = (r.checklist || []).findIndex(x => !x.done && /검역|검사/.test(x.text)); if(i >= 0){ r.checklist[i].done = true; r.checklist[i].doneAt = today(); } }
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
    } else if(j && j.err) u.err = j.err;
  }
  if(!r.refNo && u.dclrNo) r.refNo = u.dclrNo;                         // 신고번호는 관세청 값이므로 바로 넣음
  const decl = kDecl(r.refNo || u.dclrNo);
  if(decl && (u.cleared || !r.bl) && !u.paid){
    try{ const j = await uni('API049', {impDclrNo:decl}); if(pick(j, 'fpayYn') === 'Y'){ u.paid = true; u.paidAt = fmtYmd(pick(j, 'fpayDt')); } else if(pick(j, 'fpayYn')) u.paid = false; }
    catch(e){ u.err049 = e.message; }
  }
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
  if(u.loadDue){                                                        // 적재의무기한을 기한 목록에 자동 등록, 선적되면 처리 표시
    r.deadlines = r.deadlines || [];
    let d = r.deadlines.find(x => x.kind === '수출물품 적재기한');
    if(!d){ d = {id:uid(), kind:'수출물품 적재기한', base:u.acceptedAt || null, due:u.loadDue, done:false, auto:true}; r.deadlines.push(d); }
    if(u.loaded) d.done = true;
  }
  if(u.loaded) setStage(r, 'customs', u.departAt || today(), 'UNI-PASS: 선적완료');
}
async function checkExtra(r, u){
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
  const list = db.records.filter(r => r.status !== '완료' && r.status !== '보류' && ['I', 'E'].includes(caseCode(r.type)) && (r.bl || r.refNo || r.mdfy || r.reqApreNo)
    && (force || !r.unipass || (r.unipass.at || '') < cutoff)).slice(0, 15);
  for(const r of list){
    const u = {...(r.unipass || {}), at:nowIso()};
    delete u.err;
    const before = JSON.stringify(r.stage || {}) + (r.unipass || {}).last + (r.unipass || {}).mdfy;
    if(caseCode(r.type) === 'E') await checkExport(r, u); else await checkImport(r, u);
    await checkExtra(r, u);
    r.unipass = u;
    if(before !== JSON.stringify(r.stage || {}) + u.last + u.mdfy) r.updatedAt = nowIso();
  }
  const ev = evalStages();
  if(list.length || ev.n || ev.done){ commit(); if(ev.done) toast(`통관·정산이 확인된 ${ev.done}건을 자동으로 완료했습니다.`); }
}
const refreshUnipass = refreshCustoms;

/* ---------- 누락 방지: 오래된 미연결 대화, 새 의뢰 후보 ---------- */
const OVERDUE_H = 24;
const REQ_RE = /요청|의뢰|부탁|신청|진행\s*바랍|진행\s*부탁|검토\s*바랍|please|request|kindly/i;
function hoursSince(kst){ const t = new Date(String(kst).slice(0, 16) + ':00+09:00').getTime(); return isNaN(t) ? 0 : (Date.now() - t) / 3600e3; }
function isOwn(addr){ return /@bsgc\.co\.kr\b/i.test(String(addr || '')); }
function threadFlags(t){
  const first = t.ms[0];
  const ext = t.ms.find(m => !isOwn(m.from) || m.fwdFrom);
  const request = !!ext && REQ_RE.test(`${first.subject} ${(ext.snippet || '').slice(0, 300)}`);
  return {ageH:hoursSince(first.date), request, client:matchClient(t.ms)};
}
function mailAlerts(){
  const ths = mailCache ? mailThreadsList() : [];
  const fl = ths.map(threadFlags);
  return {total:ths.length, overdue:fl.filter(f => f.ageH >= OVERDUE_H).length, requests:fl.filter(f => f.request).length};
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
