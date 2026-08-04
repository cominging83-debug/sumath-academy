# 수학의 힘 v2 - 작업 요약

**작업 기간**: 2026-08-04 현재  
**버전**: v2 (신규 개발)  
**배포**: Vercel (https://sumath-academy.vercel.app)

---

## 📊 시스템 구조

```
수학의 힘
├── Version Selector (랜딩 페이지)
│   └── localStorage 기반 사용자 선택
├── V1 (안정 버전)
│   └── 기존 기능 유지
└── V2 (신규 기능)
    └── 점진적 기능 확장
```

---

## ✅ 완료된 기능 (Phase 1-3)

### Phase 1: 학부별 색상 표시
**상태**: ✅ 완료 & 배포

**기능**:
- 수강일정에서 학생 태그 색상 구분
- 초등부 → 🟢 초록색
- 중등부 → 🔵 파란색
- 고등부 → 🔴 빨강색

**파일**:
- `sheets_app/app.js` (v1, 라인 245)
- `sheets_app/v2/app.js` (v2, 라인 245)

**구현**:
```javascript
// foundSt[2]에서 학부 정보 추출
const deptStr = foundSt[2].toString();
gradeLevel = deptStr.includes('고') ? '고' : (deptStr.includes('중') ? '중' : '초');
```

---

### Phase 2: 상담 요청 시스템
**상태**: ✅ 완료 & 배포

**기능**:
- 상담 요청 생성 (원장 + 강사)
- 마감일(Due Date) 관리
- 상담 현황 대시보드
- 상태 추적 (요청/진행중/완료)

**데이터 구조** (상담일지 시트):
| A | B | C | D | E | F | G | H | I | J | K | L | M | N |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 일자 | 학생명 | 학생ID | - | 상담일자 | 상담유형 | 담당자 | 상담대상 | 상담내용 | **요청일자** | **마감일** | **상태** | **요청자** | **메모** |

**함수**:
- `openCounselRequestModal()` - 상담 요청 모달 열기
- `saveCounselRequest()` - 상담 요청 저장
- `loadCounselRequestView()` - 상담 현황 대시보드
- `markCounselComplete()` - 상담 완료 처리

**색상 표시**:
- 🔴 마감임박 (3일 이내) - 빨강
- 🟡 진행중 - 주황
- 🟢 완료 - 초록

**파일**:
- `sheets_app/v2/config.js` (설정)
- `sheets_app/v2/app.js` (함수)
- `sheets_app/v2/index.html` (메뉴)

---

### Phase 3: 학생 상세 프로필 강화
**상태**: ✅ 완료 & 배포

**기능**:
1. **상담 섹션 강화**
   - 상담 요청 현황 표시
   - 상담 요청 버튼 추가
   - 최근 상담 기록 표시

2. **교재진도 강화**
   - 예상 완료일 자동 계산
   - 학습 속도 기반 추정
   - 진도율 + 페이지 수 표시

**구현**:
```javascript
// 상담 요청 현황
const myRequests = appCache.raw.counsels.filter(c => 
  (c[2] === studentId || c[1] === studentName) && c[9]
);

// 예상 완료일 계산
const lastDate = new Date(b.lastDate);
const daysElapsed = Math.max(1, Math.floor((today - lastDate) / (1000 * 60 * 60 * 24)) + 1);
const pagesPerDay = b.maxPage / daysElapsed;
const daysRemaining = Math.ceil((b.total - b.maxPage) / pagesPerDay);
const estimatedDate = new Date(today.getTime() + daysRemaining * 24 * 60 * 60 * 1000);
```

**표시 예**:
```
📚 개념원리 중1-1
████████░░░░░░░░░ 34%
현재 85 / 총 250p | 예상 완료: 2026-08-25
```

**파일**:
- `sheets_app/v2/app.js` (함수 수정)

---

## 🔄 배포 현황

| Phase | 기능 | 상태 | 배포 |
|-------|------|------|------|
| 1 | 학부별 색상 | ✅ 완료 | 🚀 배포됨 |
| 2 | 상담 요청 시스템 | ✅ 완료 | 🚀 배포됨 |
| 3 | 학생 프로필 강화 | ✅ 완료 | 🚀 배포됨 |
| 4 | 대시보드 강화 | ⏳ 계획중 | - |

---

## 📌 다음 Phase (4): 대시보드 강화

**계획**:
1. **KPI 카드**
   - 오늘 수업 건수
   - 이번달 출석률
   - 신규 등록 학생
   - 미완료 보강

2. **차트**
   - 주간 출석 추이
   - 강사별 수업 수

3. **통계**
   - 학부별 학생 수
   - 진도율 랭킹

---

## 🛠️ 기술 스택

| 항목 | 기술 |
|------|------|
| Frontend | HTML5, Bootstrap 5, JavaScript |
| Backend | Google Sheets API |
| Deployment | Vercel (v2.vercel.app) |
| Data | Google Sheets (원천DB, 수강일정DB 등) |
| Storage | localStorage (사용자 선택) |
| Auth | Google OAuth |

---

## 📂 핵심 파일

| 파일 | 용도 |
|------|------|
| `version-selector.html` | 버전 선택 랜딩 페이지 |
| `v2/config.js` | v2 설정 (API, Sheet ID) |
| `v2/app.js` | v2 메인 로직 (~5200줄) |
| `v2/index.html` | v2 UI |
| `vercel.json` | 라우팅 설정 |

---

## 📈 주요 성과

✅ v1 vs v2 안정적 분리  
✅ 마감일 기반 상담 관리 시스템  
✅ 학생별 학부 색상 구분  
✅ 교재 진도 예상 완료일 자동 계산  
✅ 상담 요청 원장/강사 동시 지원  
✅ 학생 상세 프로필 통합 관리  

---

## 🎯 진행 상황

**완료 비율**: Phase 1-3 완료 (75%)  
**남은 작업**: Phase 4 대시보드 강화  
**예상 완료**: 2026-08-10 (현재 추정)

---

*마지막 업데이트: 2026-08-04*
