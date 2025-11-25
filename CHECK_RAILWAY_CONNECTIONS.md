# Railway 서비스 연결 확인 방법

## 방법 1: Architecture 뷰에서 확인

1. **Railway Dashboard** 접속
2. 프로젝트 선택
3. **Architecture** 탭 클릭
4. 서비스 간 연결 확인:
   - **Sudam1** 서비스와 **Postgres** 서비스 사이에 **연결선**이 있는지 확인
   - 연결선이 있으면 연결되어 있음
   - 연결선이 없으면 연결 필요

## 방법 2: Sudam1 서비스 설정에서 확인

1. **Railway Dashboard** → 프로젝트 선택
2. **Sudam1** 서비스 클릭
3. **Settings** 탭 클릭
4. **Connected Services** 섹션 확인:
   - Postgres 서비스가 목록에 있으면 연결됨
   - 없으면 연결 필요

## 방법 3: Variables에서 자동 생성된 DATABASE_URL 확인

1. **Railway Dashboard** → **Sudam1** → **Variables** 탭
2. `DATABASE_URL` 변수 확인:
   - **자동 생성된 변수**인지 확인 (Railway가 자동으로 생성하면 연결됨)
   - 변수 이름 옆에 **자동 생성 표시**가 있을 수 있음
   - 값이 `postgresql://postgres:...@postgres.railway.internal:5432/railway` 형식이면 연결됨

## 방법 4: Postgres 서비스에서 확인

1. **Railway Dashboard** → **Postgres** 서비스 클릭
2. **Settings** 탭 클릭
3. **Connected Services** 섹션 확인:
   - Sudam1 서비스가 목록에 있으면 연결됨

## 연결이 안 되어 있다면

### Postgres 서비스를 Sudam1에 연결하기

1. **Railway Dashboard** → **Sudam1** 서비스 클릭
2. **Settings** 탭 클릭
3. **Connected Services** 섹션에서 **+ Connect Service** 클릭
4. **Postgres** 서비스 선택
5. 연결 확인

또는

1. **Railway Dashboard** → **Postgres** 서비스 클릭
2. **Settings** 탭 클릭
3. **Connected Services** 섹션에서 **+ Connect Service** 클릭
4. **Sudam1** 서비스 선택
5. 연결 확인

## 연결 후 확인

연결 후 Railway가 자동으로 `DATABASE_URL`을 설정합니다:
- 변수 이름: `DATABASE_URL`
- 값 형식: `postgresql://postgres:비밀번호@postgres.railway.internal:5432/railway`

이 변수가 자동으로 생성되면 연결이 성공한 것입니다.

