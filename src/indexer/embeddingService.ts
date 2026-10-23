import { pipeline, FeatureExtractionPipeline } from '@huggingface/transformers';
import { EMBEDDING_DIMENSION, EMBEDDING_MODEL_NAME } from '../config/constants.js';

export interface EmbeddingOptions {
  modelName?: string;
  dtype?: 'q4' | 'q8' | 'fp32' | 'fp16';
  batchSize?: number;
}

export class EmbeddingService {
  private static instance: EmbeddingService | null = null;
  private pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

  public readonly modelName: string;
  public readonly dtype: 'q4' | 'q8' | 'fp32' | 'fp16';
  public readonly defaultBatchSize: number;
  public readonly dimension: number = EMBEDDING_DIMENSION;

  constructor(options: EmbeddingOptions = {}) {
    this.modelName = options.modelName || EMBEDDING_MODEL_NAME;
    this.dtype = options.dtype || 'q4';
    this.defaultBatchSize = options.batchSize || 16;
  }

  public static getInstance(options?: EmbeddingOptions): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService(options);
    }
    return EmbeddingService.instance;
  }

  /**
   * 서버 시작 시 모델을 백그라운드에서 사전 초기화합니다.
   */
  public warmup(): void {
    if (!this.pipelinePromise) {
      this.getPipeline()
        .then(async (extractor) => {
          try {
            await extractor('warmup', {
              pooling: 'mean',
              normalize: true,
              // @ts-expect-error Transformers.js extractor options
              truncation: true,
              max_length: 16,
            });
            console.log('⚡ [EmbeddingService] 임베딩 모델 예열 완료 (Metal 셰이더 컴파일 완료)');
          } catch (e) {
            console.warn('⚠️ [EmbeddingService] 임베딩 예열 경고:', e);
          }
        })
        .catch((err) => {
          console.error('⚠️ [EmbeddingService] 사전 로딩 실패:', err);
        });
    }
  }

  /**
   * ONNX 파이프라인을 지연(lazy) 초기화하여 반환합니다.
   */
  private async getPipeline(): Promise<FeatureExtractionPipeline> {
    if (!this.pipelinePromise) {
      this.pipelinePromise = (async () => {
        const extractor = await pipeline('feature-extraction', this.modelName, {
          dtype: this.dtype,
        });
        return extractor as FeatureExtractionPipeline;
      })();
    }
    return this.pipelinePromise;
  }

  /**
   * 단일 텍스트를 768차원 정규화 벡터로 변환합니다.
   */
  public async embedQuery(text: string): Promise<number[]> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error('임베딩할 텍스트가 비어있습니다.');
    }

    const extractor = await this.getPipeline();
    const result = await extractor(trimmed, {
      pooling: 'mean',
      normalize: true,
      // @ts-expect-error Transformers.js extractor options
      truncation: true,
      max_length: 1024,
    });

    const rawData = result.tolist();
    if (!Array.isArray(rawData) || rawData.length === 0) {
      throw new Error('임베딩 결과 추출 실패: 유효하지 않은 데이터 포맷');
    }

    // result.tolist() can be number[][] or number[] depending on input
    const vector = Array.isArray(rawData[0]) ? (rawData[0] as number[]) : (rawData as number[]);
    if (vector.length !== this.dimension) {
      throw new Error(`예상치 못한 벡터 차원: expected ${this.dimension}, received ${vector.length}`);
    }

    return vector;
  }

  /**
   * 여러 개의 텍스트를 배치 단위로 분할하여 768차원 벡터 배열로 변환합니다.
   */
  public async embedBatch(
    texts: string[],
    batchSize: number = this.defaultBatchSize,
    onProgress?: (processed: number, total: number) => void
  ): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return [];
    }

    const extractor = await this.getPipeline();
    const allVectors: number[][] = [];
    const total = texts.length;

    for (let i = 0; i < total; i++) {
      const text = texts[i].trim() || '공백';
      const output = await extractor(text, {
        pooling: 'mean',
        normalize: true,
        // @ts-expect-error Transformers.js extractor options
        truncation: true,
        max_length: 1024,
      });

      const rawData = output.tolist();
      const vector = Array.isArray(rawData[0]) ? (rawData[0] as number[]) : (rawData as number[]);
      if (vector.length !== this.dimension) {
        throw new Error(`벡터 차원 불일치: expected ${this.dimension}, received ${vector.length}`);
      }
      allVectors.push(vector);

      if (onProgress && (i + 1) % 10 === 0) {
        onProgress(i + 1, total);
      }
    }

    if (onProgress) {
      onProgress(total, total);
    }

    return allVectors;
  }
}
