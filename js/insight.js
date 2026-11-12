'use strict';
/* ---------- 주의 경고·업체 특이사항 문장·검토 결과 DB 반영·안정성 보강 (11/13 d) ----------
   ① 업체 특이사항 자동 문장(clientInsights): 최근 12개월 기록의 정정 원인·검사·특이 처리·[유의]·필증 업체 다름·정산 방식을 문장으로.
      업체 화면 위, 업무 기록 창의 주의 상자, 1차 검토 요청문에 쓰인다.
   ② 주의 업체·품목 경고: 업무 기록 창 맨 위에 주의·관심 업체 이유 + 특이사항 문장 + 품목 위험도 + 신고 전 점검(점검표 추가).
      품목 위험도(itemRisk, 별 0~3): 최근 24개월 그 품목 기록의 정정·보완, 검사·검역, 세관장확인 대상, 열린 확인 알림.
   ③ 관세사 확인한 1차 검토 → 세관 질의 DB(‘BSGC 관세사 검토’)와 품목 DB(HS·요건·메모)에 반영. 확인함에 '반영 안 함' 검토 목록.
   ④ 안정성: Drive와 이 PC의 데이터 열쇠가 다르면(mismatch) 로그인 직후 바로 안내 창. 수집 상태를 Apps Script에도 남겨 모든 PC 것을 함께 본다. */

/* ---- ① 업체 특이사항 문장 ---- */
let insCache = {stamp:'', res:new Map()};
const INSP_RE = /검사|검역|정밀/;
const NO_REQ = /^\s*(해당\s*(사항\s*)?없음|없음|비대상|요건\s*없음|-)/;   // '해당 없음' 같은 줄은 요건으로 보지 않음
function recInspected(r){
  const u = r.unipass || {};
  return causesOf(r).includes('검사·검역 불합격') || u.ldp === '검사대상' || (typeof PH_INSP !== 'undefined' && PH_INSP.test([u.last, u.cscl, u.stts].join(' '))) || INSP_RE.test((r.tags || []).join(' ')) || (r.phase && r.phase.k === 'insp');
}
function clientInsights(c){
  if(!c) return [];
  const stamp = (db.meta.updatedAt || '') + '|' + db.records.length;
  if(insCache.stamp !== stamp) insCache = {stamp, res:new Map()};
  if(insCache.res.has(c.id)) return insCache.res.get(c.id);
  const since = addPeriod(today(), -12, 'm');
  const recs = db.records.filter(r => r.clientId === c.id && recDate(r) >= since && !(typeof isUpdateRec === 'function' && isUpdateRec(r)));
  const out = [], put = (t, lvl) => out.push({t, lvl:lvl || 'info'});
  const done = recs.filter(r => r.status === '완료' && r.startDate && r.date);
  if(recs.length){
    const days = done.map(r => Math.round((Date.parse(r.date) - Date.parse(r.startDate)) / 864e5)).filter(d => d >= 0 && d < 365);
    put(`최근 12개월 ${recs.length}건${days.length >= 2 ? ` · 평균 처리 ${(days.reduce((a, b) => a + b, 0) / days.length).toFixed(1)}일` : ''}${c.settleMode === 'monthly' ? ' · 월 정산 업체' : ''}`);
  }
  const wc = recs.filter(r => causesOf(r).length);
  if(wc.length){
    const m = {}; wc.forEach(r => causesOf(r).forEach(k => m[k] = (m[k] || 0) + 1));
    const top = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 3);
    put(`정정·보완 ${wc.length}건(${Math.round(wc.length / recs.length * 100)}%) — 주로 ${top.map(([k, n]) => `${k} ${n}`).join(', ')}${CAUSE_HINTS[top[0][0]] ? `. 신고 전: ${CAUSE_HINTS[top[0][0]]}` : ''}`, wc.length >= 2 ? 'warn' : 'info');
  }
  const ins = recs.filter(recInspected);
  if(ins.length) put(`검사·검역 ${ins.length}건${recs.length >= 3 ? `(${Math.round(ins.length / recs.length * 100)}%)` : ''} — 일정에 검사 기간을 넉넉히 잡으세요`, ins.length >= 2 ? 'warn' : 'info');
  const sp = recs.filter(r => r.special && r.specialNote).sort(byDateDesc);
  if(sp.length) put(`특이 처리 ${sp.length}건 — 최근: “${String(sp[0].specialNote).split('\n')[0].slice(0, 70)}” (${recDate(sp[0])})`);
  const yu = [], seen = new Set();
  recs.slice().sort(byDateDesc).forEach(r => (r.checklist || []).forEach(x => { if(!/^\[유의\]/.test(x.text)) return; const t = x.text.replace(/^\[유의\]\s*/, '').replace(/\s*\((메일|검토)[^)]*\)\s*$/, ''); const k = stepKey(t).slice(0, 30); if(!seen.has(k)){ seen.add(k); yu.push(t); } }));
  if(yu.length) put(`메일·검토로 받은 유의사항: ${yu.slice(0, 2).map(t => `“${t.slice(0, 60)}”`).join(', ')}${yu.length > 2 ? ` 외 ${yu.length - 2}` : ''}`, 'warn');
  const cm = recs.filter(r => r.certMismatch).length;
  if(cm) put(`다른 업체 필증이 섞인 적 ${cm}건 — 필증의 수입자·수출화주를 확인하세요`, 'warn');
  const hold = recs.filter(r => (r.history || []).some(h => /대기 지정: 화주/.test(h.text || ''))).length;
  if(hold >= 2) put(`화주 회신·서류를 기다린 건 ${hold}건 — 서류 요청을 일찍 하세요`);
  insCache.res.set(c.id, out);
  return out;
}
function clientInsightHTML(c){
  const ins = clientInsights(c);
  if(!ins.length) return '';
  return `<section class="insight"><div class="sec-head"><h3>업체 특이사항 요약 <span class="hint">최근 12개월 기록에서 자동</span></h3></div><ul>${ins.map(x => `<li class="${x.lvl === 'warn' ? 'warn' : ''}">${esc(x.t)}</li>`).join('')}</ul></section>`;
}

/* ---- ② 품목 위험도 · 주의 상자 ---- */
function itemRisk(it){
  if(!it) return {score:0, reasons:[]};
  const since = addPeriod(today(), -24, 'm');
  const recs = db.records.filter(r => r.itemId === it.id && recDate(r) >= since);
  const corr = recs.filter(r => causesOf(r).length).length, insp = recs.filter(recInspected).length;
  let req = lines(it.reqs).some(l => !NO_REQ.test(l));
  try{ if(!req && it.ext && it.ext.ccct && (it.ext.ccct.list || []).length && typeof ccctSplit === 'function') req = ccctSplit(it.ext.ccct.list, it).rel.length > 0; }catch(e){}
  const al = openAlerts().filter(a => a.ttype === 'item' && a.tid === it.id).length;
  let score = 0; const reasons = [];
  if(corr){ score += corr >= 2 ? 2 : 1; reasons.push(`정정·보완 ${corr}건`); }
  if(insp){ score += 1; reasons.push(`검사·검역 ${insp}건`); }
  if(req){ score += 1; reasons.push('세관장확인·수입요건 있음'); }
  if(al){ score += 1; reasons.push(`확인 알림 ${al}건`); }
  return {score:Math.min(3, score), reasons, n:recs.length};
}
function itemRiskHTML(x){
  const list = Array.isArray(x) ? x : [x];
  const best = list.map(itemRisk).sort((a, b) => b.score - a.score)[0];
  if(!best || !best.score) return '';
  return ` <span class="risk r${best.score}" title="품목 위험도 (최근 24개월): ${esc(best.reasons.join(', '))}">${'★'.repeat(best.score)}${'☆'.repeat(3 - best.score)}</span>`;
}
function cautionBoxHTML(cid, itemId, rec){
  const c = db.clients.find(x => x.id === cid); if(!c) return '';
  if(rec && rec.status === '완료') return '';
  const cau = clientCaution(c), ins = clientInsights(c).filter(x => x.lvl === 'warn'), it = itemId ? db.items.find(i => i.id === itemId) : null, rk = itemRisk(it);
  const cc = clientCauses(c.id).list.slice(0, 3);
  if(cau.level === '보통' && !ins.length && rk.score < 2) return '';
  const hasChk = rec && (rec.checklist || []).some(x => /^\[점검\]/.test(x.text));
  return `<div class="caut-box ${cau.level === '주의' ? 'hi' : 'mid'}">
    <div><strong>${cau.level === '보통' ? '확인할 점' : `${esc(cau.level)} 업체`}</strong>${cau.level !== '보통' ? ` <span class="hint">${esc(cau.reasons.join(' · '))}</span>` : ''}</div>
    ${ins.length ? `<ul>${ins.slice(0, 4).map(x => `<li>${esc(x.t)}</li>`).join('')}</ul>` : ''}
    ${rk.score ? `<div>품목 위험도 <span class="risk r${rk.score}">${'★'.repeat(rk.score)}${'☆'.repeat(3 - rk.score)}</span> <span class="hint">${esc(it.name)} — ${esc(rk.reasons.join(', '))}</span></div>` : ''}
    ${cc.length && !hasChk ? `<div class="btn-row"><span class="hint">신고 전 점검: ${esc(cc.map(([k]) => k).join(', '))}</span><button type="button" class="mini strong" data-x="cautAddCheck">점검표 추가</button></div>` : ''}
  </div>`;
}

/* ---- ③ 검토 결과 → 세관 질의 DB·품목 DB ---- */
const RV_TOPIC_MAP = [[/품목\s*분류|hs/i, '품목분류'], [/요건|세관장/, '세관장확인·요건'], [/fta|원산지/i, '원산지·FTA'], [/과세\s*가격/, '과세가격'], [/정정|신고/, '정정·보정'], [/감면|환급/, '감면·환급'], [/검사|검역/, '검사·검역']];
function rvFields(draft){
  const s5 = rvSection(draft, 5), line = k => ((new RegExp(`${k}\\s*[:：]\\s*(.+)`).exec(s5) || [])[1] || '').trim();
  const kind = line('문의\\s*유형'), hsTxt = line('HS\\s*후보'), law = line('관련\\s*요건·?법령');
  const hs = (/\d{4}\.?\d{2}[.\-]?\d{2,4}/.exec(hsTxt) || [])[0] || '';
  const topic = (RV_TOPIC_MAP.find(([re]) => re.test(kind)) || [, '기타'])[1];
  return {s1:rvSection(draft, 1), s2:rvSection(draft, 2), kind, hsTxt, hs, law, topic};
}
function openReviewDb(key){
  const rv = (db.reviews || {})[key];
  if(!rv || !rv.draft){ toast('저장된 검토 초안이 없습니다.'); return; }
  const F = rvFields(rv.draft), rec = rv.recId ? db.records.find(r => r.id === rv.recId) : null, cid = rv.clientId || (rec ? rec.clientId : '');
  const items = db.items.filter(i => i.clientId === cid);
  const h6 = hsDigits(F.hs).slice(0, 6);
  const guess = (rec && rec.itemId && items.some(i => i.id === rec.itemId)) ? rec.itemId : (h6 ? (items.find(i => hsDigits(i.hs).startsWith(h6)) || {}).id : '') || '__new';
  const tag = `[${today()} 관세사 검토${rec && rec.caseNo ? ' ' + rec.caseNo : ''}]`;
  openDialog({title:'검토 결과를 DB에 반영', saveLabel:'반영',
    body:`<p class="hint">${esc(rv.subject || '')}${cid ? ' · ' + esc(clientName(cid)) : ''} — 관세사가 확인한 내용만 남기세요. 고칠 부분은 여기서 고쳐서 반영합니다.</p>
      <label class="check"><input type="checkbox" name="toInq" checked> <b>세관 질의 DB</b>에 남기기 <span class="hint">(세관: ‘BSGC 관세사 검토’ — 다음 검토·유사 업무에 참고 자료로 뜸)</span></label>
      <div class="row2"><label>분류<select name="topic">${opts(INQ_TOPICS, F.topic)}</select></label><label>HS<input name="hs" value="${esc(F.hs)}"></label></div>
      <label>문의 요지<textarea name="q" rows="3">${esc(F.s1 || rv.subject || '')}</textarea></label>
      <label>검토 결론<textarea name="a" rows="6">${esc(F.s2.slice(0, 2500))}</textarea></label>
      <label>근거 (법령·고시·사례)<textarea name="basis" rows="2">${esc(F.law)}</textarea></label>
      <label class="check"><input type="checkbox" name="toItem"${cid ? ' checked' : ' disabled'}> <b>품목 DB</b> 반영${cid ? '' : ' <span class="hint">(업체가 정해지지 않아 반영할 수 없습니다)</span>'}</label>
      ${cid ? `<div class="row2"><label>품목<select name="itemId">${opts([['__new', '새 품목으로 추가'], ...items.map(i => [i.id, `${i.name}${i.hs ? ' (' + i.hs + ')' : ''}`])], guess)}</select></label><label>새 품목명<input name="iname" value="${esc(rec && rec.itemId ? '' : String(rv.subject || '').replace(/^\s*(\[[^\]]*\]|re:|fw:|fwd:)\s*/ig, '').slice(0, 40))}" placeholder="새 품목일 때만"></label></div>
        <div class="row2"><label>품목 HS <span class="hint">(비어 있을 때만 넣음 — 다르면 메모에 남김)</span><input name="ihs" value="${esc(F.hs)}"></label><label>수입요건 추가<textarea name="ireq" rows="2">${esc(NO_REQ.test(F.law) ? '' : F.law)}</textarea></label></div>
        <label>메모 추가<input name="inote" value="${esc(`${tag} ${F.kind ? F.kind + ' — ' : ''}${F.hsTxt}`.slice(0, 200))}"></label>` : ''}`,
    onSave(fd){
      const toInq = !!fd.get('toInq'), toItem = !!fd.get('toItem') && !!cid;
      if(!toInq && !toItem){ toast('반영할 곳을 고르세요.'); return false; }
      const out = [];
      if(toInq){
        const q = String(fd.get('q') || '').trim();
        if(!q){ toast('문의 요지를 입력하세요.'); return false; }
        db.inquiries = db.inquiries || [];
        db.inquiries.push({id:uid(), date:today(), office:'BSGC 관세사 검토', officer:me ? me.name : '', topic:fd.get('topic'), clientId:cid, recId:rv.recId || '', hs:String(fd.get('hs') || '').trim(),
          question:q, answer:String(fd.get('a') || '').trim(), basis:String(fd.get('basis') || '').trim(), tags:['1차 검토', F.kind].filter(Boolean), src:'review', rvKey:key, createdAt:nowIso(), createdBy:me ? me.id : ''});
        out.push('세관 질의 DB');
      }
      if(toItem){
        const ihs = String(fd.get('ihs') || '').trim(), req = String(fd.get('ireq') || '').trim(), note = String(fd.get('inote') || '').trim();
        let it = db.items.find(i => i.id === fd.get('itemId'));
        if(!it){
          const nm = String(fd.get('iname') || '').trim(); if(!nm){ toast('새 품목명을 입력하세요.'); return false; }
          it = {id:uid(), clientId:cid, name:nm, hs:ihs, tariff:'', reqs:req, agency:'', notes:note, createdAt:nowIso(), createdBy:me ? me.id : ''}; db.items.push(it);
          if(rec && !rec.itemId){ rec.itemId = it.id; }
        } else {
          if(ihs && !it.hs) it.hs = ihs;
          const extra = ihs && it.hs && hsDigits(it.hs) !== hsDigits(ihs) ? ` (검토 HS 후보 ${ihs} — 지금 HS와 다름, 확인 필요)` : '';
          const cur = lines(it.reqs); lines(req).forEach(l => { if(!cur.some(x => stepKey(x) === stepKey(l))) cur.push(l); }); it.reqs = cur.join('\n');
          if(note || extra) it.notes = [it.notes, note + extra].filter(Boolean).join('\n');
          it.updatedAt = nowIso();
        }
        out.push(`품목 DB(${it.name})`);
      }
      rv.dbAt = today(); rv.dbBy = me ? me.id : '';
      if(rec){ addHist(rec, `1차 검토 결과 반영: ${out.join(', ')}`); rec.updatedAt = nowIso(); }
      toast(`${out.join('·')}에 반영했습니다.`);
    }});
}
/* 확인함: 관세사 확인했는데 DB 반영 안 한 검토 */
const checkGroupsBase5 = checkGroups;
checkGroups = function(){
  const g = checkGroupsBase5();
  const rvs = Object.values(db.reviews || {}).filter(x => x.status === 'done' && !x.dbAt && x.draft).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
  if(rvs.length) g.splice(Math.max(0, g.length - (g.some(x => x.k === 'run') ? 1 : 0)), 0, {k:'rvdb', title:'관세사 확인한 검토 — DB 반영 전', why:'세관 질의 DB·품목 DB에 남기면 다음 검토와 유사 업무에 참고로 뜹니다', rows:rvs.map(x => ({t1:x.subject || '(제목 없음)', t2:`${x.clientId ? clientName(x.clientId) : '업체 미지정'} · 확인 ${x.doneAt || ''}`, lvl:'ref',
    acts:`<button class="mini strong" data-rv-db="${esc(x.key)}">DB에 반영</button><button class="mini" data-rv-nodb="${esc(x.key)}">반영 안 함</button>`}))});
  return g;
};

/* ---- ④ 안정성: 열쇠 다름 바로 안내 · 수집 상태 서버 공유 ---- */
let misNoticed = false;
function showMismatchNotice(){
  if($('#dlg') && $('#dlg').open){ misNoticed = false; return; }                 // 다른 창이 열려 있으면 다음에
  openDialog({title:'이 PC와 Drive의 Workspace가 다릅니다', saveLabel:'합치기 화면 열기',
    body:`<p>이 PC에 저장된 Workspace와 Drive의 <code>data.enc.json</code>이 <b>서로 다른 데이터 열쇠</b>로 만들어져 있어 <b>자동 저장을 멈췄습니다</b>. 지금 이 PC에서 고친 내용은 다른 직원에게 보이지 않습니다.</p>
      <ul><li>다른 PC에서 ‘새 대장 만들기’를 했거나 예전 파일을 연 경우에 생깁니다.</li><li>‘합치기 화면 열기’ → Drive 쪽 계정으로 확인하면 이 PC 내용을 백업 파일로 받은 뒤 Drive 쪽 Workspace로 합칩니다.</li><li>지금 하지 않으려면 ‘취소’ — 오른쪽 위 ‘Drive 자동 저장 꺼짐’을 눌러 나중에 할 수 있습니다.</li></ul>`,
    onSave(){ setTimeout(() => { if(typeof openAdopt === 'function') openAdopt(); }, 80); return true; }});
}
const updateSaveStateBase5 = updateSaveState;
updateSaveState = function(){
  updateSaveStateBase5();
  if(!misNoticed && db && typeof sync !== 'undefined' && sync.state === 'mismatch' && sync.mis){ misNoticed = true; setTimeout(showMismatchNotice, 400); }
};
const PCID_LS = 'bsgc-pcid';
function pcId(){ try{ let v = localStorage.getItem(PCID_LS); if(!v){ v = uid(); localStorage.setItem(PCID_LS, v); } return v; }catch(e){ return 'pc-unknown'; } }
function pcLabel(){ const ua = navigator.userAgent || ''; return `${/Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : '기타'} · ${/Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : '브라우저'}`; }
let rsPostAt = 0, rsUnsupported = false, rsAll = {at:0, data:null, err:''};
async function postRunStat(){
  const cfg = (db && db.settings.mail) || {};
  if(!cfg.endpoint || !cfg.token || rsUnsupported) return;
  rsPostAt = Date.now();
  try{ const j = await syncPost(cfg, {op:'runstat', pc:pcId(), name:me ? me.name : '', label:pcLabel(), stat:runStat}); if(!j.ok && /알 수 없는 요청/.test(j.error || '')) rsUnsupported = true; }
  catch(e){}
}
const markRunBase5 = markRun;
markRun = function(k, ok, err){
  const wasFail = !!(runStat[k] && runStat[k].err);
  markRunBase5(k, ok, err);
  if(wasFail === !!ok || Date.now() - rsPostAt > 3 * 3600e3) postRunStat();      // 성공↔실패가 바뀌었거나 3시간마다
};
async function loadRunStatAll(){
  try{ const j = await collectApi({runstat:1}); rsAll = {at:Date.now(), data:j.pcs || {}, err:''}; }
  catch(e){ rsAll = {at:Date.now(), data:null, err:/알 수 없는 요청/.test(e.message) ? 'Apps Script를 새 버전으로 배포하면 다른 PC 기록도 보입니다(gs-deploy\\배포.bat).' : e.message}; }
  const el = $('#rsAll'); if(el) el.innerHTML = runStatAllHTML();
}
function runStatAllHTML(){
  if(!rsAll.at) return '<p class="hint">불러오는 중…</p>';
  if(rsAll.err) return `<p class="hint">${esc(rsAll.err)}</p>`;
  const pcs = Object.entries(rsAll.data || {}).sort((a, b) => (b[1].at || '').localeCompare(a[1].at || ''));
  if(!pcs.length) return '<p class="hint">아직 기록한 PC가 없습니다.</p>';
  const cell = s => !s ? '<span class="hint">-</span>' : s.err && (!s.ok || (s.fail || '') > s.ok) ? `<b class="bad" title="${esc(s.err)}">실패 ${esc(kstT(s.fail))}</b>` : s.ok ? `<span title="${esc(kstT(s.ok))}">${esc(ago(s.ok))}</span>` : '-';
  return `<div class="table-wrap"><table class="grid status-grid"><thead><tr><th>PC</th>${Object.values(RUN_KEYS).map(l => `<th>${esc(l.replace(/\s*\(.*\)/, ''))}</th>`).join('')}<th>마지막 보고</th></tr></thead><tbody>
    ${pcs.map(([id, p]) => `<tr${id === pcId() ? ' class="me-row"' : ''}><td>${esc(p.name || '')}${id === pcId() ? ' <span class="tag">이 PC</span>' : ''}<div class="hint">${esc(p.label || '')}</div></td>${Object.keys(RUN_KEYS).map(k => `<td>${cell((p.stat || {})[k])}</td>`).join('')}<td class="hint">${esc(ago(p.at))}</td></tr>`).join('')}
  </tbody></table></div>`;
}
const viewStatusBase5 = viewStatus;
viewStatus = function(){
  if(!rsAll.at || Date.now() - rsAll.at > 60e3) setTimeout(loadRunStatAll, 0);
  return viewStatusBase5() + `<section style="margin-top:1.5rem"><div class="sec-head"><h3>모든 PC</h3><span class="hint">각 PC가 Apps Script에 남긴 마지막 상태 (성공↔실패가 바뀔 때와 3시간마다 보고)</span></div><div id="rsAll">${runStatAllHTML()}</div></section>`;
};

document.addEventListener('click', e => {
  if(!db || e.target.closest('dialog')) return;
  const b = e.target.closest('[data-rv-db],[data-rv-nodb]'); if(!b) return;
  if('rvDb' in b.dataset) openReviewDb(b.dataset.rvDb);
  else { const rv = (db.reviews || {})[b.dataset.rvNodb]; if(rv){ rv.dbAt = 'skip'; commit(); toast('반영하지 않는 것으로 표시했습니다.'); } }
});
