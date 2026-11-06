'use strict';
/* ---------- 사업자등록증 읽기 (홈택스 PDF 글자 추출. 스캔본은 Drive 일괄 인식 사용) ---------- */
function loadScript(src){
  return new Promise((res, rej) => {
    if(document.querySelector(`script[src="${src}"]`)) return res();
    const el = document.createElement('script'); el.src = src; el.onload = res; el.onerror = () => rej(new Error('필요한 프로그램을 불러오지 못했습니다'));
    document.head.appendChild(el);
  });
}
function joinPdfItems(items){
  const rows = {};
  items.forEach(it => { const y = Math.round(it.transform[5] / 3); (rows[y] = rows[y] || []).push(it); });
  return Object.keys(rows).sort((a,b) => b - a).map(y => rows[y].sort((a,b) => a.transform[4] - b.transform[4]).map(i => i.str).join(' ')).join('\n');
}
async function readBizFile(file, onMsg){
  let text = '';
  if(/pdf/i.test(file.type) || /\.pdf$/i.test(file.name)){
    onMsg('PDF 읽는 중…');
    await loadScript(PDFJS); pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const pdf = await pdfjsLib.getDocument({data: new Uint8Array(await file.arrayBuffer())}).promise;
    const page = await pdf.getPage(1);
    text = joinPdfItems((await page.getTextContent()).items);
  }
  if(text.replace(/\s/g,'').length < 30) throw new Error('글자가 들어 있지 않은 스캔본·사진입니다. Drive의 BSGC-Backup/사업자등록증 폴더에 올린 뒤 거래업체 리스트의 ‘사업자등록증 폴더 반영’으로 읽어 주세요');
  return parseBiz(text);
}
function parseBiz(t){
  const T = String(t).replace(/[ \t]+/g, ' ');
  const g = re => { const m = T.match(re); return m ? m[1].trim().replace(/\s{2,}/g, ' ') : ''; };
  const bm = T.match(/(\d{3})\s*-\s*(\d{2})\s*-\s*(\d{5})/);
  const om = T.match(/개\s*업\s*연\s*월\s*일\s*[:：]?\s*(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  const rp = g(/(?:대\s*표\s*자|성\s*명)\s*[:：]?\s*([가-힣A-Za-z][가-힣A-Za-z ]{0,28}?)(?=\s*(?:생\s*년|개\s*업|법\s*인\s*등\s*록|\n|$))/);
  return {
    biz: bm ? `${bm[1]}-${bm[2]}-${bm[3]}` : '',
    name: g(/(?:법\s*인\s*명\s*\(?\s*단\s*체\s*명\s*\)?|상\s*호)\s*[:：]?\s*([^\n]+?)(?=\s*(?:대\s*표\s*자|성\s*명|\n|$))/),
    rep: /^[가-힣](\s[가-힣]){1,4}$/.test(rp) ? rp.replace(/\s/g,'') : rp,
    open: om ? `${om[1]}-${om[2].padStart(2,'0')}-${om[3].padStart(2,'0')}` : '',
    addr: g(/사\s*업\s*장\s*소\s*재\s*지\s*[:：]?\s*([^\n]+)/),
    type: g(/업\s*태\s*[:：]?\s*([^\n]+?)(?=\s*종\s*목|\n|$)/),
    item: g(/종\s*목\s*[:：]?\s*([^\n]+)/)
  };
}

function openDataMenu(){
  const mail = db.settings.mail || {};
  openDialog({
    title: '데이터',
    saveLabel: '설정 저장',
    body: `<label>업무 유형 (한 줄에 하나, 순서대로 표시)<textarea name="types" rows="7">${esc(db.settings.taskTypes.join('\n'))}</textarea></label>
      <div class="dlg-section">
        <h4>Apps Script 연동 (Drive 자동 저장·메일·자동 수집)</h4>
        <p class="hint">웹 앱 주소와 토큰을 넣으면 변경 내용이 Drive의 data.enc.json에 자동으로 저장되고, 다른 계정이 저장한 내용도 합쳐서 보여 줍니다. ‘메일 초안’, 자동 수집, B/L 조회도 같은 주소를 씁니다. 이 값은 암호화되어 저장되고, 다음 로그인 때 최신 파일을 먼저 받기 위해 이 PC 브라우저에도 남습니다.</p>
        <label>웹 앱 주소<input name="mailEndpoint" value="${esc(mail.endpoint)}" placeholder="https://script.google.com/macros/s/…/exec"></label>
        <label>토큰<input type="password" name="mailToken" value="${esc(mail.token)}" autocomplete="off"></label>
      </div>
      <div class="dlg-section">
        <h4>내 비밀번호 변경 (${esc(me.id)})</h4>
        <p class="hint">Drive 자동 저장을 쓰면 다른 PC에도 바로 반영됩니다. Drive의 이전 버전·날짜별 사본은 예전 비밀번호로 열립니다.</p>
        <div class="row2"><input type="password" name="npw" placeholder="새 비밀번호 (비우면 유지)" autocomplete="new-password"><input type="password" name="npw2" placeholder="새 비밀번호 확인" autocomplete="new-password"></div>
      </div>
      <div class="dlg-section">
        <h4>백업</h4>
        <p class="hint">평문 JSON은 암호화되지 않습니다. 공유 폴더나 GitHub에 두지 말고 개인 폴더에만 보관하세요. ‘JSON 가져오기’에 백업 파일을 넣으면 대장 전체가 바뀌고, 병합용 파일을 넣으면 지금 대장에 추가됩니다.</p>
        <div class="btn-row"><button type="button" class="ghost" data-act="plain">평문 JSON 받기</button><label class="btn">JSON 가져오기<input type="file" data-act="import" accept=".json,application/json" hidden></label></div>
      </div>`,
    onSave(fd){
      const types = lines(fd.get('types'));
      if(!types.length){toast('업무 유형을 하나 이상 남겨 두세요.'); return false;}
      const ep = fd.get('mailEndpoint').trim();
      if(ep && !/^https:\/\/script\.google(usercontent)?\.com\//.test(ep)){toast('웹 앱 주소는 https://script.google.com/ 으로 시작해야 합니다.'); return false;}
      db.settings.taskTypes = [...new Set(types)];
      if(ep !== db.settings.mail.endpoint) mailCache = null;
      const tk = fd.get('mailToken').trim(), syncChanged = ep !== (db.settings.mail.endpoint || '') || tk !== (db.settings.mail.token || '');
      db.settings.mail = {endpoint: ep, token: tk};
      if(syncChanged){ try{ localStorage.removeItem(LS_KEY + '-base'); }catch{} sync.base = null; sync.baseAcc = null; sync.rev = 0; setTimeout(() => syncStart(), 50); }
      const np = fd.get('npw'), np2 = fd.get('npw2');
      if(np){
        if(np.length < 10){toast('비밀번호는 10자 이상이어야 합니다.'); return false;}
        if(np !== np2){toast('두 비밀번호가 다릅니다.'); return false;}
        (async () => {
          const w = await wrapFor(me.id, me.name, me.role, np);
          accounts = accounts.map(x => x.id === me.id ? w : x);
          $('#dlg').close(); commit();
          toast('비밀번호를 바꿨습니다.' + saveTip());
        })();
        return false;
      }
      toast('설정을 저장했습니다.');
    },
    onOpen(f){
      f.querySelector('[data-act="plain"]').onclick = () => download(`ledger-backup-${today()}.json`, JSON.stringify(db, null, 2));
      f.querySelector('[data-act="import"]').onchange = async e => {
        const file = e.target.files[0]; if(!file) return;
        try{
          const obj = JSON.parse(await file.text());
          if(obj.ct){toast('암호화 파일은 잠근 뒤 첫 화면의 ‘다른 대장 파일 열기’로 여세요.'); return;}
          if(obj.format === 'bsgc-ledger-merge'){
            if(!confirm(`이 파일의 업체 ${(obj.clients||[]).length}곳, 절차 ${(obj.procedures||[]).length}건, 품목 ${(obj.items||[]).length}개, 기록 ${(obj.records||[]).length}건, 연락처 ${(obj.contacts||[]).length}건, 수수료 기준 ${(obj.feeProfiles||[]).length}개를 지금 Workspace에 추가합니다. 같은 이름의 업체는 합치고, 이미 있는 절차와 기록은 건너뜁니다. 계속할까요?`)) return;
            const n = mergeImport(obj); $('#dlg').close(); route = {name:'home', id:null}; commit();
            toast(`추가했습니다: 업체 ${n.c}곳, 절차 ${n.p}건, 품목 ${n.i}개, 기록 ${n.r}건, 연락처 ${n.k}건, 수수료 기준 ${n.f}개${n.kc ? `, KC 목록 ${n.kc}건` : ''}`);
            return;
          }
          if(!Array.isArray(obj.clients) || !Array.isArray(obj.records)){toast('BSGC Workspace 백업 파일이 아닙니다.'); return;}
          if(!confirm(`현재 데이터를 이 파일 내용(업체 ${obj.clients.length}곳, 기록 ${obj.records.length}건)으로 바꿉니다. 계속할까요?`)) return;
          db = migrate(obj); $('#dlg').close(); route = {name:'home', id:null}; commit(); toast('백업 파일을 불러왔습니다.');
        }catch{toast('파일을 읽지 못했습니다. JSON 형식인지 확인하세요.');}
      };
    }
  });
}

/* ---------- merge import ---------- */
function mergeImport(obj){
  const t = nowIso(), n = {c:0, p:0, i:0, r:0};
  const key = s => String(s || '').replace(/\s+/g,'').replace(/^\(주\)|^주식회사|\(주\)$|㈜/g,'').toLowerCase();
  const byName = new Map(db.clients.map(c => [key(c.name), c]));
  const cMap = {}, iMap = {};
  (obj.clients || []).forEach(c => {
    const ex = byName.get(key(c.name));
    if(ex){
      cMap[c.id] = ex.id;
      if(c.notes && !(ex.notes || '').includes(c.notes.split('\n')[0])) ex.notes = (ex.notes ? ex.notes + '\n\n' : '') + c.notes;
      ['bizNo','industry','contact','rep','keyword','address','openDate'].forEach(k => { if(!ex[k] && c[k]) ex[k] = c[k]; });
      if(c.relation){
        const r = ex.relation || {}, nr = c.relation;
        ex.relation = {
          since: [r.since, nr.since].filter(Boolean).sort()[0] || '',
          last: [r.last, nr.last].filter(Boolean).sort().slice(-1)[0] || '',
          basis: r.basis && nr.basis && !r.basis.includes(nr.basis) ? r.basis + '; ' + nr.basis : (r.basis || nr.basis || '')
        };
      }
    } else {
      const nc = {...c, id:uid(), createdAt:t}; db.clients.push(nc); byName.set(key(nc.name), nc); cMap[c.id] = nc.id; n.c++;
    }
  });
  const cid = id => id ? (cMap[id] || (db.clients.some(c => c.id === id) ? id : null)) : null;
  (obj.items || []).forEach(i => {
    const c = cid(i.clientId); if(!c) return;
    const ex = db.items.find(x => x.clientId === c && key(x.name) === key(i.name));
    if(ex){iMap[i.id] = ex.id; return;}
    const ni = {...i, id:uid(), clientId:c, createdAt:t}; db.items.push(ni); iMap[i.id] = ni.id; n.i++;
  });
  (obj.procedures || []).forEach(p => {
    const c = cid(p.clientId);
    if(p.clientId && !c) return;
    if(db.procedures.some(x => (x.clientId || null) === c && x.type === p.type && key(x.title) === key(p.title))) return;
    db.procedures.push({...p, id:uid(), clientId:c, createdAt:t, updatedAt:t}); n.p++;
  });
  (obj.records || []).forEach(r => {
    const c = cid(r.clientId); if(!c) return;
    if(db.records.some(x => x.clientId === c && key(x.title) === key(r.title) && (x.date || x.startDate) === (r.date || r.startDate))) return;
    db.records.push({...r, id:uid(), clientId:c, itemId:r.itemId ? (iMap[r.itemId] || '') : '', createdAt:t, updatedAt:t}); n.r++;
  });
  n.k = 0; n.f = 0; n.kc = 0;
  (obj.kc || []).forEach(g => {
    const c = db.clients.find(x => key(x.name) === key(g.clientName)); if(!c) return;
    db.kc = (db.kc || []).filter(k => k.c !== c.id).concat((g.rows || []).map(r => ({...r, c:c.id})));
    db.kcMeta = db.kcMeta || {}; db.kcMeta[c.id] = {version: g.version || '', count: (g.rows || []).length};
    n.kc += (g.rows || []).length;
  });
  (obj.contacts || []).forEach(c => {
    if(db.contacts.some(x => x.cat === c.cat && key(x.name) === key(c.name) && (x.dept || '') === (c.dept || '') && (x.person || '') === (c.person || ''))) return;
    db.contacts.push({...c, id:uid()}); n.k++;
  });
  (obj.feeProfiles || []).forEach(p => {
    db.settings.feeProfiles = db.settings.feeProfiles || [];
    if(db.settings.feeProfiles.some(x => key(x.name) === key(p.name))) return;
    db.settings.feeProfiles.push({...p, id:uid()}); n.f++;
  });
  migrate(db);
  [...new Set([...(obj.procedures||[]), ...(obj.records||[])].map(x => x.type))].forEach(ty => { if(ty && !db.settings.taskTypes.includes(ty)) db.settings.taskTypes.push(ty); });
  return n;
}
