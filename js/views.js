'use strict';
/* ---------- render ---------- */
function render(){renderSidebar(); renderView(); updateSaveState(); $('#who').textContent = me ? `${me.name} (${me.id})` : ''; $('.side-link[data-go=accounts]').hidden = !me || me.role !== 'admin';}
function renderSidebar(){
  document.querySelectorAll('.side-link').forEach(b => b.classList.toggle('on', b.dataset.go === route.name));
  const active = db.records.filter(r => r.status !== '완료').length;
  $('#cntActive').textContent = active || '';
  const ma = mailAlerts();  // customs@ 메일 중 아직 기록과 연결하지 않은 대화
  $('#cntMail').textContent = ma.total || ''; $('#cntMail').classList.toggle('warn', ma.overdue > 0); $('#cntMail').title = ma.overdue ? `${OVERDUE_H}시간 넘게 연결 안 된 대화 ${ma.overdue}건` : '';
  const ppN = (db.procProposals || []).filter(x => x.status === 'pending').length; if($('#cntManual')) $('#cntManual').textContent = ppN || '';
  if($('#cntInq')) $('#cntInq').textContent = (db.inquiries || []).length || '';
  if($('#cntAlert')){ const n = openAlerts().length; $('#cntAlert').textContent = n || ''; $('#cntAlert').classList.toggle('warn', n > 0); }
  $('#cntInbox').textContent = (db.collectPending || []).length || '';
  const counts = {}; db.records.forEach(r => counts[r.clientId] = (counts[r.clientId] || 0) + 1);
  const list = sortedClients();
  if(!list.length){$('#clientList').innerHTML = '<p class="hint side-empty">업체를 추가하세요</p>'; return;}
  const groups = {long:[], other:[]};
  list.forEach(c => groups[relationOf(c).longTerm ? 'long' : 'other'].push(c));
  const cur = route.name === 'client' ? route.id : null;
  const li = c => `<li><button data-go="client" data-id="${esc(c.id)}" class="${cur === c.id ? 'on' : ''}"><span>${esc(c.name)}${cautionBadge(c)}</span><span class="cnt">${counts[c.id]||0}</span></button></li>`;
  const folder = (key, name, arr) => {
    const open = folderOpen[key] || arr.some(c => c.id === cur);
    return `<details class="folder" data-folder="${key}"${open ? ' open' : ''}><summary><span class="f-name">${name}</span><span class="cnt">${arr.length}</span></summary><ul>${arr.map(li).join('') || '<li class="hint side-empty">없음</li>'}</ul></details>`;
  };
  $('#clientList').innerHTML = folder('long', '1년 이상 거래 유지', groups.long) + folder('other', '그 외 업체', groups.other);
}
function renderView(){
  hlRe = null;
  const v = $('#view');
  const views = {search:viewSearch, active:viewActive, mail:viewMail, report:viewReport, common:viewCommon, manual:viewManual, inquiries:viewInquiries, itemdb:viewItemDb, alerts:viewAlerts, contacts:viewContacts, clientlist:viewClientList, inbox:viewInbox, fee:viewFee, bl:viewBl, accounts:viewAccounts};
  if(route.name === 'client' && db.clients.some(c => c.id === route.id)) v.innerHTML = viewClient();
  else if(views[route.name]) v.innerHTML = views[route.name]();
  else {route = {name:'home', id:null}; v.innerHTML = viewHome();}
}
function go(name, id){route = {name, id:id || null}; typeFilter = '전체'; render(); window.scrollTo(0,0);}

function ckItem(rid, kind, i, x){
  return `<li class="${x.done ? 'done' : ''}"><label><input type="checkbox" data-ck="${esc(rid)}|${kind}|${i}"${x.done ? ' checked' : ''}><span>${esc(x.text)}${x.done && x.doneAt ? `<small>${esc(x.doneAt)}</small>` : ''}</span></label></li>`;
}
function recordHTML(r, o = {}){
  const active = r.status !== '완료';
  const ck = r.checklist || [], dc = r.docs || [];
  const ckDone = ck.filter(x => x.done).length, dcDone = dc.filter(x => x.done).length;
  const total = ck.length + dc.length, pct = total ? Math.round((ckDone + dcDone) / total * 100) : 0;
  const dls = (r.deadlines || []).filter(d => !d.done).sort((a,b) => a.due.localeCompare(b.due));
  const links = (r.links || []).filter(safeUrl);
  const item = r.itemId ? db.items.find(i => i.id === r.itemId) : null;
  const tags = (r.tags || []).length ? `<div class="tags">${r.tags.map(t => `<span class="tag">${hl(t)}</span>`).join('')}</div>` : '';
  const linkHtml = links.length ? `<div class="links">${links.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(linkLabel(u))}</a>`).join('')}</div>` : '';
  const ckHtml = total && !o.compact ? `<div class="progress" aria-hidden="true"><i style="width:${pct}%"></i></div>
    <details class="ck" data-ck-rec="${esc(r.id)}"${openCk.has(r.id) ? ' open' : ''}><summary>${ck.length ? `단계 ${ckDone}/${ck.length}` : ''}${ck.length && dc.length ? ', ' : ''}${dc.length ? `서류 ${dcDone}/${dc.length}` : ''}</summary>
      ${ck.length ? `<ul>${ck.map((x,i) => ckItem(r.id,'c',i,x)).join('')}</ul>` : ''}
      ${dc.length ? `<p class="ck-sub">필요 서류</p><ul>${dc.map((x,i) => ckItem(r.id,'d',i,x)).join('')}</ul>` : ''}
    </details>` : '';
  const dateCol = active
    ? `${esc(r.startDate || '')}<small>${r.status === '보류' ? '보류' : '접수'}</small>`
    : `${esc(r.date)}${r.startDate && r.startDate !== r.date ? `<small>접수 ${esc(r.startDate.slice(5))}</small>` : ''}`;
  const inqN = (db.inquiries || []).filter(q => q.recId === r.id).length;
  const byLine = accounts.length > 1 && r.createdBy ? `<small>${esc(accountName(r.createdBy))}</small>` : '';
  return `<article class="rec">
    <div class="rec-date">${dateCol}${byLine}</div>
    <div class="rec-body">
      <div class="rec-head">${caseTagHTML(r)}${active ? `<span class="status ${esc(r.status)}">${esc(r.status)}</span>` : ''}${r.special ? '<span class="stamp">특이</span>' : ''}<h4>${hl(r.title)}</h4></div>
      <div class="rec-meta">${o.showClient ? `<button class="linkish" data-go="client" data-id="${esc(r.clientId)}">${esc(clientName(r.clientId))}</button>` : ''}<span class="tag type">${esc(r.type)}</span>${item ? `<span>${hl(item.name)}</span>` : ''}${r.bl ? `<span class="ref">B/L ${hl(r.bl)}</span>` : ''}${r.refNo ? `<span class="ref">${hl(r.refNo)}</span>` : ''}${r.assignee ? `<span class="who-tag">담당 ${esc(assigneeName(r.assignee))}</span>` : ''}${stageHTML(r)}${causesOf(r).map(c => `<span class="tag cause">${esc(c)}</span>`).join('')}${dls.map(d => `<span class="dl-chip">${ddayHTML(d.due)}${esc(d.kind)}</span>`).join('')}${inqN ? `<button class="tag" data-inq-rec="${esc(r.id)}" title="이 기록과 연결된 세관 질의">세관 질의 ${inqN}</button>` : ''}</div>
      ${!o.compact && r.summary ? `<p class="rec-sum" title="눌러서 펼치기">${hl(r.summary)}</p>` : ''}
      ${r.special && r.specialNote ? `<div class="special-note"><strong>특이 처리 내용</strong><p class="rec-sum" title="눌러서 펼치기">${hl(r.specialNote)}</p>${(r.reflected||[]).length ? `<span class="reflected">절차에 반영됨</span>` : ''}</div>` : ''}
      ${active && !o.compact ? suggestHTML(r) + guideHTML(r) : ''}
      ${o.compact ? '' : docsHTML(r)}
      ${ckHtml}
      ${o.compact ? '' : tags + linkHtml + filesHTML(r) + mailsHTML(r)}
    </div>
    <div class="rec-act">
      <button class="mini" data-edit-rec="${esc(r.id)}">수정</button>
      ${active ? `<button class="mini strong" data-complete="${esc(r.id)}">완료 처리</button>` : ''}
      ${stageActsHTML(r)}
      ${o.compact ? '' : `<button class="mini" data-inq-new="${esc(r.id)}" title="세관에 문의하거나 세관이 요구한 내용을 기록">질의 기록</button>`}
      ${r.special ? `<button class="mini" data-reflect="${esc(r.id)}">절차에 반영</button>` : ''}
    </div>
  </article>`;
}
function procHTML(p, o = {}){
  return `<section class="proc${o.common ? ' is-common' : ''}">
    <header><span class="tag type">${esc(p.type)}</span><h4>${hl(p.title)}</h4>${o.common ? '<span class="note">공통 절차</span>' : ''}${o.showClient ? `<span class="note">${esc(clientName(p.clientId))}</span>` : ''}
      <span class="p-act"><button class="mini" data-start-proc="${esc(p.id)}">이 절차로 시작</button><button class="mini" data-edit-proc="${esc(p.id)}">수정</button></span></header>
    ${(p.steps || []).length ? `<ol>${p.steps.map(s => `<li>${hl(s)}</li>`).join('')}</ol>` : ''}
    ${p.docs ? `<div class="proc-docs"><strong>필요 서류</strong><p>${hl(p.docs)}</p></div>` : ''}
    ${p.cautions ? `<div class="proc-caution"><strong>주의</strong><p>${hl(p.cautions)}</p></div>` : ''}
    <div class="upd">최종 수정 ${esc((p.updatedAt || '').slice(0,10))}</div>
  </section>`;
}
function deadlineRow({r, d}){
  return `<div class="dl-row">
    <input type="checkbox" data-dl="${esc(r.id)}|${esc(d.id)}" title="처리 완료로 표시" aria-label="${esc(d.kind)} 처리 완료">
    ${ddayHTML(d.due)}
    <div><strong>${esc(d.kind)}</strong> <span class="hint">${esc(d.due)}${d.base ? `, 기준일 ${esc(d.base)}` : ''}</span>
      <div class="hint"><button class="linkish" data-edit-rec="${esc(r.id)}">${esc(r.title)}</button> (${esc(clientName(r.clientId))})</div></div>
  </div>`;
}

/* ---------- views ---------- */
function viewHome(){
  const recs = [...db.records].sort(byDateDesc);
  const active = db.records.filter(r => r.status !== '완료').sort((a,b) => (a.startDate||'').localeCompare(b.startDate||''));
  const done = recs.filter(r => r.status === '완료');
  const sp = done.filter(r => r.special);
  const dls = openDeadlines();
  const over = dls.filter(x => daysLeft(x.d.due) < 0).length, soon = dls.filter(x => { const n = daysLeft(x.d.due); return n >= 0 && n <= 7; }).length;
  const month = today().slice(0,7);
  const m = done.filter(r => (r.date || '').startsWith(month)).length;
  const stale = staleRecords(), sugN = db.records.filter(r => r.status !== '완료' && suggestions(r).length).length, ma = mailAlerts();
  const autoDone = db.records.filter(r => r.autoDone && r.status === '완료' && daysLeft((r.autoDone.at || '').slice(0, 10)) >= -7).sort((a, b) => (b.autoDone.at || '').localeCompare(a.autoDone.at || ''));
  return `<section class="home-intro">
    <h2>${today()}</h2>
    <p>진행 중인 업무가 ${active.length}건이고, 7일 안에 돌아오는 기한이 ${soon}건${over ? `, 이미 지난 기한이 ${over}건` : ''} 있습니다. 이번 달에는 ${m}건을 완료했습니다.</p>
    ${homeWidgetsHTML()}
    ${ma.overdue || ma.requests ? `<p class="attn alert">${ma.overdue ? `<strong>메일 누락 주의: ${OVERDUE_H}시간 넘게 기록과 연결되지 않은 customs@ 대화 ${ma.overdue}건</strong>` : ''}${ma.overdue && ma.requests ? ' · ' : ''}${ma.requests ? `<strong>새 의뢰 후보 ${ma.requests}건</strong>` : ''} <button class="mini strong" data-go="mail">customs@ 메일 열기</button></p>` : ''}
    ${autoDone.length ? `<details class="attn"><summary><strong>최근 7일 자동 완료 ${autoDone.length}건</strong> (통관·정산 확인) — 눌러서 확인</summary><ul>${autoDone.map(r => `<li><button class="linkish" data-edit-rec="${esc(r.id)}">${esc(r.caseNo || '')} ${esc(r.title)}</button> <span class="hint">${esc(clientName(r.clientId))} · ${esc(r.autoDone.reason)}</span> <button class="mini" data-undo-auto="${esc(r.id)}">되돌리기</button></li>`).join('')}</ul></details>` : ''}
    ${stale.length || sugN ? `<p class="attn">${stale.length ? `<strong>확인 필요 ${stale.length}건</strong> (진행 중인데 ${STALE_DAYS}영업일 넘게 메일·자료·기록 변화 없음)` : ''}${stale.length && sugN ? ' · ' : ''}${sugN ? `<strong>제안 ${sugN}건</strong> (메일·UNI-PASS 기준 단계 변경)` : ''} <button class="mini" data-go="active">진행 중 업무에서 보기</button></p>` : ''}
    <div class="quick"><button class="primary" data-new-rec data-status="진행중">업무 시작</button><button class="ghost" data-new-rec data-status="완료">완료 기록 남기기</button><button class="ghost" data-new-proc>처리 절차 추가</button><button class="ghost" data-new-client>업체 추가</button></div>
  </section>
  <div class="two-col">
    <section><div class="sec-head"><h3>진행 중 업무</h3>${active.length > 6 ? '<button class="mini" data-go="active">전체 보기</button>' : ''}</div>
      ${active.length ? active.slice(0,6).map(r => recordHTML(r, {showClient:true})).join('') : '<p class="empty">진행 중인 업무가 없습니다. 새 건을 받으면 ‘업무 시작’으로 등록하고 단계를 체크해 가세요.</p>'}
    </section>
    <section><div class="sec-head"><h3>챙길 기한</h3></div>
      ${dls.length ? dls.slice(0,10).map(deadlineRow).join('') : '<p class="empty">등록된 기한이 없습니다. 기록에 FTA 사후적용, 적재기한 같은 기한을 넣으면 여기서 날짜순으로 챙길 수 있습니다.</p>'}
    </section>
  </div>
  <div class="two-col">
    <section><div class="sec-head"><h3>최근 완료 기록</h3></div>
      ${done.length ? done.slice(0,8).map(r => recordHTML(r, {showClient:true})).join('') : '<p class="empty">아직 완료 기록이 없습니다.</p>'}
    </section>
    <section><div class="sec-head"><h3>특이 처리 사례</h3></div>
      ${sp.length ? sp.slice(0,8).map(r => recordHTML(r, {showClient:true, compact:true})).join('') : '<p class="empty">일반 절차와 다르게 처리한 건을 기록하면 여기에 모입니다.</p>'}
    </section>
  </div>`;
}

function viewActive(){
  const mine = r => !mineOnly || !me || r.assignee === me.id || (!r.assignee && r.createdBy === me.id);
  const stale = staleRecords().filter(x => mine(x.r));
  const act = db.records.filter(r => r.status !== '완료' && r.status !== '보류' && mine(r)).sort((a,b) => (a.startDate||'').localeCompare(b.startDate||''));
  const hold = db.records.filter(r => r.status === '보류' && mine(r)).sort((a,b) => (a.startDate||'').localeCompare(b.startDate||''));
  const dls = openDeadlines();
  return `<header class="client-head"><div><h2>진행 중 업무</h2><p class="client-meta">진행중 ${act.length}건, 보류 ${hold.length}건, 남은 기한 ${dls.length}건</p></div>
    <div class="client-act"><button class="ghost" data-mine>${mineOnly ? '전체 보기' : '내 담당만'}</button><button class="primary" data-new-rec data-status="진행중">업무 시작</button></div></header>
  ${stale.length ? `<section class="stale"><div class="sec-head"><h3>확인 필요 — ${STALE_DAYS}영업일 넘게 변화 없음</h3></div><ul>${stale.map(x => `<li><button class="linkish" data-edit-rec="${esc(x.r.id)}">${x.r.caseNo ? esc(x.r.caseNo) + ' ' : ''}${esc(x.r.title)}</button> <span class="hint">${esc(clientName(x.r.clientId))} · ${x.n}영업일${x.r.assignee ? ' · 담당 ' + esc(assigneeName(x.r.assignee)) : ''}</span></li>`).join('')}</ul></section>` : ''}
  <div class="two-col">
    <section>
      <div class="sec-head"><h3>진행중</h3></div>
      ${act.length ? act.map(r => recordHTML(r, {showClient:true})).join('') : '<p class="empty">진행중인 업무가 없습니다.</p>'}
      ${hold.length ? `<div class="sec-head" style="margin-top:2rem"><h3>보류</h3></div>${hold.map(r => recordHTML(r, {showClient:true})).join('')}` : ''}
    </section>
    <section><div class="sec-head"><h3>전체 기한</h3></div>
      ${dls.length ? dls.map(deadlineRow).join('') : '<p class="empty">남은 기한이 없습니다.</p>'}
    </section>
  </div>`;
}

function viewClient(){
  const c = db.clients.find(x => x.id === route.id);
  const recs = db.records.filter(r => r.clientId === c.id).sort(byDateDesc);
  const procs = db.procedures.filter(p => p.clientId === c.id);
  const items = db.items.filter(i => i.clientId === c.id).sort((a,b) => a.name.localeCompare(b.name,'ko'));
  const types = [...new Set([...procs, ...recs].map(x => x.type))].sort((a,b) => typeOrder(a) - typeOrder(b));
  if(typeFilter !== '전체' && !types.includes(typeFilter)) typeFilter = '전체';
  const f = x => typeFilter === '전체' || x.type === typeFilter;
  const fp = procs.filter(f).sort((a,b) => typeOrder(a.type) - typeOrder(b.type));
  const common = typeFilter === '전체' ? [] : db.procedures.filter(p => !p.clientId && p.type === typeFilter);
  const fr = recs.filter(f);
  const spCount = fr.filter(r => r.special).length, actCount = fr.filter(r => r.status !== '완료').length;
  const kw = primaryKw(c);
  const drive = 'https://drive.google.com/drive/search?q=' + encodeURIComponent(kw);
  const meta = [c.bizNo, c.industry, c.contact].filter(Boolean).map(esc).join(' / ');
  const rel = relationOf(c);
  return `<header class="client-head">
      <div><h2>${esc(c.name)}</h2>${meta ? `<p class="client-meta">${meta}</p>` : ''}
        <div class="rel" title="${esc(rel.basis)}">${rel.longTerm ? '<span class="badge-long">1년 이상 거래</span>' : '<span class="badge-other">1년 미만·확인 필요</span>'}<span>${esc(relationText(rel))}</span>${cautionBadge(c)}</div>${(() => { const x = clientCaution(c); return x.level === '보통' ? '' : `<p class="caution-why">주의 등급 ${esc(x.level)}: ${esc(x.reasons.join(' · '))}</p>`; })()}</div>
      <div class="client-act">
        
        <a class="btn" href="${esc(drive)}" target="_blank" rel="noopener noreferrer">Drive에서 찾기</a>
        ${safeUrl(c.bizDoc) ? `<a class="btn" href="${esc(c.bizDoc)}" target="_blank" rel="noopener noreferrer">사업자등록증</a>` : ''}
        <button class="ghost" data-letter data-client="${esc(c.id)}">사유서 작성</button>
        <button class="ghost" data-edit-client="${esc(c.id)}">업체 정보 수정</button>
      </div>
    </header>
    ${c.address || c.openDate ? `<p class="client-meta">${[c.address, c.openDate && '개업 ' + c.openDate].filter(Boolean).map(esc).join(' / ')}</p>` : ''}
    ${c.notes ? `<p class="client-notes">${esc(c.notes)}</p>` : ''}
    ${clientContactsSection(c)}
    ${kcSection(c)}
    <section class="items">
      <div class="sec-head"><h3>품목·요건 <span class="cnt">${items.length}개</span></h3><button class="mini" data-new-item data-client="${esc(c.id)}">품목 추가</button></div>
      ${items.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>품목</th><th>HS 코드</th><th>세율·FTA</th><th>수입요건</th><th>요건 기관</th><th></th></tr></thead><tbody>
        ${items.map(i => `<tr><td><strong>${esc(i.name)}</strong>${i.notes ? `<div class="hint">${esc(i.notes)}</div>` : ''}${extItemHTML(i)}</td><td class="hs">${esc(i.hs)}</td><td>${esc(i.tariff)}</td><td class="pre">${esc(i.reqs)}</td><td>${esc(i.agency)}</td><td><button class="mini" data-edit-item="${esc(i.id)}">수정</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="empty">자주 들어오는 품목의 HS 코드와 수입요건을 정리해 두면 기록을 쓸 때 함께 보입니다.</p>'}
    </section>
    ${amendSection(c)}
    <div class="chips" role="group" aria-label="업무 유형">${['전체', ...types].map(t => `<button class="chip${t === typeFilter ? ' on' : ''}" data-chip="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <div class="client-grid">
      <section>
        <div class="sec-head"><h3>처리 절차</h3><button class="mini" data-new-proc data-client="${esc(c.id)}">절차 추가</button></div>
        ${fp.length || common.length
          ? fp.map(p => procHTML(p)).join('') + common.map(p => procHTML(p, {common:true})).join('')
          : '<p class="empty">이 업체만의 처리 순서를 정리해 두면 다음 건을 진행할 때 체크리스트로 바로 불러올 수 있습니다.</p>'}
        ${typeFilter === '전체' && db.procedures.some(p => !p.clientId) ? '<p class="hint">업무 유형을 고르면 해당 공통 절차도 함께 보입니다.</p>' : ''}
      </section>
      <section>
        <div class="sec-head"><h3>업무 히스토리 <span class="cnt">${fr.length}건${actCount ? `, 진행 ${actCount}건` : ''}${spCount ? `, 특이 ${spCount}건` : ''}</span></h3><button class="mini" data-new-rec data-client="${esc(c.id)}">기록 추가</button></div>
        ${fr.length ? fr.map(r => recordHTML(r)).join('') : '<p class="empty">이 조건의 기록이 없습니다.</p>'}
      </section>
    </div>`;
}

/* ---------- 업체 주의 등급 (최근 12개월) ----------
   주의: 불합격·요건 미비·원산지 불인정이 있거나, 정정·보완 비율 30% 이상(3건 이상 중) 등 점수 2 이상.
   관심: 정정·보완 2건 이상(15%↑)·특이 30%↑·공공데이터 확인 알림·KC 확인 필요 중 하나. 업체 정보에서 직접 지정하면 그 값을 씀. */
let cautCache = {stamp:'', byClient:new Map(), res:new Map()};
function clientCaution(c){
  const stamp = (db.meta.updatedAt || '') + '|' + db.records.length + '|' + ((db.alerts || []).filter(a => a.status === 'open').length);
  if(cautCache.stamp !== stamp){                                       // 화면을 그릴 때마다 업체 수 × 기록 수를 다시 세지 않도록 한 번에 묶어 둠
    const since = addPeriod(today(), -12, 'm'), by = new Map();
    db.records.forEach(r => { if(recDate(r) >= since){ if(!by.has(r.clientId)) by.set(r.clientId, []); by.get(r.clientId).push(r); } });
    cautCache = {stamp, byClient:by, res:new Map()};
  }
  if(cautCache.res.has(c.id) && !c.cautionLevel) return cautCache.res.get(c.id);
  const out = clientCautionCalc(c, cautCache.byClient.get(c.id) || []);
  cautCache.res.set(c.id, out);
  return out;
}
function clientCautionCalc(c, recs){
  const reasons = [];
  const withCause = recs.filter(r => causesOf(r).length), hard = recs.filter(r => causesOf(r).some(k => CAUSE_HARD.includes(k))), sp = recs.filter(r => r.special);
  const rate = recs.length ? withCause.length / recs.length : 0;
  let score = 0;
  if(hard.length){ score += 2; reasons.push(`불합격·요건 미비·원산지 불인정 ${hard.length}건`); }
  if(recs.length >= 3 && rate >= 0.3){ score += 2; reasons.push(`정정·보완 ${Math.round(rate * 100)}% (${withCause.length}/${recs.length}건)`); }
  else if(withCause.length >= 2 && rate >= 0.15){ score += 1; reasons.push(`정정·보완 ${withCause.length}건`); }
  if(recs.length >= 3 && sp.length / recs.length >= 0.3){ score += 1; reasons.push(`특이 처리 ${sp.length}/${recs.length}건`); }
  const itemIds = new Set(db.items.filter(i => i.clientId === c.id).map(i => i.id));
  const al = typeof openAlerts === 'function' ? openAlerts().filter(a => a.ttype === 'item' && itemIds.has(a.tid)) : [];
  if(al.length){ score += 1; reasons.push(`확인 알림 ${al.length}건`); }
  const kcBad = (db.kc || []).filter(k => k.c === c.id && k.chk && (k.chk.st === 'none' || k.chk.st === 'model')).length;
  if(kcBad){ score += 1; reasons.push(`KC 확인 필요 ${kcBad}건`); }
  let level = score >= 2 ? '주의' : score === 1 ? '관심' : '보통';
  if(c.cautionLevel){ level = c.cautionLevel; reasons.unshift('직접 지정' + (c.cautionNote ? ': ' + c.cautionNote : '')); }
  return {level, reasons};
}
function cautionBadge(c){
  const x = clientCaution(c);
  return x.level === '보통' ? '' : `<span class="caution ${x.level === '주의' ? 'hi' : 'mid'}" title="${esc(x.reasons.join('\n'))}">${x.level}</span>`;
}
function amendSection(c){
  const cc = clientCauses(c.id);
  if(!cc.list.length) return '';
  return `<section class="amend">
    <div class="sec-head"><h3>정정·보완 주의 <span class="cnt">정정·보완·불합격 기록 ${cc.records}건 기준</span></h3></div>
    <div class="chips">${cc.list.map(([k,n]) => `<span class="chip">${esc(k)}<b>${n}</b></span>`).join('')}</div>
    <h4 class="sub">신고 전 점검표</h4>
    <ol class="pre-check">${cc.list.map(([k]) => `<li>${esc(CAUSE_HINTS[k])}</li>`).join('')}</ol>
    <p class="hint">새 건을 시작할 때 기록 창의 ‘정정 점검표 추가’로 체크리스트에 넣을 수 있습니다.</p>
  </section>`;
}

function clientContactsSection(c){
  const cc = c.contacts || [], rw = c.recentWork || [];
  return `<section class="items">
    <div class="sec-head"><h3>업체 담당자 <span class="cnt">${cc.length}명</span></h3><button class="mini" data-scan="${esc(c.id)}">메일에서 담당자 스캔</button></div>
    ${cc.length ? `<div class="table-wrap"><table class="grid cc-list"><thead><tr><th>이름</th><th>메일</th><th class="num">메일 수</th><th>최근</th><th></th></tr></thead><tbody>
      ${cc.map(p => `<tr><td>${esc(p.name || '')}</td><td><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></td><td class="num">${p.count || ''}</td><td>${esc(p.last || '')}</td><td><button class="mini" data-cc-del="${esc(c.id)}|${esc(p.email)}">빼기</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="empty">‘메일에서 담당자 스캔’을 누르면 최근 1년 메일에서 이 업체 담당자를 찾아 보여 줍니다. 업체 정보의 검색어에 메일 도메인(@abc.co.kr)을 넣어 두면 정확해집니다.</p>'}
    ${rw.length ? `<h4 class="sub">최근 메일로 오간 업무</h4><ul class="pre-check">${rw.slice(0,10).map(w => `<li><span class="hint">${esc(w.date)}</span> ${safeUrl(w.link) ? `<a href="${esc(w.link)}" target="_blank" rel="noopener noreferrer">${esc(w.subject)}</a>` : esc(w.subject)}</li>`).join('')}</ul><p class="hint">마지막 스캔 ${esc(c.scannedAt || '')} 기준입니다.</p>` : ''}
  </section>`;
}
async function scanContacts(cid){
  const c = db.clients.find(x => x.id === cid), cfg = db.settings.mail || {};
  if(!cfg.endpoint || !cfg.token){toast('먼저 데이터 메뉴에서 Apps Script 웹 앱 주소와 토큰을 넣어 주세요.'); return;}
  const kw = primaryKw(c);
  toast('메일을 살펴보는 중입니다…');
  let j;
  try{
    const u = new URL(cfg.endpoint); u.searchParams.set('token', cfg.token); u.searchParams.set('scan', kw); u.searchParams.set('days', '365');
    j = await (await fetch(u.href)).json();
    if(!j.ok) throw new Error(j.error || '응답 오류');
  }catch(e){toast('스캔하지 못했습니다: ' + e.message + ' (Apps Script를 새 버전으로 배포했는지 확인하세요)'); return;}
  const known = new Set((c.contacts || []).map(p => p.email));
  openDialog({
    title: `${c.name} 담당자 스캔 결과`,
    saveLabel: '선택한 담당자 저장',
    body: `<p class="hint">검색어 ‘${esc(kw)}’로 최근 1년 메일을 살펴봤습니다. 저장할 담당자를 고르세요.</p>
      <div class="scan-list">${(j.contacts || []).length ? j.contacts.map(p => `<label><input type="checkbox" name="pick" value="${esc(p.email)}"${known.has(p.email) || p.count >= 2 ? ' checked' : ''}> <span><strong>${esc(p.name || p.email)}</strong> <span class="hint">${esc(p.email)}, 메일 ${p.count}통, 최근 ${esc(p.last)}</span></span></label>`).join('') : '<p class="empty">찾은 담당자가 없습니다.</p>'}</div>
      ${(j.subjects || []).length ? `<h4 class="sub">최근 업무 메일 ${j.subjects.length}건</h4><ul class="pre-check">${j.subjects.slice(0,10).map(w => `<li><span class="hint">${esc(w.date)}</span> ${esc(w.subject)}</li>`).join('')}</ul><label class="check"><input type="checkbox" name="saveWork" checked> 업체 화면에 최근 업무로 표시</label>` : ''}`,
    onSave(fd){
      const picked = new Set(fd.getAll('pick'));
      const map = new Map((c.contacts || []).map(p => [p.email, p]));
      (j.contacts || []).filter(p => picked.has(p.email)).forEach(p => map.set(p.email, {...(map.get(p.email) || {}), ...p}));
      c.contacts = [...map.values()].sort((a,b) => (b.count || 0) - (a.count || 0));
      if(fd.get('saveWork') === 'on') c.recentWork = (j.subjects || []).slice(0,15);
      c.scannedAt = today();
      toast(`담당자 ${picked.size}명을 반영했습니다.`);
    }
  });
}

/* ---------- 거래업체 리스트 ---------- */
function normName(s){return String(s || '').replace(/\(예시\)|주식회사|유한회사|\(주\)|\(유\)|㈜|\s/g, '').toLowerCase();}
/* ---------- 업체 자동 인식 ----------
   1순위 담당자 메일 주소·메일 도메인 검색어, 2순위 검색어(약칭), 3순위 업체명.
   한글 두 글자 이하나 영문 이름은 앞뒤가 다른 글자와 붙어 있으면 인정하지 않는다(예: 두 글자 약칭이 더 긴 단어 안에 들어 있는 경우는 무시).
   같은 순위에서 길이가 같은 다른 업체가 함께 걸리면 추측하지 않고 미분류로 둔다. */
const FREE_MAIL = ['gmail.com','naver.com','daum.net','hanmail.net','nate.com','kakao.com','outlook.com','hotmail.com','yahoo.com','yahoo.co.kr','icloud.com','live.com','kita.net','korea.com','hanmir.com','empal.com'];   // kita.net: 무역협회 공용 메일 (여러 업체가 씀)
function kwList(c){return String(c.keyword || '').split(/[,;\n]/).map(x => x.trim().toLowerCase()).filter(Boolean);}
function primaryKw(c){const k = kwList(c); return (k.find(x => x.startsWith('@')) || k[0] || c.name || '').trim();}
function nameKey(s){return String(s || '').replace(/\(예시\)|주식회사|유한회사|\(주\)|\(유\)|㈜/g, '').replace(/\b(co\.?,?\s*ltd\.?|corp(oration)?\.?|inc\.?|ltd\.?|limited)\b/gi, '').replace(/\(.*?\)/g, '').replace(/[.,]+$/, '').trim().toLowerCase();}
function hasWord(text, w){
  const e = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s_-]*');
  return new RegExp(`(^|[^가-힣a-z0-9])${e}($|[^가-힣a-z0-9])`).test(text);
}
function nameHit(text, compact, w){
  if(!w || w.length < 2) return false;
  if(/^[\x00-\x7f]+$/.test(w) || w.replace(/\s/g, '').length <= 2) return hasWord(text, w);   // 영문이거나 두 글자 이하는 단어 경계 필요
  return compact.includes(w.replace(/\s+/g, ''));
}
function findClient(text){
  const t = String(text || '').toLowerCase(), compact = t.replace(/[\s_-]+/g, '');
  const addrs = t.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || [];
  const tiers = [[], [], []];
  db.clients.forEach(c => {
    const kws = kwList(c), doms = kws.filter(k => k.startsWith('@') && !FREE_MAIL.includes(k.slice(1)));
    const mails = (c.contacts || []).map(p => String(p.email || '').toLowerCase()).filter(e => e && !FREE_MAIL.includes(e.split('@')[1]));
    const m1 = Math.max(0, ...mails.filter(e => addrs.includes(e)).map(e => e.length), ...doms.filter(d => addrs.some(a => a.endsWith(d)) || t.includes(d)).map(d => d.length));
    if(m1) return tiers[0].push([c, m1]);
    const m2 = Math.max(0, ...kws.filter(k => !k.startsWith('@') && nameHit(t, compact, k)).map(k => k.length));
    if(m2) return tiers[1].push([c, m2]);
    const nk = nameKey(c.name), alt = nk.replace(/\s*(코리아|korea)$/i, '').trim();   // '티디에프코리아' → '티디에프'처럼 '코리아'를 뺀 약칭도 인정(3글자 이상)
    if(nameHit(t, compact, nk)) tiers[2].push([c, nk.length]);
    else if(alt !== nk && alt.replace(/\s/g, '').length >= 3 && nameHit(t, compact, alt)) tiers[2].push([c, alt.length]);
  });
  for(const tier of tiers){
    if(!tier.length) continue;
    const top = Math.max(...tier.map(x => x[1])), best = tier.filter(x => x[1] === top);
    return best.length === 1 ? best[0][0] : null;
  }
  return null;
}
function viewClientList(){
  const list = sortedClients();
  const types = c => [...new Set(db.records.filter(r => r.clientId === c.id).map(r => r.type))];
  return `<header class="client-head"><div><h2>거래업체 리스트</h2><p class="client-meta">업체 ${list.length}곳. 사업자등록증과 메일 기준으로 채웁니다.</p></div>
      <div class="client-act"><button class="primary" data-biz-import>사업자등록증 폴더 반영</button><button class="ghost" data-new-client>업체 추가</button></div></header>
    ${list.length ? `<div class="table-wrap" style="margin-top:1.25rem"><table class="grid"><thead><tr><th>회사명</th><th>대표자</th><th>사업장 소재지</th><th>업무담당자</th><th>관련업무</th></tr></thead><tbody>
      ${list.map(c => { const cc = (c.contacts || []).slice(0,2), ty = types(c), rw = (c.recentWork || []).slice(0,2); return `<tr>
        <td><button class="linkish" data-go="client" data-id="${esc(c.id)}"><strong>${esc(c.name)}</strong></button>${cautionBadge(c)}${c.bizNo ? `<div class="hint">${esc(c.bizNo)}</div>` : ''}</td>
        <td>${esc(c.rep || '')}</td>
        <td class="pre">${esc(c.address || '')}</td>
        <td>${cc.length ? cc.map(p => `<div>${esc(p.name || '')} <span class="hint">${esc(p.email)}</span></div>`).join('') : esc(c.contact || '')}</td>
        <td>${ty.map(t => `<span class="tag type">${esc(t)}</span> `).join('')}${rw.map(w => `<div class="hint">${esc(w.date)} ${esc(w.subject)}</div>`).join('')}</td>
      </tr>`; }).join('')}
    </tbody></table></div>` : '<p class="empty">업체가 없습니다. ‘사업자등록증 폴더 반영’으로 한 번에 채울 수 있습니다.</p>'}`;
}
async function bizImport(){
  const cfg = db.settings.mail || {};
  if(!cfg.endpoint || !cfg.token){toast('먼저 데이터 메뉴에서 Apps Script 웹 앱 주소와 토큰을 넣어 주세요.'); return;}
  const call = async params => { const u = new URL(cfg.endpoint); u.searchParams.set('token', cfg.token); Object.entries(params).forEach(([k,v]) => u.searchParams.set(k, v)); const j = await (await fetch(u.href)).json(); if(!j.ok) throw new Error(j.error || '응답 오류'); return j; };
  let j;
  try{
    do { j = await call({bizscan:1}); toast(`사업자등록증 읽는 중… ${j.items.length}/${j.total}`); } while(j.remaining > 0);
  }catch(e){toast('읽지 못했습니다: ' + e.message + ' (Apps Script 재배포와 Drive API 서비스 추가를 확인하세요)'); return;}
  const items = j.items.filter(x => x.name || x.biz);
  const match = it => db.clients.find(c => (it.biz && c.bizNo === it.biz) || (it.name && normName(c.name) === normName(it.name)));
  openDialog({
    title: `사업자등록증 ${items.length}건 반영`,
    saveLabel: '선택 항목 반영',
    body: `<p class="hint">폴더의 파일 ${j.total}개 중 ${items.length}건을 읽었습니다${j.failed ? `(읽기 실패 ${j.failed}건)` : ''}. 반영할 업체를 고르세요. 기존 업체는 등록번호나 상호가 같으면 합칩니다.</p>
      <label class="check"><input type="checkbox" name="mail" checked> 메일에서 업무담당자와 관련업무도 찾기 (업체당 몇 초씩 걸립니다)</label>
      <div class="table-wrap"><table class="grid"><thead><tr><th></th><th>회사명</th><th>대표자</th><th>사업장 소재지</th><th>반영</th></tr></thead><tbody>
      ${items.map((it, i) => { const m = match(it); return `<tr><td><input type="checkbox" name="pick" value="${i}" checked></td><td>${esc(it.name || '(상호 미인식)')}<div class="hint">${esc(it.biz || '')} ${safeUrl(it.link) ? `<a href="${esc(it.link)}" target="_blank" rel="noopener noreferrer">원본</a>` : ''}</div></td><td>${esc(it.rep)}</td><td class="pre">${esc(it.addr)}</td><td>${m ? `기존: ${esc(m.name)}` : '새 업체'}</td></tr>`; }).join('')}
      </tbody></table></div>`,
    onSave(fd){
      const picks = fd.getAll('pick').map(Number), withMail = fd.get('mail') === 'on';
      const touched = [];
      picks.forEach(i => {
        const it = items[i]; let c = match(it);
        if(!c){ c = {id:uid(), name: it.name || it.fileName, bizNo:'', industry:'', contact:'', keyword:'', notes:'', createdAt:nowIso()}; db.clients.push(c); }
        if(it.biz) c.bizNo = it.biz;
        if(it.rep) c.rep = it.rep;
        if(it.addr) c.address = it.addr;
        if(it.open) c.openDate = it.open;
        if(!c.industry && (it.type || it.item)) c.industry = [it.type, it.item].filter(Boolean).join(' / ');
        if(safeUrl(it.link)) c.bizDoc = it.link;
        touched.push(c);
      });
      $('#dlg').close(); route = {name:'clientlist', id:null}; commit();
      if(!withMail){ toast(`업체 ${touched.length}곳을 반영했습니다.`); return false; }
      (async () => {
        let k = 0;
        for(const c of touched){
          k++; toast(`메일 확인 중… ${k}/${touched.length} ${c.name}`);
          try{
            const r = await call({scan: primaryKw(c), days: 365});
            const map = new Map((c.contacts || []).map(p => [p.email, p]));
            (r.contacts || []).filter(p => p.count >= 2).slice(0,5).forEach(p => map.set(p.email, {...(map.get(p.email) || {}), ...p}));
            c.contacts = [...map.values()].sort((a,b) => (b.count || 0) - (a.count || 0));
            if((r.subjects || []).length) c.recentWork = r.subjects.slice(0,15);
            c.scannedAt = today();
          }catch(e){}
        }
        commit(); toast(`업체 ${touched.length}곳과 메일 담당자를 반영했습니다.`);
      })();
      return false;
    }
  });
}
