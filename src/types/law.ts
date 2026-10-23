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
  filePath: string;
}

export interface ParsedLawDocument {
  metadata: LawFrontmatter;
  chunks: LawArticleChunk[];
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
 * 백엔드 RAG 통계 API (/api/stats) 응답 DTO (Single Source of Truth)
 */
export interface ServerStatsResponse {
  collection: string;
  lawsCount: number;
  pointsCount: number;
  indexedVectors: number;
  useOnDeviceLlm: boolean;
  llm: UnifiedLlmStatus;
  engine: string;
  gpu: string;
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
 * UI에 노출되는 근거 법조문의 최소 코사인 유사도 점수 임계치 (74% 이상만 노출, Single Source of Truth)
 */
export const MIN_REFERENCE_SCORE_THRESHOLD = 0.74;

/**
 * UI 참조 조문 카드에서 기본으로 펼쳐 보여줄 조문 수 (Single Source of Truth)
 */
export const DEFAULT_UI_VISIBLE_REFS = 5;

/**
 * 마크다운 이스케이프 문자(예: 1\. -> 1., \( -> ()를 사람이 읽기 좋은 일반 문장 형식으로 정제합니다 (SSOT).
 */
export function cleanMarkdownEscapes(text?: string): string {

  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/(\d+)\\\./g, '$1.')
    .replace(/\\([()[\]\-*+~])/g, '$1');
}

