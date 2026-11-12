'use strict';
/* ---------- 업무 매뉴얼(절차서) 자동 갱신 (G2) ----------
   - 완료된 기록을 절차와 비교해 '개정 제안'을 쌓는다: 추가된 단계, 건너뛴 단계, 새 필요 서류, 특이 처리 내용.
   - 관리자가 매뉴얼 화면에서 항목을 골라 반영하면 절차가 바뀌고 개정 이력이 남는다.
   - 절차가 없는 업체×업무유형은 완료 기록에서 자주 나온 단계로 초안을 만든다.
   - 매뉴얼마다 실제 처리 통계(건수, 평균 소요일, 자주 받은 서류, 특이 사례)와 근거 법령·최종 검토일을 보여 준다. */
const normStep = s => String(s || '').replace(/^\[점검\]\s*/, '').replace(/\s*\(필요 시\)$/, '').replace(/\s+/g, ' ').trim();
const stepKey = s => normStep(s).replace(/[\s.,·()\-]/g, '').toLowerCase();
function procFor(r){
  const byId = db.procedures.find(p => p.id === r.procId);
  if(byId && !byId.clientId && r.clientId){ const ov = db.procedures.find(p => p.overlay && p.baseId === byId.id && p.clientId === r.clientId); if(ov) return ov; }   // 공통 절차로 시작했어도 그 업체 특이사항이 있으면 그것 (11/13 b)
  return byId
    || db.procedures.find(p => p.clientId === r.clientId && p.type === r.type)
    || db.procedures.find(p => !p.clientId && p.type === r.type) || null;
}
function procRecords(p){
  return db.records.filter(r => r.status === '완료' && r.type === p.type && (r.procId === p.id || (!r.procId && (procFor(r) || {}).id === p.id)));
}
/* ---------- 매뉴얼 3단 (구조 개편 3단계, 11/13 b) ----------
   공통 절차(clientId 없음) + 업체 특이사항(overlay — 공통 절차 위에 덧붙임만) + 사건 예외(기록의 특이 처리·[유의]·체크리스트 수정).
   업체 특이사항 층: baseId(공통 절차), addSteps [{text, after}] (after: 기준 공통 단계 stepKey, '^' 맨 앞, '' 맨 끝),
     skipSteps [stepKey](이 업체는 안 함), optSteps [stepKey](필요 시), xdocs(추가 서류), ownCautions(업체 주의), ownMeta(업체 단계 조건).
   다른 화면·기능이 그대로 쓰도록 steps·docs·cautions·laws·stepMeta는 공통+업체를 합친 값으로 채워 둔다(materialize, 화면 그릴 때마다).
   단계 조건 p.stepMeta = {stepKey: {start, done, need, who, exc}} — 절차 창에서 '단계 | 완료: … | 자료: …' 형식으로 입력.
   버전 p.ver(내용이 바뀌면 +1, 개정 이력에 ver). 기록은 r.procVer = {id, v, s, at}로 적용한 버전을 남기고, 새 버전이면 차이를 보여 준다. */
const isOverlay = p => !!(p && p.overlay && p.baseId);
function procBase(p){ return isOverlay(p) ? db.procedures.find(x => x.id === p.baseId && !x.clientId) || null : null; }
function procVerKey(p){ const b = procBase(p); return b ? `${b.ver || 1}.${p.ver || 1}` : String(p.ver || 1); }
function procVerStr(p){ const b = procBase(p); return b ? `공통 v${b.ver || 1} + 업체 v${p.ver || 1}` : `v${p.ver || 1}`; }
function bumpProc(p, text, from){
  p.ver = (p.ver || 1) + 1;
  p.history = [...(p.history || []), {at:nowIso(), by:me ? me.id : '', from:from || '', text, ver:p.ver}].slice(-50);
  p.updatedAt = nowIso();
}
/* 공통 단계 + 업체 층 → [{text, key, own, opt}] */
function composeSteps(base, ov){
  const bs = base.steps || [], skip = new Set(ov.skipSteps || []), opt = new Set(ov.optSteps || []);
  const out = bs.filter(s => !skip.has(stepKey(s))).map(s => {
    const o = opt.has(stepKey(s)) && !/\(필요 시\)$/.test(s);
    return {text:o ? s + ' (필요 시)' : s, key:stepKey(s), own:false, opt:o};
  });
  let lead = 0;
  (ov.addSteps || []).forEach(a => {
    const item = {text:a.text, key:stepKey(a.text), own:true};
    if(!item.key || out.some(x => x.key === item.key)) return;
    if(a.after === '^'){ out.splice(lead++, 0, item); return; }
    if(!a.after){ out.push(item); return; }
    let at = -1;
    for(let j = bs.findIndex(s => stepKey(s) === a.after); j >= 0 && at < 0; j--){ const k = stepKey(bs[j]); at = out.findIndex(x => x.key === k && !x.own); }   // 기준 단계를 이 업체가 안 하면 그 앞 단계 뒤
    if(at < 0){ out.splice(lead++, 0, item); return; }
    at++; while(at < out.length && out[at].own) at++;
    out.splice(at, 0, item);
  });
  return out;
}
const uniqDocs = a => a.filter((v, i) => a.findIndex(x => stepKey(x) === stepKey(v)) === i);
function materialize(ov){
  const b = procBase(ov); if(!b) return;
  ov.type = b.type;
  ov.steps = composeSteps(b, ov).map(x => x.text);
  ov.docs = uniqDocs([...splitDocs(b.docs), ...splitDocs(ov.xdocs)]).join(', ');
  ov.cautions = [ov.ownCautions, b.cautions ? `[공통] ${b.cautions}` : ''].filter(Boolean).join('\n');
  ov.laws = b.laws || ''; ov.reviewedAt = b.reviewedAt || '';
  ov.stepMeta = {...(b.stepMeta || {}), ...(ov.ownMeta || {})};
}
function refreshOverlays(){ if(db && db.procedures) db.procedures.filter(isOverlay).forEach(materialize); }
function overlaysOf(base){ return db.procedures.filter(p => isOverlay(p) && p.baseId === base.id); }

/* 단계 조건: '단계 | 완료: … | 자료: … | 담당: … | 예외: … | 시작: …' */
const META_KEYS = [['start', '시작'], ['done', '완료'], ['need', '자료'], ['who', '담당'], ['exc', '예외']];
function parseStepLines(text){
  const steps = [], meta = {};
  lines(text).forEach(l => {
    const [head, ...rest] = l.split(/\s+\|\s+/);
    const s = head.trim(); if(!s) return;
    steps.push(s);
    const m = {};
    rest.forEach(part => { const x = /^\s*(시작|완료|자료|담당|예외)\s*[:：]\s*(.+)$/.exec(part); if(x) m[META_KEYS.find(k => k[1] === x[1])[0]] = x[2].trim(); });
    if(Object.keys(m).length) meta[stepKey(s)] = m;
  });
  return {steps, meta};
}
function stepLine(s, meta){
  const m = (meta || {})[stepKey(s)];
  return s + (m ? META_KEYS.filter(([k]) => m[k]).map(([k, l]) => ` | ${l}: ${m[k]}`).join('') : '');
}
function stepMetaHTML(m){
  return m ? `<div class="hint step-meta">${META_KEYS.filter(([k]) => m[k]).map(([k, l]) => `<span>${l}: ${esc(m[k])}</span>`).join('')}</div>` : '';
}
function stepMetaOf(r, text){ const p = procFor(r); return p && p.stepMeta ? p.stepMeta[stepKey(text)] || null : null; }
function stepMetaTitle(m){ return m ? META_KEYS.filter(([k]) => m[k]).map(([k, l]) => `${l}: ${m[k]}`).join(' / ') : ''; }

/* 절차 단계 목록 HTML (업체 층이면 '업체' 표시·생략 단계 안내) */
function procStepsHTML(p, hlf = esc){
  const meta = p.stepMeta || {};
  if(!isOverlay(p)) return (p.steps || []).length ? `<ol>${p.steps.map(s => `<li>${hlf(s)}${stepMetaHTML(meta[stepKey(s)])}</li>`).join('')}</ol>` : '';
  const b = procBase(p), comp = b ? composeSteps(b, p) : [];
  const skipped = b ? (b.steps || []).filter(s => (p.skipSteps || []).includes(stepKey(s))) : [];
  return `<ol>${comp.map(x => `<li${x.own ? ' class="own"' : ''}>${x.own ? '<span class="tag own">업체</span> ' : ''}${hlf(x.text)}${stepMetaHTML(meta[x.key])}</li>`).join('')}</ol>
    ${skipped.length ? `<p class="hint">이 업체는 생략: ${skipped.map(esc).join(', ')}</p>` : ''}`;
}
function overlayHeadHTML(p){
  const b = procBase(p);
  return b ? `<p class="hint ov-base">업체 특이사항 — 공통 절차 <button class="linkish" data-man-open="${esc(b.id)}">${esc(b.title)}</button> 위에 덧붙임 · ${esc(procVerStr(p))}</p>` : '';
}

/* ---- 기록이 적용한 매뉴얼 버전 ---- */
function setProcVer(r, p){ if(p) r.procVer = {id:p.id, v:procVerKey(p), s:procVerStr(p), at:nowIso()}; }
function procVerHTML(r){
  if(r.status === '완료' || !r.procVer) return '';
  const p = db.procedures.find(x => x.id === r.procVer.id);
  if(!p) return '';
  const newer = procVerKey(p) !== r.procVer.v;
  return `<button class="tag${newer ? ' chk' : ''}" data-proc-diff="${esc(r.id)}" title="${newer ? `매뉴얼이 ${procVerStr(p)}로 바뀌었습니다 — 눌러서 차이 보기` : '적용한 매뉴얼 버전'}">매뉴얼 ${esc(r.procVer.s || '')}${newer ? ' · 새 버전' : ''}</button>`;
}
function openProcDiff(r){
  const p = db.procedures.find(x => x.id === (r.procVer || {}).id) || procFor(r);
  if(!p){ toast('연결된 매뉴얼이 없습니다.'); return; }
  const b = procBase(p), since = (r.procVer || {}).at || r.createdAt || '';
  const ck = (r.checklist || []).map(x => stepKey(x.text));
  const add = (p.steps || []).filter(s => !ck.includes(stepKey(s)));
  const gone = (r.checklist || []).filter(x => !/^\[점검\]/.test(x.text) && !(p.steps || []).some(s => stepKey(s) === stepKey(x.text))).map(x => x.text);
  const hist = [...(p.history || []).map(h => ({...h, who:'업체'})), ...(b ? (b.history || []).map(h => ({...h, who:'공통'})) : [])].filter(h => (h.at || '') > since).sort((x, y) => x.at < y.at ? 1 : -1);
  openDialog({title:`매뉴얼 차이 — ${r.caseNo || ''} ${r.title}`.trim(), saveLabel:'반영',
    body:`<p class="hint">이 업무는 ${esc((r.procVer || {}).s || '버전 기록 없음')}로 시작했습니다. 지금 매뉴얼은 <b>${esc(procVerStr(p))}</b>(${esc(p.title)})입니다. 진행 중 체크리스트는 자동으로 바뀌지 않으니, 필요한 단계만 골라 넣으세요.</p>
      ${hist.length ? `<h4>그 뒤 바뀐 내용</h4><ul>${hist.slice(0, 15).map(h => `<li><span class="hint">${esc(h.at.slice(0, 10))} ${esc(h.who)}${h.ver ? ' v' + h.ver : ''}</span> ${esc(h.text)}</li>`).join('')}</ul>` : ''}
      <h4>매뉴얼에 있고 이 체크리스트에 없는 단계</h4>
      ${add.length ? add.map((s, i) => `<label class="check"><input type="checkbox" name="add" value="${i}" checked> ${esc(s)}</label>`).join('') : '<p class="hint">없습니다.</p>'}
      ${gone.length ? `<h4>이 체크리스트에만 있는 단계 (그대로 둠)</h4><ul>${gone.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}`,
    onSave(fd){
      const pick = fd.getAll('add').map(Number).map(i => add[i]).filter(Boolean);
      if(pick.length){
        const cur = (r.checklist || []).slice(), ps = p.steps || [];
        pick.forEach(s => {                                                   // 매뉴얼에서 바로 앞 단계 뒤에 끼움
          const i = ps.findIndex(x => stepKey(x) === stepKey(s));
          let at = cur.length;
          for(let j = i - 1; j >= 0; j--){ const k = cur.findIndex(x => stepKey(x.text) === stepKey(ps[j])); if(k >= 0){ at = k + 1; break; } }
          cur.splice(at, 0, {text:s, done:false});
        });
        r.checklist = cur;
      }
      setProcVer(r, p);
      addHist(r, `매뉴얼 ${procVerStr(p)} 확인${pick.length ? ` — 단계 추가: ${pick.join(', ')}` : ''}`);
      r.updatedAt = nowIso();
      toast(pick.length ? `단계 ${pick.length}개를 넣었습니다.` : '새 버전을 확인함으로 표시했습니다.');
      return true;
    }});
}

/* ---- 업체 전용 절차 → 공통 절차 + 업체 특이사항 변환 (관리자) ---- */
function overlapOf(a, b){
  const x = new Set((a.steps || []).map(stepKey)), y = new Set((b.steps || []).map(stepKey));
  if(!x.size || !y.size) return 0;
  let n = 0; x.forEach(k => { if(y.has(k)) n++; });
  return n / Math.max(x.size, y.size);
}
function baseCandidates(p){
  return db.procedures.filter(x => !x.clientId && !isOverlay(x) && x.type === p.type).map(x => ({p:x, o:overlapOf(p, x)})).sort((a, b) => b.o - a.o);
}
function layerFrom(p, b){
  const bk = (b.steps || []).map(stepKey), ps = p.steps || [], pk = ps.map(stepKey);
  const addSteps = [];
  ps.forEach((s, i) => {
    if(bk.includes(stepKey(s))) return;
    let after = '^';
    for(let j = i - 1; j >= 0; j--){ if(bk.includes(pk[j])){ after = pk[j]; break; } }
    addSteps.push({text:s, after});
  });
  const skipSteps = (b.steps || []).filter(s => !pk.includes(stepKey(s))).map(stepKey);
  const optSteps = ps.filter(s => /\(필요 시\)$/.test(s) && bk.includes(stepKey(s)) && !(b.steps || []).some(x => stepKey(x) === stepKey(s) && /\(필요 시\)$/.test(x))).map(stepKey);
  const bd = splitDocs(b.docs).map(stepKey);
  const xdocs = splitDocs(p.docs).filter(d => !bd.includes(stepKey(d))).join(', ');
  const bc = new Set(lines(b.cautions).map(l => l.trim()));
  const ownCautions = lines(p.cautions).filter(l => !bc.has(l.trim())).join('\n');
  const ownMeta = {}; Object.entries(p.stepMeta || {}).forEach(([k, m]) => { if(!bk.includes(k) || JSON.stringify((b.stepMeta || {})[k]) !== JSON.stringify(m)) ownMeta[k] = m; });
  return {addSteps, skipSteps, optSteps, xdocs, ownCautions, ownMeta};
}
function convertToOverlay(p, baseId){
  const b = db.procedures.find(x => x.id === baseId);
  if(!b || isOverlay(p) || !p.clientId) return false;
  const L = layerFrom(p, b);
  p.legacy = {steps:p.steps || [], docs:p.docs || '', cautions:p.cautions || '', laws:p.laws || '', reviewedAt:p.reviewedAt || '', stepMeta:p.stepMeta || null, title:p.title, at:nowIso()};
  Object.assign(p, L, {overlay:true, baseId:b.id});
  materialize(p);
  bumpProc(p, `업체 전용 절차 → 공통 ‘${b.title}’ + 업체 특이사항으로 변환 (추가 ${L.addSteps.length} · 생략 ${L.skipSteps.length} · 필요 시 ${L.optSteps.length})`);
  return true;
}
function undoOverlay(p){
  if(!isOverlay(p) || !p.legacy) return false;
  const lg = p.legacy;
  ['overlay', 'baseId', 'addSteps', 'skipSteps', 'optSteps', 'xdocs', 'ownCautions', 'ownMeta', 'legacy'].forEach(k => delete p[k]);
  Object.assign(p, {steps:lg.steps, docs:lg.docs, cautions:lg.cautions, laws:lg.laws, reviewedAt:lg.reviewedAt, title:lg.title});
  if(lg.stepMeta) p.stepMeta = lg.stepMeta; else delete p.stepMeta;
  bumpProc(p, '업체 특이사항 → 업체 전용 절차로 되돌림');
  return true;
}
function convertSectionHTML(){
  if(!isAdmin()) return '';
  const list = db.procedures.filter(p => p.clientId && !isOverlay(p));
  if(!list.length) return '';
  const row = p => {
    const cs = baseCandidates(p), best = cs[0] && cs[0].o >= 0.3 ? cs[0].p.id : '';
    const L = best ? layerFrom(p, cs[0].p) : null;
    return `<tr><td>${esc(clientName(p.clientId))}</td><td>${esc(p.title)}<div class="hint">${esc(p.type)} · 단계 ${(p.steps || []).length}</div></td>
      <td>${cs.length ? `<select data-cv-base="${esc(p.id)}">${opts([['', '그대로 둠 (업체 고유 절차)'], ...cs.map(x => [x.p.id, `${x.p.title} — 겹침 ${Math.round(x.o * 100)}%`])], best)}</select>
        <div class="hint" data-cv-prev="${esc(p.id)}">${L ? `추가 ${L.addSteps.length} · 생략 ${L.skipSteps.length} · 추가 서류 ${splitDocs(L.xdocs).length}` : '겹치는 공통 절차가 적어 그대로 두기를 권합니다'}</div>` : '<span class="hint">같은 유형의 공통 절차 없음 — 그대로 둠</span>'}</td>
      <td>${cs.length ? `<button class="mini strong" data-cv-go="${esc(p.id)}">변환</button>` : ''}</td></tr>`;
  };
  return `<details class="pps cv-sec"><summary><b>업체 전용 절차 ${list.length}개 정리</b> <span class="hint">— 공통 절차와 겹치는 것은 ‘공통 + 업체 특이사항’으로 바꾸면 공통 절차가 고쳐질 때 업체 절차에도 반영됩니다(되돌리기 가능)</span></summary>
    <div class="table-wrap"><table class="grid"><thead><tr><th>업체</th><th>업체 전용 절차</th><th>공통 절차(겹침 많은 순)</th><th></th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>
    <p class="hint">시나리오가 다른 절차(예: 특정 품목·특정 거래 구조)는 ‘그대로 둠’이 맞습니다. 변환 전 내용은 절차 안에 보관되어 ‘되돌리기’로 복원됩니다.</p></details>`;
}

/* ---- 반영 대상 (업체 특이사항 / 공통) ---- */
function overlayFor(clientId, base){ return db.procedures.find(p => isOverlay(p) && p.clientId === clientId && p.baseId === base.id) || null; }
function newOverlay(clientId, base){
  const ov = {id:uid(), clientId, type:base.type, title:`${clientName(clientId)} — ${base.title}`, overlay:true, baseId:base.id, addSteps:[], skipSteps:[], optSteps:[], xdocs:'', ownCautions:'', ver:0, createdAt:nowIso(), updatedAt:nowIso()};   // 첫 반영 때 v1
  materialize(ov); db.procedures.push(ov);
  return ov;
}
function ppTargets(pp){
  const p = pp.procId ? db.procedures.find(x => x.id === pp.procId) : null, b = isOverlay(p) ? procBase(p) : (p && !p.clientId ? p : null);
  const out = [];
  if(p && p.clientId) out.push(['client', isOverlay(p) ? `업체 특이사항 (${clientName(pp.clientId)})` : `업체 전용 절차 (${p.title})`]);
  else if(b) out.push(['client', `업체 특이사항 (${clientName(pp.clientId)} — ${overlayFor(pp.clientId, b) ? '기존' : '새로'})`]);
  else out.push(['client', `업체 전용 절차 새로 (${clientName(pp.clientId)})`]);
  out.push(['common', b ? `공통 절차 (${b.title})` : `공통 절차 ${db.procedures.some(x => !x.clientId && x.type === pp.type) ? `(${db.procedures.find(x => !x.clientId && x.type === pp.type).title})` : '새로'}`]);
  return out;
}
/* 반영 대상 절차 정하기 (없으면 만듦) */
function ppTarget(pp, target){
  const p = pp.procId ? db.procedures.find(x => x.id === pp.procId) : null;
  const b = isOverlay(p) ? procBase(p) : (p && !p.clientId ? p : null);
  if(target === 'common'){
    if(b) return b;
    const c = db.procedures.find(x => !x.clientId && !isOverlay(x) && x.type === pp.type);
    if(c) return c;
    const n = {id:uid(), clientId:null, type:pp.type, title:`${pp.type} 처리 절차`, steps:[], docs:'', cautions:'', ver:1, createdAt:nowIso()};
    db.procedures.push(n); return n;
  }
  if(p && p.clientId) return p;
  if(b) return overlayFor(pp.clientId, b) || newOverlay(pp.clientId, b);
  const n = {id:uid(), clientId:pp.clientId || null, type:pp.type, title:`${clientName(pp.clientId)} ${pp.type} 절차`, steps:[], docs:'', cautions:'', ver:1, createdAt:nowIso()};
  db.procedures.push(n); return n;
}
/* 업체 층에 단계 추가·필요 시·서류·주의 반영 */
function applyToOverlay(ov, r, add, skip, docs, caution, tag){
  const b = procBase(ov), bs = (b && b.steps) || [], bk = bs.map(stepKey), changes = [];
  const rsteps = r ? (r.checklist || []).map(x => normStep(x.text)) : [];
  add.forEach(s => {
    const k = stepKey(s);
    if(bk.includes(k)){ ov.skipSteps = (ov.skipSteps || []).filter(x => x !== k); return; }     // 생략했던 공통 단계를 다시 함
    if((ov.addSteps || []).some(a => stepKey(a.text) === k)) return;
    const i = rsteps.findIndex(x => stepKey(x) === k);
    let after = '';                                                        // 기록에서 위치를 모르면 맨 끝
    if(i >= 0){ after = '^'; for(let j = i - 1; j >= 0; j--){ if(bk.includes(stepKey(rsteps[j]))){ after = stepKey(rsteps[j]); break; } } }
    ov.addSteps = [...(ov.addSteps || []), {text:s, after}];
  });
  if(add.length) changes.push(`업체 단계 추가: ${add.join(', ')}`);
  skip.forEach(s => {
    const k = stepKey(s);
    if(bk.includes(k)) ov.optSteps = [...new Set([...(ov.optSteps || []), k])];
    else ov.addSteps = (ov.addSteps || []).map(a => stepKey(a.text) === k && !/\(필요 시\)$/.test(a.text) ? {...a, text:a.text + ' (필요 시)'} : a);
  });
  if(skip.length) changes.push(`필요 시 단계로 변경: ${skip.join(', ')}`);
  if(docs.length){ ov.xdocs = uniqDocs([...splitDocs(ov.xdocs), ...docs]).join(', '); changes.push(`업체 필요 서류 추가: ${docs.join(', ')}`); }
  if(caution){ ov.ownCautions = (ov.ownCautions ? ov.ownCautions + '\n' : '') + `[${tag}] ${caution}`; changes.push('특이 사례를 업체 주의사항에 추가'); }
  materialize(ov);
  return changes;
}
function proposeFromRecord(r){
  db.procProposals = db.procProposals || [];
  if(db.procProposals.some(x => x.recId === r.id)) return null;
  const p = procFor(r);
  const steps = (r.checklist || []).filter(x => !/^\[점검\]/.test(x.text));
  const pp = {id:uid(), recId:r.id, caseNo:r.caseNo || '', clientId:r.clientId, type:r.type, procId:p ? p.id : null, at:nowIso(), by:me ? me.id : 'auto', status:'pending', add:[], skip:[], docs:[], caution:''};
  if(p){
    const pk = new Set((p.steps || []).map(stepKey)), rk = new Set(steps.map(x => stepKey(x.text)));
    pp.add = steps.filter(x => !pk.has(stepKey(x.text))).map(x => normStep(x.text));
    pp.skip = (p.steps || []).filter(s => rk.has(stepKey(s)) && steps.some(x => stepKey(x.text) === stepKey(s) && !x.done) && !/\(필요 시\)$/.test(s)).map(normStep);
    const pd = new Set(splitDocs(p.docs).map(stepKey));
    pp.docs = (r.docs || []).map(x => normStep(x.text)).filter(t => t && !pd.has(stepKey(t)));
  } else {
    pp.add = steps.map(x => normStep(x.text));
    pp.docs = (r.docs || []).map(x => normStep(x.text));
  }
  if(r.special && r.specialNote && !(r.reflected || []).length) pp.caution = r.specialNote.trim();
  if(!pp.add.length && !pp.skip.length && !pp.docs.length && !pp.caution) return null;
  if(!p && !pp.add.length) return null;                                  // 절차도 없고 단계도 없으면 만들 게 없음
  db.procProposals.push(pp);
  if(db.procProposals.length > 300) db.procProposals = db.procProposals.filter(x => x.status === 'pending').slice(-300);
  return pp;
}
function applyProposal(pp, pick){
  const r = db.records.find(x => x.id === pp.recId);
  const tag = `${today()}${pp.caseNo ? ' ' + pp.caseNo : ''}`;
  const add = pp.add.filter((_, i) => pick.add[i]), skip = pp.skip.filter((_, i) => pick.skip[i]), docs = pp.docs.filter((_, i) => pick.docs[i]);
  const caution = pp.caution && pick.caution ? pp.caution : '';
  if(!add.length && !skip.length && !docs.length && !caution) return false;
  const p = ppTarget(pp, pick.target || 'client');                      // 반영 대상: 업체 특이사항(기본) / 공통 절차 (11/13 b)
  let changes = [];
  if(isOverlay(p)) changes = applyToOverlay(p, r, add, skip, docs, caution, tag);
  else {
    if(add.length){                                                       // 기록에서의 위치를 살려, 바로 앞 단계 뒤에 끼워 넣는다
      const steps = [...(p.steps || [])], rsteps = r ? (r.checklist || []).map(x => normStep(x.text)) : [];
      add.filter(s => !steps.some(x => stepKey(x) === stepKey(s))).forEach(s => {
        const i = rsteps.findIndex(x => stepKey(x) === stepKey(s));
        let at = steps.length;
        for(let j = i - 1; j >= 0; j--){ const k = steps.findIndex(x => stepKey(x) === stepKey(rsteps[j])); if(k >= 0){ at = k + 1; break; } }
        steps.splice(at, 0, s);
      });
      p.steps = steps; changes.push(`단계 추가: ${add.join(', ')}`);
    }
    if(skip.length){ p.steps = (p.steps || []).map(s => skip.some(k => stepKey(k) === stepKey(s)) && !/\(필요 시\)$/.test(s) ? s + ' (필요 시)' : s); changes.push(`필요 시 단계로 변경: ${skip.join(', ')}`); }
    if(docs.length){ p.docs = uniqDocs([...splitDocs(p.docs), ...docs]).join(', '); changes.push(`필요 서류 추가: ${docs.join(', ')}`); }
    if(caution){ p.cautions = (p.cautions ? p.cautions + '\n' : '') + `[${tag}] ${caution}`; changes.push('특이 사례를 주의사항에 추가'); }
  }
  if(caution && r) r.reflected = [...(r.reflected || []), {procId:p.id, at:today()}];
  if(!changes.length) return false;
  bumpProc(p, changes.join(' / '), pp.caseNo || '');
  if(!p.clientId) refreshOverlays();
  pp.status = 'applied'; pp.doneAt = nowIso(); pp.target = pick.target || 'client'; pp.appliedTo = p.id;
  return true;
}
/* 절차가 없는 업체×업무유형: 완료 기록의 체크리스트에서 절반 이상 나온 단계로 초안 */
function draftFromRecords(clientId, type){
  const recs = db.records.filter(r => r.status === '완료' && r.clientId === clientId && r.type === type && (r.checklist || []).length);
  const cnt = new Map(), order = new Map();
  recs.forEach(r => r.checklist.forEach((x, i) => { const k = stepKey(x.text); if(!k || /^\[점검\]/.test(x.text)) return; cnt.set(k, (cnt.get(k) || 0) + 1); if(!order.has(k)) order.set(k, [i, normStep(x.text)]); }));
  const steps = [...cnt.entries()].filter(([, n]) => n >= Math.max(1, Math.ceil(recs.length / 2))).sort((a, b) => order.get(a[0])[0] - order.get(b[0])[0]).map(([k]) => order.get(k)[1]);
  return {steps, n:recs.length};
}

/* ---------- 통계 ---------- */
const dayDiff = (a, b) => (a && b) ? Math.round((Date.parse(b) - Date.parse(a)) / 864e5) : null;
function procStats(p){
  const recs = procRecords(p);
  const days = recs.map(r => dayDiff(r.startDate, r.date)).filter(x => x !== null && x >= 0);
  const toCustoms = recs.map(r => dayDiff(r.startDate, (r.stage || {}).accept || (r.stage || {}).customs)).filter(x => x !== null && x >= 0);
  const docCnt = {};
  recs.forEach(r => { const ts = new Set(); recFiles(r).forEach(f => docTypes(f.name).forEach(t => ts.add(t))); ts.forEach(t => docCnt[t] = (docCnt[t] || 0) + 1); });
  const docs = Object.entries(docCnt).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${Math.round(n / recs.length * 100)}%`);
  const sp = recs.filter(r => r.special).sort(byDateDesc);
  const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-';
  return {n:recs.length, avg:avg(days), avgCustoms:avg(toCustoms), last:recs.map(r => r.date).sort().slice(-1)[0] || '', docs, sp, spRate:recs.length ? Math.round(sp.length / recs.length * 100) : 0};
}

/* ---------- 화면 ---------- */
let manualQ = '', manualScope = '';   // manualScope: '' 전체, 'common' 공통 절차, 'client' 업체 전용 ('공통 절차' 메뉴를 매뉴얼 필터로 합침)
function proposalHTML(pp){
  const p = pp.procId ? db.procedures.find(x => x.id === pp.procId) : null, r = db.records.find(x => x.id === pp.recId);
  const box = (k, i, t) => `<label class="check"><input type="checkbox" data-pp-pick="${k}|${i}" checked> ${esc(t)}</label>`;
  return `<article class="pp" data-pp="${esc(pp.id)}">
    <div class="pp-head"><strong>${esc(p ? p.title : `새 절차: ${clientName(pp.clientId)} ${pp.type}`)}</strong> <span class="hint">${esc(pp.caseNo)} ${r ? esc(r.title) : ''} · ${esc(pp.at.slice(0, 10))}</span></div>
    ${pp.add.length ? `<div class="pp-sec"><span class="lbl">추가된 단계</span>${pp.add.map((t, i) => box('add', i, t)).join('')}</div>` : ''}
    ${pp.skip.length ? `<div class="pp-sec"><span class="lbl">이번에 하지 않은 단계 → '필요 시'로 표시</span>${pp.skip.map((t, i) => box('skip', i, t)).join('')}</div>` : ''}
    ${pp.docs.length ? `<div class="pp-sec"><span class="lbl">새 필요 서류</span>${pp.docs.map((t, i) => box('docs', i, t)).join('')}</div>` : ''}
    ${pp.caution ? `<div class="pp-sec"><span class="lbl">특이 처리 → 주의사항</span>${box('caution', 0, pp.caution.length > 160 ? pp.caution.slice(0, 160) + '…' : pp.caution)}</div>` : ''}
    <div class="btn-row"><label class="inline">반영 대상 <select data-pp-target>${opts(ppTargets(pp), 'client')}</select></label><button class="mini strong" data-pp-apply="${esc(pp.id)}">고른 항목 반영</button><button class="mini" data-pp-drop="${esc(pp.id)}" title="반영 안 함">반영 안 함</button></div>
  </article>`;
}
function manualHTML(p){
  const s = procStats(p);
  const reviewOld = !p.reviewedAt || daysLeft(p.reviewedAt) < -365;
  return `<section class="manual" data-man="${esc(p.id)}">
    <header><span class="tag type">${esc(p.type)}</span><h4>${esc(p.title)}</h4><span class="note">${p.clientId ? esc(clientName(p.clientId)) + (isOverlay(p) ? ' 특이사항' : ' 전용') : '공통'}</span><span class="tag" title="매뉴얼 버전 — 내용이 바뀔 때마다 올라갑니다">${esc(procVerStr(p))}</span>
      <span class="p-act"><button class="mini" data-man-print="${esc(p.id)}">인쇄</button>${isOverlay(p) && p.legacy && isAdmin() ? `<button class="mini" data-ov-undo="${esc(p.id)}" title="변환 전 업체 전용 절차로 되돌림">되돌리기</button>` : ''}<button class="mini" data-edit-proc="${esc(p.id)}">수정</button></span></header>
    ${overlayHeadHTML(p)}
    <p class="man-stat">완료 ${s.n}건${s.n ? ` · 평균 소요 ${s.avg}일${s.avgCustoms !== '-' ? ` (통관·수리까지 ${s.avgCustoms}일)` : ''} · 특이 ${s.spRate}% · 최근 ${esc(s.last)}` : ' · 아직 이 절차로 완료한 기록이 없습니다'}</p>
    ${(p.steps || []).length ? procStepsHTML(p) : '<p class="hint">단계가 없습니다.</p>'}
    ${!p.clientId && overlaysOf(p).length ? `<p class="hint">업체 특이사항 ${overlaysOf(p).length}곳: ${overlaysOf(p).map(o => `<button class="linkish" data-man-open="${esc(o.id)}">${esc(clientName(o.clientId))}</button>`).join(', ')} — 이 공통 절차를 고치면 함께 반영됩니다.</p>` : ''}
    <div class="man-grid">
      <div><span class="lbl">필요 서류</span>${esc(p.docs || '-')}${isOverlay(p) && p.xdocs ? `<div class="hint">업체 추가: ${esc(p.xdocs)}</div>` : ''}${s.docs.length ? `<div class="hint">실제로 받은 서류: ${esc(s.docs.slice(0, 6).join(', '))}</div>` : ''}</div>
      <div><span class="lbl">근거 법령</span>${p.laws ? lawLinesHTML(p) : '<span class="hint">미입력</span>'}<div class="hint${reviewOld ? ' bad' : ''}">최종 검토 ${esc(p.reviewedAt || '없음')} <button class="mini" data-man-review="${esc(p.id)}">오늘 검토함</button></div></div>
    </div>
    ${isOverlay(p) ? `${p.ownCautions ? `<div class="proc-caution"><strong>업체 주의</strong><p class="pre">${esc(p.ownCautions)}</p></div>` : ''}${(procBase(p) || {}).cautions ? `<div class="proc-caution common"><strong>공통 주의</strong><p class="pre">${esc(procBase(p).cautions)}</p></div>` : ''}`
      : p.cautions ? `<div class="proc-caution"><strong>주의</strong><p class="pre">${esc(p.cautions)}</p></div>` : ''}
    ${s.sp.length ? `<details><summary>특이 사례 ${s.sp.length}건</summary><ul>${s.sp.slice(0, 10).map(r => `<li><button class="linkish" data-edit-rec="${esc(r.id)}">${esc(r.caseNo || '')} ${esc(r.title)}</button> <span class="hint">${esc(r.date || '')}${causesOf(r).length ? ' · ' + esc(causesOf(r).join(', ')) : ''}</span>${r.specialNote ? `<div class="hint">${esc(r.specialNote.slice(0, 140))}</div>` : ''}</li>`).join('')}</ul></details>` : ''}
    ${(p.history || []).length ? `<details><summary>개정 이력 ${p.history.length}건</summary><ul>${p.history.slice().reverse().slice(0, 10).map(h => `<li><span class="hint">${esc(h.at.slice(0, 10))}${h.ver ? ' v' + h.ver : ''} ${esc(accountName(h.by))}${h.from ? ' · ' + esc(h.from) : ''}</span> ${esc(h.text)}</li>`).join('')}</ul></details>` : ''}
  </section>`;
}
function viewManual(){
  const pend = (db.procProposals || []).filter(x => x.status === 'pending');
  const q = manualQ.trim().toLowerCase();
  const ps = db.procedures.filter(p => (!manualScope || (manualScope === 'common' ? !p.clientId : !!p.clientId)) && (!q || hay(p.title, p.type, clientName(p.clientId), p.steps, p.docs, p.cautions, p.laws).includes(q)))
    .sort((a, b) => (!!a.clientId - !!b.clientId) || typeOrder(a.type) - typeOrder(b.type) || clientName(a.clientId).localeCompare(clientName(b.clientId)));
  // 절차 없는 업체×유형 중 완료 기록 2건 이상
  const combos = {};
  db.records.filter(r => r.status === '완료' && !procFor(r)).forEach(r => { const k = r.clientId + '|' + r.type; combos[k] = (combos[k] || 0) + 1; });
  const missing = Object.entries(combos).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 15);
  return `<header class="client-head"><div><h2>업무 매뉴얼</h2><p class="client-meta">절차마다 실제 처리 통계와 특이 사례, 근거 법령을 모았습니다. 업무를 완료하면 절차와 달랐던 점이 아래 '개정 제안'으로 쌓이고, 고른 항목만 반영됩니다.</p></div>
      <div class="client-act"><input type="search" id="manQ" value="${esc(manualQ)}" placeholder="절차·업체·법령 검색"><button class="ghost" data-law-check title="국가법령정보로 근거 법령의 공포·시행일을 확인 (7일마다 자동)">법령 시행일 확인</button><button class="primary" data-new-proc>절차 추가</button></div></header>
    <p class="hint">법령 확인 ${esc(db.settings.lawCheckedAt ? db.settings.lawCheckedAt.slice(0, 10) : '아직 없음')} · 근거 법령은 한 줄에 ‘법령명 제00조’ 형식으로 적고, 고시는 정식 명칭으로 적어야 찾아집니다.</p>
    <div class="chips" role="group" aria-label="적용 대상">${[['', '전체'], ['common', '공통 절차'], ['client', '업체 특이사항·전용']].map(([k, l]) => `<button class="chip${manualScope === k ? ' on' : ''}" data-man-scope="${k}">${l}<b>${db.procedures.filter(p => !k || (k === 'common' ? !p.clientId : !!p.clientId)).length}</b></button>`).join('')}${manualScope === 'common' ? '<button class="chip" data-new-proc data-client="">공통 절차 추가</button>' : ''}</div>
    ${pend.length ? `<section class="pps"><div class="sec-head"><h3>개정 제안 ${pend.length}건</h3></div><div class="card-grid tight">${pend.slice().reverse().map(proposalHTML).join('')}</div></section>` : ''}
    ${convertSectionHTML()}
    ${missing.length ? `<section class="pps"><div class="sec-head"><h3>절차서가 없는 업무</h3></div><ul>${missing.map(([k, n]) => { const [cid, ty] = k.split('|'); return `<li>${esc(clientName(cid))} · ${esc(ty)} <span class="hint">완료 ${n}건</span> <button class="mini" data-man-draft="${esc(k)}">완료 기록으로 초안 만들기</button></li>`; }).join('')}</ul></section>` : ''}
    ${ps.length ? `<div class="card-grid">${ps.map(manualHTML).join('')}</div>` : '<p class="empty">절차가 없습니다.</p>'}`;
}
function readPick(id){
  const pick = {add:{}, skip:{}, docs:{}, caution:false};
  const tg = document.querySelector(`[data-pp="${CSS.escape(id)}"] [data-pp-target]`); pick.target = tg ? tg.value : 'client';
  document.querySelectorAll(`[data-pp="${CSS.escape(id)}"] [data-pp-pick]`).forEach(el => { const [k, i] = el.dataset.ppPick.split('|'); if(k === 'caution') pick.caution = el.checked; else pick[k][i] = el.checked; });
  return pick;
}
function printManual(p){
  const s = procStats(p), w = window.open('', '_blank');
  if(!w){ toast('팝업이 막혀 있습니다. 이 사이트의 팝업을 허용하세요.'); return; }
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(p.title)}</title><style>body{font-family:sans-serif;margin:24mm 18mm;line-height:1.6;font-size:11pt}h1{font-size:16pt;margin:0 0 4pt}.m{color:#555;font-size:9.5pt}h2{font-size:12pt;margin:14pt 0 4pt;border-bottom:1px solid #999}pre{white-space:pre-wrap;font-family:inherit;margin:0}</style>
    <h1>${esc(p.title)}</h1><div class="m">${esc(p.type)} · ${p.clientId ? esc(clientName(p.clientId)) : '공통'} · 최종 수정 ${esc((p.updatedAt || '').slice(0, 10))} · 법령 검토 ${esc(p.reviewedAt || '없음')} · 완료 ${s.n}건, 평균 ${s.avg}일</div>
    ${isOverlay(p) && procBase(p) ? `<div class="m">업체 특이사항 — 공통 절차 ‘${esc(procBase(p).title)}’ 위에 덧붙임 · ${esc(procVerStr(p))}</div>` : `<div class="m">버전 ${esc(procVerStr(p))}</div>`}
    <h2>처리 단계</h2><ol>${(isOverlay(p) && procBase(p) ? composeSteps(procBase(p), p) : (p.steps || []).map(t => ({text:t, key:stepKey(t)}))).map(x => `<li>${x.own ? '[업체] ' : ''}${esc(x.text)}${(p.stepMeta || {})[x.key] ? `<br><span class="m">${esc(stepMetaTitle(p.stepMeta[x.key]))}</span>` : ''}</li>`).join('')}</ol>
    <h2>필요 서류</h2><p>${esc(p.docs || '-')}</p>
    ${p.laws ? `<h2>근거 법령</h2><pre>${esc(p.laws)}</pre>` : ''}
    ${p.cautions ? `<h2>주의사항</h2><pre>${esc(p.cautions)}</pre>` : ''}
    ${s.sp.length ? `<h2>특이 사례</h2><ul>${s.sp.slice(0, 10).map(r => `<li>${esc(r.date || '')} ${esc(r.caseNo || '')} ${esc(r.title)}${r.specialNote ? `<br><span class="m">${esc(r.specialNote.slice(0, 200))}</span>` : ''}</li>`).join('')}</ul>` : ''}`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

/* 화면을 그릴 때마다 업체 특이사항을 공통 절차와 합쳐 둠 (다른 PC에서 공통 절차가 바뀌어 동기화된 경우 포함) */
const renderBase3 = render;
render = function(){ refreshOverlays(); return renderBase3(); };
document.addEventListener('click', e => {
  if(!db || e.target.closest('dialog')) return;
  const cv = e.target.closest('[data-cv-go]');
  if(cv){
    const p = db.procedures.find(x => x.id === cv.dataset.cvGo), sel = document.querySelector(`[data-cv-base="${CSS.escape(cv.dataset.cvGo)}"]`);
    if(!p || !sel) return;
    if(!sel.value){ toast('그대로 두기로 했습니다. 바꾸려면 공통 절차를 고르세요.'); return; }
    const b = db.procedures.find(x => x.id === sel.value), L = layerFrom(p, b);
    if(!confirm(`‘${p.title}’을(를) 공통 ‘${b.title}’ + 업체 특이사항으로 바꿉니다.\n업체 추가 단계 ${L.addSteps.length}개, 이 업체는 안 하는 공통 단계 ${L.skipSteps.length}개, 추가 서류 ${splitDocs(L.xdocs).length}개.\n앞으로 공통 절차가 고쳐지면 이 업체 절차에도 반영됩니다. 진행할까요?`)) return;
    if(convertToOverlay(p, b.id)){ commit(); toast('업체 특이사항으로 바꿨습니다. 매뉴얼에서 결과를 확인하세요.'); }
    return;
  }
  const un = e.target.closest('[data-ov-undo]');
  if(un){ const p = db.procedures.find(x => x.id === un.dataset.ovUndo); if(p && confirm(`‘${p.title}’을(를) 변환 전 업체 전용 절차로 되돌릴까요?`) && undoOverlay(p)){ commit(); toast('되돌렸습니다.'); } return; }
  const nv = e.target.closest('[data-new-ov]');
  if(nv){ openOverlay(null, {clientId:nv.dataset.client || ''}); return; }
  const df = e.target.closest('[data-proc-diff]');
  if(df){ const r = db.records.find(x => x.id === df.dataset.procDiff); if(r) openProcDiff(r); return; }
});
document.addEventListener('change', e => {
  const sel = e.target.closest && e.target.closest('[data-cv-base]'); if(!sel || !db) return;
  const p = db.procedures.find(x => x.id === sel.dataset.cvBase), b = db.procedures.find(x => x.id === sel.value), out = document.querySelector(`[data-cv-prev="${CSS.escape(sel.dataset.cvBase)}"]`);
  if(!out) return;
  if(!b){ out.textContent = '업체 고유 절차로 그대로 둡니다.'; return; }
  const L = layerFrom(p, b);
  out.textContent = `추가 ${L.addSteps.length}${L.addSteps.length ? ` (${L.addSteps.slice(0, 3).map(a => a.text).join(', ')}${L.addSteps.length > 3 ? '…' : ''})` : ''} · 생략 ${L.skipSteps.length} · 추가 서류 ${splitDocs(L.xdocs).length}`;
});
