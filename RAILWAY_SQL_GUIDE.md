# Railway에서 SQL 실행하는 방법

## Railway 대시보드에서 SQL 실행하기

### 단계별 가이드

1. **Railway 대시보드 접속**
   - https://railway.app 접속
   - 로그인

2. **프로젝트 및 서비스 선택**
   - 왼쪽 사이드바에서 프로젝트 선택 (예: "capable-harmony")
   - PostgreSQL 서비스 선택 (Postgres 아이콘, "Postgres" 또는 "PostgreSQL" 이름)

3. **Database 탭으로 이동**
   - 상단 탭 메뉴에서 **"Database"** 탭 클릭
   - "Deployments", "Database", "Backups", "Variables", "Metrics", "Settings" 중 "Database" 선택

4. **Data 서브탭 확인**
   - "Database" 탭 내에서 "Data", "Extensions", "Credentials" 서브탭이 있습니다
   - **"Data"** 서브탭이 선택되어 있는지 확인

5. **SQL 실행 방법 (두 가지 방법)**

   **방법 A: 테이블 클릭 후 쿼리 실행**
   - `_prisma_migrations` 테이블을 클릭
   - 테이블 상세 화면에서 SQL 쿼리 입력창이 나타날 수 있습니다
   - 또는 상단에 "Query" 또는 "Run SQL" 버튼이 있을 수 있습니다

   **방법 B: Connect 버튼 사용 (외부 클라이언트)**
   - "Data" 탭의 우측 상단에 있는 **"Connect"** 버튼 클릭
   - 연결 정보를 복사하여 로컬의 PostgreSQL 클라이언트(예: pgAdmin, DBeaver, psql)로 연결
   - 로컬 클라이언트에서 SQL 실행

6. **SQL 쿼리 실행**
   ```sql
   -- 실패한 마이그레이션 상태 확인
   SELECT * FROM "_prisma_migrations" WHERE migration_name = '0001_init_schema';
   
   -- 실패한 마이그레이션을 해결
   UPDATE "_prisma_migrations" 
   SET finished_at = NOW(), 
       applied_steps_count = 1
   WHERE migration_name = '0001_init_schema' 
     AND finished_at IS NULL;
   ```

## 대안: Railway Shell 사용

만약 SQL 에디터를 찾을 수 없다면:

1. Railway 대시보드에서 **배포된 서비스**(예: "Sudam1") 선택
2. "Deployments" 탭 → 최신 배포 선택
3. "Shell" 탭 클릭
4. 다음 명령 실행:
   ```bash
   # PostgreSQL에 연결
   psql $DATABASE_URL
   
   # SQL 실행
   UPDATE "_prisma_migrations" 
   SET finished_at = NOW(), 
       applied_steps_count = 1
   WHERE migration_name = '0001_init_schema' 
     AND finished_at IS NULL;
   
   # 종료
   \q
   ```

## 주의사항

- SQL을 실행하기 전에 반드시 `SELECT` 쿼리로 현재 상태를 확인하세요
- `UPDATE` 쿼리는 데이터를 변경하므로 신중하게 실행하세요
- 프로덕션 환경에서는 특히 주의하세요

