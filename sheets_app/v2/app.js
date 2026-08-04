// =========================================
// 수학의 힘 v2 - app.js
// 클라이언트 비즈니스 로직 및 UI 렌더링
// =========================================

// 전역 캐시
let appCache = {
  user: null,
  raw: null,      // 시트 원본 데이터
  schedule: null, // 파싱된 시간표
  templates: []   // 알림톡 템플릿 캐시
};
let globalSourceStudents = []; // 원천DB 학생 명단 (수강 등록용)
let allEvents = []; // 전체 수업 일정 명단 (출결 모달 매크로용)
let currentEventForModal = null; // 현재 모달이 열린 수업 정보

// ── 헬퍼: 시간 문자열 ↔ 분(minutes) ──
function toMins(t) {
  if (!t || !t.includes(':')) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}
function toTimeStr(m) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// 햄버거 메뉴 토글

// ─── 학년순 정렬 헬퍼 ───────────────────────────────────────────────
// 학교명(예: "수완하나중") 또는 학년(예: "2학년")에서 초/중/고 추출
function schoolTypeWeight(schoolName, grade) {
  const s = (schoolName || '') + (grade || '');
  if (s.includes('초')) return 1;
  if (s.includes('중')) return 2;
  if (s.includes('고')) return 3;
  return 4;
}
function gradeNumWeight(grade) {
  const m = (grade || '').match(/(\d+)/);
  return m ? parseInt(m[1]) : 99;
}
// students 배열(원천DB 행)을 학년순 정렬: 초→중→고, 같은 학교급이면 학년 숫자 오름차순
function sortStudentsByGrade(arr) {
  return [...arr].sort((a, b) => {
    const wa = schoolTypeWeight(a[3], a[4]);
    const wb = schoolTypeWeight(b[3], b[4]);
    if (wa !== wb) return wa - wb;
    return gradeNumWeight(a[4]) - gradeNumWeight(b[4]);
  });
}

// 화면 전환
const VIEW_TITLES = {
  DASHBOARD: '대시보드', SCHEDULE: '주간 시간표', ABSENTEE: '보강 관리',
  ABSENT: '보강 관리', STUDENT: '학생 관리', REGISTER: '수강 등록',
  COUNSEL: '상담 기록', BOOK: '교재 관리', TATT: '강사 근태',
  HISTORY: '기록 조회', SCORE: '성적 관리'
};

// =========================================
// 데이터 파싱 (Raw -> 앱 전용 JSON)
// =========================================
function parseRawData() {
  const { schedules, students, attendance } = appCache.raw;

  // 1. 오늘 날짜 (클라이언트 기준)
  const today = new Date().toISOString().substring(0, 10);

  // 2. 학생 데이터 파싱 (원천DB)
  const studentMap = {};
  for (let i = 1; i < students.length; i++) {
    const r = students[i];
    studentMap[r[0]] = {
      id: r[0], name: r[1], dept: r[2], school: r[3], grade: r[4],
      status: r[7], regDate: r[8]
    };
  }

  // 3. 오늘 시간표 파싱 (수강일정DB)
  const dayOfWeek = ['일', '월', '화', '수', '목', '금', '토'][new Date().getDay()];
  let todaysClasses = [];

  for (let i = 1; i < schedules.length; i++) {
    const r = schedules[i];
    // 요일 체크
    if (r[4] !== dayOfWeek) continue;

    // 강사 체크 (강사 권한이면 본인 수업만)
    if (appCache.user.role === '강사' && r[3] !== appCache.user.name) continue;

    // 학생 상태가 '재원'인지 확인
    const sId = r[0].replace(/[^a-zA-Z0-9]/g, ''); // 괄호 등 제거하고 ID만 추출 (개선 필요)
    let sLevel = "보강", sName = r[0]; // 표시명 사용

    todaysClasses.push({
      id: `evt_${i}`,
      timeStr: r[6], // 시작시간
      day: r[4],
      teacherId: r[3],
      room: r[11] || r[2], // 강의실
      statusLevel: 0, // 기본 미입력
      students: [{ id: sId, badge: sName, level: sLevel }]
    });
  }

  // 4. 출결 체크 상태 반영
  const todayAtt = attendance.filter(r => r[3] && String(r[3]).substring(0, 10) === today);

  // 상태 계산 (임시: 0: 대기, 1: 임시, 2: 완료)
  // 추후 고도화 필요

  appCache.schedule = {
    today: today,
    events: todaysClasses
  };

  // 🚀 [테스트 모드] 데이터 로딩 완료 직후 계정 스위치 위젯 실행
  if (typeof createTestLoginWidget === 'function') {
    createTestLoginWidget();
  }
}

// =================================================================
// 💡 [클릭 피드백 애니메이션] 버튼 누르면 대상이 꿀렁~ 하면서 파랗게 빛납니다!
// =================================================================
window.highlightSection = function (id) {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.transition = 'all 0.3s ease';
    el.style.transform = 'scale(1.02)';
    el.style.boxShadow = '0 0 20px rgba(13, 202, 240, 0.8)';
    el.style.zIndex = '10';
    el.style.position = 'relative';
    setTimeout(() => {
      el.style.transform = 'scale(1)';
      el.style.boxShadow = 'none';
      el.style.zIndex = '1';
    }, 500);
  }
};

// =================================================================
// 🚀 [코어 엔진] 데이터 초고속 탐색 및 객체 조립 헬퍼 (성능 최적화 O(1))
// =================================================================

// 1. 학생 룩업 캐싱 (루프 돌 때마다 전체 배열 훑는 현상 방지)
window.findStudentInfo = function (sId, sName) {
  if (!appCache.studentMap) {
    appCache.studentMap = new Map();
    appCache.studentNameMap = new Map();
    (appCache.raw.students || []).forEach(s => {
      if (s[0]) appCache.studentMap.set(s[0], s);
      if (s[1]) appCache.studentNameMap.set(s[1], s);
    });
  }
  return appCache.studentMap.get(sId) || appCache.studentNameMap.get(sName);
};

// 2. 출결 고속 탐색 (배열 통째로 복사해서 뒤집는 최악의 메모리 누수 방지)
window.getLatestAttendance = function (studentId, studentName, dateStr = null, exactDate = false) {
  const att = appCache.raw.attendance || [];
  // 원본 배열을 복사하지 않고 뒤에서부터 역순으로 직접 읽어 속도 10배 향상
  for (let i = att.length - 1; i >= 1; i--) {
    const r = att[i];
    if (r[1] === studentId || r[2] === studentName) {
      if (exactDate) {
        if ((r[3] || '').substring(0, 10) === dateStr) return r;
      } else {
        if (!dateStr || (r[3] || '').substring(0, 10) <= dateStr) return r;
      }
    }
  }
  return null;
};

// 3. 출결 Record 객체 조립 공장 (과거 기록이 Value로 박히는 버그 완전 차단!)
window.buildRecordFromRow = function (row, isDraft) {
  if (!row) return { att: '', hw: '' };

  // (이전) 글자가 DB에 오염되어 들어간 경우를 대비해 청소해줍니다.
  const cleanStr = (str) => typeof str === 'string' ? str.replace(/\(이전\)\s*/g, '').trim() : (str || '');

  return {
    att: isDraft ? row[5] : '',
    hw: isDraft ? row[6] : '',
    pBook: cleanStr(row[7]),
    pRange: isDraft ? cleanStr(row[8]) : '', // 👈 임시저장이 아니면 범위를 무조건 비워서 '지워지는 글씨'가 보이게!
    hwBook: cleanStr(row[9]),
    hwRange: isDraft ? cleanStr(row[10]) : '', // 👈 임시저장이 아니면 무조건 비움!
    t1Type: isDraft ? (row[11] || '일일') : '일일', t1Cor: isDraft ? row[12] : '', t1Tot: isDraft ? row[13] : '',
    t2Type: isDraft ? (row[14] || '일일') : '일일', t2Cor: isDraft ? row[15] : '', t2Tot: isDraft ? row[16] : '',
    memo: isDraft ? row[17] : '', newBook: isDraft ? row[20] : '', bookFee: isDraft ? row[21] : '',
    hwFeedback: isDraft ? row[22] : '', praise: isDraft ? row[23] : '', effort: isDraft ? row[24] : '',
    parentsNote: isDraft ? row[25] : '', indivLearning: isDraft ? row[26] : '', eventNotice: isDraft ? row[27] : '',
    privateMemo: isDraft ? row[28] : '', testFeedback: isDraft ? row[29] : ''
  };
};

// 새로고침 시 기존 캐시 깔끔하게 청소
const originalForceRefresh = window.forceRefresh;
window.forceRefresh = function () {
  appCache.studentMap = null;
  appCache.studentNameMap = null;
  if (originalForceRefresh) originalForceRefresh();
};

// =================================================================
// 🚀 관제탑 대시보드 (코어 엔진 유지 + 사라진 4개 위젯 완벽 부활!)
// =================================================================
window.loadDashboardView = function () {
  const schedules = (appCache.raw && appCache.raw.schedules) || [];
  const today = new Date();
  const todayKor = ['일', '월', '화', '수', '목', '금', '토'][today.getDay()];
  const todayStr = today.toISOString().substring(0, 10);
  const isManager = (appCache.user.role === '원장' || appCache.user.role === '데스크');

  // 📊 KPI 데이터 계산
  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
  const thisMonthAttendance = (appCache.raw.attendance || []).slice(1).filter(a =>
    a[3] && a[3] >= thisMonthStart && a[3] <= todayStr
  );

  // KPI 1: 오늘 수업 건수
  const todayClasses = schedules.filter(s => s[4] === todayKor && s[6] && s[7]).length;

  // KPI 2: 이번달 출석률
  const thisMonthPresent = thisMonthAttendance.filter(a => a[5] === '출석').length;
  const thisMonthTotal = thisMonthAttendance.filter(a => ['출석', '결석', '보강'].includes(a[5])).length;
  const attendanceRate = thisMonthTotal > 0 ? Math.round((thisMonthPresent / thisMonthTotal) * 100) : 0;

  // KPI 3: 신규 등록 (이번달)
  const students = (appCache.raw.students || []).slice(1);
  const newStudents = students.filter(s => s[7] === '재원' && s[8] && s[8] >= thisMonthStart).length;

  // KPI 4: 미완료 보강
  const makeups = (appCache.raw['보강일정DB'] || []).slice(1);
  const incompleteMakeups = makeups.filter(m => m[8] !== '완료').length;

  const bands = todayKor === '토' ?
    [{ start: 10 * 60, end: 12 * 60, label: '10:00~12:00' }, { start: 12 * 60, end: 14 * 60, label: '12:00~14:00' }, { start: 14 * 60, end: 16 * 60, label: '14:00~16:00' }] :
    [
      { start:  9 * 60, end: 11 * 60, label: '09:00~11:00' }, // 오전 특강
      { start: 11 * 60, end: 13 * 60, label: '11:00~13:00' }, // 오전 특강
      { start: 13 * 60, end: 15 * 60, label: '13:00~15:00' }, // 오후 특강
      { start: 15 * 60, end: 17 * 60, label: '15:00~17:00' },
      { start: 17 * 60, end: 19 * 60, label: '17:00~19:00' },
      { start: 19 * 60, end: 21 * 60, label: '19:00~21:00' },
    ];

  let classes = [];
  for (const r of schedules) {
    if (r[4] !== todayKor || (r[14] || '').trim() === '비활성') continue;

    const teacherRaw = r[9] || ''; const todayTeacher = teacherRaw.split('(')[0].trim();
    const branch = teacherRaw.includes('(') ? teacherRaw.match(/\(([^)]+)\)/)[1] : '';
    if (!todayTeacher) continue;
    const sStart = toMins(r[6]); if (sStart === null) continue;

    const rawDisplay = r[0] || ''; const namePart = rawDisplay.split('(')[0].trim();
    let sId = r[3] || ''; if (sId.includes(':') || sId.includes('~') || !sId) sId = namePart;

    const foundSt = window.findStudentInfo(sId, namePart);
    const homeroomTeacher = foundSt ? (foundSt[6] || '') : '';
    if (!isManager && todayTeacher !== appCache.user.name && homeroomTeacher !== appCache.user.name) continue;

    let gradeLevel = '초';
    if (rawDisplay.includes('보강')) {
      gradeLevel = '보강';
    } else if (foundSt && foundSt[2]) {
      const deptStr = foundSt[2].toString();
      gradeLevel = deptStr.includes('고') ? '고' : (deptStr.includes('중') ? '중' : '초');
    } else if (foundSt && foundSt[4]) {
      const gradeStr = foundSt[4].toString();
      gradeLevel = gradeStr.includes('고') ? '고' : (gradeStr.includes('중') ? '중' : '초');
    }

    for (const band of bands) {
      if (sStart >= band.start && sStart < band.end) {
        const eventId = `evt_${todayKor}_${band.label}_${todayTeacher}`.replace(/[:\s]/g, '_');
        let existingClass = classes.find(c => c.eventId === eventId);
        if (!existingClass) {
          existingClass = { eventId, timeLabel: band.label, startTime: band.start, teacher: todayTeacher, branch, room: r[11] || '', students: [], status: '대기중' };
          classes.push(existingClass);
        }
        if (!existingClass.students.find(s => s.name === namePart)) existingClass.students.push({ id: sId, name: namePart, level: gradeLevel });
      }
    }
  }

  allEvents = [];
  classes.forEach(c => {
    let evtObj = { id: c.eventId, date: todayStr, day: todayKor, timeStr: c.timeLabel, teacherId: c.teacher, room: c.room, students: [] };
    allEvents.push(evtObj);
    let completedCount = 0, draftCount = 0;

    c.students.forEach(s => {
      const todayRec = window.getLatestAttendance(s.id, s.name, todayStr, true);
      if (todayRec) { if (todayRec[18] === '최종') completedCount++; else draftCount++; }

      const recData = window.buildRecordFromRow(todayRec, true);
      evtObj.students.push({ id: s.id, name: s.name, badge: s.name, level: s.level, record: recData });
    });

    c.status = (completedCount === c.students.length) ? '최종완료' : ((completedCount + draftCount > 0) ? '작성중' : '대기중');
  });

  const sortByTimeAndTeacher = (a, b) => (a.startTime !== b.startTime) ? a.startTime - b.startTime : a.teacher.localeCompare(b.teacher);
  const pending = classes.filter(c => c.status === '대기중').sort(sortByTimeAndTeacher);
  const drafting = classes.filter(c => c.status === '작성중').sort(sortByTimeAndTeacher);
  const completed = classes.filter(c => c.status === '최종완료').sort(sortByTimeAndTeacher);

  // 💡 [복구 구간] 사라졌던 4개의 위젯 데이터 계산 로직 부활!
  const notices = (appCache.raw && appCache.raw.notices) || [];
  const activeNotices = notices.slice(1).filter(n => n[3] !== '삭제');
  const uncompletedNotices = activeNotices.filter(n => n[3] !== '완료').length;

  const todos = appCache.user.todos || [];
  const remainTodos = todos.filter(t => !t.done).length;

  const allMakeups = appCache.raw['보강일정DB'] || appCache.raw.makeups || [];
  const myMakeups = allMakeups.filter(r => (r[6] || '').includes(appCache.user.name));
  const allStudents = appCache.raw.students || [];
  const myStudents = allStudents.filter(s => (s[6] || '').includes(appCache.user.name) && s[7] !== '퇴원');

  const renderClassRow = (c, colorClass, btnClass) => `
    <div class="list-group-item d-flex justify-content-between align-items-center p-3 border-bottom shadow-sm mb-3 bg-white" style="cursor:pointer; border-radius: 12px; border-left: 5px solid ${colorClass} !important;" onclick="openGroupAttModal('${c.eventId}')">
      <div class="d-flex flex-column gap-1">
        <div class="d-flex align-items-center gap-2">
          <span class="text-dark fw-bold" style="font-size: 0.95rem;"><i class="bi bi-clock text-muted"></i> ${c.timeLabel}</span>
          <span class="badge bg-light text-dark border shadow-sm">${c.room || '미정'}</span>
          ${isManager ? `<span class="badge bg-dark shadow-sm">${c.teacher}</span>` : `<span class="badge bg-secondary bg-opacity-25 text-dark border">${c.branch || '본관'}</span>`}
        </div>
        <div class="d-flex flex-wrap gap-1 mt-2">
          ${c.students.map(s => `<span class="badge ${s.level === '보강' ? 'bg-warning text-dark' : (s.level === '고' ? 'bg-danger' : (s.level === '중' ? 'bg-primary' : 'bg-success'))} fw-normal shadow-sm">${s.level}</span><span class="fw-bold text-dark" style="font-size:0.9rem; margin-right:8px;">${s.name}</span>`).join('')}
        </div>
      </div>
      <button class="btn ${btnClass} btn-sm fw-bold rounded-pill px-4 py-2 shadow">출결 ✏️</button>
    </div>`;

  let html = `<div class="sticky-top pt-3 pb-2" style="background: rgba(248, 249, 250, 0.85); backdrop-filter: blur(12px); z-index: 1020; margin-top: -1rem;">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h4 class="fw-bold m-0 text-dark"><span class="text-primary me-1">[${appCache.user.branch || '본관'}]</span> ${appCache.user.name}${isManager ? ' 원장님' : ' 선생님'} 👋</h4>
        <div class="badge bg-white text-dark border shadow-sm px-3 py-2 fs-6"><i class="bi bi-calendar-check me-2 text-primary"></i>${todayStr}</div>
      </div>

      <div class="row g-2 mb-2">
        <div class="col-4">
          <div class="card border-0 shadow-sm h-100" style="border-radius: 12px; cursor:pointer; background: linear-gradient(135deg, #ffffff, #fff5f5); border-bottom: 4px solid #ef4444 !important;" data-bs-toggle="collapse" data-bs-target="#collapsePending">
            <div class="card-body p-2 d-flex flex-column justify-content-center align-items-center">
              <p class="text-muted small fw-bold mb-1">출석 대기</p>
              <h4 class="fw-bold m-0 text-danger">${pending.length}</h4>
            </div>
          </div>
        </div>
        <div class="col-4">
          <div class="card border-0 shadow-sm h-100" style="border-radius: 12px; cursor:pointer; background: linear-gradient(135deg, #ffffff, #fffbeb); border-bottom: 4px solid #f59e0b !important;" data-bs-toggle="collapse" data-bs-target="#collapseDrafting">
            <div class="card-body p-2 d-flex flex-column justify-content-center align-items-center">
              <p class="text-muted small fw-bold mb-1">작성중</p>
              <h4 class="fw-bold m-0" style="color: #d97706;">${drafting.length}</h4>
            </div>
          </div>
        </div>
        <div class="col-4">
          <div class="card border-0 shadow-sm h-100" style="border-radius: 12px; cursor:pointer; background: linear-gradient(135deg, #ffffff, #f0fdf4); border-bottom: 4px solid #10b981 !important;" data-bs-toggle="collapse" data-bs-target="#collapseCompleted">
            <div class="card-body p-2 d-flex flex-column justify-content-center align-items-center">
              <p class="text-muted small fw-bold mb-1">최종 완료</p>
              <h4 class="fw-bold m-0 text-success">${completed.length}</h4>
            </div>
          </div>
        </div>
      </div>
      
      <div class="row g-2 mb-2 d-none d-md-flex">
        <div class="col-3">
          <div class="card border-0 shadow-sm h-100" style="border-radius: 12px; cursor:pointer; background: linear-gradient(135deg, #ffffff, #ecfeff); border-bottom: 4px solid #06b6d4 !important;" data-bs-toggle="collapse" data-bs-target="#collapseNoticePanel">
            <div class="card-body p-2 d-flex flex-column justify-content-center align-items-center">
              <p class="text-muted small fw-bold mb-1">미확인 공지</p>
              <h4 class="fw-bold m-0 text-info">${uncompletedNotices}</h4>
            </div>
          </div>
        </div>
        <div class="col-3">
          <div class="card border-0 shadow-sm h-100" style="border-radius: 12px; cursor:pointer; background: linear-gradient(135deg, #ffffff, #eff6ff); border-bottom: 4px solid #3b82f6 !important;" data-bs-toggle="collapse" data-bs-target="#collapseTodoPanel">
            <div class="card-body p-2 d-flex flex-column justify-content-center align-items-center">
              <p class="text-muted small fw-bold mb-1">오늘 할일</p>
              <h4 class="fw-bold m-0 text-primary">${remainTodos}</h4>
            </div>
          </div>
        </div>
        <div class="col-3">
          <div class="card border-0 shadow-sm h-100" style="border-radius: 12px; cursor:pointer; background: linear-gradient(135deg, #ffffff, #fefce8); border-bottom: 4px solid #eab308 !important;" data-bs-toggle="collapse" data-bs-target="#sec-makeups">
            <div class="card-body p-2 d-flex flex-column justify-content-center align-items-center">
              <p class="text-muted small fw-bold mb-1">나의 보강</p>
              <h4 class="fw-bold m-0 text-warning" style="color: #ca8a04 !important;">${myMakeups.length}</h4>
            </div>
          </div>
        </div>
        <div class="col-3">
          <div class="card border-0 shadow-sm h-100" style="border-radius: 12px; cursor:pointer; background: linear-gradient(135deg, #ffffff, #f0fdfa); border-bottom: 4px solid #84cc16 !important;" data-bs-toggle="collapse" data-bs-target="#sec-students">
            <div class="card-body p-2 d-flex flex-column justify-content-center align-items-center">
              <p class="text-muted small fw-bold mb-1">나의 전담</p>
              <h4 class="fw-bold m-0 text-success" style="color: #65a30d !important;">${myStudents.length}</h4>
            </div>
          </div>
        </div>
      </div>

      <!-- 📊 Phase 4 KPI 히어로 섹션 -->
      <div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-radius: 16px; padding: 2rem; margin-top: 1rem; margin-bottom: 2rem; box-shadow: 0 10px 40px rgba(0,0,0,0.15);">
        <div class="mb-3">
          <h5 class="text-white fw-bold m-0"><i class="bi bi-star-fill text-warning me-2"></i>오늘의 핵심 지표</h5>
        </div>

        <div class="row g-3">
          <!-- KPI 1 -->
          <div class="col-md-6 col-lg-3">
            <div class="card border-0 h-100" style="border-radius: 12px; background: linear-gradient(135deg, #ffffff, #e0f2fe); box-shadow: 0 4px 20px rgba(2, 132, 199, 0.15);">
              <div class="card-body p-4">
                <div class="d-flex justify-content-between align-items-start">
                  <div>
                    <p class="text-muted small fw-bold mb-2">📊 오늘 수업</p>
                    <h2 class="fw-bold m-0 text-info" style="font-size: 2.5rem;">${todayClasses}</h2>
                    <small class="text-muted">건수</small>
                  </div>
                  <i class="bi bi-calendar-event text-info" style="font-size: 2.5rem; opacity: 0.2;"></i>
                </div>
              </div>
            </div>
          </div>

          <!-- KPI 2 -->
          <div class="col-md-6 col-lg-3">
            <div class="card border-0 h-100" style="border-radius: 12px; background: linear-gradient(135deg, #ffffff, #dcfce7); box-shadow: 0 4px 20px rgba(22, 163, 74, 0.15);">
              <div class="card-body p-4">
                <div class="d-flex justify-content-between align-items-start">
                  <div>
                    <p class="text-muted small fw-bold mb-2">📈 이번달 출석률</p>
                    <h2 class="fw-bold m-0" style="color: #16a34a; font-size: 2.5rem;">${attendanceRate}<span style="font-size: 1.2rem;">%</span></h2>
                    <small class="text-muted">${thisMonthPresent}/${thisMonthTotal}명</small>
                  </div>
                  <i class="bi bi-graph-up text-success" style="font-size: 2.5rem; opacity: 0.2;"></i>
                </div>
              </div>
            </div>
          </div>

          <!-- KPI 3 -->
          <div class="col-md-6 col-lg-3">
            <div class="card border-0 h-100" style="border-radius: 12px; background: linear-gradient(135deg, #ffffff, #fef3c7); box-shadow: 0 4px 20px rgba(217, 119, 6, 0.15);">
              <div class="card-body p-4">
                <div class="d-flex justify-content-between align-items-start">
                  <div>
                    <p class="text-muted small fw-bold mb-2">✨ 신규 등록</p>
                    <h2 class="fw-bold m-0" style="color: #d97706; font-size: 2.5rem;">${newStudents}</h2>
                    <small class="text-muted">명 (이번달)</small>
                  </div>
                  <i class="bi bi-person-plus text-warning" style="font-size: 2.5rem; opacity: 0.2;"></i>
                </div>
              </div>
            </div>
          </div>

          <!-- KPI 4 -->
          <div class="col-md-6 col-lg-3">
            <div class="card border-0 h-100" style="border-radius: 12px; background: linear-gradient(135deg, #ffffff, #fee2e2); box-shadow: 0 4px 20px rgba(220, 38, 38, 0.15);">
              <div class="card-body p-4">
                <div class="d-flex justify-content-between align-items-start">
                  <div>
                    <p class="text-muted small fw-bold mb-2">⏳ 미완료 보강</p>
                    <h2 class="fw-bold m-0 text-danger" style="font-size: 2.5rem;">${incompleteMakeups}</h2>
                    <small class="text-muted">건 (진행중)</small>
                  </div>
                  <i class="bi bi-hourglass-split text-danger" style="font-size: 2.5rem; opacity: 0.2;"></i>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 🎯 오늘의 핵심 업무 섹션 -->
    <div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-radius: 16px; padding: 2rem; margin-bottom: 2rem; box-shadow: 0 10px 40px rgba(0,0,0,0.15);">
      <h5 class="text-white fw-bold m-0 mb-3"><i class="bi bi-lightning-fill text-warning me-2"></i>오늘의 핵심 업무</h5>

      <div class="row g-2">
        ${pending.length > 0 ? `
        <div class="col-md-4">
          <div class="card border-0 h-100" style="border-radius: 12px; background: linear-gradient(135deg, #fff5f5, #fee2e2); border-left: 5px solid #dc2626;">
            <div class="card-body p-3">
              <div class="d-flex align-items-center gap-2 mb-2">
                <span class="badge bg-danger rounded-pill fw-bold" style="font-size: 1rem;">🔴</span>
                <strong>출석 체크 대기</strong>
              </div>
              <h3 class="fw-bold m-0 text-danger">${pending.length}</h3>
              <small class="text-muted">건 | 우선순위 최고</small>
            </div>
          </div>
        </div>
        ` : ''}

        ${drafting.length > 0 ? `
        <div class="col-md-4">
          <div class="card border-0 h-100" style="border-radius: 12px; background: linear-gradient(135deg, #fffbeb, #fef3c7); border-left: 5px solid #f59e0b;">
            <div class="card-body p-3">
              <div class="d-flex align-items-center gap-2 mb-2">
                <span class="badge bg-warning text-dark rounded-pill fw-bold" style="font-size: 1rem;">🟡</span>
                <strong>일지 작성중</strong>
              </div>
              <h3 class="fw-bold m-0" style="color: #d97706;">${drafting.length}</h3>
              <small class="text-muted">건 | 작성 중</small>
            </div>
          </div>
        </div>
        ` : ''}

        ${incompleteMakeups > 0 ? `
        <div class="col-md-4">
          <div class="card border-0 h-100" style="border-radius: 12px; background: linear-gradient(135deg, #ecfdf5, #dcfce7); border-left: 5px solid #10b981;">
            <div class="card-body p-3">
              <div class="d-flex align-items-center gap-2 mb-2">
                <span class="badge bg-success rounded-pill fw-bold" style="font-size: 1rem;">🟢</span>
                <strong>미완료 보강</strong>
              </div>
              <h3 class="fw-bold m-0 text-success">${incompleteMakeups}</h3>
              <small class="text-muted">건 | 완료 예정</small>
            </div>
          </div>
        </div>
        ` : ''}
      </div>
    </div>

    <div class="row g-4 mt-2">
      <div class="col-lg-6">
        <div class="collapse show" id="collapsePending">
          <div class="d-flex align-items-center justify-content-between mb-2 px-2" data-bs-toggle="collapse" data-bs-target="#collapsePending" style="cursor:pointer;">
            <h6 class="fw-bold text-danger m-0"><i class="bi bi-exclamation-triangle-fill me-2"></i>출석 체크 대기중</h6>
            <span class="badge bg-danger rounded-pill">${pending.length}건</span>
          </div>
          <div class="mb-4 rounded">
            ${pending.length > 0 ? pending.map(c => renderClassRow(c, '#ef4444', 'btn-danger')).join('') : '<div class="card border-0 shadow-sm bg-white p-4 text-center text-muted" style="border-radius: 16px;">대기중인 수업이 없습니다.</div>'}
          </div>
        </div>

        <div class="collapse show" id="collapseDrafting">
          <div class="d-flex align-items-center justify-content-between mb-2 px-2" data-bs-toggle="collapse" data-bs-target="#collapseDrafting" style="cursor:pointer;">
            <h6 class="fw-bold m-0" style="color: #d97706;"><i class="bi bi-pencil-square me-2"></i>일지 작성중</h6>
            <span class="badge rounded-pill" style="background: #f59e0b;">${drafting.length}건</span>
          </div>
          <div class="mb-4 rounded">
            ${drafting.length > 0 ? drafting.map(c => renderClassRow(c, '#f59e0b', 'btn-warning text-dark')).join('') : '<div class="card border-0 shadow-sm bg-white p-4 text-center text-muted" style="border-radius: 16px;">작성중인 일지가 없습니다.</div>'}
          </div>
        </div>

        <div class="collapse show" id="collapseCompleted">
          <div class="d-flex align-items-center justify-content-between mb-2 px-2" data-bs-toggle="collapse" data-bs-target="#collapseCompleted" style="cursor:pointer;">
            <h6 class="fw-bold text-success m-0"><i class="bi bi-check-circle-fill me-2"></i>최종 완료</h6>
            <span class="badge bg-success rounded-pill">${completed.length}건</span>
          </div>
          <div class="mb-4 rounded">
            ${completed.length > 0 ? completed.map(c => renderClassRow(c, '#10b981', 'btn-success')).join('') : '<div class="card border-0 shadow-sm bg-white p-4 text-center text-muted" style="border-radius: 16px;">완료된 수업이 없습니다.</div>'}
          </div>
        </div>
      </div>

      <div class="col-lg-6">
        <div class="collapse show" id="collapseNoticePanel">
          <div class="mb-4 rounded bg-white" style="border-radius: 16px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);" id="notice-board-wrapper">
              ${window.renderNoticeBoard ? window.renderNoticeBoard() : ''}
          </div>
        </div>
        <div class="collapse show" id="collapseTodoPanel">
          <div class="mb-4 rounded bg-white" style="border-radius: 16px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);" id="dashboard-todo-wrapper">
              ${window.renderTodoList ? window.renderTodoList() : ''}
          </div>
        </div>
        <div id="dashboard-bottom-widgets"></div>
      </div>
    </div>
  `;

  document.getElementById('view-container').innerHTML = html;
  if (window.refreshDashboardTodos) window.refreshDashboardTodos();
  if (typeof loadTeacherDashboardWidgets === 'function') loadTeacherDashboardWidgets();
};

// =================================================================
// 🚀 [업그레이드] 메인 대시보드 투두리스트 (클라우드 동기화 5G)
// =================================================================
window.renderTodoList = function () {
  let todos = appCache.user.todos || [];

  let html = `
    <div class="card p-4 shadow-sm border-0 mb-4 border-top border-info border-4 h-100" id="todo-card">
        <div class="d-flex justify-content-between align-items-center mb-3">
            <h5 class="fw-bold text-info m-0"><i class="bi bi-check2-square"></i> 오늘 할 일 (To-Do)</h5>
            <span class="badge bg-info text-dark shadow-sm" id="todoCount">${todos.filter(t => !t.done).length}건 남음</span>
        </div>
        <div class="input-group mb-3 shadow-sm">
            <input type="text" class="form-control bg-light border-0" id="newTodoInput" placeholder="새로운 할 일 입력..." onkeyup="if(event.keyCode===13) addTodo()">
            <button class="btn btn-info text-white fw-bold px-3" onclick="addTodo()" id="btn-add-todo">추가</button>
        </div>
        <ul class="list-group list-group-flush" id="todoListContainer" style="max-height: 250px; overflow-y: auto;">
    `;

  if (todos.length === 0) {
    html += `<li class="list-group-item text-center text-muted small py-4 border-0 bg-transparent">모든 업무 완료! 고생하셨습니다 🎉</li>`;
  } else {
    todos.forEach(t => {
      let textStyle = t.done ? 'text-decoration-line-through text-muted' : 'fw-bold text-dark';
      let checkIcon = t.done ? 'bi-check-circle-fill text-success' : 'bi-circle text-muted';
      html += `
            <li class="list-group-item d-flex justify-content-between align-items-center px-2 py-2 border-bottom border-light bg-transparent">
                <div class="d-flex align-items-center gap-2" style="cursor:pointer; flex-grow: 1;" onclick="toggleTodo(${t.id})">
                    <i class="bi ${checkIcon} fs-5"></i>
                    <span class="${textStyle}" style="font-size: 0.95rem;">${t.text}</span>
                </div>
                <button class="btn btn-sm text-danger p-0 ms-2" onclick="deleteTodo(${t.id})" title="삭제"><i class="bi bi-trash-fill opacity-50 hover-opacity-100"></i></button>
            </li>`;
    });
  }
  html += `</ul></div>`;
  return html;
};

window.addTodo = async function () {
  let input = document.getElementById('newTodoInput');
  if (!input) return;
  let text = input.value.trim();
  if (!text) return;

  let btn = document.getElementById('btn-add-todo');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
  }

  if (!appCache.user.todos) appCache.user.todos = [];
  appCache.user.todos.push({ id: Date.now(), text: text, done: false });

  refreshDashboardTodos(); // 화면에 즉시 반영 (빠릿하게!)
  await window.saveTodosToSheet(); // 뒤에서 구글 시트에 몰래 저장

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '추가';
  }
};

window.toggleTodo = async function (id) {
  if (!appCache.user.todos) return;
  let todo = appCache.user.todos.find(t => t.id === id);
  if (todo) {
    todo.done = !todo.done;
    refreshDashboardTodos();
    await window.saveTodosToSheet();
  }
};

window.deleteTodo = async function (id) {
  if (!appCache.user.todos) return;
  if (window.event) window.event.stopPropagation(); // 클릭 겹침 방지

  appCache.user.todos = appCache.user.todos.filter(t => t.id !== id);
  refreshDashboardTodos();
  await window.saveTodosToSheet();
};

window.refreshDashboardTodos = function () {
  let container = document.getElementById('dashboard-todo-wrapper');
  if (container) container.innerHTML = window.renderTodoList();

  // 대시보드 상단 요약 카드 숫자도 같이 업데이트
  const remainCount = (appCache.user.todos || []).filter(t => !t.done).length;
  const summaryTodoEl = document.querySelector('#collapseTodo .text-primary.fw-bold');
  if (summaryTodoEl) {
    summaryTodoEl.innerHTML = `${remainCount}<span class="fs-6 ms-1 text-muted fw-normal">건</span>`;
  }
};

// 💡 [핵심] 시트에 내 투두리스트 동기화 저장 함수
window.saveTodosToSheet = async function () {
  try {
    const teachers = appCache.raw.teachers || [];
    const myEmail = (appCache.user.email || '').trim().toLowerCase();
    const rowIndex = teachers.findIndex(t => t[7] && t[7].trim().toLowerCase() === myEmail);

    if (rowIndex >= 0) {
      const rowNum = rowIndex + 2; // 배열 0-index 보정(+1) + 헤더행 보정(+1)
      const jsonStr = JSON.stringify(appCache.user.todos || []);
      const sheetName = (typeof CONFIG !== 'undefined' && CONFIG.SHEETS && CONFIG.SHEETS.TEACHER) ? CONFIG.SHEETS.TEACHER : '강사DB';

      // 강사DB의 K열(11번째)에 저장
      await callSheetsAPI('PUT', `/values/${encodeURIComponent(sheetName + '!K' + rowNum)}?valueInputOption=USER_ENTERED`, { values: [[jsonStr]] });

      // 캐시 원본(appCache.raw.teachers)에도 동기화
      teachers[rowIndex][10] = jsonStr;
    }
  } catch (e) {
    console.error("투두리스트 저장 실패:", e);
  }
};

// =========================================
// 🚀 [UI 전면 개편] 주간 시간표 (코어 엔진 탑재 - 초고속 렌더링)
// =========================================
window.loadScheduleView = function (baseDateStr = null, searchKeyword = '') {
  if (!appCache.raw || !appCache.raw.schedules) {
    document.getElementById('view-container').innerHTML = '<p>데이터를 불러올 수 없습니다.</p>';
    return;
  }

  const schedules = window.getActiveSchedules();
  allEvents = []; // 초기화
  const daysOrder = ['월', '화', '수', '목', '금', '토', '일'];
  const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'];

  const baseDate = baseDateStr ? new Date(baseDateStr) : new Date();
  const todayDay = baseDate.getDay();
  const monday = new Date(baseDate);
  monday.setDate(baseDate.getDate() + (todayDay === 0 ? -6 : 1 - todayDay));

  const dayKorToIdx = { '월': 0, '화': 1, '수': 2, '목': 3, '금': 4, '토': 5, '일': 6 };
  const getDateForDay = kor => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + (dayKorToIdx[kor] ?? 0));
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const weekLabel = `${monday.getFullYear()}.${String(monday.getMonth() + 1).padStart(2, '0')}.${String(monday.getDate()).padStart(2, '0')} ~ ${sunday.getFullYear()}.${String(sunday.getMonth() + 1).padStart(2, '0')}.${String(sunday.getDate()).padStart(2, '0')}`;

  const prevWeek = new Date(baseDate); prevWeek.setDate(baseDate.getDate() - 7);
  const nextWeek = new Date(baseDate); nextWeek.setDate(baseDate.getDate() + 7);
  const prevWeekStr = prevWeek.toISOString().substring(0, 10);
  const nextWeekStr = nextWeek.toISOString().substring(0, 10);
  const thisWeekStr = new Date().toISOString().substring(0, 10);
  const realTodayStr = new Date().toISOString().substring(0, 10);

  let teacherSet = new Set();
  for (const r of schedules) {
    const t = (r[9] || '').split('(')[0].trim();
    if (t) teacherSet.add(t);
  }

  const makeupsSched = appCache.raw['보강일정DB'] || appCache.raw.makeups || [];
  for (const r of makeupsSched) {
    const t = (r[6] || '').split('(')[0].trim();
    if (t) teacherSet.add(t);
  }

  let teachers = Array.from(teacherSet).sort();
  let colorMap = {};
  teachers.forEach((t, i) => colorMap[t] = colors[i % colors.length]);
  if (appCache.user.role === '강사') {
    teachers = teachers.filter(t => t === appCache.user.name);
  }

  const WEEKDAY_BANDS = [
    { start:  9 * 60, end: 11 * 60, label: '09:00~11:00' }, // 오전 특강
    { start: 11 * 60, end: 13 * 60, label: '11:00~13:00' }, // 오전 특강
    { start: 13 * 60, end: 15 * 60, label: '13:00~15:00' }, // 오후 특강
    { start: 15 * 60, end: 17 * 60, label: '15:00~17:00' },
    { start: 17 * 60, end: 19 * 60, label: '17:00~19:00' },
    { start: 19 * 60, end: 21 * 60, label: '19:00~21:00' },
  ];
  const SAT_BANDS = [
    { start: 10 * 60, end: 12 * 60, label: '10:00~12:00' },
    { start: 12 * 60, end: 14 * 60, label: '12:00~14:00' },
    { start: 14 * 60, end: 16 * 60, label: '14:00~16:00' },
  ];
  function getBandsForDay(day) {
    return day === '토' ? SAT_BANDS : WEEKDAY_BANDS;
  }

  const grouped = {};
  const bandsByDay = {};

  // (1) 정규 시간표 파싱
  for (const r of schedules) {
    const day = r[4];
    if (!day) continue;
    if ((r[14] || '').trim() === '비활성') continue;

    const sIdRaw = r[3] || '';
    const sNameRaw = (r[0] || '').split('(')[0].trim();

    // 💡 [최적화] 코어 엔진 사용: O(1) 초고속 탐색
    const foundSt = window.findStudentInfo(sIdRaw, sNameRaw);
    if (foundSt && foundSt[7] === '퇴원') continue;

    const teacherRaw = r[9] || '';
    const teacher = teacherRaw.split('(')[0].trim();
    const branch = teacherRaw.includes('(') ? teacherRaw.match(/\(([^)]+)\)/)[1] : '';
    if (!teacher) continue;
    if (appCache.user.role === '강사' && teacher !== appCache.user.name) continue;

    const sStart = toMins(r[6]);
    const sEnd = toMins(r[7]);
    if (sStart === null) continue;

    const room = r[11] || '';
    const rawDisplay = r[0] || '';
    const namePart = rawDisplay.split('(')[0].trim();
    const infoMatch = rawDisplay.match(/\(([^)]+)\)/);
    const infoStr = infoMatch ? infoMatch[1] : '';
    const gradeNum = (infoStr.match(/(\d+)학년/) || ['', ''])[1];
    const displayLabel = gradeNum ? `${namePart}${gradeNum}` : namePart;
    const isMakeup = rawDisplay.includes('보강') || (r[13] || '').includes('보강');
    const actualTime = `${r[6] || ''}~${r[7] || ''}`;

    let sId = r[3] || '';
    let sName;

    if (isMakeup && (namePart.includes('이름 미확인') || !namePart)) {
      sName = r[3] || namePart;
      const foundSt2 = window.findStudentInfo(sId, sName);
      sId = foundSt2 ? foundSt2[0] : '';
    } else {
      sName = namePart;
      if (sId.includes(':') || sId.includes('~') || !sId) sId = sName;
    }

    if (searchKeyword && !sName.includes(searchKeyword)) continue;

    for (const band of getBandsForDay(day)) {
      if (sStart >= band.start && sStart < band.end) {
        const showTime = (sStart !== band.start) || (sEnd !== null && sEnd !== band.end);

        if (!grouped[day]) grouped[day] = {};
        if (!grouped[day][band.label]) grouped[day][band.label] = {};
        if (!grouped[day][band.label][teacher]) grouped[day][band.label][teacher] = [];

        const eventId = `evt_${day}_${band.label}_${teacher}`.replace(/[:\s]/g, '_');

        // 💡 [최적화] 코어 엔진 사용: 출결 데이터 복사 방지 & Record 조립 헬퍼 사용
        const lastRecord = window.getLatestAttendance(sId, sName);
        const eventDateStr = getDateForDay(day);
        const isTodayDraft = lastRecord && (lastRecord[3] || '').substring(0, 10) === eventDateStr;
        const record = window.buildRecordFromRow(lastRecord, isTodayDraft);

        let gradeLevel = '초';
        if (isMakeup) {
          gradeLevel = '보강';
        } else if (foundSt && foundSt[2]) {
          const deptStr = foundSt[2].toString();
          gradeLevel = deptStr.includes('고') ? '고' : (deptStr.includes('중') ? '중' : '초');
        } else if (foundSt && foundSt[4]) {
          const gradeStr = foundSt[4].toString();
          gradeLevel = gradeStr.includes('고') ? '고' : (gradeStr.includes('중') ? '중' : '초');
        } else if (infoStr) {
          gradeLevel = infoStr.includes('초등학교') || infoStr.includes('초') ? '초' : (infoStr.includes('중학교') || infoStr.includes('중') ? '중' : '고');
        }

        const studentDataForEvent = { id: sId, name: sName, badge: displayLabel, level: gradeLevel, record: record, lastUsed: { pBook: record.pBook, hwBook: record.hwBook } };

        let eventObj = allEvents.find(e => e.id === eventId);
        if (!eventObj) {
          eventObj = { id: eventId, date: getDateForDay(day), day: day, timeStr: band.label, teacherId: teacher, room: room, students: [] };
          allEvents.push(eventObj);
        }
        if (!eventObj.students.find(s => s.name === sName)) {
          eventObj.students.push(studentDataForEvent);
        }

        grouped[day][band.label][teacher].push({
          name: displayLabel, id: sId, eventId: eventId, room, isMakeup, showTime, actualTime, branch: branch
        });
      }
    }
  }

  // (2) 보강일정DB 파싱
  for (const r of makeupsSched) {
    const sIdMk = r[0] || '';
    const sNameMk = r[1] || '';

    // 💡 [최적화] 코어 엔진 사용
    const foundStMk = window.findStudentInfo(sIdMk, sNameMk);
    if (foundStMk && foundStMk[7] === '퇴원') continue;

    const mkDate = (r[3] || '').substring(0, 10);
    let targetDay = null;
    for (const kor of ['월', '화', '수', '목', '금', '토', '일']) {
      if (getDateForDay(kor) === mkDate) { targetDay = kor; break; }
    }
    if (!targetDay) continue;

    const teacherRaw = r[6] || '';
    const teacher = teacherRaw.split('(')[0].trim();
    const branch = teacherRaw.includes('(') ? teacherRaw.match(/\(([^)]+)\)/)[1] : '';
    if (!teacher) continue;
    if (appCache.user.role === '강사' && teacher !== appCache.user.name) continue;

    if (searchKeyword && !sNameMk.includes(searchKeyword)) continue;

    const room = r[7] || '';
    const sStart = toMins(r[4]);
    const sEnd = toMins(r[5]);
    if (sStart === null) continue;

    for (const band of getBandsForDay(targetDay)) {
      if (sStart >= band.start && sStart < band.end) {
        const eventId = ('evt_mk_' + targetDay + '_' + band.label + '_' + teacher).replace(/[:\s]/g, '_');
        const showTime = (sStart !== band.start) || (sEnd !== null && sEnd !== band.end);
        const actualTime = (r[4] || '') + '~' + (r[5] || '');

        if (!grouped[targetDay]) grouped[targetDay] = {};
        if (!grouped[targetDay][band.label]) grouped[targetDay][band.label] = {};
        if (!grouped[targetDay][band.label][teacher]) grouped[targetDay][band.label][teacher] = [];
        if (!bandsByDay[targetDay]) bandsByDay[targetDay] = new Set();
        bandsByDay[targetDay].add(band.label);

        // 💡 [최적화] 코어 엔진 사용
        const lastRec = window.getLatestAttendance(sIdMk, sNameMk);
        const isTodayDraft = lastRec && (lastRec[3] || '').substring(0, 10) === realTodayStr;
        const record = window.buildRecordFromRow(lastRec, isTodayDraft);

        const studentData = { id: sIdMk, name: sNameMk, badge: sNameMk, level: '보강', record, lastUsed: { pBook: record.pBook, hwBook: record.hwBook } };

        let eventObj = allEvents.find(e => e.id === eventId);
        if (!eventObj) {
          eventObj = { id: eventId, date: mkDate, day: targetDay, timeStr: band.label, teacherId: teacher, room, students: [] };
          allEvents.push(eventObj);
        }
        if (!eventObj.students.find(s => s.name === sNameMk)) eventObj.students.push(studentData);
        grouped[targetDay][band.label][teacher].push({ name: sNameMk, id: sIdMk, eventId, room, isMakeup: true, showTime, actualTime, branch });
      }
    }
  }

  const getSmallDate = kor => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + (dayKorToIdx[kor] ?? 0));
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  let html = `
    <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-3">
      <div class="d-flex align-items-center gap-2">
        <h4 class="fw-bold m-0"><i class="bi bi-calendar-week me-2 text-primary"></i>주간 시간표</h4>
      </div>
      <div class="d-flex align-items-center gap-2 flex-wrap justify-content-end">
        <div class="input-group input-group-sm shadow-sm" style="width: 170px;">
          <input type="text" class="form-control border-primary" id="schedSearchInput" placeholder="학생명 검색..." value="${searchKeyword}" onkeyup="if(event.keyCode===13) loadScheduleView('${baseDateStr || ''}', this.value)">
          <button class="btn btn-primary" onclick="loadScheduleView('${baseDateStr || ''}', document.getElementById('schedSearchInput').value)"><i class="bi bi-search"></i></button>
        </div>
        <div class="btn-group shadow-sm">
          <button class="btn btn-sm btn-outline-secondary fw-bold" onclick="loadScheduleView('${prevWeekStr}', document.getElementById('schedSearchInput').value)"><i class="bi bi-chevron-left"></i> 지난주</button>
          <button class="btn btn-sm ${baseDateStr && baseDateStr !== thisWeekStr ? 'btn-outline-secondary' : 'btn-secondary'} fw-bold" onclick="loadScheduleView('${thisWeekStr}', document.getElementById('schedSearchInput').value)">이번주</button>
          <button class="btn btn-sm btn-outline-secondary fw-bold" onclick="loadScheduleView('${nextWeekStr}', document.getElementById('schedSearchInput').value)">다음주 <i class="bi bi-chevron-right"></i></button>
        </div>
        <button class="btn btn-outline-primary btn-sm fw-bold rounded-pill px-3 shadow-sm d-none d-md-inline-block" onclick="loadScheduleView('${baseDateStr || ''}', document.getElementById('schedSearchInput').value)">
          <i class="bi bi-arrow-clockwise"></i> 새로고침
        </button>
      </div>
    </div>
    <div class="text-center mb-3 fw-bold text-dark bg-white py-2 rounded-pill shadow-sm border border-light" style="max-width:320px; margin: 0 auto; font-size:0.9rem;">
      📅 ${weekLabel}
    </div>
  <div class="table-responsive border shadow-sm bg-white" style="height: calc(100vh - 170px); overflow: auto;">
    <table class="table table-bordered mb-0 align-middle" style="min-width: ${150 + teachers.length * 130}px; width: 100%; table-layout: fixed;">
      <thead class="sticky-top" style="z-index: 10;">
        <tr style="background:#f0f4f8; border-bottom:2px solid #cbd5e1; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
          <th class="text-center text-muted fw-bold" style="width:65px; min-width:65px; font-size:0.75rem;">날짜<br>요일</th>
          <th class="text-center text-muted fw-bold" style="width:85px; min-width:85px; font-size:0.75rem;">시간대</th>`;

  teachers.forEach(t => {
    html += `<th class="text-center fw-bold text-truncate" style="width:auto; min-width:130px; font-size:0.8rem; padding:8px 4px;">
      <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${colorMap[t]};margin-right:4px;"></span>${t}
    </th>`;
  });
  html += `</tr></thead><tbody>`;

  daysOrder.forEach(day => {
    const dateStr = getDateForDay(day);
    const isToday = dateStr === realTodayStr;
    const dayBands = getBandsForDay(day);
    const rowCount = dayBands.length;

    dayBands.forEach((band, bIdx) => {
      const isLastInDay = (bIdx === dayBands.length - 1);
      const rowStyle = isLastInDay ? 'border-bottom:2px solid #94a3b8;' : 'border-bottom:1px dashed #cbd5e1;';

      html += `<tr style="${rowStyle}">`;

      if (bIdx === 0) {
        const dayCellStyle = [
          `font-size:0.92rem; vertical-align:middle; text-align:center; font-weight:700;`,
          `background:${isToday ? '#dbeafe' : '#f8fafc'};`,
          `border-right:2px solid #94a3b8;`,
          isToday ? 'color:#1d4ed8;' : 'color:#475569;'
        ].join('');
        html += `<td rowspan="${rowCount}" style="${dayCellStyle}">
          ${isToday ? '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#2563eb;margin-right:2px;vertical-align:middle;"></span>' : ''}
          ${day}<br><small style="font-weight:400;font-size:0.7rem;color:#94a3b8;">(${getSmallDate(day)})</small>
        </td>`;
      }

      const [bStartStr, bEndStr] = band.label.split('~');
      html += `<td class="text-center" style="
        font-size:0.75rem; font-weight:700; color:#334155;
        background:#f8fafc; vertical-align:middle;
        border-right:2px solid #e2e8f0; line-height:1.6;
        padding:6px 4px;
      ">${bStartStr}<br><span style="color:#94a3b8;font-size:0.68rem;">~</span><br>${bEndStr}</td>`;

      teachers.forEach(teacher => {
        const students = (grouped[day]?.[band.label]?.[teacher]) || [];
        html += `<td style="vertical-align:top; padding:4px; background:#fff;">`;

        if (students.length > 0) {
          const room = students[0].room;
          const isTodayCourse = (dateStr === realTodayStr);
          let isSubmitted = false;

          if (isTodayCourse && appCache.raw && appCache.raw.attendance) {
            const firstStdId = students[0].id;
            isSubmitted = appCache.raw.attendance.some(aRow => {
              return aRow[1] === firstStdId && aRow[3] === realTodayStr && aRow[18] === '최종';
            });
          }

          const notSubBadgeHTML = (isTodayCourse && !isSubmitted)
            ? `<span class="badge bg-danger shadow text-white" style="position:absolute;top:5px;left:5px;font-size:0.6rem;animation: pulse 2s infinite;">미제출</span>`
            : '';

          html += `
            <div class="schedule-card"
                 style="background:${colorMap[teacher]};border-radius:9px;padding:7px 9px;cursor:pointer;position:relative;"
                 onclick="openGroupAttModal('${students[0].eventId}')">
              ${notSubBadgeHTML}
              <span class="badge bg-white text-dark"
                    style="position:absolute;top:5px;right:5px;font-size:0.6rem;border:1px solid rgba(0,0,0,0.12);">
                ${students.length}명
              </span>
              <div style="font-size:0.68rem;color:rgba(255,255,255,0.8);margin-bottom:5px;">
                ${students[0].branch ? `<span class="badge bg-light text-dark me-1" style="padding: 2px 4px; font-size: 0.6rem;">${students[0].branch}</span>` : ''}<i class="bi bi-geo-alt-fill"></i> ${room || '-'}
              </div>
              ${students.map(s => `
                <div style="display:flex;align-items:center;gap:3px;margin-bottom:4px;flex-wrap:wrap;">
                  <span style="color:#fff;font-weight:700;font-size:0.83rem;">${s.name}</span>
                  ${s.showTime ? `<span style="background:rgba(0,0,0,0.25);color:#fff;font-size:0.58rem;border-radius:3px;padding:0 3px;white-space:nowrap;">${s.actualTime}</span>` : ''}
                  ${s.isMakeup ? `<span style="background:#f97316;color:#fff;font-size:0.58rem;border-radius:3px;padding:0 3px;font-weight:700;">보강</span>` : ''}
                </div>`).join('')}
            </div>`;
        }
        html += `</td>`;
      });
      html += `</tr>`;
    });
  });

  html += `</tbody></table></div>`;
  document.getElementById('view-container').innerHTML = html;
};

// ─── 그룹 카드 클릭 → 출결/코멘트 모달 ───────────────────────────────
window.openGroupAttModal = function (eventId) {
  if (window.openAttendanceModal) {
    window.openAttendanceModal(eventId);
  }
};

// 💡 [보강관리 버그 픽스!] 보강관리 화면이 올바른 메모(r[17])를 읽어옵니다.
window.loadAbsenteeView = function () {
  if (!appCache.raw || !appCache.raw.attendance) {
    document.getElementById('view-container').innerHTML = '<p>데이터를 불러올 수 없습니다.</p>'; return;
  }
  const attendance = appCache.raw.attendance;
  const makeups = appCache.raw['보강일정DB'] || [];
  let absentees = [];

  for (let i = attendance.length - 1; i >= 1; i--) {
    const r = attendance[i];
    if (appCache.user.role === '강사' && r[4] !== appCache.user.name) continue;
    if (r[5] !== '결석' && r[5] !== '보강예정') continue;
    const absentDate = r[3] ? r[3].substring(0, 10) : '';
    let isScheduled = false; let makeupDate = '';
    for (const m of makeups) {
      const mAbsentDate = (m[2] || '').substring(0, 10);
      if (mAbsentDate === absentDate && (m[0] === r[1] || m[1] === r[2])) { isScheduled = true; makeupDate = (m[3] || '').substring(0, 10); break; }
    }
    let isCompleted = false;
    if (makeupDate) isCompleted = attendance.some(a => (a[1] === r[1] || a[2] === r[2]) && (a[3] || '').substring(0, 10) === makeupDate && (a[5] === '출석' || a[5] === '보강') && a[18] === '최종');
    if (!isCompleted && absentDate) isCompleted = attendance.some(a => (a[1] === r[1] || a[2] === r[2]) && (a[17] || '').includes('[' + absentDate + ' 결석] 보강완료'));
    if (isCompleted) continue;

    // 💡 [버그수정] 결석 사유를 잘못 읽어오던 버그 해결 (r[13] -> r[17])
    absentees.push({ date: absentDate, student: r[2], studentId: r[1], teacher: r[4], status: r[5], memo: r[17] || '이유 미기재', isScheduled, makeupDate });
  }

  let html = `
    <div class="d-flex justify-content-between align-items-center mb-4">
      <h3 class="fw-bold m-0"><i class="bi bi-person-x text-warning me-2"></i>보강 관리 (결석/보강 현황)</h3>
      <div class="d-flex gap-2">
        <input type="text" id="absentSearchInput" class="form-control form-control-sm border-warning rounded-pill px-3 shadow-sm" placeholder="🔍 학생명 검색..." style="width: 150px;" onkeyup="filterTableRows('absentSearchInput', 'absentTable', 1)">
        <button class="btn btn-outline-secondary btn-sm rounded-pill text-nowrap" onclick="loadAbsenteeView()"><i class="bi bi-arrow-clockwise"></i> 새로고침</button>
      </div>
    </div>
    <div class="card border-0 shadow-sm p-4 border-top border-warning border-4">
      <div class="table-responsive">
        <table class="table table-hover align-middle" id="absentTable">
          <thead class="bg-light"><tr><th>결석일자</th><th>학생명</th><th>담당강사</th><th>출결상태</th><th>결석사유(메모)</th><th class="text-end">보강 상태 / 조치</th></tr></thead>
          <tbody>
  `;
  if (absentees.length === 0) html += `<tr><td colspan="6" class="text-center py-4 text-muted">미처리 결석/보강 대상자가 없습니다. 환상적입니다! 🎉</td></tr>`;
  else {
    absentees.forEach(a => {
      const badgeClass = a.status === '결석' ? 'bg-danger' : 'bg-warning text-dark';
      const safeA = encodeURIComponent(JSON.stringify({ student: a.student, studentId: a.studentId, date: a.date, teacher: a.teacher }));
      let actionHTML = a.isScheduled ? `<span class="badge bg-info text-dark me-1">📅 ${a.makeupDate} 예약됨</span><button class="btn btn-sm btn-success fw-bold rounded-pill" onclick="markMakeupComplete('${safeA}')">보강완료 ✅</button>` : `<button class="btn btn-sm btn-outline-primary fw-bold rounded-pill mx-1" onclick="openMakeupModal('${safeA}')">날짜잡기 📅</button><button class="btn btn-sm btn-success fw-bold rounded-pill" onclick="markMakeupComplete('${safeA}')">보강완료 ✅</button>`;
      html += `<tr><td><span class="fw-bold text-muted"><i class="bi bi-calendar-event"></i> ${a.date}</span></td><td class="fw-bold fs-6">${a.student}</td><td>${a.teacher}</td><td><span class="badge ${badgeClass} rounded-pill">${a.status}</span></td><td><span class="text-truncate d-inline-block" style="max-width:250px;font-size:0.85rem;" title="${a.memo}">${a.memo}</span></td><td class="text-end">${actionHTML}</td></tr>`;
    });
  }
  html += `</tbody></table></div></div>`;
  document.getElementById('view-container').innerHTML = html;
};


// =========================================
// 👨‍🎓 학생 관리 뷰 (실시간 검색창 탑재)
// =========================================
window.loadStudentView = function () {
  try {
    const role = (appCache.user.role || '').trim();
    const isHeadmaster = (role === '원장');
    const isManager = true; // 원장만 접근하므로 항상 true

    if (!isHeadmaster) {
      document.getElementById('view-container').innerHTML = `
        <div class="alert alert-warning m-4">
          <i class="bi bi-exclamation-triangle me-2"></i>
          <strong>접근 권한 없음</strong>
          <p class="mt-2">학생 관리는 원장만 접근 가능합니다.</p>
        </div>
      `;
      return;
    }

    if (!appCache.raw || !appCache.raw.students) {
      document.getElementById('view-container').innerHTML = '<p>데이터를 불러올 수 없습니다.</p>';
      return;
    }

    const myName = (appCache.user.name || '').trim();

    const bookMap = {};
    if (appCache.raw.books) {
      appCache.raw.books.forEach(b => { if (b[0]) bookMap[b[0].trim()] = parseInt(b[3], 10) || 0; });
    }

    const progressMap = {};
    if (appCache.raw.attendance) {
      appCache.raw.attendance.forEach(r => {
        const sId = r[1]; const hwBook = (r[9] || '').trim(); const hwRange = r[10] || ''; const date = r[3] || '';
        if (!sId || !hwBook) return;
        const nums = hwRange.match(/\d+/g);
        let maxPage = 0; if (nums) maxPage = Math.max(...nums.map(Number));
        if (!progressMap[sId]) progressMap[sId] = {};
        if (!progressMap[sId][hwBook]) progressMap[sId][hwBook] = { maxPage: 0, lastDate: '', total: bookMap[hwBook] || 0 };
        if (maxPage > progressMap[sId][hwBook].maxPage) progressMap[sId][hwBook].maxPage = maxPage;
        if (date > progressMap[sId][hwBook].lastDate) progressMap[sId][hwBook].lastDate = date;
      });
    }

    // 💡 [수정] 내 시간표에 있는 학생 ID 수집 (강사용)
    let myStudentIds = new Set();
    if (!isManager && appCache.raw.schedules) {
      appCache.raw.schedules.forEach(r => {
        if (r[14] !== '비활성' && (r[9] || '').includes(myName)) {
          myStudentIds.add(r[3] || (r[0] || '').split('(')[0].trim());
        }
      });
    }

    let sList = [];
    for (let i = 1; i < appCache.raw.students.length; i++) {
      const s = appCache.raw.students[i];
      if (!s[0]) continue;

      const teacherNames = (s[6] || '').trim();
      // 💡 [수정] 원장님이 아니면 -> 담당강사에 내 이름이 있거나 OR 내 시간표에 이 학생이 있어야 보임
      if (!isManager && !teacherNames.includes(myName) && !myStudentIds.has(s[0]) && !myStudentIds.has(s[1])) continue;

      sList.push({ id: s[0], name: s[1], branch: s[2] || '', school: s[3] || '', grade: s[4] || '', status: s[7] || '재원', parentsPhone: s[10] || '-', teachers: teacherNames });
    }

    const countTotal = sList.length;
    const countActive = sList.filter(s => s.status === '재원').length;
    const countPause = sList.filter(s => s.status === '휴원').length;
    const countOut = sList.filter(s => s.status === '퇴원').length;

    sList.sort((a, b) => {
      const rank = { '재원': 1, '휴원': 2, '퇴원': 3 };
      const aRank = rank[a.status] || 1; const bRank = rank[b.status] || 1;
      if (aRank !== bRank) return aRank - bRank;
      return a.name.localeCompare(b.name);
    });

    let html = `
      <div class="d-flex justify-content-between align-items-center mb-4">
        <h3 class="fw-bold m-0"><i class="bi bi-people-fill text-success me-2"></i>학생 관리</h3>
        <div class="d-flex gap-2">
          <input type="text" id="studentSearchInput" class="form-control form-control-sm border-success rounded-pill px-3 shadow-sm" placeholder="🔍 학생 이름 검색..." style="width: 160px;" onkeyup="filterTableRows('studentSearchInput', 'studentTable', 0)">
          <button class="btn btn-outline-success btn-sm fw-bold rounded-pill border-2 text-nowrap" onclick="forceRefresh()"><i class="bi bi-arrow-clockwise"></i> 새로고침</button>
        </div>
      </div>

      <div class="row g-3 mb-4">
        <div class="col-3"><div class="card border-0 shadow-sm h-100 bg-white" style="border-radius: 12px; border-bottom: 4px solid #0d6efd !important;"><div class="card-body p-3 text-center"><p class="text-muted small fw-bold mb-1">총 인원</p><h4 class="fw-bold m-0 text-primary">${countTotal}</h4></div></div></div>
        <div class="col-3"><div class="card border-0 shadow-sm h-100 bg-white" style="border-radius: 12px; border-bottom: 4px solid #198754 !important;"><div class="card-body p-3 text-center"><p class="text-muted small fw-bold mb-1">재원</p><h4 class="fw-bold m-0 text-success">${countActive}</h4></div></div></div>
        <div class="col-3"><div class="card border-0 shadow-sm h-100 bg-white" style="border-radius: 12px; border-bottom: 4px solid #ffc107 !important;"><div class="card-body p-3 text-center"><p class="text-muted small fw-bold mb-1">휴원</p><h4 class="fw-bold m-0 text-warning" style="color: #d97706 !important;">${countPause}</h4></div></div></div>
        <div class="col-3"><div class="card border-0 shadow-sm h-100 bg-white" style="border-radius: 12px; border-bottom: 4px solid #dc3545 !important;"><div class="card-body p-3 text-center"><p class="text-muted small fw-bold mb-1">퇴원</p><h4 class="fw-bold m-0 text-danger">${countOut}</h4></div></div></div>
      </div>
      
      <div class="card border-0 shadow-sm border-top border-success border-4" style="border-radius: 12px; overflow: hidden;">
        <div class="table-responsive" style="max-height: 650px;">
          <table class="table table-hover align-middle mb-0" id="studentTable">
            <thead class="bg-light sticky-top">
              <tr><th class="ps-4 py-3">학생 이름</th><th class="py-3">상태</th><th class="py-3">학교/학년</th><th class="py-3">담당 강사</th><th style="width: 180px;" class="py-3">최근 교재 진행률</th><th class="text-center pe-4 py-3">관리</th></tr>
            </thead>
            <tbody>
    `;

    if (sList.length === 0) html += `<tr><td colspan="6" class="text-center py-5 text-muted">조회할 수 있는 학생이 없습니다.</td></tr>`;
    else {
      sList.forEach(s => {
        let statusBadge = 'bg-success'; if (s.status === '퇴원') statusBadge = 'bg-danger'; else if (s.status === '휴원') statusBadge = 'bg-warning text-dark';
        let recentBook = null;
        if (progressMap[s.id]) {
          const books = Object.keys(progressMap[s.id]).map(bName => ({ name: bName, ...progressMap[s.id][bName] })).sort((a, b) => b.lastDate.localeCompare(a.lastDate));
          if (books.length > 0) recentBook = books[0];
        }
        let progressHtml = '<span class="text-muted small">기록 없음</span>';
        if (recentBook && recentBook.total > 0) {
          let pct = Math.min(100, Math.round((recentBook.maxPage / recentBook.total) * 100)); let barColor = pct >= 90 ? 'bg-success' : (pct >= 50 ? 'bg-primary' : 'bg-warning');
          progressHtml = `<div class="d-flex flex-column w-100 px-1"><div class="d-flex justify-content-between mb-1 align-items-center"><span class="text-truncate fw-bold text-dark" style="max-width: 110px; font-size: 0.75rem;" title="${recentBook.name}">${recentBook.name}</span><span class="fw-bold" style="font-size: 0.75rem; color: #475569;">${pct}%</span></div><div class="progress shadow-sm" style="height: 6px; border-radius: 3px; background-color: #e2e8f0;"><div class="progress-bar ${barColor}" style="width: ${pct}%;"></div></div></div>`;
        } else if (recentBook && recentBook.total === 0) {
          progressHtml = `<div class="d-flex flex-column w-100"><span class="text-truncate fw-bold text-dark mb-1" style="font-size: 0.75rem;" title="${recentBook.name}">${recentBook.name}</span><span class="text-danger fw-bold" style="font-size: 0.65rem;">총 페이지 누락</span></div>`;
        }
        html += `<tr style="cursor: pointer;" onclick="openStudentProfileModal('${s.id}', '${s.name}')"><td class="ps-4 fw-bold text-dark" style="font-size: 1.05rem;">${s.name} <span class="badge bg-secondary bg-opacity-10 text-dark border ms-1 fw-normal" style="font-size: 0.7rem;">${s.branch || '본관'}</span></td><td><span class="badge ${statusBadge} shadow-sm px-2">${s.status}</span></td><td class="text-muted small">${s.school} ${s.grade}</td><td><span class="badge bg-light text-dark border fw-bold shadow-sm">${s.teachers || '-'}</span></td><td class="align-middle">${progressHtml}</td><td class="text-center pe-4"><button class="btn btn-sm btn-success rounded-pill fw-bold shadow-sm px-3" onclick="event.stopPropagation(); openStudentProfileModal('${s.id}', '${s.name}')">상세 🔍</button></td></tr>`;
      });
    }
    html += `</tbody></table></div></div>`;
    document.getElementById('view-container').innerHTML = html;

    if (isManager) {
      const fabHtml = `
        <button onclick="openNewStudentModal()" class="btn btn-primary shadow-lg d-flex justify-content-center align-items-center" style="position: fixed; bottom: 80px; right: 20px; border-radius: 50%; width: 60px; height: 60px; font-size: 28px; z-index: 1050; transition: transform 0.2s;">
          <i class="bi bi-person-plus-fill"></i>
        </button>
      `;
      document.getElementById('view-container').insertAdjacentHTML('beforeend', fabHtml);
    }
  } catch (e) {
    document.getElementById('view-container').innerHTML = `<div class="alert alert-danger m-4">학생 관리 로딩 오류: ${e.message}</div>`;
  }
};

// 명단 단순 필터링 함수
window.filterStudents = function () {
  const keyword = document.getElementById('studentSearchInput').value.toLowerCase();
  const rows = document.querySelectorAll('#studentTable .student-row');

  rows.forEach(row => {
    const name = row.querySelector('.student-name').innerText.toLowerCase();
    if (name.includes(keyword)) row.style.display = '';
    else row.style.display = 'none';
  });
}

// =========================================
// 보강 관련 기능
// =========================================
window.openMakeupModal = function (encodedA) {
  const a = JSON.parse(decodeURIComponent(encodedA));

  document.getElementById('mk_student').value = a.student;
  document.getElementById('mk_student_id').value = a.studentId || '';
  document.getElementById('mk_absentDate').value = a.date || '';

  // 강사 드롭다운 채우기
  const sel = document.getElementById('mk_teacher');
  sel.innerHTML = '';
  const teachers = (appCache.raw.teachers || []).filter(t => t[1] && t[4] !== '퇴사').map(t => t[1]);
  teachers.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    if (t === a.teacher) opt.selected = true;
    sel.appendChild(opt);
  });

  // 보강 날짜 기본값: 오늘
  document.getElementById('mk_date').value = new Date().toISOString().substring(0, 10);
  document.getElementById('mk_room').value = '';

  new bootstrap.Modal(document.getElementById('makeupModal')).show();
};

// =================================================================
// 🚀 [고속 통신 & 충돌 방지] 보강 일정 등록
// =================================================================
window.submitMakeup = async function () {
  const student = document.getElementById('mk_student').value;
  const studentId = document.getElementById('mk_student_id').value;
  const mkDate = document.getElementById('mk_date').value;
  const teacher = document.getElementById('mk_teacher').value;
  const start = document.getElementById('mk_start').value;
  const end = document.getElementById('mk_end').value;
  const room = document.getElementById('mk_room').value;

  if (!room) { alert('강의실을 반드시 입력해주세요! (예: 본관-R1)'); return; }
  if (!mkDate) { alert('보강 날짜를 선택해주세요.'); return; }
  if (!teacher) { alert('담당 강사를 선택해주세요.'); return; }

  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const dayOfWeek = dayNames[new Date(mkDate + 'T00:00:00').getDay()];

  // 💡 [핵심] 기존 정규 시간표 및 다른 보강 일정과 충돌 검사
  const existingSchedules = window.getActiveSchedules();
  const existingMakeups = appCache.raw['보강일정DB'] || [];

  // 1. 해당 요일에 정규 수업과 겹치는지 검사
  const regConflict = existingSchedules.find(r => {
    if (r[14] === '비활성') return false;
    const sId = r[3] || (r[0] || '').split('(')[0].trim();
    const sName = (r[0] || '').split('(')[0].trim();
    if (sId !== studentId && sName !== student) return false;
    if (r[4] !== dayOfWeek) return false;

    const oldStart = r[6];
    const oldEnd = r[7];
    if (!oldStart || !oldEnd) return false;

    return (toMins(start) < toMins(oldEnd) && toMins(end) > toMins(oldStart));
  });

  if (regConflict) {
    return alert(`🚨 [보강 충돌 오류]\n해당 요일(${dayOfWeek}요일 ${start}~${end})에 학생의 정규 수업(${regConflict[9]} 선생님)이 이미 있습니다!\n시간을 변경해주세요.`);
  }

  // 2. 해당 날짜에 다른 보강과 겹치는지 검사
  const mkConflict = existingMakeups.find(r => {
    if (r[8] === '완료') return false;
    const mId = r[0] || '';
    const mName = r[1] || '';
    if (mId !== studentId && mName !== student) return false;
    const mDate = (r[3] || '').substring(0, 10);
    if (mDate !== mkDate) return false;

    const oldStart = r[4];
    const oldEnd = r[5];
    if (!oldStart || !oldEnd) return false;

    return (toMins(start) < toMins(oldEnd) && toMins(end) > toMins(oldStart));
  });

  if (mkConflict) {
    return alert(`🚨 [보강 충돌 오류]\n해당 날짜(${mkDate}) 동일한 시간에 이미 다른 보강(${mkConflict[6]} 선생님)이 예약되어 있습니다!\n시간을 변경해주세요.`);
  }

  showLoader(true, "보강 일정 등록 중...");
  try {
    const absentDate = document.getElementById('mk_absentDate') ? document.getElementById('mk_absentDate').value : '';
    const rowData = [studentId, student, absentDate, mkDate, start, end, teacher, room, "예약"];

    const sheetName = '보강일정DB';
    await callSheetsAPI('POST', `/values/${encodeURIComponent(sheetName)}:append?valueInputOption=USER_ENTERED`, { values: [rowData] });

    showLoader(false);
    alert(`[${student}] 보강 일정이 등록되었습니다! 📅\n${mkDate} (${dayOfWeek}) ${start}~${end}`);
    bootstrap.Modal.getInstance(document.getElementById('makeupModal')).hide();
    forceRefresh();
  } catch (e) {
    showLoader(false);
    alert('보강 등록 실패: ' + e.message);
  }
};

// =================================================================
// 🚀 [고속 통신 2] 보강 완료 처리 (출결기록)
// =================================================================
window.markMakeupComplete = async function (encodedA) {
  const a = JSON.parse(decodeURIComponent(encodedA));
  if (!confirm(`[${a.student}] 학생의 보강 수업을 완료(출석) 처리하시겠습니까?`)) return;

  const today = new Date().toISOString().substring(0, 10);
  const timestamp = new Date().toLocaleString('ko-KR');

  showLoader(true, "보강 완료 처리 중...");
  try {
    // 출결기록 컬럼 매핑
    const rowData = [
      timestamp, a.studentId || '', a.student, today, a.teacher, '보강', '없음', '', '', '', '', '일일', '', '', '', '', '', `[${a.date} 결석] 보강완료`, '최종', '', ''
    ];

    const sheetName = (typeof CONFIG !== 'undefined' && CONFIG.SHEETS && CONFIG.SHEETS.ATTENDANCE) ? CONFIG.SHEETS.ATTENDANCE : '출결기록';
    await callSheetsAPI('POST', `/values/${encodeURIComponent(sheetName)}:append?valueInputOption=USER_ENTERED`, { values: [rowData] });

    showLoader(false);
    alert(`[${a.student}] 보강 완료 처리 되었습니다! ✅`);
    forceRefresh();
  } catch (e) {
    showLoader(false);
    alert('처리 실패: ' + e.message);
  }
};

// =========================================
// 학생 정보 수정 모달 (수정 버튼 고장 해결 & 퇴원 연동 & 학년 버그 픽스)
// =========================================
window.openStudentEditModal = function (studentId) {
  const students = appCache.raw.students || [];
  const s = students.find(r => r[0] === studentId);
  if (!s) { alert('학생 정보를 찾을 수 없습니다.'); return; }

  // 기존 모달 제거
  const existing = document.getElementById('studentEditModal');
  if (existing) existing.remove();

  const statusOptions = ['재원', '휴원', '퇴원'].map(st =>
    `<option value="${st}" ${(s[7] || '') === st ? 'selected' : ''}>${st}</option>`
  ).join('');

  // 💡 [핵심 버그 수정] 시트 값과 동일하게 1~6학년으로 선택지 통일 (빈칸 날아감 방지)
  const gradeOptions = ['1학년', '2학년', '3학년', '4학년', '5학년', '6학년'].map(g =>
    `<option value="${g}" ${(s[4] || '').includes(g.replace('학년', '')) ? 'selected' : ''}>${g}</option>`
  ).join('');

  const el = document.createElement('div');
  el.innerHTML = `
    <div class="modal fade" id="studentEditModal" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content border-0 shadow-lg">
          <div class="modal-header bg-secondary text-white">
            <h5 class="modal-title fw-bold"><i class="bi bi-pencil-square me-2"></i>${s[1]} 정보 수정</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body p-4">
            <input type="hidden" id="edit-student-id" value="${studentId}">
            <div class="row g-3">
              <div class="col-12">
                <label class="form-label fw-bold small">이름</label>
                <input type="text" id="edit-name" class="form-control" value="${s[1] || ''}">
              </div>
              <div class="col-6">
                <label class="form-label fw-bold small">학교명</label>
                <input type="text" id="edit-school" class="form-control" value="${s[3] || ''}">
              </div>
              <div class="col-6">
                <label class="form-label fw-bold small">학년</label>
                <select id="edit-grade" class="form-select">
                  <option value="">선택</option>${gradeOptions}
                </select>
              </div>
              <div class="col-6">
                <label class="form-label fw-bold small">재원 상태 ⭐</label>
                <select id="edit-status" class="form-select fw-bold border-warning text-danger">
                  ${statusOptions}
                </select>
                <div class="form-text text-danger small"><i class="bi bi-info-circle"></i> '퇴원' 처리 시 시간표에서 자동 삭제됩니다.</div>
              </div>
              <div class="col-6">
                <label class="form-label fw-bold small">학부모 연락처</label>
                <input type="text" id="edit-parent-phone" class="form-control" value="${s[10] || ''}">
              </div>
            </div>
          </div>
          <div class="modal-footer bg-light">
            <button class="btn btn-secondary rounded-pill" data-bs-dismiss="modal">취소</button>
            <button class="btn btn-primary rounded-pill fw-bold px-4" onclick="saveStudentEdit()">
              <i class="bi bi-check-circle-fill me-1"></i>저장
            </button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el.firstElementChild);
  new bootstrap.Modal(document.getElementById('studentEditModal')).show();
};

// 🚀 [핵심] 학생 수정 및 퇴원 시 시간표 연동 삭제
window.saveStudentEdit = async function () {
  const studentId = document.getElementById('edit-student-id').value;
  const name = document.getElementById('edit-name').value.trim();
  const school = document.getElementById('edit-school').value.trim();
  // 💡 [수정] 정규식으로 '초/중/고' 글자를 지우지 않고 '1학년' 형태 그대로 가져감
  const grade = document.getElementById('edit-grade').value;
  const status = document.getElementById('edit-status').value;
  const parentPhone = document.getElementById('edit-parent-phone').value.trim();

  if (!name) { alert('이름을 입력해주세요.'); return; }

  showLoader(true, "학생 정보를 업데이트하는 중...");
  try {
    // 1. 원천DB (STUDENT) 정보 업데이트
    await updateStudentData(studentId, { name, school, grade, status, parentPhone });

    // 2. 만약 상태가 '퇴원'으로 바뀌었다면, 수강일정DB(SCHEDULE)에서 비활성화(삭제) 처리
    if (status === '퇴원' || status === '휴원') {
      const scheduleRes = await callSheetsAPI('GET', `/values/${encodeURIComponent(CONFIG.SHEETS.SCHEDULE)}!A:O`);
      const schedVals = scheduleRes.values || [];
      const updateBatch = [];

      for (let i = 1; i < schedVals.length; i++) {
        const row = schedVals[i];
        if ((row[0] && (row[0].includes(name) || row[0].includes(studentId))) || row[3] === studentId) {
          const rowNum = i + 1;
          updateBatch.push({
            range: `${CONFIG.SHEETS.SCHEDULE}!O${rowNum}`,
            values: [["비활성"]]
          });
        }
      }

      if (updateBatch.length > 0) {
        await callSheetsAPI('POST', `/values:batchUpdate`, {
          valueInputOption: "USER_ENTERED",
          data: updateBatch
        });
        console.log(`[퇴원/휴원 처리] 시간표 ${updateBatch.length}건 비활성화 완료`);
      }
    }

    showLoader(false);
    alert(`[${name}] 학생 정보가 수정되었습니다! ✅\n(${status} 처리 시 시간표에서도 제외됩니다)`);

    bootstrap.Modal.getInstance(document.getElementById('studentEditModal')).hide();
    forceRefresh();

  } catch (e) {
    showLoader(false);
    alert('수정 실패: ' + e.message);
  }
};

// =================================================================
// 🚀 [업그레이드] 학생 상세 팝업 (교재 진도율 & 수강 타임라인 포함)
// =================================================================
// =================================================================
// 🚀 [신규] 학생별 시간표 변경(추가/삭제) 관리 모달
// =================================================================

// 1. 시간표 변경 모달 열기
window.openScheduleChangeModal = function (studentId, studentName) {
  const schedules = appCache.raw.schedules || [];
  // 해당 학생의 '활성' 상태인 시간표만 필터링
  const activeSchedules = schedules.filter(r =>
    ((r[0] || '').includes(studentId) || (r[0] || '').includes(studentName)) && (r[14] || '').trim() !== '비활성'
  );

  const teachers = (appCache.raw.teachers || []).filter(t => t[1] && t[4] !== '퇴사').map(t => t[1]);
  let teacherOptions = teachers.map(t => `<option value="${t}">${t}</option>`).join('');

  let listHtml = activeSchedules.map((s, idx) => `
    <div class="card border-0 shadow-sm mb-2 bg-light">
      <div class="card-body p-3 d-flex justify-content-between align-items-center">
        <div>
          <span class="badge bg-primary me-2">${s[4]}요일</span>
          <strong class="text-dark">${s[6]} ~ ${s[7]}</strong>
          <div class="small text-muted mt-1">담당: ${s[9]}T | 강의실: ${s[11] || '-'}</div>
        </div>
        <button class="btn btn-sm btn-outline-danger fw-bold rounded-pill" onclick="deactivateSchedule('${studentId}', '${studentName}', '${s[4]}', '${s[6]}')">수업 종료</button>
      </div>
    </div>
  `).join('');

  if (activeSchedules.length === 0) listHtml = '<div class="text-center py-4 text-muted small">현재 수강 중인 정규 수업이 없습니다.</div>';

  const modalHtml = `
    <div class="modal fade" id="scheduleManageModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content border-0 shadow-lg">
          <div class="modal-header bg-dark text-white">
            <h5 class="modal-title fw-bold"><i class="bi bi-calendar-range me-2"></i>시간표 변경 관리</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body p-4">
            <h6 class="fw-bold mb-3"><i class="bi bi-list-check me-2 text-primary"></i>현재 수강 중인 수업</h6>
            <div class="mb-4" style="max-height: 200px; overflow-y: auto;">${listHtml}</div>
            
            <hr class="my-4">
            
            <h6 class="fw-bold mb-3 text-success"><i class="bi bi-plus-circle-fill me-2"></i>새로운 수업 추가</h6>
            <div class="row g-2">
              <div class="col-4">
                <select id="sm-day" class="form-select form-select-sm"><option value="월">월요일</option><option value="화">화요일</option><option value="수">수요일</option><option value="목">목요일</option><option value="금">금요일</option><option value="토">토요일</option><option value="일">일요일</option></select>
              </div>
              <div class="col-8">
                <select id="sm-teacher" class="form-select form-select-sm">${teacherOptions}</select>
              </div>
              <div class="col-6">
                <div class="input-group input-group-sm"><span class="input-group-text">시작</span><input type="time" id="sm-start" class="form-control" value="17:00"></div>
              </div>
              <div class="col-6">
                <div class="input-group input-group-sm"><span class="input-group-text">종료</span><input type="time" id="sm-end" class="form-control" value="19:00"></div>
              </div>
              <div class="col-12 mt-2">
                <input type="text" id="sm-room" class="form-control form-control-sm" placeholder="강의실 (예: 본관-R1)">
              </div>
              <div class="col-12 mt-3">
                <button class="btn btn-success btn-sm w-100 fw-bold rounded-pill" onclick="addNewScheduleRow('${studentId}', '${studentName}')">새 수업 등록하기</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  const existing = document.getElementById('scheduleManageModal');
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  new bootstrap.Modal(document.getElementById('scheduleManageModal')).show();
};

// 2. 수업 종료(비활성화) 처리
window.deactivateSchedule = async function (studentId, studentName, day, startTime) {
  if (!confirm(`[${day}요일 ${startTime}] 수업을 종료 처리하시겠습니까?\n이후에는 '수강 변동 이력'에서만 확인 가능합니다.`)) return;

  showLoader(true, "수업 정보를 업데이트 중...");
  try {
    const sheetName = CONFIG.SHEETS.SCHEDULE;
    const res = await callSheetsAPI('GET', `/values/${encodeURIComponent(sheetName)}!A:O`);
    const rows = res.values || [];

    // 정확한 행 찾기 (이름/ID + 요일 + 시작시간 매칭)
    const rowIndex = rows.findIndex(r =>
      ((r[0] || '').includes(studentId) || (r[0] || '').includes(studentName)) &&
      r[4] === day && r[6] === startTime && (r[14] || '').trim() !== '비활성'
    );

    if (rowIndex < 0) throw new Error("해당 수업 데이터를 찾을 수 없습니다.");

    const rowNum = rowIndex + 1;
    await callSheetsAPI('PUT', `/values/${encodeURIComponent(sheetName + '!O' + rowNum)}?valueInputOption=USER_ENTERED`, { values: [["비활성"]] });

    alert("수업이 성공적으로 종료되었습니다.");
    bootstrap.Modal.getInstance(document.getElementById('scheduleManageModal')).hide();
    forceRefresh();
  } catch (e) {
    alert("오류 발생: " + e.message);
  } finally {
    showLoader(false);
  }
};

// 3. 새 수업 행 추가
window.addNewScheduleRow = async function (studentId, studentName) {
  const day = document.getElementById('sm-day').value;
  const teacher = document.getElementById('sm-teacher').value;
  const start = document.getElementById('sm-start').value;
  const end = document.getElementById('sm-end').value;
  const room = document.getElementById('sm-room').value;

  if (!room) return alert("강의실을 입력해주세요.");

  showLoader(true, "새 시간표 등록 중...");
  try {
    const today = new Date().toISOString().substring(0, 10);
    // 수강일정DB 컬럼: A:표시명, B:등록ID, C:반ID, D:학생ID, E:요일, F:구분, G:시작, H:종료, I:교재, J:강사, K:회차, L:강의실, M:메모, N:자동명칭, O:상태, P:시작일
    const displayLabel = `${studentName} - ${studentId}`;
    const rowData = [displayLabel, "", "", studentId, day, "정규", start, end, "", teacher, "", room, "", "", "활성", today];

    await callSheetsAPI('POST', `/values/${encodeURIComponent(CONFIG.SHEETS.SCHEDULE)}:append?valueInputOption=USER_ENTERED`, { values: [rowData] });

    alert("새 수업이 등록되었습니다! 📅");
    bootstrap.Modal.getInstance(document.getElementById('scheduleManageModal')).hide();
    forceRefresh();
  } catch (e) {
    alert("등록 실패: " + e.message);
  } finally {
    showLoader(false);
  }
};
// =================================================================
// 🚀 [업그레이드] 학생 상세 팝업 (수강 타임라인 + 시간표 변경 버튼 포함)
// =================================================================
window.openStudentProfileModal = function (studentId, studentName) {
  try {
    // 1. 학생 기본 정보
    let studentInfo = { school: '-', grade: '-', parentPhone: '-', date: '-', status: '-' };
    if (appCache.raw.students) {
      const s = appCache.raw.students.find(r => r[0] === studentId && r[1] === studentName);
      if (s) {
        studentInfo = {
          school: s[3] || '-', grade: s[4] || '-', status: s[7] || '-', parentPhone: s[10] || '-', date: s[8] ? s[8].substring(0, 10) : '-'
        };
      }
    }

    // 2. 교재 진도율 자동 계산 로직
    const bookMap = {};
    if (appCache.raw.books) {
      appCache.raw.books.forEach(b => { if (b[0]) bookMap[b[0].trim()] = parseInt(b[3], 10) || 0; });
    }

    const myProgress = {};
    if (appCache.raw.attendance) {
      const myAtt = appCache.raw.attendance.filter(r => r[1] === studentId || r[2] === studentName);
      myAtt.forEach(r => {
        const hwBook = (r[9] || '').trim();
        const hwRange = r[10] || '';
        const date = r[3] || '';
        if (!hwBook) return;

        const nums = hwRange.match(/\d+/g);
        let maxPage = 0;
        if (nums) maxPage = Math.max(...nums.map(Number));

        if (!myProgress[hwBook]) myProgress[hwBook] = { maxPage: 0, lastDate: '', total: bookMap[hwBook] || 0 };
        if (maxPage > myProgress[hwBook].maxPage) myProgress[hwBook].maxPage = maxPage;
        if (date > myProgress[hwBook].lastDate) myProgress[hwBook].lastDate = date;
      });
    }

    // 진도율 HTML 생성 (최대 최근 3권)
    let bookProgressHTML = '<div class="text-muted small py-2 text-center">숙제 기록에 기반한 교재 진행률이 없습니다.</div>';
    const books = Object.keys(myProgress).map(bName => ({
      name: bName, ...myProgress[bName]
    })).sort((a, b) => b.lastDate.localeCompare(a.lastDate));

    if (books.length > 0) {
      bookProgressHTML = books.slice(0, 3).map(b => {
        if (b.total > 0) {
          let pct = Math.min(100, Math.round((b.maxPage / b.total) * 100));
          let barColor = pct >= 90 ? 'bg-success' : (pct >= 50 ? 'bg-primary' : 'bg-warning');

          // 예상 완료일 계산
          let estimatedDate = '-';
          if (pct > 0 && pct < 100 && b.lastDate) {
            const lastDate = new Date(b.lastDate);
            const today = new Date();
            const daysElapsed = Math.max(1, Math.floor((today - lastDate) / (1000 * 60 * 60 * 24)) + 1);
            const pagesPerDay = b.maxPage / daysElapsed;
            const remainingPages = b.total - b.maxPage;
            const daysRemaining = Math.max(1, Math.ceil(remainingPages / pagesPerDay));
            const estimatedDateObj = new Date(today.getTime() + daysRemaining * 24 * 60 * 60 * 1000);
            estimatedDate = estimatedDateObj.toISOString().split('T')[0];
          }

          return `
                <div class="mb-3">
                  <div class="d-flex justify-content-between mb-1 align-items-center">
                    <span class="text-truncate fw-bold text-dark" style="font-size: 0.9rem;" title="${b.name}"><i class="bi bi-book text-muted me-1"></i>${b.name}</span>
                    <span class="fw-bold" style="font-size: 0.85rem; color: #475569;">${pct}%</span>
                  </div>
                  <div class="progress shadow-sm" style="height: 10px; border-radius: 5px; background-color: #e2e8f0;">
                    <div class="progress-bar ${barColor} progress-bar-striped progress-bar-animated" style="width: ${pct}%;"></div>
                  </div>
                  <div class="text-muted mt-1 d-flex justify-content-between" style="font-size: 0.75rem;">
                    <span>현재 <b>${b.maxPage}</b> / 총 ${b.total}p</span>
                    <span><i class="bi bi-calendar-check me-1"></i>예상 완료: <b>${estimatedDate}</b></span>
                  </div>
                </div>`;
        } else {
          return `
                <div class="mb-3">
                  <span class="text-truncate fw-bold text-dark d-block mb-1" style="font-size: 0.9rem;"><i class="bi bi-book text-muted me-1"></i>${b.name}</span>
                  <span class="text-danger fw-bold" style="font-size: 0.75rem;"><i class="bi bi-exclamation-circle-fill me-1"></i>교재DB에 총 페이지 정보가 없습니다. (현재: ${b.maxPage}p)</span>
                </div>`;
        }
      }).join('');
    }

    // 3. [신규] 수강 변동 이력 타임라인 구성
    let timelineHTML = '';
    if (appCache.raw.schedules) {
      const myFullHistory = appCache.raw.schedules.filter(r => (r[0] || '').includes(studentId) || (r[0] || '').includes(studentName));

      if (myFullHistory.length === 0) {
        timelineHTML = '<div class="text-muted small py-2">기록된 수강 이력이 없습니다.</div>';
      } else {
        timelineHTML = myFullHistory.reverse().map(r => {
          const isActive = (r[14] || '').trim() !== '비활성';
          const statusBadge = isActive ? '<span class="badge bg-success me-1">현재</span>' : '<span class="badge bg-secondary me-1">종료</span>';
          const rowStyle = isActive ? 'border-primary' : 'border-light bg-light bg-opacity-50';
          const dateInfo = isActive ? `${r[15] || '-'} ~ 진행중` : `${r[15] || '-'} ~ 종료됨`;

          return `
            <div class="border-start border-3 ${rowStyle} ps-3 mb-3 position-relative">
              <div class="d-flex align-items-center mb-1">
                ${statusBadge}
                <strong class="${isActive ? 'text-dark' : 'text-muted'} small">${r[4]}요일 ${r[6]}~${r[7]}</strong>
              </div>
              <div class="small text-muted">
                <i class="bi bi-person-workspace"></i> 담당: ${r[9]}T | <i class="bi bi-calendar-event"></i> ${dateInfo}
              </div>
            </div>`;
        }).join('');
      }
    }

    // 4. 최근 상담 3건
    let counselsHTML = '<div class="small text-muted">최근 상담 내역이 없습니다.</div>';
    if (appCache.raw.counsels) {
      const myCounsels = appCache.raw.counsels.filter(r => r[2] === studentId || r[1] === studentName).reverse().slice(0, 3);
      if (myCounsels.length > 0) {
        counselsHTML = myCounsels.map(r => `
          <div class="border-start border-3 border-info ps-2 mb-3">
            <div class="small fw-bold text-info">${r[4] ? r[4].substring(0, 10) : '-'} · ${r[5] || '-'} · ${r[7] || '-'}</div>
            <div class="small text-muted mt-1" style="white-space:pre-wrap;">${r[8] || ''}</div>
          </div>`).join('');
      }
    }

    // 5. 최근 출결 및 달력
    let attHTML = '<tr><td colspan="4" class="text-muted small text-center py-3">출결 내역이 없습니다.</td></tr>';
    let hwStatsHTML = '<div class="text-muted small">출결 기록이 없습니다.</div>';
    let calCells = '';
    let statsHTML = '';

    if (appCache.raw.attendance) {
      const myAtt = appCache.raw.attendance.filter(r => r[1] === studentId || r[2] === studentName);

      const stats = { total: myAtt.length, present: 0, absent: 0, late: 0, makeup: 0 };
      myAtt.forEach(r => {
        const s = r[5];
        if (s === '출석') stats.present++;
        else if (s === '결석') stats.absent++;
        else if (s === '지각' || s === '조퇴' || s === '보강예정') stats.late++;
        else if (s === '보강') stats.makeup++;
      });

      statsHTML = `
        <div class="d-flex flex-wrap gap-2 mb-3">
          <div class="badge bg-light text-dark border p-2 px-3 fw-bold shadow-sm">총 수업: ${stats.total}회</div>
          <div class="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25 p-2 px-3 fw-bold shadow-sm">출석: ${stats.present}</div>
          <div class="badge bg-danger bg-opacity-10 text-danger border border-danger border-opacity-25 p-2 px-3 fw-bold shadow-sm">결석: ${stats.absent}</div>
          <div class="badge bg-warning bg-opacity-10 text-warning border border-warning border-opacity-25 p-2 px-3 fw-bold shadow-sm">지각/조퇴: ${stats.late}</div>
          <div class="badge bg-info bg-opacity-10 text-info border border-info border-opacity-25 p-2 px-3 fw-bold shadow-sm">보강: ${stats.makeup}</div>
        </div>
      `;

      const now = new Date();
      const curYear = now.getFullYear();
      const curMonth = now.getMonth();
      const firstDay = new Date(curYear, curMonth, 1);
      const lastDay = new Date(curYear, curMonth + 1, 0);
      const startDayIdx = firstDay.getDay();
      const totalDays = lastDay.getDate();

      const monthAttMap = {};
      myAtt.forEach(r => {
        if (!r[3]) return;
        const d = new Date(r[3]);
        if (d.getFullYear() === curYear && d.getMonth() === curMonth) {
          monthAttMap[d.getDate()] = r[5];
        }
      });

      for (let i = 0; i < startDayIdx; i++) calCells += '<div style="background:#f1f5f9;border-radius:4px;height:24px;"></div>';
      for (let d = 1; d <= totalDays; d++) {
        const status = monthAttMap[d];
        let style = 'background:#f8fafc;color:#cbd5e1;';
        let text = d;
        if (status === '출석') { style = 'background:#22c55e;color:#fff;font-weight:bold;'; text = '출'; }
        else if (status === '결석') { style = 'background:#ef4444;color:#fff;font-weight:bold;'; text = '결'; }
        else if (status === '보강') { style = 'background:#f97316;color:#fff;font-weight:bold;'; text = '보'; }
        else if (status === '지각' || status === '조퇴' || status === '보강예정') { style = 'background:#facc15;color:#854d0e;font-weight:bold;'; text = '지'; }
        calCells += `<div style="${style}border-radius:4px;height:24px;display:flex;align-items:center;justify-content:center;font-size:0.65rem;" title="${d}일: ${status || '수업없음'}">${text}</div>`;
      }

      const recent30 = myAtt.slice(-30);
      const total = recent30.filter(r => ['출석', '보강', '지각', '조퇴'].includes(r[5])).length;
      const done = recent30.filter(r => r[6] === '완료').length;
      const half = recent30.filter(r => r[6] === '미흡' || r[6] === '세모').length;
      const fail = recent30.filter(r => r[6] === '미제출' || r[6] === '미완료').length;

      if (total > 0) {
        const donePct = Math.round(done / total * 100); const halfPct = Math.round(half / total * 100); const failPct = Math.round(fail / total * 100);
        hwStatsHTML = `
          <div class="d-flex mb-2"><span class="text-success fw-bold me-2">완료 ${donePct}%</span><span class="text-warning fw-bold me-2">미흡 ${halfPct}%</span><span class="text-danger fw-bold">미제출 ${failPct}%</span></div>
          <div class="progress" style="height:14px; border-radius:8px;">
            <div class="progress-bar bg-success" style="width:${donePct}%;" title="완료: ${done}회"></div>
            <div class="progress-bar bg-warning" style="width:${halfPct}%;" title="미흡: ${half}회"></div>
            <div class="progress-bar bg-danger" style="width:${failPct}%;" title="미제출: ${fail}회"></div>
          </div><div class="text-muted small mt-1">최근 ${total}회 수업 기준</div>`;
      }

      const top5 = myAtt.reverse().slice(0, 5);
      if (top5.length > 0) {
        attHTML = top5.map(r => {
          const dateStr = r[3] ? r[3].substring(5, 10) : '-';
          const bookStr = r[8] || r[7] || '-';
          let attBadge = r[5] === '출석' ? 'text-success' : (r[5] === '결석' ? 'text-danger' : 'text-warning');
          let hwBadge = r[6] === '완료' ? 'text-success' : (r[6] === '미제출' ? 'text-danger' : 'text-warning');
          return `<tr class="small text-center align-middle"><td class="text-muted">${dateStr}</td><td class="fw-bold ${attBadge}">${r[5]}</td><td class="fw-bold ${hwBadge}">${r[6]}</td><td class="text-start text-truncate" style="max-width:120px;" title="${bookStr}">${bookStr}</td></tr>`;
        }).join('');
      }
    }

    // 6. 성적 데이터 추출
    let chartLabels = []; let chartData = [];
    if (appCache.raw.scores) {
      const myScores = appCache.raw.scores.filter(r => r[1] === studentId || r[2] === studentName).sort((a, b) => new Date(a[3]) - new Date(b[3]));
      myScores.forEach(r => {
        const score = parseFloat(r[6]); const totalScore = parseFloat(r[7]) || 100;
        if (!isNaN(score)) {
          chartLabels.push(`${(r[3] || '').substring(5, 10)}(${(r[4] || '').substring(0, 2)})`);
          chartData.push(Math.round((score / totalScore) * 100));
        }
      });
    }

    // 7. 상담 요청 현황
    let counselRequestHTML = '';
    if (appCache.raw.counsels) {
      const myRequests = appCache.raw.counsels.filter(c => (c[2] === studentId || c[1] === studentName) && c[9]); // 요청일자 있는 것만

      if (myRequests.length > 0) {
        const today = new Date().toISOString().split('T')[0];
        const pending = myRequests.filter(c => c[10] && c[10] < today && c[11] !== '완료');
        const inProgress = myRequests.filter(c => c[10] && c[11] !== '완료');
        const completed = myRequests.filter(c => c[11] === '완료');

        counselRequestHTML = `
          <div class="alert alert-info py-2 px-3 mb-2 small" style="background-color: #cfe2ff; border-color: #b6d4fe;">
            <div class="d-flex gap-2 flex-wrap">
              ${pending.length > 0 ? `<span class="badge bg-danger">🔴 마감임박: ${pending.length}건</span>` : ''}
              ${inProgress.length > 0 ? `<span class="badge bg-warning text-dark">🟡 진행중: ${inProgress.length}건</span>` : ''}
              ${completed.length > 0 ? `<span class="badge bg-success">🟢 완료: ${completed.length}건</span>` : ''}
            </div>
          </div>
        `;
      }
    }

    // 8. HTML 조립
    const modalHTML = `
      <div class="d-flex align-items-center mb-4 p-3 bg-white rounded shadow-sm border">
        <div class="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center me-3 shadow-sm" style="width: 64px; height: 64px; font-size: 1.8rem; font-weight: bold;">
          ${studentName.substring(0, 1)}
        </div>
        <div>
          <h3 class="fw-bold m-0 mb-1">${studentName} <span class="badge ${studentInfo.status === '퇴원' ? 'bg-danger' : (studentInfo.status === '휴원' ? 'bg-warning text-dark' : 'bg-success')} fs-6 align-middle ms-2">${studentInfo.status}</span></h3>
          <div class="text-muted" style="font-size:0.9rem;">
            <i class="bi bi-building me-1"></i> ${studentInfo.school} ${studentInfo.grade} &nbsp;|&nbsp;
            <i class="bi bi-telephone-fill me-1 ms-2"></i> 학부모: ${studentInfo.parentPhone}
          </div>
        </div>
      </div>
      
      <div class="row g-3">
        <div class="col-md-5">
          
          <div class="card border-0 shadow-sm mb-3 border-top border-secondary border-3">
            <div class="card-header bg-white border-bottom-0 pt-3 pb-0 d-flex justify-content-between align-items-center">
              <h6 class="fw-bold m-0 text-secondary"><i class="bi bi-clock-history me-2"></i>수강 변동 이력 (타임라인)</h6>
              <button class="btn btn-sm btn-outline-secondary fw-bold rounded-pill border-2" onclick="openScheduleChangeModal('${studentId}', '${studentName}')">
                <i class="bi bi-pencil-square"></i> 시간표 변경
              </button>
            </div>
            <div class="card-body pt-3">${timelineHTML}</div>
          </div>

          <div class="card border-0 shadow-sm mb-3">
            <div class="card-header bg-white border-bottom-0 pt-3 pb-0">
              <h6 class="fw-bold m-0 text-info d-flex justify-content-between">
                <span><i class="bi bi-calendar3 me-2"></i>이번 달 출결 현황</span>
                <small class="text-muted fw-normal" style="font-size:0.7rem;">${new Date().getMonth() + 1}월</small>
              </h6>
            </div>
            <div class="card-body pt-3">
              <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;">
                ${calCells}
              </div>
              <div class="mt-3" style="font-size:0.7rem; color:#64748b;">
                <span class="me-2"><span style="display:inline-block;width:8px;height:8px;background:#22c55e;border-radius:2px;margin-right:2px;"></span>출석</span>
                <span class="me-2"><span style="display:inline-block;width:8px;height:8px;background:#ef4444;border-radius:2px;margin-right:2px;"></span>결석</span>
                <span class="me-2"><span style="display:inline-block;width:8px;height:8px;background:#facc15;border-radius:2px;margin-right:2px;"></span>지각</span>
                <span class="me-2"><span style="display:inline-block;width:8px;height:8px;background:#f97316;border-radius:2px;margin-right:2px;"></span>보강</span>
              </div>
            </div>
          </div>

          <div class="card border-0 shadow-sm mb-3">
            <div class="card-header bg-white border-bottom-0 pt-3 pb-0"><h6 class="fw-bold m-0 text-dark"><i class="bi bi-list-check me-2"></i>최근 출결 내역</h6></div>
            <div class="card-body p-0">
              <table class="table table-sm table-hover m-0" style="font-size:0.75rem;">
                <thead class="bg-light"><tr><th>날짜</th><th>출결</th><th>과제</th><th>진도</th></tr></thead>
                <tbody>${attHTML}</tbody>
              </table>
            </div>
          </div>
        </div>
        
        <div class="col-md-7">
          <div class="card border-0 shadow-sm mb-3 border-top border-primary border-3">
            <div class="card-header bg-white border-bottom-0 pt-3 pb-0"><h6 class="fw-bold m-0 text-primary"><i class="bi bi-book-half me-2"></i>최근 교재 진행률 (숙제 기록 기준)</h6></div>
            <div class="card-body pt-3 pb-1">${bookProgressHTML}</div>
          </div>

          <div class="card border-0 shadow-sm mb-3 border-top border-info border-3">
            <div class="card-header bg-white border-bottom-0 pt-3 pb-0"><h6 class="fw-bold m-0 text-info"><i class="bi bi-graph-up me-2"></i>전체 출결 누적 통계</h6></div>
            <div class="card-body pt-3 pb-1">${statsHTML}</div>
          </div>

          <div class="card border-0 shadow-sm mb-3">
            <div class="card-header bg-white border-bottom-0 pt-3 pb-0">
              <h6 class="fw-bold m-0 text-success"><i class="bi bi-graph-up-arrow me-2"></i>테스트 성적 추이 (100점 환산)</h6>
            </div>
            <div class="card-body pt-2">
              ${chartLabels.length > 0
        ? `<div style="position: relative; height: 160px; width: 100%;"><canvas id="studentScoreChart"></canvas></div>`
        : `<div class="text-muted small text-center py-4 bg-light rounded">테스트 기록이 없습니다.</div>`}
            </div>
          </div>

          <div class="card border-0 shadow-sm mb-3">
            <div class="card-header bg-white border-bottom-0 pt-3 pb-0"><h6 class="fw-bold m-0 text-warning"><i class="bi bi-bar-chart-line-fill me-2"></i>최근 숙제 달성률</h6></div>
            <div class="card-body pt-2 pb-3">${hwStatsHTML}</div>
          </div>
          
          <div class="card border-0 shadow-sm mb-3">
            <div class="card-header bg-white border-bottom-0 pt-3 pb-0">
              <div class="d-flex justify-content-between align-items-center">
                <h6 class="fw-bold m-0 text-secondary"><i class="bi bi-chat-dots-fill me-2"></i>상담 기록 & 요청</h6>
                <button class="btn btn-sm btn-outline-info fw-bold rounded-pill" onclick="openCounselRequestModal('${studentId}', '${studentName}')">
                  <i class="bi bi-plus-circle me-1"></i>상담 요청
                </button>
              </div>
            </div>
            <div class="card-body pt-2 pb-2">
              ${counselRequestHTML}
              ${counselsHTML}
            </div>
          </div>
        </div>
      </div>
    `;

    // 이슈 트래커 결합 및 에러 방어
    let finalHTML = modalHTML;
    if (typeof getIssueTrackerHTML === 'function') {
      finalHTML += getIssueTrackerHTML(studentId);
    }

    document.getElementById('studentProfileBody').innerHTML = finalHTML;

    // 상태 변경 버튼 추가 (원장만)
    const actionsDiv = document.getElementById('studentProfileActions');
    if (actionsDiv && appCache.user.role === '원장') {
      let btnHTML = '';
      if (studentInfo.status === '재원') {
        btnHTML = `
          <button class="btn btn-warning fw-bold text-dark me-2" onclick="markStudentAsPaused('${studentId}', '${studentName}')">
            <i class="bi bi-pause-circle me-1"></i>휴원 처리
          </button>
          <button class="btn btn-danger fw-bold" onclick="markStudentAsWithdrawn('${studentId}', '${studentName}')">
            <i class="bi bi-x-circle me-1"></i>퇴원 처리
          </button>
        `;
      } else if (studentInfo.status === '휴원') {
        btnHTML = `
          <button class="btn btn-success fw-bold me-2" onclick="markStudentAsActive('${studentId}', '${studentName}')">
            <i class="bi bi-arrow-clockwise me-1"></i>복귀 처리
          </button>
          <button class="btn btn-danger fw-bold" onclick="markStudentAsWithdrawn('${studentId}', '${studentName}')">
            <i class="bi bi-x-circle me-1"></i>퇴원 처리
          </button>
        `;
      } else if (studentInfo.status === '퇴원') {
        btnHTML = `
          <button class="btn btn-success fw-bold" onclick="markStudentAsActive('${studentId}', '${studentName}')">
            <i class="bi bi-arrow-clockwise me-1"></i>복귀 처리
          </button>
        `;
      }
      actionsDiv.innerHTML = btnHTML;
    }

    const modalEl = document.getElementById('studentProfileModal');
    if (!modalEl) {
      alert("학생 상세 창(모달)을 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.");
      return;
    }

    let modalObj = bootstrap.Modal.getInstance(modalEl);
    if (!modalObj) {
      modalObj = new bootstrap.Modal(modalEl);
    }
    modalObj.show();

    if (chartLabels.length > 0) {
      setTimeout(() => {
        const ctx = document.getElementById('studentScoreChart');
        if (ctx) {
          new Chart(ctx, {
            type: 'line',
            data: {
              labels: chartLabels,
              datasets: [{
                label: '성취도(%)', data: chartData, borderColor: '#2ecc71', backgroundColor: 'rgba(46, 204, 113, 0.1)',
                borderWidth: 2, pointBackgroundColor: '#e74c3c', pointRadius: 3, fill: true, tension: 0.3
              }]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 } }, plugins: { legend: { display: false } } }
          });
        }
      }, 300);
    }
  } catch (error) {
    console.error("학생 상세 모달 에러:", error);
    alert("상세 정보를 불러오는 중 오류가 발생했습니다.\n에러내용: " + error.message);
  }
};

// =========================================
// 수강 등록 뷰 (신규 학생 등록 + 시간표 배정)
// =========================================
function loadRegisterView() {
  const teachers = (appCache.raw && appCache.raw.teachers) || [];
  const activeTeachers = teachers.filter(t => t[1] && t[4] !== '퇴사').map(t => t[5]);
  let teacherOptions = '<option value="">선택</option>';
  activeTeachers.forEach(tName => {
    teacherOptions += `<option value="${tName}">${tName}</option>`;
  });

  const days = ['월', '화', '수', '목', '금', '토', '일'];
  const todayStr = new Date().toISOString().substring(0, 10);

  let html = `
    <div class="d-flex justify-content-between align-items-center mb-4">
      <h3 class="fw-bold m-0"><i class="bi bi-person-plus-fill text-primary me-2"></i>수강(핀셋) 등록</h3>
      <span class="badge bg-primary-subtle text-primary border border-primary-subtle px-3 py-2 rounded-pill fw-bold">함수 보호 모드</span>
    </div>

    <div class="row g-4">
      <!-- 1. 학생 및 기본 정보 -->
      <div class="col-md-12">
        <div class="card shadow-sm border-0 mb-4">
          <div class="card-header bg-white border-bottom border-primary border-3 pt-4 pb-3">
            <h5 class="fw-bold m-0"><i class="bi bi-person-vcard text-primary me-2"></i>1. 대상 학생 및 수강 정보</h5>
          </div>
          <div class="card-body p-4 bg-light">
            <div class="row g-3">
              <div class="col-md-3">
                <label class="form-label fw-bold small text-muted">학생 선택 <span class="text-danger">*</span></label>
                <input type="text" class="form-control fw-bold border-primary" id="regStudentSelect" list="regStudentList" placeholder="이름을 입력하세요" autocomplete="off">
                <datalist id="regStudentList">
                  ${(appCache.raw.students || []).slice(1).filter(s => s[1]).map(s => {
    const displayStr = s[15] || `${s[1]} (${s[4] || ''}/${s[3] || ''}) - ${s[0]}`;
    return `<option value="${displayStr}">`;
  }).join('')}
                </datalist>
              </div>
              <div class="col-md-2">
                <label class="form-label fw-bold small text-muted">담임 강사</label>
                <select class="form-select" id="regHomeroom">${teacherOptions}</select>
              </div>
              <div class="col-md-2">
                <label class="form-label fw-bold small text-muted">수강 유형</label>
                <select class="form-select" id="regClassType">
                  <option value="정규">정규</option>
                  <option value="내신">내신</option>
                  <option value="특강">특강</option>
                  <option value="단과">단과</option>
                </select>
              </div>
              <div class="col-md-2">
                <label class="form-label fw-bold small text-muted">수강 시작일 <span class="text-danger">*</span></label>
                <input type="date" class="form-control" id="regStartDate" value="${todayStr}">
              </div>
              <div class="col-md-2">
                <label class="form-label fw-bold small text-muted">수강 종료일(예정)</label>
                <input type="date" class="form-control" id="regEndDate">
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. 요일별 시간표 배정 (핀셋 매핑) -->
      <div class="col-md-12">
        <div class="card shadow-sm border-0">
          <div class="card-header bg-white border-bottom border-success border-3 pt-4 pb-3">
            <h5 class="fw-bold m-0"><i class="bi bi-calendar-check text-success me-2"></i>2. 요일별 세부 시간표 배정</h5>
          </div>
          <div class="card-body p-0">
            <div class="table-responsive">
              <table class="table table-hover align-middle mb-0">
                <thead class="bg-light">
                  <tr class="text-center">
                    <th style="width: 80px;">선택</th>
                    <th style="width: 80px;">요일</th>
                    <th>담당 강사 <span class="text-danger">*</span></th>
                    <th>강의실 <span class="text-danger">*</span></th>
                    <th>시작 시간 <span class="text-danger">*</span></th>
                    <th>종료 시간 <span class="text-danger">*</span></th>
                  </tr>
                </thead>
                <tbody>
                  ${days.map(day => `
                    <tr>
                      <td class="text-center">
                        <input type="checkbox" class="form-check-input reg-day-cb" value="${day}" style="width:20px; height:20px;">
                      </td>
                      <td class="text-center fw-bold text-success">${day}요일</td>
                      <td>
                        <select class="form-select form-select-sm" id="teacher_${day}">${teacherOptions}</select>
                      </td>
                      <td>
                        <input type="text" class="form-control form-control-sm" id="room_${day}" placeholder="예: R1">
                      </td>
                      <td>
                        <input type="time" class="form-control form-control-sm" id="start_${day}" value="17:00">
                      </td>
                      <td>
                        <input type="time" class="form-control form-control-sm" id="end_${day}" value="19:00">
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="text-center mt-5 mb-5 border-top pt-4">
      <button class="btn btn-secondary btn-lg rounded-pill px-4 fw-bold me-2" onclick="switchView('STUDENT')">취소</button>
      <button class="btn btn-primary btn-lg rounded-pill px-5 fw-bold shadow-lg" id="btn-submit-reg" onclick="submitRegistration()">
        <i class="bi bi-check-circle-fill me-2"></i> 핀셋 수강 등록 완료
      </button>
    </div>
  `;
  document.getElementById('view-container').innerHTML = html;
}

// 자동 채우기 로직 (새 UI에서는 regStudentSelect와 datalist 연동으로 대체 가능하므로 일단 유지하되 충돌 방지)
window.autoFillStudentInfo = function () {
  const nameInput = document.getElementById('regStudentSelect');
  if (!nameInput) return;
  const val = nameInput.value.trim();
  // ... 생략 또는 필요시 새 필드에 맞게 수정 ...
}

// =================================================================
// 🚀 [고속 통신 & 충돌 방지] 수강 등록 (시간표 중복 배정 완벽 차단)
// =================================================================
window.submitRegistration = async function () {
  try {
    const activeCheckboxes = document.querySelectorAll('.reg-day-cb:checked');
    if (activeCheckboxes.length === 0) return alert('수업 요일을 1개 이상 선택하세요!');
    const selectedStudent = document.getElementById('regStudentSelect').value;

    const sourceStudents = (appCache.raw.students || []).slice(1);
    const targetStudent = sourceStudents.find(s => {
      const displayStr = s[15] || `${s[1]} (${s[4] || ''}/${s[3] || ''}) - ${s[0]}`;
      return displayStr === selectedStudent || s[1] === selectedStudent;
    });

    if (!targetStudent) {
      return alert("목록에 없는 학생입니다! 먼저 원천DB에 등록하세요.");
    }

    let schedules = [];
    let isTeacherMissing = false; let isRoomMissing = false;

    // 💡 [핵심] 기존 시간표와 충돌 검사 로직
    const existingSchedules = window.getActiveSchedules();

    for (const cb of activeCheckboxes) {
      const day = cb.value;
      const teacher = document.getElementById(`teacher_${day}`).value;
      const room = document.getElementById(`room_${day}`).value;
      const newStart = document.getElementById(`start_${day}`).value;
      const newEnd = document.getElementById(`end_${day}`).value;

      if (!teacher) isTeacherMissing = true;
      if (!room) isRoomMissing = true;

      // 🚨 중복 배정 검사 (같은 학생, 같은 요일, 시간이 1분라도 겹치는지 확인)
      const conflict = existingSchedules.find(r => {
        if (r[14] === '비활성') return false; // 비활성된 옛날 수업은 무시

        const sId = r[3] || (r[0] || '').split('(')[0].trim();
        const sName = (r[0] || '').split('(')[0].trim();

        // 현재 등록하려는 학생과 일치하는지 확인
        if (targetStudent[0] !== sId && targetStudent[1] !== sName) return false;

        // 요일이 같은지 확인
        if (r[4] !== day) return false;

        const oldStart = r[6];
        const oldEnd = r[7];
        if (!oldStart || !oldEnd) return false;

        // 시간이 겹치는지 확인 (새 시작시간 < 기존 종료시간 AND 새 종료시간 > 기존 시작시간)
        return (toMins(newStart) < toMins(oldEnd) && toMins(newEnd) > toMins(oldStart));
      });

      if (conflict) {
        return alert(`🚨 [시간표 충돌 오류]\n해당 학생은 ${day}요일 ${newStart}~${newEnd} 시간에 이미 다른 수업(${conflict[9]} 선생님)이 배정되어 있습니다!\n시간을 변경해주세요.`);
      }

      schedules.push({ day: day, start: newStart, end: newEnd, teacherName: teacher, room: room });
    }

    if (isTeacherMissing) return alert('체크한 요일의 담당 강사를 반드시 선택해주세요!');
    if (isRoomMissing) return alert('체크한 요일의 강의실을 반드시 입력해주세요! (예: 본관-R1)');

    const homeroomTeacher = document.getElementById('regHomeroom').value;
    const classType = document.getElementById('regClassType').value;
    const startDate = document.getElementById('regStartDate').value;

    showLoader(true, '수강 등록 및 충돌 검사 중...');

    // A열 읽어서 빈 줄 찾기
    const enrRes = await callSheetsAPI('GET', `/values/${encodeURIComponent(CONFIG.SHEETS.CLASS)}!A:A`);
    const schRes = await callSheetsAPI('GET', `/values/${encodeURIComponent(CONFIG.SHEETS.SCHEDULE)}!A:A`);

    let enrVals = Array.isArray(enrRes) ? enrRes : (enrRes.values || []);
    let enrRow = enrVals.findIndex((r, i) => i > 0 && (!r || !r[0] || r[0].toString().trim() === "")) + 1;
    if (enrRow === 0) enrRow = enrVals.length + 1;
    if (enrRow < 3) enrRow = Math.max(enrVals.length + 1, 3);

    let schVals = Array.isArray(schRes) ? schRes : (schRes.values || []);
    let schRow = schVals.findIndex((r, i) => i > 0 && (!r || !r[0] || r[0].toString().trim() === "")) + 1;
    if (schRow === 0) schRow = schVals.length + 1;
    if (schRow < 3) schRow = Math.max(schVals.length + 1, 3);

    const batchData = [];
    batchData.push({ range: `${CONFIG.SHEETS.CLASS}!A${enrRow}`, values: [[selectedStudent]] });
    batchData.push({ range: `${CONFIG.SHEETS.CLASS}!D${enrRow}:F${enrRow}`, values: [[homeroomTeacher, classType, startDate]] });
    batchData.push({ range: `${CONFIG.SHEETS.CLASS}!H${enrRow}`, values: [["재원"]] });

    schedules.forEach(sched => {
      batchData.push({ range: `${CONFIG.SHEETS.SCHEDULE}!A${schRow}`, values: [[selectedStudent]] });
      batchData.push({ range: `${CONFIG.SHEETS.SCHEDULE}!E${schRow}`, values: [[sched.day]] });
      batchData.push({ range: `${CONFIG.SHEETS.SCHEDULE}!G${schRow}:H${schRow}`, values: [[sched.start, sched.end]] });
      batchData.push({ range: `${CONFIG.SHEETS.SCHEDULE}!J${schRow}`, values: [[sched.teacherName]] });
      batchData.push({ range: `${CONFIG.SHEETS.SCHEDULE}!L${schRow}`, values: [[sched.room]] });
      batchData.push({ range: `${CONFIG.SHEETS.SCHEDULE}!O${schRow}`, values: [["활성"]] });
      schRow++;
    });

    const body = { valueInputOption: "USER_ENTERED", data: batchData };
    await callSheetsAPI('POST', `/values:batchUpdate`, body);

    showLoader(false);
    alert('🎉 충돌 없음! 수강 등록이 안전하게 완료되었습니다.');

    if (appCache) appCache.schedule = null;
    if (typeof switchView === 'function') switchView('SCHEDULE');

  } catch (e) {
    showLoader(false);
    alert("등록 중 오류 발생: " + e.message);
    console.error(e);
  }
};


// =========================================
// 🚀 상담 기록 뷰 (실시간 검색창 탑재)
// =========================================
window.loadCounselView = function () {
  if (!appCache.raw || !appCache.raw.counsels) {
    document.getElementById('view-container').innerHTML = '<p>데이터를 불러올 수 없습니다.</p>'; return;
  }
  const counsels = appCache.raw.counsels;
  let cList = [];
  const myName = appCache.user.name;
  const isManager = (appCache.user.role === '원장');

  for (let i = counsels.length - 1; i >= 1; i--) {
    const r = counsels[i]; if (!r[0]) continue;
    const counselTeacher = (r[6] || '').split('(')[0].trim();
    if (!isManager && counselTeacher !== myName) continue;
    cList.push({ date: r[4] ? r[4].substring(0, 10) : (r[0] ? r[0].substring(0, 10) : '-'), student: r[1], schoolInfo: r[3], type: r[5], teacher: r[6], target: r[7], memo: r[8] });
  }

  let html = `
    <div class="d-flex justify-content-between align-items-center mb-4">
      <h3 class="fw-bold m-0"><i class="bi bi-chat-dots text-info me-2"></i>상담 기록</h3>
      <div class="d-flex gap-2">
        <input type="text" id="counselSearchInput" class="form-control form-control-sm border-info rounded-pill px-3 shadow-sm" placeholder="🔍 학생명 검색..." style="width: 140px;" onkeyup="filterTableRows('counselSearchInput', 'counselTable', 1)">
        <button class="btn btn-outline-info btn-sm fw-bold rounded-pill border-2" onclick="refreshCounselData()"><i class="bi bi-arrow-clockwise"></i></button>
        <button class="btn btn-info btn-sm fw-bold rounded-pill text-white text-nowrap" onclick="openCounselModal()"><i class="bi bi-pencil-square"></i> 새 등록</button>
      </div>
    </div>
    
    <div class="card border-0 shadow-sm p-4 border-top border-info border-4">
      <div class="table-responsive" style="max-height: 600px;">
        <table class="table table-hover align-middle table-sm" id="counselTable">
          <thead class="bg-light sticky-top"><tr><th style="width: 110px;">상담일자</th><th style="width: 100px;">학생명</th><th style="width: 120px;">학교명구분</th><th style="width: 150px;">상담유형</th><th style="width: 80px;">담당자</th><th>상담내용 (기타사항)</th></tr></thead>
          <tbody>
  `;
  if (cList.length === 0) html += `<tr><td colspan="6" class="text-center py-5 text-muted">등록된 상담 기록이 없습니다.</td></tr>`;
  else {
    cList.forEach(c => {
      let typeBadge = 'bg-secondary';
      if (c.type === '신규상담') typeBadge = 'bg-primary'; else if (c.type === '정기 상담') typeBadge = 'bg-success'; else if (c.type === '학부모 전화 상담 요청') typeBadge = 'bg-info text-dark border border-info'; else if (c.type === '대면상담') typeBadge = 'bg-warning text-dark'; else if (c.type === '퇴원상담') typeBadge = 'bg-danger';
      html += `<tr><td><span class="text-muted fw-bold small"><i class="bi bi-calendar"></i> ${c.date}</span></td><td class="fw-bold">${c.student} <span class="badge bg-light text-dark fw-normal border ms-1" style="font-size: 0.65rem;">${c.target || '모름'}</span></td><td class="text-muted small">${c.schoolInfo || '-'}</td><td><span class="badge ${typeBadge} rounded-pill px-2">${c.type || '-'}</span></td><td>${c.teacher || '-'}</td><td style="white-space: pre-wrap; font-size: 0.85rem;" class="text-dark">${c.memo || ''}</td></tr>`;
    });
  }
  html += `</tbody></table></div></div>`;
  document.getElementById('view-container').innerHTML = html;
};

// 상담유형에 따른 화면 토글
window.toggleCounselType = function () {
  const type = document.getElementById('c-type').value;
  const existWrap = document.getElementById('c-existing-wrap');
  const newWrap = document.getElementById('c-new-wrap');
  if (type === '신규상담') {
    existWrap.classList.add('d-none');
    newWrap.classList.remove('d-none');
  } else {
    existWrap.classList.remove('d-none');
    newWrap.classList.add('d-none');
  }
};

// 새 상담 모달 열기
window.openCounselModal = function () {
  let existing = document.getElementById('counselModal');
  if (existing) existing.remove();

  let studentOptions = '';
  if (appCache.raw && appCache.raw.students) {
    let sorted = [];
    for (let i = 1; i < appCache.raw.students.length; i++) {
      if (appCache.raw.students[i][0]) sorted.push({ id: appCache.raw.students[i][0], name: appCache.raw.students[i][1], school: appCache.raw.students[i][3], grade: appCache.raw.students[i][4] });
    }
    sorted.sort((a, b) => a.name.localeCompare(b.name)).forEach(s => {
      studentOptions += `<option value="${s.name} (${s.school}/${s.grade})" data-id="${s.id}"></option>`;
    });
  }

  const modalHtml = `
  <div class="modal fade" id="counselModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content border-0 shadow-lg">
        <div class="modal-header bg-info text-white">
          <h5 class="modal-title fw-bold"><i class="bi bi-chat-dots-fill"></i> 상담 기록 등록</h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body p-4 bg-light">
          <div class="row g-3">
            <div class="col-6">
              <label class="form-label fw-bold small text-muted">상담 유형 <span class="text-danger">*</span></label>
              <select id="c-type" class="form-select border-info" onchange="toggleCounselType()">
                <option value="정기 상담" selected>정기 상담</option>
                <option value="신규상담">신규상담</option>
                <option value="학부모 전화 상담 요청">학부모 전화 상담</option>
                <option value="대면상담">대면상담</option>
                <option value="퇴원상담">퇴원상담</option>
                <option value="기타">기타</option>
              </select>
            </div>
            <div class="col-6">
              <label class="form-label fw-bold small text-muted">상담 대상</label>
              <select id="c-target" class="form-select">
                <option value="학부모">학부모</option>
                <option value="학생">학생</option>
              </select>
            </div>

            <div class="col-12" id="c-existing-wrap">
              <label class="form-label fw-bold small text-muted">학생 검색 <span class="text-danger">*</span></label>
              <input type="text" id="c-studentInput" class="form-control fw-bold border-info" list="c-studentList" placeholder="이름 검색 후 반드시 목록에서 클릭하세요" autocomplete="off" onchange="document.getElementById('c-studentId').value = this.list.querySelector('option[value=\\''+this.value+'\\']')?.dataset.id || ''">
              <datalist id="c-studentList">${studentOptions}</datalist>
              <input type="hidden" id="c-studentId">
            </div>

            <div class="col-12 d-none" id="c-new-wrap">
              <div class="row g-2">
                <div class="col-6">
                  <label class="form-label fw-bold small text-muted">신규 학생 이름 <span class="text-danger">*</span></label>
                  <input type="text" id="c-newName" class="form-control border-info" placeholder="홍길동">
                </div>
                <div class="col-6">
                  <label class="form-label fw-bold small text-muted">연락처</label>
                  <input type="text" id="c-newPhone" class="form-control" placeholder="010-0000-0000">
                </div>
              </div>
            </div>

            <div class="col-12">
              <label class="form-label fw-bold small text-muted">상담 내용 (상세히) <span class="text-danger">*</span></label>
              <textarea id="c-memo" class="form-control" rows="6" placeholder="상담 내용을 입력하세요."></textarea>
            </div>
          </div>
        </div>
        <div class="modal-footer bg-white">
          <button class="btn btn-secondary rounded-pill fw-bold" data-bs-dismiss="modal">취소</button>
          <button class="btn btn-info text-white rounded-pill fw-bold px-4 shadow-sm" onclick="saveCounsel()"><i class="bi bi-check-circle-fill me-1"></i> 저장하기</button>
        </div>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  new bootstrap.Modal(document.getElementById('counselModal')).show();
};

// =================================================================
// 🚀 [고속 통신] 상담 기록 5G 저장 (IME 버그 방어 + 밀림 현상 완벽 차단)
// =================================================================
window.saveCounsel = async function () {
  const type = document.getElementById('c-type') ? document.getElementById('c-type').value : (document.getElementById('counsel-type')?.value || '기타');
  const target = document.getElementById('c-target') ? document.getElementById('c-target').value : (document.getElementById('counsel-target')?.value || '기타');
  const memo = document.getElementById('c-memo') ? document.getElementById('c-memo').value.trim() : (document.getElementById('counsel-content')?.value.trim() || '');

  let name = ''; let studentId = ''; let schoolInfo = ''; let contact = '';
  let date = document.getElementById('counsel-date') ? document.getElementById('counsel-date').value : new Date().toISOString().substring(0, 10);
  let teacher = document.getElementById('counsel-teacher') ? document.getElementById('counsel-teacher').value.trim() : appCache.user.name;

  if (type === '신규상담' && document.getElementById('c-newName') && !document.getElementById('c-newName').classList.contains('d-none')) {
    name = document.getElementById('c-newName').value.trim();
    contact = document.getElementById('c-newPhone').value.trim();
    if (!name) return alert("신규 학생의 이름을 입력해주세요.");
    if (contact) schoolInfo = `[연락처: ${contact}]`;
  } else {
    const idInput = document.getElementById('c-studentId') || document.getElementById('counsel-student-id');
    const searchInput = document.getElementById('c-studentInput') || document.getElementById('counsel-student-search');
    studentId = idInput ? idInput.value : '';
    let inputVal = searchInput ? searchInput.value.trim() : '';

    // 💡 [버그 픽스 1] 한글 자동완성 클릭 시 맨 뒤에 글자가 하나 더 붙는 현상 방어!
    if (!studentId && inputVal) {
      const options = document.getElementById('c-studentList')?.options || [];
      const namePartOnly = inputVal.split('(')[0].trim();

      for (let i = 0; i < options.length; i++) {
        if (options[i].value === inputVal || inputVal.startsWith(options[i].value) || options[i].value.startsWith(namePartOnly + " (")) {
          studentId = options[i].dataset.id;
          if (idInput) idInput.value = studentId;
          if (searchInput) {
            searchInput.value = options[i].value;
            inputVal = options[i].value;
          }
          break;
        }
      }
    }

    if (!studentId || !inputVal) return alert("학생을 검색하고 목록에서 반드시 선택해주세요.\n(이름을 입력 후 나타나는 드롭다운을 클릭해주세요)");
    name = inputVal.split(' (')[0];
    schoolInfo = inputVal.includes('(') ? inputVal.substring(inputVal.indexOf('(') + 1, inputVal.indexOf(')')) : (document.getElementById('counsel-student-school')?.value || '');
  }

  if (!memo) return alert("상담 내용을 입력해주세요.");

  showLoader(true, "상담 기록 저장 중...");

  try {
    const timestamp = new Date().toLocaleString('ko-KR');
    // A:일자, B:학생명, C:학생ID, D:학교/학년, E:상담일자, F:상담유형, G:담당자, H:상담대상, I:상담내용
    const rowData = [timestamp, name, studentId, schoolInfo, date, type, teacher, target, memo];
    const sheetName = (typeof CONFIG !== 'undefined' && CONFIG.SHEETS && CONFIG.SHEETS.COUNSEL) ? CONFIG.SHEETS.COUNSEL : '상담일지';

    // 💡 [버그 픽스 2] 구글 시트 맘대로 E열부터 저장되는 현상 방지 (A~I 구역 강제 핀셋 저장)
    const res = await callSheetsAPI('GET', `/values/${encodeURIComponent(sheetName + '!A:I')}`);
    const existRows = res.values || [];
    const nextRow = existRows.length + 1; // 빈 줄 찾기

    await callSheetsAPI('PUT', `/values/${encodeURIComponent(sheetName + '!A' + nextRow + ':I' + nextRow)}?valueInputOption=USER_ENTERED`, { values: [rowData] });

    showLoader(false);
    alert("✅ 상담일지가 1초 만에 등록되었습니다!");

    const modalEl = document.getElementById('counselModal');
    if (modalEl) {
      let modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();
    }

    if (typeof refreshCounselData === 'function') {
      await refreshCounselData();
    } else {
      forceRefresh();
    }
  } catch (error) {
    showLoader(false);
    alert("상담 저장 실패: " + error.message);
  }
};

// =========================================
// 강사 근태(출퇴근) 관리 화면
// =========================================
function loadTeacherAttView() {
  const tattRecords = appCache.raw.tatt || [];

  // 내 이번달 출퇴근 기록만 필터링 (원장님이더라도 본인 기록만 보는게 기본)
  // 타임스탬프 기준으로 정렬 (최신순)
  const currentMonth = new Date().toISOString().substring(0, 7); // 예: '2026-03'

  let myRecords = tattRecords.filter(r => {
    return r[1] === appCache.user.name && (r[2] || '').startsWith(currentMonth);
  });

  // 역순 정렬 (최신 기록이 위로)
  myRecords = myRecords.reverse();

  let html = `
    <div class="d-flex justify-content-between align-items-center mb-4">
      <h3 class="fw-bold m-0"><i class="bi bi-clock-history text-primary me-2"></i>출퇴근 관리</h3>
      <div>
        <span class="badge bg-light text-dark border me-2 fs-6">${currentMonth}</span>
        <button class="btn btn-sm btn-outline-secondary rounded-pill" onclick="refreshTeacherAttData()">
          <i class="bi bi-arrow-clockwise"></i> 새로고침
        </button>
      </div>
    </div>
    
    <div class="row g-3 mb-4">
      <div class="col-6">
        <button class="btn btn-primary w-100 py-4 shadow-sm rounded-4 fw-bold fs-5" id="btn-checkin" onclick="recordTeacherAtt('출근')">
          <i class="bi bi-box-arrow-in-right mb-2 d-block fs-1"></i>
          출근하기
        </button>
      </div>
      <div class="col-6">
        <button class="btn btn-danger w-100 py-4 shadow-sm rounded-4 fw-bold fs-5" id="btn-checkout" onclick="recordTeacherAtt('퇴근')">
          <i class="bi bi-box-arrow-right mb-2 d-block fs-1"></i>
          퇴근하기
        </button>
      </div>
    </div>

    <div class="card shadow-sm border-0 mt-4">
      <div class="card-header bg-white border-0 pt-4 pb-0">
        <h6 class="fw-bold m-0"><i class="bi bi-list-check me-2 text-muted"></i>내 이번 달 기록</h6>
      </div>
      <div class="card-body p-0">
        <div class="table-responsive">
          <table class="table table-hover align-middle m-0">
            <thead class="table-light">
              <tr>
                <th class="ps-4">일자</th>
                <th>시간</th>
                <th>구분</th>
              </tr>
            </thead>
            <tbody>
  `;

  if (myRecords.length === 0) {
    html += `<tr><td colspan="3" class="text-center py-5 text-muted">이번 달 출퇴근 기록이 없습니다.</td></tr>`;
  } else {
    myRecords.forEach(r => {
      // r[0]: 타임스탬프, r[1]: 이름, r[2]: 날짜, r[3]: 시간, r[4]: 출근/퇴근
      const date = r[2] || '-';
      const time = r[3] || '-';
      const type = r[4] || '-';

      const typeBadge = type === '출근' ? 'bg-primary' : (type === '퇴근' ? 'bg-danger' : 'bg-secondary');

      html += `
        <tr>
          <td class="ps-4 fw-bold text-muted">${date}</td>
          <td class="fw-bold fs-5">${time}</td>
          <td><span class="badge ${typeBadge} rounded-pill px-3 py-2">${type}</span></td>
        </tr>
      `;
    });
  }

  html += `
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.getElementById('view-container').innerHTML = html;
}

// =================================================================
// 🚀 [고속 통신] 강사 근태(출퇴근) 기록 5G 저장
// =================================================================
window.recordTeacherAtt = async function (type) {
  if (!confirm(`지금 시간으로 [${type}] 처리하시겠습니까?`)) return;

  const btnId = type === '출근' ? 'btn-checkin' : 'btn-checkout';
  const btn = document.getElementById(btnId);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 처리중...';
  }

  const now = new Date();
  const timestamp = now.toLocaleString('ko-KR');
  const dateStr = now.toISOString().substring(0, 10);
  const timeStr = now.toTimeString().substring(0, 5);

  try {
    const rowData = [timestamp, appCache.user.name, dateStr, timeStr, type];
    const body = { values: [rowData] };
    const sheetName = (typeof CONFIG !== 'undefined' && CONFIG.SHEETS && CONFIG.SHEETS.TATT) ? CONFIG.SHEETS.TATT : '강사근태';

    await callSheetsAPI('POST', `/values/${encodeURIComponent(sheetName)}:append?valueInputOption=USER_ENTERED`, body);

    alert(`⏰ ${type} 처리가 완료되었습니다!`);

    if (typeof refreshTeacherAttData === 'function') {
      await refreshTeacherAttData();
    } else {
      forceRefresh();
    }
  } catch (err) {
    alert(`${type} 기록 실패: ` + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = type === '출근' ? '<i class="bi bi-box-arrow-in-right mb-2 d-block fs-1"></i>출근하기' : '<i class="bi bi-box-arrow-right mb-2 d-block fs-1"></i>퇴근하기';
    }
  }
};

// =================================================================
// 🚀 출석 모달창 열기 & 실시간 미리보기 토글 기능 통합본
// =================================================================

// 💡 1. 토글(접기/펴기) 기능
window.isPreviewOpen = true; // 기본적으로 열려있게 설정

window.toggleLivePreview = function () {
  const panel = document.getElementById('livePreviewPanel');
  const btn = document.getElementById('previewToggleBtn');
  if (!panel || !btn) return;

  window.isPreviewOpen = !window.isPreviewOpen;

  if (window.isPreviewOpen) {
    panel.style.display = 'block';
    setTimeout(() => panel.style.opacity = '1', 10);
    btn.style.display = 'none';
  } else {
    panel.style.opacity = '0';
    setTimeout(() => panel.style.display = 'none', 200);
    btn.style.display = 'block';
  }
};

// =================================================================
// 🚀 알림톡 텍스트 완성 (공통 진도를 '종합안내' 바로 위로 자연스럽게 이동)
// =================================================================
window.generateAlimtalkText = function (idx) {
  const row = document.getElementById(`student-section-${idx}`);
  if (!row) return '';

  const sName = row.getAttribute('data-name') || '';
  const teacher = currentEventForModal ? currentEventForModal.teacherId : appCache.user.name;
  const dateObj = new Date(document.getElementById('checkDate').value || new Date());
  const dateStr = `${dateObj.getMonth() + 1}월 ${dateObj.getDate()}일`;

  const attRadio = document.querySelector(`input[name="att_${idx}"]:checked`);
  const att = attRadio ? attRadio.value : '';
  const hwRadio = document.querySelector(`input[name="hw_${idx}"]:checked`);
  const hwStatus = hwRadio ? hwRadio.value : '미입력';

  const getVal = (id) => document.getElementById(id + '_' + idx)?.value || '';

  // 상단 공통 진도 가져오기
  const commonProgress = document.getElementById('classProgress') ? document.getElementById('classProgress').value.trim() : '';

  let progLines = [];
  // 💡 [수정] 공통 진도를 진도칸(progLines)에서 뺐습니다. 오직 개별 진도만 들어갑니다.
  if (getVal('pB1') || getVal('pR1')) progLines.push((getVal('pB1') ? `[${getVal('pB1')}] ` : '') + getVal('pR1'));
  if (getVal('pB2') || getVal('pR2')) progLines.push((getVal('pB2') ? `[${getVal('pB2')}] ` : '') + getVal('pR2'));
  if (getVal('pB3') || getVal('pR3')) progLines.push((getVal('pB3') ? `[${getVal('pB3')}] ` : '') + getVal('pR3'));
  const prog = progLines.join('\n');

  let hwLines = [];
  if (getVal('hwB1') || getVal('hwR1')) hwLines.push((getVal('hwB1') ? `[${getVal('hwB1')}] ` : '') + getVal('hwR1'));
  if (getVal('hwB2') || getVal('hwR2')) hwLines.push((getVal('hwB2') ? `[${getVal('hwB2')}] ` : '') + getVal('hwR2'));
  if (getVal('hwB3') || getVal('hwR3')) hwLines.push((getVal('hwB3') ? `[${getVal('hwB3')}] ` : '') + getVal('hwR3'));
  const hwStr = hwLines.join('\n');

  if (att === '결석') {
    return `[${sName} 결석 안내]\n금일 수업에 ${sName} 학생이 참석하지 않았습니다.\n결석 사유: ${getVal('memo') || '미기재'}`;
  }

  // 💡 [핵심 수정] 공통 진도를 '종합안내(memo)' 내용과 위아래로 자연스럽게 합칩니다!
  let combinedMemo = '';
  if (commonProgress) combinedMemo += commonProgress + '\n';
  if (getVal('memo')) combinedMemo += getVal('memo');
  combinedMemo = combinedMemo.trim(); // 혹시 모를 앞뒤 공백 제거

  const templateIdx = document.getElementById(`template_${idx}`)?.value;
  let text = '';
  const firstName = sName.length >= 3 ? sName.substring(1) : sName;
  const isBatchim = (firstName.charCodeAt(firstName.length - 1) - 0xAC00) % 28 > 0;
  const nameYi = isBatchim ? `${firstName}이` : firstName;

  if (templateIdx !== undefined && templateIdx !== '' && appCache.templates[templateIdx]) {
    text = appCache.templates[templateIdx].content;
    text = text.replace(/\{학생이름\}/g, nameYi);
    text = text.replace(/\{강사이름\}/g, teacher);
    text = text.replace(/\{날짜\}/g, dateStr);
    text = text.replace(/\{오늘진도\}/g, prog ? prog.replace(/\n/g, ', ') : '없음');
    text = text.replace(/\{다음과제\}/g, hwStr ? hwStr.replace(/\n/g, ', ') : '없음');
    text = text.replace(/\{테스트종류\}/g, getVal('t1Type') || '일일');
    text = text.replace(/\{맞은개수\}/g, getVal('t1Cor') || '-');
    text = text.replace(/\{전체개수\}/g, getVal('t1Tot') || '-');
    text = text.replace(/\{개별학습\}/g, getVal('indivLearning') || '');
    text = text.replace(/\{과제피드백\}/g, getVal('hwFeedback') || '');
    // 💡 템플릿의 {종합안내} 위치에 공통진도+메모 합친 내용을 투입!
    text = text.replace(/\{종합안내\}/g, combinedMemo);
    text = text.replace(/\{새교재\}/g, getVal('newBook') ? `${getVal('newBook')} (${getVal('bookFee') || '0'}원)` : '');
    text = text.replace(/\{칭찬\}/g, getVal('praise') || '');
    text = text.replace(/\{노력\}/g, getVal('effort') || '');
    text = text.replace(/\{부모님께\}/g, getVal('parentsNote') || '');
    text = text.replace(/\{행사안내\}/g, getVal('eventNotice') || '');
    text = text.replace(/\{테스트피드백\}/g, getVal('testFeedback') || '');
  } else {
    // 기본 추천 템플릿
    const nameYiNeun = isBatchim ? `${firstName}이는` : `${firstName}는`;
    text = `안녕하세요. 수학의 힘 💙${nameYi} 담임 ${teacher}입니다.🥰\n${dateStr} 수업내용 및 안내사항입니다.\n\n`;

    let t1Str = (getVal('t1Tot') || getVal('t1Cor')) ? `${getVal('t1Type') || '일일'} 테스트 ${getVal('t1Tot') || '0'}문제 중 ${getVal('t1Cor') || '0'}문제` : '';
    let t2Str = (getVal('t2Tot') || getVal('t2Cor')) ? `${getVal('t2Type') && getVal('t2Type') !== getVal('t1Type') ? getVal('t2Type') : '추가'} 테스트 ${getVal('t2Tot') || '0'}문제 중 ${getVal('t2Cor') || '0'}문제` : '';

    const testFb = getVal('testFeedback') ? ` ${getVal('testFeedback')}` : '';

    if (t1Str && t2Str) text += `💙우리 ${nameYiNeun} ${t1Str}, ${t2Str}를 맞혔습니다.😊${testFb}\n\n`;
    else if (t1Str) text += `💙우리 ${nameYiNeun} ${t1Str}를 맞혔습니다.😊${testFb}\n\n`;
    else if (t2Str) text += `💙우리 ${nameYiNeun} ${t2Str}를 맞혔습니다.😊${testFb}\n\n`;

    let comments = [];
    if (commonProgress) comments.push(commonProgress); // 💡 종합안내(memo) 바로 위에 공통진도 문장 추가
    if (getVal('indivLearning')) comments.push(getVal('indivLearning'));
    if (getVal('memo')) comments.push(getVal('memo'));
    if (comments.length > 0) text += `${comments.join('\n')}\n\n`;

    if (getVal('newBook')) text += `📚 새 교재 알림\n${getVal('newBook').includes('지급)') ? getVal('newBook') : `${getVal('newBook')} (${dateStr.replace('월 ', '/').replace('일', '')} 지급)`} / ${getVal('bookFee') || '0'}원\n\n`;

    if (prog) text += `📖 진도\n${prog}\n\n`;
    if (hwStr) {
      text += `📝 숙제 (${hwStatus})\n${hwStr}\n`;
      if (getVal('hwFeedback')) text += `👉 과제 피드백: ${getVal('hwFeedback')}\n`;
      text += `\n`;
    }

    if (t1Str) text += `👉 ${getVal('t1Type') || '일일'} 테스트 결과\n${getVal('t1Cor') || '0'}문제 / ${getVal('t1Tot') || '0'}문제\n\n`;
    if (t2Str) text += `👉 ${getVal('t2Type') && getVal('t2Type') !== getVal('t1Type') ? getVal('t2Type') : '추가'} 테스트 결과\n${getVal('t2Cor') || '0'}문제 / ${getVal('t2Tot') || '0'}문제\n\n`;

    if (getVal('praise')) text += `👍 칭찬할 점\n${getVal('praise')}\n\n`;
    if (getVal('effort')) text += `💪 노력할 점\n${getVal('effort')}\n\n`;
    if (getVal('parentsNote')) text += `📢 부모님 드리는 말씀\n${getVal('parentsNote')}\n\n`;
    if (getVal('eventNotice')) text += `🎉 행사 안내\n${getVal('eventNotice')}\n\n`;

    text += `🌈 아이들의 수학 실력 향상에 최선을 다하는 수학의 힘이 되겠습니다.🥰`;
  }
  return text;
};

window.updateLivePreview = function (idx) {
  const panel = document.getElementById('livePreviewPanel');
  const btn = document.getElementById('previewToggleBtn');
  if (!panel || !btn) return;
  const text = window.generateAlimtalkText(idx);
  if (!text) return;
  document.getElementById('livePreviewContent').textContent = text;
  if (window.isPreviewOpen !== false) {
    panel.style.display = 'block';
    panel.style.opacity = '1';
    btn.style.display = 'none';
  }
};

// =================================================================
// 🚀 출결 모달창 열기 (코어 엔진 탑재 - 딜레이 제거)
// =================================================================
window.openAttendanceModal = function (eventId) {
  currentEventForModal = allEvents.find(e => e.id === eventId);
  if (!currentEventForModal) return;

  let modalEl = document.getElementById('attendanceModal');
  if (!modalEl) return console.error("attendanceModal을 찾을 수 없습니다.");

  const openDateStr = currentEventForModal.date || new Date().toISOString().substring(0, 10);
  document.getElementById('checkDate').value = openDateStr;
  if (document.getElementById('classProgress')) document.getElementById('classProgress').value = currentEventForModal.commonProgress || "";
  document.getElementById('modalClassInfo').innerText = `${currentEventForModal.day}요일 ${currentEventForModal.timeStr}`;

  const globalBookListEl = document.getElementById('globalBookList');
  if (globalBookListEl) {
    const books = (appCache.raw && appCache.raw.books) || [];
    globalBookListEl.innerHTML = books.map(b => `<option value="${b[0] || ''}">`).join('');
  }

  let listHtml = '';
  let navHtml = '';

  (currentEventForModal.students || []).forEach((s, idx) => {
    let rawBadge = s.badge || "이름없음";
    let rec = s.record || {};

    let pastRecord = null;
    const attArr = appCache.raw.attendance || [];
    for (let i = attArr.length - 1; i >= 1; i--) {
      const a = attArr[i];
      if ((a[1] === s.id || a[2] === s.name) && a[5] !== undefined && (a[3] || '').substring(0, 10) < openDateStr) {
        pastRecord = a;
        break;
      }
    }

    function getVal(key) { return rec[key] || ''; }
    function getPh(index, defaultTxt) { return (pastRecord && pastRecord[index]) ? `(이전) ${pastRecord[index]}` : defaultTxt; }

    // 💡 [수정] || 쓰레기값을 걸러내고 깔끔하게 (이전) 표시만 띄워줍니다.
    let pastPR = (pastRecord && pastRecord[8]) ? pastRecord[8].replace(/\(이전\)\s*/g, '').split('|') : [];
    let pastHwR = (pastRecord && pastRecord[10]) ? pastRecord[10].replace(/\(이전\)\s*/g, '').split('|') : [];

    function getPhVal(arr, arrIdx, defaultTxt) {
      if (arr && arr[arrIdx]) {
        let val = arr[arrIdx].trim();
        if (val && val !== '|' && val !== '||') return `(이전) ${val}`;
      }
      return defaultTxt;
    }

    let isAtt = rec.att === '출석' ? 'checked' : '';
    let isLate = rec.att === '지각' ? 'checked' : '';
    let isAbs = rec.att === '결석' ? 'checked' : '';
    let isHwO = rec.hw === '완료' ? 'checked' : '';
    let isHwM = rec.hw === '미흡' ? 'checked' : '';
    let isHwX = rec.hw === '미제출' ? 'checked' : '';

    let pB = (rec.pBook || (pastRecord ? pastRecord[7] : '') || "").split('|');
    let hwB = (rec.hwBook || (pastRecord ? pastRecord[9] : '') || "").split('|');
    let pR = getVal('pRange').split('|');
    let hwR = getVal('hwRange').split('|');

    let t1Type = rec.t1Type || '일일'; let t1Cor = getVal('t1Cor'); let t1Tot = getVal('t1Tot'); let t1TotPh = getPh(13, '총문항');
    let t2Type = rec.t2Type || '일일'; let t2Cor = getVal('t2Cor'); let t2Tot = getVal('t2Tot'); let t2TotPh = getPh(16, '총문항');

    let color = s.level === '보강' ? 'bg-warning text-dark border-warning' : (s.level === '고' ? 'bg-danger text-white' : (s.level === '중' ? 'bg-primary text-white' : 'bg-success text-white'));
    let displayNameHtml = `<span class="badge ${color} me-2">${s.level}</span>${rawBadge}`;

    navHtml += `<a href="#student-section-${idx}" class="list-group-item list-group-item-action py-3 ${idx === 0 ? 'active' : ''}"><span class="badge ${color} me-1">${s.level}</span> <span class="fw-bold">${rawBadge}</span></a>`;

    const savedTemplate = localStorage.getItem(`template_${openDateStr}_${s.id}`) || '';
    let templateOptions = `<option value="" ${savedTemplate === '' ? 'selected' : ''}>💙 기본 템플릿 (추천)</option>`;
    if (appCache.templates && appCache.templates.length > 0) {
      appCache.templates.forEach((t, tIdx) => {
        templateOptions += `<option value="${tIdx}" ${savedTemplate === String(tIdx) ? 'selected' : ''}>[시트] ${t.title}</option>`;
      });
    }

    listHtml += `
        <div id="student-section-${idx}" class="p-4 mb-4 bg-white border rounded shadow-sm student-row" data-id="${s.id}" data-name="${s.name}" data-rawbadge="${rawBadge}">
            <div class="row align-items-center mb-3 pb-3 border-bottom">
                <div class="col-md-3 fs-5 fw-bold text-dark d-flex flex-column align-items-start justify-content-center">
                    <div class="d-flex align-items-center mb-2">${displayNameHtml}</div>
                    <div class="d-flex gap-1 w-100 mb-2">
                        <button type="button" class="btn btn-sm btn-outline-warning fw-bold flex-fill" style="font-size: 0.65rem;" onclick="saveAttendance('임시저장', false, ${idx})">임시저장 💾</button>
                        <button type="button" class="btn btn-sm btn-outline-primary fw-bold flex-fill" style="font-size: 0.65rem;" onclick="saveAttendance('최종제출', false, ${idx})">최종제출 🚀</button>
                    </div>
                    <div class="d-flex gap-1 w-100">
                        <select class="form-select form-select-sm border-info fw-bold text-info flex-grow-1" id="template_${idx}" onchange="if(window.updateLivePreview) window.updateLivePreview('${idx}')" style="font-size: 0.75rem;">
                            ${templateOptions}
                        </select>
                        <button type="button" class="btn btn-sm btn-outline-info" onclick="editSelectedTemplate('${idx}')" title="선택한 템플릿 수정"><i class="bi bi-gear-fill"></i></button>
                    </div>
                </div>
                <div class="col-md-4">
                    <label class="small fw-bold text-secondary mb-1">출결 상태</label>
                    <div class="btn-group w-100" role="group">
                        <input type="radio" class="btn-check" name="att_${idx}" id="att_o_${idx}" value="출석" ${isAtt} onchange="onAttChange(this)">
                        <label class="btn btn-outline-success btn-sm" for="att_o_${idx}">출석</label>
                        <input type="radio" class="btn-check" name="att_${idx}" id="att_l_${idx}" value="지각" ${isLate} onchange="onAttChange(this)">
                        <label class="btn btn-outline-warning btn-sm" for="att_l_${idx}">지각</label>
                        <input type="radio" class="btn-check" name="att_${idx}" id="att_x_${idx}" value="결석" ${isAbs} onchange="onAttChange(this)">
                        <label class="btn btn-outline-danger btn-sm" for="att_x_${idx}">결석</label>
                    </div>
                </div>
                <div class="col-md-5">
                    <label class="small fw-bold text-secondary mb-1">과제 수행</label>
                    <div class="btn-group w-100" role="group">
                        <input type="radio" class="btn-check" name="hw_${idx}" id="hw_o_${idx}" value="완료" ${isHwO}>
                        <label class="btn btn-outline-primary btn-sm" for="hw_o_${idx}">완료</label>
                        <input type="radio" class="btn-check" name="hw_${idx}" id="hw_m_${idx}" value="미흡" ${isHwM}>
                        <label class="btn btn-outline-secondary btn-sm" for="hw_m_${idx}">미흡</label>
                        <input type="radio" class="btn-check" name="hw_${idx}" id="hw_x_${idx}" value="미제출" ${isHwX}>
                        <label class="btn btn-outline-danger btn-sm" for="hw_x_${idx}">미제출</label>
                    </div>
                </div>
            </div>
            <div class="row g-3 bg-light p-3 rounded border border-light mb-3">
                <div class="col-md-6 border-end">
                    <label class="small fw-bold text-primary mb-2"><i class="bi bi-book"></i> 오늘 진도</label>
                    <div class="input-group input-group-sm mb-2 shadow-sm"><input type="text" class="form-control bg-white" id="pB1_${idx}" list="globalBookList" placeholder="진도교재 1" value="${pB[0] || ''}"><input type="text" class="form-control bg-white" id="pR1_${idx}" placeholder="${getPhVal(pastPR, 0, '범위')}" value="${pR[0] || ''}"></div>
                    <div class="input-group input-group-sm shadow-sm"><input type="text" class="form-control bg-white" id="pB2_${idx}" list="globalBookList" placeholder="진도교재 2" value="${pB[1] || ''}"><input type="text" class="form-control bg-white" id="pR2_${idx}" placeholder="${getPhVal(pastPR, 1, '범위')}" value="${pR[1] || ''}"></div>
                    <div class="input-group input-group-sm shadow-sm mt-2"><input type="text" class="form-control bg-white" id="pB3_${idx}" list="globalBookList" placeholder="진도교재 3" value="${pB[2] || ''}"><input type="text" class="form-control bg-white" id="pR3_${idx}" placeholder="${getPhVal(pastPR, 2, '범위')}" value="${pR[2] || ''}"></div>
                </div>
                <div class="col-md-6">
                    <label class="small fw-bold text-success mb-2"><i class="bi bi-pencil-square"></i> 다음 과제</label>
                    <div class="input-group input-group-sm mb-2 shadow-sm"><input type="text" class="form-control bg-white" id="hwB1_${idx}" list="globalBookList" placeholder="과제교재 1" value="${hwB[0] || ''}"><input type="text" class="form-control bg-white" id="hwR1_${idx}" placeholder="${getPhVal(pastHwR, 0, '범위')}" value="${hwR[0] || ''}"></div>
                    <div class="input-group input-group-sm mb-2 shadow-sm"><input type="text" class="form-control bg-white" id="hwB2_${idx}" list="globalBookList" placeholder="과제교재 2" value="${hwB[1] || ''}"><input type="text" class="form-control bg-white" id="hwR2_${idx}" placeholder="${getPhVal(pastHwR, 1, '범위')}" value="${hwR[1] || ''}"></div>
                    <div class="input-group input-group-sm shadow-sm"><input type="text" class="form-control bg-white" id="hwB3_${idx}" list="globalBookList" placeholder="과제교재 3" value="${hwB[2] || ''}"><input type="text" class="form-control bg-white" id="hwR3_${idx}" placeholder="${getPhVal(pastHwR, 2, '범위')}" value="${hwR[2] || ''}"></div>
                </div>
            </div>
            
            <div class="row g-2 align-items-center mb-2">
                <div class="col-md-2"><span class="badge bg-danger w-100 py-2">테스트 1</span></div>
                <div class="col-md-3"><select class="form-select form-select-sm" id="t1Type_${idx}"><option value="일일" ${t1Type === '일일' ? 'selected' : ''}>일일 테스트</option><option value="주간" ${t1Type === '주간' ? 'selected' : ''}>주간 테스트</option><option value="월간" ${t1Type === '월간' ? 'selected' : ''}>월간 평가</option></select></div>
                <div class="col-md-4 d-flex align-items-center gap-2"><input type="number" class="form-control form-control-sm text-center fw-bold" id="t1Cor_${idx}" placeholder="정답" value="${t1Cor}"><span class="fw-bold text-muted">/</span><input type="number" class="form-control form-control-sm text-center text-muted" id="t1Tot_${idx}" placeholder="${t1TotPh}" value="${t1Tot}"></div>
            </div>
            <div class="row g-2 align-items-center mb-2">
                <div class="col-md-2"><span class="badge bg-primary text-white w-100 py-2">테스트 2</span></div>
                <div class="col-md-3"><select class="form-select form-select-sm" id="t2Type_${idx}"><option value="일일" ${t2Type === '일일' ? 'selected' : ''}>일일 테스트</option><option value="주간" ${t2Type === '주간' ? 'selected' : ''}>주간 테스트</option><option value="월간" ${t2Type === '월간' ? 'selected' : ''}>월간 평가</option></select></div>
                <div class="col-md-4 d-flex align-items-center gap-2"><input type="number" class="form-control form-control-sm text-center fw-bold" id="t2Cor_${idx}" placeholder="정답" value="${t2Cor}"><span class="fw-bold text-muted">/</span><input type="number" class="form-control form-control-sm text-center text-muted" id="t2Tot_${idx}" placeholder="${t2TotPh}" value="${t2Tot}"></div>
            </div>
            
            <div class="row g-2 align-items-center mb-3 mt-2">
                <div class="col-md-2"><span class="badge bg-secondary text-white w-100 py-2">테스트 피드백</span></div>
                <div class="col-md-10"><input type="text" class="form-control form-control-sm border-secondary" id="testFeedback_${idx}" placeholder="테스트 결과 코멘트를 적어주세요 (알림톡의 '맞혔습니다' 뒤에 자연스럽게 이어집니다)" value="${getVal('testFeedback')}"></div>
            </div>

            <div class="row g-2 align-items-center mb-3">
                <div class="col-md-2"><span class="badge bg-info text-dark w-100 py-2">새 교재 청구</span></div>
                <div class="col-md-5"><input type="text" class="form-control form-control-sm border-info" id="newBook_${idx}" list="globalBookList" placeholder="발급된 교재명 검색..." value="${getVal('newBook')}" onchange="if(window.updateBookFee) window.updateBookFee('${idx}')" onkeyup="if(window.updateBookFee) window.updateBookFee('${idx}')" oninput="if(window.updateBookFee) window.updateBookFee('${idx}')"></div>
                <div class="col-md-3 d-flex align-items-center gap-2"><input type="number" class="form-control form-control-sm text-end" id="bookFee_${idx}" placeholder="금액(원)" value="${getVal('bookFee')}"><span class="small text-muted fw-bold">원</span></div>
            </div>
            <div class="row g-2 mb-2 mt-3">
                <div class="col-md-6"><div class="input-group input-group-sm"><span class="input-group-text bg-light border-primary text-primary fw-bold">개별학습</span><input type="text" class="form-control border-primary" id="indivLearning_${idx}" placeholder="${getPh(26, '오늘 학습한 특이사항')}" value="${getVal('indivLearning')}"></div></div>
                <div class="col-md-6"><div class="input-group input-group-sm"><span class="input-group-text bg-light border-danger text-danger fw-bold">과제피드백</span><input type="text" class="form-control border-danger" id="hwFeedback_${idx}" placeholder="${getPh(22, '과제 수행 코멘트')}" value="${getVal('hwFeedback')}"></div></div>
            </div>
            
            <div class="row g-2 mb-2">
              <div class="col-12">
                <textarea class="form-control bg-light" placeholder="${getPh(17, '💬 종합안내')}" id="memo_${idx}" rows="2">${getVal('memo')}</textarea>
              </div>
            </div>
            
            <div class="row g-2 mb-2">
                <div class="col-md-4"><input type="text" class="form-control form-control-sm bg-light" id="praise_${idx}" placeholder="${getPh(23, '👍 칭찬할 점')}" value="${getVal('praise')}"></div>
                <div class="col-md-4"><input type="text" class="form-control form-control-sm bg-light" id="effort_${idx}" placeholder="${getPh(24, '💪 노력할 점')}" value="${getVal('effort')}"></div>
                <div class="col-md-4"><input type="text" class="form-control form-control-sm bg-light" id="parentsNote_${idx}" placeholder="${getPh(25, '📢 부모님께')}" value="${getVal('parentsNote')}"></div>
            </div>
            <div class="row g-2 mb-2">
                <div class="col-md-6"><input type="text" class="form-control form-control-sm bg-light text-primary fw-bold" id="eventNotice_${idx}" placeholder="${getPh(27, '🎉 행사 안내')}" value="${getVal('eventNotice')}"></div>
                <div class="col-md-6"><input type="text" class="form-control form-control-sm border-secondary bg-secondary bg-opacity-10" id="privateMemo_${idx}" placeholder="🔒 비밀 메모" value="${getVal('privateMemo')}"></div>
            </div>
        </div>`;
  });

  document.getElementById('studentNavList').innerHTML = navHtml;
  document.getElementById('studentCheckList').innerHTML = listHtml;

  let modal = new bootstrap.Modal(modalEl);
  modal.show();

  setTimeout(() => {
    const navLinks = document.querySelectorAll('#studentNavList a');
    const scrollContainer = document.getElementById('studentCheckList');

    scrollContainer.addEventListener('input', function (e) {
      const row = e.target.closest('.student-row');
      if (row && window.updateLivePreview) window.updateLivePreview(row.id.replace('student-section-', ''));
    });
    scrollContainer.addEventListener('change', function (e) {
      const row = e.target.closest('.student-row');
      if (row && window.updateLivePreview) window.updateLivePreview(row.id.replace('student-section-', ''));
    });

    const classProgressEl = document.getElementById('classProgress');
    if (classProgressEl) {
      classProgressEl.addEventListener('input', function () {
        const rows = document.querySelectorAll('.student-row');
        rows.forEach((row, DOMidx) => {
          if (window.updateLivePreview) window.updateLivePreview(DOMidx);
        });
      });
    }

    navLinks.forEach(link => {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        navLinks.forEach(l => l.classList.remove('active'));
        this.classList.add('active');
        const targetId = this.getAttribute('href').substring(1);
        const targetEl = document.getElementById(targetId);
        if (targetEl) {
          scrollContainer.scrollTo({ top: targetEl.offsetTop - scrollContainer.offsetTop, behavior: 'smooth' });
          if (window.updateLivePreview) window.updateLivePreview(targetId.replace('student-section-', ''));
        }
      });
    });
  }, 300);
};

window.updateBookFee = function (idx) {
  const bookNameInput = document.getElementById('newBook_' + idx);
  const bookFeeInput = document.getElementById('bookFee_' + idx);
  if (!bookNameInput || !bookFeeInput) return;
  const typedName = bookNameInput.value.trim();
  if (!typedName) { bookFeeInput.value = ''; return; }
  const books = (appCache.raw && appCache.raw.books) || [];
  const foundBook = books.find(b => b[0] === typedName);
  if (foundBook && foundBook[2]) {
    bookFeeInput.value = foundBook[2].toString().replace(/[^0-9]/g, '');
  } else {
    bookFeeInput.value = '';
  }
};

window.onAttChange = function (sel) {
  const card = sel.closest('.student-row');
  if (!card) return;
  const isAbsent = (sel.value === '결석');
  const idx = card.id.replace('student-section-', '');

  card.querySelectorAll('input[type="radio"][name^="hw_"], input[type="text"]:not(#memo_' + idx + '), input[type="number"], textarea:not(#memo_' + idx + '), select:not(#template_' + idx + ')').forEach(el => { el.disabled = isAbsent; });

  const memoEl = document.getElementById('memo_' + idx);
  if (memoEl) {
    memoEl.disabled = false;
    if (isAbsent) {
      memoEl.placeholder = "🚨 결석 사유를 상세히 적어주세요 (이 내용이 보강 관리로 넘어갑니다)";
      memoEl.classList.add('border-danger', 'border-2');
      memoEl.classList.remove('bg-light');
    } else {
      memoEl.placeholder = "💬 종합안내";
      memoEl.classList.remove('border-danger', 'border-2');
      memoEl.classList.add('bg-light');
    }
  }

  const detailAreas = card.querySelectorAll('.bg-light, .row.g-2');
  detailAreas.forEach(area => {
    if (!area.contains(memoEl)) {
      area.style.opacity = isAbsent ? '0.4' : '1';
    } else {
      area.style.opacity = '1';
    }
  });

  card.style.borderLeft = isAbsent ? '4px solid #ef4444' : '4px solid #3b82f6';
};
// =================================================================
// 🚀 [신규 기능] 출결 전체 일괄 처리 (빠른 제어)
// =================================================================
window.setAllAttendance = function (status) {
  const rows = document.querySelectorAll('.student-row');
  let count = 0;
  rows.forEach((row, idx) => {
    let radioId = '';
    if (status === '출석') radioId = 'att_o_' + idx;
    else if (status === '지각') radioId = 'att_l_' + idx;
    else if (status === '결석') radioId = 'att_x_' + idx;
    const radioBtn = document.getElementById(radioId);
    if (radioBtn) { radioBtn.checked = true; onAttChange(radioBtn); count++; }
  });
  console.log('[완료] 총 ' + count + '명의 학생이 전원 ' + status + ' 처리되었습니다.');
};

// =================================================================
// 🚀 출결 저장 로직 (테스트 피드백을 배열의 29번째 인덱스에 저장)
// =================================================================
window.saveAttendance = async function (submitType, isOnlyAtt, targetIdx = null) {
  if (!currentEventForModal) return;

  const date = document.getElementById('checkDate').value;
  const progress = document.getElementById('classProgress') ? document.getElementById('classProgress').value.trim() : '';
  const rows = document.querySelectorAll('.student-row');
  const isFinal = (submitType === '최종' || submitType === '최종제출');

  let records = [];
  let hasMissingAtt = false;

  rows.forEach((row, idx) => {
    if (targetIdx !== null && targetIdx !== idx) return;
    let rawId = row.getAttribute('data-id');
    let rawName = row.getAttribute('data-name');

    const templateSelect = document.getElementById(`template_${idx}`);
    if (templateSelect) localStorage.setItem(`template_${date}_${rawId}`, templateSelect.value);

    if (rawId && !rawId.startsWith('S')) {
      const found = (appCache.raw.students || []).find(s => s[1] === rawName || s[1] === rawId);
      if (found) { rawId = found[0]; rawName = found[1]; }
    }

    let attRadio = document.querySelector(`input[name="att_${idx}"]:checked`);
    let hwRadio = document.querySelector(`input[name="hw_${idx}"]:checked`);
    let att = attRadio ? attRadio.value : "";
    let hw = hwRadio ? hwRadio.value : (att === '결석' ? '없음' : '');

    if (!att) hasMissingAtt = true;

    let recordStatus = isFinal ? '최종' : '임시저장';
    if (att === '결석') recordStatus = '최종';

    const memoInput = document.getElementById(`memo_${idx}`)?.value || "";
    const newBookInput = document.getElementById(`newBook_${idx}`)?.value || "";
    const bookFeeInput = document.getElementById(`bookFee_${idx}`)?.value || "";

    const alimtalkSummary = `[출결] ${att} / [과제] ${hw}`;
    const newBookText = newBookInput ? (newBookInput.includes('지급)') ? newBookInput : `${newBookInput} (${date} 지급)`) : "";

    let rowData = [
      new Date().toLocaleString('ko-KR'), rawId, rawName, date, currentEventForModal.teacherId,
      att, hw,
      `${document.getElementById('pB1_' + idx)?.value || ''}|${document.getElementById('pB2_' + idx)?.value || ''}|${document.getElementById('pB3_' + idx)?.value || ''}`,
      `${document.getElementById('pR1_' + idx)?.value || progress}|${document.getElementById('pR2_' + idx)?.value || ''}|${document.getElementById('pR3_' + idx)?.value || ''}`,
      `${document.getElementById('hwB1_' + idx)?.value || ''}|${document.getElementById('hwB2_' + idx)?.value || ''}|${document.getElementById('hwB3_' + idx)?.value || ''}`,
      `${document.getElementById('hwR1_' + idx)?.value || ''}|${document.getElementById('hwR2_' + idx)?.value || ''}|${document.getElementById('hwR3_' + idx)?.value || ''}`,
      document.getElementById(`t1Type_${idx}`).value, document.getElementById(`t1Cor_${idx}`).value, document.getElementById(`t1Tot_${idx}`).value,
      document.getElementById(`t2Type_${idx}`).value, document.getElementById(`t2Cor_${idx}`).value, document.getElementById(`t2Tot_${idx}`).value,
      memoInput, recordStatus, alimtalkSummary, newBookText, bookFeeInput,
      document.getElementById(`hwFeedback_${idx}`)?.value || "", document.getElementById(`praise_${idx}`)?.value || "",
      document.getElementById(`effort_${idx}`)?.value || "", document.getElementById(`parentsNote_${idx}`)?.value || "",
      document.getElementById(`indivLearning_${idx}`)?.value || "", document.getElementById(`eventNotice_${idx}`)?.value || "",
      document.getElementById(`privateMemo_${idx}`)?.value || "",
      document.getElementById(`testFeedback_${idx}`)?.value || "" // 💡 [추가됨] 29번째 인덱스 (AD열)에 안전하게 저장!
    ];
    records.push(rowData);
  });

  if (hasMissingAtt) return alert(targetIdx !== null ? "해당 학생의 [출결] 상태를 선택해주세요!" : "모든 학생의 [출결] 상태를 선택해주세요!");

  showLoader(true);
  try {
    const sheetName = (typeof CONFIG !== 'undefined' && CONFIG.SHEETS && CONFIG.SHEETS.ATTENDANCE) ? CONFIG.SHEETS.ATTENDANCE : '출결기록';
    const existRes = await callSheetsAPI('GET', '/values/출결기록!A:D');
    const existRows = existRes.values || [];

    for (let i = 0; i < records.length; i++) {
      const rowData = records[i];
      const rawId = rowData[1];
      const dateStr = rowData[3];
      const foundIdx = existRows.findIndex(r => r[1] === rawId && r[3] === dateStr);

      if (foundIdx > -1) {
        // 배열 길이가 길어졌으므로 업데이트 범위를 AD까지 넉넉하게 잡습니다.
        await callSheetsAPI('PUT', '/values/출결기록!A' + (foundIdx + 1) + ':AD' + (foundIdx + 1) + '?valueInputOption=USER_ENTERED', { values: [rowData] });
      } else {
        await callSheetsAPI('POST', `/values/${encodeURIComponent(sheetName)}:append?valueInputOption=USER_ENTERED`, { values: [rowData] });
      }
    }
    showLoader(false);

    if (isFinal) {
      alert(`✅ 총 ${records.length}명의 출결이 저장되었습니다! 알림톡 발송 창으로 이동합니다.`);
      const attModal = bootstrap.Modal.getInstance(document.getElementById('attendanceModal'));
      if (attModal) attModal.hide();

      setTimeout(() => {
        const alimtalkRecords = [];
        rows.forEach((row, DOMidx) => {
          if (targetIdx !== null && targetIdx !== DOMidx) return;
          alimtalkRecords.push({
            studentId: row.getAttribute('data-id'),
            studentName: row.getAttribute('data-name'),
            att: document.querySelector(`input[name="att_${DOMidx}"]:checked`)?.value || '',
            finalText: window.generateAlimtalkText(DOMidx)
          });
        });
        openAlimtalkModal(alimtalkRecords, date, currentEventForModal.teacherId);
      }, 500);
    } else {
      alert(`💾 총 ${records.length}명의 출결 기록이 임시저장 되었습니다.`);
      const attModal = bootstrap.Modal.getInstance(document.getElementById('attendanceModal'));
      if (attModal) attModal.hide();
      if (typeof forceRefresh === 'function') forceRefresh();
    }
  } catch (error) {
    showLoader(false);
    alert("저장 중 오류가 발생했습니다: " + error.message);
  }
};

// =========================================
// 문자(알림톡) 템플릿 모달 및 발송 로직 (개별 템플릿 최적화)
// =========================================
let currentAlimtalkRecords = [];

window.openAlimtalkModal = function (records, date, teacher) {
  currentAlimtalkRecords = records;

  let modalEl = document.getElementById('alimtalkModal');
  if (!modalEl) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal fade" id="alimtalkModal" tabindex="-1">
        <div class="modal-dialog modal-lg modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header bg-success text-white">
              <h5 class="modal-title fw-bold">문자(알림톡) 최종 확인 및 발송</h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body bg-light">
              <div class="alert alert-success py-2 small fw-bold"><i class="bi bi-info-circle"></i> 학생별로 선택한 템플릿이 개별 적용되어 있습니다. 발송 전 내용을 마지막으로 확인하세요.</div>
              <div id="alimtalkPreviewContainer"></div>
            </div>
            <div class="modal-footer justify-content-between">
              <button class="btn btn-outline-secondary rounded-pill" data-bs-dismiss="modal">건너뛰기</button>
              <button class="btn btn-success rounded-pill shadow-sm" id="btn-send-alimtalk" onclick="sendAlimtalk()">즉시 발송</button>
            </div>
          </div>
        </div>
      </div>`);
    modalEl = document.getElementById('alimtalkModal');
  }

  window.renderAlimtalkPreviews();

  let modal = bootstrap.Modal.getInstance(modalEl);
  if (!modal) modal = new bootstrap.Modal(modalEl);
  modal.show();
};

window.renderAlimtalkPreviews = function () {
  const container = document.getElementById('alimtalkPreviewContainer');

  // 🚀 공통 드롭다운 없이, 위에서 넘겨받은 개별 finalText를 그대로 화면에 뿌려주기만 하면 끝!
  container.innerHTML = currentAlimtalkRecords.map((r, idx) => {
    return `
      <div class="card border-0 shadow-sm mb-3">
        <div class="card-header bg-white border-bottom-0 pt-3 pb-0 d-flex justify-content-between align-items-center">
          <span class="fw-bold text-dark"><i class="bi bi-person-fill text-success"></i> ${r.studentName} <small class="text-muted fw-normal ms-1">(${r.att})</small></span>
          ${r.att === '결석' ? '<span class="badge bg-danger bg-opacity-10 text-danger border">결석생</span>' : ''}
        </div>
        <div class="card-body">
          <textarea class="form-control alimtalk-content-input border-success border-opacity-25 bg-light" rows="18" style="font-size:0.9rem; line-height:1.6;" data-idx="${idx}">${r.finalText}</textarea>
        </div>
      </div>
    `;
  }).join('');
};


// =================================================================
// 🚀 [고속 통신] 알림톡 메세지 발송 (개별 템플릿 완벽 호환)
// =================================================================
window.sendAlimtalk = async function () {
  const btn = document.getElementById('btn-send-alimtalk');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 발송 처리중...';
  }

  const inputs = document.querySelectorAll('.alimtalk-content-input');
  const recordsToSave = [];
  const smsSpreadsheetId = '1hlklodChPmHcnD2_pEp6po6SjQaDhtBs9CtvntAvaP0';

  inputs.forEach((inputEl, i) => {
    const text = inputEl.value.trim();
    if (text) {
      const targetId = currentAlimtalkRecords[i].studentId;
      const targetName = currentAlimtalkRecords[i].studentName;
      const foundStudent = (appCache.raw.students || []).find(s => s[0] === targetId || s[1] === targetName);
      const parentPhone = foundStudent ? (foundStudent[10] || "") : "";

      recordsToSave.push([
        parentPhone,
        targetName,
        text,
        "대기중",
        "미확정"
      ]);
    }
  });

  if (recordsToSave.length === 0) {
    alert("전송할 내용이 없습니다.");
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-send-check-fill"></i> 메세지 즉시 발송'; }
    return;
  }

  try {
    const body = { values: recordsToSave };
    await callSheetsAPI('POST', `/values/${encodeURIComponent('SMS발송!A:A')}:append?valueInputOption=USER_ENTERED`, body, smsSpreadsheetId);

    try {
      const attRes = await callSheetsAPI('GET', '/values/출결기록!A:D');
      const updateBatch = [];
      const currentDate = document.getElementById('checkDate') ? document.getElementById('checkDate').value : new Date().toISOString().substring(0, 10);

      inputs.forEach((inputEl, i) => {
        const text = inputEl.value.trim();
        if (!text) return;
        const targetId = currentAlimtalkRecords[i].studentId;
        for (let r = (attRes.values || []).length - 1; r >= 0; r--) {
          if (attRes.values[r][1] === targetId && attRes.values[r][3] === currentDate) {
            updateBatch.push({ range: `출결기록!T${r + 1}`, values: [[text]] });
            break;
          }
        }
      });
      if (updateBatch.length > 0) {
        await callSheetsAPI('POST', '/values:batchUpdate', { valueInputOption: "USER_ENTERED", data: updateBatch });
      }
    } catch (e) { console.error("출결기록 업데이트 실패", e); }

    alert(`💌 총 ${recordsToSave.length}건의 메세지가 성공적으로 발송(예약) 되었습니다!`);
    let modal = bootstrap.Modal.getInstance(document.getElementById('alimtalkModal'));
    if (modal) modal.hide();
    if (typeof forceRefresh === 'function') forceRefresh();
  } catch (e) {
    alert("알림톡 발송 실패: " + e.message + "\n(외부 SMS 시트 연결을 확인해주세요!)");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-send-check-fill"></i> 메세지 즉시 발송';
    }
  }
};





// =========================================
// 교재 관리 화면
// =========================================
// =================================================================
// 🚀 [버그 수정] 교재 관리 화면 (금액 NaN 오류 완벽 해결)
// =================================================================
window.loadBookView = function () {
  const books = appCache.raw.books || [];

  const isManager = (appCache.user.role === '원장');
  const myBooks = isManager ? books : books.filter(b => b[2] === appCache.user.name);

  let html = `
    <div class="d-flex justify-content-between align-items-center mb-4">
      <h3 class="fw-bold m-0"><i class="bi bi-book-fill text-primary me-2"></i>교재 관리</h3>
      <button class="btn btn-primary rounded-pill fw-bold shadow-sm" onclick="openBookModal()">
        <i class="bi bi-plus-lg me-1"></i> 교재 등록
      </button>
    </div>
    
    <div class="card shadow-sm border-0">
      <div class="table-responsive">
        <table class="table table-hover align-middle m-0" style="min-width: 900px;">
          <thead class="table-light">
            <tr>
              <th>순번</th>
              <th>교재명</th>
              <th>분류</th>
              <th>가격</th>
              <th>전체 페이지</th>
              <th>등록일자</th>
              <th>기능</th>
            </tr>
          </thead>
          <tbody>
  `;

  if (myBooks.length === 0) {
    html += `<tr><td colspan="7" class="text-center py-5 text-muted">등록된 교재가 없습니다.</td></tr>`;
  } else {
    myBooks.slice().reverse().forEach((b, idx) => {
      const bookName = b[0] || '-';
      const category = b[1] || '-';
      const feeRaw = b[2] || '';
      const totalPages = b[3] || '0';
      const regDate = b[4] || '-';

      // 💡 [핵심 수술] 금액 포맷팅 오류(NaN) 해결
      // 시트에 "15,000" 이나 "15000원" 이라고 적혀있어도 정수기처럼 숫자만 쏙 뽑아냄
      const cleanFee = feeRaw.toString().replace(/[^0-9]/g, '');
      const formattedFee = cleanFee ? Number(cleanFee).toLocaleString() + '원' : '-';

      html += `
        <tr>
          <td class="text-muted small">${myBooks.length - idx}</td>
          <td class="fw-bold text-primary">${bookName}</td>
          <td><span class="badge bg-secondary bg-opacity-10 text-dark border fw-normal">${category}</span></td>
          <td class="fw-bold text-success">${formattedFee}</td>
          <td class="small">총 <b>${totalPages}</b> P</td>
          <td class="text-muted small">${regDate}</td>
          <td>
            <button class="btn btn-sm btn-outline-danger" onclick="alert('데이터 보호를 위해 삭제는 원장님을 통해서만 관리할 수 있습니다.')"><i class="bi bi-trash"></i></button>
          </td>
        </tr>
      `;
    });
  }

  html += `
          </tbody>
        </table>
      </div>
    </div>
  `;

  // 모달 동적 주입 (최초 1회만)
  if (!document.getElementById('bookModal')) {
    const modalHtml = `
      <div class="modal fade" id="bookModal" tabindex="-1">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content border-0 shadow-lg">
            <div class="modal-header bg-primary text-white">
              <h5 class="modal-title fw-bold"><i class="bi bi-journal-plus"></i> 새 교재 등록</h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body p-4">
              <div class="row g-3">
                <div class="col-8">
                  <label class="form-label fw-bold text-muted small">교재명 <span class="text-danger">*</span></label>
                  <input type="text" id="b-name" class="form-control fw-bold text-primary" placeholder="예: 개념원리 중1-1">
                </div>
                <div class="col-4">
                  <label class="form-label fw-bold text-muted small">분류 <span class="text-danger">*</span></label>
                  <select id="b-category" class="form-select">
                    <option value="개념서">개념서</option>
                    <option value="유형서">유형서</option>
                    <option value="심화서">심화서</option>
                    <option value="기출문제">기출문제</option>
                    <option value="연산">연산</option>
                    <option value="기타">기타</option>
                  </select>
                </div>
                <div class="col-6">
                  <label class="form-label fw-bold text-muted small">전체 페이지 수 <span class="text-danger">*</span></label>
                  <div class="input-group">
                    <input type="number" id="b-pages" class="form-control" placeholder="예: 250">
                    <span class="input-group-text">P</span>
                  </div>
                </div>
                <div class="col-6">
                  <label class="form-label fw-bold text-muted small">교재비 (원)</label>
                  <input type="number" id="b-fee" class="form-control" placeholder="예: 15000">
                </div>
              </div>
            </div>
            <div class="modal-footer bg-light">
              <button type="button" class="btn btn-secondary rounded-pill fw-bold" data-bs-dismiss="modal">취소</button>
              <button type="button" id="btn-save-book" class="btn btn-primary rounded-pill fw-bold px-4" onclick="saveBook()">교재 저장</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
  }

  document.getElementById('view-container').innerHTML = html;
};

window.openBookModal = function () {
  document.getElementById('b-name').value = '';
  document.getElementById('b-category').value = '개념서';
  document.getElementById('b-pages').value = '';
  document.getElementById('b-fee').value = '';
  let modal = new bootstrap.Modal(document.getElementById('bookModal'));
  modal.show();
};

// =================================================================
// 🚀 [고속 통신 3] 새 교재 등록 (교재DB)
// =================================================================
window.saveBook = async function () {
  const name = document.getElementById('b-name').value.trim();
  const category = document.getElementById('b-category').value;
  const pages = document.getElementById('b-pages').value.trim();
  const fee = document.getElementById('b-fee').value.trim();

  if (!name || !pages) {
    alert("교재명과 전체 페이지 수는 필수 입력 항목입니다.");
    return;
  }

  const btn = document.getElementById('btn-save-book');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 저장 중...';

  try {
    const todayStr = new Date().toISOString().substring(0, 10);
    // 교재DB 컬럼 매핑
    const rowData = [name, category, fee, pages, todayStr];

    const sheetName = (typeof CONFIG !== 'undefined' && CONFIG.SHEETS && CONFIG.SHEETS.BOOK) ? CONFIG.SHEETS.BOOK : '교재DB';
    await callSheetsAPI('POST', `/values/${encodeURIComponent(sheetName)}:append?valueInputOption=USER_ENTERED`, { values: [rowData] });

    alert("교재가 성공적으로 등록되었습니다. 📚");
    let modal = bootstrap.Modal.getInstance(document.getElementById('bookModal'));
    if (modal) modal.hide();

    if (typeof refreshBookData === 'function') {
      await refreshBookData();
    } else {
      forceRefresh();
    }
  } catch (err) {
    alert("교재 등록 실패: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = '교재 저장';
  }
};

// =========================================
// 🚀 기록 조회 뷰 (검색창 먹통 버그 완벽 패치)
// =========================================
window.loadHistoryView = function (filterPeriod, filterTeacher) {
  const attendance = (appCache.raw && appCache.raw.attendance) || [];
  const isManager = (appCache.user.role === '원장');

  filterPeriod = filterPeriod || 'week';
  filterTeacher = filterTeacher || (isManager ? '' : appCache.user.name);

  const now = new Date();
  const today = now.toISOString().substring(0, 10);
  let startDate = today;
  if (filterPeriod === 'today') startDate = today;
  else if (filterPeriod === 'week') { const d = new Date(now); d.setDate(d.getDate() - 6); startDate = d.toISOString().substring(0, 10); }
  else if (filterPeriod === 'month') startDate = today.substring(0, 7) + '-01';
  else if (filterPeriod === 'custom') startDate = document.getElementById('hist-start-date')?.value || today;

  let rows = attendance.filter(r => {
    const d = (r[3] || '').substring(0, 10);
    if (d < startDate || d > today) return false;
    if (filterTeacher && r[4] !== filterTeacher) return false;
    return true;
  }).reverse();

  const teachers = isManager ? [...new Set((appCache.raw.teachers || []).map(t => t[1]).filter(Boolean))] : [appCache.user.name];
  const periods = [{ key: 'today', label: '오늘' }, { key: 'week', label: '이번주' }, { key: 'month', label: '이번달' }, { key: 'custom', label: '직접입력' }];
  const periodTabs = periods.map(p => `<button class="btn btn-sm ${filterPeriod === p.key ? 'btn-primary' : 'btn-outline-secondary'} rounded-pill fw-bold" onclick="loadHistoryView('${p.key}', '${filterTeacher}')">${p.label}</button>`).join('');
  const teacherFilterHTML = isManager ? `<select class="form-select form-select-sm border-secondary rounded-pill px-3 shadow-sm" style="max-width:130px;" onchange="loadHistoryView('${filterPeriod}', this.value)"><option value="">전체 강사</option>${teachers.map(t => `<option value="${t}" ${filterTeacher === t ? 'selected' : ''}>${t}</option>`).join('')}</select>` : '';
  const customDateHTML = filterPeriod === 'custom' ? `<input type="date" id="hist-start-date" class="form-control form-control-sm" style="max-width:140px;" value="${startDate}" onchange="loadHistoryView('custom','${filterTeacher}')"><span class="text-muted small">~${today}</span>` : '';

  const tableRows = rows.length === 0 ? `<tr><td colspan="8" class="text-center py-5 text-muted">해당 기간에 기록이 없습니다.</td></tr>` : rows.map(r => {
    const date = (r[3] || '').substring(0, 10); const teacher = r[4] || '-'; const student = r[2] || '-'; const att = r[5] || '-'; const hw = r[6] || '-';
    let progItems = []; const arrB = (r[7] || '').split('|'); const arrR = (r[8] || '').split('|');
    for (let i = 0; i < 3; i++) { if (arrB[i]?.trim() || arrR[i]?.trim()) progItems.push(`${arrB[i]?.trim() ? `[${arrB[i].trim()}] ` : ''}${arrR[i]?.trim()}`); }
    const tableProg = progItems.join(', ') || '-'; const modalProg = progItems.length > 0 ? progItems.join('<br>') : '-';
    const memo = r[17] || ''; const status = r[18] || ''; const lessonType = ((r[8] || '').split('|')[0].match(/^\[([^\]]+)\]/) || ['', '일반수업'])[1];

    const attBadge = att === '출석' ? 'badge-att-present' : att === '결석' ? 'badge-att-absent' : att === '지각' ? 'badge-att-late' : att === '조퇴' ? 'badge-att-leave' : att === '보강' ? 'badge-att-makeup' : att === '보강예정' ? 'badge-att-pending' : 'bg-secondary';
    const hwBadge = hw === '완료' ? 'text-success' : hw === '미완료' ? 'text-danger' : hw === '세모' ? 'text-warning' : 'text-muted';
    const statusBadge = status === '최종' ? 'badge-status-final' : 'badge-status-temp';
    const typeBadge = lessonType === '클리닉' ? 'bg-warning text-dark' : lessonType === '개념노트' ? 'bg-info text-white' : lessonType === '테스트' ? 'bg-danger' : 'bg-light text-dark border';

    const safeData = encodeURIComponent(JSON.stringify({ date, teacher, student, att, hw, modalProg, memo, status, t1Type: r[11], t1Cor: r[12], t1Tot: r[13], t2Type: r[14], t2Cor: r[15], t2Tot: r[16], hwFeedback: r[22], praise: r[23], effort: r[24], parentsNote: r[25], indivLearning: r[26], eventNotice: r[27], privateMemo: r[28] }));

    return `<tr style="font-size:0.83rem; cursor:pointer;" onclick="showHistoryDetail('${safeData}')"><td class="text-muted fw-bold">${date}</td><td>${teacher}</td><td class="fw-bold">${student}</td><td><span class="badge ${attBadge} rounded-pill">${att}</span></td><td><span class="${hwBadge} fw-bold">${hw}</span></td><td><span class="badge ${typeBadge}" style="font-size:0.7rem;">${lessonType}</span></td><td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${tableProg}">${tableProg}</td><td>${status ? `<span class="badge ${statusBadge}" style="font-size:0.65rem;">${status}</span>` : '-'}${memo ? `<span class="text-muted small ms-1" title="${memo}">💬</span>` : ''}</td></tr>`;
  }).join('');

  document.getElementById('view-container').innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
      <h4 class="fw-bold m-0"><i class="bi bi-journal-bookmark-fill me-2 text-primary"></i>기록 조회</h4>
      <button class="btn btn-outline-secondary btn-sm rounded-pill" onclick="loadHistoryView('${filterPeriod}','${filterTeacher}')"><i class="bi bi-arrow-clockwise"></i> 새로고침</button>
    </div>
    <div class="card shadow-sm border-0 mb-4 p-3">
      <div class="d-flex flex-wrap gap-2 align-items-center">
        <span class="fw-bold small text-muted">기간:</span>${periodTabs}${customDateHTML}
        <div class="ms-auto d-flex gap-2">
          ${teacherFilterHTML}
          <input type="text" id="hist-student-filter" class="form-control form-control-sm border-primary rounded-pill px-3 shadow-sm" style="max-width:150px;" placeholder="🔍 학생명 검색" onkeyup="filterTableRows('hist-student-filter', 'historyTable', 2)">
        </div>
      </div>
      <div class="text-muted small mt-2">총 <b>${rows.length}</b>건 · ${startDate} ~ ${today}</div>
    </div>
    <div class="card shadow-sm border-0">
      <div class="table-responsive" style="max-height:60vh;">
        <table class="table table-hover align-middle mb-0" id="historyTable">
          <thead class="table-light sticky-top" style="top:0; z-index:1;"><tr style="font-size:0.82rem;"><th>날짜</th><th>강사</th><th>학생</th><th>출결</th><th>과제</th><th>수업유형</th><th>진도 범위</th><th>상태/메모</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>`;
};
window.loadHistoryView = loadHistoryView;


// =========================================
// 🚀 성적 관리 뷰 (실시간 검색창 탑재)
// =========================================
window.openScoreModal = function () {
  let existing = document.getElementById('scoreModal');
  if (existing) existing.remove();

  let studentOptions = '';
  if (appCache.raw && appCache.raw.students) {
    let sorted = [];
    for (let i = 1; i < appCache.raw.students.length; i++) {
      if (appCache.raw.students[i][0]) sorted.push({ id: appCache.raw.students[i][0], name: appCache.raw.students[i][1], school: appCache.raw.students[i][3] });
    }
    sorted.sort((a, b) => a.name.localeCompare(b.name)).forEach(s => {
      studentOptions += `<option value="${s.name} (${s.school})" data-id="${s.id}">`;
    });
  }

  const modalHtml = `
  <div class="modal fade" id="scoreModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content border-0 shadow-lg">
        <div class="modal-header bg-success text-white">
          <h5 class="modal-title fw-bold"><i class="bi bi-plus-lg"></i> 성적 입력</h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body p-4 bg-light">
          <div class="mb-3">
            <label class="form-label fw-bold small text-muted">학생 검색 <span class="text-danger">*</span></label>
            <input type="text" id="score-student-search" class="form-control fw-bold border-success" list="scoreStudentList" placeholder="이름 입력 후 선택" onchange="document.getElementById('score-student-id').value = this.list.querySelector('option[value=\\''+this.value+'\\']')?.dataset.id || ''">
            <datalist id="scoreStudentList">${studentOptions}</datalist>
            <input type="hidden" id="score-student-id">
          </div>
          <div class="row g-3 mb-3">
            <div class="col-6">
              <label class="form-label fw-bold small text-muted">시험 일자 <span class="text-danger">*</span></label>
              <input type="date" id="score-date" class="form-control" value="${new Date().toISOString().substring(0, 10)}">
            </div>
            <div class="col-6">
              <label class="form-label fw-bold small text-muted">시험 종류</label>
              <select id="score-type" class="form-select">
                <option value="단원평가">단원평가</option>
                <option value="월말평가">월말평가</option>
                <option value="중간고사">중간고사</option>
                <option value="기말고사">기말고사</option>
                <option value="모의고사">모의고사</option>
              </select>
            </div>
            <div class="col-12">
              <label class="form-label fw-bold small text-muted">과목</label>
              <input type="text" id="score-subject" class="form-control" value="수학">
            </div>
            <div class="col-6">
              <label class="form-label fw-bold small text-muted">획득 점수 <span class="text-danger">*</span></label>
              <input type="number" id="score-score" class="form-control fw-bold text-primary" placeholder="예: 95">
            </div>
            <div class="col-6">
              <label class="form-label fw-bold small text-muted">만점 기준</label>
              <input type="number" id="score-total" class="form-control" value="100">
            </div>
            <div class="col-12">
              <label class="form-label fw-bold small text-muted">비고 (코멘트)</label>
              <input type="text" id="score-memo" class="form-control" placeholder="틀린 유형이나 피드백 간단히 기록">
            </div>
          </div>
        </div>
        <div class="modal-footer bg-white">
          <button class="btn btn-secondary rounded-pill fw-bold" data-bs-dismiss="modal">취소</button>
          <button class="btn btn-success rounded-pill fw-bold px-4 shadow-sm" onclick="saveScore()"><i class="bi bi-check-circle-fill me-1"></i> 저장하기</button>
        </div>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  new bootstrap.Modal(document.getElementById('scoreModal')).show();
};

// =================================================================
// 🚀 [고속 통신] 성적 데이터 초고속 저장 (429 에러 방지)
// =================================================================
window.saveScore = async function () {
  const name = document.getElementById('score-student-search').value.trim();
  const id = document.getElementById('score-student-id').value.trim();
  const date = document.getElementById('score-date').value;
  const type = document.getElementById('score-type').value;
  const subject = document.getElementById('score-subject').value.trim();
  const score = document.getElementById('score-score').value.trim();
  const total = document.getElementById('score-total').value.trim();
  const memo = document.getElementById('score-memo').value.trim();

  if (!name || !id) { alert('학생을 검색하고 목록에서 선택해주세요.'); return; }
  if (!score) { alert('점수를 입력해주세요.'); return; }

  showLoader(true);
  try {
    // 구글 시트 '성적DB' 컬럼 순서에 맞게 배열(Array) 생성
    // [타임스탬프, 학생ID, 학생명, 시험일자, 시험종류, 과목, 점수, 만점, 비고, 강사명]
    const rowData = [
      new Date().toLocaleString('ko-KR'),
      id,
      name,
      date,
      type,
      subject || '수학',
      score,
      total || '100',
      memo,
      appCache.user.name
    ];

    const body = { values: [rowData] };

    // 시트 맨 아래 빈 줄에 다이렉트 추가 (append)
    const sheetName = CONFIG?.SHEETS?.SCORE || '성적DB';
    await callSheetsAPI('POST', `/values/${encodeURIComponent(sheetName)}:append?valueInputOption=USER_ENTERED`, body);

    showLoader(false);
    alert('📊 성적이 1초 만에 안전하게 저장되었습니다!');

    // 모달 닫기 및 화면 새로고침
    bootstrap.Modal.getInstance(document.getElementById('scoreModal')).hide();

    // 성적 데이터 새로고침 함수가 있다면 호출 (없으면 화면 전환으로 대체)
    if (typeof refreshScoreData === 'function') {
      await refreshScoreData();
    } else {
      forceRefresh();
    }
  } catch (e) {
    showLoader(false);
    alert('저장 중 오류가 발생했습니다: ' + e.message);
  }
};

// =================================================================
// 🚀 [업그레이드] 소통형 공지사항 게시판 (진행중 최상단 / 완료는 맨 밑으로)
// =================================================================
window.renderNoticeBoard = function () {
  let notices = (appCache.raw && appCache.raw.notices) || [];
  let activeNotices = notices.slice(1).filter(n => n[3] !== '삭제');

  // 💡 1. 일단 무조건 최신 글이 위로 오게 전체를 뒤집습니다.
  activeNotices.reverse();

  // 💡 2. '진행중'인 놈들과 '완료'된 놈들을 두 그룹으로 쪼갭니다.
  const ongoing = activeNotices.filter(n => n[3] !== '완료');
  const completed = activeNotices.filter(n => n[3] === '완료');

  // 💡 3. 진행중인 공지를 위에, 완료된 공지를 밑에 합쳐버립니다! (우선순위 정렬 끝)
  activeNotices = [...ongoing, ...completed];

  let html = `
    <div class="card p-0 shadow-sm border-0 h-100 border-top border-info border-4">
        <div class="card-header bg-white pt-3 pb-2 d-flex justify-content-between align-items-center">
            <h6 class="fw-bold text-info m-0"><i class="bi bi-megaphone-fill"></i> 학원 공용 공지사항</h6>
            <button class="btn btn-sm btn-outline-info rounded-pill" onclick="refreshNoticeData()"><i class="bi bi-arrow-clockwise"></i></button>
        </div>
        <div class="card-body p-3 bg-light">
            <div class="input-group mb-3 shadow-sm">
                <input type="text" class="form-control border-info" id="newNoticeInput" placeholder="새 공지 입력..." onkeyup="if(event.keyCode===13) addNotice()">
                <button class="btn btn-info text-white fw-bold px-3" onclick="addNotice()" id="btn-add-notice">등록</button>
            </div>
            <div class="list-group" style="max-height: 300px; overflow-y: auto;">
  `;

  if (activeNotices.length === 0) {
    html += `<div class="text-center text-muted small py-4">등록된 공지가 없습니다.</div>`;
  } else {
    activeNotices.forEach((n) => {
      let date = n[0] ? n[0].substring(5, 16) : '';
      let author = n[1] || '알수없음';
      let content = n[2] || '';
      let status = n[3] || '진행';
      let comments = [];
      try { comments = JSON.parse(n[4] || '[]'); } catch (e) { }

      let badge = status === '완료' ? `<span class="badge bg-secondary shadow-sm">완료됨</span>` : `<span class="badge bg-danger shadow-sm" style="animation: pulse 2s infinite;">진행중</span>`;
      let opacity = status === '완료' ? 'opacity-75' : '';
      let safeData = encodeURIComponent(JSON.stringify({ id: n[0], author, content, status, date, comments }));

      html += `
            <div class="list-group-item list-group-item-action p-3 mb-2 rounded shadow-sm border-0 ${opacity} bg-white" style="cursor:pointer;" onclick="openNoticeModal('${safeData}')">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <div>${badge} <span class="fw-bold ms-1 text-dark" style="font-size:0.85rem;">${author}</span></div>
                    <small class="text-muted" style="font-size:0.7rem;">${date}</small>
                </div>
                <div class="fw-bold text-dark text-truncate" style="font-size:0.9rem;">${content}</div>
                ${comments.length > 0 ? `<div class="mt-2 text-muted small fw-bold"><i class="bi bi-chat-dots-fill text-primary"></i> 댓글 ${comments.length}개</div>` : ''}
            </div>`;
    });
  }
  html += `</div></div></div>`;
  return html;
};

// 공지사항 상세 보기 및 댓글 달기 모달
window.openNoticeModal = function (encodedData) {
  const d = JSON.parse(decodeURIComponent(encodedData));

  let commentsHtml = d.comments.map(c => `
        <div class="bg-white p-2 rounded border mb-2 shadow-sm">
            <div class="d-flex justify-content-between mb-1">
                <strong class="small text-primary">${c.author}</strong>
                <small class="text-muted" style="font-size:0.7rem;">${c.time}</small>
            </div>
            <div class="small text-dark">${c.text}</div>
        </div>
    `).join('');

  if (!commentsHtml) commentsHtml = '<div class="text-center text-muted small py-3">첫 댓글을 남겨보세요!</div>';

  const modalHtml = `
    <div class="modal fade" id="noticeDetailModal" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content border-0 shadow-lg bg-light">
          <div class="modal-header bg-info text-white">
            <h5 class="modal-title fw-bold"><i class="bi bi-megaphone-fill"></i> 공지 및 소통 상세</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body p-4">
            <div class="bg-white p-3 rounded shadow-sm mb-4 border">
                <div class="d-flex justify-content-between mb-2">
                    <span class="badge ${d.status === '완료' ? 'bg-secondary' : 'bg-danger'}">${d.status}</span>
                    <small class="text-muted fw-bold">${d.date} · ${d.author}</small>
                </div>
                <div class="fw-bold text-dark mt-2" style="white-space:pre-wrap;">${d.content}</div>
            </div>

            <h6 class="fw-bold text-muted small mb-2"><i class="bi bi-chat-dots"></i> 진행 상황 및 댓글</h6>
            <div style="max-height:200px; overflow-y:auto;" class="mb-3 pe-2" id="notice-comments-list">
                ${commentsHtml}
            </div>

            <div class="input-group input-group-sm shadow-sm">
                <input type="text" class="form-control border-info px-2" id="noticeCommentInput" placeholder="댓글 내용 입력..." onkeyup="if(event.keyCode===13) addNoticeComment('${d.id}')">
                <button class="btn btn-info text-white fw-bold px-3" onclick="addNoticeComment('${d.id}')">등록</button>
            </div>
          </div>
          <div class="modal-footer justify-content-between bg-white">
            ${(appCache.user.role === '원장' || appCache.user.name === d.author) ?
      `<button class="btn btn-sm btn-outline-danger fw-bold rounded-pill" onclick="deleteNotice('${d.id}')">삭제</button>` : '<div></div>'}
            <div>
                <button class="btn btn-secondary rounded-pill fw-bold me-2" data-bs-dismiss="modal">닫기</button>
                ${d.status !== '완료' ? `<button class="btn btn-success rounded-pill fw-bold px-3 shadow" onclick="completeNotice('${d.id}')"><i class="bi bi-check-circle-fill me-1"></i> 처리 완료</button>` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>`;

  const existing = document.getElementById('noticeDetailModal');
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  new bootstrap.Modal(document.getElementById('noticeDetailModal')).show();
};

// 새 공지 등록 (E열 댓글 칸 비워두기)
window.addNotice = async function () {
  let input = document.getElementById('newNoticeInput');
  let text = input.value.trim();
  if (!text) return;
  let btn = document.getElementById('btn-add-notice');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
  try {
    const rowData = [new Date().toLocaleString('ko-KR'), appCache.user.name, text, "진행", "[]"];
    await callSheetsAPI('POST', `/values/${encodeURIComponent(CONFIG.SHEETS.NOTICE)}:append?valueInputOption=USER_ENTERED`, { values: [rowData] });
    await refreshNoticeData();
  } catch (e) { alert("공지 등록 실패: " + e.message); }
  finally { btn.disabled = false; btn.innerHTML = '등록'; }
};

// 댓글 등록 (E열 JSON 파싱 및 저장)
window.addNoticeComment = async function (id) {
  const input = document.getElementById('noticeCommentInput');
  const text = input.value.trim();
  if (!text) return;
  showLoader(true, "댓글 등록 중...");
  try {
    const sheetName = CONFIG.SHEETS.NOTICE;
    const res = await callSheetsAPI('GET', `/values/${encodeURIComponent(sheetName)}!A:E`);
    const values = res.values || [];
    const rowIndex = values.findIndex(r => r[0] === id);
    if (rowIndex < 0) throw new Error("공지를 찾을 수 없습니다.");

    let comments = [];
    try { comments = JSON.parse(values[rowIndex][4] || '[]'); } catch (e) { }
    comments.push({ author: appCache.user.name, text: text, time: new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) });

    const rowNum = rowIndex + 1;
    await callSheetsAPI('PUT', `/values/${encodeURIComponent(sheetName + '!E' + rowNum)}?valueInputOption=USER_ENTERED`, { values: [[JSON.stringify(comments)]] });

    await refreshNoticeData();
    bootstrap.Modal.getInstance(document.getElementById('noticeDetailModal')).hide();

    // 데이터 새로고침 후 모달 다시 열어서 댓글 보여주기
    const updatedRow = appCache.raw.notices.find(r => r[0] === id);
    if (updatedRow) {
      const safeData = encodeURIComponent(JSON.stringify({ id: updatedRow[0], author: updatedRow[1], content: updatedRow[2], status: updatedRow[3], date: updatedRow[0].substring(5, 16), comments: comments }));
      openNoticeModal(safeData);
    }
  } catch (e) { alert('댓글 등록 실패: ' + e.message); }
  showLoader(false);
};

// 💡 [핵심] 처리 완료 버튼 (모달 닫고 뒤로 튕기기)
window.completeNotice = async function (id) {
  if (!confirm("이 업무/공지를 '처리 완료' 상태로 변경하시겠습니까?")) return;
  showLoader(true, "완료 처리 중...");
  try {
    const sheetName = CONFIG.SHEETS.NOTICE;
    const res = await callSheetsAPI('GET', `/values/${encodeURIComponent(sheetName)}!A:D`);
    const values = res.values || [];
    const rowIndex = values.findIndex(r => r[0] === id);
    if (rowIndex < 0) throw new Error("공지를 찾을 수 없습니다.");

    const rowNum = rowIndex + 1;
    await callSheetsAPI('PUT', `/values/${encodeURIComponent(sheetName + '!D' + rowNum)}?valueInputOption=USER_ENTERED`, { values: [["완료"]] });

    await refreshNoticeData();
    // 모달을 닫아버림 (원장님이 원하신 뒤로가기 효과)
    bootstrap.Modal.getInstance(document.getElementById('noticeDetailModal')).hide();
  } catch (e) { alert('처리 실패: ' + e.message); }
  showLoader(false);
};

// 공지사항 삭제
window.deleteNotice = async function (timestampId) {
  if (!confirm("이 공지사항을 삭제하시겠습니까?")) return;
  showLoader(true, "삭제 중...");
  try {
    const sheetName = CONFIG.SHEETS.NOTICE;
    const res = await callSheetsAPI('GET', `/values/${encodeURIComponent(sheetName)}!A:D`);
    const rowIndex = (res.values || []).findIndex(r => r[0] === timestampId);
    if (rowIndex < 0) throw new Error("데이터를 찾을 수 없습니다.");
    await callSheetsAPI('PUT', `/values/${encodeURIComponent(sheetName + '!D' + (rowIndex + 1))}?valueInputOption=USER_ENTERED`, { values: [["삭제"]] });
    await refreshNoticeData();
    const m = bootstrap.Modal.getInstance(document.getElementById('noticeDetailModal'));
    if (m) m.hide();
  } catch (e) { alert("오류: " + e.message); }
  showLoader(false);
};

window.refreshNoticeData = async function () {
  try {
    const res = await callSheetsAPI('GET', `/values/${encodeURIComponent(CONFIG.SHEETS.NOTICE)}!A:E`);
    if (!appCache.raw) appCache.raw = {};
    appCache.raw.notices = res.values || [];
    if (typeof loadDashboardView === 'function') loadDashboardView();
  } catch (e) { console.error(e); }
};

// =================================================================
// 🚀 [테스트 전용] 강사 빙의 (계정 스위치) 플로팅 위젯 (위치 및 디자인 수정)
// =================================================================
window.createTestLoginWidget = function () {
  // 💡 [보안] 로그인한 사람의 권한이 '원장'이 아니면 위젯을 아예 그리지 않고 종료! (강사는 절대 못 봄)
  if (!appCache.user || appCache.user.role !== '원장') return;

  if (document.getElementById('test-login-widget')) return;

  const teachers = appCache.raw.teachers || [];
  let options = `<option value="원장|김인주">👑 김인주 (원장)</option>`;

  teachers.forEach(t => {
    if (t[1] && t[4] !== '퇴사' && !t[1].includes('김인주')) {
      options += `<option value="강사|${t[1]}">👨‍🏫 ${t[1]} (강사)</option>`;
    }
  });

  const widget = document.createElement('div');
  widget.id = 'test-login-widget';

  // 💡 [수정] 모달창의 저장 버튼을 가리지 않도록 bottom을 20px에서 90px로 훌쩍 올렸습니다.
  // 💡 [수정] 평소에는 반투명(opacity: 0.7)하게 있다가, 마우스를 올리면 선명해집니다.
  widget.style.cssText = 'position:fixed; bottom:90px; right:25px; z-index:9999; background:white; padding:12px; border-radius:10px; box-shadow:0 10px 25px rgba(0,0,0,0.2); border:2px solid #f59e0b; width:200px; transition: all 0.3s ease; opacity: 0.7;';

  widget.onmouseenter = () => widget.style.opacity = '1';
  widget.onmouseleave = () => widget.style.opacity = '0.7';

  widget.innerHTML = `
        <label class="form-label fw-bold text-warning small mb-2 m-0"><i class="bi bi-incognito"></i> 원장님 전용 스위치</label>
        <select class="form-select form-select-sm border-warning fw-bold" onchange="switchTestUser(this.value)">
            <option value="">테스트 계정 선택...</option>
            ${options}
        </select>
    `;
  document.body.appendChild(widget);
};

window.switchTestUser = function (val) {
  if (!val) return;
  const [role, name] = val.split('|');

  // 앱의 현재 유저 정보를 강제로 덮어쓰기
  appCache.user = { role: role, name: name };

  alert(`[테스트 모드] '${name}' (${role}) 계정으로 전환되었습니다!`);

  // 권한에 맞게 좌측 메뉴 숨기기/보이기 다시 실행
  if (typeof applyUserRoleUI === 'function') {
    applyUserRoleUI();
  }

  // 대시보드로 강제 이동해서 바뀐 화면 보여주기
  switchView('DASHBOARD');
};

// =========================================
// 초기화 (Google 로그인 버튼 렌더링)
// =========================================
window.onload = function () {
  initGoogleAuth();
};

// =================================================================
// 🚀 [신규 기능] 기록 조회 - 수업 상세내역 모달
// =================================================================
window.showHistoryDetail = function (encodedData) {
  const d = JSON.parse(decodeURIComponent(encodedData));
  const modalHtml = `
  <div class="modal fade" id="historyDetailModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content border-0 shadow-lg">
        <div class="modal-header bg-primary text-white">
          <h5 class="modal-title fw-bold"><i class="bi bi-file-text"></i> 수업 기록 상세정보</h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body bg-light">
          <h5 class="fw-bold text-dark">${d.student} <span class="badge ${d.att === '출석' ? 'bg-success' : (d.att === '결석' ? 'bg-danger' : 'bg-warning')} ms-2">${d.att}</span></h5>
          <p class="text-muted small mb-3"><i class="bi bi-calendar"></i> ${d.date} | 👨‍🏫 ${d.teacher}</p>
          
          <div class="card border-0 shadow-sm mb-2">
            <div class="card-body py-2 px-3 small">
              <strong>진도:</strong><br>
              <div style="padding-left:10px; color:#475569;">${d.modalProg || '-'}</div>
              <strong>과제:</strong> ${d.hw || '-'}
            </div>
          </div>
          
          ${(d.t1Tot || d.t2Tot) ? `
          <div class="card border-0 shadow-sm mb-2">
            <div class="card-body py-2 px-3 small">
              ${d.t1Tot ? `<strong>T1 (${d.t1Type}):</strong> ${d.t1Cor} / ${d.t1Tot}<br>` : ''}
              ${d.t2Tot ? `<strong>T2 (${d.t2Type}):</strong> ${d.t2Cor} / ${d.t2Tot}` : ''}
            </div>
          </div>` : ''}

          <div class="card border-0 shadow-sm mb-2">
            <div class="card-body py-2 px-3 small text-dark">
              ${d.indivLearning ? `<div class="mb-1"><strong>📖 학습내용:</strong> ${d.indivLearning}</div>` : ''}
              ${d.hwFeedback ? `<div class="mb-1"><strong>📝 과제피드백:</strong> ${d.hwFeedback}</div>` : ''}
              ${d.memo ? `<div class="mb-1"><strong>💬 종합코멘트:</strong> ${d.memo}</div>` : ''}
              ${d.praise ? `<div class="mb-1"><strong>👍 칭찬:</strong> ${d.praise}</div>` : ''}
              ${d.effort ? `<div class="mb-1"><strong>💪 노력:</strong> ${d.effort}</div>` : ''}
              ${d.parentsNote ? `<div class="mb-1"><strong>📢 안내:</strong> ${d.parentsNote}</div>` : ''}
              ${d.eventNotice ? `<div class="mb-1"><strong>🎉 행사:</strong> ${d.eventNotice}</div>` : ''}
              ${(!d.indivLearning && !d.hwFeedback && !d.memo && !d.praise && !d.effort && !d.parentsNote && !d.eventNotice) ? '<span class="text-muted">입력된 피드백이 없습니다.</span>' : ''}
            </div>
          </div>
          
          ${d.privateMemo ? `
          <div class="alert alert-danger py-2 px-3 small mb-0 border-0 shadow-sm">
            <strong>🔒 선생님 비밀메모:</strong> ${d.privateMemo}
          </div>` : ''}
        </div>
      </div>
    </div>
  </div>`;

  const existing = document.getElementById('historyDetailModal');
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  new bootstrap.Modal(document.getElementById('historyDetailModal')).show();
};

// =========================================
// 👨‍🏫 강사 전용 대시보드 위젯 (오늘의 보강만 띄우기!)
// =========================================
window.loadTeacherDashboardWidgets = function () {
  if (!appCache.user) return;
  const myName = appCache.user.name;
  const todayStr = new Date().toISOString().substring(0, 10);

  const allMakeups = appCache.raw['보강일정DB'] || appCache.raw.makeups || [];

  // 💡 [변경] 부등호(>=)를 등호(===)로 바꿔서 '어제'나 '내일' 보강은 쏙 빼고 오직 "오늘" 보강만 띄웁니다!
  const myMakeups = allMakeups.filter(r => r && (r[6] || '').includes(myName) && (r[3] || '').substring(0, 10) === todayStr);

  const allStudents = appCache.raw.students || [];
  const myStudents = allStudents.filter(s => s && (s[6] || '').includes(myName) && s[7] !== '퇴원');

  if (window.renderTeacherWidgetsUI) window.renderTeacherWidgetsUI(myMakeups, myStudents);
};

// =========================================
// 🎨 하단 위젯 UI 렌더링 (코드 최적화 및 접기 기능)
// =========================================
window.renderTeacherWidgetsUI = function (makeups, students) {
  const container = document.getElementById('dashboard-bottom-widgets');
  if (!container) return;

  // 1. 보강 일정 리스트 HTML 만들기
  const makeupsListHtml = makeups.length === 0
    ? `<li class="list-group-item text-muted text-center py-4 bg-light border-0">예정된 보강이 없습니다.</li>`
    : makeups.map(m => {
      const date = (m[3] || '').substring(0, 10);
      const time = `${m[4] || ''}~${m[5] || ''}`;
      return `
          <li class="list-group-item d-flex justify-content-between align-items-center bg-white border-bottom">
              <div>
                  <span class="badge bg-warning text-dark me-2">${date}</span>
                  <span class="fw-bold text-dark">${m[1] || '이름미상'}</span> 
                  <small class="text-muted ms-1">(${time})</small>
              </div>
              <button class="btn btn-sm btn-outline-warning fw-bold rounded-pill" onclick="openStudentProfileModal('${m[0]}', '${m[1]}')">상세</button>
          </li>`;
    }).join('');

  // 2. 전담 학생 리스트 HTML 만들기
  const studentsListHtml = students.length === 0
    ? `<li class="list-group-item text-muted text-center py-4 bg-light border-0">배정된 전담 학생이 없습니다.</li>`
    : students.map(s => {
      const issues = (appCache.raw['이슈DB'] || []).filter(r => r[0] === s[0] && (r[4] === '대기' || r[4] === '진행'));
      const issueBadge = issues.length > 0 ? `<span class="badge bg-danger rounded-pill ms-2 shadow-sm" style="animation: pulse 2s infinite;">🚨 이슈 ${issues.length}건</span>` : '';
      return `
          <li class="list-group-item d-flex justify-content-between align-items-center bg-white border-bottom">
              <div>
                  <span class="fw-bold text-dark">${s[1] || ''}</span> 
                  <small class="text-muted ms-1">(${s[3] || ''} ${s[4] || ''})</small>
                  ${issueBadge} 
              </div>
              <button class="btn btn-sm btn-outline-success fw-bold rounded-pill" onclick="openStudentProfileModal('${s[0]}', '${s[1]}')">프로필</button>
          </li>`;
    }).join('');

  // 3. 전체 레이아웃 조립 (collapse show 추가로 스르륵 접기 완벽 호환!)
  container.innerHTML = `
    <div class="row g-4">
      <div class="col-12 collapse show" id="sec-makeups">
        <div class="summary-card warning-card shadow-sm border-0" style="border-radius: 16px; overflow: hidden; background: #fff;">
          <div class="card-header bg-white border-0 pt-4 pb-2 d-flex justify-content-between align-items-center" data-bs-toggle="collapse" data-bs-target="#collapseMakeupsList" style="cursor: pointer;">
              <h6 class="fw-bold m-0" style="color: #d97706;"><i class="bi bi-clock-history"></i> 나의 보강 일정</h6>
              <span class="badge bg-warning text-dark rounded-pill px-3 py-2 shadow-sm">목록 열기 ▾</span>
          </div>
          <div class="card-body py-3 bg-white" data-bs-toggle="collapse" data-bs-target="#collapseMakeupsList" style="cursor: pointer;">
              <div class="summary-number text-center fs-1 fw-bold" style="color: #d97706;">${makeups.length}<span class="fs-5 ms-1 text-muted fw-normal">건</span></div>
              <p class="summary-desc text-center text-muted small mt-2 mb-0">${makeups.length === 0 ? '예정된 보강이 없습니다 🎉' : '확인해야 할 보강 일정이 있습니다.'}</p>
          </div>
          <div class="collapse ${makeups.length > 0 ? 'show' : ''}" id="collapseMakeupsList">
              <ul class="list-group list-group-flush" style="max-height: 250px; overflow-y: auto; border-top: 1px solid #f1f3f5;">
                ${makeupsListHtml}
              </ul>
          </div>
        </div>
      </div>

      <div class="col-12 collapse show" id="sec-students">
        <div class="summary-card success-card shadow-sm border-0" style="border-radius: 16px; overflow: hidden; background: #fff;">
          <div class="card-header bg-white border-0 pt-4 pb-2 d-flex justify-content-between align-items-center" data-bs-toggle="collapse" data-bs-target="#collapseStudentsList" style="cursor: pointer;">
              <h6 class="fw-bold m-0 text-success"><i class="bi bi-people-fill"></i> 나의 전담 학생</h6>
              <span class="badge bg-success rounded-pill px-3 py-2 shadow-sm">목록 열기 ▾</span>
          </div> 
          <div class="card-body py-3 bg-white" data-bs-toggle="collapse" data-bs-target="#collapseStudentsList" style="cursor: pointer;">
              <div class="summary-number text-center fs-1 fw-bold" style="color: #28a745;">${students.length}<span class="fs-5 ms-1 text-muted fw-normal">명</span></div>
              <p class="summary-desc text-center text-muted small mt-2 mb-0">${students.length === 0 ? '배정된 전담 학생이 없습니다.' : '선생님이 관리 중인 전담 학생입니다.'}</p>
          </div>
          <div class="collapse ${students.length > 0 ? 'show' : ''}" id="collapseStudentsList">
              <ul class="list-group list-group-flush" style="max-height: 250px; overflow-y: auto; border-top: 1px solid #f1f3f5;">
                ${studentsListHtml}
              </ul>
          </div>
        </div>
      </div>
    </div>
  `;
};

// =========================================
// 👨‍🏫 [옵션 C] 학생 이슈 트래커 UI 및 동작 로직
// =========================================
window.getIssueTrackerHTML = function (sId) {
  const issues = (appCache.raw['이슈DB'] || []).filter(r => r[0] === sId);
  let html = `
  <hr class="my-4" style="border-top: 2px dashed #cbd5e1;">
  <h6 class="fw-bold text-primary mb-3"><i class="bi bi-chat-square-text"></i> 선생님 간 인수인계 & 이슈 트래커</h6>
  <div class="bg-light p-3 rounded shadow-sm border mb-2">
      <div style="max-height: 250px; overflow-y: auto;" class="mb-3 pe-2">`;

  if (issues.length === 0) {
    html += `<div class="text-center text-muted small py-4">등록된 이슈가 없습니다. 첫 코멘트를 남겨보세요!</div>`;
  } else {
    issues.forEach(issue => {
      const date = (issue[1] || '').substring(5, 16).replace('T', ' ');
      const author = issue[2] || '알수없음';
      const content = issue[3] || '';
      const status = issue[4] || '대기';
      let badgeColor = 'bg-danger';
      if (status === '진행') badgeColor = 'bg-warning text-dark';
      if (status === '완료') badgeColor = 'bg-success';
      html += `
          <div class="bg-white border rounded p-2 mb-2 shadow-sm">
              <div class="d-flex justify-content-between align-items-center mb-1">
                  <div>
                      <span class="badge ${badgeColor} me-1">${status}</span>
                      <strong class="small text-dark">${author}</strong>
                  </div>
                  <small class="text-muted" style="font-size:0.7rem;"><i class="bi bi-clock"></i> ${date}</small>
              </div>
              <div class="small text-dark mt-1" style="white-space: pre-wrap; line-height: 1.4;">${content}</div>
          </div>`;
    });
  }
  html += `
      </div>
      <div class="input-group input-group-sm shadow-sm">
          <select class="form-select border-primary text-center fw-bold bg-white" id="newIssueStatus" style="max-width: 90px; cursor: pointer;">
              <option value="대기">🔴 대기</option>
              <option value="진행">🟡 진행</option>
              <option value="완료">🟢 완료</option>
          </select>
          <input type="text" class="form-control border-primary px-2" id="newIssueContent" placeholder="상담 결과나 이슈를 적어주세요..." onkeyup="if(event.keyCode===13) addNewIssue('${sId}')">
          <button class="btn btn-primary fw-bold px-3" onclick="addNewIssue('${sId}')">등록</button>
      </div>
  </div>`;
  return html;
};

window.saveStudentIssue = async function (issueObj) {
  const sheetName = '이슈DB';
  const rowData = [
    issueObj.studentId,
    new Date().toISOString().substring(0, 16).replace('T', ' '),
    appCache.user.name,
    issueObj.content,
    issueObj.status || '대기',
    issueObj.feedback || ''
  ];
  await callSheetsAPI('POST', `/values/${encodeURIComponent(sheetName + '!A:F')}:append?valueInputOption=USER_ENTERED`, { values: [rowData] });
};

window.addNewIssue = async function (sId) {
  const contentInput = document.getElementById('newIssueContent');
  const statusInput = document.getElementById('newIssueStatus');
  if (!contentInput.value.trim()) return alert('이슈 내용을 입력해주세요.');

  const issueObj = { studentId: sId, content: contentInput.value.trim(), status: statusInput.value };
  const btn = event.currentTarget;
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
  btn.disabled = true;

  try {
    await window.saveStudentIssue(issueObj);
    if (typeof showLoader === 'function') showLoader(true, '이슈를 업데이트 중입니다...');
    await loadInitialData();
    if (typeof showLoader === 'function') showLoader(false);
    const studentRecord = (appCache.raw.students || []).find(s => s[0] === sId);
    const sName = studentRecord ? studentRecord[1] : '';
    openStudentProfileModal(sId, sName);
  } catch (e) {
    alert('등록 실패: ' + e.message);
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
};
// =================================================================
// 🚀 [보안 및 메뉴 통합 패치] 로그인 권한에 따른 좌측 메뉴 통제
// =================================================================
window.applyUserRoleUI = function () {
  if (!appCache.user) return;
  const role = appCache.user.role;
  const toggleMenu = (id, displayType) => {
    const el = document.getElementById(id);
    if (el) el.style.display = displayType;
  };

  // 1. 공통 메뉴 (대시보드, 시간표)
  toggleMenu('menu-DASHBOARD', 'block');
  toggleMenu('menu-SCHEDULE', 'block');

  if (role === '원장' || role === '관리자') {
    // 👑 원장님: 모든 메뉴 오픈
    toggleMenu('menu-STUDENT', 'block');
    toggleMenu('menu-REGISTER', 'block');
    toggleMenu('menu-COUNSEL', 'block');
    toggleMenu('menu-HISTORY', 'block');
    toggleMenu('menu-SCORE', 'block');
    toggleMenu('menu-BOOK', 'block');
    toggleMenu('menu-TATT', 'block');
    toggleMenu('menu-ABSENT', 'block');
    if (typeof createTestLoginWidget === 'function') createTestLoginWidget();
  } else if (role === '데스크') {
    // 👩‍💻 데스크용 메뉴
    toggleMenu('menu-STUDENT', 'block');
    toggleMenu('menu-REGISTER', 'block');
    toggleMenu('menu-COUNSEL', 'block');
    toggleMenu('menu-ABSENT', 'block');
    toggleMenu('menu-BOOK', 'block');
    toggleMenu('menu-HISTORY', 'none');
    toggleMenu('menu-SCORE', 'none');
    toggleMenu('menu-TATT', 'none');
  } else {
    // 👨‍🏫 강사: 원장님 지시대로 본인 학생 관련 메뉴 전면 오픈
    toggleMenu('menu-STUDENT', 'block'); // 학생 관리
    toggleMenu('menu-COUNSEL', 'block'); // 상담 기록
    toggleMenu('menu-HISTORY', 'block'); // 기록 조회
    toggleMenu('menu-SCORE', 'block');   // 성적 관리
    toggleMenu('menu-ABSENT', 'block');  // 보강 관리
    toggleMenu('menu-TATT', 'block');    // 강사 근태
    toggleMenu('menu-REGISTER', 'none'); // 행정 차단
    toggleMenu('menu-BOOK', 'none');     // 행정 차단
  }
};

// =================================================================
// 🚀 [신규] 알림톡 템플릿 제작소 (태그 버튼 삽입 및 시트 자동 공유)
// =================================================================
// =================================================================
// 🚀 [신규] 기존 템플릿 불러오기 및 수정 로직 추가
// =================================================================
window.editSelectedTemplate = function (idx) {
  const val = document.getElementById(`template_${idx}`).value;
  if (val === "") {
    alert("💙 기본 템플릿은 수정할 수 없습니다.\n우측 상단의 '템플릿 제작 및 공유' 버튼을 눌러 새 템플릿을 만들거나, 다른 커스텀 템플릿을 선택해주세요.");
  } else {
    window.openTemplateBuilder(val);
  }
};

window.openTemplateBuilder = function (tIdx = null) {
  let tbIdxInput = document.getElementById('tb-idx');
  if (!tbIdxInput) {
    tbIdxInput = document.createElement('input');
    tbIdxInput.type = 'hidden';
    tbIdxInput.id = 'tb-idx';
    document.getElementById('templateBuilderModal').appendChild(tbIdxInput);
  }

  const saveBtn = document.getElementById('btn-save-template');

  if (tIdx !== null && appCache.templates[tIdx]) {
    document.getElementById('tb-title').value = appCache.templates[tIdx].title;
    document.getElementById('tb-content').value = appCache.templates[tIdx].content;
    tbIdxInput.value = tIdx;
    if (saveBtn) saveBtn.innerText = '수정하기';
  } else {
    document.getElementById('tb-title').value = '';
    document.getElementById('tb-content').value = '안녕하세요. 수학의 힘 💙{학생이름} 담임 {강사이름}입니다.🥰\n\n';
    tbIdxInput.value = '';
    if (saveBtn) saveBtn.innerText = '저장하기';
  }

  const tagContainer = document.querySelector('#templateBuilderModal .d-flex.flex-wrap.gap-1');
  if (tagContainer) {
    tagContainer.innerHTML = `
      <button class="btn btn-sm btn-outline-primary fw-bold" onclick="insertTag('{학생이름}')">{학생이름}</button>
      <button class="btn btn-sm btn-outline-primary fw-bold" onclick="insertTag('{강사이름}')">{강사이름}</button>
      <button class="btn btn-sm btn-outline-primary fw-bold" onclick="insertTag('{날짜}')">{날짜}</button>
      <button class="btn btn-sm btn-outline-success fw-bold" onclick="insertTag('{오늘진도}')">{오늘진도}</button>
      <button class="btn btn-sm btn-outline-success fw-bold" onclick="insertTag('{다음과제}')">{다음과제}</button>
      <button class="btn btn-sm btn-outline-danger fw-bold" onclick="insertTag('{테스트종류}')">{테스트종류}</button>
      <button class="btn btn-sm btn-outline-danger fw-bold" onclick="insertTag('{맞은개수}')">{맞은개수}</button>
      <button class="btn btn-sm btn-outline-danger fw-bold" onclick="insertTag('{전체개수}')">{전체개수}</button>
      <button class="btn btn-sm btn-outline-danger fw-bold" onclick="insertTag('{테스트피드백}')">{테스트피드백}</button>
      <button class="btn btn-sm btn-outline-secondary fw-bold" onclick="insertTag('{개별학습}')">{개별학습}</button>
      <button class="btn btn-sm btn-outline-secondary fw-bold" onclick="insertTag('{과제피드백}')">{과제피드백}</button>
      <button class="btn btn-sm btn-outline-secondary fw-bold" onclick="insertTag('{종합안내}')">{종합안내}</button>
      <button class="btn btn-sm btn-outline-secondary fw-bold" onclick="insertTag('{새교재}')">{새교재}</button>
      <button class="btn btn-sm btn-outline-warning fw-bold" onclick="insertTag('{칭찬}')">{칭찬}</button>
      <button class="btn btn-sm btn-outline-warning fw-bold" onclick="insertTag('{노력}')">{노력}</button>
      <button class="btn btn-sm btn-outline-info fw-bold" onclick="insertTag('{부모님께}')">{부모님께}</button>
      <button class="btn btn-sm btn-outline-info fw-bold" onclick="insertTag('{행사안내}')">{행사안내}</button>
    `;
  }

  let modalEl = document.getElementById('templateBuilderModal');
  let modal = bootstrap.Modal.getInstance(modalEl);
  if (!modal) modal = new bootstrap.Modal(modalEl);
  modal.show();
};

window.saveTemplate = async function () {
  const title = document.getElementById('tb-title').value.trim();
  const content = document.getElementById('tb-content').value.trim();
  const tIdx = document.getElementById('tb-idx')?.value;

  if (!title || !content) return alert("제목과 내용을 모두 입력해주세요.");

  const btn = document.getElementById('btn-save-template');
  const originalText = btn ? btn.innerText : '저장';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 저장중...'; }

  try {
    const sheetName = (typeof CONFIG !== 'undefined' && CONFIG.SHEETS && CONFIG.SHEETS.ALIMTALK) ? CONFIG.SHEETS.ALIMTALK : '알림톡양식';

    if (tIdx !== undefined && tIdx !== '') {
      const oldTitle = appCache.templates[tIdx].title;
      const res = await callSheetsAPI('GET', `/values/${encodeURIComponent(sheetName)}!A:B`);
      const rows = res.values || [];
      const rowIndex = rows.findIndex(r => r[0] === oldTitle);

      if (rowIndex > -1) {
        const rowNum = rowIndex + 1;
        await callSheetsAPI('PUT', `/values/${encodeURIComponent(sheetName + '!A' + rowNum + ':B' + rowNum)}?valueInputOption=USER_ENTERED`, { values: [[title, content]] });
      } else {
        await callSheetsAPI('POST', `/values/${encodeURIComponent(sheetName)}:append?valueInputOption=USER_ENTERED`, { values: [[title, content]] });
      }
    } else {
      await callSheetsAPI('POST', `/values/${encodeURIComponent(sheetName)}:append?valueInputOption=USER_ENTERED`, { values: [[title, content]] });
    }

    alert("템플릿이 저장(수정)되었습니다.");
    bootstrap.Modal.getInstance(document.getElementById('templateBuilderModal')).hide();

    if (typeof loadInitialData === 'function') {
      showLoader(true, "템플릿 갱신 중...");
      await loadInitialData();
      showLoader(false);
    } else {
      forceRefresh();
    }
  } catch (e) {
    alert("저장 실패: " + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = originalText; }
  }
};

// =================================================================
// 🚀 [접근성] 학생 프로필 글자 확대 기능 (돋보기 버튼)
// =================================================================
window.isProfileZoomed = false;
window.toggleProfileZoom = function (btnEl) {
  const body = document.getElementById('studentProfileBody');
  if (!body) return;

  window.isProfileZoomed = !window.isProfileZoomed;

  if (window.isProfileZoomed) {
    body.style.zoom = "1.5"; // 150% 시원하게 확대!
    btnEl.innerHTML = '<i class="bi bi-zoom-out"></i> 원래대로';
    btnEl.classList.replace('btn-light', 'btn-warning');
    btnEl.classList.replace('text-primary', 'text-dark');
  } else {
    body.style.zoom = "1.0"; // 100% 콤팩트 모드로 복구
    btnEl.innerHTML = '<i class="bi bi-zoom-in"></i> 글자 돋보기';
    btnEl.classList.replace('btn-warning', 'btn-light');
    btnEl.classList.replace('text-dark', 'text-primary');
  }
};
// =================================================================
// 🚀 [접근성] 앱 전체 화면 확대/축소 기능 (사이드바 짤림 완벽 해결)
// =================================================================
window.isGlobalZoomed = false;
window.toggleGlobalZoom = function () {
  window.isGlobalZoomed = !window.isGlobalZoomed;
  const btn = document.getElementById('btn-global-zoom');
  const sidebar = document.getElementById('sidebar'); // 💡 사이드바 멱살 잡기

  if (window.isGlobalZoomed) {
    document.body.style.zoom = "1.25";

    // 💡 핵심 마법: 화면이 1.25배 커진 만큼, 높이를 80vh로 줄여서 모니터 안에 딱 맞게 가둡니다! (80 x 1.25 = 100)
    if (sidebar) sidebar.style.height = "80vh";

    if (btn) {
      btn.innerHTML = '<i class="bi bi-zoom-out"></i> 원래 크기로';
      btn.classList.replace('btn-outline-warning', 'btn-warning');
      btn.classList.add('text-dark');
    }
  } else {
    document.body.style.zoom = "1.0";

    // 💡 원상 복구 시 다시 100vh로 돌려놓기
    if (sidebar) sidebar.style.height = "100vh";

    if (btn) {
      btn.innerHTML = '<i class="bi bi-zoom-in"></i> 화면 크게 보기';
      btn.classList.replace('btn-warning', 'btn-outline-warning');
      btn.classList.remove('text-dark');
    }
  }
};
// =================================================================
// 🛡️ [데이터 보호] 수업 중 화면 방치 시 데이터 날아감 방지 마법
// =================================================================

// 1. 실수로 창 닫기/새로고침 누를 때 경고창 띄우기
window.addEventListener('beforeunload', function (e) {
  const isModalOpen = document.querySelector('.modal.show');
  if (isModalOpen) {
    e.preventDefault();
    e.returnValue = '작성 중인 내용이 날아갈 수 있습니다. 진짜 새로고침 하시겠습니까?';
  }
});

// 2. 5초마다 현재 열린 창의 입력값을 브라우저 내부에 몰래 자동 백업
window.startAutoBackup = function () {
  setInterval(() => {
    const modal = document.querySelector('.modal.show');
    if (!modal) return;

    let backupData = {};
    modal.querySelectorAll('input[type="text"], textarea, select').forEach(el => {
      if (el.id && el.value.trim() !== '') {
        backupData[el.id] = el.value;
      }
    });

    if (Object.keys(backupData).length > 0) {
      localStorage.setItem('academy_backup_data', JSON.stringify(backupData));
    }
  }, 5000);
};
setTimeout(window.startAutoBackup, 2000); // 앱 실행 후 가동

// 3. 에러로 튕겼을 때 즉시 꺼내 쓰는 긴급 복구 함수
window.restoreBackupData = function () {
  const saved = localStorage.getItem('academy_backup_data');
  if (!saved) {
    alert('임시저장된 데이터가 없습니다.');
    return;
  }
  if (confirm('가장 마지막으로 작성하던(5초 전) 내용을 복구하시겠습니까?')) {
    const data = JSON.parse(saved);
    for (let key in data) {
      const el = document.getElementById(key);
      if (el) el.value = data[key];
    }
  }
};
// =================================================================
// 🚀 [초고속 실시간 검색 엔진] 화면 깜빡임 없이 즉시 학생 필터링
// =================================================================
window.filterTableRows = function (inputId, tableId, cellIdx) {
  const inputEl = document.getElementById(inputId);
  if (!inputEl) return;

  const keyword = inputEl.value.toLowerCase().trim();
  const rows = document.querySelectorAll(`#${tableId} tbody tr`);

  rows.forEach(row => {
    if (row.cells.length <= 1) return; // '데이터 없음' 안내 문구는 무시
    const targetCell = row.cells[cellIdx];
    if (targetCell) {
      const text = targetCell.textContent.toLowerCase();
      row.style.display = text.includes(keyword) ? '' : 'none';
    }
  });
};
// =================================================================
// 🚀 [신규] 템플릿 제작소 - 태그 자동 삽입 기능
// =================================================================
window.insertTag = function (tag) {
  const textarea = document.getElementById('tb-content');
  if (!textarea) return;

  // 현재 마우스 커서 위치 찾기
  const startPos = textarea.selectionStart;
  const endPos = textarea.selectionEnd;

  // 기존 텍스트를 반으로 쪼개서 그 사이에 태그 끼워넣기
  const textBefore = textarea.value.substring(0, startPos);
  const textAfter = textarea.value.substring(endPos, textarea.value.length);

  textarea.value = textBefore + tag + textAfter;

  // 커서 위치를 방금 넣은 태그 바로 뒤로 이동시키고 포커스 유지
  textarea.selectionStart = startPos + tag.length;
  textarea.selectionEnd = startPos + tag.length;
  textarea.focus();
};
// =================================================================
// 🚀 [복구] 신규 학생 등록 모달 & 폼 로직
// =================================================================
window.openNewStudentModal = function () {
  let existing = document.getElementById('newStudentModal');
  if (existing) existing.remove();

  const modalHtml = `
  <div class="modal fade" id="newStudentModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content" style="border-radius: 20px; border: none; box-shadow: 0 10px 30px rgba(0,0,0,0.1);">
        <div class="modal-header bg-primary text-white" style="border-radius: 20px 20px 0 0; padding: 1.2rem 1.5rem;">
          <h5 class="modal-title fw-bold m-0"><i class="bi bi-person-plus-fill me-2"></i>신규 학생 등록</h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body p-4 bg-light">
          <div class="mb-3">
            <label class="form-label fw-bold text-dark small">학생 이름 <span class="text-danger">*</span></label>
            <input type="text" id="newStuName" class="form-control form-control-lg border-0 shadow-sm" placeholder="예: 홍길동">
          </div>
          <div class="row g-3 mb-3">
            <div class="col-6">
              <label class="form-label fw-bold text-dark small">학교</label>
              <input type="text" id="newStuSchool" class="form-control border-0 shadow-sm" placeholder="예: 수완하나중">
            </div>
            <div class="col-6">
              <label class="form-label fw-bold text-dark small">학년</label>
              <select id="newStuGrade" class="form-select border-0 shadow-sm">
                <option value="">선택</option>
                <option value="초1">초1</option><option value="초2">초2</option><option value="초3">초3</option>
                <option value="초4">초4</option><option value="초5">초5</option><option value="초6">초6</option>
                <option value="중1">중1</option><option value="중2">중2</option><option value="중3">중3</option>
                <option value="고1">고1</option><option value="고2">고2</option><option value="고3">고3</option>
              </select>
            </div>
          </div>
          <div class="mb-3">
            <label class="form-label fw-bold text-dark small">학생 연락처</label>
            <input type="tel" id="newStuPhone" class="form-control border-0 shadow-sm" placeholder="010-0000-0000">
          </div>
          <div class="mb-3">
            <label class="form-label fw-bold text-dark small">학부모 연락처 <span class="text-danger">*</span></label>
            <input type="tel" id="newStuParentPhone" class="form-control border-0 shadow-sm" placeholder="010-0000-0000">
          </div>
        </div>
        <div class="modal-footer border-0 p-3 bg-white" style="border-radius: 0 0 20px 20px;">
          <button type="button" class="btn btn-light fw-bold w-100 mb-2 rounded-pill" data-bs-dismiss="modal">취소</button>
          <button type="button" class="btn btn-primary fw-bold w-100 m-0 py-2 rounded-pill shadow-sm" onclick="saveNewStudent()">등록 완료</button>
        </div>
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const modal = new bootstrap.Modal(document.getElementById('newStudentModal'));
  modal.show();
};

// =================================================================
// 🚀 [복구 완료] 신규 학생 등록 (A열 수식 보호 & 구글 시트 핀셋 저장)
// =================================================================
window.saveNewStudent = async function () {
  const name = document.getElementById('newStuName').value.trim();
  const school = document.getElementById('newStuSchool').value.trim();
  let grade = document.getElementById('newStuGrade').value;
  const phone = document.getElementById('newStuPhone').value.trim();
  const parentPhone = document.getElementById('newStuParentPhone').value.trim();

  if (!name) return alert('학생 이름을 입력해주세요!');
  if (!parentPhone) return alert('학부모 연락처를 입력해주세요!');

  // 학년(예: 초1)을 바탕으로 학부(초등부)와 학년 포맷(1학년) 자동 변환
  let dept = '';
  if (grade) {
    if (grade.includes('초')) dept = '초등부';
    else if (grade.includes('중')) dept = '중등부';
    else if (grade.includes('고')) dept = '고등부';

    grade = grade.replace(/[초중고]/g, '') + '학년'; // '초1' -> '1학년'
  }

  if (confirm(`[${name}] 학생을 신규 등록하시겠습니까?`)) {
    const btn = document.querySelector('#newStudentModal .btn-primary');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 등록 중...';
    btn.disabled = true;

    try {
      const today = new Date().toISOString().substring(0, 10);
      const sheetName = (typeof CONFIG !== 'undefined' && CONFIG.SHEETS && CONFIG.SHEETS.STUDENT) ? CONFIG.SHEETS.STUDENT : '원천DB';

      // 💡 [궁극의 수식 보호 패치] A열을 건드리지 않기 위해 B열의 길이를 재서 빈 줄을 찾습니다.
      const res = await callSheetsAPI('GET', `/values/${encodeURIComponent(sheetName + '!B:B')}`);
      const bCol = res.values || [];
      const nextRow = bCol.length + 1;

      // 💡 B열부터 L열까지 들어갈 데이터 배열 생성
      const rowData = [
        name,           // B: 학생명
        dept,           // C: 학부
        school,         // D: 학교
        grade,          // E: 학년
        "",             // F: 반ID
        "",             // G: 강사ID
        "재원",         // H: 재원상태
        today,          // I: 등록일
        "",             // J: 종료일
        parentPhone,    // K: 부모 연락처
        phone           // L: 학생 연락처
      ];

      // 💡 PUT 방식으로 정확하게 B~L열 칸에만 밀어 넣습니다.
      await callSheetsAPI('PUT',
        `/values/${encodeURIComponent(sheetName + '!B' + nextRow + ':L' + nextRow)}?valueInputOption=USER_ENTERED`,
        { values: [rowData] }
      );

      alert(`✅ [${name}] 학생이 성공적으로 등록되었습니다!`);

      const modalEl = document.getElementById('newStudentModal');
      const modalInst = bootstrap.Modal.getInstance(modalEl);
      if (modalInst) modalInst.hide();

      // 저장 완료 후 화면 새로고침
      if (typeof forceRefresh === 'function') forceRefresh();

    } catch (e) {
      alert('등록 실패: ' + e.message);
    } finally {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }
};
// =================================================================
// 🚨 [긴급 복구] 삭제되었던 코어 네비게이션 & UI 제어 함수들
// =================================================================

window.showLoader = function (show, msg = "데이터를 불러오는 중...") {
  const overlay = document.getElementById('loading-overlay');
  const msgEl = document.getElementById('loading-msg');
  if (overlay) {
    if (show) {
      if (msgEl) msgEl.textContent = msg;
      overlay.classList.add('active');
    } else {
      overlay.classList.remove('active');
    }
  }
};

window.showErrorMsg = function (msg) {
  if (window.showLoader) window.showLoader(false);
  const errDiv = document.getElementById('login-error');
  if (errDiv) {
    errDiv.innerHTML = `<i class="bi bi-exclamation-triangle-fill me-2"></i>${msg}`;
    errDiv.classList.remove('d-none');
  } else {
    alert("오류 발생: " + msg);
  }
};

window.switchView = function (viewId) {
  document.querySelectorAll('.menu-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById(`menu-${viewId}`);
  if (activeBtn) activeBtn.classList.add('active');

  // 모바일 헤더 타이틀 업데이트
  const viewTitles = {
    DASHBOARD: '대시보드', SCHEDULE: '주간 시간표', ABSENTEE: '보강 관리', ABSENT: '보강 관리',
    STUDENT: '학생 관리', REGISTER: '수강 등록', COUNSEL: '상담 기록', COUNSEL_REQ: '상담 요청',
    HISTORY: '기록 조회', SCORE: '성적 관리', BOOK: '교재 관리', TATT: '강사 근태'
  };
  const titleEl = document.getElementById('mobile-page-title');
  if (titleEl) titleEl.textContent = viewTitles[viewId] || '수학의 힘';

  const viewContainer = document.getElementById('view-container');
  if (viewContainer) {
    viewContainer.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>';
  }

  if (window.innerWidth < 768) {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('open');
    const overlay = document.getElementById('sidebar-overlay');
    if (overlay) overlay.classList.remove('open');
  }

  try {
    switch (viewId) {
      case 'DASHBOARD': if (window.loadDashboardView) window.loadDashboardView(); break;
      case 'SCHEDULE': if (window.loadScheduleView) window.loadScheduleView(); break;
      case 'STUDENT': if (window.loadStudentView) window.loadStudentView(); break;
      case 'REGISTER': if (window.loadRegisterView) window.loadRegisterView(); break;
      case 'COUNSEL': if (window.loadCounselView) window.loadCounselView(); break;
      case 'COUNSEL_REQ': if (window.loadCounselRequestView) window.loadCounselRequestView(); break;
      case 'HISTORY': if (window.loadHistoryView) window.loadHistoryView(); break;
      case 'SCORE': if (window.loadScoreView) window.loadScoreView(); break;
      case 'BOOK': if (window.loadBookView) window.loadBookView(); break;
      case 'TATT': if (window.loadTeacherAttView) window.loadTeacherAttView(); break;
      case 'ABSENT': if (window.loadAbsenteeView) window.loadAbsenteeView(); break;
    }
    window.scrollTo(0, 0);
  } catch (e) {
    console.error('View Switch Error:', e);
    if (viewContainer) {
      viewContainer.innerHTML = `<div class="alert alert-danger">화면을 불러오지 못했습니다: ${e.message}</div>`;
    }
  }
};

window.forceRefresh = async function () {
  if (typeof window.showLoader === 'function') {
    window.showLoader(true, "구글 시트의 최신 데이터를 불러오는 중...");
  }
  try {
    // 코어 엔진 캐시 초기화
    appCache.studentMap = null;
    appCache.studentNameMap = null;

    if (typeof loadInitialData === 'function') {
      await loadInitialData();
    }
    alert("🔄 최신 데이터로 완벽하게 업데이트 되었습니다.");
  } catch (error) {
    console.error("새로고침 오류:", error);
    alert("데이터를 불러오는 중 오류가 발생했습니다.\n다시 시도해주세요.");
  } finally {
    if (typeof window.showLoader === 'function') window.showLoader(false);
  }
};

window.logoutApp = function () {
  if (!confirm("로그아웃 하시겠습니까?")) return;
  localStorage.clear();
  location.reload();
};

window.toggleSidebar = function () {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.toggle('open');
  // 오버레이 자동 생성 및 토글
  let overlay = document.getElementById('sidebar-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'sidebar-overlay';
    overlay.onclick = function () { window.toggleSidebar(); };
    document.body.appendChild(overlay);
  }
  overlay.classList.toggle('open');
};
// =========================================
// 🚀 [긴급 복구] 성적 관리 뷰 및 팝업창 
// =========================================
window.loadScoreView = async function () {
  try {
    const role = (appCache.user.role || '').trim();
    const isManager = (role === '원장' || role === '데스크' || role === '관리자');
    const myName = (appCache.user.name || '').trim();

    if (isManager) {
      try {
        const created = await ensureScoreSheet();
        if (created) appCache.raw.scores = [];
      } catch (e) { console.warn('성적DB 체크 건너뜀:', e.message); }
    }

    const scores = (appCache.raw && appCache.raw.scores) || [];
    const sorted = [...scores].reverse();

    let tableRows = '';
    if (sorted.length === 0) tableRows = `<tr><td colspan="8" class="text-center py-5 text-muted">등록된 성적 데이터가 없습니다.</td></tr>`;
    else {
      const filtered = isManager ? sorted : sorted.filter(r => (r[9] || '').includes(myName));
      filtered.forEach(r => {
        const date = (r[3] || '').substring(0, 10); const student = r[2] || '-'; const examType = r[4] || '-'; const subject = r[5] || '-'; const score = r[6] !== undefined && r[6] !== '' ? r[6] : '-'; const total = r[7] || '100'; const memo = r[8] || ''; const teacher = r[9] || '-';
        const pct = (score !== '-' && total) ? Math.round(parseFloat(score) / parseFloat(total) * 100) : null;
        const pctColor = pct === null ? '' : pct >= 90 ? 'text-success' : pct >= 70 ? 'text-primary' : pct >= 50 ? 'text-warning' : 'text-danger';
        let typeBadge = 'bg-secondary'; if (examType.includes('중간')) typeBadge = 'bg-danger'; else if (examType.includes('단원')) typeBadge = 'bg-primary'; else if (examType.includes('월말')) typeBadge = 'bg-info text-white';
        tableRows += `<tr style="font-size:0.83rem;"><td class="text-muted fw-bold">${date}</td><td class="fw-bold">${student}</td><td><span class="badge ${typeBadge} rounded-pill">${examType}</span></td><td>${subject}</td><td class="fw-bold fs-6 text-center">${score}</td><td class="text-center text-muted">/ ${total}</td><td class="fw-bold ${pctColor} text-center">${pct !== null ? pct + '%' : '-'}</td><td class="text-muted small">${memo || (isManager ? teacher : '')}</td></tr>`;
      });
      if (!tableRows) tableRows = `<tr><td colspan="8" class="text-center py-5 text-muted">해당 권한에 맞는 성적 데이터가 없습니다.</td></tr>`;
    }

    document.getElementById('view-container').innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-4">
        <h4 class="fw-bold m-0"><i class="bi bi-bar-chart-fill me-2 text-success"></i>성적 관리</h4>
        <div class="d-flex gap-2">
          <input type="text" id="scoreSearchInput" class="form-control form-control-sm border-success rounded-pill px-3 shadow-sm" placeholder="🔍 학생명 검색..." style="width: 150px;" onkeyup="filterTableRows('scoreSearchInput', 'scoreTable', 1)">
          <button class="btn btn-outline-secondary btn-sm rounded-pill text-nowrap" onclick="refreshScoreData()"><i class="bi bi-arrow-clockwise"></i></button>
          <button class="btn btn-success btn-sm rounded-pill fw-bold text-nowrap" onclick="openScoreModal()"><i class="bi bi-plus-lg"></i> 입력</button>
        </div>
      </div>
      <div class="card shadow-sm border-0">
        <div class="table-responsive" style="max-height:65vh;">
          <table class="table table-hover align-middle mb-0" id="scoreTable">
            <thead class="table-light sticky-top"><tr style="font-size:0.82rem;"><th>시험일</th><th>학생명</th><th>시험종류</th><th>과목</th><th class="text-center">점수</th><th class="text-center">만점</th><th class="text-center">성취율</th><th>${isManager ? '강사' : '비고'}</th></tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      </div>`;
  } catch (e) {
    document.getElementById('view-container').innerHTML = `<div class="alert alert-danger m-4">성적 관리 로딩 오류: ${e.message}</div>`;
  }
};

window.openScoreModal = function () {
  let existing = document.getElementById('scoreModal');
  if (existing) existing.remove();

  let studentOptions = '';
  if (appCache.raw && appCache.raw.students) {
    let sorted = [];
    for (let i = 1; i < appCache.raw.students.length; i++) {
      if (appCache.raw.students[i][0]) sorted.push({ id: appCache.raw.students[i][0], name: appCache.raw.students[i][1], school: appCache.raw.students[i][3] });
    }
    sorted.sort((a, b) => a.name.localeCompare(b.name)).forEach(s => {
      studentOptions += `<option value="${s.name} (${s.school})" data-id="${s.id}">`;
    });
  }

  const modalHtml = `
  <div class="modal fade" id="scoreModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content border-0 shadow-lg">
        <div class="modal-header bg-success text-white">
          <h5 class="modal-title fw-bold"><i class="bi bi-plus-lg"></i> 성적 입력</h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body p-4 bg-light">
          <div class="mb-3">
            <label class="form-label fw-bold small text-muted">학생 검색 <span class="text-danger">*</span></label>
            <input type="text" id="score-student-search" class="form-control fw-bold border-success" list="scoreStudentList" placeholder="이름 입력 후 선택" onchange="document.getElementById('score-student-id').value = this.list.querySelector('option[value=\\''+this.value+'\\']')?.dataset.id || ''">
            <datalist id="scoreStudentList">${studentOptions}</datalist>
            <input type="hidden" id="score-student-id">
          </div>
          <div class="row g-3 mb-3">
            <div class="col-6">
              <label class="form-label fw-bold small text-muted">시험 일자 <span class="text-danger">*</span></label>
              <input type="date" id="score-date" class="form-control" value="${new Date().toISOString().substring(0, 10)}">
            </div>
            <div class="col-6">
              <label class="form-label fw-bold small text-muted">시험 종류</label>
              <select id="score-type" class="form-select">
                <option value="단원평가">단원평가</option>
                <option value="월말평가">월말평가</option>
                <option value="중간고사">중간고사</option>
                <option value="기말고사">기말고사</option>
                <option value="모의고사">모의고사</option>
              </select>
            </div>
            <div class="col-12">
              <label class="form-label fw-bold small text-muted">과목</label>
              <input type="text" id="score-subject" class="form-control" value="수학">
            </div>
            <div class="col-6">
              <label class="form-label fw-bold small text-muted">획득 점수 <span class="text-danger">*</span></label>
              <input type="number" id="score-score" class="form-control fw-bold text-primary" placeholder="예: 95">
            </div>
            <div class="col-6">
              <label class="form-label fw-bold small text-muted">만점 기준</label>
              <input type="number" id="score-total" class="form-control" value="100">
            </div>
            <div class="col-12">
              <label class="form-label fw-bold small text-muted">비고 (코멘트)</label>
              <input type="text" id="score-memo" class="form-control" placeholder="틀린 유형이나 피드백 간단히 기록">
            </div>
          </div>
        </div>
        <div class="modal-footer bg-white">
          <button class="btn btn-secondary rounded-pill fw-bold" data-bs-dismiss="modal">취소</button>
          <button class="btn btn-success rounded-pill fw-bold px-4 shadow-sm" onclick="saveScore()"><i class="bi bi-check-circle-fill me-1"></i> 저장하기</button>
        </div>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  new bootstrap.Modal(document.getElementById('scoreModal')).show();
};

// =========================================
// 🔐 재원 필터 헬퍼 (v2에서만 사용)
// =========================================
window.getActiveStudents = function() {
  const students = (appCache.raw.students || []).slice(1);
  return students.filter(s => s[7] === '재원');
};

window.getActiveSchedules = function() {
  const activeStudents = window.getActiveStudents();
  const activeStudentIds = new Set(activeStudents.map(s => s[0]));
  const allSchedules = (appCache.raw.schedules || []).slice(1);
  return allSchedules.filter(s => activeStudentIds.has(s[3]));
};


// =========================================
// 👤 학생 상세 정보 (상태 표시 강화)
// =========================================
window.showStudentDetail = function(studentId) {
  const allStudents = (appCache.raw.students || []).slice(1);
  const student = allStudents.find(s => s[0] === studentId);
  
  if (!student) {
    alert('학생 정보를 찾을 수 없습니다.');
    return;
  }

  const [id, name, phone, parent, parentPhone, joinDate, teacher, status, leaveDate] = student;
  
  // 상태 색상 및 텍스트
  let statusBadge = '';
  let statusWarning = '';
  
  if (status === '재원') {
    statusBadge = '<span class="badge bg-success">재원중</span>';
    statusWarning = '';
  } else if (status === '휴원') {
    statusBadge = '<span class="badge bg-warning text-dark">휴원</span>';
    statusWarning = `<div class="alert alert-warning border-2 border-warning mb-3">
      <i class="bi bi-exclamation-triangle-fill me-2"></i>
      <strong>⚠️ 휴원 상태입니다</strong>
      <br><small>휴원일: ${leaveDate || '미정'}</small>
    </div>`;
  } else if (status === '퇴원') {
    statusBadge = '<span class="badge bg-danger">퇴원</span>';
    statusWarning = `<div class="alert alert-danger border-2 border-danger mb-3">
      <i class="bi bi-x-circle-fill me-2"></i>
      <strong>❌ 퇴원 완료</strong>
      <br><small>퇴원일: ${leaveDate || '미정'}</small>
    </div>`;
  } else {
    statusBadge = `<span class="badge bg-secondary">${status}</span>`;
  }

  const html = `
    <div class="modal fade" id="studentDetailModal" tabindex="-1">
      <div class="modal-dialog modal-lg">
        <div class="modal-content border-0">
          <div class="modal-header ${status === '재원' ? 'bg-success' : status === '휴원' ? 'bg-warning' : 'bg-danger'} text-white">
            <div>
              <h5 class="modal-title fw-bold mb-0">${name}</h5>
              <small>${id} ${statusBadge}</small>
            </div>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>

          <div class="modal-body">
            ${statusWarning}
            
            <div class="row">
              <div class="col-md-6">
                <label class="text-muted small fw-bold">학생명</label>
                <p class="fw-bold mb-3">${name}</p>
                
                <label class="text-muted small fw-bold">학생ID</label>
                <p class="mb-3">${id}</p>
                
                <label class="text-muted small fw-bold">연락처</label>
                <p class="mb-3">${phone || '-'}</p>
              </div>
              <div class="col-md-6">
                <label class="text-muted small fw-bold">보호자명</label>
                <p class="fw-bold mb-3">${parent || '-'}</p>
                
                <label class="text-muted small fw-bold">보호자 연락처</label>
                <p class="mb-3">${parentPhone || '-'}</p>
                
                <label class="text-muted small fw-bold">담당 강사</label>
                <p class="mb-3">${teacher || '-'}</p>
              </div>
            </div>

            <div class="alert alert-info">
              <small>
                <strong>등록일:</strong> ${joinDate || '-'}<br>
                ${leaveDate ? `<strong>${status === '휴원' ? '휴원일' : '퇴원일'}:</strong> ${leaveDate}` : ''}
              </small>
            </div>
          </div>

          <div class="modal-footer">
            ${appCache.user.role === '원장' && status === '재원' ? `
              <button type="button" class="btn btn-danger fw-bold" onclick="markStudentAsWithdrawn('${id}', '${name}')">
                <i class="bi bi-x-circle me-1"></i>퇴원 처리
              </button>
            ` : ''}
            ${appCache.user.role === '원장' && status === '휴원' ? `
              <button type="button" class="btn btn-warning fw-bold text-dark" onclick="markStudentAsActive('${id}', '${name}')">
                <i class="bi bi-arrow-clockwise me-1"></i>복귀 처리
              </button>
            ` : ''}
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">닫기</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);
  const modal = new bootstrap.Modal(document.getElementById('studentDetailModal'));
  modal.show();

  document.getElementById('studentDetailModal').addEventListener('hidden.bs.modal', function() {
    this.remove();
  });
};


// =========================================
// 퇴원/복귀 처리 함수
// =========================================
window.markStudentAsPaused = async function(studentId, studentName) {
  if (!confirm(`${studentName} 학생을 휴원 처리하시겠습니까?`)) return;

  try {
    const today = new Date().toISOString().substring(0, 10);
    const students = (appCache.raw.students || []).slice(1);
    const studentRowIdx = students.findIndex(s => s[0] === studentId);

    if (studentRowIdx === -1) {
      alert('학생 정보를 찾을 수 없습니다.');
      return;
    }

    const sheetName = '원천DB';
    const rowNum = studentRowIdx + 2;

    // H컬럼(상태) = 휴원, I컬럼(날짜) = 오늘
    await callSheetsAPI('PUT', `/values/${encodeURIComponent(sheetName + '!H' + rowNum)}?valueInputOption=USER_ENTERED`, { values: [['휴원']] });
    await callSheetsAPI('PUT', `/values/${encodeURIComponent(sheetName + '!I' + rowNum)}?valueInputOption=USER_ENTERED`, { values: [[today]] });

    appCache.raw.students[studentRowIdx + 1][7] = '휴원';
    appCache.raw.students[studentRowIdx + 1][8] = today;

    alert(`${studentName} 학생이 휴원 처리되었습니다.`);

    const modal = bootstrap.Modal.getInstance(document.getElementById('studentProfileModal'));
    if (modal) modal.hide();

    loadStudentView();
  } catch (e) {
    alert('휴원 처리 중 오류: ' + e.message);
  }
};

window.markStudentAsWithdrawn = async function(studentId, studentName) {
  if (!confirm(`${studentName} 학생을 퇴원 처리하시겠습니까?`)) return;

  try {
    const today = new Date().toISOString().substring(0, 10);
    const students = (appCache.raw.students || []).slice(1);
    const studentRowIdx = students.findIndex(s => s[0] === studentId);
    
    if (studentRowIdx === -1) {
      alert('학생 정보를 찾을 수 없습니다.');
      return;
    }

    const sheetName = '원천DB';
    const rowNum = studentRowIdx + 2; // 헤더 1줄 + 시작줄

    // H컬럼(상태) = 퇴원, I컬럼(날짜) = 오늘
    await callSheetsAPI('PUT', `/values/${encodeURIComponent(sheetName + '!H' + rowNum)}?valueInputOption=USER_ENTERED`, { values: [['퇴원']] });
    await callSheetsAPI('PUT', `/values/${encodeURIComponent(sheetName + '!I' + rowNum)}?valueInputOption=USER_ENTERED`, { values: [[today]] });

    appCache.raw.students[studentRowIdx + 1][7] = '퇴원';
    appCache.raw.students[studentRowIdx + 1][8] = today;

    alert(`${studentName} 학생이 퇴원 처리되었습니다.`);
    
    // 모달 닫기
    const modal = bootstrap.Modal.getInstance(document.getElementById('studentDetailModal'));
    if (modal) modal.hide();
    
    loadStudentView();
  } catch (e) {
    alert('퇴원 처리 중 오류: ' + e.message);
  }
};

window.markStudentAsActive = async function(studentId, studentName) {
  if (!confirm(`${studentName} 학생을 복귀 처리하시겠습니까?`)) return;

  try {
    const students = (appCache.raw.students || []).slice(1);
    const studentRowIdx = students.findIndex(s => s[0] === studentId);
    
    if (studentRowIdx === -1) {
      alert('학생 정보를 찾을 수 없습니다.');
      return;
    }

    const sheetName = '원천DB';
    const rowNum = studentRowIdx + 2;

    // H컬럼(상태) = 재원, I컬럼(날짜) = 빈칸
    await callSheetsAPI('PUT', `/values/${encodeURIComponent(sheetName + '!H' + rowNum)}?valueInputOption=USER_ENTERED`, { values: [['재원']] });
    await callSheetsAPI('PUT', `/values/${encodeURIComponent(sheetName + '!I' + rowNum)}?valueInputOption=USER_ENTERED`, { values: [['']] });

    appCache.raw.students[studentRowIdx + 1][7] = '재원';
    appCache.raw.students[studentRowIdx + 1][8] = '';

    alert(`${studentName} 학생이 복귀 처리되었습니다.`);
    
    const modal = bootstrap.Modal.getInstance(document.getElementById('studentDetailModal'));
    if (modal) modal.hide();
    
    loadStudentView();
  } catch (e) {
    alert('복귀 처리 중 오류: ' + e.message);
  }
};

// =========================================
// 📞 상담 요청 시스템
// =========================================

window.openCounselRequestModal = function(studentId = '', studentName = '') {
  const teachers = (appCache.raw.teachers || []).slice(1);
  const students = (appCache.raw.students || []).slice(1);

  let teacherOptions = '<option value="">강사 선택</option>';
  teachers.forEach(t => {
    if (t[0] && t[1]) teacherOptions += `<option value="${t[1]}">${t[1]}</option>`;
  });

  let studentOptions = '<option value="">학생 선택</option>';
  students.forEach(s => {
    if (s[0] && s[1] && s[7] === '재원') {
      studentOptions += `<option value="${s[0]}" data-name="${s[1]}">${s[1]} (${s[0]})</option>`;
    }
  });

  const today = new Date().toISOString().split('T')[0];
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const modalHTML = `
    <div class="modal fade" id="counselRequestModal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header bg-gradient">
            <h5 class="modal-title fw-bold"><i class="bi bi-calendar-check"></i> 상담 요청</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label fw-bold">학생 <span class="text-danger">*</span></label>
              <select id="counselReqStudent" class="form-select">
                ${studentOptions}
              </select>
            </div>
            <div class="mb-3">
              <label class="form-label fw-bold">담당 강사 <span class="text-danger">*</span></label>
              <select id="counselReqTeacher" class="form-select">
                ${teacherOptions}
              </select>
            </div>
            <div class="mb-3">
              <label class="form-label fw-bold">상담 유형 <span class="text-danger">*</span></label>
              <select id="counselReqType" class="form-select">
                <option value="">선택</option>
                <option value="신규상담">신규상담</option>
                <option value="정기 상담">정기 상담</option>
                <option value="대면상담">대면상담</option>
                <option value="학부모 전화 상담 요청">학부모 전화 상담 요청</option>
              </select>
            </div>
            <div class="mb-3">
              <label class="form-label fw-bold">상담 예정 날짜 <span class="text-danger">*</span></label>
              <input type="date" id="counselReqDate" class="form-control" value="${today}">
            </div>
            <div class="mb-3">
              <label class="form-label fw-bold">마감일 (Due Date) <span class="text-danger">*</span></label>
              <input type="date" id="counselReqDueDate" class="form-control" value="${nextWeek}">
            </div>
            <div class="mb-3">
              <label class="form-label">상담 내용 (선택)</label>
              <textarea id="counselReqContent" class="form-control" rows="3" placeholder="상담 내용 입력..."></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">취소</button>
            <button type="button" class="btn btn-primary" onclick="saveCounselRequest()">요청 저장</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const existing = document.getElementById('counselRequestModal');
  if (existing) existing.remove();

  document.body.insertAdjacentHTML('beforeend', modalHTML);
  new bootstrap.Modal(document.getElementById('counselRequestModal')).show();

  if (studentId) {
    document.getElementById('counselReqStudent').value = studentId;
  }
};

window.saveCounselRequest = async function() {
  const studentSelect = document.getElementById('counselReqStudent');
  const teacherSelect = document.getElementById('counselReqTeacher');
  const typeSelect = document.getElementById('counselReqType');
  const dateInput = document.getElementById('counselReqDate');
  const dueDateInput = document.getElementById('counselReqDueDate');
  const contentInput = document.getElementById('counselReqContent');

  const studentId = studentSelect.value;
  const studentName = studentSelect.options[studentSelect.selectedIndex].getAttribute('data-name');
  const teacher = teacherSelect.value;
  const type = typeSelect.value;
  const date = dateInput.value;
  const dueDate = dueDateInput.value;
  const content = contentInput.value;

  if (!studentId || !teacher || !type || !date || !dueDate) {
    alert('필수 항목을 모두 입력해주세요.');
    return;
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    const rowData = [
      today,           // A: 일자
      studentName,     // B: 학생명
      studentId,       // C: 학생ID
      '',              // D: (비어있음)
      date,            // E: 상담일자
      type,            // F: 상담유형
      teacher,         // G: 담당자
      '',              // H: 상담대상
      '',              // I: 상담내용
      today,           // J: 요청일자
      dueDate,         // K: 마감일
      '요청',          // L: 상태
      appCache.user.name, // M: 요청자
      ''               // N: 메모
    ];

    const sheetName = CONFIG.SHEETS.COUNSEL;
    await appendSheetData(CONFIG.SPREADSHEET_ID, sheetName, [rowData]);

    alert('상담 요청이 저장되었습니다!');
    bootstrap.Modal.getInstance(document.getElementById('counselRequestModal')).hide();

    if (typeof loadCounselRequestView === 'function') {
      loadCounselRequestView();
    }
  } catch (e) {
    alert('저장 중 오류: ' + e.message);
  }
};

window.loadCounselRequestView = function() {
  const isManager = appCache.user && appCache.user.role === '원장';
  const myName = appCache.user ? appCache.user.name : '';

  if (!appCache.raw || !appCache.raw.counsels) {
    alert('상담 데이터를 로드할 수 없습니다.');
    return;
  }

  const counsels = appCache.raw.counsels.slice(1);
  const requests = counsels.filter(r => r[9]); // 요청일자가 있는 것만 (상담 요청)

  let html = `
    <div class="container-fluid py-4">
      <div class="d-flex justify-content-between align-items-center mb-4">
        <h3 class="fw-bold m-0"><i class="bi bi-calendar-check text-info me-2"></i>상담 요청 현황</h3>
        <button class="btn btn-primary btn-sm" onclick="openCounselRequestModal()"><i class="bi bi-plus-circle me-1"></i>새 요청</button>
      </div>

      <div class="row g-3 mb-4">
  `;

  // 통계 카드
  const pending = requests.filter(r => r[10] && r[10] < new Date().toISOString().split('T')[0] && r[11] !== '완료');
  const upcoming = requests.filter(r => r[10] && r[11] !== '완료');
  const completed = requests.filter(r => r[11] === '완료');

  html += `
    <div class="col-md-3">
      <div class="card border-0 shadow-sm bg-danger bg-opacity-10">
        <div class="card-body text-center">
          <h4 class="fw-bold text-danger m-0">${pending.length}</h4>
          <small class="text-muted">마감 임박</small>
        </div>
      </div>
    </div>
    <div class="col-md-3">
      <div class="card border-0 shadow-sm bg-warning bg-opacity-10">
        <div class="card-body text-center">
          <h4 class="fw-bold text-warning m-0">${upcoming.filter(r => r[11] !== '완료').length}</h4>
          <small class="text-muted">진행 중</small>
        </div>
      </div>
    </div>
    <div class="col-md-3">
      <div class="card border-0 shadow-sm bg-success bg-opacity-10">
        <div class="card-body text-center">
          <h4 class="fw-bold text-success m-0">${completed.length}</h4>
          <small class="text-muted">완료됨</small>
        </div>
      </div>
    </div>
  </div>

  <div class="card border-0 shadow-sm">
    <div class="card-body">
      <table class="table table-hover align-middle table-sm mb-0">
        <thead class="bg-light sticky-top">
          <tr>
            <th>요청일자</th>
            <th>학생명</th>
            <th>상담유형</th>
            <th>담당강사</th>
            <th>상담예정</th>
            <th>마감일</th>
            <th>상태</th>
            <th>요청자</th>
            <th>조치</th>
          </tr>
        </thead>
        <tbody>
  `;

  if (requests.length === 0) {
    html += '<tr><td colspan="9" class="text-center py-4 text-muted">상담 요청이 없습니다.</td></tr>';
  } else {
    requests.reverse().forEach(r => {
      const dueDate = r[10];
      const today = new Date().toISOString().split('T')[0];
      let statusBadge = '';
      let statusClass = '';

      if (r[11] === '완료') {
        statusBadge = '<span class="badge bg-success">완료</span>';
        statusClass = 'text-success';
      } else if (dueDate < today) {
        statusBadge = '<span class="badge bg-danger">마감</span>';
        statusClass = 'text-danger fw-bold';
      } else if (dueDate <= new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]) {
        statusBadge = '<span class="badge bg-warning">임박</span>';
        statusClass = 'text-warning fw-bold';
      } else {
        statusBadge = '<span class="badge bg-info">진행중</span>';
        statusClass = '';
      }

      const typeBadge = r[5] === '신규상담' ? 'bg-primary' : r[5] === '정기 상담' ? 'bg-success' : 'bg-info text-dark';

      html += `
        <tr class="${statusClass}">
          <td><small>${r[9] || ''}</small></td>
          <td>${r[1] || ''}</td>
          <td><span class="badge ${typeBadge}">${r[5] || ''}</span></td>
          <td>${r[6] || ''}</td>
          <td>${r[4] || ''}</td>
          <td><strong>${r[10] || ''}</strong></td>
          <td>${statusBadge}</td>
          <td>${r[12] || ''}</td>
          <td>
            ${r[11] !== '완료' ? `<button class="btn btn-sm btn-outline-primary" onclick="markCounselComplete('${r[0]}', '${r[1]}')">완료</button>` : '✓'}
          </td>
        </tr>
      `;
    });
  }

  html += `
        </tbody>
      </table>
    </div>
  </div>
    </div>
  `;

  document.getElementById('view-container').innerHTML = html;
};

window.markCounselComplete = async function(date, studentName) {
  if (!confirm(`${studentName} 학생의 상담을 완료 처리하시겠습니까?`)) return;

  try {
    const counsels = (appCache.raw.counsels || []).slice(1);
    const counselIdx = counsels.findIndex(c => c[9] === date && c[1] === studentName);

    if (counselIdx === -1) {
      alert('상담 기록을 찾을 수 없습니다.');
      return;
    }

    const sheetName = CONFIG.SHEETS.COUNSEL;
    const rowNum = counselIdx + 2;

    // L컬럼(상태) = 완료
    await callSheetsAPI('PUT', `/values/${encodeURIComponent(sheetName + '!L' + rowNum)}?valueInputOption=USER_ENTERED`, { values: [['완료']] });

    appCache.raw.counsels[counselIdx + 1][10] = '완료';

    alert('상담이 완료 처리되었습니다!');
    loadCounselRequestView();
  } catch (e) {
    alert('처리 중 오류: ' + e.message);
  }
};
