import fs from 'node:fs';
import path from 'node:path';
import { LawScanner } from '../parser/lawScanner.js';
import { EmbeddingService } from '../indexer/embeddingService.js';
import { QdrantService } from '../indexer/qdrantService.js';
import { LawArticleChunk } from '../types/law.js';
import { RAW_LAWS_DIR, INDEX_PROGRESS_FILE_PATH } from '../config/constants.js';

interface CliArgs {
  targetLaws?: string[];
  batchSize: number;
  limit?: number;
  force: boolean;
}

interface ProgressRecord {
  indexedLawDirs: string[];
  lastUpdated: string;
  totalArticlesIndexed: number;
}

function parseCliArgs(): CliArgs {
  const args = process.argv.slice(2);
  let targetLaws: string[] | undefined;
  let batchSize = 32;
  let limit: number | undefined;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--target' && i + 1 < args.length) {
      targetLaws = args[i + 1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      i++;
    } else if (arg.startsWith('--target=')) {
      targetLaws = arg
        .slice('--target='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg === '--batch' && i + 1 < args.length) {
      batchSize = parseInt(args[i + 1], 10) || 32;
      i++;
    } else if (arg.startsWith('--batch=')) {
      batchSize = parseInt(arg.slice('--batch='.length), 10) || 32;
    } else if (arg === '--limit' && i + 1 < args.length) {
      limit = parseInt(args[i + 1], 10) || undefined;
      i++;
    } else if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.slice('--limit='.length), 10) || undefined;
    } else if (arg === '--force') {
      force = true;
    }
  }

  return { targetLaws, batchSize, limit, force };
}

function loadProgress(progressFile: string): ProgressRecord {
  if (!fs.existsSync(progressFile)) {
    return { indexedLawDirs: [], lastUpdated: new Date().toISOString(), totalArticlesIndexed: 0 };
  }
  try {
    const raw = fs.readFileSync(progressFile, 'utf-8');
    return JSON.parse(raw) as ProgressRecord;
  } catch {
    return { indexedLawDirs: [], lastUpdated: new Date().toISOString(), totalArticlesIndexed: 0 };
  }
}

function saveProgress(progressFile: string, record: ProgressRecord): void {
  try {
    fs.writeFileSync(progressFile, JSON.stringify(record, null, 2), 'utf-8');
  } catch (error) {
    console.warn('⚠️ 체크포인트 파일 저장 실패:', error);
  }
}

async function runIndexLaws(): Promise<void> {
  const startTime = Date.now();
  const { targetLaws, batchSize, limit, force } = parseCliArgs();

  console.log('🚀 [대한민국 법령 벡터 인덱싱 파이프라인]');
  console.log(`📌 대상: ${targetLaws ? targetLaws.join(', ') : '전체 법령'}`);
  console.log(`⚙️ 임베딩 배치 크기: ${batchSize}`);
  console.log(`🔄 강제 재인덱싱 모드(--force): ${force ? '활성 (전체 덮어쓰기)' : '비활성 (체크포인트 이어서 진행)'}`);
  if (limit) {
    console.log(`⏱️ 최대 처리 법령 수(--limit): ${limit}개`);
  }

  const rawDir = RAW_LAWS_DIR;
  const progressFile = INDEX_PROGRESS_FILE_PATH;

  const scanner = new LawScanner();
  const embeddingService = EmbeddingService.getInstance({ batchSize });
  const qdrantService = new QdrantService();

  // 1. Qdrant 컬렉션 확인 및 생성
  console.log('\n[1/3] Qdrant 컬렉션 점검...');
  await qdrantService.ensureCollection();
  console.log(`✅ Qdrant 컬렉션 준비 완료: "${qdrantService.collectionName}"`);

  // 2. 법령 디렉터리 목록 조회
  console.log('\n[2/3] 법령 디렉터리 목록 수집 중...');
  const effectiveRawDir = LawScanner.resolveEffectiveDir(rawDir);
  let lawDirs = scanner.getLawDirectoryNames(effectiveRawDir, targetLaws);

  if (limit && limit > 0) {
    lawDirs = lawDirs.slice(0, limit);
  }

  const totalLawCount = lawDirs.length;
  console.log(`총 ${totalLawCount}개의 법령 디렉터리를 대상으로 인덱싱을 진행합니다.`);

  // 체크포인트 불러오기
  const progress = force
    ? { indexedLawDirs: [], lastUpdated: new Date().toISOString(), totalArticlesIndexed: 0 }
    : loadProgress(progressFile);
  const indexedSet = new Set<string>(progress.indexedLawDirs);

  // 3. 법령 디렉터리별 스트리밍 인덱싱 (법령 단위 파이프라인)
  console.log('\n[3/3] 법령 단위 [파싱 ➡️ 임베딩 ➡️ Qdrant 업서트] 순차 처리 시작\n');

  let processedCount = 0;
  let skippedCount = 0;
  let cumulativeArticles = progress.totalArticlesIndexed || 0;

  for (let idx = 0; idx < lawDirs.length; idx++) {
    const lawDirName = lawDirs[idx];
    const currentIndex = idx + 1;
    const progressPercent = ((currentIndex / totalLawCount) * 100).toFixed(1);

    // 이미 완료된 법령 스킵 처리
    if (!force && indexedSet.has(lawDirName)) {
      skippedCount++;
      continue;
    }

    const fullDirPath = path.join(effectiveRawDir, lawDirName);

    try {
      // 1) 개별 법령 파싱
      const parsedDocs = scanner.scanSingleLaw(fullDirPath, {
        onlyActiveStatus: true,
        keepLatestOnly: true,
      });

      if (parsedDocs.length === 0) {
        indexedSet.add(lawDirName);
        continue;
      }

      // 2) 조문 청크 수집
      const chunks: LawArticleChunk[] = [];
      for (const doc of parsedDocs) {
        chunks.push(...doc.chunks);
      }

      if (chunks.length === 0) {
        indexedSet.add(lawDirName);
        continue;
      }

      // 3) 임베딩 벡터 생성
      const textsToEmbed = chunks.map((c) => c.content);
      const vectors = await embeddingService.embedBatch(textsToEmbed, batchSize);

      // 4) Qdrant 즉시 업서트
      await qdrantService.upsertLawChunks(chunks, vectors, 64);

      processedCount++;
      cumulativeArticles += chunks.length;
      indexedSet.add(lawDirName);

      // 5) 체크포인트 주기적 저장
      saveProgress(progressFile, {
        indexedLawDirs: Array.from(indexedSet),
        lastUpdated: new Date().toISOString(),
        totalArticlesIndexed: cumulativeArticles,
      });

      const titles = parsedDocs.map((d) => d.metadata.제목).join(', ');
      console.log(
        `[${currentIndex}/${totalLawCount} (${progressPercent}%)] 📜 ${titles}: 조문 ${chunks.length}개 업서트 완료 (누적 조문: ${cumulativeArticles.toLocaleString()}개)`
      );
    } catch (lawError) {
      console.error(`\n⚠️ [${lawDirName}] 인덱싱 중 오류 발생 (건너뜀):`, lawError);
    }
  }

  // 최종 요약 출력
  const collectionInfo = await qdrantService.getCollectionInfo();
  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n==================================================');
  console.log(`🎉 인덱싱 작업 완료! 총 소요 시간: ${elapsedSec}초`);
  console.log(`📁 처리된 법령: ${processedCount}개 (이전 완료 스킵: ${skippedCount}개)`);
  console.log(`📑 적재된 누적 조문 수: ${cumulativeArticles.toLocaleString()}개`);
  console.log(`📊 Qdrant 컬렉션 전체 포인트: ${collectionInfo.points_count}개`);
  console.log('==================================================');
}

runIndexLaws().catch((error) => {
  console.error('\n❌ 인덱싱 중 치명적 오류 발생:', error);
  process.exit(1);
});
