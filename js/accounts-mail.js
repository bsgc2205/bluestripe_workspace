'use strict';
/* ---------- 계정 관리 ---------- */
function viewAccounts(){
  if(!me || me.role !== 'admin') return '<h2>계정 관리</h2><p class="empty">관리자만 볼 수 있습니다.</p>';
  return `<header class="client-head"><div><h2>계정 관리</h2><p class="client-meta">계정마다 자기 아이디와 비밀번호로 같은 Workspace에 로그인합니다.</p></div>
      <div class="client-act"><button class="primary" data-acct-new>계정 추가</button></div></header>
    <div class="narrow table-wrap"><table class="grid"><thead><tr><th>아이디</th><th>이름</th><th>권한</th><th></th></tr></thead><tbody>
      ${accounts.map(a => `<tr><td>${esc(a.id)}${a.id === me.id ? ' <span class="hint">(나)</span>' : ''}</td><td>${esc(a.name)}</td><td>${a.role === 'admin' ? '관리자' : '일반'}</td><td><button class="mini" data-acct-edit="${esc(a.id)}">수정</button></td></tr>`).join('')}
    </tbody></table></div>
    <p class="hint narrow">계정을 추가·수정·삭제하면 Drive 자동 저장으로 다른 PC에 반영됩니다(자동 저장을 쓰지 않으면 암호화 파일을 새로 받아 Drive에 저장하세요). 계정을 지워도 그 전에 받아 둔 파일은 그 계정으로 열리므로, 퇴사자 계정을 지울 때는 Drive 공유와 이전 버전도 함께 정리하세요.</p>`;
}
function openAccount(a){
  const isNew = !a;
  openDialog({
    title: isNew ? '계정 추가' : '계정 수정',
    body: `<div class="row2"><label>아이디 (영문·숫자)<input name="id" value="${esc(a ? a.id : '')}" ${isNew ? 'required' : 'readonly'}></label><label>이름<input name="name" required value="${esc(a ? a.name : '')}"></label></div>
      <label>권한<select name="role">${opts([['member','일반'],['admin','관리자']], a ? a.role : 'member')}</select></label>
      <div class="row2"><label>${isNew ? '처음 비밀번호 (10자 이상)' : '새 비밀번호 (비우면 유지)'}<input type="password" name="pw" autocomplete="new-password"></label><label>비밀번호 확인<input type="password" name="pw2" autocomplete="new-password"></label></div>
      <p class="hint">처음 비밀번호는 본인에게 따로 전하고, 첫 로그인 뒤 데이터 메뉴의 ‘내 비밀번호 변경’에서 바꾸게 하세요.</p>`,
    onSave(fd){
      const id = fd.get('id').trim(), name = fd.get('name').trim(), role = fd.get('role'), pw = fd.get('pw'), pw2 = fd.get('pw2');
      const admins = accounts.filter(x => x.role === 'admin').length;
      if(isNew){
        if(!/^[A-Za-z0-9._-]{3,20}$/.test(id)){toast('아이디는 영문·숫자 3~20자로 정하세요.'); return false;}
        if(accounts.some(x => x.id.toLowerCase() === id.toLowerCase())){toast('이미 있는 아이디입니다.'); return false;}
        if(pw.length < 10){toast('처음 비밀번호는 10자 이상이어야 합니다.'); return false;}
      } else if(a.role === 'admin' && role !== 'admin' && admins < 2){toast('관리자가 한 명은 있어야 합니다.'); return false;}
      if(pw && pw.length < 10){toast('비밀번호는 10자 이상이어야 합니다.'); return false;}
      if(pw !== pw2){toast('두 비밀번호가 다릅니다.'); return false;}
      (async () => {
        if(isNew) accounts = [...accounts, await wrapFor(id, name, role, pw)];
        else {
          const w = pw ? await wrapFor(a.id, name, role, pw) : {...a, name, role};
          accounts = accounts.map(x => x.id === a.id ? w : x);
          if(a.id === me.id) me = {...me, name, role};
        }
        $('#dlg').close(); commit();
        toast(isNew ? `계정 ‘${id}’를 만들었습니다.${saveTip()}` : '계정을 수정했습니다.');
      })();
      return false;
    },
    onDelete: isNew || a.id === me.id ? null : () => {
      if(a.role === 'admin' && accounts.filter(x => x.role === 'admin').length < 2){toast('관리자가 한 명은 있어야 합니다.'); return false;}
      if(!confirm(`계정 ‘${a.id}’를 삭제할까요?`)) return false;
      accounts = accounts.filter(x => x.id !== a.id); toast('계정을 삭제했습니다.' + saveTip());
    }
  });
}

function viewCommon(){
  const ps = db.procedures.filter(p => !p.clientId).sort((a,b) => typeOrder(a.type) - typeOrder(b.type));
  return `<header class="client-head">
      <div><h2>공통 절차</h2><p class="client-meta">모든 업체에 적용하는 기본 처리 순서입니다. 업체 화면에서 업무 유형을 고르면 함께 보입니다.</p></div>
      <div class="client-act"><button class="primary" data-new-proc data-client="">공통 절차 추가</button></div>
    </header>
    <div class="narrow">${ps.length ? ps.map(p => procHTML(p)).join('') : '<p class="empty">아직 공통 절차가 없습니다.</p>'}</div>`;
}

function viewSearch(){
  const q = $('#q').value.trim();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  hlRe = new RegExp('(' + terms.map(t => esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  const sq = x => x.replace(/[\s\-\/.]/g, '');
  const has = s => { const s2 = sq(s); return terms.every(t => s.includes(t) || s2.includes(sq(t))); };
  const tOk = x => !sOpt.type || x.type === sOpt.type;
  const narrowed = sOpt.special || sOpt.type;
  const cl = narrowed ? [] : sortedClients().filter(c => has(hay(c.name, c.bizNo, c.industry, c.contact, c.notes, c.keyword)));
  const its = narrowed ? [] : db.items.filter(i => has(hay(i.name, i.hs, (i.hs||'').replace(/[.\-\s]/g,''), i.tariff, i.reqs, i.agency, i.notes, clientName(i.clientId))));
  const pr = sOpt.special ? [] : db.procedures.filter(p => tOk(p) && has(hay(p.title, p.type, p.steps, p.docs, p.cautions, clientName(p.clientId))));
  const rc = db.records.filter(r => tOk(r) && (!sOpt.special || r.special) && has(hay(r.title, r.type, r.status, r.refNo, r.bl, r.summary, r.specialNote, r.tags, r.checklist, causesOf(r), clientName(r.clientId), (db.items.find(i => i.id === r.itemId)||{}).name))).sort(byDateDesc);
  const kcs = narrowed ? [] : db.kc.filter(k => has(hay(k.a, k.m, k.no, k.n)));
  const total = cl.length + its.length + pr.length + rc.length + kcs.length;
  return `<h2>‘${esc(q)}’ 검색 결과</h2>
    <div class="filters">
      <label class="inline">업무 유형 <select id="sType"><option value="">전체</option>${opts(db.settings.taskTypes, sOpt.type)}</select></label>
      <label class="check"><input type="checkbox" id="sSpecial"${sOpt.special ? ' checked' : ''}> 특이 처리만</label>
      <span class="hint">업체 ${cl.length}곳, 품목 ${its.length}개, 절차 ${pr.length}건, 기록 ${rc.length}건${kcs.length ? `, KC ${kcs.length}건` : ''}</span>
    </div>
    ${/^[A-Za-z0-9\-]{8,}$/.test(q) ? `<div class="setup"><div class="btn-row"><span>‘${esc(q)}’를 B/L 번호로 UNI-PASS 화물진행정보에서 찾아볼까요?</span><button class="mini strong" data-bl-q="${esc(q)}">UNI-PASS 조회</button></div><div id="blInline"></div></div>` : ''}
    ${total ? '' : '<p class="empty">찾는 내용이 없습니다. 단어를 줄이거나 다른 표현으로 검색해 보세요. 여러 단어는 모두 포함된 결과만 보여 줍니다.</p>'}
    ${cl.length ? `<section class="result-block"><div class="sec-head"><h3>업체</h3></div><div class="chips">${cl.map(c => `<button class="chip" data-go="client" data-id="${esc(c.id)}">${hl(c.name)}</button>`).join('')}</div></section>` : ''}
    ${its.length ? `<section class="result-block"><div class="sec-head"><h3>품목·요건</h3></div><div class="table-wrap"><table class="grid"><thead><tr><th>업체</th><th>품목</th><th>HS 코드</th><th>세율·FTA</th><th>수입요건</th></tr></thead><tbody>
      ${its.map(i => `<tr><td><button class="linkish" data-go="client" data-id="${esc(i.clientId)}">${esc(clientName(i.clientId))}</button></td><td>${hl(i.name)}</td><td class="hs">${hl(i.hs)}</td><td>${hl(i.tariff)}</td><td class="pre">${hl(i.reqs)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
    ${kcs.length ? `<section class="result-block"><div class="sec-head"><h3>KC 인증 목록 <span class="cnt">${kcs.length}건</span></h3></div>${kcTableHTML(kcs, true)}</section>` : ''}
    ${pr.length ? `<section class="result-block narrow"><div class="sec-head"><h3>처리 절차</h3></div>${pr.map(p => procHTML(p, {showClient:true})).join('')}</section>` : ''}
    ${rc.length ? `<section class="result-block narrow"><div class="sec-head"><h3>업무 기록</h3></div>${rc.map(r => recordHTML(r, {showClient:true})).join('')}</section>` : ''}`;
}

function monthLabel(ym){const [y,m] = ym.split('-'); return `${y}년 ${Number(m)}월`;}
function shiftMonth(ym, n){const [y,m] = ym.split('-').map(Number); const t = (m-1) + n; return `${y + Math.floor(t/12)}-${String(((t%12)+12)%12 + 1).padStart(2,'0')}`;}
function doneIn(ym){return db.records.filter(r => r.status === '완료' && (r.date || '').startsWith(ym));}
function viewReport(){
  const mon = rptMonth || today().slice(0,7);
  const done = doneIn(mon).sort(byDateDesc);
  const sp = done.filter(r => r.special).length;
  const fee = done.reduce((s,r) => s + (r.fee || 0), 0);
  const opened = db.records.filter(r => (r.startDate || '').startsWith(mon)).length;
  const dueIn = db.records.flatMap(r => r.deadlines || []).filter(d => d.due.startsWith(mon)).length;
  const byClient = {}, byType = {};
  done.forEach(r => {
    const c = byClient[r.clientId] = byClient[r.clientId] || {n:0, sp:0, fee:0};
    c.n++; if(r.special) c.sp++; c.fee += r.fee || 0;
    byType[r.type] = (byType[r.type] || 0) + 1;
  });
  const months = Array.from({length:12}, (_,i) => shiftMonth(mon, i - 11));
  const counts = months.map(m => doneIn(m).length), max = Math.max(1, ...counts);
  const clientRows = Object.entries(byClient).sort((a,b) => b[1].n - a[1].n);
  const typeRows = Object.entries(byType).sort((a,b) => b[1] - a[1]);
  return `<header class="client-head">
      <div><h2>${monthLabel(mon)} 리포트</h2></div>
      <div class="client-act"><label class="inline">월 선택 <input type="month" id="rptMonth" value="${mon}"></label><button class="ghost" data-csv="${mon}">청구용 CSV 받기</button></div>
    </header>
    <p class="report-lead">이 달 완료 ${done.length}건 가운데 특이 처리가 ${sp}건${done.length ? `(${Math.round(sp / done.length * 100)}%)` : ''}이고, 기록된 대행 수수료 합계는 ${won(fee)}입니다. 같은 달에 새로 접수한 업무는 ${opened}건, 기한이 이 달에 돌아오는 항목은 ${dueIn}건입니다.</p>
    <div class="bars" role="group" aria-label="최근 12개월 완료 건수">
      ${months.map((m,i) => `<button class="bar${m === mon ? ' on' : ''}" data-month="${m}" title="${monthLabel(m)} ${counts[i]}건"><b>${counts[i]}</b><i style="height:${Math.round(counts[i] / max * 100)}%"></i><span>${Number(m.slice(5))}월</span></button>`).join('')}
    </div>
    <div class="two-col">
      <section><div class="sec-head"><h3>업체별</h3></div>
        ${clientRows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>업체</th><th class="num">완료</th><th class="num">특이</th><th class="num">수수료</th></tr></thead><tbody>
          ${clientRows.map(([id,v]) => `<tr><td><button class="linkish" data-go="client" data-id="${esc(id)}">${esc(clientName(id))}</button></td><td class="num">${v.n}</td><td class="num">${v.sp}</td><td class="num">${won(v.fee)}</td></tr>`).join('')}
          <tr><td><strong>합계</strong></td><td class="num"><strong>${done.length}</strong></td><td class="num"><strong>${sp}</strong></td><td class="num"><strong>${won(fee)}</strong></td></tr>
        </tbody></table></div>` : '<p class="empty">이 달에 완료한 기록이 없습니다.</p>'}
      </section>
      <section><div class="sec-head"><h3>업무 유형별</h3></div>
        ${typeRows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>업무 유형</th><th class="num">건수</th></tr></thead><tbody>${typeRows.map(([t,n]) => `<tr><td>${esc(t)}</td><td class="num">${n}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">이 달에 완료한 기록이 없습니다.</p>'}
      </section>
    </div>
    ${(() => {
      const m = {}, perClient = {};
      db.records.filter(r => recDate(r).startsWith(mon)).forEach(r => causesOf(r).forEach(k => { m[k] = (m[k] || 0) + 1; perClient[r.clientId] = (perClient[r.clientId] || 0) + 1; }));
      const rows = Object.entries(m).sort((a,b) => b[1] - a[1]);
      if(!rows.length) return '';
      const top = Object.entries(perClient).sort((a,b) => b[1] - a[1]).slice(0,5);
      return `<div class="two-col"><section><div class="sec-head"><h3>정정·보완 원인</h3></div><div class="table-wrap"><table class="grid"><thead><tr><th>원인</th><th class="num">건수</th></tr></thead><tbody>${rows.map(([k,n]) => `<tr><td>${esc(k)}</td><td class="num">${n}</td></tr>`).join('')}</tbody></table></div></section>
        <section><div class="sec-head"><h3>정정이 많은 업체</h3></div><div class="table-wrap"><table class="grid"><thead><tr><th>업체</th><th class="num">원인 건수</th></tr></thead><tbody>${top.map(([id,n]) => `<tr><td><button class="linkish" data-go="client" data-id="${esc(id)}">${esc(clientName(id))}</button></td><td class="num">${n}</td></tr>`).join('')}</tbody></table></div></section></div>`;
    })()}
    <section class="result-block narrow"><div class="sec-head"><h3>완료 기록 <span class="cnt">${done.length}건</span></h3></div>
      ${done.length ? done.map(r => recordHTML(r, {showClient:true, compact:true})).join('') : '<p class="empty">이 달에 완료한 기록이 없습니다.</p>'}
    </section>`;
}
function exportCsv(mon){
  const rows = doneIn(mon).sort((a,b) => (a.date||'').localeCompare(b.date||''));
  const cell = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
  const head = ['완료일','업체','업무 유형','참조번호','제목','특이 처리','대행 수수료'];
  const body = rows.map(r => [r.date, clientName(r.clientId), r.type, r.refNo, r.title, r.special ? 'Y' : '', r.fee || ''].map(cell).join(','));
  download(`BSGC-Workspace-${mon}.csv`, '\uFEFF' + [head.map(cell).join(','), ...body].join('\r\n'), 'text/csv;charset=utf-8');
}

/* ---------- mail ---------- */
function matchClient(m){ return findClient([m.from, m.lastFrom, m.subject, m.snippet].filter(Boolean).join(' ')); }
function findRefNo(text){const m = String(text||'').match(/\b\d{5}-\d{2}-\d{6,7}[A-Z]?\b/); return m ? m[0] : '';}
function viewMail(){
  const cfg = db.settings.mail || {};
  if(!cfg.endpoint || !cfg.token) return `<h2>메일 초안</h2>
    <div class="setup"><p>Gmail에서 ‘업무완료’ 라벨을 붙인 메일을 기록 초안으로 가져옵니다. 처음 한 번 설정이 필요합니다.</p>
    <ol><li>함께 받은 <strong>gmail-to-ledger.gs</strong>를 Google Apps Script에 붙여 넣고 <code>setup</code>을 한 번 실행합니다.</li>
    <li>웹 앱으로 배포해 받은 주소와, 실행 기록에 표시된 토큰을 복사합니다.</li>
    <li>오른쪽 위 ‘데이터’ 메뉴의 Gmail 연동 칸에 붙여 넣고 저장합니다.</li></ol>
    <p class="hint">자세한 순서는 README의 ‘Gmail 라벨 연동’을 보세요.</p>
    <button class="primary" data-open-data>데이터 메뉴 열기</button></div>`;
  const list = (mailCache || []).filter(m => !db.mailSeen.includes(m.id));
  return `<header class="client-head"><div><h2>메일 초안</h2><p class="client-meta">‘업무완료’ 라벨이 붙은 메일 가운데 아직 기록하지 않은 것입니다.</p></div>
      <div class="client-act"><button class="primary" data-mail-load${mailLoading ? ' disabled' : ''}>${mailLoading ? '불러오는 중…' : '메일 불러오기'}</button></div></header>
    ${mailErr ? `<p class="msg">${esc(mailErr)}</p>` : ''}
    <div class="narrow">
    ${mailCache === null ? '<p class="empty">‘메일 불러오기’를 누르면 Gmail에서 라벨 붙은 메일을 가져옵니다.</p>'
      : list.length ? list.map(m => { const c = matchClient(m); return `<article class="rec">
        <div class="rec-date">${esc(m.date)}${m.count > 1 ? `<small>메일 ${m.count}통</small>` : ''}</div>
        <div class="rec-body"><h4>${esc(m.subject)}</h4>
          <div class="rec-meta"><span>${esc(m.from)}</span>${c ? `<span class="tag">${esc(c.name)}</span>` : '<span class="tag type">업체 미지정</span>'}</div>
          ${m.summary ? `<p class="rec-sum">${esc(m.summary)}</p>` : m.snippet ? `<p class="rec-sum">${esc(m.snippet)}</p>` : ''}
          ${safeUrl(m.link) ? `<div class="links"><a href="${esc(m.link)}" target="_blank" rel="noopener noreferrer">Gmail에서 열기</a></div>` : ''}
        </div>
        <div class="rec-act"><button class="mini strong" data-mail-make="${esc(m.id)}">기록 만들기</button><button class="mini" data-mail-ignore="${esc(m.id)}">무시</button></div>
      </article>`; }).join('')
      : '<p class="empty">새로 기록할 메일이 없습니다.</p>'}
    </div>`;
}
async function loadMail(){
  const cfg = db.settings.mail;
  mailLoading = true; mailErr = ''; renderView();
  try{
    const u = new URL(cfg.endpoint); u.searchParams.set('token', cfg.token); u.searchParams.set('days', '90');
    const r = await fetch(u.href);
    const j = await r.json();
    if(!j.ok) throw new Error(j.error || '응답 오류');
    mailCache = j.items || [];
  }catch(e){
    mailErr = `메일을 불러오지 못했습니다 (${e.message}). 웹 앱 주소, 토큰, 배포 권한(모든 사용자)을 확인하세요.`;
  }
  mailLoading = false; renderSidebar(); renderView();
}
function markMailDone(m){
  const cfg = db.settings.mail;
  if(!cfg.endpoint || !m.threadId) return;
  try{const u = new URL(cfg.endpoint); u.searchParams.set('token', cfg.token); u.searchParams.set('done', m.threadId); fetch(u.href).catch(() => {});}catch{}
}
function seeMail(id){db.mailSeen.push(id); if(db.mailSeen.length > 3000) db.mailSeen = db.mailSeen.slice(-3000);}
