@echo off
chcp 65001 >nul
echo ================================================================
echo 🚀 [대한민국 법령 RAG] 원클릭 초기 셋업 시작 (setup.bat)
echo ================================================================

:: 1. Node.js 확인
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo ❌ Node.js가 설치되어 있지 않거나 환경 변수 PATH에 등록되지 않았습니다.
  echo 👉 https://nodejs.org/ 에서 Node.js v20 이상(v22 LTS 권장)을 먼저 설치해 주세요.
  pause
  exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo ✅ Node.js 감지됨: %NODE_VERSION%

:: 2. pnpm 확인 및 설치 유도
where pnpm >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo ⚠️ pnpm이 설치되어 있지 않습니다. npm을 통해 pnpm을 자동 설치합니다...
  call npm install -g pnpm
)

for /f "tokens=*" %%i in ('pnpm -v') do set PNPM_VERSION=%%i
echo ✅ pnpm 감지됨: v%PNPM_VERSION%

:: 3. 의존성 패키지 설치
echo.
echo 📦 필수 패키지 의존성(pnpm install) 확인 및 설치 중...
call pnpm install
if %ERRORLEVEL% neq 0 (
  echo ❌ 패키지 설치 중 오류가 발생했습니다.
  pause
  exit /b 1
)

:: 4. TypeScript 기반 대화형 올인원 셋업 파이프라인 구동
echo.
echo ⚙️ 올인원 셋업 스크립트(pnpm setup)를 실행합니다...
call pnpm setup
