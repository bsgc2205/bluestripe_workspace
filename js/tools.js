'use strict';
/* ---------- KC 인증 목록 ---------- */
function kcRowsFor(cid, q){
  const terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean), sq = x => x.replace(/[\s\-\/.]/g, '');
  return db.kc.filter(k => k.c === cid && terms.every(t => { const h = hay(k.a, k.m, k.pc, k.n, k.no, k.rm, k.hs); return h.includes(t) || sq(h).includes(sq(t)); }));
}
function kcTableHTML(rows, showClient){
  if(!rows.length) return '<p class="empty">해당하는 품목이 없습니다.</p>';
  return `<div class="table-wrap"><table class="grid"><thead><tr>${showClient ? '<th>업체</th>' : ''}<th>Article No</th><th>모델</th><th>HS</th><th>인증 유형</th><th>KC 인증번호</th><th>인증일</th><th>비고</th></tr></thead><tbody>
    ${rows.slice(0,60).map(k => `<tr>${showClient ? `<td>${esc(clientName(k.c))}</td>` : ''}<td class="hs">${esc(k.a)}</td><td>${esc(k.m)}<div class="hint">${esc(k.n || k.pc || '')}</div></td><td class="hs">${esc(k.hs)}</td><td>${esc(k.t || '')}</td><td>${esc(k.no || '')}</td><td>${esc(k.d || '')}</td><td>${k.rm ? `<span class="tag cause">${esc(k.rm)}</span>` : ''}</td></tr>`).join('')}
  </tbody></table></div>${rows.length > 60 ? `<p class="hint">${rows.length}건 중 60건만 보입니다. 검색어를 더 넣어 좁히세요.</p>` : ''}`;
}
function kcSection(c){
  const all = db.kc.filter(k => k.c === c.id);
  if(!all.length) return '';
  const meta = (db.kcMeta || {})[c.id] || {};
  const cnt = t => all.filter(k => k.t === t).length;
  return `<section class="items">
    <div class="sec-head"><h3>KC 인증 목록 <span class="cnt">${all.length}건${meta.version ? ', ' + esc(meta.version) + ' 기준' : ''}</span></h3></div>
    <p class="hint">적합등록 ${cnt('적합등록')}건, 적합인증 ${cnt('적합인증')}건, 확인 필요 표시 ${all.filter(k => k.rm).length}건. 수입 전 Article No나 모델명으로 인증 여부를 확인하세요.</p>
    <input id="kcQ" data-kc-client="${esc(c.id)}" type="search" placeholder="Article No, 모델명, 인증번호로 찾기" style="max-width:420px;margin-top:.5rem">
    <div id="kcTable" style="margin-top:.5rem">${kcTableHTML(all.filter(k => k.rm).length ? all.filter(k => k.rm) : all, false)}</div>
    <p class="hint">처음에는 비고(시리즈 구분 필요, 단종·해지 등)가 있는 품목만 보여 줍니다.</p>
  </section>`;
}

/* ---------- 연락처 ---------- */
function contactRows(){
  const q = ($('#contactQ') ? $('#contactQ').value : '').trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  return db.contacts.filter(c => (contactCat === '전체' || c.cat === contactCat) && terms.every(t => hay(c.cat, c.name, c.code, c.dept, c.person, c.phone, c.fax, c.email, c.address, c.note).includes(t)))
    .sort((a,b) => CONTACT_CATS.indexOf(a.cat) - CONTACT_CATS.indexOf(b.cat) || a.name.localeCompare(b.name,'ko'));
}
function contactTable(){
  const rows = contactRows();
  if(!rows.length) return '<p class="empty">찾는 연락처가 없습니다.</p>';
  return `<div class="table-wrap"><table class="grid"><thead><tr><th>구분</th><th>이름</th><th>부서·담당</th><th>전화</th><th>팩스</th><th>메일</th><th>주소</th><th>메모</th><th></th></tr></thead><tbody>
    ${rows.map(c => `<tr><td>${esc(c.cat)}</td><td><strong>${esc(c.name)}</strong>${c.code ? `<div class="hint">${esc(c.code)}</div>` : ''}</td><td>${esc([c.dept, c.person].filter(Boolean).join(' '))}</td><td class="pre">${esc(c.phone || '')}</td><td>${esc(c.fax || '')}</td><td>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''}</td><td class="pre">${esc(c.address || '')}</td><td class="pre">${esc(c.note || '')}</td><td><button class="mini" data-contact-edit="${esc(c.id)}">수정</button></td></tr>`).join('')}
  </tbody></table></div>`;
}
function viewContacts(){
  const cats = ['전체', ...CONTACT_CATS.filter(k => db.contacts.some(c => c.cat === k))];
  return `<header class="client-head"><div><h2>연락처</h2><p class="client-meta">선사, 포워더, 창고, 터미널, 세관 연락처 ${db.contacts.length}건</p></div>
      <div class="client-act"><button class="primary" data-contact-new>연락처 추가</button></div></header>
    <div class="chips">${cats.map(k => `<button class="chip${k === contactCat ? ' on' : ''}" data-contact-cat="${esc(k)}">${esc(k)}</button>`).join('')}</div>
    <div class="filters"><input id="contactQ" type="search" placeholder="이름, 전화번호, 부호, 메모로 찾기" style="max-width:420px"></div>
    <div id="contactTable">${contactTable()}</div>
    <p class="hint">사이트 아이디와 비밀번호는 연락처에 넣지 말고 비밀번호 관리 프로그램에 따로 보관하세요.</p>`;
}
function openContact(c){
  const isNew = !c;
  const ct = c || {id:uid(), cat: contactCat !== '전체' ? contactCat : '선사', name:'', code:'', dept:'', person:'', phone:'', fax:'', email:'', address:'', note:''};
  openDialog({
    title: isNew ? '연락처 추가' : '연락처 수정',
    body: `<div class="row2"><label>구분<select name="cat">${opts(CONTACT_CATS, ct.cat)}</select></label><label>이름<input name="name" required value="${esc(ct.name)}"></label></div>
      <div class="row2"><label>부호·코드<input name="code" value="${esc(ct.code || '')}" placeholder="장치장 부호 등"></label><label>부서<input name="dept" value="${esc(ct.dept || '')}"></label></div>
      <div class="row2"><label>담당자<input name="person" value="${esc(ct.person || '')}"></label><label>메일<input name="email" value="${esc(ct.email || '')}"></label></div>
      <div class="row2"><label>전화 (여러 개면 줄바꿈)<textarea name="phone" rows="2">${esc(ct.phone || '')}</textarea></label><label>팩스<input name="fax" value="${esc(ct.fax || '')}"></label></div>
      <label>주소<textarea name="address" rows="2">${esc(ct.address || '')}</textarea></label>
      <label>메모 (D/O 신청 방법, 프리타임, 주의사항)<textarea name="note" rows="3">${esc(ct.note || '')}</textarea></label>`,
    onSave(fd){
      if(/(비번|비밀번호|password|\bpw\b)/i.test(fd.get('note')) && !confirm('메모에 비밀번호로 보이는 내용이 있습니다. 그래도 저장할까요?')) return false;
      ['cat','name','code','dept','person','phone','fax','email','address','note'].forEach(k => ct[k] = String(fd.get(k) || '').trim());
      if(isNew) db.contacts.push(ct);
      toast(isNew ? '연락처를 추가했습니다.' : '연락처를 수정했습니다.');
    },
    onDelete: isNew ? null : () => { if(!confirm(`‘${ct.name}’ 연락처를 삭제할까요?`)) return false; db.contacts = db.contacts.filter(x => x.id !== ct.id); toast('삭제했습니다.'); }
  });
}

/* ---------- 통관수수료 계산 ---------- */
function floor10(n){return Math.floor(n / 10) * 10;}
function num(v){return Number(String(v ?? '').replace(/[^\d.]/g,'')) || 0;}
function calcFee(amount, p){
  let fee = p.flat ? p.flat : floor10(amount * (p.rate || 0));
  if(!p.flat && p.min && fee < p.min) fee = p.min;
  if(!p.flat && p.max && fee > p.max) fee = p.max;
  return {fee, vat: floor10(fee * 0.1)};
}
function feeProfileText(p){
  if(p.flat) return `정액 ${won(p.flat)}`;
  return `${+(p.rate * 100).toFixed(4)}%` + (p.min ? `, 최소 ${won(p.min)}` : '') + (p.max ? `, 최대 ${won(p.max)}` : '');
}
function currentFeeProfile(){
  if(feeState.pid && feeState.pid !== '__own') return db.settings.feeProfiles.find(p => p.id === feeState.pid);
  return {name:'직접 입력', rate: num(feeState.rate) / 100, min: num(feeState.min), max: num(feeState.max)};
}
function feeOutHTML(){
  const amount = num(feeState.amount), p = currentFeeProfile();
  if(!p) return '';
  const {fee, vat} = calcFee(amount, p);
  const extras = lines(feeState.extras).map(l => { const [n, a, t] = l.split('|').map(x => x.trim()); const amt = num(a); return {n: n || '추가 항목', amt, vat: /^(y|과세|o)$/i.test(t || '') ? floor10(amt * 0.1) : 0}; }).filter(e => e.amt);
  const total = fee + vat + extras.reduce((s, e) => s + e.amt + e.vat, 0);
  const rows = [['통관수수료 (공급가)', fee], ['부가세', vat], ...extras.flatMap(e => e.vat ? [[e.n, e.amt], [e.n + ' 부가세', e.vat]] : [[e.n, e.amt]])];
  return `<table class="grid"><tbody>${rows.map(([n,v]) => `<tr><td>${esc(n)}</td><td class="num">${won(v)}</td></tr>`).join('')}<tr class="total"><td>합계</td><td class="num">${won(total)}</td></tr></tbody></table>
    <p class="hint">${esc(p.name)}: ${esc(feeProfileText(p))}. 신고금액 ${won(amount)} 기준, 수수료와 부가세는 10원 미만 버림.</p>
    <button class="ghost" data-fee-copy>결과 복사</button>`;
}
function viewFee(){
  const ps = db.settings.feeProfiles;
  if(!feeState.pid && ps.length) feeState.pid = ps[0].id;
  return `<header class="client-head"><div><h2>통관수수료 계산</h2><p class="client-meta">신고금액에 요율을 곱하고 최소·최대 금액을 적용합니다.</p></div></header>
    <div class="fee-grid">
      <section>
        <label>신고금액 (원)<input data-fee="amount" inputmode="numeric" value="${esc(feeState.amount)}" placeholder="예: 22,286,729"></label>
        <label>수수료 기준<select data-fee="pid">${opts([...ps.map(p => [p.id, `${p.name} (${feeProfileText(p)})`]), ['__own','직접 입력']], feeState.pid)}</select></label>
        <div class="row2" ${feeState.pid === '__own' ? '' : 'hidden'} data-own>
          <label>요율 (%)<input data-fee="rate" inputmode="decimal" value="${esc(feeState.rate)}" placeholder="0.15"></label>
          <label>최소 / 최대 (원)<span style="display:flex;gap:.4rem"><input data-fee="min" inputmode="numeric" value="${esc(feeState.min)}" placeholder="최소"><input data-fee="max" inputmode="numeric" value="${esc(feeState.max)}" placeholder="최대"></span></label>
        </div>
        <label>추가 항목 (항목 | 금액 | 과세면 Y, 한 줄에 하나)<textarea data-fee="extras" rows="3" placeholder="검사대행 | 30,000 | Y&#10;개별담보 설정 | 200,000">${esc(feeState.extras)}</textarea></label>
        <div class="fee-out" id="feeOut">${feeOutHTML()}</div>
      </section>
      <section>
        <div class="sec-head"><h3>수수료 기준 <span class="cnt">${ps.length}개</span></h3><button class="mini" data-fee-new>기준 추가</button></div>
        ${ps.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>이름</th><th>구분</th><th>기준</th><th></th></tr></thead><tbody>${ps.map(p => `<tr><td>${esc(p.name)}${p.note ? `<div class="hint">${esc(p.note)}</div>` : ''}</td><td>${esc(p.kind || '')}</td><td>${esc(feeProfileText(p))}</td><td><button class="mini" data-fee-edit="${esc(p.id)}">수정</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">수수료 기준이 없습니다. 병합 파일을 가져오거나 직접 추가하세요.</p>'}
      </section>
    </div>`;
}
function openFeeProfile(p){
  const isNew = !p;
  const fp = p || {id:uid(), name:'', kind:'수입', rate:0.002, min:0, max:0, flat:0, note:''};
  openDialog({
    title: isNew ? '수수료 기준 추가' : '수수료 기준 수정',
    body: `<div class="row2"><label>이름 (업체명 등)<input name="name" required value="${esc(fp.name)}"></label><label>구분<select name="kind">${opts(['수입','수출','공통'], fp.kind || '수입')}</select></label></div>
      <div class="row2"><label>요율 (%)<input name="rate" inputmode="decimal" value="${fp.rate ? +(fp.rate * 100).toFixed(4) : ''}"></label><label>정액 (원, 넣으면 요율 대신 사용)<input name="flat" inputmode="numeric" value="${fp.flat || ''}"></label></div>
      <div class="row2"><label>최소 공급가 (원)<input name="min" inputmode="numeric" value="${fp.min || ''}"></label><label>최대 공급가 (원)<input name="max" inputmode="numeric" value="${fp.max || ''}"></label></div>
      <label>메모<input name="note" value="${esc(fp.note || '')}"></label>`,
    onSave(fd){
      const v = {name: fd.get('name').trim(), kind: fd.get('kind'), rate: num(fd.get('rate')) / 100, flat: num(fd.get('flat')), min: num(fd.get('min')), max: num(fd.get('max')), note: fd.get('note').trim()};
      if(!v.rate && !v.flat){toast('요율이나 정액 중 하나는 넣어 주세요.'); return false;}
      Object.assign(fp, v);
      if(isNew) db.settings.feeProfiles.push(fp);
      toast('저장했습니다.');
    },
    onDelete: isNew ? null : () => { if(!confirm(`‘${fp.name}’ 기준을 삭제할까요?`)) return false; db.settings.feeProfiles = db.settings.feeProfiles.filter(x => x.id !== fp.id); if(feeState.pid === fp.id) feeState.pid = ''; }
  });
}

/* ---------- B/L 조회 (UNI-PASS, Apps Script 경유) ---------- */
const BL_LABELS = {cargMtNo:'화물관리번호', prgsStts:'진행상태', csclPrgsStts:'통관진행상태', mblNo:'M B/L', hblNo:'H B/L', shipNm:'선박·편명', shipNatNm:'선박 국적', shcoFlco:'선사·항공사', agnc:'선박대리점', etprDt:'입항일', etprCstm:'입항세관', vydf:'항차', ldprNm:'적재항', dsprNm:'양륙항', prnm:'품명', pckGcnt:'포장 개수', pckUt:'포장 단위', ttwg:'총중량', wghtUt:'중량 단위', msrm:'용적', cntrGcnt:'컨테이너 수', cntrNo:'컨테이너 번호', cargTp:'화물구분', blPtNm:'B/L 유형', frwrEntsConm:'포워더', prcsDttm:'처리 일시', spcnCargCd:'특수화물', mtTrgtCargYnNm:'관리대상', rlseDtyPridPassTpcd:'반출의무 경과', dclrDelyAdtxYn:'신고지연 가산세', cargTrcnRelaBsopTpcd:'처리구분', shedNm:'장치장', shedSgn:'장치장 부호', rlbrCn:'반출입 내용', rlbrDttm:'반출입 일시', dclrNo:'신고번호', wght:'중량', bfhnGdncCn:'사전안내', tkinDt:'반입일'};
function viewBl(){
  const cfg = db.settings.mail || {};
  const yr = new Date().getFullYear();
  return `<header class="client-head"><div><h2>B/L 조회</h2><p class="client-meta">관세청 UNI-PASS 화물통관진행정보를 Apps Script를 거쳐 조회합니다.</p></div>
      <div class="client-act"><a class="btn" href="https://unipass.customs.go.kr/csp/index.do" target="_blank" rel="noopener noreferrer">UNI-PASS 열기</a></div></header>
    ${!cfg.endpoint ? '<div class="setup"><p>Gmail 연동과 같은 Apps Script를 씁니다. 데이터 메뉴에 웹 앱 주소와 토큰을 넣고, Apps Script에서 <code>saveUnipassKey</code>로 UNI-PASS 인증키를 저장하세요. 자세한 순서는 README의 ‘B/L 조회’를 보세요.</p></div>' : ''}
    <div class="bl-form">
      <label>B/L 번호<input id="blNo" placeholder="예: HDMU1234567" style="min-width:16rem"></label>
      <label>구분<select id="blType"><option value="M">Master B/L</option><option value="H">House B/L</option></select></label>
      <label>연도<input id="blYear" type="number" value="${yr}" min="2000" max="${yr + 1}" style="width:6.5rem"></label>
      <button class="primary" data-bl-go${blBusy ? ' disabled' : ''}>${blBusy ? '조회 중…' : '조회'}</button>
    </div>
    <div id="blOut" class="narrow">${blResult ? blResultHTML(blResult) : ''}</div>`;
}
function blResultHTML(j){
  if(!j.ok) return `<p class="msg">${esc(j.error || '조회하지 못했습니다.')}</p>`;
  const main = j.main || [];
  if(!main.length) return `<p class="empty">결과가 없습니다. ${esc((j.info || {}).ntceInfo || '')}</p>`;
  if(main.length > 1 && !(j.details || []).length) return `<p class="hint">같은 번호의 화물이 ${main.length}건 있습니다. 화물관리번호를 골라 다시 조회하세요.</p><ul class="pre-check">${main.map(m => `<li><button class="linkish" data-bl-cargo="${esc(m.cargMtNo)}">${esc(m.cargMtNo)}</button> <span class="hint">${esc([m.prnm, m.etprDt, m.csclPrgsStts].filter(Boolean).join(' / '))}</span></li>`).join('')}</ul>`;
  const kv = Object.entries(main[0]).filter(([,v]) => v !== '' && v != null);
  const det = j.details || [];
  const cols = det.length ? Object.keys(det[0]) : [];
  return `<dl class="kv">${kv.map(([k,v]) => `<dt>${esc(BL_LABELS[k] || k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${det.length ? `<h4 class="sub">처리 이력 ${det.length}건</h4><div class="table-wrap"><table class="grid"><thead><tr>${cols.map(k => `<th>${esc(BL_LABELS[k] || k)}</th>`).join('')}</tr></thead><tbody>${det.map(d => `<tr>${cols.map(k => `<td>${esc(d[k] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}`;
}
async function queryBl(params){
  const cfg = db.settings.mail || {};
  if(!cfg.endpoint || !cfg.token){toast('먼저 데이터 메뉴에서 Apps Script 웹 앱 주소와 토큰을 넣어 주세요.'); return;}
  blBusy = true; renderView();
  try{
    const u = new URL(cfg.endpoint); u.searchParams.set('token', cfg.token);
    Object.entries(params).forEach(([k,v]) => u.searchParams.set(k, v));
    blResult = await (await fetch(u.href)).json();
  }catch(e){ blResult = {ok:false, error:'조회하지 못했습니다 (' + e.message + '). Apps Script를 새 버전으로 배포했는지 확인하세요.'}; }
  blBusy = false; renderView();
}
