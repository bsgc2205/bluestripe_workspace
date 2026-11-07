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

/* ---------- 진행단계 제안 (C3) ----------
   메일 제목과 UNI-PASS 진행정보를 보고 제안만 한다. 직원이 '적용'을 눌러야 바뀐다. */
const MAIL_HINTS = [
  {key:'mail-clear', re:/수리|필증|면허|면장 발급|cleared/i, not:/요청|신청|부탁|예정/, when:r => r.status !== '완료', text:'수리·필증 관련 메일이 왔습니다', act:'complete', label:'완료 처리'},
  {key:'mail-amend', re:/정정|보완|기각|반려/, when:r => !r.special, text:'정정·보완 관련 메일이 왔습니다', act:'special', label:'특이로 표시'},
  {key:'mail-insp', re:/검역.*(합격|완료|결과)|검사.*(완료|결과|합격)|합격/, when:r => (r.checklist || []).some(x => !x.done && /검역|검사/.test(x.text)), text:'검역·검사 결과 메일이 왔습니다', act:'check', label:'해당 단계 체크'}
];
function suggestions(r){
  if(r.status === '완료' && !(r.unipass && r.unipass.dclrNo && !r.refNo)) return [];
  const off = new Set(r.sugOff || []), out = [];
  const recent = r.mails || [];
  MAIL_HINTS.forEach(h => {
    const m = recent.slice().reverse().find(x => h.re.test(x.subject || '') && !(h.not && h.not.test(x.subject || '')));
    const key = m ? `${h.key}:${m.id}` : '';
    if(m && h.when(r) && !off.has(key)) out.push({key, text:`${h.text}: “${m.subject}” (${String(m.date).slice(5, 10)})`, act:h.act, label:h.label});
  });
  const u = r.unipass;
  if(u && !u.err){
    if(u.dclrNo && !r.refNo && !off.has('up-refno:' + u.dclrNo)) out.push({key:'up-refno:' + u.dclrNo, text:`UNI-PASS 신고번호 ${u.dclrNo}`, act:'refno', label:'신고번호 넣기', val:u.dclrNo});
    const k = 'up-' + (u.released ? 'rel' : 'clr') + ':' + (u.lastAt || '');
    if((u.cleared || u.released) && r.status !== '완료' && !off.has(k)) out.push({key:k, text:`UNI-PASS: ${u.last || (u.released ? '반출신고' : '수입신고수리')} (${fmtDttm(u.lastAt)})`, act:'complete', label:'완료 처리'});
  }
  return out;
}
function fmtDttm(s){ s = String(s || ''); return s.length >= 12 ? `${s.slice(4, 6)}/${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}` : s; }
function suggestHTML(r){
  const ss = suggestions(r);
  if(!ss.length) return '';
  return `<div class="suggest">${ss.map(s => `<div><span class="sg-label">제안</span> ${esc(s.text)} <button class="mini strong" data-sug="${esc(r.id)}|${esc(s.key)}">${esc(s.label)}</button><button class="mini" data-sug-off="${esc(r.id)}|${esc(s.key)}">무시</button></div>`).join('')}</div>`;
}
function applySuggestion(r, key){
  const s = suggestions(r).find(x => x.key === key);
  if(!s) return;
  const off = () => { r.sugOff = [...new Set([...(r.sugOff || []), key])].slice(-50); };
  if(s.act === 'complete'){ off(); openRecord(r, {complete:true}); return; }
  if(s.act === 'special'){ off(); r.special = true; openRecord(r); return; }
  if(s.act === 'check'){ const i = (r.checklist || []).findIndex(x => !x.done && /검역|검사/.test(x.text)); if(i >= 0){ r.checklist[i].done = true; r.checklist[i].doneAt = today(); } }
  if(s.act === 'refno') r.refNo = s.val;
  off(); r.updatedAt = nowIso(); commit(); toast('반영했습니다.');
}

/* UNI-PASS 화물통관 진행정보: 진행 중인 수입 건(B/L 있음)을 하루 두 번까지 확인 */
async function refreshUnipass(){
  const cfg = db.settings.mail || {};
  if(!cfg.endpoint || !cfg.token) return;
  const cutoff = new Date(Date.now() - 12 * 3600e3).toISOString();
  const list = db.records.filter(r => r.status !== '완료' && r.bl && caseCode(r.type) === 'I' && (!r.unipass || (r.unipass.at || '') < cutoff)).slice(0, 10);
  let changed = 0;
  for(const r of list){
    let j = null;
    for(const blType of ['M', 'H']){
      try{ j = await collectApi({bl:r.bl, blType, year:(r.startDate || today()).slice(0, 4)}); if(j && (j.main || []).length) break; }
      catch(e){ j = {err:e.message}; if(/인증키|연결하지/.test(e.message)) break; }
    }
    const prev = JSON.stringify(r.unipass || {});
    if(!j || j.err || !(j.main || []).length){ r.unipass = {at:nowIso(), err:(j && j.err) || '조회 결과 없음'}; }
    else{
      const m = j.main[0], det = (j.details || []).slice().sort((a, b) => String(a.prcsDttm || '').localeCompare(String(b.prcsDttm || '')));
      const last = det[det.length - 1] || {};
      const all = det.map(x => x.cargTrcnRelaBsopTpcd || '').join(' ') + ' ' + (m.csclPrgsStts || '') + ' ' + (m.prgsStts || '');
      const dcl = det.slice().reverse().find(x => x.dclrNo && /수입신고/.test(x.cargTrcnRelaBsopTpcd || ''));
      r.unipass = {at:nowIso(), stts:m.prgsStts || '', cscl:m.csclPrgsStts || '', last:last.cargTrcnRelaBsopTpcd || '', lastAt:last.prcsDttm || m.prcsDttm || '',
        cleared:/수입신고수리|수리/.test(all), released:/반출신고/.test(all), dclrNo:dcl ? dcl.dclrNo : ''};
    }
    const a = JSON.parse(prev), b = r.unipass;
    if(a.last !== b.last || a.cscl !== b.cscl){ r.updatedAt = nowIso(); }
    changed++;
  }
  if(changed) commit();
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
  return db.records.filter(r => r.status === '진행중').map(r => ({r, n:bizDaysSince(lastActivity(r))})).filter(x => x.n >= STALE_DAYS).sort((a, b) => b.n - a.n);
}
