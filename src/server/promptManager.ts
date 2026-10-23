import fs from 'node:fs';
import {
  SYSTEM_PROMPT_PATH,
  MAIN_ANSWER_PROMPT_PATH,
  QUERY_ANALYSIS_PROMPT_PATH,
  RERANK_PROMPT_PATH,
  DRILLDOWN_PROMPT_PATH,
  STEP_INTRO_PROMPT_PATH,
  STEP_BODY_PROMPT_PATH,
  STEP_CONCLUSION_PROMPT_PATH,
  MAX_LLM_CONTEXT_ARTICLES,
} from '../config/constants.js';

export { MAX_LLM_CONTEXT_ARTICLES };

interface PromptCacheEntry {
  content: string;
  mtimeMs: number;
}

const promptCache = new Map<string, PromptCacheEntry>();

/**
 * 프롬프트 마크다운 파일을 로드하고 mtime을 추적하여 실시간 핫 리로드(Hot-reload)를 지원합니다.
 * 파일 부재 또는 빈 파일 시 Fail-Fast 에러를 발생시켜 SSOT 파일 무결성을 강제합니다.
 */
function loadPromptFile(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[PromptManager] 필수 프롬프트 파일을 찾을 수 없습니다: ${filePath}`);
  }

  const stats = fs.statSync(filePath);
  const cached = promptCache.get(filePath);
  if (cached && cached.mtimeMs === stats.mtimeMs) {
    return cached.content;
  }

  const rawContent = fs.readFileSync(filePath, 'utf-8').trim();
  if (!rawContent) {
    throw new Error(`[PromptManager] 프롬프트 파일 내용이 비어 있습니다: ${filePath}`);
  }

  promptCache.set(filePath, {
    content: rawContent,
    mtimeMs: stats.mtimeMs,
  });
  return rawContent;
}

/**
 * 템플릿 내 {{variable}} 플레이스홀더를 전달된 값으로 치환합니다.
 */
function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => variables[key] ?? '');
}

/**
 * 메인 시스템 프롬프트를 data/prompts/system_prompt.md 파일에서 실시간 로드합니다.
 */
export function getSystemPrompt(customPath: string = SYSTEM_PROMPT_PATH): string {
  return loadPromptFile(customPath);
}

export interface MinimalScoredChunk {
  chunk: {
    lawName: string;
    articleNumber: string;
    articleTitle?: string;
    content: string;
  };
}

/**
 * 조문 목록을 RAG 프롬프트용 텍스트로 표준화 포맷팅합니다 (SSOT).
 */
export function formatReferenceArticles(
  scoredChunks: MinimalScoredChunk[],
  maxArticles: number = MAX_LLM_CONTEXT_ARTICLES
): string {
  return scoredChunks
    .slice(0, maxArticles)
    .map((sc, idx) => {
      const c = sc.chunk;
      return `[참조 ${idx + 1}] ${c.lawName} ${c.articleNumber} (${c.articleTitle || '본조'})\n${c.content}`;
    })
    .join('\n\n');
}

/**
 * 질문과 조문 목록을 결합하여 RAG 유저 메시지 본문을 구성합니다.
 */
export function buildRagUserContent(query: string, scoredChunks: MinimalScoredChunk[]): string {
  const contextArticles = formatReferenceArticles(scoredChunks);
  return `[참조 법령 조문]\n${contextArticles}\n\n[사용자 질문]\n${query}`;
}

/**
 * 본 답변(서론 -> 본론 -> 결론) 생성을 위한 통합 프롬프트
 * data/prompts/main_answer.md 파일 기반 핫 리로드
 */
export function getMainAnswerPrompt(query: string, scoredChunks: MinimalScoredChunk[]): string {
  const contextArticles = formatReferenceArticles(scoredChunks);
  const template = loadPromptFile(MAIN_ANSWER_PROMPT_PATH);
  return renderTemplate(template, {
    context: contextArticles,
    query: query.trim(),
  });
}

/**
 * 1단계: 서론(핵심 요약) 생성 프롬프트 (하위 호환)
 * data/prompts/step_intro.md 파일 기반 핫 리로드
 */
export function getIntroStepPrompt(query: string, scoredChunks: MinimalScoredChunk[]): string {
  const contextArticles = formatReferenceArticles(scoredChunks);
  const template = loadPromptFile(STEP_INTRO_PROMPT_PATH);
  return renderTemplate(template, {
    context: contextArticles,
    query: query.trim(),
  });
}

/**
 * 2단계: 본론(법적 기준 및 요건) 보강 프롬프트 (세션 이어쓰기)
 * data/prompts/step_body.md 파일 기반 핫 리로드
 */
export function getBodyStepPrompt(): string {
  return loadPromptFile(STEP_BODY_PROMPT_PATH);
}

/**
 * 3단계: 결론(유의사항) 보강 프롬프트 (세션 이어쓰기)
 * data/prompts/step_conclusion.md 파일 기반 핫 리로드
 */
export function getConclusionStepPrompt(): string {
  return loadPromptFile(STEP_CONCLUSION_PROMPT_PATH);
}

/**
 * 4단계: 추천 후속 질문(드릴다운) 생성 프롬프트
 * data/prompts/drilldown.md 파일 기반 핫 리로드
 */
export function getDrilldownStepPrompt(query: string, lawSummary: string): string {
  const template = loadPromptFile(DRILLDOWN_PROMPT_PATH);
  return renderTemplate(template, {
    query: query.trim(),
    lawSummary: lawSummary.trim(),
  });
}

/**
 * 온디바이스 소형 모델이 프롬프트 지침/서식을 베껴 쓰거나 반복 복창한 경우 이를 정제하는 방어 함수
 */
export function sanitizeLlmOutput(text: string): string {
  if (!text) return '';

  let cleaned = text;
  cleaned = cleaned.replace(/\[지침:[^\]]*\]/gi, '');
  cleaned = cleaned.replace(/(?:^|\n)\s*\d*\.?\s*['"‘“]?###[^'"’”\n]+['"’”]?\s*(?:으로 시작하세요|섹션에는|형식으로 작성하세요)[^\n]*/gi, '');
  cleaned = cleaned.replace(/['"‘“]?###\s*[\p{Emoji}\u2000-\u32FF\w\s()]+['"’”]?\s*섹션에는[^\n]*/gu, '');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}

/**
 * 4단계 순차 파이프라인 프롬프트 (하위 호환)
 */
export function getStepPrompts(
  query: string,
  scoredChunks: MinimalScoredChunk[],
  context?: { lawSummary?: string }
) {
  return {
    introPrompt: getIntroStepPrompt(query, scoredChunks),
    bodyPrompt: getBodyStepPrompt(),
    conclusionPrompt: getConclusionStepPrompt(),
    drilldownPrompt: getDrilldownStepPrompt(query, context?.lawSummary || ''),
  };
}

/**
 * 관련 조문 부재 시 안내 메시지 (SSOT)
 */
export function getNoRelevantLawMessage(query: string): string {
  return `질의하신 내용("${query}")과 관련된 법령 조문을 데이터베이스에서 찾을 수 없습니다.\n\n본 시스템은 등록된 대한민국 법령에만 기반하여 답변하는 법률 RAG 어시스턴트입니다. 법령 조문 및 법률 관련 질문을 구체적으로 입력해 주시기 바랍니다.`;
}

/**
 * 대한민국 법령/제도와 무관한 비법률 질문 입력 시 가드레일 안내 메시지 (SSOT)
 */
export function getNonLegalQueryMessage(query: string): string {
  return `질문하신 내용("${query}")은 대한민국 법령 및 제도와 직접적인 관련이 없는 분야입니다.\n\n본 시스템은 **대한민국 현행 법령 검색 및 법률 검토 전용 어시스턴트**입니다. 법률, 조례, 시행령, 권리구제 절차 등 법 관련 질문을 입력해 주시면 정확한 법조문을 바탕으로 검토해 드리겠습니다.`;
}

/**
 * LLM 비활성화 또는 오류 시 제공하는 표준 구조화 법률 요약 텍스트 (SSOT)
 */
export function getFallbackSummary(query: string, scoredChunks: MinimalScoredChunk[]): string {
  if (scoredChunks.length === 0) {
    return getNoRelevantLawMessage(query);
  }

  const topChunk = scoredChunks[0].chunk;
  const maxDisplay = MAX_LLM_CONTEXT_ARTICLES;
  const displayChunks = scoredChunks.slice(0, maxDisplay);

  const relatedList = displayChunks.map((c) => `${c.chunk.lawName} ${c.chunk.articleNumber}`).join(', ');
  const remainingCount = scoredChunks.length - displayChunks.length;
  const relatedText = remainingCount > 0 ? `${relatedList} 외 ${remainingCount.toLocaleString()}건` : relatedList;

  return `질의하신 내용과 가장 밀접한 규정은 **${topChunk.lawName} ${topChunk.articleNumber}**(${topChunk.articleTitle || '본조'})입니다.\n\n` +
    `📌 **관련 조문 내용**:\n${topChunk.content.trim()}\n\n` +
    `*(현재 온디바이스 LLM이 비활성화(요약 모드)되어 있거나 처리 중이므로 핵심 검색 법조문을 직접 제공합니다. 상세 조문 목록은 근거 법조문 카드를 참고하세요.)*\n\n` +
    `🔗 **주요 참조 법령**: ${relatedText}`;
}

/**
 * 질의 분석 및 키워드 추출 시스템 프롬프트 (SSOT)
 */
export const QUERY_ANALYSIS_SYSTEM_PROMPT = '오직 법률 검색 키워드 또는 "무관"만 출력하세요.';

/**
 * 사용자 질의가 대한민국 법령과 관련 있는지 판별하고 핵심 검색어를 추출하기 위한 프롬프트 (SSOT)
 * data/prompts/query_analysis.md 파일 기반 핫 리로드
 */
export function getQueryAnalysisPrompt(query: string): string {
  const template = loadPromptFile(QUERY_ANALYSIS_PROMPT_PATH);
  return renderTemplate(template, {
    query: (query || '').trim(),
  });
}

/**
 * 지능형 리랭킹 시스템 프롬프트 (SSOT)
 */
export const RERANK_SYSTEM_PROMPT = '오직 후보 번호만 쉼표로 출력하세요.';

/**
 * 질의 문맥 적합도 지능형 리랭킹 프롬프트 (SSOT)
 * data/prompts/rerank.md 파일 기반 핫 리로드
 */
export function getRerankPrompt(query: string, candidatesText: string): string {
  const template = loadPromptFile(RERANK_PROMPT_PATH);
  return renderTemplate(template, {
    query: (query || '').trim(),
    candidates: candidatesText,
  });
}

/**
 * 추천 후속 질문 시스템 프롬프트 (SSOT)
 */
export const DRILLDOWN_SYSTEM_PROMPT =
  '당신은 대한민국 법률 상담 후속 질문 추천 AI입니다. 질문 외의 설명이나 사족 없이 반드시 "### 🔍 4. 추천 후속 질문"으로 시작하여 3가지 질문만 번호 목록으로 답변하세요.';
