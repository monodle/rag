# ⚖️ 대한민국 법령 대화형 AI 챗봇 (Korean Law RAG)

대한민국 현행 법령 마크다운 데이터를 **조문(Article)** 단위로 정밀 파싱하고, **100% 로컬 온디바이스 임베딩**과 **벡터 데이터베이스(Qdrant)**, 그리고 **하드웨어 가속 온디바이스 LLM**을 결합한 오픈소스 법률 특화 RAG(Retrieval-Augmented Generation) 시스템입니다.

Tauri v2 기반의 고성능 크로스플랫폼 데스크톱 앱과 모던 반응형 웹 UI를 모두 지원하며, 외부 클라우드 API 의존 없이 내 로컬 컴퓨터에서 안전하고 독립적으로 실행할 수 있습니다.

---

## 📑 목차
1. [핵심 특징](#-핵심-특징)
2. [시스템 아키텍처](#-시스템-아키텍처)
3. [기술 스택 & 선정 모델](#-기술-스택--선정-모델)
4. [프로젝트 디렉터리 구조](#-프로젝트-디렉터리-구조)
5. [사전 요구사항 (Prerequisites)](#-사전-요구사항-prerequisites)
6. [상세 설치 및 실행 가이드 (Quick Start)](#-상세-설치-및-실행-가이드-quick-start)
   - [⚡ 올인원 원클릭 자동 셋업 (Recommended)](#-올인원-원클릭-자동-셋업-recommended)
   - [Step 1. 프로젝트 소스코드 클론 및 패키지 설치](#step-1-프로젝트-소스코드-클론-및-패키지-설치)
   - [Step 2. 환경 변수 설정 (.env)](#step-2-환경-변수-설정-env)
   - [Step 3. Qdrant 벡터 데이터베이스 실행 (Docker)](#step-3-qdrant-벡터-데이터베이스-실행-docker)
   - [Step 4. 외부 법령 데이터셋 다운로드 (data/raws)](#step-4-외부-법령-데이터셋-다운로드-dataraws)
   - [Step 5. 온디바이스 LLM 모델 준비 (선택/권장)](#step-5-온디바이스-llm-모델-준비-선택권장)
   - [Step 6. 법령 파싱 검증 및 Qdrant 벡터 인덱싱](#step-6-법령-파싱-검증-및-qdrant-벡터-인덱싱)
   - [Step 7. 백엔드 서버 및 UI 앱 실행](#step-7-백엔드-서버-및-ui-앱-실행)
7. [CLI 유틸리티 및 명령어 요약](#-cli-유틸리티-및-명령어-요약)
8. [자주 묻는 질문 및 트러블슈팅](#-자주-묻는-질문-및-트러블슈팅)
9. [법적 면책 조항 (Disclaimer)](#-법적-면책-조항-disclaimer)

---

## ✨ 핵심 특징

- 🏛️ **조문(Article) 단위 정밀 청킹**: 법령 마크다운에서 `제N조(제목)` 단위로 분할하고, 조문이 속한 상위 `편 > 장 > 절` 계층 정보를 문맥으로 자동 주입합니다.
- 🧹 **스마트 법령 필터링**: 개정으로 실효/삭제된 조문(`[본조삭제]` 등)을 자동 식별하여 검색 노이즈를 제거하며, 동명 법령 중 최신 시행일자 현행법만 유지합니다.
- 🔒 **100% 로컬 무료 임베딩**: 외부 유료 API 없이 `google/embeddinggemma-2` ONNX 모델을 로컬(Transformers.js / Node.js)에서 직접 구동하여 768차원 고밀도 벡터를 생성합니다.
- ⚡ **온디바이스 LLM 하드웨어 가속**: `node-llama-cpp`를 통해 Mac(Metal) 및 PC(CUDA)의 GPU 가속을 활용하여 EXAONE 4.0, Gemma 4 등 로컬 GGUF 모델을 초고속 추론합니다.
- 🎯 **법률 질문 판별 및 환각 방지**: 코사인 유사도 임계치(Threshold) 검사를 통해 비법률 질문을 선별하고, 검색된 실제 법조문만을 근거로 정확한 인용 답변을 제시합니다.
- 💻 **Tauri v2 + React 19 UI**: 미려한 Glassmorphism 다크 테마 UI를 웹 브라우저(`localhost:5173`) 또는 독립 실행형 데스크톱 앱(Mac/Windows/Linux)으로 이용할 수 있습니다.

---

## 🏛️ 시스템 아키텍처

```
[legalize-kr 마크다운 데이터 (data/raws)]
                  │
                  ▼
[1. Markdown 전처리 & 조문 단위 파서 (LawScanner)]
    - YAML Frontmatter 파싱 및 '상태: 시행' 현행 법령 필터링
    - 최신 시행일자 기준 중복 및 구 폐지 법령 배제
    - '##### 제N조(제목)' 기준 조문 청크 분할 및 상위 장·절 컨텍스트 주입
    - 삭제/실효 조문 내용 자동 제외
                  │
                  ▼
[2. 로컬 고성능 임베딩 (EmbeddingService)]
    - 모델: google/embeddinggemma-2 (onnx-community/embeddinggemma-2-ONNX)
    - 768차원 임베딩 생성 (Node.js 프로세스 내 로컬 ONNX Runtime 추론)
                  │
                  ▼
[3. 벡터 데이터베이스 적재 & 검색 (QdrantService)]
    - 컬렉션: korean_laws (Cosine 거리, 768차원)
    - 메타데이터: 법령명, 조문번호, 조문제목, 상위 장/절 경로, 시행일자, 출처 URL
    - 조문 단위 정확 검색 및 하이브리드 필터링
                  │
                  ▼
[4. 대화형 RAG 백엔드 서버 (RagServer, Dev: 34200, Prod: 34100)]
    - SSE(Server-Sent Events) 스트리밍 토큰 전송
    - 법률 관련도 임계치(0.69) 검사 (비법률 질의 필터링)
    - 온디바이스 LLM(node-llama-cpp Metal/CUDA 가속) 로컬 추론
                  │
                  ▼
[5. 프론트엔드 UI (Tauri v2 / React 19 / Vite)]
    - 데스크톱 네이티브 윈도우 또는 웹 브라우저 인터페이스
    - 실시간 타이핑 애니메이션, 근거 법조문 카드 및 국가법령정보센터 원문 링크
```

---

## 🛠️ 기술 스택 & 선정 모델

| 구분 | 기술 / 라이브러리 | 설명 |
| :--- | :--- | :--- |
| **데스크톱 / UI** | **Tauri v2**, **React 19**, **Vite**, **TypeScript** | 경량 네이티브 데스크톱 앱 및 모던 반응형 웹 프론트엔드 |
| **스타일링** | **Vanilla CSS** | 모던 다크 테마, HSL 기반 Glassmorphism 디자인 시스템 |
| **RAG 백엔드** | **Node.js 22+**, **HTTP Streaming (SSE)** | 초경량 네이티브 HTTP 서버 및 실시간 조문 스트리밍 |
| **임베딩 모델** | **`google/embeddinggemma-2`** (ONNX 768d) | `@huggingface/transformers` 로컬 추론 (완전 무료, 8,192 토큰) |
| **온디바이스 LLM** | **`node-llama-cpp`** (GGUF 추론 엔진) | Apple Silicon Metal / NVIDIA CUDA 가속 지원 (EXAONE 4.0, Gemma 4 등) |
| **벡터 DB** | **LanceDB** (기본, 로컬 임베디드) / **Qdrant** | Docker 불필요, 고속 Apache Arrow 컬럼형 벡터 DB & 20만 조문 릴리즈 동기화 지원 |
| **데이터 파서** | **`gray-matter`**, 커스텀 정규식 조문 파서 | 마크다운 Frontmatter 파싱 및 조문/항/호 정밀 추출 |

---

## 📁 프로젝트 디렉터리 구조

```text
rag/
├── data/
│   ├── raws/                 # 대한민국 법령 마크다운 원본 (legalize-kr)
│   ├── models/               # 온디바이스 LLM GGUF 가중치 모델 저장소
│   ├── prompts/              # RAG 생성용 시스템 프롬프트 (Hot-reload 지원)
│   └── .indexed_laws.json    # Qdrant 인덱싱 진행 상태 캐시 파일
├── src/
│   ├── config/               # 환경변수 및 시스템 설정 상수 (constants.ts)
│   ├── parser/               # 마크다운 파서 및 최신 법령 스캐너
│   │   ├── markdownParser.ts # YAML 헤더 및 조문 단위 정규식 파서
│   │   └── lawScanner.ts     # data/raws 스캔 및 최신 현행법 선별기
│   ├── indexer/              # 임베딩 생성 및 Qdrant 벡터 적재 서비스
│   │   ├── embeddingService.ts # Transformers.js 로컬 임베딩
│   │   └── qdrantService.ts    # Qdrant 컬렉션 생성/검색/업서트
│   ├── server/               # RAG 백엔드 HTTP 서버 및 추론 엔진
│   │   ├── ragServer.ts      # REST / SSE 스트리밍 API 엔드포인트
│   │   ├── llamaCppService.ts# node-llama-cpp 로컬 LLM 세션 관리
│   │   └── promptManager.ts  # 시스템 프롬프트 캐싱 및 핫 리로드(Hot-reload)
│   ├── ui/                   # React 19 프론트엔드 인터페이스
│   │   ├── App.tsx           # 챗봇 대화창, 법조문 카드, 모델 상태 UI
│   │   └── index.css         # 디자인 시스템 및 테마 스타일
│   ├── types/
│   │   └── law.ts            # 법령, 조문 청크 및 메시지 인터페이스
│   └── scripts/
│       ├── setup.ts          # 환경점검/Docker/데이터/모델/인덱싱 올인원 셋업
│       ├── testParser.ts     # 법령 마크다운 파싱 단위 검증
│       ├── indexLaws.ts      # Qdrant 벡터 인덱싱 배치 스크립트
│       ├── searchLaws.ts     # CLI 단독 조문 검색 도구
│       ├── downloadModel.ts  # HuggingFace 온디바이스 GGUF 대화형 다운로더
│       └── selectModel.ts    # 다운로드된 로컬 GGUF 모델 선택기
├── src-tauri/                # Tauri 2.0 Rust 백엔드 설정 및 바이너리
├── scripts/                  # 빌드 및 셋업 유틸리티 스크립트
│   ├── setup.sh              # macOS / Linux 원클릭 자동 셋업 쉘 스크립트
│   ├── setup.bat             # Windows 원클릭 자동 셋업 배치 파일
│   ├── build-win.bat         # Windows 가상머신 전용 자동 빌드 파이프라인
│   ├── sync-version.js       # 버전 동기화 스크립트
│   └── tauri-cli.js          # Tauri CLI 크로스플랫폼 래퍼
├── .env.example              # 환경 변수 설정 템플릿
├── package.json
└── README.md
```

---

## 📋 사전 요구사항 (Prerequisites)

실행하기 전 아래 도구들이 설치되어 있어야 합니다:

1. **Node.js**: `v20.x` 이상 (LTS인 `v22.x` 강력 권장)
2. **패키지 매니저**: `pnpm` (`v9.x` 또는 `v10.x`)
   ```bash
   npm install -g pnpm
   ```
3. **Docker**: Qdrant 벡터 데이터베이스를 컨테이너로 구동하기 위해 필요합니다. ([Docker Desktop 설치](https://www.docker.com/products/docker-desktop/))
4. **Rust & Cargo** *(선택 사항)*:
   - **Tauri 데스크톱 앱**을 빌드/실행할 경우에만 필수입니다. ([Rust 설치 안내](https://www.rust-lang.org/tools/install))
   - 브라우저 웹 UI로만 이용하실 분은 Rust 설치 없이 Node.js만으로도 모든 기능을 구동할 수 있습니다.

---

## 🚀 상세 설치 및 실행 가이드 (Quick Start)

### ⚡ 올인원 원클릭 자동 셋업 (Recommended)

처음 설치 시 복잡한 수동 명령어를 일일이 칠 필요 없이, `package.json`에 등록된 `"setup": "tsx src/scripts/setup.ts"` 스크립트를 통해 **단 하나의 명령어**로 전체 시스템 준비를 끝마칠 수 있는 대화형 자동 셋업을 제공합니다:

```bash
# 옵션 1. 저장소 클론 직후 바로 실행할 때 (Node/pnpm 검사 및 패키지 자동 설치 포함)
./scripts/setup.sh        # macOS / Linux
scripts\setup.bat         # Windows (명령 프롬프트 또는 더블클릭)

# 옵션 2. pnpm 명령어로 직접 실행할 때 (모든 OS 공통: "setup": "tsx src/scripts/setup.ts")
pnpm setup
```

**자동으로 수행되는 작업:**
1. 🔍 **런타임 검사**: Node.js(v20+) 및 pnpm 버전 점검, `.env` 자동 복사
2. 📦 **의존성 설치**: `pnpm install` 누락 여부 확인 및 자동 설치
3. 🐳 **Docker & Qdrant**: Docker 설치/데몬 점검(미설치/미실행 시 안내 후 엔터 대기) 및 `qdrant.local` 컨테이너 자동 실행 & 헬스체크
4. 📚 **법령 데이터셋**: `data/raws/`에 legalize-kr 마크다운 데이터셋 자동 클론
5. 🧠 **온디바이스 LLM**: 추천 한국어 모델(LG EXAONE 4.0 1.2B) 자동 다운로드 & `.env` 등록
6. ⚡ **로컬 임베딩**: 구글 `google/embeddinggemma-2` ONNX 모델 사전 로딩 & 워밍업
7. ⚖️ **샘플 인덱싱**: 즉시 질의 가능한 4대 핵심 법령(`근로기준법,형법,민법,도로교통법`) 자동 벡터 인덱싱

> [!TIP]
> 올인원 셋업이 완료되면 곧바로 [Step 7](#step-7-백엔드-서버-및-ui-앱-실행)으로 이동하여 앱을 구동하시면 됩니다.  
> 수동으로 하나씩 직접 설정하고 싶으시다면 아래의 **Step 1~7**을 차례대로 진행하세요.

---

### Step 1. 프로젝트 소스코드 클론 및 패키지 설치

```bash
# 1. 본 RAG 애플리케이션 저장소 클론
git clone https://github.com/monodle/rag.git
cd rag

# 2. 패키지 의존성 설치
pnpm install
```

---

### Step 2. 환경 변수 설정 (`.env`)

저장소 루트에 있는 `.env.example` 파일을 복사하여 `.env` 파일을 생성합니다.

```bash
cp .env.example .env
```

`.env` 주요 설정 값:
```dotenv
# 온디바이스 LLM 활성화 여부 (true: 로컬 GGUF 가속 추론, false: 비활성화/검색 전용)
USE_ONDEVICE_LLM=true

# 온디바이스 GGUF 모델 경로 (미설정 시 data/models/ 디렉터리 내 모델 자동 감지)
# ONDEVICE_LLM=./data/models/EXAONE-4.0-1.2B-Q4_K_M.gguf

# Qdrant 벡터 데이터베이스 연결 설정
QDRANT_HOST=localhost
QDRANT_PORT=6333
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=korean_laws

# 법제처 오픈소스 법령 원본 데이터셋 Git 저장소 URL (기본값: https://github.com/legalize-kr/legalize-kr.git)
LEGALIZE_KR_REPO_URL=https://github.com/legalize-kr/legalize-kr.git

# RAG 로컬 백엔드 서버 포트 (개발: 34200, 운용: 34100)
PORT=34200

# 질의 시 참조할 최대 법조문 수 (기본값: 4)
MAX_REFERENCES=4

# 법령 원본 마크다운 데이터셋 경로 (기본값: ./data/raws)
RAW_LAWS_DIR=./data/raws

# 시스템 프롬프트 마크다운 파일 경로 (기본값: ./prompts/1000-system_prompt.md)
SYSTEM_PROMPT_PATH=./prompts/1000-system_prompt.md
```

> [!TIP]
> - **조문 검색 전용 모드**: GPU 메모리가 부족하거나 온디바이스 모델 다운로드 없이 **조문 검색 및 원문 인용 기능**만 빠르게 테스트하고 싶다면 `USE_ONDEVICE_LLM=false`로 설정하세요.
> - **시스템 프롬프트 커스터마이징 & 핫 리로드 (Hot-reload)**: `prompts/1000-system_prompt.md` 파일에서 LLM 어시스턴트의 답변 어조, 조문 인용 엄격성 규칙, 환각 방지 지침 등을 수정할 수 있습니다. 백엔드 서버를 재시작하지 않아도 파일 저장 즉시 새로운 프롬프트가 실시간 적용됩니다.

---

### Step 3. Qdrant 벡터 데이터베이스 실행 (Docker)

법률 조문 벡터를 저장하고 고속 코사인 검색을 수행하는 Qdrant 컨테이너를 실행합니다.

```bash
docker run -d \
  --name qdrant.local \
  --restart always \
  -e TZ=Asia/Seoul \
  -p 6333:6333 \
  -v $(pwd)/qdrant_storage:/qdrant/storage \
  qdrant/qdrant
```

- 실행 후 브라우저에서 `http://localhost:6333/dashboard`로 접속하여 Qdrant 웹 대시보드가 정상 동작하는지 확인할 수 있습니다.

---

### Step 4. 외부 법령 데이터셋 다운로드 (`data/raws`)

> [!NOTE]
> **Step 1(본 프로젝트 소스코드 클론)** 과 별개로, RAG 검색 대상이 되는 **실제 대한민국 법률 본문 데이터셋**을 준비하는 단계입니다.

본 시스템은 법제처 데이터를 마크다운으로 가공한 오픈소스 [legalize-kr/legalize-kr](https://github.com/legalize-kr/legalize-kr) 데이터셋을 활용합니다. 법령 마크다운 파일들을 프로젝트 내 `data/raws/` 디렉터리에 내려받습니다.

#### 방법 A: 전체 법령 데이터셋 다운로드 (약 3,000+개 법령)
외부 법령 데이터 저장소를 `data/raws` 경로에 얕은 복제(shallow clone)로 내려받습니다:
```bash
git clone --depth 1 https://github.com/legalize-kr/legalize-kr.git data/raws
```

#### 방법 B: 주요 법령만 선택하여 빠르게 시작하기
3,000여 개 전체 법령을 받지 않고, 테스트하고자 하는 핵심 법령(예: 근로기준법, 형법 등)만 `data/raws/` 하위에 직접 배치해도 즉시 동작합니다:
```text
data/raws/
├── 근로기준법/
│   └── 20240101_시행/
│       └── 법률.md
└── 형법/
    └── 20230808_시행/
        └── 법률.md
```

---

### Step 5. 온디바이스 LLM 모델 준비 (선택/권장)

자연어 답변 생성에 사용할 온디바이스 LLM(GGUF 모델)을 준비합니다. 대화형 CLI 도구를 통해 클릭 한 번으로 다운로드하고 자동 설정할 수 있습니다.

```bash
pnpm model:download
```

**제공되는 프리셋 모델:**
- 🥇 **LG EXAONE 4.0 1.2B (추천)**: 한국어 특화 네이티브 모델, 가볍고 빠른 응답 속도
- 🥈 **Google Gemma 4 E2B**: 최신 소형 경량 모델
- 🥉 **NAVER HyperCLOVAX SEED 0.5B**: 초경량 400MB 모델

다운로드가 완료되면 자동으로 `.env`의 `GEMMA4_MODEL_PATH` 항목이 갱신됩니다.  
이미 로컬에 보유 중인 GGUF 모델이 있다면 `pnpm model:select`를 실행하여 손쉽게 교체할 수 있습니다.

---

### Step 6. 법령 파싱 검증 및 Qdrant 벡터 인덱싱

#### 1) 파서 정상 동작 검증
`data/raws` 내의 마크다운 법령이 조문 단위로 올바르게 분할되는지 테스트합니다:
```bash
pnpm parse:test
```

#### 2) Qdrant 벡터 인덱싱 배치 실행
로컬 임베딩 모델([`google/embeddinggemma-2`](https://huggingface.co/google/embeddinggemma-2))을 통해 768차원 벡터를 생성하여 Qdrant에 적재합니다.

> [!WARNING]
> **소요 시간 안내**: 대한민국 전체 법령(약 3,000+개, 수십만 개 조문)을 모두 인덱싱할 경우 환경에 따라 **약 10~12시간 이상**이 소요됩니다.  
> 따라서 처음 실행하거나 빠른 테스트를 원하실 때는 **[옵션 1]** 처럼 특정 법령(`--target`)만 먼저 인덱싱하여 테스트하는 것을 권장합니다.  
> *(인덱싱 진행 상태는 `data/.indexed_laws.json`에 실시간 자동 저장되므로, 도중에 중단하더라도 언제든지 이어서 진행할 수 있습니다.)*

```bash
# [권장: 빠른 테스트] 특정 주요 법령만 먼저 지정하여 인덱싱 (수분 내 완료)
pnpm index:laws --target="근로기준법,형법,민법,도로교통법"

# [전체 인덱싱] 약 10~12시간 소요 (중단 시 자동 이어하기 지원)
pnpm index:laws

# [옵션] 테스트용으로 처음 5개 법령만 인덱싱
pnpm index:laws --limit=5

# [옵션] 배치 크기 지정 및 기존 캐시 무시 강제 재인덱싱
pnpm index:laws --batch=64 --force
```
> [!NOTE]
> 공식 모델은 구글의 [google/embeddinggemma-2](https://huggingface.co/google/embeddinggemma-2)입니다. 본 프로젝트는 Python 설치 없이 Node.js 프로세스 내에서 100% 로컬 무료 구동하기 위해 Transformers.js의 ONNX 런타임 버전(`onnx-community/embeddinggemma-2-ONNX`)을 내부적으로 자동 다운로드하여 실행합니다.

---

### Step 7. 백엔드 및 UI 앱 실행

#### 🖥️ 옵션 A: Tauri 데스크톱 애플리케이션 (권장 - 원클릭 통합 실행)
```bash
pnpm tauri dev
```
- 백엔드 RAG 서버(포트 34200)와 데스크톱 네이티브 윈도우가 **단 하나의 명령어로 함께 자동 구동**됩니다.
- 앱 창을 닫거나 터미널에서 `Ctrl+C`를 누르면 백엔드 서버도 함께 안전하게 종료됩니다.

#### 🌐 옵션 B: 웹 브라우저에서 실행 (Rust 미설치 시)
```bash
pnpm dev
```
- 백엔드 서버(포트 34200)와 Vite 프론트엔드(포트 5173)가 동시에 실행되며, 브라우저에서 `http://localhost:5173`으로 접속할 수 있습니다.

---

## 💻 CLI 유틸리티 및 명령어 요약

터미널에서 자주 사용하는 스크립트 모음입니다:

| 스크립트 명령어 | 설명 |
| :--- | :--- |
| `pnpm setup` / `./scripts/setup.sh` / `scripts\setup.bat` | 환경점검/의존성/Docker/법령/모델/인덱싱 올인원 대화형 자동 셋업 (`"setup": "tsx src/scripts/setup.ts"`) |
| `pnpm tauri dev` | Tauri 2.0 데스크톱 앱 실행 (백엔드 서버 자동 통합 구동) |
| `pnpm dev` | 웹 브라우저 개발 환경 구동 (백엔드 + Vite UI 동시 구동) |
| `pnpm dev:server` | RAG HTTP 백엔드 서버 단독 실행 (개발 포트 34200, SSE 스트리밍) |
| `pnpm dev:ui` | Vite 웹 프론트엔드 단독 구동 (`http://localhost:5173`) |
| `pnpm index:laws` | 법령 마크다운 파싱 및 Qdrant 벡터 데이터베이스 인덱싱 |
| `pnpm parse:test` | `data/raws` 디렉터리의 법령 파서 정상 동작 검증 |
| `pnpm search "<질문>"` | UI 없이 터미널에서 즉시 유사 법조문 코사인 검색 테스트 |
| `pnpm model:download` | Hugging Face 인기 GGUF 온디바이스 모델 대화형 다운로더 |
| `pnpm model:select` | `data/models/` 내 보유 중인 GGUF 모델 선택 및 `.env` 반영 |
| `pnpm db:download` | GitHub Releases에서 사전 구축된 20만 조문 LanceDB 벡터 데이터베이스 자동 다운로드 및 동기화 |
| `pnpm db:migrate` | Docker Qdrant에 있는 기구축 벡터 데이터를 내장 LanceDB로 재임베딩 없이 고속 마이그레이션 |
| `pnpm db:pack` | `data/lancedb`를 배포용 `korean_laws_lancedb.tar.gz`로 압축 및 SHA256 체크섬 생성 |
| `pnpm db:release` | GitHub CLI(`gh`)를 통해 GitHub Releases에 압축 DB 에셋 자동 배포 |

---

## ❓ 자주 묻는 질문 및 트러블슈팅

### Q1. `docker run` 실행 시 포트 6333이 이미 사용 중이라고 나옵니다.
기존에 실행 중인 Qdrant 컨테이너가 있는지 확인하세요:
```bash
docker ps -a | grep qdrant
docker restart qdrant.local
```

### Q2. 법률과 상관없는 일반 질문을 하면 어떻게 되나요?
본 시스템은 질의어와 인덱싱된 법조문 간의 코사인 유사도를 정밀 측정합니다. 유사도 점수가 법률 기준치(`0.69`) 미만인 경우, 무리하게 왜곡된 법 조항을 끌어오지 않고 **"대한민국 법령과 관련된 구체적인 질문을 입력해 주세요."** 라는 안내와 함께 빠른 가이드를 제공합니다.

### Q3. Tauri 앱 실행(`pnpm tauri dev`) 시 컴파일 에러가 발생합니다.
Tauri 2.0 실행에는 Rust 컴파일러와 C++ 빌드 도구가 필요합니다:
- **macOS**: `xcode-select --install`
- **Linux**: `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`, `wget`, `file`, `libssl-dev`, `libgtk-3-dev` 패키지 설치
- Rust 설치 없이 빠르게 사용하려면 `pnpm dev:ui` 명령어로 웹 브라우저에서 실행하세요.

### Q4. 답변 생성 속도를 더 빠르게 높이고 싶습니다.
- 양자화 비율이 높은 GGUF 모델(예: `Q4_K_M`, `Q4_0`)을 선택하세요.
- Mac의 경우 Apple Silicon(M1/M2/M3/M4)의 Metal 가속이 `node-llama-cpp`를 통해 기본 활성화되어 초당 40~60+ 토큰의 초고속 생성이 가능합니다.

---

## ⚖️ 법적 면책 조항 (Disclaimer)

1. 본 소프트웨어가 제공하는 검색 결과 및 인공지능 생성 답변은 대한민국 법제처 국가법령정보센터의 공개 공공데이터에 기초한 **단순 참고용 정보**입니다.
2. 시스템이 출력하는 내용은 **공인 변호사, 공인노무사, 법무사 등 법률 전문가의 유권해석이나 정식 법률 자문을 절대 대신할 수 없습니다.**
3. 법령의 개정 시점, 구체적인 사실관계 및 판례에 따라 실제 법 적용 결과는 상이할 수 있으므로, 실제 법적 분쟁이나 법률적 판단이 필요한 사안은 반드시 **공인된 법률 전문가와 직접 상담**하시기 바랍니다.
4. 개발자 및 기여자는 본 소프트웨어의 활용으로 인해 발생하는 직·간접적인 손해나 법적 결과에 대해 일체의 책임을 지지 않습니다.

---

## 📄 라이선스 (License)

This project is licensed under the [ISC License](LICENSE).  
법령 원문 데이터의 저작권 및 공공누리 라이선스는 대한민국 법제처 및 [legalize-kr](https://github.com/legalize-kr/legalize-kr) 프로젝트의 가이드라인을 따릅니다.
