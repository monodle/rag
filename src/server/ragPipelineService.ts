import { EmbeddingService } from '../indexer/embeddingService.js';
import { getVectorStoreService, IVectorStoreService } from '../indexer/vectorStore.js';
import { LlmManager } from './llmManager.js';
import { filterRelevantArticles } from '../indexer/lawArticleFilter.js';
import { refineReferencesByAnswer } from './postArticleRefiner.js';
import { getNoRelevantLawMessage, getNonLegalQueryMessage } from './promptManager.js';
import { MAX_REFERENCES, VECTOR_CANDIDATE_LIMIT } from '../config/constants.js';
import { DEFAULT_LAW_AGGREGATION_CONFIG } from './lawAggregator.js';
import { ReferenceArticle, ChatResponseDto, ScoredArticleChunk } from '../types/law.js';
import { QueryLogger, QueryLogSession } from './queryLogger.js';

export interface SearchArticlesResult {
  queryVector: number[];
  rawChunks: ScoredArticleChunk[];
  scoredChunks: ScoredArticleChunk[];
  isLegalQuery: boolean;
}

export interface ChatExecutionResult extends ChatResponseDto {
  scoredChunks: ScoredArticleChunk[];
  isLegallyRelevant: boolean;
}

export interface ExecuteChatOptions {
  query: string;
  limit?: number;
  onToken?: (token: string) => void;
  onStatus?: (status: string) => void;
}

/**
 * 대한민국 법령 RAG 전체 질의응답 및 검색 파이프라인을 총괄하는 오케스트레이터 (Single Source of Truth)
 */
export class RagPipelineService {
  private static instance: RagPipelineService | null = null;
  private embeddingService = EmbeddingService.getInstance();
  private vectorStore: IVectorStoreService = getVectorStoreService();
  private llmManager = LlmManager.getInstance();

  private constructor() {}

  public static getInstance(): RagPipelineService {
    if (!RagPipelineService.instance) {
      RagPipelineService.instance = new RagPipelineService();
    }
    return RagPipelineService.instance;
  }

  /**
   * 벡터 검색 시 충분한 유효 조문을 확보하기 위한 후보군 추출 개수를 계산합니다 (SSOT).
   */
  public calcCandidateLimit(limit: number): number {
    return Math.max(limit * 5, VECTOR_CANDIDATE_LIMIT);
  }

  /**
   * 사용자 쿼리를 임베딩하고 벡터 검색 및 실효 조문 필터링을 수행합니다 (SSOT).
   */
  public async searchArticles(
    query: string,
    limit: number = MAX_REFERENCES,
    lawName?: string,
    onStatus?: (status: string) => void,
    logSession?: QueryLogSession
  ): Promise<SearchArticlesResult> {
    const trimmed = query.trim();
    if (!trimmed) {
      return { queryVector: [], rawChunks: [], scoredChunks: [], isLegalQuery: true };
    }

    const candidateLimit = this.calcCandidateLimit(limit);

    // 1. 온디바이스 모델을 통한 대한민국 법령 관련성 사전 판별 및 검색 키워드 추출 (Single-Pass Query Analysis)
    onStatus?.('🔍 사용자 질문 분석 및 법률 검색어 추출 중...');
    let searchTargetQuery = trimmed;
    let isLegalQuery = true;
    let analysisRawOutput = '';
    let analysisPrompt = '';
    let analysisSystemPrompt = '';
    let extractedKeywords: string[] = [];

    try {
      const analysis = await this.llmManager.analyzeQuery(trimmed, logSession);
      isLegalQuery = analysis.isLegalQuery;
      analysisRawOutput = analysis.rawResponse || '';
      analysisPrompt = analysis.prompt || '';
      analysisSystemPrompt = analysis.systemPrompt || '';

      if (!isLegalQuery) {
        console.log('\n=================== [1단계: 사용자 질의 분석 및 가드레일] ===================');
        console.log(`[원본 질문]: "${trimmed}"`);
        console.log(`[판정]: 대한민국 법령 무관 질문 (isLegalQuery = false) -> Qdrant 검색 생략`);
        console.log('===============================================================================\n');
        onStatus?.('⚠️ 대한민국 법령과 무관한 질의로 판별되었습니다.');

        logSession?.recordQueryAnalysis({
          systemPrompt: analysisSystemPrompt,
          prompt: analysisPrompt,
          rawOutput: analysisRawOutput,
          isLegalQuery: false,
          keywords: [],
          searchTargetQuery: trimmed,
        });

        return {
          queryVector: [],
          rawChunks: [],
          scoredChunks: [],
          isLegalQuery: false,
        };
      }

      extractedKeywords = analysis.keywords;
      if (extractedKeywords.length > 0) {
        // 원본 질문의 핵심 의도가 누락되지 않도록 원본 질의 + 추출 키워드 유기적 결합 (SSOT)
        const combined = Array.from(new Set([trimmed, ...extractedKeywords])).join(' ');
        searchTargetQuery = combined;
        onStatus?.(`💡 핵심 검색어 추출: ${extractedKeywords.join(', ')}`);
        console.log('\n=================== [1단계: 사용자 질의 분석 및 키워드 추출] ===================');
        console.log(`[원본 질문]: "${trimmed}"`);
        console.log(`[LLM 추출 키워드]: [${extractedKeywords.join(', ')}]`);
        console.log(`[최종 Qdrant 임베딩 쿼리]: "${searchTargetQuery}"`);
        console.log('===============================================================================\n');
      } else {
        onStatus?.('💡 원본 질문 기반 검색 진행');
      }
    } catch {
      onStatus?.('💡 원본 질문 기반 검색 진행');
      searchTargetQuery = trimmed;
    }

    logSession?.recordQueryAnalysis({
      systemPrompt: analysisSystemPrompt,
      prompt: analysisPrompt,
      rawOutput: analysisRawOutput,
      isLegalQuery: true,
      keywords: extractedKeywords,
      searchTargetQuery,
    });

    // 2. 벡터 유사도 검색 및 실효 조문 선별
    onStatus?.('📚 벡터 검색 및 유효 조문 선별 중...');
    const queryVector = await this.embeddingService.embedQuery(searchTargetQuery);
    const rawChunks = await this.vectorStore.searchSimilarArticles(queryVector, {
      limit: candidateLimit,
      lawName,
    });

    console.log('\n=================== [2단계: 벡터 검색 결과 (상위 5건)] ===================');
    rawChunks.slice(0, 5).forEach((c, idx) => {
      console.log(
        `  ${idx + 1}. [${c.chunk.lawName}] ${c.chunk.articleNumber} (${c.chunk.articleTitle || '본조'}) - 유사도: ${(c.score * 100).toFixed(2)}% (코사인: ${c.score.toFixed(4)})`
      );
    });
    console.log('=================================================================================\n');

    const filteredChunks = filterRelevantArticles(rawChunks, candidateLimit);

    logSession?.recordVectorSearch({
      searchTargetQuery,
      candidateLimit,
      rawChunksCount: rawChunks.length,
      topRawChunks: rawChunks.slice(0, 5).map((c) => ({
        lawName: c.chunk.lawName,
        articleNumber: c.chunk.articleNumber,
        articleTitle: c.chunk.articleTitle,
        score: c.score,
        snippet: c.chunk.content.slice(0, 150),
      })),
      filteredCount: filteredChunks.length,
    });

    // 2.5. 온디바이스 LLM 기반 질의 문맥 적합도 지능형 리랭킹 (Zero-Hardcoding Reranking)
    onStatus?.('⚖️ 질문 문맥 적합도 지능형 검토 중...');
    const scoredChunks = await this.llmManager.rerankArticlesByRelevance(
      trimmed,
      filteredChunks,
      DEFAULT_LAW_AGGREGATION_CONFIG.targetCandidateCount,
      logSession
    );

    if (scoredChunks.length > 0 && filteredChunks.length > 0 && scoredChunks[0].chunk.id !== filteredChunks[0].chunk.id) {
      console.log(
        `[LLM 리랭킹 승격] 1순위가 [${filteredChunks[0].chunk.lawName} ${filteredChunks[0].chunk.articleNumber}] ➔ [${scoredChunks[0].chunk.lawName} ${scoredChunks[0].chunk.articleNumber}] 로 지능형 승격되었습니다.\n`
      );
    }

    const topLaw = scoredChunks[0]
      ? `${scoredChunks[0].chunk.lawName} ${scoredChunks[0].chunk.articleNumber}`
      : '';
    onStatus?.(
      `📑 관련 조문 ${scoredChunks.length}건 선별${topLaw ? ` (최상위: ${topLaw})` : ''}`
    );

    return {
      queryVector,
      rawChunks,
      scoredChunks,
      isLegalQuery: true,
    };
  }

  /**
   * RAG 전체 질의응답 파이프라인(검색 -> 1차 필터링 -> LLM 생성 -> 2단계 키워드/인용 선별)을 실행합니다 (SSOT).
   */
  public async executeChat(options: ExecuteChatOptions): Promise<ChatExecutionResult> {
    const { query, onToken, onStatus } = options;
    const limit = options.limit && options.limit > 0 ? options.limit : MAX_REFERENCES;
    const trimmed = (query || '').trim();
    const startTime = Date.now();

    if (!trimmed) {
      const emptyMsg = '질문 내용을 입력해 주시기 바랍니다.';
      if (onToken) onToken(emptyMsg);
      return {
        answer: emptyMsg,
        references: [],
        scoredChunks: [],
        isLegallyRelevant: false,
      };
    }

    const logSession = QueryLogger.startSession(trimmed);

    // 실시간 상태 알림 및 로그 세션 자동 수집을 동시에 수행하는 프록시 래퍼
    const trackedOnStatus = (statusMessage: string) => {
      logSession.recordStatus(statusMessage);
      onStatus?.(statusMessage);
    };

    try {
      // 1. 유사 조문 검색 및 실효 조문 1차 필터링 (onStatus 연계 및 로그 수집)
      const { scoredChunks, isLegalQuery } = await this.searchArticles(
        trimmed,
        limit,
        undefined,
        trackedOnStatus,
        logSession
      );
      const isLegallyRelevant = scoredChunks.length > 0;

      // 1-1. 대한민국 법령과 무관한 질의인 경우 가드레일 안내 메시지 즉시 반환 (Early Return)
      if (!isLegalQuery) {
        const nonLegalMsg = getNonLegalQueryMessage(trimmed);
        if (onToken) onToken(nonLegalMsg);

        const llmStatus = this.llmManager.getStatus();
        logSession.recordFinalResult({
          fullAnswer: nonLegalMsg,
          references: [],
          modelName: llmStatus.modelName,
          engine: llmStatus.engine,
          elapsedMs: Date.now() - startTime,
        });
        await logSession.saveToFile().catch(() => {});

        return {
          answer: nonLegalMsg,
          references: [],
          scoredChunks: [],
          isLegallyRelevant: false,
        };
      }

      // 1-2. 법률 질의이나 관련 조문 부재 또는 임계치 미달 시 안내 반환 (Early Return)
      if (!isLegallyRelevant) {
        const noContextMsg = getNoRelevantLawMessage(trimmed);
        if (onToken) onToken(noContextMsg);

        const llmStatus = this.llmManager.getStatus();
        logSession.recordFinalResult({
          fullAnswer: noContextMsg,
          references: [],
          modelName: llmStatus.modelName,
          engine: llmStatus.engine,
          elapsedMs: Date.now() - startTime,
        });
        await logSession.saveToFile().catch(() => {});

        return {
          answer: noContextMsg,
          references: [],
          scoredChunks: [],
          isLegallyRelevant: false,
        };
      }

      // 3. 조문 컨텍스트 기반 LLM 답변 생성
      const promptChunks = scoredChunks.slice(0, limit);
      console.log('\n=================== [3단계: LLM에 주입된 최종 참조 조문 (Top 5)] ===================');
      promptChunks.slice(0, 5).forEach((c, idx) => {
        console.log(
          `  [참조 ${idx + 1}] [${c.chunk.lawName}] ${c.chunk.articleNumber} (${c.chunk.articleTitle || '본조'}) - 유사도: ${(c.score * 100).toFixed(1)}%`
        );
      });
      console.log('===================================================================================\n');

      const answer = await this.llmManager.generateAnswer(
        trimmed,
        promptChunks,
        onToken,
        trackedOnStatus,
        logSession
      );

      trackedOnStatus('✨ 법률 검토 및 답변 도출');

      // 5. 답변 내용 분석을 통한 핵심 근거 법조문 2단계 재평가 및 선별
      const references: ReferenceArticle[] = refineReferencesByAnswer(answer, scoredChunks, limit);

      console.log('\n=================== [5단계: UI에 최종 확정된 근거 법조문 카드] ===================');
      console.log(`[최종 선별된 근거 법조문 총 개수]: ${references.length}건`);
      references.slice(0, 5).forEach((r, idx) => {
        console.log(
          `  ${idx + 1}. [${r.lawName}] ${r.articleNumber} (${r.articleTitle || '본조'}) - ${(r.score * 100).toFixed(1)}%`
        );
      });
      console.log('===================================================================================\n');

      // 6. 상세 질의응답 사이클 로그 파일 영속화 (logs/yyyymmddhhiiss.log)
      const llmStatus = this.llmManager.getStatus();
      const elapsedMs = Date.now() - startTime;

      logSession.recordFinalResult({
        fullAnswer: answer,
        references,
        modelName: llmStatus.modelName,
        engine: llmStatus.engine,
        elapsedMs,
      });

      const logFilePath = await logSession.saveToFile();
      if (logFilePath) {
        console.log(`📝 [RAG 질의응답 상세 로그 저장 완료]: ${logFilePath}`);
      }

      return {
        answer,
        references,
        scoredChunks,
        isLegallyRelevant: true,
      };
    } catch (error) {
      logSession.recordError(error);
      await logSession.saveToFile().catch(() => {});
      throw error;
    }
  }
}
