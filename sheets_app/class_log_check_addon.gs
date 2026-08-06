/******************************************************
 * 학습내용(수업일지) 입력 누락 체크 - SMS 발송 스크립트 추가분
 * ------------------------------------------------------------------
 * 설치 방법:
 * 1. SMS 발송 스프레드시트의 Apps Script 편집기를 엽니다.
 *    (기존 "통합발송" 메뉴가 있는 그 스크립트 프로젝트)
 * 2. 이 파일의 함수 3개(checkMissingClassLogs_, sendMissingClassLogReport_)를
 *    기존 스크립트 맨 아래에 그대로 붙여넣습니다.
 * 3. 기존 autoSendAndNotify() 함수를 찾아서, sendCompletionEmail(); 바로 다음 줄에
 *    sendMissingClassLogReport_();  한 줄만 추가합니다. (아래 "수정 예시" 참고)
 * 4. 저장하면 끝. 기존 트리거(밤 9:30 / 다음날 낮 12:00)에 자동으로 같이 실행됩니다.
 *
 * 동작 방식:
 * - 밤 9:30 실행 시각(14시 이후) → 오늘 수업 기준으로 체크
 * - 낮 12:00 실행 시각(14시 이전) → 어제 수업 기준으로 체크 (하루 지나도 안 채워진 것 잡아내기)
 * - "수강일정DB"에서 해당 요일 정규수업 학생 목록을 뽑고,
 *   "출결기록"에서 그 날짜에 최종상태(S열/19번째 컬럼 = '최종')로 기록된 학생을 뺀 나머지를
 *   선생님별로 묶어서 이메일로 보고합니다.
 * ------------------------------------------------------------------
 * 수정 예시 (기존 autoSendAndNotify 함수):
 *
 * function autoSendAndNotify() {
 *   try {
 *     Logger.log('=== 자동발송 시작 ===');
 *     sendPendingAiNormalOnly_('ALIMTALK');
 *     Utilities.sleep(30000);
 *     syncFinalStatuses_();
 *     sendCompletionEmail();
 *     sendMissingClassLogReport_();   // ⬅ 이 줄만 추가
 *     Logger.log('=== 자동발송 완료 ===');
 *   } catch (e) {
 *     Logger.log('자동발송 에러: ' + e.message);
 *     try { GmailApp.sendEmail('cominging83@gmail.com', '[자동발송 오류]', String(e.message || e)); } catch(e2) {}
 *   }
 * }
 ******************************************************/

// 메인 앱 스프레드시트(원천DB/수강일정DB/출결기록이 있는 곳) - 기존 MAIN_SHEET_ID와 동일해야 함
// (이미 기존 스크립트에 MAIN_SHEET_ID가 선언되어 있으면 이 줄은 붙여넣지 마세요 - 중복 선언 에러 남)
// const MAIN_SHEET_ID = '1jwnEef3Irk9jc4LMm71efZ4NT8CH1XXKchIS7psy7MM';

function checkMissingClassLogs_() {
  const hour = new Date().getHours();
  const targetDate = new Date();
  if (hour < 14) { // 낮 12시 트리거로 판단 → 어제 수업 대상으로 체크
    targetDate.setDate(targetDate.getDate() - 1);
  }
  const targetDateStr = Utilities.formatDate(targetDate, 'Asia/Seoul', 'yyyy-MM-dd');
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const targetDayKor = dayNames[targetDate.getDay()];

  const mainSs = SpreadsheetApp.openById(MAIN_SHEET_ID);
  const scheduleSheet = mainSs.getSheetByName('수강일정DB');
  const attSheet = mainSs.getSheetByName('출결기록');
  if (!scheduleSheet || !attSheet) return { targetDateStr, missing: {} };

  const schedules = scheduleSheet.getDataRange().getValues().slice(1);
  const attendance = attSheet.getDataRange().getValues().slice(1);

  // 해당 날짜에 '최종' 상태로 기록된 학생 Set (학생ID/이름 둘 다 등록해서 매칭 누락 방지)
  const finalizedSet = new Set();
  attendance.forEach(r => {
    const date = String(r[3] || '').substring(0, 10);
    if (date !== targetDateStr) return;
    if (String(r[18] || '').trim() !== '최종') return;
    if (r[1]) finalizedSet.add(String(r[1]).trim());
    if (r[2]) finalizedSet.add(String(r[2]).trim());
  });

  const missingByTeacher = {};
  schedules.forEach(r => {
    if (String(r[4] || '').trim() !== targetDayKor) return;      // 요일 불일치
    if (String(r[14] || '').trim() === '비활성') return;          // 비활성 수업 제외

    const rawDisplay = String(r[0] || '');
    const namePart = rawDisplay.split('(')[0].trim();
    let sId = String(r[3] || '');
    if (sId.includes(':') || sId.includes('~') || !sId) sId = namePart;
    if (!namePart) return;
    if (finalizedSet.has(sId) || finalizedSet.has(namePart)) return; // 이미 최종기록됨

    const teacherRaw = String(r[9] || '');
    const teacher = teacherRaw.split('(')[0].trim() || '미확인';
    if (!missingByTeacher[teacher]) missingByTeacher[teacher] = [];
    if (missingByTeacher[teacher].indexOf(namePart) === -1) missingByTeacher[teacher].push(namePart);
  });

  return { targetDateStr, missing: missingByTeacher };
}

function sendMissingClassLogReport_() {
  try {
    const result = checkMissingClassLogs_();
    const targetDateStr = result.targetDateStr;
    const missing = result.missing;
    const teacherNames = Object.keys(missing);

    if (teacherNames.length === 0) {
      Logger.log('학습내용 누락 없음: ' + targetDateStr);
      return;
    }

    const bodyLines = [];
    bodyLines.push('[학습내용 입력 누락 알림]');
    bodyLines.push('');
    bodyLines.push('대상 날짜: ' + targetDateStr);
    bodyLines.push('');
    teacherNames.forEach(function (t) {
      bodyLines.push('▶ ' + t + ' 선생님 (' + missing[t].length + '명)');
      missing[t].forEach(function (n) { bodyLines.push('  - ' + n); });
      bodyLines.push('');
    });
    bodyLines.push('※ 수업일지(진도/숙제 등)가 아직 최종 저장되지 않은 학생 목록입니다.');

    const body = bodyLines.join('\n');
    const totalCount = teacherNames.reduce(function (sum, t) { return sum + missing[t].length; }, 0);

    ['cominging83@gmail.com', 'jyjy310@hanmail.net'].forEach(function (email) {
      GmailApp.sendEmail(email, '[학습내용 누락] ' + targetDateStr + ' - ' + totalCount + '명', body);
    });

    Logger.log('학습내용 누락 메일 발송 완료: ' + targetDateStr + ' (' + totalCount + '명)');
  } catch (e) {
    Logger.log('학습내용 누락 체크 에러: ' + e.message);
  }
}
