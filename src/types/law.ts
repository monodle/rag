export interface LawFrontmatter {
  제목?: string;
  법령MST?: number | string;
  법령ID?: string;
  법령구분?: string;
  소관부처?: string[] | string;
  공포일자?: string;
  공포번호?: string;
  시행일자?: string;
  법령분야?: string;
  상태?: string;
  출처?: string;
}

export interface LawArticleChunk {
  id: string;
  lawName: string;
  lawType: string;
  chapterPath: string;
  articleNumber: string;
  articleTitle: string;
  content: string;
  effectiveDate: string;
  status: string;
  sourceUrl: string;
  filePath?: string;
}

export interface ParsedLawDocument {
  metadata: LawFrontmatter;
  chunks: LawArticleChunk[];
}

/**
 * 법령 벡터 검색 옵션 인터페이스 (Single Source of Truth)
 */
export interface LawSearchOptions {
  limit?: number;
  scoreThreshold?: number;
  lawName?: string;
  articleNumber?: string;
}

/**
 * 유사도 점수가 부여된 법령 조문 청크 (Single Source of Truth)
 */
export interface ScoredArticleChunk {
  score: number;
  chunk: LawArticleChunk;
}

/**
 * RAG API 응답 및 UI 렌더링에 사용되는 참조 조문 DTO (Single Source of Truth)
 */
export interface ReferenceArticle {
  id: string;
  lawName: string;
  lawType?: string;
  chapterPath?: string;
  articleNumber: string;
  articleTitle?: string;
  content: string;
  score: number;
  matchReasons?: string[];
}

/**
 * 온디바이스 언어 모델 구동 상태 DTO (Single Source of Truth)
 */
export interface UnifiedLlmStatus {
  enabled: boolean;
  isReady: boolean;
  isInitializing: boolean;
  modelName: string;
  gpu: string;
  engine: 'disabled' | 'metal-gpu' | 'onnx-cpu';
}

/**
 * 로컬에 보관된 사용 가능한 GGUF 모델 정보 DTO (Single Source of Truth)
 */
export interface AvailableLlmModel {
  filename: string;
  name: string;
  title: string;
  quant: string;
  sizeBytes: number;
  isCurrent: boolean;
}

/**
 * 사전 구축 법령 벡터 DB 다운로드 및 동기화 진행 상태 DTO (Single Source of Truth)
 */
export interface DbSyncProgress {
  status: 'checking' | 'downloading' | 'extracting' | 'verifying' | 'completed' | 'error';
  percent: number;
  downloadedMB: string;
  totalMB: string;
  message: string;
}

/**
 * HuggingFace GGUF 파일 정보 DTO (Single Source of Truth)
 */
export interface HfGgufItem {
  path: string;
  size: number;
  sizeFormatted: string;
}

/**
 * 온디바이스 GGUF 모델 다운로드 진행 상태 DTO (Single Source of Truth)
 */
export interface ModelDownloadProgress {
  status: 'idle' | 'downloading' | 'completed' | 'error';
  repo: string;
  filename: string;
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
  downloadedMB: string;
  totalMB: string;
  speedMBs: string;
  message: string;
}

/**
 * 시스템 스토리지 디렉토리별 점유량 DTO (Single Source of Truth)
 */
export interface StorageBreakdown {
  totalBytes: number;
  modelsBytes: number;
  databaseBytes: number;
  engineBytes: number;
  logsBytes: number;
  formattedTotal: string;
  formattedModels: string;
  formattedDatabase: string;
  formattedEngine: string;
  formattedLogs: string;
  appDataRoot: string;
}

/**
 * 백엔드 RAG 통계 API (/api/stats) 응답 DTO (Single Source of Truth)
 */
export interface ServerStatsResponse {
  version?: string;
  collection: string;
  lawsCount: number;
  pointsCount: number;
  indexedVectors: number;
  useOnDeviceLlm: boolean;
  llm: UnifiedLlmStatus;
  engine: string;
  gpu: string;
  vectorBackend?: string;
  minReferenceScoreThreshold?: number;
}

/**
 * 질의응답 단일 완료 응답 DTO (Single Source of Truth)
 */
export interface ChatResponseDto {
  answer: string;
  references: ReferenceArticle[];
}

/**
 * 답변 도출 과정(추론 및 검색 파이프라인)의 개별 단계 로그 DTO (Single Source of Truth)
 */
export interface ProcessLogItem {
  id: string;
  step: string;
  detail?: string;
  timestamp: string;
  status: 'loading' | 'done';
}
/**
 * 온디바이스 GGUF 추천 모델 프리셋 인터페이스 (Single Source of Truth)
 */
export interface PresetModel {
  repo: string;
  name: string;
  defaultFile: string;
  sizeLabel: string;
  description: string;
  tags: string[];
}

/**
 * 로컬 설치 여부가 결합된 프리셋 모델 DTO (Single Source of Truth)
 */
export type PresetModelWithStatus = PresetModel & {
  isInstalled: boolean;
  installedFilename?: string;
};


/**
 * 백엔드 데이터베이스 상태 API (/api/db/status) 응답 DTO (Single Source of Truth)
 */
export interface DbStatusResponse {
  ready: boolean;
  pointsCount: number;
  progress: DbSyncProgress;
}

/**
 * 백엔드 LLM 모델 목록 API (/api/llm/models) 응답 DTO (Single Source of Truth)
 */
export interface LlmModelsResponse {
  models: AvailableLlmModel[];
  currentModel: string | null;
}

/**
 * 사용자 질의 분석 및 키워드 추출 결과 DTO (Single Source of Truth)
 */
export interface QueryAnalysisResult {
  keywords: string[];
  isLegalQuery: boolean;
  rawResponse?: string;
  systemPrompt?: string;
  prompt?: string;
}

