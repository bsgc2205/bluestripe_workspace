'use strict';
/* ---------- 계정 관리 ---------- */
function viewAccounts(){
  if(!me || me.role !== 'admin') return '<h2>계정 관리</h2><p class="empty">관리자만 볼 수 있습니다.</p>';
  return `<header class="client-head"><div><h2>계정 관리</h2><p class="client-meta">계정마다 자기 아이디와 비밀번호로 같은 Workspace에 로그인합니다.</p></div>
      <div class="client-act"><button class="primary" data-acct-new>계정 추가</button></div></header>
    <div class="narrow table-wrap"><table class="grid"><thead><tr><th>아이디</th><th>이름</th><th>권한</th><th></th></tr></thead><tbody>
      ${accounts.map(a => `<tr><td>${esc(a.id)}${a.id === me.id ? ' <span class="hint">(나)</span>' : ''}</td><td>${esc(a.name)}</td><td>${a.role === 'admin' ? '관리자' : '일반'}</td><td><button class="mini" data-acct-edit="${esc(a.id)}">수정</button></td></tr>`).join('')}
    </tbody></table></div>
    <p class="hint narrow">계정을 추가·수정·삭제하면 Drive 자동 저장으로 다른 PC에 반영됩니다(자동 저장을 쓰지 않으면 암호화 파일을 새로 받아 Drive에 저장하세요). 계정을 지워도 그 전에 받아 둔 파일은 그 계정으로 열리므로, 퇴사자 계정을 지울 때는 Drive 공유와 이전 버전도 함께 정리하세요.</p>
    ${pcLinkSectionHTML()}`;
}
/* ---------- PC 연결: 1회용 연결 코드와 직원별 토큰 (11/11) ----------
   관리자가 계정마다 6자리 코드를 만들면(10분, 한 번만) 직원은 첫 화면에서 그 코드로 연결해 그 PC 전용 토큰을 받는다.
   연결 링크(#pair=웹 앱 주소)는 비밀이 아니므로 메신저로 보내도 되고, 코드만 말로 불러 준다. 토큰 원문은 화면에 나오지 않는다. */
let pcLink = {list:null, err:'', who:null, code:null, busy:false};
function pairLinkUrl(){ const ep = (db.settings.mail || {}).endpoint || ''; return location.origin + location.pathname + '#pair=' + btoa(unescape(encodeURIComponent(ep))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function pcLinkLoad(){
  const cfg = syncCfg(); if(!cfg){ pcLink.err = 'Apps Script 연동이 꺼져 있습니다.'; return; }
  try{
    const w = await syncPost(cfg, {op:'whoami'}); pcLink.who = w.ok ? w : null;
    if(w.ok && w.admin){ const j = await syncPost(cfg, {op:'tokens'}); if(!j.ok) throw new Error(j.error || '응답 오류'); pcLink.list = j.items || []; pcLink.err = ''; }
    else pcLink.err = w.ok ? '이 PC는 직원 토큰으로 연결돼 있어 연결 코드를 만들 수 없습니다. 관리자 토큰이 있는 PC에서 하세요.' : (w.error || '');
  }catch(e){ pcLink.err = /알 수 없는 요청/.test(e.message) ? 'Apps Script를 새 버전으로 배포해야 PC 연결을 쓸 수 있습니다.' : e.message; }
  if(route.name === 'accounts') renderView();
}
function pcLinkSectionHTML(){
  if(pcLink.list === null && !pcLink.err && !pcLink.busy){ pcLink.busy = true; setTimeout(() => pcLinkLoad().finally(() => { pcLink.busy = false; }), 30); }
  const w = pcLink.who, c = pcLink.code, left = c ? Math.max(0, Math.round((c.until - Date.now()) / 60000)) : 0;
  const rows = (pcLink.list || []).map(t => `<tr class="${t.off ? 'q-hide' : ''}"><td>${esc(t.name || t.sid)} <span class="hint">${esc(t.sid)}</span>${t.admin ? ' <span class="tag">관리자</span>' : ''}</td><td>${esc(t.label || '')}</td><td>${esc(String(t.at || '').replace('T', ' '))}</td><td>${esc(String(t.last || '').replace('T', ' ') || '-')}</td><td>${t.off ? '끊김' : '사용 중'}</td><td>${t.off ? '' : `<button class="mini" data-pc-revoke="${esc(t.id)}">끊기</button>`}</td></tr>`).join('');
  return `<section class="items narrow"><div class="sec-head"><h3>PC 연결 (직원별 토큰)</h3><button class="mini" data-pc-reload>새로고침</button></div>
    <p class="hint">직원 PC·휴대폰을 처음 연결할 때: ① 아래에서 그 직원의 ‘연결 코드 만들기’ → ② ‘연결 링크 복사’로 링크를 보내거나(링크만으로는 열리지 않음) 그 PC에서 Workspace 첫 화면의 ‘서버 주소로 연결’을 엽니다 → ③ 6자리 코드는 말로 불러 주거나 직접 입력합니다. 코드는 10분 동안 한 번만 쓰이고, 그 PC 전용 토큰이 발급됩니다. 퇴사·분실 때는 그 PC만 ‘끊기’ 합니다.</p>
    ${w ? `<p class="hint">이 PC: ${w.master ? '공용(관리자) 토큰' : `직원 토큰 — ${esc(w.name || w.sid)}${w.admin ? ' (관리자)' : ''}`}</p>` : ''}
    ${pcLink.err ? `<p class="msg">${esc(pcLink.err)}</p>` : ''}
    ${c && left > 0 ? `<div class="pc-code"><div>연결 코드 <strong>${esc(c.code.slice(0, 3))} ${esc(c.code.slice(3))}</strong></div><div class="hint">${esc(c.name)}(${esc(c.sid)}) · 약 ${left}분 남음 · 한 번만 쓸 수 있음</div><button class="mini" data-pc-copylink>연결 링크 복사</button> <button class="mini" data-pc-hide>코드 숨기기</button></div>` : ''}
    ${w && w.admin ? `<div class="table-wrap"><table class="grid"><thead><tr><th>계정</th><th></th></tr></thead><tbody>${accounts.map(a => `<tr><td>${esc(a.name)} <span class="hint">${esc(a.id)}${a.role === 'admin' ? ' · 관리자' : ''}</span></td><td><button class="mini strong" data-pc-pair="${esc(a.id)}">연결 코드 만들기</button></td></tr>`).join('')}</tbody></table></div>
      <h4 class="sub">연결된 PC</h4>${rows ? `<div class="table-wrap"><table class="grid"><thead><tr><th>계정</th><th>PC 이름</th><th>연결</th><th>마지막 사용</th><th>상태</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">아직 연결 코드로 연결한 PC가 없습니다.</p>'}
      <details class="more fold"><summary>공용 토큰 정리 (테스트 주간 뒤 한 번)</summary><ol class="hint">
        <li>직원 PC마다 연결 코드로 다시 연결합니다(잠그기 → 첫 화면 ‘서버 주소로 연결’ → 코드 입력). 위 목록에 모두 보이는지 확인합니다.</li>
        <li>Apps Script 편집기에서 <code>resetToken</code>을 실행해 공용 토큰을 바꿉니다(실행 기록에 새 토큰이 나옴).</li>
        <li>관리자 PC: 데이터 → ‘이 PC의 토큰’에 새 토큰을 넣습니다. 사무실 PC 메일 수집기: <code>python bsgc_mail_collector.py --setup</code>으로 새 토큰을 넣습니다.</li>
        <li>예전 공용 토큰을 아는 PC는 이제 연결되지 않습니다. 직원 토큰은 그대로입니다.</li></ol></details>` : ''}
  </section>`;
}
document.addEventListener('click', async e => {
  if(typeof db === 'undefined' || !db) return;
  const b = e.target.closest('[data-pc-pair],[data-pc-revoke],[data-pc-reload],[data-pc-copylink],[data-pc-hide]'); if(!b) return;
  const d = b.dataset, cfg = syncCfg();
  if('pcReload' in d){ pcLink.list = null; pcLink.err = ''; renderView(); return; }
  if('pcHide' in d){ pcLink.code = null; renderView(); return; }
  if('pcCopylink' in d){ try{ await navigator.clipboard.writeText(pairLinkUrl()); toast('연결 링크를 복사했습니다. 링크만으로는 열리지 않고, 코드는 따로 불러 주세요.'); }catch{ prompt('연결 링크', pairLinkUrl()); } return; }
  if(!cfg){ toast('Apps Script 연동이 꺼져 있습니다.'); return; }
  if('pcPair' in d){
    const a = accounts.find(x => x.id === d.pcPair); if(!a) return;
    try{ const j = await syncPost(cfg, {op:'pair', sid:a.id, name:a.name, admin:a.role === 'admin'}); if(!j.ok) throw new Error(j.error || '응답 오류');
      pcLink.code = {code:j.code, sid:a.id, name:a.name, until:Date.now() + (j.ttl || 600) * 1000}; renderView();
      setTimeout(() => { if(pcLink.code && Date.now() > pcLink.code.until){ pcLink.code = null; if(route.name === 'accounts') renderView(); } }, (j.ttl || 600) * 1000 + 500);
    }catch(err){ toast('연결 코드를 만들지 못했습니다: ' + err.message); }
  }
  if('pcRevoke' in d){
    const t = (pcLink.list || []).find(x => x.id === d.pcRevoke);
    if(!t || !confirm(`${t.name || t.sid}의 ‘${t.label || 'PC'}’ 연결을 끊을까요? 그 PC는 다음 요청부터 Workspace에 연결되지 않습니다.`)) return;
    try{ const j = await syncPost(cfg, {op:'revoke', id:t.id}); if(!j.ok) throw new Error(j.error || '응답 오류'); pcLink.list = j.items || pcLink.list; renderView(); toast('연결을 끊었습니다.'); }
    catch(err){ toast('끊지 못했습니다: ' + err.message); }
  }
});
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
  const iqs = sOpt.special ? [] : (db.inquiries || []).filter(x => (!sOpt.type || !x.recId || ((db.records.find(r => r.id === x.recId) || {}).type === sOpt.type)) && has(inqHay(x)));
  const total = cl.length + its.length + pr.length + rc.length + kcs.length + iqs.length;
  return `<h2>‘${esc(q)}’ 검색 결과</h2>
    <div class="filters">
      <label class="inline">업무 유형 <select id="sType"><option value="">전체</option>${opts(db.settings.taskTypes, sOpt.type)}</select></label>
      <label class="check"><input type="checkbox" id="sSpecial"${sOpt.special ? ' checked' : ''}> 특이 처리만</label>
      <span class="hint">업체 ${cl.length}곳, 품목 ${its.length}개, 절차 ${pr.length}건, 기록 ${rc.length}건${iqs.length ? `, 세관 질의 ${iqs.length}건` : ''}${kcs.length ? `, KC ${kcs.length}건` : ''}</span>
    </div>
    ${/^[A-Za-z0-9\-]{8,}$/.test(q) ? `<div class="setup"><div class="btn-row"><span>‘${esc(q)}’를 B/L 번호로 UNI-PASS 화물진행정보에서 찾아볼까요?</span><button class="mini strong" data-bl-q="${esc(q)}">UNI-PASS 조회</button></div><div id="blInline"></div></div>` : ''}
    ${total ? '' : '<p class="empty">찾는 내용이 없습니다. 단어를 줄이거나 다른 표현으로 검색해 보세요. 여러 단어는 모두 포함된 결과만 보여 줍니다.</p>'}
    ${cl.length ? `<section class="result-block"><div class="sec-head"><h3>업체</h3></div><div class="chips">${cl.map(c => `<button class="chip" data-go="client" data-id="${esc(c.id)}">${hl(c.name)}</button>`).join('')}</div></section>` : ''}
    ${its.length ? `<section class="result-block"><div class="sec-head"><h3>품목·요건</h3></div><div class="table-wrap"><table class="grid"><thead><tr><th>업체</th><th>품목</th><th>HS 코드</th><th>세율·FTA</th><th>수입요건</th></tr></thead><tbody>
      ${its.map(i => `<tr><td><button class="linkish" data-go="client" data-id="${esc(i.clientId)}">${esc(clientName(i.clientId))}</button></td><td>${hl(i.name)}</td><td class="hs">${hl(i.hs)}</td><td>${hl(i.tariff)}</td><td class="pre">${hl(i.reqs)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
    ${kcs.length ? `<section class="result-block"><div class="sec-head"><h3>KC 인증 목록 <span class="cnt">${kcs.length}건</span></h3></div>${kcTableHTML(kcs, true)}</section>` : ''}
    ${iqs.length ? `<section class="result-block narrow"><div class="sec-head"><h3>세관 질의</h3></div>${iqs.map(inquiryHTML).join('')}</section>` : ''}
    ${pr.length ? `<section class="result-block narrow"><div class="sec-head"><h3>처리 절차</h3></div>${pr.map(p => procHTML(p, {showClient:true})).join('')}</section>` : ''}
    ${rc.length ? `<section class="result-block narrow"><div class="sec-head"><h3>업무 기록</h3></div>${rc.map(r => recordHTML(r, {showClient:true})).join('')}</section>` : ''}`;
}

function monthLabel(ym){const [y,m] = ym.split('-'); return `${y}년 ${Number(m)}월`;}
function shiftMonth(ym, n){const [y,m] = ym.split('-').map(Number); const t = (m-1) + n; return `${y + Math.floor(t/12)}-${String(((t%12)+12)%12 + 1).padStart(2,'0')}`;}
/* 실적 (11/12 e): 완료 기록 중 BSGC-Backup '자료 갱신' 기록은 빼고, 같은 신고번호는 1건 */
function doneIn(ym){return perfDedupe(db.records.filter(r => r.status === '완료' && (r.date || '').startsWith(ym)));}
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
/* 업체 알아보기 (11/11 c): ① 주소·제목에서 먼저 찾고, ② 못 찾으면 첨부 파일명·본문 앞부분(600자), ③ 그래도 없으면 본문 단서(hints: 수집기가 본문 전체에서 뽑은 회사명 줄·메일 주소)까지 본다.
   본문에 인용된 지난 메일·다른 업체 이름이 제목의 업체를 덮어쓰지 않게 하려는 순서다(제목에 A사, 첨부명·본문에 'A사&B사'가 있으면 A사).
   직원이 '업체 지정'한 대화는 그 업체로 본다(db.mailClient[대화 키]). */
function mailHead(m){return [m.fwdFrom, m.from, m.fromName, m.to, m.cc, m.subject].filter(Boolean).join(' ');}
function mailText(m){return [mailHead(m), (m.attachments || []).join(' '), m.snippet].filter(Boolean).join(' ');}
function matchClient(m){
  const ms = Array.isArray(m) ? m : [m];
  return findClient(ms.map(mailHead).join(' ')) || findClient(ms.map(mailText).join(' '))
    || (ms.some(x => x.hints) ? findClient(ms.map(x => mailText(x) + ' ' + (x.hints || '')).join(' ')) : null);   // ③ 본문 단서는 마지막에(인용된 지난 메일의 포워더 주소가 본문 속 업체명을 덮지 않게)
}
function threadClient(t){ const id = (db.mailClient || {})[t.key]; return (id && db.clients.find(c => c.id === id)) || matchClient(t.ms); }
/* 수하인(C/…) 이름: 포워더 A/N 제목 'S/SHIPPER CO C/ABC TRADING H/ABCD2611001'에서 'ABC TRADING' */
function consigneeNames(text){
  const out = [], re = /(?:^|[\s\[(,])C\s*\/\s*([A-Z][A-Z0-9&.'\- ]{1,40}?)\s*(?=\s(?:H|M|B|S)\s*\/|\s*\/\/|[\])/,]|\s{2,}|$)/g;
  let m;
  while((m = re.exec(String(text || '')))) { const v = m[1].trim(); if(v.length >= 2 && !/^(NO|PO|INV|CI)$|^O\b/i.test(v)) out.push(v); }
  return [...new Set(out)];
}
function findRefNo(text){const m = String(text||'').match(/\b\d{5}-\d{2}-\d{6,7}[A-Z]?\b/); return m ? m[0] : '';}
const refKey = s => String(s || '').toUpperCase().replace(/[-\s]/g, '');
/* B/L 여러 건 (11/9): 메일 한 통에 B/L이 여러 개면 모두 찾는다(색인의 bl 칸은 첫 번째 하나뿐이라 제목·첨부 파일명에서 다시 찾음).
   제목 → 첨부 → 본문 앞부분 순으로 기준 B/L을 정하고, 접두어·길이가 같은 번호만 같은 묶음으로 본다(ABCDE26100048, ABCDE26100045).
   접두어가 다르면(HBL·MBL, 선적 서류 번호 등) 기준 하나만 쓴다. PO·INV 번호와 케이스 번호는 뺀다. */
const BL_G = /(?<![A-Z0-9]|[A-Z]-)[A-Z]{2,}[A-Z0-9]*\d{5,}[A-Z0-9]*(?![A-Z0-9])/g;   // 'HS-AB2026100355'처럼 하이픈 앞머리가 붙은 문서번호는 뺌
const NOT_BL = /^(PO|INV|CI|PL|PI|TY|SC|OR|HS|EXP|IMP)\d/;
const blPrefix = b => (String(b).match(/^[A-Z]+/) || [''])[0];
/* 같은 제목에 접두어가 다른 번호가 섞이면(공급사 문서번호 + B/L) B/L다운 것을 앞으로: 이미 기록에 있는 B/L 접두어 → 영문 3자 이상+숫자 6자 이상 */
const BL_SHAPE = /^[A-Z]{3,}\d{6,}$/;
function knownPrefixes(){ return new Set(((typeof db !== 'undefined' && db && db.records) || []).map(r => blPrefix(String(r.bl || '').toUpperCase())).filter(p => p.length >= 3)); }
function blList(text){
  const xs = [...new Set(String(text || '').toUpperCase().match(BL_G) || [])].filter(b => !NOT_BL.test(b));
  if(xs.length < 2) return xs;
  const kp = knownPrefixes(), score = b => (kp.has(blPrefix(b)) ? 2 : 0) + (BL_SHAPE.test(b) ? 1 : 0);
  return xs.map((b, i) => [b, i]).sort((a, b) => score(b[0]) - score(a[0]) || a[1] - b[1]).map(x => x[0]);
}
function blGroup(base, more){
  if(!base.length) return [];
  const p = blPrefix(base[0]), n = base[0].length;
  const same = [...new Set([...base, ...more])].filter(b => blPrefix(b) === p && b.length === n);
  return same.length >= 2 ? same : [base[0]];
}
function mailBLs(m){
  const subj = blList(m.subject), files = blList((m.attachments || m.files || []).join(' '));
  let base = subj.length ? subj : files;
  if(!base.length) base = blList(String(m.snippet || '').slice(0, 300)).slice(0, 1);
  if(!base.length && m.bl && !NOT_BL.test(String(m.bl).toUpperCase())) base = [String(m.bl).toUpperCase()];
  return blGroup(base, files);
}
function threadBLs(t){
  const all = t.ms.map(mailBLs).filter(x => x.length);
  if(!all.length) return [];
  return blGroup(all[0], all.slice(1).flat());
}
/* B/L로 기록 하나 찾기 (여러 건이면 진행 중인 것이 하나일 때만) */
function recordByBL(b){
  const k = refKey(b);
  if(k.length < 6) return null;
  const hits = db.records.filter(r => recKeys(r, 'bl').some(x => refKey(x) === k));
  if(hits.length <= 1) return hits[0] || null;
  const open = hits.filter(r => r.status !== '완료');
  return open.length === 1 ? open[0] : null;
}
/* 메일이 붙을 기록 전부: 기본 연결(mailRecord) + B/L이 여러 개인 메일은 B/L마다 해당 기록 */
function mailRecords(m){
  const out = [], first = mailRecord(m);
  if(first) out.push(first);
  const bls = mailBLs(m);
  if(bls.length >= 2) bls.forEach(b => { const r = recordByBL(b); if(r && !out.includes(r)) out.push(r); });
  return out;
}
function threadKey(subject){
  let t = String(subject || '').toLowerCase();
  t = t.replace(/\[[^\]\d]*\]/g, ' ');                                   // [정산서], [BSGC-TROPI] 같은 숫자 없는 머리말
  t = t.replace(/(^|\s|\]|:)(re|fw|fwd|답장|회신|전달|r)\s*(\[\d+\])?\s*[:：]/g, ' ');
  return t.replace(/[\s:：\-_/|,.]+/g, ' ').trim().slice(0, 120);
}
/* 신고번호: 색인 값 → 제목·본문 → 첨부 파일명(EXP_1367526100793X_….pdf / IMP_…: 하이픈 없는 UNI-PASS 필증 파일) */
const CERT_FILE = /(?:^|[^A-Z])(EXP|IMP)[_-]?(\d{5})-?(\d{2})-?(\d{6,7}[A-Z]?)(?=[_.\-\s]|$)/i;
function mailDecl(m){
  if(m.declNo) return m.declNo;
  const t = findRefNo((m.subject || '') + ' ' + (m.snippet || ''));
  if(t) return t;
  for(const f of (m.attachments || m.files || [])){ const x = CERT_FILE.exec(String(f)); if(x) return `${x[2]}-${x[3]}-${x[4].toUpperCase()}`; }
  return '';
}
/* 우리 직원이 필증을 보낸 메일 = 수리된 것. 수출 → 수리완료, 수입 → 통관완료 근거
   (첨부가 EXP_/IMP_ 필증 파일이거나, 제목·본문 앞부분에 '필증·면장'과 '송부·드립니다·첨부'가 함께 있을 때) */
function certMail(m){
  const from = m.fwdFrom ? '' : (m.from || '');
  if(!isOwn(from)) return null;
  const files = (m.attachments || m.files || []).map(String);
  const f = files.map(x => CERT_FILE.exec(x)).find(Boolean);
  const head = `${m.subject || ''} ${String(m.snippet || '').slice(0, 160)}`;
  const byText = /필증|면장/.test(head) && /송부|드립니다|드려요|첨부|보내/.test(head) && !/요청|부탁|주시/.test(String(m.snippet || '').slice(0, 80));
  if(!f && !byText) return null;
  const kind = f ? (f[1].toUpperCase() === 'EXP' ? 'E' : 'I') : /수출|export/i.test(head) ? 'E' : /수입|import/i.test(head) ? 'I' : '';
  return {kind, decl:mailDecl(m), date:String(m.date || '').slice(0, 10), who:m.fromName || from, fix:/정정/.test(head), byFile:!!f};   // byFile: 필증 파일 첨부(확정) / 글만(확인 필요)
}
function applyCert(r, cm){
  const code = caseCode(r.type);
  if(code !== 'E' && code !== 'I') return false;
  let ch = false;
  const lv = cm.byFile ? 'ok' : 'chk', how = cm.byFile ? '필증 파일 첨부' : '글만 — 첨부 확인 필요';
  if(code === 'E'){ if(setStage(r, 'accept', cm.date, `메일: 필증 송부 (${cm.who}, ${how})`, lv)){ setLoadDue(r, r.stage.accept); ch = true; } }
  else if(setStage(r, 'customs', cm.date, `메일: 수입필증 송부 (${cm.who}, ${how})`, lv)) ch = true;
  if(cm.fix && !(r.tags || []).includes('정정필증')){ r.tags = [...(r.tags || []), '정정필증']; addHist(r, `정정된 필증 송부 메일 (${cm.who}, ${cm.date})`); ch = true; }
  if(!r.refNo && cm.decl){ r.refNo = cm.decl; ch = true; }
  else if(cm.decl && addRef(r, cm.decl, 'decl', `필증 송부 메일 (${cm.date})${cm.fix ? ' — 정정' : ' — 분할·추가'}`)) ch = true;
  if(ch) r.updatedAt = nowIso();
  return ch;
}
/* 진행 중 기록에 붙은 메일 중 필증 송부가 있으면 단계 반영 (붙어 있던 메일도 다시 봄) */
function certStages(){
  let n = 0;
  db.records.filter(r => r.status !== '완료' && r.status !== '보류').forEach(r => {
    (r.mails || []).forEach(x => { const cm = certMail({...x, from:x.from, files:x.files}); if(cm && applyCert(r, cm)) n++; });
  });
  return n;
}
/* 자동 접수: 기록이 없는 대화에서 최근 14일 안에 직원이 필증을 보냈고, 업체를 알아보고 신고번호가 있으면 기록을 만든다 */
function staffAccount(m){
  const nm = String(m.fromName || '').replace(/["']/g, '').trim(), local = String(m.from || '').split('@')[0].toLowerCase();
  const a = accounts.find(x => (nm && x.name && (nm.includes(x.name) || x.name.includes(nm))) || x.id.toLowerCase() === local);
  return a ? a.id : '';
}
/* 자동 접수 (목표 5: 버튼 없이 기록 생성). 대상 대화는 최근 14일·누락 기준일 이후이고, 업체를 알아보며, 기록이 없을 때만.
   ① 직원이 필증을 보낸 대화(신고번호 있음) → 수리 반영까지 ② 업체의 의뢰 메일(새 의뢰 후보) → 진행 중 기록.
   유형·품목은 메일로 추정, 단계·서류는 절차(업체 전용 → 공통)에서, 담당은 보낸 직원 → 절차 담당 → 업체 기본 담당 순. 근거는 이력에 남긴다. */
const cleanSubj = s => String(s || '').replace(/^\s*(\[[^\]\d]*\]\s*|(re|fw|fwd|답장|회신|전달)\s*[:：]\s*)+/i, '').trim();
function applyProcAuto(r){
  const p = procFor(r);
  if(!p) return;
  r.procId = p.id;
  if(!(r.checklist || []).length){ r.checklist = (p.steps || []).map(text => ({text, done:false})); if(typeof setProcVer === 'function') setProcVer(r, p); }
  if(!(r.docs || []).length) r.docs = splitDocs(p.docs).map(text => ({text, done:false}));
  if(!r.assignee && p.assignee && accounts.some(a => a.id === p.assignee)) r.assignee = p.assignee;
}
/* 자동 접수 (11/9 확장). 대상 대화: 기준일 이후, 업체를 알아봄, 기록 없음. 접수 근거(why):
   cert    직원이 필증을 보냄(신고번호 있음) → 수리 반영까지
   asked   업체의 의뢰 메일(요청·의뢰·신청…)
   docs    포워더·업체의 A/N·선적 서류·입항 안내·통관 서류 전달 = 업무 시작 (B/L 필요)
   bill    직원이 보낸 통관예상경비청구서·자금청구서·정산서 (B/L 필요) — 필증을 메일로 보내지 않는 업체 대비
   B/L이 여러 개인 대화('ABCDE26100048, ABCDE26100045')는 B/L마다 기록을 하나씩 만들고, 이미 기록이 있는 B/L에는 메일만 붙인다.
   opts.since: 기준일(없으면 최근 14일·누락 기준일 중 늦은 날) / opts.all: 목록에서 뺀 메일도 다시 봄(놓친 건 일괄 접수) / opts.dry: 미리 보기만 */
const WHY_LABEL = {cert:'필증 송부', asked:'의뢰 메일', docs:'선적 서류·도착 안내', bill:'청구서·정산서'};
function intakeThreads(opts){
  if(!opts.all) return mailThreadsList();
  const attached = new Set(db.records.flatMap(r => (r.mails || []).map(x => x.id)));
  const off = new Set([...(db.intakeOff || []), ...(db.mailIgnored || [])]);
  return threadsOf((mailCache || []).filter(m => !attached.has(m.id) && !off.has(m.id)));
}
function autoIntake(opts = {}){
  const made = [], linked = [], plan = [];
  const since = opts.since || [addPeriod(today(), -14, 'd'), mailWatchFrom()].sort().slice(-1)[0];
  const newBL = new Set();
  intakeThreads(opts).slice().sort((a, b) => a.ms[0].date < b.ms[0].date ? -1 : 1).forEach(t => {   // 오래된 대화부터: 서류 전달 → 청구서 → 정산서 순으로 이어지게
    if(String(t.last.date).slice(0, 10) < since) return;
    const ci = t.ms.map(m => ({m, cm:certMail(m)})).filter(x => x.cm && x.cm.decl && x.cm.date >= since);
    const f = threadFlags(t), bls = threadBLs(t);
    const why = ci.length ? 'cert' : f.asked ? 'asked' : f.docs && bls.length ? 'docs' : f.bill && bls.length ? 'bill' : '';
    if(!why) return;
    const c = f.client;
    if(!c) return;                                                                          // 업체 미인식 → 메일 화면 표시, 업체 등록 후 다음 불러오기 때 접수
    if(why === 'cert' || bls.length <= 1){
      if(t.ms.some(x => mailRecord(x))) return;                                             // 이미 있는 건은 autoAttachMails가 붙임
      if(ci.length && recordByRef({declNo:ci[0].cm.decl})) return;
    }
    const targets = why === 'cert' || !bls.length ? [''] : bls;
    targets.forEach(bl => {
      const ex = bl ? recordByBL(bl) : null;
      if(opts.dry){ if(!ex && !(bl && newBL.has(bl))){ plan.push({client:c.name, bl, why, subject:t.ms[0].subject, date:String(t.ms[0].date).slice(0, 10)}); if(bl) newBL.add(bl); } return; }
      if(ex){ let n = 0; t.ms.forEach(x => { if(attachMail(ex, x)) n++; seeMail(x.id); }); if(n){ addHist(ex, `메일 ${n}통 연결 (B/L ${bl}, ${WHY_LABEL[why]})`); linked.push(ex); } return; }
      made.push(intakeRecord(t, c, why, bl, bls, ci));
    });
  });
  return opts.dry ? plan : Object.assign(made, {linked});
}
/* 제목: 청구서·서류 메일은 [통관예상경비청구서 품명] 머리말에 품명이 들어 있어 RE:/FW:만 뗀다 */
function intakeTitle(subject, why){
  if(why !== 'bill' && why !== 'docs') return cleanSubj(subject);
  return String(subject || '').replace(/^\s*((\[(정산서|청구서)[^\]]*\]\s*)|(re|fw|fwd|답장|회신|전달)\s*[:：]\s*)+/i, '').trim();
}
function intakeRecord(t, c, why, bl, bls, ci){
  const txt = t.ms.map(x => x.subject + ' ' + String(x.snippet || '').slice(0, 200)).join(' ');
  const cm = ci.length ? ci[0].cm : null;
  const type = cm && cm.kind === 'E' ? '수출신고' : cm && cm.kind === 'I' ? '수입통관'
    : why === 'docs' && ARRIVAL_RE.test(txt) ? '수입통관'
    : (guessType(txt, c.id) || lastType(c.id) || (why === 'bill' || why === 'docs' ? '수입통관' : '기타'));
  const first = t.ms[0], src = t.ms.find(x => why === 'docs' ? docMail(x) : why === 'bill' ? billMail(x) : true) || first;
  const multi = bls.length > 1;
  const r = {id:uid(), clientId:c.id, type, status:'진행중', startDate:String(first.date || today()).slice(0, 10), date:'', refNo:cm ? cm.decl : (multi ? '' : t.ms.map(mailDecl).find(Boolean) || ''), bl:bl || t.ms.map(x => x.bl).find(Boolean) || '',
    title:(intakeTitle(first.subject, why) || `[${type}] ${cm ? cm.decl : bl}`) + (multi ? ` (B/L ${bl})` : ''), summary:String(first.snippet || '').slice(0, 300), special:false, specialNote:'', tags:['자동접수'], links:[], fee:null, itemId:'', checklist:[], docs:[], deadlines:[], reflected:[],
    assignee:(cm ? staffAccount(ci[0].m) : '') || t.ms.filter(x => isOwn(x.from)).map(staffAccount).find(Boolean) || '', history:[], createdAt:nowIso(), updatedAt:nowIso(), createdBy:'auto'};
  const gi = guessItem(txt, c.id); if(gi) r.itemId = gi.id;
  applyProcAuto(r);
  if(!r.assignee) r.assignee = clientAssignee(c.id);
  const who = src.fromName || src.fwdFrom || src.from, at = String(src.date).slice(0, 16);
  addHist(r, cm ? `자동 접수: ${cm.who}가 필증 송부 (${cm.date}, 신고 ${cm.decl})`
    : `자동 접수(${WHY_LABEL[why]}): “${src.subject}” (${who}, ${at})${multi ? ` — 같은 메일의 B/L ${bls.length}건을 하나씩 접수` : ''}`);
  t.ms.forEach(x => { attachMail(r, x); seeMail(x.id); });
  ci.forEach(x => applyCert(r, x.cm));
  if(!r.lawSnap) snapLaws(r);
  db.records.push(r);
  return r;
}
/* 놓친 건 일괄 접수 (11/9): 기준일 이후 색인 메일(최근 60일)을 다시 보고, 기록에 붙지 않은 업무를 미리 보여 준 뒤 접수한다.
   직원이 '접수 취소'한 메일과 하나씩 '무시'한 메일은 빼고, 기준일 이전 일괄 정리분은 다시 본다. */
async function backfillIntake(){
  const since = (document.getElementById('mailBackfillFrom') || {}).value || addPeriod(today(), -45, 'd');
  db.settings.mailBackfillFrom = since;
  if(!mailCache) await loadMail(false);
  if(!mailCache){ toast('메일 색인을 불러오지 못했습니다.'); return; }
  const n0 = autoAttachMails();
  const plan = autoIntake({since, all:true, dry:true});
  if(!plan.length){ if(n0) commit(); toast(`${since} 이후 새로 접수할 업무가 없습니다${n0 ? ` (메일 ${n0}통은 기존 기록에 붙였습니다)` : ''}.`); return; }
  const by = {}; plan.forEach(x => { by[x.client] = (by[x.client] || 0) + 1; });
  const lines = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `· ${k} ${v}건`).join('\n');
  if(!confirm(`${since} 이후 메일에서 기록이 없는 업무 ${plan.length}건을 찾았습니다.\n${lines}\n\n모두 접수할까요? 잘못 접수된 건은 기록의 ‘접수 취소’로 지울 수 있습니다.`)){ if(n0) commit(); return; }
  const made = autoIntake({since, all:true});
  const cs = certStages(), ev = evalStages();
  pruneThreads(); commit(); renderSidebar(); if(route.name === 'mail') renderView();
  toast([`${made.length}건을 접수했습니다`, (made.linked || []).length && `기존 기록 ${made.linked.length}건에 메일 연결`, ev.n && `정산서로 정산완료 ${ev.n}건`, ev.done && `자동 완료 ${ev.done}건`].filter(Boolean).join(' · ') + '. UNI-PASS 수리 확인은 15건씩 이어서 진행합니다.');
  if(made.length) setTimeout(() => refreshCustoms(true), 800);
}
function lastType(cid){ const r = db.records.filter(x => x.clientId === cid && x.type).sort(byDateDesc)[0]; return r ? r.type : ''; }
/* 업체 인식 학습 (목표 5): 직원이 대화를 업체 기록에 연결하면, 그 대화의 의뢰자 주소(회사 도메인이면 '@도메인', 공용 메일이면 주소)를 업체 검색어에 더한다.
   다른 업체 기록에도 나온 주소·도메인(포워더 등)은 배우지 않는다. */
function learnClient(cid, ms){
  const c = db.clients.find(x => x.id === cid);
  if(!c || !ms || !ms.length) return [];
  const ext = a => a && !isOwn(a);
  const addr = s => (String(s || '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/) || [''])[0];
  let src = ms.map(m => addr(m.fwdFrom) || addr(m.from)).filter(ext);
  if(!src.length) src = ms.filter(m => isOwn(m.from)).flatMap(m => String(m.to || '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []).filter(ext);
  const first = src[0];
  if(!first) return [];
  const dom = first.split('@')[1], key = FREE_MAIL.includes(dom) ? first : '@' + dom;
  const kws = kwList(c);
  if(kws.includes(key)) return [];
  const usedElsewhere = db.clients.some(o => o.id !== cid && kwList(o).some(k => k === key || (key.startsWith('@') && k.endsWith(key))))
    || db.records.some(r => r.clientId && r.clientId !== cid && (r.mails || []).some(m => String(m.from || '').toLowerCase().includes(key)));
  if(usedElsewhere) return [];
  c.keyword = [...kws, key].join(', ');
  c.learned = [...(c.learned || []), {key, at:today()}].slice(-30);
  return [key];
}
function mailRecord(m){
  const cm = CASE_RE.exec(m.caseNo || m.subject || '');
  if(cm){ const r = db.records.find(x => x.caseNo === cm[0]); if(r) return r; }
  const th = (db.mailThreads || {})[threadKey(m.subject)];
  if(th){
    const r = db.records.find(x => x.id === th);
    if(r){                                                                  // 한 대화에서 B/L별로 기록을 나눈 경우: 메일의 B/L이 그 기록과 다르면 B/L 쪽을 따름
      const bls = mailBLs(m).map(refKey);
      if(bls.length && r.bl && !recKeys(r, 'bl').some(x => bls.includes(refKey(x)))){ const rb = recordByBL(bls[0]); if(rb) return rb; }
      return r;
    }
  }
  const keys = [...new Set([m.bl, ...mailBLs(m), mailDecl(m)].map(refKey).filter(k => k.length >= 6))];
  if(!keys.length) return null;
  const hits = db.records.filter(r => recKeys(r).some(x => keys.includes(refKey(x))));
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
  if(!r.bl){ const b = mailBLs(m); if(b.length === 1) r.bl = b[0]; else if(!b.length && m.bl) r.bl = m.bl; }   // B/L이 여러 개인 메일은 기록의 B/L을 함부로 정하지 않음
  if(!r.refNo && mailDecl(m)) r.refNo = mailDecl(m);
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
function mailThreadsList(){ return threadsOf((mailCache || []).filter(m => !db.mailSeen.includes(m.id))); }
function threadsOf(list){
  const groups = new Map();
  list.forEach(m => {
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
  const all = mailThreadsList().map(t => ({...t, f:threadFlags(t)})), olds = all.filter(t => t.f.old);
  const ths = all.filter(t => !t.f.old).sort((a, b) => (b.f.request - a.f.request) || (b.f.ageH >= OVERDUE_H) - (a.f.ageH >= OVERDUE_H) || (a.last.date < b.last.date ? 1 : -1));
  return `<header class="client-head"><div><h2>customs@ 메일</h2><p class="client-meta">최근 60일 customs@ 메일 중 아직 기록과 연결하지 않은 대화 ${ths.length}건입니다. 제목에 케이스 번호([2026-I-001])가 있거나, 이미 기록에 붙인 대화의 회신이거나, B/L·신고번호로 기록이 하나로 정해지면 자동으로 붙습니다.</p></div>
      <div class="client-act"><label class="inline">누락 경고 기준일 <input type="date" id="mailWatch" value="${esc(mailWatchFrom())}"></label><button class="ghost" data-mail-audit title="업체를 알아보지 못한 메일·자료에서 업체 후보 찾기">업체 미인식 점검</button><label class="inline" title="이 날짜 이후 메일 중 기록이 없는 업무(필증·의뢰·A/N·선적 서류·청구서·정산서)를 찾아 한 번에 접수합니다. 목록에서 정리(무시)한 메일도 다시 봅니다.">놓친 건 <input type="date" id="mailBackfillFrom" value="${esc(db.settings.mailBackfillFrom || addPeriod(today(), -45, 'd'))}"></label><button class="ghost" data-mail-backfill${mailLoading ? ' disabled' : ''}>일괄 접수</button><button class="primary" data-mail-load${mailLoading ? ' disabled' : ''}>${mailLoading ? '불러오는 중…' : '새로 불러오기'}</button></div></header>
    ${mailErr ? `<p class="msg">${esc(mailErr)}</p>` : ''}
    <div class="narrow">
    ${mailCache === null ? '<p class="empty">‘새로 불러오기’를 누르면 메일 색인에서 가져옵니다.</p>'
      : ths.length ? ths.map(t => { const m = t.last, c = t.f.client, over = t.f.ageH >= OVERDUE_H;
        const refs = [...new Set(t.ms.flatMap(x => [...mailBLs(x).map(b => `B/L ${b}`), x.declNo && `신고 ${x.declNo}`].filter(Boolean)))];
        const files = [...new Set(t.ms.flatMap(x => x.attachments || []))];
        const people = [...new Set(t.ms.map(x => x.fwdFrom ? `전달: ${x.fwdFrom}` : (x.fromName || x.from)))];
        const first = t.ms[0];
        const openRecs = c ? db.records.filter(r => r.clientId === c.id && r.status !== '완료' && r.status !== '보류').sort(byDateDesc).slice(0, 3) : [];
        return `<article class="rec${over ? ' overdue' : ''}">
        <div class="rec-date">${esc(String(m.date).slice(0, 10))}<small>${t.ms.length > 1 ? `${t.ms.length}통 · ${esc(String(first.date).slice(5, 10))}~` : esc(String(m.date).slice(11, 16))}</small></div>
        <div class="rec-body"><h4>${esc(m.subject || '(제목 없음)')}</h4>
          <div class="rec-meta">${t.f.request ? '<span class="tag new">새 의뢰 후보</span>' : ''}${t.ms.some(certMail) ? `<span class="tag new" title="직원이 필증을 보낸 대화입니다. 업체를 알아보면 다음 불러오기 때 자동 접수됩니다.">필증 송부됨${c ? '' : ' · 업체 지정 필요'}</span>` : ''}${over ? `<span class="tag warn">${Math.floor(t.f.ageH / 24) ? Math.floor(t.f.ageH / 24) + '일' : Math.floor(t.f.ageH) + '시간'} 미연결</span>` : ''}<span>${esc(people.slice(0, 4).join(', '))}${people.length > 4 ? ` 외 ${people.length - 4}명` : ''}</span>${c ? `<span class="tag">${esc(c.name)}</span>${cautionBadge(c)}` : '<span class="tag type">업체 미지정</span>'}${typeof threadReviewHTML === 'function' ? threadReviewHTML(t) : ''}${refs.slice(0, 4).map(x => `<span class="tag">${esc(x)}</span>`).join('')}</div>
          ${m.snippet ? `<p class="rec-sum">${esc(m.snippet)}</p>` : ''}
          ${files.length ? `<div class="hint">첨부 ${files.length}개: ${esc(files.slice(0, 6).join(', '))}${files.length > 6 ? ' …' : ''}</div>` : ''}
          ${openRecs.length ? `<div class="hint mail-to">진행 중인 ${esc(c.name)} 기록에 바로 붙이기: ${openRecs.map(r => `<button class="mini" data-mail-to="${esc(t.key)}|${esc(r.id)}" title="${esc(r.title || '')}">${esc(((r.caseNo ? r.caseNo + ' ' : '') + (r.bl ? r.bl + ' ' : '') + (r.title || '')).slice(0, 34))}</button>`).join(' ')}</div>` : ''}
          ${threadSimHTML(t)}
        </div>
        <div class="rec-act"><button class="mini strong" data-mail-make="${esc(t.key)}">${t.f.request ? '업무 시작' : '기록 만들기'}</button><button class="mini" data-mail-attach="${esc(t.key)}">기록에 붙이기</button>${typeof threadKind === 'function' && (threadKind(t) === 'review' || reviewOf(t.key)) ? `<button class="mini${reviewOf(t.key) ? '' : ' strong'}" data-rv="${esc(t.key)}" title="관세사 검토의견이 필요한 문의 — AI 1차 검토 초안 만들기">1차 검토</button>` : ''}<button class="mini${c ? '' : ' strong'}" data-mail-client="${esc(t.key)}" title="이 대화의 업체를 직접 정합니다. 의뢰·선적 서류·청구서·필증 근거가 있으면 바로 자동 접수합니다.">${c ? '업체 변경' : '업체 지정'}</button><button class="mini" data-mail-ignore="${esc(t.key)}">무시</button></div>
      </article>`; }).join('')
      : '<p class="empty">새로 연결할 메일이 없습니다.</p>'}
    ${olds.length ? `<details class="old-mails"><summary>기준일(${esc(mailWatchFrom())}) 이전 대화 ${olds.length}건 — 경고에서 제외됨</summary><p class="hint">처음 연결할 때 쌓인 과거 메일입니다. 필요한 것만 위 기준일을 앞당겨 처리하거나, 한 번에 정리하세요.</p><button class="mini" data-mail-old-clear>이전 대화 ${olds.length}건 모두 정리(무시)</button><ul>${olds.slice(0, 50).map(t => `<li><span class="rec-date">${esc(String(t.last.date).slice(0, 10))}</span> ${esc(t.last.subject || '')} <span class="hint">${t.ms.length}통</span></li>`).join('')}${olds.length > 50 ? `<li class="hint">외 ${olds.length - 50}건</li>` : ''}</ul></details>` : ''}
    </div>`;
}
function autoAttachMails(){
  let n = 0;
  (mailCache || []).filter(m => !db.mailSeen.includes(m.id)).sort((a, b) => a.date < b.date ? -1 : 1).forEach(m => {
    const rs = mailRecords(m);                                                   // B/L 여러 건 메일('정산서 두 건')은 해당 기록 모두에 붙임
    if(!rs.length) return;
    if(rs.map(r => attachMail(r, m)).some(Boolean)) n++;
    seeMail(m.id);
  });
  return n;
}
async function loadMail(manual = true){
  mailLoading = true; mailErr = ''; if(route.name === 'mail') renderView();
  try{
    const j = await collectApi({mails:1, days:60});
    mailCache = j.items || []; mailCollectorAt = j.collectorAt || '';
    if(typeof markRun === 'function') markRun('mail', true);
    if(typeof loadReviews === 'function') await loadReviews();            // 검토 문의·필증 의뢰 메일 전문 (11/12)
    const n = autoAttachMails(), made = autoIntake(), cs = certStages(), ev = evalStages(), cu = typeof applyCautions === 'function' ? applyCautions() : 0;
    if(n || made.length || (made.linked || []).length || cs || ev.n || ev.done || ev.ck || cu){ pruneThreads(); commit(); }
    if(made.length){ setTimeout(() => refreshCustoms(true), 800); renderSidebar(); }                     // 새로 접수한 건은 UNI-PASS로 수리일·적재기한 바로 확인
    const ln = (made.linked || []).length;
    if(n || made.length || ln || cs || ev.done || cu) toast([n && `customs@ 메일 ${n}통을 기존 기록에 붙였습니다`, made.length && `메일로 ${made.length}건을 자동 접수했습니다(진행 중 업무에서 확인)`, ln && `B/L이 같은 기존 기록 ${ln}건에 메일을 붙였습니다`, cs && `필증 송부로 ${cs}건의 단계를 반영했습니다`, ev.done && `통관·정산이 확인된 ${ev.done}건을 자동 완료했습니다`, cu && `의뢰 메일의 신고 유의사항 ${cu}건을 체크리스트에 넣었습니다`].filter(Boolean).join(' · '));
  }catch(e){
    mailErr = `메일을 불러오지 못했습니다 (${e.message}).`;
    if(typeof markRun === 'function') markRun('mail', false, e.message);
    if(manual) toast(mailErr);
  }
  mailLoading = false; renderSidebar(); if(route.name === 'mail') renderView();
}
function openAttachMail(t){
  const c = threadClient(t);
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
      const lk = learnClient(r.clientId, t.ms);
      toast(`기록에 메일 ${t.ms.length}통을 붙였습니다.${lk.length ? ` 다음부터 ${lk[0]} 메일은 ${clientName(r.clientId)}로 알아봅니다.` : ''}`);
    }
  });
}
/* 업체 지정 (11/11 c): 업체를 못 알아봤거나 잘못 알아본 대화를 직원이 정한다. 검색어를 함께 넣으면 다음 메일부터 자동으로 알아본다.
   지정 후 바로 자동 접수를 돌린다(의뢰·선적 서류·청구서·필증 근거가 있는 대화만 기록이 생김). */
function openMailClient(t){
  const c = threadClient(t);
  const cands = [...new Set(t.ms.flatMap(m => [...consigneeNames(m.subject), ...auditCands([m.subject, m.snippet, m.hints].join(' '), '').filter(x => !x.startsWith('@'))]))].slice(0, 6);
  openDialog({title:'메일 업체 지정', saveLabel:'지정',
    body:`<p class="hint">${esc(t.last.subject || '')} (${t.ms.length}통)</p>
      <label>업체<select name="cid">${opts([['', '업체 선택'], ...sortedClients().map(x => [x.id, x.name])], c ? c.id : '')}</select></label>
      <label>검색어로도 기억 (선택)<input name="kw" value="${esc(c ? '' : cands[0] || '')}" placeholder="예: 업체 약칭, 영문 수하인명"></label>
      ${cands.length ? `<p class="hint">메일에서 찾은 이름 후보: ${cands.map(esc).join(', ')}</p>` : ''}
      <p class="hint">검색어를 넣으면 그 이름이 들어간 다음 메일도 이 업체로 알아봅니다. 포워더·제품 이름은 넣지 마세요(여러 업체 메일에 나옴).</p>`,
    onSave(fd){
      const x = db.clients.find(y => y.id === fd.get('cid'));
      if(!x){ toast('업체를 고르세요.'); return false; }
      db.mailClient = {...(db.mailClient || {}), [t.key]:x.id};
      const kw = String(fd.get('kw') || '').trim();
      if(kw.length >= 2 && !kwList(x).includes(kw.toLowerCase())){ x.keyword = [...String(x.keyword || '').split(/[,;\n]/).map(v => v.trim()).filter(Boolean), kw].join(', '); x.updatedAt = nowIso(); }
      const made = autoIntake();
      toast(`${x.name}로 지정했습니다.${kw ? ` 검색어 ‘${kw}’도 기억합니다.` : ''}${made.length ? ` 메일로 ${made.length}건을 자동 접수했습니다.` : ''}`);
    }});
}
function mailToRecord(key, rid){
  const t = findThread(key), r = db.records.find(x => x.id === rid);
  if(!t || !r) return;
  t.ms.forEach(m => { attachMail(r, m); seeMail(m.id); });
  addHist(r, `메일 ${t.ms.length}통 연결: “${t.last.subject || ''}”`);
  if(typeof applyCautions === 'function') applyCautions();
  commit(); toast(`${clientName(r.clientId)} 기록에 메일 ${t.ms.length}통을 붙였습니다.`);
}
function markMailDone(){}
function seeMail(id){ if(!db.mailSeen.includes(id)) db.mailSeen.push(id); if(db.mailSeen.length > 5000) db.mailSeen = db.mailSeen.slice(-5000); }

/* ---------- 업체 미인식 점검 ----------
   customs@ 메일(색인 전체 기간)과 자동 수집 미분류 자료 중 업체를 알아보지 못한 것에서 업체 후보를 뽑아 묶는다.
   후보: 보낸 사람 회사 도메인, 본문·제목의 '(주)·주식회사·CO., LTD·CORPORATION' 앞뒤 이름, '○○ 홍길동입니다' 자기소개, 파일명 앞 단어.
   비슷한 기존 업체가 있으면 '검색어 추가', 없으면 '새 업체 추가'를 제안. 무시한 후보는 settings.auditIgnore에 남김. */
const AUDIT_STOP = /^(bsgc|비에스지씨|관세사|관세법인|관세사무소|customs|통관|수입|수출|안녕하세요|감사합니다|문의|요청|re|fw|fwd|the|and|korea|corporation|company|co|ltd|inc|주식회사|유한회사|드림|팀|차장|과장|대리|부장|이사|대표|담당|담당자|첨부|파일|서류|송부|전달|확인|진행|건|관련)$/i;
function auditNorm(s){ return String(s || '').replace(/\(주\)|㈜|주식회사|\(유\)|유한회사/g, '').replace(/[\s.,·"'`()\[\]<>]/g, '').toLowerCase(); }
function auditCands(text, from){
  const out = new Set(), t = String(text || '');
  const add = v => { v = String(v || '').replace(/^[\s\-:·,]+|[\s\-:·,]+$/g, '').trim(); const k = auditNorm(v); if(k.length >= 2 && k.length <= 30 && !AUDIT_STOP.test(k) && !/^\d+$/.test(k)) out.add(v); };
  let m;
  const reK1 = /(?:\(주\)|㈜|주식회사)\s*([가-힣A-Za-z0-9&]{2,15})/g, reK2 = /([가-힣A-Za-z0-9&]{2,15})\s*(?:\(주\)|㈜|주식회사)/g;
  while((m = reK1.exec(t))) add(m[1]);
  while((m = reK2.exec(t))) add(m[1]);
  const reE = /\b([A-Z][A-Za-z0-9&\-]*(?:\s+[A-Z][A-Za-z0-9&\-]*){0,3})\s+(?:CO\.?,?\s*LTD\.?|CORPORATION|CORP\.?|INC\.?|LIMITED|GMBH|S\.?P\.?A\.?)(?![A-Za-z])/g;
  while((m = reE.exec(t))) add(m[1]);
  const reI = /([가-힣A-Za-z]{2,10})\s+[가-힣]{2,4}\s*(?:입니다|드림|올림)/g;
  while((m = reI.exec(t))) add(m[1]);
  consigneeNames(t).forEach(add);                                         // 포워더 A/N의 수하인 'C/ABC TRADING' (11/11 c)
  const em = String(from || '').toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/);
  if(em && !FREE_MAIL.includes(em[1]) && !isOwn(from)) out.add('@' + em[1]);
  return [...out];
}
function auditData(){
  const linked = new Set(db.records.flatMap(r => (r.mails || []).map(m => m.id)));
  const ignore = new Set(db.settings.auditIgnore || []), groups = new Map();
  const put = (cand, src) => {
    const k = cand.startsWith('@') ? cand : auditNorm(cand);
    if(ignore.has(k)) return;
    const g = groups.get(k) || {key:k, name:cand, mails:[], files:[], froms:new Set()};
    if(!cand.startsWith('@') && cand.length > g.name.length && !g.name.startsWith('@')) g.name = cand;
    if(src.mail){ if(!g.mails.some(x => x.id === src.mail.id)) g.mails.push(src.mail); const f = src.mail.fwdFrom || src.mail.from; if(f && !isOwn(f)) g.froms.add(String(f).toLowerCase()); }
    if(src.file && !g.files.some(x => x.id === src.file.id)) g.files.push(src.file);
    groups.set(k, g);
  };
  (mailCache || []).forEach(m => {
    if(matchClient(m)) return;                                          // 이미 업체를 알아본 메일은 제외
    if(isOwn(m.fwdFrom || m.from) && !m.fwdFrom) return;                // 우리 회사가 보낸 메일
    const cs = auditCands([m.subject, m.snippet, m.hints, m.fromName].join(' '), m.fwdFrom || m.from), dom = cs.find(c => c.startsWith('@')), names = cs.filter(c => !c.startsWith('@'));
    if(dom){ put(dom, {mail:m}); const g = groups.get(dom); if(g){ g.names = [...new Set([...(g.names || []), ...names])]; } }   // 회사 도메인이 있으면 그 도메인으로 묶고 이름은 함께 보관
    else names.forEach(c => put(c, {mail:m}));
  });
  (db.collectPending || []).forEach(x => {
    const lead = String(x.name || '').replace(/\.[^.]+$/, '').split(/[\s_]+/).filter(w => /[가-힣]/.test(w) || /^[A-Za-z]{3,}$/.test(w)).slice(0, 2).join(' ');
    [...auditCands(x.name), lead].filter(Boolean).forEach(c => put(c, {file:x}));
  });
  const keyOf = c => [auditNorm(c.name), ...kwList(c).map(auditNorm)].filter(k => k.length >= 2);
  return [...groups.values()].filter(g => g.mails.length + g.files.length > 0).map(g => {
    if(g.key.startsWith('@') && (g.names || []).length) g.name = g.names.slice().sort((x, y) => auditNorm(y).length - auditNorm(x).length)[0], g.domain = g.key;   // 대표 이름은 가장 긴 후보
    const k = auditNorm(g.name.startsWith('@') ? g.key.slice(1).split('.')[0] : g.name);
    const similar = db.clients.filter(c => keyOf(c).some(ck => k.length >= 2 && ck.length >= 2 && (ck.includes(k) || k.includes(ck) || (k.length >= 3 && ck.length >= 3 && (ck.includes(k.slice(0, 3)) || k.includes(ck.slice(0, 3))))))).slice(0, 3);
    const open = g.mails.filter(m => !linked.has(m.id));
    const last = g.mails.map(m => String(m.date).slice(0, 10)).concat(g.files.map(f => f.created || '')).sort().slice(-1)[0] || '';
    return {...g, froms:[...g.froms], similar, open:open.length, last};
  }).sort((a, b) => (b.open + b.files.length) - (a.open + a.files.length) || b.mails.length - a.mails.length || b.last.localeCompare(a.last));
}
function openAudit(){
  if(mailCache === null){ toast('메일을 먼저 불러오는 중입니다. 잠시 뒤 다시 누르세요.'); loadMail(true); return; }
  const list = auditData().slice(0, 80);
  const row = (g, i) => `<tr><td><strong>${esc(g.name)}</strong>${g.froms.length ? `<div class="hint">${esc(g.froms.slice(0, 2).join(', '))}</div>` : ''}</td>
    <td class="num">${g.open}<span class="hint"> / ${g.mails.length}</span>${g.files.length ? `<div class="hint">자료 ${g.files.length}</div>` : ''}</td><td class="hint">${esc(g.last)}</td>
    <td class="hint">${esc(g.mails.slice(0, 2).map(m => m.subject).concat(g.files.slice(0, 1).map(f => f.name)).join(' / ').slice(0, 120))}</td>
    <td>${g.domain ? `<div class="hint">${esc(g.domain)}</div>` : ''}${g.similar.map(c => `<button type="button" class="mini" data-x-aud-kw="${i}|${esc(c.id)}" title="검색어에 '${esc(g.name)}'${g.froms.length ? ' 와 보낸 사람 주소' : ''} 추가">${esc(c.name)}에 추가</button>`).join(' ')}
      <select class="mini" data-x-aud-pick="${i}" title="비슷한 이름이 없을 때(영문 수하인명 등) 기존 업체를 골라 검색어로 추가"><option value="">다른 업체에 추가…</option>${opts(sortedClients().map(c => [c.id, c.name]), '')}</select>
      <button type="button" class="mini strong" data-x-aud-new="${i}">새 업체</button> <button type="button" class="mini" data-x-aud-ign="${i}">무시</button></td></tr>`;
  openDialog({title:'업체 미인식 점검', saveLabel:'닫기', body:`<p class="hint">customs@ 메일 ${(mailCache || []).length}통(최근 수집분)과 자동 수집 미분류 자료 ${(db.collectPending || []).length}건 중 <strong>업체를 알아보지 못한 것</strong>에서 업체 후보를 뽑았습니다. ‘미연결’은 어느 기록에도 붙지 않은 메일 수입니다. 업체명이 아닌 후보(포워더·제품명 등)는 ‘무시’하세요.</p>
    ${list.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>업체 후보</th><th class="num">미연결 / 메일</th><th>최근</th><th>예시</th><th>처리</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>` : '<p class="empty">업체를 알아보지 못한 메일·자료가 없습니다.</p>'}
    <p class="hint">‘○○에 추가’는 그 업체의 검색어에 후보 이름과 보낸 사람 메일 주소(공용 메일이면 주소 전체, 회사 도메인이면 @도메인)를 넣습니다. ‘새 업체’는 업체를 만들고 정보 창을 엽니다. 처리 후 미분류 자료는 자동으로 다시 맞춰 봅니다.</p>`,
    onSave(){ return true; },
    onOpen(f){
      f.addEventListener('change', e => {
        const s = e.target.closest('[data-x-aud-pick]'); if(!s || !s.value) return;
        const g = list[Number(s.dataset.xAudPick)], c = db.clients.find(x => x.id === s.value); if(!g || !c) return;
        const words = g.name.startsWith('@') ? [] : [g.name];
        const cur = kwList(c); c.keyword = [...String(c.keyword || '').split(/[,;\n]/).map(x => x.trim()).filter(Boolean), ...words.filter(w => !cur.includes(w.toLowerCase()))].join(', '); c.updatedAt = nowIso();
        s.closest('tr').style.opacity = .4; s.closest('td').innerHTML = `<span class="hint">${esc(c.name)} 검색어에 ‘${esc(words[0] || '')}’ 추가</span>`; commit();
      });
      f.addEventListener('click', e => {
        const b = e.target.closest('[data-x-aud-kw],[data-x-aud-new],[data-x-aud-ign]'); if(!b) return;
        const d = b.dataset, g = list[Number((d.xAudKw || d.xAudNew || d.xAudIgn).split('|')[0])]; if(!g) return;
        const addrs = g.froms.map(a => { const dm = a.split('@')[1] || ''; return FREE_MAIL.includes(dm) ? a.replace(/^.*<|>.*$/g, '') : '@' + dm; }).filter(x => x.length > 3);
        const words = [...new Set([g.name.startsWith('@') ? '' : g.name, ...addrs])].filter(Boolean);
        const finish = msg => { const r = rematchPending(); b.closest('tr').style.opacity = .4; b.closest('td').innerHTML = `<span class="hint">${esc(msg)}${r ? ` · 미분류 자료 ${r.made + r.upd}건 반영` : ''}</span>`; commit(); };
        if(d.xAudIgn){ db.settings.auditIgnore = [...new Set([...(db.settings.auditIgnore || []), g.key])].slice(-500); finish('무시함'); return; }
        if(d.xAudKw){
          const c = db.clients.find(x => x.id === d.xAudKw.split('|')[1]); if(!c) return;
          const cur = kwList(c); c.keyword = [...String(c.keyword || '').split(/[,;\n]/).map(x => x.trim()).filter(Boolean), ...words.filter(w => !cur.includes(w.toLowerCase()))].join(', '); c.updatedAt = nowIso();
          finish(`${c.name} 검색어에 추가`); return;
        }
        const c = {id:uid(), name:g.name.startsWith('@') ? g.name.slice(1).split('.')[0] : g.name, bizNo:'', industry:'', contact:'', keyword:words.join(', '), notes:'업체 미인식 점검에서 추가', createdAt:nowIso()};
        db.clients.push(c); finish('새 업체 추가'); $('#dlg').close(); openClient(c);
      });
    }});
}
