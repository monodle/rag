import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { formatBytes, updateEnvModel } from './selectModel.js';
import { MODELS_DIR, PRESET_MODELS } from '../config/constants.js';
export { PRESET_MODELS };

interface HfTreeItem {
  type: string;
  path: string;
  size: number;
}

export async function fetchHfGgufList(repoId: string): Promise<HfTreeItem[]> {
  const url = `https://huggingface.co/api/models/${repoId}/tree/main`;
  const res = await fetch(url);

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`저장소를 찾을 수 없습니다: ${repoId}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`접근 권한이 필요하거나 비공개/Gated 저장소입니다: ${repoId}`);
    }
    throw new Error(`Hugging Face API 오류 (${res.status} ${res.statusText})`);
  }

  const items = (await res.json()) as HfTreeItem[];
  return items.filter((item) => item.type === 'file' && item.path.endsWith('.gguf'));
}

export async function downloadWithProgress(
  url: string,
  destPath: string,
  totalSize: number
): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`다운로드 실패 (${res.status} ${res.statusText})`);
  }

  const contentLength = Number(res.headers.get('content-length')) || totalSize;
  const fileStream = fs.createWriteStream(destPath);

  let downloaded = 0;
  const startTime = Date.now();
  let lastUpdate = 0;

  const nodeReadable = Readable.fromWeb(res.body as any);

  nodeReadable.on('data', (chunk: Buffer) => {
    downloaded += chunk.length;
    const now = Date.now();

    // 150ms마다 콘솔 프로그레스 갱신
    if (now - lastUpdate > 150 || downloaded === contentLength) {
      lastUpdate = now;
      const elapsedSec = (now - startTime) / 1000;
      const speed = elapsedSec > 0 ? downloaded / elapsedSec : 0;
      const percent = contentLength > 0 ? ((downloaded / contentLength) * 100).toFixed(1) : '0';

      const barLength = 25;
      const filled = Math.min(barLength, Math.floor((Number(percent) / 100) * barLength));
      const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);

      process.stdout.write(
        `\r⏳ [${bar}] ${percent}% (${formatBytes(downloaded)} / ${formatBytes(contentLength)}) - ${formatBytes(speed)}/s`
      );
    }
  });

  await finished(nodeReadable.pipe(fileStream));
  console.log('\n');
}

async function ask(rl: readline.Interface, query: string): Promise<string> {
  try {
    const res = await rl.question(query);
    return res.trim();
  } catch {
    return '';
  }
}

async function main() {
  const rl = readline.createInterface({ input, output });

  try {
    console.log('\n================================================================');
    console.log('📥 [Hugging Face GGUF 온디바이스 모델 다운로더]');
    console.log('================================================================');
    console.log('💡 자주 사용하는 추천 저장소:');
    PRESET_MODELS.forEach((p, idx) => {
      console.log(`  [${idx + 1}] ${p.repo}`);
      console.log(`      └ ${p.name}`);
    });
    console.log('----------------------------------------------------------------');

    const defaultModel = PRESET_MODELS[0];
    const inputRepo = await ask(
      rl,
      `Hugging Face 저장소(업체명/모델명) 또는 번호(1~${PRESET_MODELS.length})를 입력하세요\n(기본값: 1번 ${defaultModel?.name ?? '기본 모델'}): `
    );

    let targetRepo = inputRepo.trim();
    if (!targetRepo) {
      targetRepo = defaultModel?.repo ?? '';
    } else {
      const selectedIndex = parseInt(targetRepo, 10) - 1;
      if (!Number.isNaN(selectedIndex) && selectedIndex >= 0 && selectedIndex < PRESET_MODELS.length) {
        targetRepo = PRESET_MODELS[selectedIndex].repo;
      }
    }

    console.log(`\n🔍 저장소 메타데이터 조회 중... (${targetRepo})`);
    const ggufList = await fetchHfGgufList(targetRepo);

    if (ggufList.length === 0) {
      console.log(`❌ 해당 저장소에 .gguf 파일이 존재하지 않습니다.`);
      return;
    }

    console.log(`\n📦 다운로드 가능한 GGUF 모델 목록 (${ggufList.length}개):`);
    console.log('----------------------------------------------------------------');

    // Q4_K_M 추천 배지 부여
    ggufList.forEach((item, idx) => {
      const isRecommended = item.path.includes('Q4_K_M') || item.path.includes('q4_0');
      const badge = isRecommended ? ' ⭐ (온디바이스 최적 추천)' : '';
      console.log(`[${idx + 1}] ${item.path} [${formatBytes(item.size)}]${badge}`);
    });
    console.log('----------------------------------------------------------------');

    const fileChoice = await ask(rl, '다운로드할 파일 번호를 선택하세요 (취소: Enter): ');
    if (!fileChoice) {
      console.log('취소되었습니다.');
      return;
    }

    const fileIndex = parseInt(fileChoice, 10);
    if (isNaN(fileIndex) || fileIndex < 1 || fileIndex > ggufList.length) {
      console.error('❌ 유효하지 않은 번호입니다.');
      return;
    }

    const selectedFile = ggufList[fileIndex - 1];
    const modelsDir = MODELS_DIR;
    if (!fs.existsSync(modelsDir)) {
      await fsPromises.mkdir(modelsDir, { recursive: true });
    }

    const destPath = path.join(modelsDir, path.basename(selectedFile.path));
    const downloadUrl = `https://huggingface.co/${targetRepo}/resolve/main/${selectedFile.path}`;

    // 파일이 이미 존재하는지 확인
    if (fs.existsSync(destPath)) {
      const stat = await fsPromises.stat(destPath);
      const overwrite = await ask(
        rl,
        `\n⚠️ 이미 파일이 존재합니다 (${formatBytes(stat.size)}). 덮어쓰시겠습니까? (y/N): `
      );
      if (overwrite.toLowerCase() !== 'y') {
        console.log('다운로드가 취소되었습니다.');
        return;
      }
    }

    console.log(`\n🚀 다운로드 시작: ${selectedFile.path} (${formatBytes(selectedFile.size)})`);
    console.log(`🔗 다운로드 URL: ${downloadUrl}`);
    console.log(`📁 저장 경로: ${destPath}\n`);

    await downloadWithProgress(downloadUrl, destPath, selectedFile.size);

    console.log('🎉 다운로드가 완료되었습니다!');

    const relPath = `./data/models/${path.basename(selectedFile.path)}`;
    const applyNow = await ask(
      rl,
      `\n👉 지금 바로 이 모델을 .env에 기본 모델로 적용하시겠습니까? (Y/n): `
    );

    if (applyNow.toLowerCase() !== 'n') {
      await updateEnvModel(relPath);
      console.log(`\n✅ .env 설정이 완료되었습니다!`);
      console.log(`   USE_ONDEVICE_LLM=true`);
      console.log(`   ONDEVICE_LLM="${relPath}"`);
      console.log(`   (서버 구동 시 이 모델이 Metal GPU로 즉시 로드됩니다.)\n`);
    } else {
      console.log(`\n💡 나중에 'pnpm model:select' 명령어로 언제든지 이 모델을 활성화할 수 있습니다.\n`);
    }
  } catch (err: unknown) {
    console.error(`\n❌ 오류: ${err instanceof Error ? err.message : String(err)}\n`);
  } finally {
    rl.close();
  }
}

if (process.argv[1]?.endsWith('downloadModel.ts') || process.argv[1]?.endsWith('downloadModel.js')) {
  main().catch((err) => {
    console.error('오류 발생:', err);
    process.exit(1);
  });
}
