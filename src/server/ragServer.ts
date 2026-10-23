import http from 'node:http';
import fs from 'node:fs/promises';
import { EmbeddingService } from '../indexer/embeddingService.js';
import { getVectorStoreService } from '../indexer/vectorStore.js';
import { LlmManager } from './llmManager.js';
import { LawScanner } from '../parser/lawScanner.js';
import { RagPipelineService } from './ragPipelineService.js';
import {
  USE_ONDEVICE_LLM,
  ONDEVICE_LLM_MODEL,
  SERVER_PORT,
  MAX_REFERENCES,
  RAW_LAWS_DIR,
} from '../config/constants.js';
import { ServerStatsResponse } from '../types/law.js';

const PORT = SERVER_PORT;

/**
 * 하위 호환성을 위해 제공되는 후보군 추출 개수 계산 헬퍼 (SSOT: RagPipelineService)
 */
export function calcCandidateLimit(limit: number): number {
  return RagPipelineService.getInstance().calcCandidateLimit(limit);
}

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
      const effectiveDir = LawScanner.resolveEffectiveDir(RAW_LAWS_DIR);
      const entries = await fs.readdir(effectiveDir, { withFileTypes: true });
      this.lawsCount = entries.filter((e) => e.isDirectory() && e.name !== '.git' && e.name !== 'kr').length;
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
        if (url.pathname === '/api/stats' && req.method === 'GET') {
          await this.handleStats(res);
          return;
        }

        if (url.pathname === '/api/llm/models' && req.method === 'GET') {
          await this.handleGetModels(res);
          return;
        }

        if (url.pathname === '/api/llm/toggle' && req.method === 'POST') {
          const body = await this.readJsonBody(req);
          await this.handleToggleLlm(body, res);
          return;
        }

        if (url.pathname === '/api/llm/model' && req.method === 'POST') {
          const body = await this.readJsonBody(req);
          await this.handleSwitchModel(body, res);
          return;
        }

        if (url.pathname === '/api/search' && req.method === 'POST') {
          const body = await this.readJsonBody(req);
          await this.handleSearch(body, res);
          return;
        }

        if (url.pathname === '/api/chat' && req.method === 'POST') {
          const body = await this.readJsonBody(req);
          await this.handleChat(body, res);
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
        console.log(`🤖 [Config] 온디바이스 LLM 활성화 상태 (.env: USE_ONDEVICE_LLM=true, 모델: ${process.env.ONDEVICE_LLM || ONDEVICE_LLM_MODEL})`);
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

  private async handleStats(res: http.ServerResponse): Promise<void> {
    const info = await this.vectorStore.getCollectionInfo().catch(() => ({ points_count: 0, indexed_vectors_count: 0 }));
    const llmStatus = this.llmManager.getStatus();

    const stats: ServerStatsResponse = {
      collection: 'korean_laws',
      lawsCount: this.lawsCount,
      pointsCount: typeof info.points_count === 'number' ? info.points_count : 0,
      indexedVectors: typeof (info.indexed_vectors_count ?? info.points_count) === 'number'
        ? (info.indexed_vectors_count ?? info.points_count)!
        : 0,
      useOnDeviceLlm: llmStatus.enabled,
      llm: llmStatus,
      engine: llmStatus.engine,
      gpu: llmStatus.gpu,
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

}

// 직접 스크립트 실행 시
if (process.argv[1]?.endsWith('ragServer.ts') || process.argv[1]?.endsWith('ragServer.js')) {
  const server = new RagServer();
  server.start();
}
