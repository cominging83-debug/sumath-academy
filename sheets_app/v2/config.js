// =========================================
// 수학의 힘 v2 - config.js
// 구글 API 설정 파일
// =========================================

const CONFIG = {
    // 1. Google Cloud Console에서 발급받은 클라이언트 ID
    CLIENT_ID: '927376819341-67g84j4nfvmagmg1r88ihiach9n6f3o3.apps.googleusercontent.com',

    // 2. 구글 API 키 (선택 사항이지만 있으면 빠름)
    API_KEY: '여기에_API_KEY를_입력하세요',

    // 3. 연결할 구글 스프레드시트 ID (URL의 d/ 와 /edit 사이 값)
    SPREADSHEET_ID: '1jwnEef3Irk9jc4LMm71efZ4NT8CH1XXKchIS7psy7MM', // 사용자 실제 운영 시트 ID

    // 4. API 권한 범위 (스프레드시트 읽기/쓰기 권한)
    SCOPES: 'https://www.googleapis.com/auth/spreadsheets',

    // 5. 사용할 시트 이름 상수
    SHEETS: {
        TEACHER: '강사DB',
        STUDENT: '원천DB',
        CLASS: '수강DB',
        SCHEDULE: '수강일정DB',
        ATTENDANCE: '출결기록',
        COUNSEL: '상담일지',    // 상담 기록 + 요청 (J:요청일자, K:마감일, L:상태, M:요청자, N:메모)
        BOOK: '교재DB',        // 교재 마스터
        ALIMTALK: '알림톡설정', // 알림톡 템플릿
        TATT: '강사근태',      // 강사 출퇴근 기록
        SCORE: '성적DB',
        NOTICE: '공지DB',
        MAKEUP: '보강일정DB',   // 보강 일정
        MONTHLY_EVAL_DB: '월말평가DB', // 월말평가 결과 누적 (메인 스프레드시트 내 신규 시트)
        TUITION: '수강료단가표', // 학교급별 단가 (원장님이 시트에서 직접 수정)
        SALARY: '강사급여'      // 강사별 월 급여 (원장님이 시트에서 직접 수정)
    },

    // 6. SMS 발송 시트 (V2 전용)
    SMS_SHEET: {
        SPREADSHEET_ID: '1QmNIHDT76K1owChT1PinOEEn6WqgF7uhb5vQcv9Bm3Q',
        SHEET_NAME: 'SMS발송'
    },

    // 7. 월말평가 원본 시트 (원장님이 직접 채점하는 별도 워크북)
    MONTHLY_EVAL_SHEET: {
        SPREADSHEET_ID: '1XOnYT08eKlH6Lh1irAQw3pgTDGeLAA8mqq_uPfGpJUA'
        // 탭 이름은 'YYYY.MM' 형식으로 매달 바뀜 (예: '2026.06') - 앱에서 자동 탐색
    }
};
