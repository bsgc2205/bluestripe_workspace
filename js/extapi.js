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
const EXT_NAMES = {law:'법령', trrt:'관세율', ccct:'세관장확인', chem:'화학물질', food:'식품원재료'};
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
  if(a.ttype === 'rec'){ const r = db.records.find(x => x.id === a.tid); return r ? `<button class="mini" data-edit-rec="${esc(r.id)}">기록 열기</button>` : ''; }
  return '';
}
function viewAlerts(){
  const op = openAlerts().slice().sort((a, b) => b.at.localeCompare(a.at)), done = (db.alerts || []).filter(x => x.status !== 'open').sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')).slice(0, 50);
  const card = a => `<article class="inq${a.status === 'open' ? '' : ' done'}"><div class="inq-head"><span class="tag type">${esc(EXT_NAMES[a.kind] || a.kind)}</span><strong>${esc(a.title)}</strong><span class="hint">${esc(a.at.slice(0, 10))}</span><span class="sp"></span>${alertTargetHTML(a)}${a.status === 'open' ? ` <button class="mini strong" data-alert-done="${esc(a.id)}">확인함</button>` : `<span class="hint">확인 ${esc(accountName(a.doneBy || ''))} ${esc((a.doneAt || '').slice(0, 10))}</span>`}</div>${a.text ? `<p class="pre hint" style="margin:.4rem 0 0">${esc(a.text)}</p>` : ''}</article>`;
  return `<header class="client-head"><div><h2>확인 알림</h2><p class="client-meta">공공데이터 확인에서 바뀐 점(법령 개정, 세관장확인 요건·관세율 변경, 화학물질 분류, 식품원재료 판정)을 모았습니다. 내용을 보고 품목 요건·절차를 고친 뒤 ‘확인함’을 누르세요.</p></div>
      <div class="client-act">${op.length ? `<button class="ghost" data-alert-all>모두 확인함</button>` : ''}</div></header>
    <div class="narrow">${op.length ? op.map(card).join('') : '<p class="empty">확인할 알림이 없습니다.</p>'}
    ${done.length ? `<details class="old-mails"><summary>확인한 알림 ${done.length}건</summary>${done.map(card).join('')}</details>` : ''}</div>`;
}

/* ---------- 품목: 관세율·세관장확인·화학물질·식품원재료 (P2-D) ---------- */
function itemReqs(it){
  const hs = hsDigits(it.hs), out = [];
  if(hs.length === 10){ out.push({svc:'ccct', key:'ccct', p:{hs, imex:'2'}}); out.push({svc:'trrt', key:'trrt', p:{hs}}); }
  casList(it.cas).forEach(c => out.push({svc:'chem', key:'chem:' + c, p:{by:'2', q:c}}));
  lines(it.raw).map(x => x.replace(/\s*\(.*?\)\s*/g, ' ').trim()).filter(x => x.length >= 2).slice(0, 10).forEach(n => out.push({svc:'food', key:'food:' + n, p:{name:n}}));
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
  return {raw:rows.map(r => rowText(r))};
}
const REQ_TEXT = it => [it.reqs, it.agency, it.notes].join(' ');
function itemAlerts(it, prev, cur){
  const nm = `${it.name} (${clientName(it.clientId)}${it.hs ? ', HS ' + it.hs : ''})`;
  const p0 = prev || {};
  if(cur.ccct && !cur.ccct.err){
    const was = p0.ccct && !p0.ccct.err && p0.ccct.v === 2 ? p0.ccct.sig : null;   // 표시 형식이 바뀐 예전 결과와는 비교하지 않음
    if(was !== null && was !== cur.ccct.sig) addAlert({key:`ccct|${it.id}|${cur.ccct.sig}`, kind:'ccct', ttype:'item', tid:it.id, title:`세관장확인 요건 변경: ${nm}`, text:`이전: ${(p0.ccct.list || []).map(x => x.law + ' ' + x.org).join(', ') || '없음'}\n현재: ${cur.ccct.list.map(x => x.law + ' ' + x.org).join(', ') || '없음'}`});
    else if(was === null && cur.ccct.n && !String(it.reqs || '').trim()) addAlert({key:`ccct|${it.id}|${cur.ccct.sig}`, kind:'ccct', ttype:'item', tid:it.id, title:`세관장확인 대상인데 품목 요건이 비어 있음: ${nm}`, text:cur.ccct.list.map(x => `${x.law} · ${x.org}${x.doc ? ' · ' + x.doc : ''}${x.from ? ' (' + x.from + '부터)' : ''}`).join('\n')});
  }
  if(cur.trrt && !cur.trrt.err && p0.trrt && !p0.trrt.err && p0.trrt.v === 2 && p0.trrt.sig !== cur.trrt.sig) addAlert({key:`trrt|${it.id}|${cur.trrt.sig.slice(0, 200)}`, kind:'trrt', ttype:'item', tid:it.id, title:`관세율 변경: ${nm}`, text:`이전: ${(p0.trrt.rows || []).join(' / ')}\n현재: ${cur.trrt.rows.join(' / ')}`});
  (cur.chem || []).filter(c => !c.err && c.flags.length).forEach(c => {
    if(/화관법|유해화학|유독|제한|금지|허가|사고대비/.test(REQ_TEXT(it))) return;
    addAlert({key:`chem|${it.id}|${c.cas}|${c.sig}`, kind:'chem', ttype:'item', tid:it.id, title:`화학물질 분류 확인: ${nm} — CAS ${c.cas}${c.name ? ' ' + c.name : ''}`, text:`분류: ${c.flags.join(', ')}\n품목 요건에 화관법 관련 내용이 없습니다.`});
  });
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
  catch(e){ extBusy = false; if(!silent) toast('확인하지 못했습니다: ' + e.message); return; }
  let k = 0, nAlert = (db.alerts || []).length, errs = new Set();
  plan.forEach(({it, reqs}) => {
    const cur = {at:nowIso(), chem:[], food:[]};
    reqs.forEach(r => {
      const s = summarize(r.svc, res[k++], r.p);
      if(s.err) errs.add(`${EXT_NAMES[r.svc]}: ${s.err}`);
      if(r.svc === 'chem') cur.chem.push(s.err ? {cas:r.p.q, err:s.err} : s);
      else if(r.svc === 'food') cur.food.push(s.err ? {name:r.p.name, err:s.err} : s);
      else cur[r.svc] = s;
    });
    itemAlerts(it, it.ext, cur);
    it.ext = cur; it.updatedAt = nowIso();
  });
  extBusy = false;
  const setup = [...errs].every(e => /미저장|설정 필요/.test(e)) && errs.size;
  if(setup) db.settings.extPause = today();
  commit();
  const na = (db.alerts || []).length - nAlert;
  if(!silent) toast(`확인 완료: 품목 ${plan.length}개${na ? ` · 새 알림 ${na}건` : ''}${errs.size ? ` · 오류 ${[...errs].slice(0, 2).join(' / ')}` : ''}`);
}
function extItemHTML(it, full){
  const e = it.ext; if(!e) return '';
  const out = [];
  if(e.ccct) out.push(e.ccct.err ? `<span class="kc-chip bad" title="${esc(e.ccct.err)}">세관장확인 오류</span>` : e.ccct.n ? `<span class="kc-chip warn" title="${esc(e.ccct.list.map(x => x.raw).join('\n'))}">세관장확인 ${e.ccct.n}건: ${esc([...new Set(e.ccct.list.map(x => x.law).filter(Boolean))].join(', ') || '내용 보기')}</span>` : '<span class="kc-chip ok">세관장확인 대상 아님</span>');
  if(e.trrt) out.push(e.trrt.err ? `<span class="kc-chip bad" title="${esc(e.trrt.err)}">관세율 ${/설정 필요/.test(e.trrt.err) ? '설정 필요' : '오류'}</span>` : `<span class="kc-chip" title="${esc(e.trrt.rows.join('\n'))}">관세율 ${esc((e.trrt.rows[0] || '없음').slice(0, 50))}</span>`);
  (e.chem || []).forEach(c => out.push(c.err ? `<span class="kc-chip bad" title="${esc(c.err)}">CAS ${esc(c.cas)} 오류</span>` : `<span class="kc-chip ${c.flags.length ? 'warn' : c.found ? 'ok' : ''}" title="${esc((c.raw || []).join('\n'))}">CAS ${esc(c.cas)}${c.name ? ' ' + esc(c.name) : ''}${c.flags.length ? ' · ' + esc(c.flags.slice(0, 3).join(', ')) : c.found ? '' : ' · 조회 안 됨'}</span>`));
  (e.food || []).forEach(f => out.push(f.err ? `<span class="kc-chip bad" title="${esc(f.err)}">${esc(f.name)} ${/설정 필요/.test(f.err) ? '설정 필요' : '오류'}</span>` : `<span class="kc-chip ${f.limited ? 'bad' : f.n ? 'ok' : ''}" title="${esc((f.raw || []).join('\n'))}">${esc(f.name)}${f.verdict.length ? ' · ' + esc(f.verdict.join(' · ')) : f.n ? '' : ' · 조회 안 됨'}${f.n && !f.exact ? ' (이름 일부 일치)' : ''}</span>`));
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
  catch(e){ lawBusy = false; if(!silent) toast('확인하지 못했습니다: ' + e.message); return; }
  db.lawInfo = db.lawInfo || {};
  let errs = 0, miss = 0;
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
const CONF_LABEL = {TRRT_PATH:'UNI-PASS 관세율 경로 (/ext/rest/ 뒤)', TRRT_HS_PARAM:'관세율 HS 요청변수', CCCT_UNI_PATH:'UNI-PASS 세관장확인 경로 (/ext/rest/ 뒤)', FOOD_URL:'식품 원재료 요청주소', CCCT_URL:'세관장확인 요청주소', CHEM_URL:'화학물질 요청주소'};
const KEY_LABEL = {LAW_API_KEY:'국가법령정보 OC', DATA_GO_KR_KEY:'공공데이터포털 인증키 (Decoding)', CUSTOMS_CONFIRM_KEY:'UNI-PASS 관세율 기본조회 키', UNIPASS_KEY_API029:'UNI-PASS 세관장확인 키 (API029)'};
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
  const cfg = db.settings.mail || {};
  if(!cfg.endpoint || !cfg.token || db.settings.extPause === today()) return;
  const old = (iso, d) => !iso || daysLeft(String(iso).slice(0, 10)) < -d;
  (async () => {
    if(old(db.settings.lawCheckedAt, 7)) await checkLaws(true);
    if(db.settings.extPause === today()) return;
    const due = db.items.filter(it => itemReqs(it).length && old((it.ext || {}).at, 30)).slice(0, 15);
    if(due.length) await checkItemsExt(due, true);
  })().catch(() => {});
}
function snapLaws(rec){
  const p = (rec.procId && db.procedures.find(x => x.id === rec.procId)) || procFor(rec);
  if(!p) return;
  const laws = lawRefs(p).map(x => { const li = (db.lawInfo || {})[lawKey(x.name)] || {}; return {name:x.name, effect:li.err || li.miss ? '' : (li.effect || ''), promul:li.err || li.miss ? '' : (li.promul || '')}; });
  if(laws.length) rec.lawSnap = {at:today(), procId:p.id, laws};
}
