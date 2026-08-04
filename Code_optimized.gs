// ============================================================
// 캐시 유틸 함수
// ============================================================
function invalidateCache(keys) {
  const cache = CacheService.getScriptCache();
  keys.forEach(k => { try { cache.remove(k); } catch(e) {} });
}

// ============================================================
// doGet - 변경 없음
// ============================================================
function doGet() {
  return HtmlService.createTemplateFromFile('index')
      .evaluate()
      .setTitle('수학의 힘 통합 관리 시스템')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ============================================================
// autoUpgradeDB - 변경 없음
// ============================================================
function autoUpgradeDB() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let absSheet = ss.getSheetByName('결근예정');
    if(!absSheet) { absSheet = ss.insertSheet('결근예정'); absSheet.appendRow(['등록일시', '강사명', '결근예정일', '사유']); }
    let attSheet = ss.getSheetByName('출결기록');
    if(!attSheet) { attSheet = ss.insertSheet('출결기록'); attSheet.appendRow(['타임스탬프', '학생ID', '학생명', '수업일자', '담당강사', '출결상태', '과제상태', '진도교재', '진도범위', '과제교재', '과제범위', 'T1종류', 'T1정답', 'T1총문항', 'T2종류', 'T2정답', 'T2총문항', '개별코멘트', '제출상태', '알림톡내용', '새교재명', '교재비']); }
    let mkSheet = ss.getSheetByName('보강일정');
    if(!mkSheet) { mkSheet = ss.insertSheet('보강일정'); mkSheet.appendRow(['학생ID', '학생명', '결석일자', '보강일자', '시작시간', '종료시간', '담당강사', '강의실', '보강상태']); }
    let cnSheet = ss.getSheetByName('상담기록');
    if(!cnSheet) { cnSheet = ss.insertSheet('상담기록'); cnSheet.appendRow(['학생ID', '학생명', '상담일자', '상담유형', '상담내용', '상담자']); }
    let tAttSheet = ss.getSheetByName('강사근태');
    if(!tAttSheet) { tAttSheet = ss.insertSheet('강사근태'); tAttSheet.appendRow(['일자', '강사명', '출근시간', '퇴근시간', '비고']); }
    let holSheet = ss.getSheetByName('휴일DB');
    if(!holSheet) { holSheet = ss.insertSheet('휴일DB'); holSheet.appendRow(['휴일일자', '사유']); }
    let bookSheet = ss.getSheetByName('교재DB');
    if(!bookSheet) { bookSheet = ss.insertSheet('교재DB'); bookSheet.appendRow(['교재명', '분류', '가격']); bookSheet.appendRow(['쎈(중1-1)', '중등', '15000']); }
    let tDB = ss.getSheetByName('강사DB');
    if(tDB && tDB.getRange(1, 7).getValue() !== '비밀번호') { tDB.getRange(1, 7).setValue('비밀번호'); }
  } catch (e) { console.error("DB 초기화 오류:", e); }
}

// ============================================================
// ★ getLoginInitData - 캐시 1시간
// ============================================================
function getLoginInitData() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('login_init');
  if (cached) return JSON.parse(cached);

  autoUpgradeDB();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const teacherSheet = ss.getSheetByName('강사DB');
  const tData = teacherSheet ? teacherSheet.getDataRange().getDisplayValues() : [];
  const rawTeachersData = ['원장님'];
  if(tData.length > 1) {
    let displayColIdx = tData[0].indexOf('표시') !== -1 ? tData[0].indexOf('표시') : 5;
    for(let i=1; i<tData.length; i++) {
      let tName = tData[i].length > displayColIdx ? String(tData[i][displayColIdx] || "").trim() : "";
      if(tName) rawTeachersData.push(tName);
    }
  }
  const cleanTeachers = Array.from(new Set(rawTeachersData.map(t => t.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim()))).sort();
  cleanTeachers.sort((a, b) => { if (a === '원장님') return -1; if (b === '원장님') return 1; return a.localeCompare(b); });
  const result = { success: true, teacherList: cleanTeachers };
  try { cache.put('login_init', JSON.stringify(result), 3600); } catch(e) {}
  return result;
}

// ============================================================
// verifyLogin - 변경 없음
// ============================================================
function verifyLogin(username, password) {
  try {
    if(username === '원장님' && password === '0000') { return { success: true, role: '원장', name: '원장님' }; }
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const teacherSheet = ss.getSheetByName('강사DB');
    if(!teacherSheet) return { success: false, error: "강사DB 시트가 없습니다." };
    const tData = teacherSheet.getDataRange().getDisplayValues();
    let headers = tData[0] || [];
    let displayColIdx = headers.indexOf('표시') !== -1 ? headers.indexOf('표시') : 5;
    let pwColIdx = headers.indexOf('비밀번호') !== -1 ? headers.indexOf('비밀번호') : 6;
    let roleColIdx = headers.indexOf('권한');
    for(let i=1; i<tData.length; i++) {
      let r = tData[i] || [];
      let rawName = r.length > displayColIdx ? String(r[displayColIdx] || "").trim() : "";
      let tName = rawName.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim();
      let tPw = r.length > pwColIdx ? String(r[pwColIdx] || "").trim() : "";
      let tRole = (roleColIdx !== -1 && r.length > roleColIdx) ? String(r[roleColIdx] || "").trim() : "강사";
      if(tName === username && tPw === password) {
         if(rawName.includes('원장') || tRole === '원장') return { success: true, role: '원장', name: tName };
         else return { success: true, role: '강사', name: tName };
      }
    }
    return { success: false, error: "비밀번호가 일치하지 않습니다." };
  } catch(e) { return { success: false, error: e.toString() }; }
}

// ============================================================
// ★ getInitData - 캐시 30분
// ============================================================
function getInitData() {
  try {
    const cache = CacheService.getScriptCache();
    const cached = cache.get('init_data');
    if (cached) return JSON.parse(cached);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const teacherSheet = ss.getSheetByName('강사DB');
    const tData = teacherSheet ? teacherSheet.getDataRange().getDisplayValues() : [];
    const rawTeachersData = [];
    if(tData.length > 1) {
      let displayColIdx = tData[0].indexOf('표시') !== -1 ? tData[0].indexOf('표시') : 5;
      for(let i=1; i<tData.length; i++) {
        let tName = tData[i].length > displayColIdx ? String(tData[i][displayColIdx] || "").trim() : "";
        if(tName) rawTeachersData.push(tName);
      }
    }
    const cleanTeachers = Array.from(new Set(rawTeachersData.map(t => t.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim()))).sort();
    const rawTeachers = Array.from(new Set(rawTeachersData)).sort();

    const sourceSheet = ss.getSheetByName('원천DB');
    const sourceData = sourceSheet ? sourceSheet.getDataRange().getValues() : [];
    const sourceStudents = [];
    let sHeaders = sourceData[0] || [];
    let sNameIdx = sHeaders.indexOf('학생명') !== -1 ? sHeaders.indexOf('학생명') : sHeaders.indexOf('이름');
    let sIdIdx = sHeaders.indexOf('학생ID');
    let sFullIdx = sHeaders.indexOf('표시') !== -1 ? sHeaders.indexOf('표시') : sHeaders.indexOf('표시용이름');
    for(let i = 1; i < sourceData.length; i++) {
      let r = sourceData[i] || [];
      let fullDisplay = sFullIdx !== -1 && r[sFullIdx] ? String(r[sFullIdx]).trim() : `${r[sIdIdx]} ${r[sNameIdx]}`;
      if (fullDisplay && fullDisplay !== "undefined undefined") sourceStudents.push(fullDisplay);
    }

    const cnSheet = ss.getSheetByName('상담기록');
    const counselRows = cnSheet ? cnSheet.getDataRange().getDisplayValues().slice(1).reverse() : [];
    const simpleStudents = sourceData.slice(1).filter(r => r && r.length > 1 && r[sNameIdx]).map(r => ({
      id: String(r[sIdIdx] || ""), name: String(r[sNameIdx] || ""), full: sFullIdx !== -1 && r[sFullIdx] ? String(r[sFullIdx] || "") : `${r[sIdIdx]} ${r[sNameIdx]}`
    }));
    const bookSheet = ss.getSheetByName('교재DB');
    const bookList = bookSheet ? bookSheet.getDataRange().getDisplayValues().slice(1).map(r => ({ name: String(r[0] || ""), price: r.length > 2 ? String(r[2] || "") : "" })).filter(b => b.name) : [];

    const result = { success: true, sourceStudents: sourceStudents.sort(), simpleStudents, rawTeachers, cleanTeachers, counselRows, bookList };
    try { cache.put('init_data', JSON.stringify(result), 1800); } catch(e) {}
    return result;
  } catch (e) { return { success: false, error: e.toString() }; }
}

// ============================================================
// ★ getScheduleData - 캐시 10분 + 주간 필터링
// ============================================================
function getScheduleData(baseDateStr) {
  try {
    const cacheKey = 'schedule_' + (baseDateStr || 'today');
    const cache = CacheService.getScriptCache();
    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const enrSheet = ss.getSheetByName('수강DB');
    const schSheet = ss.getSheetByName('수강일정DB');
    const attSheet = ss.getSheetByName('출결기록');
    let targetDate = baseDateStr ? new Date(baseDateStr) : new Date();
    let day = targetDate.getDay(); let diff = targetDate.getDate() - day + (day === 0 ? -6 : 1); let monday = new Date(targetDate.setDate(diff));
    let weekDates = []; let weekMap = {}; let dateMap = {}; let dayNames = ['일','월','화','수','목','금','토'];
    for(let i=0; i<7; i++) {
      let d = new Date(monday); d.setDate(monday.getDate() + i);
      let dStr = Utilities.formatDate(d, "GMT+9", "yyyy-MM-dd"); let dName = dayNames[d.getDay()];
      weekDates.push({ day: dName, date: dStr, label: `${dName} (${d.getMonth()+1}/${d.getDate()})` });
      weekMap[dName] = dStr; dateMap[dStr] = dName;
    }
    // ★ 주간 날짜 범위
    const weekStart = weekDates[0].date;
    const weekEnd   = weekDates[weekDates.length - 1].date;

    let holSheet = ss.getSheetByName('휴일DB'); let holidayMap = {};
    if(holSheet && holSheet.getLastRow() > 1) {
      let hData = holSheet.getDataRange().getDisplayValues();
      for(let i=1; i<hData.length; i++) { if(hData[i][0]) holidayMap[hData[i][0]] = hData[i][1] || "휴원일"; }
    }

    const enrData = enrSheet.getDataRange().getValues();
    const schData = schSheet.getDataRange().getDisplayValues();
    const attMap = {}; const lastUsedBookMap = {};

    if (attSheet && attSheet.getLastRow() > 0) {
      const attData = attSheet.getDataRange().getValues();
      const headers = attData[0];
      const hIdx = {
        date: headers.indexOf('수업일자'), tName: headers.indexOf('담당강사'), sId: headers.indexOf('학생ID'),
        att: headers.indexOf('출결상태'), hw: headers.indexOf('과제상태'),
        pBook: headers.indexOf('진도교재'), pRange: headers.indexOf('진도범위'),
        hwBook: headers.indexOf('과제교재'), hwRange: headers.indexOf('과제범위'),
        t1Type: headers.indexOf('T1종류'), t1Cor: headers.indexOf('T1정답'), t1Tot: headers.indexOf('T1총문항'),
        t2Type: headers.indexOf('T2종류'), t2Cor: headers.indexOf('T2정답'), t2Tot: headers.indexOf('T2총문항'),
        memo: headers.indexOf('개별코멘트'), status: headers.indexOf('제출상태'),
        newBook: headers.indexOf('새교재명'), bookFee: headers.indexOf('교재비')
      };
      for (let i = 1; i < attData.length; i++) {
        let r = attData[i]; if(!r[hIdx.date]) continue;
        let dStr = r[hIdx.date] instanceof Date ? Utilities.formatDate(r[hIdx.date], "GMT+9", "yyyy-MM-dd") : r[hIdx.date].toString().trim();
        let tId = r[hIdx.tName] ? r[hIdx.tName].toString().trim() : "";
        let sId = r[hIdx.sId] ? r[hIdx.sId].toString().trim() : "";
        // ★ lastUsedBookMap은 전체 기록 필요 (이번 주 외도 수집)
        if(r[hIdx.pBook] || r[hIdx.hwBook]) lastUsedBookMap[sId] = { pBook: String(r[hIdx.pBook] || ""), hwBook: String(r[hIdx.hwBook] || "") };
        // ★ attMap은 이번 주 데이터만 수집 (핵심 최적화)
        if(dStr < weekStart || dStr > weekEnd) continue;
        attMap[`${dStr}_${tId}_${sId}`] = { att: String(r[hIdx.att] || ""), hw: String(r[hIdx.hw] || ""), pBook: String(r[hIdx.pBook] || ""), pRange: String(r[hIdx.pRange] || ""), hwBook: String(r[hIdx.hwBook] || ""), hwRange: String(r[hIdx.hwRange] || ""), t1Type: String(r[hIdx.t1Type] || "일일"), t1Cor: String(r[hIdx.t1Cor] || ""), t1Tot: String(r[hIdx.t1Tot] || ""), t2Type: String(r[hIdx.t2Type] || "일일"), t2Cor: String(r[hIdx.t2Cor] || ""), t2Tot: String(r[hIdx.t2Tot] || ""), memo: String(r[hIdx.memo] || ""), status: String(r[hIdx.status] || "임시저장"), newBook: String(r[hIdx.newBook] || ""), bookFee: String(r[hIdx.bookFee] || "") };
      }
    }

    let now = new Date(); now.setHours(0,0,0,0); const activeEnrMap = {};
    for (let i = 1; i < enrData.length; i++) {
      let studentStr = enrData[i][0] ? enrData[i][0].toString().trim() : ""; let status = enrData[i][7] ? enrData[i][7].toString().trim() : "";
      let start = enrData[i][5] instanceof Date ? enrData[i][5] : new Date('2000-01-01'); let end = enrData[i][6] instanceof Date ? enrData[i][6] : new Date('2099-12-31');
      if (status === "재원" && studentStr) { let sId = studentStr.split(' ')[0]; activeEnrMap[sId] = { start: start, end: end }; }
    }

    const groupedEvents = {}; const teacherMap = {};
    for (let j = 1; j < schData.length; j++) {
      const row = schData[j]; const schStudentStr = row[0] ? row[0].toString().trim() : "";
      const sId = schStudentStr.split(' ')[0]; let sNameOnly = schStudentStr.replace(sId, '').trim(); if(!sNameOnly) sNameOnly = sId;
      let enrInfo = activeEnrMap[sId];
      if (row[14] === "활성" && enrInfo) {
        const cleanT = row[9] ? row[9].toString().replace(/\([^)]*\)/g, '').trim() : ""; if(cleanT) teacherMap[cleanT] = cleanT;
        let dayName = row[4]; let classDateStr = weekMap[dayName];
        if(classDateStr && !holidayMap[classDateStr]) {
          let cDate = new Date(classDateStr);
          if(cDate >= enrInfo.start && cDate <= enrInfo.end) {
            const endFormatted = formatTimeSafe(row[7]); let endHour = parseInt(endFormatted.split(':')[0], 10);
            let stdStartStr = formatTimeSafe(row[6]) || (endHour-2).toString().padStart(2,'0') + ":00"; let stdTimeStr = `${stdStartStr} ~ ${endFormatted}`;
            const displayBadge = row[13] ? row[13].toString().trim() : (sNameOnly || "이름없음");
            let parsedLevel = "초"; let bracketText = schStudentStr.match(/\(([^)]+)\)/); if (bracketText) { if (bracketText[1].includes("고")) parsedLevel = "고"; else if (bracketText[1].includes("중")) parsedLevel = "중"; }
            const key = `${classDateStr}_${endFormatted}_${row[11]}_${cleanT}`;
            if (!groupedEvents[key]) groupedEvents[key] = { id: 'evt_'+j+'_'+classDateStr, day: dayName, date: classDateStr, timeStr: stdTimeStr, start: classDateStr + "T" + stdStartStr, teacherId: cleanT, room: row[11], studentsObj: {}, commonProgress: "" };
            let record = attMap[`${classDateStr}_${cleanT}_${sId}`] || null; let lastUsed = lastUsedBookMap[sId] || {pBook:"", pRange:"", hwBook:"", hwRange:""};
            groupedEvents[key].studentsObj[sId] = { id: sId, name: sNameOnly, full: schStudentStr, badge: displayBadge, record: record, level: parsedLevel, lastUsed: lastUsed };
          }
        }
      }
    }

    let mkSheet = ss.getSheetByName('보강일정');
    if(mkSheet && mkSheet.getLastRow() > 1) {
      let mkData = mkSheet.getDataRange().getDisplayValues(); const mkHeaders = mkData[0];
      const mIdx = { sId: mkHeaders.indexOf('학생ID'), sName: mkHeaders.indexOf('학생명'), date: mkHeaders.indexOf('보강일자'), start: mkHeaders.indexOf('시작시간'), end: mkHeaders.indexOf('종료시간'), teacher: mkHeaders.indexOf('담당강사'), room: mkHeaders.indexOf('강의실'), status: mkHeaders.indexOf('보강상태') };
      for(let m=1; m<mkData.length; m++) {
        let r = mkData[m]; let mDateStr = r[mIdx.date]; let mStatus = r[mIdx.status];
        if(dateMap[mDateStr] && mStatus !== '취소') {
          let sId = String(r[mIdx.sId]).trim(); let sNameOnly = String(r[mIdx.sName]).trim(); let startT = formatTimeSafe(r[mIdx.start]); let endT = formatTimeSafe(r[mIdx.end]);
          let tName = r[mIdx.teacher]; let room = r[mIdx.room]; let dayName = dateMap[mDateStr]; if(tName) teacherMap[tName] = tName;
          let stdTimeStr = `${startT} ~ ${endT}`;
          const key = `${mDateStr}_${endT}_${room}_${tName}`;
          if (!groupedEvents[key]) groupedEvents[key] = { id: 'mk_'+m+'_'+mDateStr, day: dayName, date: mDateStr, timeStr: stdTimeStr, start: mDateStr + "T" + startT, teacherId: tName, room: room, studentsObj: {}, commonProgress: "보강 수업 진행" };
          let record = attMap[`${mDateStr}_${tName}_${sId}`] || null; let lastUsed = lastUsedBookMap[sId] || {pBook:"", pRange:"", hwBook:"", hwRange:""};
          groupedEvents[key].studentsObj[sId] = { id: sId, name: sNameOnly, full: sId+" "+sNameOnly, badge: sNameOnly, record: record, level: "보강", lastUsed: lastUsed };
        }
      }
    }

    const events = Object.values(groupedEvents).map(ev => {
      let students = Object.keys(ev.studentsObj).map(sId => ev.studentsObj[sId]);
      let totalSt = students.length; let recCount = students.filter(s => s.record).length; let absentCount = students.filter(s => s.record && s.record.att === '결석').length; let draftCount = students.filter(s => s.record && s.record.status !== '최종제출' && s.record.att !== '결석').length;
      let statusLevel = 0; if (recCount > 0) { if (recCount < totalSt || draftCount > 0) statusLevel = 1; else { if (absentCount === totalSt) statusLevel = 3; else statusLevel = 2; } }
      return { ...ev, students, statusLevel };
    });

    let absSheet = ss.getSheetByName('결근예정'); let plannedAbsences = [];
    if(absSheet && absSheet.getLastRow() > 1) {
      let absData = absSheet.getDataRange().getDisplayValues();
      let todayStr = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd");
      for(let i=1; i<absData.length; i++) { if (absData[i][2] >= todayStr) { plannedAbsences.push({ teacher: absData[i][1], date: absData[i][2], reason: absData[i][3] }); } }
      plannedAbsences.sort((a,b) => a.date.localeCompare(b.date));
    }

    const result = { success: true, events, weekDates, today: Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd"), holidayMap: holidayMap, plannedAbsences: plannedAbsences };
    try { cache.put(cacheKey, JSON.stringify(result), 600); } catch(e) {}
    return result;
  } catch (e) { return { success: false, error: e.toString() }; }
}

// ============================================================
// ★ toggleHolidayStatus - 저장 후 캐시 무효화
// ============================================================
function toggleHolidayStatus(dateStr, memo, isCancel) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet(); let sheet = ss.getSheetByName('휴일DB');
    let data = sheet.getDataRange().getValues(); let foundRow = -1;
    for(let i=1; i<data.length; i++) { let dStr = data[i][0] instanceof Date ? Utilities.formatDate(data[i][0], "GMT+9", "yyyy-MM-dd") : data[i][0].toString().trim(); if(dStr === dateStr) { foundRow = i + 1; break; } }
    if (isCancel) { if (foundRow !== -1) sheet.deleteRow(foundRow); } else { if (foundRow !== -1) sheet.getRange(foundRow, 2).setValue(memo); else sheet.appendRow([dateStr, memo]); }
    // ★ 캐시 무효화
    invalidateCache(['schedule_today', 'schedule_' + dateStr]);
    return { success: true };
  } catch(e) { return { success: false, error: e.toString() }; }
}

// ============================================================
// ★ saveAttendanceData - 저장 후 캐시 무효화
// ============================================================
function saveAttendanceData(date, teacherId, progress, records, submitType) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet(); let sheet = ss.getSheetByName('출결기록');
    const timeStamp = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd HH:mm:ss");
    let data = sheet.getDataRange().getValues(); const headers = data[0];
    const mapHeader = (name) => headers.indexOf(name) !== -1 ? headers.indexOf(name) : headers.length;
    const c = {
      ts: mapHeader('타임스탬프'), sId: mapHeader('학생ID'), sName: mapHeader('학생명'), date: mapHeader('수업일자'), teacher: mapHeader('담당강사'),
      att: mapHeader('출결상태'), hw: mapHeader('과제상태'), pBook: mapHeader('진도교재'), pRange: mapHeader('진도범위'), hwBook: mapHeader('과제교재'), hwRange: mapHeader('과제범위'),
      t1Type: mapHeader('T1종류'), t1Cor: mapHeader('T1정답'), t1Tot: mapHeader('T1총문항'), t2Type: mapHeader('T2종류'), t2Cor: mapHeader('T2정답'), t2Tot: mapHeader('T2총문항'),
      memo: mapHeader('개별코멘트'), status: mapHeader('제출상태'), alimtalk: mapHeader('알림톡내용'), newBook: mapHeader('새교재명'), bookFee: mapHeader('교재비')
    };
    let rowsToAppend = []; let updates = [];
    records.forEach(r => {
      let foundRow = -1; let existingAlimtalk = "";
      for(let i=1; i<data.length; i++) {
        if(!data[i][c.date]) continue; let dStr = data[i][c.date] instanceof Date ? Utilities.formatDate(data[i][c.date], "GMT+9", "yyyy-MM-dd") : data[i][c.date].toString().trim();
        if(dStr === date && data[i][c.teacher] == teacherId && String(data[i][c.sId]).trim() === String(r.id).trim()) { foundRow = i + 1; existingAlimtalk = data[i][c.alimtalk] || ""; break; }
      }
      let rowData = new Array(headers.length).fill("");
      rowData[c.ts] = timeStamp; rowData[c.date] = date; rowData[c.teacher] = teacherId; rowData[c.sId] = r.id; rowData[c.sName] = r.name;
      rowData[c.att] = r.attendance; rowData[c.hw] = r.task; rowData[c.pBook] = r.pBook; rowData[c.pRange] = r.pRange; rowData[c.hwBook] = r.hwBook; rowData[c.hwRange] = r.hwRange;
      rowData[c.t1Type] = r.t1Type; rowData[c.t1Cor] = r.t1Cor; rowData[c.t1Tot] = r.t1Tot; rowData[c.t2Type] = r.t2Type; rowData[c.t2Cor] = r.t2Cor; rowData[c.t2Tot] = r.t2Tot;
      rowData[c.memo] = r.memo; rowData[c.status] = submitType; rowData[c.alimtalk] = existingAlimtalk; rowData[c.newBook] = r.newBook; rowData[c.bookFee] = r.bookFee;
      if(foundRow !== -1) updates.push({row: foundRow, vals: rowData}); else rowsToAppend.push(rowData);
    });
    updates.forEach(u => sheet.getRange(u.row, 1, 1, headers.length).setValues([u.vals]));
    if(rowsToAppend.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, headers.length).setValues(rowsToAppend);

    let mkSheet = ss.getSheetByName('보강일정');
    if(mkSheet && mkSheet.getLastRow() > 1) {
      let mkData = mkSheet.getDataRange().getValues(); let mkHeaders = mkData[0];
      let mkDIdx = mkHeaders.indexOf('보강일자'); let mkTIdx = mkHeaders.indexOf('담당강사'); let mkSIdIdx = mkHeaders.indexOf('학생ID'); let mkStatIdx = mkHeaders.indexOf('보강상태');
      let mkUpdates = [];
      records.forEach(r => {
        for(let m=1; m<mkData.length; m++) {
          if(!mkData[m][mkDIdx]) continue;
          let mDateStr = mkData[m][mkDIdx] instanceof Date ? Utilities.formatDate(mkData[m][mkDIdx], "GMT+9", "yyyy-MM-dd") : mkData[m][mkDIdx].toString().trim();
          let mTeacher = String(mkData[m][mkTIdx]).trim(); let mStudentId = String(mkData[m][mkSIdIdx]).trim();
          if(mDateStr === date && mTeacher === teacherId && mStudentId === String(r.id).trim()) {
            let newMkStatus = (r.attendance === '결석') ? '보강결석' : '완료'; mkUpdates.push({row: m+1, col: mkStatIdx+1, val: newMkStatus});
          }
        }
      });
      mkUpdates.forEach(mu => mkSheet.getRange(mu.row, mu.col).setValue(mu.val));
    }
    // ★ 캐시 무효화
    invalidateCache(['schedule_today', 'schedule_' + date]);
    return { success: true };
  } catch(e) { return { success: false, error: e.toString() }; }
}

// ============================================================
// updateAlimtalkText - 변경 없음 (캐시 영향 없음)
// ============================================================
function updateAlimtalkText(date, teacherId, textRecords) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let attSheet = ss.getSheetByName('출결기록');
    let attData = attSheet.getDataRange().getValues(); let attHeaders = attData[0];
    let aDateIdx = attHeaders.indexOf('수업일자'); let aTIdx = attHeaders.indexOf('담당강사'); let aSIdIdx = attHeaders.indexOf('학생ID'); let aTalkIdx = attHeaders.indexOf('알림톡내용');
    let sourceSheet = ss.getSheetByName('원천DB'); let sourceData = sourceSheet.getDataRange().getValues(); let sHeaders = sourceData[0];
    let sIdIdx = sHeaders.findIndex(h => h && String(h).replace(/\s/g, '') === '학생ID');
    let sNameIdx = sHeaders.findIndex(h => h && (String(h).replace(/\s/g, '') === '학생명' || String(h).replace(/\s/g, '') === '이름'));
    let sPhoneIdx = sHeaders.findIndex(h => h && (String(h).replace(/\s/g, '').includes('부모연락') || String(h).replace(/\s/g, '').includes('부모HP')));
    if (sPhoneIdx === -1) sPhoneIdx = 10; if (sIdIdx === -1) sIdIdx = 0; if (sNameIdx === -1) sNameIdx = 1;
    let phoneMap = {};
    for(let i=1; i<sourceData.length; i++) {
      let sId = String(sourceData[i][sIdIdx] || "").trim(); let sName = String(sourceData[i][sNameIdx] || "").trim(); let pPhone = String(sourceData[i][sPhoneIdx] || "").trim();
      if(sId) phoneMap[sId] = { name: sName, phone: pPhone };
      if(sName) phoneMap[sName] = { name: sName, phone: pPhone };
    }
    let targetSS = SpreadsheetApp.openById('1hlklodChPmHcnD2_pEp6po6SjQaDhtBs9CtvntAvaP0');
    let smsSheet = targetSS.getSheetByName('SMS발송');
    if (!smsSheet) return { success: false, error: "문자 파일에 'SMS발송' 시트가 없습니다." };
    let smsColA = smsSheet.getRange("A1:A" + Math.max(smsSheet.getLastRow(), 1)).getValues();
    let insertRow = -1;
    for (let i = 1; i < smsColA.length; i++) { if (!smsColA[i][0] || String(smsColA[i][0]).trim() === "") { insertRow = i + 1; break; } }
    if (insertRow === -1) insertRow = Math.max(smsSheet.getLastRow() + 1, 2);
    let smsUpdates = [];
    let colT = attSheet.getRange(1, aTalkIdx + 1, Math.max(attSheet.getLastRow(), 1), 1).getValues();
    textRecords.forEach(r => {
      let cleanRecordId = String(r.id || "").trim(); let safeName = String(r.name || "").trim();
      for(let i=1; i<attData.length; i++) {
        let dStr = attData[i][aDateIdx] instanceof Date ? Utilities.formatDate(attData[i][aDateIdx], "GMT+9", "yyyy-MM-dd") : attData[i][aDateIdx].toString().trim();
        if(dStr === date && attData[i][aTIdx] == teacherId && String(attData[i][aSIdIdx]).trim() === cleanRecordId) { colT[i][0] = r.text; break; }
      }
      let studentInfo = phoneMap[cleanRecordId] || phoneMap[safeName] || { name: safeName || cleanRecordId, phone: "" };
      let rawPhone = studentInfo.phone.toString().replace(/[^0-9]/g, '');
      let finalPhone = "";
      if (rawPhone.length === 11) finalPhone = rawPhone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
      else if (rawPhone.length === 10) finalPhone = rawPhone.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
      else if (rawPhone.length > 0) finalPhone = rawPhone;
      if(r.text && r.text.trim() !== "") { smsUpdates.push([ finalPhone, studentInfo.name, r.text, '대기중', '미확정', 'LMS 자동발송' ]); }
    });
    if(attSheet.getLastRow() > 0) attSheet.getRange(1, aTalkIdx + 1, colT.length, 1).setValues(colT);
    if(smsUpdates.length > 0) smsSheet.getRange(insertRow, 1, smsUpdates.length, 6).setValues(smsUpdates);
    return { success: true, count: smsUpdates.length };
  } catch(e) { return { success: false, error: "문자 연동 에러: " + e.toString() }; }
}

// ============================================================
// 나머지 함수들 - 변경 없음
// ============================================================
function getAbsenteeData() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet(); const sheet = ss.getSheetByName('출결기록');
    if(!sheet) return { success: true, pending: [], scheduled: [], completed: [] };
    let sourceSheet = ss.getSheetByName('원천DB'); let sourceData = sourceSheet ? sourceSheet.getDataRange().getValues() : []; let sHeaders = sourceData[0] || [];
    let sIdIdx = sHeaders.indexOf('학생ID'); let sNameIdx = sHeaders.indexOf('이름'); let sFullIdx = sHeaders.indexOf('표시용이름');
    let nameMap = {};
    for(let i=1; i<sourceData.length; i++) {
      let sId = String(sourceData[i][sIdIdx] || "").trim();
      let sName = sFullIdx !== -1 && sourceData[i][sFullIdx] ? String(sourceData[i][sFullIdx]).trim() : String(sourceData[i][sNameIdx] || "").trim();
      if(sId) nameMap[sId] = sName;
    }
    let mkSheet = ss.getSheetByName('보강일정'); let scheduledMap = {};
    if(mkSheet && mkSheet.getLastRow() > 1) {
      let mkData = mkSheet.getDataRange().getDisplayValues(); let mkHeaders = mkData[0];
      let mkIdIdx = mkHeaders.indexOf('학생ID'); let mkDateIdx = mkHeaders.indexOf('결석일자'); let mkStartIdx = mkHeaders.indexOf('시작시간'); let mkEndIdx = mkHeaders.indexOf('종료시간'); let mkTIdx = mkHeaders.indexOf('담당강사'); let mkStatIdx = mkHeaders.indexOf('보강상태'); let mkMkDateIdx = mkHeaders.indexOf('보강일자');
      for(let j=1; j<mkData.length; j++) { let key = mkData[j][mkIdIdx] + "_" + mkData[j][mkDateIdx]; scheduledMap[key] = { mkDate: mkData[j][mkMkDateIdx], mkTime: mkData[j][mkStartIdx] + "~" + mkData[j][mkEndIdx], mkTeacher: mkData[j][mkTIdx], status: mkData[j][mkStatIdx] }; }
    }
    const data = sheet.getDataRange().getDisplayValues(); let attHeaders = data[0];
    let aDateIdx = attHeaders.indexOf('수업일자'); let aTIdx = attHeaders.indexOf('담당강사'); let aSIdIdx = attHeaders.indexOf('학생ID'); let aAttIdx = attHeaders.indexOf('출결상태'); let aMemoIdx = attHeaders.indexOf('개별코멘트');
    let pending = []; let scheduled = []; let completed = [];
    for(let i = data.length - 1; i > 0; i--) {
      if(data[i][aAttIdx] === '결석') {
        let sId = String(data[i][aSIdIdx]).trim(); let sName = nameMap[sId] || sId; if(!sName || sName.trim() === "") sName = "이름없음";
        let aDate = data[i][aDateIdx] instanceof Date ? Utilities.formatDate(data[i][aDateIdx], "GMT+9", "yyyy-MM-dd") : data[i][aDateIdx].toString().trim();
        let key = sId + "_" + aDate; let memo = data[i][aMemoIdx] || "사유 미기재";
        if(scheduledMap[key]) { let mkInfo = scheduledMap[key]; let item = { date: aDate, teacher: data[i][aTIdx], id: sId, student: sName, memo: memo, mkInfo: mkInfo }; if(mkInfo.status === '예약') scheduled.push(item); else completed.push(item); }
        else { pending.push({ date: aDate, teacher: data[i][aTIdx], id: sId, student: sName, memo: memo }); }
      }
    }
    return { success: true, pending, scheduled, completed };
  } catch(e) { return { success: false, error: e.toString() }; }
}

function getStudentHistory(sId, studentName) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const attSheet = ss.getSheetByName('출결기록'); const attData = attSheet ? attSheet.getDataRange().getDisplayValues() : [];
    let studentAtts = []; let aIdx = {};
    if (attData.length > 0) {
      let h = attData[0];
      aIdx = { date: h.indexOf('수업일자'), teacher: h.indexOf('담당강사'), sId: h.indexOf('학생ID'), att: h.indexOf('출결상태'), hw: h.indexOf('과제상태'), pBook: h.indexOf('진도교재'), pRange: h.indexOf('진도범위'), hwBook: h.indexOf('과제교재'), hwRange: h.indexOf('과제범위'), t1Cor: h.indexOf('T1정답'), t1Tot: h.indexOf('T1총문항'), t2Cor: h.indexOf('T2정답'), t2Tot: h.indexOf('T2총문항'), memo: h.indexOf('개별코멘트') };
      studentAtts = attData.slice(1).filter(r => String(r[aIdx.sId]).trim() === String(sId).trim());
    }
    const cSheet = ss.getSheetByName('상담기록'); const cData = cSheet ? cSheet.getDataRange().getDisplayValues() : [];
    let history = [];
    if (cData.length > 0) { let ch = cData[0]; let csIdIdx = ch.indexOf('학생ID'); history = cData.slice(1).filter(r => String(r[csIdIdx]).trim() === String(sId).trim()).reverse(); }
    const mkSheet = ss.getSheetByName('보강일정'); const mkData = mkSheet ? mkSheet.getDataRange().getDisplayValues() : [];
    let present=0, late=0, absent=0, hwDone=0, hwPoor=0, hwNone=0; const chartData = { dates: [], scores: [] }; const attendanceList = [];
    studentAtts.forEach(r => {
      let attStat = r[aIdx.att]; let hwStat = r[aIdx.hw];
      if (attStat === '출석') present++; else if (attStat === '지각') late++; else if (attStat === '결석') absent++;
      if (hwStat === '완료') hwDone++; else if (hwStat === '미흡') hwPoor++; else if (hwStat === '미제출') hwNone++;
      let dStr = r[aIdx.date] instanceof Date ? Utilities.formatDate(r[aIdx.date], "GMT+9", "yyyy-MM-dd") : r[aIdx.date].toString().trim(); let dateShort = dStr.substring(5, 10);
      let t1Cor = parseInt(r[aIdx.t1Cor]); let t1Tot = parseInt(r[aIdx.t1Tot]);
      if (!isNaN(t1Cor)) { chartData.dates.push(dateShort); chartData.scores.push(isNaN(t1Tot) || t1Tot===0 ? t1Cor : Math.round((t1Cor / t1Tot) * 100)); }
      let pStr = (r[aIdx.pBook] || "").replace(/\|/g, ', '); if(r[aIdx.pRange]) pStr += ` (${(r[aIdx.pRange] || "").replace(/\|/g, ', ')})`;
      let hwStr = (r[aIdx.hwBook] || hwStat || "").replace(/\|/g, ', '); if(r[aIdx.hwRange]) hwStr += ` (${(r[aIdx.hwRange] || "").replace(/\|/g, ', ')})`;
      attendanceList.push({ date: dStr, att: attStat, hw: hwStr, teacher: r[aIdx.teacher], memo: r[aIdx.memo], prog: pStr, t1: isNaN(t1Cor) ? "-" : `${t1Cor}/${r[aIdx.t1Tot]||''}`, t2: isNaN(parseInt(r[aIdx.t2Cor])) ? "-" : `${r[aIdx.t2Cor]}/${r[aIdx.t2Tot]||''}` });
    });
    attendanceList.sort((a,b) => new Date(b.date) - new Date(a.date));
    let pendingMakeups = 0; let completedMakeups = 0;
    if(mkData.length > 0) {
      let mh = mkData[0]; let msIdIdx = mh.indexOf('학생ID'); let mStatIdx = mh.indexOf('보강상태');
      mkData.slice(1).forEach(m => { let mId = String(m[msIdIdx] || "").trim(); if(mId === String(sId).trim() && m[mStatIdx] !== '취소') { if(m[mStatIdx] === '예약') pendingMakeups++; else if(m[mStatIdx] === '완료') completedMakeups++; } });
    }
    let requiredMakeups = absent - completedMakeups - pendingMakeups; if(requiredMakeups < 0) requiredMakeups = 0;
    const stats = { present, late, absent, hwDone, hwPoor, hwNone, total: studentAtts.length, requiredMakeups, pendingMakeups, completedMakeups };
    return { success: true, history, stats, chartData, attendanceList };
  } catch(e) { return { success: false, error: e.toString() }; }
}

function saveMakeupClass(form) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet(); let sheet = ss.getSheetByName('보강일정');
    sheet.appendRow([form.id, form.student, form.absentDate, form.mkDate, "'" + form.mkStart, "'" + form.mkEnd, form.mkTeacher, form.mkRoom, '예약']);
    invalidateCache(['schedule_today', 'schedule_' + form.mkDate]);
    return { success: true };
  } catch(e) { return { success: false, error: e.toString() }; }
}

function getTemplates() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet(); let sheet = ss.getSheetByName('알림톡설정');
    if(!sheet || sheet.getLastRow() <= 1) {
      if(!sheet) sheet = ss.insertSheet('알림톡설정'); sheet.clear();
      sheet.appendRow(['템플릿명', '내용']); sheet.appendRow(['기본형', '안녕하세요. 수학의 힘 💙{name} 담임 {name_t}입니다.🥰\n{class_m}월 {class_date}일 수업내용 안내드립니다.\n\n💙우리 {name} {test_category} 테스트는 {total_num}문제 중 {correct_num}문제 정답입니다.😊\n💙우리 {name}는 {procedure}했습니다.😊\n\n👉 {test_category} 테스트 결과\n{correct_num}문제 / {total_num}문제\n\n👉 숙제 (수행률: {homework_feedback})\n{hw}\n\n🌈 수학의 힘이 되겠습니다. 감사합니다.😊']);
    }
    const data = sheet.getDataRange().getDisplayValues(); const templates = [];
    for(let i=1; i<data.length; i++) { if(data[i][0]) templates.push({ title: data[i][0], content: data[i][1] }); }
    return { success: true, templates: templates };
  } catch(e) { return { success: false, error: e.toString() }; }
}

function saveTemplate(title, content) { try { const ss = SpreadsheetApp.getActiveSpreadsheet(); let sheet = ss.getSheetByName('알림톡설정'); let data = sheet.getDataRange().getValues(); let found = false; for(let i=1; i<data.length; i++) { if(data[i][0] === title) { sheet.getRange(i+1, 2).setValue(content); found = true; break; } } if(!found) sheet.appendRow([title, content]); return { success: true }; } catch(e) { return { success: false, error: e.toString() }; } }
function deleteTemplate(title) { try { const ss = SpreadsheetApp.getActiveSpreadsheet(); let sheet = ss.getSheetByName('알림톡설정'); let data = sheet.getDataRange().getValues(); for(let i=1; i<data.length; i++) { if(data[i][0] === title) { sheet.deleteRow(i+1); return { success: true }; } } return { success: false, error: "템플릿을 찾을 수 없습니다." }; } catch(e) { return { success: false, error: e.toString() }; } }
function saveCounsel(f) {
  try {
    const ss=SpreadsheetApp.getActiveSpreadsheet(); let s=ss.getSheetByName('상담기록');
    s.appendRow([f.id, f.studentName, f.date, "정기상담", f.content, f.teacher]);
    invalidateCache(['init_data']);
    return {success:true};
  } catch(e) { return { success: false, error: e.toString() }; }
}
function getStudentData() { try { const ss = SpreadsheetApp.getActiveSpreadsheet(); const sheet = ss.getSheetByName('원천DB'); const data = sheet.getDataRange().getDisplayValues(); const headers = ["학생ID", "이름", "학부", "학교", "학년", "상태", "등록일", "종료일"]; const rows = []; for(let i=1; i<data.length; i++) { if(!data[i][1]) continue; rows.push([ data[i][0], data[i][1], data[i][2], data[i][3], data[i][4], data[i][7], data[i][8], data[i][9], data[i][10] || "", data[i][11] || "", data[i][12] || "", data[i][15] || "" ]); } return { success: true, headers: headers, rows: rows }; } catch(e) { return { success: false, error: e.toString() }; } }
function registerNewStudent(form) { try { const ss = SpreadsheetApp.getActiveSpreadsheet(); let sheet = ss.getSheetByName('원천DB'); let colB = sheet.getRange("B1:B" + sheet.getMaxRows()).getValues(); let emptyRow = colB.findIndex((r, idx) => idx > 0 && (!r[0] || r[0].toString().trim() === "")) + 1; if (emptyRow === 0) emptyRow = sheet.getLastRow() + 1; sheet.getRange(emptyRow, 2).setValue(form.name); sheet.getRange(emptyRow, 3).setValue(form.dept); sheet.getRange(emptyRow, 4).setValue(form.school); sheet.getRange(emptyRow, 5).setValue(form.grade); sheet.getRange(emptyRow, 8).setValue(form.status); sheet.getRange(emptyRow, 9).setValue(form.regDate); sheet.getRange(emptyRow, 11).setValue(form.parentHp); sheet.getRange(emptyRow, 12).setValue(form.studentHp); sheet.getRange(emptyRow, 13).setValue(form.memo); invalidateCache(['init_data']); return { success: true }; } catch(e) { return { success: false, error: e.toString() }; } }
function updateStudentDetails(form) { try { const ss = SpreadsheetApp.getActiveSpreadsheet(); let sheet = ss.getSheetByName('원천DB'); let data = sheet.getDataRange().getValues(); for(let i=1; i<data.length; i++) { if(data[i][0] === form.id) { sheet.getRange(i+1, 2).setValue(form.name); sheet.getRange(i+1, 3).setValue(form.dept); sheet.getRange(i+1, 4).setValue(form.school); sheet.getRange(i+1, 5).setValue(form.grade); sheet.getRange(i+1, 11).setValue(form.parentHp); sheet.getRange(i+1, 12).setValue(form.studentHp); sheet.getRange(i+1, 13).setValue(form.memo); invalidateCache(['init_data']); return { success: true }; } } return { success: false, error: "학생을 찾을 수 없습니다." }; } catch(e) { return { success: false, error: e.toString() }; } }
function updateStudentStatus(studentId, newStatus, endDate) { try { const ss = SpreadsheetApp.getActiveSpreadsheet(); let sheet = ss.getSheetByName('원천DB'); let data = sheet.getDataRange().getValues(); for(let i=1; i<data.length; i++) { if(data[i][0] == studentId) { sheet.getRange(i+1, 8).setValue(newStatus); if(endDate) sheet.getRange(i+1, 10).setValue(endDate); invalidateCache(['init_data']); return { success: true }; } } return { success: false, error: "학생을 찾을 수 없습니다." }; } catch(e) { return { success: false, error: e.toString() }; } }
function saveRegistrationData(form) { try { const ss = SpreadsheetApp.getActiveSpreadsheet(); let enrSheet = ss.getSheetByName('수강DB'); let schSheet = ss.getSheetByName('수강일정DB'); let exactStudentName = form.studentDisplay.trim(); let enrColA = enrSheet.getRange("A1:A" + enrSheet.getMaxRows()).getValues(); let emptyEnrRow = enrColA.findIndex((r, idx) => idx > 0 && (!r[0] || r[0].toString().trim() === "")) + 1; if (emptyEnrRow === 0) emptyEnrRow = enrSheet.getLastRow() + 1; enrSheet.getRange(emptyEnrRow, 1).clearDataValidations().setValue(exactStudentName); enrSheet.getRange(emptyEnrRow, 4).setValue(form.homeroomTeacher); enrSheet.getRange(emptyEnrRow, 5).setValue(form.classType); enrSheet.getRange(emptyEnrRow, 6).setValue(form.startDate); enrSheet.getRange(emptyEnrRow, 8).setValue("재원"); let schColA = schSheet.getRange("A1:A" + schSheet.getMaxRows()).getValues(); let currentSchRow = schColA.findIndex((r, idx) => idx > 0 && (!r[0] || r[0].toString().trim() === "")) + 1; form.schedules.forEach(sched => { schSheet.getRange(currentSchRow, 1).setValue(exactStudentName); schSheet.getRange(currentSchRow, 5).setValue(sched.day); schSheet.getRange(currentSchRow, 7).setValue("'" + sched.start); schSheet.getRange(currentSchRow, 8).setValue("'" + sched.end); schSheet.getRange(currentSchRow, 10).setValue(sched.teacherName); schSheet.getRange(currentSchRow, 12).setValue(sched.room); schSheet.getRange(currentSchRow, 15).setValue("활성"); currentSchRow++; }); invalidateCache(['init_data', 'schedule_today']); return { success: true }; } catch (e) { return { success: false, error: e.toString() }; } }
function formatTimeSafe(t) { if(!t || !t.toString().includes(':')) return "09:00"; let p = t.toString().split(':'); return p[0].padStart(2,'0')+":"+p[1].padStart(2,'0'); }
function getTAttData() { try { const ss = SpreadsheetApp.getActiveSpreadsheet(); let sheet = ss.getSheetByName('강사근태'); if(!sheet) return { success: true, records: [] }; const data = sheet.getDataRange().getDisplayValues(); const records = []; for(let i=1; i<data.length; i++) { if(data[i][0]) records.push({ date: data[i][0], teacher: data[i][1], inTime: data[i][2], outTime: data[i][3], memo: data[i][4] }); } return { success: true, records: records }; } catch(e) { return { success: false, error: e.toString() }; } }
function saveTAttRecord(date, teacher, inTime, outTime, memo) { try { const ss = SpreadsheetApp.getActiveSpreadsheet(); let sheet = ss.getSheetByName('강사근태'); let data = sheet.getDataRange().getValues(); let foundRow = -1; for(let i=1; i<data.length; i++) { let dStr = data[i][0] instanceof Date ? Utilities.formatDate(data[i][0], "GMT+9", "yyyy-MM-dd") : data[i][0].toString().trim(); if(dStr === date && data[i][1] === teacher) { foundRow = i + 1; break; } } if(foundRow !== -1) { sheet.getRange(foundRow, 1, 1, 5).setValues([[date, teacher, inTime?"'"+inTime:"", outTime?"'"+outTime:"", memo]]); } else { sheet.appendRow([date, teacher, inTime?"'"+inTime:"", outTime?"'"+outTime:"", memo]); } return { success: true }; } catch(e) { return { success: false, error: e.toString() }; } }
function savePlannedAbsence(date, teacher, reason) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('결근예정');
    if(!sheet) { sheet = ss.insertSheet('결근예정'); sheet.appendRow(['등록일시', '강사명', '결근예정일', '사유']); }
    let ts = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd HH:mm:ss");
    sheet.appendRow([ts, teacher, date, reason]);
    invalidateCache(['schedule_today']);
    return { success: true };
  } catch(e) { return { success: false, error: e.toString() }; }
}
