'use strict';
/* ---------- events ---------- */
const CLICK_SEL = '[data-kc-check],[data-sim-copy],[data-inq-new],[data-inq-edit],[data-inq-rec],[data-inq-topic],[data-inq-hs],[data-req-badge],[data-pp-apply],[data-pp-drop],[data-man-draft],[data-man-review],[data-man-print],[data-mail-old-clear],[data-unstage],[data-stage],[data-undo-auto],[data-copy-case],[data-sug],[data-sug-off],[data-mine],[data-mail-attach],[data-collect-now],[data-pend-apply],[data-pend-drop],[data-bl-q],[data-biz-import],[data-scan],[data-cc-del],[data-contact-new],[data-contact-edit],[data-contact-cat],[data-fee-new],[data-fee-edit],[data-fee-copy],[data-bl-go],[data-bl-cargo],[data-acct-new],[data-acct-edit],[data-letter],[data-go],[data-new-rec],[data-edit-rec],[data-complete],[data-reflect],[data-new-proc],[data-edit-proc],[data-start-proc],[data-new-client],[data-edit-client],[data-new-item],[data-edit-item],[data-chip],[data-month],[data-csv],[data-mail-load],[data-mail-make],[data-mail-ignore],[data-open-data],.rec-sum';
document.addEventListener('click', e => {
  const t = e.target.closest(CLICK_SEL);
  if(!t || !db || t.closest('dialog')) return;
  if(t.classList.contains('rec-sum')){t.classList.toggle('open'); return;}
  const d = t.dataset;
  const curClient = route.name === 'client' ? route.id : '';
  const curType = typeFilter !== '전체' ? typeFilter : '';
  const findRec = id => db.records.find(r => r.id === id);
  if('simCopy' in d){const [rid, sid] = d.simCopy.split('|'), r = findRec(rid), src = findRec(sid); if(r && src){ const n = copyFromRecord(r, src); openCk.add(rid); commit(); toast(n ? `${src.caseNo || src.title}의 단계·서류 ${n}개를 체크리스트에 더했습니다.` : '이미 모두 들어 있습니다.'); } return;}
  if('inqNew' in d){openInquiry(null, {rec: d.inqNew ? findRec(d.inqNew) : null}); return;}
  if('inqEdit' in d){const q = (db.inquiries || []).find(x => x.id === d.inqEdit); if(q) openInquiry(q); return;}
  if('inqRec' in d){const r = findRec(d.inqRec); inqQ = ''; inqTopic = ''; $('#q').value = ''; go('inquiries'); if(r){ const qs = (db.inquiries || []).filter(x => x.recId === r.id); if(qs.length === 1) openInquiry(qs[0]); } return;}
  if('inqTopic' in d){inqTopic = d.inqTopic; renderView(); return;}
  if('inqHs' in d){inqQ = d.inqHs; inqTopic = ''; $('#q').value = ''; go('inquiries'); return;}
  if('reqBadge' in d){itemBadge = d.reqBadge; renderView(); return;}
  if('collectNow' in d){runCollect(true); return;}
  if('pendApply' in d){applyPending(Number(d.pendApply), $(`[data-pend-client="${d.pendApply}"]`).value); return;}
  if('pendDrop' in d){db.collectPending.splice(Number(d.pendDrop), 1); commit(); return;}
  if('blQ' in d){blInline(d.blQ); return;}
  if('bizImport' in d){bizImport(); return;}
  if('scan' in d){scanContacts(d.scan); return;}
  if('ccDel' in d){const [cid, em] = d.ccDel.split('|'); const c = db.clients.find(x => x.id === cid); if(c){c.contacts = (c.contacts || []).filter(p => p.email !== em); commit();} return;}
  if('contactNew' in d){openContact(null); return;}
  if('contactEdit' in d){openContact(db.contacts.find(x => x.id === d.contactEdit)); return;}
  if('contactCat' in d){contactCat = d.contactCat; renderView(); return;}
  if('feeNew' in d){openFeeProfile(null); return;}
  if('feeEdit' in d){openFeeProfile(db.settings.feeProfiles.find(x => x.id === d.feeEdit)); return;}
  if('feeCopy' in d){const el = $('#feeOut table'); if(el && navigator.clipboard) navigator.clipboard.writeText(el.innerText).then(() => toast('복사했습니다.'), () => toast('복사하지 못했습니다.')); return;}
  if('blGo' in d){const bl = $('#blNo').value.trim().toUpperCase(); if(!bl){toast('B/L 번호를 넣어 주세요.'); return;} queryBl({bl, blType:$('#blType').value, year:$('#blYear').value}); return;}
  if('blCargo' in d){queryBl({cargMtNo: d.blCargo}); return;}
  if('acctNew' in d){openAccount(null); return;}
  if('acctEdit' in d){openAccount(accounts.find(x => x.id === d.acctEdit)); return;}
  if('letter' in d && !('go' in d)){openLetter('client' in d ? d.client : curClient); return;}
  if('go' in d){$('#q').value = ''; go(d.go, d.id);}
  else if('newRec' in d) openRecord(null, {clientId: 'client' in d ? d.client : curClient, type: curType, status: d.status || '완료'});
  else if('editRec' in d) openRecord(findRec(d.editRec));
  else if('complete' in d) openRecord(findRec(d.complete), {complete:true});
  else if('reflect' in d) openReflect(findRec(d.reflect));
  else if('newProc' in d) openProc(null, {clientId: 'client' in d ? d.client : curClient, type: curType});
  else if('editProc' in d) openProc(db.procedures.find(p => p.id === d.editProc));
  else if('startProc' in d){const p = db.procedures.find(x => x.id === d.startProc); openRecord(null, {clientId: p.clientId || curClient, type: p.type, status:'진행중', procId: p.id});}
  else if('newClient' in d) openClient(null);
  else if('editClient' in d) openClient(db.clients.find(c => c.id === d.editClient));
  else if('newItem' in d) openItem(null, d.client || curClient);
  else if('editItem' in d) openItem(db.items.find(i => i.id === d.editItem));
  else if('chip' in d){typeFilter = d.chip; renderView();}
  else if('month' in d){rptMonth = d.month; renderView();}
  else if('csv' in d) exportCsv(d.csv);
  else if('mailLoad' in d) loadMail(true);
  else if('mailMake' in d){const t = findThread(d.mailMake); if(t) openRecord(null, {thread:t, status:'진행중'});}
  else if('mailAttach' in d){const t = findThread(d.mailAttach); if(t) openAttachMail(t);}
  else if('mailIgnore' in d){const t = findThread(d.mailIgnore); if(t) t.ms.forEach(m => seeMail(m.id)); commit(); toast('목록에서 뺐습니다.');}
  else if('copyCase' in d){const s = `[${d.copyCase}]`; (navigator.clipboard ? navigator.clipboard.writeText(s) : Promise.reject()).then(() => toast(`${s} 복사함. 메일 제목에 붙여 넣으면 이 기록에 자동 연결됩니다.`), () => toast(s));}
  else if('sug' in d){const [rid, key] = d.sug.split('|'); const r = findRec(rid); if(r) applySuggestion(r, d.sug.slice(rid.length + 1));}
  else if('sugOff' in d){const rid = d.sugOff.split('|')[0], r = findRec(rid); if(r){ r.sugOff = [...new Set([...(r.sugOff || []), d.sugOff.slice(rid.length + 1)])].slice(-50); commit(); }}
  else if('mine' in d){mineOnly = !mineOnly; renderView();}
  else if('kcCheck' in d){kcCheck(d.kcCheck);}
  else if('ppApply' in d){const pp = (db.procProposals || []).find(x => x.id === d.ppApply); if(pp && applyProposal(pp, readPick(pp.id))){ commit(); toast('절차에 반영했습니다. 개정 이력에 남았습니다.'); } else toast('고른 항목이 없습니다.');}
  else if('ppDrop' in d){const pp = (db.procProposals || []).find(x => x.id === d.ppDrop); if(pp){ pp.status = 'dropped'; commit(); }}
  else if('manDraft' in d){const [cid, ty] = d.manDraft.split('|'), dr = draftFromRecords(cid, ty); if(!dr.steps.length){ toast('완료 기록에 공통으로 나온 단계가 없습니다. 절차를 직접 추가하세요.'); openProc(null, {clientId:cid, type:ty}); } else { db.procProposals = db.procProposals || []; db.procProposals.push({id:uid(), recId:'', caseNo:`완료 ${dr.n}건 기준`, clientId:cid, type:ty, procId:null, at:nowIso(), by:me ? me.id : '', status:'pending', add:dr.steps, skip:[], docs:[], caution:''}); commit(); toast('초안을 개정 제안에 올렸습니다. 확인 후 반영하세요.'); }}
  else if('manReview' in d){const p = db.procedures.find(x => x.id === d.manReview); if(p){ p.reviewedAt = today(); p.history = [...(p.history || []), {at:nowIso(), by:me ? me.id : '', text:'근거 법령 검토'}].slice(-50); commit(); }}
  else if('manPrint' in d){const p = db.procedures.find(x => x.id === d.manPrint); if(p) printManual(p);}
  else if('mailOldClear' in d){const olds = mailThreadsList().filter(t => threadFlags(t).old); if(confirm(`기준일 이전 대화 ${olds.length}건을 모두 목록에서 뺄까요? 메일 색인에는 그대로 남습니다.`)){ olds.forEach(t => t.ms.forEach(m => seeMail(m.id))); commit(); toast(`${olds.length}건을 정리했습니다.`); }}
  else if('stage' in d){const [rid, k] = d.stage.split('|'), r = findRec(rid); if(r){ setStage(r, k, today(), '직접 표시'); if(k === 'customs') (r.deadlines || []).filter(x => x.kind === '수출물품 적재기한').forEach(x => x.done = true); const done = autoComplete(r); commit(); toast(done ? '통관·정산이 모두 확인되어 완료 처리했습니다.' : (k === 'customs' ? '통관완료로 표시했습니다.' : '정산완료로 표시했습니다.')); }}
  else if('unstage' in d){const [rid, k] = d.unstage.split('|'), r = findRec(rid); const nm = k === 'customs' ? '통관완료' : '정산완료'; if(r && confirm(`‘${r.title}’의 ${nm} 표시를 취소할까요?${r.autoDone ? ' 자동 완료도 함께 되돌립니다.' : ''}`)){ unsetStage(r, k); commit(); toast(`${nm} 표시를 취소했습니다.`); }}
  else if('undoAuto' in d){const r = findRec(d.undoAuto); if(r){ undoAuto(r); commit(); toast('진행 중으로 되돌렸습니다. 이 기록은 다시 자동 완료하지 않습니다.'); }}
  else if('openData' in d) openDataMenu();
  else if('letter' in d) openLetter('client' in d ? d.client : curClient);
});
$('#view').addEventListener('input', e => {
  const el = e.target;
  if(el.id === 'contactQ'){ $('#contactTable').innerHTML = contactTable(); return; }
  if(el.id === 'inqQ' || el.id === 'itemQ'){ const id = el.id; if(id === 'inqQ') inqQ = el.value; else itemQ = el.value; clearTimeout(window._gq); window._gq = setTimeout(() => { renderView(); const q = $('#' + id); if(q){ q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 300); return; }
  if(el.id === 'manQ'){ manualQ = el.value; clearTimeout(window._manT); window._manT = setTimeout(() => { renderView(); const q = $('#manQ'); if(q){ q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 300); return; }
  if(el.id === 'kcQ'){ $('#kcTable').innerHTML = kcTableHTML(kcRowsFor(el.dataset.kcClient, el.value), false); return; }
  if(el.dataset && el.dataset.fee && el.dataset.fee !== 'pid'){
    if(el.dataset.fee === 'amount'){ const n = num(el.value); el.value = n ? n.toLocaleString('ko-KR') : ''; }
    feeState[el.dataset.fee] = el.value;
    $('#feeOut').innerHTML = feeOutHTML();
  }
});
document.addEventListener('change', e => {
  if(e.target.id === 'mailWatch' && db){ if(e.target.value){ db.settings.mailWatchFrom = e.target.value; commit(); } return; }
  if(e.target.dataset && e.target.dataset.fee === 'pid' && db){ feeState.pid = e.target.value; $('[data-own]').hidden = e.target.value !== '__own'; $('#feeOut').innerHTML = feeOutHTML(); return; }
  const el = e.target;
  if(!db || el.closest('dialog')) return;
  if(el.matches('[data-ck]')){
    const [rid, kind, i] = el.dataset.ck.split('|');
    const r = db.records.find(x => x.id === rid); if(!r) return;
    const x = (kind === 'c' ? r.checklist : r.docs)[Number(i)]; if(!x) return;
    x.done = el.checked; x.doneAt = el.checked ? today() : null; r.updatedAt = nowIso();
    openCk.add(rid); commit();
  } else if(el.matches('[data-dl]')){
    const [rid, did] = el.dataset.dl.split('|');
    const r = db.records.find(x => x.id === rid); const dl = r && r.deadlines.find(x => x.id === did); if(!dl) return;
    dl.done = true; dl.doneAt = today(); commit(); toast(`‘${dl.kind}’을(를) 처리 완료로 표시했습니다.`);
  } else if(el.id === 'sType'){sOpt.type = el.value; renderView();}
  else if(el.id === 'sSpecial'){sOpt.special = el.checked; renderView();}
  else if(el.id === 'rptMonth' && el.value){rptMonth = el.value; renderView();}
});
document.addEventListener('toggle', e => {
  const el = e.target;
  if(el.matches && el.matches('details[data-ck-rec]')){const id = el.dataset.ckRec; el.open ? openCk.add(id) : openCk.delete(id);}
  if(el.matches && el.matches('details[data-sim-rec]')){const id = el.dataset.simRec; if(el.open){ simOpen.add(id); simOpen.delete('x' + id); } else { simOpen.delete(id); simOpen.add('x' + id); }}
  if(el.matches && el.matches('details[data-folder]')) folderOpen[el.dataset.folder] = el.open;
}, true);
let searchTimer;
$('#q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const v = $('#q').value.trim();
    if(v) route = {name:'search', id:null};
    else if(route.name === 'search') route = {name:'home', id:null};
    renderSidebar(); renderView();
  }, 150);
});
document.addEventListener('keydown', e => {
  if(e.key === '/' && db && !$('#dlg').open && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)){e.preventDefault(); $('#q').focus();}
});
$('#btnExport').onclick = exportEnc;
$('#btnData').onclick = openDataMenu;
$('#btnLock').onclick = () => location.reload();
$('#btnUnlock').onclick = unlock;
$('#pw').addEventListener('keydown', e => {if(e.key === 'Enter') unlock();});
$('#btnCreate').onclick = createNew;
$('#pw2').addEventListener('keydown', e => {if(e.key === 'Enter') createNew();});
$('#gateToNew').onclick = () => showGate('new');
$('#gateToUnlock').onclick = () => showGate('unlock');
$('#btnOpenFile').onclick = () => $('#gateFile').click();
$('#gateToSync').onclick = () => { const g = $('#gateSync'); g.hidden = !g.hidden; if(!g.hidden){ const c = storedSync(); if(c){ $('#gsEp').value = c.endpoint; } $('#gsEp').focus(); } };
$('#btnGateSync').onclick = async () => {
  const cfg = {endpoint: $('#gsEp').value.trim(), token: $('#gsTk').value.trim()}, m = $('#gsMsg');
  if(!/^https:\/\/script\.google\.com\//.test(cfg.endpoint) || !cfg.token){ m.textContent = '웹 앱 주소와 토큰을 확인하세요.'; return; }
  m.textContent = 'Drive에서 Workspace를 받는 중…';
  try{
    const res = await syncGet(cfg, {load:1});
    if(!res.blob || !res.blob.ct || !Array.isArray(res.blob.accounts)) throw new Error('Drive에 Workspace 파일이 아직 없습니다. 관리자가 먼저 자동 저장을 켜야 합니다');
    serverBlob = res.blob; serverPre = {endpoint: cfg.endpoint, res};
    try{ localStorage.setItem(LS_KEY + '-sync', jstr(cfg)); }catch{}
    m.textContent = ''; $('#gateSync').hidden = true; showGate('unlock');
    $('#gateMsg').textContent = 'Drive의 Workspace를 받았습니다. 아이디와 비밀번호를 입력하세요.';
  }catch(e){ m.textContent = '연결하지 못했습니다: ' + e.message; }
};
$('#gateFile').addEventListener('change', async e => {
  const file = e.target.files[0]; if(!file) return;
  try{
    const obj = JSON.parse(await file.text());
    if(!obj.ct){showGate('unlock'); $('#gateMsg').textContent = '암호화 파일(data.enc.json)이 아닙니다.'; return;}
    remoteBlob = obj; showGate('unlock');
    $('#gateMsg').textContent = `${file.name}을(를) 불러왔습니다. 비밀번호를 입력하세요.`;
  }catch{showGate('unlock'); $('#gateMsg').textContent = '파일을 읽지 못했습니다.';}
});

boot();
