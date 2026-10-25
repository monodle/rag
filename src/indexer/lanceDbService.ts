import fs from 'node:fs';
import * as lancedb from '@lancedb/lancedb';
import type { LawArticleChunk, LawSearchOptions, ScoredArticleChunk } from '../types/law.js';
import {
  LANCEDB_DIR,
  LANCEDB_TABLE_NAME,
  EMBEDDING_DIMENSION,
} from '../config/constants.js';

export interface LanceDbConfig {
  dbDir?: string;
  tableName?: string;
}

export class LanceDbService {
  private static instance: LanceDbService | null = null;
  private dbDir: string;
  public readonly tableName: string;
  public readonly vectorDimension: number = EMBEDDING_DIMENSION;
  private dbPromise: Promise<lancedb.Connection> | null = null;
  private tablePromise: Promise<lancedb.Table> | null = null;

  private cachedLawsCount: number | null = null;

  constructor(config: LanceDbConfig = {}) {
    this.dbDir = config.dbDir || LANCEDB_DIR;
    this.tableName = config.tableName || LANCEDB_TABLE_NAME;
  }

  public static getInstance(config?: LanceDbConfig): LanceDbService {
    if (!LanceDbService.instance) {
      LanceDbService.instance = new LanceDbService(config);
    }
    return LanceDbService.instance;
  }

  /**
   * DB 테이블 및 연결 캐시를 초기화합니다.
   * (DB 동기화 완료 후 새로 생성된 테이블을 열기 위해 사용)
   */
  public resetCache(): void {
    this.tablePromise = null;
    this.dbPromise = null;
    this.cachedLawsCount = null;
  }

  /**
   * LanceDB 데이터베이스 연결을 반환하며 싱글톤 연결을 유지합니다.
   */
  private async getDb(): Promise<lancedb.Connection> {
    if (!this.dbPromise) {
      if (!fs.existsSync(this.dbDir)) {
        fs.mkdirSync(this.dbDir, { recursive: true });
      }
      this.dbPromise = lancedb.connect(this.dbDir).catch((err) => {
        this.dbPromise = null;
        throw err;
      });
    }
    return await this.dbPromise;
  }

  /**
   * 법령 테이블 객체를 반환합니다.
   */
  public async getTable(): Promise<lancedb.Table> {
    if (!this.tablePromise) {
      this.tablePromise = (async () => {
        try {
          const db = await this.getDb();
          const tableNames = await db.tableNames();
          if (!tableNames.includes(this.tableName)) {
            throw new Error(
              `LanceDB 테이블 [${this.tableName}]이 존재하지 않습니다. 먼저 동기화(pnpm db:sync) 또는 마이그레이션을 수행해 주세요.`
            );
          }
          return await db.openTable(this.tableName);
        } catch (err) {
          this.tablePromise = null;
          throw err;
        }
      })();
    }
    return await this.tablePromise;
  }

  /**
   * 테이블 존재 여부를 점검합니다.
   */
  public async hasTable(): Promise<boolean> {
    try {
      const db = await this.getDb();
      const tableNames = await db.tableNames();
      return tableNames.includes(this.tableName);
    } catch {
      return false;
    }
  }

  /**
   * 쿼리 벡터와 유사한 법령 조문을 검색합니다.
   * Qdrant와 동일한 인터페이스(ScoredArticleChunk[]) 및 Cosine 유사도 점수 체계를 제공합니다.
   */
  public async searchSimilarArticles(
    queryVector: number[],
    options: LawSearchOptions = {}
  ): Promise<ScoredArticleChunk[]> {
    const { limit = 5, scoreThreshold, lawName, articleNumber } = options;

    if (queryVector.length !== this.vectorDimension) {
      throw new Error(`쿼리 벡터 차원 불일치: expected ${this.vectorDimension}, received ${queryVector.length}`);
    }

    const table = await this.getTable();

    // Cosine 거리 기반 벡터 검색 (distance = 1 - cosine_similarity)
    let queryBuilder = table
      .vectorSearch(queryVector)
      .distanceType('cosine')
      .limit(limit);

    // SQL 형태의 WHERE 필터 조건 구축
    const filters: string[] = [];
    if (lawName) {
      const escaped = lawName.replace(/'/g, "''");
      filters.push(`lawName = '${escaped}'`);
    }
    if (articleNumber) {
      const escaped = articleNumber.replace(/'/g, "''");
      filters.push(`articleNumber = '${escaped}'`);
    }

    if (filters.length > 0) {
      queryBuilder = queryBuilder.where(filters.join(' AND '));
    }

    const rawRows = await queryBuilder.toArray();

    const scoredChunks: ScoredArticleChunk[] = [];

    for (const row of rawRows) {
      // LanceDB cosine 거리: distance = 1 - similarity ➔ similarity = 1 - distance
      const distance = typeof row._distance === 'number' ? row._distance : 1.0;
      const score = Math.max(0, Math.min(1, 1 - distance));

      if (scoreThreshold !== undefined && score < scoreThreshold) {
        continue;
      }

      scoredChunks.push({
        score,
        chunk: {
          id: String(row.chunkId || row.id || ''),
          lawName: String(row.lawName || ''),
          lawType: String(row.lawType || ''),
          chapterPath: String(row.chapterPath || ''),
          articleNumber: String(row.articleNumber || ''),
          articleTitle: String(row.articleTitle || ''),
          content: String(row.content || ''),
          effectiveDate: String(row.effectiveDate || ''),
          status: String(row.status || ''),
          sourceUrl: String(row.sourceUrl || ''),
          filePath: String(row.filePath || ''),
        },
      });
    }

    return scoredChunks;
  }

  /**
   * 컬렉션(테이블) 통계 및 레코드 수를 반환합니다 (Qdrant 호환 포맷).
   */
  public async getCollectionInfo(): Promise<{ points_count: number; indexed_vectors_count: number }> {
    try {
      const table = await this.getTable();
      const count = await table.countRows();
      return {
        points_count: count,
        indexed_vectors_count: count,
      };
    } catch {
      return {
        points_count: 0,
        indexed_vectors_count: 0,
      };
    }
  }

  /**
   * 인덱싱된 전체 법령 중 고유 법률 수(distinct lawName)를 계산하여 반환합니다.
   * 연산 결과를 메모리에 캐싱하여 후속 호출 시 즉각 반환합니다.
   */
  public async getLawsCount(): Promise<number> {
    if (this.cachedLawsCount !== null && this.cachedLawsCount > 0) {
      return this.cachedLawsCount;
    }

    try {
      const table = await this.getTable();
      const records = await table.query().select(['lawName']).toArray();
      const uniqueLaws = new Set(records.map((r) => r.lawName).filter(Boolean));
      this.cachedLawsCount = uniqueLaws.size;
      return this.cachedLawsCount;
    } catch {
      return 0;
    }
  }

  /**
   * 신규 법령 청크 및 임베딩 벡터를 배치로 추가합니다.
   */
  public async upsertLawChunks(
    chunks: LawArticleChunk[],
    vectors: number[][],
    batchSize: number = 2000,
    onProgress?: (upserted: number, total: number) => void
  ): Promise<void> {
    if (chunks.length !== vectors.length) {
      throw new Error(`청크 수(${chunks.length})와 벡터 수(${vectors.length})가 일치하지 않습니다.`);
    }

    if (chunks.length === 0) {
      return;
    }

    const db = await this.getDb();
    const tableNames = await db.tableNames();
    const total = chunks.length;

    for (let i = 0; i < total; i += batchSize) {
      const sliceChunks = chunks.slice(i, i + batchSize);
      const sliceVectors = vectors.slice(i, i + batchSize);

      const records = sliceChunks.map((chunk, idx) => ({
        id: chunk.id,
        vector: sliceVectors[idx],
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
      }));

      if (!tableNames.includes(this.tableName) && i === 0) {
        await db.createTable(this.tableName, records);
        tableNames.push(this.tableName);
      } else {
        const table = await this.getTable();
        await table.add(records);
      }

      if (onProgress) {
        onProgress(Math.min(i + batchSize, total), total);
      }
    }
  }
}
