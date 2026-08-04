// ============================================================
// 학원 관리 자동화 Apps Script
// 이 코드를 해당 스프레드시트의 확장 프로그램 > Apps Script에 붙여넣고
// setupTriggers() 함수를 1회 실행하면 모든 자동화가 시작됩니다.
// ============================================================

// ============================================================
// ★ 1. 학생ID 자동 생성 (원천DB 새 행 입력 시)
// 이름 입력 → 학생ID 자동 채번 (예: S2026001)
// ============================================================
function onEdit(e) {
  var sheet = e.range.getSheet();
  var sheetName = sheet.getName();

  // 원천DB: B열(이름)에 값 입력 시 A열에 학생ID 자동 생성
  if (sheetName === '원천DB' && e.range.getColumn() === 2 && e.range.getRow() > 1) {
    var row = e.range.getRow();
    var existingId = sheet.getRange(row, 1).getValue();
    if (!existingId || existingId.toString().trim() === '') {
      var newId = generateStudentId_(sheet);
      sheet.getRange(row, 1).setValue(newId);
    }
  }

  // 강사DB: B열(이름) 입력 시 A열에 강사ID 자동 생성
  if (sheetName === '강사DB' && e.range.getColumn() === 2 && e.range.getRow() > 1) {
    var row2 = e.range.getRow();
    var existingTId = sheet.getRange(row2, 1).getValue();
    if (!existingTId || existingTId.toString().trim() === '') {
      var tId = generateTeacherId_(sheet);
      sheet.getRange(row2, 1).setValue(tId);
    }
  }

  // 출결기록: A열(타임스탬프) 자동 기록 (새 행 입력 시)
  if (sheetName === '출결기록' && e.range.getColumn() !== 1 && e.range.getRow() > 1) {
    var row3 = e.range.getRow();
    var tsCell = sheet.getRange(row3, 1);
    if (!tsCell.getValue()) {
      tsCell.setValue(new Date());
      tsCell.setNumberFormat('yyyy-MM-dd HH:mm:ss');
    }
  }
}

function generateStudentId_(sheet) {
  var year = new Date().getFullYear();
  var prefix = 'S' + year;
  var data = sheet.getDataRange().getValues();
  var maxNum = 0;
  for (var i = 1; i < data.length; i++) {
    var id = String(data[i][0] || '');
    if (id.startsWith(prefix)) {
      var num = parseInt(id.replace(prefix, ''), 10) || 0;
      if (num > maxNum) maxNum = num;
    }
  }
  return prefix + String(maxNum + 1).padStart(3, '0');
}

function generateTeacherId_(sheet) {
  var year = new Date().getFullYear();
  var prefix = 'T' + year;
  var data = sheet.getDataRange().getValues();
  var maxNum = 0;
  for (var i = 1; i < data.length; i++) {
    var id = String(data[i][0] || '');
    if (id.startsWith(prefix)) {
      var num = parseInt(id.replace(prefix, ''), 10) || 0;
      if (num > maxNum) maxNum = num;
    }
  }
  return prefix + String(maxNum + 1).padStart(2, '0');
}

// ============================================================
// ★ 2. 월별 출결 통계 리포트 자동 생성
// 매월 1일 자동 실행 or 수동 실행 가능
// ============================================================
function generateMonthlyReport() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var attSheet = ss.getSheetByName('출결기록');
  var studentSheet = ss.getSheetByName('원천DB');

  if (!attSheet || !studentSheet) {
    SpreadsheetApp.getUi().alert('출결기록 또는 원천DB 시트가 없습니다.');
    return;
  }

  // 지난달 기준
  var now = new Date();
  var lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  var targetYM = Utilities.formatDate(lastMonth, 'Asia/Seoul', 'yyyy-MM');
  var reportSheetName = targetYM + ' 월간리포트';

  // 기존 리포트 시트 삭제 후 재생성
  var existingReport = ss.getSheetByName(reportSheetName);
  if (existingReport) ss.deleteSheet(existingReport);
  var reportSheet = ss.insertSheet(reportSheetName);

  // 헤더
  var headers = ['학생ID', '학생명', '총수업', '출석', '지각', '결석', '출석률(%)', '과제완료', '과제미흡', '과제미제출', '테스트평균(%)'];
  reportSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  reportSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1a73e8').setFontColor('white');

  // 출결기록 읽기
  var attData = attSheet.getDataRange().getValues();
  var attHeaders = attData[0];
  var dateIdx = attHeaders.indexOf('수업일자');
  var sIdIdx = attHeaders.indexOf('학생ID');
  var sNameIdx = attHeaders.indexOf('학생명');
  var attIdx = attHeaders.indexOf('출결상태');
  var hwIdx = attHeaders.indexOf('과제상태');
  var t1CorIdx = attHeaders.indexOf('T1정답');
  var t1TotIdx = attHeaders.indexOf('T1총문항');

  // 학생별 집계
  var stats = {};
  for (var i = 1; i < attData.length; i++) {
    var row = attData[i];
    if (!row[dateIdx]) continue;
    var dStr = row[dateIdx] instanceof Date
      ? Utilities.formatDate(row[dateIdx], 'Asia/Seoul', 'yyyy-MM')
      : String(row[dateIdx]).substring(0, 7);
    if (dStr !== targetYM) continue;

    var sId = String(row[sIdIdx] || '').trim();
    var sName = String(row[sNameIdx] || '').trim();
    if (!sId) continue;
    if (!stats[sId]) stats[sId] = { name: sName, total: 0, att: 0, late: 0, abs: 0, hwO: 0, hwM: 0, hwX: 0, scores: [] };

    var s = stats[sId];
    s.total++;
    var attVal = String(row[attIdx] || '');
    if (attVal === '출석') s.att++;
    else if (attVal === '지각') s.late++;
    else if (attVal === '결석') s.abs++;

    var hwVal = String(row[hwIdx] || '');
    if (hwVal === '완료') s.hwO++;
    else if (hwVal === '미흡') s.hwM++;
    else if (hwVal === '미제출') s.hwX++;

    var t1Cor = parseFloat(row[t1CorIdx]);
    var t1Tot = parseFloat(row[t1TotIdx]);
    if (!isNaN(t1Cor) && !isNaN(t1Tot) && t1Tot > 0) s.scores.push(Math.round((t1Cor / t1Tot) * 100));
  }

  // 리포트 행 작성
  var reportRows = [];
  Object.keys(stats).forEach(function(sId) {
    var s = stats[sId];
    var attRate = s.total > 0 ? Math.round(((s.att + s.late) / s.total) * 100) : 0;
    var avgScore = s.scores.length > 0 ? Math.round(s.scores.reduce(function(a, b) { return a + b; }, 0) / s.scores.length) : '-';
    reportRows.push([sId, s.name, s.total, s.att, s.late, s.abs, attRate, s.hwO, s.hwM, s.hwX, avgScore]);
  });

  if (reportRows.length > 0) {
    reportSheet.getRange(2, 1, reportRows.length, headers.length).setValues(reportRows);
    // 출석률 컬럼 조건부 색상
    for (var r = 2; r <= reportRows.length + 1; r++) {
      var rate = reportSheet.getRange(r, 7).getValue();
      var bg = rate >= 90 ? '#c6efce' : (rate >= 70 ? '#ffeb9c' : '#ffc7ce');
      reportSheet.getRange(r, 7).setBackground(bg);
    }
  }

  reportSheet.autoResizeColumns(1, headers.length);
  SpreadsheetApp.getUi().alert(targetYM + ' 월간 리포트 생성 완료! (' + reportRows.length + '명)');
}

// ============================================================
// ★ 3. 결석 3회 이상 학생 자동 감지 및 강조
// 수동 또는 매주 월요일 자동 실행
// ============================================================
function checkFrequentAbsences() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var attSheet = ss.getSheetByName('출결기록');
  if (!attSheet) return;

  var attData = attSheet.getDataRange().getValues();
  var attHeaders = attData[0];
  var sIdIdx = attHeaders.indexOf('학생ID');
  var sNameIdx = attHeaders.indexOf('학생명');
  var attIdx = attHeaders.indexOf('출결상태');
  var dateIdx = attHeaders.indexOf('수업일자');

  // 최근 30일만 체크
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  var absCount = {};
  var nameMap = {};
  for (var i = 1; i < attData.length; i++) {
    var row = attData[i];
    if (!row[dateIdx] || String(row[attIdx]) !== '결석') continue;
    var d = row[dateIdx] instanceof Date ? row[dateIdx] : new Date(row[dateIdx]);
    if (d < cutoff) continue;
    var sId = String(row[sIdIdx] || '').trim();
    nameMap[sId] = String(row[sNameIdx] || '').trim();
    absCount[sId] = (absCount[sId] || 0) + 1;
  }

  var alerts = [];
  Object.keys(absCount).forEach(function(sId) {
    if (absCount[sId] >= 3) {
      alerts.push(nameMap[sId] + ' (' + sId + '): ' + absCount[sId] + '회 결석');
    }
  });

  if (alerts.length > 0) {
    SpreadsheetApp.getUi().alert('⚠️ 최근 30일 결석 3회 이상 학생\n\n' + alerts.join('\n'));
  } else {
    SpreadsheetApp.getUi().alert('✅ 최근 30일 내 결석 3회 이상 학생이 없습니다!');
  }
}

// ============================================================
// ★ 4. 재원 현황 대시보드 자동 업데이트
// '현황' 시트에 재원생 수 통계를 자동 집계
// ============================================================
function updateStatusDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var studentSheet = ss.getSheetByName('원천DB');
  if (!studentSheet) return;

  var dashSheet = ss.getSheetByName('현황대시보드') || ss.insertSheet('현황대시보드');
  dashSheet.clearContents();

  var data = studentSheet.getDataRange().getValues();
  var headers = data[0];
  var deptIdx = headers.indexOf('학부');
  var gradeIdx = headers.indexOf('학년');
  var statusIdx = headers.indexOf('상태');

  var deptStats = { '초등부': {}, '중등부': {}, '고등부': {} };
  var total = 0;

  for (var i = 1; i < data.length; i++) {
    var status = String(data[i][statusIdx] || '').trim();
    if (status !== '재원') continue;
    total++;
    var dept = String(data[i][deptIdx] || '기타').trim();
    var grade = String(data[i][gradeIdx] || '미분류').trim();
    if (!deptStats[dept]) deptStats[dept] = {};
    deptStats[dept][grade] = (deptStats[dept][grade] || 0) + 1;
  }

  var now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  dashSheet.getRange('A1').setValue('📊 재원 현황 대시보드 (갱신: ' + now + ')');
  dashSheet.getRange('A1').setFontWeight('bold').setFontSize(13);
  dashSheet.getRange('A2').setValue('전체 재원생: ' + total + '명');
  dashSheet.getRange('A2').setFontWeight('bold').setFontColor('#1a73e8');

  var row = 4;
  ['초등부', '중등부', '고등부'].forEach(function(dept) {
    var grades = deptStats[dept] || {};
    var deptTotal = Object.values(grades).reduce(function(a, b) { return a + b; }, 0);
    dashSheet.getRange(row, 1).setValue(dept + ' (' + deptTotal + '명)').setFontWeight('bold');
    row++;
    Object.keys(grades).sort().forEach(function(g) {
      dashSheet.getRange(row, 2).setValue(g);
      dashSheet.getRange(row, 3).setValue(grades[g] + '명');
      row++;
    });
    row++;
  });

  dashSheet.autoResizeColumns(1, 3);
  SpreadsheetApp.getUi().alert('현황 대시보드 업데이트 완료!');
}

// ============================================================
// ★ 5. 커스텀 메뉴 추가 (스프레드시트 열 때 자동 표시)
// ============================================================
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('🏫 학원 자동화')
    .addItem('📊 월간 리포트 생성', 'generateMonthlyReport')
    .addItem('⚠️ 결석 다발 학생 확인', 'checkFrequentAbsences')
    .addItem('📈 재원 현황 업데이트', 'updateStatusDashboard')
    .addSeparator()
    .addItem('🔧 트리거 설정 (최초 1회)', 'setupTriggers')
    .addToUi();
}

// ============================================================
// ★ 6. 트리거 자동 설정 (최초 1회만 실행)
// - 매월 1일 오전 9시: 월간 리포트 생성
// - 매주 월요일 오전 8시: 결석 다발 학생 체크
// ============================================================
function setupTriggers() {
  // 기존 트리거 모두 삭제
  ScriptApp.getProjectTriggers().forEach(function(t) {
    ScriptApp.deleteTrigger(t);
  });

  // 매월 1일 오전 9시 - 월간 리포트
  ScriptApp.newTrigger('generateMonthlyReport')
    .timeBased()
    .onMonthDay(1)
    .atHour(9)
    .create();

  // 매주 월요일 오전 8시 - 결석 체크
  ScriptApp.newTrigger('checkFrequentAbsences')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)
    .create();

  SpreadsheetApp.getUi().alert('✅ 자동화 트리거 설정 완료!\n\n• 매월 1일 오전 9시: 월간 리포트 생성\n• 매주 월요일 오전 8시: 결석 다발 학생 체크\n• 새 학생/강사 입력 시: ID 자동 생성');
}
