import { ScoredArticleChunk } from './qdrantService.js';
import { LEGAL_RELEVANCE_THRESHOLD, MAX_REFERENCES } from '../config/constants.js';
import { ARTICLE_HEADER_LINE_REGEX } from '../types/lawRegex.js';


/**
 * 개정으로 인해 본문이 '삭제' 처리된 실효 조문인지 판별합니다 (SSOT).
 * 예: "삭제", "삭제 <2023.3.21>", "삭제 <2020.8.5>\n\n# 제6편...", "[본조삭제]" 등
 */
export function isDeletedArticle(chunk: { content: string; articleTitle?: string }): boolean {
  if (!chunk || !chunk.content) {
    return true;
  }

  // 1. 헤더 [경로] 및 마크다운 장/편/절 헤더(# ...), 빈 줄 필터링
  const lines = chunk.content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (line.startsWith('[') && line.endsWith(']')) return false; // [경로]
      if (line.startsWith('#')) return false; // # 제6편 ... 등 후속 마크다운 헤더
      return true;
    });

  if (lines.length === 0) {
    return true;
  }

  // 2. 순수 조문 번호 줄 필터링 (예: "제10조", "제10조(삭제)", "제10조의2(구류)")
  const bodyLines = lines.filter((line) => {
    return !ARTICLE_HEADER_LINE_REGEX.test(line);
  });


  // 조문 번호 외에 본문 내용이 없는 경우
  if (bodyLines.length === 0) {
    return true;
  }

  // 3. 본문 텍스트 결합
  const fullBody = bodyLines.join(' ').trim();

  // 3-1. 본문이 '삭제', '삭제 <개정일자>' 형태인 경우
  if (/^삭제(?:\s*<[^>]+>)?\.?$/.test(fullBody)) {
    return true;
  }

  // 3-2. 날짜, 괄호, 특수문자, 공백을 제거한 순수 텍스트가 '삭제' 단어로만 구성된 경우
  const stripped = fullBody.replace(/<[^>]+>|\[[^\]]+\]|\([^\)]*\)|\s+|\.|\,/g, '');
  if (stripped === '삭제' || stripped === '전문삭제' || stripped === '본조삭제') {
    return true;
  }

  // 3-3. 본문이 40자 이하의 매우 짧은 길이이면서 '삭제'로 시작하는 경우 (예: "삭제 <2023.3.21.>")
  if (fullBody.startsWith('삭제') && fullBody.length <= 40) {
    return true;
  }

  return false;
}

/**
 * 벡터 검색 결과 중 실효/삭제 조문을 제외하고,
 * 법령 관련도 및 유사도 비율에 따라 최적의 유효 조문을 선별합니다 (SSOT).
 * 
 * @param rawChunks Qdrant 등에서 검색된 원본 유사 조문 목록
 * @param limit 최대 반환할 유효 조문 수 (기본값: MAX_REFERENCES)
 * @returns 실효 조문이 배제되고 관련성 검증을 통과한 유효 조문 목록
 */
export function filterRelevantArticles(
  rawChunks: ScoredArticleChunk[],
  limit: number = MAX_REFERENCES
): ScoredArticleChunk[] {
  if (!rawChunks || rawChunks.length === 0) {
    return [];
  }

  // 1. 개정으로 삭제된 실효 조문 선제적 제외
  const validChunks = rawChunks.filter((c) => !isDeletedArticle(c.chunk));
  if (validChunks.length === 0) {
    return [];
  }

  const topScore = validChunks[0]?.score ?? 0;
  // 최상위 결과가 법령 임계치 미달 시 무관한 질의로 판단하여 0건 반환 (Early Return)
  if (topScore < LEGAL_RELEVANCE_THRESHOLD) {
    return [];
  }

  // 최상위 점수의 88% 이상이면서 법령 임계치를 넘는 유효 조문만 채택 (최대 limit)
  return validChunks
    .filter((c) => c.score >= LEGAL_RELEVANCE_THRESHOLD && c.score >= topScore * 0.88)
    .slice(0, limit);
}
