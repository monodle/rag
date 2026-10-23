import fs from 'node:fs';
import path from 'node:path';
import { ScoredArticleChunk } from '../indexer/qdrantService.js';
import { LlamaCppService, type QueryAnalysisResult } from './llamaCppService.js';
import { LlmService } from './llmService.js';
import { MODELS_DIR } from '../config/constants.js';
import { getNoRelevantLawMessage, getFallbackSummary } from './promptManager.js';
import { formatModelDisplayName } from '../types/lawRegex.js';
import { QueryLogSession } from './queryLogger.js';

export type { QueryAnalysisResult };

export interface UnifiedLlmStatus {
  enabled: boolean;
  isReady: boolean;
  isInitializing: boolean;
  modelName: string;
  gpu: string;
  engine: 'disabled' | 'metal-gpu' | 'onnx-cpu';
}

export interface AvailableLlmModel {
  filename: string;
  name: string;
  title: string;
  quant: string;
  sizeBytes: number;
  isCurrent: boolean;
}

/**
 * 온디바이스 언어 모델 추론을 총괄하는 통합 오케스트레이터 Facade (Single Source of Truth)
 * 
 * - Apple Silicon Metal GPU (node-llama-cpp) 동적 로드/언로드 지원
 * - GPU 미지원 또는 실패 시 ONNX CPU (Transformers.js) 자동 폴백
 * - 온디바이스 LLM 비활성화 상태에서는 메모리를 즉시 해제하고 구조화 법률 요약(Fallback Summary) 모드로 안전 전환
 */
export class LlmManager {
  private static instance: LlmManager | null = null;
  private llamaCppService: LlamaCppService;
  private llmService: LlmService;

  private constructor() {
    this.llamaCppService = LlamaCppService.getInstance();
    this.llmService = LlmService.getInstance();
  }

  public static getInstance(): LlmManager {
    if (!LlmManager.instance) {
      LlmManager.instance = new LlmManager();
    }
    return LlmManager.instance;
  }

  /**
   * 온디바이스 LLM 전체 상태를 단일 규격으로 반환합니다.
   */
  public getStatus(): UnifiedLlmStatus {
    const llamaStatus = this.llamaCppService.getStatus();
    const onnxStatus = this.llmService.getStatus();
    const isEnabled = llamaStatus.enabled;
    const activeStatus = llamaStatus.isReady ? llamaStatus : onnxStatus;

    const engine: 'disabled' | 'metal-gpu' | 'onnx-cpu' = !isEnabled
      ? 'disabled'
      : llamaStatus.isReady
        ? 'metal-gpu'
        : 'onnx-cpu';

    return {
      enabled: isEnabled,
      isReady: activeStatus.isReady,
      isInitializing: activeStatus.isInitializing,
      modelName: activeStatus.modelName || llamaStatus.modelName || '',
      gpu: llamaStatus.gpu || 'none',
      engine,
    };
  }

  /**
   * data/models 디렉터리에 보관된 선택 가능한 GGUF 모델 목록을 스캔합니다.
   */
  public async getAvailableModels(): Promise<AvailableLlmModel[]> {
    if (!fs.existsSync(MODELS_DIR)) {
      return [];
    }

    try {
      const entries = await fs.promises.readdir(MODELS_DIR, { withFileTypes: true });
      const ggufFiles = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.gguf'));
      const currentModelName = path.basename(this.llamaCppService.modelPath || '');

      const models: AvailableLlmModel[] = [];
      for (const file of ggufFiles) {
        const fullPath = path.join(MODELS_DIR, file.name);
        const stat = await fs.promises.stat(fullPath);
        const parsed = formatModelDisplayName(file.name);
        models.push({
          filename: file.name,
          name: file.name,
          title: parsed.title,
          quant: parsed.quant,
          sizeBytes: stat.size,
          isCurrent: file.name === currentModelName,
        });
      }

      return models;
    } catch (err) {
      console.error('⚠️ [LlmManager] 사용 가능 모델 목록 조회 실패:', err);
      return [];
    }
  }

  /**
   * 온디바이스 LLM의 활성화/비활성화 상태를 토글합니다.
   * 비활성화 시 모델 메모리를 해제하고, 활성화 시 메모리에 모델을 적재합니다.
   */
  public async setEnabled(enabled: boolean): Promise<UnifiedLlmStatus> {
    await this.llamaCppService.setEnabled(enabled);
    return this.getStatus();
  }

  /**
   * 사용자가 선택한 모델로 전환하고 즉시 메모리에 적재합니다.
   */
  public async switchModel(filename: string): Promise<UnifiedLlmStatus> {
    const safeFilename = path.basename(filename);
    const fullPath = path.join(MODELS_DIR, safeFilename);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`요청한 모델 파일이 존재하지 않습니다: ${safeFilename}`);
    }

    await this.llamaCppService.switchModel(fullPath);
    return this.getStatus();
  }

  /**
   * 사용자 화면이나 로그에 표시할 모델명을 추출합니다.
   */
  public getDisplayName(): string {
    const status = this.getStatus();
    if (!status.enabled) {
      return '요약 모드';
    }
    if (status.modelName) {
      return status.modelName.replace(/\.gguf$/i, '').split(/[-_][QqIi]/)[0];
    }
    return '온디바이스 AI';
  }

  /**
   * 서버 또는 CLI 구동 시 모델을 사전 로드(예열)합니다.
   */
  public warmup(): void {
    const status = this.getStatus();
    if (!status.enabled) {
      return;
    }

    try {
      this.llamaCppService.warmup();
    } catch {
      this.llmService.warmup();
    }
  }

  /**
   * 법률 질문과 검색 조문을 바탕으로 최적의 엔진을 선택하여 답변을 스트리밍 생성합니다 (SSOT).
   */
  public async generateAnswer(
    query: string,
    scoredChunks: ScoredArticleChunk[],
    onToken?: (token: string) => void,
    onStatus?: (status: string) => void,
    logSession?: QueryLogSession
  ): Promise<string> {
    if (!scoredChunks || scoredChunks.length === 0) {
      const emptyMsg = getNoRelevantLawMessage(query);
      if (onToken) onToken(emptyMsg);
      return emptyMsg;
    }

    const status = this.getStatus();
    if (!status.enabled) {
      const summary = getFallbackSummary(query, scoredChunks);
      if (onToken) onToken(summary);
      return summary;
    }

    const llamaStatus = this.llamaCppService.getStatus();

    // 1. Metal GPU (LlamaCpp) 우선 시도
    if (llamaStatus.isReady || this.llamaCppService.modelPath) {
      try {
        return await this.llamaCppService.generateAnswer(query, scoredChunks, onToken, onStatus, logSession);
      } catch (gpuError) {
        console.warn('⚠️ [LlmManager] Metal GPU 추론 실패, ONNX 엔진으로 폴백합니다:', gpuError);
      }
    }

    // 2. Transformers.js ONNX 폴백 시도
    try {
      return await this.llmService.generateAnswer(query, scoredChunks, onToken);
    } catch (onnxError) {
      console.warn('⚠️ [LlmManager] ONNX 추론 실패, 법률 구조화 요약으로 최종 폴백합니다:', onnxError);
      const fallbackText = getFallbackSummary(query, scoredChunks);
      if (onToken) onToken(fallbackText);
      return fallbackText;
    }
  }

  /**
   * 온디바이스 모델을 통해 사용자 질문의 대한민국 법령 관련성을 1단계에서 사전 판별하고,
   * 관련 질문인 경우 검색용 핵심 법률 키워드를 초고속 추출합니다 (Single-Pass Query Analysis).
   * 모델 미탑재/비활성화 시 { keywords: [], isLegalQuery: true }로 안전하게 폴백합니다 (Defensive Early Return).
   */
  public async analyzeQuery(query: string, logSession?: QueryLogSession): Promise<QueryAnalysisResult> {
    const status = this.getStatus();
    if (!status.enabled) {
      return { keywords: [], isLegalQuery: true };
    }

    // 1. 모델이 아직 준비되지 않았다면 자동 초기화 시도
    if (!this.llamaCppService.isReady) {
      if (this.llamaCppService.modelPath) {
        try {
          await this.llamaCppService.initModel();
        } catch {
          return { keywords: [], isLegalQuery: true };
        }
      } else {
        return { keywords: [], isLegalQuery: true };
      }
    }

    try {
      return await this.llamaCppService.analyzeSearchQuery(query, logSession);
    } catch (err) {
      console.warn('⚠️ [LlmManager] 질의 분석 및 키워드 추출 실패, 기본 검색으로 폴백:', err);
      return { keywords: [], isLegalQuery: true };
    }
  }

  /**
   * 온디바이스 모델을 통해 검색용 핵심 법률 키워드를 초고속 추출합니다 (하위 호환 지원).
   * 모델 미탑재/비활성화 시 빈 배열을 즉시 반환하여 원본 질의로 안전하게 폴백합니다 (SSOT).
   */
  public async extractSearchKeywords(query: string): Promise<string[]> {
    const result = await this.analyzeQuery(query);
    return result.isLegalQuery ? result.keywords : [];
  }

  /**
   * 온디바이스 모델을 통해 Qdrant 검색 후보 조문의 질의 문맥 적합도를 지능형 리랭킹합니다 (SSOT).
   * 모델 미탑재/비활성화 시 원본 후보군을 즉시 반환합니다.
   */
  public async rerankArticlesByRelevance(
    query: string,
    candidateChunks: ScoredArticleChunk[],
    topK: number = 5,
    logSession?: QueryLogSession
  ): Promise<ScoredArticleChunk[]> {
    const status = this.getStatus();
    if (!status.enabled || candidateChunks.length <= 1) {
      return candidateChunks;
    }

    if (!this.llamaCppService.isReady) {
      if (this.llamaCppService.modelPath) {
        try {
          await this.llamaCppService.initModel();
        } catch {
          return candidateChunks;
        }
      } else {
        return candidateChunks;
      }
    }

    try {
      return await this.llamaCppService.rerankArticlesByRelevance(query, candidateChunks, topK, logSession);
    } catch (err) {
      console.warn('⚠️ [LlmManager] 조문 리랭킹 실패, 원본 순서로 폴백:', err);
      return candidateChunks;
    }
  }
}
