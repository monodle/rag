import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { APP_CONFIG, APP_DATA_DIR, MODELS_DIR, LANCEDB_DIR, resolveLogsDir } from '../config/constants.js';
import { LlmManager } from './llmManager.js';
import { getVectorStoreService } from '../indexer/vectorStore.js';
import type { StorageBreakdown } from '../types/law.js';
import { formatBytes } from '../utils/formatUtils.js';
import { getDirectorySizeBytes } from '../utils/fileUtils.js';

export class SystemMaintenanceService {
  private static instance: SystemMaintenanceService;

  public static getInstance(): SystemMaintenanceService {
    if (!SystemMaintenanceService.instance) {
      SystemMaintenanceService.instance = new SystemMaintenanceService();
    }
    return SystemMaintenanceService.instance;
  }

  /**
   * 앱 데이터의 최상위 루트 디렉토리 반환
   * - macOS: ~/Library/Application Support/korean-law-chat
   * - Windows: %APPDATA%/korean-law-chat
   */
  public getAppDataRootDir(): string {
    return path.dirname(APP_DATA_DIR);
  }

  /**
   * 각 디렉토리별 스토리지 점유량(Bytes) 계산
   */
  public async getStorageUsage(): Promise<StorageBreakdown> {
    const rootDir = this.getAppDataRootDir();
    const lancedbDir = LANCEDB_DIR;
    const qdrantDir = path.join(APP_DATA_DIR, 'qdrant');
    const engineDir = path.join(rootDir, 'engine');
    const logsDir = resolveLogsDir();

    const [totalBytes, modelsBytes, lancedbBytes, qdrantBytes, engineBytes, logsBytes] =
      await Promise.all([
        getDirectorySizeBytes(rootDir),
        getDirectorySizeBytes(MODELS_DIR),
        getDirectorySizeBytes(lancedbDir),
        getDirectorySizeBytes(qdrantDir),
        getDirectorySizeBytes(engineDir),
        getDirectorySizeBytes(logsDir),
      ]);

    const databaseBytes = lancedbBytes + qdrantBytes;

    return {
      totalBytes,
      modelsBytes,
      databaseBytes,
      engineBytes,
      logsBytes,
      formattedTotal: formatBytes(totalBytes),
      formattedModels: formatBytes(modelsBytes),
      formattedDatabase: formatBytes(databaseBytes),
      formattedEngine: formatBytes(engineBytes),
      formattedLogs: formatBytes(logsBytes),
      appDataRoot: rootDir,
    };
  }

  /**
   * 백엔드 리소스(LLM 세션, DB 연결) 안전 해제
   */
  public async releaseResources(): Promise<void> {
    try {
      console.log('[SystemMaintenance] 🛑 모델 및 백엔드 리소스 정리 중...');
      const llmManager = LlmManager.getInstance();
      await llmManager.unloadModel().catch(() => {});

      const vectorStore = getVectorStoreService();
      if ('close' in vectorStore && typeof (vectorStore as any).close === 'function') {
        await (vectorStore as any).close().catch(() => {});
      }
    } catch (err) {
      console.warn('[SystemMaintenance] 리소스 정리 중 경고:', err);
    }
  }

  /**
   * OS별 관련된 모든 찌꺼기/데이터 디렉토리 목록 수집
   */
  public getTargetDataDirectories(): string[] {
    const home = os.homedir();
    const targets: string[] = [];
    const rootDir = this.getAppDataRootDir();

    targets.push(rootDir);
    targets.push(APP_DATA_DIR);
    targets.push(MODELS_DIR);
    targets.push(resolveLogsDir());

    if (process.platform === 'darwin') {
      targets.push(path.join(home, 'Library', 'Application Support', APP_CONFIG.name));
      targets.push(path.join(home, 'Library', 'Logs', APP_CONFIG.name));
      targets.push(path.join(home, 'Library', 'Caches', APP_CONFIG.bundleId));
      targets.push(path.join(home, 'Library', 'WebKit', APP_CONFIG.bundleId));
      targets.push(path.join(home, 'Library', 'Saved Application State', `${APP_CONFIG.bundleId}.savedState`));
    } else if (process.platform === 'win32') {
      const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');

      targets.push(path.join(appData, APP_CONFIG.name));
      targets.push(path.join(localAppData, APP_CONFIG.name));
      targets.push(path.join(localAppData, APP_CONFIG.bundleId));
      targets.push(path.join(appData, APP_CONFIG.bundleId));
    } else {
      targets.push(path.join(home, '.local', 'share', APP_CONFIG.name));
      targets.push(path.join(home, '.local', 'state', APP_CONFIG.name));
      targets.push(path.join(home, '.cache', APP_CONFIG.name));
    }

    // 중복 제거 및 존재하는 경로만 필터링
    return Array.from(new Set(targets));
  }

  /**
   * 사용자 데이터 초기화 (앱은 유지, 데이터만 삭제)
   */
  public async resetData(): Promise<{ success: boolean; deletedPaths: string[] }> {
    await this.releaseResources();

    const deletedPaths: string[] = [];
    const targets = this.getTargetDataDirectories();

    for (const target of targets) {
      if (fs.existsSync(target)) {
        try {
          await fsp.rm(target, { recursive: true, force: true });
          deletedPaths.push(target);
          console.log(`[SystemMaintenance] 🗑️ 데이터 디렉토리 삭제 완료: ${target}`);
        } catch (err) {
          console.error(`[SystemMaintenance] ❌ 삭제 실패: ${target}`, err);
        }
      }
    }

    return { success: true, deletedPaths };
  }

  /**
   * macOS .app 번들 위치 탐색
   */
  public findMacAppBundlePath(): string | null {
    if (process.platform !== 'darwin') return null;

    // 1. process.execPath 기반 탐색 (.../korean-law-chat.app/Contents/MacOS/...)
    const execPath = process.execPath;
    const match = execPath.match(/(.+\.app)(?:\/Contents\/MacOS\/.*)?$/);
    if (match && fs.existsSync(match[1])) {
      return match[1];
    }

    // 2. 표준 설치 디렉토리 확인
    const appBundleName = `${APP_CONFIG.name}.app`;
    const standardCandidates = [
      path.join('/Applications', appBundleName),
      path.join(os.homedir(), 'Applications', appBundleName),
    ];

    for (const candidate of standardCandidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Windows NSIS 언인스톨러 경로 탐색
   */
  public findWindowsUninstallerPath(): string | null {
    if (process.platform !== 'win32') return null;

    const home = os.homedir();
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    const uninstallerName = `Uninstall ${APP_CONFIG.name}.exe`;
    const candidates = [
      path.join(localAppData, 'Programs', APP_CONFIG.name, uninstallerName),
      path.join(programFiles, APP_CONFIG.name, uninstallerName),
      path.join(programFilesX86, APP_CONFIG.name, uninstallerName),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * 앱 및 데이터 완전 삭제 (Uninstall)
   */
  public async uninstallApplication(): Promise<{ success: boolean; message: string }> {
    await this.releaseResources();

    // 1. 데이터 디렉토리 우선 정리
    const targets = this.getTargetDataDirectories();
    for (const target of targets) {
      if (fs.existsSync(target)) {
        try {
          await fsp.rm(target, { recursive: true, force: true });
        } catch {
          // 언인스톨 후속 스크립트에서도 삭제 시도
        }
      }
    }

    // 2. OS별 앱 프로그램 파일 제거 및 프로세스 종료
    if (process.platform === 'darwin') {
      const appBundle = this.findMacAppBundlePath();
      if (appBundle) {
        console.log(`[SystemMaintenance] 🍏 macOS 앱 번들을 휴지통으로 이동합니다: ${appBundle}`);
        // Finder를 통해 휴지통으로 이동 후 앱 프로세스 종료 스크립트 실행
        const script = `
          tell application "Finder" to move POSIX file "${appBundle}" to trash
          do shell script "sleep 0.5 && killall ${APP_CONFIG.name} || true"
        `;
        spawn('osascript', ['-e', script], {
          detached: true,
          stdio: 'ignore',
        }).unref();
      } else {
        // 앱 번들을 못 찾은 경우 프로세스만 종료
        spawn('sh', ['-c', `sleep 0.5 && killall ${APP_CONFIG.name} || true`], {
          detached: true,
          stdio: 'ignore',
        }).unref();
      }
    } else if (process.platform === 'win32') {
      const uninstaller = this.findWindowsUninstallerPath();
      if (uninstaller) {
        console.log(`[SystemMaintenance] 🪟 Windows NSIS 언인스톨러를 시작합니다: ${uninstaller}`);
        // 언인스톨러 실행 후 현재 앱 프로세스 강제 종료
        const batScript = `@echo off
timeout /t 1 /nobreak > nul
taskkill /F /IM ${APP_CONFIG.name}.exe > nul 2>&1
start "" "${uninstaller}"
exit
`;
        const tempBat = path.join(os.tmpdir(), `korean_law_uninstall_${Date.now()}.bat`);
        await fsp.writeFile(tempBat, batScript, 'utf8');

        spawn('cmd.exe', ['/c', tempBat], {
          detached: true,
          stdio: 'ignore',
        }).unref();
      } else {
        // 포터블/개발 환경: 데이터 정리 및 프로세스 종료
        const batScript = `@echo off
timeout /t 1 /nobreak > nul
taskkill /F /IM ${APP_CONFIG.name}.exe > nul 2>&1
exit
`;
        const tempBat = path.join(os.tmpdir(), `korean_law_kill_${Date.now()}.bat`);
        await fsp.writeFile(tempBat, batScript, 'utf8');

        spawn('cmd.exe', ['/c', tempBat], {
          detached: true,
          stdio: 'ignore',
        }).unref();
      }
    }

    // 3. 백엔드 프로세스 종료 타이머
    setTimeout(() => {
      process.exit(0);
    }, 1000);

    return {
      success: true,
      message: '앱 완전 삭제 절차가 시작되었습니다. 잠시 후 애플리케이션이 종료됩니다.',
    };
  }
}
