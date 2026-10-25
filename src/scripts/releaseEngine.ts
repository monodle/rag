import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ENGINE_ARCHIVE_NAMES,
  APP_CONFIG,
  DEFAULT_ENGINE_RELEASE_TAG,
  DEFAULT_INSTALLER_RELEASE_TAG,
  DEFAULT_LANCEDB_RELEASE_TAG,
} from '../config/constants.js';
import { packageEngine } from './packageEngine.js';

interface EngineAsset {
  readonly fileName: string;
  readonly filePath: string;
  readonly sizeMb: string;
}

/**
 * 릴리즈 태그가 타 채널(설치 파일, 벡터 DB)과 충돌하지 않는지 방어 검증합니다.
 */
function validateReleaseTag(tag: string): void {
  if (tag === DEFAULT_INSTALLER_RELEASE_TAG) {
    throw new Error(
      `[오배포 방지] 설치 파일 전용 릴리즈 태그('${tag}')로 백엔드 엔진을 배포할 수 없습니다.\n` +
      `엔진 런타임은 반드시 '${DEFAULT_ENGINE_RELEASE_TAG}' 릴리즈 채널에 배포되어야 합니다.`
    );
  }

  if (tag === DEFAULT_LANCEDB_RELEASE_TAG || tag.startsWith('data-')) {
    throw new Error(
      `[오배포 방지] 벡터 데이터베이스 전용 릴리즈 태그('${tag}')로 백엔드 엔진을 배포할 수 없습니다.\n` +
      `엔진 런타임은 반드시 '${DEFAULT_ENGINE_RELEASE_TAG}' 릴리즈 채널에 배포되어야 합니다.`
    );
  }
}

/**
 * GitHub CLI(gh) 설치 및 로그인 상태를 방어적으로 확인합니다.
 */
function verifyGhCli(): void {
  const versionCheck = spawnSync('gh', ['--version'], { encoding: 'utf-8' });
  if (versionCheck.status !== 0) {
    console.error('❌ GitHub CLI(gh)가 설치되어 있지 않습니다.');
    console.error('👉 https://cli.github.com 에서 gh 설치 후 `gh auth login`을 진행하세요.');
    process.exit(1);
  }

  const authCheck = spawnSync('gh', ['auth', 'status'], { encoding: 'utf-8' });
  if (authCheck.status !== 0) {
    console.error('❌ GitHub CLI 인증이 만료되었거나 로그인되어 있지 않습니다.');
    console.error('👉 터미널에서 `gh auth login` 명령을 실행하여 계정을 연결하세요.');
    process.exit(1);
  }
}

/**
 * release 디렉토리에서 존재하는 모든 플랫폼의 백엔드 엔진 아카이브 및 체크섬을 수집합니다.
 */
function collectEngineAssets(releaseDir: string): { uploadFiles: string[]; assets: EngineAsset[] } {
  const allEngineFiles = [
    ENGINE_ARCHIVE_NAMES.mac,
    `${ENGINE_ARCHIVE_NAMES.mac}.sha256`,
    ENGINE_ARCHIVE_NAMES.win,
    `${ENGINE_ARCHIVE_NAMES.win}.sha256`,
  ];

  const uploadFiles: string[] = [];
  const assets: EngineAsset[] = [];

  for (const fileName of allEngineFiles) {
    const fullPath = path.join(releaseDir, fileName);
    if (fs.existsSync(fullPath)) {
      uploadFiles.push(fullPath);
      if (fileName.endsWith('.tar.gz')) {
        const stats = fs.statSync(fullPath);
        assets.push({
          fileName,
          filePath: fullPath,
          sizeMb: (stats.size / (1024 * 1024)).toFixed(2),
        });
      }
    }
  }

  return { uploadFiles, assets };
}

/**
 * 백엔드 엔진 아카이브를 GitHub Release에 자동 배포합니다.
 */
async function releaseEngine(): Promise<void> {
  console.log('='.repeat(70));
  console.log('🚀 [GitHub Releases] 백엔드 엔진 런타임 자동 릴리즈 배포');
  console.log('='.repeat(70));

  // 1. 사전 검증
  verifyGhCli();

  const releaseTag = process.argv[2]?.trim() || DEFAULT_ENGINE_RELEASE_TAG;
  validateReleaseTag(releaseTag);

  const releaseDir = path.resolve('release');
  if (!fs.existsSync(releaseDir)) {
    fs.mkdirSync(releaseDir, { recursive: true });
  }

  // 2. 현재 플랫폼의 엔진 아카이브 확인 (없으면 패키징 먼저 수행)
  const currentPlatformArchive = process.platform === 'win32'
    ? ENGINE_ARCHIVE_NAMES.win
    : ENGINE_ARCHIVE_NAMES.mac;
  const currentArchivePath = path.join(releaseDir, currentPlatformArchive);

  if (!fs.existsSync(currentArchivePath)) {
    console.log(`⚠️ 현재 플랫폼(${process.platform}) 엔진 아카이브가 없습니다. 패키징을 먼저 수행합니다...`);
    await packageEngine();
  }

  // 3. release/ 디렉토리에 존재하는 모든 플랫폼 엔진 파일 수집 (Mac + Windows)
  const { uploadFiles, assets } = collectEngineAssets(releaseDir);

  if (uploadFiles.length === 0) {
    throw new Error(`${releaseDir} 디렉토리에 배포할 엔진 아카이브 파일이 없습니다.`);
  }

  console.log(`📌 대상 릴리즈 태그: ${releaseTag}`);
  console.log(`📦 업로드 대상 엔진 에셋 (${assets.length}개 플랫폼 감지):`);
  for (const asset of assets) {
    console.log(`  - ${asset.fileName} (${asset.sizeMb} MB)`);
  }
  console.log('');

  // 4. 대상 릴리즈 존재 확인
  const viewRes = spawnSync('gh', ['release', 'view', releaseTag], { encoding: 'utf-8' });
  const releaseExists = viewRes.status === 0;

  if (releaseExists) {
    console.log(`ℹ️ 기존 릴리즈 [${releaseTag}]가 확인되었습니다. 최신 엔진 에셋을 업로드(덮어쓰기)합니다...`);
    const uploadRes = spawnSync(
      'gh',
      ['release', 'upload', releaseTag, ...uploadFiles, '--clobber'],
      { stdio: 'inherit' }
    );

    if (uploadRes.status !== 0) {
      throw new Error(`엔진 릴리즈 에셋 업로드에 실패했습니다. (코드: ${uploadRes.status})`);
    }
  } else {
    console.log(`✨ 새 릴리즈 [${releaseTag}]를 생성하고 엔진 에셋을 배포합니다...`);
    const createArgs = [
      'release',
      'create',
      releaseTag,
      ...uploadFiles,
      '--title',
      `Korean Law RAG Engine ${releaseTag}`,
      '--notes',
      '초경량 스마트 웹 인스톨러 구동용 백엔드 엔진 런타임',
    ];

    const createRes = spawnSync('gh', createArgs, { stdio: 'inherit' });
    if (createRes.status !== 0) {
      throw new Error(`엔진 릴리즈 생성 및 업로드에 실패했습니다. (코드: ${createRes.status})`);
    }
  }

  // 5. 결과 확인
  const repoView = spawnSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], {
    encoding: 'utf-8',
  });
  const repoName = repoView.stdout.trim() || APP_CONFIG.githubRepo;
  const releaseUrl = `https://github.com/${repoName}/releases/tag/${releaseTag}`;

  console.log('\n' + '='.repeat(70));
  console.log('🎉 [배포 완료] 백엔드 엔진 GitHub Releases 배포가 성공적으로 완료되었습니다!');
  console.log('='.repeat(70));
  console.log(`🌐 릴리즈 페이지: ${releaseUrl}`);
  console.log('\n📥 배포된 엔진 파일:');
  for (const asset of assets) {
    const directUrl = `https://github.com/${repoName}/releases/download/${releaseTag}/${asset.fileName}`;
    console.log(`  - ${asset.fileName} (${asset.sizeMb} MB)`);
    console.log(`    URL: ${directUrl}`);
  }
  console.log('='.repeat(70) + '\n');
}

releaseEngine().catch((err: unknown) => {
  console.error('\n❌ 엔진 릴리즈 배포 중 오류 발생:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
