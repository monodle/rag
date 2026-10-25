#!/usr/bin/env bash
set -e

# ==============================================================================
# 대한민국 법령 RAG 원클릭 셋업 부트스트랩 스크립트 (setup.sh)
# ==============================================================================

cd "$(dirname "$0")/.."

echo "================================================================"
echo "🚀 [대한민국 법령 RAG] 원클릭 초기 셋업 시작 (scripts/setup.sh)"
echo "================================================================"

# 1. Node.js 확인
if ! command -v node &> /dev/null; then
  echo "❌ Node.js가 설치되어 있지 않습니다."
  echo "👉 https://nodejs.org/ 에서 Node.js v20 이상(v22 LTS 권장)을 먼저 설치해 주세요."
  exit 1
fi

NODE_VERSION=$(node -v)
echo "✅ Node.js 감지됨: ${NODE_VERSION}"

# 2. pnpm 확인 및 설치 유도
if ! command -v pnpm &> /dev/null; then
  echo "⚠️ pnpm이 설치되어 있지 않습니다. npm을 통해 pnpm을 자동 설치합니다..."
  npm install -g pnpm
fi

PNPM_VERSION=$(pnpm -v)
echo "✅ pnpm 감지됨: v${PNPM_VERSION}"

# 3. 의존성 패키지 설치
echo ""
echo "📦 필수 패키지 의존성(pnpm install) 확인 및 설치 중..."
pnpm install

# 4. TypeScript 기반 대화형 올인원 셋업 파이프라인 구동
echo ""
echo "⚙️ 올인원 셋업 스크립트(pnpm setup)를 실행합니다..."
pnpm setup
