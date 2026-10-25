import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { MODELS_DIR } from '../config/constants.js';
import { formatBytes } from '../utils/formatUtils.js';

/**
 * .env 파일의 온디바이스 LLM 설정을 안전하게 갱신합니다.
 */
export async function updateEnvModel(modelPath: string | null): Promise<void> {
  const envPath = path.resolve(process.cwd(), '.env');
  let content = '';

  try {
    content = await fs.readFile(envPath, 'utf-8');
  } catch {
    content = '# 대한민국 법령 RAG 환경 설정\n';
  }

  const enabled = Boolean(modelPath);

  // 1. USE_ONDEVICE_LLM 갱신
  if (/^USE_ONDEVICE_LLM\s*=.*/m.test(content)) {
    content = content.replace(/^USE_ONDEVICE_LLM\s*=.*/m, `USE_ONDEVICE_LLM=${enabled}`);
  } else {
    content = `USE_ONDEVICE_LLM=${enabled}\n` + content;
  }

  // 2. ONDEVICE_LLM 갱신
  if (modelPath) {
    const formattedPath = `"${modelPath}"`;
    if (/^ONDEVICE_LLM\s*=.*/m.test(content)) {
      content = content.replace(/^ONDEVICE_LLM\s*=.*/m, `ONDEVICE_LLM=${formattedPath}`);
    } else {
      content += `\nONDEVICE_LLM=${formattedPath}\n`;
    }
  }

  await fs.writeFile(envPath, content, 'utf-8');
}

/**
 * 현재 .env에 설정된 활성 모델 경로를 가져옵니다.
 */
async function getCurrentActiveModel(): Promise<{ enabled: boolean; modelPath: string }> {
  const envPath = path.resolve(process.cwd(), '.env');
  try {
    const content = await fs.readFile(envPath, 'utf-8');
    const enabledMatch = content.match(/^USE_ONDEVICE_LLM\s*=\s*(true|false)/m);
    const enabled = enabledMatch ? enabledMatch[1] === 'true' : false;

    const modelMatch = content.match(/^ONDEVICE_LLM\s*=\s*["']?([^"'\r\n]+)["']?/m);
    const modelPath = modelMatch ? modelMatch[1].trim() : '';

    return { enabled, modelPath };
  } catch {
    return { enabled: false, modelPath: '' };
  }
}

async function main() {
  const modelsDir = MODELS_DIR;
  const displayModelsDir = path.relative(process.cwd(), modelsDir) || modelsDir;
  console.log('\n================================================================');
  console.log(`🤖 [로컬 온디바이스 모델 선택기] - ${displayModelsDir}`);
  console.log('================================================================');

  if (!fsSync.existsSync(modelsDir)) {
    await fs.mkdir(modelsDir, { recursive: true });
  }

  const files = await fs.readdir(modelsDir, { withFileTypes: true });
  const ggufFiles: { name: string; size: number; fullPath: string; relPath: string }[] = [];

  for (const file of files) {
    if (file.isFile() && file.name.endsWith('.gguf')) {
      const fullPath = path.join(modelsDir, file.name);
      const stat = await fs.stat(fullPath);
      const rawRel = path.relative(process.cwd(), fullPath);
      const relPath = rawRel.startsWith('.') ? rawRel : `./${rawRel}`;
      ggufFiles.push({
        name: file.name,
        size: stat.size,
        fullPath,
        relPath,
      });
    }
  }

  // 이름순 정렬
  ggufFiles.sort((a, b) => a.name.localeCompare(b.name));

  const current = await getCurrentActiveModel();

  console.log(`현재 상태: ${current.enabled ? '🟢 활성화 (ON)' : '⚪ 비활성화 (OFF)'}`);
  if (current.enabled && current.modelPath) {
    console.log(`현재 선택된 모델: ${current.modelPath}`);
  }
  console.log('----------------------------------------------------------------');

  console.log('[0] ⛔ 온디바이스 LLM 비활성화 (USE_ONDEVICE_LLM=false)');

  if (ggufFiles.length === 0) {
    console.log(`\n⚠️ ${displayModelsDir} 폴더에 다운로드된 .gguf 모델 파일이 없습니다.`);
    console.log('   먼저 `pnpm model:download` 명령어로 모델을 다운로드하세요.\n');
    } else {
      ggufFiles.forEach((m, idx) => {
        const isCurrent = current.enabled && (current.modelPath === m.relPath || current.modelPath.endsWith(m.name));
        const badge = isCurrent ? ' (현재 사용 중 ⭐)' : '';
        console.log(`[${idx + 1}] 📦 ${m.name} [${formatBytes(m.size)}]${badge}`);
      });
    }

    console.log('----------------------------------------------------------------');
    const rl = readline.createInterface({ input, output });
    let answer = '';
    try {
      answer = await rl.question('적용할 모델 번호를 입력하세요 (취소: Enter): ');
    } catch {
      console.log('\n취소되었습니다.');
      rl.close();
      return;
    } finally {
      rl.close();
    }
    const choice = answer.trim();

    if (!choice) {
      console.log('취소되었습니다.');
      return;
    }

    const selectedIndex = parseInt(choice, 10);
    if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex > ggufFiles.length) {
      console.error('❌ 유효하지 않은 번호입니다.');
      return;
    }

    if (selectedIndex === 0) {
      await updateEnvModel(null);
      console.log('\n✅ 온디바이스 LLM이 비활성화되었습니다. (.env: USE_ONDEVICE_LLM=false)');
      console.log('   (서버 재시작 시 법조문 기반 구조화 요약 모드로 동작합니다.)\n');
      return;
    }

    const selected = ggufFiles[selectedIndex - 1];
    await updateEnvModel(selected.relPath);

    console.log('\n✅ 모델이 성공적으로 .env에 적용되었습니다!');
    console.log(`   USE_ONDEVICE_LLM=true`);
    console.log(`   ONDEVICE_LLM="${selected.relPath}"`);
    console.log('   (RAG 백엔드 서버를 재시작하시면 하드웨어 가속 엔진(Metal/CUDA/Vulkan/CPU)으로 즉시 적재됩니다.)\n');
}

if (process.argv[1]?.endsWith('selectModel.ts') || process.argv[1]?.endsWith('selectModel.js')) {
  main().catch((err) => {
    console.error('오류 발생:', err);
    process.exit(1);
  });
}
