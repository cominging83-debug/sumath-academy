// =========================================
// 수학의 힘 v2 - api.js (로그인 최적화 버전)
// =========================================

let tokenClient;
let accessToken = null;
let tokenRefreshInterval = null;

let _googleAuthInitialized = false;
function initGoogleAuth() {
    if (_googleAuthInitialized) return; // 중복 초기화 방지
    _googleAuthInitialized = true;

    // 💡 [핵심 수정] 토큰 캐시와 상관없이 백그라운드 자동 갱신을 위해 무조건 먼저 초기화합니다!
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.CLIENT_ID,
        scope: CONFIG.SCOPES,
        callback: (tokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
                accessToken = tokenResponse.access_token;
                localStorage.setItem('gapi_token', accessToken);
                localStorage.setItem('gapi_token_time', new Date().getTime());
                document.getElementById('login-screen').classList.add('d-none');
                document.getElementById('main-app').classList.remove('d-none');
                loadInitialData();
                startTokenAutoRefresh();
            }
        },
    });

    // 1. 기존 로그인 세션 유지 로직
    const savedToken = localStorage.getItem('gapi_token');
    const savedTime = localStorage.getItem('gapi_token_time');

    if (savedToken && savedTime) {
        const now = new Date().getTime();
        if (now - savedTime < 50 * 60 * 1000) { // 50분 이내면 구글 묻지 않고 프리패스
            accessToken = savedToken;
            const cachedUser = localStorage.getItem('gapi_user');
            if (cachedUser) {
                appCache.user = JSON.parse(cachedUser);
            } else {
                appCache.user = { email: '', name: '', role: '강사' };
            }
            document.getElementById('login-screen').classList.add('d-none');
            document.getElementById('main-app').classList.remove('d-none');
            loadInitialData();
            startTokenAutoRefresh();
            return; // ✨ 구글 로그인 버튼 생성은 생략하고 바로 통과!
        } else {
            localStorage.removeItem('gapi_token');
            localStorage.removeItem('gapi_token_time');
        }
    }

    google.accounts.id.initialize({
        client_id: CONFIG.CLIENT_ID,
        callback: typeof handleCredentialResponse !== 'undefined' ? handleCredentialResponse : null
    });

    // 가운데 화면에 큼직한 구글 버튼 그리기
    google.accounts.id.renderButton(
        document.getElementById("google-signin-btn"),
        { theme: "outline", size: "large", text: "continue_with" }
    );
}

function startTokenAutoRefresh() {
    if (tokenRefreshInterval) clearInterval(tokenRefreshInterval);
    tokenRefreshInterval = setInterval(() => {
        console.log("🔄 세션 연장: 사용자 방해 없이 백그라운드 갱신");
        if (tokenClient) {
            // prompt를 빈칸으로 두어 동의창 없이 조용히 토큰만 새로 받아옴
            tokenClient.requestAccessToken({ prompt: '' });
        }
    }, 45 * 60 * 1000);
}

function parseJwt(token) {
    try {
        var base64Url = token.split('.')[1];
        var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        var jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        console.error("토큰 해독 오류:", e);
        return {};
    }
}

function handleCredentialResponse(response) {
    const data = parseJwt(response.credential);
    appCache.user = {
        name: data.name,
        email: data.email,
        picture: data.picture,
        role: '강사'
    };
    localStorage.setItem('gapi_user', JSON.stringify(appCache.user));

    // ✨ 핵심 수정: prompt: 'consent'를 빼서 매번 동의창이 뜨지 않게 함
    tokenClient.requestAccessToken({ prompt: '' });
}

async function callSheetsAPI(method, path, body = null, customSpreadsheetId = null, isRetry = false) {
    if (!accessToken) throw new Error("인증 토큰이 없습니다. 다시 로그인해주세요.");

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${customSpreadsheetId || CONFIG.SPREADSHEET_ID}${path}`;
    const options = {
        method: method,
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        }
    };
    if (body) {
        options.body = JSON.stringify(body);
    }

    let response = await fetch(url, options);

    // 💡 [핵심 방어 코드] 토큰 만료(401 에러) 감지 시, 튕기지 않고 몰래 열쇠를 새로 받아와서 마저 실행합니다!
    if (response.status === 401 && !isRetry) {
        console.warn("🔑 구글 로그인 토큰 만료 감지! 백그라운드 자동 갱신을 시도합니다...");

        return new Promise((resolve, reject) => {
            // 토큰 재발급 후 실행될 콜백(행동) 가로채기
            tokenClient.callback = async (resp) => {
                if (resp.error !== undefined) {
                    alert("보안 토큰이 완전히 만료되었습니다. 안전을 위해 새로고침(F5) 후 다시 로그인해주세요.");
                    reject(new Error("토큰 자동 갱신 실패"));
                    return;
                }

                // 새 열쇠 발급 성공! 저장소에 업데이트
                accessToken = resp.access_token;
                localStorage.setItem('gapi_token', accessToken);
                localStorage.setItem('gapi_token_time', new Date().getTime());
                console.log("🔑 토큰 갱신 완료! 중단되었던 API 작업을 마저 진행합니다.");

                try {
                    // 새 열쇠를 들고 아까 실패했던 작업을 '재시도(isRetry=true)' 합니다!
                    const retryData = await callSheetsAPI(method, path, body, customSpreadsheetId, true);
                    resolve(retryData);
                } catch (retryErr) {
                    reject(retryErr);
                }
            };

            // 💡 화면 팝업 없이 조용히 토큰만 연장해달라고 구글에 백그라운드 요청 (prompt: '')
            tokenClient.requestAccessToken({ prompt: '' });
        });
    }

    if (!response.ok) {
        const errorData = await response.json();
        console.error('API Error:', errorData);
        throw new Error(`Google API 호출 실패: ${errorData.error.message}`);
    }
    return await response.json();
}

async function getSheetData(sheetName, range = '') {
    const queryRange = range ? `${sheetName}!${range}` : sheetName;
    const data = await callSheetsAPI('GET', `/values/${encodeURIComponent(queryRange)}`);
    return data.values || [];
}

async function getOptionalSheetData(sheetName, range = '') {
    try {
        return await getSheetData(sheetName, range);
    } catch (e) {
        console.warn(`${sheetName} 시트를 찾을 수 없어 빈 데이터로 초기화합니다.`);
        return [];
    }
}

// 전체 초기 데이터 병렬 로드 (속도 5배 향상 핵심)
async function loadInitialData() {
    showLoader(true, "기초 데이터를 불러오는 중...");
    // 💡 [버그 방어] appCache.user가 null이면 빈 객체로 초기화
    if (!appCache.user) appCache.user = { email: '', name: '', role: '강사' };
    try {
        // 💡 [수정] 맨 끝에 issues 와 '이슈DB' 로드 명령을 추가했습니다!
        const [teachers, students, schedules, attendance, counsels, books, tatt, classes, scores, templatesRaw, notices, makeups, issues, smsLogs, monthlyEvalDb, tuition, salary, studentMemos] = await Promise.all([
            getOptionalSheetData(CONFIG.SHEETS.TEACHER, 'A2:L'),
            getOptionalSheetData(CONFIG.SHEETS.STUDENT, 'A2:P'),
            getOptionalSheetData(CONFIG.SHEETS.SCHEDULE, 'A2:N'),
            getOptionalSheetData(CONFIG.SHEETS.ATTENDANCE, 'A2:ZZ'),
            getOptionalSheetData(CONFIG.SHEETS.COUNSEL, 'A2:M'),
            getOptionalSheetData(CONFIG.SHEETS.BOOK, 'A2:E'),
            getOptionalSheetData(CONFIG.SHEETS.TATT, 'A2:E'),
            getOptionalSheetData(CONFIG.SHEETS.CLASS, 'A2:H'),
            getOptionalSheetData(CONFIG.SHEETS.SCORE, 'A2:J'),
            getOptionalSheetData(CONFIG.SHEETS.ALIMTALK, 'A2:B'),
            getOptionalSheetData(CONFIG.SHEETS.NOTICE, 'A2:D'),
            getOptionalSheetData('보강일정DB', 'A2:I'),
            getOptionalSheetData('이슈DB', 'A2:F'),
            getSmsLogData(), // SMS 발송 로그 (별도 Sheet)
            getOptionalSheetData(CONFIG.SHEETS.MONTHLY_EVAL_DB, 'A2:Q'), // 월말평가 결과 누적
            getOptionalSheetData(CONFIG.SHEETS.TUITION, 'A2:E'), // 수강료 단가표
            getOptionalSheetData(CONFIG.SHEETS.SALARY, 'A2:C'),  // 강사 월급여
            getOptionalSheetData(CONFIG.SHEETS.STUDENT_MEMO, 'A2:I') // 학생별 상시 메모
        ]);

        // 💡 [수정] 가져온 issues 데이터를 메모리(appCache)에 등록합니다.
        appCache.raw = { teachers, students, schedules, attendance, counsels, books, tatt, classes, scores, notices, '보강일정DB': makeups, '이슈DB': issues, smsLogs, monthlyEvalDb, tuition, salary, studentMemos };

        globalSourceStudents = students.map(s => s[1]).filter(name => name);
        appCache.templates = templatesRaw.map(r => ({ title: r[0], content: r[1] })).filter(t => t.title);
        const myEmail = (appCache.user && appCache.user.email ? appCache.user.email : '').trim().toLowerCase();
        const myInfo = teachers.find(t => t[7] && t[7].trim().toLowerCase() === myEmail);

        if (myInfo) {
            appCache.user.branch = myInfo[2] || '';
            appCache.user.name = myInfo[1];
            appCache.user.role = myInfo[8] ? myInfo[8].trim() : '강사';
            appCache.user.teacherId = myInfo[0];

            // 💡 [추가됨] 강사DB K열에 저장된 개인 투두리스트 불러오기
            try { appCache.user.todos = myInfo[10] ? JSON.parse(myInfo[10]) : []; }
            catch (e) { appCache.user.todos = []; }
        } else {
            localStorage.clear();
            document.getElementById('main-app').classList.add('d-none');
            document.getElementById('login-screen').classList.remove('d-none');
            showLoader(false);

            const errDiv = document.getElementById('login-error');
            if (errDiv) {
                errDiv.innerHTML = `<i class="bi bi-shield-fill-x me-2"></i>🚫 접근 차단됨: <b>${myEmail}</b><br>강사DB에 등록되지 않은 계정입니다.`;
                errDiv.classList.remove('d-none');
            } else {
                alert(`🚫 접근 차단됨\n등록되지 않은 계정입니다: ${myEmail}`);
            }
            return;
        }

        document.getElementById('userRoleDisplay').innerHTML = `접속: <b>${appCache.user.name}</b> (${appCache.user.role})`;

        parseRawData();
        showLoader(false);

        if (typeof applyUserRoleUI === 'function') {
            applyUserRoleUI();
        }

        const activeMenu = document.querySelector('.menu-btn.active');
        const currentView = activeMenu ? activeMenu.id.replace('menu-', '') : 'DASHBOARD';
        if (typeof switchView === 'function') switchView(currentView);

    } catch (error) {
        console.error("데이터 로드 오류:", error);
        if (typeof showErrorMsg === 'function') showErrorMsg(error.message);
    }
}

function parseRawData() {
    if (!appCache.raw) return;
    appCache.teachers = (appCache.raw.teachers || []).filter(r => r[1] && r[4] !== '퇴사').map(r => ({
        id: r[0], name: r[1], role: r[8] ? r[8].trim() : '강사'
    }));
}

async function appendAttendanceData(records) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const values = records.map(r => [
        timestamp, r.studentId, r.studentName, r.date, r.teacherId, r.att, r.hw, r.pBook, r.pRange, r.hwBook, r.hwRange,
        r.t1Type, r.t1Cor, r.t1Tot, r.t2Type, r.t2Cor, r.t2Tot, r.memo, r.status, '', r.newBook || '', r.bookFee || ''
    ]);
    const body = { values: values };
    await callSheetsAPI('POST', `/values/${encodeURIComponent(CONFIG.SHEETS.ATTENDANCE)}:append?valueInputOption=USER_ENTERED`, body);
}

async function refreshCounselData() {
    try {
        const counsels = await getOptionalSheetData(CONFIG.SHEETS.COUNSEL, 'A2:M');
        appCache.raw.counsels = counsels;
    } catch (e) {
        console.warn('상담일지 새로고침 실패', e);
    }
    if (typeof loadCounselView === 'function') loadCounselView();
}

async function appendCounselData(record) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const values = [[timestamp, record.studentName, record.studentId, record.schoolInfo, record.counselDate, record.counselType, record.teacherId, record.target, record.memo]];
    const body = { values: values };
    await callSheetsAPI('POST', `/values/${encodeURIComponent(CONFIG.SHEETS.COUNSEL)}:append?valueInputOption=USER_ENTERED`, body);
}

async function refreshBookData() {
    try {
        const books = await getOptionalSheetData(CONFIG.SHEETS.BOOK, 'A2:E');
        appCache.raw.books = books;
    } catch (e) {
        console.warn('교재DB 새로고침 실패', e);
    }
    if (typeof loadBookView === 'function') loadBookView();
}

async function appendBookData(record) {
    const timestamp = new Date().toISOString().substring(0, 10);
    const values = [[record.name, record.category, record.fee, record.totalPages, timestamp]];
    const body = { values: values };
    await callSheetsAPI('POST', `/values/${encodeURIComponent(CONFIG.SHEETS.BOOK)}:append?valueInputOption=USER_ENTERED`, body);
}

async function refreshTeacherAttData() {
    try {
        const tatt = await getOptionalSheetData(CONFIG.SHEETS.TATT, 'A2:E');
        appCache.raw.tatt = tatt;
    } catch (e) {
        console.warn('강사근태 새로고침 실패', e);
    }
    if (typeof loadTeacherAttView === 'function') loadTeacherAttView();
}

async function appendTeacherAttData(record) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const values = [[timestamp, record.teacherName, record.date, record.time, record.type]];
    const body = { values: values };
    await callSheetsAPI('POST', `/values/${encodeURIComponent(CONFIG.SHEETS.TATT)}:append?valueInputOption=USER_ENTERED`, body);
}

async function appendStudentData(studentObj) {
    const timestamp = new Date().toISOString().substring(0, 10);
    let newId = 'S0001';
    if (appCache.raw && appCache.raw.students && appCache.raw.students.length > 0) {
        const ids = appCache.raw.students.map(s => {
            const m = (s[0] || '').match(/^S(\d+)$/);
            return m ? parseInt(m[1], 10) : 0;
        });
        const maxId = Math.max(...ids, 0);
        newId = 'S' + (maxId + 1).toString().padStart(4, '0');
    }
    const values = [[
        newId, studentObj.name, '', studentObj.school, studentObj.grade, '', '', '재원', timestamp,
        studentObj.studentContact || '', studentObj.parentContact, studentObj.address || ''
    ]];
    const body = { values: values };
    await callSheetsAPI('POST', `/values/${encodeURIComponent(CONFIG.SHEETS.STUDENT)}:append?valueInputOption=USER_ENTERED`, body);
    return newId;
}

async function appendEnrollmentData(records) {
    let newIdNum = 1;
    if (appCache.raw && appCache.raw.classes && appCache.raw.classes.length > 0) {
        const ids = appCache.raw.classes.map(s => {
            const m = (s[1] || '').match(/^ENR(\d+)$/);
            return m ? parseInt(m[1], 10) : 0;
        });
        const maxId = Math.max(...ids, 0);
        newIdNum = maxId + 1;
    }
    const values = records.map((r, i) => {
        const enrId = 'ENR' + (newIdNum + i).toString().padStart(4, '0');
        const label = r.studentInfo ? `${r.studentName} (${r.studentInfo}) - ${r.studentId}` : `${r.studentName} - ${r.studentId}`;
        return [label, enrId, r.studentId, r.teacherName, '정규', r.startDate, '재원'];
    });
    const body = { values: values };
    await callSheetsAPI('POST', `/values/${encodeURIComponent(CONFIG.SHEETS.CLASS)}:append?valueInputOption=USER_ENTERED`, body);
}

async function appendScheduleData(records) {
    const values = records.map(r => [
        `${r.studentName} - ${r.studentId}`, '', r.studentId, r.studentId, r.dayOfWeek, '', r.startTime, r.endTime, '',
        r.teacherName, '', r.room, '', `${r.studentName} ${r.startTime}${r.isMakeup ? '(보강)' : '(0분)'}`, '활성', r.startDate, ''
    ]);
    const body = { values: values };
    await callSheetsAPI('POST', `/values/${encodeURIComponent(CONFIG.SHEETS.SCHEDULE)}:append?valueInputOption=USER_ENTERED`, body);
}

async function refreshAttendanceData() {
    try {
        const attendance = await getOptionalSheetData(CONFIG.SHEETS.ATTENDANCE, 'A2:ZZ');
        appCache.raw.attendance = attendance;
    } catch (e) {
        console.warn('출결 새로고침 실패', e);
    }
}

// =================================================================
// 🚀 [업그레이드] 학생 정보 업데이트 (퇴원/휴원 시 시간표 자동 비활성화)
// =================================================================
async function updateStudentData(studentId, updateObj) {
    const students = appCache.raw.students || [];
    const idx = students.findIndex(s => s[0] === studentId);
    if (idx < 0) throw new Error('학생 데이터를 찾을 수 없습니다.');
    const rowNum = idx + 2;
    const s = students[idx];

    let newStatus = updateObj.status !== undefined ? updateObj.status : (s[7] || '');
    let endDate = s[9] || '';

    // 💡 [핵심] 퇴원 처리 시 종료일 기록 및 시간표 비활성화
    if (newStatus === '퇴원' && s[7] !== '퇴원') {
        endDate = new Date().toISOString().substring(0, 10);

        // 💡 1. 시간표 시트에서 이 학생 찾아서 비활성 처리
        try {
            const scheduleRes = await callSheetsAPI('GET', `/values/${encodeURIComponent(CONFIG.SHEETS.SCHEDULE)}!A:O`);
            const schedVals = scheduleRes.values || [];
            const updateBatch = [];
            const studentName = s[1] || '';

            for (let i = 1; i < schedVals.length; i++) {
                const row = schedVals[i];
                // 이름이나 ID가 매칭되면 비활성 처리 (O열)
                if ((row[0] && (row[0].includes(studentName) || row[0].includes(studentId))) || row[3] === studentId) {
                    const schedRowNum = i + 1;
                    updateBatch.push({
                        range: `${CONFIG.SHEETS.SCHEDULE}!O${schedRowNum}`,
                        values: [["비활성"]]
                    });
                }
            }

            if (updateBatch.length > 0) {
                await callSheetsAPI('POST', `/values:batchUpdate`, {
                    valueInputOption: "USER_ENTERED",
                    data: updateBatch
                });
                console.log(`[시스템 알림] ${studentName} 학생의 시간표 ${updateBatch.length}건 비활성화 완료`);
            }
        } catch (e) {
            console.error("시간표 비활성화 중 오류 발생:", e);
        }

    } else if (newStatus !== '퇴원') {
        endDate = '';
    }

    const newRow = [
        updateObj.name !== undefined ? updateObj.name : (s[1] || ''),
        s[2] || '',
        updateObj.school !== undefined ? updateObj.school : (s[3] || ''),
        updateObj.grade !== undefined ? updateObj.grade : (s[4] || ''),
        s[5] || '', s[6] || '', newStatus, s[8] || '', endDate,
        updateObj.parentPhone !== undefined ? updateObj.parentPhone : (s[10] || ''),
        s[11] || ''
    ];
    const body = { values: [newRow] };
    await callSheetsAPI('PUT', `/values/${encodeURIComponent(CONFIG.SHEETS.STUDENT + '!B' + rowNum + ':L' + rowNum)}?valueInputOption=USER_ENTERED`, body);
    appCache.raw.students[idx] = [s[0], ...newRow];
}

async function appendScoreData(record) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const values = [[timestamp, record.studentId, record.studentName, record.examDate, record.examType, record.subject, record.score, record.totalScore, record.memo, record.teacherName]];
    const body = { values: values };
    await callSheetsAPI('POST', `/values/${encodeURIComponent(CONFIG.SHEETS.SCORE)}:append?valueInputOption=USER_ENTERED`, body);
}

async function refreshScoreData() {
    try {
        const scores = await getOptionalSheetData(CONFIG.SHEETS.SCORE, 'A2:J');
        appCache.raw.scores = scores;
    } catch (e) {
        console.warn('성적DB 새로고침 실패', e);
    }
    if (typeof loadScoreView === 'function') loadScoreView();
}

async function ensureScoreSheet() {
    const meta = await callSheetsAPI('GET', '');
    const exists = (meta.sheets || []).some(s => s.properties.title === CONFIG.SHEETS.SCORE);
    if (!exists) {
        await callSheetsAPI('POST', ':batchUpdate', {
            requests: [{ addSheet: { properties: { title: CONFIG.SHEETS.SCORE } } }]
        });
        const headers = [['타임스탬프', '학생ID', '학생명', '시험일자', '시험종류', '과목', '점수', '만점', '비고', '강사']];
        await callSheetsAPI('PUT', `/values/${encodeURIComponent(CONFIG.SHEETS.SCORE + '!A1:J1')}?valueInputOption=USER_ENTERED`, { values: headers });
        return true;
    }
    return false;
}

// SMS 발송 데이터 조회 (V2_SMS발송 Sheet)
async function getSmsLogData() {
    try {
        const customSpreadsheetId = CONFIG.SMS_SHEET.SPREADSHEET_ID;
        const range = `${CONFIG.SMS_SHEET.SHEET_NAME}!A2:F`;
        const result = await callSheetsAPI('GET', `/values/${encodeURIComponent(range)}`, null, customSpreadsheetId);
        return result.values || [];
    } catch (e) {
        console.warn('SMS 발송 로그 조회 실패:', e);
        return [];
    }
}

// SMS 데이터 앱 캐시에 로드
async function loadSmsLogData() {
    try {
        const smsLogs = await getSmsLogData();
        appCache.raw.smsLogs = smsLogs;
    } catch (e) {
        console.warn('SMS 로그 로드 실패', e);
        appCache.raw.smsLogs = [];
    }
}

// =================================================================
// 📊 월말평가 연동 (별도 워크북 → 메인 스프레드시트 월말평가DB)
// =================================================================
const MONTHLY_EVAL_DB_HEADERS = ['타임스탬프', '연월', '학생ID', '학생명', '학년', '학기', '담당강사', '선행범위', '현행점수', '선행점수', '현행링크', '선행링크', '풀이노트제출여부', '풀이노트점수', '클리닉대상', '풀이노트평가', '특이사항'];

// 월말평가DB 시트가 없으면 생성 + 헤더 기록
async function ensureMonthlyEvalDbSheet() {
    const meta = await callSheetsAPI('GET', '');
    const exists = (meta.sheets || []).some(s => s.properties.title === CONFIG.SHEETS.MONTHLY_EVAL_DB);
    if (!exists) {
        await callSheetsAPI('POST', ':batchUpdate', {
            requests: [{ addSheet: { properties: { title: CONFIG.SHEETS.MONTHLY_EVAL_DB } } }]
        });
        const lastCol = String.fromCharCode('A'.charCodeAt(0) + MONTHLY_EVAL_DB_HEADERS.length - 1);
        await callSheetsAPI('PUT', `/values/${encodeURIComponent(CONFIG.SHEETS.MONTHLY_EVAL_DB + '!A1:' + lastCol + '1')}?valueInputOption=USER_ENTERED`, { values: [MONTHLY_EVAL_DB_HEADERS] });
        return true;
    }
    return false;
}

// 월말평가 원본 워크북(별도 스프레드시트)의 시트 탭 목록 조회 → 'YYYY.MM' 형식 탭만 필터
async function getMonthlyEvalSheetList() {
    const customSpreadsheetId = CONFIG.MONTHLY_EVAL_SHEET.SPREADSHEET_ID;
    const meta = await callSheetsAPI('GET', '', null, customSpreadsheetId);
    return (meta.sheets || [])
        .map(s => s.properties.title)
        .filter(title => /^\d{4}\.\d{2}$/.test(title))
        .sort(); // 문자열 정렬로도 YYYY.MM은 시간순 정렬됨
}

// 월말평가 원본 탭의 학생 데이터 원본 로우 조회 (4행부터 시작, A~W열)
async function getMonthlyEvalRawData(sheetName) {
    const customSpreadsheetId = CONFIG.MONTHLY_EVAL_SHEET.SPREADSHEET_ID;
    const range = `${sheetName}!A4:W300`;
    const result = await callSheetsAPI('GET', `/values/${encodeURIComponent(range)}`, null, customSpreadsheetId);
    return result.values || [];
}

// 파싱된 월말평가 결과 행들을 월말평가DB(메인 스프레드시트)에 append
async function appendMonthlyEvalRows(rows) {
    if (!rows || rows.length === 0) return;
    const body = { values: rows };
    await callSheetsAPI('POST', `/values/${encodeURIComponent(CONFIG.SHEETS.MONTHLY_EVAL_DB)}:append?valueInputOption=USER_ENTERED`, body);
}

// 월말평가DB 데이터를 앱 캐시에 로드 (대시보드 위젯용)
async function loadMonthlyEvalDbData() {
    try {
        const data = await getOptionalSheetData(CONFIG.SHEETS.MONTHLY_EVAL_DB, 'A2:Q');
        appCache.raw.monthlyEvalDb = data;
    } catch (e) {
        console.warn('월말평가DB 로드 실패', e);
        appCache.raw.monthlyEvalDb = [];
    }
}

// =================================================================
// 💰 정산 설정 시트 (수강료 단가표 / 강사 급여)
//    두 시트 모두 원장님이 시트에서 직접 수정하는 것이 정상 운영 방식.
//    코드에는 "시트가 없을 때 처음 만들어주는 초기값"만 둔다.
// =================================================================
const TUITION_HEADERS = ['학교급', '월수강료', '수업당매출', '담임수당', '비고'];

// 초기값은 원장님이 제시한 규칙(주3회 기준)을 그대로 반영한 것.
// 중등은 30만 ÷ 3 = 10만으로 딱 떨어져 담임수당이 0원이 된다 → 시트에서 조정 필요.
const TUITION_SEED = [
    ['초등', 250000, 80000, 10000, '주3회 기준 (8만×3 + 담임수당 1만 = 25만)'],
    ['중등', 300000, 100000, 0, '⚠️ 30만÷3이 딱 떨어져 담임수당이 0원입니다. 조정해 주세요'],
    ['고등', 400000, 130000, 10000, '주3회 기준 (13만×3 + 담임수당 1만 = 40만)']
];

const SALARY_HEADERS = ['강사명', '월급여', '비고'];

// 시트가 없으면 생성하고 헤더 + 초기값을 기록한다. 이미 있으면 건드리지 않는다.
async function ensureSettlementSheets() {
    const meta = await callSheetsAPI('GET', '');
    const existing = new Set((meta.sheets || []).map(s => s.properties.title));
    const created = [];

    const addSheet = async (title, headers, seedRows) => {
        if (existing.has(title)) return;
        await callSheetsAPI('POST', ':batchUpdate', {
            requests: [{ addSheet: { properties: { title } } }]
        });
        const values = seedRows && seedRows.length ? [headers, ...seedRows] : [headers];
        const lastCol = String.fromCharCode('A'.charCodeAt(0) + headers.length - 1);
        const range = `${title}!A1:${lastCol}${values.length}`;
        await callSheetsAPI('PUT', `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, { values });
        created.push(title);
    };

    await addSheet(CONFIG.SHEETS.TUITION, TUITION_HEADERS, TUITION_SEED);

    // 강사급여는 재직 중인 강사 명단을 미리 채워두면 원장님이 금액만 적으면 된다.
    const activeTeachers = (appCache.raw.teachers || [])
        .slice(1)
        .filter(t => t && t[1] && t[4] !== '퇴사')
        .map(t => [String(t[1]).split('(')[0].trim(), '', '']);
    await addSheet(CONFIG.SHEETS.SALARY, SALARY_HEADERS, activeTeachers);

    return created;
}

// =================================================================
// 📌 학생별 상시 메모
//    "땡땡이는 4시 45분에 끝내주세요" 같은 운영 메모.
//    진행 중인 메모만 일지 작성 화면에 뜨고, 완료하면 학생 상세 이력으로만 남는다.
// =================================================================
const STUDENT_MEMO_HEADERS = ['메모ID', '학생ID', '학생명', '내용', '작성자', '작성일시', '상태', '완료일시', '완료자'];

async function ensureStudentMemoSheet() {
    const meta = await callSheetsAPI('GET', '');
    const exists = (meta.sheets || []).some(s => s.properties.title === CONFIG.SHEETS.STUDENT_MEMO);
    if (exists) return false;
    await callSheetsAPI('POST', ':batchUpdate', {
        requests: [{ addSheet: { properties: { title: CONFIG.SHEETS.STUDENT_MEMO } } }]
    });
    const lastCol = String.fromCharCode('A'.charCodeAt(0) + STUDENT_MEMO_HEADERS.length - 1);
    await callSheetsAPI('PUT', `/values/${encodeURIComponent(CONFIG.SHEETS.STUDENT_MEMO + '!A1:' + lastCol + '1')}?valueInputOption=USER_ENTERED`, { values: [STUDENT_MEMO_HEADERS] });
    return true;
}

async function appendStudentMemoRow(row) {
    await callSheetsAPI('POST', `/values/${encodeURIComponent(CONFIG.SHEETS.STUDENT_MEMO)}:append?valueInputOption=USER_ENTERED`, { values: [row] });
}

// 메모ID로 행을 찾아 상태/완료일시/완료자(G:I)를 갱신
async function updateStudentMemoStatus(memoId, status, doneAt, doneBy) {
    const res = await callSheetsAPI('GET', `/values/${encodeURIComponent(CONFIG.SHEETS.STUDENT_MEMO)}!A:I`);
    const values = res.values || [];
    const rowIndex = values.findIndex(r => r[0] === memoId);
    if (rowIndex < 0) throw new Error('메모를 찾을 수 없습니다.');
    const rowNum = rowIndex + 1;
    await callSheetsAPI('PUT', `/values/${encodeURIComponent(CONFIG.SHEETS.STUDENT_MEMO + '!G' + rowNum + ':I' + rowNum)}?valueInputOption=USER_ENTERED`, {
        values: [[status, doneAt, doneBy]]
    });
}

async function reloadStudentMemos() {
    appCache.raw.studentMemos = await getOptionalSheetData(CONFIG.SHEETS.STUDENT_MEMO, 'A2:I');
}

// 정산 설정 두 시트를 다시 읽어 캐시에 반영
async function reloadSettlementData() {
    const [tuition, salary] = await Promise.all([
        getOptionalSheetData(CONFIG.SHEETS.TUITION, 'A2:E'),
        getOptionalSheetData(CONFIG.SHEETS.SALARY, 'A2:C')
    ]);
    appCache.raw.tuition = tuition;
    appCache.raw.salary = salary;
}