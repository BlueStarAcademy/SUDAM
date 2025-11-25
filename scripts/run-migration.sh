#!/bin/bash

# Supabase → Railway 마이그레이션 실행 스크립트
# 사용법: ./scripts/run-migration.sh

set -e  # 오류 발생 시 중단

echo "=========================================="
echo "Supabase → Railway 마이그레이션"
echo "=========================================="
echo ""

# 환경 변수 확인
if [ -z "$SUPABASE_DATABASE_URL" ]; then
    echo "❌ 오류: SUPABASE_DATABASE_URL 환경변수가 설정되지 않았습니다."
    echo ""
    echo "설정 방법:"
    echo "export SUPABASE_DATABASE_URL=\"postgresql://postgres:password@db.xxx.supabase.co:5432/postgres\""
    exit 1
fi

if [ -z "$RAILWAY_DATABASE_URL" ]; then
    echo "❌ 오류: RAILWAY_DATABASE_URL 환경변수가 설정되지 않았습니다."
    echo ""
    echo "설정 방법:"
    echo "export RAILWAY_DATABASE_URL=\"postgresql://postgres:password@containers-us-west-xxx.railway.app:5432/railway\""
    exit 1
fi

# 연결 정보 확인 (비밀번호 마스킹)
SUPABASE_MASKED=$(echo "$SUPABASE_DATABASE_URL" | sed 's/:[^:@]*@/:****@/')
RAILWAY_MASKED=$(echo "$RAILWAY_DATABASE_URL" | sed 's/:[^:@]*@/:****@/')

echo "소스 (Supabase): $SUPABASE_MASKED"
echo "대상 (Railway): $RAILWAY_MASKED"
echo ""

# 확인
read -p "마이그레이션을 시작하시겠습니까? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
    echo "마이그레이션이 취소되었습니다."
    exit 0
fi

echo ""
echo "[1/3] Railway Postgres에 스키마 적용 중..."
DATABASE_URL="$RAILWAY_DATABASE_URL" npm run prisma:migrate:deploy
echo "✓ 스키마 적용 완료"
echo ""

echo "[2/3] 데이터 마이그레이션 실행 중..."
npm run migrate:to-railway
echo "✓ 데이터 마이그레이션 완료"
echo ""

echo "[3/3] 마이그레이션 완료!"
echo ""
echo "다음 단계:"
echo "1. Railway Dashboard → Backend 서비스 → Variables"
echo "2. DATABASE_URL을 Railway Postgres URL로 변경"
echo "3. 서비스가 자동으로 재시작됩니다"
echo ""

