import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  ARCHIVE_FILE_PATH,
  CHECKSUM_FILE_PATH,
  packageDatabase,
} from './packageDb.js';
import { calculateSha256 } from '../utils/fileUtils.js';
import {
  DEFAULT_LANCEDB_RELEASE_TAG,
  LANCEDB_ARCHIVE_FILE_NAME,
  APP_CONFIG,
  TOTAL_INDEXED_ARTICLES_ESTIMATE,
} from '../config/constants.js';

const DEFAULT_RELEASE_TAG = DEFAULT_LANCEDB_RELEASE_TAG;

/**
 * gh CLI를 통해 아카이브된 법령 벡터 데이터베이스를 GitHub Releases에 자동 배포합니다.
 */
async function releaseDatabase() {
  console.log('='.repeat(70));
  console.log('🚀 [GitHub Releases] 법률 벡터 데이터베이스 자동 릴리즈 배포');
  console.log('='.repeat(70));

  // 1. gh CLI 설치 및 인증 상태 확인
  const ghCheck = spawnSync('gh', ['--version'], { encoding: 'utf-8' });
  if (ghCheck.status !== 0) {
    console.error('❌ GitHub CLI(gh)가 설치되어 있지 않습니다.');
    console.error('👉 https://cli.github.com 에서 gh를 설치하고 `gh auth login`을 완료해 주세요.');
    process.exit(1);
  }

  // 2. 압축 파일 존재 확인 (없으면 자동 패키징 수행)
  if (!fs.existsSync(ARCHIVE_FILE_PATH)) {
    console.log('⚠️ 압축 아카이브가 없습니다. 패키징(압축)을 먼저 수행합니다...');
    await packageDatabase();
  }

  const sha256 = fs.existsSync(CHECKSUM_FILE_PATH)
    ? fs.readFileSync(CHECKSUM_FILE_PATH, 'utf-8').split(/\s+/)[0]
    : await calculateSha256(ARCHIVE_FILE_PATH);

  const releaseTag = process.argv[2]?.trim() || DEFAULT_RELEASE_TAG;
  console.log(`📌 대상 릴리즈 태그: ${releaseTag}`);
  console.log(`📦 업로드 에셋: ${ARCHIVE_FILE_PATH}`);
  console.log(`🔑 SHA256: ${sha256}\n`);

  // 3. 기존 릴리즈 존재 여부 확인
  const viewRes = spawnSync('gh', ['release', 'view', releaseTag], { encoding: 'utf-8' });
  const releaseExists = viewRes.status === 0;

  if (releaseExists) {
    console.log(`ℹ️ 기존 릴리즈 [${releaseTag}]가 이미 존재합니다. 에셋을 갱신(덮어쓰기) 업로드합니다...`);
    const uploadRes = spawnSync(
      'gh',
      ['release', 'upload', releaseTag, ARCHIVE_FILE_PATH, CHECKSUM_FILE_PATH, '--clobber'],
      { stdio: 'inherit' }
    );

    if (uploadRes.status !== 0) {
      console.error('❌ 릴리즈 에셋 업로드에 실패했습니다.');
      process.exit(1);
    }
  } else {
    console.log(`✨ 새 릴리즈 [${releaseTag}]를 생성하고 에셋을 업로드합니다...`);
    const title = '대한민국 법령 20만 조문 벡터 데이터베이스 (LanceDB)';
    const notes = [
      '## ⚖️ Korean Laws Vector Database (LanceDB)',
      `- **데이터 규모**: 대한민국 현행 법령 ${TOTAL_INDEXED_ARTICLES_ESTIMATE.toLocaleString()}개 조문 청크`,
      '- **임베딩 모델**: google/embeddinggemma-2 (768차원 Cosine)',
      '- **포맷**: Apache Arrow / Lance 컬럼형 온디바이스 포맷',
      `- **SHA256 체크섬**: \`${sha256}\``,
      '',
      'Tauri 법령 RAG 앱 첫 실행 시 1회 자동 동기화에 사용됩니다.',
    ].join('\n');

    const createRes = spawnSync(
      'gh',
      [
        'release',
        'create',
        releaseTag,
        ARCHIVE_FILE_PATH,
        CHECKSUM_FILE_PATH,
        '--title',
        title,
        '--notes',
        notes,
      ],
      { stdio: 'inherit' }
    );

    if (createRes.status !== 0) {
      console.error('❌ 릴리즈 생성 및 업로드에 실패했습니다.');
      process.exit(1);
    }
  }

  // 4. 업로드된 다운로드 URL 확인
  const repoView = spawnSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], {
    encoding: 'utf-8',
  });
  const repoName = repoView.stdout.trim() || APP_CONFIG.githubRepo;
  const downloadUrl = `https://github.com/${repoName}/releases/download/${releaseTag}/${LANCEDB_ARCHIVE_FILE_NAME}`;

  console.log('\n' + '='.repeat(70));
  console.log('🎉 [배포 완료] GitHub Releases 배포가 성공적으로 완료되었습니다!');
  console.log('='.repeat(70));
  console.log(`🌐 릴리즈 페이지: https://github.com/${repoName}/releases/tag/${releaseTag}`);
  console.log(`📥 다이렉트 다운로드 URL: ${downloadUrl}`);
  console.log(`🔑 SHA256 체크섬: ${sha256}`);
  console.log('='.repeat(70));
}

releaseDatabase().catch((err) => {
  console.error('❌ 릴리즈 중 오류 발생:', err);
  process.exit(1);
});
