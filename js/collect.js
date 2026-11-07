'use strict';
/* ---------- 자동 수집 (수입·수출 폴더 신규 업로드 + 메일 매칭) ---------- */
function collectApi(params){
  const cfg = db.settings.mail || {};
  if(!cfg.endpoint || !cfg.token) return Promise.reject(new Error('Apps Script 주소와 토큰이 없습니다'));
  const u = new URL(cfg.endpoint); u.searchParams.set('token', cfg.token);
  Object.entries(params).forEach(([k,v]) => u.searchParams.set(k, v));
  return fetch(u.href).then(r => r.json()).then(j => { if(!j.ok) throw new Error(j.error || '응답 오류'); return j; });
}
function matchClientText(text){ return findClient(text); }
function caseFromItems(c, group){
  const f = group[0], specials = [...new Set(group.flatMap(x => x.special || []))];
  const mail = group.find(x => x.mail) ? group.find(x => x.mail).mail : null;
  const links = [...new Set([...group.map(x => x.link), mail && mail.link].filter(u => safeUrl(u)))];
  return {
    id:uid(), clientId:c.id, type: f.kind === '수출' ? '수출신고' : f.kind === '수입' ? '수입통관' : /FTA/.test(f.kind) ? 'FTA원산지' : '기타', status:'완료',
    startDate: f.created, date: group.map(x => x.created).sort().slice(-1)[0],
    bl: f.bl || '', refNo: f.declNo || '', fee:null, itemId:'',
    title: ['수입','수출'].includes(f.kind) ? `[${f.kind}] ${f.bl || f.declNo || f.name.replace(/\.[^.]+$/, '')}` : `[${f.kind}] 자료 갱신 ${group.length}건 (${today()})`,
    summary: (mail ? `메일: ${mail.subject} (${mail.date})\n${mail.snippet || ''}\n` : '') + '자료: ' + group.map(x => x.name).join(', '),
    special: specials.length > 0,
    specialNote: specials.length ? `자동 수집에서 특이 절차로 보이는 자료가 확인됨: ${specials.join(', ')}. 내용을 확인해 무엇이 달랐는지 보완하세요.` : '',
    tags: ['자동수집', ...specials], links, checklist:[], docs:[], deadlines:[], reflected:[],
    files: group.map(x => ({id:x.id, name:x.name, link:x.link || '', date:x.created || ''})),
    createdAt: nowIso(), updatedAt: nowIso(), createdBy: 'auto'
  };
}
function applyCollected(items){
  db.collectSeen = db.collectSeen || []; db.collectPending = db.collectPending || [];
  const seen = new Set(db.collectSeen);
  const fresh = items.filter(x => !seen.has(x.id));
  if(!fresh.length) return null;
  const groups = {};
  let pend = 0;
  fresh.forEach(x => {
    const c = matchClientText(`${x.name} ${x.path} ${x.mail ? x.mail.subject : ''}`);
    if(!c){ db.collectPending.push(x); pend++; return; }
    const weekly = !['수입','수출'].includes(x.kind);
    const k = weekly ? c.id + '|' + x.kind + '|weekly|' + today() : c.id + '|' + x.kind + '|' + (x.bl || x.declNo || x.name);
    (groups[k] = groups[k] || {c, list:[]}).list.push(x);
  });
  let made = 0, sp = 0, upd = 0;
  Object.values(groups).forEach(({c, list}) => {
    const f = list[0];
    const weekly = !['수입','수출'].includes(f.kind);
    const ex = weekly ? null : db.records.find(r => r.clientId === c.id && ((f.bl && r.bl === f.bl) || (f.declNo && r.refNo === f.declNo)));
    if(ex){
      const nr = caseFromItems(c, list);
      ex.links = [...new Set([...(ex.links || []), ...nr.links])];
      addFiles(ex, list);
      if(nr.special && !ex.special){ ex.special = true; ex.specialNote = (ex.specialNote ? ex.specialNote + '\n' : '') + nr.specialNote; }
      ex.updatedAt = nowIso(); upd++;
    } else { const r = caseFromItems(c, list); db.records.push(r); made++; if(r.special) sp++; }
  });
  fresh.forEach(x => db.collectSeen.push(x.id));
  if(db.collectSeen.length > 5000) db.collectSeen = db.collectSeen.slice(-5000);
  return {made, sp, upd, pend};
}
async function runCollect(manual){
  try{
    if(manual){ toast('수입·수출 폴더와 BSGC-Backup 변동사항을 확인하는 중입니다…'); await collectApi({collect:1}); await collectApi({weekly:1}); }
    const j = await collectApi({inbox:1});
    const r = applyCollected(j.items || []);
    const s2 = applyStatus(j.status);
    if(r || s2){
      commit();
      const msg = [r && `새 케이스 ${r.made}건(특이 ${r.sp}건), 보완 ${r.upd}건, 미분류 ${r.pend}건`, s2 && `토스템 진행현황 ${s2.date} 반영(새 ${s2.made}건, 갱신 ${s2.upd}건)`].filter(Boolean).join(' / ');
      toast('자동 수집: ' + msg);
    } else if(manual) toast('새로 반영할 자료가 없습니다.');
  }catch(e){ if(manual) toast('자동 수집을 확인하지 못했습니다: ' + e.message); }
}
function viewInbox(){
  const pend = db.collectPending || [];
  return `<header class="client-head"><div><h2>자동 수집</h2><p class="client-meta">매일 08시 수입·수출 폴더, 매주 월요일 15시 BSGC-Backup 전체 변동사항과 토스템 주간 진행현황을 확인해 업체 기록으로 넣습니다. 업체를 알아보지 못한 자료만 여기 남습니다.${db.settings.statusDate ? ` 진행현황 반영 기준일 ${esc(db.settings.statusDate)}.` : ''}</p></div>
      <div class="client-act"><button class="primary" data-collect-now>지금 확인</button></div></header>
    ${pend.length ? `<div class="table-wrap" style="margin-top:1rem"><table class="grid"><thead><tr><th>자료</th><th>폴더</th><th>올린 날</th><th>메일</th><th>업체 지정</th></tr></thead><tbody>
      ${pend.map((x,i) => `<tr><td>${safeUrl(x.link) ? `<a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">${esc(x.name)}</a>` : esc(x.name)}${(x.special || []).length ? ` <span class="stamp sm">특이</span>` : ''}</td><td>${esc(x.kind)} / ${esc(x.path)}</td><td>${esc(x.created)}</td><td>${x.mail ? esc(x.mail.subject) : ''}</td>
        <td><div class="btn-row"><select data-pend-client="${i}"><option value="">업체 선택</option>${opts(sortedClients().map(c => [c.id, c.name]), '')}</select><button class="mini strong" data-pend-apply="${i}">반영</button><button class="mini" data-pend-drop="${i}">무시</button></div></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="empty">미분류 자료가 없습니다.</p>'}
    <p class="hint">업체를 자동으로 알아보려면 파일명이나 폴더명에 업체명이 들어가야 합니다. 업체 정보의 검색어(약칭)도 함께 씁니다.</p>`;
}
function applyStatus(st){
  if(!st || !st.date || !(st.rows || []).length) return null;
  if(db.settings.statusDate === st.date) return null;
  let made = 0, upd = 0;
  st.rows.forEach(x => {
    const c = db.clients.find(y => normName(y.name) === normName(x.owner)); if(!c) return;
    const stg = Object.entries(x.stages || {}).map(([k,v]) => `${k} ${v}`).join(', ');
    const doneNow = /완료/.test(x.done || '');
    const line = `[진행현황 ${st.date}] ${x.done || ''}${x.inDate ? `, 반입 ${x.inDate}` : ''}${x.wh ? `, ${x.wh}` : ''}${stg ? `, 단계: ${stg}` : ''}${x.bill ? `, 청구 ${x.bill}` : ''}${x.paid ? `, 입금 ${x.paid}` : ''}`;
    const extra = [x.note && `특이: ${x.note}`, x.req && `요청: ${x.req}`].filter(Boolean).join(' / ');
    const sp = /정밀|검역|검사|반송|보세|FTA|사후|D&D|FREE|프리|지연|보류/i.test(extra);
    let r = db.records.find(y => y.clientId === c.id && y.bl === x.bl);
    if(!r){
      r = {id:uid(), clientId:c.id, type:'수입통관', status: doneNow ? '완료' : '진행중', startDate: st.date, date: doneNow ? st.date : '', bl:x.bl, refNo:'',
        title:`[수입] ${x.partner || ''} ${x.bl}`.trim(), summary:'', special:false, specialNote:'', tags:['주간현황'], links: safeUrl(st.link) ? [st.link] : [],
        fee:null, itemId:'', checklist:[], docs:[], deadlines:[], reflected:[], createdAt:nowIso(), updatedAt:nowIso(), createdBy:'auto'};
      db.records.push(r); made++;
    } else upd++;
    r.summary = [line, extra, (r.summary || '').split('\n').filter(l => !l.startsWith('[진행현황')).join('\n')].filter(Boolean).join('\n');
    if(doneNow && r.status !== '완료'){ r.status = '완료'; r.date = r.date || st.date; }
    if(sp){ r.special = true; if(!(r.specialNote || '').includes(extra)) r.specialNote = ((r.specialNote ? r.specialNote + '\n' : '') + `${st.date}: ${extra}`); }
    r.updatedAt = nowIso();
  });
  db.settings.statusDate = st.date;
  return {made, upd, date: st.date};
}

function applyPending(i, cid){
  const x = db.collectPending[i], c = db.clients.find(y => y.id === cid);
  if(!x || !c){toast('업체를 고르세요.'); return;}
  const ex = db.records.find(r => r.clientId === c.id && ((x.bl && r.bl === x.bl) || (x.declNo && r.refNo === x.declNo)));
  if(ex){ ex.links = [...new Set([...(ex.links || []), x.link].filter(u => safeUrl(u)))]; addFiles(ex, [x]); }
  else db.records.push(caseFromItems(c, [x]));
  db.collectPending.splice(i, 1); commit(); toast(`${c.name} 기록으로 넣었습니다.`);
}
async function blInline(q){
  const el = $('#blInline'); if(!el) return;
  el.innerHTML = '<p class="hint">UNI-PASS 조회 중…</p>';
  try{ const j = await collectApi({bl:q.toUpperCase(), blType:'M', year:new Date().getFullYear()}); el.innerHTML = blResultHTML(j); }
  catch(e){ el.innerHTML = `<p class="msg">${esc(e.message)}</p>`; }
}
