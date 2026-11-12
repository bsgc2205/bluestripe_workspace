'use strict';
/* ---------- 케이스 화면 (구조 개편 2단계, 11/13 a) ----------
   ① 요약 줄: 단계(근거) · 다음 조치 · 대기 상대방(며칠째·재확인일) · 최근 활동 · 타임라인
   ② 대기 상대방 r.wait = {who, since, recheck, note, by, at} — 직접 지정. 없으면 근거로 추정(저장 안 함).
      재확인일이 지나면 '오늘 할 일'에 '재확인', 대기 중 상대 메일이 오면 '회신 옴'. 재확인일 전까지는 무변동 경고를 하지 않음.
   ③ 다음 조치 r.next = {t, at, by} — 직접 쓰면 그 문장, 비우면 단계·서류·체크리스트로 자동.
   ④ 타임라인: 메일·자료·단계·UNI-PASS·기한·대기·변경 이력을 시간순으로.
   ⑤ 상태·단계를 직접 바꿀 때 사유(이력에 남음): 기록 창 상태 변경, 보드 단계 옮기기, 단계 표시 취소. */
const WAIT_PARTY = {client:'화주(업체)', fwd:'포워더·선사', agency:'요건기관·검사', customs:'세관', internal:'우리(내부)', etc:'기타'};
const mmdd = s => String(s || '').slice(5, 10).replace('-', '/');
/* 이력 시각(UTC 'Z')을 메일과 같은 한국 시각 'YYYY-MM-DDTHH:MM'으로 */
const kst = at => /Z$|[+-]\d\d:\d\d$/.test(String(at || '')) ? new Date(at).toLocaleString('sv-SE', {timeZone:'Asia/Seoul'}).replace(' ', 'T').slice(0, 16) : String(at || '').replace(' ', 'T');

/* ---- 대기 상대방 ---- */
let replyCache = {stamp:'', map:new Map()};
function replyWaitOf(r){                                                 // 회신 대기 목록(우리가 보낸 요청에 답 없음)에서 이 기록 것
  if(!mailCache || typeof waitList !== 'function') return null;
  const stamp = mailCache.length + '|' + (db.meta.updatedAt || '');
  if(replyCache.stamp !== stamp){
    const map = new Map();
    try{ waitList().forEach(x => { if(x.rec && !map.has(x.rec.id)) map.set(x.rec.id, x); }); }catch(e){}
    replyCache = {stamp, map};
  }
  return replyCache.map.get(r.id) || null;
}
function partyOfAddr(r, addrs){
  const c = db.clients.find(x => x.id === r.clientId);
  const cm = ((c && c.contacts) || []).map(p => String(p.email || '').toLowerCase()).filter(e => e.includes('@'));
  const dom = cm.map(e => e.split('@')[1]);
  return addrs.some(a => cm.includes(a) || dom.includes(a.split('@')[1])) ? 'client' : 'fwd';
}
function autoWait(r){
  if(r.status === '완료' || r.status === '보류') return null;
  const rw = replyWaitOf(r);
  if(rw){
    const to = String([rw.last.to, rw.last.cc].join(' ')).toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || [];
    return {who:partyOfAddr(r, to.filter(a => !isOwn(a))), since:String(rw.last.date).slice(0, 10), note:`회신 대기: ${rw.last.subject || ''}`, auto:true};
  }
  const ph = recPhase(r).k;
  if(ph === 'docs'){ const miss = docStatus(r).list.filter(x => !x.ok).map(x => x.label); return {who:'client', since:r.startDate || '', note:`서류 대기: ${miss.slice(0, 3).join(', ')}`, auto:true}; }
  if(ph === 'insp') return {who:'agency', since:'', note:'검사·검역 결과 대기', auto:true};
  return null;
}
function waitOf(r){ return r.wait && r.wait.who ? r.wait : autoWait(r); }
function waitDays(w){ return w && w.since ? Math.max(0, -daysLeft(w.since)) : null; }
/* 대기 지정 뒤 상대(우리 직원이 아닌 사람) 메일이 왔는지 */
function waitReply(r){
  const w = r.wait;
  if(!w || !w.who || w.who === 'internal') return null;
  const since = w.at ? kst(w.at) : (w.since || '');   // 메일 날짜는 한국 시각 'YYYY-MM-DDTHH:MM'
  return (r.mails || []).filter(m => !isOwn(m.from) && String(m.date || '').replace(' ', 'T') > since).sort((a, b) => a.date < b.date ? 1 : -1)[0] || null;
}
/* 대기 중이고 재확인일 전 = 알고 기다리는 중 → 무변동 경고 안 함 */
function waitHold(r){ return !!(r.wait && r.wait.who && r.wait.recheck && r.wait.recheck > today()); }
function setWait(r, w){
  const old = r.wait;
  r.wait = {who:w.who, since:w.since || today(), recheck:w.recheck || '', note:w.note || '', by:me ? me.id : '', at:nowIso()};
  addHist(r, `대기 ${old && old.who ? '변경' : '지정'}: ${WAIT_PARTY[w.who] || w.who}${r.wait.recheck ? `, 재확인 ${r.wait.recheck}` : ''}${r.wait.note ? ` — ${r.wait.note}` : ''}`);
  r.updatedAt = nowIso();
}
function clearWait(r, why){
  if(!r.wait) return;
  addHist(r, `대기 해제: ${WAIT_PARTY[r.wait.who] || ''}${why ? ` (${why})` : ''}`);
  delete r.wait; r.updatedAt = nowIso();
}

/* ---- 다음 조치 ---- */
function nextAction(r){
  if(r.status === '완료') return {t:'', auto:true};
  if(r.next && r.next.t) return {t:r.next.t, auto:false, at:r.next.at, by:r.next.by};
  const st = stageOf(r), ph = recPhase(r).k, a = t => ({t, auto:true});
  if(r.status === '보류') return a('보류 — 재개 시점 확인');
  if(st.customsLv === 'chk' || st.acceptLv === 'chk') return a('필증·UNI-PASS로 수리 확인 (메일 글만 근거)');
  if(ph === 'fix') return a('보완·정정 요구 대응');
  if(ph === 'insp') return a('검사·검역 결과 확인');
  const io = ['I', 'E'].includes(caseCode(r.type));
  if(!(io && (st.customs || st.accept))){
    const miss = ['recv', 'docs'].includes(ph) ? docStatus(r).list.filter(x => !x.ok).map(x => x.label) : [];   // 직접 신고진행 이후로 옮겼으면 서류 대기로 보지 않음
    if(miss.length) return a(`서류 받기: ${miss.slice(0, 3).join(', ')}${miss.length > 3 ? ` 외 ${miss.length - 3}` : ''}`);
    const ck = (r.checklist || []).find(x => !x.done);
    if(ck) return a(ck.text);
  }
  if(!io) return a(caseCode(r.type) === 'C' ? '검토 의견 회신 후 완료 처리' : '완료 처리');
  if(!r.refNo && !(r.unipass || {}).dclrNo && !st.customs && !st.accept) return a(isExp(r) ? '수출신고' : '수입신고');
  if(isExp(r)){
    if(!st.accept) return a('수출신고 수리 확인');
    if(!st.customs){ const ld = (r.deadlines || []).find(x => x.kind === '수출물품 적재기한' && !x.done); return a(`선적 확인${ld ? ` (적재기한 ${mmdd(ld.due)})` : ''}`); }
  } else if(!st.customs) return a((r.unipass || {}).cleared ? '납부·반출 확인' : '수리 확인');
  if(!st.settle && settleMode(r) === 'each') return a('정산서 발송');
  return a('완료 처리');
}

/* ---- 단계 근거 ---- */
function phaseEvidence(r){
  const ph = recPhase(r), u = r.unipass || {}, ev = recEvents(r);
  if(!ph.auto) return `직접 지정${ph.by ? ' ' + accountName(ph.by) : ''}${ph.at ? ' ' + mmdd(ph.at) : ''}`;
  if(ph.k === 'accept'){ const e = ev.accept; return e ? `${e.src} ${mmdd(e.date)}` : ''; }
  if(ph.k === 'fix') return `UNI-PASS ${u.mdfy || u.last || u.cscl || ''}`.trim();
  if(ph.k === 'insp') return `UNI-PASS ${[u.last, u.ldp, u.condTxt].filter(Boolean).join(' · ')}`.trim();
  if(ph.k === 'decl'){ const e = ev.decl; return e ? `${e.src} ${mmdd(e.date)}` : '서류 모두 받음'; }
  const {list, extra} = docStatus(r);
  return list.length ? `서류 ${list.filter(x => x.ok).length}/${list.length}${extra.length ? ` (+${extra.length})` : ''}` : '';
}

/* ---- 최근 활동 ---- */
function lastActInfo(r){
  const c = [];
  (r.mails || []).forEach(m => c.push({at:String(m.date || ''), t:`${isOwn(m.from) ? '보낸' : '받은'} 메일 ‘${String(m.subject || '').slice(0, 40)}’`}));
  (r.files || []).forEach(f => f.date && c.push({at:String(f.date), t:`자료 ${f.name}`}));
  (r.history || []).forEach(h => c.push({at:kst(h.at), t:String(h.text || '').slice(0, 50)}));
  return c.filter(x => x.at).sort((a, b) => a.at < b.at ? 1 : -1)[0] || null;
}

/* ---- 요약 줄 ---- */
function caseSumHTML(r){
  if(r.status === '완료') return '';
  const ph = recPhase(r), nx = nextAction(r), w = waitOf(r), la = lastActInfo(r), evd = phaseEvidence(r), rep = waitReply(r);
  const wd = waitDays(w), due = w && w.recheck && w.recheck <= today();
  const waitTxt = w ? `<span class="cs-i${due ? ' bad' : ''}" title="${esc(w.note || '')}${w.auto ? ' (근거로 추정 — 직접 지정하면 고정)' : ''}">대기 <b>${esc(WAIT_PARTY[w.who] || w.who)}</b>${wd !== null ? ` ${wd}일째` : ''}${w.recheck ? ` · 재확인 ${mmdd(w.recheck)}` : ''}${w.auto ? ' <i>추정</i>' : ''}</span>` : '';
  return `<div class="case-sum">
    <span class="cs-i">단계 <b>${esc(phaseLabel(ph.k))}</b>${evd ? ` <span class="hint" title="단계 근거">(${esc(evd)})</span>` : ''}</span>
    <span class="cs-i cs-next">다음 <b>${esc(nx.t)}</b>${nx.auto ? '' : ' <i>직접</i>'}</span>
    ${waitTxt}${rep ? `<span class="cs-i ok">회신 옴 ${mmdd(rep.date)}</span>` : ''}
    ${la ? `<span class="cs-i hint" title="${esc(la.t)}">최근 ${esc(mmdd(la.at))} ${esc(la.t.slice(0, 30))}</span>` : ''}
    <span class="cs-act"><button class="linkish" data-cs-wait="${esc(r.id)}" title="누구를 기다리는지·재확인일·다음 조치를 적습니다">대기·다음 조치</button><button class="linkish" data-cs-tl="${esc(r.id)}">타임라인</button></span>
  </div>`;
}
function caseNextLine(r){
  if(r.status === '완료') return '';
  const nx = nextAction(r), w = waitOf(r);
  return `<div class="hint cs-mini">다음: ${esc(nx.t)}${w ? ` · 대기 ${esc(WAIT_PARTY[w.who] || '')}${waitDays(w) !== null ? ' ' + waitDays(w) + '일' : ''}` : ''}</div>`;
}

/* ---- 대기·다음 조치 창 ---- */
function openWaitDialog(r){
  const w = r.wait || {}, aw = !r.wait ? autoWait(r) : null, nx = nextAction(r);
  const def = w.recheck || addPeriod(today(), 2, 'd');
  openDialog({title:`대기·다음 조치 — ${r.caseNo || ''} ${r.title}`.trim(), saveLabel:'저장',
    body:`<p class="hint">누구의 회신·서류·결과를 기다리는지 적어 두면, 재확인일에 ‘오늘 할 일’에 다시 올라오고 그전까지는 무변동 경고를 하지 않습니다. 기다리는 동안 상대 메일이 오면 ‘회신 옴’으로 표시됩니다.</p>
      ${aw ? `<p class="hint">지금은 근거로 추정: ${esc(WAIT_PARTY[aw.who])} — ${esc(aw.note || '')}</p>` : ''}
      <div class="row2"><label>기다리는 상대<select name="who">${opts([['', '대기 없음'], ...Object.entries(WAIT_PARTY)], w.who || (aw ? aw.who : ''))}</select></label>
        <label>기다린 날부터<input type="date" name="since" value="${esc(w.since || (aw && aw.since) || today())}"></label></div>
      <div class="row2"><label>재확인일<input type="date" name="recheck" value="${esc(def)}"></label>
        <label>무엇을 기다리나<input name="note" value="${esc(w.note || (aw ? aw.note : ''))}" placeholder="예: 원산지증명서 원본, 검역 결과, 세관 보완 회신"></label></div>
      <label>다음 조치 <span class="hint">(비우면 단계·서류·체크리스트로 자동 — 지금 자동: ${esc(r.next && r.next.t ? '직접 입력 중' : nx.t)})</span><input name="next" value="${esc((r.next || {}).t || '')}" placeholder="예: 화주에게 FTA 원산지 사후 제출 안내"></label>`,
    onSave(fd){
      const who = fd.get('who'), nt = String(fd.get('next') || '').trim();
      if(who){
        const nw = {who, since:fd.get('since'), recheck:fd.get('recheck'), note:String(fd.get('note') || '').trim()};
        if(!r.wait || ['who', 'since', 'recheck', 'note'].some(k => (r.wait[k] || '') !== (nw[k] || ''))) setWait(r, nw);
      } else if(r.wait) clearWait(r, '직접 해제');
      if(nt !== ((r.next || {}).t || '')){
        if(nt){ r.next = {t:nt, at:today(), by:me ? me.id : ''}; addHist(r, `다음 조치: ${nt}`); }
        else { delete r.next; addHist(r, '다음 조치 직접 입력 지움(자동)'); }
        r.updatedAt = nowIso();
      }
      return true;
    }});
}

/* ---- 타임라인 ---- */
function timelineOf(r){
  const ev = [], st = r.stage || {}, u = r.unipass || {};
  const put = (at, kind, text, sub) => { if(at) ev.push({at:String(at), kind, text, sub:sub || ''}); };
  (r.mails || []).forEach(m => put(m.date, isOwn(m.from) ? '보낸 메일' : '받은 메일', m.subject || '(제목 없음)', `${m.fromName || m.from || ''}${(m.files || []).length ? ` · 첨부 ${m.files.length}` : ''}`));
  (r.files || []).forEach(f => put(f.date, '자료', f.name + (f.ver ? ` (v${f.ver})` : ''), ''));
  [['accept', '수리완료'], ['customs', stageName(r, 'customs')], ['settle', '정산완료']].forEach(([k, nm]) => st[k] && put(st[k], '단계', `${nm}${st[k + 'Lv'] === 'chk' ? ' (확인 필요)' : ''}`, st[k + 'By'] || ''));
  if(u.shedIn) put(u.shedIn, 'UNI-PASS', `반입 ${u.shedNm || u.shedSgn || ''}`.trim());
  if(u.clearedAt) put(u.clearedAt, 'UNI-PASS', '수입신고수리');
  if(u.paidAt) put(u.paidAt, 'UNI-PASS', '납부 확인');
  if(u.releasedAt) put(u.releasedAt, 'UNI-PASS', '반출신고');
  if(u.acceptedAt) put(u.acceptedAt, 'UNI-PASS', '수출신고수리');
  if(u.departAt) put(u.departAt, 'UNI-PASS', '선적(출항)');
  (r.deadlines || []).forEach(d => put(d.due, d.done ? '기한(처리)' : '기한', d.kind, d.due > today() ? '앞으로' : ''));
  (r.checklist || []).filter(x => x.done && x.doneAt).forEach(x => put(x.doneAt, '체크', x.text, x.auto || ''));
  (r.history || []).forEach(h => put(kst(h.at), '이력', h.text, h.by ? (h.by === 'auto' ? '자동' : accountName(h.by)) : '자동'));
  return ev.sort((a, b) => a.at < b.at ? 1 : a.at > b.at ? -1 : 0);
}
function openTimeline(r){
  const ev = timelineOf(r), kinds = [...new Set(ev.map(x => x.kind))];
  const fmt = s => s.length > 10 ? s.slice(0, 16).replace('T', ' ') : s;
  openDialog({title:`타임라인 — ${r.caseNo || ''} ${r.title}`.trim(), saveLabel:'닫기',
    body:`<div class="chips tl-chips">${['전체', ...kinds].map((k, i) => `<button type="button" class="chip${i ? '' : ' on'}" data-tl-k="${esc(k)}">${esc(k)}</button>`).join('')}</div>
      <ol class="timeline">${ev.map(x => `<li data-k="${esc(x.kind)}"><span class="tl-at">${esc(fmt(x.at))}</span><span class="tag">${esc(x.kind)}</span> ${esc(x.text)}${x.sub ? ` <span class="hint">${esc(x.sub)}</span>` : ''}</li>`).join('') || '<li class="empty">기록된 일이 없습니다.</li>'}</ol>`,
    onSave(){ return true; },
    onOpen(f){
      f.addEventListener('click', e => {
        const b = e.target.closest('[data-tl-k]'); if(!b) return;
        f.querySelectorAll('[data-tl-k]').forEach(x => x.classList.toggle('on', x === b));
        f.querySelectorAll('.timeline li[data-k]').forEach(li => { li.hidden = b.dataset.tlK !== '전체' && li.dataset.k !== b.dataset.tlK; });
      });
    }});
}

/* ---- 오늘 할 일 ---- */
function caseTodayItems(mine, recLine){
  const out = [];
  db.records.filter(r => r.status !== '완료' && r.wait && r.wait.who && mine(r)).forEach(r => {
    const w = r.wait, rep = waitReply(r), lbl = WAIT_PARTY[w.who] || w.who;
    if(rep) out.push({lvl:'chk', pri:1.5, kind:'회신 옴', title:`${lbl} 메일: ${rep.subject || ''}`, sub:`${recLine(r)}${w.note ? ' · 기다린 것: ' + w.note : ''}`,
      acts:`<button class="mini strong" data-cs-clear="${esc(r.id)}">대기 해제</button><button class="mini" data-cs-wait="${esc(r.id)}">대기 수정</button>`});
    else if(w.recheck && w.recheck <= today()) out.push({lvl:'act', pri:1.6, kind:'재확인', title:`${lbl} ${w.note || '회신'} — ${waitDays(w) ?? '-'}일째${w.recheck < today() ? ` (재확인일 ${mmdd(w.recheck)} 지남)` : ''}`, sub:recLine(r),
      acts:`<button class="mini strong" data-cs-later="${esc(r.id)}" title="재확인일을 2일 뒤로">2일 뒤 다시</button><button class="mini" data-cs-clear="${esc(r.id)}">대기 해제</button><button class="mini" data-edit-rec="${esc(r.id)}">기록</button>`});
  });
  return out;
}

/* ---- 상태·단계 변경 사유 ---- */
function askReason(what){
  const v = prompt(`${what} 사유를 적어 주세요 (이력에 남습니다. 비워도 됩니다)`, '');
  return v === null ? null : v.trim();
}

document.addEventListener('click', e => {
  if(!db || e.target.closest('dialog')) return;
  const b = e.target.closest('[data-cs-wait],[data-cs-tl],[data-cs-clear],[data-cs-later]'); if(!b) return;
  const d = b.dataset, r = db.records.find(x => x.id === (d.csWait || d.csTl || d.csClear || d.csLater)); if(!r) return;
  if('csWait' in d) openWaitDialog(r);
  else if('csTl' in d) openTimeline(r);
  else if('csClear' in d){ clearWait(r, waitReply(r) ? '회신 받음' : '직접 해제'); commit(); toast('대기를 해제했습니다.'); }
  else if('csLater' in d && r.wait){ r.wait.recheck = addPeriod(today(), 2, 'd'); addHist(r, `대기 재확인일 → ${r.wait.recheck}`); r.updatedAt = nowIso(); commit(); toast(`재확인일을 ${r.wait.recheck}로 미뤘습니다.`); }
});
