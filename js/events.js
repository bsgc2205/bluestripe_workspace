'use strict';
/* ---------- events ---------- */
const CLICK_SEL = '[data-collect-now],[data-pend-apply],[data-pend-drop],[data-bl-q],[data-biz-import],[data-scan],[data-cc-del],[data-contact-new],[data-contact-edit],[data-contact-cat],[data-fee-new],[data-fee-edit],[data-fee-copy],[data-bl-go],[data-bl-cargo],[data-acct-new],[data-acct-edit],[data-letter],[data-go],[data-new-rec],[data-edit-rec],[data-complete],[data-reflect],[data-new-proc],[data-edit-proc],[data-start-proc],[data-new-client],[data-edit-client],[data-new-item],[data-edit-item],[data-chip],[data-month],[data-csv],[data-mail-load],[data-mail-make],[data-mail-ignore],[data-open-data],.rec-sum';
document.addEventListener('click', e => {
  const t = e.target.closest(CLICK_SEL);
  if(!t || !db || t.closest('dialog')) return;
  if(t.classList.contains('rec-sum')){t.classList.toggle('open'); return;}
  const d = t.dataset;
  const curClient = route.name === 'client' ? route.id : '';
  const curType = typeFilter !== '전체' ? typeFilter : '';
  const findRec = id => db.records.find(r => r.id === id);
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
  else if('mailLoad' in d) loadMail();
  else if('mailMake' in d){const m = (mailCache || []).find(x => x.id === d.mailMake); if(m) openRecord(null, {mail:m, status:'완료'});}
  else if('mailIgnore' in d){const m = (mailCache || []).find(x => x.id === d.mailIgnore); seeMail(d.mailIgnore); if(m) markMailDone(m); commit(); toast('목록에서 뺐습니다.');}
  else if('openData' in d) openDataMenu();
  else if('letter' in d) openLetter('client' in d ? d.client : curClient);
});
$('#view').addEventListener('input', e => {
  const el = e.target;
  if(el.id === 'contactQ'){ $('#contactTable').innerHTML = contactTable(); return; }
  if(el.id === 'kcQ'){ $('#kcTable').innerHTML = kcTableHTML(kcRowsFor(el.dataset.kcClient, el.value), false); return; }
  if(el.dataset && el.dataset.fee && el.dataset.fee !== 'pid'){
    if(el.dataset.fee === 'amount'){ const n = num(el.value); el.value = n ? n.toLocaleString('ko-KR') : ''; }
    feeState[el.dataset.fee] = el.value;
    $('#feeOut').innerHTML = feeOutHTML();
  }
});
document.addEventListener('change', e => {
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
