'use strict';
/* ---------- dialogs ---------- */
function openDialog({title, body, onSave, onDelete, onOpen, saveLabel = '저장'}){
  const dlg = $('#dlg');
  const delNote = onDelete && !isAdmin() ? '<span class="hint">삭제는 관리자만 할 수 있습니다</span>' : '';
  if(!isAdmin()) onDelete = null;                                       // 업체·기록·절차·품목 등 삭제는 관리자 전용
  dlg.innerHTML = `<form class="dlg"><h3>${esc(title)}</h3><div class="dlg-body">${body}</div>
    <footer>${onDelete ? '<button type="button" class="danger" data-act="del">삭제</button>' : delNote}<span class="sp"></span>
    <button type="button" class="ghost" data-act="cancel">취소</button><button type="submit" class="primary">${esc(saveLabel)}</button></footer></form>`;
  const f = dlg.querySelector('form');
  f.addEventListener('submit', e => {e.preventDefault(); if(onSave(new FormData(f), f) === false) return; dlg.close(); commit();});
  f.querySelector('[data-act="cancel"]').onclick = () => dlg.close();
  if(onDelete) f.querySelector('[data-act="del"]').onclick = () => {if(onDelete() === false) return; dlg.close(); commit();};
  dlg.showModal();
  if(onOpen) onOpen(f);
}

/* 기록 창 오른쪽 참고 패널: 품목 요건, 참고 절차, 진행 중 중복 의심, 비슷한 과거 건(G3), 관련 세관 질의 */
function relatedHTML(t){
  const item = t.itemId ? db.items.find(i => i.id === t.itemId) : null;
  const procs = db.procedures.filter(p => p.type === t.type && (p.clientId === t.clientId || !p.clientId));
  const open = db.records.filter(r => r.id !== t.id && r.status !== '완료' && r.clientId === t.clientId && r.type === t.type).sort(byDateDesc).slice(0, 3);
  const sims = similarRecords(t, 5), simIds = new Set(sims.map(x => x.r.id));
  const inqs = similarInquiries(t, sims, 3);
  const others = db.records.filter(r => r.id !== t.id && r.clientId !== t.clientId && r.type === t.type && r.special && r.status === '완료' && !simIds.has(r.id)).sort(byDateDesc).slice(0, 3);
  const cl = db.clients.find(c => c.id === t.clientId), cau = cl ? clientCaution(cl) : null;
  const cauHtml = cau && cau.level !== '보통' ? `<p class="caution-why">${cautionBadge(cl)} 업체 주의 등급 — ${esc(cau.reasons.join(' · '))}</p>` : '';
  if(!item && !procs.length && !open.length && !sims.length && !inqs.length && !others.length) return cauHtml + '<p class="hint">비슷한 과거 건과 절차가 아직 없습니다. 제목에 품목명을 넣으면 다른 업체의 같은 품목 건도 찾아 줍니다.</p>';
  const li = (r, extra = '') => `<li>${r.special ? '<span class="stamp sm">특이</span> ' : ''}<span class="rec-date">${esc(recDate(r))}</span>${esc(r.title)}${extra}${r.special && r.specialNote ? `<div class="hint" style="white-space:pre-wrap">${esc(r.specialNote)}</div>` : ''}</li>`;
  return `${cauHtml}${item ? `<h4>품목 요건: ${esc(item.name)}</h4><ul><li>${item.hs ? `HS ${esc(item.hs)}` : ''}${item.tariff ? `, ${esc(item.tariff)}` : ''}${item.reqs ? `<div class="hint" style="white-space:pre-wrap">${esc(item.reqs)}</div>` : ''}${item.agency ? `<div class="hint">기관: ${esc(item.agency)}</div>` : ''}</li></ul>` : ''}
    ${open.length ? `<h4>진행 중인 같은 업체·유형 건 (중복 확인)</h4><ul>${open.map(r => li(r, ` <span class="hint">${esc(r.caseNo || '')} ${esc(r.status)}</span>`)).join('')}</ul>` : ''}
    ${procs.length ? `<h4>참고할 절차</h4><ul>${procs.map(p => `<li><strong>${esc(p.title)}</strong> <span class="hint">${p.clientId ? '업체 전용' : '공통'}</span>${(p.steps || []).length ? `<ol class="mini-ol">${p.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}${p.cautions ? `<div class="hint" style="white-space:pre-wrap">주의: ${esc(p.cautions)}</div>` : ''}</li>`).join('')}</ul>` : ''}
    ${sims.length ? `<h4>${esc(simSummary(sims))}</h4><ul class="sim" data-sims="${sims.length}">${sims.map(x => simItemHTML(x, {copy:'data-x-sim', inDialog:true})).join('')}</ul>` : ''}
    ${inqs.length ? `<h4>관련 세관 질의</h4><ul class="sim">${inqs.map(q => inqMiniHTML(q, true)).join('')}</ul>` : ''}
    ${others.length ? `<h4>다른 업체의 같은 유형 특이 사례</h4><ul>${others.map(r => li(r, ` <span class="hint">${esc(clientName(r.clientId))}</span>`)).join('')}</ul>` : ''}`;
}

function openRecord(r, preset = {}){
  if(!db.clients.length){toast('먼저 업체를 추가하세요.'); openClient(null); return;}
  const isNew = !r;
  const first = sortedClients()[0].id;
  const status = preset.status || '완료';
  const rec = r || {id:uid(), clientId:preset.clientId || first, type:preset.type || db.settings.taskTypes[0], status,
    startDate:today(), date:status === '완료' ? today() : '', refNo:'', title:'', summary:'', special:false, specialNote:'',
    tags:[], links:[], fee:null, itemId:'', checklist:[], docs:[], deadlines:[], reflected:[]};
  if(isNew && preset.thread){ preset.mail = preset.thread.ms[preset.thread.ms.length - 1]; }
  if(isNew && preset.mail){
    const m = preset.mail, c = preset.thread ? threadClient(preset.thread) : matchClient(m);
    Object.assign(rec, {clientId:c ? c.id : rec.clientId, title:m.subject || '', startDate:String((preset.thread ? preset.thread.ms[0] : m).date || today()).slice(0, 10), date:status === '완료' ? String(m.date || today()).slice(0, 10) : '', summary:m.snippet || '', bl:m.bl || '', refNo:m.declNo || findRefNo((m.subject||'') + ' ' + (m.snippet||'')), links:[]});
    (preset.thread ? preset.thread.ms : [m]).forEach(x => attachMail(rec, x));
    rec.title = String(m.subject || '').replace(/^\s*(\[[^\]\d]*\]\s*|(re|fw|fwd|답장|회신|전달)\s*[:：]\s*)+/i, '').trim() || rec.title;    const txt = (preset.thread ? preset.thread.ms : [m]).map(x => (x.subject || '') + ' ' + String(x.snippet || '').slice(0, 200)).join(' ');
    if(!preset.type){ const g = guessType(txt, rec.clientId); if(g) rec.type = g; }          // 메일 내용으로 업무 유형·품목 추정 (창에서 바꿀 수 있음)
    const gi = guessItem(txt, rec.clientId); if(gi) rec.itemId = gi.id;
  }
  if(isNew && preset.prefill) Object.assign(rec, preset.prefill);
  if(!db.clients.some(c => c.id === rec.clientId)) rec.clientId = first;
  const dls = (rec.deadlines || []).map(d => ({...d}));
  let usedProc = rec.procId || '', procLoaded = '';
  openDialog({
    title: isNew ? (status === '진행중' ? '업무 시작' : '업무 기록 남기기') : `업무 기록 수정${rec.caseNo ? ' · ' + rec.caseNo : ''}`,
    body: `<div class="row2">
        <label>업체<select name="clientId">${opts(sortedClients().map(c => [c.id, c.name]), rec.clientId)}</select></label>
        <label>업무 유형<select name="type">${opts(typeList(rec.type), rec.type)}</select></label>
      </div>
      <div class="row2">
        <label>상태<select name="status">${opts(STATUSES, rec.status)}</select></label>
        ${isNew ? '' : `<label data-x="reasonWrap" hidden>상태 변경 사유 <span class="hint">(보류·재개·완료 되돌림은 필수)</span><input name="statusReason" placeholder="예: 화주 요청으로 선적 연기, 세관 보완 요구로 재개"></label>`}
        <label>품목<select name="itemId"></select></label>
      </div>
      <div class="row2">
        <label>접수일<input type="date" name="startDate" value="${esc(rec.startDate)}"></label>
        <label>완료일<input type="date" name="date" value="${esc(rec.date)}"></label>
      </div>
      <div class="row2">
        <label>B/L 번호<input name="bl" value="${esc(rec.bl || '')}" placeholder="예: HDMU1234567"></label>
        <label>신고번호<input name="refNo" value="${esc(rec.refNo)}" placeholder="수입·수출 신고번호"></label>
      </div>
      <label>추가 식별번호 <span class="hint">분할 통관·정정 신고번호, 추가 B/L, 인보이스 번호 — 쉼표로 구분. 같은 화물·같은 의뢰면 한 케이스에 모읍니다(다른 화물은 별도 케이스).</span>
        <input name="refsExtra" value="${esc((rec.refs || []).map(x => x.no).join(', '))}" placeholder="예: 13675-26-300778M, HDMU7654321"></label>
      <div class="row2">
        <label>담당자<select name="assignee">${opts([['', '지정 안 함'], ...accounts.map(a => [a.id, a.name])], rec.assignee || (isNew ? (clientAssignee(rec.clientId) || (me ? me.id : '')) : ''))}</select></label>
        <label>대행 수수료 (원)<input name="fee" inputmode="numeric" value="${rec.fee ? esc(rec.fee.toLocaleString('ko-KR')) : ''}" placeholder="리포트 집계용"></label>
      </div>
      <label>제목<input name="title" required value="${esc(rec.title)}" placeholder="예: 미국산 유기농 옥수수분말 수입통관"></label>
      <p class="hint sim-hint" data-x="simHint" hidden></p>
      <label>진행 요약<textarea name="summary" rows="4" placeholder="진행 순서, 제출 서류, 소요 기간 등. 완료 시 비워 두면 체크리스트로 자동 작성됩니다.">${esc(rec.summary)}</textarea></label>
      <label class="check"><input type="checkbox" name="special"${rec.special ? ' checked' : ''}> 일반 절차와 다르게 처리함</label>
      ${(rec.history || []).length ? `<details class="dlg-section hist"><summary class="hint">변경 이력 ${rec.history.length}건</summary><ul>${rec.history.slice().reverse().map(h => `<li><span class="hint">${esc(String(h.at).slice(0, 16).replace('T', ' '))} ${esc(accountName(h.by || '') || '자동')}</span> ${esc(h.text)}</li>`).join('')}</ul></details>` : ''}
      ${rec.lawSnap ? `<p class="hint">업무 시작(${esc(rec.lawSnap.at)}) 시점 근거 법령: ${esc(rec.lawSnap.laws.map(x => x.name + (x.effect ? ' 시행 ' + x.effect : '')).join(', '))}</p>` : ''}
      <div class="special-fields"><label>특이 처리 내용<textarea name="specialNote" rows="4" placeholder="무엇이 달랐는지 / 어떻게 해결했는지 / 다음에 적용할 점">${esc(rec.specialNote)}</textarea></label></div>
      <div class="dlg-section">
        <h4>UNI-PASS 추적 번호 (있는 것만)</h4>
        <div class="row2"><label>요건신청번호 (처리상태 확인)<input name="reqRqstNo" value="${esc(rec.reqRqstNo || '')}"></label><label>잔량 관리<select name="condKind">${opts([['', '해당 없음'], ['reimp', '재수입조건부 수출 (수출신고번호 기준)'], ['reexp', '재수출면세 수입 (수입신고번호 기준)']], (rec.cond || {}).kind || '')}</select></label></div>
        <div class="row2"><label>잔량 관리 란번호<input name="condLn" inputmode="numeric" value="${esc((rec.cond || {}).ln || '')}" placeholder="예: 001"></label><label>규격번호 (재수입조건부만)<input name="condStsz" inputmode="numeric" value="${esc((rec.cond || {}).stsz || '')}" placeholder="예: 01"></label></div>
        <div class="row2"><label>요건승인번호 (있으면 UNI-PASS로 승인 확인)<input name="reqApreNo" value="${esc(rec.reqApreNo || '')}"></label><label>정정 제출번호<input name="mdfyNo" value="${esc((rec.mdfy || {}).dcshSbmtNo || '')}" placeholder="정정 신청 후 처리상태 자동 확인"></label></div>
        <div class="row2"><label>정정 신청 차수<input name="mdfyDg" inputmode="numeric" value="${esc((rec.mdfy || {}).dgcnt || '')}"></label><label>정정 신청일자<input type="date" name="mdfyDt" value="${esc((rec.mdfy || {}).date || '')}"></label></div>
        <h4>정정·보완 원인</h4>
        <p class="hint">정정이나 세관 보완 요구가 있었던 건만 고르세요. 업체별 신고 전 점검표에 쓰입니다.</p>
        <div class="cause-grid">${CAUSES.map(k => `<label class="check"><input type="checkbox" name="cause" value="${esc(k)}"${causesOf(rec).includes(k) ? ' checked' : ''}> ${esc(k)}</label>`).join('')}</div>
      </div>
      <div class="dlg-section">
        <h4>체크리스트</h4>
        <div class="btn-row"><select data-x="procPick" aria-label="불러올 절차"></select><button type="button" class="ghost" data-x="loadProc">절차 불러오기</button><button type="button" class="ghost" data-x="addCheck">정정 점검표 추가</button></div>
        <div class="row2">
          <label>처리 단계 (한 줄에 하나)<textarea name="checklist" rows="5">${esc((rec.checklist || []).map(x => x.text).join('\n'))}</textarea></label>
          <label>필요 서류 (한 줄에 하나)<textarea name="docs" rows="5">${esc((rec.docs || []).map(x => x.text).join('\n'))}</textarea></label>
        </div>
        <p class="hint">완료 표시는 목록 화면에서 항목을 체크하면 됩니다.</p>
      </div>
      <div class="dlg-section">
        <h4>기한</h4>
        <ul class="dl-list"></ul>
        <div class="dl-add">
          <label>기한 종류<select data-x="dlKind">${opts(DL_RULES.map(x => x.kind), DL_RULES[0].kind)}</select></label>
          <label><span data-x="dlBaseLbl">기준일</span><input type="date" data-x="dlDate"></label>
          <label data-x="dlNameWrap" hidden>기한명<input data-x="dlName" placeholder="예: 검사 결과 확인"></label>
          <button type="button" class="ghost" data-x="dlAdd">기한 추가</button>
        </div>
        <p class="hint" data-x="dlPrev"></p>
        <p class="hint">법정 기한은 일반 규정으로 계산한 참고값입니다. 말일이 공휴일인 경우나 개별 사정은 직접 확인하세요.</p>
      </div>
      <div class="dlg-section">
        <label>태그<input name="tags" value="${esc((rec.tags || []).join(', '))}" placeholder="쉼표로 구분: 검역, 정정신고"></label>
        <label>관련 링크<textarea name="links" rows="2" placeholder="Drive 폴더·파일 주소를 한 줄에 하나씩">${esc((rec.links || []).join('\n'))}</textarea></label>
      </div>
      <aside class="related" aria-label="참고 자료"></aside>`,
    onSave(fd){
      const before = isNew ? null : histSnap(rec);
      const t = nowIso(), status = fd.get('status'), wasDone = rec.status === '완료' && !isNew;
      const oldStatus = rec.status, stReason = String(fd.get('statusReason') || '').trim();
      if(!isNew && status !== oldStatus && status !== '완료' && !stReason){ toast('상태를 바꾸는 사유를 적어 주세요(이력에 남습니다).'); const el = document.querySelector('#dlg [name="statusReason"]'); if(el){ el.closest('label').hidden = false; el.focus(); } return false; }
      if(status === '완료' && !fd.get('date')){toast('완료 상태는 완료일이 필요합니다.'); return false;}
      const rawLinks = lines(fd.get('links'));
      const links = rawLinks.map(safeUrl).filter(Boolean);
      if(links.length < rawLinks.length) toast('http(s)로 시작하지 않는 링크는 빼고 저장했습니다.');
      const keep = (old, texts) => {const m = new Map(old.map(x => [x.text, x])); return texts.map(tx => m.get(tx) || {text:tx, done:false});};
      const checklist = keep(rec.checklist || [], lines(fd.get('checklist')));
      let summary = fd.get('summary').trim();
      if(status === '완료' && !summary && checklist.length)
        summary = '처리 단계\n' + checklist.map(x => `${x.done ? '✓' : '–'} ${x.text}${x.doneAt ? ` (${x.doneAt})` : ''}`).join('\n');
      const feeNum = Number(String(fd.get('fee')).replace(/[^\d]/g,''));
      Object.assign(rec, {
        clientId: fd.get('clientId'), type: fd.get('type'), status, itemId: fd.get('itemId') || '',
        startDate: fd.get('startDate') || fd.get('date') || today(), date: fd.get('date'),
        refNo: fd.get('refNo').trim(), bl: String(fd.get('bl') || '').trim().toUpperCase(), refs: parseRefs(fd.get('refsExtra'), rec.refs), fee: feeNum || null, title: fd.get('title').trim(), summary,
        special: fd.get('special') === 'on', specialNote: fd.get('specialNote').trim(), causes: fd.getAll('cause'),
        checklist, docs: keep(rec.docs || [], lines(fd.get('docs'))), deadlines: dls,
        tags: fd.get('tags').split(',').map(x => x.trim()).filter(Boolean), links, assignee: fd.get('assignee') || '', updatedAt: t,
        reqApreNo: String(fd.get('reqApreNo') || '').trim(),
        reqRqstNo: String(fd.get('reqRqstNo') || '').trim(),
        cond: fd.get('condKind') ? {...(rec.cond || {}), kind: fd.get('condKind'), ln: String(fd.get('condLn') || '').trim(), stsz: String(fd.get('condStsz') || '').trim()} : null,
        mdfy: fd.get('mdfyNo') ? {dcshSbmtNo: String(fd.get('mdfyNo')).trim(), dgcnt: String(fd.get('mdfyDg') || '').trim(), date: fd.get('mdfyDt') || ''} : null
      });
      rec.updatedBy = me ? me.id : '';
      if(usedProc) rec.procId = usedProc;
      if(procLoaded) setProcVer(rec, db.procedures.find(x => x.id === procLoaded));
      if(!rec.lawSnap && status !== '완료') snapLaws(rec);
      if(isNew) addHist(rec, '기록 생성' + (preset.thread || preset.mail ? ' (customs@ 메일에서)' : '')); else { const ch = histDiff(before, histSnap(rec)); if(ch) addHist(rec, ch + (status !== oldStatus && stReason ? ` — 사유: ${stReason}` : '')); }
      if(status === '완료' && rec.wait){ addHist(rec, '대기 해제 (완료)'); delete rec.wait; }                // 업무 시작 시점의 근거 법령 시행일 기록 (사후 검증용)
      if(status === '완료' && !wasDone){ const pp = proposeFromRecord(rec); if(pp) setTimeout(() => toast('절차와 다른 점이 있어 업무 매뉴얼에 개정 제안을 올렸습니다.'), 900); }
      if(isNew){
        rec.createdAt = t; rec.createdBy = me ? me.id : ''; db.records.push(rec);
        if(preset.thread) preset.thread.ms.forEach(x => seeMail(x.id)); else if(preset.mail) seeMail(preset.mail.id);
        const lk = (preset.thread || preset.mail) && !matchClient(preset.thread ? preset.thread.ms : [preset.mail]) ? learnClient(rec.clientId, preset.thread ? preset.thread.ms : [preset.mail]) : [];
        if(lk.length) setTimeout(() => toast(`다음부터 ${lk[0]} 메일은 ${clientName(rec.clientId)}로 알아봅니다.`), 1200);
        toast(status === '진행중' ? '업무를 시작했습니다.' : '기록을 저장했습니다.');
      } else toast(preset.complete ? '완료 처리했습니다.' : '기록을 수정했습니다.');
    },
    onDelete: isNew ? null : () => {
      if(!confirm(`‘${rec.title}’ 기록을 삭제할까요?`)) return false;
      db.records = db.records.filter(x => x.id !== rec.id); toast('기록을 삭제했습니다.');
    },
    onOpen(f){
      const N = n => f.elements.namedItem(n), X = n => f.querySelector(`[data-x="${n}"]`);
      const rel = f.querySelector('.related'), spf = f.querySelector('.special-fields');
      if(X('reasonWrap')) N('status').addEventListener('change', () => { X('reasonWrap').hidden = N('status').value === rec.status || N('status').value === '완료'; });   // 상태를 바꾸면 사유 칸 (11/13)
      const itemSel = N('itemId'), procPick = X('procPick');
      const fillItems = (sel) => {
        const its = db.items.filter(i => i.clientId === N('clientId').value);
        itemSel.innerHTML = '<option value="">선택 안 함</option>' + opts(its.map(i => [i.id, i.name + (i.hs ? ` (${i.hs})` : '')]), sel);
      };
      const fillProcs = () => {
        const cid = N('clientId').value, ty = N('type').value;
        const ps = db.procedures.filter(p => !p.clientId || p.clientId === cid)
          .sort((a,b) => ((b.type === ty) - (a.type === ty)) || ((!!b.clientId) - (!!a.clientId)));
        procPick.innerHTML = ps.length ? opts(ps.map(p => [p.id, `${p.title} (${isOverlay(p) ? '업체 특이사항' : p.clientId ? '업체 전용' : '공통'}, ${p.type}, ${procVerStr(p)})`]), ps[0].id) : '<option value="">불러올 절차가 없습니다</option>';
      };
      const upd = () => {rel.innerHTML = relatedHTML({id:rec.id, clientId:N('clientId').value, type:N('type').value, itemId:itemSel.value, title:N('title').value, summary:N('summary').value, bl:N('bl').value, causes:[...f.querySelectorAll('[name=cause]:checked')].map(x => x.value)});
        const sl = rel.querySelector('[data-sims]'), h = X('simHint');
        h.hidden = !sl; if(sl) h.innerHTML = `${esc(sl.previousElementSibling.textContent)} — <button type="button" class="linkish" data-x="toSim">아래 참고 패널에서 보기</button>`;};
      f.addEventListener('click', e => { if(e.target.closest('[data-x="toSim"]')) rel.querySelector('[data-sims]').scrollIntoView({behavior:'smooth', block:'start'}); });
      let updT; const updLater = () => { clearTimeout(updT); updT = setTimeout(upd, 400); };
      ['title', 'summary', 'bl'].forEach(n => N(n).addEventListener('input', updLater));
      f.querySelectorAll('[name=cause]').forEach(x => x.addEventListener('change', upd));
      rel.addEventListener('click', e => {                                 // 비슷한 과거 건의 단계·서류를 체크리스트에 더함
        const b = e.target.closest('[data-x-sim]'); if(!b) return;
        const src = db.records.find(x => x.id === b.dataset.xSim); if(!src) return;
        const steps = (src.checklist || []).filter(s => !/^\[점검\]/.test(s.text)).map(s => normStep(s.text)), docs = (src.docs || []).map(s => normStep(s.text));
        const c0 = lines(N('checklist').value), d0 = lines(N('docs').value), c1 = mergeLines(c0, steps), d1 = mergeLines(d0, docs);
        N('checklist').value = c1.join('\n'); N('docs').value = d1.join('\n');
        if(!usedProc && src.procId && db.procedures.some(p => p.id === src.procId)) usedProc = src.procId;
        toast(c1.length + d1.length - c0.length - d0.length ? `${src.caseNo || src.title}의 단계 ${c1.length - c0.length}개, 서류 ${d1.length - d0.length}개를 더했습니다.` : '이미 모두 들어 있습니다.');
      });
      const tog = () => {spf.hidden = !N('special').checked;};
      const stat = () => {if(N('status').value === '완료' && !N('date').value) N('date').value = today();};
      const loadProc = (id, ask) => {
        const p = db.procedures.find(x => x.id === id); if(!p) return;
        usedProc = p.id;
        if(ask && (N('checklist').value.trim() || N('docs').value.trim()) && !confirm('체크리스트를 이 절차 내용으로 바꿀까요?')) return;
        procLoaded = p.id;                                                // 저장 때 적용한 매뉴얼 버전을 남김 (11/13 b)
        N('checklist').value = (p.steps || []).join('\n'); N('docs').value = splitDocs(p.docs).join('\n');
        if(p.assignee && accounts.some(a => a.id === p.assignee)) N('assignee').value = p.assignee;
        if((p.dlKinds || []).length){ X('dlKind').value = p.dlKinds[0]; prev(); X('dlPrev').textContent = `이 절차의 기한: ${p.dlKinds.join(', ')} — 기준일이 정해지면 위에서 추가하세요.`; }
      };
      let asgTouched = !isNew;
      N('assignee').addEventListener('change', () => { asgTouched = true; });
      N('clientId').addEventListener('change', () => {fillItems(''); fillProcs(); upd(); if(!asgTouched){ const a = clientAssignee(N('clientId').value); if(a) N('assignee').value = a; }});
      N('type').addEventListener('change', () => {fillProcs(); upd();});
      itemSel.addEventListener('change', upd);
      N('special').addEventListener('change', tog);
      N('status').addEventListener('change', stat);
      X('loadProc').onclick = () => loadProc(procPick.value, true);
      X('addCheck').onclick = () => {
        const cc = clientCauses(N('clientId').value).list;
        if(!cc.length){toast('이 업체는 기록된 정정 원인이 없습니다.'); return;}
        const cur = lines(N('checklist').value);
        const add = cc.map(([k]) => '[점검] ' + CAUSE_HINTS[k]).filter(t => !cur.includes(t));
        N('checklist').value = [...add, ...cur].join('\n');
        toast(add.length ? `점검 항목 ${add.length}개를 맨 앞에 넣었습니다.` : '이미 들어 있습니다.');
      };
      // deadlines
      const dlList = f.querySelector('.dl-list');
      const rule = () => DL_RULES.find(x => x.kind === X('dlKind').value);
      const renderDls = () => {
        dlList.innerHTML = dls.length
          ? dls.map((d,i) => `<li>${ddayHTML(d.due)}<strong>${esc(d.kind)}</strong><span class="hint">기한 ${esc(d.due)}${d.base ? `, 기준일 ${esc(d.base)}` : ''}${d.done ? ', 처리됨' : ''}</span><button type="button" class="mini" data-x-del="${i}">삭제</button></li>`).join('')
          : '<li class="hint">등록된 기한이 없습니다.</li>';
      };
      const prev = () => {
        const ru = rule(), dt = X('dlDate').value;
        X('dlBaseLbl').textContent = ru.base || '기한일';
        X('dlNameWrap').hidden = !!ru.base;
        X('dlPrev').textContent = ru.base && dt ? `계산된 기한: ${addPeriod(dt, ru.n, ru.u)}` : '';
      };
      X('dlKind').onchange = prev; X('dlDate').oninput = prev;
      X('dlAdd').onclick = () => {
        const ru = rule(), dt = X('dlDate').value;
        if(!dt){toast('날짜를 입력하세요.'); return;}
        dls.push({id:uid(), kind:ru.base ? ru.kind : (X('dlName').value.trim() || '기한'), base:ru.base ? dt : null, due:ru.base ? addPeriod(dt, ru.n, ru.u) : dt, done:false});
        X('dlDate').value = ''; X('dlName').value = ''; prev(); renderDls();
      };
      dlList.onclick = e => {const b = e.target.closest('[data-x-del]'); if(b){dls.splice(Number(b.dataset.xDel), 1); renderDls();}};
      fillItems(rec.itemId); fillProcs(); upd(); tog(); prev(); renderDls();
      if(preset.procId){loadProc(preset.procId, false); procPick.value = preset.procId;}
      if(preset.complete){N('status').value = '완료'; stat(); N('summary').focus();}
      else if(isNew) N('title').focus();
    }
  });
}

function letterBody(t, v){
  const reason = v.reason || '          ', num = v.num || '                ';
  const R = `${reason}${josa(reason,'으로')} 인하여`;
  if(t === 'co_after') return `1. 귀관의 노고에 감사드리며, 일익 번창하심을 기원합니다.\n\n2. 원산지증명서 발급 건(${num})에 대해 ${R} 선적 후 발급 신청하오니 선처 바랍니다.\n\n3. 귀관의 업무협조를 요청하는 바입니다.`;
  if(t === 'co_amend') return `1. 귀관의 노고에 감사드리며, 일익 번창하심을 기원합니다.\n\n2. 원산지증명서 발급 건(${num})에 대해 ${R} ${v.item || '선적일자'} 기재사항 정정신청 하오니 선처 바랍니다.\n\n3. 귀관의 업무협조를 요청하는 바입니다.`;
  const items = v.items.length ? v.items.join(', ') : '          ';
  const rows = lines(v.rows);
  const table = rows.length ? `\n\n정정 항목 | 정정 전 | 정정 후\n${rows.join('\n')}` : '';
  return `1. 귀관의 노고에 감사드리며, 일익 번창하심을 기원합니다.\n\n2. 당사 수출신고 건(${num})의 ${items} 기재 내용을 ${R} 아래와 같이 정정 신청하오니 선처 바랍니다.${table}\n\n3. 첨부 서류: ${v.attach || '정정 사유서, 정정 Invoice·Packing List, 기존 수출신고필증'}\n\n4. 귀관의 업무협조를 요청하는 바입니다.`;
}
function renderLetterBody(text){
  const out = []; let tbl = [];
  const flush = () => { if(tbl.length){ out.push('<table>' + tbl.map((r,i) => '<tr>' + r.map(c => i === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`).join('') + '</tr>').join('') + '</table>'); tbl = []; } };
  String(text).split('\n').forEach(l => { if(l.includes('|')) tbl.push(l.split('|').map(x => x.trim())); else { flush(); out.push(esc(l) + '\n'); } });
  flush(); return out.join('');
}
function printLetter(v){
  const fr = document.createElement('iframe');
  fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(fr);
  const w = fr.contentWindow; w.document.open();
  w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(v.title)}</title><style>
    @page{size:A4;margin:25mm 22mm}
    body{font-family:"Batang","바탕","Noto Serif KR","Nanum Myeongjo",serif;color:#000;font-size:12pt;line-height:1.9;margin:0}
    h1{text-align:center;font-size:24pt;letter-spacing:.6em;margin:0 0 2em;font-weight:700}
    .meta p{margin:.15em 0}.meta b{display:inline-block;width:4.2em;font-weight:700}
    .body{margin-top:2em;white-space:pre-wrap}
    table{border-collapse:collapse;width:100%;margin:.3em 0 .6em}th,td{border:1px solid #000;padding:.3em .6em;font-size:11pt;text-align:left}th{background:#f2f2f2}
    .date{text-align:center;margin:3.5em 0 2.5em}
    .sign{text-align:right;font-size:13pt}.sign p{margin:.2em 0}
    @media screen{body{max-width:166mm;margin:18mm auto;padding:0 6mm}}
  </style></head><body>
    <h1>사 유 서</h1>
    <div class="meta"><p><b>수 신</b>: ${esc(v.to)}</p><p><b>제 목</b>: ${esc(v.title)}</p></div>
    <div class="body">${renderLetterBody(v.body)}</div>
    <p class="date">${esc(v.date.replace(/-/g,'.'))}</p>
    <div class="sign"><p>${esc(v.company)}</p><p>대표 ${esc(v.rep)}&nbsp;&nbsp;&nbsp;(인)</p></div>
  </body></html>`);
  w.document.close();
  setTimeout(() => { try{ w.focus(); w.print(); }catch(e){ toast('인쇄하지 못했습니다: ' + e.message); } setTimeout(() => fr.remove(), 60000); }, 400);
  return true;
}
function openLetter(clientId){
  if(!db.clients.length){toast('먼저 업체를 추가하세요.'); openClient(null); return;}
  const first = sortedClients()[0].id;
  let cid = db.clients.some(c => c.id === clientId) ? clientId : first;
  let edited = false;
  openDialog({
    title: '사유서 작성',
    saveLabel: '인쇄하기',
    body: `<div class="row2">
        <label>업체<select name="clientId">${opts(sortedClients().map(c => [c.id, c.name]), cid)}</select></label>
        <label>사유서 종류<select name="ltype">${opts(Object.entries(LETTER_TYPES).map(([k,v]) => [k, v.name]), 'co_after')}</select></label>
      </div>
      <div class="row2">
        <label>수신<input name="to" list="toList" required><datalist id="toList">${TO_LIST.map(t => `<option value="${esc(t)}">`).join('')}</datalist></label>
        <label><span data-x="numLbl">번호</span><input name="num"></label>
      </div>
      <div class="row2">
        <label>사유<select name="reasonPick"></select></label>
        <label data-x="ownWrap">사유 직접 입력<input name="reasonOwn" placeholder="예: 선적 서류 도착 지연"></label>
      </div>
      <label data-x="itemWrap">정정할 기재사항<input name="item" value="선적일자"></label>
      <div data-x="expWrap">
        <p class="hint" style="margin:.6rem 0 .1rem">정정 항목</p>
        <div class="cause-grid">${CAUSES.filter(k => k !== '증빙 보완' && !CAUSE_HARD.includes(k)).map(k => `<label class="check"><input type="checkbox" name="ecause" value="${esc(k)}"> ${esc(k)}</label>`).join('')}</div>
        <label>정정 내용 (항목 | 정정 전 | 정정 후, 한 줄에 하나)<textarea name="rows" rows="3" placeholder="총중량 | 1,250 KG | 1,288 KG"></textarea></label>
        <label>첨부 서류<input name="attach"></label>
      </div>
      <div class="row2">
        <label>작성일<input type="date" name="ldate" value="${today()}"></label>
        <label>대표자<input name="rep" placeholder="업체 정보에 저장됩니다"></label>
      </div>
      <div class="dlg-section">
        <div class="btn-row" style="justify-content:space-between"><h4>문안</h4><button type="button" class="mini" data-x="regen">문안 다시 만들기</button></div>
        <textarea name="body" rows="11" class="letter-body"></textarea>
        <p class="hint">문안을 직접 고친 뒤에는 위 항목을 바꿔도 자동으로 바뀌지 않습니다. ‘|’로 나눈 줄은 인쇄할 때 표로 나옵니다.</p>
      </div>
      <label class="check"><input type="checkbox" name="logit" checked> 인쇄한 뒤 업무 기록으로 남기기</label>`,
    onOpen(f){
      const N = n => f.elements.namedItem(n), X = n => f.querySelector(`[data-x="${n}"]`);
      const client = () => db.clients.find(c => c.id === N('clientId').value);
      const vals = () => {
        const t = N('ltype').value, pick = N('reasonPick').value;
        return {t, num:N('num').value.trim(), reason: pick === '__own' ? N('reasonOwn').value.trim() : pick, item:N('item').value.trim(),
          items:[...f.querySelectorAll('[name=ecause]:checked')].map(x => x.value), rows:N('rows').value, attach:N('attach').value.trim()};
      };
      const gen = (force) => { if(edited && !force) return; const v = vals(); N('body').value = letterBody(v.t, v); if(force) edited = false; };
      const setType = (keepTo) => {
        const t = N('ltype').value, L = LETTER_TYPES[t], c = client();
        X('numLbl').textContent = L.numLabel;
        N('reasonPick').innerHTML = opts([...L.reasons, ['__own','직접 입력']], L.reasons[0]);
        X('itemWrap').hidden = t !== 'co_amend';
        X('expWrap').hidden = t !== 'exp_amend';
        if(!keepTo) N('to').value = ((c.letterPrefs || {})[t] || {}).to || L.to;
        if(t === 'exp_amend' && !N('attach').value){
          const ev = clientCauses(c.id).list.some(([k]) => k === '증빙 보완');
          N('attach').value = '정정 사유서, 정정 Invoice·Packing List, 기존 수출신고필증' + (ev ? ', 출고내역(ERP) 캡처, S/N 목록, 양사 서명 P/I' : '');
        }
        ownToggle(); gen();
      };
      const ownToggle = () => { X('ownWrap').hidden = N('reasonPick').value !== '__own'; };
      const setClient = () => { N('rep').value = client().rep || ''; N('attach').value = ''; setType(false); };
      N('clientId').addEventListener('change', setClient);
      N('ltype').addEventListener('change', () => setType(false));
      N('reasonPick').addEventListener('change', () => { ownToggle(); gen(); });
      ['num','reasonOwn','item','rows','attach'].forEach(n => N(n).addEventListener('input', () => gen()));
      f.querySelectorAll('[name=ecause]').forEach(x => x.addEventListener('change', () => gen()));
      N('body').addEventListener('input', () => { edited = true; });
      X('regen').onclick = () => gen(true);
      setClient();
    },
    onSave(fd, f){
      const t = fd.get('ltype'), L = LETTER_TYPES[t], c = db.clients.find(x => x.id === fd.get('clientId'));
      const body = fd.get('body').trim(), rep = fd.get('rep').trim(), to = fd.get('to').trim();
      if(!body){toast('문안이 비어 있습니다.'); return false;}
      const pick = fd.get('reasonPick'), reason = pick === '__own' ? fd.get('reasonOwn').trim() : pick;
      if(!printLetter({title:L.title, to, body, date:fd.get('ldate') || today(), company:c.name, rep})) return false;
      c.rep = rep;
      c.letterPrefs = {...(c.letterPrefs || {}), [t]: {to}};
      const num = fd.get('num').trim(), items = fd.getAll('ecause');
      const causes = t === 'exp_amend' ? items : (t === 'co_amend' && /선적/.test(fd.get('item') + reason) ? ['선적일'] : []);
      const logit = fd.get('logit') === 'on';
      $('#dlg').close(); commit();
      if(logit) openRecord(null, {status:'완료', prefill:{clientId:c.id, type:L.recType, title:`${L.name} 제출`, refNo:num,
        summary:`수신: ${to}\n사유: ${reason}` + (t === 'exp_amend' && lines(fd.get('rows')).length ? '\n정정 내용:\n' + lines(fd.get('rows')).join('\n') : ''),
        causes, tags: t === 'co_after' ? ['C/O','선적후발급'] : t === 'co_amend' ? ['C/O','정정발급'] : ['정정']}});
      else toast('인쇄 창을 열었습니다.');
      return false;
    }
  });
}

function openProc(p, preset = {}){
  if(isOverlay(p) || preset.overlay) return openOverlay(p, preset);        // 업체 특이사항(공통 위에 덧붙임)은 전용 창 (11/13 b)
  const isNew = !p;
  const pr = p || {id:uid(), clientId:preset.clientId || null, type:preset.type || db.settings.taskTypes[0], title:'', steps:[], docs:'', cautions:''};
  openDialog({
    title: isNew ? '처리 절차 추가' : '처리 절차 수정',
    body: `<div class="row2">
        <label>적용 대상<select name="clientId">${opts([['', '공통 (전 업체)'], ...sortedClients().map(c => [c.id, c.name])], pr.clientId || '')}</select></label>
        <label>업무 유형<select name="type">${opts(typeList(pr.type), pr.type)}</select></label>
      </div>
      <label>절차명<input name="title" required value="${esc(pr.title)}" placeholder="예: 수입 사료원료 통관"></label>
      <p class="hint" data-x="ovHint" hidden>이 업체만 다른 점이 있는 경우라면 공통 절차를 복사하지 말고 <button type="button" class="linkish" data-x="toOv">업체 특이사항으로 만들기</button>(공통 절차 위에 덧붙임 — 공통이 고쳐지면 함께 반영)를 쓰세요.</p>
      <label>처리 단계 <span class="hint">(한 줄에 한 단계. 단계 조건은 뒤에 ‘ | 완료: … | 자료: … | 담당: … | 예외: … | 시작: …’)</span><textarea name="steps" rows="8" placeholder="선적서류 수령 | 완료: Invoice·PL·B/L 모두 받음 | 자료: Invoice, PL, B/L&#10;HS 분류 및 요건 확인&#10;…">${esc((pr.steps || []).map(x => stepLine(x, pr.stepMeta)).join('\n'))}</textarea></label>
      <label>필요 서류 (쉼표나 줄바꿈으로 구분)<textarea name="docs" rows="3">${esc(pr.docs)}</textarea></label>
      <label>주의사항<textarea name="cautions" rows="4" placeholder="이 업체·업무에서 자주 걸리는 부분">${esc(pr.cautions)}</textarea></label>
      <div class="row2"><label>근거 법령 (한 줄에 하나: 법령명 제00조, 고시명)<textarea name="laws" rows="3" placeholder="관세법 제241조&#10;수입통관 사무처리에 관한 고시">${esc(pr.laws || '')}</textarea></label><label>최종 법령 검토일<input type="date" name="reviewedAt" value="${esc(pr.reviewedAt || '')}"></label></div>
      <div class="row2">
        <label>기본 담당자<select name="assignee">${opts([['', '지정 안 함'], ...accounts.map(a => [a.id, a.name])], pr.assignee || '')}</select></label>
        <div><span class="lbl">챙길 기한</span><div class="cause-grid">${DL_RULES.filter(x => x.base).map(x => `<label class="check"><input type="checkbox" name="dlKinds" value="${esc(x.kind)}"${(pr.dlKinds || []).includes(x.kind) ? ' checked' : ''}> ${esc(x.kind)}</label>`).join('')}</div></div>
      </div>`,
    onSave(fd){
      const t = nowIso(), ps = parseStepLines(fd.get('steps'));
      const snap = x => JSON.stringify([x.steps || [], x.docs || '', x.cautions || '', x.laws || '', x.stepMeta || {}, x.clientId || '', x.type]);
      const before = isNew ? '' : snap(pr);
      Object.assign(pr, {clientId: fd.get('clientId') || null, type: fd.get('type'), title: fd.get('title').trim(), steps: ps.steps, stepMeta: ps.meta, docs: fd.get('docs').trim(), cautions: fd.get('cautions').trim(), laws: String(fd.get('laws') || '').trim(), reviewedAt: fd.get('reviewedAt') || pr.reviewedAt || '', assignee: fd.get('assignee') || '', dlKinds: fd.getAll('dlKinds'), updatedAt: t});
      if(isNew){pr.createdAt = t; pr.ver = 1; pr.history = [{at:t, by:me ? me.id : '', text:'작성', ver:1}]; db.procedures.push(pr); toast('절차를 저장했습니다.');}
      else { if(before !== snap(pr)) bumpProc(pr, '직접 수정'); toast(`절차를 수정했습니다 (${procVerStr(pr)}).`); }
      if(!pr.clientId) refreshOverlays();
    },
    onDelete: isNew ? null : () => {
      if(!confirm(`‘${pr.title}’ 절차를 삭제할까요?`)) return false;
      db.procedures = db.procedures.filter(x => x.id !== pr.id); toast('절차를 삭제했습니다.');
    },
    onOpen(f){
      const N = n => f.elements.namedItem(n), X = n => f.querySelector(`[data-x="${n}"]`);
      const sync = () => { X('ovHint').hidden = !N('clientId').value || !db.procedures.some(x => !x.clientId && !isOverlay(x)); };
      N('clientId').addEventListener('change', sync); sync();
      X('toOv').onclick = () => { const cid = N('clientId').value, ty = N('type').value; $('#dlg').close(); openOverlay(null, {clientId:cid, type:ty}); };
      if(isNew) N('title').focus();
    }
  });
}
/* 업체 특이사항 창: 공통 절차 고르기 → 공통 단계마다 '함·필요 시·안 함' → 업체 추가 단계(@번호 = 그 공통 단계 뒤) → 추가 서류·업체 주의 */
function openOverlay(p, preset = {}){
  const commons = db.procedures.filter(x => !x.clientId && !isOverlay(x)).sort((a, b) => typeOrder(a.type) - typeOrder(b.type) || a.title.localeCompare(b.title, 'ko'));
  if(!commons.length){ toast('공통 절차가 없습니다. 공통 절차를 먼저 만드세요.'); return; }
  const isNew = !p;
  const ov = p || {id:uid(), clientId:preset.clientId || (sortedClients()[0] || {}).id, overlay:true, baseId:(commons.find(x => x.type === preset.type) || commons[0]).id, addSteps:[], skipSteps:[], optSteps:[], xdocs:'', ownCautions:'', ownMeta:{}, ver:1};
  const b0 = db.procedures.find(x => x.id === ov.baseId) || commons[0];
  const addLine = a => { const bs = b0.steps || [], i = bs.findIndex(s => stepKey(s) === a.after); return stepLine(a.text, ov.ownMeta) + (a.after === '^' ? ' @0' : i >= 0 ? ` @${i + 1}` : ''); };
  openDialog({title:isNew ? '업체 특이사항 추가' : `업체 특이사항 수정 (${procVerStr(ov)})`,
    body:`<p class="hint">공통 절차를 복사하지 않고, 이 업체만 다른 점(추가 단계·안 하는 단계·추가 서류·주의사항)만 덧붙입니다. 공통 절차가 고쳐지면 이 업체 절차에도 그대로 반영됩니다.</p>
      <div class="row2"><label>업체<select name="clientId">${opts(sortedClients().map(c => [c.id, c.name]), ov.clientId)}</select></label>
        <label>공통 절차<select name="baseId">${opts(commons.map(x => [x.id, `${x.type} · ${x.title}`]), b0.id)}</select></label></div>
      <label>이름 <span class="hint">(비우면 ‘업체명 — 공통 절차명’)</span><input name="title" value="${esc(isNew ? '' : ov.title || '')}"></label>
      <div class="dlg-section"><h4>공통 단계 — 이 업체에서</h4><div data-x="baseSteps"></div></div>
      <label>이 업체 추가 단계 <span class="hint">(한 줄에 하나. 끝에 ‘@번호’ = 위 공통 단계 그 번호 뒤, ‘@0’ = 맨 앞, 없으면 맨 끝. 조건은 ‘ | 완료: … | 자료: …’)</span>
        <textarea name="addSteps" rows="4" placeholder="식품 접촉 부분 시험성적서 확인 @2">${esc((ov.addSteps || []).map(addLine).join('\n'))}</textarea></label>
      <label>이 업체 추가 서류 <span class="hint">(쉼표로 구분)</span><input name="xdocs" value="${esc(ov.xdocs || '')}"></label>
      <label>업체 주의사항<textarea name="ownCautions" rows="4" placeholder="이 업체에서 자주 걸리는 부분">${esc(ov.ownCautions || '')}</textarea></label>
      <label>기본 담당자<select name="assignee">${opts([['', '지정 안 함'], ...accounts.map(a => [a.id, a.name])], ov.assignee || '')}</select></label>`,
    onSave(fd){
      const b = db.procedures.find(x => x.id === fd.get('baseId')); if(!b){ toast('공통 절차를 고르세요.'); return false; }
      const bs = b.steps || [], skip = [], opt = [];
      bs.forEach((s, i) => { const v = fd.get('bs_' + i); if(v === 'skip') skip.push(stepKey(s)); else if(v === 'opt') opt.push(stepKey(s)); });
      const adds = [], meta = {};
      lines(fd.get('addSteps')).forEach(l => {
        const m = /\s*@(\d+)\s*$/.exec(l), ps = parseStepLines(m ? l.slice(0, m.index) : l), t = ps.steps[0];
        if(!t) return;
        const n = m ? Number(m[1]) : -1;
        adds.push({text:t, after:n === 0 ? '^' : n > 0 && bs[n - 1] ? stepKey(bs[n - 1]) : ''});
        Object.assign(meta, ps.meta);
      });
      const cid = fd.get('clientId');
      const snap = x => JSON.stringify([x.clientId, x.baseId, x.addSteps || [], x.skipSteps || [], x.optSteps || [], x.xdocs || '', x.ownCautions || '', x.ownMeta || {}]);
      const before = isNew ? '' : snap(ov);
      Object.assign(ov, {clientId:cid, baseId:b.id, type:b.type, title:String(fd.get('title') || '').trim() || `${clientName(cid)} — ${b.title}`, addSteps:adds, skipSteps:skip, optSteps:opt,
        xdocs:String(fd.get('xdocs') || '').trim(), ownCautions:String(fd.get('ownCautions') || '').trim(), ownMeta:meta, assignee:fd.get('assignee') || ''});
      materialize(ov);
      if(isNew){ const t = nowIso(); Object.assign(ov, {createdAt:t, updatedAt:t, ver:1, history:[{at:t, by:me ? me.id : '', text:`작성 (공통 ‘${b.title}’ 위에)`, ver:1}]}); db.procedures.push(ov); toast('업체 특이사항을 저장했습니다.'); }
      else { if(before !== snap(ov)) bumpProc(ov, '직접 수정'); toast(`업체 특이사항을 수정했습니다 (${procVerStr(ov)}).`); }
    },
    onDelete:isNew ? null : () => {
      if(!confirm(`‘${ov.title}’ 업체 특이사항을 삭제할까요? (공통 절차는 그대로)`)) return false;
      db.procedures = db.procedures.filter(x => x.id !== ov.id); toast('업체 특이사항을 삭제했습니다.');
    },
    onOpen(f){
      const N = n => f.elements.namedItem(n), box = f.querySelector('[data-x="baseSteps"]');
      const draw = () => {
        const b = db.procedures.find(x => x.id === N('baseId').value), same = b && b.id === ov.baseId;
        box.innerHTML = b && (b.steps || []).length ? `<ol class="ov-steps">${b.steps.map((s, i) => { const k = stepKey(s), v = same && (ov.skipSteps || []).includes(k) ? 'skip' : same && (ov.optSteps || []).includes(k) ? 'opt' : 'use';
          return `<li><span>${esc(s)}</span><select name="bs_${i}">${opts([['use', '함'], ['opt', '필요 시'], ['skip', '이 업체는 안 함']], v)}</select></li>`; }).join('')}</ol>` : '<p class="hint">공통 절차에 단계가 없습니다.</p>';
      };
      N('baseId').addEventListener('change', draw); draw();
    }});
}

function openReflect(rec){
  const targets = db.procedures.filter(p => p.type === rec.type && (p.clientId === rec.clientId || !p.clientId))
    .sort((a,b) => (!!b.clientId) - (!!a.clientId));
  const lastLine = lines(rec.specialNote).slice(-1)[0] || '';
  const cm = targets.find(p => !p.clientId), ovNew = cm && !overlayFor(rec.clientId, cm) ? cm : null;   // 공통 절차는 있는데 이 업체 특이사항이 없으면 새로 만들 수 있게
  openDialog({
    title: '특이 사례를 절차에 반영',
    saveLabel: '반영',
    body: `<p class="hint">‘${esc(rec.title)}’에서 다음에 적용할 점을 절차의 주의사항에 덧붙입니다. 날짜와 함께 기록되어 어느 사례에서 나온 내용인지 남습니다.</p>
      <label>반영할 절차<select name="target">${opts([...targets.map(p => [p.id, `${p.title} (${isOverlay(p) ? '업체 특이사항' : p.clientId ? '업체 전용' : '공통'})`]), ...(ovNew ? [['__ov', `업체 특이사항 새로 (${clientName(rec.clientId)} — 공통 ‘${ovNew.title}’ 위에)`]] : []), ['__new', `새 절차 만들기 (${clientName(rec.clientId)} 전용)`]], targets.find(p => p.clientId)?.id || (ovNew ? '__ov' : '') || targets[0]?.id || '__new')}</select></label>
      <label>덧붙일 내용<textarea name="text" rows="4">${esc(lastLine)}</textarea></label>
      <details><summary class="hint">특이 처리 내용 전체 보기</summary><p style="white-space:pre-wrap">${esc(rec.specialNote)}</p></details>`,
    onSave(fd){
      const text = fd.get('text').trim().replace(/\s*\n\s*/g, ' ');
      if(!text){toast('덧붙일 내용을 입력하세요.'); return false;}
      const line = `- ${text} (${rec.date || rec.startDate || today()} 사례)`;
      const t = nowIso(); let p;
      if(fd.get('target') === '__new'){
        p = {id:uid(), clientId:rec.clientId, type:rec.type, title:`${rec.type} 처리 절차`, steps:[], docs:'', cautions:line, ver:1, history:[{at:t, by:me ? me.id : '', text:'특이 사례로 작성', from:rec.caseNo || '', ver:1}], createdAt:t, updatedAt:t};
        db.procedures.push(p);
      } else {
        p = fd.get('target') === '__ov' ? newOverlay(rec.clientId, ovNew) : db.procedures.find(x => x.id === fd.get('target'));
        if(isOverlay(p)){ p.ownCautions = (p.ownCautions ? p.ownCautions + '\n' : '') + line; materialize(p); }
        else p.cautions = (p.cautions ? p.cautions + '\n' : '') + line;
        bumpProc(p, `특이 사례를 ${isOverlay(p) ? '업체 ' : ''}주의사항에 추가`, rec.caseNo || '');
        if(!p.clientId) refreshOverlays();
      }
      rec.reflected = [...new Set([...(rec.reflected || []), p.id])];
      toast(`‘${p.title}’ 주의사항에 반영했습니다.`);
    }
  });
}

function openItem(it, clientId){
  const isNew = !it;
  const item = it || {id:uid(), clientId, name:'', hs:'', tariff:'', reqs:'', agency:'', notes:''};
  openDialog({
    title: isNew ? '품목 추가' : '품목 수정',
    body: `<div class="row2">
        <label>품목명<input name="name" required value="${esc(item.name)}"></label>
        <label>HS 코드<input name="hs" value="${esc(item.hs)}" placeholder="예: 3402.42-0000"></label>
      </div>
      <div class="btn-row"><button type="button" class="mini" data-x="hscand">HS 후보 찾기 (품목명으로, 참고용)</button><span class="hint" data-x="hsmsg"></span></div><div data-x="hslist"></div>
      <div class="row2"><label>업체<select name="clientId">${opts(sortedClients().map(c => [c.id, c.name]), item.clientId || clientId || '')}</select></label>
        <label>수출입 구분<select name="dir">${opts([['', `자동 (지금: ${DIR_LABEL[itemDir(item)]})`], ['I', '수입'], ['E', '수출 — 수출 세관장확인만 확인'], ['IE', '수출입 모두']], item.dir || '')}</select></label></div>
      <label>세율·FTA<input name="tariff" value="${esc(item.tariff)}" placeholder="기본세율, 적용 협정과 협정세율"></label>
      <div class="row2">
        <label>수입요건 (한 줄에 하나)<textarea name="reqs" rows="4">${esc(item.reqs)}</textarea></label>
        <label>요건 기관<textarea name="agency" rows="4">${esc(item.agency)}</textarea></label>
      </div>
      <div class="row2"><label>CAS 번호 (화학제품, 한 줄에 하나·함량 같이 적어도 됨)<textarea name="cas" rows="3" placeholder="7440-36-0 99%">${esc(item.cas || '')}</textarea></label><label>식품 원재료명 (식품, 한 줄에 하나)<textarea name="raw" rows="3" placeholder="옥수수">${esc(item.raw || '')}</textarea></label></div>
      <div class="row2"><label>제조사<input name="maker" value="${esc(item.maker || '')}"></label><label>제조국<input name="country" value="${esc(item.country || '')}"></label><label>모델명<input name="model" value="${esc(item.model || '')}"></label></div>
      <p class="hint">HS 10단위·CAS·식품 원재료명을 넣어 두면 품목 DB의 ‘공공데이터 확인’으로 세관장확인 요건·관세율·화학물질 분류·원재료 정보를 조회합니다.</p>
      ${item.ext ? `<div class="dlg-section"><h4>공공데이터 확인 결과</h4>${extItemHTML(item, true)}</div>` : ''}
      <label>메모<textarea name="notes" rows="2" placeholder="원산지, 제조사, 품목분류 근거 등">${esc(item.notes)}</textarea></label>`,
    onSave(fd){
      const bad = lines(fd.get('cas')).flatMap(l => (l.match(/\b\d{2,7}-\d{2}-\d\b/g) || []).filter(c => !casValid(c)));
      if(bad.length && !confirm(`CAS 번호 검증 숫자가 맞지 않습니다: ${bad.join(', ')}\n그대로 저장할까요? (틀린 번호는 조회하지 않습니다)`)) return false;
      const ncid = fd.get('clientId') || item.clientId, ndir = fd.get('dir') || '';
      if(!isNew && (ncid !== item.clientId || ndir !== (item.dir || ''))){ item.ext = null; openAlerts().filter(a => a.tid === item.id).forEach(a => { a.status = 'done'; a.doneAt = nowIso(); a.doneBy = me ? me.id : ''; a.doneNote = '품목 업체·수출입 구분을 바꿔 다시 확인합니다.'; }); }
      if(ncid !== item.clientId) db.records.forEach(r => { if(r.itemId === item.id && r.clientId !== ncid) r.itemId = ''; });
      item.clientId = ncid; item.dir = ndir;
      Object.assign(item, {name: fd.get('name').trim(), hs: fd.get('hs').trim(), tariff: fd.get('tariff').trim(), reqs: fd.get('reqs').trim(), agency: fd.get('agency').trim(), notes: fd.get('notes').trim(), cas: fd.get('cas').trim(), raw: fd.get('raw').trim(), maker: fd.get('maker').trim(), country: fd.get('country').trim(), model: fd.get('model').trim(), updatedAt: nowIso()});
      if(isNew){item.createdAt = nowIso(); db.items.push(item); toast('품목을 추가했습니다.');}
      else toast('품목을 수정했습니다.');
    },
    onDelete: isNew ? null : () => {
      if(!confirm(`‘${item.name}’ 품목을 삭제할까요? 기록에 연결된 품목 표시만 사라지고 기록은 남습니다.`)) return false;
      db.items = db.items.filter(x => x.id !== item.id);
      db.records.forEach(r => { if(r.itemId === item.id) r.itemId = ''; });
      toast('품목을 삭제했습니다.');
    },
    onOpen(f){
      if(isNew) f.elements.namedItem('name').focus();
      const X = n => f.querySelector(`[data-x="${n}"]`);
      X('hscand').onclick = async () => {
        const nm = f.elements.namedItem('name').value.trim();
        if(nm.length < 2){ X('hsmsg').textContent = '품목명을 두 글자 이상 넣으세요.'; return; }
        X('hsmsg').textContent = '찾는 중…';
        try{
          const list = await hsCandidates(nm);
          X('hsmsg').textContent = list.length ? `${list.length}건 — 누르면 HS 칸에 넣습니다. 품목분류는 직접 판단하세요.` : '후보가 없습니다. 다른 이름(영문·일반명)으로 찾아보세요.';
          X('hslist').innerHTML = list.length ? `<ul class="sim">${list.map(x => `<li><button type="button" class="linkish" data-hs="${esc(x.hs)}">${esc(x.hs.replace(/^(\d{4})(\d{2})(\d{4})$/, '$1.$2-$3'))}</button> ${esc(x.ko)} <span class="hint">${esc(x.en.slice(0, 60))}</span></li>`).join('')}</ul>` : '';
          X('hslist').querySelectorAll('[data-hs]').forEach(b => b.onclick = () => { f.elements.namedItem('hs').value = b.textContent; });
        }catch(e){ X('hsmsg').textContent = '찾지 못했습니다: ' + e.message; }
      };
    }
  });
}

function openClient(c){
  const isNew = !c;
  const cl = c || {id:uid(), name:'', bizNo:'', industry:'', contact:'', keyword:'', notes:''};
  const bizBefore = cl.bizNo || '';
  openDialog({
    title: isNew ? '업체 추가' : '업체 정보 수정',
    body: `<div class="btn-row"><label class="btn">사업자등록증 읽기 (홈택스 PDF)<input type="file" data-x="bizfile" accept=".pdf" hidden></label><span class="hint" data-x="bizmsg">파일은 이 브라우저 안에서만 읽고 어디에도 올리지 않습니다.</span></div>
      <label>업체명<input name="name" required value="${esc(cl.name)}"></label>
      <div class="row2">
        <label>사업자등록번호<input name="bizNo" value="${esc(cl.bizNo)}"></label>
        <label>업종, 주요 품목<input name="industry" value="${esc(cl.industry)}"></label>
      </div>
      <div class="row2">
        <label>담당자<input name="contact" value="${esc(cl.contact)}" placeholder="부서, 직함 정도만"></label>
        <label>대표자 (사유서용)<input name="rep" value="${esc(cl.rep || '')}"></label>
        <label>정산 방식<select name="settleMode">${opts([['each', '건별 정산서 (정산서 메일로 완료)'], ['monthly', '월 정산 (통관완료만으로 완료)']], cl.settleMode || 'each')}</select></label>
      </div>
      <div class="row2">
        <label>메일·Drive 검색어<input name="keyword" value="${esc(cl.keyword)}" placeholder="@abc.co.kr, 약칭 (쉼표로 구분)"></label>
      </div>
      <p class="hint">검색어에 업체 메일 도메인을 넣으면 customs@ 메일과 자동 수집 자료가 이 업체로 정확히 연결됩니다.</p>
      <div class="row2">
        <label>거래 시작 (월)<input type="month" name="since" value="${esc((cl.relation||{}).since || '')}"></label>
        <label>최근 업무 (월)<input type="month" name="last" value="${esc((cl.relation||{}).last || '')}"></label>
      </div>
      <label>거래 기간 근거<input name="basis" value="${esc((cl.relation||{}).basis || '')}" placeholder="예: 2023 정산방식표, 2026.10 정산서"></label>
      <p class="hint">기록 날짜도 함께 반영됩니다. 기간 12개월 이상이고 최근 12개월 안에 업무가 있으면 ‘1년 이상 거래 유지’ 폴더로 들어갑니다.</p>
      <div class="row2">
        <label>개업일<input type="date" name="openDate" value="${esc(cl.openDate || '')}"></label>
        <label>사업장 주소<input name="address" value="${esc(cl.address || '')}"></label>
      </div>
      <div class="row2"><label>통관고유부호<input name="ecm" value="${esc(cl.ecm || '')}" placeholder="사업자번호가 있으면 저장 후 자동으로 채웁니다"></label><label>대표 전화<input name="tel" value="${esc(cl.tel || '')}"></label></div>
      <div class="row2"><label>기본 담당자 (메일로 업무 시작할 때 자동 지정)<select name="defaultAssignee">${opts([['', '지정 안 함 (작성자)'], ...accounts.map(a => [a.id, a.name])], cl.defaultAssignee || '')}</select></label><span></span></div>
      <div class="row2"><label>주의 등급<select name="cautionLevel">${opts([['', '자동 (최근 12개월 기록 기준)'], ['주의', '주의 (직접 지정)'], ['관심', '관심 (직접 지정)'], ['보통', '보통 (직접 지정)']], cl.cautionLevel || '')}</select></label><label>주의 메모<input name="cautionNote" value="${esc(cl.cautionNote || '')}" placeholder="직접 지정한 이유"></label></div>
      <label>메모<textarea name="notes" rows="4" placeholder="거래 특성, 합의 사항, 자주 생기는 이슈">${esc(cl.notes)}</textarea></label>`,
    onSave(fd){
      Object.assign(cl, {name: fd.get('name').trim(), bizNo: fd.get('bizNo').trim(), industry: fd.get('industry').trim(), contact: fd.get('contact').trim(), rep: fd.get('rep').trim(), settleMode: fd.get('settleMode') || 'each', keyword: fd.get('keyword').trim(), notes: fd.get('notes').trim(), updatedAt: nowIso()});
      cl.relation = {since: fd.get('since') || '', last: fd.get('last') || '', basis: fd.get('basis').trim()};
      const bizChanged = bizDigits(cl.bizNo) !== bizDigits(bizBefore);
      cl.openDate = fd.get('openDate') || ''; cl.address = fd.get('address').trim(); cl.ecm = String(fd.get('ecm') || '').trim(); cl.tel = String(fd.get('tel') || '').trim();
      if((bizChanged || isNew) && (db.settings.mail || {}).endpoint) setTimeout(() => checkClientsExt([cl], true), 600);   // 사업자번호가 바뀌면 통관고유부호·국세청 상태 바로 확인
      cl.cautionLevel = fd.get('cautionLevel') || ''; cl.defaultAssignee = fd.get('defaultAssignee') || ''; cl.cautionNote = String(fd.get('cautionNote') || '').trim();
      if(isNew){cl.createdAt = nowIso(); db.clients.push(cl); toast('업체를 추가했습니다.');}
      else toast('업체 정보를 수정했습니다.');
      route = {name:'client', id:cl.id}; $('#q').value = '';
    },
    onDelete: isNew ? null : () => {
      const n = db.records.filter(r => r.clientId === cl.id).length, m = db.procedures.filter(p => p.clientId === cl.id).length, k = db.items.filter(i => i.clientId === cl.id).length;
      if(!confirm(`‘${cl.name}’을(를) 삭제하면 이 업체의 기록 ${n}건, 전용 절차 ${m}건, 품목 ${k}개도 함께 삭제됩니다. 계속할까요?`)) return false;
      db.clients = db.clients.filter(x => x.id !== cl.id);
      db.records = db.records.filter(r => r.clientId !== cl.id);
      db.procedures = db.procedures.filter(p => p.clientId !== cl.id);
      db.items = db.items.filter(i => i.clientId !== cl.id);
      (db.inquiries || []).forEach(q => { if(q.clientId === cl.id){ q.clientId = ''; q.updatedAt = nowIso(); } });   // 세관 질의는 지식이므로 남김
      route = {name:'home', id:null}; toast('업체를 삭제했습니다.');
    },
    onOpen(f){
      if(isNew) f.elements.namedItem('name').focus();
      const N = n => f.elements.namedItem(n), msg = f.querySelector('[data-x="bizmsg"]');
      f.querySelector('[data-x="bizfile"]').onchange = async e => {
        const file = e.target.files[0]; if(!file) return;
        try{
          const r = await readBizFile(file, t => { msg.textContent = t; });
          const set = (n, v) => { if(v) N(n).value = v; };
          set('bizNo', r.biz); if(r.name && !N('name').value.trim()) N('name').value = r.name;
          set('rep', r.rep); set('openDate', r.open); set('address', r.addr);
          if((r.type || r.item) && !N('industry').value.trim()) N('industry').value = [r.type, r.item].filter(Boolean).join(' / ');
          const got = [r.biz && '등록번호', r.name && '상호', r.rep && '대표자', r.open && '개업일', r.addr && '주소', (r.type || r.item) && '업태·종목'].filter(Boolean);
          msg.textContent = got.length ? `읽은 항목: ${got.join(', ')}. 내용을 확인한 뒤 저장하세요.` : '글자를 찾지 못했습니다. 더 선명한 파일로 다시 해 보세요.';
        }catch(err){ msg.textContent = '읽지 못했습니다: ' + err.message; }
      };
    }
  });
}

/* ---------- 기록 변경 이력 ---------- */
function clientAssignee(cid){ const c = db.clients.find(x => x.id === cid); return c && c.defaultAssignee && accounts.some(a => a.id === c.defaultAssignee) ? c.defaultAssignee : ''; }
function addHist(r, text){ r.history = [...(r.history || []), {at:nowIso(), by:me ? me.id : '', text:String(text).slice(0, 300)}].slice(-40); }
function histSnap(r){ return {status:r.status, assignee:r.assignee || '', clientId:r.clientId, type:r.type, title:r.title, refNo:r.refNo || '', bl:r.bl || '', startDate:r.startDate || '', date:r.date || '', special:!!r.special,
  causes:(Array.isArray(r.causes) ? r.causes : []).join(','), steps:(r.checklist || []).length, docs:(r.docs || []).length, dls:(r.deadlines || []).length, fee:r.fee || 0, summary:r.summary || ''}; }
function histDiff(a, b){
  if(!a) return '';
  const nm = {status:'상태', assignee:'담당', clientId:'업체', type:'유형', title:'제목', refNo:'신고번호', bl:'B/L', startDate:'접수일', date:'완료일', special:'특이', causes:'원인', steps:'단계 수', docs:'서류 수', dls:'기한 수', fee:'수수료'};
  const val = (k, v) => (v === undefined || v === null) ? '없음' : k === 'assignee' ? (v ? assigneeName(v) : '없음') : k === 'clientId' ? clientName(v) : k === 'special' ? (v ? '예' : '아니오') : (v === '' ? '없음' : v);
  const out = Object.keys(nm).filter(k => String(a[k] ?? '') !== String(b[k] ?? '')).map(k => `${nm[k]} ${val(k, a[k])} → ${val(k, b[k])}`);
  if(a.summary !== b.summary) out.push('진행 요약 수정');
  return out.join(', ');
}
