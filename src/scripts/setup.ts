import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { updateEnvModel } from './selectModel.js';
import { formatBytes } from '../utils/formatUtils.js';
import { fetchHfGgufList, downloadWithProgress } from './downloadModel.js';
import { EmbeddingService } from '../indexer/embeddingService.js';
import { QdrantService } from '../indexer/qdrantService.js';
import {
  RAW_LAWS_DIR,
  QDRANT_URL,
  MODELS_DIR,
  LEGALIZE_KR_REPO_URL,
  QDRANT_PORT,
  DEFAULT_QDRANT_PORT,
  PRESET_MODELS,
  VECTOR_STORE_TYPE,
  DEFAULT_DEV_UI_PORT,
} from '../config/constants.js';
import { DbSyncService } from '../indexer/dbSyncService.js';

/**
 * 터미널 프롬프트 질문 헬퍼
 */
async function ask(rl: readline.Interface, query: string): Promise<string> {
  try {
    const res = await rl.question(query);
    return res.trim();
  } catch {
    return '';
  }
}

/**
 * 터미널 키 대기 헬퍼 (엔터 입력 대기)
 */
async function waitForEnter(rl: readline.Interface, message: string): Promise<void> {
  await rl.question(`\n👉 ${message} (완료 후 [Enter]를 누르세요): `);
}

/**
 * 쉘 명령어 실행 결과 확인 헬퍼
 */
function runCommand(command: string, options: { silent?: boolean; cwd?: string } = {}): { success: boolean; output: string } {
  try {
    const out = execSync(command, {
      cwd: options.cwd || process.cwd(),
      encoding: 'utf-8',
      stdio: options.silent ? 'pipe' : 'inherit',
    });
    return { success: true, output: out || '' };
  } catch (err: any) {
    return {
      success: false,
      output: err.stdout || err.stderr || err.message || '',
    };
  }
}

/**
 * 명령어 존재 여부 확인
 */
function isCommandAvailable(cmd: string): boolean {
  const checkCmd = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`;
  const res = spawnSync(checkCmd, { shell: true, stdio: 'ignore' });
  return res.status === 0;
}

/**
 * Docker 데몬 동작 여부 확인
 */
function isDockerDaemonRunning(): boolean {
  const res = spawnSync('docker info', { shell: true, stdio: 'ignore' });
  return res.status === 0;
}

/**
 * Qdrant REST API 헬스체크 (최대 timeoutMs 대기)
 */
async function waitForQdrantHealth(url?: string, timeoutMs = 15000): Promise<boolean> {
  const targetUrl = url || (QDRANT_URL.endsWith('/') ? `${QDRANT_URL}healthz` : `${QDRANT_URL}/healthz`);
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const res = await fetch(targetUrl);
      if (res.ok) return true;
    } catch {
      // 대기 후 재시도
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/**
 * Step 1: 기본 환경 점검 (Node.js, pnpm, .env)
 */
async function checkEnvironment(): Promise<void> {
  console.log('\n[1/7] 🔍 시스템 런타임 및 환경 설정 점검...');

  // 1. Node.js 버전 확인
  const nodeVersionStr = process.version;
  const major = parseInt(nodeVersionStr.replace('v', '').split('.')[0], 10);
  if (major < 20) {
    console.warn(`⚠️ 현재 Node.js 버전은 ${nodeVersionStr}입니다. Node.js v20 이상(v22 LTS 권장)을 권장합니다.`);
  } else {
    console.log(`  ✅ Node.js: ${nodeVersionStr}`);
  }

  // 2. pnpm 확인
  if (isCommandAvailable('pnpm')) {
    const { output: pnpmVer } = runCommand('pnpm -v', { silent: true });
    console.log(`  ✅ pnpm: v${pnpmVer.trim()}`);
  } else {
    console.log('  ⚠️ pnpm이 설치되어 있지 않습니다. npm install -g pnpm 실행을 권장합니다.');
  }

  // 3. .env 파일 준비
  const envPath = path.resolve(process.cwd(), '.env');
  const envExamplePath = path.resolve(process.cwd(), '.env.example');
  if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath);
    console.log('  ✅ .env 파일이 없어 .env.example로부터 새로 생성했습니다.');
  } else if (fs.existsSync(envPath)) {
    console.log('  ✅ .env 설정 파일 확인 완료');
  }
}

/**
 * Step 2: 의존성 패키지 설치 확인
 */
async function ensureDependencies(): Promise<void> {
  console.log('\n[2/7] 📦 의존성 패키지(node_modules) 확인 및 설치...');
  const nodeModulesPath = path.resolve(process.cwd(), 'node_modules');
  if (!fs.existsSync(nodeModulesPath)) {
    console.log('  ⏳ 패키지가 설치되지 않아 pnpm install을 실행합니다...');
    runCommand('pnpm install');
    console.log('  ✅ 의존성 패키지 설치 완료');
  } else {
    console.log('  ✅ 의존성 패키지가 이미 설치되어 있습니다.');
  }
}

/**
 * Step 3: 벡터 데이터베이스 설정 (LanceDB 기본 / Qdrant 옵션)
 */
async function ensureVectorDatabase(rl: readline.Interface): Promise<void> {
  console.log(`\n[3/7] ⚡ 벡터 데이터베이스 점검 (선택된 엔진: ${VECTOR_STORE_TYPE})...`);

  if (VECTOR_STORE_TYPE === 'lancedb') {
    const syncService = DbSyncService.getInstance();
    const isReady = await syncService.isDatabaseReady();

    if (isReady) {
      console.log('  ✅ 내장 LanceDB 데이터베이스(20만 조문)가 이미 준비되어 있습니다. (Docker 불필요)');
      return;
    }

    console.log('  ⚠️ 로컬 LanceDB 데이터가 없습니다.');
    const answer = await ask(
      rl,
      '  👉 GitHub Releases에서 사전 구축된 20만 조문 벡터 DB를 지금 다운로드하시겠습니까? (Y/n): '
    );

    if (answer.toLowerCase() !== 'n') {
      let lastPercent = -1;
      syncService.onProgress((p) => {
        if (p.status === 'downloading') {
          if (p.percent !== lastPercent) {
            lastPercent = p.percent;
            process.stdout.write(
              `\r  ⏳ 다운로드 진행 중: [${p.percent}%] ${p.downloadedMB}MB / ${p.totalMB}MB`
            );
          }
        } else {
          process.stdout.write(`\n  📌 ${p.message}\n`);
        }
      });

      await syncService.syncDatabase();
      console.log('  ✅ LanceDB 데이터베이스 동기화 완료!');
    } else {
      console.log('  💡 나중에 앱 실행 시 자동 다운로드되거나 `pnpm db:download`로 받을 수 있습니다.');
    }
    return;
  }

  // Qdrant인 경우 Docker 점검
  await ensureDockerAndQdrant(rl);
}

/**
 * Docker 및 Qdrant 컨테이너 점검 (Qdrant 모드 전용)
 */
async function ensureDockerAndQdrant(rl: readline.Interface): Promise<void> {
  console.log('\n  🐳 Docker 및 Qdrant 벡터 데이터베이스 점검...');

  // 1. Docker 설치 확인
  while (!isCommandAvailable('docker')) {
    console.log('\n❌ Docker가 시스템에 설치되어 있지 않거나 PATH에 등록되지 않았습니다.');
    console.log('👉 공식 다운로드: https://www.docker.com/products/docker-desktop/');
    await waitForEnter(rl, 'Docker Desktop을 설치하신 후 엔터를 눌러주세요');
  }

  // 2. Docker 데몬 실행 여부 확인
  while (!isDockerDaemonRunning()) {
    console.log('\n⚠️ Docker Desktop 애플리케이션이 실행되고 있지 않습니다.');
    await waitForEnter(rl, 'Docker Desktop을 실행하신 후 엔터를 눌러주세요');
  }
  console.log('  ✅ Docker 엔진 정상 구동 확인');

  // 3. Qdrant 컨테이너 확인 및 실행
  const checkContainer = runCommand('docker ps -a --filter "name=qdrant.local" --format "{{.Status}}"', { silent: true });
  const statusStr = checkContainer.output.trim().toLowerCase();

  const storageDir = path.resolve(process.cwd(), 'qdrant_storage');
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }

  // Windows 및 POSIX 환경의 Docker 볼륨 마운트 경로 호환 처리
  let dockerMountPath = storageDir;
  if (process.platform === 'win32') {
    const normalized = storageDir.replace(/\\/g, '/');
    const match = normalized.match(/^([a-zA-Z]):\/(.*)$/);
    if (match) {
      dockerMountPath = `/${match[1].toLowerCase()}/${match[2]}`;
    } else {
      dockerMountPath = normalized;
    }
  }

  if (statusStr.startsWith('up')) {
    console.log('  ✅ Qdrant 컨테이너(qdrant.local)가 이미 실행 중입니다.');
  } else if (statusStr) {
    console.log('  ⏳ 중지된 Qdrant 컨테이너를 재시작합니다...');
    runCommand('docker start qdrant.local');
  } else {
    console.log('  ⏳ Qdrant 컨테이너를 최초 실행합니다...');
    const dockerRunCmd = `docker run -d --name qdrant.local --restart always -e TZ=Asia/Seoul -p ${QDRANT_PORT}:${DEFAULT_QDRANT_PORT} -v "${dockerMountPath}":/qdrant/storage qdrant/qdrant`;
    const res = runCommand(dockerRunCmd);
    if (!res.success) {
      console.warn('⚠️ Docker run 실행 중 경고 발생:', res.output);
    }
  }

  console.log(`  ⏳ Qdrant 서버 헬스체크 통신 대기 중 (${QDRANT_URL})...`);
  const healthy = await waitForQdrantHealth();
  if (healthy) {
    console.log('  ✅ Qdrant 벡터 데이터베이스 연결 성공 (Ready)');
  } else {
    console.warn('  ⚠️ Qdrant 헬스체크 응답이 지연되고 있습니다. 잠시 후 재확인해 주세요.');
  }
}

/**
 * Step 4: 법령 마크다운 데이터셋 다운로드 (RAW_LAWS_DIR)
 */
async function ensureLegalDataset(): Promise<void> {
  console.log(`\n[4/7] 📚 대한민국 법령 마크다운 데이터셋(${RAW_LAWS_DIR}) 확인...`);
  const rawsDir = RAW_LAWS_DIR;

  const { LawScanner } = await import('../parser/lawScanner.js');
  const effectiveDir = LawScanner.resolveEffectiveDir(rawsDir);

  const hasData =
    fs.existsSync(effectiveDir) &&
    fs.readdirSync(effectiveDir).some((f) => !f.startsWith('.') && f !== 'kr' && f !== 'README.md');

  if (hasData) {
    const count = fs.readdirSync(effectiveDir).length;
    console.log(`  ✅ 이미 법령 데이터셋이 준비되어 있습니다 (약 ${count}개 폴더 감지: ${path.relative(process.cwd(), effectiveDir)}).`);
    return;
  }

  console.log(`  ⏳ 법제처 오픈소스 법령 데이터(legalize-kr)를 ${rawsDir} 경로에 내려받습니다...`);
  console.log(`  🔗 저장소: ${LEGALIZE_KR_REPO_URL}`);
  
  if (!fs.existsSync(rawsDir)) {
    fs.mkdirSync(rawsDir, { recursive: true });
  }

  const cloneRes = runCommand(`git clone --depth 1 ${LEGALIZE_KR_REPO_URL} "${rawsDir}"`);
  if (cloneRes.success) {
    console.log('  ✅ 법령 마크다운 데이터셋 클론 완료!');

    // legalize-kr 저장소의 kr/ 하위 법령 폴더들을 rawsDir 직하로 평탄화(Flatten) 처리
    const krDir = path.join(rawsDir, 'kr');
    if (fs.existsSync(krDir) && fs.statSync(krDir).isDirectory()) {
      try {
        console.log(`  ⏳ ${path.join(rawsDir, 'kr')} 디렉터리를 ${rawsDir} 직하로 재배치 중...`);
        const items = fs.readdirSync(krDir);
        for (const item of items) {
          const srcItemPath = path.join(krDir, item);
          const destItemPath = path.join(rawsDir, item);
          if (!fs.existsSync(destItemPath)) {
            fs.renameSync(srcItemPath, destItemPath);
          }
        }
        // 빈 kr 디렉터리 정리
        fs.rmdirSync(krDir);
        console.log(`  ✅ 법령 디렉터리 평탄화 완료 (${rawsDir}/[법령명]/...)`);
      } catch (err: any) {
        console.warn('  ⚠️ 디렉터리 평탄화 건너뜀 (LawScanner kr 자동 감지 모드로 동작):', err.message);
      }
    }

    // legalize-kr 저장소의 README.md 파일이 프로젝트 루트의 README.md와 혼동되지 않도록 출처 문서명으로 정돈
    const rawReadme = path.join(rawsDir, 'README.md');
    const datasetReadme = path.join(rawsDir, 'LEGAL_DATASET_README.md');
    if (fs.existsSync(rawReadme) && !fs.existsSync(datasetReadme)) {
      try {
        fs.renameSync(rawReadme, datasetReadme);
        console.log(`  📄 원본 데이터셋 안내 문서를 ${path.join(rawsDir, 'LEGAL_DATASET_README.md')}로 보존했습니다.`);
      } catch {
        // 무시
      }
    }
  } else {
    console.warn('  ⚠️ git clone 실패. 인터넷 연결 상태를 확인하거나 수동으로 법령 데이터를 복사해 주세요.');
  }
}

/**
 * Step 5: 온디바이스 LLM 모델 준비 (선택/권장)
 */
async function ensureOnDeviceLlm(rl: readline.Interface): Promise<void> {
  console.log('\n[5/7] 🧠 온디바이스 GGUF 언어 모델 준비...');
  const modelsDir = MODELS_DIR;
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }

  const existingModels = fs.readdirSync(modelsDir).filter((f) => f.endsWith('.gguf'));
  if (existingModels.length > 0) {
    console.log(`  ✅ 이미 로컬 모델이 존재합니다: ${existingModels[0]}`);
    const fullModelPath = path.join(modelsDir, existingModels[0]);
    const rawRel = path.relative(process.cwd(), fullModelPath);
    const relPath = rawRel.startsWith('.') ? rawRel : `./${rawRel}`;
    await updateEnvModel(relPath);
    return;
  }

  const defaultPreset = PRESET_MODELS[0];
  const displayModelsDir = path.relative(process.cwd(), modelsDir) || modelsDir;
  console.log(`  💡 현재 ${displayModelsDir} 디렉터리에 다운로드된 GGUF 모델이 없습니다.`);
  console.log(`  - 추천 모델: ${defaultPreset.name}`);
  const answer = await ask(rl, `👉 추천 모델(${defaultPreset.name})을 지금 다운로드하시겠습니까? (Y/n): `);

  if (answer.toLowerCase() === 'n') {
    console.log('  ℹ️ 온디바이스 LLM 다운로드를 건너뜁니다. (조문 검색 전용 모드로 동작)');
    await updateEnvModel(null);
    return;
  }

  try {
    const defaultRepo = PRESET_MODELS[0].repo;
    console.log(`\n  🔍 저장소 모델 정보 조회 중 (${defaultRepo})...`);
    const ggufList = await fetchHfGgufList(defaultRepo);
    const targetFile =
      ggufList.find((item) => item.path.includes('Q4_K_M') || item.path.includes('q4_k_m')) || ggufList[0];

    if (!targetFile) {
      throw new Error('해당 저장소에서 GGUF 파일을 찾을 수 없습니다.');
    }

    const destPath = path.join(modelsDir, path.basename(targetFile.path));
    const downloadUrl = `https://huggingface.co/${defaultRepo}/resolve/main/${targetFile.path}`;

    console.log(`  🚀 모델 다운로드 시작: ${targetFile.path} (${formatBytes(targetFile.size)})`);
    await downloadWithProgress(downloadUrl, destPath, targetFile.size);

    const rawRel = path.relative(process.cwd(), destPath);
    const relPath = rawRel.startsWith('.') ? rawRel : `./${rawRel}`;
    await updateEnvModel(relPath);
    console.log(`  ✅ .env 모델 설정 완료 (ONDEVICE_LLM="${relPath}")`);
  } catch (err: any) {
    console.warn(`  ⚠️ 모델 다운로드 중 오류 발생: ${err.message}`);
    console.log('  💡 이후에 "pnpm model:download" 명령어로 언제든지 다시 다운로드할 수 있습니다.');
  }
}

/**
 * Step 6: 로컬 고성능 임베딩 모델 사전 다운로드 & 워밍업
 */
async function ensureEmbeddingModel(): Promise<void> {
  console.log('\n[6/7] ⚡ 로컬 임베딩 모델(google/embeddinggemma-2 ONNX) 사전 로딩 및 워밍업...');
  console.log('  ⏳ 로컬 ONNX 가중치를 확인하고 테스트 벡터를 추출합니다 (최초 1회 캐싱)...');

  try {
    const embeddingService = EmbeddingService.getInstance();
    const testVector = await embeddingService.embedQuery('대한민국헌법 제1조 대한민국은 민주공화국이다.');
    console.log(`  ✅ 임베딩 모델 검증 성공 (차원 수: ${testVector.length}d)`);
  } catch (err: any) {
    console.warn(`  ⚠️ 임베딩 모델 로딩 경고: ${err.message}`);
  }
}

/**
 * Step 7: 테스트용 필수 핵심 법령 Qdrant 인덱싱
 */
async function indexSampleLaws(): Promise<void> {
  console.log('\n[7/7] ⚖️ 빠른 시작을 위한 필수 핵심 법령 Qdrant 인덱싱...');
  const targetLaws = '근로기준법,형법,민법,도로교통법';
  console.log(`  🎯 대상 법령: ${targetLaws}`);
  console.log('  ⏳ 인덱싱 배치 작업을 실행합니다 (약 1~2분 소요)...');

  const res = runCommand(`pnpm index:laws --target="${targetLaws}"`);
  if (res.success) {
    console.log('  ✅ 필수 핵심 법령 인덱싱 완료!');
  } else {
    console.warn('  ⚠️ 인덱싱 스크립트 실행 중 일부 오류 발생:', res.output);
  }

  // 인덱싱 결과 포인트 확인
  try {
    const qdrant = new QdrantService();
    const info = await qdrant.getCollectionInfo();
    const points = (info as any).points_count ?? (info as any).pointsCount ?? 0;
    console.log(`  📊 Qdrant 컬렉션 상태: 현재 총 ${Number(points).toLocaleString()}개 조문 인덱싱됨`);
  } catch {
    // 무시
  }
}

/**
 * 메인 셋업 파이프라인 실행
 */
async function main() {
  const rl = readline.createInterface({ input, output });

  console.log('================================================================');
  console.log('🚀 [대한민국 법령 RAG] 올인원 초기 셋업 (All-in-One Setup)');
  console.log('================================================================');
  console.log('이 스크립트는 RAG 시스템 실행에 필요한 모든 환경, DB, 데이터셋,');
  console.log('임베딩 및 온디바이스 언어 모델을 자동으로 구성합니다.\n');

  try {
    await checkEnvironment();
    await ensureDependencies();
    await ensureVectorDatabase(rl);
    await ensureLegalDataset();
    await ensureOnDeviceLlm(rl);
    await ensureEmbeddingModel();

    if (VECTOR_STORE_TYPE === 'qdrant') {
      await indexSampleLaws();
    }

    console.log('\n================================================================');
    console.log('🎉 모든 초기 설정 및 데이터베이스 구축이 완료되었습니다!');
    console.log('================================================================');
    console.log('\n이제 아래 명령어로 시스템을 시작할 수 있습니다:');
    console.log('\n1. RAG 백엔드 서버 구동 (터미널 1):');
    console.log('   $ pnpm dev:server');
    console.log('\n2. 데스크톱 앱 또는 웹 UI 실행 (터미널 2):');
    console.log('   $ pnpm tauri dev   (Tauri 데스크톱 앱)');
    console.log('   또는');
    console.log(`   $ pnpm dev:ui      (웹 브라우저 http://localhost:${DEFAULT_DEV_UI_PORT})\n`);
  } catch (err: any) {
    console.error('\n❌ 셋업 중 오류가 발생했습니다:', err);
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error('초기화 실행 실패:', err);
  process.exit(1);
});
