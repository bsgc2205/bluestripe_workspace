'use strict';
/* ---------- 메뉴 5개·확인함·수집 상태 (구조 개편 4단계, 11/13 c) ----------
   왼쪽 메뉴: ① 오늘 할 일 ② 업무케이스 ③ 업체 ④ 매뉴얼·자료 ⑤ 관리. 각 묶음의 세부 화면은 화면 위 탭으로 오간다(예전 화면 이름·주소는 그대로).
   확인함(check): 사람이 판단해야 하는 것만 한 화면에 — 미연결 메일·업체 미인식 메일·자동 수집 미분류·필증 업체 다름·메일↔UNI-PASS 불일치·'확인 필요' 단계·수집 실패.
   수집 상태(status): 메일 수집기·메일 불러오기·Drive 자료 수집·필증 읽기·UNI-PASS·공공데이터·법령 확인·Drive 자동 저장의 마지막 성공·실패(이 PC 기준, 메일 수집기는 서버 기준).
   사유서·B/L 조회는 케이스 요약 줄에서 바로(도구 탭에도 남김). */
const NAV = [
  {k:'home', go:'home', tabs:[['home', '오늘 할 일'], ['alerts', '확인 알림']]},
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
  if(!n || route.name === 'client' || route.name === 'home') return '';   // 11/15: 홈은 자체 필터 줄(확인 알림·회신 대기 포함)
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
/* 11/15 H-01: 자동 처리 결과를 잠깐 뜨는 알림뿐 아니라 '수집 상태 › 최근 처리 기록'에 남김(200건, 모든 PC 공유) */
function logProc(kind, text){
  if(!db || !text) return;
  const L = db.procLog = db.procLog || [], last = L[L.length - 1], t = String(text).slice(0, 300);
  if(last && last.kind === kind && last.text === t && hoursSince(last.at) < 6) { last.n = (last.n || 1) + 1; last.at = nowIso(); return; }
  L.push({id:uid(), at:nowIso(), kind, text:t, by:me ? me.name || me.id : ''});
  if(L.length > 200) db.procLog = L.slice(-200);
}
function markRun(k, ok, err){
  const s = runStat[k] = runStat[k] || {};
  if(ok){ s.ok = nowIso(); delete s.err; s.fails = 0; }
  else { s.fail = nowIso(); s.err = String(err || '오류').slice(0, 200); s.fails = (s.fails || 0) + 1; logProc('fail', `${RUN_KEYS[k] || k} 실패: ${s.err}`); }
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
    ${procLogHTML()}
    ${typeof autoCheckHTML === 'function' ? autoCheckHTML() : ''}
    <p class="hint">실패가 이어지면: 메일 수집기는 사무실 PC 확인, 그 밖에는 ‘데이터’ 창의 Apps Script 주소·이 PC 토큰과 인터넷 연결을 확인하세요. 오류 문구에 ‘인증키’·‘허용’이 있으면 관리자에게 알립니다.</p>`;
}

function procLogHTML(){
  const L = (db.procLog || []).slice(-40).reverse();
  if(!L.length) return '';
  const lab = {mail:'메일', drive:'Drive 자료', cert:'필증 읽기', fail:'실패', move:'연결 변경', uni:'UNI-PASS'};
  return `<details class="proc-log"><summary>최근 처리 기록 <span class="cnt">${(db.procLog || []).length}</span></summary><ul class="plain">${L.map(x => `<li><span class="rec-date">${esc(kstT(x.at))}</span> <span class="tag${x.kind === 'fail' ? ' bad' : ''}">${esc(lab[x.kind] || x.kind)}</span> ${esc(x.text)}${x.n > 1 ? ` <span class="hint">×${x.n}</span>` : ''} <span class="hint">${esc(x.by || '')}</span></li>`).join('')}</ul></details>`;
}
/* ---- 확인함 ---- */
/* 11/15: 확인함 처리 뜻 통일 — 확정(근거 보고 반영) · 연결 변경(기록·업체 바꿈) · 나중에(날짜까지 숨김) · 업무 아님(목록에서 빼되 '나중에·제외' 탭에서 복구)
   종류별 탭 + 20건 페이지. 행마다 key가 있어 '나중에'를 기억한다(db.checkLater). */
const CHK_PAGE = 20;
let checkTab = '', checkPage = 0;
const BTN = {
  ok:(attr, label = '확정') => `<button class="mini strong" ${attr}>${label}</button>`,
  link:(attr, label = '연결 변경') => `<button class="mini" ${attr}>${label}</button>`,
  later:key => `<button class="mini ghosty" data-chk-later="${esc(key)}" title="정한 날짜까지 목록에서 숨깁니다">나중에</button>`,
  no:attr => `<button class="mini ghosty" ${attr} title="목록에서 빼고 '나중에·제외' 탭에 남깁니다(복구 가능)">업무 아님</button>`
};
function checkGroups(){
  const g = [], later = [];
  if(mailCache){
    const th = mailThreadsList().map(t => ({t, f:threadFlags(t)})).filter(x => !x.f.old && !x.f.ref);   // 참고 메일(반송·세금계산서·내역서·견적)은 뺌 (11/13 f)
    const nocl = th.filter(x => !x.f.client), unl = th.filter(x => x.f.client && (x.f.request || x.f.ageH >= OVERDUE_H));
    if(unl.length) g.push({k:'mail', s:'연결 안 된 메일', title:'기록과 연결 안 된 메일 대화', why:'새 의뢰 후보이거나 24시간 넘게 연결이 안 된 대화', rows:unl.map(({t, f}) => ({key:'mail:' + t.key, t1:t.last.subject || '(제목 없음)', t2:`${f.client.name}${f.how && f.how !== 'manual' ? '(추정)' : ''} · ${t.ms.length}통 · ${Math.floor(f.ageH / 24) ? Math.floor(f.ageH / 24) + '일' : Math.floor(f.ageH) + '시간'} 전${f.request ? ' · 새 의뢰 후보' : ''}`, lvl:f.request ? 'act' : 'chk',
      acts:BTN.ok(`data-mail-make="${esc(t.key)}"`, '업무 시작') + BTN.link(`data-mail-attach="${esc(t.key)}"`, '기록에 붙이기') + BTN.later('mail:' + t.key) + BTN.no(`data-mail-ignore="${esc(t.key)}"`)}))});
    if(nocl.length) g.push({k:'nocl', s:'업체 모름', title:'업체를 알아보지 못한 메일', why:'업체를 지정하고 검색어를 넣으면 다음부터 자동으로 알아봅니다', rows:nocl.map(({t}) => ({key:'mail:' + t.key, t1:t.last.subject || '(제목 없음)', t2:`${t.last.fromName || t.last.from || ''} · ${t.ms.length}통`, lvl:'chk',
      acts:BTN.ok(`data-mail-client="${esc(t.key)}"`, '업체 지정') + BTN.later('mail:' + t.key) + BTN.no(`data-mail-ignore="${esc(t.key)}"`)}))});
  }
  const pend = db.collectPending || [], pk = x => 'pend:' + x.id + '|' + (x.declNo || '');
  const amb = pend.map((x, i) => ({x, i})).filter(({x}) => (x.cands || []).some(id => db.records.some(r => r.id === id)));
  const recLab = r => `${r.caseNo ? r.caseNo + ' · ' : ''}${clientName(r.clientId)} · ${r.status} · ${recDate(r)}`;
  if(amb.length) g.push({k:'amb', s:'후보 여러 건', title:'같은 번호 기록이 여러 건 — 자료를 넣을 기록 고르기', why:'정정·분할·같은 B/L의 다른 건일 수 있어 자동으로 고르지 않았습니다', rows:amb.map(({x, i}) => ({key:pk(x), t1:x.name, t2:`${x.declNo || x.bl || ''} · 후보 ${x.cands.length}건 · ${x.created || ''}`, lvl:'chk',
    acts:`<select data-pend-cand="${i}">${x.cands.map(id => db.records.find(r => r.id === id)).filter(Boolean).map(r => `<option value="${esc(r.id)}">${esc(recLab(r))}</option>`).join('')}</select>` + BTN.ok(`data-pend-rec="${i}"`) + BTN.later(pk(x)) + BTN.no(`data-pend-drop="${i}"`)}))});
  const pendN = pend.map((x, i) => ({x, i})).filter(({x}) => !(x.cands || []).some(id => db.records.some(r => r.id === id)));
  if(pendN.length) g.push({k:'pend', s:'미분류 자료', title:'자동 수집 미분류 자료', why:'신고번호·B/L이 없거나 업체를 알아보지 못한 Drive 자료', rows:pendN.map(({x, i}) => ({key:pk(x), t1:x.name, t2:`${x.kind} / ${x.path || ''} · ${x.created || ''}`, lvl:'ref',
    acts:`<select data-pend-client="${i}"><option value="">업체 선택</option>${opts(sortedClients().map(c => [c.id, c.name]), x.sug || '')}</select>` + BTN.ok(`data-pend-apply="${i}"`) + BTN.later(pk(x)) + BTN.no(`data-pend-drop="${i}"`)}))});
  const cm = db.records.filter(r => r.certMismatch && !r.certMismatch.ok);
  if(cm.length) g.push({k:'cert', s:'필증 업체 다름', title:'필증의 업체가 기록과 다름', why:'다른 업체 필증이 이 기록에 붙었을 수 있습니다 — 틀리면 기록을 열어 자료를 옮기세요', rows:cm.map(r => ({key:'cert:' + r.id, t1:`${r.caseNo || ''} ${r.title}`, t2:`${clientName(r.clientId)} 기록 ← 필증 ${r.certMismatch.file} (${r.certMismatch.party})`, lvl:'chk',
    acts:BTN.ok(`data-cm-ok="${esc(r.id)}"`, '확정(맞음)') + BTN.link(`data-edit-rec="${esc(r.id)}"`, '연결 변경') + BTN.later('cert:' + r.id)}))});
  const chk = db.records.filter(r => r.status !== '완료' && ['customs', 'accept'].some(k => (r.stage || {})[k + 'Lv'] === 'chk'));
  const led = openAlerts().filter(a => a.kind === 'ledger');
  if(chk.length || led.length) g.push({k:'ledger', s:'단계 근거 확인', title:'메일만 근거인 단계 · UNI-PASS와 다름', why:'필증 파일 없이 글로만 “필증 송부”한 메일 — UNI-PASS나 필증으로 확인', rows:[
    ...led.map(a => ({key:'alert:' + a.id, t1:a.title, t2:String(a.text || '').split('\n')[0], lvl:'act', acts:`${alertTargetHTML(a)}` + BTN.ok(`data-alert-done="${esc(a.id)}"`) + BTN.later('alert:' + a.id)})),
    ...chk.filter(r => !led.some(a => a.tid === r.id)).map(r => { const k = (r.stage || {}).customsLv === 'chk' ? 'customs' : 'accept';
      return {key:`stage:${r.id}|${k}`, t1:`${r.caseNo || ''} ${r.title}`, t2:`${clientName(r.clientId)} · ${stageName(r, k)}? ${(r.stage || {})[k]} — ${(r.stage || {})[k + 'By'] || ''}`, lvl:'chk',
        acts:BTN.ok(`data-stage-ok="${esc(r.id)}|${k}"`) + BTN.link(`data-unstage="${esc(r.id)}|${k}"`, '틀림(취소)') + BTN.link(`data-edit-rec="${esc(r.id)}"`, '기록 열기') + BTN.later(`stage:${r.id}|${k}`)}; })]});
  const pv = db.records.filter(r => r.status !== '완료' && typeof procVerHTML === 'function' && / 새 버전/.test(procVerHTML(r)));
  if(pv.length) g.push({k:'pver', s:'매뉴얼 변경', title:'매뉴얼이 바뀐 진행 중 업무', why:'시작한 뒤 매뉴얼이 고쳐졌습니다 — 차이를 보고 필요한 단계만 넣으세요', rows:pv.map(r => ({key:'pver:' + r.id, t1:`${r.caseNo || ''} ${r.title}`, t2:`${clientName(r.clientId)} · ${(r.procVer || {}).s || ''}`, lvl:'ref', acts:BTN.ok(`data-proc-diff="${esc(r.id)}"`, '차이 보기') + BTN.later('pver:' + r.id)}))});
  if(typeof recDupCandidates === 'function'){                              // 11/14 P2: 같은 신고번호·B/L 기록
    const rd = recDupCandidates();
    const lab = r => `${r.caseNo ? r.caseNo + ' ' : ''}${r.title}`.slice(0, 50) + ` (${r.status}, ${recDate(r)})`;
    if(rd.length) g.push({k:'recdup', s:'중복 기록', title:'같은 신고번호·B/L 기록', why:'두 PC·Drive 합치기·묶음 필증 등으로 한 건이 두 기록이 됐을 수 있습니다 — 합치면 메일·자료·단계가 한 기록에 모입니다', rows:rd.map(x => { const [k, o] = recKeepFirst(x.a, x.b) <= 0 ? [x.a, x.b] : [x.b, x.a], key = 'rdup:' + dupPairKey(k.id, o.id);
      return {key, t1:`${clientName(k.clientId)} · ${x.why}`, t2:`남김: ${lab(k)} ← ${lab(o)}`, lvl:x.lvl === 3 ? 'chk' : 'ref', acts:BTN.ok(`data-rdup-merge="${esc(k.id)}|${esc(o.id)}"`, '합치기') + BTN.link(`data-rdup-swap="${esc(o.id)}|${esc(k.id)}" title="반대쪽을 남기고 합치기"`, '반대로') + BTN.link(`data-rdup-no="${esc(k.id)}|${esc(o.id)}"`, '다른 건') + BTN.later(key)}; })});
  }
  if(typeof resolveBillTo === 'function'){                                 // 11/14 P2: 포워더 의뢰 건 청구처 미정
    const cut = addPeriod(today(), -60, 'd'), tb = db.records.filter(r => r.via && !r.billTo && recDate(r) >= cut);
    if(tb.length) g.push({k:'billtbd', s:'청구처 미정', title:'청구처 미정 — 포워더 의뢰 건', why:'청구서 메일·지난 건·기본값으로 정하지 못했습니다. 한 번 정하면 같은 화주·포워더의 다음 건은 따라갑니다', rows:tb.map(r => ({key:'bill:' + r.id, t1:`${r.caseNo || ''} ${r.title}`.trim(), t2:`${clientName(r.clientId)} · 의뢰 ${clientName(r.via)}`, lvl:'chk',
      acts:BTN.ok(`data-bill-set="${esc(r.id)}|via"`, '포워더 청구') + BTN.ok(`data-bill-set="${esc(r.id)}|self"`, '화주 청구') + BTN.later('bill:' + r.id)}))});
  }
  const sc = (db.syncConflicts || []).filter(x => !x.done);               // 11/15 D-01: 두 PC가 같은 칸을 다르게 고친 것
  const FLD = {title:'제목', status:'상태', refNo:'신고번호', bl:'B/L', summary:'요약', assignee:'담당자', clientId:'업체', fee:'수수료', via:'의뢰처', billTo:'청구처', type:'업무 유형', name:'이름', keyword:'검색어', date:'완료일', startDate:'시작일', due:'기한'};
  const confLab = x => { const ks = x.path.split('/').filter(Boolean), kind = ks[0], o = (db[kind] || []).find(y => y.id === ks[1]);
    const who = kind === 'records' ? (o ? `${o.caseNo || ''} ${o.title || ''}`.trim() : '지운 기록') : kind === 'clients' ? (o ? o.name : '지운 업체') : (o ? o.name || o.title || kind : kind);
    return `${who} · ${ks.slice(2).map(k => FLD[k] || k).join(' › ')}`; };
  if(sc.length) g.push({k:'conflict', s:'동시 수정', title:'동시 수정 — 두 PC가 같은 칸을 다르게 고침', why:'이 PC 값을 남겼습니다. 다른 PC 값이 맞으면 바꾸세요', rows:sc.map(x => ({key:'conf:' + x.id, t1:confLab(x), t2:`이 PC: “${String(x.mine ?? '(비움)').slice(0, 40)}” · ${x.by || '다른 PC'}: “${String(x.theirs ?? '(비움)').slice(0, 40)}” · ${String(x.at).slice(5, 16).replace('T', ' ')}`, lvl:'chk',
    acts:BTN.ok(`data-conf-ok="${esc(x.id)}"`, '이대로 확정') + BTN.link(`data-conf-theirs="${esc(x.id)}"`, '다른 PC 값으로')}))});
  const rf = runFails();
  if(rf.length) g.push({k:'run', s:'수집 실패', title:'수집 실패', why:'자동 수집·확인이 실패하고 있습니다', rows:rf.map(x => ({key:'run:' + x.label, t1:x.label, t2:`${x.s.fail ? kstT(x.s.fail) + ' · ' : ''}${x.s.err}`, lvl:'act', acts:`<button class="mini" data-go="status">수집 상태</button>`}))});
  const L = db.checkLater || {}, td = today();                             // '나중에' 날짜가 남은 행은 빼서 later로
  g.forEach(x => { x.rows = x.rows.filter(r => { const l = L[r.key]; if(l && l.until > td){ later.push({...r, grp:x.s, until:l.until}); return false; } return true; }); });
  const out = g.filter(x => x.rows.length);
  out.later = later;
  return out;
}
let checkMemo = {stamp:'', n:0};
function checkCount(){                                                     // 메뉴 숫자용 — 데이터·메일·수집 기록이 바뀔 때만 다시 셈
  const stamp = [db.meta.updatedAt || '', today(), mailCache ? mailCache.length : -1, (db.mailSeen || []).length, (db.collectPending || []).length, (db.alerts || []).length, JSON.stringify(runStat), mailCollectorAt, typeof sync !== 'undefined' ? sync.state : ''].join('|');
  if(checkMemo.stamp === stamp) return checkMemo.n;
  let n = 0; try{ n = checkGroups().reduce((s, x) => s + x.rows.length, 0); }catch(e){}
  checkMemo = {stamp, n}; return n;
}
/* '나중에·제외' 탭: 날짜까지 숨긴 것 + 업무 아님으로 뺀 메일·자료 — 복구 가능 */
function checkOffRows(g){
  const rows = (g.later || []).map(r => ({t1:r.t1, t2:`${r.grp} · ${r.until}까지 숨김`, lvl:'ref', acts:`<button class="mini" data-chk-unlater="${esc(r.key)}">지금 보기</button>`}));
  if(mailCache){
    const ig = new Set(db.mailIgnored || []);
    threadsOf(mailCache.filter(m => ig.has(m.id))).slice(0, 100).forEach(t => rows.push({t1:t.last.subject || '(제목 없음)', t2:`업무 아님(메일) · ${t.ms.length}통 · ${String(t.last.date || '').slice(0, 10)}`, lvl:'ref', acts:`<button class="mini" data-mail-unignore="${esc(t.key)}">복구</button>`}));
  }
  (db.collectDropped || []).slice(-100).reverse().forEach(x => rows.push({t1:x.name, t2:`업무 아님(자료) · ${String(x.droppedAt || '').slice(0, 10)}${x.droppedBy ? ' · ' + x.droppedBy : ''}`, lvl:'ref', acts:`<button class="mini" data-pend-undrop="${esc(x.id)}|${esc(x.declNo || '')}">복구</button>`}));
  return rows;
}
function viewCheck(){
  const g = checkGroups(), n = g.reduce((s, x) => s + x.rows.length, 0), off = checkOffRows(g);
  const tabs = [...g.map(x => ({k:x.k, s:x.s, n:x.rows.length, act:x.rows.some(r => r.lvl === 'act')})), ...(off.length ? [{k:'off', s:'나중에·제외', n:off.length}] : [])];
  if(!tabs.some(t => t.k === checkTab)){ checkTab = (tabs.find(t => t.act) || tabs[0] || {}).k || ''; checkPage = 0; }
  const cur = checkTab === 'off' ? {k:'off', title:'나중에 볼 것 · 업무 아님으로 뺀 것', why:'복구하면 원래 목록으로 돌아갑니다', rows:off} : g.find(x => x.k === checkTab);
  const row = x => `<div class="todo lv-${x.lvl}"><div class="t-main"><strong>${esc(x.t1)}</strong><span class="hint">${esc(x.t2)}</span></div><div class="t-act">${x.acts}</div></div>`;
  const pages = cur ? Math.max(1, Math.ceil(cur.rows.length / CHK_PAGE)) : 1;
  if(checkPage >= pages) checkPage = pages - 1;
  const pager = pages > 1 ? `<div class="pager"><button class="mini" data-chk-page="${checkPage - 1}"${checkPage ? '' : ' disabled'}>‹ 이전</button><span>${checkPage + 1} / ${pages} 쪽 · ${cur.rows.length}건</span><button class="mini" data-chk-page="${checkPage + 1}"${checkPage < pages - 1 ? '' : ' disabled'}>다음 ›</button></div>` : '';
  return `<header class="client-head"><div><h2>확인함 <span class="cnt">${n}건</span></h2><p class="client-meta">자동으로 정하지 못한 것만 모았습니다. <b>확정</b> = 보고 반영 · <b>연결 변경</b> = 기록·업체 바꿈 · <b>나중에</b> = 날짜까지 숨김 · <b>업무 아님</b> = 빼되 복구 가능${mailCache ? '' : ' (메일을 불러오는 중이면 메일 항목은 잠시 뒤 보입니다)'}</p></div></header>
    ${tabs.length ? `<div class="tabs chk-tabs" role="tablist">${tabs.map(t => `<button class="tab${t.k === checkTab ? ' on' : ''}${t.act ? ' act' : ''}" data-chk-tab="${t.k}">${esc(t.s)} <span class="cnt">${t.n}</span></button>`).join('')}</div>` : ''}
    ${cur ? `<section class="chk-grp"><div class="sec-head"><h3>${esc(cur.title)}</h3><span class="hint">${esc(cur.why)}</span></div>${cur.rows.slice(checkPage * CHK_PAGE, (checkPage + 1) * CHK_PAGE).map(row).join('')}${pager}</section>` : '<p class="empty">확인할 것이 없습니다.</p>'}`;
}
function openCheckLater(key){
  openDialog({title:'나중에 확인', saveLabel:'숨기기',
    body:`<p class="hint">정한 날짜가 되면 확인함에 다시 나타납니다. 그 전에는 ‘나중에·제외’ 탭에서 볼 수 있습니다.</p>
      <label>다시 볼 날짜<input type="date" name="until" value="${addPeriod(today(), 3, 'd')}" min="${addPeriod(today(), 1, 'd')}"></label>
      <div class="pick-bar">${[[1, '내일'], [3, '3일 뒤'], [7, '다음 주']].map(([n, l]) => `<button type="button" class="mini" data-d="${addPeriod(today(), n, 'd')}">${l}</button>`).join('')}</div>
      <label>메모 (선택)<input name="note" placeholder="예: 고객 회신 기다림"></label>`,
    onSave(fd){ const u = String(fd.get('until') || ''); if(!u || u <= today()) return false;
      db.checkLater = db.checkLater || {}; db.checkLater[key] = {until:u, note:String(fd.get('note') || ''), at:nowIso(), by:me ? me.id : ''};
      Object.keys(db.checkLater).forEach(k => { if(db.checkLater[k].until < addPeriod(today(), -30, 'd')) delete db.checkLater[k]; });   // 지난 것 정리
      toast(`${u}까지 숨깁니다.`); },
    onOpen(f){ f.querySelectorAll('[data-d]').forEach(b => { b.onclick = () => { f.until.value = b.dataset.d; }; }); }});
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
