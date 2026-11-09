'use strict';
/* ---------- 운임 견적 (11/9) ----------
   흐름: 우리가 포워더에 견적 요청 → 포워더 회신 메일의 견적 첨부(PDF·엑셀)를 사무실 PC 수집기가 Apps Script로 보냄
        → Apps Script가 Drive 'BSGC-견적' 폴더에 저장하고 글자를 뽑음 → 여기서 항목을 추출해 요청 건별로 비교
        → 고른 견적으로 고객용 견적서 작성(항목별 가산, BSGC 항목 추가) → BSGC 양식 인쇄(PDF)·엑셀 저장.
   고객 견적서에는 포워더 이름·원가가 나오지 않는다(원가·가산은 이 화면에서만 보임).
   db.quotes: 받은 견적(원문 글자 + 추출 결과), db.quoteJobs: 고객 견적서, db.settings.quote: 기본 가산율·환율·발신 정보. */

/* 운임 항목 사전: key, 표시 이름, 찾는 말, 구분(freight 운임 / origin 선적지 / dest 도착지 / local 부대 / other 기타), 부가세 기본값 */
const QCHG = [
  ['OF', 'Ocean Freight (해상운임)', /ocean\s*freight|o\s*\/\s*f(?![a-z])|sea\s*freight|basic\s*freight|해상\s*운임/i, 'freight', false],
  ['AF', 'Air Freight (항공운임)', /air\s*freight|a\s*\/\s*f(?![a-z])|항공\s*운임/i, 'freight', false],
  ['BAF', 'BAF (유류할증료)', /(?<![a-z])baf(?![a-z])|bunker\s*adj|유류\s*할증/i, 'freight', false],
  ['LSS', 'LSS·SBS·EBS (저유황·특별 유류할증)', /(?<![a-z])(lss|lsf|sbs|ebs|ecc)(?![a-z])|low\s*sul|special\s*bunker|emergency\s*bunker/i, 'freight', false],
  ['CAF', 'CAF (통화할증료)', /(?<![a-z])caf(?![a-z])|currency\s*adj/i, 'freight', false],
  ['PSS', 'PSS·GRI (성수기·운임인상)', /(?<![a-z])(pss|gri)(?![a-z])|peak\s*season/i, 'freight', false],
  ['CIC', 'CIC·CRS (컨테이너 불균형)', /(?<![a-z])(cic|crs|ecrs|eis)(?![a-z])|container\s*imbalance|equipment\s*imbalance/i, 'freight', false],
  ['FSC', 'FSC·SSC (항공 유류·보안)', /(?<![a-z])(fsc|ssc|mcc)(?![a-z])|fuel\s*surcharge|security\s*surcharge/i, 'freight', false],
  ['THC', 'THC (터미널 화물처리비)', /(?<![a-z])thc(?![a-z])|terminal\s*handling|터미널/i, 'local', false],
  ['CFS', 'CFS Charge', /(?<![a-z])cfs(?![a-z])/i, 'local', false],
  ['WFG', 'Wharfage (부두사용료)', /wharfage|(?<![a-z])wfg(?![a-z])|부두\s*(세|사용)/i, 'local', false],
  ['DO', 'D/O Charge (화물인도지시서)', /(?<![a-z])d\s*\/\s*o(?![a-z])|delivery\s*order/i, 'local', false],
  ['DOC', 'Document Fee (서류발급비)', /doc(ument)?s?\s*(fee|charge)|(?<![a-z])doc(?![a-z])|b\s*\/?\s*l\s*fee|awb\s*fee|서류\s*(비|발급)/i, 'local', false],
  ['HDL', 'Handling Charge', /handling\s*(charge|fee)|(?<![a-z])h\s*\/\s*c(?![a-z])|핸들링/i, 'local', true],
  ['CCC', 'Container Cleaning (청소비)', /clean(ing)?|(?<![a-z])ccc(?![a-z])|청소/i, 'local', false],
  ['PSC', 'Port Security Charge (보안료)', /port\s*secur|security\s*charge|(?<![a-z])psc(?![a-z])|보안료/i, 'local', false],
  ['PSM', 'Port Safety (항만안전)', /port\s*safety|(?<![a-z])psm(?![a-z])|항만\s*안전/i, 'local', false],
  ['SEAL', 'Seal Fee', /seal/i, 'local', false],
  ['AFS', 'AFS·AMS·ENS (적하목록 신고)', /(?<![a-z])(afs|ams|ens|aci|isf)(?![a-z])|manifest/i, 'local', false],
  ['LASH', 'Lashing·Securing (고박)', /lash|securing|고박|쇼링|shoring/i, 'local', true],
  ['TRK', 'Trucking (내륙운송)', /truck|내륙\s*운송|운송료|pick\s*up|픽업|drayage|delivery\s*charge/i, 'other', true],
  ['INS', 'Insurance (보험료)', /insurance|보험/i, 'other', false],
  ['CUS', 'Customs Clearance (통관수수료)', /customs\s*clearance|clearance\s*fee|통관\s*(수수료|비)|관세사/i, 'other', true],
  ['STO', 'Storage (보관료)', /storage|보관|창고료|장치료/i, 'other', true],
  ['DG', 'DG Charge (위험물)', /(?<![a-z])dg\s*(charge|fee)|위험물/i, 'other', false],
  ['FUM', 'Fumigation (훈증)', /fumigat|훈증/i, 'other', true],
  ['COO', 'C/O Fee (원산지증명)', /(?<![a-z])c\s*\/\s*o\s*(fee|charge)|원산지\s*증명/i, 'other', true],
  ['OTH', 'Other Charge (기타)', /other\s*charge|기타\s*(비용|charge)/i, 'other', false]
];
const QSEC = {freight:'운임', origin:'선적지 부대비용', dest:'도착지 부대비용', local:'부대비용', other:'기타 비용', bsgc:'BSGC 항목'};
const QCUR = [['USD', /us\s*\$|usd|\$/i], ['EUR', /eur|€/i], ['CNY', /cny|rmb/i], ['JPY', /jpy|¥/i], ['KRW', /₩|krw|\\|원/i]];
const QCOL_RE = /(20|40|45)\s*['’`]?\s*(GP|DC|DV|HC|HQ|RF|RH|FR|OT|FT)?(?![0-9])|L\.?C\.?L|R\s*\/\s*T|(?<![A-Z])CBM|[-+]\s*\d{2,4}\s*KG|MIN(?:IMUM)?(?![A-Z])/gi;
const QCUR_TOKEN = /(US\s*\$|USD|\$|₩|KRW|\\|EUR|€|CNY|RMB|JPY|¥)\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.\d+)?|[0-9]+(?:\.\d+)?)|([0-9]{1,3}(?:,[0-9]{3})+(?:\.\d+)?|[0-9]+\.\d{1,2}|[0-9]{2,})\s*(원|USD|KRW)?|(at\s*cost|실비|별도|포함|included|incl\.?|n\s*\/\s*a|free|-)(?![a-z])/gi;
const qN = s => Number(String(s || '').replace(/,/g, ''));
function qCur(tok, fallback){ const x = QCUR.find(([, re]) => re.test(tok || '')); return x ? x[0] : fallback; }
function qColName(t){
  const s = String(t).toUpperCase().replace(/[\s'’`.]/g, '');
  if(/LCL/.test(s)) return 'LCL';
  if(/R\/T|CBM/.test(s)) return 'R/T';
  if(/KG/.test(s)) return s.replace(/KG$/, 'KG');
  if(/^MIN/.test(s)) return 'MIN';
  const m = /^(20|40|45)(GP|DC|DV|HC|HQ|RF|RH|FR|OT|FT)?$/.exec(s);
  if(m){ const k = {DC:'GP', DV:'GP', FT:'GP', HC:'HQ', RH:'RF'}[m[2]] || m[2] || 'GP'; return m[1] + k; }
  return s;
}
/* 견적 원문 → {title, pol, pod, carrier, valid, term, mode, rate, cols[], lines[{key,name,sec,unit,vat,note,cur,amt{col:n},cost{col:'at'|'incl'}}]} */
const KR_PORT = /busan|pusan|incheon|inchon|pyeongtaek|pyongtaek|kwangyang|gwangyang|ulsan|icn|pus|korea|부산|인천|평택|광양|울산/i;
/* 부대비용이 어느 쪽인지: 도착항이 한국이면 수입(도착지), 선적항이 한국이면 수출(선적지), 모르면 조건으로 */
function qLocalSide(o){ if(KR_PORT.test(o.pod || '')) return 'dest'; if(KR_PORT.test(o.pol || '')) return 'origin'; return /FOB|EXW|FCA/.test(o.term) ? 'dest' : /CIF|CFR|CPT|CIP|DAP|DPU|DDP/.test(o.term) ? 'origin' : 'local'; }
function parseQuote(text){
  const raw = String(text || '').replace(/ /g, ' ').replace(/\r/g, '');
  const L = raw.split('\n').map(x => x.replace(/\t+/g, '  ').replace(/[ ]{2,}/g, '  ').trim());
  const out = {title:'', pol:'', pod:'', carrier:'', valid:'', term:'', mode:'', rate:null, cols:[], lines:[]};
  const g = re => { const m = re.exec(raw); return m ? m[1].trim().replace(/\s{2,}/g, ' ') : ''; };
  out.title = g(/(?:title|제\s*목)\s*[:：]\s*([^\n]{3,120})/i);
  out.pol = g(/(?:pol|port\s*of\s*loading|선적항|출발지)\s*[:：]\s*([^\n:：]{2,40}?)(?=\s{2,}|\s+(?:pod|port\s*of\s*dis|도착)|$|\n)/i);
  out.pod = g(/(?:pod|port\s*of\s*dis\w*|도착항|도착지)\s*[:：]\s*([^\n:：]{2,40}?)(?=\s{2,}|\s+(?:term|valid|carrier)|$|\n)/i);
  if(!out.pol && out.title){ const m = /([A-Z][A-Z .]{2,30}?)\s*(?:TO|->|→|-|~)\s*([A-Z][A-Z ,.]{2,40}?)(?=\s|$|[가-힣(])/.exec(out.title.toUpperCase()); if(m){ out.pol = m[1].trim(); out.pod = m[2].trim().replace(/,$/, ''); } }
  out.carrier = g(/(?:carrier|shipping\s*line|선\s*사|항공사)\s*[:：]\s*([^\n]{2,30}?)(?=\s{2,}|$|\n)/i);
  out.valid = g(/(?:valid(?:ity)?(?:\s*until)?|유효\s*기간|유효)\s*[:：]\s*([^\n]{4,30}?)(?=\s{2,}|$|\n)/i) || g(/(\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일)\s*(?:출항|선적)\s*분?\s*까지/);
  out.term = (/(?<![A-Z])(EXW|FCA|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP|DDU)(?![A-Z])/.exec(raw.toUpperCase()) || [])[1] || '';
  out.mode = /air\s*freight|항공|awb|\bkg\b/i.test(raw) && !/ocean|해상/i.test(raw) ? 'AIR' : /(?<![a-z])lcl(?![a-z])|cbm|r\s*\/\s*t/i.test(raw) ? 'LCL' : 'FCL';
  const rm = /@\s*([0-9]{1,2},?[0-9]{3}(?:\.\d+)?)/.exec(raw) || /(?:환율|exchange\s*rate|ex\.?\s*rate)\s*[:：]?\s*([0-9]{1,2},?[0-9]{3}(?:\.\d+)?)/i.exec(raw);
  if(rm) out.rate = qN(rm[1]);
  let cols = [], sec = 'local', rateTable = false, last = null;
  const curHint = (/currency\s*[:：]\s*([A-Z, ]+)/i.exec(raw) || [])[1] || '';
  L.forEach((ln, i) => {
    if(!ln) return;
    if(/도착지|destination|수입\s*부대|arrival\s*charge/i.test(ln) && !/[0-9]{3}/.test(ln)) sec = 'dest';
    else if(/선적지|origin|수출\s*부대|departure\s*charge/i.test(ln) && !/[0-9]{3}/.test(ln)) sec = 'origin';
    else if(/^\s*\d[.)]\s*.*(운임|freight)/i.test(ln) && !/[0-9]{3}/.test(ln)) sec = 'freight';
    const cm = ln.match(QCOL_RE);
    const isHead = cm && cm.length >= 1 && !/[0-9]{1,3},[0-9]{3}|\d+\.\d{2}/.test(ln) && (/(desc|item|항목|내역|charge|shipping|carrier|pol|구분|unit|단위|remark)/i.test(ln) || cm.length >= 2);
    if(isHead){ cols = [...new Set(cm.map(qColName))]; rateTable = /(shipping\s*line|carrier|pol|pod|선사)/i.test(ln); return; }
    if(/^(total|합계|소계|grand)/i.test(ln) || /^\d\)\s/.test(ln) || /total\s*(비용|cost|amount)|합\s*계/i.test(ln)) return;
    if(/^\s*(20|40|45)\s*['’`]?\s*[A-Z]{0,2}\s*[-:]\s*(₩|\\|krw|usd|\$)/i.test(ln)) return;                      // 합계 줄의 이어지는 줄
    if(/(?<![a-z])(tel|fax|mobile|contact|e-?mail|phone|attn|ref\.?\s*no)\s*[:：.]|전화|팩스|휴대|주\s*소\s*[:：]|(?<![a-z])(to|from|date)\s*[:：]/i.test(ln)) return;   // 머리글·연락처
    if(last && /약\s*[\\₩$0-9]|~|최소|minimum|필요\s*시|발생\s*시|청구합니다|청구\s*$|if\s*needed/i.test(ln)){ const ck = (QCHG.find(c => c[2].test(ln)) || [])[0]; if(!ck || ck === last.key){ last.note = [last.note, ln].filter(Boolean).join(' / ').slice(0, 120); return; } }
    const vat = /^\s*\*/.test(ln);
    const t = ln.replace(/^\s*\*\s*/, '');
    const chg = QCHG.find(c => c[2].test(t));
    const cells = []; let m, firstIdx = -1;
    QCUR_TOKEN.lastIndex = 0;
    while((m = QCUR_TOKEN.exec(t))){
      if(m[2] || m[3]){
        const numTxt = m[2] || m[3], after = t.slice(m.index + m[0].length, m.index + m[0].length + 3);
        if(!m[1] && !m[4] && (/^\s*['’`]?\s*(GP|DC|HQ|HC|FT|RF|FR|%|일|월|년|kg|cbm|피트)/i.test(after) || /^(19|20)\d{2}$/.test(numTxt) || (/^\d{2}$/.test(numTxt) && !/,/.test(numTxt)))) continue;
        if(!m[1] && !m[4] && !/[,.]/.test(numTxt) && qN(numTxt) < 100 && !cols.length) continue;
        if(firstIdx < 0) firstIdx = m.index;
        cells.push({v:qN(numTxt), cur:qCur(m[1] || m[4], '')});
      } else if(m[5]){
        const w = m[5].toLowerCase();
        if(w === '-' && !cells.length && !chg) continue;
        if(firstIdx < 0) firstIdx = m.index;
        cells.push({flag:/포함|incl/.test(w) ? 'incl' : /^-$|n\s*\/\s*a/.test(w) ? 'na' : /free/.test(w) ? 'free' : /별도/.test(w) ? 'sep' : 'at'});
      }
    }
    const unitM = /\/\s*(CNTR|CTNR|CONTAINER|B\s*\/?\s*L|SET|R\s*\/?\s*T|CBM|KG|SHPT|SHIPMENT|TRUCK|DAY|AWB|HBL|MBL|TON)/i.exec(t) || /(?:per|PER)\s+(CNTR|CTNR|CONTAINER|BL|B\/L|SET|RT|R\/T|CBM|KG|SHPT|TRUCK|TON)/.exec(t);
    const unit = unitM ? '/' + unitM[1].toUpperCase().replace(/\s/g, '').replace('CTNR', 'CNTR').replace('CONTAINER', 'CNTR').replace('B/L', 'BL').replace('RT', 'R/T') : '';
    if(!cells.length){
      if(last && (!chg || chg[0] === last.key.split('#')[0]) && /[가-힣]/.test(t) && t.length <= 60 && !last.note) last.note = t;          // 다음 줄의 한글 설명
      else if(last && !chg && unitM && !last.unit) last.unit = unit;
      return;
    }
    let key = chg ? chg[0] : '', name = chg ? chg[1] : '', group = chg ? chg[3] : sec;
    if(!chg){
      if(rateTable){ key = out.mode === 'AIR' ? 'AF' : 'OF'; const q = QCHG.find(c => c[0] === key); name = q[1]; group = 'freight'; const car = t.slice(0, firstIdx).trim().split(/\s+/)[0]; if(car && !out.carrier) out.carrier = car; }
      else { name = t.slice(0, firstIdx).replace(/[:：\-|]+$/, '').trim(); if(!/[a-z가-힣]{2}/i.test(name) || name.length > 60) return; key = 'X:' + name.toLowerCase(); }
    }
    if(group === 'local') group = sec === 'origin' || sec === 'dest' ? sec : qLocalSide(out);
    const ln2 = {key, name, sec:group, unit, star:vat, dictVat:chg ? chg[4] : false, vat:false, note:'', amt:{}, flag:{}, cur:''};
    const useCols = cols.length ? cols : ['AMT'];
    const nums = cells.filter(c => c.flag !== 'sep' || cells.length === 1);
    let idx = 0;
    if(nums.length === 1 && useCols.length > 1 && /\/(BL|SET|SHPT|AWB|HBL|MBL)/.test(unit)) useCols.forEach(c => put(c, nums[0]));
    else nums.slice(0, useCols.length).forEach(c => put(useCols[idx++], c));
    function put(col, c){ if(c.flag) ln2.flag[col] = c.flag; else { ln2.amt[col] = c.v; ln2.cur = ln2.cur || c.cur; } }
    if(!ln2.cur) ln2.cur = /usd/i.test(curHint) && !/krw/i.test(curHint) ? 'USD' : (group === 'freight' ? 'USD' : 'KRW');
    if(!cols.length && !out.cols.includes('AMT')) out.cols.push('AMT');
    useCols.forEach(c => { if(!out.cols.includes(c)) out.cols.push(c); });
    const remark = t.slice(firstIdx).replace(/(US\s*\$|USD|\$|₩|KRW|\\|EUR|€|CNY|RMB|JPY|¥)\s*[0-9][0-9,]*(\.\d+)?|[0-9]{1,3}(,[0-9]{3})+(\.\d+)?\s*(원)?|[0-9]+\.[0-9]{1,2}/gi, ' ').replace(/at\s*cost/gi, ' ').replace(/\/\s*[A-Z/ ]{2,10}/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if(remark && /[가-힣a-z]{2}/i.test(remark) && remark.length <= 50) ln2.note = remark;
    const prev = out.lines.find(o => o.key === ln2.key), has = x => Object.keys(x.amt).length > 0;
    if(prev){                                                                    // 같은 항목이 또 나오면: 금액 없는 쪽은 버리고, 둘 다 금액이면(예: 부산·광양 부두세) 뒤의 것을 대안으로 표시해 합계에서 뺌
      if(!has(prev) && has(ln2)){ out.lines.splice(out.lines.indexOf(prev), 1); if(last === prev) last = null; ln2.note = ln2.note || prev.note; }
      else if(has(ln2)){ ln2.key += '#' + out.lines.length; ln2.alt = true; ln2.name += ' (대안)'; }
      else { last = prev; return; }
    }
    out.lines.push(ln2); last = ln2;
  });
  // 같은 항목이 '실비'와 금액으로 두 번 나오면 금액 쪽만 남김(예: 운임표의 O/F와 부대비용표의 'Ocean Freight At Cost')
  out.lines = out.lines.filter(l => !(Object.keys(l.amt).length === 0 && out.lines.some(o => o !== l && o.key.split('#')[0] === l.key.split('#')[0] && Object.keys(o.amt).length)));
  out.cols = out.cols.filter(c => out.lines.some(l => c in l.amt || c in l.flag));
  const anyStar = out.lines.some(l => l.star);                                   // '*' 표시가 있으면 그 표시를, 없으면 항목 기본값(국내 용역)을 부가세 대상으로
  out.lines.forEach(l => { l.vat = anyStar ? l.star : l.dictVat; delete l.star; delete l.dictVat; });
  if(!out.cols.length) out.cols = ['AMT'];
  return out;
}

/* ---------- 데이터 ---------- */
function qset(){
  db.settings.quote = db.settings.quote || {};
  const s = db.settings.quote;
  if(s.markup == null) s.markup = 10;
  if(!s.rate) s.rate = 1450;
  if(!s.round) s.round = 10;
  s.fwd = s.fwd || {};
  s.company = s.company || {name:'BSGC Customs Networks', addr:'', tel:'', fax:'', email:'', person:''};
  if(s.notes == null) s.notes = '1) 상기 운임은 유효기간 내 선적분 기준이며, 선사 사정에 따라 변동될 수 있습니다.\n2) * 표시 항목은 부가세 10% 대상입니다.\n3) 관세·부가세, 세관 검사비, 보관료 등은 실비로 청구합니다.';
  db.quotes = db.quotes || []; db.quoteJobs = db.quoteJobs || [];
  return s;
}
const qDomain = a => (String(a || '').toLowerCase().match(/@([a-z0-9.-]+)/) || [, ''])[1];
function fwdLabel(q){
  const s = qset(), d = qDomain(q.from);
  if(d && s.fwd[d]) return s.fwd[d];
  if(q.manual) return q.fwdName || '직접 올림';
  const base = d ? d.split('.')[0] : '';
  return base ? base.toUpperCase() : (q.fromName || '포워더');
}
function qGroupKey(subj){
  return String(subj || '').replace(/\[(re|fw|fwd)\]/gi, ' ').replace(/(^|\s|\])(re|fw|fwd|답장|회신|전달)\s*[:：]/gi, ' ').replace(/\[[^\]]{0,24}\]/g, ' ')
    .replace(/\/\s*bsgc[^/]*$/i, ' ').replace(/확인\s*요청|급\s|긴급|件|\(?\s*수정\s*\)?/g, ' ').replace(/[^0-9a-z가-힣]+/gi, ' ').trim().toLowerCase().slice(0, 80) || '기타';
}
function qGroupTitle(subj){ return String(subj || '').replace(/^\s*((\[(re|fw|fwd)\]|re|fw|fwd)\s*[:：]?\s*)+/gi, '').replace(/^\s*(\[[^\]]{0,24}\]\s*)+/, '').replace(/\/\s*bsgc[^/]*$/i, '').trim() || '견적'; }
function addQuotes(items){
  qset();
  let n = 0;
  (items || []).forEach(x => {
    if(!x || !x.key || db.quotes.some(q => q.key === x.key)) return;
    const q = {id:uid(), key:x.key, mailId:x.mailId || '', date:x.date || String(x.at || '').slice(0, 16), at:x.at || '', from:x.from || '', fromName:x.fromName || '', subject:x.subject || '', name:x.name || '', link:x.link || '', text:String(x.text || '').slice(0, 12000), err:x.err || '', manual:!!x.manual, grp:qGroupKey(x.subject || x.name)};
    q.p = parseQuote(q.text);
    db.quotes.push(q); n++;
  });
  db.quotes = db.quotes.slice(-300);
  return n;
}
let quoteLoading = false, quoteLoadedAt = 0, quoteErr = '';
async function loadQuotes(manual){
  const cfg = db.settings.mail || {};
  if(!cfg.endpoint || !cfg.token){ if(manual) toast('먼저 데이터 메뉴에서 Apps Script 웹 앱 주소와 토큰을 넣어 주세요.'); return; }
  const s = qset();
  quoteLoading = true; quoteErr = ''; if(route.name === 'quote') renderView();
  try{
    const j = await syncGet(cfg, {quotes:1, since:manual ? '' : (s.lastAt || '')});
    const n = addQuotes(j.items || []);
    const at = (j.items || []).map(x => x.at || '').sort().slice(-1)[0];
    if(at && at > (s.lastAt || '')) s.lastAt = at;
    quoteLoadedAt = Date.now();
    if(n) commit();
    if(manual) toast(n ? `새 견적 ${n}건을 불러왔습니다.` : '새로 받은 견적이 없습니다.');
  }catch(e){ quoteErr = `견적을 불러오지 못했습니다 (${e.message}). Apps Script를 새 버전으로 배포했는지 확인하세요.`; if(manual) toast(quoteErr); }
  quoteLoading = false; if(route.name === 'quote') renderView();
}
/* 끌어놓은 파일 → Apps Script(op quote)로 보내 Drive에 저장하고 글자를 받음 */
async function uploadQuoteFiles(files, subject){
  const cfg = db.settings.mail || {};
  if(!cfg.endpoint || !cfg.token){ toast('먼저 데이터 메뉴에서 Apps Script 웹 앱 주소와 토큰을 넣어 주세요.'); return; }
  const list = [...files].filter(f => /\.(pdf|xlsx?|xlsm|csv|png|jpe?g)$/i.test(f.name) && f.size <= 10 * 1024 * 1024);
  if(!list.length){ toast('PDF·엑셀·이미지 파일(10MB 이하)만 올릴 수 있습니다.'); return; }
  toast(`견적 파일 ${list.length}개를 올리고 글자를 읽는 중입니다… (파일당 10~30초)`);
  const b64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(f); });
  try{
    const fs = [];
    for(const f of list) fs.push({name:f.name, mime:f.type || 'application/octet-stream', b64:await b64(f)});
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 180000);
    const r = await fetch(cfg.endpoint, {method:'POST', body:JSON.stringify({token:cfg.token, op:'quote', mail:{id:'manual:' + uid(), date:nowIso().slice(0, 16), from:'', fromName:me ? me.name : '', subject:subject || list[0].name, manual:true}, files:fs}), signal:ac.signal});
    clearTimeout(tm);
    const j = await r.json();
    if(!j.ok) throw new Error(j.error || '응답 오류');
    const n = addQuotes(j.items || []);
    commit();
    toast(n ? `견적 ${n}건을 추가했습니다. 추출 결과를 확인하세요.` : '이미 올린 파일입니다.');
  }catch(e){ toast('올리지 못했습니다: ' + (e.name === 'AbortError' ? '시간 초과' : e.message)); }
}
function pasteQuote(text, subject, fwdName){
  if(!String(text || '').trim()){ toast('견적 내용을 붙여 넣으세요.'); return; }
  qset();
  const q = {id:uid(), key:'paste:' + uid(), date:nowIso().slice(0, 16), at:nowIso(), from:'', fromName:'', fwdName:fwdName || '', subject:subject || '붙여넣은 견적', name:'(붙여넣기)', link:'', text:String(text).slice(0, 12000), manual:true, grp:qGroupKey(subject || '붙여넣은 견적')};
  q.p = parseQuote(q.text);
  db.quotes.push(q); commit();
  toast(`항목 ${q.p.lines.length}개를 추출했습니다.`);
}

/* ---------- 계산 ---------- */
function toKrw(v, cur, rate){ if(v == null || isNaN(v)) return null; return cur === 'KRW' ? v : v * (rate || 0); }
function qRound(v, cur){ const s = qset(); if(v == null) return null; return cur === 'KRW' ? Math.ceil(v / (s.round || 1)) * (s.round || 1) : Math.round(v * 100) / 100; }
function qTotal(q, col, rate){
  let krw = 0, at = 0;
  (q.p.lines || []).filter(l => !l.alt).forEach(l => { const v = l.amt[col] ?? l.amt.AMT; if(v != null) krw += toKrw(v, l.cur, rate); else if((l.flag[col] || l.flag.AMT) === 'at') at++; });
  return {krw:Math.round(krw), at};
}
function jobLinePrice(j, l){
  if(l.price != null && l.price !== '') return Number(l.price);
  if(l.cost == null || l.cost === '') return null;
  const pct = l.addPct != null && l.addPct !== '' ? Number(l.addPct) : (l.src === 'fwd' ? Number(j.markup || 0) : 0);
  return qRound(Number(l.cost) * (1 + pct / 100) + Number(l.addAmt || 0), l.cur);
}
function jobTotals(j){
  const by = {}, rate = Number(j.rate || 0);
  let krw = 0, vatBase = 0, cost = 0;
  j.lines.filter(l => l.show !== false).forEach(l => {
    const p = jobLinePrice(j, l); if(p == null) return;
    const amt = p * Number(l.qty || 1);
    by[l.cur] = (by[l.cur] || 0) + amt;
    const k = toKrw(amt, l.cur, rate); krw += k; if(l.vat) vatBase += k;
    if(l.cost != null && l.cost !== '') cost += toKrw(Number(l.cost) * Number(l.qty || 1), l.cur, rate);
  });
  const vat = Math.round(vatBase * 0.1);
  return {by, krw:Math.round(krw), vat, grand:Math.round(krw) + vat, cost:Math.round(cost), margin:Math.round(krw - cost)};
}
const qfmt = (v, cur) => v == null || v === '' || isNaN(v) ? '' : (cur === 'KRW' ? Math.round(v).toLocaleString('ko-KR') : Number(v).toLocaleString('en-US', {minimumFractionDigits:Number(v) % 1 ? 2 : 0, maximumFractionDigits:2}));
const qcell = (l, col) => { const v = l.amt[col] ?? (col !== 'AMT' ? l.amt.AMT : undefined); if(v != null) return `${l.cur === 'KRW' ? '₩' : l.cur + ' '}${qfmt(v, l.cur)}`; const f = l.flag[col] || l.flag.AMT; return f ? {at:'실비', incl:'포함', na:'-', free:'무료', sep:'별도'}[f] : ''; };

/* ---------- 화면: 목록·비교 ---------- */
let qCol = {}, qOpenText = new Set();
function viewQuote(){
  const s = qset();
  if(route.id){ const j = db.quoteJobs.find(x => x.id === route.id); if(j) return viewQuoteJob(j); }
  if(!quoteLoadedAt && !quoteLoading) setTimeout(() => loadQuotes(false), 50);
  const groups = new Map();
  db.quotes.filter(q => !q.off).forEach(q => { if(!groups.has(q.grp)) groups.set(q.grp, []); groups.get(q.grp).push(q); });
  const gl = [...groups.entries()].map(([k, qs]) => ({k, qs:qs.sort((a, b) => a.date < b.date ? -1 : 1), last:qs.map(q => q.date).sort().slice(-1)[0] || ''})).sort((a, b) => a.last < b.last ? 1 : -1);
  const jobs = db.quoteJobs.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const grpOpts = gl.map(g => `<option value="${esc(g.k)}">${esc(qGroupTitle(g.qs[0].subject).slice(0, 50))}</option>`).join('');
  return `<header class="client-head"><div><h2>운임 견적</h2><p class="client-meta">포워더가 보낸 견적(메일 첨부는 자동, 그 밖은 끌어놓기·붙여넣기)을 요청 건별로 비교하고, 고른 견적으로 고객 견적서를 만듭니다. 고객 견적서에는 포워더 이름·원가가 나오지 않습니다.</p></div>
      <div class="client-act"><button class="primary" data-q-load${quoteLoading ? ' disabled' : ''}>${quoteLoading ? '불러오는 중…' : '새 견적 불러오기'}</button><button class="ghost" data-q-newjob>빈 견적서 만들기</button></div></header>
    ${quoteErr ? `<p class="msg">${esc(quoteErr)}</p>` : ''}
    <div class="q-drop" id="qDrop" tabindex="0">견적 PDF·엑셀을 여기에 끌어놓거나 <label class="linkish">파일 고르기<input type="file" id="qFile" multiple accept=".pdf,.xls,.xlsx,.xlsm,.csv,.png,.jpg,.jpeg" hidden></label> · 요청 건 이름 <input id="qDropSubj" placeholder="예: FOB 상해-인천 LCL 견적" style="max-width:280px"></div>
    <details class="more fold"><summary>메일 본문 견적 붙여넣기</summary>
      <div class="q-paste"><input id="qPasteSubj" placeholder="요청 건 이름 (같은 이름끼리 비교)"><input id="qPasteFwd" placeholder="포워더 이름 (내부용)" style="max-width:180px"><textarea id="qPasteText" rows="6" placeholder="포워더 메일의 운임 부분을 그대로 붙여 넣으세요"></textarea><button class="mini strong" data-q-paste>추출</button></div></details>
    <section class="items"><div class="sec-head"><h3>견적 요청 <span class="cnt">${gl.length}건</span></h3></div>
      ${gl.length ? gl.map(g => qGroupHTML(g, grpOpts)).join('') : '<p class="empty">아직 받은 견적이 없습니다. 포워더 회신 메일의 견적 첨부는 사무실 PC 수집기가 15분마다 자동으로 가져옵니다(지난 견적은 수집기 <code>--quotes 날짜</code>).</p>'}
    </section>
    <section class="items"><div class="sec-head"><h3>고객 견적서 <span class="cnt">${jobs.length}건</span></h3></div>
      ${jobs.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>번호</th><th>제목</th><th>수신</th><th>일자</th><th class="num">합계(원)</th><th>상태</th><th></th></tr></thead><tbody>${jobs.map(j => { const t = jobTotals(j); return `<tr><td>${esc(j.no)}</td><td>${esc(j.title)}</td><td>${esc(j.to || clientName(j.clientId) || '')}</td><td>${esc(j.date)}</td><td class="num">${t.grand.toLocaleString('ko-KR')}</td><td>${esc(j.status || '작성 중')}</td><td><button class="mini" data-q-openjob="${esc(j.id)}">열기</button></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="empty">견적 비교표에서 ‘이 견적으로 작성’을 누르면 만들어집니다.</p>'}
    </section>
    <details class="more fold"><summary>견적 기본 설정 (가산율·환율·발신 정보·포워더 이름)</summary>${qSettingsHTML()}</details>`;
}
function qGroupHTML(g, grpOpts){
  const qs = g.qs, cols = [...new Set(qs.flatMap(q => q.p.cols))];
  const col = qCol[g.k] && cols.includes(qCol[g.k]) ? qCol[g.k] : cols[0];
  const rate = qset().rate;
  const keys = []; qs.forEach(q => q.p.lines.forEach(l => { if(!keys.some(k => k.key === l.key)) keys.push({key:l.key, name:l.name, sec:l.sec}); }));
  const order = ['freight', 'origin', 'local', 'dest', 'other'];
  keys.sort((a, b) => order.indexOf(a.sec) - order.indexOf(b.sec));
  const totals = qs.map(q => qTotal(q, col, q.p.rate || rate));
  const best = Math.min(...totals.filter(t => t.krw > 0).map(t => t.krw));
  const cl = typeof findClient === 'function' ? findClient(qs.map(q => q.subject).join(' ')) : null;
  return `<article class="q-grp">
    <div class="q-grp-h"><div><strong>${esc(qGroupTitle(qs[0].subject))}</strong> ${cl ? `<span class="tag">${esc(cl.name)}</span>` : ''}<span class="hint"> · 견적 ${qs.length}건 · ${esc(String(g.last).slice(0, 10))}</span></div>
      <div><label class="inline">비교 기준 <select data-q-col="${esc(g.k)}">${cols.map(x => `<option${x === col ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label> <button class="mini" data-q-cmpx="${esc(g.k)}" title="내부용 비교표(포워더 이름 포함)">비교표 엑셀</button></div></div>
    <div class="table-wrap"><table class="grid q-cmp"><thead><tr><th>항목</th>${qs.map(q => `<th>${esc(fwdLabel(q))}<div class="hint">${esc(String(q.date).slice(5, 10))} ${q.link ? `<a href="${esc(q.link)}" target="_blank" rel="noopener noreferrer">원문</a>` : ''}</div></th>`).join('')}</tr></thead><tbody>
      ${keys.map(k => `<tr><td>${esc(k.name)}<div class="hint">${esc(QSEC[k.sec] || '')}</div></td>${qs.map(q => { const l = q.p.lines.find(x => x.key === k.key); return `<td class="num">${l ? esc(qcell(l, col)) : ''}${l && l.unit ? `<div class="hint">${esc(l.unit)}</div>` : ''}</td>`; }).join('')}</tr>`).join('')}
      <tr class="q-tot"><td>합계 (원 환산${qs.some(q => q.p.rate) ? '' : ` @${rate.toLocaleString()}`})</td>${totals.map(t => `<td class="num${t.krw && t.krw === best && qs.length > 1 ? ' q-best' : ''}">${t.krw ? '₩' + t.krw.toLocaleString('ko-KR') : '-'}${t.at ? `<div class="hint">실비 ${t.at}항목 별도</div>` : ''}</td>`).join('')}</tr>
      <tr><td></td>${qs.map(q => `<td><button class="mini strong" data-q-make="${esc(q.id)}|${esc(col)}">이 견적으로 작성</button><details class="more"><summary>원문·설정</summary>
        <div class="hint">${esc(q.name)}${q.err ? ` · 읽기 오류: ${esc(q.err)}` : ''}${q.p.pol ? ` · ${esc(q.p.pol)} → ${esc(q.p.pod)}` : ''}${q.p.term ? ' · ' + esc(q.p.term) : ''}${q.p.valid ? ' · 유효 ' + esc(q.p.valid) : ''}${q.p.carrier ? ' · ' + esc(q.p.carrier) : ''}</div>
        <label class="inline">묶음 <select data-q-grp="${esc(q.id)}">${grpOpts.replace(`value="${esc(q.grp)}"`, `value="${esc(q.grp)}" selected`)}<option value="__new">새 요청 건으로 분리</option></select></label>
        <button class="mini" data-q-off="${esc(q.id)}">목록에서 빼기</button>
        <pre class="q-raw">${esc(String(q.text || '(글자 없음)').slice(0, 4000))}</pre></details></td>`).join('')}</tr>
    </tbody></table></div>
  </article>`;
}
function qSettingsHTML(){
  const s = qset(), c = s.company;
  const doms = [...new Set(db.quotes.map(q => qDomain(q.from)).filter(Boolean))];
  return `<div class="q-set">
    <label>기본 가산율(포워더 항목, %) <input type="number" step="0.5" data-q-set="markup" value="${esc(s.markup)}"></label>
    <label>환율(USD→원) <input type="number" step="0.01" data-q-set="rate" value="${esc(s.rate)}"></label>
    <label>원화 올림 단위 <input type="number" step="1" data-q-set="round" value="${esc(s.round)}"></label>
    <label>발신 회사명 <input data-q-co="name" value="${esc(c.name)}"></label><label>주소 <input data-q-co="addr" value="${esc(c.addr)}"></label>
    <label>전화 <input data-q-co="tel" value="${esc(c.tel)}"></label><label>팩스 <input data-q-co="fax" value="${esc(c.fax)}"></label><label>메일 <input data-q-co="email" value="${esc(c.email)}"></label><label>담당 <input data-q-co="person" value="${esc(c.person)}"></label>
    <label class="wide">기본 비고 <textarea data-q-set="notes" rows="3">${esc(s.notes)}</textarea></label>
    ${doms.length ? `<p class="hint wide">포워더 이름(내부 비교표용): ${doms.map(d => `<label class="inline">${esc(d)} <input data-q-fwd="${esc(d)}" value="${esc(s.fwd[d] || '')}" placeholder="${esc(d.split('.')[0].toUpperCase())}" style="width:110px"></label>`).join(' ')}</p>` : ''}
  </div>`;
}

/* ---------- 고객 견적서 ---------- */
function newJobNo(){ const d = today().replace(/-/g, ''); const n = db.quoteJobs.filter(j => String(j.no || '').startsWith('Q' + d)).length + 1; return `Q${d}-${String(n).padStart(2, '0')}`; }
function makeJob(q, col){
  const s = qset();
  const cl = q ? findClient(q.subject + ' ' + (q.text || '').slice(0, 300)) : null;
  const j = {id:uid(), no:newJobNo(), srcId:q ? q.id : '', grp:q ? q.grp : '', clientId:cl ? cl.id : '', to:cl ? cl.name : '', attn:'', title:q ? (q.p.title || qGroupTitle(q.subject)) : '운임 견적', date:today(), valid:q ? q.p.valid : '',
    pol:q ? q.p.pol : '', pod:q ? q.p.pod : '', term:q ? q.p.term : '', cargo:'', mode:q ? q.p.mode : 'FCL', col:col || '', carrier:q ? q.p.carrier : '', rate:(q && q.p.rate) || s.rate, markup:s.markup, notes:s.notes, status:'작성 중', lines:[], createdAt:nowIso(), updatedAt:nowIso()};
  if(q) q.p.lines.forEach(l => {
    const v = l.amt[col] ?? l.amt.AMT, f = l.flag[col] || l.flag.AMT;
    if(v == null && !f) return;
    if(l.key === 'CUS') return;                                               // 통관수수료는 BSGC 항목으로 따로 넣음
    j.lines.push({id:uid(), sec:l.sec === 'local' ? 'dest' : l.sec, name:l.name, unit:l.unit || (/\d/.test(col) ? '/CNTR' : ''), qty:1, cur:l.cur, cost:v ?? null, flag:v == null ? f : '', addPct:'', addAmt:0, price:'', vat:!!l.vat, note:l.note || '', src:'fwd', show:f !== 'na' && !l.alt});
  });
  j.lines.push({id:uid(), sec:'bsgc', name:'통관수수료 (Customs Clearance)', unit:'/BL', qty:1, cur:'KRW', cost:null, addPct:'', addAmt:0, price:'', vat:true, note:'', src:'bsgc', show:true});
  db.quoteJobs.push(j);
  return j;
}
const BSGC_ADD = {cus:['통관수수료 (Customs Clearance)', '/BL', true], trk:['내륙운송 (Trucking)', '/CNTR', true], ins:['적하보험료 (Insurance)', '/BL', false], ins2:['검사·검역 대행', '/BL', true], etc:['기타', '', true]};
function viewQuoteJob(j){
  const t = jobTotals(j), secs = ['freight', 'origin', 'dest', 'other', 'bsgc'];
  const ln = l => { const p = jobLinePrice(j, l); return `<tr class="${l.show === false ? 'q-hide' : ''}">
      <td><input type="checkbox" data-qj="${esc(l.id)}|show"${l.show !== false ? ' checked' : ''} title="견적서에 넣기"></td>
      <td><input data-qj="${esc(l.id)}|name" value="${esc(l.name)}"><input class="q-note" data-qj="${esc(l.id)}|note" value="${esc(l.note || '')}" placeholder="비고"></td>
      <td><input data-qj="${esc(l.id)}|unit" value="${esc(l.unit || '')}" style="width:64px"></td>
      <td><input type="number" step="0.01" data-qj="${esc(l.id)}|qty" value="${esc(l.qty)}" style="width:56px"></td>
      <td><select data-qj="${esc(l.id)}|cur">${['KRW', 'USD', 'EUR', 'CNY', 'JPY'].map(c => `<option${c === l.cur ? ' selected' : ''}>${c}</option>`).join('')}</select></td>
      <td class="num q-int"><input type="number" step="0.01" data-qj="${esc(l.id)}|cost" value="${esc(l.cost ?? '')}" placeholder="${l.flag === 'at' ? '실비' : ''}" style="width:96px"></td>
      <td class="q-int"><input type="number" step="0.5" data-qj="${esc(l.id)}|addPct" value="${esc(l.addPct)}" placeholder="${l.src === 'fwd' ? esc(j.markup) : '0'}" style="width:56px">%<input type="number" step="1" data-qj="${esc(l.id)}|addAmt" value="${esc(l.addAmt || '')}" placeholder="+금액" style="width:80px"></td>
      <td class="num"><input type="number" step="0.01" data-qj="${esc(l.id)}|price" value="${esc(l.price)}" placeholder="${p == null ? (l.flag === 'at' ? '실비' : '') : esc(p)}" style="width:100px"></td>
      <td><input type="checkbox" data-qj="${esc(l.id)}|vat"${l.vat ? ' checked' : ''} title="부가세 10% 대상"></td>
      <td><button class="mini" data-qj-del="${esc(l.id)}" title="줄 지우기">×</button></td></tr>`; };
  const clOpts = sortedClients().map(c => `<option value="${esc(c.id)}"${c.id === j.clientId ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  return `<header class="client-head"><div><h2>고객 견적서 ${esc(j.no)}</h2><p class="client-meta">회색 칸(원가·가산)은 내부용이며 인쇄·엑셀에 나오지 않습니다. 판매가를 직접 넣으면 가산 계산보다 우선합니다.</p></div>
      <div class="client-act"><button class="ghost" data-q-back>목록</button><button class="primary" data-q-print="${esc(j.id)}">BSGC 양식 인쇄(PDF)</button><button class="ghost" data-q-xlsx="${esc(j.id)}">엑셀 저장</button><button class="ghost" data-q-copy="${esc(j.id)}">메일용 표 복사</button><button class="ghost" data-q-deljob="${esc(j.id)}">삭제</button></div></header>
    <div class="q-form">
      <label>업체 <select data-qf="clientId"><option value="">(직접 입력)</option>${clOpts}</select></label>
      <label>수신 <input data-qf="to" value="${esc(j.to)}"></label><label>참조(담당) <input data-qf="attn" value="${esc(j.attn)}"></label>
      <label class="wide">제목 <input data-qf="title" value="${esc(j.title)}"></label>
      <label>견적일 <input type="date" data-qf="date" value="${esc(j.date)}"></label><label>유효기간 <input data-qf="valid" value="${esc(j.valid)}"></label>
      <label>선적항(POL) <input data-qf="pol" value="${esc(j.pol)}"></label><label>도착항(POD) <input data-qf="pod" value="${esc(j.pod)}"></label>
      <label>조건 <input data-qf="term" value="${esc(j.term)}" placeholder="FOB·CIF·DDP"></label><label>운송 <input data-qf="mode" value="${esc(j.mode)}" placeholder="FCL·LCL·AIR"></label>
      <label>컨테이너·단위 <input data-qf="col" value="${esc(j.col)}"></label><label>품명 <input data-qf="cargo" value="${esc(j.cargo)}"></label>
      <label>선사(견적서 표시) <input data-qf="carrier" value="${esc(j.carrier)}"></label>
      <label class="q-int">기본 가산율 % <input type="number" step="0.5" data-qf="markup" value="${esc(j.markup)}"></label><label>환율 USD <input type="number" step="0.01" data-qf="rate" value="${esc(j.rate)}"></label>
      <label>상태 <select data-qf="status">${['작성 중', '발송', '수주', '실주'].map(x => `<option${x === (j.status || '작성 중') ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
    </div>
    <div class="table-wrap"><table class="grid q-edit"><thead><tr><th></th><th>항목 / 비고</th><th>단위</th><th>수량</th><th>통화</th><th class="q-int">원가</th><th class="q-int">가산</th><th>판매 단가</th><th>VAT</th><th></th></tr></thead>
      ${secs.map(sc => { const ls = j.lines.filter(l => (l.sec || 'other') === sc); return ls.length ? `<tbody><tr class="q-sec"><td colspan="10">${esc(QSEC[sc])}</td></tr>${ls.map(ln).join('')}</tbody>` : ''; }).join('')}
    </table></div>
    <p class="q-addrow">줄 추가: ${Object.entries(BSGC_ADD).map(([k, v]) => `<button class="mini" data-qj-add="${k}">${esc(v[0].replace(/\s*\(.*\)/, ''))}</button>`).join('')}<button class="mini" data-qj-add="fwd">운임·부대비 줄</button></p>
    <div class="q-totals">${Object.entries(t.by).map(([c, v]) => `<span>${esc(c)} ${esc(qfmt(v, c))}</span>`).join('')}<span>원화 환산 ₩${t.krw.toLocaleString('ko-KR')}</span><span>부가세 ₩${t.vat.toLocaleString('ko-KR')}</span><strong>합계 ₩${t.grand.toLocaleString('ko-KR')}</strong><span class="q-int">원가 ₩${t.cost.toLocaleString('ko-KR')} · 차익 ₩${t.margin.toLocaleString('ko-KR')}</span></div>
    <label class="wide">비고 (견적서 하단) <textarea data-qf="notes" rows="4">${esc(j.notes)}</textarea></label>`;
}
function jobRows(j){
  const rows = [], secs = ['freight', 'origin', 'dest', 'other', 'bsgc'];
  secs.forEach(sc => j.lines.filter(l => (l.sec || 'other') === sc && l.show !== false).forEach(l => {
    const p = jobLinePrice(j, l);
    rows.push({sec:QSEC[sc] === 'BSGC 항목' ? '통관·기타' : QSEC[sc], name:l.name, unit:l.unit || '', qty:Number(l.qty || 1), cur:l.cur, price:p, amt:p == null ? null : p * Number(l.qty || 1), vat:l.vat, note:l.note || '', flag:p == null && l.flag === 'at' ? '실비' : ''});
  }));
  return rows;
}
function quotePrint(j){
  const s = qset(), c = s.company, t = jobTotals(j), rows = jobRows(j);
  const w = window.open('', '_blank'); if(!w){ toast('팝업이 막혀 있습니다. 이 사이트의 팝업을 허용하세요.'); return; }
  const base = location.href.replace(/[^/]*$/, '');
  const tr = rows.map((r, i) => `<tr><td class="c">${i + 1}</td><td>${esc(r.sec)}</td><td>${r.vat ? '* ' : ''}${esc(r.name)}</td><td class="c">${esc(r.unit)}</td><td class="c">${esc(r.qty)}</td><td class="c">${esc(r.cur)}</td><td class="n">${r.flag || esc(qfmt(r.price, r.cur))}</td><td class="n">${r.flag || esc(qfmt(r.amt, r.cur))}</td><td>${esc(r.note)}</td></tr>`).join('');
  const info = [['선적항', j.pol], ['도착항', j.pod], ['조건', j.term], ['운송', [j.mode, j.col].filter(Boolean).join(' / ')], ['품명', j.cargo], ['선사', j.carrier], ['유효기간', j.valid]].filter(x => x[1]);
  w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><base href="${esc(base)}"><title>${esc(j.no)} 견적서</title><style>
    @page{size:A4;margin:14mm} body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#111;font-size:11.5px;margin:0}
    .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1E4E79;padding-bottom:8px} .top img{height:46px} h1{font-size:24px;letter-spacing:12px;margin:6px 0 0;color:#1E4E79}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0} .box{border:1px solid #bbb;padding:8px 10px;line-height:1.7} .box b{display:inline-block;width:64px;color:#444}
    table{width:100%;border-collapse:collapse;margin-top:8px} th,td{border:1px solid #999;padding:5px 6px;vertical-align:top} th{background:#E8EEF4} .c{text-align:center} .n{text-align:right;white-space:nowrap}
    .info td:nth-child(odd){background:#F3F6F9;width:12%;font-weight:600} .sum{margin-top:10px;display:flex;justify-content:flex-end} .sum table{width:auto} .sum td{padding:5px 12px} .grand td{font-weight:700;font-size:13px;background:#E8EEF4}
    .notes{margin-top:14px;white-space:pre-wrap;line-height:1.7;border-top:1px solid #ccc;padding-top:8px} .foot{margin-top:24px;text-align:right;line-height:1.7}
    @media print{.noprint{display:none}}</style></head><body>
    <div class="noprint" style="padding:8px;background:#FFF8E1;font-size:12px">인쇄 창에서 ‘PDF로 저장’을 고르면 PDF로 저장됩니다. <button onclick="print()">인쇄</button></div>
    <div class="top"><div><img src="logo.png" alt="" onerror="this.remove()"><h1>견 적 서</h1><div style="color:#555">QUOTATION</div></div><div style="text-align:right;line-height:1.7"><div>견적번호 <b>${esc(j.no)}</b></div><div>견적일 ${esc(j.date)}</div></div></div>
    <div class="meta"><div class="box"><div><b>수 신</b>${esc(j.to || clientName(j.clientId) || '')} 귀중</div>${j.attn ? `<div><b>참 조</b>${esc(j.attn)}</div>` : ''}<div><b>제 목</b>${esc(j.title)}</div></div>
      <div class="box"><div><b>발 신</b>${esc(c.name)}</div>${c.addr ? `<div><b>주 소</b>${esc(c.addr)}</div>` : ''}${c.tel || c.fax ? `<div><b>연락처</b>${esc([c.tel && 'T. ' + c.tel, c.fax && 'F. ' + c.fax].filter(Boolean).join('  '))}</div>` : ''}${c.email ? `<div><b>메 일</b>${esc(c.email)}</div>` : ''}${c.person ? `<div><b>담 당</b>${esc(c.person)}</div>` : ''}</div></div>
    ${info.length ? `<table class="info"><tbody>${info.reduce((a, x, i) => a + (i % 3 === 0 ? '<tr>' : '') + `<td>${esc(x[0])}</td><td>${esc(x[1])}</td>` + (i % 3 === 2 || i === info.length - 1 ? '</tr>' : ''), '')}</tbody></table>` : ''}
    <table><thead><tr><th>No</th><th>구분</th><th>항목</th><th>단위</th><th>수량</th><th>통화</th><th>단가</th><th>금액</th><th>비고</th></tr></thead><tbody>${tr}</tbody></table>
    <div class="sum"><table><tbody>${Object.entries(t.by).map(([cu, v]) => `<tr><td>소계 (${esc(cu)})</td><td class="n">${esc(qfmt(v, cu))}</td></tr>`).join('')}
      ${Object.keys(t.by).some(x => x !== 'KRW') ? `<tr><td>원화 환산 (USD @${Number(j.rate).toLocaleString()})</td><td class="n">₩${t.krw.toLocaleString('ko-KR')}</td></tr>` : ''}<tr><td>부가세 (* 항목 10%)</td><td class="n">₩${t.vat.toLocaleString('ko-KR')}</td></tr><tr class="grand"><td>합계</td><td class="n">₩${t.grand.toLocaleString('ko-KR')}</td></tr></tbody></table></div>
    ${j.notes ? `<div class="notes">${esc(j.notes)}</div>` : ''}
    <div class="foot">${esc(c.name)} (인)</div>
    <script>window.onload=()=>setTimeout(()=>print(),400)<\/script></body></html>`);
  w.document.close();
}
function loadScriptOnce(src){ return new Promise((res, rej) => { if(document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('라이브러리를 받지 못했습니다')); document.head.appendChild(s); }); }
const XLSX_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
async function quoteXlsx(j){
  try{ await loadScriptOnce(XLSX_SRC); }catch(e){ toast(e.message); return; }
  const s = qset(), c = s.company, t = jobTotals(j), rows = jobRows(j);
  const aoa = [['견 적 서 (QUOTATION)'], [], ['견적번호', j.no, '', '견적일', j.date], ['수신', (j.to || clientName(j.clientId) || '') + ' 귀중', '', '발신', c.name], ['참조', j.attn || '', '', '연락처', [c.tel, c.email].filter(Boolean).join(' / ')], ['제목', j.title],
    ['선적항', j.pol || '', '', '도착항', j.pod || ''], ['조건', j.term || '', '', '운송', [j.mode, j.col].filter(Boolean).join(' / ')], ['품명', j.cargo || '', '', '유효기간', j.valid || ''], [],
    ['No', '구분', '항목', '단위', '수량', '통화', '단가', '금액', 'VAT', '비고']];
  rows.forEach((r, i) => aoa.push([i + 1, r.sec, r.name, r.unit, r.qty, r.cur, r.flag || r.price, r.flag || r.amt, r.vat ? '10%' : '', r.note]));
  aoa.push([]);
  Object.entries(t.by).forEach(([cu, v]) => aoa.push(['', '', '', '', '', '', `소계 (${cu})`, Math.round(v * 100) / 100]));
  if(Object.keys(t.by).some(x => x !== 'KRW')) aoa.push(['', '', '', '', '', '', `원화 환산 (@${j.rate})`, t.krw]);
  aoa.push(['', '', '', '', '', '', '부가세', t.vat], ['', '', '', '', '', '', '합계(원)', t.grand], [], ['비고'], ...String(j.notes || '').split('\n').map(x => [x]));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{wch:6}, {wch:14}, {wch:34}, {wch:8}, {wch:6}, {wch:6}, {wch:14}, {wch:14}, {wch:6}, {wch:28}];
  ws['!merges'] = [{s:{r:0, c:0}, e:{r:0, c:9}}];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '견적서');
  XLSX.writeFile(wb, `${j.no}_${(j.to || '견적').replace(/[\\/:*?"<>|]/g, '')}.xlsx`);
}
async function quoteCmpXlsx(gk){
  try{ await loadScriptOnce(XLSX_SRC); }catch(e){ toast(e.message); return; }
  const qs = db.quotes.filter(q => q.grp === gk && !q.off), col = qCol[gk] || (qs[0] && qs[0].p.cols[0]);
  const keys = []; qs.forEach(q => q.p.lines.forEach(l => { if(!keys.some(k => k.key === l.key)) keys.push(l); }));
  const aoa = [['항목', '구분', ...qs.map(fwdLabel)]];
  keys.forEach(k => aoa.push([k.name, QSEC[k.sec] || '', ...qs.map(q => { const l = q.p.lines.find(x => x.key === k.key); return l ? qcell(l, col) : ''; })]));
  aoa.push(['합계(원)', col, ...qs.map(q => qTotal(q, col, q.p.rate || qset().rate).krw)]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '견적 비교(내부)');
  XLSX.writeFile(wb, `견적비교_${qGroupTitle(qs[0] ? qs[0].subject : '').slice(0, 30).replace(/[\\/:*?"<>|]/g, '')}.xlsx`);
}
function quoteCopy(j){
  const t = jobTotals(j), rows = jobRows(j);
  const html = `<table border="1" cellpadding="4" style="border-collapse:collapse;font-size:12px"><tr style="background:#E8EEF4"><th>구분</th><th>항목</th><th>단위</th><th>통화</th><th>단가</th><th>수량</th><th>금액</th><th>비고</th></tr>${rows.map(r => `<tr><td>${esc(r.sec)}</td><td>${r.vat ? '* ' : ''}${esc(r.name)}</td><td>${esc(r.unit)}</td><td>${esc(r.cur)}</td><td align="right">${r.flag || esc(qfmt(r.price, r.cur))}</td><td align="center">${esc(r.qty)}</td><td align="right">${r.flag || esc(qfmt(r.amt, r.cur))}</td><td>${esc(r.note)}</td></tr>`).join('')}<tr><td colspan="6" align="right"><b>합계(원, VAT 포함)</b></td><td align="right"><b>₩${t.grand.toLocaleString('ko-KR')}</b></td><td></td></tr></table>`;
  const txt = rows.map(r => `${r.name}\t${r.unit}\t${r.cur}\t${r.flag || qfmt(r.amt, r.cur)}`).join('\n') + `\n합계(원, VAT 포함)\t\t\t${t.grand.toLocaleString('ko-KR')}`;
  try{ navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html], {type:'text/html'}), 'text/plain':new Blob([txt], {type:'text/plain'})})]).then(() => toast('메일에 붙여 넣을 표를 복사했습니다.'), () => { navigator.clipboard.writeText(txt); toast('표를 글자로 복사했습니다.'); }); }
  catch{ navigator.clipboard.writeText(txt); toast('표를 글자로 복사했습니다.'); }
}

/* ---------- 이벤트 (이 화면 전용) ---------- */
document.addEventListener('click', e => {
  if(typeof db === 'undefined' || !db) return;
  const b = e.target.closest('[data-q-load],[data-q-newjob],[data-q-paste],[data-q-make],[data-q-off],[data-q-openjob],[data-q-back],[data-q-print],[data-q-xlsx],[data-q-copy],[data-q-deljob],[data-qj-add],[data-qj-del],[data-q-cmpx]');
  if(!b) return;
  const d = b.dataset;
  if('qLoad' in d) loadQuotes(true);
  else if('qNewjob' in d){ const j = makeJob(null, ''); commit(); go('quote', j.id); }
  else if('qPaste' in d){ pasteQuote(($('#qPasteText') || {}).value, ($('#qPasteSubj') || {}).value, ($('#qPasteFwd') || {}).value); }
  else if('qMake' in d){ const [qid, col] = d.qMake.split('|'); const q = db.quotes.find(x => x.id === qid); if(q){ const j = makeJob(q, col); commit(); go('quote', j.id); } }
  else if('qOff' in d){ const q = db.quotes.find(x => x.id === d.qOff); if(q){ q.off = true; commit(); } }
  else if('qOpenjob' in d) go('quote', d.qOpenjob);
  else if('qBack' in d) go('quote');
  else if('qPrint' in d){ const j = db.quoteJobs.find(x => x.id === d.qPrint); if(j) quotePrint(j); }
  else if('qXlsx' in d){ const j = db.quoteJobs.find(x => x.id === d.qXlsx); if(j) quoteXlsx(j); }
  else if('qCopy' in d){ const j = db.quoteJobs.find(x => x.id === d.qCopy); if(j) quoteCopy(j); }
  else if('qCmpx' in d) quoteCmpXlsx(d.qCmpx);
  else if('qDeljob' in d){ const j = db.quoteJobs.find(x => x.id === d.qDeljob); if(j && confirm(`견적서 ${j.no}을(를) 지울까요?`)){ db.quoteJobs = db.quoteJobs.filter(x => x.id !== j.id); commit(); go('quote'); } }
  else if('qjAdd' in d){ const j = db.quoteJobs.find(x => x.id === route.id); if(!j) return; const a = BSGC_ADD[d.qjAdd];
    j.lines.push(a ? {id:uid(), sec:'bsgc', name:a[0], unit:a[1], qty:1, cur:'KRW', cost:null, addPct:'', addAmt:0, price:'', vat:a[2], note:'', src:'bsgc', show:true}
      : {id:uid(), sec:'dest', name:'', unit:'/CNTR', qty:1, cur:'KRW', cost:null, addPct:'', addAmt:0, price:'', vat:false, note:'', src:'fwd', show:true});
    j.updatedAt = nowIso(); commit(); }
  else if('qjDel' in d){ const j = db.quoteJobs.find(x => x.id === route.id); if(j){ j.lines = j.lines.filter(l => l.id !== d.qjDel); j.updatedAt = nowIso(); commit(); } }
});
document.addEventListener('change', e => {
  if(typeof db === 'undefined' || !db) return;
  const el = e.target, d = el.dataset || {};
  if('qCol' in d){ qCol[d.qCol] = el.value; renderView(); return; }
  if('qGrp' in d){ const q = db.quotes.find(x => x.id === d.qGrp); if(q){ q.grp = el.value === '__new' ? qGroupKey(q.subject) + ' ' + q.id : el.value; commit(); } return; }
  if('qSet' in d){ const s = qset(); s[d.qSet] = el.type === 'number' ? Number(el.value || 0) : el.value; commit(); return; }
  if('qCo' in d){ qset().company[d.qCo] = el.value; commit(); return; }
  if('qFwd' in d){ const s = qset(); if(el.value.trim()) s.fwd[d.qFwd] = el.value.trim(); else delete s.fwd[d.qFwd]; commit(); return; }
  if(el.id === 'qFile' && el.files.length){ uploadQuoteFiles(el.files, ($('#qDropSubj') || {}).value); el.value = ''; return; }
  const j = route.name === 'quote' && route.id ? db.quoteJobs.find(x => x.id === route.id) : null;
  if(!j) return;
  if('qf' in d){ j[d.qf] = ['markup', 'rate'].includes(d.qf) ? Number(el.value || 0) : el.value; if(d.qf === 'clientId' && el.value){ const c = db.clients.find(x => x.id === el.value); if(c) j.to = c.name; } j.updatedAt = nowIso(); commit(); return; }
  if('qj' in d){ const [lid, k] = d.qj.split('|'), l = j.lines.find(x => x.id === lid); if(!l) return;
    if(el.type === 'checkbox') l[k] = el.checked;
    else if(['qty', 'cost', 'addPct', 'addAmt', 'price'].includes(k)) l[k] = el.value === '' ? (k === 'qty' ? 1 : k === 'addAmt' ? 0 : '') : Number(el.value);
    else l[k] = el.value;
    if(k === 'cost' && el.value === '') l.cost = null;
    j.updatedAt = nowIso(); commit(); }
});
document.addEventListener('dragover', e => { const z = e.target.closest && e.target.closest('#qDrop'); if(z){ e.preventDefault(); z.classList.add('on'); } });
document.addEventListener('dragleave', e => { const z = e.target.closest && e.target.closest('#qDrop'); if(z) z.classList.remove('on'); });
document.addEventListener('drop', e => { const z = e.target.closest && e.target.closest('#qDrop'); if(!z) return; e.preventDefault(); z.classList.remove('on'); if(e.dataTransfer.files.length) uploadQuoteFiles(e.dataTransfer.files, ($('#qDropSubj') || {}).value); });
