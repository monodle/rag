import { LawScanner } from '../parser/lawScanner.js';
import { RAW_LAWS_DIR } from '../config/constants.js';

async function main() {
  const scanner = new LawScanner();

  console.log('🔍 [테스트] 근로기준법 및 형법 파싱 시작...');
  const parsedDocs = await scanner.scanDirectory(RAW_LAWS_DIR, {
    targetLawNames: ['근로기준법', '형법'],
    onlyActiveStatus: true,
  });

  console.log(`\n✅ 파싱된 문서 수: ${parsedDocs.length}개`);

  for (const doc of parsedDocs) {
    const meta = doc.metadata;
    console.log(`\n--------------------------------------------------`);
    console.log(`📜 법령명: ${meta.제목} (${meta.법령구분})`);
    console.log(`📅 시행일자: ${meta.시행일자} | 상태: ${meta.상태}`);
    console.log(`📑 추출된 조문 수: ${doc.chunks.length}개`);

    // 상위 3개 조문 샘플 출력
    console.log(`\n[조문 샘플 2건]`);
    const samples = doc.chunks.slice(0, 2);
    for (const chunk of samples) {
      console.log(`\n* ID: ${chunk.id}`);
      console.log(`* 경로: ${chunk.chapterPath}`);
      console.log(`* 조문: ${chunk.articleNumber} (${chunk.articleTitle})`);
      console.log(`* 본문 미리보기:\n${chunk.content.slice(0, 150)}...`);
    }
  }
}

main().catch(console.error);
