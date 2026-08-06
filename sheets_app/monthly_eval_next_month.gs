/**
 * 월말평가 워크북 전용 Apps Script
 * ------------------------------------------------------------------
 * 설치 방법:
 * 1. 월말평가 구글 시트(https://docs.google.com/spreadsheets/d/1XOnYT08eKlH6Lh1irAQw3pgTDGeLAA8mqq_uPfGpJUA)를 엽니다.
 * 2. 확장 프로그램 > Apps Script 클릭
 * 3. 기본 Code.gs 내용을 지우고 이 파일 전체를 붙여넣습니다.
 * 4. 저장(Ctrl+S) 후, 월말평가 시트로 돌아와 새로고침(F5)하면
 *    상단 메뉴에 "📊 월말평가 관리" 메뉴가 생깁니다.
 * 5. 처음 실행 시 구글 계정 권한 승인 창이 뜨면 승인해주세요.
 *    (같은 계정으로 메인 학원 스프레드시트도 열어야 해서 권한이 필요합니다)
 * ------------------------------------------------------------------
 */

// 재원생 목록을 가져올 메인 앱 스프레드시트 ID (원천DB가 있는 곳)
const MAIN_SPREADSHEET_ID = '1jwnEef3Irk9jc4LMm71efZ4NT8CH1XXKchIS7psy7MM';
const STUDENT_SHEET_NAME = '원천DB';

// 월말평가 탭의 데이터 시작 행 (1~3행: 안내/헤더, 4행부터 학생 데이터)
const DATA_START_ROW = 4;
// 학생 데이터가 들어가는 마지막 열 (W열 = 23번째)
const LAST_COL = 23; // A=1 ... W=23

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 월말평가 관리')
    .addItem('다음달 시트 생성', 'createNextMonthSheet')
    .addToUi();
}

/**
 * 현재 워크북에서 'YYYY.MM' 형식 탭 중 가장 최신 탭을 찾아
 * 다음 달 탭을 복제 생성하고, 재원생 명단으로 학생 행을 갱신합니다.
 */
function createNextMonthSheet() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. 'YYYY.MM' 형식 탭 중 최신 탭 찾기
  const monthPattern = /^(\d{4})\.(\d{2})$/;
  const monthSheets = ss.getSheets()
    .map(sh => ({ sheet: sh, name: sh.getName() }))
    .filter(o => monthPattern.test(o.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (monthSheets.length === 0) {
    ui.alert('오류', "'YYYY.MM' 형식의 월말평가 탭을 찾을 수 없습니다.", ui.ButtonSet.OK);
    return;
  }

  const latest = monthSheets[monthSheets.length - 1];
  const match = latest.name.match(monthPattern);
  let year = parseInt(match[1], 10);
  let month = parseInt(match[2], 10) + 1;
  if (month > 12) { month = 1; year += 1; }
  const nextMonthName = `${year}.${String(month).padStart(2, '0')}`;

  // 이미 존재하면 중단 (실수로 중복 생성 방지)
  if (ss.getSheetByName(nextMonthName)) {
    ui.alert('알림', `"${nextMonthName}" 탭이 이미 존재합니다.`, ui.ButtonSet.OK);
    return;
  }

  const confirm = ui.alert(
    '다음달 시트 생성',
    `"${latest.name}" 탭을 복제하여 "${nextMonthName}" 탭을 만들고,\n현재 재원생 명단으로 학생 목록을 갱신합니다.\n\n계속할까요?`,
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  // 2. 이전 달 탭의 학생별 "이번달 단원명(E열)" 값을 이름 기준으로 저장 (→ 다음달의 전월단원명으로 승계)
  const oldSheet = latest.sheet;
  const oldLastRow = oldSheet.getLastRow();
  const prevUnitByName = {};
  const prevTeacherByName = {};
  const prevSemesterByName = {};
  if (oldLastRow >= DATA_START_ROW) {
    const oldData = oldSheet.getRange(DATA_START_ROW, 1, oldLastRow - DATA_START_ROW + 1, 7).getValues(); // A~G
    oldData.forEach(row => {
      const name = String(row[0] || '').trim();
      if (!name) return;
      prevUnitByName[name] = row[4]; // E열: 이번달 단원명 → 다음달엔 전월단원명이 됨
      prevSemesterByName[name] = row[3]; // D열: 학기
      prevTeacherByName[name] = row[6]; // G열: 선생님
    });
  }

  // 3. 시트 복제 (서식/수식 그대로 유지됨)
  const newSheet = oldSheet.copyTo(ss);
  newSheet.setName(nextMonthName);
  // 새 탭을 맨 앞쪽(월말평가 최신 탭 자리)으로 이동
  ss.setActiveSheet(newSheet);
  ss.moveActiveSheet(2); // 1번은 보통 '설문지 응답' 등 고정 탭이라 2번째 자리에 둠 (환경에 따라 조정 가능)

  // 4. 메인 스프레드시트에서 재원생 목록 가져오기
  const mainSs = SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);
  const studentSheet = mainSs.getSheetByName(STUDENT_SHEET_NAME);
  if (!studentSheet) {
    ui.alert('오류', `메인 스프레드시트에서 '${STUDENT_SHEET_NAME}' 시트를 찾을 수 없습니다. 시트는 생성됐지만 명단은 비어있습니다.`, ui.ButtonSet.OK);
    return;
  }
  const studentData = studentSheet.getRange(2, 1, Math.max(studentSheet.getLastRow() - 1, 0), 12).getValues(); // A2:L
  // 원천DB: A=ID B=이름 C=학부(예: "초등부"/"중등부"/"고등부") D=학교 E=학년(예: "4학년") F=반ID G=강사ID H=재원상태 I=등록일 J=종료일 K=학부모연락처 L=학생연락처
  const activeStudents = studentData
    .filter(r => String(r[7] || '').trim() === '재원')
    .map(r => {
      const dept = String(r[2] || '');
      const gradeNum = (String(r[4] || '').match(/\d+/) || [''])[0];
      let level = '';
      if (dept.includes('초')) level = '초';
      else if (dept.includes('중')) level = '중';
      else if (dept.includes('고')) level = '고';
      return { name: String(r[1] || '').trim(), gradeLabel: level + gradeNum, gradeNum };
    })
    .filter(s => s.name);

  // 5. 기존 학생 데이터 행 지우기 (서식은 유지, 값만 삭제)
  const newLastRow = newSheet.getLastRow();
  if (newLastRow >= DATA_START_ROW) {
    newSheet.getRange(DATA_START_ROW, 1, newLastRow - DATA_START_ROW + 1, LAST_COL).clearContent();
  }

  // 6. 재원생 명단으로 A~D, F~G열 채우기 (E열=이번달 단원명은 선생님이 직접 입력하도록 공란)
  if (activeStudents.length > 0) {
    // 필요한 만큼 행 확보
    const neededRows = DATA_START_ROW + activeStudents.length - 1;
    if (newSheet.getMaxRows() < neededRows) {
      newSheet.insertRowsAfter(newSheet.getMaxRows(), neededRows - newSheet.getMaxRows());
    }

    const rows = activeStudents.map(s => [
      s.name,                                   // A: 이름
      s.gradeLabel,                              // B: 현학년 (예: 초4)
      s.gradeNum,                                // C: 학년 (숫자만)
      prevSemesterByName[s.name] || '',          // D: 학기 (지난달 값 승계)
      '',                                        // E: 이번달 단원명 (직접 입력)
      prevUnitByName[s.name] || '',              // F: 전월 단원명 (지난달 E열 승계)
      prevTeacherByName[s.name] || ''            // G: 선생님 (지난달 값 승계, 신규생은 공란)
    ]);
    newSheet.getRange(DATA_START_ROW, 1, rows.length, 7).setValues(rows);
  }

  ui.alert(
    '완료',
    `"${nextMonthName}" 탭이 생성되었습니다.\n재원생 ${activeStudents.length}명의 명단을 채웠습니다.\n\n※ 신규 학생은 학기/선생님 칸이 비어있으니 확인 후 채워주세요.\n※ 이번달 단원명(E열)은 선생님이 직접 입력해야 합니다.`,
    ui.ButtonSet.OK
  );
}
