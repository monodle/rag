import { DbSyncService } from '../indexer/dbSyncService.js';

async function main() {
  console.log('='.repeat(70));
  console.log('📥 [LanceDB] 사전 구축 법률 벡터 데이터베이스 다운로더');
  console.log('='.repeat(70));

  const syncService = DbSyncService.getInstance();
  const isReady = await syncService.isDatabaseReady();

  if (isReady && !process.argv.includes('--force')) {
    console.log('✅ 로컬 LanceDB 데이터베이스가 이미 준비되어 있습니다.');
    console.log('💡 강제로 다시 다운로드하려면 `pnpm db:download --force`를 실행하세요.');
    process.exit(0);
  }

  let lastPercent = -1;
  syncService.onProgress((p) => {
    if (p.status === 'downloading') {
      if (p.percent !== lastPercent) {
        lastPercent = p.percent;
        process.stdout.write(
          `\r⏳ 다운로드 진행 중: [${p.percent}%] ${p.downloadedMB}MB / ${p.totalMB}MB`
        );
      }
    } else {
      process.stdout.write(`\n📌 상태: ${p.message}\n`);
    }
  });

  try {
    await syncService.syncDatabase();
    console.log('\n🎉 데이터베이스 동기화가 성공적으로 완료되었습니다!');
  } catch (err) {
    console.error('\n❌ 데이터베이스 다운로드 중 오류 발생:', err);
    process.exit(1);
  }
}

main();
