import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import {
  APP_CONFIG,
  DEFAULT_PROD_SERVER_PORT,
  DEFAULT_DEV_SERVER_PORT,
  DEFAULT_DEV_UI_PORT,
  DEFAULT_MIN_REFERENCE_SCORE_THRESHOLD,
  STORAGE_KEYS,
  INSTALLER_FILE_NAMES,
  TOTAL_INDEXED_ARTICLES_ESTIMATE,
  API_ENDPOINTS,
  PRESET_QUERIES,
} from './sharedConstants.js';
import type { PresetModel } from '../types/law.js';

export {
  APP_CONFIG,
  DEFAULT_PROD_SERVER_PORT,
  DEFAULT_DEV_SERVER_PORT,
  DEFAULT_DEV_UI_PORT,
  DEFAULT_MIN_REFERENCE_SCORE_THRESHOLD,
  STORAGE_KEYS,
  INSTALLER_FILE_NAMES,
  TOTAL_INDEXED_ARTICLES_ESTIMATE,
  API_ENDPOINTS,
  PRESET_QUERIES,
  type PresetModel,
};

/**
 * OS별 표준 사용자 애플리케이션 데이터 디렉터리를 반환합니다.
 *
 * 1. 명시적 환경변수 (APP_DATA_DIR) 가 있으면 최우선 적용.
 * 2. 개발 환경(프로젝트 루트에 package.json이 있고 NODE_ENV !== 'production'):
 *    - 프로젝트 루트의 data/ 디렉터리 사용 (개발 편의성)
 * 3. 프로덕션 패키징 설치 환경 (Windows / macOS / Linux):
 *    - Windows: %APPDATA%/korean-law-chat/data (또는 %LOCALAPPDATA%/korean-law-chat/data)
 *    - macOS: ~/Library/Application Support/korean-law-chat/data
 *    - Linux: $XDG_DATA_HOME/korean-law-chat/data (또는 ~/.local/share/korean-law-chat/data)
 */
/**
 * 환경변수 경로 문자열을 검사하여 절대 경로 또는 CWD 기준 정규화 경로로 반환합니다 (Single Source of Truth).
 */
export function resolvePathEnv(envVal?: string, defaultVal?: string): string {
  const trimmed = envVal?.trim();
  if (trimmed) {
    return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
  }
  if (defaultVal) {
    const trimmedDefault = defaultVal.trim();
    return path.isAbsolute(trimmedDefault) ? trimmedDefault : path.resolve(process.cwd(), trimmedDefault);
  }
  return '';
}

/**
 * OS별 표준 사용자 애플리케이션 데이터 디렉터리를 반환합니다.
 *
 * 1. 명시적 환경변수 (APP_DATA_DIR) 가 있으면 최우선 적용.
 * 2. 개발 환경(프로젝트 루트에 package.json이 있고 NODE_ENV !== 'production'):
 *    - 프로젝트 루트의 data/ 디렉터리 사용 (개발 편의성)
 * 3. 프로덕션 패키징 설치 환경 (Windows / macOS / Linux):
 *    - Windows: %APPDATA%/korean-law-chat/data (또는 %LOCALAPPDATA%/korean-law-chat/data)
 *    - macOS: ~/Library/Application Support/korean-law-chat/data
 *    - Linux: $XDG_DATA_HOME/korean-law-chat/data (또는 ~/.local/share/korean-law-chat/data)
 */
function resolveAppDataDir(): string {
  if (process.env.APP_DATA_DIR?.trim()) {
    return resolvePathEnv(process.env.APP_DATA_DIR);
  }

  const isProduction = process.env.NODE_ENV === 'production' || process.env.TAURI_ENV_DEBUG === 'false';
  const hasLocalPackageJson = fs.existsSync(path.resolve(process.cwd(), 'package.json'));

  // 소스코드 트리 내에서 로컬 개발 중인 경우 프로젝트 내부 data 폴더를 우선 사용
  if (!isProduction && hasLocalPackageJson) {
    return path.resolve(process.cwd(), 'data');
  }

  const appName = APP_CONFIG.name;
  const home = os.homedir();

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, appName, 'data');
  }

  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', appName, 'data');
  }

  // Linux 및 기타 Unix 계열
  const dataHome = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  return path.join(dataHome, appName, 'data');
}

/**
 * OS별 표준 로그 저장 디렉터리를 반환합니다.
 */
export function resolveLogsDir(): string {
  if (process.env.LOGS_DIR?.trim()) {
    return resolvePathEnv(process.env.LOGS_DIR);
  }

  const isProduction = process.env.NODE_ENV === 'production' || process.env.TAURI_ENV_DEBUG === 'false';
  const hasLocalPackageJson = fs.existsSync(path.resolve(process.cwd(), 'package.json'));

  if (!isProduction && hasLocalPackageJson) {
    return path.resolve(process.cwd(), 'logs');
  }

  const appName = APP_CONFIG.name;
  const home = os.homedir();

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, appName, 'logs');
  }

  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Logs', appName);
  }

  const stateHome = process.env.XDG_STATE_HOME || path.join(home, '.local', 'state');
  return path.join(stateHome, appName, 'logs');
}

export const APP_DATA_DIR: string = resolveAppDataDir();

/**
 * 법령 원본 마크다운 데이터 디렉터리 경로 (.env의 RAW_LAWS_DIR 또는 기본값)
 */
function resolveRawLawsDir(): string {
  const envPath = process.env.RAW_LAWS_DIR?.trim();
  if (envPath) {
    return resolvePathEnv(envPath);
  }
  const appDataRaw = path.join(APP_DATA_DIR, 'raws');
  if (fs.existsSync(appDataRaw)) {
    return appDataRaw;
  }
  const defaultPath = path.resolve(process.cwd(), 'data/raws');
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }
  const legacyPath = path.resolve(process.cwd(), 'data/raw');
  if (fs.existsSync(legacyPath)) {
    return legacyPath;
  }
  return appDataRaw;
}

export const RAW_LAWS_DIR: string = resolveRawLawsDir();

/**
 * 앱 버전 반환 (환경 변수 또는 package.json의 version 기준 - SSOT)
 */
function resolveAppVersion(): string {
  if (process.env.APP_VERSION?.trim()) {
    return process.env.APP_VERSION.trim();
  }
  try {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.version) return pkg.version;
    }
  } catch {
    // 무시
  }
  return '1.0.0';
}

export const APP_VERSION: string = resolveAppVersion();

/**
 * 환경 변수 문자열을 안전하게 boolean으로 파싱합니다.
 *
 * @param value 환경 변수 문자열 값
 * @param defaultValue 값이 없거나 잘못된 형식일 경우 반환할 기본값
 * @returns boolean 파싱 결과
 */
function parseBooleanEnv(value: string | undefined | null, defaultValue: boolean): boolean {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === '') {
    return defaultValue;
  }

  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  return defaultValue;
}

/**
 * 환경 변수 정수값을 안전하게 파싱합니다.
 */
function parseNumberEnv(value: string | undefined | null, defaultValue: number): number {
  if (value === undefined || value === null || value.trim() === '') {
    return defaultValue;
  }

  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

/**
 * 온디바이스 LLM 활성화 여부
 *
 * - .env의 USE_ONDEVICE_LLM (또는 USE_GEMMA4 / ENABLE_GEMMA4) 값을 읽어 결정합니다.
 * - 기본값: false (미설정 또는 비워둘 시 기본 비활성화)
 */
export const USE_ONDEVICE_LLM: boolean = parseBooleanEnv(
  process.env.USE_ONDEVICE_LLM ?? process.env.USE_GEMMA4 ?? process.env.ENABLE_GEMMA4,
  false
);

/**
 * 기본 서버 포트 (운용: 34100, 개발: 34200)
 */
const PROD_SERVER_PORT: number = parseNumberEnv(
  process.env.PROD_PORT,
  DEFAULT_PROD_SERVER_PORT
);
const DEV_SERVER_PORT: number = parseNumberEnv(
  process.env.DEV_PORT,
  DEFAULT_DEV_SERVER_PORT
);

const DEFAULT_SERVER_PORT: number =
  process.env.NODE_ENV === 'production' || process.env.TAURI_ENV_DEBUG === 'false'
    ? PROD_SERVER_PORT
    : DEV_SERVER_PORT;

/**
 * 서버 포트 설정 (PORT 환경변수 명시 시 최우선, 없으면 환경별 포트 적용)
 */
export const SERVER_PORT: number = parseNumberEnv(process.env.PORT, DEFAULT_SERVER_PORT);

/**
 * 패키징 및 배포 시 사용되는 플랫폼별 백엔드 엔진 아카이브 파일명 (Single Source of Truth)
 */
export const ENGINE_ARCHIVE_NAMES = {
  mac: 'korean_law_engine_mac_arm64.tar.gz',
  win: 'korean_law_engine_win_x64.tar.gz',
} as const;

/**
 * 기본 Qdrant 접속 정보
 */
const DEFAULT_QDRANT_HOST: string = 'localhost';
export const DEFAULT_QDRANT_PORT: number = 6333;

/**
 * Qdrant 벡터 데이터베이스 연결 설정
 */
const QDRANT_HOST: string = process.env.QDRANT_HOST?.trim() || DEFAULT_QDRANT_HOST;
export const QDRANT_PORT: number = parseNumberEnv(process.env.QDRANT_PORT, DEFAULT_QDRANT_PORT);
export const QDRANT_URL: string =
  process.env.QDRANT_URL?.trim() || `http://${QDRANT_HOST}:${QDRANT_PORT}`;
export const QDRANT_API_KEY: string | undefined = process.env.QDRANT_API_KEY?.trim() || undefined;
export const QDRANT_COLLECTION: string = process.env.QDRANT_COLLECTION?.trim() || 'korean_laws';

export const LANCEDB_DIR: string = resolvePathEnv(
  process.env.LANCEDB_DIR,
  path.join(APP_DATA_DIR, 'lancedb')
);
export const LANCEDB_TABLE_NAME: string = process.env.LANCEDB_TABLE_NAME?.trim() || 'korean_laws';

/**
 * 사전 구축된 LanceDB 벡터 데이터베이스 아카이브 파일명 (Single Source of Truth)
 */
export const LANCEDB_ARCHIVE_FILE_NAME = 'korean_laws_lancedb.tar.gz';

/**
 * 3대 독립 릴리즈 채널 기본 태그 설정 (Single Source of Truth, .env에서 재정의 가능)
 */
export const DEFAULT_INSTALLER_RELEASE_TAG: string =
  process.env.RELEASE_TAG_INSTALLER?.trim() || 'latest';

export const DEFAULT_ENGINE_RELEASE_TAG: string =
  process.env.RELEASE_TAG_ENGINE?.trim() || `v${APP_VERSION}`;

export const DEFAULT_LANCEDB_RELEASE_TAG: string =
  process.env.RELEASE_TAG_DB?.trim() || 'data-v1';

/**
 * 사전 구축된 법령 벡터 데이터베이스 GitHub Release 다이렉트 다운로드 URL
 */
export const DEFAULT_LANCEDB_RELEASE_URL: string =
  process.env.LANCEDB_RELEASE_URL?.trim() ||
  `https://github.com/${APP_CONFIG.githubRepo}/releases/download/${DEFAULT_LANCEDB_RELEASE_TAG}/${LANCEDB_ARCHIVE_FILE_NAME}`;

/**
 * 활성화할 벡터 데이터베이스 백엔드 ('lancedb' | 'qdrant')
 * 기본값: 'lancedb' (로컬 프로세스 내장형, Docker 불필요)
 */
export const VECTOR_STORE_TYPE: 'lancedb' | 'qdrant' =
  process.env.VECTOR_STORE?.trim().toLowerCase() === 'qdrant' ? 'qdrant' : 'lancedb';

/**
 * 기본 법제처 오픈소스 법령 원본 데이터셋 Git 저장소 URL
 */
const DEFAULT_LEGALIZE_KR_REPO_URL: string = 'https://github.com/legalize-kr/legalize-kr.git';

/**
 * 법제처 오픈소스 법령 원본 데이터셋 Git 저장소 URL (.env의 LEGALIZE_KR_REPO_URL 또는 기본 저장소)
 */
export const LEGALIZE_KR_REPO_URL: string =
  process.env.LEGALIZE_KR_REPO_URL?.trim() || DEFAULT_LEGALIZE_KR_REPO_URL;

/**
 * 법령 벡터 인덱싱 진행 상태 체크포인트 저장 파일 경로
 */
export const INDEX_PROGRESS_FILE_PATH: string = path.join(APP_DATA_DIR, '.indexed_laws.json');

/**
 * 온디바이스 GGUF 추천 모델 프리셋 목록 (Single Source of Truth - 업체 공식 저장소 기준)
 */

export const PRESET_MODELS: PresetModel[] = [
  {
    repo: 'LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF',
    name: 'LG EXAONE 4.0 1.2B (추천 ⭐)',
    defaultFile: 'EXAONE-4.0-1.2B-BF16.gguf',
    sizeLabel: '2.4 GB',
    description: 'LG AI 공식 최신 경량 모델, CPU 및 보급형 GPU에서 고속 한국어 법률 질의 최적화',
    tags: ['한국어 공식', '초경량', 'CPU/GPU 공용', '추천'],
  },
  {
    repo: 'LGAI-EXAONE/EXAONE-3.5-7.8B-Instruct-GGUF',
    name: 'LG EXAONE 3.5 7.8B Instruct (고성능)',
    defaultFile: 'EXAONE-3.5-7.8B-Instruct-Q4_K_M.gguf',
    sizeLabel: '4.88 GB',
    description: 'LG 최고 사양 도메인 특화 모델, 심층 법률 조항 해석 (VRAM 8GB+ / Mac 16GB+ 권장)',
    tags: ['고성능 7.8B', 'VRAM 8GB+ 권장', '심층 분석'],
  },
  {
    repo: 'naver-ellm/HyperCLOVAX-SEED-Text-Instruct-1.5B-GGUF',
    name: 'NAVER HyperCLOVAX SEED 1.5B',
    defaultFile: 'HyperCLOVAX-SEED-Text-Instruct-1.5B-Q4_K_M.gguf',
    sizeLabel: '960 MB',
    description: '네이버 클라우드 공식 한국어 특화 경량 지시 튜닝 모델',
    tags: ['네이버', '한국어 특화', '1GB 미만', '저사양 최적'],
  },
  {
    repo: 'mykor/Konan-LLM-OND-gguf',
    name: 'Konan LLM OND Q4_K_M (한국어 온디바이스)',
    defaultFile: 'Konan-LLM-OND-Q4_K_M.gguf',
    sizeLabel: '2.37 GB',
    description: '코난테크놀로지 온디바이스 특화 경량 한국어 모델 (속도/용량 최적 균형)',
    tags: ['한국어 온디바이스', 'Q4_K_M', '경량'],
  },
  {
    repo: 'mykor/Konan-LLM-OND-gguf',
    name: 'Konan LLM OND Q8_0 (고정밀 8-bit)',
    defaultFile: 'Konan-LLM-OND-Q8_0.gguf',
    sizeLabel: '4.04 GB',
    description: '코난테크놀로지 온디바이스 모델의 고정밀 8비트 양자화 버전 (한국어 추론 정밀도 극대화)',
    tags: ['한국어 온디바이스', 'Q8_0 고정밀', '4GB'],
  },
];

/**
 * ONNX CPU 폴백용 모델 식별자 (GGUF 파일 경로인 경우 기본 ONNX 모델 사용)
 */
export const ONDEVICE_LLM_MODEL: string =
  (process.env.ONDEVICE_LLM?.trim().endsWith('.gguf') ? undefined : process.env.ONDEVICE_LLM?.trim()) ||
  process.env.ONDEVICE_ONNX_MODEL?.trim() ||
  'onnx-community/gemma-4-E2B-it-ONNX';

/**
 * 로컬 GGUF 가중치 모델 파일 경로 (.env의 ONDEVICE_LLM 또는 GEMMA4_MODEL_PATH)
 */
export const GEMMA4_MODEL_PATH: string | undefined =
  process.env.GEMMA4_MODEL_PATH?.trim() ||
  (process.env.ONDEVICE_LLM?.trim().endsWith('.gguf') ? process.env.ONDEVICE_LLM.trim() : undefined);

/**
 * 질의 시 참조할 최대 근거 법조문 수 (기본값: 4, 최소 1)
 */
export const MAX_REFERENCES: number = Math.max(1, parseNumberEnv(process.env.MAX_REFERENCES, 4));

/**
 * Qdrant 벡터 검색 시 1차 후보군 추출 상한 (.env의 VECTOR_CANDIDATE_LIMIT 또는 기본값 1000)
 */
export const VECTOR_CANDIDATE_LIMIT: number = Math.max(100, parseNumberEnv(process.env.VECTOR_CANDIDATE_LIMIT, 1000));

/**
 * 2단계 조문 선별 시 답변 내 명시적 인용이 적더라도 벡터 최상위 핵심 조문으로 보장할 최소 개수
 */
export const MIN_GUARANTEED_REFS: number = 3;

/**
 * 온디바이스 소형 LLM 컨텍스트 주입용 최대 조문 수 (환각 및 컨텍스트 초과 방지)
 */
export const MAX_LLM_CONTEXT_ARTICLES: number = 5;

/**
 * 근거 법조문 노출 최소 코사인 유사도 임계치 (.env의 MIN_REFERENCE_SCORE_THRESHOLD 또는 기본값 0.74 = 74%)
 */
export const MIN_REFERENCE_SCORE_THRESHOLD: number = parseNumberEnv(
  process.env.MIN_REFERENCE_SCORE_THRESHOLD,
  DEFAULT_MIN_REFERENCE_SCORE_THRESHOLD
);



export const MODELS_DIR: string = resolvePathEnv(
  process.env.MODELS_DIR,
  path.join(APP_DATA_DIR, 'models')
);

/**
 * 임베딩 모델 식별자 및 출력 벡터 차원 (Single Source of Truth)
 */
export const EMBEDDING_MODEL_NAME: string =
  process.env.EMBEDDING_MODEL?.trim() || 'onnx-community/embeddinggemma-2-ONNX';
export const EMBEDDING_DIMENSION: number = 768;

/**
 * 대한민국 법령 관련도 판별 코사인 유사도 임계치
 */
export const LEGAL_RELEVANCE_THRESHOLD: number = 0.69;

/**
 * 1차 후보군 중 최소 유사도 보장 하한선 (Single Source of Truth)
 */
export const MIN_SIMILARITY_FLOOR: number = 0.65;

/**
 * 1차 후보군 선별 시 최상위 점수 대비 허용 최소 상대 유사도 감쇄 비율 (88% 이상 유지, Single Source of Truth)
 */
export const RELATIVE_SIMILARITY_RATIO: number = 0.88;

/**
 * 온디바이스 GGUF (node-llama-cpp) 모델 추론 기본 하이퍼파라미터 (Single Source of Truth)
 */
export const DEFAULT_LLAMA_MAX_TOKENS = 2048;
export const DEFAULT_LLAMA_TEMPERATURE = 0.2;
export const DEFAULT_LLAMA_CONTEXT_SIZE = 8192;

/**
 * 온디바이스 ONNX CPU (Transformers.js) 모델 추론 기본 하이퍼파라미터 (Single Source of Truth)
 */
export const DEFAULT_ONNX_MAX_TOKENS = 1024;
export const DEFAULT_ONNX_TEMPERATURE = 0.0;

function resolvePromptPath(envVar: string | undefined, defaultRelativePath: string): string {
  const trimmed = envVar?.trim();
  if (trimmed) {
    return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
  }
  const defaultPath = path.resolve(process.cwd(), defaultRelativePath);
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }
  // 하위 호환성 1: 넘버링 프리픽스가 없는 경우 (예: prompts/system_prompt.md)
  const unnumberedPath = path.resolve(process.cwd(), defaultRelativePath.replace(/^prompts\/\d+-/, 'prompts/'));
  if (fs.existsSync(unnumberedPath)) {
    return unnumberedPath;
  }
  // 하위 호환성 2: data/prompts/ 에 파일이 존재하는 경우 (예: data/prompts/system_prompt.md)
  const legacyPath = path.resolve(process.cwd(), defaultRelativePath.replace(/^prompts\/\d+-/, 'data/prompts/'));
  if (fs.existsSync(legacyPath)) {
    return legacyPath;
  }
  return defaultPath;
}

/**
 * 시스템 프롬프트 마크다운 파일 경로 (.env의 SYSTEM_PROMPT_PATH 또는 기본값 'prompts/1000-system_prompt.md')
 */
export const SYSTEM_PROMPT_PATH: string = resolvePromptPath(
  process.env.SYSTEM_PROMPT_PATH,
  'prompts/1000-system_prompt.md'
);

/**
 * 쿼리 분석 및 키워드 추출 프롬프트 마크다운 파일 경로
 */
export const QUERY_ANALYSIS_PROMPT_PATH: string = resolvePromptPath(
  process.env.QUERY_ANALYSIS_PROMPT_PATH,
  'prompts/1100-query_analysis.md'
);

/**
 * 조문 리랭킹 프롬프트 마크다운 파일 경로
 */
export const RERANK_PROMPT_PATH: string = resolvePromptPath(
  process.env.RERANK_PROMPT_PATH,
  'prompts/1200-rerank.md'
);

/**
 * 메인 답변 템플릿 마크다운 파일 경로
 */
export const MAIN_ANSWER_PROMPT_PATH: string = resolvePromptPath(
  process.env.MAIN_ANSWER_PROMPT_PATH,
  'prompts/1300-main_answer.md'
);


/**
 * 본론 누락 자가 복구용 프롬프트 마크다운 파일 경로
 */
export const STEP_BODY_PROMPT_PATH: string = resolvePromptPath(
  process.env.STEP_BODY_PROMPT_PATH,
  'prompts/1500-step_body.md'
);

/**
 * 결론 누락 자가 복구용 프롬프트 마크다운 파일 경로
 */
export const STEP_CONCLUSION_PROMPT_PATH: string = resolvePromptPath(
  process.env.STEP_CONCLUSION_PROMPT_PATH,
  'prompts/1600-step_conclusion.md'
);

/**
 * 추천 후속 질문 프롬프트 마크다운 파일 경로
 */
export const DRILLDOWN_PROMPT_PATH: string = resolvePromptPath(
  process.env.DRILLDOWN_PROMPT_PATH,
  'prompts/1700-drilldown.md'
);

/**
 * 질의응답 상세 로그 저장 디렉터리 경로
 */
export const LOGS_DIR: string = resolveLogsDir();




