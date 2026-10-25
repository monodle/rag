import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { LANCEDB_DIR, LANCEDB_ARCHIVE_FILE_NAME } from '../config/constants.js';
import { LanceDbService } from '../indexer/lanceDbService.js';
import { calculateSha256, getDirSizeBytesSync } from '../utils/fileUtils.js';
import { formatBytes } from '../utils/formatUtils.js';

const ARCHIVE_OUTPUT_DIR = path.resolve(process.cwd(), 'data');
const ARCHIVE_FILE_NAME = LANCEDB_ARCHIVE_FILE_NAME;
export const ARCHIVE_FILE_PATH = path.join(ARCHIVE_OUTPUT_DIR, ARCHIVE_FILE_NAME);
export const CHECKSUM_FILE_PATH = `${ARCHIVE_FILE_PATH}.sha256`;

/**
 * data/lancedb/ 디렉터리를 tar.gz 포맷으로 압축하고 SHA256 해시를 생성합니다.
 */
export async function packageDatabase(): Promise<{ archivePath: string; sha256: string; sizeMB: string }> {
  console.log('='.repeat(70));
  console.log('📦 [LanceDB 배포 패키징] 아카이브 압축 유틸리티');
  console.log('='.repeat(70));

  if (!fs.existsSync(LANCEDB_DIR)) {
    throw new Error(`LanceDB 데이터베이스 디렉터리가 없습니다: ${LANCEDB_DIR}\n먼저 'pnpm db:migrate'를 실행해 주세요.`);
  }

  // 패키징 전 구버전 트랜잭션 파일 정리 및 최적화
  try {
    console.log('🧹 LanceDB 테이블 최적화 및 오래된 트랜잭션 버전 정리 중...');
    const service = LanceDbService.getInstance();
    const table = await service.getTable();
    await table.optimize({ cleanupOlderThan: new Date() });
  } catch (err) {
    console.warn('⚠️ 테이블 최적화 건너뜀:', err);
  }

  const rawSizeBytes = getDirSizeBytesSync(LANCEDB_DIR);
  console.log(`📁 원본 LanceDB 디렉터리: ${LANCEDB_DIR} (${formatBytes(rawSizeBytes)})`);
  console.log(`🎯 출력 아카이브 파일: ${ARCHIVE_FILE_PATH}`);

  const startTime = Date.now();
  console.log('\n⏳ tar.gz 압축 진행 중... (약 10~20초 소요)');

  // 시스템 tar 명령을 사용하여 고속 스트리밍 압축 수행 (크로스플랫폼: macOS/Linux/Win10+ tar.exe 호환)
  await new Promise<void>((resolve, reject) => {
    const baseDir = path.dirname(LANCEDB_DIR);
    const targetFolder = path.basename(LANCEDB_DIR);

    const tarProcess = spawn('tar', ['-czf', ARCHIVE_FILE_PATH, '-C', baseDir, targetFolder], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });

    tarProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`tar 압축 프로세스가 종료 코드 ${code}로 실패했습니다.`));
      }
    });

    tarProcess.on('error', reject);
  });

  const compressedSizeBytes = fs.statSync(ARCHIVE_FILE_PATH).size;
  const compressedSizeMB = (compressedSizeBytes / (1024 * 1024)).toFixed(1);
  const compressionRatio = (((rawSizeBytes - compressedSizeBytes) / rawSizeBytes) * 100).toFixed(1);
  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`✅ 압축 완료! (소요 시간: ${elapsedSec}s)`);
  console.log(`   - 압축 전 용량: ${formatBytes(rawSizeBytes)}`);
  console.log(`   - 압축 후 용량: ${formatBytes(compressedSizeBytes)} (압축률: ${compressionRatio}% 절감)`);

  // SHA256 체크섬 계산
  console.log('\n🔐 SHA256 체크섬 계산 중...');
  const sha256 = await calculateSha256(ARCHIVE_FILE_PATH);
  fs.writeFileSync(CHECKSUM_FILE_PATH, `${sha256}  ${ARCHIVE_FILE_NAME}\n`, 'utf-8');

  console.log(`🔑 SHA256: ${sha256}`);
  console.log(`📄 체크섬 파일 저장: ${CHECKSUM_FILE_PATH}`);
  console.log('='.repeat(70));

  return {
    archivePath: ARCHIVE_FILE_PATH,
    sha256,
    sizeMB: compressedSizeMB,
  };
}

// 직접 CLI로 실행된 경우
if (process.argv[1] && process.argv[1].endsWith('packageDb.ts')) {
  packageDatabase().catch((err) => {
    console.error('❌ 패키징 중 오류 발생:', err);
    process.exit(1);
  });
}
