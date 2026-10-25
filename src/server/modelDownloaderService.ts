import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { MODELS_DIR, APP_CONFIG, APP_VERSION } from '../config/constants.js';
import type { HfGgufItem, ModelDownloadProgress } from '../types/law.js';
import { formatBytes } from '../utils/formatUtils.js';

export class ModelDownloaderService {
  private static instance: ModelDownloaderService | null = null;

  private isDownloading: boolean = false;
  private abortController: AbortController | null = null;
  private currentProgress: ModelDownloadProgress = {
    status: 'idle',
    repo: '',
    filename: '',
    percent: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    downloadedMB: '0.0',
    totalMB: '0.0',
    speedMBs: '0.0',
    message: '대기 중',
  };

  private listeners: Array<(progress: ModelDownloadProgress) => void> = [];

  private constructor() {}

  public static getInstance(): ModelDownloaderService {
    if (!ModelDownloaderService.instance) {
      ModelDownloaderService.instance = new ModelDownloaderService();
    }
    return ModelDownloaderService.instance;
  }

  public getProgress(): ModelDownloadProgress {
    return { ...this.currentProgress };
  }

  public onProgress(listener: (progress: ModelDownloadProgress) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(update: Partial<ModelDownloadProgress>): void {
    this.currentProgress = { ...this.currentProgress, ...update };
    for (const listener of this.listeners) {
      try {
        listener(this.currentProgress);
      } catch (err) {
        console.error('⚠️ [ModelDownloader] Listener error:', err);
      }
    }
  }

  /**
   * Hugging Face 저장소의 메인 브랜치에서 .gguf 파일 목록을 조회합니다.
   */
  public async fetchHfGgufList(repoId: string): Promise<HfGgufItem[]> {
    const trimmedRepo = repoId.trim();
    if (!trimmedRepo) {
      throw new Error('저장소 식별자(repo_id)가 제공되지 않았습니다.');
    }

    const url = `https://huggingface.co/api/models/${trimmedRepo}/tree/main`;
    const res = await fetch(url, { headers: { 'User-Agent': `${APP_CONFIG.name}/${APP_VERSION}` } });

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`저장소를 찾을 수 없습니다: ${trimmedRepo}`);
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error(`접근 권한이 필요하거나 비공개/Gated 저장소입니다: ${trimmedRepo}`);
      }
      throw new Error(`Hugging Face API 오류 (${res.status} ${res.statusText})`);
    }

    const items = (await res.json()) as Array<{ type: string; path: string; size?: number }>;
    if (!Array.isArray(items)) {
      return [];
    }

    return items
      .filter((item) => item.type === 'file' && item.path.toLowerCase().endsWith('.gguf'))
      .map((item) => {
        const size = item.size ?? 0;
        return {
          path: item.path,
          size,
          sizeFormatted: formatBytes(size),
        };
      });
  }

  /**
   * Hugging Face 모델 파일 다운로드를 시작합니다.
   */
  public async startDownload(repoId: string, filePath: string): Promise<string> {
    if (this.isDownloading) {
      throw new Error('이미 다른 모델 다운로드가 진행 중입니다.');
    }

    const trimmedRepo = repoId.trim();
    const cleanFileName = path.basename(filePath.trim());
    if (!trimmedRepo || !cleanFileName) {
      throw new Error('저장소 및 파일 경로가 올바르지 않습니다.');
    }

    if (!fs.existsSync(MODELS_DIR)) {
      await fs.promises.mkdir(MODELS_DIR, { recursive: true });
    }

    const destPath = path.join(MODELS_DIR, cleanFileName);
    const tempPath = path.join(MODELS_DIR, `${cleanFileName}.download`);

    const downloadUrl = `https://huggingface.co/${trimmedRepo}/resolve/main/${filePath}`;
    this.isDownloading = true;
    this.abortController = new AbortController();

    this.notify({
      status: 'downloading',
      repo: trimmedRepo,
      filename: cleanFileName,
      percent: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      downloadedMB: '0.0',
      totalMB: '0.0',
      speedMBs: '0.0',
      message: `${cleanFileName} 연결 준비 중...`,
    });

    console.log(`📥 [ModelDownloader] 다운로드 시작: ${downloadUrl} -> ${destPath}`);

    try {
      const response = await fetch(downloadUrl, {
        redirect: 'follow',
        signal: this.abortController.signal,
        headers: { 'User-Agent': 'KoreanLawRAG/1.0' },
      });

      if (!response.ok || !response.body) {
        throw new Error(`다운로드 실패: HTTP ${response.status} (${response.statusText})`);
      }

      const contentLengthHeader = response.headers.get('content-length');
      const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
      const totalMB = totalBytes > 0 ? (totalBytes / (1024 * 1024)).toFixed(1) : '계산 중';

      const fileStream = fs.createWriteStream(tempPath);
      let downloadedBytes = 0;
      const startTime = Date.now();
      let lastNotifyTime = 0;

      const nodeReadable = Readable.fromWeb(response.body as any);

      nodeReadable.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length;
        const now = Date.now();

        // 150ms 단위 throttled 업데이트
        if (now - lastNotifyTime >= 150 || (totalBytes > 0 && downloadedBytes === totalBytes)) {
          lastNotifyTime = now;
          const elapsedSec = (now - startTime) / 1000;
          const speedBytes = elapsedSec > 0 ? downloadedBytes / elapsedSec : 0;
          const speedMBs = (speedBytes / (1024 * 1024)).toFixed(1);
          const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
          const percent = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 1000) / 10) : 0;

          this.notify({
            status: 'downloading',
            percent,
            downloadedBytes,
            totalBytes,
            downloadedMB,
            totalMB,
            speedMBs,
            message: `${cleanFileName} 다운로드 중...`,
          });
        }
      });

      await finished(nodeReadable.pipe(fileStream));

      // 다운로드 완료: 임시 파일명을 정식 파일명으로 교체
      await fs.promises.rename(tempPath, destPath);

      this.isDownloading = false;
      this.abortController = null;

      this.notify({
        status: 'completed',
        percent: 100,
        downloadedMB: (downloadedBytes / (1024 * 1024)).toFixed(1),
        message: `${cleanFileName} 다운로드 완료!`,
      });

      console.log(`✅ [ModelDownloader] 모델 다운로드 및 저장 완료: ${cleanFileName}`);
      return cleanFileName;
    } catch (err: any) {
      this.isDownloading = false;
      this.abortController = null;

      // 임시 파일 정리
      if (fs.existsSync(tempPath)) {
        try {
          await fs.promises.unlink(tempPath);
        } catch {
          // 무시
        }
      }

      const errorMessage = err?.name === 'AbortError' ? '다운로드가 취소되었습니다.' : (err?.message || '다운로드 실패');
      this.notify({
        status: 'error',
        message: errorMessage,
      });

      console.error('❌ [ModelDownloader] 다운로드 오류:', err);
      throw new Error(errorMessage);
    }
  }

  /**
   * 진행 중인 다운로드를 취소합니다.
   */
  public cancelDownload(): boolean {
    if (!this.isDownloading || !this.abortController) {
      return false;
    }
    this.abortController.abort();
    return true;
  }
}
