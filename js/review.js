'use strict';
/* ---------- 관세사 검토 문의 · 신고 유의사항 (11/12) ----------
   ① 검토 문의(review): 품목분류(HS)·수입요건·FTA·원산지·과세가격·수출통제·환급·감면·정정 가능 여부처럼 관세사 검토의견이 필요한 외부 문의.
      메일 화면과 기록 카드에 '검토 필요'를 달고, '1차 검토'에서 AI에 줄 검토 요청문(메일 전문·첨부 글자·Workspace 참고 자료)을 만든다.
      지금은 복사 → Claude 앱에 붙여 넣기 → 받은 초안을 다시 붙여 저장하는 방식. Apps Script에 ANTHROPIC_API_KEY가 있으면 'AI로 바로 작성'도 쓴다.
   ② 필증 발행 의뢰(issue): 초안은 만들지 않고, 의뢰 메일에 적힌 신고 시 유의사항(금액 조건·분할·무상·정정·기재 방법 등)을
      그 기록 체크리스트 맨 앞에 '[유의] …'로 넣는다(r.cauSeen에 본 메일 기록, 한 번만).
   본문은 수집기가 문의·의뢰 메일만 따로 보낸 전문(Drive 'BSGC-검토', ?reviews=1)을 쓰고, 없으면 색인의 앞부분(600자)을 쓴다. */
const RV_TOPIC = /hs\s*code|hs\s*코드|hs\s*no|(?<![a-z])hs(?![a-z])|에이치에스|품목\s*분류|세번|관세율|(?<![가-힣])세율|fta|원산지\s*(판정|기준|결정|검증|인정)|협정\s*세율|요건|세관장\s*확인|검역|식품|화학\s*물질|화평법|화관법|cas\s*(no|번호)|msds|kc\s*(인증|대상)|전파\s*(인증|법|적합)|인증\s*대상|과세\s*가격|특수\s*관계|로열티|가산\s*요소|(수입|수출|통관|반입)\s*(이\s*)?가능|가능\s*여부|전략\s*물자|(?<![a-z])ear(?![a-z])|수출\s*통제|환급|감면|면세|재수입|사전\s*심사|(정정|변경)\s*(가능|여부)|classification|tariff|duty\s*rate|import\s*(requirement|regulation)/i;
const RV_ASK = /문의|질의|검토|자문|의견|확인\s*(부탁|요청|바랍|해\s*주|가능)|가능\s*할까|가능한지|가능\s*할지|가능한가|여부|궁금|어떻게|알려\s*주|inquiry|question|advise|could\s+you|please\s+(check|confirm|review|advise)/i;
const RV_ISSUE = /필증|면장|면허|(수입|수출|반송)\s*신고\s*(요청|의뢰|부탁|진행)|통관\s*(요청|의뢰)|신고\s*(요청|의뢰)|발행\s*(요청|의뢰|부탁)|발급\s*(요청|의뢰)/i;
const RV_QUOTE = /-{2,}\s*(original|원본)|(^|\s)(from|보낸\s*사람|보낸사람)\s*:|on .{5,60} wrote:/i;
const RV_CT = /원산지|c\/o|(?<![a-z])co(?![a-z])|fta|한글\s*표시|표시\s*사항|라벨|label|중량|무게|수량|단가|금액|가격|통화|usd|eur|인코텀즈|incoterms|exw|fob|cif|dap|ddp|fca|(?<![a-z])hs(?![a-z])|세번|요건|검역|검사|kc|전파|정정|분할|무상|foc|샘플|유상|재수출|재수입|보세|반송|포장|팔레트|pallet|규격|모델|시리얼|s\/n|계약|인보이스|invoice|packing|선적일|적재|수출자|수입자|제조자|제조사|납세|부가세|환급|면세|감면|운임|보험/i;
const RV_CA = /유의|주의|반드시|꼭|필히|수정|정정|변경|기재|기입|표기|나누어|나눠|맞춰|동일하게|아닌|말고|제외|포함|누락|별도|조건으로|(으로|로)\s*(진행|신고)|분할|무상|샘플|추천/i;
const RV_SKIP = /^(안녕하세요|감사합니다|수고|좋은\s*하루)|드림$|올림$|^(tel|fax|mobile|e-?mail|t\.|f\.|m\.)|차량번호|안전운임|적하보험/i;
const RV_PLAIN = /^.{0,40}(면장|필증|면허|신고)\s*(신청|요청|발행|발급|진행)?\s*(부탁|요청)?\s*(드립니다|드려요|바랍니다)\.?$/;

let reviewStore = null;                                                   // mailId → {body, files:[{name,text,link}], kind}
let rvKindCache = new Map(), rvById = null, rvByIdSrc = null;              // 화면을 그릴 때마다 메일 수천 통을 다시 판정하지 않도록
async function loadReviews(){
  try{ const j = await collectApi({reviews:1}); reviewStore = new Map((j.items || []).map(x => [x.mailId, x])); }
  catch(e){ if(!reviewStore) reviewStore = new Map(); }
  rvKindCache = new Map();
}
function rvMail(id){ if(rvByIdSrc !== mailCache){ rvByIdSrc = mailCache; rvById = new Map((mailCache || []).map(m => [m.id, m])); rvKindCache = new Map(); } return rvById.get(id); }
function mailKindC(m){ if(rvByIdSrc !== mailCache) rvMail(''); if(!rvKindCache.has(m.id)) rvKindCache.set(m.id, mailKind(m)); return rvKindCache.get(m.id); }
function rvOwn(t){ const s = String(t || ''), m = RV_QUOTE.exec(s); return m ? s.slice(0, m.index) : s; }
function mailFull(m){ const x = reviewStore && reviewStore.get(m.id); return x && x.body ? x.body : String(m.snippet || ''); }
function mailKind(m){
  if(isOwn(m.from) && !m.fwdFrom) return '';
  const s = String(m.subject || ''), b = rvOwn(mailFull(m)).slice(0, 1500);
  const subjRev = RV_TOPIC.test(s) && (RV_ASK.test(s) || RV_ASK.test(b.slice(0, 400)));
  const bodyRev = RV_TOPIC.test(b) && RV_ASK.test(b) && !RV_ISSUE.test(s);
  if(subjRev || bodyRev) return 'review';
  return RV_ISSUE.test(s + ' ' + b.slice(0, 400)) ? 'issue' : '';
}
function threadKind(t){ const ks = t.ms.map(mailKindC); return ks.includes('review') ? 'review' : ks.includes('issue') ? 'issue' : ''; }
function rvCautions(text){
  let t = rvOwn(text).replace(/^.{0,120}?안녕하세요[^.\n]{0,40}?(입니다|이에요)?[.~!,\s]*/s, '');
  t = t.split(/감사합니다|best\s+regards|thank\s+you/i)[0];
  const parts = t.split(/\n|(?<=[.!?])\s+|(?<=니다)\s+|(?<=요)\s+/).map(p => p.trim().replace(/^[\s\-·*l]+/, '')).filter(Boolean);
  return parts.filter(p => p.length >= 8 && p.length <= 160 && !RV_SKIP.test(p) && RV_CT.test(p) && RV_CA.test(p) && !RV_PLAIN.test(p)).slice(0, 4);
}
/* 필증 발행 의뢰 메일의 유의사항 → 기록 체크리스트 '[유의]' (메일 불러올 때·기록에 붙일 때) */
function applyCautions(){
  if(!mailCache) return 0;
  let n = 0;
  db.records.filter(r => r.status !== '완료' && (r.mails || []).length).forEach(r => {
    r.cauSeen = r.cauSeen || [];
    (r.mails || []).forEach(x => {
      if(r.cauSeen.includes(x.id)) return;
      const m = rvMail(x.id); if(!m) return;
      r.cauSeen = [...r.cauSeen, x.id].slice(-200);
      if(String(m.date || '').slice(0, 10) < addPeriod(today(), -30, 'd')) return;    // 처음 켤 때 지난 메일까지 쏟아지지 않게 최근 30일만
      if(mailKindC(m) !== 'issue') return;
      const cs = rvCautions(mailFull(m)), at = String(m.date || '').slice(5, 10);
      const who = (String(m.fwdFrom || '').replace(/<.*>/, '').replace(/"/g, '').trim() || m.fromName || String(m.from || '').split('@')[0]);
      cs.forEach(s => {
        const text = `[유의] ${s.slice(0, 150)} (${at} ${String(who).slice(0, 20)})`;
        r.checklist = r.checklist || [];
        if(r.checklist.some(c => c.text.includes(s.slice(0, 40)))) return;
        r.checklist.unshift({text, done:false});
        n++;
      });
      if(cs.length){ addHist(r, `메일의 신고 유의사항 ${cs.length}건을 체크리스트에 넣음: “${m.subject || ''}”`); r.updatedAt = nowIso(); }
    });
  });
  return n;
}

/* ---------- 1차 검토 ---------- */
let rvV1 = {src:null, map:new Map()};
function reviewOf(key){                                                     // 11/13 f 이전 키(threadKeyV1)로 저장된 검토도 찾음
  const rv = db.reviews || {};
  if(rv[key]) return rv[key];
  if(!Object.keys(rv).length || !mailCache) return null;
  if(rvV1.src !== mailCache){ const mp = new Map(); mailCache.forEach(m => { const k = threadKey(m.subject), k1 = threadKeyV1(m.subject); if(k !== k1){ if(!mp.has(k)) mp.set(k, new Set()); mp.get(k).add(k1); } }); rvV1 = {src:mailCache, map:mp}; }
  const k1 = [...(rvV1.map.get(key) || [])].find(k => rv[k]);
  return k1 ? rv[k1] : null;
}
function recReviewKeys(r){ return [...new Set((r.mails || []).flatMap(m => threadKeysOf(m.subject)).filter(k => k.length >= 4))]; }
function recReview(r){ const rv = db.reviews || {}; return Object.values(rv).find(x => x.recId === r.id) || recReviewKeys(r).map(k => rv[k]).find(Boolean) || null; }
function recNeedsReview(r){
  if(!mailCache) return false;
  return (r.mails || []).some(x => { const m = rvMail(x.id); return m && mailKindC(m) === 'review'; });
}
function reviewTagHTML(rv, need){
  if(rv) return `<span class="tag ${rv.status === 'done' ? 'ok-tag' : 'new'}" title="${esc(rv.status === 'done' ? `관세사 확인 ${rv.doneAt || ''}` : `1차 초안 ${String(rv.at || '').slice(0, 10)}`)}">${rv.status === 'done' ? '검토 완료' : '검토 초안'}</span>`;
  return need ? '<span class="tag chk" title="관세사 검토의견이 필요한 문의로 보입니다">검토 필요</span>' : '';
}
function threadReviewHTML(t){ const k = threadKind(t); return k === 'review' || reviewOf(t.key) ? reviewTagHTML(reviewOf(t.key), k === 'review') : ''; }
function recReviewHTML(r){ const rv = recReview(r), need = !rv && recNeedsReview(r); return rv || need ? `<button class="linkish rv-link" data-rv-rec="${esc(r.id)}">${reviewTagHTML(rv, need)}</button>` : ''; }

const RV_MASK = s => String(s || '').replace(/\+?82[-.\s)]*\d{1,2}[-.\s)]*\d{3,4}[-.\s]?\d{4}/g, '[전화]').replace(/\b01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, '[휴대폰]').replace(/\b0\d{1,2}[-.)\s]\d{3,4}[-.\s]\d{4}\b/g, '[전화]');
function rvPrompt(ms, rec, c){
  const first = ms[0] || {}, last = ms[ms.length - 1] || {};
  const mails = ms.filter(m => !isOwn(m.from) || m.fwdFrom).concat(ms.filter(m => isOwn(m.from) && !m.fwdFrom)).sort((a, b) => a.date < b.date ? -1 : 1).slice(-4);
  const files = mails.flatMap(m => { const x = reviewStore && reviewStore.get(m.id); return x ? (x.files || []) : []; }).filter(f => f.text).slice(0, 5);
  const target = rec || {id:'', clientId:c ? c.id : '', type:'', itemId:'', title:ms.map(m => m.subject).join(' '), summary:ms.map(m => String(mailFull(m)).slice(0, 400)).join('\n'), bl:''};
  const sims = typeof similarRecords === 'function' ? similarRecords(target, 4) : [];
  const inqs = typeof similarInquiries === 'function' ? similarInquiries(target, sims, 4) : [];
  const items = c ? db.items.filter(i => i.clientId === c.id).slice(0, 12) : [];
  const cau = c ? clientCaution(c) : null, cc = c && typeof clientCauses === 'function' ? clientCauses(c.id) : null;
  const L = [];
  L.push('당신은 한국 관세사무소(BSGC Customs Networks)의 관세사를 돕는 1차 검토 보조자입니다. 아래 고객 문의에 대해, 관세사가 최종 검토·수정할 1차 검토 의견과 회신 메일 초안을 작성하세요.');
  L.push('', '[작성 원칙]',
    '- 관세법·관세율표(HSK)·관세율표 해석에 관한 통칙·부/류 주·HS 해설서·관세청 품목분류 사례·세관장확인고시·FTA 협정과 특례법 등 근거를 밝히세요. 근거가 확실하지 않으면 "확인 필요"로 적고 단정하지 마세요.',
    '- 품목분류 문의는 HS 10단위 후보를 1~3개 제시하고, 후보별 근거(호의 용어·주 규정·통칙)와 판단에 더 필요한 자료(성분·용도·구조·사진 등)를 적으세요.',
    '- 수입요건 문의는 세관장확인 대상 법령·확인기관·필요 서류를 적고, 용도·성분에 따라 대상이 갈리면 그 조건을 분명히 적으세요(예: 식품용 기구에 한함).',
    '- 아래 [Workspace 참고 자료](과거 처리 사례·세관 질의·업체 품목)를 우선 참고하고, 다르게 판단하면 이유를 적으세요.',
    '- 회신 메일은 정중한 한국어 비즈니스 메일로, 관세사 검토 후 최종 안내드린다는 전제의 표현을 쓰세요. 고객이 영어로 문의했으면 영어로 쓰세요.',
    '- 개인정보(연락처 등)는 회신에 넣지 마세요.');
  L.push('', '[출력 형식] 아래 제목을 그대로 쓰세요.', '### 1. 문의 요지', '### 2. 검토 의견', '### 3. 추가 확인 필요 사항', '### 4. 회신 메일 초안', '### 5. 기록용 요약', '- 문의 유형: (품목분류 / 수입요건 / FTA·원산지 / 과세가격 / 수출통제 / 정정·신고 / 기타)', '- HS 후보:', '- 관련 요건·법령:', '- 신고 시 유의사항:');
  L.push('', '[문의 메일]', `업체: ${c ? c.name : '미지정'}${rec && rec.caseNo ? ` (케이스 ${rec.caseNo})` : ''}`);
  mails.forEach(m => {
    L.push('', `--- ${String(m.date || '').replace('T', ' ')} · ${isOwn(m.from) && !m.fwdFrom ? '보낸 메일(BSGC)' : '받은 메일'} · ${m.fwdFrom || m.fromName || m.from}`, `제목: ${m.subject || ''}`);
    L.push(RV_MASK(rvOwn(mailFull(m))).replace(/\n{3,}/g, '\n\n').slice(0, 6000));
    if((m.attachments || []).length) L.push(`첨부 파일: ${(m.attachments || []).join(', ')}`);
  });
  if(files.length){ L.push('', '[첨부 자료 글자 (자동 추출, 표·OCR이라 일부 깨질 수 있음)]'); files.forEach(f => L.push(`--- ${f.name}`, RV_MASK(String(f.text || '')).slice(0, 5000))); }
  L.push('', '[Workspace 참고 자료]');
  if(c){
    L.push(`- 업체: ${c.name}${c.industry ? ' / ' + c.industry : ''}${cau && cau.level !== '보통' ? ` / 주의 등급 ${cau.level}: ${cau.reasons.join(', ')}` : ''}`);
    if(cc && cc.list.length) L.push(`- 이 업체에서 자주 나온 정정·보완 원인: ${cc.list.map(([k, n]) => `${k} ${n}건`).join(', ')}`);
    const ins = typeof clientInsights === 'function' ? clientInsights(c) : [];
    if(ins.length) L.push(`- 업체 특이사항 요약: ${ins.map(x => x.t).join(' / ').slice(0, 600)}`);
    if(c.notes) L.push(`- 업체 메모: ${String(c.notes).replace(/\n/g, ' ').slice(0, 400)}`);
  }
  if(items.length){ L.push('- 이 업체 품목·요건:'); items.forEach(i => L.push(`  · ${i.name}${i.hs ? ' / HS ' + i.hs : ''}${i.reqs ? ' / 요건 ' + String(i.reqs).replace(/\n/g, ' ').slice(0, 120) : ''}${i.tariff ? ' / 세율 ' + i.tariff : ''}`)); }
  if(sims.length){ L.push('- 비슷한 과거 처리:'); sims.forEach(x => { const r = x.r; L.push(`  · ${r.caseNo || ''} ${clientName(r.clientId)} / ${r.type} / ${r.title}${r.special && r.specialNote ? ' / 특이: ' + String(r.specialNote).replace(/\n/g, ' ').slice(0, 200) : ''}`); }); }
  if(inqs.length){ L.push('- 관련 세관 질의:'); inqs.forEach(q => L.push(`  · ${q.date || ''} ${q.office || ''} [${q.topic || ''}]${q.hs ? ' HS ' + q.hs : ''} 질의: ${String(q.question || '').replace(/\n/g, ' ').slice(0, 200)} / 답변: ${String(q.answer || '').replace(/\n/g, ' ').slice(0, 200)}${q.basis ? ' / 근거: ' + q.basis : ''}`)); }
  if(!c && !items.length && !sims.length && !inqs.length) L.push('- (참고할 기록 없음)');
  return L.join('\n').slice(0, 60000);
}
function rvSection(text, no){
  const re = new RegExp(`#+\\s*${no}\\.[^\\n]*\\n([\\s\\S]*?)(?=\\n#+\\s*\\d\\.|$)`), m = re.exec(String(text || ''));
  return m ? m[1].trim() : '';
}
function rvCopy(text, label){
  try{ navigator.clipboard.writeText(text).then(() => toast(`${label}을(를) 복사했습니다.`), () => toast('복사하지 못했습니다. 글을 직접 선택해 복사하세요.')); }
  catch{ toast('복사하지 못했습니다. 글을 직접 선택해 복사하세요.'); }
}
function openReview(key, recId){
  let t = key ? (mailThreadsList().find(x => x.key === key) || threadsOf((mailCache || []).filter(m => threadKey(m.subject) === key))[0]) : null;
  let rec = recId ? db.records.find(r => r.id === recId) : null;
  if(!t && rec && mailCache){                                             // 기록에서 열 때: 붙은 메일 중 검토 문의 대화(없으면 전체)
    const ids = new Set((rec.mails || []).map(m => m.id)), ms = mailCache.filter(m => ids.has(m.id));
    const th = threadsOf(ms), rt = th.find(x => threadKind(x) === 'review') || th[0];
    const rv0 = recReview(rec);
    t = (rv0 && th.find(x => x.key === rv0.key)) || rt || null;
  }
  if(!t && !rec){ toast('메일을 찾지 못했습니다. 메일을 새로 불러온 뒤 다시 누르세요.'); return; }
  const k = t ? t.key : 'rec:' + rec.id;
  if(!rec && t){ const r0 = t.ms.map(m => mailRecord(m)).find(Boolean); if(r0) rec = r0; }
  const c = rec ? db.clients.find(x => x.id === rec.clientId) : t ? threadClient(t) : null;
  const rv = reviewOf(k) || (rec ? recReview(rec) : null) || {};
  const prompt = rvPrompt(t ? t.ms : [], rec, c), full = t ? t.ms.some(m => reviewStore && reviewStore.get(m.id)) : false;
  let goDb = false;                                                        // '확인 완료 + DB에 반영' (11/13 d)
  openDialog({title:'1차 검토 초안', saveLabel:'저장',
    body:`<p class="hint">${esc(t ? t.last.subject || '' : rec.title)}${c ? ' · ' + esc(c.name) : ''}${rec && rec.caseNo ? ' · ' + esc(rec.caseNo) : ''}</p>
      <ol class="rv-steps">
        <li><b>검토 요청문 복사</b> — 메일 ${full ? '전문·첨부 글자' : '앞부분(전문은 수집기 업데이트 뒤부터)'}와 이 업체의 과거 사례·세관 질의·품목 요건을 묶었습니다. 연락처는 가렸습니다.
          <div class="rv-act"><button type="button" class="primary" data-x-rv-copy>검토 요청문 복사</button><a class="btn" href="https://claude.ai/new" target="_blank" rel="noopener noreferrer">Claude 열기</a><button type="button" class="ghost" data-x-rv-ai title="Apps Script에 Claude API 키(ANTHROPIC_API_KEY)를 넣은 경우에만 동작합니다. 별도 사용료가 듭니다.">AI로 바로 작성 (API)</button></div>
          <details><summary class="hint">검토 요청문 보기 (${prompt.length.toLocaleString()}자)</summary><textarea readonly rows="8" class="rv-prompt">${esc(prompt)}</textarea></details></li>
        <li><b>받은 초안 붙여 넣기</b><textarea name="draft" rows="14" placeholder="Claude가 쓴 답을 그대로 붙여 넣으세요. '### 4. 회신 메일 초안' 부분은 아래 버튼으로 따로 복사할 수 있습니다.">${esc(rv.draft || '')}</textarea></li>
        <li><b>관세사 확인 후 회신</b> — 내용을 고친 뒤 회신 초안을 복사해 한비로 메일에 붙여 넣습니다.
          <div class="rv-act"><button type="button" class="ghost" data-x-rv-reply>회신 초안 복사</button>${isAdmin() ? `<label class="inline"><input type="checkbox" name="done"${rv.status === 'done' ? ' checked' : ''}> 관세사 확인 완료</label><button type="button" class="ghost" data-x-rv-db title="확인 완료로 저장하고 결론을 세관 질의 DB·품목 DB에 남깁니다">${rv.dbAt && rv.dbAt !== 'skip' ? `DB 반영함(${esc(rv.dbAt)}) · 다시` : '확인 완료 + DB에 반영'}</button>` : (rv.status === 'done' ? '<span class="tag ok-tag">관세사 확인 완료</span>' : '<span class="hint">확인 완료 표시는 관리자(관세사)만 합니다.</span>')}</div></li>
      </ol>
      <p class="hint">AI 초안은 참고용입니다. 품목분류·요건 판단과 회신은 관세사 확인을 거쳐 보내세요. 세관에 질의한 내용이 생기면 ‘세관 질의 DB’에 남겨 다음 검토에 쓰입니다.</p>`,
    onSave(fd){
      const draft = String(fd.get('draft') || '').trim();
      if(!draft && !rv.draft){ toast('붙여 넣은 초안이 없습니다.'); return false; }
      db.reviews = db.reviews || {};
      const was = db.reviews[k] || {};
      const done = isAdmin() ? !!fd.get('done') : was.status === 'done';
      const sum = rvSection(draft, 5);
      db.reviews[k] = {...was, key:k, recId:rec ? rec.id : (was.recId || ''), clientId:c ? c.id : (was.clientId || ''), subject:t ? t.last.subject || '' : rec.title, draft, summary:sum.slice(0, 800),
        status:done ? 'done' : 'draft', at:nowIso(), by:me ? me.id : '', ...(done && was.status !== 'done' ? {doneAt:today(), doneBy:me ? me.id : ''} : {})};
      if(rec){
        addHist(rec, done && was.status !== 'done' ? '1차 검토: 관세사 확인 완료' : (was.draft ? '1차 검토 초안 수정' : '1차 검토 초안 저장'));
        const caut = (sum.match(/신고\s*시\s*유의사항\s*[:：]\s*(.+)/) || [])[1];
        if(caut && !/^(없음|해당\s*없음|-)$/.test(caut.trim())){ rec.checklist = rec.checklist || []; const tx = `[유의] ${caut.trim().slice(0, 150)} (검토)`; if(!rec.checklist.some(x => x.text === tx)) rec.checklist.unshift({text:tx, done:false}); }
        rec.updatedAt = nowIso();
      }
      toast(done ? '관세사 확인 완료로 저장했습니다.' : '1차 검토 초안을 저장했습니다.');
      if(goDb && typeof openReviewDb === 'function') setTimeout(() => openReviewDb(k), 120);
    },
    onOpen(f){
      f.addEventListener('click', async e => {
        if(e.target.closest('[data-x-rv-copy]')){ rvCopy(prompt, '검토 요청문'); return; }
        if(e.target.closest('[data-x-rv-db]')){ if(!f.elements.namedItem('draft').value.trim()){ toast('초안이 없습니다.'); return; } const d = f.elements.namedItem('done'); if(d) d.checked = true; goDb = true; f.requestSubmit(); return; }
        if(e.target.closest('[data-x-rv-reply]')){ const d = f.elements.namedItem('draft').value, r4 = rvSection(d, 4); if(!d.trim()){ toast('초안이 없습니다.'); return; } rvCopy(r4 || d, r4 ? '회신 메일 초안' : '초안 전체'); return; }
        const ai = e.target.closest('[data-x-rv-ai]');
        if(ai){
          const cfg = db.settings.mail || {};
          ai.disabled = true; ai.textContent = 'AI 작성 중… (1분 안팎)';
          try{
            const j = await syncPost(cfg, {op:'ai', prompt});
            if(!j.ok) throw new Error(/알 수 없는 요청/.test(j.error || '') ? 'Apps Script를 새 버전으로 배포해야 합니다' : (j.error || '응답 오류'));
            f.elements.namedItem('draft').value = j.text || ''; toast('AI 초안을 넣었습니다. 확인 후 저장하세요.');
          }catch(err){ toast('AI로 작성하지 못했습니다: ' + err.message); }
          ai.disabled = false; ai.textContent = 'AI로 바로 작성 (API)';
        }
      });
    }});
}
document.addEventListener('click', e => {
  if(!db || e.target.closest('dialog')) return;
  const a = e.target.closest('[data-rv]'); if(a){ openReview(a.dataset.rv, ''); return; }
  const b = e.target.closest('[data-rv-rec]'); if(b){ e.preventDefault(); openReview('', b.dataset.rvRec); }
});
