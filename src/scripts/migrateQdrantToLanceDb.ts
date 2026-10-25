import fs from 'node:fs';
import path from 'node:path';
import { QdrantClient } from '@qdrant/js-client-rest';
import * as lancedb from '@lancedb/lancedb';
import {
  QDRANT_URL,
  QDRANT_API_KEY,
  QDRANT_COLLECTION,
  LANCEDB_DIR,
  LANCEDB_TABLE_NAME,
  EMBEDDING_DIMENSION,
} from '../config/constants.js';
import { getDirSizeBytesSync } from '../utils/fileUtils.js';

interface LanceLawRecord {
  id: string;
  vector: number[];
  chunkId: string;
  lawName: string;
  lawType: string;
  chapterPath: string;
  articleNumber: string;
  articleTitle: string;
  content: string;
  effectiveDate: string;
  status: string;
  sourceUrl: string;
  filePath: string;
  [key: string]: unknown;
}



/**
 * Docker Qdrant에 저장된 기구축 벡터 및 조문 데이터를
 * 로컬 내장 LanceDB로 재임베딩 연산 없이 고속 덤프/마이그레이션합니다.
 */
async function runMigration() {
  const startTime = Date.now();
  console.log('='.repeat(70));
  console.log('🚀 [Qdrant ➔ LanceDB] 고속 데이터 마이그레이션 유틸리티');
  console.log('='.repeat(70));
  console.log(`📌 Qdrant 엔드포인트: ${QDRANT_URL} (컬렉션: ${QDRANT_COLLECTION})`);
  console.log(`📌 LanceDB 대상 경로: ${LANCEDB_DIR} (테이블: ${LANCEDB_TABLE_NAME})`);
  console.log('💡 재임베딩(벡터화) 연산 없이 기존 768차원 벡터와 메타데이터를 그대로 이전합니다.\n');

  // 1. Qdrant 클라이언트 초기화 및 컬렉션 점검
  const qdrant = new QdrantClient({
    url: QDRANT_URL,
    apiKey: QDRANT_API_KEY,
  });

  let collectionInfo;
  try {
    collectionInfo = await qdrant.getCollection(QDRANT_COLLECTION);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ Qdrant 컬렉션 접속 실패: ${message}`);
    console.error('💡 Docker Qdrant 컨테이너가 실행 중인지 확인해 주세요. (curl http://localhost:6333)');
    process.exit(1);
  }

  const totalPoints = collectionInfo.points_count ?? 0;
  console.log(`📊 Qdrant 원본 데이터 총 레코드: ${totalPoints.toLocaleString()}건 확인`);

  if (totalPoints === 0) {
    console.warn('⚠️ Qdrant 컬렉션에 데이터가 없습니다. 먼저 인덱싱을 수행해 주세요.');
    process.exit(0);
  }

  // 2. LanceDB 데이터베이스 연결
  if (!fs.existsSync(LANCEDB_DIR)) {
    fs.mkdirSync(LANCEDB_DIR, { recursive: true });
  }

  console.log('🔄 LanceDB 스토리지 연결 중...');
  const db = await lancedb.connect(LANCEDB_DIR);

  // 3. Qdrant Scroll API를 이용한 배치 스트리밍 및 적재
  const BATCH_SIZE = 2000;
  let nextOffset: Record<string, unknown> | string | number | null | undefined = undefined;
  let processedCount = 0;
  let table: lancedb.Table | null = null;

  console.log(`📦 배치 크기: ${BATCH_SIZE}건 단위로 스트리밍 이전 시작...\n`);

  while (true) {
    const scrollRes = await qdrant.scroll(QDRANT_COLLECTION, {
      limit: BATCH_SIZE,
      with_payload: true,
      with_vector: true,
      offset: nextOffset,
    });

    const points = scrollRes.points;
    if (!points || points.length === 0) {
      break;
    }

    // LanceDB 스키마에 맞춘 레코드 변환
    const records: LanceLawRecord[] = [];
    for (const point of points) {
      const payload = (point.payload || {}) as Record<string, string>;
      const vector = (point.vector || []) as number[];

      if (vector.length !== EMBEDDING_DIMENSION) {
        continue;
      }

      records.push({
        id: String(point.id),
        vector,
        chunkId: payload.chunkId || String(point.id),
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
      });
    }

    if (records.length > 0) {
      if (!table) {
        // 첫 번째 배치: 테이블 신규 생성 (덮어쓰기 모드)
        table = await db.createTable(LANCEDB_TABLE_NAME, records, { mode: 'overwrite' });
      } else {
        // 후속 배치: 기존 테이블에 추가
        await table.add(records);
      }
    }

    processedCount += points.length;
    const progressPercent = ((processedCount / totalPoints) * 100).toFixed(1);
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    const remainingSec =
      processedCount > 0
        ? ((((Date.now() - startTime) / processedCount) * (totalPoints - processedCount)) / 1000).toFixed(0)
        : '?';

    process.stdout.write(
      `\r⏳ [진행률: ${progressPercent}%] ${processedCount.toLocaleString()} / ${totalPoints.toLocaleString()}건 완료 (경과: ${elapsedSec}s, 예상잔여: ${remainingSec}s)`
    );

    nextOffset = scrollRes.next_page_offset;
    if (!nextOffset) {
      break;
    }
  }

  process.stdout.write('\n\n');

  // 4. 데이터 정합성 검증
  if (!table) {
    console.error('❌ 이전할 유효한 레코드가 없었습니다.');
    process.exit(1);
  }

  const finalRowCount = await table.countRows();
  const dirSizeMB = (getDirSizeBytesSync(LANCEDB_DIR) / (1024 * 1024)).toFixed(1);
  const totalElapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('='.repeat(70));
  console.log('🎉 [마이그레이션 완료 검증 보고]');
  console.log('='.repeat(70));
  console.log(`✅ LanceDB 저장 행 수: ${finalRowCount.toLocaleString()}건 (원본 Qdrant: ${totalPoints.toLocaleString()}건)`);
  console.log(`💾 LanceDB 디렉터리 디스크 크기: ${dirSizeMB} MB`);
  console.log(`⏱️ 총 소요 시간: ${totalElapsedSec}초`);

  // 5. 샘플 벡터 검색 테스트
  console.log('\n🔍 [자가 검증] LanceDB 벡터 검색 기능 정상 동작 테스트...');
  const testSample = await table.query().limit(1).toArray();
  if (testSample.length > 0 && testSample[0].vector) {
    const sampleVector = testSample[0].vector;
    const searchResults = await table
      .vectorSearch(sampleVector)
      .limit(3)
      .toArray();

    console.log(`✅ 자가 유사도 검색 성공 (상위 3건):`);
    searchResults.forEach((row, i) => {
      console.log(`   ${i + 1}. [${row.lawName}] 제${row.articleNumber}조 (${row.articleTitle}) - 거리 점수: ${row._distance}`);
    });
  }

  console.log('\n✨ Docker Qdrant ➔ LanceDB 마이그레이션이 성공적으로 완료되었습니다!');
}

runMigration().catch((err) => {
  console.error('\n❌ 마이그레이션 중 오류 발생:', err);
  process.exit(1);
});
