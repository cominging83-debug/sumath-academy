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


// 화면 로딩 및 에러 처리
function showLoader(show, msg = "데이터 불러오는 중...") {
  const overlay = document.getElementById('loading-overlay');
  document.getElementById('loading-msg').innerText = msg;
  overlay.style.display = show ? 'flex' : 'none';
}

function showErrorMsg(msg) {
  showLoader(false);
  document.getElementById('view-container').innerHTML = `
    <div class="alert alert-danger m-4 shadow-sm">
      <h4 class="fw-bold"><i class="bi bi-exclamation-triangle-fill"></i> 시스템 오류 발생</h4>
      <p class="mt-3 text-dark fw-bold">${msg}</p>
      <hr>
      <button class="btn btn-sm btn-outline-danger mt-3 fw-bold" onclick="forceRefresh()">다시 시도하기</button>
    </div>`;
}

// 화면 전환
const VIEW_TITLES = {
  DASHBOARD: '대시보드', SCHEDULE: '주간 시간표', ABSENTEE: '보강 관리',
  ABSENT: '보강 관리', STUDENT: '학생 관리', REGISTER: '수강 등록',
  COUNSEL: '상담 기록', BOOK: '교재 관리', TATT: '강사 근태',
  HISTORY: '기록 조회', SCORE: '성적 관리'
};

function switchView(view) {
  // 모바일 사이드바 닫기
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');
  }

  document.querySelectorAll('.menu-btn').forEach(e => e.classList.remove('active'));
  let targetMenu = document.getElementById('menu-' + view);
  if (targetMenu) targetMenu.classList.add('active');

  // 모바일 헤더 타이틀 업데이트
  const titleEl = document.getElementById('mobile-page-title');
  if (titleEl) titleEl.textContent = VIEW_TITLES[view] || '수학의 힘';

  if (view === 'DASHBOARD') loadDashboardView();
  else if (view === 'SCHEDULE') loadScheduleView();
  else if (view === 'ABSENTEE') loadAbsenteeView();
  else if (view === 'ABSENT') loadAbsenteeView();
  else if (view === 'STUDENT') loadStudentView();
  else if (view === 'REGISTER') loadRegisterView();
  else if (view === 'COUNSEL') loadCounselView();
  else if (view === 'BOOK') loadBookView();
  else if (view === 'TATT') loadTeacherAttView();
  else if (view === 'HISTORY') loadHistoryView();
  else if (view === 'SCORE') loadScoreView();
  else {
    document.getElementById('view-container').innerHTML = `
      <div class="text-center py-5">
        <h3 class="fw-bold text-muted">준비 중인 메뉴입니다 🚀</h3>
        <p>Google Sheets API 버전으로 순차적 업데이트 중입니다.</p>
      </div>`;
  }
}

// 모바일 사이드바 토글
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  if (!document.getElementById('sidebar-overlay')) {
    const overlay = document.createElement('div');
    overlay.id = 'sidebar-overlay';
    document.body.appendChild(overlay);
    overlay.onclick = toggleSidebar;
  }
  document.getElementById('sidebar-overlay').classList.toggle('open');
}

// 데이터 강제 리로드
function forceRefresh() {
  appCache.schedule = null;
  loadInitialData();
}

function logoutApp() {
  localStorage.removeItem('gapi_token');
  localStorage.removeItem('gapi_token_time');
  localStorage.removeItem('gapi_user');
  google.accounts.id.disableAutoSelect();
  location.reload();
}

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

// =========================================
// 대시보드 뷰
// =========================================
// =================================================================
// 🚀 [UI 전면 개편] 전설의 관제탑 대시보드 부활 (직관적 업무 흐름)
// =================================================================
window.loadDashboardView = function() {
  const schedules = (appCache.raw && appCache.raw.schedules) || [];
  const attendance = (appCache.raw && appCache.raw.attendance) || [];
  const today = new Date();
  const todayKor = ['일','월','화','수','목','금','토'][today.getDay()];
  const todayStr = today.toISOString().substring(0, 10);
  const isManager = (appCache.user.role === '원장');

  // --- 1. 오늘 수업 데이터 파싱 및 분류 (loadScheduleView 로직 차용) ---
  const WEEKDAY_BANDS = [
    { start: 15*60, end: 17*60, label: '15:00~17:00' },
    { start: 17*60, end: 19*60, label: '17:00~19:00' },
    { start: 19*60, end: 21*60, label: '19:00~21:00' },
  ];
  const SAT_BANDS = [
    { start: 10*60, end: 12*60, label: '10:00~12:00' },
    { start: 12*60, end: 14*60, label: '12:00~14:00' },
    { start: 14*60, end: 16*60, label: '14:00~16:00' },
  ];
  const bands = todayKor === '토' ? SAT_BANDS : WEEKDAY_BANDS;

  let classes = [];

  for (const r of schedules) {
    if (r[4] !== todayKor) continue; // 오늘 요일만
    const teacherRaw = r[9] || '';
    const teacher = teacherRaw.split('(')[0].trim();
    const branch = teacherRaw.includes('(') ? teacherRaw.match(/\(([^)]+)\)/)[1] : '';
    if (!teacher) continue;
    if (!isManager && teacher !== appCache.user.name) continue; // 권한 필터

    const sStart = toMins(r[6]);
    const sEnd = toMins(r[7]);
    if (sStart === null) continue;

    for (const band of bands) {
      if (sStart >= band.start && sStart < band.end) {
        const eventId = `evt_${todayKor}_${band.label}_${teacher}`.replace(/[:\s]/g, '_');
        
        let existingClass = classes.find(c => c.eventId === eventId);
        if (!existingClass) {
          existingClass = {
            eventId: eventId,
            timeLabel: band.label,
            teacher: teacher,
            branch: branch,
            room: r[11] || '',
            students: [],
            status: '대기중' // 기본값
          };
          classes.push(existingClass);
        }

        // [수정] 학생 정보 추가 (대시보드)
        const rawDisplay = r[0] || '';
        const namePart = rawDisplay.split('(')[0].trim();
        
        let sId = r[3] || '';
        if (sId.includes(':') || sId.includes('~') || !sId) {
            sId = namePart; // 시간값이 들어왔거나 비어있으면 이름으로 대체
        }

        const infoStr = (rawDisplay.match(/\(([^)]+)\)/) || ['',''])[1];
        const gradeLevel = rawDisplay.includes('보강') ? '보강' : (infoStr.includes('고') ? '고' : (infoStr.includes('중') ? '중' : '초'));
        
        if (!existingClass.students.find(s => s.name === namePart)) {
          existingClass.students.push({ id: sId, name: namePart, level: gradeLevel });
        }
      }
    }
  }


  // --- [보강일정DB 병합] 오늘 날짜의 보강 수업도 classes에 추가 ---
  const makeupsDash = appCache.raw['보강일정DB'] || appCache.raw.makeups || [];
  for (let i = 1; i < makeupsDash.length; i++) {
    const r = makeupsDash[i];
    const mkDate = (r[3] || '').substring(0, 10);
    if (mkDate !== todayStr) continue;
    const teacherRaw = r[6] || '';
    const teacher = teacherRaw.split('(')[0].trim();
    const branch = teacherRaw.includes('(') ? teacherRaw.match(/\(([^)]+)\)/)[1] : '';
    if (!teacher) continue;
    if (!isManager && teacher !== appCache.user.name) continue;
    const sStart = toMins(r[4]);
    const sEnd   = toMins(r[5]);
    if (sStart === null) continue;
    const sId   = r[0] || '';
    const sName = r[1] || '';
    for (const band of bands) {
      if (sStart >= band.start && sStart < band.end) {
        const eventId = ('evt_mk_' + mkDate + '_' + band.label + '_' + teacher).replace(/[:\s]/g, '_');
        let existingClass = classes.find(c => c.eventId === eventId);
        if (!existingClass) {
          existingClass = { eventId, timeLabel: band.label, teacher, branch: branch, room: r[7] || '', students: [], status: '대기중' };
          classes.push(existingClass);
        }
        if (!existingClass.students.find(s => s.name === sName)) {
          existingClass.students.push({ id: sId, name: sName, level: '보강' });
        }
      }
    }
  }

  // --- 2. 출결 상태(대기/작성중/완료) 매핑 및 allEvents 등록(모달용) ---
  allEvents = [];
  
  classes.forEach(c => {
    let evtObj = allEvents.find(e => e.id === c.eventId);
    if (!evtObj) {
      evtObj = { id: c.eventId, date: todayStr, day: todayKor, timeStr: c.timeLabel, teacherId: c.teacher, room: c.room, students: [] };
      allEvents.push(evtObj);
    }
    
    let completedCount = 0;
    let draftCount = 0;

    c.students.forEach(s => {
      const todayRec = [...attendance].reverse().find(a => (a[1] === s.id || a[2] === s.name) && a[3] === todayStr);
      
      if (todayRec) {
        if (todayRec[18] === '최종' || todayRec[18] === '최종제출') completedCount++;
        else draftCount++;
      }

      if (!evtObj.students.find(es => es.name === s.name)) {
        const fallbackRec = [...attendance].reverse().find(a => a[1] === s.id || a[2] === s.name);
        evtObj.students.push({
          id: s.id, name: s.name, badge: s.name, level: s.level,
          record: todayRec ? { 
              att: todayRec[5], hw: todayRec[6],
              pBook: todayRec[7], pRange: todayRec[8],
              hwBook: todayRec[9], hwRange: todayRec[10],
              t1Type: todayRec[11] || '일일', t1Cor: todayRec[12], t1Tot: todayRec[13],
              t2Type: todayRec[14] || '일일', t2Cor: todayRec[15], t2Tot: todayRec[16],
              memo: todayRec[17], newBook: todayRec[20], bookFee: todayRec[21]
          } : { att: '', hw: '' },
          lastUsed: fallbackRec ? { pBook: fallbackRec[7], hwBook: fallbackRec[9] } : {}
        });
      }
    });

    // 반 학생 전체가 출결이 체크되었을 때만 이동하는 로직
    const totalCount = c.students.length;
    if (totalCount > 0 && completedCount === totalCount) {
        c.status = '최종완료';
    } else if (totalCount > 0 && (completedCount + draftCount) === totalCount) {
        c.status = '작성중';
    } else {
        c.status = '대기중';
    }
  });

  // 상태별 분류
  const pending = classes.filter(c => c.status === '대기중');
  const drafting = classes.filter(c => c.status === '작성중');
  const completed = classes.filter(c => c.status === '최종완료');

  // --- 3. UI 렌더링 (예전 대시보드 스타일 완벽 구현) ---
  const renderClassRow = (c, colorClass, btnClass) => `
    <div class="list-group-item d-flex justify-content-between align-items-center p-3 border-bottom shadow-sm mb-2 rounded bg-white" style="cursor:pointer; border-left: 4px solid ${colorClass} !important;" onclick="openGroupAttModal('${c.eventId}')">
      <div class="d-flex flex-column gap-1">
        <div class="d-flex align-items-center gap-2">
          <span class="text-danger fw-bold" style="font-size: 0.9rem;"><i class="bi bi-clock"></i> ${c.timeLabel}</span>
          <span class="badge bg-secondary bg-opacity-10 text-dark border">${c.room || '미정'}</span>
          ${isManager ? `<span class="badge bg-dark"><i class="bi bi-person-fill"></i> ${c.teacher}${c.branch ? ` (${c.branch})` : ''}</span>` : `<span class="badge bg-secondary bg-opacity-25 text-dark border">${c.branch || '본관'}</span>`}
        </div>
        <div class="d-flex flex-wrap gap-1 mt-1">
          ${c.students.map(s => {
            const badgeBg = s.level === '보강' ? 'bg-warning text-dark' : (s.level === '고' ? 'bg-danger' : (s.level === '중' ? 'bg-primary' : 'bg-success'));
            return `<span class="badge ${badgeBg} fw-normal shadow-sm">${s.level}</span><span class="fw-bold text-dark" style="font-size:0.85rem; margin-right:6px;">${s.name}</span>`;
          }).join('')}
        </div>
      </div>
      <button class="btn ${btnClass} btn-sm fw-bold rounded-pill px-3 shadow-sm" onclick="event.stopPropagation(); openGroupAttModal('${c.eventId}')">출결 체크 ✏️</button>
    </div>
  `;

  const html = `
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h4 class="fw-bold m-0"><span class="text-primary me-1">[${appCache.user.branch || '본관'}]</span> ${appCache.user.name}${isManager ? ' 원장님' : ' 선생님'}, 환영합니다! 👋</h4>
      <div class="text-muted small fw-bold"><i class="bi bi-calendar-check me-1"></i>${todayStr} (${todayKor})</div>
    </div>

    <div class="row g-3 mb-4">
      <div class="col-md-4">
        <div class="card border-0 shadow-sm text-white h-100" style="background-color: #3b82f6; border-radius: 12px;">
          <div class="card-body p-4 d-flex flex-column justify-content-between">
            <h6 class="fw-bold mb-3 opacity-75">오늘 담당 수업</h6>
            <div class="display-5 fw-bold">${classes.length} <span class="fs-6 fw-normal opacity-75">타임</span></div>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card border-0 shadow-sm text-dark h-100" style="background-color: #f97316; border-radius: 12px;">
          <div class="card-body p-4 d-flex flex-column justify-content-between text-white">
            <h6 class="fw-bold mb-3 opacity-75">일지 작성중 (임시저장)</h6>
            <div class="display-5 fw-bold">${drafting.length} <span class="fs-6 fw-normal opacity-75">타임</span></div>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card border-0 shadow-sm text-white h-100" style="background-color: #10b981; border-radius: 12px;">
          <div class="card-body p-4 d-flex flex-column justify-content-between">
            <h6 class="fw-bold mb-3 opacity-75">최종 완료 (알림톡 대기)</h6>
            <div class="display-5 fw-bold">${completed.length} <span class="fs-6 fw-normal opacity-75">타임</span></div>
          </div>
        </div>
      </div>
    </div>

    <div class="card border-0 shadow-sm mb-4 border-top border-danger border-4">
      <div class="card-header bg-white border-bottom-0 pt-3 pb-2">
        <h6 class="fw-bold text-danger m-0"><i class="bi bi-exclamation-triangle-fill me-2"></i>출석 체크 대기중 (${pending.length}건)</h6>
      </div>
      <div class="card-body pt-1 bg-light">
        ${pending.length > 0 ? pending.map(c => renderClassRow(c, '#dc3545', 'btn-danger')).join('') : '<div class="text-center text-muted py-3">대기중인 수업이 없습니다.</div>'}
      </div>
    </div>

    <div class="card border-0 shadow-sm mb-4 border-top border-warning border-4">
      <div class="card-header bg-white border-bottom-0 pt-3 pb-2">
        <h6 class="fw-bold text-warning m-0" style="color: #d97706 !important;"><i class="bi bi-pencil-square me-2"></i>일지 미완성 (작성중) (${drafting.length}건)</h6>
      </div>
      <div class="card-body pt-1 bg-light">
        ${drafting.length > 0 ? drafting.map(c => renderClassRow(c, '#f59e0b', 'btn-warning text-dark')).join('') : '<div class="text-center text-muted py-3">작성중인 일지가 없습니다.</div>'}
      </div>
    </div>

    <div class="card border-0 shadow-sm mb-4 border-top border-success border-4">
      <div class="card-header bg-white border-bottom-0 pt-3 pb-2">
        <h6 class="fw-bold text-success m-0"><i class="bi bi-check-circle-fill me-2"></i>최종 완료 및 알림톡 생성됨 (${completed.length}건)</h6>
      </div>
      <div class="card-body pt-1 bg-light">
        ${completed.length > 0 ? completed.map(c => renderClassRow(c, '#10b981', 'btn-success')).join('') : '<div class="text-center text-muted py-3">완료된 수업이 없습니다.</div>'}
      </div>
    </div>

    <hr class="my-5 text-muted">

    <div class="row g-3">
      <div class="col-md-6" id="dashboard-notice-wrapper">
         ${window.renderNoticeBoard ? window.renderNoticeBoard() : ''}
      </div>
      <div class="col-md-6" id="dashboard-todo-wrapper">
         ${window.renderTodoList ? window.renderTodoList() : ''}
      </div>
    </div>
  `;

  document.getElementById('view-container').innerHTML = html;
  
  // 투두리스트 이벤트 바인딩 다시 걸어주기 위해 호출
  if(window.refreshDashboardTodos) window.refreshDashboardTodos();
};

// =================================================================
// 🚀 [신규 기능] 메인 대시보드 투두리스트 (To-Do) - 로딩 0초
// =================================================================
window.renderTodoList = function() {
    // 브라우저 저장소에서 할 일 목록을 즉시 불러옴 (없으면 학원용 기본 샘플 세팅)
    let todos = JSON.parse(localStorage.getItem('sumath_todos')) || [
        { id: 1, text: "신규 학부모 상담 전화 (오후 2시)", done: false },
        { id: 2, text: "중등부 다음 달 교재 주문", done: false }
    ];

    let html = `
    <div class="card p-4 shadow-sm border-0 mb-4 border-top border-info border-4 h-100" id="todo-card">
        <div class="d-flex justify-content-between align-items-center mb-3">
            <h5 class="fw-bold text-info m-0"><i class="bi bi-check2-square"></i> 오늘 할 일 (To-Do)</h5>
            <span class="badge bg-info text-dark shadow-sm" id="todoCount">${todos.filter(t=>!t.done).length}건 남음</span>
        </div>
        <div class="input-group mb-3 shadow-sm">
            <input type="text" class="form-control bg-light border-0" id="newTodoInput" placeholder="새로운 할 일 입력..." onkeyup="if(event.keyCode===13) addTodo()">
            <button class="btn btn-info text-white fw-bold px-3" onclick="addTodo()">추가</button>
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

// 할 일 추가
window.addTodo = function() {
    let input = document.getElementById('newTodoInput');
    if(!input) return;
    let text = input.value.trim();
    if (!text) return;
    let todos = JSON.parse(localStorage.getItem('sumath_todos')) || [];
    todos.push({ id: Date.now(), text: text, done: false });
    localStorage.setItem('sumath_todos', JSON.stringify(todos));
    refreshDashboardTodos();
};

// 할 일 체크/해제
window.toggleTodo = function(id) {
    let todos = JSON.parse(localStorage.getItem('sumath_todos')) || [];
    let todo = todos.find(t => t.id === id);
    if (todo) todo.done = !todo.done;
    localStorage.setItem('sumath_todos', JSON.stringify(todos));
    refreshDashboardTodos();
};

// 할 일 삭제
window.deleteTodo = function(id) {
    let todos = JSON.parse(localStorage.getItem('sumath_todos')) || [];
    todos = todos.filter(t => t.id !== id);
    localStorage.setItem('sumath_todos', JSON.stringify(todos));
    refreshDashboardTodos();
};

// 투두리스트 영역만 화면 깜빡임 없이 새로고침
window.refreshDashboardTodos = function() {
    let container = document.getElementById('dashboard-todo-wrapper');
    if(container) container.innerHTML = window.renderTodoList();
};



function loadScheduleView() {
  if (!appCache.raw || !appCache.raw.schedules) {
    document.getElementById('view-container').innerHTML = '<p>데이터를 불러올 수 없습니다.</p>';
    return;
  }

  const schedules = appCache.raw.schedules;
  const attendance = appCache.raw.attendance || [];
  allEvents = []; // 초기화
  const daysOrder = ['월', '화', '수', '목', '금', '토', '일'];
  const colors = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#34495e'];

  // (toMins, toTimeStr 전역 이동됨)

  // ── 1. 요일별 날짜 계산 ──
  const today    = new Date();
  const todayDay = today.getDay();
  const monday   = new Date(today);
  monday.setDate(today.getDate() + (todayDay === 0 ? -6 : 1 - todayDay));
  const dayKorToIdx = { '월':0,'화':1,'수':2,'목':3,'금':4,'토':5,'일':6 };
  const getDateForDay = kor => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + (dayKorToIdx[kor] ?? 0));
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };
  const todayKor = ['일','월','화','수','목','금','토'][todayDay];

  // ── 2. 강사 목록 & 컬러맵 (r[9] 기준) ──
  let teacherSet = new Set();
  for (const r of schedules) {
    const t = (r[9] || '').split('(')[0].trim();
    if (t) teacherSet.add(t);
  }
  let teachers = Array.from(teacherSet).sort();
  let colorMap = {};
  teachers.forEach((t, i) => colorMap[t] = colors[i % colors.length]);
  if (appCache.user.role === '강사') {
    teachers = teachers.filter(t => t === appCache.user.name);
  }

  // ── 3. 고정 시간대 밴드 설정 ──
  // 평일: 15~17시, 17~19시, 19~21시
  // 토요일: 10~12시, 12~14시, 14~16시
  const WEEKDAY_BANDS = [
    { start: 15*60, end: 17*60, label: '15:00~17:00' },
    { start: 17*60, end: 19*60, label: '17:00~19:00' },
    { start: 19*60, end: 21*60, label: '19:00~21:00' },
  ];
  const SAT_BANDS = [
    { start: 10*60, end: 12*60, label: '10:00~12:00' },
    { start: 12*60, end: 14*60, label: '12:00~14:00' },
    { start: 14*60, end: 16*60, label: '14:00~16:00' },
  ];
  function getBandsForDay(day) {
    return day === '토' ? SAT_BANDS : WEEKDAY_BANDS;
  }

  // ── 4. 학생 데이터 → 밴드별 그룹 (겹치는 밴드 모두에 배치) ──
  // grouped[day][bandLabel][teacher] = [{name, actualTime, showTime, room, isMakeup, id}]
  const grouped = {};
  // 요일별 실제 사용된 밴드 레이블 추적
  const bandsByDay = {}; // day → Set of bandLabel

  for (const r of schedules) {
    const day = r[4];
    if (!day) continue;
    const teacherRaw = r[9] || '';
    const teacher = teacherRaw.split('(')[0].trim();
    const branch = teacherRaw.includes('(') ? teacherRaw.match(/\(([^)]+)\)/)[1] : '';
    if (!teacher) continue;
    if (appCache.user.role === '강사' && teacher !== appCache.user.name) continue;

    const sStart = toMins(r[6]);
    const sEnd   = toMins(r[7]);
    if (sStart === null) continue;

    const room       = r[11] || '';
    const rawDisplay = r[0] || '';
    const namePart   = rawDisplay.split('(')[0].trim();
    const infoMatch  = rawDisplay.match(/\(([^)]+)\)/);
    const infoStr    = infoMatch ? infoMatch[1] : '';
    const gradeNum   = (infoStr.match(/(\d+)학년/) || ['',''])[1];
    const displayLabel = gradeNum ? `${namePart}${gradeNum}` : namePart;
    const isMakeup   = rawDisplay.includes('보강') || (r[13] || '').includes('보강');
    const actualTime = `${r[6] || ''}~${r[7] || ''}`;

    // 해당 요일의 고정 밴드에 대해 겹침 체크
    for (const band of getBandsForDay(day)) {
      if (sStart >= band.start && sStart < band.end) {
        const showTime = (sStart !== band.start) || (sEnd !== null && sEnd !== band.end);

        if (!grouped[day]) grouped[day] = {};
        if (!grouped[day][band.label]) grouped[day][band.label] = {};
        if (!grouped[day][band.label][teacher]) grouped[day][band.label][teacher] = [];
        
        // 고유 ID 생성 (매크로용)
        const eventId = `evt_${day}_${band.label}_${teacher}`.replace(/[:\s]/g, '_');
        
        // [수정] 보강 학생 이름/ID 제대로 추출
        const rawNamePart = (r[0] || '').split('(')[0].trim();
        let sId = r[3] || '';
        let sName;

        if (isMakeup && (rawNamePart.includes('이름 미확인') || !rawNamePart)) {
            // 보강 등록 시 A열이 '이름 미확인'으로 렐이면, D열(r[3])이 실제 이름
            sName = r[3] || rawNamePart;
            const foundSt = (appCache.raw.students || []).find(s => s[1] === sName);
            sId = foundSt ? foundSt[0] : ''; // 원첝DB에서 S0... ID 조회
        } else {
            sName = rawNamePart;
            if (sId.includes(':') || sId.includes('~') || !sId) {
                sId = sName;
            }
        }

        // 가장 최근 출결 기록 찾기 (이름으로도 찾을 수 있게 보완)
        const lastRecord = [...attendance].reverse().find(a => a[1] === sId || a[2] === sName);

        // 오늘자 임시저장 여부 판단 (T열 날짜 기준)
        const eventDateStr = getDateForDay(day);
        const isTodayDraft = lastRecord && (lastRecord[3] || '').substring(0, 10) === eventDateStr;

        const record = {
            // 교재는 항상 이전 기록에서 가져의서 유지
            pBook:   lastRecord ? lastRecord[7] : '',
            pRange:  lastRecord ? lastRecord[8] : '',
            hwBook:  lastRecord ? lastRecord[9] : '',
            hwRange: lastRecord ? lastRecord[10] : '',
            // 아래 필드는 오늘 임시저장일 때만 채움
            att:     isTodayDraft ? lastRecord[5] : '',
            hw:      isTodayDraft ? lastRecord[6] : '',
            t1Type:  isTodayDraft ? (lastRecord[11] || '일일') : '일일',
            t1Cor:   isTodayDraft ? lastRecord[12] : '',
            t1Tot:   isTodayDraft ? lastRecord[13] : '',
            t2Type:  isTodayDraft ? (lastRecord[14] || '일일') : '일일',
            t2Cor:   isTodayDraft ? lastRecord[15] : '',
            t2Tot:   isTodayDraft ? lastRecord[16] : '',
            memo:    isTodayDraft ? lastRecord[17] : '',
            newBook: isTodayDraft ? lastRecord[20] : '',
            bookFee: isTodayDraft ? lastRecord[21] : ''
        };

        const studentDataForEvent = {
            id: sId,
            name: sName,
            badge: displayLabel,
            level: isMakeup ? '보강' : (infoStr.includes('고') ? '고' : (infoStr.includes('중') ? '중' : '초')),
            record: record,
            lastUsed: { pBook: record.pBook, hwBook: record.hwBook }
        };

        let eventObj = allEvents.find(e => e.id === eventId);
        if (!eventObj) {
            eventObj = {
                id: eventId,
                date: getDateForDay(day), 
                day: day,
                timeStr: band.label,
                teacherId: teacher,
                room: room,
                students: []
            };
            allEvents.push(eventObj);
        }
        // 3. 중복 방지를 이름(sName) 기준으로 변경
        if (!eventObj.students.find(s => s.name === sName)) {
            eventObj.students.push(studentDataForEvent);
        }

        grouped[day][band.label][teacher].push({
          name: displayLabel,
          id: sId,
          eventId: eventId,
          room,
          isMakeup,
          showTime,
          actualTime,
          branch: branch
        });
      }
    }
  }

  // --- [보강일정DB 병합] 이번 주 보강 수업도 시간표에 추가 ---
  const makeupsSched = appCache.raw['보강일정DB'] || appCache.raw.makeups || [];
  for (let i = 1; i < makeupsSched.length; i++) {
    const r = makeupsSched[i];
    const mkDate = (r[3] || '').substring(0, 10);
    // 이번 주 해당 요일 찾기
    let targetDay = null;
    for (const kor of ['월','화','수','목','금','토','일']) {
      if (getDateForDay(kor) === mkDate) { targetDay = kor; break; }
    }
    if (!targetDay) continue;
    const teacherRaw = r[6] || '';
    const teacher = teacherRaw.split('(')[0].trim();
    const branch = teacherRaw.includes('(') ? teacherRaw.match(/\(([^)]+)\)/)[1] : '';
    if (!teacher) continue;
    if (appCache.user.role === '강사' && teacher !== appCache.user.name) continue;
    const sId   = r[0] || '';
    const sName = r[1] || '';
    const room  = r[7] || '';
    const sStart = toMins(r[4]);
    const sEnd   = toMins(r[5]);
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
        // lastRecord 및 isTodayDraft
        const todayStr2 = new Date().toISOString().substring(0, 10);
        const lastRec = [...attendance].reverse().find(a => a[1] === sId || a[2] === sName);
        const isTodayDraft = lastRec && (lastRec[3] || '').substring(0, 10) === todayStr2;
        const record = {
          pBook: lastRec ? lastRec[7] : '', pRange: lastRec ? lastRec[8] : '',
          hwBook: lastRec ? lastRec[9] : '', hwRange: lastRec ? lastRec[10] : '',
          att: isTodayDraft ? lastRec[5] : '', hw: isTodayDraft ? lastRec[6] : '',
          t1Type: isTodayDraft ? (lastRec[11] || '일일') : '일일',
          t1Cor: isTodayDraft ? lastRec[12] : '', t1Tot: isTodayDraft ? lastRec[13] : '',
          memo: isTodayDraft ? lastRec[17] : '',
          newBook: isTodayDraft ? lastRec[20] : '', bookFee: isTodayDraft ? lastRec[21] : ''
        };
        const studentData = { id: sId, name: sName, badge: sName, level: '보강', record, lastUsed: { pBook: record.pBook, hwBook: record.hwBook } };
        let eventObj = allEvents.find(e => e.id === eventId);
        if (!eventObj) {
          eventObj = { id: eventId, date: mkDate, day: targetDay, timeStr: band.label, teacherId: teacher, room, students: [] };
          allEvents.push(eventObj);
        }
        if (!eventObj.students.find(s => s.name === sName)) eventObj.students.push(studentData);
        grouped[targetDay][band.label][teacher].push({ name: sName, id: sId, eventId, room, isMakeup: true, showTime, actualTime, branch });
      }
    }
  }


  // 화면 표시용 날짜 포맷 (M/D) 다시 계산 (UI상으로는 M/D가 예쁨)
  const getSmallDate = kor => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + (dayKorToIdx[kor] ?? 0));
    return `${d.getMonth()+1}/${d.getDate()}`;
  };


  // ── 5. HTML 렌더링 ──
  let html = `
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h4 class="fw-bold m-0"><i class="bi bi-calendar-week me-2 text-primary"></i>주간 통합 시간표</h4>
      <button class="btn btn-outline-primary btn-sm fw-bold rounded-pill px-3" onclick="loadScheduleView()">
        <i class="bi bi-arrow-clockwise"></i> 새로고침
      </button>
    </div>
    <div class="overflow-auto">
    <table class="table table-bordered mb-0 align-middle"
           style="min-width:${120 + teachers.length * 160}px; table-layout:fixed;">
      <thead>
        <tr style="background:#f0f4f8; border-bottom:2px solid #cbd5e1;">
          <th class="text-center text-muted fw-bold" style="width:72px; font-size:0.78rem;">날짜<br>요일</th>
          <th class="text-center text-muted fw-bold" style="width:96px; font-size:0.78rem;">시간대</th>`;

  teachers.forEach(t => {
    html += `<th class="text-center fw-bold" style="width:155px; font-size:0.82rem; padding:8px 4px;">
      <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${colorMap[t]};margin-right:4px;"></span>${t}
    </th>`;
  });
  html += `</tr></thead><tbody>`;

  daysOrder.forEach(day => {
    const dateStr  = getDateForDay(day);
    const isToday  = day === todayKor;
    // 해당 요일의 고정 밴드 (항상 전체 표시)
    const dayBands = getBandsForDay(day);
    const rowCount = dayBands.length;


    dayBands.forEach((band, bIdx) => {
      const isLastInDay = (bIdx === dayBands.length - 1);
      const rowStyle = isLastInDay
        ? 'border-bottom:2px solid #94a3b8;'
        : 'border-bottom:1px dashed #cbd5e1;';

      html += `<tr style="${rowStyle}">`;

      // 날짜/요일 셀 (첫 밴드에서만 rowspan)
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

      // 시간대 셀
      const [bStartStr, bEndStr] = band.label.split('~');
      html += `<td class="text-center" style="
        font-size:0.75rem; font-weight:700; color:#334155;
        background:#f8fafc; vertical-align:middle;
        border-right:2px solid #e2e8f0; line-height:1.6;
        padding:6px 4px;
      ">${bStartStr}<br><span style="color:#94a3b8;font-size:0.68rem;">~</span><br>${bEndStr}</td>`;

      // 강사별 카드
      teachers.forEach(teacher => {
        const students = (grouped[day]?.[band.label]?.[teacher]) || [];
        html += `<td style="vertical-align:top; padding:4px; background:#fff;">`;

        if (students.length > 0) {
          const room = students[0].room;
          
          // 미제출 뱃지 계산 (오늘 수업이면서, 출결 '최종' 제출 기록이 없는 경우)
          const todayStr = new Date().toISOString().substring(0, 10);
          const isTodayCourse = (day === todayKor);
          let isSubmitted = false;
          
          if (isTodayCourse && appCache.raw && appCache.raw.attendance) {
            // 해당 반(첫번째 학생의 id/name 기준)의 오늘 날짜(최종) 기록 존재 여부 확인
            const firstStdId = students[0].id;
            isSubmitted = appCache.raw.attendance.some(aRow => {
              // aRow 구조: [타임스탬프, 학생ID, 학생명, 날짜(C열), 강사명, 출결상태, ..., status(S열)]
              // S열 인덱스는 18 (0-indexed)
              return aRow[1] === firstStdId && aRow[3] === todayStr && aRow[18] === '최종';
            });
          }
          
          const notSubBadgeHTML = (isTodayCourse && !isSubmitted) 
            ? `<span class="badge bg-danger shadow text-white" style="position:absolute;top:5px;left:5px;font-size:0.6rem;animation: pulse 2s infinite;">미제출</span>` 
            : '';

          const cardData = encodeURIComponent(JSON.stringify({
            teacher, time: band.label, room, day,
            students: students.map(s => ({ id: s.id, name: s.name, isMakeup: s.isMakeup, actualTime: s.actualTime }))
          }));

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
}



// ─── 그룹 카드 클릭 → 출결/코멘트 모달 ───────────────────────────────
window.openGroupAttModal = function(eventId) {
    if (window.openAttendanceModal) {
        window.openAttendanceModal(eventId);
    }
};

function loadAbsenteeView() {
  if (!appCache.raw || !appCache.raw.attendance) {
    document.getElementById('view-container').innerHTML = '<p>데이터를 불러올 수 없습니다.</p>';
    return;
  }

  const attendance = appCache.raw.attendance;
  const makeups    = appCache.raw['보강일정DB'] || [];

  // ── 1. 결석/보강예정 기록 수집 (역순, 최신순) ──────────────────────────
  let absentees = [];
  for (let i = attendance.length - 1; i >= 1; i--) {
    const r = attendance[i];
    if (appCache.user.role === '강사' && r[4] !== appCache.user.name) continue;
    if (r[5] !== '결석' && r[5] !== '보강예정') continue;

    const absentDate = r[3] ? r[3].substring(0, 10) : '';

    // ── 2-A. 보강일정DB에서 결석일자(C열) + 학생 매칭 예약 찾기 ──────
    let isScheduled = false;
    let makeupDate  = '';
    for (const m of makeups) {
      const mAbsentDate = (m[2] || '').substring(0, 10);
      if (mAbsentDate === absentDate && (m[0] === r[1] || m[1] === r[2])) {
        isScheduled = true;
        makeupDate  = (m[3] || '').substring(0, 10);
        break;
      }
    }

    // ── 2-B. 보강 완료 여부 확인 ──────────────────────────────────────────
    let isCompleted = false;
    // 방법 A: 보강일자에 출석/보강 [최종] 기록 존재 여부
    if (makeupDate) {
      isCompleted = attendance.some(a =>
        (a[1] === r[1] || a[2] === r[2]) &&
        (a[3] || '').substring(0, 10) === makeupDate &&
        (a[5] === '출석' || a[5] === '보강') &&
        a[18] === '최종'
      );
    }
    // 방법 B: 개별코멘트(인덱스17)에 "[결석일자 결석] 보강완료" 텍스트 포함
    if (!isCompleted && absentDate) {
      const tag = '[' + absentDate + ' 결석] 보강완료';
      isCompleted = attendance.some(a =>
        (a[1] === r[1] || a[2] === r[2]) && (a[17] || '').includes(tag)
      );
    }

    // ── 3. 완료된 항목은 목록에서 제외 ──────────────────────────────────
    if (isCompleted) continue;

    absentees.push({
      date: absentDate,
      student: r[2],
      studentId: r[1],
      teacher: r[4],
      status: r[5],
      memo: r[13] || '이유 미기재',
      isScheduled,
      makeupDate
    });
  }

  // ── 4. HTML 빌드 ────────────────────────────────────────────────────────
  let html = `
    <div class="d-flex justify-content-between align-items-center mb-4">
      <h3 class="fw-bold m-0"><i class="bi bi-person-x text-warning me-2"></i>보강 관리 (결석/보강 현황)</h3>
      <button class="btn btn-outline-secondary btn-sm rounded-pill" onclick="loadAbsenteeView()">
        <i class="bi bi-arrow-clockwise"></i> 새로고침
      </button>
    </div>

    <div class="card border-0 shadow-sm p-4 border-top border-warning border-4">
      <div class="table-responsive">
        <table class="table table-hover align-middle">
          <thead class="bg-light">
            <tr>
              <th>결석일자</th>
              <th>학생명</th>
              <th>담당강사</th>
              <th>출결상태</th>
              <th>결석사유(메모)</th>
              <th class="text-end">보강 상태 / 조치</th>
            </tr>
          </thead>
          <tbody>
  `;

  if (absentees.length === 0) {
    html += `<tr><td colspan="6" class="text-center py-4 text-muted">미처리 결석/보강 대상자가 없습니다. 환상적입니다! 🎉</td></tr>`;
  } else {
    absentees.forEach(a => {
      const badgeClass = a.status === '결석' ? 'bg-danger' : 'bg-warning text-dark';
      const safeA = encodeURIComponent(JSON.stringify({
        student: a.student, studentId: a.studentId, date: a.date, teacher: a.teacher
      }));

      let actionHTML = '';
      if (a.isScheduled) {
        actionHTML = `
          <span class="badge bg-info text-dark me-1">📅 ${a.makeupDate} 예약됨</span>
          <button class="btn btn-sm btn-success fw-bold rounded-pill" onclick="markMakeupComplete('${safeA}')">보강완료 ✅</button>
        `;
      } else {
        actionHTML = `
          <button class="btn btn-sm btn-outline-primary fw-bold rounded-pill mx-1" onclick="openMakeupModal('${safeA}')">날짜잡기 📅</button>
          <button class="btn btn-sm btn-success fw-bold rounded-pill" onclick="markMakeupComplete('${safeA}')">보강완료 ✅</button>
        `;
      }

      html += `
        <tr>
          <td><span class="fw-bold text-muted"><i class="bi bi-calendar-event"></i> ${a.date}</span></td>
          <td class="fw-bold fs-6">${a.student}</td>
          <td>${a.teacher}</td>
          <td><span class="badge ${badgeClass} rounded-pill">${a.status}</span></td>
          <td><span class="text-truncate d-inline-block" style="max-width:250px;font-size:0.85rem;" title="${a.memo}">${a.memo}</span></td>
          <td class="text-end">${actionHTML}</td>
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

  document.getElementById('view-container').innerHTML = html;
}


// =========================================
// 학생 관리 뷰 (원천DB)
// =========================================
function loadStudentView() {
  if (!appCache.raw || !appCache.raw.students) {
    document.getElementById('view-container').innerHTML = '<p>데이터를 불러올 수 없습니다.</p>';
    return;
  }

  const students = appCache.raw.students;
  let sList = [];

  // 헤더 제외 파싱
  for (let i = 1; i < students.length; i++) {
    const r = students[i];
    if (!r[0]) continue; // ID 없는 빈 줄 제거
    sList.push({
      id: r[0],
      name: r[1],
      dept: r[2],       // 학부
      school: r[3],     // 학교
      grade: r[4],      // 학년
      status: r[7],     // 재원상태 
      parentPhone: r[10], // 부모님번호
      date: r[8]        // 등록/변경일
    });
  }

  // 상태 요약 계산
  const activeCount = sList.filter(s => s.status === '재원').length;
  const holdCount = sList.filter(s => s.status === '휴원').length;
  const outCount = sList.filter(s => s.status === '퇴원').length;

  let html = `
    <div class="d-flex justify-content-between align-items-center mb-4">
      <h3 class="fw-bold m-0"><i class="bi bi-people-fill text-primary me-2"></i>학생 관리 (원천DB)</h3>
      <div class="d-flex gap-2">
        <button class="btn btn-primary btn-sm fw-bold rounded-pill" onclick="openNewStudentModal()">
          <i class="bi bi-person-plus-fill"></i> 학생 등록
        </button>
        <button class="btn btn-outline-secondary btn-sm fw-bold rounded-pill" onclick="loadStudentView()">
          <i class="bi bi-arrow-clockwise"></i> 새로고침
        </button>
      </div>
    </div>
    
    <div class="row mb-4">
      <div class="col-4">
        <div class="card border-0 shadow-sm bg-primary bg-opacity-10 text-center p-3">
          <h6 class="text-primary fw-bold mb-1">현재 재원생</h6>
          <h3 class="m-0 fw-bold text-primary">${activeCount}명</h3>
        </div>
      </div>
      <div class="col-4">
        <div class="card border-0 shadow-sm bg-secondary bg-opacity-10 text-center p-3">
          <h6 class="text-secondary fw-bold mb-1">휴원생</h6>
          <h3 class="m-0 fw-bold text-secondary">${holdCount}명</h3>
        </div>
      </div>
      <div class="col-4">
        <div class="card border-0 shadow-sm bg-danger bg-opacity-10 text-center p-3">
          <h6 class="text-danger fw-bold mb-1">퇴원생</h6>
          <h3 class="m-0 fw-bold text-danger">${outCount}명</h3>
        </div>
      </div>
    </div>
    
    <div class="card border-0 shadow-sm p-4 border-top border-primary border-4">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h5 class="fw-bold m-0">전체 학생 명단</h5>
        <div class="input-group" style="max-width: 250px;">
          <input type="text" class="form-control form-control-sm" placeholder="학생명 검색..." id="studentSearchInput" onkeyup="filterStudents()">
          <span class="input-group-text bg-white"><i class="bi bi-search"></i></span>
        </div>
      </div>
      
      <div class="table-responsive" style="max-height: 500px;">
        <table class="table table-hover align-middle table-sm" id="studentTable">
          <thead class="bg-light sticky-top">
            <tr>
              <th>이름 (ID)</th>
              <th>학부/학교/학년</th>
              <th>상태</th>
              <th>학부모 연락처</th>
              <th>변동일자</th>
              <th class="text-end">조치</th>
            </tr>
          </thead>
          <tbody>
  `;

  // 최신 등록순(역순)으로 정렬 표시
  sList.reverse().forEach(s => {
    let sBadge = 'bg-primary';
    if (s.status === '휴원') sBadge = 'bg-secondary';
    if (s.status === '퇴원') sBadge = 'bg-danger';

    html += `
            <tr class="student-row" style="cursor:pointer;" onclick="openStudentProfileModal('${s.id}', '${s.name}')" title="상세 프로필 보기">
              <td>
                <span class="fw-bold fs-6 student-name">${s.name}</span>
                <span class="text-muted small ms-1">(${s.id})</span>
              </td>
              <td class="text-muted small">${s.dept} / ${s.school} / ${s.grade}</td>
              <td><span class="badge ${sBadge} rounded-pill">${s.status || '미분류'}</span></td>
              <td class="font-monospace small">${s.parentPhone || '-'}</td>
              <td class="text-muted small">${s.date ? s.date.substring(0, 10) : '-'}</td>
              <td class="text-end">
                <button class="btn btn-sm btn-outline-secondary rounded-pill" onclick="openStudentEditModal('${s.id}')" style="font-size:0.75rem;">수정 📝</button>
              </td>
            </tr>
    `;
  });

  html += `
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('view-container').innerHTML = html;
}

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
// 신규 학생 등록
// =========================================
window.openNewStudentModal = function() {
  const existing = document.getElementById('newStudentModal');
  if (existing) existing.remove();
  const gradeOptions = ['초1','초2','초3','초4','초5','초6','중1','중2','중3','고1','고2','고3']
    .map(g => `<option value="${g}">${g}</option>`).join('');
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="modal fade" id="newStudentModal" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content border-0 shadow-lg">
          <div class="modal-header bg-primary text-white">
            <h5 class="modal-title fw-bold"><i class="bi bi-person-plus-fill me-2"></i>신규 학생 등록</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body p-4">
            <div class="row g-3">
              <div class="col-12">
                <label class="form-label fw-bold small">학생명 <span class="text-danger">*</span></label>
                <input type="text" id="ns-name" class="form-control" placeholder="예: 홍길동">
              </div>
              <div class="col-6">
                <label class="form-label fw-bold small">학부</label>
                <input type="text" id="ns-dept" class="form-control" placeholder="예: 중등부">
              </div>
              <div class="col-6">
                <label class="form-label fw-bold small">학교명</label>
                <input type="text" id="ns-school" class="form-control" placeholder="예: 수완중학교">
              </div>
              <div class="col-6">
                <label class="form-label fw-bold small">학년</label>
                <select id="ns-grade" class="form-select">
                  <option value="">선택</option>${gradeOptions}
                </select>
              </div>
              <div class="col-6">
                <label class="form-label fw-bold small">학부모 연락처</label>
                <input type="tel" id="ns-phone" class="form-control" placeholder="010-0000-0000">
              </div>
            </div>
          </div>
          <div class="modal-footer bg-light">
            <button class="btn btn-secondary rounded-pill" data-bs-dismiss="modal">취소</button>
            <button class="btn btn-primary rounded-pill fw-bold px-4" onclick="saveNewStudent()">
              <i class="bi bi-check-circle-fill me-1"></i>등록
            </button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el.firstElementChild);
  new bootstrap.Modal(document.getElementById('newStudentModal')).show();
};

window.saveNewStudent = async function() {
  const name  = document.getElementById('ns-name').value.trim();
  const dept  = document.getElementById('ns-dept').value.trim();
  const school= document.getElementById('ns-school').value.trim();
  let grade = document.getElementById('ns-grade').value;
  if (grade) grade = grade.replace(/[초중고]/g, '') + '학년';
  const phone = document.getElementById('ns-phone').value.trim();
  if (!name) return alert('학생명을 입력해주세요.');
  const today = new Date().toISOString().substring(0, 10);
  // A=ID(자동)="", B=이름, C=학부, D=학교, E=학년, F~G="", H=재원상태, I=등록일, J="", K=연락저
  const rowData = ["", name, dept, school, grade, "", "", "재원", today, "", phone];
  showLoader(true, '학생 등록 중...');
  try {
    const sheetName = CONFIG?.SHEETS?.STUDENT || '원천DB';
    await callSheetsAPI('POST', `/values/${encodeURIComponent(sheetName)}:append?valueInputOption=USER_ENTERED`, { values: [rowData] });
    showLoader(false);
    alert(`✅ [${name}] 학생이 등록되었습니다!`);
    bootstrap.Modal.getInstance(document.getElementById('newStudentModal')).hide();
    forceRefresh();
  } catch(e) {
    showLoader(false);
    alert('등록 실패: ' + e.message);
  }
};

// =========================================
// 보강 관련 기능
// =========================================
window.openMakeupModal = function(encodedA) {
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
// 🚀 [고속 통신 1] 보강 일정 등록 (수강일정DB)
// =================================================================
window.submitMakeup = async function() {
  const student  = document.getElementById('mk_student').value;
  const studentId= document.getElementById('mk_student_id').value;
  const mkDate   = document.getElementById('mk_date').value;
  const teacher  = document.getElementById('mk_teacher').value;
  const start    = document.getElementById('mk_start').value;  // HH:MM
  const end      = document.getElementById('mk_end').value;
  const room     = document.getElementById('mk_room').value;
  if (!room) { alert('강의실을 반드시 입력해주세요! (예: 본관-R1)'); return; }

  if (!mkDate) { alert('보강 날짜를 선택해주세요.'); return; }
  if (!teacher) { alert('담당 강사를 선택해주세요.'); return; }

  const dayNames = ['일','월','화','수','목','금','토'];
  const dayOfWeek = dayNames[new Date(mkDate + 'T00:00:00').getDay()];

  showLoader(true, "보강 일정 등록 중...");
  try {
    const absentDate = document.getElementById('mk_absentDate') ? document.getElementById('mk_absentDate').value : '';

    // [보강일정DB] 컬럼 매핑 (A~I열 기준)
    const rowData = [
      studentId,   // A: 학생ID
      student,     // B: 학생명
      absentDate,  // C: 결석일자
      mkDate,      // D: 보강일자
      start,       // E: 시작시간
      end,         // F: 종료시간
      teacher,     // G: 담당강사
      room,        // H: 강의실
      "예약"       // I: 보강상태
    ];

    const sheetName = '보강일정DB'; // 전용 보강일정DB 시트로 변경 (수강일정DB 꼬임 방지)
    await callSheetsAPI('POST', `/values/${encodeURIComponent(sheetName)}:append?valueInputOption=USER_ENTERED`, { values: [rowData] });

    showLoader(false);
    alert(`[${student}] 보강 일정이 등록되었습니다! 📅\n${mkDate} (${dayOfWeek}) ${start}~${end}`);
    bootstrap.Modal.getInstance(document.getElementById('makeupModal')).hide();
    forceRefresh();
  } catch(e) {
    showLoader(false);
    alert('보강 등록 실패: ' + e.message);
  }
};

// =================================================================
// 🚀 [고속 통신 2] 보강 완료 처리 (출결기록)
// =================================================================
window.markMakeupComplete = async function(encodedA) {
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
  } catch(e) {
    showLoader(false);
    alert('처리 실패: ' + e.message);
  }
};

// =========================================
// 학생 정보 수정 모달
// =========================================
window.openStudentEditModal = function(studentId) {
  const students = appCache.raw.students || [];
  const s = students.find(r => r[0] === studentId);
  if (!s) { alert('학생 정보를 찾을 수 없습니다.'); return; }

  // 기존 모달 제거
  const existing = document.getElementById('studentEditModal');
  if (existing) existing.remove();

  const statusOptions = ['재원','휴원','퇴원'].map(st =>
    `<option value="${st}" ${(s[7]||'') === st ? 'selected' : ''}>${st}</option>`
  ).join('');

  const gradeOptions = ['초1','초2','초3','초4','초5','초6','중1','중2','중3','고1','고2','고3'].map(g =>
    `<option value="${g}" ${(s[4]||'') === g ? 'selected' : ''}>${g}</option>`
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
                <input type="text" id="edit-name" class="form-control" value="${s[1]||''}">
              </div>
              <div class="col-6">
                <label class="form-label fw-bold small">학교명</label>
                <input type="text" id="edit-school" class="form-control" value="${s[3]||''}">
              </div>
              <div class="col-6">
                <label class="form-label fw-bold small">학년</label>
                <select id="edit-grade" class="form-select">
                  <option value="">선택</option>${gradeOptions}
                </select>
              </div>
              <div class="col-6">
                <label class="form-label fw-bold small">재원 상태 ⭐</label>
                <select id="edit-status" class="form-select fw-bold">
                  ${statusOptions}
                </select>
              </div>
              <div class="col-6">
                <label class="form-label fw-bold small">학부모 연락처</label>
                <input type="text" id="edit-parent-phone" class="form-control" value="${s[10]||''}">
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

window.saveStudentEdit = async function() {
  const studentId  = document.getElementById('edit-student-id').value;
  const name       = document.getElementById('edit-name').value.trim();
  const school     = document.getElementById('edit-school').value.trim();
  let grade      = document.getElementById('edit-grade').value;
  if (grade) grade = grade.replace(/[초중고]/g, '') + '학년';
  const status     = document.getElementById('edit-status').value;
  const parentPhone= document.getElementById('edit-parent-phone').value.trim();

  if (!name) { alert('이름을 입력해주세요.'); return; }

  try {
    await updateStudentData(studentId, { name, school, grade, status, parentPhone });
    alert('학생 정보가 수정되었습니다! ✅');
    bootstrap.Modal.getInstance(document.getElementById('studentEditModal')).hide();
    // 학생 목록 새로고침
    loadStudentView();
  } catch(e) {
    alert('수정 실패: ' + e.message);
  }
};

// =========================================
// 학생 상세 프로필 모달 (Phase 6)
// =========================================
// =================================================================
// 🚀 [신규 기능] 학생 상세 프로필 모달 & 성적 추이 차트(Chart.js) 복원
// =================================================================
window.openStudentProfileModal = function(studentId, studentName) {
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

  // 2. 수강 시간표
  let schedulesHTML = '<span class="text-muted small">현재 수강 중인 강의가 없습니다.</span>';
  if (appCache.raw.schedules) {
    const mySchedules = appCache.raw.schedules.filter(r => r[0].includes(studentId) || r[0].includes(studentName));
    if (mySchedules.length > 0) {
      schedulesHTML = mySchedules.map(r => `<span class="badge bg-primary me-1 mb-1 fs-6 fw-normal">${r[4]} ${r[6]}~${r[7]} (${(r[9]||'').split('(')[0]})</span>`).join('');
    }
  }

  // 3. 최근 상담 3건
  let counselsHTML = '<div class="small text-muted">최근 상담 내역이 없습니다.</div>';
  if (appCache.raw.counsels) {
    const myCounsels = appCache.raw.counsels.filter(r => r[6] === studentId || r[1] === studentName).reverse().slice(0, 3);
    if (myCounsels.length > 0) {
      counselsHTML = myCounsels.map(r => `
        <div class="border-start border-3 border-info ps-2 mb-3">
          <div class="small fw-bold text-info">${r[8] || (r[4] ? r[4].substring(0, 10) : '-')} · ${r[9]} · ${r[10]}</div>
          <div class="small text-muted mt-1" style="white-space:pre-wrap;">${r[12]}</div>
        </div>`).join('');
    }
  }

  // 4. 최근 출결 (5건), 통계 및 달력
  let attHTML = '<tr><td colspan="4" class="text-muted small text-center py-3">출결 내역이 없습니다.</td></tr>';
  let hwStatsHTML = '<div class="text-muted small">출결 기록이 없습니다.</div>';
  let calCells = '';
  let statsHTML = '';
  
  if (appCache.raw.attendance) {
    const myAtt = appCache.raw.attendance.filter(r => r[1] === studentId || r[2] === studentName);
    
    // [신규] 전체 출결 통계
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

    // [신규] 이번 달 미니 달력
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
      calCells += `<div style="${style}border-radius:4px;height:24px;display:flex;align-items:center;justify-content:center;font-size:0.65rem;" title="${d}일: ${status||'수업없음'}">${text}</div>`;
    }

    // 달성률 통계 (최근 30건)
    const recent30 = myAtt.slice(-30);
    const total = recent30.filter(r => ['출석', '보강', '지각', '조퇴'].includes(r[5])).length;
    const done  = recent30.filter(r => r[6] === '완료').length;
    const half  = recent30.filter(r => r[6] === '미흡' || r[6] === '세모').length;
    const fail  = recent30.filter(r => r[6] === '미제출' || r[6] === '미완료').length;

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

    // 출결 리스트 (최근 5건)
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

  // 5. 성적 데이터 추출
  let chartLabels = []; let chartData = [];
  if (appCache.raw.scores) {
      const myScores = appCache.raw.scores.filter(r => r[1] === studentId || r[2] === studentName).sort((a, b) => new Date(a[3]) - new Date(b[3]));
      myScores.forEach(r => {
          const score = parseFloat(r[6]); const totalScore = parseFloat(r[7]) || 100;
          if (!isNaN(score)) {
              chartLabels.push(`${(r[3]||'').substring(5,10)}(${(r[4]||'').substring(0,2)})`);
              chartData.push(Math.round((score / totalScore) * 100));
          }
      });
  }

  // 6. HTML 렌더링
  const modalHTML = `
    <div class="d-flex align-items-center mb-4 p-3 bg-white rounded shadow-sm border">
      <div class="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center me-3 shadow-sm" style="width: 64px; height: 64px; font-size: 1.8rem; font-weight: bold;">
        ${studentName.substring(0, 1)}
      </div>
      <div>
        <h3 class="fw-bold m-0 mb-1">${studentName} <span class="badge ${studentInfo.status==='재원'?'bg-success':'bg-secondary'} fs-6 align-middle ms-2">${studentInfo.status}</span></h3>
        <div class="text-muted" style="font-size:0.9rem;">
          <i class="bi bi-building me-1"></i> ${studentInfo.school} ${studentInfo.grade} &nbsp;|&nbsp;
          <i class="bi bi-telephone-fill me-1 ms-2"></i> 학부모: ${studentInfo.parentPhone}
        </div>
      </div>
    </div>
    
    <div class="row g-3">
      <div class="col-md-5">
        <div class="card border-0 shadow-sm mb-3">
          <div class="card-header bg-white border-bottom-0 pt-3 pb-0"><h6 class="fw-bold m-0 text-primary"><i class="bi bi-calendar-check me-2"></i>수강 시간표</h6></div>
          <div class="card-body pt-2">${schedulesHTML}</div>
        </div>

        <div class="card border-0 shadow-sm mb-3">
          <div class="card-header bg-white border-bottom-0 pt-3 pb-0">
            <h6 class="fw-bold m-0 text-info d-flex justify-content-between">
              <span><i class="bi bi-calendar3 me-2"></i>이번 달 출결 현황</span>
              <small class="text-muted fw-normal" style="font-size:0.7rem;">${new Date().getMonth()+1}월</small>
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
          <div class="card-header bg-white border-bottom-0 pt-3 pb-0"><h6 class="fw-bold m-0 text-secondary"><i class="bi bi-chat-dots-fill me-2"></i>최근 상담 기록</h6></div>
          <div class="card-body pt-2 pb-2">${counselsHTML}</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('studentProfileBody').innerHTML = modalHTML;
  const modalObj = new bootstrap.Modal(document.getElementById('studentProfileModal'));
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
};
;

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
                    const displayStr = s[15] || `${s[1]} (${s[4]||''}/${s[3]||''}) - ${s[0]}`;
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
window.autoFillStudentInfo = function() {
  const nameInput = document.getElementById('regStudentSelect');
  if (!nameInput) return;
  const val = nameInput.value.trim();
  // ... 생략 또는 필요시 새 필드에 맞게 수정 ...
}

// =================================================================
// 🚀 [고속 통신] 수강 등록 (함수 파괴 방지 & 에러 철통 방어)
// =================================================================
window.submitRegistration = async function() {
    try {
        const activeCheckboxes = document.querySelectorAll('.reg-day-cb:checked'); 
        if (activeCheckboxes.length === 0) return alert('수업 요일을 1개 이상 선택하세요!');
        const selectedStudent = document.getElementById('regStudentSelect').value; 
        
        // 데이터가 로드되지 않았을 때의 에러(length 등) 원천 차단
        const sourceStudents = (appCache.raw.students || []).slice(1);
        if (!sourceStudents.some(s => {
            const displayStr = s[15] || `${s[1]} (${s[4]||''}/${s[3]||''}) - ${s[0]}`;
            return displayStr === selectedStudent || s[1] === selectedStudent;
        })) {
            return alert("목록에 없는 학생입니다! 먼저 원천DB에 등록하세요.");
        }

        let schedules = []; 
        let isTeacherMissing = false; let isRoomMissing = false;
        activeCheckboxes.forEach(cb => { 
            const day = cb.value; 
            const teacher = document.getElementById(`teacher_${day}`).value; 
            const room = document.getElementById(`room_${day}`).value; 
            if(!teacher) isTeacherMissing = true; 
            if(!room) isRoomMissing = true; 
            schedules.push({ day: day, start: document.getElementById(`start_${day}`).value, end: document.getElementById(`end_${day}`).value, teacherName: teacher, room: room }); 
        });
        
        if(isTeacherMissing) return alert('체크한 요일의 담당 강사를 반드시 선택해주세요!'); 
        if(isRoomMissing) return alert('체크한 요일의 강의실을 반드시 입력해주세요! (예: 본관-R1)');

        const homeroomTeacher = document.getElementById('regHomeroom').value;
        const classType = document.getElementById('regClassType').value;
        const startDate = document.getElementById('regStartDate').value;

        showLoader(true);
        
        // 1. A열만 읽어와서 진짜 빈 줄 번호 찾기 (api.js의 응답 형태 차이에 완벽 대응)
        const enrRes = await callSheetsAPI('GET', `/values/${encodeURIComponent(CONFIG.SHEETS.CLASS)}!A:A`);
        const schRes = await callSheetsAPI('GET', `/values/${encodeURIComponent(CONFIG.SHEETS.SCHEDULE)}!A:A`);
        
        // 배열로 오든, 객체로 오든 무조건 안전하게 분리
        let enrVals = Array.isArray(enrRes) ? enrRes : (enrRes.values || []);
        let enrRow = enrVals.findIndex((r, i) => i > 0 && (!r || !r[0] || r[0].toString().trim() === "")) + 1;
        if (enrRow === 0) enrRow = enrVals.length + 1;
        // 최후의 방어선: 절대 1, 2번 행(제목, 수식)을 덮어쓰지 못하게 강제
        if (enrRow < 3) enrRow = Math.max(enrVals.length + 1, 3);

        let schVals = Array.isArray(schRes) ? schRes : (schRes.values || []);
        let schRow = schVals.findIndex((r, i) => i > 0 && (!r || !r[0] || r[0].toString().trim() === "")) + 1;
        if (schRow === 0) schRow = schVals.length + 1;
        if (schRow < 3) schRow = Math.max(schVals.length + 1, 3);

        // 2. 수식이 없는 칸만 정확히 찔러넣는 핀셋 데이터
        const batchData = [];

        // --- 수강DB ---
        batchData.push({ range: `${CONFIG.SHEETS.CLASS}!A${enrRow}`, values: [[selectedStudent]] });
        batchData.push({ range: `${CONFIG.SHEETS.CLASS}!D${enrRow}:F${enrRow}`, values: [[homeroomTeacher, classType, startDate]] });
        batchData.push({ range: `${CONFIG.SHEETS.CLASS}!H${enrRow}`, values: [["재원"]] });

        // --- 수강일정DB ---
        schedules.forEach(sched => {
            batchData.push({ range: `${CONFIG.SHEETS.SCHEDULE}!A${schRow}`, values: [[selectedStudent]] });
            batchData.push({ range: `${CONFIG.SHEETS.SCHEDULE}!E${schRow}`, values: [[sched.day]] });
            batchData.push({ range: `${CONFIG.SHEETS.SCHEDULE}!G${schRow}:H${schRow}`, values: [[sched.start, sched.end]] });
            batchData.push({ range: `${CONFIG.SHEETS.SCHEDULE}!J${schRow}`, values: [[sched.teacherName]] });
            batchData.push({ range: `${CONFIG.SHEETS.SCHEDULE}!L${schRow}`, values: [[sched.room]] });
            batchData.push({ range: `${CONFIG.SHEETS.SCHEDULE}!O${schRow}`, values: [["활성"]] });
            schRow++;
        });

        // 3. 한 방에 전송!
        const body = {
            valueInputOption: "USER_ENTERED",
            data: batchData
        };
        await callSheetsAPI('POST', `/values:batchUpdate`, body);

        showLoader(false);
        alert('🎉 수강 등록 완료! (함수 손상 없이 안전하게 저장되었습니다.)');
        
        if (appCache) appCache.schedule = null;
        if (typeof switchView === 'function') switchView('SCHEDULE');

    } catch(e) {
        showLoader(false);
        alert("등록 중 오류 발생: " + e.message);
        console.error(e);
    }
};


// =========================================
// 상담 기록 뷰 (원천 연동)
// =========================================
function loadCounselView() {
  if (!appCache.raw || !appCache.raw.counsels) {
    document.getElementById('view-container').innerHTML = '<p>데이터를 불러올 수 없습니다.</p>';
    return;
  }

  const counsels = appCache.raw.counsels;
  let cList = [];

  // 헤더 제외 역순 파싱 (최신순)
  for (let i = counsels.length - 1; i >= 1; i--) {
    const r = counsels[i];
    if (!r[0]) continue;
    cList.push({
      date: r[4] ? r[4].substring(0, 10) : (r[0] ? r[0].substring(0, 10) : '-'), // E열 상담일자 없으면 A열 작성일
      student: r[1],      // 학생명
      schoolInfo: r[3],   // 학교구분
      type: r[5],         // 상담유형
      teacher: r[6],      // 담당자
      target: r[7],       // 대상
      memo: r[8]          // 기타사항
    });
  }

  let html = `
    <div class="d-flex justify-content-between align-items-center mb-4">
      <h3 class="fw-bold m-0"><i class="bi bi-chat-dots text-info me-2"></i>상담 기록</h3>
      <div>
        <button class="btn btn-outline-info btn-sm fw-bold rounded-pill border-2 me-2" onclick="refreshCounselData()">
          <i class="bi bi-arrow-clockwise"></i> 새로고침
        </button>
        <button class="btn btn-info btn-sm fw-bold rounded-pill text-white" onclick="openCounselModal()">
          <i class="bi bi-pencil-square"></i> 새 상담 등록
        </button>
      </div>
    </div>
    
    <div class="card border-0 shadow-sm p-4 border-top border-info border-4">
      <div class="table-responsive" style="max-height: 600px;">
        <table class="table table-hover align-middle table-sm">
          <thead class="bg-light sticky-top">
            <tr>
              <th style="width: 110px;">상담일자</th>
              <th style="width: 100px;">학생명</th>
              <th style="width: 120px;">학교명구분</th>
              <th style="width: 80px;">상담유형</th>
              <th style="width: 80px;">담당자</th>
              <th>상담내용 (기타사항)</th>
            </tr>
          </thead>
          <tbody>
  `;

  if (cList.length === 0) {
    html += `<tr><td colspan="6" class="text-center py-5 text-muted">등록된 상담 기록이 없습니다.</td></tr>`;
  } else {
    cList.forEach(c => {
      let typeBadge = 'bg-secondary';
      if (c.type === '신규상담') typeBadge = 'bg-primary';
      else if (c.type === '전화상담') typeBadge = 'bg-success';
      else if (c.type === '대면상담') typeBadge = 'bg-warning text-dark';
      else if (c.type === '퇴원상담') typeBadge = 'bg-danger';

      html += `
        <tr>
          <td><span class="text-muted fw-bold small"><i class="bi bi-calendar"></i> ${c.date}</span></td>
          <td class="fw-bold">${c.student} <span class="badge bg-light text-dark fw-normal border ms-1" style="font-size: 0.65rem;">${c.target || '모름'}</span></td>
          <td class="text-muted small">${c.schoolInfo || '-'}</td>
          <td><span class="badge ${typeBadge} rounded-pill">${c.type || '-'}</span></td>
          <td>${c.teacher || '-'}</td>
          <td style="white-space: pre-wrap; font-size: 0.85rem;" class="text-dark">${c.memo || ''}</td>
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

  // 모달 HTML 동적 주입 (최초 1회만)
  if (!document.getElementById('counselModal')) {
    const modalHtml = `
      <div class="modal fade" id="counselModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content border-0 shadow-lg">
            <div class="modal-header bg-info text-white">
              <h5 class="modal-title fw-bold"><i class="bi bi-pencil-square"></i> 새 상담 기록 작성</h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body p-4">
              <div class="row g-3">
                <div class="col-12">
                  <label class="form-label fw-bold text-info small">1. 상담 유형 설정</label>
                  <select id="c-type" class="form-select bg-info bg-opacity-10 border-info fw-bold text-info" onchange="toggleCounselType()">
                    <option value="전화상담">전화상담 (기존/재원생)</option>
                    <option value="대면상담">대면상담 (기존/재원생)</option>
                    <option value="카톡상담">카톡상담 (기존/재원생)</option>
                    <option value="퇴원상담">퇴원상담 (기존/재원생)</option>
                    <option value="신규상담">신규상담 (새로 온 학생)</option>
                  </select>
                </div>
                
                <hr class="my-3 text-muted">
                
                <!-- 기존 학생 선택 영역 (신규상담 아닐때) -->
                <div class="col-8" id="c-existing-wrap">
                  <label class="form-label fw-bold text-muted small">학생 검색</label>
                  <input type="text" id="c-studentInput" class="form-control border-info" placeholder="이름을 입력하세요..." autocomplete="off" list="c-studentList">
                  <datalist id="c-studentList">
                  </datalist>
                  <input type="hidden" id="c-studentId">
                  <div class="form-text text-muted">최소 1자 이상 입력 시 검색됩니다.</div>
                </div>
                
                <!-- 신규 학생 직접 입력 영역 (hide 기본) -->
                <div class="col-8 d-none" id="c-new-wrap">
                  <label class="form-label fw-bold text-primary small">신규 학생 이름 <span class="text-danger">*</span></label>
                  <input type="text" id="c-newName" class="form-control" placeholder="예: 홍길동">
                  
                  <label class="form-label fw-bold text-primary small mt-2">연락처</label>
                  <input type="text" id="c-newPhone" class="form-control" placeholder="예: 010-0000-0000">
                </div>

                <div class="col-4">
                  <label class="form-label fw-bold text-muted small">상담 대상</label>
                  <select id="c-target" class="form-select">
                    <option value="학부모">학부모</option>
                    <option value="학생">학생</option>
                  </select>
                </div>
                <div class="col-12">
                  <label class="form-label fw-bold text-muted small">상담내용 (기타사항)</label>
                  <textarea id="c-memo" class="form-control" rows="5" placeholder="상담 내용을 자세히 기록해주세요..."></textarea>
                </div>
              </div>
            </div>
            <div class="modal-footer bg-light">
              <button type="button" class="btn btn-secondary rounded-pill fw-bold" data-bs-dismiss="modal">취소</button>
              <button type="button" id="btn-save-counsel" class="btn btn-info rounded-pill fw-bold text-white px-4" onclick="saveCounsel()">상담 저장</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
  }

  document.getElementById('view-container').innerHTML = html;
}

// 상담유형에 따른 화면 토글 (select onchange)
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
}

// 새 상담 모달 열기
window.openCounselModal = function () {
  // 폼 초기화
  document.getElementById('c-memo').value = '';
  document.getElementById('c-type').value = '전화상담';
  document.getElementById('c-newName').value = '';
  document.getElementById('c-newPhone').value = '';
  toggleCounselType(); // 화면 복구

  // 기존 재원생 리스트 datalist 채우기
  const dl = document.getElementById('c-studentList');
  dl.innerHTML = '';

  if (appCache.raw && appCache.raw.students) {
    let sortedStudents = [];
    const students = appCache.raw.students;
    for (let i = 1; i < students.length; i++) {
      if (!students[i][0]) continue;
      sortedStudents.push({
        id: students[i][0],
        name: students[i][1],
        school: students[i][3],
        grade: students[i][4]
      });
    }
    sortedStudents.sort((a, b) => a.name.localeCompare(b.name)).forEach(s => {
      // 표시는 "이름 (학교/학년)" 형태, value도 같은 문자열
      const opt = document.createElement('option');
      opt.value = `${s.name} (${s.school}/${s.grade})`;
      opt.dataset.id = s.id; // 학생 ID 보관
      dl.appendChild(opt);
    });
  }

  // input 초기화
  document.getElementById('c-studentInput').value = '';

  let modal = new bootstrap.Modal(document.getElementById('counselModal'));
  modal.show();
}

// 상담 데이터 저장 API 호출
// =================================================================
// 🚀 [고속 통신] 상담 기록 5G 저장 (중복 함수 완벽 통합)
// =================================================================
window.saveCounsel = async function() {
  // 두 가지 버전의 폼(신규/기존) 모두 호환되도록 값 추출
  const type    = document.getElementById('c-type') ? document.getElementById('c-type').value : (document.getElementById('counsel-type')?.value || '기타');
  const target  = document.getElementById('c-target') ? document.getElementById('c-target').value : (document.getElementById('counsel-target')?.value || '기타');
  const memo    = document.getElementById('c-memo') ? document.getElementById('c-memo').value.trim() : (document.getElementById('counsel-content')?.value.trim() || '');

  let name = ''; let studentId = ''; let schoolInfo = ''; let contact = '';
  let date = document.getElementById('counsel-date') ? document.getElementById('counsel-date').value : new Date().toISOString().substring(0, 10);
  let teacher = document.getElementById('counsel-teacher') ? document.getElementById('counsel-teacher').value.trim() : appCache.user.name;

  // 신규 상담(외부 학생)일 경우
  if (type === '신규상담' && document.getElementById('c-newName') && !document.getElementById('c-newName').classList.contains('d-none')) {
    name = document.getElementById('c-newName').value.trim();
    contact = document.getElementById('c-newPhone').value.trim();
    if (!name) return alert("신규 학생의 이름을 입력해주세요.");
    if (contact) schoolInfo = `[연락처: ${contact}]`;
  } else {
    // 기존 재원생일 경우
    const idInput = document.getElementById('c-studentId') || document.getElementById('counsel-student-id');
    const searchInput = document.getElementById('c-studentInput') || document.getElementById('counsel-student-search');
    studentId = idInput ? idInput.value : '';
    const inputVal = searchInput ? searchInput.value.trim() : '';

    if (!studentId || !inputVal) return alert("학생을 검색하고 목록에서 반드시 선택해주세요.");
    name = inputVal.split(' (')[0]; 
    schoolInfo = inputVal.includes('(') ? inputVal.substring(inputVal.indexOf('(') + 1, inputVal.indexOf(')')) : (document.getElementById('counsel-student-school')?.value || '');
  }

  if (!memo) return alert("상담 내용을 입력해주세요.");

  showLoader(true, "상담 기록 저장 중...");

  try {
    const timestamp = new Date().toLocaleString('ko-KR');
    // 시트 컬럼 맞춤: A=타임스탬프, B~D=빈칸, E=상담일자, F=담당자, G=상담대상, H=상담내용
    const rowData = [timestamp, name, studentId, schoolInfo, date, type, teacher, target, memo];
    const body = { values: [rowData] };
    
    const sheetName = (typeof CONFIG !== 'undefined' && CONFIG.SHEETS && CONFIG.SHEETS.COUNSEL) ? CONFIG.SHEETS.COUNSEL : '상담기록';
    await callSheetsAPI('POST', `/values/${encodeURIComponent(sheetName)}:append?valueInputOption=USER_ENTERED`, body);

    showLoader(false);
    alert("✅ 상담일지가 1초 만에 등록되었습니다!");

    const modalEl = document.getElementById('counselModal');
    if (modalEl) {
        let modal = bootstrap.Modal.getInstance(modalEl);
        if(modal) modal.hide();
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
window.recordTeacherAtt = async function(type) {
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
// 🚀 [UI 개선 & 매크로] 출석 모달창 열기 및 학생 리스트 렌더링
// =================================================================
window.openAttendanceModal = function(eventId) {
    currentEventForModal = allEvents.find(e => e.id === eventId); 
    if(!currentEventForModal) return;

    let modalEl = document.getElementById('attendanceModal');
    if (!modalEl) return console.error("attendanceModal을 찾을 수 없습니다.");

    document.getElementById('checkDate').value = currentEventForModal.date || new Date().toISOString().substring(0, 10); 
    if (document.getElementById('classProgress')) document.getElementById('classProgress').value = currentEventForModal.commonProgress || ""; 
    document.getElementById('modalClassInfo').innerText = `${currentEventForModal.day}요일 ${currentEventForModal.timeStr}`;

    const globalBookListEl = document.getElementById('globalBookList');
    if (globalBookListEl) {
        const books = (appCache.raw && appCache.raw.books) || [];
        globalBookListEl.innerHTML = books.map(b => `<option value="${b[0] || ''}">`).join('');
    } else {
        const dl = document.createElement('datalist');
        dl.id = 'globalBookList';
        const books = (appCache.raw && appCache.raw.books) || [];
        dl.innerHTML = books.map(b => `<option value="${b[0] || ''}">`).join('');
        document.body.appendChild(dl);
    }

    let listHtml = '';
    (currentEventForModal.students || []).forEach((s, idx) => {
        let rawBadge = s.badge || "이름없음"; 
        let rec = s.record || {}; 
        let last = s.lastUsed || {};

        let isAtt = rec.att === '출석' ? 'checked' : ''; 
        let isLate = rec.att === '지각' ? 'checked' : ''; 
        let isAbs = rec.att === '결석' ? 'checked' : '';
        
        let isHwO = rec.hw === '완료' ? 'checked' : ''; 
        let isHwM = rec.hw === '미흡' ? 'checked' : ''; 
        let isHwX = rec.hw === '미제출' ? 'checked' : '';

        let pB = (rec.pBook || last.pBook || "").split('|'); 
        let pR = (rec.pRange || last.pRange || "").split('|'); 
        let hwB = (rec.hwBook || last.hwBook || "").split('|'); 
        let hwR = (rec.hwRange || last.hwRange || "").split('|');

        let t1Type = rec.t1Type || '일일'; 
        let t1Cor = rec.t1Cor || ''; 
        let t1Tot = rec.t1Tot || '';
        let t2Type = rec.t2Type || '일일'; 
        let t2Cor = rec.t2Cor || ''; 
        let t2Tot = rec.t2Tot || '';
        if (!rec.att) { t1Cor = ''; t1Tot = ''; t2Cor = ''; t2Tot = ''; }
        let memo = rec.memo || ''; 
        let nbVal = rec.newBook || ""; 
        let bfVal = rec.bookFee || "";

        let color = s.level === '보강' ? 'bg-warning text-dark border-warning' : (s.level === '고' ? 'bg-danger text-white' : (s.level === '중' ? 'bg-primary text-white' : 'bg-success text-white'));
        let displayNameHtml = `<span class="badge ${color} me-2">${s.level}</span>${rawBadge}`;

        listHtml += `
        <div class="p-3 mb-4 bg-white border rounded shadow-sm student-row" data-id="${s.id}" data-name="${s.name}" data-rawbadge="${rawBadge}">
            <div class="row align-items-center mb-3 pb-3 border-bottom">
                <div class="col-md-3 fs-5 fw-bold text-dark d-flex flex-column align-items-start justify-content-center">
                    <div class="d-flex align-items-center mb-2">${displayNameHtml}</div>
                    <div class="d-flex gap-1">
                        <button type="button" class="btn btn-sm btn-outline-warning fw-bold" style="font-size: 0.65rem;" onclick="saveAttendance('임시저장', false, ${idx})">개별 임시저장 💾</button>
                        <button type="button" class="btn btn-sm btn-outline-primary fw-bold" style="font-size: 0.65rem;" onclick="saveAttendance('최종', false, ${idx})">개별 최종제출 🚀</button>
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
                    <label class="small fw-bold text-primary mb-2"><i class="bi bi-book"></i> 오늘 진도 (이전 교재 자동 불러옴)</label>
                    <div class="input-group input-group-sm mb-2 shadow-sm">
                        <input type="text" class="form-control bg-white" id="pB1_${idx}" list="globalBookList" placeholder="진도교재 1" value="${pB[0]||''}" style="width:45%; ${pB[0] ? 'color: #adb5bd;' : ''}" oninput="this.style.color='#212529'">
                        <input type="text" class="form-control bg-white" id="pR1_${idx}" placeholder="페이지/단원 (직접입력)" value="${pR[0]||''}">
                    </div>
                    <div class="input-group input-group-sm shadow-sm">
                        <input type="text" class="form-control bg-white" id="pB2_${idx}" list="globalBookList" placeholder="진도교재 2" value="${pB[1]||''}" style="width:45%; ${pB[1] ? 'color: #adb5bd;' : ''}" oninput="this.style.color='#212529'">
                        <input type="text" class="form-control bg-white" id="pR2_${idx}" placeholder="페이지/단원 (직접입력)" value="${pR[1]||''}">
                    </div>
                </div>
                <div class="col-md-6">
                    <label class="small fw-bold text-success mb-2"><i class="bi bi-pencil-square"></i> 다음 과제 (이전 교재 자동 불러옴)</label>
                    <div class="input-group input-group-sm mb-2 shadow-sm">
                        <input type="text" class="form-control bg-white" id="hwB1_${idx}" list="globalBookList" placeholder="과제교재 1" value="${hwB[0]||''}" style="width:45%; ${hwB[0] ? 'color: #adb5bd;' : ''}" oninput="this.style.color='#212529'">
                        <input type="text" class="form-control bg-white" id="hwR1_${idx}" placeholder="과제 범위 (직접입력)" value="${hwR[0]||''}">
                    </div>
                    <div class="input-group input-group-sm mb-2 shadow-sm">
                        <input type="text" class="form-control bg-white" id="hwB2_${idx}" list="globalBookList" placeholder="과제교재 2" value="${hwB[1]||''}" style="width:45%; ${hwB[1] ? 'color: #adb5bd;' : ''}" oninput="this.style.color='#212529'">
                        <input type="text" class="form-control bg-white" id="hwR2_${idx}" placeholder="과제 범위 (직접입력)" value="${hwR[1]||''}">
                    </div>
                    <div class="input-group input-group-sm shadow-sm">
                        <input type="text" class="form-control bg-white" id="hwB3_${idx}" list="globalBookList" placeholder="과제교재 3" value="${hwB[2]||''}" style="width:45%; ${hwB[2] ? 'color: #adb5bd;' : ''}" oninput="this.style.color='#212529'">
                        <input type="text" class="form-control bg-white" id="hwR3_${idx}" placeholder="과제 범위 (직접입력)" value="${hwR[2]||''}">
                    </div>
                </div>
            </div>
            <div class="row g-2 align-items-center mb-2">
                <div class="col-md-2"><span class="badge bg-danger w-100 py-2">테스트 1</span></div>
                <div class="col-md-3">
                    <select class="form-select form-select-sm" id="t1Type_${idx}">
                        <option value="일일" ${t1Type==='일일'?'selected':''}>일일 테스트</option>
                        <option value="주간" ${t1Type==='주간'?'selected':''}>주간 테스트</option>
                        <option value="월간" ${t1Type==='월간'?'selected':''}>월간 평가</option>
                    </select>
                </div>
                <div class="col-md-4 d-flex align-items-center gap-2">
                    <input type="number" class="form-control form-control-sm text-center fw-bold" id="t1Cor_${idx}" placeholder="정답수" value="${t1Cor}">
                    <span class="fw-bold text-muted">/</span>
                    <input type="number" class="form-control form-control-sm text-center text-muted" id="t1Tot_${idx}" placeholder="총문항" value="${t1Tot}">
                </div>
            </div>
            <div class="row g-2 align-items-center mb-2">
                <div class="col-md-2"><span class="badge bg-primary text-white w-100 py-2">테스트 2</span></div>
                <div class="col-md-3">
                    <select class="form-select form-select-sm" id="t2Type_${idx}">
                        <option value="일일" ${t2Type==='일일'?'selected':''}>일일 테스트</option>
                        <option value="주간" ${t2Type==='주간'?'selected':''}>주간 테스트</option>
                        <option value="월간" ${t2Type==='월간'?'selected':''}>월간 평가</option>
                    </select>
                </div>
                <div class="col-md-4 d-flex align-items-center gap-2">
                    <input type="number" class="form-control form-control-sm text-center fw-bold" id="t2Cor_${idx}" placeholder="정답수" value="${t2Cor}">
                    <span class="fw-bold text-muted">/</span>
                    <input type="number" class="form-control form-control-sm text-center text-muted" id="t2Tot_${idx}" placeholder="총문항" value="${t2Tot}">
                </div>
            </div>
            <div class="row g-2 align-items-center mb-3">
                <div class="col-md-2"><span class="badge bg-info text-dark w-100 py-2">새 교재 청구</span></div>
                <div class="col-md-5">
                    <input type="text" class="form-control form-control-sm border-info" id="newBook_${idx}" list="globalBookList" placeholder="발급된 교재명 검색..." onchange="updateBookFee(${idx})" value="${nbVal}">
                </div>
                <div class="col-md-3 d-flex align-items-center gap-2">
                    <input type="number" class="form-control form-control-sm text-end" id="bookFee_${idx}" placeholder="금액(원)" value="${bfVal}">
                    <span class="small text-muted fw-bold">원</span>
                </div>
            </div>
            <div class="row">
                <div class="col-12">
                    <textarea class="form-control bg-light" placeholder="개별 코멘트 / 피드백 (알림톡에 포함됩니다)" id="memo_${idx}" rows="2">${memo}</textarea>
                </div>
            </div>
        </div>`;
    });
    
    document.getElementById('studentCheckList').innerHTML = listHtml; 
    let modal = new bootstrap.Modal(modalEl);
    modal.show();
};

// 새 교재 청구 자동완성 기능 (교재명에 맞는 금액 자동 입력)
window.updateBookFee = function(idx) {
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

// 결석/보강예정 선택 시 카드 비활성화
window.onAttChange = function(sel) {
  const card = sel.closest('.student-row');
  if (!card) return;
  const isAbsent = (sel.value === '결석');
  card.querySelectorAll('input[type="radio"][name^="hw_"], input[type="text"], input[type="number"], textarea, select').forEach(el => { el.disabled = isAbsent; });
  
  // 카드 전체가 아닌, 하단 세부 입력 영역들만 흐리게 처리 (버튼은 선명하게 유지)
  const detailAreas = card.querySelectorAll('.bg-light, .row.g-2');
  detailAreas.forEach(area => area.style.opacity = isAbsent ? '0.4' : '1');
  
  card.style.borderLeft = isAbsent ? '4px solid #ef4444' : '4px solid #3b82f6';
};

// =================================================================
// 🚀 [신규 기능] 출결 전체 일괄 처리 (빠른 제어)
// =================================================================
window.setAllAttendance = function(status) {
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

// (중복 선언된 window.updateModalUnitSelect 함수 제거됨)

// =================================================================
// 🚀 [버그 수정 완벽판] 출결 데이터 고속 저장 및 알림톡 연동
// =================================================================
window.saveAttendance = async function(submitType, isOnlyAtt, targetIdx = null) {
    if (!currentEventForModal) return;

    const date = document.getElementById('checkDate').value;
    const progress = document.getElementById('classProgress') ? document.getElementById('classProgress').value.trim() : '';
    const rows = document.querySelectorAll('.student-row');
    const isFinal = (submitType === '최종' || submitType === '최종제출');
    
    let records = [];
    let hasMissingAtt = false;
    let hasAttended = false;

    rows.forEach((row, idx) => {
        if (targetIdx !== null && targetIdx !== idx) return;
        let rawId = row.getAttribute('data-id');
        let rawName = row.getAttribute('data-name');

        // [수정] ID가 S0...형식이 아닠 경우 원첝DB에서 보정
        if (rawId && !rawId.startsWith('S')) {
            const found = (appCache.raw.students || []).find(s => s[1] === rawName || s[1] === rawId);
            if (found) { rawId = found[0]; rawName = found[1]; }
        }
        
        let attRadio = document.querySelector(`input[name="att_${idx}"]:checked`);
        let hwRadio = document.querySelector(`input[name="hw_${idx}"]:checked`);
        let att = attRadio ? attRadio.value : "";
        let hw = hwRadio ? hwRadio.value : (att === '결석' ? '없음' : '');
        
        if (!att) hasMissingAtt = true;
        if (['출석', '지각', '조퇴', '보강'].includes(att)) hasAttended = true;

        // 전송 상태 강제 고정 (찌꺼기 텍스트 제거)
        let recordStatus = isFinal ? '최종' : '임시저장';
        if (att === '결석') recordStatus = '최종'; // 결석은 무조건 최종 처리

        const memoInput = document.getElementById(`memo_${idx}`)?.value || "";
        const newBookInput = document.getElementById(`newBook_${idx}`)?.value || "";
        const bookFeeInput = document.getElementById(`bookFee_${idx}`)?.value || "";

        // 알림톡 요약 텍스트
        const alimtalkSummary = `[출결] ${att} / [과제] ${hw}`;

        // 새교재명 (값이 있으면 날짜 + 지급)
        const newBookText = newBookInput ? `${newBookInput} (${date} 지급)` : "";

        let rowData = [
            new Date().toLocaleString('ko-KR'), 
            rawId,                              
            rawName,                            
            date,                               
            currentEventForModal.teacherId,      
            att,                                
            hw,                                 
            `${document.getElementById(`pB1_${idx}`).value}|${document.getElementById(`pB2_${idx}`).value}`, 
            `${document.getElementById('pR1_' + idx).value || progress}|${document.getElementById('pR2_' + idx).value}`, 
            `${document.getElementById(`hwB1_${idx}`).value}|${document.getElementById(`hwB2_${idx}`).value}|${document.getElementById(`hwB3_${idx}`).value}`, 
            `${document.getElementById(`hwR1_${idx}`).value}|${document.getElementById(`hwR2_${idx}`).value}|${document.getElementById(`hwR3_${idx}`).value}`, 
            document.getElementById(`t1Type_${idx}`).value, 
            document.getElementById(`t1Cor_${idx}`).value,  
            document.getElementById(`t1Tot_${idx}`).value,  
            document.getElementById(`t2Type_${idx}`).value, 
            document.getElementById(`t2Cor_${idx}`).value,  
            document.getElementById(`t2Tot_${idx}`).value,                         
            memoInput,                          // 인덱스 17 (R열): 개별코멘트
            recordStatus,                       // 인덱스 18 (S열): 제출상태
            alimtalkSummary,                    // 인덱스 19 (T열): 알림톡내용 요약
            newBookText,                        // 인덱스 20 (U열): 새교재명 (가공됨)
            bookFeeInput                        // 인덱스 21 (V열): 교재비
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
                const rowNum = foundIdx + 1;
                await callSheetsAPI('PUT', '/values/출결기록!A' + rowNum + ':V' + rowNum + '?valueInputOption=USER_ENTERED', { values: [rowData] });
            } else {
                await callSheetsAPI('POST', `/values/${encodeURIComponent(sheetName)}:append?valueInputOption=USER_ENTERED`, { values: [rowData] });
            }
        }
        
        showLoader(false);
        
        if (isFinal) {
            alert(`✅ 총 ${records.length}명의 출결이 시트에 1초 만에 저장되었습니다! 알림톡 발송 창으로 이동합니다.`);
            const modalEl = document.getElementById('attendanceModal');
            const attModal = bootstrap.Modal.getInstance(modalEl);
            if (attModal) attModal.hide();
            
            setTimeout(() => {
                // 💡 [핵심 수정] 알림톡 창으로 교재, 테스트 등 모든 변수를 꽉꽉 채워서 넘김
                const alimtalkRecords = records.map(r => ({
                    studentId: r[1],
                    studentName: r[2],
                    att: r[5],
                    hw: r[6],
                    pBook: r[7],      // 진도교재
                    pRange: r[8],     // 진도범위
                    hwBook: r[9],     // 과제교재
                    t1Type: r[11],    // 테스트유형
                    t1Cor: r[12],     // 맞은개수
                    t1Tot: r[13],     // 총개수
                    memo: r[17]       // 코멘트
                }));
                openAlimtalkModal(alimtalkRecords, date, currentEventForModal.teacherId);
            }, 500);
        } else {
            alert(`💾 총 ${records.length}명의 출결 기록이 임시저장 되었습니다.`);
            const modalEl = document.getElementById('attendanceModal');
            const attModal = bootstrap.Modal.getInstance(modalEl);
            if (attModal) attModal.hide();
            if (typeof forceRefresh === 'function') forceRefresh();
        }
        
    } catch (error) {
        showLoader(false);
        alert("저장 중 오류가 발생했습니다: " + error.message);
    }
};

// =========================================
// 문자(알림톡) 템플릿 모달 및 발송 로직
// =========================================
let currentAlimtalkRecords = [];
let currentAlimtalkDate = '';
let currentAlimtalkTeacher = '';

window.openAlimtalkModal = async function(records, date, teacher) {
  currentAlimtalkRecords = records;
  currentAlimtalkDate = date;
  currentAlimtalkTeacher = teacher;

  // 알림톡설정 시트에서 템플릿 동적 로드
  if (!appCache.templates || appCache.templates.length === 0) {
    try {
      const res = await callSheetsAPI('GET', '/values/알림톡설정!A:B');
      const tRows = (res.values || []).slice(1);
      appCache.templates = tRows.map(r => ({ title: r[0] || '', content: r[1] || '' })).filter(t => t.title);
    } catch(e) {
      console.warn('알림톡설정 시트 로드 실패:', e.message);
      appCache.templates = [];
    }
  }

  let modalEl = document.getElementById('alimtalkModal');
  if (!modalEl) {
    const modalHtml = `
      <div class="modal fade" id="alimtalkModal" tabindex="-1">
        <div class="modal-dialog modal-lg modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header bg-success text-white">
              <h5 class="modal-title fw-bold"><i class="bi bi-chat-dots-fill"></i> 문자(알림톡) 발송</h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body bg-light">
              <div class="alert alert-info py-2 small fw-bold mb-3 shadow-sm border-0">
                <i class="bi bi-info-circle-fill me-1"></i> [최종 제출]된 출결/과제 기록을 바탕으로 학부모님께 문자를 발송합니다.
              </div>
              <div class="row g-2 mb-3">
                <div class="col-12">
                  <label class="fw-bold small text-muted">템플릿 선택</label>
                  <select class="form-select border-success fw-bold" id="alimtalkTemplateSelect" onchange="applyAlimtalkTemplate()">
                    <option value="">템플릿 직접 작성 (선택 안함)</option>
                  </select>
                </div>
              </div>
              
              <div id="alimtalkPreviewContainer">
                <!-- 학생별 문자 미리보기 렌더링 -->
              </div>
            </div>
            <div class="modal-footer justify-content-between">
              <button class="btn btn-outline-secondary rounded-pill fw-bold px-4" data-bs-dismiss="modal">건너뛰기</button>
              <button class="btn btn-success fw-bold rounded-pill shadow-sm px-4" id="btn-send-alimtalk" onclick="sendAlimtalk()">
                <i class="bi bi-send-check-fill"></i> 메세지 즉시 발송
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    modalEl = document.getElementById('alimtalkModal');
  }

  // 템플릿 목록 렌더링
  const sel = document.getElementById('alimtalkTemplateSelect');
  sel.innerHTML = '<option value="">템플릿 직접 작성 (선택 안함)</option>';
  if (appCache.templates && appCache.templates.length > 0) {
    appCache.templates.forEach((t, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = t.title;
      sel.appendChild(opt);
    });
    // 기본형 자동 선택
    sel.selectedIndex = 1;
  }

  // 학생별 미리보기 렌더링
  renderAlimtalkPreviews();

  let modal = new bootstrap.Modal(modalEl);
  modal.show();
}

window.renderAlimtalkPreviews = function() {
  const container = document.getElementById('alimtalkPreviewContainer');
  const sel = document.getElementById('alimtalkTemplateSelect');
  const selIdx = sel.value;
  
  let templateContent = '';
  if (selIdx !== '' && appCache.templates[selIdx]) {
    templateContent = appCache.templates[selIdx].content;
  }

  container.innerHTML = currentAlimtalkRecords.map((r, idx) => {
    let text = templateContent;
    if (text) {
      // 💡 [핵심 수정] 원장님 시트의 {변수명} 과 완벽하게 1:1 매칭
      text = text.replace(/\{name\}/g, r.studentName || '');
      text = text.replace(/\{name_t\}/g, currentAlimtalkTeacher || '');
      text = text.replace(/\{date\}/g, currentAlimtalkDate ? currentAlimtalkDate.substring(5) : '');

      const bookName = r.pBook ? r.pBook.split('|')[0] : '';
      const prog = (bookName ? `[${bookName}] ` : '') + (r.pRange || '');
      text = text.replace(/\{prog\}/g, prog || '진도 없음');
      text = text.replace(/\{procedure\}/g, prog || '진도 없음'); 

      text = text.replace(/\{hw\}/g, r.hw || '없음');
      text = text.replace(/\{t1Type\}/g, r.t1Type || '일일');
      text = text.replace(/\{t1Cor\}/g, r.t1Cor || '-');
      text = text.replace(/\{t1Tot\}/g, r.t1Tot || '-');
      
      text = text.replace(/\{memo\}/g, r.memo || '');
    }

    if (r.att === '결석') text = `[${r.studentName} 결석 안내]\n금일 수업에 ${r.studentName} 학생이 참석하지 않았습니다.\n사유: ${r.memo || '미기재'}`;

    return `
      <div class="card border-0 shadow-sm mb-3">
        <div class="card-header bg-white border-bottom-0 pt-3 pb-0 d-flex justify-content-between align-items-center">
          <span class="fw-bold text-dark"><i class="bi bi-person-fill text-success"></i> ${r.studentName} <small class="text-muted fw-normal ms-1">(${r.att})</small></span>
          ${r.att === '결석' ? '<span class="badge bg-danger bg-opacity-10 text-danger border">결석생</span>' : ''}
        </div>
        <div class="card-body">
          <textarea class="form-control alimtalk-content-input border-success border-opacity-25 bg-light" rows="7" style="font-size:0.9rem; line-height:1.6;" data-idx="${idx}">${text}</textarea>
        </div>
      </div>
    `;
  }).join('');
};

window.applyAlimtalkTemplate = function() {
  renderAlimtalkPreviews();
};

// =================================================================
// 🚀 [고속 통신] 알림톡 메세지 발송 (Vercel 서버 완벽 호환)
// =================================================================
window.sendAlimtalk = async function() {
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
        inputs.forEach((inputEl, i) => {
            const text = inputEl.value.trim();
            if (!text) return;
            const targetId = currentAlimtalkRecords[i].studentId;
            for (let r = (attRes.values || []).length - 1; r >= 0; r--) {
                if (attRes.values[r][1] === targetId && attRes.values[r][3] === currentAlimtalkDate) {
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
window.loadBookView = function() {
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

window.openBookModal = function() {
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
window.saveBook = async function() {
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
    if(modal) modal.hide();
    
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
// 기록 조회 뷰 (출결 + 수업일지 몰아보기)
// =========================================
function loadHistoryView(filterPeriod, filterTeacher, filterStudent) {
  const attendance = (appCache.raw && appCache.raw.attendance) || [];
  const isManager = (appCache.user.role === '원장');

  filterPeriod  = filterPeriod  || 'week';
  filterTeacher = filterTeacher || (isManager ? '' : appCache.user.name);
  filterStudent = filterStudent || '';

  // 기간 계산
  const now   = new Date();
  const today = now.toISOString().substring(0, 10);
  let startDate = today;
  if (filterPeriod === 'today') startDate = today;
  else if (filterPeriod === 'week') {
    const d = new Date(now); d.setDate(d.getDate() - 6); startDate = d.toISOString().substring(0, 10);
  } else if (filterPeriod === 'month') {
    startDate = today.substring(0, 7) + '-01';
  } else if (filterPeriod === 'custom') {
    startDate = document.getElementById('hist-start-date')?.value || today;
  }

  // 필터링 (헤더 제외)
  let rows = attendance.filter(r => {
    const d = (r[3] || '').substring(0, 10);
    if (d < startDate || d > today) return false;
    if (filterTeacher && r[4] !== filterTeacher) return false;
    if (filterStudent && !(r[2] || '').includes(filterStudent)) return false;
    return true;
  }).reverse(); // 최신순

  // 강사 목록 (필터용)
  const teachers = isManager
    ? [...new Set((appCache.raw.teachers || []).map(t => t[1]).filter(Boolean))]
    : [appCache.user.name];

  // 기간 탭
  const periods = [
    { key: 'today', label: '오늘' },
    { key: 'week',  label: '이번주' },
    { key: 'month', label: '이번달' },
    { key: 'custom', label: '직접입력' }
  ];
  const periodTabs = periods.map(p =>
    `<button class="btn btn-sm ${filterPeriod === p.key ? 'btn-primary' : 'btn-outline-secondary'} rounded-pill fw-bold"
      onclick="loadHistoryView('${p.key}', '${filterTeacher}', '${filterStudent}')">${p.label}</button>`
  ).join('');

  // 강사 필터 (원장만 노출)
  const teacherFilterHTML = isManager ? `
    <select class="form-select form-select-sm" style="max-width:130px;"
      onchange="loadHistoryView('${filterPeriod}', this.value, '${filterStudent}')">
      <option value="">전체 강사</option>
      ${teachers.map(t => `<option value="${t}" ${filterTeacher === t ? 'selected' : ''}>${t}</option>`).join('')}
    </select>` : '';

  // 학생 검색
  const studentSearchHTML = `
    <input type="text" id="hist-student-filter" class="form-control form-control-sm border-primary" style="max-width:130px;"
      placeholder="학생명 검색" value="${filterStudent}"
      oninput="loadHistoryView('${filterPeriod}','${filterTeacher}',this.value)">`;

  // 직접 입력 날짜
  const customDateHTML = filterPeriod === 'custom' ? `
    <input type="date" id="hist-start-date" class="form-control form-control-sm" style="max-width:140px;"
      value="${startDate}"
      onchange="loadHistoryView('custom','${filterTeacher}','${filterStudent}')">
    <span class="text-muted small">~${today}</span>` : '';

  // 테이블 행 생성
  const tableRows = rows.length === 0
    ? `<tr><td colspan="8" class="text-center py-5 text-muted">해당 기간에 기록이 없습니다.</td></tr>`
    : rows.map(r => {
        const date     = (r[3] || '').substring(0, 10);
        const teacher  = r[4] || '-';
        const student  = r[2] || '-';
        const att      = r[5] || '-';
        const hw       = r[6] || '-';
        const book     = r[7] || '';
        const range    = r[8] || '';
        const memo     = r[17] || '';
        const status   = r[18] || '';

        // 수업유형 추출 (range 앞 [xxx] prefix)
        const typeMatch = range.match(/^\[([^\]]+)\]/);
        const lessonType = typeMatch ? typeMatch[1] : '일반수업';
        const cleanRange = range.replace(/^\[[^\]]+\]\s*/, '');

        const attBadge  = att === '출석' ? 'badge-att-present'
                        : att === '결석'  ? 'badge-att-absent'
                        : att === '지각'  ? 'badge-att-late'
                        : att === '조퇴'  ? 'badge-att-leave'
                        : att === '보강'  ? 'badge-att-makeup'
                        : att === '보강예정' ? 'badge-att-pending' : 'bg-secondary';
        const hwBadge   = hw === '완료' ? 'text-success' : hw === '미완료' ? 'text-danger' : hw === '세모' ? 'text-warning' : 'text-muted';
        const statusBadge = status === '최종' ? 'badge-status-final' : 'badge-status-temp';
        const typeBadge = lessonType === '클리닉' ? 'bg-warning text-dark' : lessonType === '개념노트' ? 'bg-info text-white' : lessonType === '테스트' ? 'bg-danger' : 'bg-light text-dark border';


        return `
          <tr style="font-size:0.83rem;">
            <td class="text-muted fw-bold">${date}</td>
            <td>${teacher}</td>
            <td class="fw-bold">${student}</td>
            <td><span class="badge ${attBadge} rounded-pill">${att}</span></td>
            <td><span class="${hwBadge} fw-bold">${hw}</span></td>
            <td><span class="badge ${typeBadge}" style="font-size:0.7rem;">${lessonType}</span></td>
            <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${book} ${cleanRange}">
              ${book ? `<small class="text-muted">[${book}]</small> ` : ''}${cleanRange || '-'}
            </td>
            <td>
              ${status ? `<span class="badge ${statusBadge}" style="font-size:0.65rem;">${status}</span>` : '-'}
              ${memo ? `<span class="text-muted small ms-1" title="${memo}">💬</span>` : ''}
            </td>
          </tr>`;
      }).join('');

  document.getElementById('view-container').innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
      <h4 class="fw-bold m-0"><i class="bi bi-journal-bookmark-fill me-2 text-primary"></i>기록 조회 (출결 + 수업일지)</h4>
      <button class="btn btn-outline-secondary btn-sm rounded-pill" onclick="loadHistoryView('${filterPeriod}','${filterTeacher}','${filterStudent}')">
        <i class="bi bi-arrow-clockwise"></i> 새로고침
      </button>
    </div>

    <div class="card shadow-sm border-0 mb-4 p-3">
      <div class="d-flex flex-wrap gap-2 align-items-center">
        <span class="fw-bold small text-muted">기간:</span>
        ${periodTabs}
        ${customDateHTML}
        <div class="ms-auto d-flex gap-2">
          ${teacherFilterHTML}
          ${studentSearchHTML}
        </div>
      </div>
      <div class="text-muted small mt-2">
        총 <b>${rows.length}</b>건 · ${startDate} ~ ${today}
      </div>
    </div>

    <div class="card shadow-sm border-0">
      <div class="table-responsive" style="max-height:60vh;">
        <table class="table table-hover align-middle mb-0">
          <thead class="table-light sticky-top" style="top:0; z-index:1;">
            <tr style="font-size:0.82rem;">
              <th>날짜</th>
              <th>강사</th>
              <th>학생</th>
              <th>출결</th>
              <th>과제</th>
              <th>수업유형</th>
              <th>진도 범위</th>
              <th>상태/메모</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>`;
}
window.loadHistoryView = loadHistoryView;


// =========================================
// 성적 관리 뷰
// =========================================
async function loadScoreView() {
  // 성적DB 시트 없을 경우 자동 생성
  try {
    const created = await ensureScoreSheet();
    if (created) {
      // 시트 신규 생성 시 캐시 초기화 (빈 배열로 유지)
      appCache.raw.scores = [];
    }
  } catch(e) {
    console.warn('성적DB 시트 확인/생성 중 오류:', e.message);
  }

  const scores = (appCache.raw && appCache.raw.scores) || [];
  const students = (appCache.raw && appCache.raw.students) || [];
  const isManager = (appCache.user.role === '원장');

  // 최신순 정렬
  const sorted = [...scores].reverse();

  // 필터용 학생 목록
  const studentOpts = students
    .filter(s => s[0] && s[0].startsWith('S'))
    .sort((a, b) => (a[1] || '').localeCompare(b[1] || ''))
    .map(s => `<option value="${s[1]} (${s[0]})">${s[1]} (${s[3] || ''} ${s[4] || ''})</option>`)
    .join('');

  // 성적 행 생성
  let tableRows = '';
  if (sorted.length === 0) {
    tableRows = `<tr><td colspan="8" class="text-center py-5 text-muted">등록된 성적 데이터가 없습니다.</td></tr>`;
  } else {
    // 권한별 필터
    const filtered = isManager ? sorted : sorted.filter(r => r[9] === appCache.user.name);
    filtered.forEach(r => {
      const date     = (r[3] || '').substring(0, 10);
      const student  = r[2] || '-';
      const examType = r[4] || '-';
      const subject  = r[5] || '-';
      const score    = r[6] !== undefined && r[6] !== '' ? r[6] : '-';
      const total    = r[7] || '100';
      const memo     = r[8] || '';
      const teacher  = r[9] || '-';

      // 성취율 계산
      const pct = (score !== '-' && total) ? Math.round(parseFloat(score) / parseFloat(total) * 100) : null;
      const pctColor = pct === null ? '' : pct >= 90 ? 'text-success' : pct >= 70 ? 'text-primary' : pct >= 50 ? 'text-warning' : 'text-danger';

      let typeBadge = 'bg-secondary';
      if (examType.includes('중간')) typeBadge = 'bg-danger';
      else if (examType.includes('단원')) typeBadge = 'bg-primary';
      else if (examType.includes('월말')) typeBadge = 'bg-info text-white';

      tableRows += `
        <tr style="font-size:0.83rem;">
          <td class="text-muted fw-bold">${date}</td>
          <td class="fw-bold">${student}</td>
          <td><span class="badge ${typeBadge} rounded-pill">${examType}</span></td>
          <td>${subject}</td>
          <td class="fw-bold fs-6 text-center">${score}</td>
          <td class="text-center text-muted">/ ${total}</td>
          <td class="fw-bold ${pctColor} text-center">${pct !== null ? pct + '%' : '-'}</td>
          <td class="text-muted small">${memo || (isManager ? teacher : '')}</td>
        </tr>`;
    });
    if (!tableRows) {
      tableRows = `<tr><td colspan="8" class="text-center py-5 text-muted">해당 권한에 맞는 성적 데이터가 없습니다.</td></tr>`;
    }
  }

  document.getElementById('view-container').innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-4">
      <h4 class="fw-bold m-0"><i class="bi bi-bar-chart-fill me-2 text-success"></i>성적 관리</h4>
      <div class="d-flex gap-2">
        <button class="btn btn-outline-secondary btn-sm rounded-pill" onclick="refreshScoreData()">
          <i class="bi bi-arrow-clockwise"></i> 새로고침
        </button>
        <button class="btn btn-success btn-sm rounded-pill fw-bold" onclick="openScoreModal()">
          <i class="bi bi-plus-lg"></i> 성적 입력
        </button>
      </div>
    </div>

    <div class="card shadow-sm border-0">
      <div class="table-responsive" style="max-height:65vh;">
        <table class="table table-hover align-middle mb-0">
          <thead class="table-light sticky-top">
            <tr style="font-size:0.82rem;">
              <th>시험일</th>
              <th>학생명</th>
              <th>시험종류</th>
              <th>과목</th>
              <th class="text-center">점수</th>
              <th class="text-center">만점</th>
              <th class="text-center">성취율</th>
              <th>${isManager ? '강사' : '비고'}</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>

    <!-- 성적 입력 모달 -->
    <div class="modal fade" id="scoreModal" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content border-0 shadow-lg">
          <div class="modal-header bg-success text-white">
            <h5 class="modal-title fw-bold"><i class="bi bi-pencil-square me-2"></i>성적 입력</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body p-4">
            <div class="row g-3">
              <div class="col-md-8">
                <label class="form-label fw-bold small">학생 검색 <span class="text-danger">*</span></label>
                <input type="text" id="score-student-search" class="form-control" autocomplete="off" placeholder="이름 입력...">
                <div id="score-student-list" class="list-group mt-1" style="max-height:150px; overflow-y:auto; display:none;"></div>
                <input type="hidden" id="score-student-id">
              </div>
              <div class="col-md-4">
                <label class="form-label fw-bold small">시험일자 <span class="text-danger">*</span></label>
                <input type="date" id="score-date" class="form-control" value="${new Date().toISOString().substring(0,10)}">
              </div>
              <div class="col-md-6">
                <label class="form-label fw-bold small">시험종류 <span class="text-danger">*</span></label>
                <input type="text" id="score-type" class="form-control" list="score-type-list" placeholder="직접 입력 또는 선택">
                <datalist id="score-type-list">
                  <option value="중간고사">중간고사</option>
                  <option value="기말고사">기말고사</option>
                  <option value="단원평가">단원평가</option>
                  <option value="월말평가">월말평가</option>
                  <option value="모의고사">모의고사</option>
                </datalist>
              </div>
              <div class="col-md-6">
                <label class="form-label fw-bold small">과목</label>
                <input type="text" id="score-subject" class="form-control" value="수학" placeholder="예: 수학">
              </div>
              <div class="col-md-5">
                <label class="form-label fw-bold small">점수 <span class="text-danger">*</span></label>
                <input type="number" id="score-score" class="form-control fw-bold" placeholder="예: 85" min="0" max="999">
              </div>
              <div class="col-md-4">
                <label class="form-label fw-bold small">만점</label>
                <input type="number" id="score-total" class="form-control" value="100" placeholder="100">
              </div>
              <div class="col-12">
                <label class="form-label fw-bold small">비고</label>
                <input type="text" id="score-memo" class="form-control" placeholder="선택사항">
              </div>
            </div>
          </div>
          <div class="modal-footer bg-light">
            <button class="btn btn-secondary rounded-pill" data-bs-dismiss="modal">취소</button>
            <button class="btn btn-success rounded-pill fw-bold px-4" onclick="saveScore()">
              <i class="bi bi-check-circle-fill me-1"></i>저장
            </button>
          </div>
        </div>
      </div>
    </div>`;

  // 성적 학생 자동완성 이벤트
  const si = document.getElementById('score-student-search');
  if (si) {
    si.addEventListener('input', function() {
      const q = this.value.trim().toLowerCase();
      const listEl = document.getElementById('score-student-list');
      if (!q) { listEl.style.display = 'none'; return; }
      const matches = students.filter(s => (s[1]||'').toLowerCase().includes(q) && s[0]).slice(0,10);
      if (!matches.length) { listEl.style.display = 'none'; return; }
      listEl.innerHTML = matches.map(s =>
        `<button class="list-group-item list-group-item-action py-1 px-2 text-start"
          onclick="selectScoreStudent('${s[0]}','${s[1]}')">
          <strong>${s[1]}</strong> <small class="text-muted">${s[3]||''} ${s[4]||''}</small>
        </button>`
      ).join('');
      listEl.style.display = 'block';
    });
  }
}
window.loadScoreView = loadScoreView;

window.openScoreModal = function() {
  const modalEl = document.getElementById('scoreModal');
  if (modalEl) {
    document.getElementById('score-student-search').value = '';
    document.getElementById('score-student-id').value = '';
    document.getElementById('score-score').value = '';
    document.getElementById('score-memo').value = '';
    document.getElementById('score-student-list').style.display = 'none';
    new bootstrap.Modal(modalEl).show();
  }
};

window.selectScoreStudent = function(id, name) {
  document.getElementById('score-student-search').value = name;
  document.getElementById('score-student-id').value = id;
  document.getElementById('score-student-list').style.display = 'none';
};

// =================================================================
// 🚀 [고속 통신] 성적 데이터 초고속 저장 (429 에러 방지)
// =================================================================
window.saveScore = async function() {
  const name    = document.getElementById('score-student-search').value.trim();
  const id      = document.getElementById('score-student-id').value.trim();
  const date    = document.getElementById('score-date').value;
  const type    = document.getElementById('score-type').value;
  const subject = document.getElementById('score-subject').value.trim();
  const score   = document.getElementById('score-score').value.trim();
  const total   = document.getElementById('score-total').value.trim();
  const memo    = document.getElementById('score-memo').value.trim();

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
  } catch(e) {
    showLoader(false);
    alert('저장 중 오류가 발생했습니다: ' + e.message);
  }
};

// =================================================================
// 🚀 [신규 기능] 메인 대시보드 - 학원 공용 공지사항 (구글 시트 연동)
// =================================================================
window.renderNoticeBoard = function() {
    // appCache.raw.notices 에 공지DB 데이터가 있다고 가정 (없으면 빈 배열)
    let notices = (appCache.raw && appCache.raw.notices) || [];
    
    // '삭제'되지 않은 활성 공지만 필터링하고 최신순(역순)으로 정렬
    // 헤더 행([0]) 제외하고 데이터만 필터링
    let activeNotices = notices.slice(1).filter(n => n[3] !== '삭제').reverse();

    let html = `
    <div class="card p-4 shadow-sm border-0 mb-4 border-top border-warning border-4 h-100" id="notice-card">
        <div class="d-flex justify-content-between align-items-center mb-3">
            <h5 class="fw-bold text-warning m-0"><i class="bi bi-megaphone-fill"></i> 학원 공용 공지사항</h5>
            <button class="btn btn-sm btn-outline-warning rounded-pill" onclick="refreshNoticeData()"><i class="bi bi-arrow-clockwise"></i></button>
        </div>
        
        <div class="input-group mb-3 shadow-sm">
            <input type="text" class="form-control bg-light border-0" id="newNoticeInput" placeholder="모두에게 공유할 내용 입력..." onkeyup="if(event.keyCode===13) addNotice()">
            <button class="btn btn-warning text-dark fw-bold px-3" onclick="addNotice()" id="btn-add-notice">등록</button>
        </div>
        
        <div class="list-group list-group-flush" id="noticeListContainer" style="max-height: 350px; overflow-y: auto;">
    `;

    if (activeNotices.length === 0) {
        html += `<div class="text-center text-muted small py-4 bg-transparent">등록된 공지사항이 없습니다.</div>`;
    } else {
        activeNotices.forEach((n, idx) => {
            let date = n[0] ? n[0].substring(5, 16) : ''; // MM-DD HH:mm
            let author = n[1] || '알수없음';
            let content = n[2] || '';
            // 원장님이거나 본인이 쓴 글만 삭제 버튼 표시
            let deleteBtn = (appCache.user.role === '원장' || appCache.user.name === author) 
                ? `<button class="btn btn-sm text-danger p-0 ms-2" onclick="deleteNotice('${n[0]}')" title="삭제"><i class="bi bi-x-circle-fill opacity-50 hover-opacity-100"></i></button>` 
                : '';

            html += `
            <div class="list-group-item px-2 py-3 border-bottom border-light bg-transparent">
                <div class="d-flex justify-content-between align-items-start mb-1">
                    <span class="badge bg-light text-dark border shadow-sm" style="font-size:0.7rem;"><i class="bi bi-person-fill text-warning"></i> ${author}</span>
                    <div class="d-flex align-items-center">
                        <small class="text-muted" style="font-size:0.7rem;">${date}</small>
                        ${deleteBtn}
                    </div>
                </div>
                <div class="fw-bold text-dark mt-1" style="font-size:0.9rem; white-space:pre-wrap; word-break:keep-all;">${content}</div>
            </div>`;
        });
    }
    html += `</div></div>`;
    return html;
};

// 공지사항 등록 (초고속 API 저장)
window.addNotice = async function() {
    let input = document.getElementById('newNoticeInput');
    let text = input.value.trim();
    if (!text) return;

    let btn = document.getElementById('btn-add-notice');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

    try {
        const rowData = [
            new Date().toLocaleString('ko-KR'), // A: 타임스탬프 (고유 ID 역할)
            appCache.user.name,                 // B: 작성자
            text,                               // C: 내용
            "활성"                              // D: 상태
        ];
        
        const sheetName = CONFIG.SHEETS.NOTICE;
        const body = { values: [rowData] };
        
        await callSheetsAPI('POST', `/values/${encodeURIComponent(sheetName)}:append?valueInputOption=USER_ENTERED`, body);
        
        input.value = '';
        await refreshNoticeData(); // 데이터 다시 불러와서 화면 갱신
    } catch (e) {
        alert("공지 등록 실패: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '등록';
    }
};

// 공지사항 삭제 (상태를 '삭제'로 업데이트)
window.deleteNotice = async function(timestampId) {
    if (!confirm("이 공지사항을 삭제하시겠습니까?")) return;
    
    showLoader(true, "삭제 중...");
    try {
        // 실제로는 해당 행을 찾아 상태를 '삭제'로 바꿔야 함. 
        // 1. 전체 공지 로딩
        const sheetName = CONFIG.SHEETS.NOTICE;
        const res = await callSheetsAPI('GET', `/values/${encodeURIComponent(sheetName)}!A:D`);
        const values = res.values || [];
        
        // 2. 타임스탬프가 일치하는 행 번호 찾기 (0-indexed -> 1-indexed)
        const rowIndex = values.findIndex(r => r[0] === timestampId);
        if (rowIndex < 0) throw new Error("삭제할 데이터를 찾을 수 없습니다.");
        
        const rowNum = rowIndex + 1;
        
        // 3. 해당 행의 D열(상태) 만 '삭제' 로 업데이트
        const body = { values: [["삭제"]] };
        await callSheetsAPI('PUT', `/values/${encodeURIComponent(sheetName + '!D' + rowNum)}?valueInputOption=USER_ENTERED`, body);

        showLoader(false);
        await refreshNoticeData();
    } catch(e) {
        showLoader(false);
        alert("오류: " + e.message);
    }
};

// 공지사항 데이터 새로고침
window.refreshNoticeData = async function() {
    showLoader(true, "공지사항 불러오는 중...");
    try {
        const sheetName = CONFIG.SHEETS.NOTICE;
        const res = await callSheetsAPI('GET', `/values/${encodeURIComponent(sheetName)}!A:D`);
        if (!appCache.raw) appCache.raw = {};
        appCache.raw.notices = res.values || [];
        
        // 대시보드 화면 다시 그리기
        if(typeof loadDashboardView === 'function') loadDashboardView();
    } catch (e) {
        console.error(e);
    }
    showLoader(false);
};


// =================================================================
// 🚀 [신규 기능] 로그인 권한에 따른 좌측 메뉴 필터링 (원장 vs 강사)
// =================================================================
window.applyUserRoleUI = function() {
    // 1. 현재 로그인한 사람ของ 권한 확인 ('원장' 또는 '강사')
    const role = appCache.user?.role || '강사'; 
    
    // 2. 강사에게는 보이면 안 되는 '관리자 전용 메뉴' ID 목록
    const adminOnlyMenus = [
        'menu-STUDENT',  // 원천DB (학생관리)
        'menu-REGISTER', // 수강등록
        'menu-BOOK'      // 교재관리
    ]; 
    
    // 3. 권한에 따라 메뉴 숨기기/보이기
    adminOnlyMenus.forEach(menuId => {
        const menuEl = document.getElementById(menuId);
        if (menuEl) {
            if (role === '강사') {
                menuEl.style.display = 'none'; // 강사는 메뉴 숨김
            } else {
                menuEl.style.display = 'block'; // 원장님은 모두 보임
            }
        }
    });

    // 4. 대시보드를 다시 렌더링 (강사는 본인 수업만, 원장은 전체 수업이 뜨도록 갱신)
    if (typeof loadDashboardView === 'function') {
        loadDashboardView();
    }
};

// =================================================================
// 🚀 [테스트 전용] 강사 빙의 (계정 스위치) 플로팅 위젯
// =================================================================
window.createTestLoginWidget = function() {
    // 이미 위젯이 있으면 중복 생성 방지
    if(document.getElementById('test-login-widget')) return;

    const teachers = appCache.raw.teachers || [];
    
    // 원장님 기본 옵션
    let options = `<option value="원장|김인주">👑 김인주 (원장)</option>`;
    
    // 강사DB에서 원장님을 제외한 나머지 강사 목록 싹 불러오기
    teachers.forEach(t => {
        // t[1]: 강사명, t[4]: 재직상태
        if(t[1] && t[4] !== '퇴사' && !t[1].includes('김인주')) {
            options += `<option value="강사|${t[1]}">👨‍🏫 ${t[1]} (강사)</option>`;
        }
    });

    const widget = document.createElement('div');
    widget.id = 'test-login-widget';
    widget.style.cssText = 'position:fixed; bottom:20px; right:20px; z-index:9999; background:white; padding:15px; border-radius:10px; box-shadow:0 10px 25px rgba(0,0,0,0.2); border:2px solid #f59e0b; width:220px; transition: all 0.3s ease;';
    widget.innerHTML = `
        <label class="form-label fw-bold text-warning small mb-2"><i class="bi bi-incognito"></i> [테스트] 계정 스위치</label>
        <select class="form-select form-select-sm border-warning fw-bold" onchange="switchTestUser(this.value)">
            <option value="">테스트 계정 선택...</option>
            ${options}
        </select>
    `;
    document.body.appendChild(widget);
};

window.switchTestUser = function(val) {
    if(!val) return;
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
