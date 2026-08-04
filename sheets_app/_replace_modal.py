import sys

file = r'c:\Users\comin\Desktop\학원관리프로그램\sheets_app\app.js'

with open(file, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# 교체 범위: 2402~2663번 줄 (1-indexed) → 0-indexed: 2401~2662
start_idx = 2401  # 0-indexed (line 2402)
end_idx   = 2663  # 0-indexed (line 2663, inclusive)

new_code = r"""// =================================================================
// 🚀 [UI 개선] 출석 모달창 열기 (왼쪽 사이드바 + 실시간 미리보기 연동 완결판)
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

      const pastRecord = [...(appCache.raw.attendance || [])].reverse().find(a =>
        (a[1] === s.id || a[2] === s.name) && a[5] !== undefined && (a[3] || '').substring(0, 10) < openDateStr
      );

      function getVal(key) { return rec[key] || ''; }
      function getPh(index, defaultTxt) { return (pastRecord && pastRecord[index]) ? `(이전) ${pastRecord[index]}` : defaultTxt; }

      let isAtt = rec.att === '출석' ? 'checked' : '';
      let isLate = rec.att === '지각' ? 'checked' : '';
      let isAbs = rec.att === '결석' ? 'checked' : '';
      let isHwO = rec.hw === '완료' ? 'checked' : '';
      let isHwM = rec.hw === '미흡' ? 'checked' : '';
      let isHwX = rec.hw === '미제출' ? 'checked' : '';

      let pB = (rec.pBook || (pastRecord ? pastRecord[7] : '') || "").split('|');
      let hwB = (rec.hwBook || (pastRecord ? pastRecord[9] : '') || "").split('|');
      let pR = getVal('pRange').split('|'); let hwR = getVal('hwRange').split('|');

      let t1Type = rec.t1Type || '일일'; let t1Cor = getVal('t1Cor'); let t1Tot = getVal('t1Tot'); let t1TotPh = getPh(13, '총문항');
      let t2Type = rec.t2Type || '일일'; let t2Cor = getVal('t2Cor'); let t2Tot = getVal('t2Tot'); let t2TotPh = getPh(16, '총문항');

      let color = s.level === '보강' ? 'bg-warning text-dark border-warning' : (s.level === '고' ? 'bg-danger text-white' : (s.level === '중' ? 'bg-primary text-white' : 'bg-success text-white'));
      let displayNameHtml = `<span class="badge ${color} me-2">${s.level}</span>${rawBadge}`;

      navHtml += `<a href="#student-section-${idx}" class="list-group-item list-group-item-action py-3 ${idx === 0 ? 'active' : ''}"><span class="badge ${color} me-1">${s.level}</span> <span class="fw-bold">${rawBadge}</span></a>`;

      listHtml += `
        <div id="student-section-${idx}" class="p-4 mb-4 bg-white border rounded shadow-sm student-row" data-id="${s.id}" data-name="${s.name}" data-rawbadge="${rawBadge}">
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
                    <label class="small fw-bold text-primary mb-2"><i class="bi bi-book"></i> 오늘 진도</label>
                    <div class="input-group input-group-sm mb-2 shadow-sm"><input type="text" class="form-control bg-white" id="pB1_${idx}" list="globalBookList" placeholder="진도교재 1" value="${pB[0] || ''}"><input type="text" class="form-control bg-white" id="pR1_${idx}" placeholder="범위" value="${pR[0] || ''}"></div>
                    <div class="input-group input-group-sm shadow-sm"><input type="text" class="form-control bg-white" id="pB2_${idx}" list="globalBookList" placeholder="진도교재 2" value="${pB[1] || ''}"><input type="text" class="form-control bg-white" id="pR2_${idx}" placeholder="범위" value="${pR[1] || ''}"></div>
                    <div class="input-group input-group-sm shadow-sm mt-2"><input type="text" class="form-control bg-white" id="pB3_${idx}" list="globalBookList" placeholder="진도교재 3" value="${pB[2] || ''}"><input type="text" class="form-control bg-white" id="pR3_${idx}" placeholder="범위" value="${pR[2] || ''}"></div>
                </div>
                <div class="col-md-6">
                    <label class="small fw-bold text-success mb-2"><i class="bi bi-pencil-square"></i> 다음 과제</label>
                    <div class="input-group input-group-sm mb-2 shadow-sm"><input type="text" class="form-control bg-white" id="hwB1_${idx}" list="globalBookList" placeholder="과제교재 1" value="${hwB[0] || ''}"><input type="text" class="form-control bg-white" id="hwR1_${idx}" placeholder="범위" value="${hwR[0] || ''}"></div>
                    <div class="input-group input-group-sm mb-2 shadow-sm"><input type="text" class="form-control bg-white" id="hwB2_${idx}" list="globalBookList" placeholder="과제교재 2" value="${hwB[1] || ''}"><input type="text" class="form-control bg-white" id="hwR2_${idx}" placeholder="범위" value="${hwR[1] || ''}"></div>
                    <div class="input-group input-group-sm shadow-sm"><input type="text" class="form-control bg-white" id="hwB3_${idx}" list="globalBookList" placeholder="과제교재 3" value="${hwB[2] || ''}"><input type="text" class="form-control bg-white" id="hwR3_${idx}" placeholder="범위" value="${hwR[2] || ''}"></div>
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
            <div class="row g-2 align-items-center mb-3">
                <div class="col-md-2"><span class="badge bg-info text-dark w-100 py-2">새 교재 청구</span></div>
                <div class="col-md-5"><input type="text" class="form-control form-control-sm border-info" id="newBook_${idx}" list="globalBookList" placeholder="발급된 교재명 검색..." value="${getVal('newBook')}"></div>
                <div class="col-md-3 d-flex align-items-center gap-2"><input type="number" class="form-control form-control-sm text-end" id="bookFee_${idx}" placeholder="금액(원)" value="${getVal('bookFee')}"><span class="small text-muted fw-bold">원</span></div>
            </div>
            <div class="row g-2 mb-2 mt-3">
                <div class="col-md-6"><div class="input-group input-group-sm"><span class="input-group-text bg-light border-primary text-primary fw-bold">개별학습</span><input type="text" class="form-control border-primary" id="indivLearning_${idx}" placeholder="${getPh(26, '오늘 학습한 특이사항')}" value="${getVal('indivLearning')}"></div></div>
                <div class="col-md-6"><div class="input-group input-group-sm"><span class="input-group-text bg-light border-danger text-danger fw-bold">과제피드백</span><input type="text" class="form-control border-danger" id="hwFeedback_${idx}" placeholder="${getPh(22, '과제 수행 코멘트')}" value="${getVal('hwFeedback')}"></div></div>
            </div>
            <div class="row g-2 mb-2"><div class="col-12"><textarea class="form-control bg-light" placeholder="${getPh(17, '💬 종합안내')}" id="memo_${idx}" rows="2">${getVal('memo')}</textarea></div></div>
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

      scrollContainer.addEventListener('input', function(e) {
          const row = e.target.closest('.student-row');
          if (row && window.updateLivePreview) window.updateLivePreview(row.id.replace('student-section-', ''));
      });
      scrollContainer.addEventListener('change', function(e) {
          const row = e.target.closest('.student-row');
          if (row && window.updateLivePreview) window.updateLivePreview(row.id.replace('student-section-', ''));
      });

      navLinks.forEach(link => {
        link.addEventListener('click', function (e) {
          e.preventDefault();
          navLinks.forEach(l => l.classList.remove('active'));
          this.classList.add('active');
          const targetId = this.getAttribute('href').substring(1);
          const targetEl = document.getElementById(targetId);
          if (targetEl) {
            scrollContainer.scrollTo({ top: targetEl.offsetTop - scrollContainer.offsetTop, behavior: 'smooth' });
            if(window.updateLivePreview) window.updateLivePreview(targetId.replace('student-section-', ''));
          }
        });
      });

      scrollContainer.addEventListener('scroll', () => {
        let currentActiveIdx = 0;
        const containerTop = scrollContainer.scrollTop;
        const sections = document.querySelectorAll('#studentCheckList .student-row');
        sections.forEach((sec, idx) => {
          if (sec.offsetTop - scrollContainer.offsetTop <= containerTop + 200) currentActiveIdx = idx;
        });

        navLinks.forEach(l => l.classList.remove('active'));
        if(navLinks[currentActiveIdx]) {
            if (!navLinks[currentActiveIdx].classList.contains('active')) {
                navLinks[currentActiveIdx].classList.add('active');
                if(window.updateLivePreview) window.updateLivePreview(currentActiveIdx);
            }
        }
      });

      if(window.updateLivePreview) window.updateLivePreview(0);
    }, 300);
};
"""

# Build new lines list
new_lines = lines[:start_idx] + [new_code] + lines[end_idx:]

with open(file, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print(f"Done! Replaced lines {start_idx+1}~{end_idx} with new openAttendanceModal function.")
print(f"Total lines before: {len(lines)}, after: {len(new_lines)}")
