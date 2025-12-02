# Railway Dashboard 설정 가이드 (현재 화면 기준)

## 📋 현재 화면에서 확인해야 할 설정들

### ✅ **1. Pre-deploy Command (유지하되 최적화)**

**현재 설정:**
```
npx prisma db push --schema prisma/schema.prisma --accept-data
```

**권장 설정 (더 안전하게):**
```
npx prisma db push --schema prisma/schema.prisma --accept-data-loss --skip-generate
```

**이유:**
- ✅ **유지해야 합니다**: 데이터베이스 스키마를 최신 상태로 유지하기 위해 필요
- ⚠️ **최적화**: `--skip-generate`를 추가하면 Prisma Client 생성 건너뛰어 배포 시간 단축 (Docker 빌드 단계에서 이미 생성됨)
- ⚠️ **플래그 확인**: `--accept-data`가 아니라 `--accept-data-loss`가 정확한 플래그입니다

**또는 더 안전한 방법 (마이그레이션 사용):**
```
npx prisma migrate deploy --schema prisma/schema.prisma
```
- 이 방법은 마이그레이션 히스토리를 관리하므로 더 안전하지만, 초기 마이그레이션 문제가 있었다면 `db push`를 사용하는 것이 좋습니다

---

### ✅ **2. Custom Start Command (현재 설정 유지)**

**현재 설정:**
```
npm run start-server
```

**조치:**
- ✅ **유지**: 현재 설정이 `railway.json`과 일치하므로 그대로 두세요

---

### 🌍 **3. Regions (지역 설정)**

**현재 설정:**
- **지역**: `Southeast Asia (Singapore)`
- **인스턴스 수**: `1 Instance`

**권장 설정:**

**한국 사용자 기준:**
- **옵션 1**: `Southeast Asia (Singapore)` ✅ **현재 설정 유지** (한국에서 가장 가까운 지역)
- **옵션 2**: `East Asia (Japan)` (도쿄 - 더 가까울 수 있지만 Railway에서 제공하는 경우만)
- **옵션 3**: `US West` (미국 서부 - 가장 안정적이지만 지연 시간 증가)

**인스턴스 수:**
- ✅ **1 Instance 유지** (현재 크래시 문제 해결 후 필요시 증가)

**지역 변경 방법:**
1. Regions 드롭다운 클릭
2. 사용 가능한 지역 목록 확인
3. 한국 사용자라면 현재 `Singapore`가 최선의 선택입니다
4. 변경하지 않아도 됩니다 ✅

---

### ⚙️ **4. Teardown (제거/비활성화 유지)**

**현재 설정:**
- **Enable Teardown**: `OFF` (비활성화)

**조치:**
- ✅ **그대로 유지**: 비활성화 상태가 정확합니다
- 이 설정은 새 배포 시작 시 이전 배포를 종료하는 것입니다
- 크래시 문제 해결 중에는 비활성화 상태가 안전합니다

---

### 💻 **5. Resource Limits (리소스 제한)**

**현재 설정:**
- **CPU**: `32 vCPU` (Plan limit: 32 vCPU) - 체크박스 해제
- **Memory**: `32 GB` (Plan limit: 32 GB) - 체크박스 해제

**권장 설정:**

**실제 필요한 리소스 확인 후 조정:**
1. **CPU**: `2-4 vCPU` 정도로 시작 (32 vCPU는 과도함)
2. **Memory**: `4-8 GB` 정도로 시작 (32 GB는 과도함)
3. 메모리 부족 시 크래시가 발생할 수 있으므로 적절히 설정

**설정 방법:**
1. CPU 입력 필드에서 `4` 입력 (또는 적절한 값)
2. Memory 입력 필드에서 `8` 입력 (또는 적절한 값)
3. 체크박스는 해제 상태 유지 (플랜 제한 사용 안 함)

**주의:**
- 리소스를 너무 적게 설정하면 메모리 부족으로 크래시 발생 가능
- 너무 많이 설정하면 비용 증가
- 현재 크래시 문제가 있다면 `8 GB Memory, 2-4 vCPU` 정도로 시작

---

### 🔍 **6. Health Check 설정 (화면에 보이지 않을 수 있음)**

**`railway.json` 파일에 이미 설정되어 있음:**
- Health Check Path: `/api/health`
- Health Check Timeout: `60` 초
- Health Check Interval: `120` 초

**화면에서 확인:**
1. Deploy 섹션을 아래로 스크롤
2. "Health Check" 또는 "Healthcheck" 섹션 찾기
3. 있으면 다음 값으로 설정:
   - **Path**: `/api/health`
   - **Timeout**: `60`
   - **Interval**: `120`

**없으면:**
- `railway.json` 파일 설정이 자동으로 적용됩니다 ✅

---

### 🔄 **7. Restart Policy (화면에서 찾기)**

**`railway.json` 파일에 설정됨:**
- Restart Policy Type: `NEVER`

**화면에서 확인:**
1. Deploy 섹션을 아래로 스크롤
2. "Restart Policy" 또는 "Auto Restart" 찾기
3. 있으면 `Never` 또는 `OFF` 선택

**없으면:**
- `railway.json` 파일 설정이 자동으로 적용됩니다 ✅

---

## 📝 요약: 변경해야 할 항목

### ✅ **유지할 것:**
1. ✅ Pre-deploy Command (플래그만 수정 가능)
2. ✅ Custom Start Command
3. ✅ Regions (Singapore 유지)
4. ✅ Teardown (OFF 유지)

### ⚠️ **수정 고려:**
1. ⚠️ **Resource Limits**: CPU와 Memory를 적절히 조정 (4 vCPU, 8 GB 정도)

### 🔍 **확인해야 할 것:**
1. 🔍 Health Check 설정 (있으면 확인, 없으면 `railway.json` 적용됨)
2. 🔍 Restart Policy (있으면 확인, 없으면 `railway.json` 적용됨)

---

## 🚀 다음 단계

1. **Resource Limits 조정** (가장 중요)
   - CPU: `4` vCPU
   - Memory: `8` GB

2. **Pre-deploy Command 확인**
   - 현재 설정 유지하거나 `--skip-generate` 추가

3. **배포 후 모니터링**
   - Logs 탭에서 메모리 사용량 확인
   - 크래시 발생 여부 확인

4. **필요시 리소스 조정**
   - 메모리 부족 시 증가
   - CPU 부족 시 증가

