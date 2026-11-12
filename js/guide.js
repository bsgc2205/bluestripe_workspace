'use strict';
/* ---------- 유사 업무 가이드 (G3, 11/9 재설계) ----------
   새 기록 창·진행 중 기록·customs@ 대화에 '비슷한 과거 건'(완료 기록)을 3~5개 보여 준다.
   기준은 '업무 내용·절차가 같은가'. 같은 업체·같은 업무유형(수입통관 등)만으로는 보여 주지 않는다.
   ① 절차 특징(SIM_PROC): 요건확인(식약처·검역·KC·화학물질…), 감면·특례(재수입·재수출·임가공·무상…), FTA, 정정, 검사, 보세·반송 등
      기록 제목·특이사항·요약(메일 서명·인사말 잘라냄)·태그·서류 목록·품목 요건·UNI-PASS 요건에서 찾는다. 겹치는 특징 1개 18점(최대 36)
   ② 같은 품목 20 / HS 6단위 15 / 4단위 8 ③ 같은 정정 원인 개당 6(최대 18) ④ 업체 전용 절차(매뉴얼)가 같음 15
   ⑤ 업무 단어 겹침: 제목·특이사항·품목명·직접 단 태그의 낱말만(인사말·서명·직함·어미 제외, 두 글자 조각 비교 안 함) 개당 5(최대 15)
   ⑥ 보조: 같은 업체 10 · 같은 유형 6 · 같은 운송형태 3 · 같은 선사 3 · 특이 기록 2 — 보조 점수만으로는 보여 주지 않음.
   ①~④ 중 하나, 또는 ⑤가 2개 이상 겹쳐야 하고 SIM_MIN점 이상일 때만 보여 준다. 세관 질의 DB도 같은 기준으로 찾는다. */
const SIM_MIN = 24;
const SIM_PROC = [
  ['식품 수입신고', /수입식품|식품\s*등?의?\s*수입\s*신고|식약처|식품의약품안전|정밀\s*검사|무작위\s*검사|기구\s*[·및]?\s*용기|식품용\s*기구|기구.{0,4}식품|haccp|한글\s*표시/i],
  ['동식물 검역', /식물\s*검역|동물\s*검역|식물방역|검역\s*(신청|증명|대상|합격|불합격)|훈증|소독\s*증명|위생\s*증명|phyto/i],
  ['사료', /사료|feed(?![a-z])/i],
  ['전파·KC', /전파\s*인증|적합성\s*평가|전파법|rra(?![a-z])|kc\s*인증|kc(?![a-z])\s*(번호|대상)/i],
  ['전기·생활용품 안전', /전기\s*용품|전기\s*안전|생활\s*용품|어린이\s*제품|안전\s*인증|안전\s*확인|공급자\s*적합성|kats|제품안전/i],
  ['화학물질(화평법·화관법)', /화평법|화관법|화학물질|유해\s*화학|등록\s*면제|확인\s*명세서|k-?reach|cas\s*(no|번호)/i],
  ['위험물·MSDS', /위험물|msds|(?<![a-z])un\s*\d{4}|imdg|고압가스/i],
  ['의료기기', /의료\s*기기|표준\s*통관\s*예정/],
  ['의약품·화장품', /의약품|의약외품|화장품/],
  ['폐기물·재활용', /폐기물|바젤|재활용/],
  ['전략물자', /전략\s*물자|수출\s*허가|yestrade/i],
  ['재수입 면세', /재수입|re-?import|반입\s*거절|반송\s*재수입|제?\s*99\s*조/i],
  ['재수출 면세·조건부', /재수출|re-?export|일시\s*수입|수리\s*후\s*재수출|a\.?t\.?a\s*(까르네|carnet)|제?\s*9[78]\s*조/i],
  ['해외임가공', /임가공|제?\s*101\s*조/],
  ['무상·견본', /무상|견본|샘플|sample|f\.?o\.?c(?![a-z])|무환/i],
  ['FTA·원산지', /fta|원산지(?!\s*관리사)|(?<![a-z])c\/o(?![a-z])|form\s*[ae](?![a-z])|사후\s*적용|협정\s*관세|원산지\s*증명/i],
  ['정정·보정', /정정|보정|수정\s*신고|경정|취하|각하/],
  ['과세가격', /과세\s*가격|가산세|가산금|특수\s*관계|로열티|운임\s*(공제|가산)|저가\s*신고/],
  ['품목분류', /품목\s*분류|세번\s*변경|사전\s*심사|hs\s*(변경|분류)/i],
  ['관세 환급', /환급|drawback/i],
  ['세관 검사', /검사\s*대상|현품\s*검사|적재지\s*검사|세관\s*검사|x-?ray|엑스레이/i],
  ['보세·반송', /보세\s*운송|반송|보세\s*공장|장치\s*기간|체화|보세\s*창고/],
  ['외환', /외환|지급\s*신고|해외\s*직접\s*투자|대외\s*지급/],
  ['특송·우편', /특송|(?<![a-z])ems(?![a-z])|우편물|목록\s*통관|간이\s*신고/i]
];
const SIM_WEAK = [['항공', /항공|air(?![a-z])/i], ['해상 LCL', /lcl/i], ['해상 FCL', /fcl|\d{2}\s*(ft|피트)/i]];
const SIM_STOP = new Set(('수입 수출 통관 신고 수입통관 수출통관 수입신고 수출신고 관련 관련하여 요청 의뢰 부탁 문의 신청 진행 건 건의 표제 표제건 금번 이번 해당 '
  + '안녕하세요 감사합니다 수고하세요 수고하십니다 고맙습니다 확인 송부 전달 회신 답장 자료 서류 첨부 메일 업무 처리 완료 자동 단계 수리 납부 반출신고 수입신고수리 '
  + '선적완료 정산완료 통관완료 정산서 청구서 필증 수출신고필증 수입신고필증 면장 면허 건입니다 드림 드리오니 드리며 드립니다 드려요 올림 배상 '
  + '차장 대리 과장 부장 실장 팀장 이사 상무 전무 대표 사원 주임 계장 수석 책임 선임 매니저 담당 담당자 님 차장님 대리님 과장님 부장님 실장님 팀장님 '
  + '전화 팩스 휴대폰 핸드폰 주소 서울 서울특별시 금천구 가산디지털 가산디지털1로 에이스 에이스가산포휴 포휴 카카오 kakao '
  + 'eta etd ata atd custom clearance shipping shipment document documents doc docs arrival notice sea air dry cargo freight booking schedule vessel container '
  + 'jan feb mar apr may jun jul aug sep oct nov dec 해상 항공 해상수입 항공수입 해상수출 항공수출 수출면장 수입면장 면허요청 면장요청 정산내역 발급 선적서류 선적 도착 입항 출항 '
  + '가능 여부 검토 화주 수하인 송하인 total 입항분 출항분 진행요청 확인요청 발급요청 '
  + 're fw fwd the and for of to in on with please dear regards kind best thanks thank you sent from subject date mr ms team dept manager tel fax mobile email www http https com net co kr '
  + 'invoice packing list bl b/l ltd inc corp bsgc customs networks uni pass 및 등 각 위 아래 금일 오늘 내일 다음 관세사 관세법인 주식회사 원산지관리사').split(' '));
const SIM_ENDING = /(니다|니까|세요|십시오|드림|드리|드려|오니|하며|하여|해서|하고|하신|하는|하실|되어|되며|됩니다|주시|주셔|바랍|바람|감사|수고|안녕|하겠|겠습|있습|없습|었습|였습|입니|합니|습니|부탁)/;
const SIM_PARTICLE = /(에서|으로|에게|까지|부터|이며|이고|이나|입니다|은|는|이|가|을|를|에|의|로|와|과|도|만)$/;
const CASE_RE_G = new RegExp(CASE_RE.source, 'g');
function hsDigits(s){ const d = String(s || '').replace(/[^0-9]/g, ''); return d.length >= 4 ? d.slice(0, 10) : ''; }
function fmtHs(d){ d = String(d || ''); return d.length > 4 ? d.slice(0, 4) + '.' + d.slice(4, 6) + (d.length > 6 ? '-' + d.slice(6) : '') : d; }
function hsInText(text){ const m = /(?:hs|세번)\s*(?:code|코드|no\.?|번호)?\s*[:#]?\s*(\d{4}[.\-\s]?\d{2}(?:[.\-\s]?\d{2,4})?)/i.exec(String(text || '')); return m ? hsDigits(m[1]) : ''; }
function carrierOf(bl){ const m = /^([A-Z]{4})\d/.exec(String(bl || '').toUpperCase()); return m ? m[1] : ''; }
/* 메일 본문 앞부분에서 서명·인용·인사말을 잘라 업무 내용만 남김 */
const MAIL_CUT = /(감사합니다|감사드립니다|고맙습니다|수고하세요|\*\*\s*personal|best\s*regards|kind\s*regards|regards|thanks?(\s*you)?[,.!\s]|bsgc\s*customs\s*networks|date\s*:|from\s*:|sent\s*:|-----\s*original|보낸\s*사람|─{3,}|_{5,}|발신\s*:|\bT\.\s*0\d)/i;
function stripMailNoise(s){
  const t = String(s || ''); const m = MAIL_CUT.exec(t);
  return (m ? t.slice(0, m.index) : t).replace(/^\s*(안녕하세요|안녕하십니까)[.!,]?\s*/, '').replace(/^[^.\n]{0,40}(입니다|드림|배상)[.,]?\s*/, '');
}
let simCache = {stamp:'', feats:new Map(), stop:new Set(), spread:null};
function simStop(){
  const st = (db.meta.updatedAt || '') + '|' + db.records.length + '|' + db.clients.length + '|' + db.items.length;
  if(simCache.stamp !== st){
    const stop = new Set();   // 업체명·약칭은 '같은 업체' 점수로 따로 보고, 직원·담당자 이름은 업무 내용이 아니므로 뺀다
    db.clients.forEach(c => [nameKey(c.name), ...kwList(c).filter(k => !k.startsWith('@')), ...(c.contacts || []).map(p => p.name)].forEach(w => String(w || '').split(/\s+/).forEach(x => { if(x) stop.add(x.toLowerCase()); })));
    (typeof accounts !== 'undefined' ? accounts : []).forEach(a => String(a.name || '').split(/\s+/).forEach(x => { if(x) stop.add(x.toLowerCase()); }));
    (db.contacts || []).forEach(p => String(p.name || '').split(/\s+/).forEach(x => { if(x) stop.add(x.toLowerCase()); }));
    simCache = {stamp:st, feats:new Map(), stop, spread:null};
  }
  return simCache.stop;
}
/* 업무 낱말: 인사말·직함·서명·어미가 붙은 말·조각(두 글자 비교)은 쓰지 않는다 */
function simTokens(text){
  const stop = simStop();
  const t = String(text || '').toLowerCase().replace(CASE_RE_G, ' ').replace(/\b\d{5}-\d{2}-\d{6,7}[a-z]?\b/g, ' ').replace(/[a-z]{2,}[a-z0-9]*\d{5,}[a-z0-9]*/g, ' ').replace(/\d{2,4}[-./]\d{1,2}[-./]\d{1,2}/g, ' ');
  const out = new Set();
  t.split(/[^0-9a-z가-힣]+/).forEach(w0 => {
    let w = w0;
    if(/^[가-힣]{3,}$/.test(w)) w = w.replace(SIM_PARTICLE, '');
    if(w.length < 2 || /^\d+$/.test(w) || /^[a-z]{1,2}\d*$/.test(w) || SIM_STOP.has(w) || stop.has(w) || stop.has(w0)) return;
    if(/[가-힣]/.test(w) && SIM_ENDING.test(w)) return;
    if(/^[a-z]+$/.test(w) && w.length < 3) return;
    if(/^\d+(팔렛|파레트|박스|건|개|ea|pcs|cbm|kg|ctn|plt|ft|피트)$/.test(w)) return;
    out.add(w);
  });
  return out;
}
/* 여러 업체 기록에 두루 나오는 낱말(포워더 이름, 물류 일반 용어, 국가명 등)은 업무 내용 근거로 쓰지 않는다: 3곳 이상 업체 & 업체의 10% 이상, 또는 기록의 15% 이상 */
function simCommon(){
  if(simCache.spread) return simCache.spread;
  const by = new Map(), df = new Map(), recs = db.records;
  recs.forEach(r => { recFeat(r).tokens.forEach(w => { df.set(w, (df.get(w) || 0) + 1); if(r.clientId){ if(!by.has(w)) by.set(w, new Set()); by.get(w).add(r.clientId); } }); });
  const nc = new Set(recs.map(r => r.clientId).filter(Boolean)).size || 1, common = new Set();
  df.forEach((n, w) => { const sp = (by.get(w) || new Set()).size; if((sp >= 3 && sp / nc >= 0.1) || (recs.length >= 20 && n / recs.length >= 0.15)) common.add(w); });
  simCache.spread = common;
  return common;
}
function procTags(text){ const t = String(text || ''); return SIM_PROC.filter(([, re]) => re.test(t)).map(x => x[0]); }
function weakTags(text){ const t = String(text || ''); return SIM_WEAK.filter(([, re]) => re.test(t)).map(x => x[0]); }
/* 자동 완료 요약·체크리스트 줄은 모든 기록에 비슷하게 들어가므로 뺀다 */
function cleanSummary(s){ return lines(s).filter(l => !/^[✓–-]\s/.test(l) && l !== '처리 단계' && !l.startsWith('[자동 완료]')).join(' ').slice(0, 400); }
const AUTO_TAGS = new Set(['자동접수', '자동수집', '주간현황', '정정필증']);
function recFeat(r, cache = true){
  if(cache && r.id && simCache.feats.has(r.id)) return simCache.feats.get(r.id);
  simStop();
  const item = r.itemId ? db.items.find(i => i.id === r.itemId) : null;
  const userTags = (r.tags || []).filter(x => !AUTO_TAGS.has(x));
  const summary = stripMailNoise(cleanSummary(r.summary));
  const certNames = (r.certs || []).flatMap(c => (c.lines || []).map(l => l.trade || l.name || '')).join(' ');
  const procText = [r.title, summary, r.specialNote, userTags.join(' '), (r.tags || []).includes('정정필증') ? '정정' : '', (r.docs || []).map(x => x.text).join(' '), item ? [item.name, item.reqs, item.agency].join(' ') : '', (r.unipass || {}).req || '', (r.unipass || {}).condTxt || ''].join(' ');
  const p = r.procId ? db.procedures.find(x => x.id === r.procId) : null;
  const certHs = (r.certs || []).flatMap(c => (c.lines || []).map(l => hsDigits(l.hs))).find(Boolean) || '';
  const f = {id:r.id, clientId:r.clientId || '', type:r.type || '', typeGuess:!!r.typeGuess, itemId:r.itemId || '', hs:hsDigits(item && item.hs) || certHs || hsInText(procText),
    carrier:carrierOf(r.bl), proc:procTags(procText), weak:weakTags([r.title, summary].join(' ')), procId:p && p.clientId ? p.id : '',
    tokens:simTokens([r.title, String(r.specialNote || '').slice(0, 200), userTags.join(' '), item ? item.name : '', certNames, r.createdBy === 'auto' ? '' : summary.slice(0, 200)].join(' ')),
    causes:Array.isArray(r.causes) ? r.causes : causesOf(r)};
  if(cache && r.id) simCache.feats.set(r.id, f);
  return f;
}
function simScore(t, f, r){
  let s = 0, core = false; const why = [];
  const pt = t.proc.filter(x => f.proc.includes(x));
  if(pt.length){ s += Math.min(36, pt.length * 18); why.push('같은 절차 ' + pt.join(', ')); core = true; }
  if(t.itemId && f.itemId === t.itemId){ s += 20; why.push('같은 품목'); core = true; }
  else if(t.hs && f.hs){
    if(t.hs.length >= 6 && f.hs.length >= 6 && t.hs.slice(0, 6) === f.hs.slice(0, 6)){ s += 15; why.push('HS ' + fmtHs(f.hs.slice(0, 6))); core = true; }
    else if(t.hs.slice(0, 4) === f.hs.slice(0, 4)){ s += 8; why.push('HS ' + f.hs.slice(0, 4)); core = true; }
  }
  const cs = (t.causes || []).filter(c => f.causes.includes(c));
  if(cs.length){ s += Math.min(18, cs.length * 6); why.push('같은 정정 원인 ' + cs.join(', ')); core = true; }
  if(t.procId && f.procId === t.procId){ s += 15; why.push('같은 업체 절차'); core = true; }
  const common = simCommon(), sw = [...t.tokens].filter(x => f.tokens.has(x) && !common.has(x));
  if(sw.length){ s += Math.min(15, sw.length * 5); why.push('업무 단어 ' + sw.slice(0, 4).join(', ')); if(sw.length >= 2) core = true; }
  if(t.clientId && f.clientId === t.clientId){ s += 10; why.push('같은 업체'); }
  if(t.type && f.type === t.type){ s += t.typeGuess ? 4 : 6; why.push('같은 유형 ' + t.type); }
  const wk = t.weak.filter(x => f.weak.includes(x));
  if(wk.length){ s += 3; why.push(wk.join(', ')); }
  if(t.carrier && f.carrier === t.carrier){ s += 3; why.push('같은 선사 ' + t.carrier); }
  if(r.special) s += 2;
  return {s:Math.round(s), why, core};
}
/* target: 기록이나 기록 모양의 객체 {id, clientId, type, typeGuess, itemId, title, summary, bl, causes} */
function similarRecords(target, n = 5){
  const t = recFeat(target, false);
  if(!t.proc.length && !t.tokens.size && !t.hs && !t.itemId && !(t.causes || []).length) return [];
  return db.records.filter(r => r.status === '완료' && r.id !== target.id)
    .map(r => ({r, ...simScore(t, recFeat(r), r)}))
    .filter(x => x.core && x.s >= SIM_MIN)
    .sort((a, b) => b.s - a.s || byDateDesc(a.r, b.r)).slice(0, n);
}
function similarInquiries(target, sims = [], n = 3){
  const t = recFeat(target, false), simIds = new Set(sims.map(x => x.r.id));
  return (db.inquiries || []).map(q => {
    let s = 0;
    const h = hsDigits(q.hs), qtext = [q.question, q.answer, q.topic, (q.tags || []).join(' ')].join(' ');
    if(t.hs && h){ if(t.hs.slice(0, 6) === h.slice(0, 6) && h.length >= 6) s += 20; else if(t.hs.slice(0, 4) === h.slice(0, 4)) s += 10; }
    if(t.clientId && q.clientId === t.clientId) s += 6;
    if(q.recId && (q.recId === target.id || simIds.has(q.recId))) s += 15;
    const pt = t.proc.filter(x => procTags(qtext).includes(x)); s += Math.min(30, pt.length * 15);
    const qt = simTokens(qtext); let k = 0; t.tokens.forEach(x => { if(qt.has(x)) k += 5; }); s += Math.min(15, k);
    return {q, s};
  }).filter(x => x.s >= 20).sort((a, b) => b.s - a.s).slice(0, n).map(x => x.q);
}
/* 메일 대화 → 기록 모양 */
const TYPE_GUESS = [
  ['FTA원산지', /원산지|(^|[^a-z])c\/?o([^a-z]|$)|fta|form\s?[ae]([^a-z]|$)|사후적용/i], ['관세환급', /환급/], ['수출신고', /수출|export|선적|적재|shipping/i],
  ['화학물질', /화평법|화관법|화학물질|유해화학/], ['요건확인·검역', /검역|요건확인|식약처|수입식품|위생증명/], ['품목분류', /품목분류|사전심사|세번/],
  ['외환신고', /외환|지급신고|송금/], ['AEO', /(^|[^a-z])aeo([^a-z]|$)/i], ['수입통관', /수입|import|도착|입항|arrival|b\/l/i]];
function guessType(text, clientId){
  const types = db.settings.taskTypes, hit = TYPE_GUESS.find(([ty, re]) => types.includes(ty) && re.test(String(text || '')));
  if(hit) return hit[0];
  const cnt = {}; db.records.filter(r => r.clientId === clientId).forEach(r => cnt[r.type] = (cnt[r.type] || 0) + 1);
  return Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(x => x[0])[0] || '';
}
function guessItem(text, clientId){
  const t = String(text || '').toLowerCase().replace(/\s+/g, '');
  return db.items.filter(i => i.clientId === clientId && String(i.name || '').replace(/\s+/g, '').length >= 2 && t.includes(String(i.name).toLowerCase().replace(/\s+/g, '')))
    .sort((a, b) => b.name.length - a.name.length)[0] || null;
}
function threadTarget(t){
  const c = threadClient(t), text = t.ms.map(m => (m.subject || '') + ' ' + stripMailNoise(String(m.snippet || '').slice(0, 300))).join(' ');
  const it = c ? guessItem(text, c.id) : null, ty = guessType(text, c ? c.id : '');
  return {id:'', clientId:c ? c.id : '', type:ty, typeGuess:true, itemId:it ? it.id : '', title:t.ms.map(m => m.subject || '').join(' '), summary:t.ms.map(m => stripMailNoise(String(m.snippet || '').slice(0, 300))).join('\n'), bl:(t.ms.find(m => m.bl) || {}).bl || '', causes:[], createdBy:'auto'};
}

/* ---------- 화면 조각 ---------- */
let simOpen = new Set();
function simSummary(list){
  const days = list.map(x => dayDiff(x.r.startDate, x.r.date)).filter(x => x !== null && x >= 0);
  const sp = list.filter(x => x.r.special).length, cc = {}, who = {};
  list.forEach(x => { causesOf(x.r).forEach(c => cc[c] = (cc[c] || 0) + 1); if(x.r.assignee) who[x.r.assignee] = (who[x.r.assignee] || 0) + 1; });
  const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(e => e[0]);
  return [`비슷한 과거 건 ${list.length}건`, days.length && `평균 소요 ${(days.reduce((a, b) => a + b, 0) / days.length).toFixed(1)}일`,
    sp && `특이 ${sp}건`, top(cc).length && `정정 원인 ${top(cc).slice(0, 3).join(', ')}`, top(who).length && `주로 ${assigneeName(top(who)[0])} 담당`].filter(Boolean).join(' · ');
}
function simItemHTML(x, o = {}){
  const r = x.r, p = procFor(r), d = dayDiff(r.startDate, r.date), dc = dayDiff(r.startDate, (r.stage || {}).accept || (r.stage || {}).customs);
  const meta = [o.showClient === false ? '' : clientName(r.clientId), r.date && `완료 ${r.date}`, d !== null && d >= 0 && `소요 ${d}일${dc !== null && dc >= 0 && dc !== d ? ` (통관 ${dc}일)` : ''}`, r.assignee && `담당 ${assigneeName(r.assignee)}`].filter(Boolean).join(' · ');
  const steps = (r.checklist || []).filter(s => !/^\[점검\]/.test(s.text));
  const inq = (db.inquiries || []).filter(q => q.recId === r.id);
  return `<li class="sim-it">
    <div><span class="sim-sc" title="유사도 점수">${x.s}</span>${r.special ? '<span class="stamp sm">특이</span> ' : ''}${o.inDialog ? `<strong>${esc(r.caseNo ? r.caseNo + ' ' : '')}${esc(r.title)}</strong>` : `<button type="button" class="linkish" data-edit-rec="${esc(r.id)}">${esc(r.caseNo ? r.caseNo + ' ' : '')}${esc(r.title)}</button>`}</div>
    <div class="hint">${esc(meta)}</div>
    <div class="hint">근거: ${esc(x.why.join(' · '))}</div>
    ${p ? `<div class="hint">절차: ${esc(p.title)}${steps.length ? ` · 실제 단계 ${steps.length}개` : ''}</div>` : (steps.length ? `<div class="hint">실제 단계 ${steps.length}개: ${esc(steps.slice(0, 4).map(s => normStep(s.text)).join(' → '))}${steps.length > 4 ? ' …' : ''}</div>` : '')}
    ${r.special && r.specialNote ? `<div class="sim-note">${esc(r.specialNote.length > 220 ? r.specialNote.slice(0, 220) + '…' : r.specialNote)}</div>` : ''}
    ${inq.length ? `<div class="hint">세관 질의 ${inq.length}건: ${esc(inq.map(q => q.question).join(' / ').slice(0, 120))}</div>` : ''}
    ${o.copy && (steps.length || (r.docs || []).length) ? `<button type="button" class="mini" ${o.copy}="${esc((o.copyPrefix || '') + r.id)}">이 건의 단계·서류 가져오기</button>` : ''}
  </li>`;
}
function inqMiniHTML(q, inDialog){
  return `<li class="sim-it"><div><span class="tag type">${esc(q.topic || '질의')}</span> <strong>${esc(q.office || '')}</strong> <span class="hint">${esc(q.date || '')}${q.hs ? ' · HS ' + esc(q.hs) : ''}</span> ${inDialog ? '' : `<button type="button" class="mini" data-inq-edit="${esc(q.id)}">보기</button>`}</div>
    <div class="hint">질의: ${esc(String(q.question || '').slice(0, 140))}</div>${q.answer ? `<div class="hint">답변: ${esc(String(q.answer).slice(0, 160))}</div>` : ''}${q.basis ? `<div class="hint">근거: ${esc(String(q.basis).slice(0, 100))}</div>` : ''}</li>`;
}
/* 진행 중 기록 카드 안 '유사 업무 가이드' */
function guideHTML(r){
  const list = similarRecords(r, 5);
  const inqs = similarInquiries(r, list, 3);
  if(!list.length && !inqs.length) return '';
  const open = simOpen.has(r.id) || (!(r.checklist || []).length && !simOpen.has('x' + r.id));
  return `<details class="sim-box" data-sim-rec="${esc(r.id)}"${open ? ' open' : ''}><summary>${list.length ? esc(simSummary(list)) : '비슷한 과거 건 없음'}${inqs.length ? ` · 관련 세관 질의 ${inqs.length}건` : ''}</summary>
    ${list.length ? `<ul class="sim">${list.map(x => simItemHTML(x, {copy:'data-sim-copy', copyPrefix:r.id + '|'})).join('')}</ul>` : ''}
    ${inqs.length ? `<p class="sim-sub">관련 세관 질의</p><ul class="sim">${inqs.map(q => inqMiniHTML(q)).join('')}</ul>` : ''}
  </details>`;
}
/* customs@ 대화 한 줄 요약 */
function threadSimHTML(t){
  const list = similarRecords(threadTarget(t), 3);
  if(!list.length) return '';
  return `<div class="sim-line"><span class="lbl-in">비슷한 과거 건</span>${list.map(x => { const d = dayDiff(x.r.startDate, x.r.date); return `<button class="linkish" data-edit-rec="${esc(x.r.id)}" title="${esc(x.why.join(' · '))}">${esc(x.r.caseNo || '')} ${esc(x.r.title.length > 28 ? x.r.title.slice(0, 28) + '…' : x.r.title)}${d !== null && d >= 0 ? ` (${d}일)` : ''}${x.r.special ? ' ·특이' : ''}</button>`; }).join('')}</div>`;
}
/* 다른 기록의 단계·서류를 합친다(없는 것만 뒤에 추가) */
function mergeLines(cur, add){ const k = new Set(cur.map(stepKey)); return [...cur, ...add.filter(x => { const kk = stepKey(x); if(!kk || k.has(kk)) return false; k.add(kk); return true; })]; }
function copyFromRecord(dst, src){
  const steps = (src.checklist || []).filter(s => !/^\[점검\]/.test(s.text)).map(s => normStep(s.text)), docs = (src.docs || []).map(s => normStep(s.text));
  const keep = (old, texts) => { const m = new Map(old.map(x => [x.text, x])); return texts.map(t => m.get(t) || {text:t, done:false}); };
  const n0 = (dst.checklist || []).length + (dst.docs || []).length;
  dst.checklist = keep(dst.checklist || [], mergeLines((dst.checklist || []).map(x => x.text), steps));
  dst.docs = keep(dst.docs || [], mergeLines((dst.docs || []).map(x => x.text), docs));
  if(!dst.procId && src.procId) dst.procId = src.procId;
  dst.updatedAt = nowIso();
  return dst.checklist.length + dst.docs.length - n0;
}

/* ---------- 세관 질의 DB ---------- */
const INQ_TOPICS = ['품목분류', '세관장확인·요건', '과세가격', '감면·환급', '원산지·FTA', '통관절차', '검사·검역', '정정·보정', '기타'];
let inqQ = '', inqTopic = '';
function inquiryHTML(q){
  const r = q.recId ? db.records.find(x => x.id === q.recId) : null;
  return `<article class="inq">
    <div class="inq-head"><span class="tag type">${esc(q.topic || '기타')}</span><strong>${hl(q.office || '세관 미기재')}</strong>${q.officer ? `<span class="hint">${hl(q.officer)}</span>` : ''}<span class="hint">${esc(q.date || '')}</span>${q.hs ? `<span class="ref">HS ${hl(q.hs)}</span>` : ''}${q.clientId ? `<button class="linkish" data-go="client" data-id="${esc(q.clientId)}">${esc(clientName(q.clientId))}</button>` : ''}<span class="sp"></span><button class="mini" data-inq-edit="${esc(q.id)}">수정</button></div>
    <p class="inq-q pre"><b>질의</b> ${hl(q.question)}</p>
    ${q.answer ? `<p class="inq-a pre"><b>답변</b> ${hl(q.answer)}</p>` : '<p class="hint">답변을 아직 적지 않았습니다.</p>'}
    ${q.basis ? `<p class="hint pre">근거: ${hl(q.basis)}</p>` : ''}
    ${(q.tags || []).length ? `<div class="tags">${q.tags.map(t => `<span class="tag">${hl(t)}</span>`).join('')}</div>` : ''}
    ${r ? `<div class="hint">관련 기록: <button class="linkish" data-edit-rec="${esc(r.id)}">${esc(r.caseNo ? r.caseNo + ' ' : '')}${esc(r.title)}</button></div>` : ''}
  </article>`;
}
function inqHay(q){ return hay(q.office, q.officer, q.topic, q.hs, hsDigits(q.hs), q.question, q.answer, q.basis, q.tags, clientName(q.clientId)); }
function viewInquiries(){
  const all = (db.inquiries || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  const terms = inqQ.trim().toLowerCase().split(/\s+/).filter(Boolean), sq = x => x.replace(/[\s\-\/.]/g, '');
  const list = all.filter(q => (!inqTopic || q.topic === inqTopic) && terms.every(t => { const h = inqHay(q); return h.includes(t) || sq(h).includes(sq(t)); }));
  if(terms.length) hlRe = new RegExp('(' + terms.map(t => esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  const cnt = {}; all.forEach(q => cnt[q.topic || '기타'] = (cnt[q.topic || '기타'] || 0) + 1);
  return `<header class="client-head"><div><h2>세관 질의 DB</h2><p class="client-meta">세관에 문의하거나 세관이 요구한 내용과 답변, 근거를 모아 둡니다. 같은 HS·업체·키워드의 새 건을 진행할 때 유사 업무 가이드에 함께 뜹니다.</p></div>
      <div class="client-act"><input type="search" id="inqQ" value="${esc(inqQ)}" placeholder="질의·답변·세관·HS 검색"><button class="primary" data-inq-new>질의 기록</button></div></header>
    <div class="chips" role="group" aria-label="분류">${['', ...INQ_TOPICS].filter(t => !t || cnt[t]).map(t => `<button class="chip${t === inqTopic ? ' on' : ''}" data-inq-topic="${esc(t)}">${esc(t || '전체')}${t ? `<b>${cnt[t]}</b>` : ''}</button>`).join('')}</div>
    <div class="card-grid">${list.length ? list.map(inquiryHTML).join('') : `<p class="empty">${all.length ? '조건에 맞는 질의가 없습니다.' : '아직 기록한 세관 질의가 없습니다. 품목분류·요건·과세가격 등 세관과 주고받은 질의를 남겨 두면 다음 건에서 바로 찾을 수 있습니다. 진행 중 기록의 ‘질의 기록’ 버튼으로도 남길 수 있습니다.'}</p>`}</div>`;
}
function openInquiry(q, preset = {}){
  const isNew = !q, rec = preset.rec || null;
  const item = rec && rec.itemId ? db.items.find(i => i.id === rec.itemId) : null;
  const x = q || {id:uid(), date:today(), office:'', officer:'', clientId:rec ? rec.clientId : '', recId:rec ? rec.id : '', hs:item ? item.hs : '', topic:rec && /품목분류/.test(rec.type) ? '품목분류' : '통관절차', question:'', answer:'', basis:'', tags:[]};
  const recOpts = cid => [['', '연결 안 함'], ...db.records.slice().sort((a, b) => (cid ? (b.clientId === cid) - (a.clientId === cid) : 0) || byDateDesc(a, b)).slice(0, 120).map(r => [r.id, `${r.caseNo ? r.caseNo + ' · ' : ''}${clientName(r.clientId)} · ${r.title}`])];
  const offices = [...new Set([...TO_LIST, ...(db.inquiries || []).map(v => v.office).filter(Boolean)])];
  openDialog({
    title: isNew ? '세관 질의 기록' : '세관 질의 수정',
    body: `<div class="row2"><label>질의일<input type="date" name="date" value="${esc(x.date)}"></label><label>세관<input name="office" list="inqOffice" value="${esc(x.office)}" placeholder="예: 인천세관 수입과"><datalist id="inqOffice">${offices.map(o => `<option value="${esc(o)}">`).join('')}</datalist></label></div>
      <div class="row2"><label>담당 부서·직원 (선택)<input name="officer" value="${esc(x.officer || '')}"></label><label>분류<select name="topic">${opts(INQ_TOPICS, x.topic)}</select></label></div>
      <div class="row2"><label>업체<select name="clientId">${opts([['', '공통·미지정'], ...sortedClients().map(c => [c.id, c.name])], x.clientId || '')}</select></label><label>HS 코드<input name="hs" value="${esc(x.hs || '')}" placeholder="예: 1102.20-0000"></label></div>
      <label>관련 기록<select name="recId">${opts(recOpts(x.clientId), x.recId || '')}</select></label>
      <label>질의 내용<textarea name="question" rows="4" required placeholder="세관에 물은 것, 또는 세관이 요구·지적한 것">${esc(x.question)}</textarea></label>
      <label>세관 답변·처리 결과<textarea name="answer" rows="4" placeholder="답변 요지, 결론, 추가 제출 서류">${esc(x.answer)}</textarea></label>
      <label>근거 (법령·고시·질의회신·사전심사 번호)<textarea name="basis" rows="2">${esc(x.basis)}</textarea></label>
      <label>태그<input name="tags" value="${esc((x.tags || []).join(', '))}" placeholder="쉼표로 구분"></label>`,
    onSave(fd){
      const question = String(fd.get('question') || '').trim();
      if(!question){ toast('질의 내용을 입력하세요.'); return false; }
      Object.assign(x, {date:fd.get('date') || today(), office:fd.get('office').trim(), officer:fd.get('officer').trim(), topic:fd.get('topic'), clientId:fd.get('clientId') || '', hs:fd.get('hs').trim(),
        recId:fd.get('recId') || '', question, answer:fd.get('answer').trim(), basis:fd.get('basis').trim(), tags:fd.get('tags').split(',').map(v => v.trim()).filter(Boolean), updatedAt:nowIso(), updatedBy:me ? me.id : ''});
      db.inquiries = db.inquiries || [];
      if(isNew){ x.createdAt = nowIso(); x.createdBy = me ? me.id : ''; db.inquiries.push(x); toast('세관 질의를 기록했습니다.'); }
      else toast('세관 질의를 수정했습니다.');
    },
    onDelete: isNew ? null : () => { if(!confirm('이 세관 질의 기록을 삭제할까요?')) return false; db.inquiries = db.inquiries.filter(v => v.id !== x.id); toast('삭제했습니다.'); },
    onOpen(f){
      const N = n => f.elements.namedItem(n);
      N('clientId').addEventListener('change', () => { const cur = N('recId').value; N('recId').innerHTML = opts(recOpts(N('clientId').value), cur); });
      if(isNew) N('question').focus();
    }
  });
}

/* ---------- 품목 DB (업체별 품목·요건 + KC + 세관 질의를 HS로 묶음) ---------- */
const REQ_BADGES = [['검역', /검역|식물|동물|가축|사료|농림/], ['식약처', /식약처|식품|건강기능|의약|화장품|위생/], ['화평법', /화평법|화학물질\s*(등록|확인)|등록면제|신규화학/],
  ['화관법', /화관법|유해화학|유독|사고대비|제한물질|금지물질|허가물질/], ['KC·전기', /(^|[^a-z])kc([^a-z]|$)|전기용품|생활용품|어린이제품|안전인증|안전확인|공급자적합/i],
  ['전파', /전파|적합성평가|(^|[^a-z])rra([^a-z]|$)|방송통신/i], ['위험물', /위험물/], ['폐기물', /폐기물|바젤|국가간\s*이동/]];
let itemQ = '', itemBadge = '';
function reqBadges(text){ return REQ_BADGES.filter(([, re]) => re.test(String(text || ''))).map(b => b[0]); }
function itemGroups(){
  const g = new Map();
  db.items.forEach(i => { const h = hsDigits(i.hs), k = h ? 'h' + h : 'n' + nameKey(i.name).replace(/\s/g, ''); if(!g.has(k)) g.set(k, {hs:h, items:[]}); g.get(k).items.push(i); });
  const uniq = a => [...new Set(a.map(v => String(v || '').trim()).filter(Boolean))];
  return [...g.values()].map(x => {
    const ids = new Set(x.items.map(i => i.id)), h6 = x.hs.slice(0, 6);
    const reqs = uniq(x.items.flatMap(i => lines(i.reqs))), agency = uniq(x.items.flatMap(i => lines(i.agency)));
    return {...x, names:uniq(x.items.map(i => i.name)), clients:uniq(x.items.map(i => i.clientId)), tariffs:uniq(x.items.map(i => i.tariff)), reqs, agency,
      badges:reqBadges([...reqs, ...agency, ...x.items.map(i => i.notes)].join(' ')),
      recs:db.records.filter(r => ids.has(r.itemId)).length,
      kc:h6.length === 6 ? db.kc.filter(k => hsDigits(k.hs).startsWith(h6)).length : 0,
      inq:h6.length === 6 ? (db.inquiries || []).filter(q => hsDigits(q.hs).startsWith(h6)).length : 0};
  }).sort((a, b) => (a.hs || 'z').localeCompare(b.hs || 'z') || a.names[0].localeCompare(b.names[0], 'ko'));
}
/* 같은 품목명인데 업체마다 HS가 다른 경우(품목분류 일관성 점검) */
function hsConflicts(){
  const m = new Map();
  db.items.forEach(i => { const k = nameKey(i.name).replace(/\s/g, ''), h = hsDigits(i.hs); if(k.length < 2 || !h) return; if(!m.has(k)) m.set(k, []); m.get(k).push(i); });
  return [...m.values()].filter(a => new Set(a.map(i => hsDigits(i.hs).slice(0, 6))).size > 1);
}
function viewItemDb(){
  const gs = itemGroups(), conf = hsConflicts();
  const terms = itemQ.trim().toLowerCase().split(/\s+/).filter(Boolean), sq = x => x.replace(/[\s\-\/.]/g, '');
  const list = gs.filter(x => (!itemBadge || x.badges.includes(itemBadge)) && terms.every(t => { const h = hay(x.hs, fmtHs(x.hs), x.names, x.tariffs, x.reqs, x.agency, x.clients.map(clientName), x.items.map(i => [i.cas, i.raw, i.maker, i.model].join(' '))); return h.includes(t) || sq(h).includes(sq(t)); }));
  const bc = {}; gs.forEach(x => x.badges.forEach(b => bc[b] = (bc[b] || 0) + 1));
  return `<header class="client-head"><div><h2>품목 DB</h2><p class="client-meta">업체별 ‘품목·요건’을 HS 코드로 묶고 KC·세관 질의·기록 건수를 함께 봅니다. ‘공공데이터 확인’은 HS 10단위로 세관장확인 요건·관세율, CAS 번호로 화학물질 분류, 식품 원재료명으로 원재료 정보를 조회하고, 바뀐 점은 ‘확인 알림’에 올립니다(30일마다 자동).</p></div>
      <div class="client-act"><input type="search" id="itemQ" value="${esc(itemQ)}" placeholder="품목명·HS·요건·CAS·업체 검색"><button class="ghost" data-ext-all title="HS 10단위·CAS·식품 원재료가 있는 품목 중 30일 넘게 확인 안 한 것 (최대 30개)">공공데이터 확인</button>${me && me.role === 'admin' ? '<button class="ghost" data-api-ping>연결 점검</button>' : ''}</div></header>
    ${conf.length ? `<section class="pps" style="margin-top:1.25rem"><div class="sec-head"><h3>HS 확인 필요 ${conf.length}건 <span class="cnt">같은 품목명인데 업체마다 HS 6단위가 다름</span></h3></div><ul>${conf.slice(0, 20).map(a => `<li><strong>${esc(a[0].name)}</strong> ${a.map(i => `<span class="hint">${esc(clientName(i.clientId))} ${esc(i.hs)}</span> <button class="mini" data-edit-item="${esc(i.id)}">수정</button>`).join(' · ')}</li>`).join('')}</ul></section>` : ''}
    <div class="chips" role="group" aria-label="요건">${['', ...REQ_BADGES.map(b => b[0])].filter(b => !b || bc[b]).map(b => `<button class="chip${b === itemBadge ? ' on' : ''}" data-req-badge="${esc(b)}">${esc(b || '전체')}${b ? `<b>${bc[b]}</b>` : ''}</button>`).join('')}</div>
    ${list.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>HS 코드</th><th>품목</th><th>업체</th><th>세율·FTA</th><th>수입요건</th><th class="num">기록·질의·KC</th></tr></thead><tbody>
      ${list.slice(0, 200).map(x => `<tr><td class="hs">${esc(x.hs ? fmtHs(x.hs) : '미입력')}</td><td>${x.names.map(n => `<div><strong>${esc(n)}</strong></div>`).join('')}${typeof itemRiskHTML === 'function' ? itemRiskHTML(x.items) : ''}</td>
        <td>${x.clients.map(c => `<button class="linkish" data-go="client" data-id="${esc(c)}">${esc(clientName(c))}</button>`).join('<br>')}</td>
        <td>${x.tariffs.map(esc).join('<br>')}</td>
        <td>${x.badges.map(b => `<span class="tag req">${esc(b)}</span> `).join('')}${x.reqs.length ? `<div class="pre hint">${esc(x.reqs.join('\n'))}</div>` : ''}${x.agency.length ? `<div class="hint">기관: ${esc(x.agency.join(', '))}</div>` : ''}</td>
        <td class="num">${x.recs} · ${x.inq ? `<button class="linkish" data-inq-hs="${esc(x.hs.slice(0, 6))}">${x.inq}</button>` : 0} · ${x.kc}</td></tr>${x.items.some(i => i.ext || itemReqs(i).length) ? `<tr class="ext-tr"><td></td><td colspan="5">${x.items.map(i => `<div>${x.items.length > 1 ? `<span class="hint">${esc(clientName(i.clientId))}</span> ` : ''}${extItemHTML(i, true) || '<span class="hint">공공데이터 미확인</span>'}</div>`).join('')}<button class="mini" data-ext-items="${esc(x.items.map(i => i.id).join(','))}">이 품목 확인</button></td></tr>` : ''}`).join('')}
    </tbody></table></div>${list.length > 200 ? `<p class="hint">${list.length}개 중 200개만 보입니다. 검색어로 좁히세요.</p>` : ''}`
    : `<p class="empty">${gs.length ? '조건에 맞는 품목이 없습니다.' : '아직 정리한 품목이 없습니다. 업체 화면의 ‘품목·요건’에서 품목을 추가하면 여기에 모입니다.'}</p>`}`;
}
