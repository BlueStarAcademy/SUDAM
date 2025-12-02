# Railway 현재 화면 설정 가이드

## 🔍 현재 화면에서 조절해야 할 항목

### ❌ **1. Restart Policy (가장 중요 - 크래시 루프 원인!)**

**현재 설정:**
- **Restart Policy**: `On Failure` ✅ (드롭다운에 선택됨)
- **재시도 횟수**: `10` (입력 필드)

**문제점:**
- ❌ `On Failure` 설정으로 인해 서버가 크래시되면 자동으로 10번 재시도
- ❌ 이것이 **크래시 루프의 주요 원인**일 가능성이 높음

**변경 방법:**

1. **Restart Policy 드롭다운 클릭**
2. **"Never"** 선택
   - 또는 "Off" 옵션이 있다면 그것 선택
3. **재시도 횟수 입력 필드**: `0` 또는 빈 값으로 변경 (또는 필드 자체가 비활성화될 수 있음)

**왜 중요한가:**
- ✅ `Never`로 설정하면 Railway가 자동으로 재시작하지 않음
- ✅ 크래시 루프 방지
- ✅ `railway.json`에 `restartPolicyType: "NEVER"`로 설정했지만, Dashboard 설정이 우선 적용될 수 있음

---

### ✅ **2. Healthcheck Path (헬스체크 경로 설정)**

**현재 설정:**
- **Healthcheck Path**: 비어있음 (입력 필드가 비어있음)

**문제점:**
- ❌ 헬스체크 경로가 설정되지 않으면 Railway가 서버 상태를 확인할 수 없음
- ❌ 서버가 정상인지 비정상인지 판단 불가

**변경 방법:**

1. **Healthcheck Path 입력 필드 클릭**
2. 다음 값 입력: `/api/health`
3. 저장 (일반적으로 자동 저장됨)

**이유:**
- ✅ 서버가 정상 작동하는지 확인
- ✅ `railway.json`에 이미 설정되어 있지만, Dashboard 설정이 우선 적용될 수 있음
- ✅ 우리 서버 코드에 `/api/health` 엔드포인트가 구현되어 있음

---

### ✅ **3. Serverless (현재 설정 유지)**

**현재 설정:**
- **Enable Serverless**: `OFF` (토글이 꺼져있음)

**조치:**
- ✅ **그대로 유지**: OFF 상태가 정확합니다
- 서버리스 모드는 컨테이너를 0으로 스케일 다운하는데, 우리 서비스는 항상 실행되어야 함

---

### ✅ **4. Cron Schedule (현재 설정 유지)**

**현재 설정:**
- **Cron Schedule**: 없음

**조치:**
- ✅ **설정 불필요**: 현재 사용하지 않으므로 그대로 두세요

---

## 📝 요약: 지금 바로 변경해야 할 항목

### 🔴 **즉시 변경 (크래시 루프 해결):**

1. **Restart Policy**
   - 현재: `On Failure` (재시도 10번)
   - 변경: `Never` (또는 `Off`)
   - 재시도 횟수: `0` 또는 제거

2. **Healthcheck Path**
   - 현재: 비어있음
   - 변경: `/api/health` 입력

### ✅ **유지:**
- Serverless: OFF 유지
- Cron Schedule: 설정 불필요

---

## 🎯 설정 순서

1. **Restart Policy 변경** (가장 중요!)
   - 드롭다운에서 `Never` 선택
   - 재시도 횟수를 `0`으로 변경

2. **Healthcheck Path 입력**
   - `/api/health` 입력

3. **변경사항 저장**
   - 일반적으로 자동 저장됨
   - 또는 페이지 하단의 저장 버튼 클릭

4. **재배포 확인**
   - "Apply 3 changes" 버튼이 보이면 클릭
   - 또는 "Deploy → Enter" 버튼 클릭

---

## ⚠️ 중요 참고사항

- **Restart Policy가 "On Failure"로 설정되어 있는 것이 크래시 루프의 주요 원인일 가능성이 매우 높습니다!**
- 이것을 `Never`로 변경하면 Railway가 자동으로 재시작하지 않습니다
- `railway.json` 파일에 이미 `restartPolicyType: "NEVER"`로 설정했지만, Dashboard 설정이 우선 적용될 수 있으므로 Dashboard에서도 확인해야 합니다

