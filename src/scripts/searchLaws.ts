import { RagPipelineService } from '../server/ragPipelineService.js';
import { MAX_REFERENCES } from '../config/constants.js';


async function runSearch(): Promise<void> {
  const args = process.argv.slice(2);
  const query = args.filter((arg) => !arg.startsWith('--')).join(' ').trim();

  if (!query) {
    console.log('사용법: pnpm run search "<검색 질의문>" [--law "<법령명>"] [--limit <숫자>]');
    console.log('예시: pnpm run search "주 52시간 근무제가 법적으로 어떻게 돼?"');
    return;
  }

  let lawFilter: string | undefined;
  let limit = MAX_REFERENCES;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--law' && i + 1 < args.length) {
      lawFilter = args[i + 1];
      i++;
    } else if (args[i] === '--limit' && i + 1 < args.length) {
      limit = parseInt(args[i + 1], 10) || MAX_REFERENCES;
      i++;
    }
  }

  console.log(`🔍 [조문 유사도 검색]`);
  console.log(`❓ 질의: "${query}"`);
  if (lawFilter) {
    console.log(`📌 필터: 법령명 = "${lawFilter}"`);
  }
  console.log(`🔝 반환 개수: ${limit}건\n`);

  const ragPipeline = RagPipelineService.getInstance();

  const startTime = Date.now();
  console.log('⚡ 쿼리 임베딩 및 유효 법령 조문 검색 수행 중...');
  const { scoredChunks: results } = await ragPipeline.searchArticles(query, limit, lawFilter);

  const elapsedMs = Date.now() - startTime;
  console.log(`✅ 검색 완료 (${elapsedMs}ms, ${results.length}건 유효 조문 선별됨)\n`);


  if (results.length === 0) {
    console.log('⚠️ 일치하는 관련 조문을 찾을 수 없습니다.');
    return;
  }

  results.forEach((item, index) => {
    const { score, chunk } = item;
    const similarityPercent = (score * 100).toFixed(2);

    console.log(`==================================================`);
    console.log(`[결과 ${index + 1}] 유사도 점수: ${similarityPercent}% (코사인 점수: ${score.toFixed(4)})`);
    console.log(`📜 법령: ${chunk.lawName} (${chunk.lawType})`);
    if (chunk.chapterPath) {
      console.log(`📂 위치: ${chunk.chapterPath}`);
    }
    console.log(`📑 조문: ${chunk.articleNumber} ${chunk.articleTitle ? `(${chunk.articleTitle})` : ''}`);
    console.log(`📅 시행일자: ${chunk.effectiveDate} | 상태: ${chunk.status}`);
    console.log(`--------------------------------------------------`);
    console.log(`[조문 본문]`);
    console.log(chunk.content);
    console.log('\n');
  });
}

runSearch().catch((err) => {
  console.error('❌ 검색 중 오류 발생:', err);
  process.exit(1);
});
