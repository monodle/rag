import crypto from 'node:crypto';
import { QdrantClient } from '@qdrant/js-client-rest';
import type { LawArticleChunk, LawSearchOptions, ScoredArticleChunk } from '../types/law.js';
import { QDRANT_URL, QDRANT_API_KEY, QDRANT_COLLECTION, EMBEDDING_DIMENSION } from '../config/constants.js';

export interface QdrantConfig {
  url?: string;
  apiKey?: string;
  collectionName?: string;
}

export class QdrantService {
  private client: QdrantClient;
  public readonly collectionName: string;
  public readonly vectorDimension: number = EMBEDDING_DIMENSION;

  constructor(config: QdrantConfig = {}) {
    const url = config.url || QDRANT_URL;
    const apiKey = config.apiKey || QDRANT_API_KEY;
    this.collectionName = config.collectionName || QDRANT_COLLECTION;

    this.client = new QdrantClient({
      url,
      apiKey: apiKey || undefined,
    });
  }

  /**
   * 고유 키 문자열로부터 멱등성을 보장하는 유효한 UUID 문자열을 생성합니다.
   */
  public generateDeterministicUuid(key: string): string {
    const hash = crypto.createHash('md5').update(key).digest('hex');
    return [
      hash.substring(0, 8),
      hash.substring(8, 12),
      `4${hash.substring(13, 16)}`,
      `a${hash.substring(17, 20)}`,
      hash.substring(20, 32),
    ].join('-');
  }

  /**
   * 컬렉션 존재 여부를 점검하고, 미존재 시 768차원 Cosine 벡터 컬렉션 및 페이로드 인덱스를 자동 생성합니다.
   */
  public async ensureCollection(): Promise<void> {
    const collectionsResponse = await this.client.getCollections();
    const exists = collectionsResponse.collections.some(
      (col) => col.name === this.collectionName
    );

    if (!exists) {
      await this.client.createCollection(this.collectionName, {
        vectors: {
          size: this.vectorDimension,
          distance: 'Cosine',
        },
      });

      // 빠른 필터링을 위한 키워드 페이로드 인덱스 생성
      await Promise.all([
        this.client.createPayloadIndex(this.collectionName, {
          field_name: 'lawName',
          field_schema: 'keyword',
        }),
        this.client.createPayloadIndex(this.collectionName, {
          field_name: 'articleNumber',
          field_schema: 'keyword',
        }),
        this.client.createPayloadIndex(this.collectionName, {
          field_name: 'status',
          field_schema: 'keyword',
        }),
      ]);
    }
  }

  /**
   * 조문 청크와 임베딩 벡터를 Qdrant에 배치로 업서트합니다.
   */
  public async upsertLawChunks(
    chunks: LawArticleChunk[],
    vectors: number[][],
    batchSize: number = 64,
    onProgress?: (upserted: number, total: number) => void
  ): Promise<void> {
    if (chunks.length !== vectors.length) {
      throw new Error(`청크 수(${chunks.length})와 벡터 수(${vectors.length})가 일치하지 않습니다.`);
    }

    if (chunks.length === 0) {
      return;
    }

    await this.ensureCollection();

    const total = chunks.length;

    for (let i = 0; i < total; i += batchSize) {
      const sliceChunks = chunks.slice(i, i + batchSize);
      const sliceVectors = vectors.slice(i, i + batchSize);

      const points = sliceChunks.map((chunk, idx) => {
        const pointId = this.generateDeterministicUuid(chunk.id);
        return {
          id: pointId,
          vector: sliceVectors[idx],
          payload: {
            chunkId: chunk.id,
            lawName: chunk.lawName,
            lawType: chunk.lawType,
            chapterPath: chunk.chapterPath,
            articleNumber: chunk.articleNumber,
            articleTitle: chunk.articleTitle,
            content: chunk.content,
            effectiveDate: chunk.effectiveDate,
            status: chunk.status,
            sourceUrl: chunk.sourceUrl,
            filePath: chunk.filePath,
          },
        };
      });

      await this.client.upsert(this.collectionName, {
        wait: true,
        points,
      });

      if (onProgress) {
        onProgress(Math.min(i + batchSize, total), total);
      }
    }
  }

  /**
   * 쿼리 벡터와 유사한 조문을 검색합니다.
   */
  public async searchSimilarArticles(
    queryVector: number[],
    options: LawSearchOptions = {}
  ): Promise<ScoredArticleChunk[]> {
    const { limit = 5, scoreThreshold, lawName, articleNumber } = options;

    if (queryVector.length !== this.vectorDimension) {
      throw new Error(`쿼리 벡터 차원 불일치: expected ${this.vectorDimension}, received ${queryVector.length}`);
    }

    const mustConditions: Array<Record<string, unknown>> = [];

    if (lawName) {
      mustConditions.push({
        key: 'lawName',
        match: { value: lawName },
      });
    }

    if (articleNumber) {
      mustConditions.push({
        key: 'articleNumber',
        match: { value: articleNumber },
      });
    }

    const filter = mustConditions.length > 0 ? { must: mustConditions } : undefined;

    const response = await this.client.query(this.collectionName, {
      query: queryVector,
      limit,
      score_threshold: scoreThreshold,
      filter,
      with_payload: true,
    });

    return response.points.map((point) => {
      const payload = (point.payload || {}) as Record<string, string>;
      return {
        score: point.score ?? 0,
        chunk: {
          id: payload.chunkId || String(point.id),
          lawName: payload.lawName || '',
          lawType: payload.lawType || '',
          chapterPath: payload.chapterPath || '',
          articleNumber: payload.articleNumber || '',
          articleTitle: payload.articleTitle || '',
          content: payload.content || '',
          effectiveDate: payload.effectiveDate || '',
          status: payload.status || '',
          sourceUrl: payload.sourceUrl || '',
          filePath: payload.filePath || '',
        },
      };
    });
  }

  /**
   * 컬렉션 통계 및 상태 정보를 반환합니다.
   */
  public async getCollectionInfo(): Promise<{ points_count: number; indexed_vectors_count: number }> {
    const res = await this.client.getCollection(this.collectionName);
    return {
      points_count: typeof res.points_count === 'number' ? res.points_count : 0,
      indexed_vectors_count: typeof res.indexed_vectors_count === 'number' ? res.indexed_vectors_count : 0,
    };
  }

  /**
   * 인덱싱된 법률 수를 반환합니다 (미지원 시 0).
   */
  public async getLawsCount(): Promise<number> {
    return 0;
  }
}
