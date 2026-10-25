import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ENGINE_ARCHIVE_NAMES, APP_VERSION, APP_CONFIG } from '../config/constants.js';
import { calculateSha256 } from '../utils/fileUtils.js';

type TargetPlatform = 'mac' | 'win';

interface EngineConfig {
  readonly platform: TargetPlatform;
  readonly archiveName: string;
  readonly nodeBinaryName: string;
}

const PLATFORM_CONFIGS: Record<TargetPlatform, EngineConfig> = {
  mac: {
    platform: 'mac',
    archiveName: ENGINE_ARCHIVE_NAMES.mac,
    nodeBinaryName: 'node',
  },
  win: {
    platform: 'win',
    archiveName: ENGINE_ARCHIVE_NAMES.win,
    nodeBinaryName: 'node.exe',
  },
};

/**
 * 쉘 명령 비동기 실행 및 실시간 출력
 */
function executeCommand(command: string, args: readonly string[], cwd = process.cwd()): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`\n🚀 [명령 실행] ${command} ${args.join(' ')} (CWD: ${cwd})`);
    const proc = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      cwd,
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`명령어 실행 실패 (코드: ${code}): ${command} ${args.join(' ')}`));
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}


/**
 * 디렉터리 재귀 복사
 */
function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * 현재 시스템의 Node 바이너리 절대 경로 탐색
 */
function resolveSystemNodeBinary(): string {
  if (process.platform === 'win32') {
    return process.execPath;
  }
  // macOS / Linux의 경우 심볼릭 링크를 해석한 실제 바이너리 경로
  return fs.realpathSync(process.execPath);
}

/**
 * 백엔드 엔진 독립 패키징
 */
async function main(): Promise<void> {
  const isUpload = process.argv.includes('--upload');
  const platform: TargetPlatform = process.platform === 'win32' ? 'win' : 'mac';
  const config = PLATFORM_CONFIGS[platform];

  const releaseDir = path.resolve('release');
  const stagingDir = path.resolve('dist-engine');
  const targetArchive = path.join(releaseDir, config.archiveName);
  const targetChecksum = `${targetArchive}.sha256`;

  console.log('='.repeat(65));
  console.log(`📦 [스마트 웹 인스톨러] 백엔드 엔진 패키징 (${platform.toUpperCase()})`);
  console.log(`- 결과 압축 파일: ${targetArchive}`);
  console.log(`- GitHub Release 자동 업로드: ${isUpload ? '예' : '아니오'}`);
  console.log('='.repeat(65));

  // 1. 디렉토리 정리 및 준비
  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.mkdirSync(releaseDir, { recursive: true });

  // 2. 서버 번들 빌드
  console.log(`\n⚙️ 백엔드 서버 번들 빌드 중...`);
  await executeCommand('pnpm', ['run', 'build:server']);

  // 3. dist-server 복사
  console.log(`\n📋 서버 번들 파일 복사 중...`);
  copyDirSync(path.resolve('dist-server'), path.join(stagingDir, 'dist-server'));

  // 4. prompts 복사
  if (fs.existsSync(path.resolve('prompts'))) {
    console.log(`📋 프롬프트 템플릿 복사 중...`);
    copyDirSync(path.resolve('prompts'), path.join(stagingDir, 'prompts'));
  }

  // 5. Node 바이너리 포함
  const nodeBinarySrc = resolveSystemNodeBinary();
  const nodeBinaryDest = path.join(stagingDir, config.nodeBinaryName);
  console.log(`\n📋 Node 바이너리 복사: ${nodeBinarySrc} -> ${nodeBinaryDest}`);
  fs.copyFileSync(nodeBinarySrc, nodeBinaryDest);
  if (platform === 'mac') {
    fs.chmodSync(nodeBinaryDest, 0o755);
  }

  // 6. 경량 package.json 생성 (루트 package.json의 version 및 dependencies를 단일 진실 공급원으로 동적 연동)
  const rootPkgPath = path.resolve('package.json');
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
  const targetDeps = [
    '@huggingface/transformers',
    '@lancedb/lancedb',
    '@qdrant/js-client-rest',
    'dotenv',
    'gray-matter',
    'node-llama-cpp',
    'onnxruntime-node',
  ];

  const engineDependencies: Record<string, string> = {};
  for (const dep of targetDeps) {
    if (rootPkg.dependencies?.[dep]) {
      engineDependencies[dep] = rootPkg.dependencies[dep];
    } else {
      throw new Error(`루트 package.json에 필수 엔진 의존성 [${dep}]이 정의되어 있지 않습니다.`);
    }
  }

  const enginePackageJson = {
    name: 'korean-law-engine',
    version: APP_VERSION,
    type: 'module',
    dependencies: engineDependencies,
  };
  fs.writeFileSync(
    path.join(stagingDir, 'package.json'),
    JSON.stringify(enginePackageJson, null, 2),
    'utf-8'
  );

  // 7. 순수 프로덕션 의존성 설치
  console.log(`\n📥 프로덕션 의존성 모듈 설치 중...`);
  await executeCommand('npm', ['install', '--omit=dev', '--no-package-lock'], stagingDir);

  // 8. 불필요한 타 플랫폼 바이너리 및 불필요 파일 가지치기 (최적화)
  console.log(`\n✂️ 용량 최적화 (불필요한 타 플랫폼 바이너리 정리)...`);
  const onnxNapiDir = path.join(stagingDir, 'node_modules/onnxruntime-node/bin/napi-v6');
  if (fs.existsSync(onnxNapiDir)) {
    if (platform === 'mac') {
      fs.rmSync(path.join(onnxNapiDir, 'linux'), { recursive: true, force: true });
      fs.rmSync(path.join(onnxNapiDir, 'win32'), { recursive: true, force: true });
    } else if (platform === 'win') {
      fs.rmSync(path.join(onnxNapiDir, 'linux'), { recursive: true, force: true });
      fs.rmSync(path.join(onnxNapiDir, 'darwin'), { recursive: true, force: true });
    }
  }

  // 불필요한 onnxruntime-web 및 @typescript 컴파일러 제거
  fs.rmSync(path.join(stagingDir, 'node_modules/onnxruntime-web'), { recursive: true, force: true });
  fs.rmSync(path.join(stagingDir, 'node_modules/@typescript'), { recursive: true, force: true });

  // 9. 압축 아카이브 생성
  console.log(`\n🗜️ 엔진 압축 중 (${config.archiveName})...`);
  if (fs.existsSync(targetArchive)) {
    fs.rmSync(targetArchive, { force: true });
  }

  await executeCommand('tar', ['-czf', targetArchive, '-C', stagingDir, '.']);

  // 10. 체크섬 생성
  const checksum = await calculateSha256(targetArchive);
  fs.writeFileSync(targetChecksum, `${checksum}  ${config.archiveName}\n`, 'utf-8');

  const stats = fs.statSync(targetArchive);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);

  console.log('\n' + '='.repeat(65));
  console.log(`✅ 엔진 패키징 완료!`);
  console.log(`- 파일: ${targetArchive}`);
  console.log(`- 크기: ${sizeMb} MB`);
  console.log(`- SHA256: ${checksum}`);
  console.log('='.repeat(65));

  // 11. GitHub Release 업로드 (옵션)
  if (isUpload) {
    const releaseTag = `v${APP_VERSION}`;
    console.log(`\n🚀 GitHub Release (${releaseTag})로 엔진 파일 업로드 중...`);
    // 릴리즈 존재 여부 확인 후 create 또는 upload
    try {
      await executeCommand('gh', [
        'release',
        'upload',
        releaseTag,
        targetArchive,
        targetChecksum,
        '--clobber',
      ]);
    } catch {
      console.log(`릴리즈 ${releaseTag}가 존재하지 않아 새로 생성합니다...`);
      await executeCommand('gh', [
        'release',
        'create',
        releaseTag,
        targetArchive,
        targetChecksum,
        '--title',
        `Korean Law RAG Engine ${releaseTag}`,
        '--notes',
        '초경량 스마트 웹 인스톨러 구동용 백엔드 엔진 런타임',
      ]);
    }
    console.log(`🎉 GitHub Release 업로드 완료: https://github.com/${APP_CONFIG.githubRepo}/releases/tag/${releaseTag}`);
  }
}

main().catch((err: unknown) => {
  console.error('\n❌ 엔진 패키징 실패:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
