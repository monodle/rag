import { ScoredArticleChunk } from '../indexer/qdrantService.js';

export interface StatuteGroupSummary {
  lawName: string;
  maxScore: number;
  matchCount: number;
  combinedScore: number;
  topArticles: Array<{
    articleNumber: string;
    articleTitle?: string;
    score: number;
  }>;
}

export interface LawAggregationOptions {
  /**
   * 선별할 대표 법령의 최대 개수 (기본값: 3)
   */
  maxLaws?: number;
  /**
   * 법령당 추출할 최상위 조문의 최대 개수 (기본값: 2)
   */
  maxPerLaw?: number;
  /**
   * 총 선별할 후보 조문의 목표 개수 (기본값: 6)
   */
  targetCandidateCount?: number;
  /**
   * 조문 출현 빈도 가중치 계수 (기본값: 0.025)
   * Score = maxScore + alpha * log2(1 + matchCount)
   */
  alpha?: number;
}

export interface LawAggregationResult {
  /**
   * Reranker LLM에 전달할 대표 조문 목록 (법령 다양성 및 빈도 가중치 반영)
   */
  selectedChunks: ScoredArticleChunk[];
  /**
   * 선별되지 않은 나머지 조문 목록 (원본 유사도 순서 유지)
   */
  remainderChunks: ScoredArticleChunk[];
  /**
   * 법령별 집계 요약 정보 (로깅 및 모니터링용)
   */
  summaries: StatuteGroupSummary[];
}

/**
 * 법령명에서 시행령, 시행규칙, 규칙 등의 접미사를 정규화하여 모법(Root Law)명을 도출합니다.
 * 예: "개인정보 보호법 시행령" ➔ "개인정보 보호법"
 *     "공동주택관리법 시행규칙" ➔ "공동주택관리법"
 *     "영유아보육법" ➔ "영유아보육법"
 */
export function getRootLawName(lawName: string): string {
  const trimmed = (lawName || '').trim();
  const normalized = trimmed.replace(
    /\s+(시행령|시행규칙|운영규정|사건사무규칙|수사규칙|관리규칙|규정|규칙)$/i,
    ''
  ).trim();
  return normalized || trimmed;
}

/**
 * 검색된 후보 조문들을 모법(Root Law) 체계 단위로 Group By 집계하고,
 * 특정 단발성 조문(Outlier)의 과대 평가를 방지하면서 쟁점 관련 조문이 다수 포진한
 * 대표 법령의 핵심 조문들을 균형 있게 선별합니다.
 */
export function aggregateAndSelectCandidates(
  candidateChunks: ScoredArticleChunk[],
  options: LawAggregationOptions = {}
): LawAggregationResult {
  if (!candidateChunks || candidateChunks.length === 0) {
    return { selectedChunks: [], remainderChunks: [], summaries: [] };
  }

  if (candidateChunks.length <= 3) {
    return {
      selectedChunks: [...candidateChunks],
      remainderChunks: [],
      summaries: [],
    };
  }

  const maxLaws = options.maxLaws ?? 3;
  const maxPerLaw = options.maxPerLaw ?? 2;
  const targetCandidateCount = options.targetCandidateCount ?? 6;
  const alpha = options.alpha ?? 0.025;

  // 1. 모법(Root Law) 기준 Group By 구성
  const lawGroupMap = new Map<string, ScoredArticleChunk[]>();
  for (const item of candidateChunks) {
    const rawLawName = item.chunk.lawName?.trim() || '기타';
    const rootName = getRootLawName(rawLawName);
    const list = lawGroupMap.get(rootName) || [];
    list.push(item);
    lawGroupMap.set(rootName, list);
  }

  // 2. 법령별 그룹 스코어링 및 정렬
  const groupSummaries: Array<{
    lawName: string;
    maxScore: number;
    matchCount: number;
    combinedScore: number;
    chunks: ScoredArticleChunk[];
  }> = [];

  for (const [rootLawName, chunks] of lawGroupMap.entries()) {
    // 그룹 내 조문 정렬: 점수 높은 순 (유사 점수대일 경우 모법(법률) 우선)
    chunks.sort((a, b) => {
      const diff = b.score - a.score;
      if (Math.abs(diff) > 0.005) {
        return diff;
      }
      // 유사 점수대(0.5% 미만 차이)일 때 모법(법률) 우선
      const isALaw = !/(시행령|시행규칙|규칙)/.test(a.chunk.lawName);
      const isBLaw = !/(시행령|시행규칙|규칙)/.test(b.chunk.lawName);
      if (isALaw && !isBLaw) return -1;
      if (!isALaw && isBLaw) return 1;
      return diff;
    });

    const maxScore = chunks[0]?.score ?? 0;
    const matchCount = chunks.length;
    // log2(1 + count): count가 1이면 0, 3이면 1.0, 7이면 2.0, 15면 3.0 증가
    const boost = alpha * Math.log2(1 + matchCount);
    const combinedScore = maxScore + boost;

    groupSummaries.push({
      lawName: rootLawName,
      maxScore,
      matchCount,
      combinedScore,
      chunks,
    });
  }



  // 종합 점수 기준 내림차순 정렬
  groupSummaries.sort((a, b) => b.combinedScore - a.combinedScore);

  // 3. 상위 대표 법령 선별 및 대표 조문 추출
  const selectedChunks: ScoredArticleChunk[] = [];
  const selectedChunkIds = new Set<string>();

  // 1차 추출: 상위 N개 법령에서 법령당 maxPerLaw개씩 추출
  const topLawGroups = groupSummaries.slice(0, maxLaws);
  for (const group of topLawGroups) {
    const picks = group.chunks.slice(0, maxPerLaw);
    for (const chunkItem of picks) {
      if (!selectedChunkIds.has(chunkItem.chunk.id)) {
        selectedChunkIds.add(chunkItem.chunk.id);
        selectedChunks.push(chunkItem);
      }
    }
  }

  // 2차 추출: 만약 targetCandidateCount에 미달하면, 상위 법령의 다음 순위 조문 또는 차순위 법령 조문으로 보충
  if (selectedChunks.length < targetCandidateCount) {
    for (const group of groupSummaries) {
      if (selectedChunks.length >= targetCandidateCount) {
        break;
      }
      for (const chunkItem of group.chunks) {
        if (!selectedChunkIds.has(chunkItem.chunk.id)) {
          selectedChunkIds.add(chunkItem.chunk.id);
          selectedChunks.push(chunkItem);
          if (selectedChunks.length >= targetCandidateCount) {
            break;
          }
        }
      }
    }
  }

  // 4. 선별되지 않은 나머지 조문 목록 구성 (원래 candidateChunks 순서 유지)
  const remainderChunks = candidateChunks.filter(
    (c) => !selectedChunkIds.has(c.chunk.id)
  );

  // 5. 로깅용 요약 DTO 구성
  const summaries: StatuteGroupSummary[] = groupSummaries.map((g) => ({
    lawName: g.lawName,
    maxScore: g.maxScore,
    matchCount: g.matchCount,
    combinedScore: g.combinedScore,
    topArticles: g.chunks.slice(0, 3).map((c) => ({
      articleNumber: c.chunk.articleNumber,
      articleTitle: c.chunk.articleTitle,
      score: c.score,
    })),
  }));

  return {
    selectedChunks,
    remainderChunks,
    summaries,
  };
}
