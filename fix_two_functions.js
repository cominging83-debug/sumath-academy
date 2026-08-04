// ★ 수정 1: initApp 함수 (기존 함수 전체를 이것으로 교체)
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

        // ★ 템플릿 + 스케줄 동시 로드 (병렬)
        let templatesLoaded = false;
        let scheduleLoaded = false;
        const trySwitch = () => { if (templatesLoaded && scheduleLoaded) switchView(targetMenu); };

        google.script.run.withSuccessHandler(res => {
            if (res && res.success) appCache.templates = res.templates;
            templatesLoaded = true; trySwitch();
        }).withFailureHandler(() => { templatesLoaded = true; trySwitch(); }).getTemplates();

        google.script.run.withSuccessHandler(schedData => {
            if (schedData && schedData.success) {
                appCache.schedule = schedData;
                allEvents = schedData.events || [];
                todayServerStr = schedData.today;
            }
            scheduleLoaded = true; trySwitch();
        }).withFailureHandler(() => { scheduleLoaded = true; trySwitch(); }).getScheduleData();

    }).withFailureHandler(err => showErrorMsg(err.message)).getInitData();
}

// ★ 수정 2: loadDashboardView 바로 다음에 아래 함수 추가 (buildDashboardUI 누락이 오류 원인)
function buildDashboardUI(data) {
    allEvents = data.events || [];
    todayServerStr = data.today;
    renderDashboard(appCache.user.role === '강사' ? appCache.user.name : 'ALL');
}
