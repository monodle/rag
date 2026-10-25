import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { EmbeddingService } from '../indexer/embeddingService.js';
import { getVectorStoreService } from '../indexer/vectorStore.js';
import { DbSyncService } from '../indexer/dbSyncService.js';
import { ModelDownloaderService } from './modelDownloaderService.js';
import { LlmManager } from './llmManager.js';
import { LawScanner } from '../parser/lawScanner.js';
import { RagPipelineService } from './ragPipelineService.js';
import { SystemMaintenanceService } from './systemMaintenanceService.js';
import {
  USE_ONDEVICE_LLM,
  ONDEVICE_LLM_MODEL,
  SERVER_PORT,
  MAX_REFERENCES,
  RAW_LAWS_DIR,
  VECTOR_STORE_TYPE,
  APP_VERSION,
  QDRANT_COLLECTION,
  LANCEDB_TABLE_NAME,
  MIN_REFERENCE_SCORE_THRESHOLD,
  API_ENDPOINTS,
} from '../config/constants.js';
import { ServerStatsResponse } from '../types/law.js';

const PORT = SERVER_PORT;

export class RagServer {
  private embeddingService = EmbeddingService.getInstance();
  private vectorStore = getVectorStoreService();
  private llmManager = LlmManager.getInstance();
  private ragPipeline = RagPipelineService.getInstance();
  private lawsCount = 0;


  constructor() {
    this.initLawsCount().catch(() => {});
  }

  private async initLawsCount(): Promise<void> {
    try {
      // 1. 벡터 DB(LanceDB 등)에서 고유 법률 수 우선 조회 (data/raws가 없는 환경 대응)
      if (this.vectorStore.getLawsCount) {
        const count = await this.vectorStore.getLawsCount().catch(() => 0);
        if (count > 0) {
          this.lawsCount = count;
          return;
        }
      }

      // 2. data/raws 디렉토리가 남아있는 경우 폴백 조회
      const effectiveDir = LawScanner.resolveEffectiveDir(RAW_LAWS_DIR);
      if (existsSync(effectiveDir)) {
        const entries = await fs.readdir(effectiveDir, { withFileTypes: true });
        this.lawsCount = entries.filter((e) => e.isDirectory() && e.name !== '.git' && e.name !== 'kr').length;
      } else {
        this.lawsCount = 0;
      }
    } catch {
      this.lawsCount = 0;
    }
  }

  public start(): http.Server {
    const server = http.createServer(async (req, res) => {
      // CORS 및 헤더 설정
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://localhost:${PORT}`);

      try {
        if (url.pathname === API_ENDPOINTS.DB_STATUS && req.method === 'GET') {
          await this.handleDbStatus(res);
          return;
        }

        if (url.pathname === API_ENDPOINTS.DB_SYNC && req.method === 'GET') {
          await this.handleDbSync(res);
          return;
        }

        if (url.pathname === API_ENDPOINTS.STATS && req.method === 'GET') {
          await this.handleStats(res);
          return;
        }

        if (url.pathname === API_ENDPOINTS.LLM_MODELS && req.method === 'GET') {
          await this.handleGetModels(res);
          return;
        }

        if (url.pathname === API_ENDPOINTS.LLM_TOGGLE && req.method === 'POST') {
          const body = await this.readJsonBody(req);
          await this.handleToggleLlm(body, res);
          return;
        }

        if (url.pathname === API_ENDPOINTS.LLM_MODEL && req.method === 'POST') {
          const body = await this.readJsonBody(req);
          await this.handleSwitchModel(body, res);
          return;
        }

        if (url.pathname === API_ENDPOINTS.LLM_MODEL && req.method === 'DELETE') {
          const body = await this.readJsonBody(req);
          await this.handleDeleteModel(body, res);
          return;
        }

        if (url.pathname === API_ENDPOINTS.LLM_PRESETS && req.method === 'GET') {
          await this.handleGetPresets(res);
          return;
        }

        if (url.pathname === API_ENDPOINTS.LLM_HF_FILES && req.method === 'GET') {
          await this.handleGetHfFiles(url, res);
          return;
        }

        if (url.pathname === API_ENDPOINTS.LLM_DOWNLOAD && req.method === 'POST') {
          const body = await this.readJsonBody(req);
          await this.handleDownloadModel(body, res);
          return;
        }

        if (url.pathname === API_ENDPOINTS.LLM_DOWNLOAD_STREAM && req.method === 'GET') {
          await this.handleDownloadStream(res);
          return;
        }

        if (url.pathname === API_ENDPOINTS.LLM_DOWNLOAD_CANCEL && req.method === 'POST') {
          await this.handleCancelDownload(res);
          return;
        }

        if (url.pathname === API_ENDPOINTS.SEARCH && req.method === 'POST') {
          const body = await this.readJsonBody(req);
          await this.handleSearch(body, res);
          return;
        }

        if (url.pathname === API_ENDPOINTS.CHAT && req.method === 'POST') {
          const body = await this.readJsonBody(req);
          await this.handleChat(body, res);
          return;
        }

        if (url.pathname === API_ENDPOINTS.SYSTEM_OPEN_URL && req.method === 'POST') {
          const body = await this.readJsonBody(req);
          await this.handleOpenUrl(body, res);
          return;
        }

        if (url.pathname === API_ENDPOINTS.SYSTEM_STORAGE && req.method === 'GET') {
          await this.handleSystemStorage(res);
          return;
        }

        if (url.pathname === API_ENDPOINTS.SYSTEM_RESET_DATA && req.method === 'POST') {
          await this.handleSystemResetData(res);
          return;
        }

        if (url.pathname === API_ENDPOINTS.SYSTEM_UNINSTALL && req.method === 'POST') {
          await this.handleSystemUninstall(res);
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Not Found' }));
      } catch (err: unknown) {
        console.error('API Error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    });

    server.listen(PORT, () => {
      console.log(`📡 [RAG 로컬 API 서버] http://localhost:${PORT} 에서 대기 중...`);
      // 서버 구동 시 임베딩 모델 사전 로드
      this.embeddingService.warmup();

      // 온디바이스 LLM 사용 설정에 따라 사전 로드 분기
      if (USE_ONDEVICE_LLM) {
        console.log(`🤖 [Config] 온디바이스 LLM 활성화 상태 (.env: USE_ONDEVICE_LLM=true, 모델: ${ONDEVICE_LLM_MODEL})`);
        this.llmManager.warmup();
      } else {
        console.log(`ℹ️ [Config] 온디바이스 LLM 비활성화 상태 (.env: USE_ONDEVICE_LLM=false)`);
      }

      console.log(`📑 [Config] 최대 근거 법조문 수: ${MAX_REFERENCES}건 (.env: MAX_REFERENCES=${process.env.MAX_REFERENCES ?? '미설정'})`);
    });

    return server;
  }

  private async readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  private async handleDbStatus(res: http.ServerResponse): Promise<void> {
    const syncService = DbSyncService.getInstance();
    const isReady = await syncService.isDatabaseReady();
    const info = await this.vectorStore.getCollectionInfo().catch(() => ({ points_count: 0, indexed_vectors_count: 0 }));

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        ready: isReady,
        pointsCount: info.points_count,
        progress: syncService.getProgress(),
      })
    );
  }

  private async handleDbSync(res: http.ServerResponse): Promise<void> {
    const syncService = DbSyncService.getInstance();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const cleanup = syncService.onProgress((progress) => {
      sendEvent('progress', progress);
      if (progress.status === 'completed' || progress.status === 'error') {
        sendEvent('done', progress);
        setTimeout(() => {
          cleanup();
          res.end();
        }, 500);
      }
    });

    req_close: {
      res.on('close', () => {
        cleanup();
      });
    }

    // 초기 상태 즉시 전송
    sendEvent('progress', syncService.getProgress());

    // 동기화 비동기 실행 (이미 진행 중이 아니면 시작)
    syncService.syncDatabase().catch((err) => {
      console.error('handleDbSync error:', err);
    });
  }

  private async handleStats(res: http.ServerResponse): Promise<void> {
    const info = await this.vectorStore.getCollectionInfo().catch((err) => {
      console.warn('⚠️ [Stats] 컬렉션 정보 조회 대기/실패:', err instanceof Error ? err.message : err);
      return { points_count: 0, indexed_vectors_count: 0 };
    });

    // DB 동기화 완료 후 최초 1회 또는 lawsCount가 0일 때 벡터 DB에서 고유 법률 수 갱신
    if (this.lawsCount === 0 && this.vectorStore.getLawsCount) {
      const count = await this.vectorStore.getLawsCount().catch(() => 0);
      if (count > 0) {
        this.lawsCount = count;
      }
    }

    const llmStatus = this.llmManager.getStatus();

    const stats: ServerStatsResponse = {
      version: APP_VERSION,
      collection: VECTOR_STORE_TYPE === 'lancedb' ? LANCEDB_TABLE_NAME : QDRANT_COLLECTION,
      lawsCount: this.lawsCount,
      pointsCount: typeof info.points_count === 'number' ? info.points_count : 0,
      indexedVectors: typeof (info.indexed_vectors_count ?? info.points_count) === 'number'
        ? (info.indexed_vectors_count ?? info.points_count)!
        : 0,
      useOnDeviceLlm: llmStatus.enabled,
      llm: llmStatus,
      engine: llmStatus.engine,
      gpu: llmStatus.gpu,
      vectorBackend: VECTOR_STORE_TYPE,
      minReferenceScoreThreshold: MIN_REFERENCE_SCORE_THRESHOLD,
    };

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(stats));
  }

  private async handleGetModels(res: http.ServerResponse): Promise<void> {
    const models = await this.llmManager.getAvailableModels();
    const currentStatus = this.llmManager.getStatus();

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      models,
      currentModel: currentStatus.modelName,
      enabled: currentStatus.enabled,
    }));
  }

  private async handleToggleLlm(body: Record<string, unknown>, res: http.ServerResponse): Promise<void> {
    const enabled = Boolean(body.enabled);
    console.log(`🔌 [API] 온디바이스 LLM 토글 요청: ${enabled ? '켜기 (메모리 로드)' : '끄기 (메모리 해제)'}`);
    const status = await this.llmManager.setEnabled(enabled);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, status }));
  }

  private async handleSwitchModel(body: Record<string, unknown>, res: http.ServerResponse): Promise<void> {
    const model = String(body.model || '').trim();
    if (!model) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'model 이름이 필요합니다.' }));
      return;
    }

    console.log(`🔀 [API] 온디바이스 LLM 모델 전환 요청: ${model}`);
    const status = await this.llmManager.switchModel(model);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, status }));
  }

  private async handleDeleteModel(body: Record<string, unknown>, res: http.ServerResponse): Promise<void> {
    const filename = String(body.filename || body.model || '').trim();
    if (!filename) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'filename이 필요합니다.' }));
      return;
    }

    console.log(`🗑️ [API] 온디바이스 LLM 모델 삭제 요청: ${filename}`);
    const result = await this.llmManager.deleteModel(filename);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
  }

  private async handleGetPresets(res: http.ServerResponse): Promise<void> {
    const presets = await this.llmManager.getPresetsWithStatus();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ presets }));
  }

  private async handleGetHfFiles(url: URL, res: http.ServerResponse): Promise<void> {
    const repo = url.searchParams.get('repo')?.trim();
    if (!repo) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'repo 파라미터가 필요합니다.' }));
      return;
    }

    try {
      const files = await ModelDownloaderService.getInstance().fetchHfGgufList(repo);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ files }));
    } catch (err: unknown) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  }

  private async handleDownloadModel(body: Record<string, unknown>, res: http.ServerResponse): Promise<void> {
    const repo = String(body.repo || '').trim();
    const filePath = String(body.filePath || body.filename || '').trim();

    if (!repo || !filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'repo 및 filePath가 필요합니다.' }));
      return;
    }

    const downloader = ModelDownloaderService.getInstance();
    downloader.startDownload(repo, filePath).catch((err) => {
      console.error('⚠️ [API] 다운로드 백그라운드 에러:', err);
    });

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, message: '다운로드가 시작되었습니다.' }));
  }

  private async handleDownloadStream(res: http.ServerResponse): Promise<void> {
    const downloader = ModelDownloaderService.getInstance();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const cleanup = downloader.onProgress((progress) => {
      sendEvent('progress', progress);
      if (progress.status === 'completed' || progress.status === 'error') {
        sendEvent('done', progress);
        setTimeout(() => {
          cleanup();
          res.end();
        }, 500);
      }
    });

    res.on('close', () => {
      cleanup();
    });

    sendEvent('progress', downloader.getProgress());
  }

  private async handleCancelDownload(res: http.ServerResponse): Promise<void> {
    const success = ModelDownloaderService.getInstance().cancelDownload();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success }));
  }

  private async handleSearch(body: Record<string, unknown>, res: http.ServerResponse): Promise<void> {
    const query = String(body.query || '').trim();
    if (!query) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'query가 필요합니다.' }));
      return;
    }

    const limit = Number(body.limit) || MAX_REFERENCES;
    const { scoredChunks } = await this.ragPipeline.searchArticles(query, limit);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ results: scoredChunks }));
  }

  private async handleChat(body: Record<string, unknown>, res: http.ServerResponse): Promise<void> {
    const query = String(body.query || '').trim();
    const isStream = body.stream !== false; // 기본값 true (스트리밍)
    const limit = Number(body.limit) || MAX_REFERENCES;

    console.log(`💬 [RAG] 질의 요청 수신: "${query}" (스트리밍: ${isStream}, 최대참조: ${limit})`);

    if (!query) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'query가 필요합니다.' }));
      return;
    }

    if (!isStream) {
      // 단일 JSON 응답 모드 (SSOT 파이프라인 호출)
      const result = await this.ragPipeline.executeChat({ query, limit });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ answer: result.answer, references: result.references }));
      return;
    }

    // SSE 스트리밍 모드
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.flushHeaders();

    const sendSse = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await this.ragPipeline.executeChat({
        query,
        limit,
        onToken: (token) => {
          if (token) sendSse('token', { token });
        },
        onStatus: (message) => {
          sendSse('status', { message });
        },
      });

      console.log(
        `📑 [RAG 2단계 선별 완료] 근거 법조문 ${result.references.length}건 확정 전송`
      );

      sendSse('references', result.references);
      sendSse('done', { answer: result.answer, references: result.references });
    } catch (err: unknown) {
      console.error('스트리밍 처리 중 에러:', err);
      sendSse('error', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      res.end();
    }
  }

  /**
   * 데스크톱(Tauri) 및 웹 환경 공통 OS 기본 브라우저 열기 핸들러
   */
  private async handleOpenUrl(
    body: Record<string, unknown>,
    res: http.ServerResponse
  ): Promise<void> {
    const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
    if (!rawUrl || (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://'))) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '올바른 HTTP/HTTPS URL이 아닙니다.' }));
      return;
    }

    try {
      if (process.platform === 'darwin') {
        execFile('open', [rawUrl]);
      } else if (process.platform === 'win32') {
        execFile('cmd', ['/c', 'start', '', rawUrl]);
      } else {
        execFile('xdg-open', [rawUrl]);
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true }));
    } catch (err: unknown) {
      console.error('외부 브라우저 열기 실패:', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '외부 브라우저를 열지 못했습니다.' }));
    }
  }

  /**
   * 애플리케이션 스토리지 용량 통계 조회 핸들러
   */
  private async handleSystemStorage(res: http.ServerResponse): Promise<void> {
    try {
      const stats = await SystemMaintenanceService.getInstance().getStorageUsage();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(stats));
    } catch (err: unknown) {
      console.error('스토리지 용량 조회 실패:', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '스토리지 용량을 조회하지 못했습니다.' }));
    }
  }

  /**
   * 사용자 데이터 초기화(Reset) 핸들러
   */
  private async handleSystemResetData(res: http.ServerResponse): Promise<void> {
    try {
      const result = await SystemMaintenanceService.getInstance().resetData();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err: unknown) {
      console.error('데이터 초기화 실패:', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '데이터 초기화에 실패했습니다.' }));
    }
  }

  /**
   * 앱 및 데이터 완전 삭제(Uninstall) 핸들러
   */
  private async handleSystemUninstall(res: http.ServerResponse): Promise<void> {
    try {
      const result = await SystemMaintenanceService.getInstance().uninstallApplication();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err: unknown) {
      console.error('앱 완전 삭제 실패:', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '앱 완전 삭제 처리에 실패했습니다.' }));
    }
  }

}

// 직접 스크립트 실행 시
if (
  process.argv[1]?.endsWith('ragServer.ts') ||
  process.argv[1]?.endsWith('ragServer.js') ||
  process.argv[1]?.endsWith('ragServer.mjs')
) {
  const server = new RagServer();
  server.start();
}
