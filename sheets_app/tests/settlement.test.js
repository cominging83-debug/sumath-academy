// 강사 정산 로직 검증 — app.js의 실제 함수를 로드해서 돌린다
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = 'C:/Users/comin/Desktop/학원관리프로그램/sheets_app/v2/app.js';

// --- 최소 브라우저 환경 스텁 ---
const sandbox = {
  console,
  document: {
    getElementById: () => null,
    addEventListener: () => {},
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: () => ({ style: {}, classList: { add(){}, remove(){} }, appendChild(){} }),
    body: { appendChild(){} }
  },
  setTimeout, clearTimeout, setInterval, clearInterval,
  alert: () => {}, confirm: () => true,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  navigator: { userAgent: 'node' },
  location: { href: '', search: '' },
  fetch: async () => ({ json: async () => ({}) }),
  CONFIG: { SHEETS: {} },
  gapi: undefined, google: undefined, Chart: undefined,
  showLoader: () => {},
  callSheetsAPI: async () => ({}),
  getOptionalSheetData: async () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
  matchMedia: () => ({ matches: false, addListener(){}, addEventListener(){} }),
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// app.js 로드 (최상위에서 DOM 만지는 코드가 있어도 스텁으로 흡수)
try {
  vm.runInContext(fs.readFileSync(APP, 'utf8'), sandbox, { filename: 'app.js' });
} catch (e) {
  console.error('❌ app.js 로드 실패:', e.message);
  process.exit(1);
}

// --- 테스트 데이터 구성 ---
// 원천DB 컬럼: [0]ID [1]이름 [2]부서 [3]학교 [4]학년 [5]? [6]담임 [7]상태 [8]일자 ...
// 수강일정DB:  [0]표시 [3]학생ID [4]요일 [6]시작 [7]종료 [9]강사 [14]활성여부
const students = [
  ['헤더'],
  ['S1', '김초등', '초등부', 'OO초', '5학년', '', '', '재원', '2025-03-01'],
  ['S2', '이중등', '중등부', 'OO중', '2학년', '', '', '재원', '2025-03-01'],
  ['S3', '박고등', '고등부', 'OO고', '1학년', '', '', '재원', '2025-03-01'],
  ['S4', '최동점', '초등부', 'OO초', '6학년', '', '박선생', '재원', '2025-03-01'],
  ['S5', '정동점무', '초등부', 'OO초', '6학년', '', '', '재원', '2025-03-01'],
  ['S6', '퇴원생', '초등부', 'OO초', '6학년', '', '김선생', '퇴원', '2025-06-01'],
  ['S7', '휴원생', '초등부', 'OO초', '6학년', '', '김선생', '휴원', '2025-06-01'],
];

const sch = (sid, day, st, en, teacher, active) =>
  ['표시', '', '', sid, day, '', st, en, '', teacher, '', '', '', '', active || ''];

const schedules = [
  ['헤더'],
  // S1 초등: 화·목 김선생, 토 박선생  → 담임 = 김선생(2회)
  sch('S1', '화', '15:00', '17:00', '김선생'),
  sch('S1', '목', '15:00', '17:00', '김선생'),
  sch('S1', '토', '10:00', '12:00', '박선생'),
  // S2 중등: 3회 전부 김선생 → 담임 = 김선생
  sch('S2', '월', '19:00', '21:00', '김선생'),
  sch('S2', '수', '19:00', '21:00', '김선생'),
  sch('S2', '금', '19:00', '21:00', '김선생'),
  // S3 고등: 주2회 박선생 (횟수대로 계산 대상)
  sch('S3', '화', '19:00', '21:30', '박선생'),
  sch('S3', '목', '19:00', '21:30', '박선생'),
  // S4 동점 2:2 → 원천DB 담임 '박선생' 이 결정
  sch('S4', '월', '15:00', '17:00', '김선생'),
  sch('S4', '화', '15:00', '17:00', '김선생'),
  sch('S4', '수', '15:00', '17:00', '박선생'),
  sch('S4', '목', '15:00', '17:00', '박선생'),
  // S5 동점 2:2 인데 원천DB 담임 비어있음 → 미결정으로 잡혀야 함
  sch('S5', '월', '15:00', '17:00', '김선생'),
  sch('S5', '화', '15:00', '17:00', '김선생'),
  sch('S5', '수', '15:00', '17:00', '박선생'),
  sch('S5', '목', '15:00', '17:00', '박선생'),
  // 비활성 슬롯은 무시되어야 함
  sch('S1', '일', '10:00', '12:00', '최선생', '비활성'),
];

sandbox.__test = {
  user: { role: '원장', name: '원장님' },
  raw: {
    students,
    schedules,
    teachers: [['헤더'], ['T1', '김선생', '', '', '재직'], ['T2', '박선생', '', '', '재직']],
    tuition: [
      ['초등', 250000, 80000, 10000, ''],
      ['중등', 300000, 100000, 0, ''],
      ['고등', 400000, 130000, 10000, ''],
    ],
    salary: [
      ['김선생', 2000000, ''],
      ['박선생', '', ''],   // 금액 미입력 → null 로 처리되어야 함
    ],
  },
};

// app.js 안의 `let appCache` 는 렉시컬 바인딩이라 샌드박스 프로퍼티로는 못 덮는다.
// 같은 컨텍스트에서 스크립트를 한 번 더 돌려 내부 appCache 에 테스트 데이터를 주입한다.
vm.runInContext('appCache.user = __test.user; appCache.raw = __test.raw;', sandbox);

const d = sandbox.window.computeTeacherSettlement();

// --- 기대값 계산 ---
// 김선생 수업매출: S1 화목 8만×2=16만, S2 3회 10만×3=30만, S4 2회 8만×2=16만, S5 2회 8만×2=16만 = 78만
// 김선생 담임수당: S1(1만) + S2(중등 0원) = 1만  → 합계 79만
// 박선생 수업매출: S1 토 8만, S3 13만×2=26만, S4 8만×2=16만, S5 8만×2=16만 = 66만
// 박선생 담임수당: S3(주2회 단독담당 → 담임) 1만 + S4(동점→원천DB) 1만 = 2만 → 합계 68만
const expect = { 김선생: 790000, 박선생: 680000 };

let pass = true;
const check = (label, actual, want) => {
  const ok = actual === want;
  if (!ok) pass = false;
  console.log(`${ok ? '✅' : '❌'} ${label}: ${actual}${ok ? '' : `  (기대 ${want})`}`);
};

console.log('=== 강사별 매출 ===');
d.rows.forEach(r => {
  console.log(`  ${r.name}: 매출 ${r.revenue.toLocaleString()} (수업 ${r.classRevenue.toLocaleString()} + 담임 ${r.homeroomRevenue.toLocaleString()}), ` +
    `주간시수 ${r.weeklyHours.toFixed(1)}h, 담당 ${r.studentCount}명, 담임 ${r.homeroomStudents}명, ` +
    `급여 ${r.salary === null ? '미입력' : r.salary.toLocaleString()}, 차액 ${r.profit === null ? '-' : r.profit.toLocaleString()}`);
});

console.log('\n=== 검증 ===');
Object.entries(expect).forEach(([name, want]) => {
  const row = d.rows.find(r => r.name === name);
  check(`${name} 매출`, row ? row.revenue : null, want);
});

const kim = d.rows.find(r => r.name === '김선생');
const park = d.rows.find(r => r.name === '박선생');

// S1 화목(2h×2) + S2 월수금(2h×3) + S4 월화(2h×2) + S5 월화(2h×2) = 18h
check('김선생 주간시수', kim.weeklyHours, 18);
// S1 토(2h) + S3 화목(2.5h×2) + S4 수목(2h×2) + S5 수목(2h×2) = 15h
check('박선생 주간시수', park.weeklyHours, 15);
check('김선생 담임 학생수', kim.homeroomStudents, 2);   // S1, S2
check('박선생 담임 학생수', park.homeroomStudents, 2);  // S3(단독담당) + S4(동점→원천DB)
check('박선생 급여 미입력 → null', park.salary, null);
check('박선생 차액 → null', park.profit, null);
check('김선생 차액', kim.profit, 790000 - 2000000);
check('담임 동점 미결정 수', d.unresolvedHomeroom.length, 1);
check('미결정 학생명', d.unresolvedHomeroom[0] && d.unresolvedHomeroom[0].name, '정동점무');
check('급여 미입력 명단', d.missingSalary.join(','), '박선생');

// 담임별 유지율: 원천DB 담임 컬럼 기준 (김선생 = S6 퇴원, S7 휴원)
console.log('\n=== 담임별 유지 (원천DB 담임 기준) ===');
d.rows.forEach(r => console.log(`  ${r.name}: 재원 ${r.retention.재원} / 휴원 ${r.retention.휴원} / 퇴원 ${r.retention.퇴원} → 퇴원율 ${r.churnRate === null ? '-' : r.churnRate.toFixed(1) + '%'}`));
check('김선생 퇴원 집계', kim.retention.퇴원, 1);
check('김선생 휴원 집계', kim.retention.휴원, 1);
// 재원생은 역산 담임으로 잡혀야 한다: 김선생 = S1, S2
check('김선생 재원 집계(역산 담임)', kim.retention.재원, 2);
// 김선생 퇴원율 = 퇴원1 / (재원2 + 휴원1 + 퇴원1) = 25%
check('김선생 퇴원율', Number(kim.churnRate.toFixed(1)), 25);
// 박선생 재원 = S3(단독) + S4(동점→원천DB)
check('박선생 재원 집계(역산 담임)', park.retention.재원, 2);

// 비활성 슬롯이 제외됐는지 (최선생이 아예 안 잡혀야 함)
check('비활성 슬롯 강사 제외', d.rows.some(r => r.name === '최선생'), false);

console.log(`\n${pass ? '🎉 전체 통과' : '⚠️ 실패 항목 있음'}`);
process.exit(pass ? 0 : 1);
