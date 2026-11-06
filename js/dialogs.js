'use strict';
/* ---------- dialogs ---------- */
function openDialog({title, body, onSave, onDelete, onOpen, saveLabel = '저장'}){
  const dlg = $('#dlg');
  dlg.innerHTML = `<form class="dlg"><h3>${esc(title)}</h3><div class="dlg-body">${body}</div>
    <footer>${onDelete ? '<button type="button" class="danger" data-act="del">삭제</button>' : ''}<span class="sp"></span>
    <button type="button" class="ghost" data-act="cancel">취소</button><button type="submit" class="primary">${esc(saveLabel)}</button></footer></form>`;
  const f = dlg.querySelector('form');
  f.addEventListener('submit', e => {e.preventDefault(); if(onSave(new FormData(f), f) === false) return; dlg.close(); commit();});
  f.querySelector('[data-act="cancel"]').onclick = () => dlg.close();
  if(onDelete) f.querySelector('[data-act="del"]').onclick = () => {if(onDelete() === false) return; dlg.close(); commit();};
  dlg.showModal();
  if(onOpen) onOpen(f);
}

function relatedHTML(clientId, type, selfId, itemId){
  const item = itemId ? db.items.find(i => i.id === itemId) : null;
  const procs = db.procedures.filter(p => p.type === type && (p.clientId === clientId || !p.clientId));
  const same = db.records.filter(r => r.id !== selfId && r.clientId === clientId && r.type === type).sort(byDateDesc).slice(0,4);
  const others = db.records.filter(r => r.id !== selfId && r.clientId !== clientId && r.type === type && r.special).sort(byDateDesc).slice(0,3);
  if(!item && !procs.length && !same.length && !others.length) return '<p class="hint">이 업체의 같은 유형 기록과 절차가 아직 없습니다.</p>';
  const li = (r, extra = '') => `<li>${r.special ? '<span class="stamp sm">특이</span> ' : ''}<span class="rec-date">${esc(recDate(r))}</span>${esc(r.title)}${extra}${r.special && r.specialNote ? `<div class="hint" style="white-space:pre-wrap">${esc(r.specialNote)}</div>` : ''}</li>`;
  return `${item ? `<h4>품목 요건: ${esc(item.name)}</h4><ul><li>${item.hs ? `HS ${esc(item.hs)}` : ''}${item.tariff ? `, ${esc(item.tariff)}` : ''}${item.reqs ? `<div class="hint" style="white-space:pre-wrap">${esc(item.reqs)}</div>` : ''}${item.agency ? `<div class="hint">기관: ${esc(item.agency)}</div>` : ''}</li></ul>` : ''}
    ${procs.length ? `<h4>참고할 절차</h4><ul>${procs.map(p => `<li><strong>${esc(p.title)}</strong> <span class="hint">${p.clientId ? '업체 전용' : '공통'}</span>${(p.steps || []).length ? `<ol class="mini-ol">${p.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}${p.cautions ? `<div class="hint" style="white-space:pre-wrap">주의: ${esc(p.cautions)}</div>` : ''}</li>`).join('')}</ul>` : ''}
    ${same.length ? `<h4>이 업체의 같은 업무</h4><ul>${same.map(r => li(r)).join('')}</ul>` : ''}
    ${others.length ? `<h4>다른 업체의 같은 유형 특이 사례</h4><ul>${others.map(r => li(r, ` <span class="hint">${esc(clientName(r.clientId))}</span>`)).join('')}</ul>` : ''}`;
}

function openRecord(r, preset = {}){
  if(!db.clients.length){toast('먼저 업체를 추가하세요.'); openClient(null); return;}
  const isNew = !r;
  const first = sortedClients()[0].id;
  const status = preset.status || '완료';
  const rec = r || {id:uid(), clientId:preset.clientId || first, type:preset.type || db.settings.taskTypes[0], status,
    startDate:today(), date:status === '완료' ? today() : '', refNo:'', title:'', summary:'', special:false, specialNote:'',
    tags:[], links:[], fee:null, itemId:'', checklist:[], docs:[], deadlines:[], reflected:[]};
  if(isNew && preset.mail){
    const m = preset.mail, c = matchClient(m);
    Object.assign(rec, {clientId:c ? c.id : rec.clientId, title:m.subject || '', startDate:m.date || today(), date:m.date || today(), summary:m.summary || m.snippet || '', refNo:findRefNo((m.subject||'') + ' ' + (m.snippet||'')), links:safeUrl(m.link) ? [m.link] : []});
  }
  if(isNew && preset.prefill) Object.assign(rec, preset.prefill);
  if(!db.clients.some(c => c.id === rec.clientId)) rec.clientId = first;
  const dls = (rec.deadlines || []).map(d => ({...d}));
  openDialog({
    title: isNew ? (status === '진행중' ? '업무 시작' : '업무 기록 남기기') : '업무 기록 수정',
    body: `<div class="row2">
        <label>업체<select name="clientId">${opts(sortedClients().map(c => [c.id, c.name]), rec.clientId)}</select></label>
        <label>업무 유형<select name="type">${opts(typeList(rec.type), rec.type)}</select></label>
      </div>
      <div class="row2">
        <label>상태<select name="status">${opts(STATUSES, rec.status)}</select></label>
        <label>품목<select name="itemId"></select></label>
      </div>
      <div class="row2">
        <label>접수일<input type="date" name="startDate" value="${esc(rec.startDate)}"></label>
        <label>완료일<input type="date" name="date" value="${esc(rec.date)}"></label>
      </div>
      <div class="row2">
        <label>B/L 번호<input name="bl" value="${esc(rec.bl || '')}" placeholder="예: HDMU1234567"></label>
        <label>신고번호<input name="refNo" value="${esc(rec.refNo)}" placeholder="수입·수출 신고번호"></label>
      </div>
      <div class="row2">
        <label>대행 수수료 (원)<input name="fee" inputmode="numeric" value="${rec.fee ? esc(rec.fee.toLocaleString('ko-KR')) : ''}" placeholder="리포트 집계용"></label>
      </div>
      <label>제목<input name="title" required value="${esc(rec.title)}" placeholder="예: 미국산 유기농 옥수수분말 수입통관"></label>
      <label>진행 요약<textarea name="summary" rows="4" placeholder="진행 순서, 제출 서류, 소요 기간 등. 완료 시 비워 두면 체크리스트로 자동 작성됩니다.">${esc(rec.summary)}</textarea></label>
      <label class="check"><input type="checkbox" name="special"${rec.special ? ' checked' : ''}> 일반 절차와 다르게 처리함</label>
      <div class="special-fields"><label>특이 처리 내용<textarea name="specialNote" rows="4" placeholder="무엇이 달랐는지 / 어떻게 해결했는지 / 다음에 적용할 점">${esc(rec.specialNote)}</textarea></label></div>
      <div class="dlg-section">
        <h4>정정·보완 원인</h4>
        <p class="hint">정정이나 세관 보완 요구가 있었던 건만 고르세요. 업체별 신고 전 점검표에 쓰입니다.</p>
        <div class="cause-grid">${CAUSES.map(k => `<label class="check"><input type="checkbox" name="cause" value="${esc(k)}"${causesOf(rec).includes(k) ? ' checked' : ''}> ${esc(k)}</label>`).join('')}</div>
      </div>
      <div class="dlg-section">
        <h4>체크리스트</h4>
        <div class="btn-row"><select data-x="procPick" aria-label="불러올 절차"></select><button type="button" class="ghost" data-x="loadProc">절차 불러오기</button><button type="button" class="ghost" data-x="addCheck">정정 점검표 추가</button></div>
        <div class="row2">
          <label>처리 단계 (한 줄에 하나)<textarea name="checklist" rows="5">${esc((rec.checklist || []).map(x => x.text).join('\n'))}</textarea></label>
          <label>필요 서류 (한 줄에 하나)<textarea name="docs" rows="5">${esc((rec.docs || []).map(x => x.text).join('\n'))}</textarea></label>
        </div>
        <p class="hint">완료 표시는 목록 화면에서 항목을 체크하면 됩니다.</p>
      </div>
      <div class="dlg-section">
        <h4>기한</h4>
        <ul class="dl-list"></ul>
        <div class="dl-add">
          <label>기한 종류<select data-x="dlKind">${opts(DL_RULES.map(x => x.kind), DL_RULES[0].kind)}</select></label>
          <label><span data-x="dlBaseLbl">기준일</span><input type="date" data-x="dlDate"></label>
          <label data-x="dlNameWrap" hidden>기한명<input data-x="dlName" placeholder="예: 검사 결과 확인"></label>
          <button type="button" class="ghost" data-x="dlAdd">기한 추가</button>
        </div>
        <p class="hint" data-x="dlPrev"></p>
        <p class="hint">법정 기한은 일반 규정으로 계산한 참고값입니다. 말일이 공휴일인 경우나 개별 사정은 직접 확인하세요.</p>
      </div>
      <div class="dlg-section">
        <label>태그<input name="tags" value="${esc((rec.tags || []).join(', '))}" placeholder="쉼표로 구분: 검역, 정정신고"></label>
        <label>관련 링크<textarea name="links" rows="2" placeholder="Gmail 메일 주소, Drive 폴더 주소를 한 줄에 하나씩">${esc((rec.links || []).join('\n'))}</textarea></label>
      </div>
      <aside class="related" aria-label="참고 자료"></aside>`,
    onSave(fd){
      const t = nowIso(), status = fd.get('status');
      if(status === '완료' && !fd.get('date')){toast('완료 상태는 완료일이 필요합니다.'); return false;}
      const rawLinks = lines(fd.get('links'));
      const links = rawLinks.map(safeUrl).filter(Boolean);
      if(links.length < rawLinks.length) toast('http(s)로 시작하지 않는 링크는 빼고 저장했습니다.');
      const keep = (old, texts) => {const m = new Map(old.map(x => [x.text, x])); return texts.map(tx => m.get(tx) || {text:tx, done:false});};
      const checklist = keep(rec.checklist || [], lines(fd.get('checklist')));
      let summary = fd.get('summary').trim();
      if(status === '완료' && !summary && checklist.length)
        summary = '처리 단계\n' + checklist.map(x => `${x.done ? '✓' : '–'} ${x.text}${x.doneAt ? ` (${x.doneAt})` : ''}`).join('\n');
      const feeNum = Number(String(fd.get('fee')).replace(/[^\d]/g,''));
      Object.assign(rec, {
        clientId: fd.get('clientId'), type: fd.get('type'), status, itemId: fd.get('itemId') || '',
        startDate: fd.get('startDate') || fd.get('date') || today(), date: fd.get('date'),
        refNo: fd.get('refNo').trim(), bl: String(fd.get('bl') || '').trim().toUpperCase(), fee: feeNum || null, title: fd.get('title').trim(), summary,
        special: fd.get('special') === 'on', specialNote: fd.get('specialNote').trim(), causes: fd.getAll('cause'),
        checklist, docs: keep(rec.docs || [], lines(fd.get('docs'))), deadlines: dls,
        tags: fd.get('tags').split(',').map(x => x.trim()).filter(Boolean), links, updatedAt: t
      });
      rec.updatedBy = me ? me.id : '';
      if(isNew){
        rec.createdAt = t; rec.createdBy = me ? me.id : ''; db.records.push(rec);
        if(preset.mail){seeMail(preset.mail.id); markMailDone(preset.mail);}
        toast(status === '진행중' ? '업무를 시작했습니다.' : '기록을 저장했습니다.');
      } else toast(preset.complete ? '완료 처리했습니다.' : '기록을 수정했습니다.');
    },
    onDelete: isNew ? null : () => {
      if(!confirm(`‘${rec.title}’ 기록을 삭제할까요?`)) return false;
      db.records = db.records.filter(x => x.id !== rec.id); toast('기록을 삭제했습니다.');
    },
    onOpen(f){
      const N = n => f.elements.namedItem(n), X = n => f.querySelector(`[data-x="${n}"]`);
      const rel = f.querySelector('.related'), spf = f.querySelector('.special-fields');
      const itemSel = N('itemId'), procPick = X('procPick');
      const fillItems = (sel) => {
        const its = db.items.filter(i => i.clientId === N('clientId').value);
        itemSel.innerHTML = '<option value="">선택 안 함</option>' + opts(its.map(i => [i.id, i.name + (i.hs ? ` (${i.hs})` : '')]), sel);
      };
      const fillProcs = () => {
        const cid = N('clientId').value, ty = N('type').value;
        const ps = db.procedures.filter(p => !p.clientId || p.clientId === cid)
          .sort((a,b) => ((b.type === ty) - (a.type === ty)) || ((!!b.clientId) - (!!a.clientId)));
        procPick.innerHTML = ps.length ? opts(ps.map(p => [p.id, `${p.title} (${p.clientId ? '업체 전용' : '공통'}, ${p.type})`]), ps[0].id) : '<option value="">불러올 절차가 없습니다</option>';
      };
      const upd = () => {rel.innerHTML = relatedHTML(N('clientId').value, N('type').value, rec.id, itemSel.value);};
      const tog = () => {spf.hidden = !N('special').checked;};
      const stat = () => {if(N('status').value === '완료' && !N('date').value) N('date').value = today();};
      const loadProc = (id, ask) => {
        const p = db.procedures.find(x => x.id === id); if(!p) return;
        if(ask && (N('checklist').value.trim() || N('docs').value.trim()) && !confirm('체크리스트를 이 절차 내용으로 바꿀까요?')) return;
        N('checklist').value = (p.steps || []).join('\n'); N('docs').value = splitDocs(p.docs).join('\n');
      };
      N('clientId').addEventListener('change', () => {fillItems(''); fillProcs(); upd();});
      N('type').addEventListener('change', () => {fillProcs(); upd();});
      itemSel.addEventListener('change', upd);
      N('special').addEventListener('change', tog);
      N('status').addEventListener('change', stat);
      X('loadProc').onclick = () => loadProc(procPick.value, true);
      X('addCheck').onclick = () => {
        const cc = clientCauses(N('clientId').value).list;
        if(!cc.length){toast('이 업체는 기록된 정정 원인이 없습니다.'); return;}
        const cur = lines(N('checklist').value);
        const add = cc.map(([k]) => '[점검] ' + CAUSE_HINTS[k]).filter(t => !cur.includes(t));
        N('checklist').value = [...add, ...cur].join('\n');
        toast(add.length ? `점검 항목 ${add.length}개를 맨 앞에 넣었습니다.` : '이미 들어 있습니다.');
      };
      // deadlines
      const dlList = f.querySelector('.dl-list');
      const rule = () => DL_RULES.find(x => x.kind === X('dlKind').value);
      const renderDls = () => {
        dlList.innerHTML = dls.length
          ? dls.map((d,i) => `<li>${ddayHTML(d.due)}<strong>${esc(d.kind)}</strong><span class="hint">기한 ${esc(d.due)}${d.base ? `, 기준일 ${esc(d.base)}` : ''}${d.done ? ', 처리됨' : ''}</span><button type="button" class="mini" data-x-del="${i}">삭제</button></li>`).join('')
          : '<li class="hint">등록된 기한이 없습니다.</li>';
      };
      const prev = () => {
        const ru = rule(), dt = X('dlDate').value;
        X('dlBaseLbl').textContent = ru.base || '기한일';
        X('dlNameWrap').hidden = !!ru.base;
        X('dlPrev').textContent = ru.base && dt ? `계산된 기한: ${addPeriod(dt, ru.n, ru.u)}` : '';
      };
      X('dlKind').onchange = prev; X('dlDate').oninput = prev;
      X('dlAdd').onclick = () => {
        const ru = rule(), dt = X('dlDate').value;
        if(!dt){toast('날짜를 입력하세요.'); return;}
        dls.push({id:uid(), kind:ru.base ? ru.kind : (X('dlName').value.trim() || '기한'), base:ru.base ? dt : null, due:ru.base ? addPeriod(dt, ru.n, ru.u) : dt, done:false});
        X('dlDate').value = ''; X('dlName').value = ''; prev(); renderDls();
      };
      dlList.onclick = e => {const b = e.target.closest('[data-x-del]'); if(b){dls.splice(Number(b.dataset.xDel), 1); renderDls();}};
      fillItems(rec.itemId); fillProcs(); upd(); tog(); prev(); renderDls();
      if(preset.procId){loadProc(preset.procId, false); procPick.value = preset.procId;}
      if(preset.complete){N('status').value = '완료'; stat(); N('summary').focus();}
      else if(isNew) N('title').focus();
    }
  });
}

function letterBody(t, v){
  const reason = v.reason || '          ', num = v.num || '                ';
  const R = `${reason}${josa(reason,'으로')} 인하여`;
  if(t === 'co_after') return `1. 귀관의 노고에 감사드리며, 일익 번창하심을 기원합니다.\n\n2. 원산지증명서 발급 건(${num})에 대해 ${R} 선적 후 발급 신청하오니 선처 바랍니다.\n\n3. 귀관의 업무협조를 요청하는 바입니다.`;
  if(t === 'co_amend') return `1. 귀관의 노고에 감사드리며, 일익 번창하심을 기원합니다.\n\n2. 원산지증명서 발급 건(${num})에 대해 ${R} ${v.item || '선적일자'} 기재사항 정정신청 하오니 선처 바랍니다.\n\n3. 귀관의 업무협조를 요청하는 바입니다.`;
  const items = v.items.length ? v.items.join(', ') : '          ';
  const rows = lines(v.rows);
  const table = rows.length ? `\n\n정정 항목 | 정정 전 | 정정 후\n${rows.join('\n')}` : '';
  return `1. 귀관의 노고에 감사드리며, 일익 번창하심을 기원합니다.\n\n2. 당사 수출신고 건(${num})의 ${items} 기재 내용을 ${R} 아래와 같이 정정 신청하오니 선처 바랍니다.${table}\n\n3. 첨부 서류: ${v.attach || '정정 사유서, 정정 Invoice·Packing List, 기존 수출신고필증'}\n\n4. 귀관의 업무협조를 요청하는 바입니다.`;
}
function renderLetterBody(text){
  const out = []; let tbl = [];
  const flush = () => { if(tbl.length){ out.push('<table>' + tbl.map((r,i) => '<tr>' + r.map(c => i === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`).join('') + '</tr>').join('') + '</table>'); tbl = []; } };
  String(text).split('\n').forEach(l => { if(l.includes('|')) tbl.push(l.split('|').map(x => x.trim())); else { flush(); out.push(esc(l) + '\n'); } });
  flush(); return out.join('');
}
function printLetter(v){
  const fr = document.createElement('iframe');
  fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(fr);
  const w = fr.contentWindow; w.document.open();
  w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(v.title)}</title><style>
    @page{size:A4;margin:25mm 22mm}
    body{font-family:"Batang","바탕","Noto Serif KR","Nanum Myeongjo",serif;color:#000;font-size:12pt;line-height:1.9;margin:0}
    h1{text-align:center;font-size:24pt;letter-spacing:.6em;margin:0 0 2em;font-weight:700}
    .meta p{margin:.15em 0}.meta b{display:inline-block;width:4.2em;font-weight:700}
    .body{margin-top:2em;white-space:pre-wrap}
    table{border-collapse:collapse;width:100%;margin:.3em 0 .6em}th,td{border:1px solid #000;padding:.3em .6em;font-size:11pt;text-align:left}th{background:#f2f2f2}
    .date{text-align:center;margin:3.5em 0 2.5em}
    .sign{text-align:right;font-size:13pt}.sign p{margin:.2em 0}
    @media screen{body{max-width:166mm;margin:18mm auto;padding:0 6mm}}
  </style></head><body>
    <h1>사 유 서</h1>
    <div class="meta"><p><b>수 신</b>: ${esc(v.to)}</p><p><b>제 목</b>: ${esc(v.title)}</p></div>
    <div class="body">${renderLetterBody(v.body)}</div>
    <p class="date">${esc(v.date.replace(/-/g,'.'))}</p>
    <div class="sign"><p>${esc(v.company)}</p><p>대표 ${esc(v.rep)}&nbsp;&nbsp;&nbsp;(인)</p></div>
  </body></html>`);
  w.document.close();
  setTimeout(() => { try{ w.focus(); w.print(); }catch(e){ toast('인쇄하지 못했습니다: ' + e.message); } setTimeout(() => fr.remove(), 60000); }, 400);
  return true;
}
function openLetter(clientId){
  if(!db.clients.length){toast('먼저 업체를 추가하세요.'); openClient(null); return;}
  const first = sortedClients()[0].id;
  let cid = db.clients.some(c => c.id === clientId) ? clientId : first;
  let edited = false;
  openDialog({
    title: '사유서 작성',
    saveLabel: '인쇄하기',
    body: `<div class="row2">
        <label>업체<select name="clientId">${opts(sortedClients().map(c => [c.id, c.name]), cid)}</select></label>
        <label>사유서 종류<select name="ltype">${opts(Object.entries(LETTER_TYPES).map(([k,v]) => [k, v.name]), 'co_after')}</select></label>
      </div>
      <div class="row2">
        <label>수신<input name="to" list="toList" required><datalist id="toList">${TO_LIST.map(t => `<option value="${esc(t)}">`).join('')}</datalist></label>
        <label><span data-x="numLbl">번호</span><input name="num"></label>
      </div>
      <div class="row2">
        <label>사유<select name="reasonPick"></select></label>
        <label data-x="ownWrap">사유 직접 입력<input name="reasonOwn" placeholder="예: 선적 서류 도착 지연"></label>
      </div>
      <label data-x="itemWrap">정정할 기재사항<input name="item" value="선적일자"></label>
      <div data-x="expWrap">
        <p class="hint" style="margin:.6rem 0 .1rem">정정 항목</p>
        <div class="cause-grid">${CAUSES.filter(k => k !== '증빙 보완').map(k => `<label class="check"><input type="checkbox" name="ecause" value="${esc(k)}"> ${esc(k)}</label>`).join('')}</div>
        <label>정정 내용 (항목 | 정정 전 | 정정 후, 한 줄에 하나)<textarea name="rows" rows="3" placeholder="총중량 | 1,250 KG | 1,288 KG"></textarea></label>
        <label>첨부 서류<input name="attach"></label>
      </div>
      <div class="row2">
        <label>작성일<input type="date" name="ldate" value="${today()}"></label>
        <label>대표자<input name="rep" placeholder="업체 정보에 저장됩니다"></label>
      </div>
      <div class="dlg-section">
        <div class="btn-row" style="justify-content:space-between"><h4>문안</h4><button type="button" class="mini" data-x="regen">문안 다시 만들기</button></div>
        <textarea name="body" rows="11" class="letter-body"></textarea>
        <p class="hint">문안을 직접 고친 뒤에는 위 항목을 바꿔도 자동으로 바뀌지 않습니다. ‘|’로 나눈 줄은 인쇄할 때 표로 나옵니다.</p>
      </div>
      <label class="check"><input type="checkbox" name="logit" checked> 인쇄한 뒤 업무 기록으로 남기기</label>`,
    onOpen(f){
      const N = n => f.elements.namedItem(n), X = n => f.querySelector(`[data-x="${n}"]`);
      const client = () => db.clients.find(c => c.id === N('clientId').value);
      const vals = () => {
        const t = N('ltype').value, pick = N('reasonPick').value;
        return {t, num:N('num').value.trim(), reason: pick === '__own' ? N('reasonOwn').value.trim() : pick, item:N('item').value.trim(),
          items:[...f.querySelectorAll('[name=ecause]:checked')].map(x => x.value), rows:N('rows').value, attach:N('attach').value.trim()};
      };
      const gen = (force) => { if(edited && !force) return; const v = vals(); N('body').value = letterBody(v.t, v); if(force) edited = false; };
      const setType = (keepTo) => {
        const t = N('ltype').value, L = LETTER_TYPES[t], c = client();
        X('numLbl').textContent = L.numLabel;
        N('reasonPick').innerHTML = opts([...L.reasons, ['__own','직접 입력']], L.reasons[0]);
        X('itemWrap').hidden = t !== 'co_amend';
        X('expWrap').hidden = t !== 'exp_amend';
        if(!keepTo) N('to').value = ((c.letterPrefs || {})[t] || {}).to || L.to;
        if(t === 'exp_amend' && !N('attach').value){
          const ev = clientCauses(c.id).list.some(([k]) => k === '증빙 보완');
          N('attach').value = '정정 사유서, 정정 Invoice·Packing List, 기존 수출신고필증' + (ev ? ', 출고내역(ERP) 캡처, S/N 목록, 양사 서명 P/I' : '');
        }
        ownToggle(); gen();
      };
      const ownToggle = () => { X('ownWrap').hidden = N('reasonPick').value !== '__own'; };
      const setClient = () => { N('rep').value = client().rep || ''; N('attach').value = ''; setType(false); };
      N('clientId').addEventListener('change', setClient);
      N('ltype').addEventListener('change', () => setType(false));
      N('reasonPick').addEventListener('change', () => { ownToggle(); gen(); });
      ['num','reasonOwn','item','rows','attach'].forEach(n => N(n).addEventListener('input', () => gen()));
      f.querySelectorAll('[name=ecause]').forEach(x => x.addEventListener('change', () => gen()));
      N('body').addEventListener('input', () => { edited = true; });
      X('regen').onclick = () => gen(true);
      setClient();
    },
    onSave(fd, f){
      const t = fd.get('ltype'), L = LETTER_TYPES[t], c = db.clients.find(x => x.id === fd.get('clientId'));
      const body = fd.get('body').trim(), rep = fd.get('rep').trim(), to = fd.get('to').trim();
      if(!body){toast('문안이 비어 있습니다.'); return false;}
      const pick = fd.get('reasonPick'), reason = pick === '__own' ? fd.get('reasonOwn').trim() : pick;
      if(!printLetter({title:L.title, to, body, date:fd.get('ldate') || today(), company:c.name, rep})) return false;
      c.rep = rep;
      c.letterPrefs = {...(c.letterPrefs || {}), [t]: {to}};
      const num = fd.get('num').trim(), items = fd.getAll('ecause');
      const causes = t === 'exp_amend' ? items : (t === 'co_amend' && /선적/.test(fd.get('item') + reason) ? ['선적일'] : []);
      const logit = fd.get('logit') === 'on';
      $('#dlg').close(); commit();
      if(logit) openRecord(null, {status:'완료', prefill:{clientId:c.id, type:L.recType, title:`${L.name} 제출`, refNo:num,
        summary:`수신: ${to}\n사유: ${reason}` + (t === 'exp_amend' && lines(fd.get('rows')).length ? '\n정정 내용:\n' + lines(fd.get('rows')).join('\n') : ''),
        causes, tags: t === 'co_after' ? ['C/O','선적후발급'] : t === 'co_amend' ? ['C/O','정정발급'] : ['정정']}});
      else toast('인쇄 창을 열었습니다.');
      return false;
    }
  });
}

function openProc(p, preset = {}){
  const isNew = !p;
  const pr = p || {id:uid(), clientId:preset.clientId || null, type:preset.type || db.settings.taskTypes[0], title:'', steps:[], docs:'', cautions:''};
  openDialog({
    title: isNew ? '처리 절차 추가' : '처리 절차 수정',
    body: `<div class="row2">
        <label>적용 대상<select name="clientId">${opts([['', '공통 (전 업체)'], ...sortedClients().map(c => [c.id, c.name])], pr.clientId || '')}</select></label>
        <label>업무 유형<select name="type">${opts(typeList(pr.type), pr.type)}</select></label>
      </div>
      <label>절차명<input name="title" required value="${esc(pr.title)}" placeholder="예: 수입 사료원료 통관"></label>
      <label>처리 단계 (한 줄에 한 단계)<textarea name="steps" rows="8" placeholder="선적서류 수령&#10;HS 분류 및 요건 확인&#10;…">${esc((pr.steps || []).join('\n'))}</textarea></label>
      <label>필요 서류 (쉼표나 줄바꿈으로 구분)<textarea name="docs" rows="3">${esc(pr.docs)}</textarea></label>
      <label>주의사항<textarea name="cautions" rows="4" placeholder="이 업체·업무에서 자주 걸리는 부분">${esc(pr.cautions)}</textarea></label>`,
    onSave(fd){
      const t = nowIso();
      Object.assign(pr, {clientId: fd.get('clientId') || null, type: fd.get('type'), title: fd.get('title').trim(), steps: lines(fd.get('steps')), docs: fd.get('docs').trim(), cautions: fd.get('cautions').trim(), updatedAt: t});
      if(isNew){pr.createdAt = t; db.procedures.push(pr); toast('절차를 저장했습니다.');}
      else toast('절차를 수정했습니다.');
    },
    onDelete: isNew ? null : () => {
      if(!confirm(`‘${pr.title}’ 절차를 삭제할까요?`)) return false;
      db.procedures = db.procedures.filter(x => x.id !== pr.id); toast('절차를 삭제했습니다.');
    },
    onOpen(f){ if(isNew) f.elements.namedItem('title').focus(); }
  });
}

function openReflect(rec){
  const targets = db.procedures.filter(p => p.type === rec.type && (p.clientId === rec.clientId || !p.clientId))
    .sort((a,b) => (!!b.clientId) - (!!a.clientId));
  const lastLine = lines(rec.specialNote).slice(-1)[0] || '';
  openDialog({
    title: '특이 사례를 절차에 반영',
    saveLabel: '반영',
    body: `<p class="hint">‘${esc(rec.title)}’에서 다음에 적용할 점을 절차의 주의사항에 덧붙입니다. 날짜와 함께 기록되어 어느 사례에서 나온 내용인지 남습니다.</p>
      <label>반영할 절차<select name="target">${opts([...targets.map(p => [p.id, `${p.title} (${p.clientId ? '업체 전용' : '공통'})`]), ['__new', `새 절차 만들기 (${clientName(rec.clientId)} 전용)`]], targets.find(p => p.clientId)?.id || targets[0]?.id || '__new')}</select></label>
      <label>덧붙일 내용<textarea name="text" rows="4">${esc(lastLine)}</textarea></label>
      <details><summary class="hint">특이 처리 내용 전체 보기</summary><p style="white-space:pre-wrap">${esc(rec.specialNote)}</p></details>`,
    onSave(fd){
      const text = fd.get('text').trim().replace(/\s*\n\s*/g, ' ');
      if(!text){toast('덧붙일 내용을 입력하세요.'); return false;}
      const line = `- ${text} (${rec.date || rec.startDate || today()} 사례)`;
      const t = nowIso(); let p;
      if(fd.get('target') === '__new'){
        p = {id:uid(), clientId:rec.clientId, type:rec.type, title:`${rec.type} 처리 절차`, steps:[], docs:'', cautions:line, createdAt:t, updatedAt:t};
        db.procedures.push(p);
      } else {
        p = db.procedures.find(x => x.id === fd.get('target'));
        p.cautions = (p.cautions ? p.cautions + '\n' : '') + line; p.updatedAt = t;
      }
      rec.reflected = [...new Set([...(rec.reflected || []), p.id])];
      toast(`‘${p.title}’ 주의사항에 반영했습니다.`);
    }
  });
}

function openItem(it, clientId){
  const isNew = !it;
  const item = it || {id:uid(), clientId, name:'', hs:'', tariff:'', reqs:'', agency:'', notes:''};
  openDialog({
    title: isNew ? '품목 추가' : '품목 수정',
    body: `<div class="row2">
        <label>품목명<input name="name" required value="${esc(item.name)}"></label>
        <label>HS 코드<input name="hs" value="${esc(item.hs)}" placeholder="예: 3402.42-0000"></label>
      </div>
      <label>세율·FTA<input name="tariff" value="${esc(item.tariff)}" placeholder="기본세율, 적용 협정과 협정세율"></label>
      <div class="row2">
        <label>수입요건 (한 줄에 하나)<textarea name="reqs" rows="4">${esc(item.reqs)}</textarea></label>
        <label>요건 기관<textarea name="agency" rows="4">${esc(item.agency)}</textarea></label>
      </div>
      <label>메모<textarea name="notes" rows="2" placeholder="원산지, 제조사, 품목분류 근거 등">${esc(item.notes)}</textarea></label>`,
    onSave(fd){
      Object.assign(item, {name: fd.get('name').trim(), hs: fd.get('hs').trim(), tariff: fd.get('tariff').trim(), reqs: fd.get('reqs').trim(), agency: fd.get('agency').trim(), notes: fd.get('notes').trim(), updatedAt: nowIso()});
      if(isNew){item.createdAt = nowIso(); db.items.push(item); toast('품목을 추가했습니다.');}
      else toast('품목을 수정했습니다.');
    },
    onDelete: isNew ? null : () => {
      if(!confirm(`‘${item.name}’ 품목을 삭제할까요? 기록에 연결된 품목 표시만 사라지고 기록은 남습니다.`)) return false;
      db.items = db.items.filter(x => x.id !== item.id);
      db.records.forEach(r => { if(r.itemId === item.id) r.itemId = ''; });
      toast('품목을 삭제했습니다.');
    },
    onOpen(f){ if(isNew) f.elements.namedItem('name').focus(); }
  });
}

function openClient(c){
  const isNew = !c;
  const cl = c || {id:uid(), name:'', bizNo:'', industry:'', contact:'', keyword:'', notes:''};
  openDialog({
    title: isNew ? '업체 추가' : '업체 정보 수정',
    body: `<div class="btn-row"><label class="btn">사업자등록증 읽기 (홈택스 PDF)<input type="file" data-x="bizfile" accept=".pdf" hidden></label><span class="hint" data-x="bizmsg">파일은 이 브라우저 안에서만 읽고 어디에도 올리지 않습니다.</span></div>
      <label>업체명<input name="name" required value="${esc(cl.name)}"></label>
      <div class="row2">
        <label>사업자등록번호<input name="bizNo" value="${esc(cl.bizNo)}"></label>
        <label>업종, 주요 품목<input name="industry" value="${esc(cl.industry)}"></label>
      </div>
      <div class="row2">
        <label>담당자<input name="contact" value="${esc(cl.contact)}" placeholder="부서, 직함 정도만"></label>
        <label>대표자 (사유서용)<input name="rep" value="${esc(cl.rep || '')}"></label>
      </div>
      <div class="row2">
        <label>메일·Drive 검색어<input name="keyword" value="${esc(cl.keyword)}" placeholder="@abc.co.kr, 약칭 (쉼표로 구분)"></label>
      </div>
      <p class="hint">검색어에 업체 메일 도메인을 넣으면 메일 초안이 이 업체로 자동 연결됩니다.</p>
      <div class="row2">
        <label>거래 시작 (월)<input type="month" name="since" value="${esc((cl.relation||{}).since || '')}"></label>
        <label>최근 업무 (월)<input type="month" name="last" value="${esc((cl.relation||{}).last || '')}"></label>
      </div>
      <label>거래 기간 근거<input name="basis" value="${esc((cl.relation||{}).basis || '')}" placeholder="예: 2023 정산방식표, 2026.10 정산서"></label>
      <p class="hint">기록 날짜도 함께 반영됩니다. 기간 12개월 이상이고 최근 12개월 안에 업무가 있으면 ‘1년 이상 거래 유지’ 폴더로 들어갑니다.</p>
      <div class="row2">
        <label>개업일<input type="date" name="openDate" value="${esc(cl.openDate || '')}"></label>
        <label>사업장 주소<input name="address" value="${esc(cl.address || '')}"></label>
      </div>
      <label>메모<textarea name="notes" rows="4" placeholder="거래 특성, 합의 사항, 자주 생기는 이슈">${esc(cl.notes)}</textarea></label>`,
    onSave(fd){
      Object.assign(cl, {name: fd.get('name').trim(), bizNo: fd.get('bizNo').trim(), industry: fd.get('industry').trim(), contact: fd.get('contact').trim(), rep: fd.get('rep').trim(), keyword: fd.get('keyword').trim(), notes: fd.get('notes').trim(), updatedAt: nowIso()});
      cl.relation = {since: fd.get('since') || '', last: fd.get('last') || '', basis: fd.get('basis').trim()};
      cl.openDate = fd.get('openDate') || ''; cl.address = fd.get('address').trim();
      if(isNew){cl.createdAt = nowIso(); db.clients.push(cl); toast('업체를 추가했습니다.');}
      else toast('업체 정보를 수정했습니다.');
      route = {name:'client', id:cl.id}; $('#q').value = '';
    },
    onDelete: isNew ? null : () => {
      const n = db.records.filter(r => r.clientId === cl.id).length, m = db.procedures.filter(p => p.clientId === cl.id).length, k = db.items.filter(i => i.clientId === cl.id).length;
      if(!confirm(`‘${cl.name}’을(를) 삭제하면 이 업체의 기록 ${n}건, 전용 절차 ${m}건, 품목 ${k}개도 함께 삭제됩니다. 계속할까요?`)) return false;
      db.clients = db.clients.filter(x => x.id !== cl.id);
      db.records = db.records.filter(r => r.clientId !== cl.id);
      db.procedures = db.procedures.filter(p => p.clientId !== cl.id);
      db.items = db.items.filter(i => i.clientId !== cl.id);
      route = {name:'home', id:null}; toast('업체를 삭제했습니다.');
    },
    onOpen(f){
      if(isNew) f.elements.namedItem('name').focus();
      const N = n => f.elements.namedItem(n), msg = f.querySelector('[data-x="bizmsg"]');
      f.querySelector('[data-x="bizfile"]').onchange = async e => {
        const file = e.target.files[0]; if(!file) return;
        try{
          const r = await readBizFile(file, t => { msg.textContent = t; });
          const set = (n, v) => { if(v) N(n).value = v; };
          set('bizNo', r.biz); if(r.name && !N('name').value.trim()) N('name').value = r.name;
          set('rep', r.rep); set('openDate', r.open); set('address', r.addr);
          if((r.type || r.item) && !N('industry').value.trim()) N('industry').value = [r.type, r.item].filter(Boolean).join(' / ');
          const got = [r.biz && '등록번호', r.name && '상호', r.rep && '대표자', r.open && '개업일', r.addr && '주소', (r.type || r.item) && '업태·종목'].filter(Boolean);
          msg.textContent = got.length ? `읽은 항목: ${got.join(', ')}. 내용을 확인한 뒤 저장하세요.` : '글자를 찾지 못했습니다. 더 선명한 파일로 다시 해 보세요.';
        }catch(err){ msg.textContent = '읽지 못했습니다: ' + err.message; }
      };
    }
  });
}
