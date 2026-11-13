'use strict';
/* ---------- 공공데이터 연동 (P1·P2) ----------
   Apps Script 공통 호출부(op:'api')로 여러 건을 한 번에 조회한다. 쓰는 서비스:
   law  국가법령정보(LAW_API_KEY)            — 업무 매뉴얼 근거 법령의 공포·시행일 → 최종 검토일 이후 개정이면 알림
   trrt UNI-PASS 관세율 기본조회(CUSTOMS_CONFIRM_KEY) — 품목 HS 10단위 기본세율
   ccct 관세청 세관장확인대상물품(DATA_GO_KR_KEY)   — 품목 HS 10단위 확인법령·요건기관
   chem 한국환경공단 화학물질(DATA_GO_KR_KEY)       — 품목 CAS → 물질명·분류(유독·제한·금지·허가·사고대비 등)
   food 식약처 식품 원재료 정보(DATA_GO_KR_KEY)    — 품목 식품 원재료명 → 대분류(LCLAS_NM)·사용조건(USE_CND_NM)
   결과는 품목(item.ext)·법령(db.lawInfo)에 요약만 저장하고, 변화가 있으면 db.alerts(공통 알림함)에 올린다.
   응답 필드명은 기관 문서마다 달라 '이름처럼 보이는 칸'을 골라 쓰고, 나머지는 원문 칸을 그대로 보여 준다. */
const EXT_NAMES = {law:'법령', trrt:'관세율', ccct:'세관장확인', chem:'화학물질', food:'식품원재료', ecm:'통관고유부호', hs:'HS 부호', nts:'국세청 사업자'};
const CHEM_FLAG = /유독|제한물질|금지물질|허가물질|사고대비|중점관리|인체급성|인체만성|생태유해|등록대상|기존화학물질|함량/;
const casList = s => [...new Set((String(s || '').match(/\b\d{2,7}-\d{2}-\d\b/g) || []).filter(casValid))];
function casValid(c){ const d = c.replace(/-/g, ''), body = d.slice(0, -1).split('').reverse(); return body.reduce((a, x, i) => a + Number(x) * (i + 1), 0) % 10 === Number(d.slice(-1)); }
const rowText = (r, n = 8) => Object.entries(r || {}).filter(([k, v]) => k[0] !== '_' && String(v).trim()).slice(0, n).map(([k, v]) => `${k}: ${String(v).trim().slice(0, 60)}`).join(' · ');
const pickVals = (r, re) => Object.entries(r || {}).filter(([k, v]) => k[0] !== '_' && re.test(k) && String(v).trim()).map(([, v]) => String(v).trim());
async function extCall(reqs){
  const cfg = db.settings.mail || {};
  if(!cfg.endpoint || !cfg.token) throw new Error('Apps Script 연동이 설정되지 않았습니다');
  const out = [];
  for(let i = 0; i < reqs.length; i += 50){
    const j = await syncPost(cfg, {op:'api', reqs:reqs.slice(i, i + 50)});
    if(!j || !j.ok) throw new Error((j && j.error) || '응답 오류 (gs를 새 버전으로 배포했는지 확인)');
    out.push(...(j.results || []));
  }
  return out;
}

/* ---------- 공통 알림함 (P1-C) ---------- */
function addAlert(a){
  db.alerts = db.alerts || [];
  if(db.alerts.some(x => x.key === a.key)) return false;                 // key에 변화 내용이 들어 있어, 같은 변화는 한 번만
  db.alerts.push({id:uid(), at:nowIso(), status:'open', ...a});
  if(db.alerts.length > 500) db.alerts = db.alerts.filter(x => x.status === 'open').concat(db.alerts.filter(x => x.status !== 'open').slice(-200));
  return true;
}
function openAlerts(){ return (db.alerts || []).filter(x => x.status === 'open'); }
function alertTargetHTML(a){
  if(a.ttype === 'item'){ const it = db.items.find(i => i.id === a.tid); return it ? `<button class="mini" data-edit-item="${esc(it.id)}">품목 열기</button> <button class="linkish" data-go="client" data-id="${esc(it.clientId)}">${esc(clientName(it.clientId))}</button>` : ''; }
  if(a.ttype === 'proc'){ const p = db.procedures.find(x => x.id === a.tid); return p ? `<button class="mini" data-man-open="${esc(p.id)}">매뉴얼에서 보기</button>` : ''; }
  if(a.ttype === 'client'){ const c = db.clients.find(x => x.id === a.tid); return c ? `<button class="mini" data-go="client" data-id="${esc(c.id)}">업체 열기</button>` : ''; }
  if(a.ttype === 'rec'){ const r = db.records.find(x => x.id === a.tid); return r ? `<button class="mini" data-edit-rec="${esc(r.id)}">기록 열기</button>${a.kind === 'recmerge' && a.logId && (db.recMergeLog || []).some(x => x.id === a.logId) ? `<button class="mini" data-rdup-undo="${esc(a.logId)}">합치기 되돌리기</button>` : ''}` : ''; }
  return '';
}
/* 조건부 요건만 남은 품목의 세관장확인 알림은 자동으로 정리 (11/12 이전에 쌓인 알림 포함) */
function tidyCcctAlerts(){
  let n = 0;
  openAlerts().filter(a => ['ccct', 'trrt', 'food'].includes(a.kind) && a.ttype === 'item').forEach(a => {   // 수출 품목에 수입 기준으로 띄운 알림 (11/12)
    const it = db.items.find(i => i.id === a.tid);
    if(!it || itemDir(it) !== 'E' || a.imex === '1') return;
    a.status = 'done'; a.doneAt = nowIso(); a.doneBy = 'auto'; a.doneNote = '수출 품목이라 수입 요건·관세율·식품원재료 알림을 정리했습니다(수출 세관장확인으로 다시 확인).'; n++;
    if(it.ext && it.ext.ccct && it.ext.ccct.imex !== '1') it.ext.at = '';    // 다음 자동 확인 때 수출 기준으로 다시 조회
  });
  openAlerts().filter(a => a.kind === 'ccct' && a.ttype === 'item').forEach(a => {
    const it = db.items.find(i => i.id === a.tid), e = it && it.ext && it.ext.ccct;
    if(!e || e.err) return;
    const sp = ccctSplit(e.list, it);
    if(sp.rel.length || !sp.cond.length) return;
    a.status = 'done'; a.doneAt = nowIso(); a.doneBy = 'auto'; a.doneNote = `조건부 요건 — ${sp.cond.map(x => x.cond.need).join(' / ')} (품목 용도상 해당 없음으로 자동 정리)`; n++;
  });
  return n;
}
function viewAlerts(){
  if(tidyCcctAlerts()) setTimeout(() => commit(), 0);
  const op = openAlerts().slice().sort((a, b) => b.at.localeCompare(a.at)), done = (db.alerts || []).filter(x => x.status !== 'open').sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')).slice(0, 50);
  const card = a => `<article class="inq${a.status === 'open' ? '' : ' done'}"><div class="inq-head"><span class="tag type">${esc(EXT_NAMES[a.kind] || a.kind)}</span><strong>${esc(a.title)}</strong><span class="hint">${esc(a.at.slice(0, 10))}</span><span class="sp"></span>${alertTargetHTML(a)}${a.status === 'open' ? ` <button class="mini strong" data-alert-done="${esc(a.id)}">확인함</button>` : `<span class="hint">${a.doneBy === 'auto' ? '자동 정리' : '확인 ' + esc(accountName(a.doneBy || ''))} ${esc((a.doneAt || '').slice(0, 10))}</span>`}</div>${a.text ? `<p class="pre hint" style="margin:.4rem 0 0">${esc(a.text)}</p>` : ''}${a.doneNote ? `<p class="hint" style="margin:.3rem 0 0">${esc(a.doneNote)}</p>` : ''}</article>`;
  return `<header class="client-head"><div><h2>확인 알림</h2><p class="client-meta">공공데이터 확인에서 바뀐 점(법령 개정, 세관장확인 요건·관세율 변경, 화학물질 분류, 식품원재료 판정)을 모았습니다. 내용을 보고 품목 요건·절차를 고친 뒤 ‘확인함’을 누르세요.</p></div>
      <div class="client-act">${op.length ? `<button class="ghost" data-alert-all>모두 확인함</button>` : ''}</div></header>
    <div class="card-grid">${op.length ? op.map(card).join('') : '<p class="empty">확인할 알림이 없습니다.</p>'}</div><div>
    ${done.length ? `<details class="old-mails"><summary>확인한 알림 ${done.length}건</summary>${done.map(card).join('')}</details>` : ''}</div>`;
}

/* ---------- 품목: 관세율·세관장확인·화학물질·식품원재료 (P2-D) ---------- */
/* 품목 수출입 구분 (11/12): 수출만 하는 품목에 수입 세관장확인·관세율·식품원재료를 확인해 엉뚱한 수입요건 알림이 뜨던 문제.
   직접 지정(it.dir: I·E·IE) → 필증에서 등록될 때의 구분(it.dirs) → 이 품목을 쓴 기록의 유형 → 업체 기록이 수출뿐이면 수출. 모르면 수입. */
let dirCache = {stamp:'', byItem:new Map(), byClient:new Map()};
function itemDir(it){
  if(it.dir) return it.dir;
  const stamp = (db.meta.updatedAt || '') + '|' + db.records.length;
  if(dirCache.stamp !== stamp){
    const byItem = new Map(), byClient = new Map(), add = (m, k, v) => { if(!m.has(k)) m.set(k, new Set()); m.get(k).add(v); };
    db.records.forEach(r => { const k = caseCode(r.type); if(k !== 'I' && k !== 'E') return; if(r.itemId) add(byItem, r.itemId, k); add(byClient, r.clientId, k); });
    dirCache = {stamp, byItem, byClient};
  }
  const s = new Set([...(it.dirs || []), ...(dirCache.byItem.get(it.id) || [])]);
  if(!s.size){ const cs = dirCache.byClient.get(it.clientId); if(cs && cs.size === 1) cs.forEach(k => s.add(k)); }
  return s.has('I') && s.has('E') ? 'IE' : s.has('E') ? 'E' : 'I';
}
const DIR_LABEL = {I:'수입', E:'수출', IE:'수출입'};
function itemReqs(it){
  const hs = hsDigits(it.hs), out = [], exp = itemDir(it) === 'E';
  if(hs.length === 10){
    out.push({svc:'ccct', key:'ccct', p:{hs, imex:exp ? '1' : '2'}});                    // 수출 품목은 수출 세관장확인(수출 요건)만
    if(!exp) out.push({svc:'trrt', key:'trrt', p:{hs}});
    out.push({svc:'hs', key:'hs', p:{hs}});
  }
  casList(it.cas).forEach(c => out.push({svc:'chem', key:'chem:' + c, p:{by:'2', q:c}}));
  if(!exp) lines(it.raw).map(x => x.replace(/\s*\(.*?\)\s*/g, ' ').trim()).filter(x => x.length >= 2).slice(0, 10).forEach(n => out.push({svc:'food', key:'food:' + n, p:{name:n}}));
  return out;
}
function summarize(svc, res, p){
  if(!res || !res.ok) return {err:(res && res.error) || '응답 없음'};
  const rows = (res.items || []).slice(0, 20);
  if(svc === 'ccct'){
    const list = rows.map(r => ({law:r.dcerCfrmLworNm || pickVals(r, /lwor|law|법령/i).filter(v => !/^[A-Z0-9]+$/.test(v))[0] || '', org:r.reqApreIttNm || pickVals(r, /apre|inst|org|기관/i).filter(v => !/^[A-Z0-9]+$/.test(v))[0] || '',
      doc:r.reqCfrmIstmNm || '', from:fmtYmd(r.aplyStrtDt || pickVals(r, /strt|일자|dt$/i)[0] || ''), raw:[r.dcerCfrmLworNm, r.reqApreIttNm, r.reqCfrmIstmNm, r.aplyStrtDt && '적용 ' + fmtYmd(r.aplyStrtDt)].filter(Boolean).join(' · ') || rowText(r)}));
    return {v:2, n:list.length, list, sig:list.map(x => x.law + '/' + x.org).sort().join('|')};
  }
  if(svc === 'trrt'){                                                     // UNI-PASS 관세율 기본조회: trrtTpcd·trrtTpNm(세율구분), trrt(세율), aplyStrtDt~aplyEndDt(적용기간)
    const td = today().replace(/-/g, ''), cur = rows.filter(r => !r.aplyEndDt || String(r.aplyEndDt) >= td).filter(r => !r.aplyStrtDt || String(r.aplyStrtDt) <= td);
    const use = (cur.length ? cur : rows).map(r => ({cd:r.trrtTpcd || '', nm:r.trrtTpNm || r.trrtTpcd || '', rate:r.trrt != null && r.trrt !== '' ? r.trrt : '', unit:r.prutXamt ? `${r.prutXamt}${r.basePrc ? '/' + r.basePrc : ''}` : ''}))
      .sort((a, b) => (a.cd === 'A' ? -1 : b.cd === 'A' ? 1 : 0) || a.nm.localeCompare(b.nm, 'ko'));
    const fmt = x => `${x.nm}${x.cd && x.nm !== x.cd ? '(' + x.cd + ')' : ''} ${x.rate !== '' ? x.rate + '%' : ''}${x.unit ? ' ' + x.unit : ''}`.trim();
    const base = use.find(x => x.cd === 'A') || use[0], nums = use.map(x => parseFloat(x.rate)).filter(n => !isNaN(n)), low = nums.length ? Math.min(...nums) : null;
    const head = base ? `기본 ${base.rate !== '' ? base.rate + '%' : base.unit}${low !== null && base.rate !== '' && low < parseFloat(base.rate) ? ` · 최저 ${low}%` : ''} · 세율 ${use.length}종` : '없음';
    return {v:2, rows:[head, ...use.slice(0, 30).map(fmt)], sig:use.map(fmt).sort().join('|')};
  }
  if(svc === 'chem'){
    const subs = rows.filter(r => r._p === undefined);
    const name = subs.map(r => pickVals(r, /kor|명|nm$/i)[0]).filter(Boolean)[0] || '';
    const flags = [...new Set(rows.flatMap(r => Object.entries(r).filter(([k, v]) => k[0] !== '_' && CHEM_FLAG.test(v)).map(([, v]) => String(v).trim().slice(0, 50))))].slice(0, 8);
    return {cas:p.q, name, flags, n:subs.length || rows.length, found:!!rows.length, raw:rows.slice(0, 4).map(r => rowText(r)), sig:flags.join('|') + '|' + (rows.length ? 1 : 0)};
  }
  if(svc === 'food'){                                                    // 원재료명이 같은 줄을 우선, 대분류와 사용조건으로 판단
    const nm = x => String(x || '').replace(/\s+/g, '').toLowerCase(), q = nm(p.name);
    const ex = rows.filter(r => nm(r.RPRSNT_RAWMTRL_NM) === q || String(r.RAWMTRL_NCKNM || '').split(/[,，]/).some(x => nm(x) === q)), use = (ex.length ? ex : rows).slice(0, 5);
    const cls = [...new Set(use.map(r => String(r.LCLAS_NM || '').trim()).filter(Boolean))], cnd = [...new Set(use.flatMap(r => [r.USE_CND_NM, r.USE_CND_STDR_CN]).map(x => String(x || '').trim()).filter(Boolean))];
    const verdict = [...cls, ...cnd.map(c => c.slice(0, 40))].slice(0, 4);
    const limited = cnd.some(c => /제한|한함|불가|금지|사용할\s*수\s*없/.test(c)) || (cls.length > 0 && !cls.some(c => /식품원료/.test(c)));
    return {name:p.name, n:rows.length, exact:ex.length, verdict, limited, raw:use.slice(0, 3).map(r => rowText(r, 10)), sig:verdict.join('|') + '|' + (ex.length ? 1 : 0)};
  }
  if(svc === 'hs'){                                                      // UNI-PASS API018: 현행 HS인지 + 표준 품명·단위
    const h = hsDigits(p.hs), hit = rows.find(r => hsDigits(r.hsSgn) === h);
    return hit ? {found:true, ko:hit.korePrnm || '', en:hit.englPrnm || '', qty:hit.qtyUt || '', wt:hit.wghtUt || '', sig:'1'} : {found:false, sig:'0'};
  }
  return {raw:rows.map(r => rowText(r))};
}
const REQ_TEXT = it => [it.reqs, it.agency, it.notes].join(' ');
/* 세관장확인 조건부 요건 (11/12): 세관장확인 고시는 HS 단위로 정해 두고, 실제 대상은 용도·성분으로 한정하는 법령이 많다.
   예) 플라스틱 시트(3920)에 식품위생법·수입식품안전관리 특별법이 걸려 있어도 '식품에 닿는 기구·용기·포장'일 때만 대상.
   품목 이름·메모·원재료·모델에 그 용도를 뜻하는 말이 있으면 대상으로 보고(yes), 없으면 '조건부 — 해당 없을 가능성'(maybe)으로 따로 보여 주며 알림을 띄우지 않는다.
   직원이 '해당 없음'을 누르면 it.reqNA에 법령을 남겨 계속 해당 없음으로 본다. 식품 자체(1~22류)는 조건부로 보지 않는다. */
const CCCT_COND = [
  {re:/수입식품|식품\s*위생|식품\s*등의|건강기능식품|축산물/, direct:/^(0[1-9]|1\d|2[0-2])/, need:'식품·식품첨가물이거나 식품에 직접 닿는 기구·용기·포장일 때만',
    yes:/식품|식용|음식|주방|조리|식기|용기|포장재|병마개|빨대|도마|그릇|접시|쟁반|텀블러|컵|뚜껑|보틀|트레이|도시락|밀폐|젖병|(?<![a-z])(food|kitchen|tableware|cutlery|cups?|trays?|lids?|bottles?|containers?|straws?|tumblers?)(?![a-z])/i},
  {re:/전기용품|생활용품\s*안전|어린이제품/, need:'전기용품·생활용품·어린이제품 안전관리 대상 품목일 때만', yes:/전기|전원|충전|어댑터|램프|조명|히터|완구|어린이|유아|(?<![a-z])(electric|charger|adapter|lamp|heater|toy|baby|kids?)(?![a-z])/i},
  {re:/전파법/, need:'무선·방송통신기자재(전자파 적합성 대상)일 때만', yes:/무선|블루투스|와이파이|송수신|안테나|전자|(?<![a-z])(rf|wifi|wi-fi|radio|wireless|bluetooth|transmitter|module|electronic)(?![a-z])/i},
  {re:/약사법|의약품/, need:'의약품·의약외품 용도일 때만', yes:/의약|약품|(?<![a-z])(medic\w*|pharm\w*|drugs?)(?![a-z])/i},
  {re:/의료기기/, need:'의료기기 용도일 때만', yes:/의료|진단|수술|(?<![a-z])(medical|surgical|diagnos\w*)(?![a-z])/i},
  {re:/화장품/, need:'화장품 용도일 때만', yes:/화장|크림|로션|세럼|(?<![a-z])(cosmetics?|skin\s*care|cream|lotion|serum)(?![a-z])/i},
  {re:/화학물질|화평|화관|유해화학/, need:'등록·신고 대상이거나 유해화학물질을 함유할 때만', yes:/화학|용제|(?<![a-z])(chemical|solvent|reagent)(?![a-z])/i, cas:true},
  {re:/사료/, need:'사료 용도일 때만', yes:/사료|(?<![a-z])(feed|fodder|pet\s*food)(?![a-z])/i},
  {re:/비료/, need:'비료 용도일 때만', yes:/비료|(?<![a-z])fertili\w*/i},
  {re:/농약/, need:'농약 용도일 때만', yes:/농약|살충|살균|제초|(?<![a-z])pesticide/i},
  {re:/위생용품/, need:'위생용품(세척제·일회용품 등) 용도일 때만', yes:/세척|세제|일회용|물티슈|냅킨|기저귀|(?<![a-z])(wipes?|detergent|disposable|diapers?)(?![a-z])/i}
];
function ccctCond(x, it){
  const rule = CCCT_COND.find(c => c.re.test([x.law, x.org, x.doc].join(' ')));
  if(!rule) return null;
  if(rule.direct && rule.direct.test(hsDigits(it.hs))) return null;
  if((it.reqNA || []).includes(x.law)) return {need:rule.need, likely:'na'};
  if(rule.cas && casList(it.cas).length) return null;                          // CAS가 있는 화학제품은 화학물질 확인으로 따로 봄 — 요건으로 둠
  const text = [it.name, it.notes, it.reqs, it.raw, it.model, it.maker].join(' ');
  return rule.yes.test(text) ? null : {need:rule.need, likely:'maybe'};
}
/* 실제로 챙길 요건(조건이 없거나 용도상 해당)과 조건부(해당 없을 가능성·해당 없음 확인)로 나눔 */
function ccctSplit(list, it){
  const rel = [], cond = [];
  (list || []).forEach(x => { const c = ccctCond(x, it); if(c) cond.push({...x, cond:c}); else rel.push(x); });
  return {rel, cond};
}
const ccctSig = xs => xs.map(x => x.law + '/' + x.org).sort().join('|');
function itemAlerts(it, prev, cur){
  const nm = `${it.name} (${clientName(it.clientId)}${it.hs ? ', HS ' + it.hs : ''})`;
  const p0 = prev || {};
  if(cur.ccct && !cur.ccct.err){
    const prevOk = p0.ccct && !p0.ccct.err && p0.ccct.v === 2 && (p0.ccct.imex || '2') === (cur.ccct.imex || '2');   // 표시 형식·수출입 구분이 바뀐 예전 결과와는 비교하지 않음
    const ie = cur.ccct.imex === '1' ? '수출 ' : '';
    const now = ccctSplit(cur.ccct.list, it), sigNow = ccctSig(now.rel), was = prevOk ? ccctSig(ccctSplit(p0.ccct.list, it).rel) : null;
    const condTxt = now.cond.length ? `\n조건부(용도상 해당 없을 가능성): ${now.cond.map(x => `${x.law} — ${x.cond.need}`).join(' / ')}` : '';
    if(was !== null && was !== sigNow) addAlert({key:`ccct|${it.id}|${sigNow}`, kind:'ccct', imex:cur.ccct.imex || '2', ttype:'item', tid:it.id, title:`${ie}세관장확인 요건 변경: ${nm}`, text:`이전: ${was.replace(/\|/g, ', ').replace(/\//g, ' ') || '없음'}\n현재: ${now.rel.map(x => x.law + ' ' + x.org).join(', ') || '없음'}${condTxt}`});
    else if(!p0.ccct && now.rel.length && !String(it.reqs || '').trim()) addAlert({key:`ccct|${it.id}|${sigNow}`, kind:'ccct', imex:cur.ccct.imex || '2', ttype:'item', tid:it.id, title:`${ie}세관장확인 대상인데 품목 요건이 비어 있음: ${nm}`, text:now.rel.map(x => `${x.law} · ${x.org}${x.doc ? ' · ' + x.doc : ''}${x.from ? ' (' + x.from + '부터)' : ''}`).join('\n') + condTxt});
  }
  if(cur.trrt && !cur.trrt.err && p0.trrt && !p0.trrt.err && p0.trrt.v === 2 && p0.trrt.sig !== cur.trrt.sig) addAlert({key:`trrt|${it.id}|${cur.trrt.sig.slice(0, 200)}`, kind:'trrt', ttype:'item', tid:it.id, title:`관세율 변경: ${nm}`, text:`이전: ${(p0.trrt.rows || []).join(' / ')}\n현재: ${cur.trrt.rows.join(' / ')}`});
  (cur.chem || []).filter(c => !c.err && c.flags.length).forEach(c => {
    if(/화관법|유해화학|유독|제한|금지|허가|사고대비/.test(REQ_TEXT(it))) return;
    addAlert({key:`chem|${it.id}|${c.cas}|${c.sig}`, kind:'chem', ttype:'item', tid:it.id, title:`화학물질 분류 확인: ${nm} — CAS ${c.cas}${c.name ? ' ' + c.name : ''}`, text:`분류: ${c.flags.join(', ')}\n품목 요건에 화관법 관련 내용이 없습니다.`});
  });
  if(cur.hs && !cur.hs.err && !cur.hs.found) addAlert({key:`hs|${it.id}|${hsDigits(it.hs)}`, kind:'hs', ttype:'item', tid:it.id, title:`현행 HS 부호가 아님: ${nm}`, text:`UNI-PASS HS 부호 조회에 ${it.hs}가 없습니다. HS 개정(매년 1월)으로 바뀌었거나 입력이 틀렸을 수 있습니다. 품목 화면의 ‘HS 후보 찾기’로 확인하세요.`});
  (cur.food || []).filter(f => !f.err && f.limited).forEach(f => addAlert({key:`food|${it.id}|${f.name}|${f.sig}`, kind:'food', ttype:'item', tid:it.id, title:`식품원재료 사용 조건 확인: ${nm} — ${f.name}`, text:`판정: ${f.verdict.join(', ')}\n${f.raw.join('\n')}`}));
}
let extBusy = false;
async function checkItemsExt(items, silent){
  if(extBusy){ if(!silent) toast('이미 확인 중입니다.'); return; }
  const plan = items.map(it => ({it, reqs:itemReqs(it)})).filter(x => x.reqs.length);
  if(!plan.length){ if(!silent) toast('확인할 값이 없습니다. 품목에 HS 10단위, CAS 번호, 식품 원재료명을 넣어 주세요.'); return; }
  extBusy = true;
  if(!silent) toast(`공공데이터 확인 중… 품목 ${plan.length}개`);
  let res;
  try{ res = await extCall(plan.flatMap(x => x.reqs.map(r => ({svc:r.svc, p:r.p})))); }
  catch(e){ extBusy = false; typeof markRun === 'function' && markRun('ext', false, e.message); if(!silent) toast('확인하지 못했습니다: ' + e.message); return; }
  let k = 0, nAlert = (db.alerts || []).length, errs = new Set();
  plan.forEach(({it, reqs}) => {
    const cur = {at:nowIso(), chem:[], food:[]};
    reqs.forEach(r => {
      const s = summarize(r.svc, res[k++], r.p);
      if(s.err) errs.add(`${EXT_NAMES[r.svc]}: ${s.err}`);
      if(r.svc === 'chem') cur.chem.push(s.err ? {cas:r.p.q, err:s.err} : s);
      else if(r.svc === 'food') cur.food.push(s.err ? {name:r.p.name, err:s.err} : s);
      else cur[r.svc] = r.svc === 'ccct' ? {...s, imex:r.p.imex} : s;
    });
    itemAlerts(it, it.ext, cur);
    it.ext = cur; it.updatedAt = nowIso();
  });
  tidyCcctAlerts();
  extBusy = false;
  typeof markRun === 'function' && markRun('ext', !(errs.size && errs.size >= plan.length), errs.size ? [...errs][0] : '');
  const setup = [...errs].every(e => /미저장|설정 필요/.test(e)) && errs.size;
  if(setup) db.settings.extPause = today();
  commit();
  const na = (db.alerts || []).length - nAlert;
  if(!silent) toast(`확인 완료: 품목 ${plan.length}개${na ? ` · 새 알림 ${na}건` : ''}${errs.size ? ` · 오류 ${[...errs].slice(0, 2).join(' / ')}` : ''}`);
}
function extItemHTML(it, full){
  const e = it.ext; if(!e) return '';
  const out = [];
  const dir = itemDir(it), stale = dir === 'E' && e.ccct && e.ccct.imex !== '1';     // 수출 품목인데 예전 수입 기준 결과
  out.push(`<span class="kc-chip" title="${esc(it.dir ? '직접 지정' : '필증·기록 유형으로 자동 판정 — 품목 수정에서 바꿀 수 있음')}">${DIR_LABEL[dir]}${it.dir ? '' : ' (자동)'}</span>`);
  if(stale) out.push('<span class="kc-chip">수출 품목 — 수출 기준으로 다시 확인 예정</span>');
  else if(e.ccct){
    if(e.ccct.imex === '1') out.push('<span class="kc-chip" title="수출 세관장확인(수출 요건) 기준">수출 기준</span>');
    if(e.ccct.err) out.push(`<span class="kc-chip bad" title="${esc(e.ccct.err)}">세관장확인 오류</span>`);
    else if(!e.ccct.n) out.push('<span class="kc-chip ok">세관장확인 대상 아님</span>');
    else {
      const sp = ccctSplit(e.ccct.list, it), laws = xs => [...new Set(xs.map(x => x.law).filter(Boolean))];
      if(sp.rel.length) out.push(`<span class="kc-chip warn" title="${esc(sp.rel.map(x => x.raw).join('\n'))}">세관장확인 ${sp.rel.length}건: ${esc(laws(sp.rel).join(', ') || '내용 보기')}</span>`);
      laws(sp.cond).forEach(l => { const x = sp.cond.find(y => y.law === l), na = x.cond.likely === 'na';
        out.push(`<span class="kc-chip${na ? ' ok' : ''}" title="${esc(x.cond.need + '\n' + sp.cond.filter(y => y.law === l).map(y => y.raw).join('\n'))}">${na ? '해당 없음 확인' : '조건부'} · ${esc(l)}${na ? '' : ` — ${esc(x.cond.need)}`} <button type="button" class="mini" data-ccct-na="${esc(it.id)}|${esc(l)}" title="${na ? '다시 요건으로 봄' : '이 품목은 그 용도가 아니어서 요건이 아님'}">${na ? '되돌리기' : '해당 없음'}</button></span>`); });
    }
  }
  if(e.hs) out.push(e.hs.err ? `<span class="kc-chip bad" title="${esc(e.hs.err)}">HS 확인 오류</span>` : e.hs.found ? `<span class="kc-chip ok" title="${esc([e.hs.ko, e.hs.en, e.hs.qty && '수량단위 ' + e.hs.qty, e.hs.wt && '중량단위 ' + e.hs.wt].filter(Boolean).join('\n'))}">현행 HS${e.hs.ko ? ' · ' + esc(e.hs.ko.slice(0, 30)) : ''}</span>` : '<span class="kc-chip bad">현행 HS 아님</span>');
  if(e.trrt && dir !== 'E') out.push(e.trrt.err ? `<span class="kc-chip bad" title="${esc(e.trrt.err)}">관세율 ${/설정 필요/.test(e.trrt.err) ? '설정 필요' : '오류'}</span>` : `<span class="kc-chip" title="${esc(e.trrt.rows.join('\n'))}">관세율 ${esc((e.trrt.rows[0] || '없음').slice(0, 50))}</span>`);
  (e.chem || []).forEach(c => out.push(c.err ? `<span class="kc-chip bad" title="${esc(c.err)}">CAS ${esc(c.cas)} 오류</span>` : `<span class="kc-chip ${c.flags.length ? 'warn' : c.found ? 'ok' : ''}" title="${esc((c.raw || []).join('\n'))}">CAS ${esc(c.cas)}${c.name ? ' ' + esc(c.name) : ''}${c.flags.length ? ' · ' + esc(c.flags.slice(0, 3).join(', ')) : c.found ? '' : ' · 조회 안 됨'}</span>`));
  (stale ? [] : e.food || []).forEach(f => out.push(f.err ? `<span class="kc-chip bad" title="${esc(f.err)}">${esc(f.name)} ${/설정 필요/.test(f.err) ? '설정 필요' : '오류'}</span>` : `<span class="kc-chip ${f.limited ? 'bad' : f.n ? 'ok' : ''}" title="${esc((f.raw || []).join('\n'))}">${esc(f.name)}${f.verdict.length ? ' · ' + esc(f.verdict.join(' · ')) : f.n ? '' : ' · 조회 안 됨'}${f.n && !f.exact ? ' (이름 일부 일치)' : ''}</span>`));
  if(!out.length) return '';
  return `<div class="ext-row">${out.join(' ')}<span class="hint">${esc(e.at.slice(0, 10))} 확인</span></div>${full ? extDetailHTML(e) : ''}`;
}
function extDetailHTML(e){
  const sec = (t, a) => a.length ? `<div><span class="lbl">${t}</span><ul class="pre-check">${a.map(x => `<li class="hint">${esc(x)}</li>`).join('')}</ul></div>` : '';
  return `<details class="ext-detail"><summary class="hint">원문 칸 보기</summary>${sec('세관장확인', e.ccct && !e.ccct.err ? e.ccct.list.map(x => x.raw) : [])}${sec('관세율', e.trrt && !e.trrt.err ? e.trrt.rows : [])}${sec('화학물질', (e.chem || []).flatMap(c => c.raw || []))}${sec('식품원재료', (e.food || []).flatMap(f => f.raw || []))}</details>`;
}

/* ---------- 법령: 매뉴얼 근거 법령 시행일·개정 확인 (P2-E, G4 일부) ----------
   절차의 '근거 법령' 한 줄 = 법령명 [조문]. 법령명으로 검색해 이름이 같은 현행 법령의 공포(발령)·시행일을 받는다.
   고시·훈령·예규·규정·지침은 행정규칙으로 찾는다. */
function lawRefs(p){
  return lines(p.laws).map(l => {
    const m = /^(.+?)\s*((?:제\s*\d+\s*조(?:의\s*\d+)?|별표|부칙|제\s*\d+\s*항).*)?$/.exec(l.replace(/^[-·•]\s*/, '').trim());
    const name = (m ? m[1] : l).replace(/[「」『』"]/g, '').trim(), art = m && m[2] ? m[2].trim() : '';
    return {line:l, name, art, target:/(고시|훈령|예규|규정|지침|요령|공고)$/.test(name) && !/(법|령|규칙)$/.test(name) ? 'admrul' : 'law'};
  }).filter(x => x.name.length >= 2);
}
const lawKey = n => String(n || '').replace(/\s+/g, '');
function lawPick(items, name){
  const k = lawKey(name);
  const nm = r => lawKey(r['법령명한글'] || r['행정규칙명'] || r['법령명'] || '');
  const same = items.filter(r => nm(r) === k);
  const cur = same.find(r => /현행/.test(r['현행연혁코드'] || r['현행연혁구분'] || '')) || same[0];
  if(!cur) return null;
  return {id:cur['법령ID'] || cur['행정규칙ID'] || '', serial:cur['법령일련번호'] || cur['행정규칙일련번호'] || '', kind:cur['법령구분명'] || cur['행정규칙종류'] || '',
    promul:fmtYmd(cur['공포일자'] || cur['발령일자'] || ''), effect:fmtYmd(cur['시행일자'] || ''), dept:cur['소관부처명'] || ''};
}
let lawBusy = false;
async function checkLaws(silent){
  if(lawBusy) return;
  const refs = new Map();
  db.procedures.forEach(p => lawRefs(p).forEach(r => { if(!refs.has(lawKey(r.name))) refs.set(lawKey(r.name), r); }));
  const list = [...refs.values()].slice(0, 60);
  if(!list.length){ if(!silent) toast('근거 법령을 적은 절차가 없습니다. 절차 수정 창의 ‘근거 법령’에 한 줄에 하나씩 적어 주세요.'); return; }
  lawBusy = true; if(!silent) toast(`법령 ${list.length}개의 시행일을 확인하는 중…`);
  let res;
  try{ res = await extCall(list.map(r => ({svc:'law', p:{query:r.name, target:r.target}}))); }
  catch(e){ lawBusy = false; typeof markRun === 'function' && markRun('law', false, e.message); if(!silent) toast('확인하지 못했습니다: ' + e.message); return; }
  db.lawInfo = db.lawInfo || {};
  let errs = 0, miss = 0;
  typeof markRun === 'function' && markRun('law', true);
  list.forEach((r, i) => {
    const x = res[i];
    if(!x || !x.ok){ errs++; db.lawInfo[lawKey(r.name)] = {...(db.lawInfo[lawKey(r.name)] || {}), name:r.name, err:(x && x.error) || '응답 없음', at:nowIso()}; return; }
    const info = lawPick(x.items || [], r.name);
    if(!info){ miss++; db.lawInfo[lawKey(r.name)] = {name:r.name, miss:true, at:nowIso(), cands:(x.items || []).slice(0, 3).map(it => it['법령명한글'] || it['행정규칙명'] || '').filter(Boolean)}; return; }
    db.lawInfo[lawKey(r.name)] = {name:r.name, ...info, at:nowIso()};
  });
  let na = 0;
  db.procedures.forEach(p => {
    if(!p.reviewedAt) return;
    lawRefs(p).forEach(r => {
      const li = db.lawInfo[lawKey(r.name)];
      if(!li || li.err || li.miss) return;
      const last = [li.promul, li.effect].filter(d => d && d <= today()).sort().slice(-1)[0];
      if(last && last > p.reviewedAt && addAlert({key:`law|${p.id}|${lawKey(r.name)}|${li.promul}|${li.effect}`, kind:'law', ttype:'proc', tid:p.id, title:`법령 개정 확인 필요: ${p.title} — ${r.name}`, text:`공포(발령) ${li.promul || '-'} · 시행 ${li.effect || '-'} / 절차 최종 검토 ${p.reviewedAt}\n개정 내용을 확인해 절차를 고친 뒤 매뉴얼에서 ‘오늘 검토함’을 누르세요.`})) na++;
      if(li.effect && li.effect > today() && addAlert({key:`lawf|${p.id}|${lawKey(r.name)}|${li.effect}`, kind:'law', ttype:'proc', tid:p.id, title:`시행 예정 개정: ${p.title} — ${r.name}`, text:`${li.effect} 시행 예정. 진행 중인 건에 적용 시점을 확인하세요.`})) na++;
    });
  });
  db.records.filter(r => r.status !== '완료' && r.lawSnap).forEach(r => {        // 진행 중 업무: 시작 시점 법령과 달라졌으면 알림
    (r.lawSnap.laws || []).forEach(x => {
      const li = db.lawInfo[lawKey(x.name)];
      if(!li || li.err || li.miss) return;
      if(!x.effect && !x.promul){ x.effect = li.effect || ''; x.promul = li.promul || ''; return; }   // 시작 때 정보가 없었으면 지금 값으로 채움
      if((li.promul || '') === (x.promul || '') && (li.effect || '') === (x.effect || '')) return;
      if(addAlert({key:`lawr|${r.id}|${lawKey(x.name)}|${li.promul}|${li.effect}`, kind:'law', ttype:'rec', tid:r.id, title:`진행 중 업무에 법령 개정: ${r.caseNo || ''} ${r.title} — ${x.name}`,
        text:`업무 시작(${r.lawSnap.at}) 기준 공포 ${x.promul || '-'} · 시행 ${x.effect || '-'} → 현재 공포 ${li.promul || '-'} · 시행 ${li.effect || '-'}${li.effect > today() ? ' (시행 예정)' : ''}\n이 건에 어느 법령을 적용할지 확인하세요.`})) na++;
    });
  });
  db.settings.lawCheckedAt = nowIso(); lawBusy = false;
  if(errs === list.length && list.length) db.settings.extPause = today();
  commit();
  if(!silent) toast(`법령 ${list.length}개 확인${miss ? ` · 이름 불일치 ${miss}` : ''}${errs ? ` · 오류 ${errs}` : ''}${na ? ` · 새 알림 ${na}건` : ''}`);
}
function lawLinesHTML(p){
  const refs = lawRefs(p);
  if(!refs.length) return `<span class="pre">${esc(p.laws)}</span>`;
  return `<ul class="law-list">${refs.map(r => {
    const li = (db.lawInfo || {})[lawKey(r.name)];
    let tag = '';
    if(li && li.err) tag = `<span class="kc-chip bad" title="${esc(li.err)}">조회 오류</span>`;
    else if(li && li.miss) tag = `<span class="kc-chip warn" title="검색 결과: ${esc((li.cands || []).join(', '))}">이름 불일치 — 정식 명칭 확인</span>`;
    else if(li){ const last = [li.promul, li.effect].filter(d => d && d <= today()).sort().slice(-1)[0]; const rev = p.reviewedAt && last && last > p.reviewedAt;
      tag = `<span class="kc-chip${rev ? ' bad' : ''}">${rev ? '개정 확인 필요 · ' : ''}시행 ${esc(li.effect || '-')}${li.effect > today() ? ' (예정)' : ''}</span>`; }
    return `<li>${esc(r.line)} ${tag}</li>`;
  }).join('')}</ul>`;
}

/* ---------- 연결 점검·자동 확인 ---------- */
/* 연결 점검 + 설정: 키와 주소는 Apps Script 스크립트 속성에 저장(재배포 불필요). 키 값은 화면에 다시 보여 주지 않음 */
const CONF_LABEL = {TRRT_PATH:'UNI-PASS 관세율 경로 (/ext/rest/ 뒤)', TRRT_HS_PARAM:'관세율 HS 요청변수', CCCT_UNI_PATH:'UNI-PASS 세관장확인 경로 (/ext/rest/ 뒤)', FOOD_URL:'식품 원재료 요청주소', CCCT_URL:'세관장확인 요청주소', CHEM_URL:'화학물질 요청주소', ECM_PATH:'UNI-PASS 통관고유부호 경로 (API010)', HS_PATH:'UNI-PASS HS 부호 경로 (API018)', NTS_URL:'국세청 사업자 상태조회 주소'};
const KEY_LABEL = {LAW_API_KEY:'국가법령정보 OC', DATA_GO_KR_KEY:'공공데이터포털 인증키 (Decoding)', CUSTOMS_CONFIRM_KEY:'UNI-PASS 관세율 기본조회 키', UNIPASS_KEY_API029:'UNI-PASS 세관장확인 키 (API029)', UNIPASS_KEY_API010:'UNI-PASS 통관고유부호 키 (API010)', UNIPASS_KEY_API018:'UNI-PASS HS 부호 키 (API018)', NTS_API_KEY:'국세청 사업자 상태조회 키 (비우면 공공데이터포털 키 사용)'};
async function openApiPing(){
  const cfg = db.settings.mail || {};
  if(!cfg.endpoint || !cfg.token){ toast('먼저 Apps Script 연동을 설정하세요.'); return; }
  toast('공공데이터 연결을 점검하는 중…');
  let j;
  try{ j = await collectApi({apiping:1}); }catch(e){ toast('점검하지 못했습니다: ' + e.message + ' (gs를 새 버전으로 배포했는지 확인)'); return; }
  const st = j.state || {keys:{}, conf:{}}, admin = me && me.role === 'admin';
  openDialog({title:'공공데이터 연결 점검', saveLabel:'닫기', body:`<p class="hint">서비스마다 시험 값으로 한 번씩 호출한 결과입니다. 오늘 호출 수: ${esc(Object.entries(j.today || {}).map(([k, v]) => `${EXT_NAMES[k] || k} ${v}`).join(', ') || '없음')}</p>
    <div class="table-wrap"><table class="grid"><thead><tr><th>서비스</th><th>키</th><th>결과</th><th>받은 칸</th></tr></thead><tbody>${(j.services || []).map(s => `<tr><td>${esc(s.name)}</td><td class="hs">${esc(s.key)}</td><td>${s.ok ? `<span class="kc-chip ok">정상 ${s.n}건</span>` : `<span class="kc-chip bad">${esc(s.error)}</span>`}</td><td class="hint">${esc((s.fields || []).join(', '))}</td></tr>`).join('')}</tbody></table></div>
    ${admin ? `<div class="dlg-section"><h4>설정 (관리자) — 저장하면 바로 적용, 재배포 필요 없음</h4>
      <div class="row2">${Object.keys(KEY_LABEL).map(k => `<label>${esc(KEY_LABEL[k])}<input type="password" autocomplete="new-password" data-key="${k}" placeholder="${st.keys[k] ? '저장됨 ' + esc(st.keys[k]) + ' — 바꿀 때만 입력' : '미저장'}"></label>`).join('')}</div>
      <div class="row2">${Object.keys(CONF_LABEL).map(k => `<label>${esc(CONF_LABEL[k])}<input data-conf="${k}" value="${esc(st.conf[k] || '')}"></label>`).join('')}</div>
      <label style="max-width:260px">관리자 PIN (Apps Script 스크립트 속성 CONF_PIN)<input type="password" autocomplete="new-password" data-x="pin" placeholder="숫자로 정한 PIN"></label>
      <div class="btn-row"><button type="button" class="primary" data-x="confsave">설정 저장 후 다시 점검</button><span class="hint" data-x="confmsg"></span></div>
      <p class="hint">키는 Apps Script 스크립트 속성에만 저장되고 Workspace 데이터·GitHub에는 남지 않으며, 저장 후에는 끝 4자리만 보입니다. 주소는 공공데이터포털·UNI-PASS 주소만 받습니다. 주소를 비우고 저장하면 기본값으로 돌아갑니다.</p></div>` : ''}`,
    onSave(){ return true; },
    onOpen(f){
      const X = n => f.querySelector(`[data-x="${n}"]`);
      if(!admin) return;
      setTimeout(() => f.querySelectorAll('[data-key],[data-x="pin"]').forEach(el => { el.value = ''; }), 300);   // 브라우저가 로그인 비밀번호를 자동으로 채운 경우 지움
      X('confsave').onclick = async () => {
        const set = {};
        f.querySelectorAll('[data-key]').forEach(el => { if(el.value.trim()) set[el.dataset.key] = el.value.trim(); });
        f.querySelectorAll('[data-conf]').forEach(el => { if(el.value.trim() !== (st.conf[el.dataset.conf] || '')) set[el.dataset.conf] = el.value.trim(); });
        if(!Object.keys(set).length){ X('confmsg').textContent = '바뀐 값이 없습니다.'; return; }
        if(!X('pin').value.trim()){ X('confmsg').textContent = '관리자 PIN을 넣으세요.'; return; }
        X('confmsg').textContent = '저장 중…';
        try{
          const r = await syncPost(cfg, {op:'conf', set, pin:X('pin').value});
          if(!r.ok) throw new Error(r.error || '응답 오류');
          if((r.bad || []).length){ X('confmsg').textContent = '형식이 맞지 않아 저장하지 않음: ' + r.bad.map(k => CONF_LABEL[k] || k).join(', '); return; }
          db.settings.extPause = ''; $('#dlg').close(); toast('설정을 저장했습니다. 다시 점검합니다.'); openApiPing();
        }catch(e){ X('confmsg').textContent = '저장하지 못했습니다: ' + e.message; }
      };
    }});
}
function autoExtChecks(){
  if(tidyCcctAlerts()) commit();                                            // 조건부 요건만 남은 세관장확인 알림 정리 (로그인할 때)
  const cfg = db.settings.mail || {};
  if(!cfg.endpoint || !cfg.token || db.settings.extPause === today()) return;
  const old = (iso, d) => !iso || daysLeft(String(iso).slice(0, 10)) < -d;
  (async () => {
    if(old(db.settings.lawCheckedAt, 7)) await checkLaws(true);
    if(db.settings.extPause === today()) return;
    const due = db.items.filter(it => itemReqs(it).length && (old((it.ext || {}).at, 30) || (itemDir(it) === 'E' && it.ext && it.ext.ccct && it.ext.ccct.imex !== '1'))).slice(0, 15);   // 수출 품목은 수출 기준으로 다시
    if(due.length) await checkItemsExt(due, true);
    const cd = db.clients.filter(c => (bizDigits(c.bizNo).length === 10 || c.name) && old((c.ext || {}).at, 30)).slice(0, 20);
    if(cd.length) await checkClientsExt(cd, true);
  })().catch(() => {});
}

/* ---------- 업체 정보 자동 확인 (목표 5): 통관고유부호(API010) + 국세청 사업자 상태 ----------
   사업자번호가 있으면 API010으로 통관고유부호·대표자·주소·전화를 빈칸에 채우고, 국세청으로 계속·휴업·폐업과 과세유형을 확인한다.
   사업자번호가 없으면 상호명으로 API010을 찾아 한 곳만 나올 때 사업자번호까지 채운다. 변화는 확인 알림으로. */
let clientExtBusy = false;
async function checkClientsExt(list, silent){
  if(clientExtBusy) return;
  const cs = list.filter(c => bizDigits(c.bizNo).length === 10 || (c.name && nameKey(c.name).length >= 2));
  if(!cs.length){ if(!silent) toast('확인할 업체가 없습니다. 사업자번호나 업체명을 넣어 주세요.'); return; }
  clientExtBusy = true;
  const reqs = cs.map(c => bizDigits(c.bizNo).length === 10 ? {svc:'ecm', p:{brno:bizDigits(c.bizNo)}} : {svc:'ecm', p:{name:nameKey(c.name)}});
  const withBiz = () => cs.filter(c => bizDigits(c.bizNo).length === 10);
  let res;
  try{ res = await extCall(reqs); }catch(e){ clientExtBusy = false; if(!silent) toast('업체 정보를 확인하지 못했습니다: ' + e.message); return; }
  let filled = 0, na0 = (db.alerts || []).length, errs = new Set();
  cs.forEach((c, i) => {
    const r = res[i] || {};
    c.ext = {...(c.ext || {}), at:nowIso()};
    if(!r.ok){ errs.add('통관고유부호: ' + (r.error || '응답 없음')); c.ext.ecmErr = r.error || ''; return; }
    delete c.ext.ecmErr;
    const rows = (r.items || []).filter(x => x.ecm || x.bsnsNo);
    const b = bizDigits(c.bizNo);
    const same = x => nameKey(x.conmNm).replace(/\s/g, '') === nameKey(c.name).replace(/\s/g, '');   // 상호로 찾을 때는 이름이 같은 한 곳만 인정
    const hit = b ? rows.find(x => bizDigits(x.bsnsNo) === b) || null : (rows.filter(same).length === 1 ? rows.filter(same)[0] : null);
    c.ext.ecmN = rows.length;
    if(!hit) return;
    const set = (k, v) => { if(v && !String(c[k] || '').trim()){ c[k] = String(v).trim(); filled++; return true; } return false; };
    if(!b && hit.bsnsNo) set('bizNo', String(hit.bsnsNo).replace(/^(\d{3})(\d{2})(\d{5})$/, '$1-$2-$3'));
    set('ecm', hit.ecm); set('rep', hit.rppnNm); set('address', hit.bslcBscsAddr); set('tel', hit.rprsTelno);
    const prevUse = c.ext.ecmUse;
    c.ext.ecmUse = hit.useYn || '';
    if(hit.useYn && hit.useYn !== 'Y' && prevUse !== hit.useYn) addAlert({key:`ecm|${c.id}|${hit.useYn}`, kind:'ecm', ttype:'client', tid:c.id, title:`통관고유부호 사용 안 함: ${c.name}`, text:`UNI-PASS 통관고유부호 ${hit.ecm || ''} 사용여부 ${hit.useYn}. 신고 전에 업체에 부호 상태를 확인하세요.`});
    c.updatedAt = nowIso();
  });
  const bz = withBiz();
  for(let i = 0; i < bz.length; i += 100){                               // 국세청: 100개씩
    const part = bz.slice(i, i + 100);
    let nr;
    try{ nr = (await extCall([{svc:'nts', p:{bnos:part.map(c => bizDigits(c.bizNo)).join(',')}}]))[0]; }catch(e){ nr = {ok:false, error:e.message}; }
    if(!nr || !nr.ok){ errs.add('국세청: ' + ((nr && nr.error) || '응답 없음')); continue; }
    (nr.items || []).filter(x => x.b_no).forEach(x => {
      const c = part.find(y => bizDigits(y.bizNo) === bizDigits(x.b_no)); if(!c) return;
      const prev = c.ext.nts || null, cur = {cd:x.b_stt_cd || '', stt:x.b_stt || '', tax:x.tax_type || '', end:x.end_dt || '', at:today()};
      c.ext.nts = cur;
      const nm = c.name;
      if(cur.cd === '02' || cur.cd === '03') addAlert({key:`nts|${c.id}|${cur.cd}`, kind:'nts', ttype:'client', tid:c.id, title:`${cur.cd === '03' ? '폐업' : '휴업'} 사업자: ${nm}`, text:`국세청 상태 ${cur.stt}${cur.end ? ` (폐업일 ${fmtYmd(cur.end)})` : ''}. 진행 중 업무와 정산을 확인하세요.`});
      else if(!cur.cd && /등록되지 않은/.test(cur.tax)) addAlert({key:`nts|${c.id}|none`, kind:'nts', ttype:'client', tid:c.id, title:`국세청에 없는 사업자번호: ${nm}`, text:`${c.bizNo} — ${cur.tax}`});
      else if(prev && prev.tax && cur.tax && prev.tax !== cur.tax) addAlert({key:`ntstax|${c.id}|${cur.tax}`, kind:'nts', ttype:'client', tid:c.id, title:`과세유형 변경: ${nm}`, text:`${prev.tax} → ${cur.tax}`});
    });
  }
  clientExtBusy = false;
  commit();
  const na = (db.alerts || []).length - na0;
  if(!silent || na || filled) toast(`업체 정보 확인: ${cs.length}곳${filled ? ` · 빈칸 ${filled}개 채움` : ''}${na ? ` · 새 알림 ${na}건` : ''}${errs.size ? ` · ${[...errs].slice(0, 2).join(' / ')}` : ''}`);
}
/* 품목 화면: 품명으로 HS 후보 (참고용, 자동으로 넣지 않음) */
async function hsCandidates(name){
  const r = (await extCall([{svc:'hs', p:{name}}]))[0];
  if(!r || !r.ok) throw new Error((r && r.error) || '응답 없음');
  return (r.items || []).filter(x => x.hsSgn).slice(0, 20).map(x => ({hs:x.hsSgn, ko:x.korePrnm || '', en:x.englPrnm || ''}));
}
function snapLaws(rec){
  const p = (rec.procId && db.procedures.find(x => x.id === rec.procId)) || procFor(rec);
  if(!p) return;
  const laws = lawRefs(p).map(x => { const li = (db.lawInfo || {})[lawKey(x.name)] || {}; return {name:x.name, effect:li.err || li.miss ? '' : (li.effect || ''), promul:li.err || li.miss ? '' : (li.promul || '')}; });
  if(laws.length) rec.lawSnap = {at:today(), procId:p.id, laws};
}

/* 조건부 세관장확인 '해당 없음' 표시 (품목별 법령) */
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-ccct-na]'); if(!b || !db) return;
  const [id, law] = b.dataset.ccctNa.split('|'), it = db.items.find(i => i.id === id); if(!it) return;
  const on = (it.reqNA || []).includes(law);
  it.reqNA = on ? it.reqNA.filter(x => x !== law) : [...(it.reqNA || []), law];
  it.updatedAt = nowIso(); tidyCcctAlerts(); commit();
  toast(on ? `${it.name}: ${law}을(를) 다시 요건으로 봅니다.` : `${it.name}: ${law}은(는) 해당 없음으로 표시했습니다.`);
});
