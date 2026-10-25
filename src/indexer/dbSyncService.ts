import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  LANCEDB_DIR,
  DEFAULT_LANCEDB_RELEASE_URL,
} from '../config/constants.js';
import { LanceDbService } from './lanceDbService.js';
import type { DbSyncProgress } from '../types/law.js';

export class DbSyncService {
  private static instance: DbSyncService | null = null;
  private isSyncing: boolean = false;
  private currentProgress: DbSyncProgress = {
    status: 'checking',
    percent: 0,
    downloadedMB: '0.0',
    totalMB: '0.0',
    message: '데이터베이스 상태를 점검 중입니다.',
  };
  private listeners: Array<(progress: DbSyncProgress) => void> = [];

  private constructor() {}

  public static getInstance(): DbSyncService {
    if (!DbSyncService.instance) {
      DbSyncService.instance = new DbSyncService();
    }
    return DbSyncService.instance;
  }

  public getProgress(): DbSyncProgress {
    return { ...this.currentProgress };
  }

  public onProgress(listener: (progress: DbSyncProgress) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(update: Partial<DbSyncProgress>) {
    this.currentProgress = { ...this.currentProgress, ...update };
    for (const listener of this.listeners) {
      try {
        listener(this.currentProgress);
      } catch (err) {
        console.error('Progress listener error:', err);
      }
    }
  }

  /**
   * 로컬 LanceDB 데이터가 준비되어 있는지 검사합니다.
   */
  public async isDatabaseReady(): Promise<boolean> {
    try {
      if (!fs.existsSync(LANCEDB_DIR)) {
        return false;
      }
      const lanceService = LanceDbService.getInstance();
      const hasTable = await lanceService.hasTable();
      if (!hasTable) {
        return false;
      }
      const info = await lanceService.getCollectionInfo();
      return info.points_count > 0;
    } catch {
      return false;
    }
  }

  /**
   * GitHub Releases에서 사전 구축된 LanceDB 아카이브를 다운로드하여 압축 해제합니다.
   */
  public async syncDatabase(customUrl?: string): Promise<void> {
    if (this.isSyncing) {
      throw new Error('데이터베이스 동기화가 이미 진행 중입니다.');
    }

    const downloadUrl = customUrl || DEFAULT_LANCEDB_RELEASE_URL;
    this.isSyncing = true;

    try {
      const targetDir = path.dirname(LANCEDB_DIR);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const tempArchivePath = path.join(targetDir, 'korean_laws_download_temp.tar.gz');

      // 1. 다운로드 스트림 시작
      this.notify({
        status: 'downloading',
        percent: 0,
        downloadedMB: '0.0',
        totalMB: '0.0',
        message: 'GitHub Releases에서 법률 데이터베이스 다운로드 시작...',
      });

      console.log(`📥 [DbSync] 법령 벡터 DB 다운로드 시작: ${downloadUrl}`);
      const response = await fetch(downloadUrl, { redirect: 'follow' });

      if (!response.ok || !response.body) {
        throw new Error(`다운로드 실패: HTTP ${response.status} (${response.statusText})`);
      }

      const contentLengthHeader = response.headers.get('content-length');
      const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
      const totalMB = totalBytes > 0 ? (totalBytes / (1024 * 1024)).toFixed(1) : '0.0';

      let downloadedBytes = 0;
      const fileStream = fs.createWriteStream(tempArchivePath);
      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (value) {
          fileStream.write(Buffer.from(value));
          downloadedBytes += value.length;
          const percent = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
          const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(1);

          this.notify({
            status: 'downloading',
            percent,
            downloadedMB,
            totalMB,
            message: `데이터베이스 다운로드 중... (${percent}%)`,
          });
        }
      }

      await new Promise<void>((resolve, reject) => {
        fileStream.end((err?: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // 2. 압축 해제
      this.notify({
        status: 'extracting',
        percent: 100,
        message: '다운로드 완료! 로컬 스토리지에 압축 해제 중...',
      });
      console.log('📦 [DbSync] 다운로드 완료, 압축 해제 진행 중...');

      await new Promise<void>((resolve, reject) => {
        const tarProcess = spawn('tar', ['-xzf', tempArchivePath, '-C', targetDir], {
          stdio: ['ignore', 'inherit', 'inherit'],
          windowsHide: true,
        });

        tarProcess.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`tar 압축 해제 실패 (종료 코드 ${code})`));
        });

        tarProcess.on('error', reject);
      });

      // 임시 다운로드 파일 정리
      if (fs.existsSync(tempArchivePath)) {
        fs.unlinkSync(tempArchivePath);
      }

      // 3. 무결성 및 인덱스 점검
      this.notify({
        status: 'verifying',
        percent: 100,
        message: '데이터베이스 정합성 및 인덱스 점검 중...',
      });

      const lanceService = LanceDbService.getInstance();
      lanceService.resetCache();
      const info = await lanceService.getCollectionInfo();

      this.notify({
        status: 'completed',
        percent: 100,
        message: `동기화 완료! 총 ${info.points_count.toLocaleString()}개 조문이 준비되었습니다.`,
      });
      console.log(`✨ [DbSync] 동기화 완료: ${info.points_count.toLocaleString()}건 조문 로드 성공`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.notify({
        status: 'error',
        message: `동기화 실패: ${msg}`,
      });
      console.error('❌ [DbSync] 동기화 중 에러 발생:', error);
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }
}
