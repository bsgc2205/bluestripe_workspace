'use strict';
/* ---------- 메뉴 5개·확인함·수집 상태 (구조 개편 4단계, 11/13 c) ----------
   왼쪽 메뉴: ① 오늘 할 일 ② 업무케이스 ③ 업체 ④ 매뉴얼·자료 ⑤ 관리. 각 묶음의 세부 화면은 화면 위 탭으로 오간다(예전 화면 이름·주소는 그대로).
   확인함(check): 사람이 판단해야 하는 것만 한 화면에 — 미연결 메일·업체 미인식 메일·자동 수집 미분류·필증 업체 다름·메일↔UNI-PASS 불일치·'확인 필요' 단계·수집 실패.
   수집 상태(status): 메일 수집기·메일 불러오기·Drive 자료 수집·필증 읽기·UNI-PASS·공공데이터·법령 확인·Drive 자동 저장의 마지막 성공·실패(이 PC 기준, 메일 수집기는 서버 기준).
   사유서·B/L 조회는 케이스 요약 줄에서 바로(도구 탭에도 남김). */
const NAV = [
  {k:'home', go:'home', tabs:[['home', '오늘 할 일'], ['alerts', '확인 알림'], ['@wait', '회신 대기']]},
  {k:'cases', go:'active', tabs:[['active', '진행 중'], ['check', '확인함'], ['mail', 'customs@ 메일']]},
  {k:'clients', go:'clientlist', tabs:[['clientlist', '거래업체 리스트'], ['contacts', '연락처']]},
  {k:'docs', go:'manual', tabs:[['manual', '업무 매뉴얼'], ['inquiries', '세관 질의 DB'], ['itemdb', '품목 DB'], ['tools', '도구']]},
  {k:'admin', go:'report', tabs:[['report', '월간 리포트'], ['inbox', '자동 수집'], ['status', '수집 상태'], ['accounts', '계정 관리']]}
];
const TOOL_ROUTES = ['fee', 'quote', 'bl'];
function navOf(name){
  if(name === 'client') return NAV[2];
  if(name === 'common') return NAV[3];
  if(TOOL_ROUTES.includes(name)) return NAV[3];
  return NAV.find(n => n.tabs.some(t => t[0] === name)) || null;
}
function navTabsHTML(){
  const n = navOf(route.name);
  if(!n || route.name === 'client') return '';
  const cur = TOOL_ROUTES.includes(route.name) ? 'tools' : route.name === 'common' ? 'manual' : route.name;
  const cnt = {check:checkCount(), mail:typeof mailAlerts === 'function' ? mailAlerts().total : 0, alerts:openAlerts().length, inbox:(db.collectPending || []).length,
    status:runFails().length, '@wait':mailCache && typeof waitSummary === 'function' ? waitSummary().n : 0};
  const tab = ([k, l]) => (k === 'accounts' && !isAdmin()) ? '' : k === '@wait'
    ? `<button class="nav-tab" data-wait-list>${l}${cnt[k] ? ` <span class="cnt">${cnt[k]}</span>` : ''}</button>`
    : `<button class="nav-tab${cur === k ? ' on' : ''}" data-go="${k}">${l}${cnt[k] ? ` <span class="cnt${['check', 'status'].includes(k) ? ' warn' : ''}">${cnt[k]}</span>` : ''}</button>`;
  const tools = cur === 'tools' ? `<div class="nav-tabs sub">${[['fee', '수수료 계산'], ['quote', '운임 견적'], ['bl', 'B/L 조회']].map(([k, l]) => `<button class="nav-tab sm${route.name === k ? ' on' : ''}" data-go="${k}">${l}</button>`).join('')}<button class="nav-tab sm" data-letter>사유서 작성</button></div>` : '';
  return `<div class="nav-tabs" role="tablist">${n.tabs.map(tab).join('')}</div>${tools}`;
}
function viewTools(){
  const card = (go, t, d) => `<button class="tool-card" ${go}><strong>${t}</strong><span class="hint">${d}</span></button>`;
  return `<header class="client-head"><div><h2>도구</h2><p class="client-meta">자주 쓰는 계산·조회 도구입니다. 사유서와 B/L 조회는 업무 케이스의 요약 줄에서도 바로 열립니다.</p></div></header>
    <div class="tool-grid">${card('data-go="fee"', '수수료 계산', '통관 수수료 요율·최저 수수료로 계산')}${card('data-go="quote"', '운임 견적', '포워더 견적 요청·비교')}${card('data-go="bl"', 'B/L 조회', 'UNI-PASS 화물진행정보')}${card('data-letter', '사유서 작성', '정정·지연 사유서 초안')}</div>`;
}

/* ---- 수집 상태 ---- */
const RUN_KEYS = {mail:'메일 불러오기 (customs@ 색인)', drive:'Drive 자료 수집', cert:'필증 읽기', uni:'UNI-PASS 통관 확인', ext:'공공데이터 (요건·관세율 등)', law:'법령 시행일 확인'};
const RUN_LS = 'bsgc-runstat';
let runStat = (() => { try{ return JSON.parse(localStorage.getItem(RUN_LS) || '{}') || {}; }catch(e){ return {}; } })();
function markRun(k, ok, err){
  const s = runStat[k] = runStat[k] || {};
  if(ok){ s.ok = nowIso(); delete s.err; s.fails = 0; }
  else { s.fail = nowIso(); s.err = String(err || '오류').slice(0, 200); s.fails = (s.fails || 0) + 1; }
  try{ localStorage.setItem(RUN_LS, JSON.stringify(runStat)); }catch(e){}
}
const isUtc = t => /Z$|[+-]\d\d:\d\d$/.test(String(t || ''));   // 이 PC 기록은 UTC(nowIso), 서버·메일 시각은 한국 시각 문자열
const hrsAgo = t => isUtc(t) ? (Date.now() - Date.parse(t)) / 3600e3 : hoursSince(t);
const ago = iso => { if(!iso) return ''; const h = hrsAgo(iso); return h < 1 ? '방금' : h < 24 ? `${Math.floor(h)}시간 전` : `${Math.floor(h / 24)}일 전`; };
const kstT = t => !t ? '' : isUtc(t) ? new Date(t).toLocaleString('sv-SE', {timeZone:'Asia/Seoul'}).slice(5, 16) : String(t).replace('T', ' ').slice(5, 16);
function runFails(){
  const out = Object.entries(runStat).filter(([, s]) => s.err && (!s.ok || s.fail > s.ok)).map(([k, s]) => ({k, label:RUN_KEYS[k] || k, s}));
  if(mailCollectorAt && hoursSince(mailCollectorAt) > 1) out.unshift({k:'collector', label:'메일 수집기 (사무실 PC)', s:{err:`${ago(mailCollectorAt)} 마지막 실행 — 사무실 PC 수집기 확인`}});
  if(typeof sync !== 'undefined' && ['fail', 'mismatch'].includes(sync.state)) out.push({k:'sync', label:'Drive 자동 저장', s:{err:sync.err || (sync.state === 'mismatch' ? '다른 열쇠의 Workspace — 오른쪽 위 저장 상태를 누르세요' : '저장 실패')}});
  return out;
}
function viewStatus(){
  const row = (label, s, note) => {
    const bad = s && s.err && (s.bad || !s.ok || (s.fail || '') > s.ok);
    return `<tr class="${bad ? 'bad-row' : ''}"><td>${label}</td><td>${s && s.ok ? `${esc(kstT(s.ok))} <span class="hint">${ago(s.ok)}</span>` : '<span class="hint">기록 없음</span>'}</td>
      <td>${bad ? `<b class="bad">${s.fail ? esc(kstT(s.fail)) : '지금'}</b> ${esc(s.err)}${s.fails > 1 ? ` <span class="hint">(연속 ${s.fails}회)</span>` : ''}` : s && s.fail ? `<span class="hint">${esc(kstT(s.fail))} 이후 정상</span>` : '-'}</td><td class="hint">${note || ''}</td></tr>`;
  };
  const lastMail = (mailCache || []).map(m => m.collectedAt || '').sort().slice(-1)[0] || '';
  const coll = mailCollectorAt ? {ok:mailCollectorAt, ...(hoursSince(mailCollectorAt) > 1 ? {err:'1시간 넘게 실행 기록 없음', bad:true} : {})} : null;
  const sy = typeof sync !== 'undefined' ? {ok:sync.at || '', ...(['fail', 'mismatch'].includes(sync.state) ? {err:sync.err || (sync.state === 'mismatch' ? '다른 열쇠의 Workspace' : '저장 실패'), bad:true} : {})} : null;
  return `<header class="client-head"><div><h2>수집 상태</h2><p class="client-meta">자동으로 도는 일들의 마지막 성공·실패입니다. 메일 수집기는 서버 기준, 나머지는 <b>이 PC 기준</b>(이 PC에서 Workspace를 열어 둔 동안 실행된 것)입니다. 같은 자료는 파일 id·메일 id로 걸러 다시 수집해도 중복으로 들어가지 않습니다.</p></div>
      <div class="client-act"><button class="ghost" data-collect-now>Drive 지금 확인</button><button class="ghost" data-run-uni>UNI-PASS 지금 확인</button><button class="primary" data-run-mail>메일 다시 불러오기</button></div></header>
    <div class="table-wrap"><table class="grid status-grid"><thead><tr><th>작업</th><th>마지막 성공</th><th>실패</th><th>주기</th></tr></thead><tbody>
      ${row('메일 수집기 (사무실 PC)', coll, `15분마다 · 최근 메일 ${lastMail ? esc(String(lastMail).slice(5, 16).replace('T', ' ')) : '없음'}`)}
      ${row(RUN_KEYS.mail, runStat.mail, '로그인·메일 화면·15분마다')}
      ${row(RUN_KEYS.drive, runStat.drive, '매일 08시(수입·수출), 월 15시(BSGC-Backup)')}
      ${row(RUN_KEYS.cert, runStat.cert, '자동 수집 뒤 6개씩')}
      ${row(RUN_KEYS.uni, runStat.uni, '진행 중 수입·수출 12시간마다 15건씩')}
      ${row(RUN_KEYS.ext, runStat.ext, '품목 요건·관세율 자동 확인')}
      ${row(RUN_KEYS.law, runStat.law, '7일마다')}
      ${row('Drive 자동 저장', sy, '고칠 때마다')}
    </tbody></table></div>
    <p class="hint">실패가 이어지면: 메일 수집기는 사무실 PC 확인, 그 밖에는 ‘데이터’ 창의 Apps Script 주소·이 PC 토큰과 인터넷 연결을 확인하세요. 오류 문구에 ‘인증키’·‘허용’이 있으면 관리자에게 알립니다.</p>`;
}

/* ---- 확인함 ---- */
function checkGroups(){
  const g = [];
  if(mailCache){
    const th = mailThreadsList().map(t => ({t, f:threadFlags(t)})).filter(x => !x.f.old && !x.f.ref);   // 참고 메일(반송·세금계산서·내역서·견적)은 뺌 (11/13 f)
    const nocl = th.filter(x => !x.f.client), unl = th.filter(x => x.f.client && (x.f.request || x.f.ageH >= OVERDUE_H));
    if(unl.length) g.push({k:'mail', title:'기록과 연결 안 된 메일 대화', why:'새 의뢰 후보이거나 24시간 넘게 연결이 안 된 대화', rows:unl.map(({t, f}) => ({t1:t.last.subject || '(제목 없음)', t2:`${f.client.name}${f.how && f.how !== 'manual' ? '(추정)' : ''} · ${t.ms.length}통 · ${Math.floor(f.ageH / 24) ? Math.floor(f.ageH / 24) + '일' : Math.floor(f.ageH) + '시간'} 전${f.request ? ' · 새 의뢰 후보' : ''}`, lvl:f.request ? 'act' : 'chk',
      acts:`<button class="mini strong" data-mail-make="${esc(t.key)}">업무 시작</button><button class="mini" data-mail-attach="${esc(t.key)}">기록에 붙이기</button><button class="mini" data-mail-ignore="${esc(t.key)}">무시</button>`}))});
    if(nocl.length) g.push({k:'nocl', title:'업체를 알아보지 못한 메일', why:'업체를 지정하고 검색어를 넣으면 다음부터 자동으로 알아봅니다', rows:nocl.map(({t}) => ({t1:t.last.subject || '(제목 없음)', t2:`${t.last.fromName || t.last.from || ''} · ${t.ms.length}통`, lvl:'chk',
      acts:`<button class="mini strong" data-mail-client="${esc(t.key)}">업체 지정</button><button class="mini" data-mail-ignore="${esc(t.key)}">무시</button>`}))});
  }
  const pend = db.collectPending || [];
  if(pend.length) g.push({k:'pend', title:'자동 수집 미분류 자료', why:'신고번호·B/L이 없거나 업체를 알아보지 못한 Drive 자료', rows:pend.map((x, i) => ({t1:x.name, t2:`${x.kind} / ${x.path || ''} · ${x.created || ''}`, lvl:'ref',
    acts:`<select data-pend-client="${i}"><option value="">업체 선택</option>${opts(sortedClients().map(c => [c.id, c.name]), x.sug || '')}</select><button class="mini strong" data-pend-apply="${i}">반영</button><button class="mini" data-pend-drop="${i}">무시</button>`}))});
  const cm = db.records.filter(r => r.certMismatch && !r.certMismatch.ok);
  if(cm.length) g.push({k:'cert', title:'필증의 업체가 기록과 다름', why:'다른 업체 필증이 이 기록에 붙었을 수 있습니다', rows:cm.map(r => ({t1:`${r.caseNo || ''} ${r.title}`, t2:`${clientName(r.clientId)} 기록 ← 필증 ${r.certMismatch.file} (${r.certMismatch.party})`, lvl:'chk',
    acts:`<button class="mini" data-edit-rec="${esc(r.id)}">기록 열기</button><button class="mini strong" data-cm-ok="${esc(r.id)}">확인함</button>`}))});
  const chk = db.records.filter(r => r.status !== '완료' && ['customs', 'accept'].some(k => (r.stage || {})[k + 'Lv'] === 'chk'));
  const led = openAlerts().filter(a => a.kind === 'ledger');
  if(chk.length || led.length) g.push({k:'ledger', title:'메일만 근거인 단계 · UNI-PASS와 다름', why:'필증 파일 없이 글로만 “필증 송부”한 메일 — UNI-PASS나 필증으로 확인', rows:[
    ...led.map(a => ({t1:a.title, t2:String(a.text || '').split('\n')[0], lvl:'act', acts:`${alertTargetHTML(a)}<button class="mini strong" data-alert-done="${esc(a.id)}">확인함</button>`})),
    ...chk.filter(r => !led.some(a => a.tid === r.id)).map(r => { const k = (r.stage || {}).customsLv === 'chk' ? 'customs' : 'accept';
      return {t1:`${r.caseNo || ''} ${r.title}`, t2:`${clientName(r.clientId)} · ${stageName(r, k)}? ${(r.stage || {})[k]} — ${(r.stage || {})[k + 'By'] || ''}`, lvl:'chk', acts:`<button class="mini" data-edit-rec="${esc(r.id)}">기록 열기</button><button class="mini strong" data-stage-ok="${esc(r.id)}|${k}">확인 완료</button>`}; })]});
  const pv = db.records.filter(r => r.status !== '완료' && typeof procVerHTML === 'function' && / 새 버전/.test(procVerHTML(r)));
  if(pv.length) g.push({k:'pver', title:'매뉴얼이 바뀐 진행 중 업무', why:'시작한 뒤 매뉴얼이 고쳐졌습니다 — 차이를 보고 필요한 단계만 넣으세요', rows:pv.map(r => ({t1:`${r.caseNo || ''} ${r.title}`, t2:`${clientName(r.clientId)} · ${(r.procVer || {}).s || ''}`, lvl:'ref', acts:`<button class="mini strong" data-proc-diff="${esc(r.id)}">차이 보기</button>`}))});
  const rf = runFails();
  if(rf.length) g.push({k:'run', title:'수집 실패', why:'자동 수집·확인이 실패하고 있습니다', rows:rf.map(x => ({t1:x.label, t2:`${x.s.fail ? kstT(x.s.fail) + ' · ' : ''}${x.s.err}`, lvl:'act', acts:`<button class="mini" data-go="status">수집 상태</button>`}))});
  return g;
}
let checkMemo = {stamp:'', n:0};
function checkCount(){                                                     // 메뉴 숫자용 — 데이터·메일·수집 기록이 바뀔 때만 다시 셈
  const stamp = [db.meta.updatedAt || '', mailCache ? mailCache.length : -1, (db.mailSeen || []).length, (db.collectPending || []).length, (db.alerts || []).length, JSON.stringify(runStat), mailCollectorAt, typeof sync !== 'undefined' ? sync.state : ''].join('|');
  if(checkMemo.stamp === stamp) return checkMemo.n;
  let n = 0; try{ n = checkGroups().reduce((s, x) => s + x.rows.length, 0); }catch(e){}
  checkMemo = {stamp, n}; return n;
}
function viewCheck(){
  const g = checkGroups(), n = g.reduce((s, x) => s + x.rows.length, 0);
  const row = x => `<div class="todo lv-${x.lvl}"><div class="t-main"><strong>${esc(x.t1)}</strong><span class="hint">${esc(x.t2)}</span></div><div class="t-act">${x.acts}</div></div>`;
  return `<header class="client-head"><div><h2>확인함 <span class="cnt">${n}건</span></h2><p class="client-meta">자동으로 정하지 못해 사람이 판단해야 하는 것만 모았습니다. 처리하면 목록에서 빠집니다.${mailCache ? '' : ' (메일을 불러오는 중이면 메일 항목은 잠시 뒤 보입니다)'}</p></div></header>
    ${g.length ? g.map(x => `<section class="chk-grp"><div class="sec-head"><h3>${esc(x.title)} <span class="cnt">${x.rows.length}</span></h3><span class="hint">${esc(x.why)}</span></div>${x.rows.slice(0, 30).map(row).join('')}${x.rows.length > 30 ? `<p class="hint">외 ${x.rows.length - 30}건 — ${x.k === 'pend' ? '자동 수집' : x.k === 'mail' || x.k === 'nocl' ? 'customs@ 메일' : ''} 화면에서 모두 볼 수 있습니다.</p>` : ''}</section>`).join('')
      : '<p class="empty">확인할 것이 없습니다.</p>'}`;
}

/* ---- B/L 조회 (케이스 안에서) ---- */
async function openBlDialog(bl){
  openDialog({title:`B/L 조회 — ${bl}`, saveLabel:'닫기', body:'<div data-x="blRes"><p class="hint">UNI-PASS 조회 중…</p></div>', onSave(){ return true; }});
  const el = document.querySelector('#dlg [data-x="blRes"]');
  try{ const j = await collectApi({bl:String(bl).toUpperCase(), blType:'M', year:new Date().getFullYear()}); if(el) el.innerHTML = blResultHTML(j); }
  catch(e){ if(el) el.innerHTML = `<p class="msg">${esc(e.message)}</p>`; }
}
function caseToolLinks(r){
  return `${r.bl ? `<button class="linkish" data-case-bl="${esc(r.bl)}">B/L 조회</button>` : ''}<button class="linkish" data-letter data-client="${esc(r.clientId)}">사유서</button>`;
}

/* ---- 화면 그리기에 끼우기 ---- */
const NAV_VIEWS = {check:viewCheck, status:viewStatus, tools:viewTools};
const renderViewBase4 = renderView;
renderView = function(){
  const v = $('#view');
  if(NAV_VIEWS[route.name]){ hlRe = null; v.innerHTML = NAV_VIEWS[route.name](); }
  else renderViewBase4();
  const tabs = navTabsHTML();
  if(tabs) v.insertAdjacentHTML('afterbegin', tabs);
};
const renderSidebarBase4 = renderSidebar;
renderSidebar = function(){
  renderSidebarBase4();
  const n = navOf(route.name);
  document.querySelectorAll('.side-link[data-go]').forEach(b => b.classList.toggle('on', !!n && b.dataset.go === n.go));
  const ck = checkCount(), cc = $('#cntCheck'); if(cc){ cc.textContent = ck ? `확인 ${ck}` : ''; cc.classList.toggle('warn', ck > 0); }
  const rf = runFails().length, ca = $('#cntAdmin'); if(ca){ ca.textContent = rf ? '!' : ''; ca.classList.toggle('warn', rf > 0); ca.title = rf ? `수집 실패 ${rf}건 — 관리 → 수집 상태` : ''; }
};
document.addEventListener('click', e => {
  if(!db || e.target.closest('dialog')) return;
  const b = e.target.closest('[data-case-bl],[data-cm-ok],[data-run-mail],[data-run-uni]'); if(!b) return;
  const d = b.dataset;
  if('caseBl' in d) openBlDialog(d.caseBl);
  else if('cmOk' in d){ const r = db.records.find(x => x.id === d.cmOk); if(r && r.certMismatch){ r.certMismatch.ok = today(); addHist(r, '필증 업체 다름 — 확인함'); r.updatedAt = nowIso(); commit(); toast('확인함으로 표시했습니다.'); } }
  else if('runMail' in d) loadMail(true);
  else if('runUni' in d){ toast('UNI-PASS로 진행 중 수입·수출 건을 확인합니다…'); refreshCustoms(true).then(() => { renderView(); toast('UNI-PASS 확인을 마쳤습니다.'); }); }
});
