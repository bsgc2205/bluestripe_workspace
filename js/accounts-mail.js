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
  const rc = db.records.filter(r => tOk(r) && (!sOpt.special || r.special) && has(hay(r.caseNo, r.title, r.type, r.status, r.refNo, r.bl, r.summary, (r.files || []).map(f => f.name).join(' '), (r.mails || []).map(x => x.subject + ' ' + x.from + ' ' + (x.files || []).join(' ')).join(' '), r.specialNote, r.tags, r.checklist, causesOf(r), clientName(r.clientId), (db.items.find(i => i.id === r.itemId)||{}).name))).sort(byDateDesc);
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

/* ---------- customs@ 메일 (한비로 → 사무실 PC 수집기 → Apps Script 'BSGC 메일 색인' 시트) ----------
   같은 대화(제목에서 RE:/FW:와 숫자 없는 [머리말]을 뺀 것)는 한 줄로 묶는다.
   자동 연결 순서: 제목의 케이스 번호 → 이미 기록에 붙인 대화 → B/L·신고번호로 기록이 하나로 정해질 때. 나머지는 화면에서 고른다. */
function mailText(m){return [m.fwdFrom, m.from, m.fromName, m.to, m.cc, m.subject, m.snippet, (m.attachments || []).join(' ')].filter(Boolean).join(' ');}
function matchClient(m){ return findClient(Array.isArray(m) ? m.map(mailText).join(' ') : mailText(m)); }
function findRefNo(text){const m = String(text||'').match(/\b\d{5}-\d{2}-\d{6,7}[A-Z]?\b/); return m ? m[0] : '';}
const refKey = s => String(s || '').toUpperCase().replace(/[-\s]/g, '');
function threadKey(subject){
  let t = String(subject || '').toLowerCase();
  t = t.replace(/\[[^\]\d]*\]/g, ' ');                                   // [정산서], [BSGC-TROPI] 같은 숫자 없는 머리말
  t = t.replace(/(^|\s|\]|:)(re|fw|fwd|답장|회신|전달|r)\s*(\[\d+\])?\s*[:：]/g, ' ');
  return t.replace(/[\s:：\-_/|,.]+/g, ' ').trim().slice(0, 120);
}
function mailRecord(m){
  const cm = CASE_RE.exec(m.caseNo || m.subject || '');
  if(cm){ const r = db.records.find(x => x.caseNo === cm[0]); if(r) return r; }
  const th = (db.mailThreads || {})[threadKey(m.subject)];
  if(th){ const r = db.records.find(x => x.id === th); if(r) return r; }
  const keys = [m.bl, m.declNo].map(refKey).filter(k => k.length >= 6);
  if(!keys.length) return null;
  const hits = db.records.filter(r => keys.includes(refKey(r.bl)) || keys.includes(refKey(r.refNo)));
  if(hits.length <= 1) return hits[0] || null;
  const open = hits.filter(r => r.status !== '완료');
  return open.length === 1 ? open[0] : null;            // 여러 건이면 추측하지 않음
}
function attachMail(r, m){
  r.mails = r.mails || [];
  db.mailThreads = db.mailThreads || {};
  const k = threadKey(m.subject);
  if(k.length >= 4) db.mailThreads[k] = r.id;
  if(r.mails.some(x => x.id === m.id)) return false;
  r.mails.push({id:m.id, date:m.date || '', from:m.fwdFrom || (m.fromName ? `${m.fromName} <${m.from}>` : m.from), subject:m.subject || '', files:(m.attachments || []).slice(0, 10)});
  r.mails.sort((a, b) => a.date < b.date ? -1 : 1);
  if(!r.bl && m.bl) r.bl = m.bl;
  if(!r.refNo && m.declNo) r.refNo = m.declNo;
  r.updatedAt = nowIso();
  return true;
}
function pruneThreads(){
  const ids = new Set(db.records.map(r => r.id)), t = db.mailThreads || {};
  const keys = Object.keys(t).filter(k => ids.has(t[k]));
  db.mailThreads = Object.fromEntries(keys.slice(-3000).map(k => [k, t[k]]));
}
function mailsHTML(r){
  const ms = r.mails || [];
  if(!ms.length) return '';
  return `<details class="rec-mails"><summary>customs@ 메일 ${ms.length}통</summary><ul>${ms.map(x => `<li><span class="rec-date">${esc(String(x.date).replace('T', ' '))}</span> ${hl(x.subject)} <span class="hint">${esc(x.from)}</span>${(x.files || []).length ? `<div class="hint">첨부: ${esc(x.files.join(', '))}</div>` : ''}</li>`).join('')}</ul></details>`;
}
function mailThreadsList(){
  const groups = new Map();
  (mailCache || []).filter(m => !db.mailSeen.includes(m.id)).forEach(m => {
    const k = threadKey(m.subject) || m.id;
    if(!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  });
  return [...groups.entries()].map(([key, ms]) => { ms.sort((a, b) => a.date < b.date ? -1 : 1); return {key, ms, last:ms[ms.length - 1]}; })
    .sort((a, b) => a.last.date < b.last.date ? 1 : -1);
}
function findThread(key){ return mailThreadsList().find(t => t.key === key); }
function viewMail(){
  const cfg = db.settings.mail || {};
  if(!cfg.endpoint || !cfg.token) return `<h2>customs@ 메일</h2>
    <div class="setup"><p>한비로 customs@bsgc.co.kr로 들어온 메일을 업무 기록과 연결합니다. 사무실 PC의 메일 수집기와 Apps Script 연동이 필요합니다.</p>
    <p class="hint">설치 순서는 README의 ‘customs@ 메일 수집’을 보세요.</p>
    <button class="primary" data-open-data>데이터 메뉴 열기</button></div>`;
  const ths = mailThreadsList();
  return `<header class="client-head"><div><h2>customs@ 메일</h2><p class="client-meta">최근 60일 customs@ 메일 중 아직 기록과 연결하지 않은 대화 ${ths.length}건입니다. 제목에 케이스 번호([2026-I-001])가 있거나, 이미 기록에 붙인 대화의 회신이거나, B/L·신고번호로 기록이 하나로 정해지면 자동으로 붙습니다.</p></div>
      <div class="client-act"><button class="primary" data-mail-load${mailLoading ? ' disabled' : ''}>${mailLoading ? '불러오는 중…' : '새로 불러오기'}</button></div></header>
    ${mailErr ? `<p class="msg">${esc(mailErr)}</p>` : ''}
    <div class="narrow">
    ${mailCache === null ? '<p class="empty">‘새로 불러오기’를 누르면 메일 색인에서 가져옵니다.</p>'
      : ths.length ? ths.map(t => { const m = t.last, c = matchClient(t.ms);
        const refs = [...new Set(t.ms.flatMap(x => [x.bl && `B/L ${x.bl}`, x.declNo && `신고 ${x.declNo}`].filter(Boolean)))];
        const files = [...new Set(t.ms.flatMap(x => x.attachments || []))];
        const people = [...new Set(t.ms.map(x => x.fwdFrom ? `전달: ${x.fwdFrom}` : (x.fromName || x.from)))];
        const first = t.ms[0];
        return `<article class="rec">
        <div class="rec-date">${esc(String(m.date).slice(0, 10))}<small>${t.ms.length > 1 ? `${t.ms.length}통 · ${esc(String(first.date).slice(5, 10))}~` : esc(String(m.date).slice(11, 16))}</small></div>
        <div class="rec-body"><h4>${esc(m.subject || '(제목 없음)')}</h4>
          <div class="rec-meta"><span>${esc(people.slice(0, 4).join(', '))}${people.length > 4 ? ` 외 ${people.length - 4}명` : ''}</span>${c ? `<span class="tag">${esc(c.name)}</span>` : '<span class="tag type">업체 미지정</span>'}${refs.slice(0, 4).map(x => `<span class="tag">${esc(x)}</span>`).join('')}</div>
          ${m.snippet ? `<p class="rec-sum">${esc(m.snippet)}</p>` : ''}
          ${files.length ? `<div class="hint">첨부 ${files.length}개: ${esc(files.slice(0, 6).join(', '))}${files.length > 6 ? ' …' : ''}</div>` : ''}
        </div>
        <div class="rec-act"><button class="mini strong" data-mail-make="${esc(t.key)}">기록 만들기</button><button class="mini" data-mail-attach="${esc(t.key)}">기록에 붙이기</button><button class="mini" data-mail-ignore="${esc(t.key)}">무시</button></div>
      </article>`; }).join('')
      : '<p class="empty">새로 연결할 메일이 없습니다.</p>'}
    </div>`;
}
function autoAttachMails(){
  let n = 0;
  (mailCache || []).filter(m => !db.mailSeen.includes(m.id)).sort((a, b) => a.date < b.date ? -1 : 1).forEach(m => {
    const r = mailRecord(m);
    if(r && attachMail(r, m)){ seeMail(m.id); n++; }
    else if(r) seeMail(m.id);
  });
  return n;
}
async function loadMail(manual = true){
  mailLoading = true; mailErr = ''; if(route.name === 'mail') renderView();
  try{
    const j = await collectApi({mails:1, days:60});
    mailCache = j.items || [];
    const n = autoAttachMails();
    if(n){ pruneThreads(); commit(); toast(`customs@ 메일 ${n}통을 기존 기록에 자동으로 붙였습니다.`); }
  }catch(e){
    mailErr = `메일을 불러오지 못했습니다 (${e.message}).`;
    if(manual) toast(mailErr);
  }
  mailLoading = false; renderSidebar(); if(route.name === 'mail') renderView();
}
function openAttachMail(t){
  const c = matchClient(t.ms);
  const recs = db.records.slice().sort((a, b) => (a.status === '완료') - (b.status === '완료') || (c ? (b.clientId === c.id) - (a.clientId === c.id) : 0) || byDateDesc(a, b)).slice(0, 80);
  if(!recs.length){ toast('붙일 기록이 없습니다. ‘기록 만들기’를 쓰세요.'); return; }
  openDialog({
    title: '기록에 메일 붙이기',
    saveLabel: '붙이기',
    body: `<p class="hint">${esc(t.last.subject || '')} (${t.ms.length}통). 붙이면 이 대화의 이후 회신도 같은 기록에 자동으로 붙습니다.</p>
      <label>기록<select name="rid">${opts(recs.map(r => [r.id, `${r.status === '완료' ? '' : '[진행중] '}${r.caseNo ? r.caseNo + ' · ' : ''}${clientName(r.clientId)} · ${recDate(r)} · ${r.title}`]), recs[0].id)}</select></label>`,
    onSave(fd){
      const r = db.records.find(x => x.id === fd.get('rid'));
      if(!r) return false;
      t.ms.forEach(m => { attachMail(r, m); seeMail(m.id); });
      toast(`기록에 메일 ${t.ms.length}통을 붙였습니다.`);
    }
  });
}
function markMailDone(){}
function seeMail(id){ if(!db.mailSeen.includes(id)) db.mailSeen.push(id); if(db.mailSeen.length > 5000) db.mailSeen = db.mailSeen.slice(-5000); }
