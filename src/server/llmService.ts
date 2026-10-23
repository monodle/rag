import { pipeline, TextStreamer } from '@huggingface/transformers';
import { ScoredArticleChunk } from '../indexer/qdrantService.js';
import { USE_ONDEVICE_LLM, ONDEVICE_LLM_MODEL } from '../config/constants.js';
import {
  getSystemPrompt,
  buildRagUserContent,
  getNoRelevantLawMessage,
  getFallbackSummary,
} from './promptManager.js';

export interface LlmGenerationOptions {
  modelName?: string;
  dtype?: 'q4' | 'q8' | 'fp32' | 'fp16';
  maxNewTokens?: number;
  temperature?: number;
}

export class LlmService {
  private static instance: LlmService | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private generatorPromise: Promise<any> | null = null;
  private isInitializing = false;
  private isReady = false;

  public readonly modelName: string;
  public readonly dtype: 'q4' | 'q8' | 'fp32' | 'fp16';
  public readonly maxNewTokens: number;
  public readonly temperature: number;

  constructor(options: LlmGenerationOptions = {}) {
    this.modelName = options.modelName || ONDEVICE_LLM_MODEL;
    this.dtype = options.dtype || 'q4';
    this.maxNewTokens = options.maxNewTokens || 1024;
    this.temperature = options.temperature || 0.0;
  }

  public static getInstance(options?: LlmGenerationOptions): LlmService {
    if (!LlmService.instance) {
      LlmService.instance = new LlmService(options);
    }
    return LlmService.instance;
  }

  public getStatus(): { enabled: boolean; isReady: boolean; isInitializing: boolean; modelName: string } {
    return {
      enabled: USE_ONDEVICE_LLM,
      isReady: this.isReady,
      isInitializing: this.isInitializing,
      modelName: this.modelName,
    };
  }

  /**
   * 앱 구동 시 백그라운드에서 Gemma 4 모델을 즉시 사전 로드(Pre-warm)합니다.
   */
  public warmup(): void {
    if (!USE_ONDEVICE_LLM) {
      return;
    }
    if (!this.generatorPromise) {
      this.getGenerator().catch((err) => {
        console.error('⚠️ [Gemma4] 사전 로딩 실패:', err);
      });
    }
  }

  /**
   * Gemma 4 text-generation 파이프라인을 비동기로 준비합니다.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async getGenerator(): Promise<any> {
    if (!USE_ONDEVICE_LLM) {
      throw new Error('온디바이스 LLM이 설정(.env)에서 비활성화되어 있습니다.');
    }
    if (this.generatorPromise) {
      return this.generatorPromise;
    }

    this.isInitializing = true;
    console.log(`🧠 [Gemma4] 모델 로드 시작: ${this.modelName} (dtype: ${this.dtype})`);

    this.generatorPromise = (async () => {
      try {
        const pipe = await pipeline('text-generation', this.modelName, {
          dtype: this.dtype,
        });

        // Metal/GPU 셰이더 및 KV Cache 사전 예열 (더미 1토큰 추론)
        console.log(`🔥 [Gemma4] 셰이더 및 KV 캐시 예열(Warm-up 추론) 진행 중...`);
        try {
          await pipe('warmup', { max_new_tokens: 1 });
          console.log(`⚡ [Gemma4] 예열 추론 완료 (완전 준비됨)`);
        } catch (warmErr) {
          console.warn('⚠️ [Gemma4] 예열 추론 경고(기본 파이프라인은 준비됨):', warmErr);
        }

        this.isReady = true;
        this.isInitializing = false;
        console.log(`✅ [Gemma4] 모델 로드 완료: ${this.modelName}`);
        return pipe;
      } catch (err) {
        this.isInitializing = false;
        this.generatorPromise = null;
        console.error('❌ [Gemma4] 모델 로드 실패:', err);
        throw err;
      }
    })();

    return this.generatorPromise;
  }

  /**
   * RAG 검색 결과를 결합하여 Gemma 대화 프롬프트를 구성합니다.
   */
  private buildRagMessages(
    query: string,
    scoredChunks: ScoredArticleChunk[]
  ): Array<{ role: string; content: string }> {
    return [
      { role: 'system', content: getSystemPrompt() },
      { role: 'user', content: buildRagUserContent(query, scoredChunks) },
    ];
  }

  /**
   * Gemma 4 모델을 이용해 법률 답변을 생성합니다.
   */
  public async generateAnswer(
    query: string,
    scoredChunks: ScoredArticleChunk[],
    onToken?: (token: string) => void
  ): Promise<string> {
    if (scoredChunks.length === 0) {
      const msg = getNoRelevantLawMessage(query);
      if (onToken) onToken(msg);
      return msg;
    }

    if (!USE_ONDEVICE_LLM) {
      const fallbackText = getFallbackSummary(query, scoredChunks);
      if (onToken) {
        onToken(fallbackText);
      }
      return fallbackText;
    }

    try {
      const generator = await this.getGenerator();
      const messages = this.buildRagMessages(query, scoredChunks);

      const streamer = onToken
        ? new TextStreamer(generator.tokenizer, {
          skip_prompt: true,
          callback_function: onToken,
        })
        : undefined;

      const output = await generator(messages, {
        max_new_tokens: this.maxNewTokens,
        temperature: this.temperature,
        do_sample: false,
        streamer,
      });

      const generated = output[0]?.generated_text;
      if (Array.isArray(generated)) {
        const lastMsg = generated[generated.length - 1];
        return String(lastMsg?.content || '').trim();
      }

      return String(generated || '').trim();
    } catch (error) {
      console.warn('⚠️ [Gemma4] 로컬 모델 추론 중 오류, 구조화된 법률 요약으로 폴백:', error);
      const fallbackText = getFallbackSummary(query, scoredChunks);
      if (onToken) {
        onToken(fallbackText);
      }
      return fallbackText;
    }
  }
}
