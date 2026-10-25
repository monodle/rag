import path from 'node:path';
import fs from 'node:fs';
import {
  getLlama,
  Llama,
  LlamaModel,
  LlamaContext,
  LlamaChatSession,
} from 'node-llama-cpp';
import type { ScoredArticleChunk, QueryAnalysisResult } from '../types/law.js';
import {
  OBVIOUS_LEGAL_KEYWORD_REGEX,
  KOREAN_STOPWORDS_REGEX,
} from '../types/lawRegex.js';
import {
  aggregateAndSelectCandidates,
  DEFAULT_LAW_AGGREGATION_CONFIG,
} from './lawAggregator.js';

import {
  USE_ONDEVICE_LLM,
  GEMMA4_MODEL_PATH,
  MODELS_DIR,
  DEFAULT_LLAMA_MAX_TOKENS,
  DEFAULT_LLAMA_TEMPERATURE,
  DEFAULT_LLAMA_CONTEXT_SIZE,
  resolvePathEnv,
} from '../config/constants.js';
import {
  getSystemPrompt,
  getMainAnswerPrompt,
  getBodyStepPrompt,
  getConclusionStepPrompt,
  getDrilldownStepPrompt,
  sanitizeLlmOutput,
  getNoRelevantLawMessage,
  getFallbackSummary,
  QUERY_ANALYSIS_SYSTEM_PROMPT,
  getQueryAnalysisPrompt,
  RERANK_SYSTEM_PROMPT,
  getRerankPrompt,
  DRILLDOWN_SYSTEM_PROMPT,
} from './promptManager.js';
import { QueryLogSession } from './queryLogger.js';

export interface LlamaGenerationOptions {
  modelPath?: string;
  maxTokens?: number;
  temperature?: number;
  contextSize?: number;
}

export type { QueryAnalysisResult };

export class LlamaCppService {
  private static instance: LlamaCppService | null = null;
  private llama: Llama | null = null;
  private model: LlamaModel | null = null;
  private context: LlamaContext | null = null;
  private isInitializing = false;
  private _isReady = false;
  private gpuType = 'none';
  private enabled: boolean = USE_ONDEVICE_LLM;

  private _modelPath: string;
  public readonly maxTokens: number;
  public readonly temperature: number;
  public readonly contextSize: number;

  public get isReady(): boolean {
    return this._isReady;
  }

  public get modelPath(): string {
    return this._modelPath;
  }

  public getModelPath(): string {
    return this._modelPath;
  }

  public isModelReady(): boolean {
    return this._isReady;
  }

  constructor(options: LlamaGenerationOptions = {}) {
    const rawPath = options.modelPath || GEMMA4_MODEL_PATH || '';

    let initialPath = resolvePathEnv(rawPath);

    // 경로가 지정되지 않았거나 파일이 없으면 data/models 디렉터리의 첫 번째 GGUF 모델 자동 탐색
    if ((!initialPath || !fs.existsSync(initialPath)) && fs.existsSync(MODELS_DIR)) {
      try {
        const files = fs.readdirSync(MODELS_DIR);
        const firstGguf = files.find((f) => f.toLowerCase().endsWith('.gguf'));
        if (firstGguf) {
          initialPath = path.join(MODELS_DIR, firstGguf);
        }
      } catch {
        // 무시
      }
    }

    this._modelPath = initialPath;
    this.maxTokens = options.maxTokens ?? DEFAULT_LLAMA_MAX_TOKENS;
    this.temperature = options.temperature ?? DEFAULT_LLAMA_TEMPERATURE;
    this.contextSize = options.contextSize ?? DEFAULT_LLAMA_CONTEXT_SIZE;
  }

  public static getInstance(options?: LlamaGenerationOptions): LlamaCppService {
    if (!LlamaCppService.instance) {
      LlamaCppService.instance = new LlamaCppService(options);
    }
    return LlamaCppService.instance;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public getStatus(): {
    enabled: boolean;
    isReady: boolean;
    isInitializing: boolean;
    modelName: string;
    gpu: string;
  } {
    return {
      enabled: this.enabled,
      isReady: this.isReady,
      isInitializing: this.isInitializing,
      modelName: this.modelPath ? path.basename(this.modelPath) : '',
      gpu: this.gpuType,
    };
  }

  /**
   * 백그라운드에서 Metal GPU 가속 LLM 모델을 예열합니다.
   */
  public warmup(): void {
    if (!this.enabled) {
      return;
    }
    if (this.isReady || this.isInitializing) return;
    this.initModel().catch((err) => {
      console.error('⚠️ [LlamaCpp/Metal] 예열 초기화 실패:', err);
    });
  }

  /**
   * 로드된 모델과 컨텍스트를 메모리에서 안전하게 해제합니다.
   */
  public async unloadModel(): Promise<void> {
    if (this.isInitializing) {
      while (this.isInitializing) {
        await new Promise((res) => setTimeout(res, 50));
      }
    }

    if (this.context) {
      try {
        await this.context.dispose();
      } catch (err) {
        console.warn('⚠️ [LlamaCpp/Metal] Context dispose 중 경고:', err);
      }
      this.context = null;
    }

    if (this.model) {
      try {
        await this.model.dispose();
      } catch (err) {
        console.warn('⚠️ [LlamaCpp/Metal] Model dispose 중 경고:', err);
      }
      this.model = null;
    }

    this._isReady = false;
    console.log('🧹 [LlamaCpp/Metal] 모델 메모리 언로드 완료');
  }

  /**
   * 지정된 모델을 언로드하고 모델 경로 설정을 안전하게 초기화합니다 (SSOT).
   */
  public async clearModel(): Promise<void> {
    await this.unloadModel();
    this._modelPath = '';
  }

  /**
   * 온디바이스 LLM을 켜거나 끕니다.
   * 끄면 메모리에서 모델을 해제하고, 켜면 지정된 모델을 메모리에 로드합니다.
   */
  public async setEnabled(enabled: boolean): Promise<void> {
    if (this.enabled === enabled) {
      if (enabled && !this.isReady && !this.isInitializing) {
        await this.initModel();
      }
      return;
    }

    this.enabled = enabled;
    if (!enabled) {
      await this.unloadModel();
    } else {
      await this.initModel();
    }
  }

  /**
   * 모델을 전환하고 메모리에 새로 로드합니다.
   */
  public async switchModel(targetPath: string): Promise<void> {
    const resolvedPath = resolvePathEnv(targetPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`지정한 모델 파일을 찾을 수 없습니다: ${resolvedPath}`);
    }

    if (this.modelPath === resolvedPath && this.isReady && this.enabled) {
      return;
    }

    console.log(`🔄 [LlamaCpp] 모델 전환 요청: ${path.basename(resolvedPath)}`);
    await this.unloadModel();
    this._modelPath = resolvedPath;
    this.enabled = true;
    await this.initModel();
  }

  /**
   * 하드웨어 가속(Metal / CUDA / Vulkan / CPU) 엔진 및 컨텍스트 초기화
   */
  public async initModel(): Promise<void> {
    if (!this.enabled) {
      console.log('ℹ️ [LlamaCpp] 온디바이스 LLM이 비활성화되어 있습니다.');
      return;
    }
    if (this.isReady && this.model && this.context) return;
    if (this.isInitializing) {
      while (this.isInitializing) {
        await new Promise((res) => setTimeout(res, 100));
      }
      return;
    }

    if (!this.modelPath || !fs.existsSync(this.modelPath)) {
      console.warn(`⚠️ [LlamaCpp] GGUF 가중치 모델이 지정되지 않았거나 파일을 찾을 수 없습니다: ${this.modelPath || '미설정'}`);
      return;
    }

    this.isInitializing = true;
    console.log(`🚀 [LlamaCpp] 하드웨어 가속 모델 초기화 시작: ${this.modelPath}`);

    try {
      if (!this.llama) {
        this.llama = await getLlama();
        this.gpuType = String(this.llama.gpu || 'cpu');
        console.log(`⚡ [LlamaCpp] 감지된 하드웨어 가속 엔진: ${this.gpuType.toUpperCase()}`);
      }

      this.model = await this.llama.loadModel({
        modelPath: this.modelPath,
        gpuLayers: 'max',
      });

      this.context = await this.model.createContext({
        contextSize: this.contextSize,
        sequences: 4,
      });

      this._isReady = true;
      this.isInitializing = false;
      console.log(`✅ [LlamaCpp] GGUF 모델 로드 및 Context 준비 완료 (${this.gpuType.toUpperCase()})`);
    } catch (err) {
      this.isInitializing = false;
      this._isReady = false;
      console.error('❌ [LlamaCpp] 모델 초기화 실패:', err);
      throw err;
    }
  }


  /**
   * Metal GPU 기반 4단계 순차 파이프라인(서론 -> 본론 -> 결론 -> 드릴다운) 스트리밍 답변 생성
   */
  public async generateAnswer(
    query: string,
    scoredChunks: ScoredArticleChunk[],
    onToken?: (token: string) => void,
    onStatus?: (status: string) => void,
    logSession?: QueryLogSession
  ): Promise<string> {
    if (scoredChunks.length === 0) {
      const msg = getNoRelevantLawMessage(query);
      if (onToken) onToken(msg);
      return msg;
    }

    if (!this.enabled) {
      const fallback = getFallbackSummary(query, scoredChunks);
      if (onToken) onToken(fallback);
      return fallback;
    }

    try {
      await this.initModel();

      if (!this.model || !this.context) {
        throw new Error('LlamaCpp 엔진이 준비되지 않았습니다.');
      }

      const systemPrompt = getSystemPrompt();
      const stopTriggers = [
        '[|endofturn|]',
        '[|user|]',
        '[|assistant|]',
        '<end_of_turn>',
        '<start_of_turn>',
        '</think>',
        '[i]',
        'User:',
        '\n---\n',
      ];

      const sequence = this.context!.getSequence();
      const session = new LlamaChatSession({
        contextSequence: sequence,
        systemPrompt,
      });

      const parts: string[] = [];

      try {
        // 법률 답변 생성: (서론 + 본론 + 결론 : 단일 턴 생성 시도)
        onStatus?.('⚖️ 법률 검토 답변 작성 중...');
        const mainPrompt = getMainAnswerPrompt(query, scoredChunks);

        let mainAnswerOutput = '';
        const res = await session.prompt(mainPrompt, {
          maxTokens: 65536,
          temperature: 0.1,
          repeatPenalty: { penalty: 1.05, frequencyPenalty: 0.0, presencePenalty: 0.0 },
          customStopTriggers: stopTriggers,
          onTextChunk(chunk) {
            if (!chunk) return;
            mainAnswerOutput += chunk;
          },
        });
        const rawMainOutput = res || mainAnswerOutput;
        let mainAnswer = sanitizeLlmOutput(rawMainOutput.trim());

        logSession?.recordStep({
          stepKey: 'main_answer',
          title: '법률 검토 답변 작성 (서론/본론/결론 통합)',
          statusMessage: '⚖️ 법률 검토 답변 작성 중...',
          systemPrompt,
          prompt: mainPrompt,
          rawOutput: rawMainOutput,
        });

        // 소형 모델(EXAONE 등)이 1단계(핵심 요약)만 작성하고 종료한 경우,
        // 동일 세션 컨텍스트를 활용하여 누락된 본론과 결론을 순차적으로 체이닝 완성 (Self-Healing Sequential Pipeline)
        const hasBody = /(?:^|\n)#{1,4}\s*[📖\w\s]*2\.\s*법적/m.test(mainAnswer);
        if (!hasBody) {
          onStatus?.('📖 법적 기준 및 세부 요건 보강 작성 중...');
          const bodyStepPrompt = getBodyStepPrompt();
          let bodyOutput = '';
          const bodyRes = await session.prompt(bodyStepPrompt, {
            maxTokens: 2048,
            temperature: 0.1,
            repeatPenalty: { penalty: 1.05, frequencyPenalty: 0.0, presencePenalty: 0.0 },
            customStopTriggers: stopTriggers,
            onTextChunk(chunk) {
              if (!chunk) return;
              bodyOutput += chunk;
            },
          });
          const rawBodyOutput = bodyRes || bodyOutput;
          const cleanedBody = sanitizeLlmOutput(rawBodyOutput.trim());
          if (cleanedBody) {
            mainAnswer = `${mainAnswer}\n\n${cleanedBody}`;
          }

          logSession?.recordStep({
            stepKey: 'body_supplement',
            title: '법적 기준 및 세부 요건 보강',
            statusMessage: '📖 법적 기준 및 세부 요건 보강 작성 중...',
            prompt: bodyStepPrompt,
            rawOutput: rawBodyOutput,
          });
        }

        const hasConclusion = /(?:^|\n)#{1,4}\s*[💡\w\s]*3\.\s*유의/m.test(mainAnswer);
        if (!hasConclusion) {
          onStatus?.('💡 실무 유의사항 보강 작성 중...');
          const conclusionStepPrompt = getConclusionStepPrompt();
          let conclusionOutput = '';
          const conclusionRes = await session.prompt(conclusionStepPrompt, {
            maxTokens: 1024,
            temperature: 0.1,
            repeatPenalty: { penalty: 1.05, frequencyPenalty: 0.0, presencePenalty: 0.0 },
            customStopTriggers: stopTriggers,
            onTextChunk(chunk) {
              if (!chunk) return;
              conclusionOutput += chunk;
            },
          });
          const rawConclusionOutput = conclusionRes || conclusionOutput;
          const cleanedConclusion = sanitizeLlmOutput(rawConclusionOutput.trim());
          if (cleanedConclusion) {
            mainAnswer = `${mainAnswer}\n\n${cleanedConclusion}`;
          }

          logSession?.recordStep({
            stepKey: 'conclusion_supplement',
            title: '실무 유의사항 보강',
            statusMessage: '💡 실무 유의사항 보강 작성 중...',
            prompt: conclusionStepPrompt,
            rawOutput: rawConclusionOutput,
          });
        }

        if (mainAnswer.trim()) {
          parts.push(mainAnswer.trim());
        }
      } finally {
        session.dispose({ disposeSequence: true });
      }

      // [2/2] 추천 후속 질문 생성 (독립 단일 턴)
      // 만약 답변 본문에 이미 "4. 추천 후속 질문"이 모델에 의해 작성되었다면 중복 생성 방지
      const alreadyHasQuestions = /(?:^|\n)#{1,4}\s*[🔍❓]?\s*4\.\s*추천/m.test(parts.join('\n'));
      let drilldownAdded = alreadyHasQuestions;

      if (!alreadyHasQuestions) {
        onStatus?.('💡 추천 후속 질문 추출 중...');
        try {
          const topLawNames = Array.from(
            new Set(scoredChunks.slice(0, 3).map((s) => `${s.chunk.lawName} ${s.chunk.articleNumber}`))
          ).join(', ');
          const introSnippet = parts[0]
            ? parts[0].replace(/###[^\n]+/g, '').replace(/[🏷️📌][^\n]+/g, '').trim().slice(0, 150)
            : '';
          const lawSummary = `주요 적용 법령: ${topLawNames}\n핵심 요약: ${introSnippet}`;
          const drilldownPrompt = getDrilldownStepPrompt(query, lawSummary);

          const drilldownSeq = this.context!.getSequence();
          const drilldownSession = new LlamaChatSession({
            contextSequence: drilldownSeq,
            systemPrompt: DRILLDOWN_SYSTEM_PROMPT,
          });

          try {
            let drilldownOutput = '';
            const res = await drilldownSession.prompt(drilldownPrompt, {
              maxTokens: 512,
              temperature: 0.1,
              customStopTriggers: stopTriggers,
              onTextChunk(chunk) {
                if (!chunk) return;
                drilldownOutput += chunk;
              },
            });
            const rawDrilldownOutput = res || drilldownOutput;
            let cleanedDrilldown = sanitizeLlmOutput(rawDrilldownOutput.trim());
            if (cleanedDrilldown) {
              // 헤딩이 누락된 경우 헤딩 강제 보강
              if (!/^#{1,4}\s+/m.test(cleanedDrilldown)) {
                cleanedDrilldown = `### 🔍 4. 추천 후속 질문\n${cleanedDrilldown}`;
              }
              parts.push(cleanedDrilldown);
              drilldownAdded = true;
            }

            logSession?.recordStep({
              stepKey: 'drilldown',
              title: '추천 후속 질문 추출',
              statusMessage: '💡 추천 후속 질문 추출 중...',
              systemPrompt: DRILLDOWN_SYSTEM_PROMPT,
              prompt: drilldownPrompt,
              rawOutput: rawDrilldownOutput,
            });
          } finally {
            drilldownSession.dispose({ disposeSequence: true });
          }
        } catch (err) {
          console.warn('⚠️ [LlamaCpp] 후속 질문 단일 원샷 생성 실패 (폴백 생성 진행):', err);
        }
      }

      // 방어 로직: 모델이 후속 질문을 뱉지 못했거나 실패한 경우 검색된 법령 기반 추천 질문 자동 생성 (항상 100% 제공 보장)
      if (!drilldownAdded && scoredChunks.length > 0) {
        const fallbackQuestions = scoredChunks.slice(0, 3).map((sc, idx) => {
          const c = sc.chunk;
          const title = c.articleTitle ? `(${c.articleTitle})` : '';
          const sampleTemplates = [
            `${c.lawName} ${c.articleNumber}${title}의 구체적인 적용 요건과 위반 시 처벌 또는 제재 기준은 어떻게 되나요?`,
            `${c.lawName} ${c.articleNumber}${title}에 따른 예외 인정 사유나 면책 규정이 별도로 존재하나요?`,
            `${c.lawName} 규정과 관련하여 실무상 자주 발생하는 분쟁이나 필수 주의사항은 무엇인가요?`,
          ];
          return `${idx + 1}. ${sampleTemplates[idx % sampleTemplates.length]}`;
        });
        const fallbackText = `### 🔍 4. 추천 후속 질문\n${fallbackQuestions.join('\n')}`;
        parts.push(fallbackText);

        logSession?.recordStep({
          stepKey: 'drilldown_fallback',
          title: '추천 후속 질문 (규칙 기반 폴백 보장)',
          statusMessage: '💡 추천 후속 질문 추출 중...',
          prompt: '규칙 기반 추천 후속 질문 템플릿',
          rawOutput: fallbackText,
        });
      }

      const fullText = parts.filter(Boolean).join('\n\n');
      if (onToken) {
        const chunkSize = 1;
        for (let i = 0; i < fullText.length; i += chunkSize) {
          onToken(fullText.slice(i, i + chunkSize));
          await new Promise((resolve) => setTimeout(resolve, 8));
        }
      }

      return fullText;
    } catch (error) {
      console.warn('⚠️ [LlamaCpp/Metal] 추론 중 오류 발생, 구조화 요약으로 폴백:', error);
      const fallback = getFallbackSummary(query, scoredChunks);
      if (onToken) onToken(fallback);
      return fallback;
    }
  }

  /**
   * 온디바이스 소형 LLM을 사용하여 사용자 질문의 대한민국 법령 관련성을 1단계에서 사전 판별하고,
   * 관련 질의인 경우 검색용 핵심 법률 키워드를 초고속 추출합니다 (Single-Pass Query Analysis).
   * - 프로그래밍, IT, 요리 등 비법률 질의인 경우 isLegalQuery: false를 반환하여 불필요한 벡터 검색 원천 차단
   * - maxTokens: 40 (~0.1초 완료)
   */
  public async analyzeSearchQuery(
    query: string,
    _logSession?: QueryLogSession
  ): Promise<QueryAnalysisResult> {
    const trimmed = (query || '').trim();
    if (!trimmed) {
      return { keywords: [], isLegalQuery: true };
    }

    if (!this.enabled || !this.isReady || !this.context) {
      return { keywords: [], isLegalQuery: true };
    }

    try {
      const keywordPrompt = getQueryAnalysisPrompt(trimmed);

      const sequence = this.context.getSequence();
      const session = new LlamaChatSession({
        contextSequence: sequence,
        systemPrompt: QUERY_ANALYSIS_SYSTEM_PROMPT,
      });

      let rawResponse = '';
      try {
        rawResponse = await session.prompt(keywordPrompt, {
          maxTokens: 40,
          temperature: 0.1,
        });
      } finally {
        session.dispose({ disposeSequence: true });
      }

      if (!rawResponse) {
        return {
          keywords: [],
          isLegalQuery: true,
          rawResponse: '',
          systemPrompt: QUERY_ANALYSIS_SYSTEM_PROMPT,
          prompt: keywordPrompt,
        };
      }

      // "검색어:", "결과:", "질문: ... \n결과: " 등 모델의 반복 출력 프리픽스 유연한 정제
      let trimmedText = rawResponse.trim();
      const matchPrefix = trimmedText.match(/(?:검색어|결과):\s*([^\n]+)/i);
      if (matchPrefix) {
        trimmedText = matchPrefix[1].trim();
      } else {
        trimmedText = trimmedText
          .replace(/^(?:질문:[^\n]*\n)?(?:(?:핵심\s*)?(?:검색어|결과):\s*)?/i, '')
          .trim();
      }

      // "무관", "관련 없음", "none", "n/a" 판정 (비법률 질문 가드레일)
      if (
        /^(무관|관련\s*없음|해당\s*없음|none|n\/a)/i.test(trimmedText) ||
        trimmedText === '무관' ||
        trimmedText.startsWith('무관')
      ) {
        // 단, 질문 자체에 명백한 사법/형사/민사/제도 핵심어가 있는 경우 과도한 차단 방어 (Defensive Programming)
        const isObviousLegal = OBVIOUS_LEGAL_KEYWORD_REGEX.test(trimmed);
        if (!isObviousLegal) {
          return {
            keywords: [],
            isLegalQuery: false,
            rawResponse,
            systemPrompt: QUERY_ANALYSIS_SYSTEM_PROMPT,
            prompt: keywordPrompt,
          };
        }

        console.log(`🛡️ [가드레일 방어] 소형 LLM이 '무관'으로 출력했으나 질문 내 명백한 법률 키워드가 감지되어 법률 질의로 복구합니다: "${trimmed}"`);
        return {
          keywords: [],
          isLegalQuery: true,
          rawResponse,
          systemPrompt: QUERY_ANALYSIS_SYSTEM_PROMPT,
          prompt: keywordPrompt,
        };
      }

      // 3심제, 4대보험, 52시간제 등 유효한 숫자 포함 법률 용어의 앞자리 숫자가 잘리지 않도록 리스트 번호만 선별 제거
      let cleaned = trimmedText
        .split(/[,\n]/)
        .map((k) => k.replace(/^[0-9]+[.)\]]\s*|^[-*#\s]+/, '').trim())
        .filter((k) => k.length >= 2 && k.length <= 25 && !k.startsWith('검색어') && !k.startsWith('결과') && !k.startsWith('질문'));

      // [가드레일 보강] LLM이 키워드 대신 서술형 문장을 출력하여 쉼표/개행 분리 결과가 비어있을 때의 안전 폴백
      if (cleaned.length === 0 && trimmedText.length > 0) {
        const words = trimmedText
          .replace(/[^가-힣a-zA-Z0-9\s]/g, ' ')
          .split(/\s+/)
          .map((w) => w.trim())
          .filter((w) => {
            if (w.length < 2 || w.length > 20) return false;
            return !KOREAN_STOPWORDS_REGEX.test(w);
          });
        cleaned = words.slice(0, 4);
      }

      return {
        keywords: Array.from(new Set(cleaned)),
        isLegalQuery: true,
        rawResponse,
        systemPrompt: QUERY_ANALYSIS_SYSTEM_PROMPT,
        prompt: keywordPrompt,
      };
    } catch (err) {
      console.warn('⚠️ [LlamaCpp] 질의 분석 및 키워드 추출 실패, 원본 질의로 폴백:', err);
      return { keywords: [], isLegalQuery: true };
    }
  }


  /**
   * Qdrant에서 검색된 상위 후보 조문 중 질문의 주체와 상황에 가장 적합한 조문을 지능적으로 재정렬합니다 (Zero-Hardcoding Reranker).
   * - 단순 벡터 유사도(표제어 매칭)의 한계를 극복하고 질문 문맥에 보편적으로 부합하는 법령을 1순위로 승격
   * - maxTokens: 30 (~0.15초 초고속 완료)
   * - 실패 또는 모델 미준비 시 원본 후보군 그대로 안전 반환 (Defensive Early Return)
   */
  public async rerankArticlesByRelevance(
    query: string,
    candidateChunks: ScoredArticleChunk[],
    topK: number = DEFAULT_LAW_AGGREGATION_CONFIG.targetCandidateCount,
    logSession?: QueryLogSession
  ): Promise<ScoredArticleChunk[]> {
    const trimmed = (query || '').trim();
    if (!this.enabled || !trimmed || !this.isReady || !this.context || candidateChunks.length <= 1) {
      return candidateChunks;
    }

    // 법령 단위 Group By 집계를 통해 특정 조문 노이즈를 억제하고 대표 법령 핵심 조문 선별
    const aggregationResult = aggregateAndSelectCandidates(candidateChunks, {
      maxLaws: DEFAULT_LAW_AGGREGATION_CONFIG.maxLaws,
      maxPerLaw: DEFAULT_LAW_AGGREGATION_CONFIG.maxPerLaw,
      targetCandidateCount: Math.max(topK, DEFAULT_LAW_AGGREGATION_CONFIG.targetCandidateCount),
      alpha: DEFAULT_LAW_AGGREGATION_CONFIG.alpha,
    });

    const targetCandidates = aggregationResult.selectedChunks;
    const remainderChunks = aggregationResult.remainderChunks;
    const statuteSummaries = aggregationResult.summaries;

    if (statuteSummaries.length > 0) {
      console.log('\n=================== [법령 단위 Group By 집계 및 후보군 선별] ===================');
      statuteSummaries.slice(0, 5).forEach((stat, idx) => {
        console.log(
          `  ${idx + 1}. [${stat.lawName}] ${stat.matchCount}건 매칭 (최고: ${(stat.maxScore * 100).toFixed(2)}%, 종합: ${(stat.combinedScore * 100).toFixed(2)}%)`
        );
      });
      console.log(`  ➔ Reranker 검토 대상 조문: ${targetCandidates.length}건 선별`);
      console.log('=================================================================================\n');
    }

    try {
      const candidatesText = targetCandidates
        .map((sc, idx) => {
          const c = sc.chunk;
          const snippet = c.content.replace(/\s+/g, ' ').slice(0, 120);
          return `${idx + 1}. [${c.lawName}] ${c.articleNumber} (${c.articleTitle || '본조'})\n   내용: ${snippet}...`;
        })
        .join('\n\n');

      const rerankPrompt = getRerankPrompt(trimmed, candidatesText);

      const sequence = this.context.getSequence();
      const session = new LlamaChatSession({
        contextSequence: sequence,
        systemPrompt: RERANK_SYSTEM_PROMPT,
      });

      let rawResponse = '';
      try {
        rawResponse = await session.prompt(rerankPrompt, {
          maxTokens: 25,
          temperature: 0.0,
        });
      } finally {
        session.dispose({ disposeSequence: true });
      }

      if (!rawResponse) {
        console.log('[LLM 문맥 적합도 리랭커] 응답이 비어있어 원본 순서를 유지합니다.');
        return candidateChunks;
      }

      // 숫자 파싱 (1-based index)
      const parsedIndices: number[] = [];
      const matches = rawResponse.match(/\d+/g);
      if (matches) {
        for (const m of matches) {
          const num = parseInt(m, 10);
          if (num >= 1 && num <= targetCandidates.length && !parsedIndices.includes(num)) {
            parsedIndices.push(num);
          }
        }
      }

      console.log('\n=================== [LLM 문맥 적합도 리랭커] ===================');
      console.log(`[LLM 응답 원본 (rawResponse)]: "${rawResponse.trim()}"`);
      console.log(`[파싱된 추천 순위 (1-based)]: [${parsedIndices.join(', ')}]`);

      // 파싱된 번호가 없다면 원본 유지
      if (parsedIndices.length === 0) {
        console.log('[LLM 문맥 적합도 리랭커] 유효한 번호가 파싱되지 않아 원본 Qdrant 순서를 유지합니다.');
        console.log('=========================================================================\n');
        return candidateChunks;
      }

      // 재정렬된 조문 목록 구성
      const rerankedTargets: ScoredArticleChunk[] = [];
      for (const idx of parsedIndices) {
        rerankedTargets.push(targetCandidates[idx - 1]);
      }

      // LLM이 미처 언급하지 않은 나머지 상위 후보들도 뒤에 덧붙임
      for (const chunk of targetCandidates) {
        if (!rerankedTargets.includes(chunk)) {
          rerankedTargets.push(chunk);
        }
      }

      const beforeTopLaw = targetCandidates[0]
        ? `[${targetCandidates[0].chunk.lawName}] ${targetCandidates[0].chunk.articleNumber}`
        : undefined;
      const afterTopLaw = rerankedTargets[0]
        ? `[${rerankedTargets[0].chunk.lawName}] ${rerankedTargets[0].chunk.articleNumber}`
        : undefined;
      const isPromoted = Boolean(beforeTopLaw && afterTopLaw && beforeTopLaw !== afterTopLaw);

      logSession?.recordRerank({
        systemPrompt: RERANK_SYSTEM_PROMPT,
        prompt: rerankPrompt,
        rawOutput: rawResponse,
        parsedIndices,
        beforeTopLaw,
        afterTopLaw,
        isPromoted,
        statuteSummaries,
      });

      console.log(`[리랭킹 결과 1순위]: [${rerankedTargets[0]?.chunk.lawName} ${rerankedTargets[0]?.chunk.articleNumber}] (${rerankedTargets[0]?.chunk.articleTitle || '본조'})`);
      console.log('=========================================================================\n');

      return [...rerankedTargets, ...remainderChunks];
    } catch (err) {
      console.warn('⚠️ [LlamaCpp] LLM 리랭킹 실패, Qdrant 벡터 점수 원본으로 폴백:', err);
      return candidateChunks;
    }
  }
}

