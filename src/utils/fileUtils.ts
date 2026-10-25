import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * 대용량 파일의 SHA256 체크섬을 스트리밍 방식으로 비동기 계산합니다 (Single Source of Truth).
 * 
 * @param filePath 대상 파일 절대 또는 상대 경로
 * @returns 16진수 SHA256 해시 문자열
 */
export async function calculateSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * 디렉터리 내부 파일들의 총 바이트 크기를 재귀적으로 비동기 계산합니다 (Single Source of Truth).
 * 
 * @param dirPath 대상 디렉터리 경로
 * @returns 총 바이트 크기
 */
export async function getDirectorySizeBytes(dirPath: string): Promise<number> {
  if (!fs.existsSync(dirPath)) {
    return 0;
  }

  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    let total = 0;

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          total += await getDirectorySizeBytes(fullPath);
        } else if (entry.isFile()) {
          const stat = await fs.promises.stat(fullPath);
          total += stat.size;
        }
      } catch {
        // 읽기 권한 없음 또는 삭제된 파일 무시
      }
    }

    return total;
  } catch {
    return 0;
  }
}

/**
 * 디렉터리 내부 파일들의 총 바이트 크기를 재귀적으로 동기 계산합니다 (CLI 스크립트용 SSOT).
 * 
 * @param dirPath 대상 디렉터리 경로
 * @returns 총 바이트 크기
 */
export function getDirSizeBytesSync(dirPath: string): number {
  if (!fs.existsSync(dirPath)) {
    return 0;
  }

  try {
    let totalSize = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        totalSize += getDirSizeBytesSync(fullPath);
      } else if (entry.isFile()) {
        totalSize += fs.statSync(fullPath).size;
      }
    }
    return totalSize;
  } catch {
    return 0;
  }
}
