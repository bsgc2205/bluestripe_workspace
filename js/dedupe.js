'use strict';
/* ---------- 업체 중복 점검·합치기 (11/14) ----------
   같은 회사가 두 번 등록되는 일(예: Drive 자료로 만든 약칭 업체 + 사업자등록증 반영으로 만든 정식 상호 업체)을 찾아 하나로 합친다.
   후보 근거(강한 순):
     biz   사업자번호 같음 / ecm 통관고유부호 같음                                   — 확실
     dom   회사 메일 도메인이 같음(검색어 '@도메인'·담당자 주소, 무료 메일·세 곳 이상에 나오는 도메인 제외) — 거의 확실
     name  상호가 같거나 한쪽이 다른 쪽을 포함('(주)'·'주식회사'·업종 꼬리말 뗀 뒤), 한쪽 검색어가 다른 쪽 이름 — 확인 필요
   사업자번호가 둘 다 있고 서로 다르면 같은 업체로 보지 않는다(이름까지 똑같으면 '지점·공장일 수 있음'으로만 보임).
   '다른 업체임'은 settings.clientNotDup에 남겨 다시 묻지 않는다.
   합치기(mergeClients): 남길 업체를 고르고, 없어질 업체를 가리키던 모든 자료(기록·절차·품목·세관 질의·KC·견적·알림·메일 업체 지정·미분류 자료 등)를
   남길 업체로 옮긴다. 없어질 업체 이름은 남길 업체의 검색어로 넣고, 빈 칸·담당자·검색어는 채우거나 합친다.
   db.clientMerged[없어진 id] = 남은 id 를 남겨, 동기화 전 다른 PC가 옛 업체로 만든 자료도 Drive 합칠 때 자동으로 옮긴다(tidyMerged → applyClientMerged).
   db.clientMergeLog에 되돌리기 정보(없어진 업체 원본, 남은 업체의 바뀐 칸, 옮긴 자료 목록)를 남겨 업체 화면에서 되돌릴 수 있다. */
const DUP_TAIL = /(해운항공|해운|항공|로지스틱스|로지스|물류|일렉트로닉스|일렉트로닉|전자|산업기계|산업|기계|정공|물산|통상|상사|무역|인터내셔널|글로벌|코리아|테크|엠앤디|에스티|이앤비|에프앤비|네트웍스|기업|유기농|화학|케미칼|메디칼|엔지니어링|시스템|솔루션|korea|logistics|trading|international|global)+$/i;
function dupNameKey(s){ return nameKey(s).replace(/[\s.,·\-_&()]/g, ''); }
function dupCore(s){ const k = dupNameKey(s), t = k.replace(DUP_TAIL, ''); return t.length >= 2 ? t : k; }
function dupDomains(c){
  const out = new Set();
  kwList(c).filter(k => k.startsWith('@')).forEach(k => out.add(k.slice(1)));
  (c.contacts || []).forEach(p => { const d = String(p.email || '').toLowerCase().split('@')[1]; if(d) out.add(d.trim()); });
  return [...out].filter(d => d && !FREE_MAIL.includes(d) && !/(^|\.)bsgc\.co\.kr$/.test(d));
}
function dupPairKey(a, b){ return [a, b].sort().join('|'); }
function dupCandidates(){
  const notDup = new Set(db.settings.clientNotDup || []), cs = db.clients, out = [];
  const domCount = new Map();
  const doms = new Map(cs.map(c => { const d = dupDomains(c); d.forEach(x => domCount.set(x, (domCount.get(x) || 0) + 1)); return [c.id, d]; }));
  const info = new Map(cs.map(c => [c.id, {k:dupNameKey(c.name), core:dupCore(c.name), biz:bizDigits(c.bizNo), ecm:String(c.ecm || '').replace(/\s/g, '').toUpperCase(), kws:kwList(c).filter(k => !k.startsWith('@')).map(dupNameKey)}]));
  for(let i = 0; i < cs.length; i++) for(let j = i + 1; j < cs.length; j++){
    const a = cs[i], b = cs[j], A = info.get(a.id), B = info.get(b.id);
    if(notDup.has(dupPairKey(a.id, b.id))) continue;
    const why = [];
    let lvl = 0;                                                          // 3 확실 · 2 거의 확실 · 1 확인 필요
    const bizDiff = A.biz.length === 10 && B.biz.length === 10 && A.biz !== B.biz;
    if(A.biz.length === 10 && A.biz === B.biz){ why.push('사업자번호 같음'); lvl = 3; }
    if(A.ecm && A.ecm === B.ecm){ why.push('통관고유부호 같음'); lvl = 3; }
    const sd = doms.get(a.id).filter(d => doms.get(b.id).includes(d) && domCount.get(d) <= 2);
    if(sd.length){ why.push(`메일 도메인 같음 (${sd[0]})`); lvl = Math.max(lvl, 2); }
    const contains = (x, y) => x.length >= 2 && y.length >= 2 && x !== y && (x.length <= 2 ? y.startsWith(x) : y.includes(x));
    if(A.k && A.k === B.k){ why.push('상호 같음'); lvl = Math.max(lvl, 2); }
    else if(contains(A.k, B.k) || contains(B.k, A.k)){ why.push('한쪽 상호가 다른 쪽을 포함'); lvl = Math.max(lvl, 1); }
    else if(A.core.length >= 2 && A.core === B.core){ why.push('업종 꼬리말 뺀 이름 같음'); lvl = Math.max(lvl, 1); }
    if(A.kws.some(k => k.length >= 2 && k === B.k) || B.kws.some(k => k.length >= 2 && k === A.k)){ why.push('검색어에 상대 업체 이름'); lvl = Math.max(lvl, 2); }
    if(!why.length) continue;
    if(bizDiff){ if(A.k !== B.k) continue; why.push('사업자번호 다름 — 지점·공장일 수 있음'); lvl = 1; }
    out.push({a, b, why, lvl});
  }
  return out.sort((x, y) => y.lvl - x.lvl || x.a.name.localeCompare(y.a.name, 'ko'));
}
/* 남길 업체 추천: 사업자번호·사업자등록증 있는 쪽 → 기록이 많은 쪽 → 먼저 만든 쪽 */
function dupKeepFirst(a, b){
  const sc = c => (bizDigits(c.bizNo).length === 10 ? 4 : 0) + (c.bizDoc ? 2 : 0) + (c.ecm ? 1 : 0);
  const n = c => db.records.filter(r => r.clientId === c.id).length;
  return sc(b) - sc(a) || n(b) - n(a) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || 0;
}
function dupStats(c){ return {rec:db.records.filter(r => r.clientId === c.id).length, item:db.items.filter(i => i.clientId === c.id).length, proc:db.procedures.filter(p => p.clientId === c.id).length}; }

/* 자료 안의 업체 id를 찾아 바꿈(값이 같은 문자열, 또는 업체 id를 키로 쓰는 표). 업체 id는 무작위 문자열이라 다른 값과 겹치지 않는다. */
function refSwap(o, from, to){
  let hit = false;
  if(Array.isArray(o)){ o.forEach((v, i) => { if(v === from){ o[i] = to; hit = true; } else if(v && typeof v === 'object' && refSwap(v, from, to)) hit = true; }); return hit; }
  Object.keys(o).forEach(k => {
    const v = o[k];
    if(k === from){ if(!(to in o)) o[to] = v; delete o[k]; hit = true; return; }
    if(v === from){ o[k] = to; hit = true; }
    else if(v && typeof v === 'object' && refSwap(v, from, to)) hit = true;
  });
  return hit;
}
const MERGE_SKIP = new Set(['clients', 'meta', 'clientMergeLog', 'clientMerged', 'mailSeen', 'mailIgnored', 'intakeOff', 'collectSeen']);
function entKey(x, i){ return x && typeof x === 'object' && x.id ? 'id:' + x.id + (x.declNo ? '|' + x.declNo : '') : 'i:' + i + ':' + jstr(x).slice(0, 200); }
function mergeClients(keepId, goneId){
  const keep = db.clients.find(c => c.id === keepId), gone = db.clients.find(c => c.id === goneId);
  if(!keep || !gone || keep === gone) return null;
  const log = {id:uid(), at:nowIso(), by:me ? me.id : '', keep:keep.id, keepName:keep.name, gone:clone(gone), keepBefore:{}, moved:{}};
  // ① 업체 칸 합치기: 빈 칸은 채우고, 검색어·담당자·학습 주소는 합침, 없어질 이름은 검색어로
  const setK = (k, v) => { if(!(k in log.keepBefore)) log.keepBefore[k] = clone(keep[k]); keep[k] = v; };
  Object.keys(gone).forEach(k => {
    if(['id', 'name', 'createdAt', 'updatedAt', 'keyword', 'contacts', 'learned', 'notes', 'recentWork'].includes(k)) return;
    const v = gone[k], cur = keep[k];
    if(v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return;
    if(cur === undefined || cur === null || cur === '' || (Array.isArray(cur) && !cur.length) || (typeof cur === 'object' && !Array.isArray(cur) && !Object.keys(cur).length)) setK(k, clone(v));
  });
  const kws = [...new Set([...String(keep.keyword || '').split(/[,;\n]/), ...String(gone.keyword || '').split(/[,;\n]/), gone.name].map(x => String(x || '').trim()).filter(Boolean))]
    .filter(x => dupNameKey(x) !== dupNameKey(keep.name));
  if(kws.join(', ') !== String(keep.keyword || '')) setK('keyword', kws.join(', '));
  const people = [...(keep.contacts || [])];
  (gone.contacts || []).forEach(p => { const e = String(p.email || '').toLowerCase(); if(!people.some(q => (e && String(q.email || '').toLowerCase() === e) || (!e && q.name === p.name))) people.push(clone(p)); });
  if(people.length !== (keep.contacts || []).length) setK('contacts', people);
  if((gone.learned || []).length) setK('learned', [...(keep.learned || []), ...gone.learned].slice(-30));
  if((gone.recentWork || []).length) setK('recentWork', [...(keep.recentWork || []), ...gone.recentWork].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 10));
  if(gone.notes && !String(keep.notes || '').includes(gone.notes)) setK('notes', [keep.notes, `[합친 업체 ‘${gone.name}’ 메모] ${gone.notes}`].filter(Boolean).join('\n'));
  keep.updatedAt = nowIso();
  // ② 자료 옮기기
  Object.keys(db).forEach(k => {
    if(MERGE_SKIP.has(k)) return;
    const v = db[k];
    if(Array.isArray(v)) v.forEach((x, i) => { if(x && typeof x === 'object' && refSwap(x, gone.id, keep.id)){ (log.moved[k] = log.moved[k] || []).push(entKey(x, i)); if(x.updatedAt !== undefined && k === 'records') x.updatedAt = nowIso(); } });
    else if(v && typeof v === 'object'){                                    // 표(업체 id를 키로 쓰거나 값으로 가진 것): 바꾼 칸만 기억
      const mv = [];
      Object.keys(v).forEach(k2 => {
        if(k2 === gone.id){ const had = keep.id in v; mv.push(['key', k2, had, had ? clone(v[k2]) : null]); if(!had) v[keep.id] = v[k2]; delete v[k2]; return; }
        const x = v[k2];
        if(x === gone.id){ v[k2] = keep.id; mv.push(['val', k2]); }
        else if(x && typeof x === 'object' && refSwap(x, gone.id, keep.id)) mv.push(['val', k2]);
      });
      if(mv.length) (log.maps = log.maps || {})[k] = mv;
    }
    else if(v === gone.id){ db[k] = keep.id; log.moved[k] = ['=']; }
  });
  db.records.filter(r => r.clientId === keep.id && (log.moved.records || []).includes(entKey(r))).forEach(r => addHist(r, `업체 합치기: ‘${gone.name}’ → ‘${keep.name}’`));
  db.clients = db.clients.filter(c => c.id !== gone.id);
  db.clientMerged = {...(db.clientMerged || {}), [gone.id]:keep.id};
  Object.keys(db.clientMerged).forEach(k => { if(db.clientMerged[k] === gone.id) db.clientMerged[k] = keep.id; });   // 예전에 gone으로 합친 것도 keep으로
  db.clientMergeLog = [...(db.clientMergeLog || []), log].slice(-30);
  return log;
}
/* 되돌리기: 없어진 업체를 다시 만들고, 그때 옮긴 자료만 되돌린다. 합친 뒤 새로 생긴 자료는 남은 업체에 그대로 있다. */
function unmergeClients(logId){
  const log = (db.clientMergeLog || []).find(x => x.id === logId);
  if(!log) return false;
  const keep = db.clients.find(c => c.id === log.keep);
  if(db.clients.some(c => c.id === log.gone.id)) return false;
  db.clients.push(clone(log.gone));
  if(keep){ Object.keys(log.keepBefore).forEach(k => { if(log.keepBefore[k] === undefined) delete keep[k]; else keep[k] = clone(log.keepBefore[k]); }); keep.updatedAt = nowIso(); }
  Object.keys(log.maps || {}).forEach(k => {
    const v = db[k]; if(!v || typeof v !== 'object') return;
    log.maps[k].forEach(([t, k2, had, val]) => {
      if(t === 'key'){ if(had) v[k2] = clone(val); else if(log.keep in v){ v[k2] = v[log.keep]; delete v[log.keep]; } }
      else if(t === 'val'){ if(v[k2] === log.keep) v[k2] = log.gone.id; else if(v[k2] && typeof v[k2] === 'object') refSwap(v[k2], log.keep, log.gone.id); }
    });
  });
  Object.keys(log.moved).forEach(k => {
    if(log.moved[k][0] === '='){ if(db[k] === log.keep) db[k] = log.gone.id; return; }
    const v = db[k], keys = new Set(log.moved[k]);
    if(Array.isArray(v)) v.forEach((x, i) => { if(x && typeof x === 'object' && (keys.has(entKey(x, i)) || [...keys].some(q => q.startsWith('id:') && x.id && q.split('|')[0] === 'id:' + x.id))) refSwap(x, log.keep, log.gone.id); });
  });
  db.records.filter(r => r.clientId === log.gone.id).forEach(r => addHist(r, `업체 합치기 되돌림: ‘${log.keepName}’ → ‘${log.gone.name}’`));
  if(db.clientMerged) delete db.clientMerged[log.gone.id];
  db.clientMergeLog = db.clientMergeLog.filter(x => x.id !== logId);
  db.settings.clientNotDup = [...new Set([...(db.settings.clientNotDup || []), dupPairKey(log.keep, log.gone.id)])];   // 되돌린 쌍은 다시 후보로 묻지 않음
  return true;
}
/* Drive 동기화로 합쳐진 자료에 옛 업체 id가 남아 있으면 남은 업체로 (sync.js tidyMerged에서 먼저 부름) */
function applyClientMerged(d){
  const m = d.clientMerged || {};
  const ids = Object.keys(m);
  if(!ids.length) return d;
  const live = new Set(d.clients.map(c => c.id));
  const target = id => { let t = m[id], n = 0; while(m[t] && n++ < 10) t = m[t]; return t; };
  const map = new Map(ids.map(id => [id, target(id)]).filter(([, t]) => live.has(t)));
  if(!map.size) return d;
  d.clients = d.clients.filter(c => !map.has(c.id));                     // 다른 PC가 되살린 옛 업체는 뺌(남은 업체가 있을 때만)
  const walk = o => {                                                     // 한 번 훑으며 옛 id → 남은 id
    if(Array.isArray(o)){ o.forEach((v, i) => { if(typeof v === 'string'){ if(map.has(v)) o[i] = map.get(v); } else if(v && typeof v === 'object') walk(v); }); return; }
    Object.keys(o).forEach(k => {
      const v = o[k];
      if(map.has(k)){ const t = map.get(k); if(!(t in o)) o[t] = v; delete o[k]; }
      if(typeof v === 'string'){ if(map.has(v)) o[map.has(k) ? map.get(k) : k] = map.get(v); }
      else if(v && typeof v === 'object') walk(v);
    });
  };
  Object.keys(d).forEach(k => { if(MERGE_SKIP.has(k)) return; const v = d[k]; if(v && typeof v === 'object') walk(v); });
  return d;
}

/* ---------- 화면 ---------- */
function openClientDup(){
  const list = dupCandidates();
  const lv = ['', '확인 필요', '거의 확실', '확실'], lc = ['', 'chk', 'prog', 'act'];
  const card = (c, stt) => `<div><strong>${esc(c.name)}</strong>${c.bizNo ? `<div class="hint">${esc(c.bizNo)}${c.bizDoc ? ' · 등록증' : ''}</div>` : '<div class="hint">사업자번호 없음</div>'}<div class="hint">기록 ${stt.rec} · 품목 ${stt.item} · 절차 ${stt.proc}${c.createdAt ? ` · ${esc(String(c.createdAt).slice(0, 10))} 등록` : ''}</div></div>`;
  const row = (x, i) => { const [k, g] = dupKeepFirst(x.a, x.b) <= 0 ? [x.a, x.b] : [x.b, x.a];
    return `<tr data-x-dup-row="${i}"><td><span class="tag lv-${lc[x.lvl]}">${lv[x.lvl]}</span><div class="hint">${esc(x.why.join(' · '))}</div></td>
      <td><label class="check"><input type="radio" name="keep${i}" value="${esc(k.id)}" checked> 남김</label>${card(k, dupStats(k))}</td>
      <td><label class="check"><input type="radio" name="keep${i}" value="${esc(g.id)}"> 남김</label>${card(g, dupStats(g))}</td>
      <td><button type="button" class="mini strong" data-x-dup-merge="${i}">합치기</button> <button type="button" class="mini" data-x-dup-no="${i}">다른 업체임</button></td></tr>`; };
  openDialog({title:`업체 중복 점검 — 후보 ${list.length}쌍`, saveLabel:'닫기',
    body:`<p class="hint">같은 회사가 두 번 등록된 것으로 보이는 쌍입니다. <b>남길 업체</b>를 고르고 <b>합치기</b>를 누르면, 다른 쪽의 기록·절차·품목·세관 질의·KC·견적·알림·메일 업체 지정을 모두 옮기고 그 이름은 남길 업체의 검색어로 넣습니다. 합친 뒤에도 남은 업체 화면에서 <b>되돌리기</b>를 할 수 있습니다. 같은 회사가 아니면 <b>다른 업체임</b> — 다시 묻지 않습니다.</p>
      ${list.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>근거</th><th>업체 1</th><th>업체 2</th><th>처리</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>` : '<p class="empty">중복으로 보이는 업체가 없습니다.</p>'}
      <p class="hint">사업자번호가 둘 다 있고 서로 다르면 다른 회사로 봅니다(이름까지 같으면 지점·공장일 수 있어 ‘확인 필요’로만 보입니다).</p>`,
    onSave(){ return true; },
    onOpen(f){
      f.addEventListener('click', e => {
        const b = e.target.closest('[data-x-dup-merge],[data-x-dup-no]'); if(!b) return;
        e.preventDefault();
        const i = Number(b.dataset.xDupMerge ?? b.dataset.xDupNo), x = list[i], tr = b.closest('tr');
        if(!x) return;
        if('xDupNo' in b.dataset){
          db.settings.clientNotDup = [...new Set([...(db.settings.clientNotDup || []), dupPairKey(x.a.id, x.b.id)])];
          commit(); tr.style.opacity = .4; tr.lastElementChild.innerHTML = '<span class="hint">다른 업체로 표시</span>'; return;
        }
        const keepId = (f.querySelector(`input[name="keep${i}"]:checked`) || {}).value, gone = keepId === x.a.id ? x.b : x.a, keep = keepId === x.a.id ? x.a : x.b;
        if(!db.clients.includes(gone) || !db.clients.includes(keep)){ toast('이미 다른 쌍에서 합친 업체입니다. 창을 닫고 다시 여세요.'); return; }
        const st = dupStats(gone);
        if(!confirm(`‘${gone.name}’을(를) ‘${keep.name}’에 합칩니다.\n기록 ${st.rec}건 · 품목 ${st.item}개 · 절차 ${st.proc}건이 ‘${keep.name}’으로 옮겨지고 ‘${gone.name}’은 검색어로 남습니다.\n(남은 업체 화면에서 되돌릴 수 있습니다)`)) return;
        const log = mergeClients(keep.id, gone.id);
        if(!log){ toast('합치지 못했습니다.'); return; }
        commit();
        tr.style.opacity = .5; tr.lastElementChild.innerHTML = `<span class="hint">‘${esc(keep.name)}’으로 합침</span>`;
        f.querySelectorAll('tr[data-x-dup-row]').forEach(o => { const y = list[Number(o.dataset.xDupRow)]; if(o !== tr && y && (y.a.id === gone.id || y.b.id === gone.id) && o.style.opacity !== '0.5'){ o.style.opacity = .4; o.lastElementChild.innerHTML = '<span class="hint">합친 업체 — 다시 점검</span>'; } });
        toast(`‘${gone.name}’을(를) ‘${keep.name}’에 합쳤습니다.`);
      });
    }});
}
/* 업체 화면: 이 업체로 합친 이력과 되돌리기 */
function clientMergedHTML(c){
  const logs = (db.clientMergeLog || []).filter(x => x.keep === c.id);
  if(!logs.length) return '';
  return `<p class="hint merged-from">합친 업체: ${logs.map(x => `‘${esc(x.gone.name)}’ (${esc(String(x.at).slice(0, 10))}) <button class="mini" data-client-unmerge="${esc(x.id)}" title="이 업체를 다시 나누고, 그때 옮긴 기록·품목 등을 되돌립니다">되돌리기</button>`).join(' · ')}</p>`;
}
/* 새 업체를 만들기 전에 비슷한 업체 찾기 (업체 추가·사업자등록증 반영·업체 미인식 점검의 '새 업체') */
function similarClients(name, biz, exceptId){
  const k = dupNameKey(name), core = dupCore(name), b = bizDigits(biz);
  const notDup = new Set(db.settings.clientNotDup || []);
  return db.clients.filter(c => c.id !== exceptId && !(exceptId && notDup.has(dupPairKey(c.id, exceptId)))).map(c => {
    const ck = dupNameKey(c.name), cb = bizDigits(c.bizNo);
    if(b.length === 10 && cb === b) return {c, why:'사업자번호 같음', lvl:3};
    if(b.length === 10 && cb.length === 10) return null;
    if(!k || !ck) return null;
    if(ck === k) return {c, why:'상호 같음', lvl:2};
    if(kwList(c).some(w => !w.startsWith('@') && dupNameKey(w) === k)) return {c, why:'검색어에 같은 이름', lvl:2};
    const contains = (x, y) => x.length >= 2 && y.length >= 2 && (x.length <= 2 ? y.startsWith(x) : y.includes(x));
    if(contains(ck, k) || contains(k, ck)) return {c, why:'한쪽 상호가 다른 쪽을 포함', lvl:1};
    if(core.length >= 2 && dupCore(c.name) === core) return {c, why:'업종 꼬리말 뺀 이름 같음', lvl:1};
    return null;
  }).filter(Boolean).sort((x, y) => y.lvl - x.lvl);
}
function dupCount(){ try{ return dupCandidates().length; }catch(e){ return 0; } }
