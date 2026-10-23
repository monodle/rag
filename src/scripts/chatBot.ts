import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { RagPipelineService } from '../server/ragPipelineService.js';
import { LlmManager } from '../server/llmManager.js';
import { USE_ONDEVICE_LLM, MAX_REFERENCES } from '../config/constants.js';

async function runCliChat(): Promise<void> {
  const args = process.argv.slice(2);
  const initialQuery = args.join(' ').trim();

  const ragPipeline = RagPipelineService.getInstance();
  const llmManager = LlmManager.getInstance();

  console.log('================================================================');
  console.log('⚖️ [대한민국 법령 RAG 대화형 CLI 어시스턴트]');
  console.log('================================================================');
  console.log(`- 온디바이스 LLM: ${USE_ONDEVICE_LLM ? '🟢 활성화' : '⚪ 비활성화 (조문 요약 모드)'}`);
  console.log(`- 엔진: ${llmManager.getDisplayName()}`);
  console.log(`- 참조 조문 수: 최대 ${MAX_REFERENCES}건`);
  console.log('종료하려면 "exit", "quit" 또는 Ctrl+C를 입력하세요.\n');

  const answerQuery = async (query: string) => {
    if (!query) return;

    process.stdout.write('\n🔍 관련 법령 조문 검색 및 답변 생성 중...\n\n💬 [답변]\n');
    const startTime = Date.now();

    const result = await ragPipeline.executeChat({
      query,
      limit: MAX_REFERENCES,
      onToken: (token) => {
        process.stdout.write(token);
      },
    });

    const elapsed = Date.now() - startTime;
    console.log(`\n\n⏱️ [소요 시간: ${elapsed}ms]`);

    if (result.references.length > 0) {
      console.log('\n📜 [핵심 근거 법조문 (2단계 정제 완료)]');
      result.references.forEach((ref, idx) => {
        const titleSuffix = ref.articleTitle ? `(${ref.articleTitle})` : '';
        const matchInfo = ref.matchReasons && ref.matchReasons.length > 0
          ? ` [${ref.matchReasons.join(', ')}]`
          : '';
        console.log(
          `  ${idx + 1}. ${ref.lawName} ${ref.articleNumber} ${titleSuffix} [유사도: ${(ref.score * 100).toFixed(1)}%]${matchInfo}`
        );
      });
    }

    console.log('\n----------------------------------------------------------------\n');
  };


  if (initialQuery) {
    await answerQuery(initialQuery);
    return;
  }

  const rl = readline.createInterface({ input, output });

  try {
    while (true) {
      const line = await rl.question('👉 법률 질문을 입력하세요: ');
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === 'exit' || trimmed === 'quit') break;

      await answerQuery(trimmed);
    }
  } finally {
    rl.close();
  }
}

runCliChat().catch((err) => {
  console.error('\n❌ CLI 챗봇 실행 실패:', err);
  process.exit(1);
});
