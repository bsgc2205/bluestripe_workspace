'use strict';
/* ---------- 원장·번호 정리 (1단계, 11/12 e) ----------
   기준 원장: 진행 상태 = UNI-PASS / 정산 = 직원이 보낸 정산서 메일(또는 업체 '월 정산') / 실적 = 신고번호 1개 = 1건.
   Drive 수입·수출 폴더 = 근거 자료, BSGC-Backup 주간 수집 = 백업(케이스·실적을 만들지 않고 업체 '자료 갱신 이력'만 남김).
   ① 한 케이스에 여러 B/L·신고번호(분할·정정): r.refs = [{no, kind:'decl'|'bl'|'inv'|'etc', at, why}]
   ② 같은 신고번호의 수정 자료 = 기존 케이스의 새 버전(f.ver, 이력 '정정·새 버전')
   ③ 상담(C) → 신고(I/E) '이어짐': r.linkTo = [id…], 신고 쪽 r.linkFrom = id
   ④ 근거 등급: r.stage[k + 'Lv'] = 'chk'(메일 글만 근거 — 확인 필요). 없으면 확정(UNI-PASS·필증 파일·정산서·직원 표시)
   ⑤ 메일(확인 필요)과 UNI-PASS가 2일 넘게 다르면 확인 알림(kind 'ledger') */
EXT_NAMES.ledger = '원장 확인';
const UPD_RE = /^\[[^\]]+\] 자료 갱신 \d+건/;
function isUpdateRec(r){ return !!r && r.createdBy === 'auto' && UPD_RE.test(r.title || ''); }

/* ---- ① 추가 식별번호 ---- */
const REF_KIND = {decl:'신고번호', bl:'B/L', inv:'인보이스', etc:'기타'};
const DECL_LIKE = /^\d{5}-?\d{2}-?\d{6,7}[A-Z]?$|^\d{6}[A-Z]$/i;
function refKindOf(no){
  const s = String(no || '').trim();
  if(DECL_LIKE.test(s.replace(/\s/g, ''))) return 'decl';
  if(/^(INV|CI|PI)[-_ ]?|invoice/i.test(s)) return 'inv';
  return /^[A-Z]{3,4}[A-Z0-9]{5,}$/i.test(s.replace(/[-\s]/g, '')) ? 'bl' : 'etc';
}
/* 같은 번호인지: 신고번호는 뒷자리(파일명 '300777M')만 있어도 같은 것으로 본다 */
function sameRef(a, b){
  const x = refTail(a), y = refTail(b);
  if(!x || !y) return false;
  return x === y || (x.length >= 7 && y.length >= 7 && (x.endsWith(y) || y.endsWith(x)));
}
function hasRef(r, no){ return recKeys(r).some(k => sameRef(k, no)); }
function addRef(r, no, kind, why){
  no = String(no || '').trim().toUpperCase();
  if(refTail(no).length < 6 || hasRef(r, no)) return false;
  kind = kind || refKindOf(no);
  r.refs = [...(r.refs || []), {no, kind, at:today(), why:why || ''}].slice(-20);
  addHist(r, `식별번호 추가: ${REF_KIND[kind] || kind} ${no}${why ? ` (${why})` : ''}`);
  r.updatedAt = nowIso();
  return true;
}
/* 기록 창 '추가 식별번호' 입력값 → refs (있던 항목의 근거·날짜는 유지) */
function parseRefs(text, old){
  const prev = old || [], out = [];
  String(text || '').split(/[,\n;]+/).map(s => s.trim().toUpperCase()).filter(s => refTail(s).length >= 6).forEach(no => {
    if(out.some(x => sameRef(x.no, no))) return;
    const ex = prev.find(x => sameRef(x.no, no));
    out.push(ex ? {...ex, no} : {no, kind:refKindOf(no), at:today(), why:'직접 입력'});
  });
  return out.slice(-20);
}

/* ---- ② 같은 자료의 새 버전 ---- */
function fileBase(name){
  let s = String(name || '').toLowerCase().replace(/\.[a-z0-9]{2,5}$/, '');
  for(let i = 0; i < 3; i++) s = s.replace(/\s*\(\d+\)$/, '').replace(/[_\-\s]*(v|ver|rev)\.?\d+$/i, '').replace(/[_\-\s]*(정정|수정|최종|final|revised|new)\d*$/i, '');
  return s.replace(/[_\-\s.]+/g, ' ').trim();
}
/* 기존 케이스에 붙이기 전 호출: 같은 이름(버전 표시만 다른) 자료가 이미 있으면 새 버전 번호를 붙이고 이력에 '정정·새 버전'을 남긴다 */
function markVersions(r, list){
  const fs = r.files || [], out = [];
  list.forEach(x => {
    const b = fileBase(x.name);
    if(b.length < 4 || fs.some(f => f.id === x.id)) return;
    const same = fs.filter(f => fileBase(f.name) === b);
    if(!same.length) return;
    x.ver = Math.max(...same.map(f => f.ver || 1)) + 1;
    out.push(`${x.name} (v${x.ver})`);
  });
  if(out.length){ addHist(r, `정정·새 버전 자료: ${out.join(', ')}`); r.updatedAt = nowIso(); }
  return out.length;
}

/* ---- 실적: 완료 기록 중 자료 갱신 기록 제외, 같은 신고번호는 1건 ---- */
function perfDedupe(list){
  const seen = new Map(), out = [];
  list.filter(r => !isUpdateRec(r)).forEach(r => {
    const t = refTail(r.refNo), k = t.length >= 7 ? t.slice(-7) : '';
    if(!k){ out.push(r); return; }
    const i = seen.get(k);
    if(i === undefined){ seen.set(k, out.length); out.push(r); return; }
    if(out[i].createdBy === 'auto' && r.createdBy !== 'auto') out[i] = r;   // 직원이 만든 기록을 대표로
  });
  return out;
}

/* ---- BSGC-Backup 주간 수집 → 업체 '자료 갱신 이력' (c.updates) ---- */
function addClientUpdate(c, kind, list, at){
  const cl = db.clients.find(x => x.id === c.id);
  if(!cl || !list.length) return 0;
  cl.updates = cl.updates || [];
  const day = at || today();
  let u = cl.updates.find(x => x.at === day && x.kind === kind);
  if(!u){ u = {at:day, kind, n:0, files:[]}; cl.updates.push(u); }
  list.forEach(x => {
    if(u.files.some(f => (x.id && f.id === x.id) || f.name === x.name)) return;
    u.files.push({id:x.id || '', name:x.name || '', link:safeUrl(x.link) ? x.link : '', date:x.created || ''});
    u.n++;
    (x.special || []).forEach(s => { u.special = [...new Set([...(u.special || []), s])]; });
  });
  u.files = u.files.slice(-40);
  cl.updates = cl.updates.sort((a, b) => a.at.localeCompare(b.at)).slice(-40);
  cl.updatedAt = nowIso();
  return list.length;
}
function clientUpdatesSection(c){
  const ups = (c.updates || []).slice().reverse();
  if(!ups.length) return '';
  return `<details class="old-mails client-updates"><summary>자료 갱신 이력 <span class="cnt">${ups.length}회</span> <span class="hint">BSGC-Backup 주간 수집 — 실적·케이스에 넣지 않는 백업 기록</span></summary>
    <div class="table-wrap"><table class="grid"><thead><tr><th>날짜</th><th>폴더</th><th class="num">자료</th><th>자료 이름</th></tr></thead><tbody>
    ${ups.map(u => `<tr><td>${esc(u.at)}</td><td>${esc(u.kind)}${(u.special || []).length ? ` <span class="stamp sm" title="${esc(u.special.join(', '))}">특이</span>` : ''}</td><td class="num">${u.n}</td>
      <td>${u.files.slice(0, 6).map(f => safeUrl(f.link) ? `<a href="${esc(f.link)}" target="_blank" rel="noopener noreferrer">${esc(f.name)}</a>` : esc(f.name)).join(', ')}${u.files.length > 6 ? ` <span class="hint">외 ${u.files.length - 6}개</span>` : ''}</td></tr>`).join('')}
    </tbody></table></div></details>`;
}
/* 기존에 자동으로 만들어진 '[폴더] 자료 갱신 N건' 완료 기록 → 업체 자료 갱신 이력으로 옮김.
   메일이 붙었거나 직원이 고친 기록(updatedBy·체크리스트·직접 쓴 요약)은 그대로 둔다(실적에서는 이미 빠짐). */
function updateRecs(){
  const all = db.records.filter(isUpdateRec);
  const touched = r => (r.mails || []).length || r.updatedBy || (r.checklist || []).length || (r.inquiries || []).length || (db.inquiries || []).some(q => q.recId === r.id);
  return {all, move:all.filter(r => !touched(r)), keep:all.filter(touched)};
}
function moveUpdateRecs(){
  const {move, keep} = updateRecs();
  if(!move.length){ toast(keep.length ? `옮길 기록이 없습니다(직원이 고친 ${keep.length}건은 그대로 둠).` : '옮길 기록이 없습니다.'); return; }
  if(!confirm(`BSGC-Backup 주간 수집으로 만들어진 ‘자료 갱신’ 기록 ${move.length}건을 각 업체의 ‘자료 갱신 이력’으로 옮기고 업무 기록에서 지웁니다.${keep.length ? `\n(메일이 붙었거나 직원이 고친 ${keep.length}건은 그대로 둡니다.)` : ''}\n진행할까요?`)) return;
  const ids = new Set();
  move.forEach(r => {
    const kind = (/^\[([^\]]+)\]/.exec(r.title) || [])[1] || '자료';
    addClientUpdate({id:r.clientId}, kind, (r.files || []).map(f => ({...f, created:f.date})), (r.date || r.startDate || today()).slice(0, 10));
    const cl = db.clients.find(x => x.id === r.clientId);
    if(cl && r.special){ const u = cl.updates.find(x => x.at === (r.date || r.startDate || today()).slice(0, 10) && x.kind === kind); if(u) u.special = [...new Set([...(u.special || []), ...(r.tags || []).filter(t => t !== '자동수집')])]; }
    ids.add(r.id);
  });
  db.records = db.records.filter(r => !ids.has(r.id));
  commit();
  toast(`자료 갱신 기록 ${ids.size}건을 업체 자료 갱신 이력으로 옮겼습니다.`);
}
function updateRecsBanner(){
  if(!isAdmin()) return '';
  const {all, move} = updateRecs();
  if(!all.length) return '';
  return `<div class="notice"><strong>정리 제안</strong> BSGC-Backup 주간 수집으로 만들어진 ‘[폴더] 자료 갱신 N건’ 완료 기록이 ${all.length}건 있습니다. 실적에서는 이미 빠졌고, ${move.length ? `${move.length}건은 업체 ‘자료 갱신 이력’으로 옮길 수 있습니다.` : '모두 직원이 고친 기록이라 그대로 둡니다.'}
    ${move.length ? `<button class="mini strong" data-ledger-move>업체 이력으로 옮기기</button>` : ''}</div>`;
}

/* ---- ③ 상담 → 신고 '이어짐' ---- */
function caseNextBtn(r){
  return ['C', 'F', 'X'].includes(caseCode(r.type)) ? `<button class="mini" data-case-next="${esc(r.id)}" title="이 상담이 실제 신고로 이어졌으면 수입·수출 케이스를 새로 만들거나 기존 케이스와 연결">신고로 이어가기</button>` : '';
}
function linkChipsHTML(r){
  const chip = (id, pre) => { const x = db.records.find(y => y.id === id); return x ? `<button class="tag link-chip" data-edit-rec="${esc(x.id)}" title="${esc(x.title)}">${pre} ${esc(x.caseNo || x.title.slice(0, 20))}</button>` : ''; };
  return (r.linkFrom ? chip(r.linkFrom, '← 상담') : '') + (r.linkTo || []).map(id => chip(id, '→ 이어짐')).join('');
}
function recLedgerHTML(r){
  const refs = (r.refs || []).map(x => `<span class="ref" title="${esc((REF_KIND[x.kind] || '') + (x.why ? ' · ' + x.why : '') + (x.at ? ' · ' + x.at : ''))}">${hl(x.no)}</span>`).join('');
  return refs + linkChipsHTML(r);
}
function linkCases(from, to){
  from.linkTo = [...new Set([...(from.linkTo || []), to.id])];
  to.linkFrom = from.id;
  addHist(from, `신고로 이어짐: ${to.caseNo || ''} ${to.title}`.trim());
  addHist(to, `상담에서 이어짐: ${from.caseNo || ''} ${from.title}`.trim());
  from.updatedAt = to.updatedAt = nowIso();
}
function openCaseNext(r){
  const cands = db.records.filter(x => x.id !== r.id && x.clientId === r.clientId && ['I', 'E'].includes(caseCode(x.type)) && !x.linkFrom).sort(byDateDesc).slice(0, 30);
  const guess = /수출|export/i.test(r.title + ' ' + (r.summary || '')) ? '수출신고' : '수입통관';
  openDialog({title:'신고로 이어가기', saveLabel:'연결',
    body:`<p class="hint">상담 ${esc(r.caseNo || '')} ‘${esc(r.title)}’이(가) 실제 신고로 이어졌을 때 씁니다. 상담 케이스는 그대로 두고, 신고 케이스와 ‘이어짐’으로 묶습니다(실적은 신고 케이스로 셉니다).</p>
      <label><input type="radio" name="how" value="new" checked> 새 신고 케이스 만들기
        <select name="type">${opts([['수입통관', '수입'], ['수출신고', '수출']], guess)}</select></label>
      ${cands.length ? `<label><input type="radio" name="how" value="link"> 이미 있는 케이스와 연결
        <select name="target">${opts(cands.map(x => [x.id, `${x.caseNo || ''} ${x.title} (${x.status === '완료' ? '완료 ' + (x.date || '') : x.status})`]), '')}</select></label>` : '<p class="hint">이 업체의 연결 가능한 수입·수출 케이스가 없습니다.</p>'}`,
    onSave(fd){
      let to;
      if(fd.get('how') === 'link'){ to = db.records.find(x => x.id === fd.get('target')); if(!to){ toast('연결할 케이스를 고르세요.'); return false; } }
      else {
        const type = fd.get('type') || guess;
        to = {id:uid(), clientId:r.clientId, type, status:'진행중', startDate:today(), date:'', bl:'', refNo:'', refs:[], fee:null, itemId:r.itemId || '',
          title:`[${type === '수출신고' ? '수출' : '수입'}] ${r.title.replace(/^\[[^\]]*\]\s*/, '')}`, summary:'', special:false, specialNote:'', tags:[], links:[...(r.links || [])],
          checklist:[], docs:[], deadlines:[], reflected:[], assignee:r.assignee || clientAssignee(r.clientId), history:[], createdAt:nowIso(), updatedAt:nowIso(), createdBy:me ? me.id : ''};
        if(typeof applyProcAuto === 'function') applyProcAuto(to);
        db.records.push(to);
      }
      linkCases(r, to);
      if(fd.get('how') !== 'link') setTimeout(() => openRecord(to), 60);
      toast('신고 케이스와 연결했습니다.');
      return true;
    }});
}

/* ---- ④ 근거 등급 확인 / ⑤ 메일↔UNI-PASS 불일치 ---- */
function confirmStage(r, k){
  if(!r || !r.stage || !r.stage[k]) return;
  r.stage[k + 'Lv'] = 'ok';
  r.stage[k + 'By'] = `${r.stage[k + 'By'] || ''} → 직원 확인(${me ? me.name : ''})`;
  addHist(r, `${stageName(r, k)} 확인함 (직원이 근거 확인)`);
  r.updatedAt = nowIso();
  autoComplete(r);
}
/* refreshCustoms에서 UNI-PASS 조회 뒤 호출 */
function ledgerCheck(r, u){
  const st = r.stage || {};
  if(u.err) return;
  ['accept', 'customs'].forEach(k => {
    if(!st[k] || st[k + 'Lv'] !== 'chk') return;
    const imp = !isExp(r) && k === 'customs';
    if(imp ? u.cleared : (k === 'accept' ? u.accepted : u.loaded)){
      st[k + 'Lv'] = 'ok'; st[k + 'By'] = `${st[k + 'By'] || ''} → UNI-PASS 확인`;
      addHist(r, `${stageName(r, k)} UNI-PASS로 확인됨`); r.updatedAt = nowIso(); return;
    }
    if(!(r.bl || r.refNo || u.dclrNo)) return;                          // 조회할 번호가 없으면 비교할 수 없음
    const days = (Date.now() - new Date(st[k] + 'T00:00:00').getTime()) / 864e5;
    if(days < 2) return;
    addAlert({key:`ledger|${r.id}|${k}|${st[k]}`, kind:'ledger', ttype:'rec', tid:r.id,
      title:`메일과 UNI-PASS가 다름: ${r.caseNo || ''} ${r.title}`.trim(),
      text:`${stageName(r, k)} 메일(${st[k]}, ${st[k + 'By'] || ''})은 있지만 UNI-PASS에서는 아직 ${u.last || u.cscl || '수리가 확인되지 않습니다'}.\n신고번호·B/L이 맞는지, 분할·정정 건(다른 신고번호)인지 확인하세요. 확인되면 기록에서 ‘확인 완료’를 누르세요.`});
  });
}

document.addEventListener('click', e => {
  if(!db || e.target.closest('dialog')) return;
  const a = e.target.closest('[data-case-next]'); if(a){ const r = db.records.find(x => x.id === a.dataset.caseNext); if(r) openCaseNext(r); return; }
  const s = e.target.closest('[data-stage-ok]');
  if(s){ const [rid, k] = s.dataset.stageOk.split('|'), r = db.records.find(x => x.id === rid);
    if(r && confirm(`‘${r.title}’의 ${stageName(r, k)}을(를) 확인했나요?\n(메일 글만으로 표시된 단계입니다. 필증·UNI-PASS로 확인한 뒤 누르세요.)`)){ confirmStage(r, k); commit(); toast('확인했습니다.'); } return; }
  if(e.target.closest('[data-ledger-move]')){ moveUpdateRecs(); return; }
});
