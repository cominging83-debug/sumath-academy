// 학생별 상시 메모 로직 검증 — app.js의 실제 함수를 로드해서 돌린다
const fs = require('fs');
const vm = require('vm');

const APP = 'C:/Users/comin/Desktop/학원관리프로그램/sheets_app/v2/app.js';

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
  alert: () => {}, confirm: () => true, prompt: () => null,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  navigator: { userAgent: 'node' },
  location: { href: '', search: '' },
  fetch: async () => ({ json: async () => ({}) }),
  CONFIG: { SHEETS: {} },
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

try {
  vm.runInContext(fs.readFileSync(APP, 'utf8'), sandbox, { filename: 'app.js' });
} catch (e) {
  console.error('❌ app.js 로드 실패:', e.message);
  process.exit(1);
}

// 학생메모DB 컬럼: [0]메모ID [1]학생ID [2]학생명 [3]내용 [4]작성자 [5]작성일시 [6]상태 [7]완료일시 [8]완료자
sandbox.__test = {
  user: { role: '강사', name: '박준희' },
  raw: {
    studentMemos: [
      ['m1', 'S1', '김철수', '4시 45분에 끝내주세요', '박준희', '2026-08-05 14:00', '진행', '', ''],
      ['m2', 'S1', '김철수', '다음주 화요일 결석 예정', '김경은', '2026-08-06 09:00', '진행', '', ''],
      ['m3', 'S1', '김철수', '교재 새로 받아가야 함', '박준희', '2026-08-01 10:00', '완료', '2026-08-03 11:00', '이산행'],
      ['m4', 'S2', '이영희', '어머니 상담 요청', '배예은', '2026-08-04 16:00', '진행', '', ''],
      ['m5', '',   '박민수', 'ID 없이 이름만 있는 경우', '박준희', '2026-08-02 12:00', '진행', '', ''],
    ],
  },
};
vm.runInContext('appCache.user = __test.user; appCache.raw = __test.raw;', sandbox);

let pass = true;
const check = (label, actual, want) => {
  const ok = actual === want;
  if (!ok) pass = false;
  console.log(`${ok ? '✅' : '❌'} ${label}: ${JSON.stringify(actual)}${ok ? '' : `  (기대 ${JSON.stringify(want)})`}`);
};

const W = sandbox.window;

console.log('=== 조회 ===');
check('S1 진행중 메모 2건', W.getStudentMemos_('S1', '김철수', '진행').length, 2);
check('S1 전체 메모 3건', W.getStudentMemos_('S1', '김철수').length, 3);
check('S2 진행중 1건', W.getStudentMemos_('S2', '이영희', '진행').length, 1);
check('학생ID 없이 이름만으로도 조회', W.getStudentMemos_('', '박민수', '진행').length, 1);
check('없는 학생은 0건', W.getStudentMemos_('S9', '없는학생').length, 0);

console.log('\n=== 일지 화면 패널 (진행중만 노출) ===');
const panel = W.renderStudentMemoPanel('S1', '김철수');
check('진행중 메모 본문 노출', panel.includes('4시 45분에 끝내주세요'), true);
check('진행중 메모 2건째도 노출', panel.includes('다음주 화요일 결석 예정'), true);
check('완료된 메모는 일지 화면에서 사라짐', panel.includes('교재 새로 받아가야 함'), false);
check('건수 배지 표시', panel.includes('학생 메모 (2)'), true);
check('완료 버튼에 메모ID 연결', panel.includes(`completeStudentMemo('m1')`), true);

const emptyPanel = W.renderStudentMemoPanel('S9', '없는학생');
check('메모 없으면 건수 배지 없음', emptyPanel.includes('학생 메모 ('), false);
check('메모 없어도 추가 버튼은 있음', emptyPanel.includes('addStudentMemo'), true);

console.log('\n=== 학생 상세 이력 (진행 + 완료 전부) ===');
const hist = W.renderStudentMemoHistory('S1', '김철수');
check('이력에는 완료 메모도 나옴', hist.includes('교재 새로 받아가야 함'), true);
check('이력에 진행 메모도 나옴', hist.includes('4시 45분에 끝내주세요'), true);
check('완료 메모에 되돌리기 버튼', hist.includes('reopenStudentMemo'), true);
check('완료자/완료일시 표시', hist.includes('이산행') && hist.includes('2026-08-03'), true);
// 작성일시 내림차순: m2(8-06) → m1(8-05) → m3(8-01)
const order = ['다음주 화요일', '4시 45분', '교재 새로'].map(t => hist.indexOf(t));
check('최신순 정렬', order[0] < order[1] && order[1] < order[2], true);
check('메모 없으면 안내문', W.renderStudentMemoHistory('S9', '없').includes('등록된 메모가 없습니다'), true);

console.log('\n=== XSS / 깨짐 방지 ===');
vm.runInContext(`appCache.raw.studentMemos.push(
  ['m6','S3','해커','<img src=x onerror=alert(1)>와 "따옴표" & \\'작은따옴표\\'','박준희','2026-08-06 10:00','진행','','']
);`, sandbox);
const xss = W.renderStudentMemoPanel('S3', '해커');
check('스크립트 태그 이스케이프됨', xss.includes('<img src=x'), false);
check('이스케이프된 형태로 존재', xss.includes('&lt;img'), true);
check('따옴표 이스케이프', xss.includes('&quot;') && xss.includes('&#39;'), true);

console.log('\n=== 고유 ID 생성 (공지DB 중복 버그 방지) ===');
const ids = new Set();
for (let i = 0; i < 5000; i++) ids.add(W.makeUniqueId_());
check('5000개 전부 고유', ids.size, 5000);

console.log(`\n${pass ? '🎉 전체 통과' : '⚠️ 실패 항목 있음'}`);
process.exit(pass ? 0 : 1);
