# 로컬에서 Railway 데이터베이스 사용 설정

## Railway Postgres 공개 연결 URL

로컬 개발 환경에서 Railway Postgres를 사용하려면 공개 연결 URL을 사용해야 합니다.

**Railway Postgres 공개 연결 URL:**
```
postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpKlR@turntable.proxy.rlwy.net:17109/railway?sslmode=require
```

## 설정 방법

### 1. `.env` 파일 수정

프로젝트 루트의 `.env` 파일을 열고 `DATABASE_URL`을 다음과 같이 설정하세요:

```env
DATABASE_URL="postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpKlR@turntable.proxy.rlwy.net:17109/railway?sslmode=require"
```

**중요:** 
- `sslmode=require` 파라미터를 반드시 포함해야 합니다
- 이 URL은 공개 연결 URL이므로 보안에 주의하세요
- 프로덕션 환경에서는 내부 네트워크 주소를 사용합니다

### 2. Prisma 클라이언트 재생성 (선택사항)

스키마가 변경되었다면 Prisma 클라이언트를 재생성하세요:

```bash
npm run prisma:generate
```

### 3. 연결 테스트

로컬 서버를 시작하여 연결을 테스트하세요:

```bash
npm start
```

서버가 정상적으로 시작되고 데이터베이스 연결이 성공하면 다음과 같은 메시지가 표시됩니다:
```
[DB] Database initialized successfully
```

## 주의사항

⚠️ **보안:**
- 공개 연결 URL에는 비밀번호가 포함되어 있으므로 `.env` 파일을 Git에 커밋하지 마세요
- `.env` 파일은 `.gitignore`에 포함되어 있어야 합니다

⚠️ **성능:**
- 공개 연결 URL은 인터넷을 통해 연결되므로 로컬 데이터베이스보다 느릴 수 있습니다
- 개발 중에는 로컬 PostgreSQL을 사용하는 것을 권장합니다

⚠️ **연결 제한:**
- Railway의 공개 연결은 연결 수 제한이 있을 수 있습니다
- 여러 개발자가 동시에 사용하면 연결 오류가 발생할 수 있습니다

## 로컬 PostgreSQL로 되돌리기

로컬 개발을 위해 로컬 PostgreSQL을 사용하려면:

```env
DATABASE_URL="postgresql://sudamr:sudamr@localhost:5432/sudamr?schema=public"
```

## Railway CLI를 사용한 자동 설정 (선택사항)

Railway CLI를 사용하여 환경 변수를 자동으로 가져올 수 있습니다:

```bash
# Railway에 로그인
railway login

# 프로젝트 연결
railway link

# 환경 변수 가져오기 (로컬 .env 파일에 추가)
railway variables --service Postgres --output json | jq -r 'to_entries[] | "\(.key)=\(.value)"' >> .env
```

하지만 이 방법은 모든 환경 변수를 가져오므로, DATABASE_URL만 수동으로 설정하는 것이 더 안전합니다.

