// ============================================================
// ui_logic_patch.js - 최종 수정본
// 아래 함수들을 기존 ui_logic.html의 동일 함수와 교체하세요.
// ============================================================

// ★ [필수] buildDashboardUI - 기존 코드에서 삭제된 함수 (반드시 복원)
function buildDashboardUI(data) {
  allEvents = data.events || [];
  todayServerStr = data.today;
  renderDashboard(appCache.user.role === '강사' ? appCache.user.name : 'ALL');
}

// ★ [핵심] initApp - 로그인 로딩 중 스케줄 데이터 미리 받아놓기
// getInitData, getTemplates, getScheduleData 세 개를 동시에 호출
// 셋 다 완료되면 switchView 실행 → 대시보드 즉시 렌더링
function initApp(userName, userRole, targetMenu = 'DASHBOARD') {
  showLoader(true);
  google.script.run.withSuccessHandler(info => {
    if (!info || !info.success) { showErrorMsg(info ? info.error : "서버 연결에 실패했습니다."); return; }
    appCache.init = info; appCache.bookList = info.bookList || [];
    allTeachers = info.cleanTeachers.map(t => ({ id: t, name: t }));

    if (userName) appCache.user = { name: userName, role: userRole };
    document.getElementById('userRoleDisplay').innerHTML = `접속: <b>${appCache.user.name}</b> (${appCache.user.role})`;

    if (appCache.user.role === '강사') {
      document.getElementById('menu-REGISTER').style.display = 'none';
      document.getElementById('menu-STUDENT').style.display = 'none';
      document.getElementById('menu-TEMPLATE').style.display = 'none';
    } else {
      document.getElementById('menu-REGISTER').style.display = 'block';
      document.getElementById('menu-STUDENT').style.display = 'block';
      document.getElementById('menu-TEMPLATE').style.display = 'block';
    }

    let dl = document.getElementById('globalBookList');
    if (dl) dl.innerHTML = appCache.bookList.map(b => `<option value="${b.name}"></option>`).join('');

    // ★ 두 요청이 모두 완료되면 화면 전환
    let templatesLoaded = false;
    let scheduleLoaded = false;
    const trySwitch = () => {
      if (templatesLoaded && scheduleLoaded) switchView(targetMenu);
    };

    // 요청 1: 템플릿
    google.script.run.withSuccessHandler(res => {
      if (res && res.success) appCache.templates = res.templates;
      templatesLoaded = true;
      trySwitch();
    }).withFailureHandler(() => { templatesLoaded = true; trySwitch(); }).getTemplates();

    // ★ 요청 2: 스케줄 데이터 미리 로드 (로그인 로딩 중에 받아놓음)
    google.script.run.withSuccessHandler(schedData => {
      if (schedData && schedData.success) {
        appCache.schedule = schedData;
        allEvents = schedData.events || [];
        todayServerStr = schedData.today;
      }
      scheduleLoaded = true;
      trySwitch();
    }).withFailureHandler(() => { scheduleLoaded = true; trySwitch(); }).getScheduleData();

  }).withFailureHandler(err => showErrorMsg(err.message)).getInitData();
}

// ★ loadDashboardView - 캐시 있으면 즉시 렌더 (buildDashboardUI 호출)
function loadDashboardView() {
  if (appCache.schedule) {
    buildDashboardUI(appCache.schedule);
    showLoader(false);
    return;
  }
  showLoader(true);
  google.script.run
    .withSuccessHandler(data => {
      try {
        if (!data.success) throw new Error(data.error);
        appCache.schedule = data;
        buildDashboardUI(data);
        showLoader(false);
      } catch (e) { showErrorMsg(e.message); }
    })
    .withFailureHandler(err => showErrorMsg(err.message))
    .getScheduleData();
}

// ★ loadScheduleView - 같은 주면 캐시 재사용
function loadScheduleView() {
  let dStr = currentTimetableDate.toISOString().substring(0, 10);
  if (appCache.schedule && appCache.schedule.weekDates) {
    let cachedDates = appCache.schedule.weekDates.map(w => w.date);
    if (cachedDates.indexOf(dStr) !== -1) {
      buildScheduleUI(appCache.schedule);
      showLoader(false);
      return;
    }
  }
  showLoader(true);
  google.script.run
    .withSuccessHandler(data => {
      try {
        if (!data.success) throw new Error(data.error);
        appCache.schedule = data;
        buildScheduleUI(data);
        showLoader(false);
      } catch (e) { showErrorMsg(e.message); }
    })
    .withFailureHandler(err => showErrorMsg(err.message))
    .getScheduleData(dStr);
}

// ★ loadAbsenteeView - 캐시 있으면 즉시 렌더
function loadAbsenteeView() {
  if (appCache.absent) {
    buildAbsenteeUI(appCache.absent);
    showLoader(false);
    return;
  }
  showLoader(true);
  google.script.run
    .withSuccessHandler(res => {
      try {
        if (!res.success) throw new Error(res.error);
        appCache.absent = res;
        buildAbsenteeUI(res);
        showLoader(false);
      } catch (e) { showErrorMsg(e.message); }
    })
    .withFailureHandler(e => showErrorMsg(e.message))
    .getAbsenteeData();
}

// ★ clearCache - absent 필드 추가
function clearCache() {
  let u = appCache.user;
  appCache = { schedule: null, students: null, init: null, absent: null, studentHistory: {}, templates: [], bookList: [], user: u };
}
