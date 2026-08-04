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
        COUNSEL: '상담일지',    // 원천DB 연동
        BOOK: '교재DB',        // 교재 마스터
        ALIMTALK: '알림톡설정', // 알림톡 템플릿
        TATT: '강사근태',      // 강사 출퇴근 기록
        SCORE: '성적DB',
        NOTICE: '공지DB'
    }
};
