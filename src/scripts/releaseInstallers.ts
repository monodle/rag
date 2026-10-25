import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  APP_VERSION,
  APP_CONFIG,
  DEFAULT_INSTALLER_RELEASE_TAG,
  DEFAULT_ENGINE_RELEASE_TAG,
  DEFAULT_LANCEDB_RELEASE_TAG,
} from '../config/constants.js';
import { calculateSha256 } from '../utils/fileUtils.js';

interface InstallerAsset {
  readonly fileName: string;
  readonly filePath: string;
  readonly checksumPath: string;
  readonly sizeMb: string;
  readonly sha256: string;
  readonly platform: 'macOS' | 'Windows';
  readonly type: 'Installer';
}

interface ReleaseConfig {
  readonly releaseDir: string;
  readonly tag: string;
  readonly title: string;
}

const DEFAULT_TAG = DEFAULT_INSTALLER_RELEASE_TAG;

/**
 * 릴리즈 태그가 다른 릴리즈 채널(엔진, 벡터 DB)과 충돌하지 않는지 검증합니다.
 */
function validateReleaseTag(tag: string): void {
  if (tag === DEFAULT_ENGINE_RELEASE_TAG || (tag.startsWith('v') && /^v\d+\.\d+\.\d+/.test(tag))) {
    throw new Error(
      `[오배포 방지] 엔진 런타임 전용 릴리즈 태그('${tag}')로 앱 인스톨러를 배포할 수 없습니다.\n` +
      `설치 파일은 반드시 '${DEFAULT_INSTALLER_RELEASE_TAG}' 릴리즈 채널에 배포되어야 합니다.`
    );
  }

  if (tag === DEFAULT_LANCEDB_RELEASE_TAG || tag.startsWith('data-')) {
    throw new Error(
      `[오배포 방지] 벡터 데이터베이스 전용 릴리즈 태그('${tag}')로 앱 인스톨러를 배포할 수 없습니다.\n` +
      `설치 파일은 반드시 '${DEFAULT_INSTALLER_RELEASE_TAG}' 릴리즈 채널에 배포되어야 합니다.`
    );
  }
}

/**
 * CLI 인자를 파싱하여 릴리즈 설정을 구성합니다.
 */
function parseArgs(): ReleaseConfig {
  const args = process.argv.slice(2);

  let customTag: string | null = null;
  const tagIndex = args.indexOf('--tag');
  if (tagIndex !== -1 && args[tagIndex + 1]) {
    customTag = args[tagIndex + 1].trim();
  } else {
    const positional = args.find((arg) => !arg.startsWith('--'));
    if (positional) {
      customTag = positional.trim();
    }
  }

  const tag = customTag || DEFAULT_TAG;
  validateReleaseTag(tag);

  const version = APP_VERSION;
  const title = tag === 'latest'
    ? `Korean Law RAG App (Latest Release - v${version})`
    : `Korean Law RAG App ${tag}`;

  return {
    releaseDir: path.resolve('release'),
    tag,
    title,
  };
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
 * release 디렉토리에서 인스톨러 파일들을 수집하고 체크섬을 생성합니다.
 */
async function collectInstallerAssets(releaseDir: string): Promise<InstallerAsset[]> {
  if (!fs.existsSync(releaseDir)) {
    throw new Error(`릴리즈 디렉토리가 존재하지 않습니다: ${releaseDir}`);
  }

  const files = fs.readdirSync(releaseDir);
  const targetFiles = files.filter((file) => {
    const lower = file.toLowerCase();
    // macOS dmg 및 Windows exe 파일만 수집 (msi, zip, tar.gz, sha256 제외)
    return (
      (lower.endsWith('.dmg') || lower.endsWith('.exe')) &&
      !lower.endsWith('.msi') &&
      !lower.endsWith('.zip') &&
      !lower.endsWith('.tar.gz') &&
      !lower.endsWith('.sha256')
    );
  });

  if (targetFiles.length === 0) {
    throw new Error(`${releaseDir} 디렉토리에 배포할 dmg 또는 exe 파일이 없습니다.`);
  }

  const assets: InstallerAsset[] = [];

  for (const fileName of targetFiles) {
    const filePath = path.join(releaseDir, fileName);
    const checksumPath = `${filePath}.sha256`;
    const stats = fs.statSync(filePath);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);

    const sha256 = await calculateSha256(filePath);
    fs.writeFileSync(checksumPath, `${sha256}  ${fileName}\n`, 'utf-8');

    const lower = fileName.toLowerCase();
    const platform: 'macOS' | 'Windows' = lower.endsWith('.dmg') ? 'macOS' : 'Windows';

    assets.push({
      fileName,
      filePath,
      checksumPath,
      sizeMb,
      sha256,
      platform,
      type: 'Installer',
    });
  }

  return assets;
}

/**
 * 릴리즈 본문(Release Notes) 마크다운을 생성합니다.
 */
function generateReleaseNotes(assets: readonly InstallerAsset[], tag: string): string {
  const macAssets = assets.filter((a) => a.platform === 'macOS');
  const winAssets = assets.filter((a) => a.platform === 'Windows');

  const lines: string[] = [
    `# ⚖️ Korean Law RAG Desktop App (${tag})`,
    '',
    '대한민국 현행 법령 20만 조문 기반 온디바이스 AI RAG 검색 및 대화형 챗봇 데스크톱 앱입니다.',
    '',
    '## 📦 설치 파일 다운로드 (초경량 스마트 웹 인스톨러)',
    '앱 실행 시 온디바이스 AI 엔진 및 고속 벡터 인덱스를 안전하게 자동 구성합니다.',
    '',
    '| 플랫폼 | 파일명 | 크기 | SHA256 체크섬 |',
    '| :--- | :--- | :---: | :--- |',
  ];

  for (const asset of assets) {
    lines.push(`| **${asset.platform}** | \`${asset.fileName}\` | ${asset.sizeMb} MB | \`${asset.sha256.substring(0, 16)}...\` |`);
  }

  lines.push('');
  lines.push('### 🍎 macOS 설치 가이드');
  if (macAssets.length > 0) {
    lines.push(`- **권장 파일**: \`${macAssets[0].fileName}\``);
  }
  lines.push('- Apple Silicon (M1/M2/M3/M4) 및 macOS 13(Ventura) 이상 지원');
  lines.push('- `.dmg` 실행 후 애플리케이션 폴더로 드래그 앤 드롭하여 설치합니다.');
  lines.push('');
  lines.push('### 🪟 Windows 설치 가이드');
  if (winAssets.length > 0) {
    lines.push(`- **권장 파일**: \`${winAssets[0].fileName}\``);
  }
  lines.push('- Windows 10 / 11 64비트(x64) 지원');
  lines.push('- 인스톨러 실행 후 안내에 따라 간편하게 설치할 수 있습니다.');
  lines.push('');
  lines.push('---');
  lines.push('💡 **참고**: 무결성 검증을 위한 `.sha256` 파일이 각 바이너리와 함께 배포됩니다.');

  return lines.join('\n');
}

/**
 * GitHub 릴리즈에 에셋을 업로드하고 Latest 버전으로 설정합니다.
 */
async function releaseInstallers(): Promise<void> {
  console.log('='.repeat(70));
  console.log('🚀 [GitHub Releases] 대한민국 법령 RAG 앱 인스톨러 배포 파이프라인');
  console.log('='.repeat(70));

  // 1. 사전 검증
  verifyGhCli();
  const config = parseArgs();

  console.log(`📌 대상 릴리즈 태그: ${config.tag}`);
  console.log(`📂 검색 디렉토리: ${config.releaseDir}\n`);

  // 2. 인스톨러 파일 및 체크섬 수집
  const installerAssets = await collectInstallerAssets(config.releaseDir);

  const uploadFiles: string[] = [];
  console.log('📦 업로드 대상 인스톨러 목록:');
  for (const asset of installerAssets) {
    console.log(`  - [${asset.platform}] ${asset.fileName} (${asset.sizeMb} MB)`);
    console.log(`    SHA256: ${asset.sha256}`);
    uploadFiles.push(asset.filePath);
    uploadFiles.push(asset.checksumPath);
  }

  // 3. 대상 릴리즈 존재 확인
  const viewRes = spawnSync('gh', ['release', 'view', config.tag], { encoding: 'utf-8' });
  const releaseExists = viewRes.status === 0;
  const notes = generateReleaseNotes(installerAssets, config.tag);

  if (releaseExists) {
    console.log(`\nℹ️ 기존 릴리즈 [${config.tag}]가 확인되었습니다. 최신 에셋을 업로드(덮어쓰기)합니다...`);
    const uploadRes = spawnSync(
      'gh',
      ['release', 'upload', config.tag, ...uploadFiles, '--clobber'],
      { stdio: 'inherit' }
    );

    if (uploadRes.status !== 0) {
      throw new Error(`릴리즈 에셋 업로드에 실패했습니다. (코드: ${uploadRes.status})`);
    }

    // Latest 플래그 및 최신 릴리즈 정보(노트/제목) 동기화
    console.log(`\n🏷️ 릴리즈 [${config.tag}]의 설명 및 최신(Latest) 상태를 갱신 중...`);
    spawnSync('gh', ['release', 'edit', config.tag, '--title', config.title, '--notes', notes, '--latest'], {
      stdio: 'inherit',
    });
  } else {
    console.log(`\n✨ 새 릴리즈 [${config.tag}]를 생성하고 Latest 버전으로 배포합니다...`);
    const createArgs = [
      'release',
      'create',
      config.tag,
      ...uploadFiles,
      '--title',
      config.title,
      '--notes',
      notes,
      '--latest',
    ];

    const createRes = spawnSync('gh', createArgs, { stdio: 'inherit' });
    if (createRes.status !== 0) {
      throw new Error(`릴리즈 생성 및 업로드에 실패했습니다. (코드: ${createRes.status})`);
    }
  }

  // 4. 저장소 정보 확인
  const repoView = spawnSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], {
    encoding: 'utf-8',
  });
  const repoName = repoView.stdout.trim() || APP_CONFIG.githubRepo;
  const releaseUrl = `https://github.com/${repoName}/releases/tag/${config.tag}`;
  const latestUrl = `https://github.com/${repoName}/releases/latest`;

  console.log('\n' + '='.repeat(70));
  console.log('🎉 [배포 완료] GitHub Latest 릴리즈 배포가 성공적으로 완료되었습니다!');
  console.log('='.repeat(70));
  console.log(`🌐 릴리즈 페이지: ${releaseUrl}`);
  console.log(`🌟 Latest 링크: ${latestUrl}`);
  console.log('\n📥 배포된 파일:');
  for (const asset of installerAssets) {
    const directUrl = `https://github.com/${repoName}/releases/download/${config.tag}/${asset.fileName}`;
    console.log(`  - ${asset.fileName} (${asset.sizeMb} MB)`);
    console.log(`    URL: ${directUrl}`);
  }
  console.log('='.repeat(70) + '\n');
}

releaseInstallers().catch((err: unknown) => {
  console.error('\n❌ 릴리즈 배포 중 오류 발생:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
