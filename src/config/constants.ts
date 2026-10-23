import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';

/**
 * 법령 원본 마크다운 데이터 디렉터리 경로 (.env의 RAW_LAWS_DIR 또는 기본값 'data/raws')
 * data/raws 가 없을 경우 하위 호환을 위해 data/raw 로 fallback 합니다.
 */
function resolveRawLawsDir(): string {
  const envPath = process.env.RAW_LAWS_DIR?.trim();
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
  }
  const defaultPath = path.resolve(process.cwd(), 'data/raws');
  if (!fs.existsSync(defaultPath)) {
    const legacyPath = path.resolve(process.cwd(), 'data/raw');
    if (fs.existsSync(legacyPath)) {
      return legacyPath;
    }
  }
  return defaultPath;
}

export const RAW_LAWS_DIR: string = resolveRawLawsDir();
export const APP_VERSION: string = process.env.APP_VERSION?.trim() || '1.1';

/**
 * 환경 변수 문자열을 안전하게 boolean으로 파싱합니다.
 * 
 * @param value 환경 변수 문자열 값
 * @param defaultValue 값이 없거나 잘못된 형식일 경우 반환할 기본값
 * @returns boolean 파싱 결과
 */
export function parseBooleanEnv(value: string | undefined | null, defaultValue: boolean): boolean {
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
export function parseNumberEnv(value: string | undefined | null, defaultValue: number): number {
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
 * 기본 서버 포트
 */
export const DEFAULT_SERVER_PORT: number = 3100;

/**
 * 서버 포트 설정
 */
export const SERVER_PORT: number = parseNumberEnv(process.env.PORT, DEFAULT_SERVER_PORT);

/**
 * 기본 Qdrant 접속 정보
 */
export const DEFAULT_QDRANT_HOST: string = 'localhost';
export const DEFAULT_QDRANT_PORT: number = 6333;

/**
 * Qdrant 벡터 데이터베이스 연결 설정
 */
export const QDRANT_HOST: string = process.env.QDRANT_HOST?.trim() || DEFAULT_QDRANT_HOST;
export const QDRANT_PORT: number = parseNumberEnv(process.env.QDRANT_PORT, DEFAULT_QDRANT_PORT);
export const QDRANT_URL: string =
  process.env.QDRANT_URL?.trim() || `http://${QDRANT_HOST}:${QDRANT_PORT}`;
export const QDRANT_API_KEY: string | undefined = process.env.QDRANT_API_KEY?.trim() || undefined;
export const QDRANT_COLLECTION: string = process.env.QDRANT_COLLECTION?.trim() || 'korean_laws';

/**
 * LanceDB 로컬 임베디드 벡터 데이터베이스 경로 및 테이블명
 */
export const DEFAULT_LANCEDB_DIR: string = path.resolve(process.cwd(), 'data/lancedb');
export const LANCEDB_DIR: string = process.env.LANCEDB_DIR?.trim() || DEFAULT_LANCEDB_DIR;
export const LANCEDB_TABLE_NAME: string = process.env.LANCEDB_TABLE_NAME?.trim() || 'korean_laws';

/**
 * 활성화할 벡터 데이터베이스 백엔드 ('lancedb' | 'qdrant')
 * 기본값: 'lancedb' (로컬 프로세스 내장형, Docker 불필요)
 */
export const VECTOR_STORE_TYPE: 'lancedb' | 'qdrant' =
  process.env.VECTOR_STORE?.trim().toLowerCase() === 'qdrant' ? 'qdrant' : 'lancedb';

/**
 * 기본 법제처 오픈소스 법령 원본 데이터셋 Git 저장소 URL
 */
export const DEFAULT_LEGALIZE_KR_REPO_URL: string = 'https://github.com/legalize-kr/legalize-kr.git';

/**
 * 법제처 오픈소스 법령 원본 데이터셋 Git 저장소 URL (.env의 LEGALIZE_KR_REPO_URL 또는 기본 저장소)
 */
export const LEGALIZE_KR_REPO_URL: string =
  process.env.LEGALIZE_KR_REPO_URL?.trim() || DEFAULT_LEGALIZE_KR_REPO_URL;

/**
 * 법령 벡터 인덱싱 진행 상태 체크포인트 저장 파일 경로
 */
export const INDEX_PROGRESS_FILE_PATH: string = path.resolve(process.cwd(), 'data/.indexed_laws.json');

/**
 * 온디바이스 GGUF 추천 모델 프리셋 인터페이스 및 목록 (Single Source of Truth - 업체 공식 저장소 기준)
 */
export interface PresetModel {
  repo: string;
  name: string;
}

export const PRESET_MODELS: PresetModel[] = [
  {
    repo: 'LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF',
    name: 'LG EXAONE 4.0 1.2B (추천 ⭐ - LG AI Research 공식, 한국어 네이티브, 초경량)',
  },
  {
    repo: 'google/gemma-4-E2B-it-qat-q4_0-gguf',
    name: 'Google Gemma 4 E2B QAT (Google 공식 최신 모델)',
  },
  {
    repo: 'naver-ellm/HyperCLOVAX-SEED-Text-Instruct-0.5B-GGUF',
    name: 'NAVER HyperCLOVAX SEED 0.5B (NAVER Cloud 공식, 초경량 400MB)',
  },
  {
    repo: 'naver-ellm/HyperCLOVAX-SEED-Text-Instruct-1.5B-GGUF',
    name: 'NAVER HyperCLOVAX SEED 1.5B (NAVER Cloud 공식, 한국어 특화)',
  },
  {
    repo: 'Qwen/Qwen2.5-1.5B-Instruct-GGUF',
    name: 'Qwen 2.5 1.5B Instruct (Qwen 공식 경량 다국어 모델)',
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

export { DEFAULT_UI_VISIBLE_REFS, MIN_REFERENCE_SCORE_THRESHOLD as DEFAULT_MIN_REFERENCE_SCORE_THRESHOLD } from '../types/law.js';

/**
 * 근거 법조문 노출 최소 코사인 유사도 임계치 (.env의 MIN_REFERENCE_SCORE_THRESHOLD 또는 기본값 0.74 = 74%)
 */
export const MIN_REFERENCE_SCORE_THRESHOLD: number = parseNumberEnv(
  process.env.MIN_REFERENCE_SCORE_THRESHOLD,
  0.74
);



/**
 * 로컬 온디바이스 GGUF 모델 기본 저장 디렉터리 경로
 */
export const MODELS_DIR: string = path.resolve(process.cwd(), 'data/models');

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

function resolvePromptPath(envVar: string | undefined, defaultRelativePath: string): string {
  const trimmed = envVar?.trim();
  if (trimmed) {
    return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
  }
  return path.resolve(process.cwd(), defaultRelativePath);
}

/**
 * 시스템 프롬프트 마크다운 파일 경로 (.env의 SYSTEM_PROMPT_PATH 또는 기본값 'data/prompts/system_prompt.md')
 */
export const SYSTEM_PROMPT_PATH: string = resolvePromptPath(
  process.env.SYSTEM_PROMPT_PATH,
  'data/prompts/system_prompt.md'
);

/**
 * 메인 답변 템플릿 마크다운 파일 경로
 */
export const MAIN_ANSWER_PROMPT_PATH: string = resolvePromptPath(
  process.env.MAIN_ANSWER_PROMPT_PATH,
  'data/prompts/main_answer.md'
);

/**
 * 쿼리 분석 및 키워드 추출 프롬프트 마크다운 파일 경로
 */
export const QUERY_ANALYSIS_PROMPT_PATH: string = resolvePromptPath(
  process.env.QUERY_ANALYSIS_PROMPT_PATH,
  'data/prompts/query_analysis.md'
);

/**
 * 조문 리랭킹 프롬프트 마크다운 파일 경로
 */
export const RERANK_PROMPT_PATH: string = resolvePromptPath(
  process.env.RERANK_PROMPT_PATH,
  'data/prompts/rerank.md'
);

/**
 * 추천 후속 질문 프롬프트 마크다운 파일 경로
 */
export const DRILLDOWN_PROMPT_PATH: string = resolvePromptPath(
  process.env.DRILLDOWN_PROMPT_PATH,
  'data/prompts/drilldown.md'
);

/**
 * 서론(핵심 요약) 프롬프트 마크다운 파일 경로
 */
export const STEP_INTRO_PROMPT_PATH: string = resolvePromptPath(
  process.env.STEP_INTRO_PROMPT_PATH,
  'data/prompts/step_intro.md'
);

/**
 * 본론 누락 자가 복구용 프롬프트 마크다운 파일 경로
 */
export const STEP_BODY_PROMPT_PATH: string = resolvePromptPath(
  process.env.STEP_BODY_PROMPT_PATH,
  'data/prompts/step_body.md'
);

/**
 * 결론 누락 자가 복구용 프롬프트 마크다운 파일 경로
 */
export const STEP_CONCLUSION_PROMPT_PATH: string = resolvePromptPath(
  process.env.STEP_CONCLUSION_PROMPT_PATH,
  'data/prompts/step_conclusion.md'
);

/**
 * 질의응답 상세 로그 저장 디렉터리 경로
 */
export const LOGS_DIR: string = path.resolve(process.cwd(), 'logs');




