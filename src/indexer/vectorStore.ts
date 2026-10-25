import type { LawSearchOptions, ScoredArticleChunk } from '../types/law.js';
import { QdrantService } from './qdrantService.js';
import { LanceDbService } from './lanceDbService.js';
import { VECTOR_STORE_TYPE } from '../config/constants.js';

export interface IVectorStoreService {
  searchSimilarArticles(
    queryVector: number[],
    options?: LawSearchOptions
  ): Promise<ScoredArticleChunk[]>;
  getCollectionInfo(): Promise<{ points_count: number; indexed_vectors_count: number }>;
  getLawsCount?(): Promise<number>;
}

let activeVectorStore: IVectorStoreService | null = null;

/**
 * 환경 설정(VECTOR_STORE_TYPE)에 따라 현재 활성화된 벡터 저장소 인스턴스를 반환합니다.
 * 기본값: 내장 LanceDB (로컬 프로세스 내장형, Docker 불필요)
 */
export function getVectorStoreService(): IVectorStoreService {
  if (activeVectorStore) {
    return activeVectorStore;
  }

  if (VECTOR_STORE_TYPE === 'qdrant') {
    console.log('🔌 [VectorStore] Qdrant 백엔드 활성화 (Docker 컨테이너 연동)');
    activeVectorStore = new QdrantService();
  } else {
    console.log('⚡ [VectorStore] LanceDB 백엔드 활성화 (로컬 내장 파일 기반)');
    activeVectorStore = LanceDbService.getInstance();
  }

  return activeVectorStore;
}
