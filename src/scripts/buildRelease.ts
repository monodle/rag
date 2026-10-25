import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { INSTALLER_FILE_NAMES } from '../config/sharedConstants.js';

type TargetPlatform = 'mac' | 'win';

interface BuildConfig {
  readonly platform: TargetPlatform;
  readonly bundleTarget: string;
  readonly searchDirs: readonly string[];
  readonly fileExts: readonly string[];
  readonly outputFileName: string;
}

const PLATFORM_CONFIGS: Record<TargetPlatform, BuildConfig> = {
  mac: {
    platform: 'mac',
    bundleTarget: 'dmg',
    searchDirs: [
      path.resolve('src-tauri/target/release/bundle/dmg'),
      path.resolve('src-tauri/target/aarch64-apple-darwin/release/bundle/dmg'),
      path.resolve('src-tauri/target/x86_64-apple-darwin/release/bundle/dmg'),
    ],
    fileExts: ['.dmg'],
    outputFileName: INSTALLER_FILE_NAMES.macDmg,
  },
  win: {
    platform: 'win',
    bundleTarget: 'all',
    searchDirs: [
      path.resolve('src-tauri/target/release/bundle/msi'),
      path.resolve('src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi'),
      path.resolve('src-tauri/target/release/bundle/nsis'),
      path.resolve('src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis'),
      path.resolve('src-tauri/target/release/bundle'),
      path.resolve('src-tauri/target/x86_64-pc-windows-msvc/release/bundle'),
    ],
    fileExts: ['.msi', '.exe'],
    outputFileName: INSTALLER_FILE_NAMES.winMsi,
  },
};

/**
 * CLI 인자 또는 실행 환경에서 타겟 플랫폼 판별
 */
function resolvePlatform(): TargetPlatform {
  const args = process.argv.slice(2);
  const platformArgIndex = args.indexOf('--platform');

  if (platformArgIndex !== -1 && args[platformArgIndex + 1]) {
    const rawVal = args[platformArgIndex + 1].toLowerCase();
    if (rawVal === 'mac' || rawVal === 'darwin' || rawVal === 'macos') {
      return 'mac';
    }
    if (rawVal === 'win' || rawVal === 'windows' || rawVal === 'win32') {
      return 'win';
    }
    throw new Error(`지원하지 않는 플랫폼 옵션입니다: ${rawVal} ('mac' 또는 'win' 지정 필요)`);
  }

  if (process.platform === 'darwin') {
    return 'mac';
  }
  if (process.platform === 'win32') {
    return 'win';
  }

  throw new Error(`현재 OS(${process.platform})는 지원되지 않습니다. (--platform mac|win 옵션을 사용하세요)`);
}

/**
 * 프로세스를 실행하고 표준 입출력을 실시간 스트리밍
 */
function executeCommand(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`\n🚀 실행 명령: ${command} ${args.join(' ')}\n`);
    const proc = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      cwd: process.cwd(),
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`명령어 실행 실패 (종료 코드: ${code})`));
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * 번들 폴더에서 가장 최근 생성된 타겟 확장자 파일 탐색
 */
function findLatestBundleFile(
  searchDirs: readonly string[],
  extensions: readonly string[]
): string | null {
  const matchedFiles: { path: string; mtimeMs: number; size: number }[] = [];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;

    try {
      const entries = fs.readdirSync(dir, { recursive: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, String(entry));
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isFile() && extensions.some((ext) => fullPath.toLowerCase().endsWith(ext.toLowerCase()))) {
            matchedFiles.push({ path: fullPath, mtimeMs: stat.mtimeMs, size: stat.size });
          }
        } catch {
          // 파일 접근 오류 무시
        }
      }
    } catch {
      // 디렉터리 읽기 오류 무시
    }
  }

  if (matchedFiles.length === 0) {
    return null;
  }

  matchedFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return matchedFiles[0].path;
}

/**
 * 초경량 스마트 웹 인스톨러 배포 패키지 빌드
 */
async function main(): Promise<void> {
  const platform = resolvePlatform();
  const config = PLATFORM_CONFIGS[platform];
  const releaseDir = path.resolve('release');

  console.log('='.repeat(60));
  console.log(`📦 [${platform.toUpperCase()}] 초경량 스마트 웹 인스톨러 패키지 빌드 시작`);
  console.log(`- 번들 타겟: ${config.bundleTarget}`);
  console.log(`- 결과 파일명: ${config.outputFileName}`);
  console.log(`- 대상 릴리즈 폴더: ${releaseDir}`);
  console.log('='.repeat(60));

  // 1. release 디렉토리 사전 확보
  if (!fs.existsSync(releaseDir)) {
    fs.mkdirSync(releaseDir, { recursive: true });
  }

  // 2. UI 및 서버 번들 빌드
  console.log(`\n⚙️ UI 및 백엔드 번들 빌드...`);
  await executeCommand('pnpm', ['run', 'build:ui']);
  await executeCommand('pnpm', ['run', 'build:server']);

  // 3. Tauri 빌드 실행 (무거운 node_modules 없이 초경량 7MB 패키징)
  await executeCommand('pnpm', ['tauri', 'build', '--bundles', config.bundleTarget]);

  // 4. 빌드된 산출물 검색
  const sourcePath = findLatestBundleFile(config.searchDirs, config.fileExts);
  if (!sourcePath) {
    throw new Error(`빌드 산출물을 찾을 수 없습니다: ${config.searchDirs.join(', ')} 내 ${config.fileExts.join('/')} 파일 없음`);
  }

  const outFileName = sourcePath.toLowerCase().endsWith('.exe')
    ? INSTALLER_FILE_NAMES.winSetupExe
    : config.outputFileName;
  const destinationPath = path.join(releaseDir, outFileName);

  // 5. release/ 폴더로 복사
  console.log(`\n📋 파일 복사 중...`);
  console.log(`- 원본: ${sourcePath}`);
  console.log(`- 대상: ${destinationPath}`);

  fs.copyFileSync(sourcePath, destinationPath);

  const stats = fs.statSync(destinationPath);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);

  console.log('\n' + '='.repeat(60));
  console.log(`🎉 [${platform.toUpperCase()}] 초경량 스마트 웹 인스톨러 배포 빌드 완료!`);
  console.log(`- 파일: ${destinationPath}`);
  console.log(`- 크기: ${sizeMb} MB (초경량 패키지)`);
  console.log('='.repeat(60) + '\n');
}

main().catch((err: unknown) => {
  console.error('\n❌ 빌드 중 오류 발생:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
