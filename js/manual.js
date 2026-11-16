'use strict';
/* ---------- 업무 매뉴얼(절차서) 자동 갱신 (G2) ----------
   - 완료된 기록을 절차와 비교해 '개정 제안'을 쌓는다: 추가된 단계, 건너뛴 단계, 새 필요 서류, 특이 처리 내용.
   - 관리자가 매뉴얼 화면에서 항목을 골라 반영하면 절차가 바뀌고 개정 이력이 남는다.
   - 절차가 없는 업체×업무유형은 완료 기록에서 자주 나온 단계로 초안을 만든다.
   - 매뉴얼마다 실제 처리 통계(건수, 평균 소요일, 자주 받은 서류, 특이 사례)와 근거 법령·최종 검토일을 보여 준다. */
const normStep = s => String(s || '').replace(/^\[점검\]\s*/, '').replace(/\s*\(필요 시\)$/, '').replace(/\s+/g, ' ').trim();
const stepKey = s => normStep(s).replace(/[\s.,·()\-]/g, '').toLowerCase();
/* 11/16 d: 체크리스트 상태 — 완료(done) · 해당 없음(na: 사유) · 미처리(둘 다 아님). 미처리로 완료한 단계는 매뉴얼 개정 근거로 쓰지 않음 */
const ckOpen = x => !!x && !x.done && !x.na;
const NA_WHY = {cond:'이번 건 조건에 해당 없음', other:'다른 담당자·업체가 처리', etc:'기타'};
/* 11/16 d: 매뉴얼 고르기 — ① 기록에 지정한 매뉴얼 ② 같은 업체·유형 중 적용 범위(수출: 통관만/물류 포함/부가업무)·적용 조건이 맞는 것 ③ 공통 ④ 같은 점수 후보가 여럿이면 기록에서 고르게 함 */
function procScore(p, sc, txt){
  let s = 0;
  if(p.scope){ if(!sc || p.scope !== sc) return -9; s += 2; }              // 범위를 정한 매뉴얼은 범위가 같은 업무에만
  const cw = String(p.cond || '').split(/[,;\n]/).map(x => x.trim().toLowerCase()).filter(x => x.length >= 2);
  if(cw.length) s += cw.some(w => txt.includes(w)) ? 3 : -1;               // 적용 조건 낱말이 제목·요약에 있으면 우선
  return s;
}
function procCands(r){
  const sc = isExp(r) && typeof recScope === 'function' ? recScope(r) : '', txt = `${r.title || ''} ${r.summary || ''} ${(r.tags || []).join(' ')}`.toLowerCase();
  const rank = ps => ps.map(p => ({p, s:procScore(p, sc, txt)})).filter(x => x.s > -9).sort((a, b) => b.s - a.s);
  const own = rank(db.procedures.filter(p => p.clientId && p.clientId === r.clientId && p.type === r.type));
  return own.length ? own : rank(db.procedures.filter(p => !p.clientId && p.type === r.type));
}
function procFor(r){
  const byId = r.procId && db.procedures.find(p => p.id === r.procId);
  if(byId && !byId.clientId && r.clientId){ const ov = db.procedures.find(p => p.overlay && p.baseId === byId.id && p.clientId === r.clientId); if(ov) return ov; }   // 공통 절차로 시작했어도 그 업체 특이사항이 있으면 그것 (11/13 b)
  if(byId) return byId;
  const c = procCands(r); return c.length ? c[0].p : null;
}
function procAmbig(r){                                                     // 지정 없이 같은 점수 후보가 둘 이상
  if(r.status === '완료' || (r.procId && db.procedures.some(p => p.id === r.procId))) return [];
  const c = procCands(r); return c.length > 1 && c[0].s === c[1].s ? c.filter(x => x.s === c[0].s).map(x => x.p) : [];
}
function procCondTxt(p){ return [p.scope && typeof SCOPE !== 'undefined' ? SCOPE[p.scope] : '', p.cond ? `조건: ${p.cond}` : ''].filter(Boolean).join(' · '); }
function procDocsExtra(p){                                                 // 조건부·참고 서류 (공통 + 업체 층)
  const b = isOverlay(p) ? procBase(p) || {} : {};
  return [...(b.docsCond || []), ...(p.docsCond || [])].map(d => ({text:d.text, cond:d.cond || '', cls:'cond'})).concat([...(b.docsRef || []), ...(p.docsRef || [])].map(t => ({text:t, cls:'ref'})));
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
  ov.laws = b.laws || ''; ov.reviewedAt = b.reviewedAt || ''; ov.lawReviewedAt = b.lawReviewedAt || ''; ov.reviewNeed = b.reviewNeed || null;
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
/* 업무 시작 때 적용한 매뉴얼: 버전 + 그때의 단계·서류 문구(r.procSnap). 나중에 새 버전을 '확인'(procSeen)한 것과 실제 '반영'(procApply)한 것은 따로 */
function setProcVer(r, p){
  if(!p) return;
  r.procVer = {id:p.id, v:procVerKey(p), s:procVerStr(p), at:nowIso()};
  r.procSnap = {v:procVerKey(p), s:procVerStr(p), title:p.title, steps:(p.steps || []).slice(), docs:p.docs || '', cond:procDocsExtra(p).map(d => d.text + (d.cond ? ` (${d.cond})` : '')), at:today()};
  delete r.procSeen;
}
function procVerHTML(r){
  if(r.status === '완료' || !r.procVer) return '';
  const p = db.procedures.find(x => x.id === r.procVer.id);
  if(!p) return '';
  const seen = r.procSeen || r.procVer, newer = procVerKey(p) !== seen.v;
  return `<button class="tag${newer ? ' chk' : ''}" data-proc-diff="${esc(r.id)}" title="${newer ? `매뉴얼이 ${procVerStr(p)}로 바뀌었습니다 — 눌러서 차이 보기` : '적용한 매뉴얼 버전'}">매뉴얼 ${esc(r.procVer.s || '')}${r.procSeen && r.procSeen.v !== r.procVer.v ? ` → ${esc(r.procSeen.s)} 확인` : ''}${newer ? ' · 새 버전' : ''}</button>`;
}
const DIFF_WHY = {'':'미반영 사유 고르기', na:'이번 건 해당 없음', done:'이미 처리함', next:'다음 건부터 적용'};
function openProcDiff(r){
  const p = db.procedures.find(x => x.id === (r.procVer || {}).id) || procFor(r);
  if(!p){ toast('연결된 매뉴얼이 없습니다.'); return; }
  const b = procBase(p), since = ((r.procSeen || r.procVer) || {}).at || r.createdAt || '';
  const ck = (r.checklist || []).map(x => stepKey(x.text));
  const add = (p.steps || []).filter(s => !ck.includes(stepKey(s)));
  const gone = (r.checklist || []).filter(x => !/^\[점검\]/.test(x.text) && !(p.steps || []).some(s => stepKey(s) === stepKey(x.text))).map(x => x.text);
  const hist = [...(p.history || []).map(h => ({...h, who:isOverlay(p) || p.clientId ? '업체' : '공통'})), ...(b ? (b.history || []).map(h => ({...h, who:'공통'})) : [])].filter(h => (h.at || '') > since).sort((x, y) => x.at < y.at ? 1 : -1);
  const snap = r.procSnap, ap = r.procApply || [];
  openDialog({title:`매뉴얼 차이 — ${r.caseNo || ''} ${r.title}`.trim(), saveLabel:'확인·반영',
    body:`<p class="hint">이 업무는 <b>${esc((r.procVer || {}).s || '버전 기록 없음')}</b>로 시작했습니다${r.procSeen ? ` (최근 확인 ${esc(r.procSeen.s)})` : ''}. 지금 매뉴얼은 <b>${esc(procVerStr(p))}</b>(${esc(p.title)})입니다. 진행 중 체크리스트는 자동으로 바뀌지 않습니다 — 넣을 단계만 고르고, 안 넣는 단계는 사유를 남기세요(확인한 것과 반영한 것을 따로 기록).</p>
      ${hist.length ? `<h4>그 뒤 바뀐 내용</h4><ul>${hist.slice(0, 15).map(h => `<li><span class="hint">${esc(h.at.slice(0, 10))} ${esc(h.who)}${h.ver ? ' v' + h.ver : ''}</span> ${esc(h.text)}</li>`).join('')}</ul>` : ''}
      <h4>매뉴얼에 있고 이 체크리스트에 없는 단계</h4>
      ${add.length ? add.map((s, i) => `<div class="diff-row"><label class="check"><input type="checkbox" name="add" value="${i}" checked> ${esc(s)}</label><select name="why${i}" class="mini-sel">${opts(Object.entries(DIFF_WHY), '')}</select></div>`).join('') : '<p class="hint">없습니다.</p>'}
      ${gone.length ? `<h4>이 체크리스트에만 있는 단계 (그대로 둠)</h4><ul>${gone.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
      ${snap ? `<details><summary>시작할 때 적용한 매뉴얼 (${esc(snap.s)} · ${esc(snap.at)})</summary><ol>${(snap.steps || []).map(t => `<li>${esc(t)}</li>`).join('')}</ol>${snap.docs ? `<p class="hint">서류: ${esc(snap.docs)}</p>` : ''}</details>` : ''}
      ${ap.length ? `<details><summary>이 건의 확인·반영 기록 ${ap.length}회</summary><ul>${ap.slice().reverse().map(a => `<li><span class="hint">${esc(a.at)} ${esc(accountName(a.by))} ${esc(a.s || '')}</span> 반영 ${a.add.length}${a.skip.length ? ` · 미반영 ${a.skip.map(x => `${x.text}(${DIFF_WHY[x.why] && x.why ? DIFF_WHY[x.why] : '사유 없음'})`).join(', ')}` : ''}</li>`).join('')}</ul></details>` : ''}`,
    onSave(fd){
      const picked = new Set(fd.getAll('add').map(Number)), pick = add.filter((_, i) => picked.has(i));
      const skip = add.map((t, i) => ({text:t, why:String(fd.get('why' + i) || '')})).filter((_, i) => !picked.has(i));
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
      if(!r.procVer) setProcVer(r, p);
      r.procSeen = {v:procVerKey(p), s:procVerStr(p), at:nowIso(), by:me ? me.id : ''};
      r.procApply = [...(r.procApply || []), {v:procVerKey(p), s:procVerStr(p), at:today(), by:me ? me.id : '', add:pick, skip}].slice(-10);
      addHist(r, `매뉴얼 ${procVerStr(p)} 확인 — 반영 ${pick.length}${pick.length ? `(${pick.join(', ')})` : ''}${skip.length ? ` · 미반영 ${skip.length}(${skip.map(x => `${x.text}: ${x.why ? DIFF_WHY[x.why] : '사유 없음'}`).join(', ')})` : ''}`);
      r.updatedAt = nowIso();
      toast(pick.length ? `단계 ${pick.length}개를 넣었습니다.` : '새 버전을 확인했습니다(반영한 단계 없음).');
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
/* 매뉴얼 후보가 여럿일 때 기록에서 고르기 (11/16 d) */
function procPickHTML(r){ const c = procAmbig(r); return c.length ? `<button class="tag chk" data-proc-pick="${esc(r.id)}" title="같은 업체·유형에 조건이 같은 매뉴얼이 ${c.length}개 — 이 건에 맞는 것을 고르세요">매뉴얼 후보 ${c.length} — 고르기</button>` : ''; }
function openProcPick(r){
  const c = procCands(r); if(!c.length){ toast('맞는 매뉴얼이 없습니다.'); return; }
  const cur = procFor(r);
  openDialog({title:`매뉴얼 고르기 — ${r.caseNo || ''} ${r.title}`.trim(), saveLabel:'이 매뉴얼로',
    body:`<p class="hint">업무 범위·적용 조건이 맞는 순서입니다. 고르면 이 건의 기준 매뉴얼이 되고(시작 시 내용 보존), 체크리스트에 없는 단계는 ‘매뉴얼 차이’에서 골라 넣습니다.</p>
      ${c.map((x, i) => `<label class="check"><input type="radio" name="pid" value="${esc(x.p.id)}"${(cur ? cur.id === x.p.id : !i) ? ' checked' : ''}> <b>${esc(x.p.title)}</b> <span class="hint">${esc(procVerStr(x.p))}${procCondTxt(x.p) ? ' · ' + esc(procCondTxt(x.p)) : ''} · 단계 ${(x.p.steps || []).length}</span></label>`).join('')}`,
    onSave(fd){
      const p = db.procedures.find(x => x.id === fd.get('pid')); if(!p) return false;
      r.procId = p.id;
      if(!(r.checklist || []).length) r.checklist = (p.steps || []).map(text => ({text, done:false}));
      setProcVer(r, p); addHist(r, `매뉴얼 지정: ${p.title} (${procVerStr(p)})`); r.updatedAt = nowIso();
      if((p.steps || []).some(s => !(r.checklist || []).some(x => stepKey(x.text) === stepKey(s)))) setTimeout(() => openProcDiff(r), 50);
      return true;
    }});
}
/* 완료 기록 → 매뉴얼 개정 제안 (11/16 d): 추가 단계는 실제로 처리(체크)한 것만, '필요 시' 제안은 '해당 없음 + 사유'로 표시한 단계만.
   체크하지 않은 채 완료한 단계(미처리)는 개정 근거로 쓰지 않고 개수만 남김. 받은 서류는 필수로 바로 올리지 않음(반영할 때 필수·조건부·참고 선택) */
function proposeFromRecord(r){
  db.procProposals = db.procProposals || [];
  if(db.procProposals.some(x => x.recId === r.id)) return null;
  const p = procFor(r);
  const steps = (r.checklist || []).filter(x => !/^\[점검\]/.test(x.text));
  const pp = {id:uid(), recId:r.id, caseNo:r.caseNo || '', clientId:r.clientId, type:r.type, procId:p ? p.id : null, at:nowIso(), by:me ? me.id : 'auto', status:'pending', add:[], skip:[], skipWhy:{}, docs:[], caution:'', undone:0};
  const naTxt = x => x.na.note || NA_WHY[x.na.why] || '';
  if(p){
    const pk = new Set((p.steps || []).map(stepKey)), byK = new Map(steps.map(x => [stepKey(x.text), x]));
    pp.add = steps.filter(x => x.done && !pk.has(stepKey(x.text))).map(x => normStep(x.text));
    (p.steps || []).forEach(st => {
      const x = byK.get(stepKey(st)); if(!x || /\(필요 시\)$/.test(st)) return;
      if(x.na){ const t = normStep(st); pp.skip.push(t); pp.skipWhy[stepKey(t)] = naTxt(x); }
      else if(!x.done) pp.undone++;
    });
    const pd = new Set([...splitDocs(p.docs), ...procDocsExtra(p).map(d => d.text)].map(stepKey));
    pp.docs = (r.docs || []).filter(x => !x.na).map(x => normStep(x.text)).filter(t => t && !pd.has(stepKey(t)));
  } else {
    pp.add = steps.filter(x => x.done).map(x => normStep(x.text));
    pp.undone = steps.filter(ckOpen).length;
    pp.docs = (r.docs || []).filter(x => !x.na).map(x => normStep(x.text));
  }
  if(r.special && r.specialNote && !(r.reflected || []).length) pp.caution = r.specialNote.trim();
  if(!pp.add.length && !pp.skip.length && !pp.docs.length && !pp.caution) return null;
  if(!p && !pp.add.length) return null;                                  // 절차도 없고 단계도 없으면 만들 게 없음
  db.procProposals.push(pp);
  if(db.procProposals.length > 300) db.procProposals = db.procProposals.filter(x => x.status === 'pending').slice(-300);
  return pp;
}
/* 개정 제안 묶기 (11/16 d): 같은 매뉴얼·같은 업체의 대기 제안을 한 카드로, 같은 내용은 한 줄로(근거 사건 수) */
function ppGroupKey(pp){ return `${pp.procId || 'new'}|${pp.clientId || ''}|${pp.type || ''}`; }
function ppGroups(){
  const g = new Map();
  (db.procProposals || []).filter(x => x.status === 'pending').forEach(pp => { const k = ppGroupKey(pp); if(!g.has(k)) g.set(k, {key:k, pps:[], items:[], undone:0}); g.get(k).pps.push(pp); });
  g.forEach(G => {
    const idx = new Map();
    const put = (kind, text, pp, why) => { const k = kind + '|' + (kind === 'caution' ? text : stepKey(text)); let it = idx.get(k); if(!it){ it = {kind, text, pps:[], why:[]}; idx.set(k, it); G.items.push(it); } if(!it.pps.includes(pp)) it.pps.push(pp); if(why && !it.why.includes(why)) it.why.push(why); };
    G.pps.forEach(pp => { (pp.add || []).forEach(t => put('add', t, pp)); (pp.skip || []).forEach(t => put('skip', t, pp, pp.skipWhy ? pp.skipWhy[stepKey(t)] : '예전 제안 — 체크하지 않은 단계라 근거가 약함')); (pp.docs || []).forEach(t => put('docs', t, pp)); if(pp.caution) put('caution', pp.caution, pp); G.undone += pp.undone || 0; });
    const ord = {add:0, skip:1, docs:2, caution:3}; G.items.sort((a, b) => ord[a.kind] - ord[b.kind] || b.pps.length - a.pps.length);
  });
  return [...g.values()].sort((a, b) => b.pps.length - a.pps.length || String(b.pps[0].at).localeCompare(String(a.pps[0].at)));
}
const PP_KIND = {add:'실제로 처리한 추가 단계', skip:'‘해당 없음’으로 표시한 단계 → ‘필요 시’(조건부) 단계로', docs:'매뉴얼에 없는 받은 서류 — 필수·조건부·참고 중 선택', caution:'특이 처리 → 주의사항'};
function ppGroupHTML(G){
  const pp0 = G.pps[0], p = pp0.procId ? db.procedures.find(x => x.id === pp0.procId) : null;
  const cases = it => it.pps.map(x => x.caseNo).filter(Boolean);
  const ev = it => `<span class="hint"> · 근거 ${it.pps.length}건${cases(it).length ? ` (${esc(cases(it).slice(0, 3).join(', '))}${cases(it).length > 3 ? ' …' : ''})` : ''}</span>`;
  const row = (it, i) => {
    const short = it.kind === 'caution' && it.text.length > 160 ? it.text.slice(0, 160) + '…' : it.text;
    return `<div class="pp-item"><label class="check"><input type="checkbox" data-ppg-pick="${i}"${it.kind === 'add' ? ' checked' : ''}> ${esc(short)}${ev(it)}</label>
      ${it.kind === 'skip' && it.why.length ? `<div class="hint">사유: ${esc(it.why.join(' / '))}</div>` : ''}
      ${it.kind === 'docs' ? `<div class="pp-dcls"><select data-ppg-dcls="${i}">${opts([['cond', '조건부'], ['ref', '참고'], ['req', '필수']], 'cond')}</select><input data-ppg-dcond="${i}" placeholder="필요한 경우 (예: 식품 접촉 품목)"></div>` : ''}</div>`;
  };
  const secs = ['add', 'skip', 'docs', 'caution'].map(k => { const xs = G.items.map((it, i) => [it, i]).filter(([it]) => it.kind === k); return xs.length ? `<div class="pp-sec"><span class="lbl">${PP_KIND[k]}</span>${xs.map(([it, i]) => row(it, i)).join('')}</div>` : ''; }).join('');
  return `<article class="pp" data-ppg="${esc(G.key)}">
    <div class="pp-head"><strong>${esc(p ? p.title : `새 절차: ${clientName(pp0.clientId)} ${pp0.type}`)}</strong> <span class="hint">${esc(clientName(pp0.clientId))} · 완료 ${G.pps.length}건에서 · 최근 ${esc(String(G.pps[G.pps.length - 1].at).slice(0, 10))}</span></div>
    ${secs}
    ${G.undone ? `<p class="hint">체크하지 않은 채 완료한 단계 ${G.undone}개는 ‘미처리’라 개정 근거로 쓰지 않았습니다.</p>` : ''}
    <p class="hint">단계 추가만 미리 골라 두었습니다. ‘필요 시’ 변경·서류·주의사항은 내용을 보고 고르세요.</p>
    <div class="btn-row"><label class="inline">반영 대상 <select data-ppg-target>${opts(ppTargets(pp0), 'client')}</select></label><button class="mini strong" data-ppg-apply="${esc(G.key)}">고른 항목 반영</button><button class="mini" data-ppg-drop="${esc(G.key)}">이 묶음 반영 안 함</button></div>
  </article>`;
}
function readGroupPick(key){
  const box = document.querySelector(`[data-ppg="${CSS.escape(key)}"]`), out = {items:{}, dcls:{}, dcond:{}, target:'client'};
  if(!box) return out;
  const tg = box.querySelector('[data-ppg-target]'); if(tg) out.target = tg.value;
  box.querySelectorAll('[data-ppg-pick]').forEach(el => out.items[el.dataset.ppgPick] = el.checked);
  box.querySelectorAll('[data-ppg-dcls]').forEach(el => out.dcls[el.dataset.ppgDcls] = el.value);
  box.querySelectorAll('[data-ppg-dcond]').forEach(el => out.dcond[el.dataset.ppgDcond] = el.value.trim());
  return out;
}
function applyGroup(key, pick){
  const G = ppGroups().find(x => x.key === key); if(!G) return false;
  const sel = G.items.map((it, i) => [it, i]).filter(([, i]) => pick.items[i]);
  const L = {add:sel.filter(([it]) => it.kind === 'add').map(([it]) => it.text), skip:sel.filter(([it]) => it.kind === 'skip').map(([it]) => ({text:it.text, why:it.why.join(' / ')})),
    docs:sel.filter(([it]) => it.kind === 'docs').map(([it, i]) => ({text:it.text, cls:pick.dcls[i] || 'cond', cond:pick.dcond[i] || ''})), caution:sel.filter(([it]) => it.kind === 'caution').map(([it]) => it.text).join('\n')};
  if(!L.add.length && !L.skip.length && !L.docs.length && !L.caution) return false;
  const pp0 = G.pps[0], src = G.pps.find(pp => (pp.add || []).length) || pp0, r = db.records.find(x => x.id === src.recId);
  const cs = G.pps.map(x => x.caseNo).filter(Boolean), from = cs.slice(0, 3).join(', ') + (cs.length > 3 ? ` 외 ${cs.length - 3}` : '');
  const tp = applyLists(pp0, r, L, pick.target || 'client', from);
  if(!tp) return false;
  if(L.caution) G.pps.filter(pp => pp.caution).forEach(pp => { const rr = db.records.find(x => x.id === pp.recId); if(rr) rr.reflected = [...(rr.reflected || []), {procId:tp.id, at:today()}]; });
  G.pps.forEach(pp => Object.assign(pp, {status:'applied', doneAt:nowIso(), target:pick.target || 'client', appliedTo:tp.id}));
  return true;
}
/* 반영: 단계 추가(기록에서의 위치 유지) · 필요 시(사유는 단계 예외 칸에) · 서류(필수/조건부/참고) · 주의사항 */
function applyLists(pp, r, L, target, from){
  const p = ppTarget(pp, target), tag = `${today()}${from ? ' ' + from : ''}`, changes = [];
  const meta = isOverlay(p) ? (p.ownMeta = p.ownMeta || {}) : (p.stepMeta = p.stepMeta || {});
  const noteExc = (t, why) => { if(!why) return; const k = stepKey(t), m = meta[k] || {}; if(!String(m.exc || '').includes(why)) meta[k] = {...m, exc:[m.exc, `해당 없던 경우: ${why}`].filter(Boolean).join('; ')}; };
  if(isOverlay(p)){
    const req = L.docs.filter(d => d.cls === 'req').map(d => d.text);
    changes.push(...applyToOverlay(p, r, L.add, L.skip.map(x => x.text), req, L.caution, tag));
  } else {
    if(L.add.length){
      const steps = [...(p.steps || [])], rsteps = r ? (r.checklist || []).map(x => normStep(x.text)) : [];
      L.add.filter(t => !steps.some(x => stepKey(x) === stepKey(t))).forEach(t => {
        const i = rsteps.findIndex(x => stepKey(x) === stepKey(t));
        let at = steps.length;
        for(let j = i - 1; j >= 0; j--){ const k = steps.findIndex(x => stepKey(x) === stepKey(rsteps[j])); if(k >= 0){ at = k + 1; break; } }
        steps.splice(at, 0, t);
      });
      p.steps = steps; changes.push(`단계 추가: ${L.add.join(', ')}`);
    }
    if(L.skip.length){ p.steps = (p.steps || []).map(t => L.skip.some(x => stepKey(x.text) === stepKey(t)) && !/\(필요 시\)$/.test(t) ? t + ' (필요 시)' : t); changes.push(`필요 시 단계로 변경: ${L.skip.map(x => x.text).join(', ')}`); }
    const req = L.docs.filter(d => d.cls === 'req').map(d => d.text);
    if(req.length){ p.docs = uniqDocs([...splitDocs(p.docs), ...req]).join(', '); changes.push(`필수 서류 추가: ${req.join(', ')}`); }
    if(L.caution){ p.cautions = (p.cautions ? p.cautions + '\n' : '') + `[${tag}] ${L.caution}`; changes.push('특이 사례를 주의사항에 추가'); }
  }
  L.skip.forEach(x => noteExc(x.text, x.why));
  const cond = L.docs.filter(d => d.cls === 'cond'), ref = L.docs.filter(d => d.cls === 'ref');
  if(cond.length){ p.docsCond = [...(p.docsCond || []).filter(d => !cond.some(c => stepKey(c.text) === stepKey(d.text))), ...cond.map(d => ({text:d.text, cond:d.cond}))]; changes.push(`조건부 서류: ${cond.map(d => d.text + (d.cond ? `(${d.cond})` : '')).join(', ')}`); }
  if(ref.length){ p.docsRef = uniqDocs([...(p.docsRef || []), ...ref.map(d => d.text)]); changes.push(`참고 서류: ${ref.map(d => d.text).join(', ')}`); }
  if(isOverlay(p)) materialize(p);
  if(!changes.length) return null;
  bumpProc(p, changes.join(' / '), from || '');
  if(!p.clientId) refreshOverlays();
  return p;
}
/* 체크리스트 '해당 없음' (11/16 d) */
function openCkNa(r, kind, i){
  const x = (kind === 'c' ? r.checklist : r.docs || [])[i]; if(!x) return;
  if(x.na){ delete x.na; r.updatedAt = nowIso(); addHist(r, `‘${x.text}’ 해당 없음 취소`); if(typeof openCk !== 'undefined') openCk.add(r.id); commit(); return; }
  openDialog({title:'이번 건에 해당 없음', saveLabel:'해당 없음으로 표시',
    body:`<p><b>${esc(x.text)}</b></p><p class="hint">체크하지 않은 채 완료한 단계는 ‘미처리’로 보고 매뉴얼 개정 근거로 쓰지 않습니다. 이번 건에 필요 없던 단계만 사유와 함께 표시하세요 — 매뉴얼에는 ‘필요 시’ 단계로 정리하자는 제안으로 올라갑니다(기본 미선택).</p>
      ${Object.entries(NA_WHY).map(([k, l], j) => `<label class="check"><input type="radio" name="why" value="${k}"${j ? '' : ' checked'}> ${esc(l)}</label>`).join('')}
      <label>어떤 경우에 필요한 단계인지 / 메모<input name="note" placeholder="예: 검역 대상 품목일 때만 · 포워더가 직접 처리"></label>`,
    onSave(fd){
      x.na = {why:fd.get('why') || 'cond', note:String(fd.get('note') || '').trim(), by:me ? me.id : '', at:today()}; x.done = false; x.doneAt = null; delete x.auto;
      r.updatedAt = nowIso(); if(typeof openCk !== 'undefined') openCk.add(r.id);
      addHist(r, `‘${x.text}’ 해당 없음 (${NA_WHY[x.na.why] || ''}${x.na.note ? ': ' + x.na.note : ''})`);
      return true;
    }});
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
/* 11/16 d 화면: 탭(매뉴얼 · 개정 제안 · 절차 없는 업무 · 전용 절차 정리) + 목록 20건 + 고른 매뉴얼 상세(처리 순서 → 서류 → 주의, 나머지는 접기) */
let manTab = 'list', manPage = 0, manSel = '', manType = '';
const MAN_PAGE = 20;
function procReviewState(p){
  const law = p.lawReviewedAt || p.reviewedAt || '';
  if(p.reviewNeed) return {k:'need', t:`재검토 필요 — ${p.reviewNeed.why || ''}`.trim()};
  if(!p.reviewedAt) return {k:'none', t:'내용 검토 기록 없음'};
  if(daysLeft(p.reviewedAt) < -365) return {k:'old', t:`내용 검토 ${p.reviewedAt} (1년 지남)`};
  return {k:'ok', t:`내용 검토 ${p.reviewedAt}${law && law !== p.reviewedAt ? ` · 법령 ${law}` : ''}`};
}
function manualHTML(p){
  const s = procStats(p), rv = procReviewState(p), ex = procDocsExtra(p), b = procBase(p);
  const caut = isOverlay(p) ? `${p.ownCautions ? `<div class="proc-caution"><strong>업체 주의</strong><p class="pre">${esc(p.ownCautions)}</p></div>` : ''}${(b || {}).cautions ? `<div class="proc-caution common"><strong>공통 주의</strong><p class="pre">${esc(b.cautions)}</p></div>` : ''}`
    : p.cautions ? `<div class="proc-caution"><strong>주의</strong><p class="pre">${esc(p.cautions)}</p></div>` : '';
  const revs = [...(p.reviews || []), ...(b ? (b.reviews || []).map(x => ({...x, base:true})) : [])].sort((x, y) => String(y.at).localeCompare(String(x.at)));
  return `<section class="manual man-detail" data-man="${esc(p.id)}">
    <header><button class="mini" data-man-sel="">← 목록</button><span class="tag type">${esc(p.type)}</span><h4>${esc(p.title)}</h4><span class="note">${p.clientId ? esc(clientName(p.clientId)) + (isOverlay(p) ? ' 특이사항' : ' 전용') : '공통'}</span><span class="tag" title="매뉴얼 버전 — 내용이 바뀔 때마다 올라갑니다">${esc(procVerStr(p))}</span><span class="kc-chip${rv.k === 'ok' ? '' : rv.k === 'need' ? ' bad' : ' warn'}">${esc(rv.t)}</span>
      <span class="p-act"><button class="mini" data-start-proc="${esc(p.id)}">이 절차로 업무 시작</button><button class="mini" data-man-print="${esc(p.id)}">인쇄</button>${isOverlay(p) && p.legacy && isAdmin() ? `<button class="mini" data-ov-undo="${esc(p.id)}" title="변환 전 업체 전용 절차로 되돌림">되돌리기</button>` : ''}<button class="mini" data-edit-proc="${esc(p.id)}">수정</button></span></header>
    ${overlayHeadHTML(p)}
    ${procCondTxt(p) ? `<p class="hint">적용 범위·조건: ${esc(procCondTxt(p))}</p>` : ''}
    <h5 class="man-h">처리 순서</h5>${(p.steps || []).length ? procStepsHTML(p) : '<p class="hint">단계가 없습니다.</p>'}
    <h5 class="man-h">필요 서류</h5>
    <div class="man-docs"><div><span class="lbl">필수</span> ${esc(p.docs || '-')}${isOverlay(p) && p.xdocs ? ` <span class="hint">(업체 추가: ${esc(p.xdocs)})</span>` : ''}</div>
      ${ex.filter(d => d.cls === 'cond').length ? `<div><span class="lbl">조건부</span> ${ex.filter(d => d.cls === 'cond').map(d => `${esc(d.text)}${d.cond ? ` <span class="hint">(${esc(d.cond)})</span>` : ''}`).join(', ')}</div>` : ''}
      ${ex.filter(d => d.cls === 'ref').length ? `<div><span class="lbl">참고</span> ${esc(ex.filter(d => d.cls === 'ref').map(d => d.text).join(', '))}</div>` : ''}</div>
    ${caut}
    ${!p.clientId && overlaysOf(p).length ? `<p class="hint">업체 특이사항 ${overlaysOf(p).length}곳: ${overlaysOf(p).map(o => `<button class="linkish" data-man-sel="${esc(o.id)}">${esc(clientName(o.clientId))}</button>`).join(', ')} — 이 공통 절차를 고치면 함께 반영됩니다.</p>` : ''}
    <details class="more fold"${rv.k === 'need' ? ' open' : ''}><summary>근거 법령 · 검토 기록</summary>
      ${p.laws ? lawLinesHTML(p) : '<p class="hint">근거 법령 미입력</p>'}
      <p class="hint">내용 검토 ${esc(p.reviewedAt || '없음')} · 법령 검토 ${esc(p.lawReviewedAt || p.reviewedAt || '없음')} · 법령 조회(국가법령정보) ${esc(db.settings.lawCheckedAt ? db.settings.lawCheckedAt.slice(0, 10) : '없음')} — 법령을 조회한 날은 내용을 검토한 날이 아닙니다.</p>
      <button class="mini" data-man-review="${esc(p.id)}">검토 기록 남기기</button>
      ${revs.length ? `<ul class="plain">${revs.slice(0, 8).map(x => `<li><span class="hint">${esc(String(x.at).slice(0, 10))} ${esc(accountName(x.by))}${x.base ? ' · 공통' : ''}</span> ${esc(REVIEW_SCOPE[x.scope] || x.scope)}${x.note ? ` — ${esc(x.note)}` : ''}</li>`).join('')}</ul>` : ''}</details>
    <details class="more fold"><summary>처리 통계 — 완료 ${s.n}건</summary><p class="man-stat">${s.n ? `평균 소요 ${s.avg}일${s.avgCustoms !== '-' ? ` (통관·수리까지 ${s.avgCustoms}일)` : ''} · 특이 ${s.spRate}% · 최근 ${esc(s.last)}` : '아직 이 절차로 완료한 기록이 없습니다'}</p>${s.docs.length ? `<p class="hint">실제로 받은 서류: ${esc(s.docs.slice(0, 8).join(', '))}</p>` : ''}</details>
    ${s.sp.length ? `<details class="more fold"><summary>특이 사례 ${s.sp.length}건</summary><ul>${s.sp.slice(0, 10).map(r => `<li><button class="linkish" data-edit-rec="${esc(r.id)}">${esc(r.caseNo || '')} ${esc(r.title)}</button> <span class="hint">${esc(r.date || '')}${causesOf(r).length ? ' · ' + esc(causesOf(r).join(', ')) : ''}</span>${r.specialNote ? `<div class="hint">${esc(r.specialNote.slice(0, 140))}</div>` : ''}</li>`).join('')}</ul></details>` : ''}
    ${(p.history || []).length ? `<details class="more fold"><summary>개정 이력 ${p.history.length}건</summary><ul>${p.history.slice().reverse().slice(0, 10).map(h => `<li><span class="hint">${esc(h.at.slice(0, 10))}${h.ver ? ' v' + h.ver : ''} ${esc(accountName(h.by))}${h.from ? ' · ' + esc(h.from) : ''}</span> ${esc(h.text)}</li>`).join('')}</ul></details>` : ''}
  </section>`;
}
function manualRowHTML(p){
  const rv = procReviewState(p), n = procRecords(p).length;
  return `<tr class="${manSel === p.id ? 'sel' : ''}"><td><button class="linkish" data-man-sel="${esc(p.id)}"><b>${esc(p.title)}</b></button>${isOverlay(p) && procBase(p) ? `<div class="hint">공통 ‘${esc(procBase(p).title)}’ 위에</div>` : ''}</td>
    <td>${esc(p.type)}</td><td>${p.clientId ? esc(clientName(p.clientId)) + (isOverlay(p) ? ' <span class="hint">특이사항</span>' : ' <span class="hint">전용</span>') : '공통'}</td>
    <td>${esc(procCondTxt(p) || '-')}</td><td>${esc(procVerStr(p))}</td><td><span class="kc-chip${rv.k === 'ok' ? '' : rv.k === 'need' ? ' bad' : ' warn'}">${esc(rv.k === 'ok' ? '검토 ' + p.reviewedAt : rv.k === 'need' ? '재검토 필요' : rv.k === 'old' ? '검토 1년 지남' : '검토 없음')}</span></td><td>${n}</td></tr>`;
}
function viewManual(){
  const groups = ppGroups(), pendN = groups.reduce((n, g) => n + g.pps.length, 0);
  const q = manualQ.trim().toLowerCase();
  const ps = db.procedures.filter(p => (!manualScope || (manualScope === 'common' ? !p.clientId : !!p.clientId)) && (!manType || p.type === manType) && (!q || hay(p.title, p.type, clientName(p.clientId), p.steps, p.docs, p.cautions, p.laws, p.cond).includes(q)))
    .sort((a, b) => (!!a.clientId - !!b.clientId) || typeOrder(a.type) - typeOrder(b.type) || clientName(a.clientId).localeCompare(clientName(b.clientId)));
  const combos = {};
  db.records.filter(r => r.status === '완료' && !procFor(r)).forEach(r => { const k = r.clientId + '|' + r.type; combos[k] = (combos[k] || 0) + 1; });
  const missing = Object.entries(combos).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 30);
  const cv = convertSectionHTML(), need = db.procedures.filter(p => p.reviewNeed).length;
  if(manTab === 'pp' && !groups.length) manTab = 'list';
  const tab = (k, l, n, act) => `<button class="tab${manTab === k ? ' on' : ''}${act ? ' act' : ''}" data-man-tab="${k}">${l}${n !== undefined ? ` <span class="cnt">${n}</span>` : ''}</button>`;
  const head = `<header class="client-head"><div><h2>업무 매뉴얼</h2><p class="client-meta">공통 절차 + 업체 특이사항 + 사건별 예외. 업무를 완료하면 실제로 처리한 단계와 ‘해당 없음’ 사유를 모아 개정 제안을 만듭니다(체크 안 한 단계는 근거로 쓰지 않음).</p></div>
      <div class="client-act"><input type="search" id="manQ" value="${esc(manualQ)}" placeholder="절차·업체·법령 검색"><button class="ghost" data-law-check title="국가법령정보로 근거 법령의 공포·시행일을 조회 (7일마다 자동) — 사람이 내용을 검토한 것과는 별개">법령 시행일 확인</button><button class="primary" data-new-proc>절차 추가</button><button class="ghost" data-new-ov>업체 특이사항 추가</button></div></header>
    <div class="tabs">${tab('list', '매뉴얼', ps.length)}${groups.length ? tab('pp', '개정 제안', pendN, true) : ''}${missing.length ? tab('missing', '절차 없는 업무', missing.length) : ''}${cv ? tab('conv', '전용 절차 정리') : ''}</div>`;
  if(manTab === 'pp') return head + `<p class="hint">같은 매뉴얼·같은 업체 제안은 한 카드로, 같은 내용은 한 줄로 묶었습니다(근거 사건 수). 반영하지 않은 항목은 묶음과 함께 정리됩니다.</p><div class="card-grid tight">${groups.map(ppGroupHTML).join('')}</div>`;
  if(manTab === 'missing') return head + `<section class="pps"><p class="hint">완료 기록이 2건 이상인데 매뉴얼이 없는 업체×업무 유형입니다. ‘초안 만들기’는 완료 기록에 절반 이상 나온 단계로 개정 제안을 만듭니다.</p><ul>${missing.map(([k, n]) => { const [cid, ty] = k.split('|'); return `<li>${esc(clientName(cid))} · ${esc(ty)} <span class="hint">완료 ${n}건</span> <button class="mini" data-man-draft="${esc(cid)}|${esc(ty)}">초안 만들기</button></li>`; }).join('')}</ul></section>`;
  if(manTab === 'conv') return head + cv.replace('<details class="pps cv-sec">', '<details class="pps cv-sec" open>');
  const sel = manSel && db.procedures.find(p => p.id === manSel);
  if(sel) return head + manualHTML(sel);
  if(manPage * MAN_PAGE >= ps.length) manPage = Math.max(0, Math.ceil(ps.length / MAN_PAGE) - 1);
  const types = [...new Set(db.procedures.map(p => p.type))].sort((a, b) => typeOrder(a) - typeOrder(b));
  return head + `<p class="hint">법령 조회 ${esc(db.settings.lawCheckedAt ? db.settings.lawCheckedAt.slice(0, 10) : '아직 없음')}${need ? ` · <b>재검토 필요 ${need}건</b>` : ''} · 근거 법령은 한 줄에 ‘법령명 제00조’ 형식으로 적고, 고시는 정식 명칭으로 적습니다.</p>
    <div class="chips" role="group" aria-label="적용 대상">${[['', '전체'], ['common', '공통 절차'], ['client', '업체 특이사항·전용']].map(([k, l]) => `<button class="chip${manualScope === k ? ' on' : ''}" data-man-scope="${k}">${l}</button>`).join('')}
      <select data-man-type aria-label="업무 유형">${opts([['', '모든 유형'], ...types.map(t => [t, t])], manType)}</select></div>
    ${ps.length ? `<div class="table-wrap"><table class="grid man-table"><thead><tr><th>매뉴얼</th><th>유형</th><th>대상</th><th>적용 범위·조건</th><th>버전</th><th>검토</th><th>완료</th></tr></thead><tbody>${ps.slice(manPage * MAN_PAGE, (manPage + 1) * MAN_PAGE).map(manualRowHTML).join('')}</tbody></table></div>${pagerHTML('man-page', manPage, ps.length, MAN_PAGE)}` : '<p class="empty">절차가 없습니다.</p>'}`;
}
const REVIEW_SCOPE = {all:'전체 내용·근거 법령 검토', body:'단계·서류 내용 검토', law:'근거 법령만 검토'};
function openManReview(p){
  const tgt = isOverlay(p) ? procBase(p) || p : p;
  openDialog({title:`검토 기록 — ${p.title}`, saveLabel:'기록',
    body:`<p class="hint">법령을 조회한 날과 사람이 내용을 검토한 날을 나눠 기록합니다. ‘근거 법령만’은 법령 개정 알림만 정리하고 내용 검토일은 바꾸지 않습니다.${isOverlay(p) ? ' 업체 특이사항의 근거 법령·검토일은 공통 절차를 따릅니다.' : ''}</p>
      ${Object.entries(REVIEW_SCOPE).map(([k, l], j) => `<label class="check"><input type="radio" name="scope" value="${k}"${j ? '' : ' checked'}> ${esc(l)}</label>`).join('')}
      <label>검토 메모 (무엇을 확인했는지)<input name="note" placeholder="예: 고시 개정 반영 여부 확인, 서류 목록 정리"></label>`,
    onSave(fd){
      const sc = fd.get('scope') || 'all', note = String(fd.get('note') || '').trim(), rec = {at:nowIso(), by:me ? me.id : '', scope:sc, note};
      p.reviews = [...(p.reviews || []), rec].slice(-20);
      if(tgt !== p) tgt.reviews = [...(tgt.reviews || []), {...rec, note:`${note}${note ? ' ' : ''}(${p.title})`}].slice(-20);
      if(sc !== 'law') tgt.reviewedAt = today();
      if(sc !== 'body'){ tgt.lawReviewedAt = today(); delete tgt.reviewNeed;
        openAlerts().filter(x => x.kind === 'law' && x.tid === tgt.id && !/^시행 예정/.test(x.title)).forEach(x => { x.status = 'done'; x.doneAt = nowIso(); x.doneBy = me ? me.id : ''; }); }
      tgt.history = [...(tgt.history || []), {at:nowIso(), by:me ? me.id : '', text:REVIEW_SCOPE[sc] + (note ? ` — ${note}` : '')}].slice(-50);
      if(!tgt.clientId) refreshOverlays();
      toast('검토 기록을 남겼습니다.');
      return true;
    }});
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
  const mt = e.target.closest('[data-man-tab]'); if(mt){ manTab = mt.dataset.manTab; manSel = ''; renderView(); return; }
  const ms = e.target.closest('[data-man-sel]'); if(ms){ manSel = ms.dataset.manSel; manTab = 'list'; renderView(); window.scrollTo(0, 0); return; }
  const mp = e.target.closest('[data-man-page]'); if(mp){ manPage = Math.max(0, Number(mp.dataset.manPage) || 0); renderView(); return; }
  const ga = e.target.closest('[data-ppg-apply]'); if(ga){ if(applyGroup(ga.dataset.ppgApply, readGroupPick(ga.dataset.ppgApply))){ commit(); toast('매뉴얼에 반영했습니다. 개정 이력에 남았습니다.'); } else toast('고른 항목이 없습니다.'); return; }
  const gd = e.target.closest('[data-ppg-drop]'); if(gd){ const G = ppGroups().find(x => x.key === gd.dataset.ppgDrop); if(G && confirm(`이 묶음(완료 ${G.pps.length}건의 제안)을 반영하지 않고 정리할까요?`)){ G.pps.forEach(pp => { pp.status = 'dropped'; pp.doneAt = nowIso(); }); commit(); } return; }
  const na = e.target.closest('[data-ck-na]'); if(na){ e.preventDefault(); const [rid, kind, i] = na.dataset.ckNa.split('|'), r = db.records.find(x => x.id === rid); if(r) openCkNa(r, kind, Number(i)); return; }
  const pk = e.target.closest('[data-proc-pick]'); if(pk){ const r = db.records.find(x => x.id === pk.dataset.procPick); if(r) openProcPick(r); return; }
  const nv = e.target.closest('[data-new-ov]');
  if(nv){ openOverlay(null, {clientId:nv.dataset.client || ''}); return; }
  const df = e.target.closest('[data-proc-diff]');
  if(df){ const r = db.records.find(x => x.id === df.dataset.procDiff); if(r) openProcDiff(r); return; }
});
document.addEventListener('change', e => {
  if(db && e.target.matches && e.target.matches('[data-man-type]')){ manType = e.target.value; manPage = 0; manSel = ''; renderView(); return; }
  const sel = e.target.closest && e.target.closest('[data-cv-base]'); if(!sel || !db) return;
  const p = db.procedures.find(x => x.id === sel.dataset.cvBase), b = db.procedures.find(x => x.id === sel.value), out = document.querySelector(`[data-cv-prev="${CSS.escape(sel.dataset.cvBase)}"]`);
  if(!out) return;
  if(!b){ out.textContent = '업체 고유 절차로 그대로 둡니다.'; return; }
  const L = layerFrom(p, b);
  out.textContent = `추가 ${L.addSteps.length}${L.addSteps.length ? ` (${L.addSteps.slice(0, 3).map(a => a.text).join(', ')}${L.addSteps.length > 3 ? '…' : ''})` : ''} · 생략 ${L.skipSteps.length} · 추가 서류 ${splitDocs(L.xdocs).length}`;
});
