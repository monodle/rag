import { ScoredArticleChunk } from '../indexer/qdrantService.js';
import { ReferenceArticle } from '../types/law.js';
import { extractArticleNumbers } from '../types/lawRegex.js';
import { MAX_REFERENCES, MIN_GUARANTEED_REFS, MIN_REFERENCE_SCORE_THRESHOLD } from '../config/constants.js';

export { extractArticleNumbers };

/**
 * 하위 호환성을 위한 참조 타입 별칭 (SSOT: ReferenceArticle)
 */
export type RefinedReference = ReferenceArticle;

/**
 * 한국어 조사 및 일반 불용어 세트
 */
const KOREAN_STOPWORDS = new Set([
  '이', '그', '저', '것', '수', '등', '및', '또는', '관련', '대한', '대해', '경우',
  '따라', '의거', '규정', '따른', '의한', '위한', '통해', '하여', '하고', '하며',
  '있습니다', '합니다', '됩니다', '입니다', '할', '수', '있는', '없는', '있으며',
  '경우에는', '관하여', '법률', '법령', '기준', '사항', '내용', '따르면', '대하여'
]);

/**
 * 텍스트에서 핵심 법률 키워드를 추출합니다 (2글자 이상, 불용어 제외).
 */
export function extractKeywords(text: string): string[] {
  if (!text) return [];

  // 특수문자 제거 후 공백 단위 분리
  const cleaned = text.replace(/[`~!@#$%^&*()_|+\-=?;:'",.<>\{\}\[\]\\\/]/gi, ' ');
  const tokens = cleaned.split(/\s+/);

  const keywords: string[] = [];
  for (const token of tokens) {
    const word = token.trim();
    if (word.length >= 2 && !KOREAN_STOPWORDS.has(word)) {
      keywords.push(word);
    }
  }

  return Array.from(new Set(keywords));
}

export { MIN_GUARANTEED_REFS };

/**
 * 1차 검색된 후보 조문 목록 중, 실제 생성된 답변 텍스트(메인 키워드 및 명시적 조문 인용)를
 * 바탕으로 가장 관련성이 높은 근거 법조문을 재평가(Re-ranking) 및 엄격히 선별합니다 (SSOT).
 * 코사인 유사도 79%(MIN_REFERENCE_SCORE_THRESHOLD) 이상인 유효 조문만 근거로 노출합니다.
 * 
 * @param answer LLM이 생성한 최종 답변 텍스트
 * @param candidateChunks 1차 벡터 검색에서 추출된 후보 조문 목록
 * @param limit 최종 반환할 근거 조문 최대 상한 (기본값: MAX_REFERENCES)
 */
export function refineReferencesByAnswer(
  answer: string,
  candidateChunks: ScoredArticleChunk[],
  limit: number = MAX_REFERENCES
): ReferenceArticle[] {

  if (!candidateChunks || candidateChunks.length === 0) {
    return [];
  }

  // 0. 유사도 점수가 74%(MIN_REFERENCE_SCORE_THRESHOLD) 이상인 유효 후보군 선별
  let eligibleChunks = candidateChunks.filter((sc) => sc.score >= MIN_REFERENCE_SCORE_THRESHOLD);
  // 방어 로직: 임계치 이상 항목이 없더라도 1차 벡터 검색 최상위 조문과의 유사도 격차가 근소한 경우 최소 후보 보장
  if (eligibleChunks.length === 0 && candidateChunks.length > 0) {
    const topScore = candidateChunks[0].score;
    eligibleChunks = candidateChunks
      .filter((sc) => sc.score >= Math.max(0.65, topScore - 0.05))
      .slice(0, MIN_GUARANTEED_REFS);
  }
  if (eligibleChunks.length === 0) {
    return [];
  }

  // 1. 답변 텍스트가 비어 있는 경우 최상위 핵심 조문 최소 개수만 반환
  if (!answer || !answer.trim()) {
    const fallbackCount = Math.min(eligibleChunks.length, Math.max(MIN_GUARANTEED_REFS, Math.min(limit, 5)));
    return eligibleChunks.slice(0, fallbackCount).map((sc) => ({
      id: sc.chunk.id,
      lawName: sc.chunk.lawName,
      lawType: sc.chunk.lawType,
      chapterPath: sc.chunk.chapterPath,
      articleNumber: sc.chunk.articleNumber,
      articleTitle: sc.chunk.articleTitle,
      content: sc.chunk.content,
      score: sc.score,
    }));
  }

  // 2. 답변에서 언급된 조문 번호 및 핵심 키워드 추출
  const citedArticleNumbers = extractArticleNumbers(answer);
  const answerKeywords = extractKeywords(answer);

  // 3. 후보 조문 재평가 (79% 이상 적격 조문 대상)
  const evaluated = eligibleChunks.map((sc) => {
    const chunk = sc.chunk;
    const reasons: string[] = [];
    let bonusScore = 0;

    // 조문 번호 정규화 (예: "제50조", "제50조의2")
    const rawArtNum = chunk.articleNumber ? chunk.articleNumber.replace(/\s+/g, '') : '';
    const isDirectArticleCited = Boolean(rawArtNum && citedArticleNumbers.has(rawArtNum));

    // 법령명 언급 여부 (예: "근로기준법")
    const isLawNameCited = Boolean(chunk.lawName && answer.includes(chunk.lawName));

    // 3-1. 법령명 + 조문 번호가 답변에 동시 명시 인용된 경우 (최고 가산점)
    if (isDirectArticleCited && isLawNameCited) {
      bonusScore += 1.5;
      reasons.push(`답변 본문에서 "${chunk.lawName} ${chunk.articleNumber}" 직접 인용`);
    } else if (isDirectArticleCited) {
      bonusScore += 1.0;
      reasons.push(`답변 본문에서 "${chunk.articleNumber}" 인용`);
    } else if (isLawNameCited) {
      // 법령명만 언급된 경우: 소속 조문 전체가 오탐되지 않도록 약간의 가산점만 부여
      bonusScore += 0.15;
    }

    // 3-2. 조문 제목 키워드 일치도
    let hasTitleMatch = false;
    if (chunk.articleTitle) {
      const titleKeywords = extractKeywords(chunk.articleTitle);
      const titleMatches = titleKeywords.filter((tk) => answer.includes(tk));
      if (titleMatches.length > 0) {
        hasTitleMatch = true;
        bonusScore += Math.min(0.5, titleMatches.length * 0.2);
        reasons.push(`조문 제목 키워드 일치 (${titleMatches.slice(0, 2).join(', ')})`);
      }
    }

    // 3-3. 조문 본문과 답변 키워드 오버랩 계산
    let keywordOverlapCount = 0;
    for (const kw of answerKeywords) {
      if (chunk.content.includes(kw)) {
        keywordOverlapCount++;
      }
    }

    const keywordRatio = answerKeywords.length > 0 ? keywordOverlapCount / answerKeywords.length : 0;
    if (keywordOverlapCount >= 3) {
      bonusScore += Math.min(0.4, keywordRatio * 0.6);
      if (isLawNameCited || keywordOverlapCount >= 4) {
        reasons.push(`답변 주요 키워드 ${keywordOverlapCount}개 일치`);
      }
    }

    // 종합 정제 점수 = 기본 벡터 점수(40%) + 보너스 점수(60%)
    const finalScore = Number((sc.score * 0.4 + bonusScore * 0.6).toFixed(4));

    // 답변과의 유의미한 실제 연관성(Relevant) 여부 판정:
    // 1) 조문 번호가 직접 인용되었거나,
    // 2) 조문 제목 키워드가 매칭되었고 (소속 법령이 언급되었거나 키워드 오버랩 2개 이상),
    // 3) 소속 법령이 언급되고 본문 키워드가 3개 이상 일치하거나,
    // 4) 답변 본문 키워드가 5개 이상 집중 일치하는 경우
    const isMeaningfulMatch = Boolean(
      isDirectArticleCited ||
      (hasTitleMatch && (isLawNameCited || keywordOverlapCount >= 2)) ||
      (isLawNameCited && keywordOverlapCount >= 3) ||
      keywordOverlapCount >= 5
    );

    return {
      chunk,
      originalScore: sc.score,
      bonusScore,
      finalScore,
      isDirectlyCited: isDirectArticleCited,
      isMeaningfulMatch,
      reasons,
    };
  });

  // 4. 정렬: 직접 인용 우선 -> 유의미 매칭 우선 -> 종합 정제 점수 내림차순
  evaluated.sort((a, b) => {
    if (a.isDirectlyCited !== b.isDirectlyCited) {
      return a.isDirectlyCited ? -1 : 1;
    }
    if (a.isMeaningfulMatch !== b.isMeaningfulMatch) {
      return a.isMeaningfulMatch ? -1 : 1;
    }
    return b.finalScore - a.finalScore;
  });

  // 5. 유의미한 연관성이 검증된 조문만 선별
  const meaningfulList = evaluated.filter((item) => item.isMeaningfulMatch);

  // 최소 보장 개수 계산 (상한 limit 및 후보군 크기 범위 내)
  const minGuaranteed = Math.min(limit, Math.min(MIN_GUARANTEED_REFS, evaluated.length));

  // 유의미한 조문이 최소 보장치보다 적은 경우, 상위 점수 순으로 보충 (단순 서술형 답변 대응)
  const selectedItems: typeof evaluated = [...meaningfulList];
  if (selectedItems.length < minGuaranteed) {
    for (const item of evaluated) {
      if (selectedItems.length >= minGuaranteed) break;
      if (!selectedItems.some((s) => s.chunk.id === item.chunk.id)) {
        selectedItems.push(item);
      }
    }
  }

  // 최종 limit 상한 적용 (사용자 요청 한도 준수) 및 79% 이상 최종 방어
  const finalSelected = selectedItems
    .slice(0, limit)
    .filter((item) => item.originalScore >= MIN_REFERENCE_SCORE_THRESHOLD);

  return finalSelected.map((item) => ({
    id: item.chunk.id,
    lawName: item.chunk.lawName,
    lawType: item.chunk.lawType,
    chapterPath: item.chunk.chapterPath,
    articleNumber: item.chunk.articleNumber,
    articleTitle: item.chunk.articleTitle,
    content: item.chunk.content,
    score: item.originalScore, // 사용자에게 보여줄 신뢰도 표시는 원본 벡터 코사인 유사도 유지
    matchReasons: item.reasons.length > 0 ? item.reasons : undefined,
  }));
}
