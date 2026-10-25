import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { LOGS_DIR } from '../config/constants.js';
import type { ReferenceArticle } from '../types/law.js';
import type { StatuteGroupSummary } from './lawAggregator.js';

export interface QueryAnalysisLogData {
  systemPrompt?: string;
  prompt: string;
  rawOutput: string;
  isLegalQuery: boolean;
  keywords: string[];
  searchTargetQuery: string;
}

interface VectorChunkSnippet {
  lawName: string;
  articleNumber: string;
  articleTitle?: string;
  score: number;
  snippet: string;
}

export interface VectorSearchLogData {
  searchTargetQuery: string;
  candidateLimit: number;
  rawChunksCount: number;
  topRawChunks: VectorChunkSnippet[];
  filteredCount: number;
}

export interface RerankLogData {
  systemPrompt?: string;
  prompt: string;
  rawOutput: string;
  parsedIndices: number[];
  beforeTopLaw?: string;
  afterTopLaw?: string;
  isPromoted: boolean;
  statuteSummaries?: StatuteGroupSummary[];
}

export interface StepLogData {
  stepKey: string;
  title: string;
  statusMessage?: string;
  systemPrompt?: string;
  prompt: string;
  rawOutput: string;
}

export interface FinalResultLogData {
  fullAnswer: string;
  references: Array<Pick<ReferenceArticle, 'lawName' | 'articleNumber' | 'articleTitle' | 'score' | 'matchReasons'>>;
  modelName?: string;
  engine?: string;
  elapsedMs: number;
}

/**
 * 2자리 숫자 패딩 헬퍼 함수
 */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Date 객체를 yyyymmddhhiiss 포맷 문자열로 변환합니다.
 */
function formatTimestampFileName(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const ii = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return `${yyyy}${mm}${dd}${hh}${ii}${ss}`;
}

/**
 * Date 객체를 가독성 좋은 KST 일시 포맷 문자열로 변환합니다.
 */
function formatReadableDateTime(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const ii = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${ii}:${ss}`;
}

/**
 * 단일 질의응답 사이클의 모든 단계별 입출력과 상태를 수집하여 마크다운 파일로 영속화하는 로거 세션
 */
export class QueryLogSession {
  public readonly id: string;
  public readonly startTime: Date;
  public readonly query: string;

  private queryAnalysisData?: QueryAnalysisLogData;
  private vectorSearchData?: VectorSearchLogData;
  private rerankData?: RerankLogData;
  private steps: StepLogData[] = [];
  private finalResultData?: FinalResultLogData;
  private errorInfo?: string;
  private statuses: Array<{ time: Date; message: string }> = [];

  private targetPath?: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(query: string, startTime: Date = new Date()) {
    this.query = query;
    this.startTime = startTime;
    this.id = formatTimestampFileName(startTime);
  }

  /**
   * 세션에서 사용할 단일 로그 파일 경로를 안전하게 확정합니다 (1회 캐싱).
   */
  private async resolveTargetPath(): Promise<string> {
    if (this.targetPath) {
      return this.targetPath;
    }

    await fs.mkdir(LOGS_DIR, { recursive: true });

    const baseName = this.id;
    let fileName = `${baseName}.log`;
    let target = path.join(LOGS_DIR, fileName);
    let counter = 1;

    while (true) {
      try {
        await fs.access(target);
        fileName = `${baseName}_${counter}.log`;
        target = path.join(LOGS_DIR, fileName);
        counter++;
      } catch {
        break;
      }
    }

    this.targetPath = target;
    return this.targetPath;
  }

  /**
   * 동시 쓰기(Race Condition)를 방지하는 Promise 큐 기반 비동기 자동 저장 트리거
   */
  public triggerPersist(): void {
    const isFirstCreation = !this.targetPath;
    this.writeQueue = this.writeQueue
      .then(async () => {
        const filePath = await this.resolveTargetPath();
        const content = this.toMarkdown();
        await fs.writeFile(filePath, content, 'utf-8');
        if (isFirstCreation) {
          await QueryLogger.pruneOldLogs(20);
        }
      })
      .catch((err) => {
        console.error('❌ [QueryLogger] 로그 점진적 저장 오류:', err);
      });
  }

  public recordStatus(message: string): void {
    if (!message) return;
    this.statuses.push({ time: new Date(), message });
    this.triggerPersist();
  }

  public recordQueryAnalysis(data: QueryAnalysisLogData): void {
    this.queryAnalysisData = data;
    this.triggerPersist();
  }

  public recordVectorSearch(data: VectorSearchLogData): void {
    this.vectorSearchData = data;
    this.triggerPersist();
  }

  public recordRerank(data: RerankLogData): void {
    this.rerankData = data;
    this.triggerPersist();
  }

  public recordStep(data: StepLogData): void {
    this.steps.push(data);
    this.triggerPersist();
  }

  public recordFinalResult(data: FinalResultLogData): void {
    this.finalResultData = data;
    this.triggerPersist();
  }

  public recordError(error: unknown): void {
    if (error instanceof Error) {
      this.errorInfo = `${error.name}: ${error.message}\n${error.stack || ''}`;
    } else {
      this.errorInfo = String(error);
    }
    this.triggerPersist();
  }

  /**
   * 수집된 데이터를 바탕으로 상세 마크다운 문서를 렌더링합니다.
   */
  public toMarkdown(): string {
    const formattedDate = formatReadableDateTime(this.startTime);
    const lines: string[] = [];

    // 1. 헤더 및 메타데이터
    lines.push(`# ⚖️ 법률 RAG 질의응답 상세 로그 (${formattedDate})`);
    lines.push('');
    lines.push('## 📌 [메타데이터]');
    lines.push(`- **질의 일시**: ${formattedDate}`);
    lines.push(`- **사용자 질문**: \`${this.query}\``);
    if (this.finalResultData?.modelName) {
      lines.push(`- **사용 모델**: ${this.finalResultData.modelName}`);
    }
    if (this.finalResultData?.engine) {
      lines.push(`- **추론 엔진**: ${this.finalResultData.engine}`);
    }
    if (this.finalResultData?.elapsedMs !== undefined) {
      lines.push(`- **총 소요 시간**: ${this.finalResultData.elapsedMs.toLocaleString()}ms`);
    }
    lines.push('');

    // 2. 실시간 상태 타임라인
    if (this.statuses.length > 0) {
      lines.push('## ⏱️ [파이프라인 진행 상태 타임라인]');
      this.statuses.forEach((st) => {
        lines.push(`- **${formatReadableDateTime(st.time)}**: ${st.message}`);
      });
      lines.push('');
    }

    // 3. [1단계] 사용자 질문 분석 및 키워드 추출
    lines.push('---');
    lines.push('');
    lines.push('## 1️⃣ [1단계: 사용자 질문 분석 및 법률 검색어 추출]');
    if (this.queryAnalysisData) {
      const qa = this.queryAnalysisData;
      lines.push(`- **대한민국 법령 관련성 판정**: ${qa.isLegalQuery ? '✅ 관련 있음 (true)' : '⚠️ 무관함 (false - 가드레일 작동)'}`);
      lines.push(`- **추출된 검색 키워드**: ${qa.keywords.length > 0 ? qa.keywords.map((k) => `\`${k}\``).join(', ') : '*(추출 키워드 없음)*'}`);
      lines.push(`- **최종 Qdrant 임베딩 쿼리**: \`${qa.searchTargetQuery}\``);
      lines.push('');

      if (qa.systemPrompt) {
        lines.push('### 📥 시스템 프롬프트 (System Prompt)');
        lines.push('```text');
        lines.push(qa.systemPrompt.trim());
        lines.push('```');
        lines.push('');
      }

      lines.push('### 📥 LLM 질의 (Prompt)');
      lines.push('```markdown');
      lines.push(qa.prompt.trim());
      lines.push('```');
      lines.push('');

      lines.push('### 📤 LLM 원본 응답 (Raw Response)');
      lines.push('```text');
      lines.push(qa.rawOutput.trim());
      lines.push('```');
      lines.push('');
    } else {
      lines.push('*1단계 분석 데이터가 기록되지 않았거나 건너뛰었습니다.*');
      lines.push('');
    }

    // 4. [2단계] Qdrant 벡터 검색
    lines.push('---');
    lines.push('');
    lines.push('## 2️⃣ [2단계: Qdrant 벡터 검색 및 유효 조문 선별]');
    if (this.vectorSearchData) {
      const vs = this.vectorSearchData;
      lines.push(`- **검색 타겟 쿼리**: \`${vs.searchTargetQuery}\``);
      lines.push(`- **후보군 추출 목표**: ${vs.candidateLimit}건`);
      lines.push(`- **실제 검색된 후보 조문 수**: ${vs.rawChunksCount}건`);
      lines.push(`- **1차 실효 조문 필터링 후 잔여 조문 수**: ${vs.filteredCount}건`);
      lines.push('');

      if (vs.topRawChunks.length > 0) {
        lines.push('### 📚 Qdrant 벡터 검색 상위 후보군');
        vs.topRawChunks.forEach((c, idx) => {
          const titleSuffix = c.articleTitle ? ` (${c.articleTitle})` : '';
          const scorePercent = (c.score * 100).toFixed(2);
          lines.push(`#### ${idx + 1}. [${c.lawName}] ${c.articleNumber}${titleSuffix}`);
          lines.push(`- **유사도**: ${scorePercent}% (코사인 점수: ${c.score.toFixed(4)})`);
          lines.push(`- **내용 요약**:\n> ${c.snippet.replace(/\n+/g, ' ')}`);
          lines.push('');
        });
      }
    } else {
      lines.push('*2단계 벡터 검색이 수행되지 않았습니다.*');
      lines.push('');
    }

    // 5. [3단계] 지능형 문맥 적합도 리랭킹
    lines.push('---');
    lines.push('');
    lines.push('## 3️⃣ [3단계: 질문 문맥 적합도 지능형 검토 (Reranking)]');
    if (this.rerankData) {
      const rr = this.rerankData;
      lines.push(`- **지능형 승격 여부**: ${rr.isPromoted ? '🚀 승격 완료' : '⚪ 순위 변동 없음'}`);
      if (rr.beforeTopLaw && rr.afterTopLaw) {
        lines.push(`- **1순위 변동**: \`${rr.beforeTopLaw}\` ➔ \`${rr.afterTopLaw}\``);
      }
      lines.push(`- **파싱된 추천 순위 (1-based)**: [${rr.parsedIndices.join(', ')}]`);
      lines.push('');

      if (rr.statuteSummaries && rr.statuteSummaries.length > 0) {
        lines.push('### 📊 법령 단위 Group By 집계 및 후보군 선별 (상위 5개)');
        lines.push('| 순위 | 법령명 | 걸린 조문 수 | 최고 유사도 | 종합 점수 |');
        lines.push('| :---: | :--- | :---: | :---: | :---: |');
        rr.statuteSummaries.slice(0, 5).forEach((stat, idx) => {
          const maxPct = (stat.maxScore * 100).toFixed(2);
          const combPct = (stat.combinedScore * 100).toFixed(2);
          lines.push(`| ${idx + 1} | **${stat.lawName}** | ${stat.matchCount}건 | ${maxPct}% | ${combPct}% |`);
        });
        lines.push('');
      }

      if (rr.systemPrompt) {
        lines.push('### 📥 시스템 프롬프트 (System Prompt)');
        lines.push('```text');
        lines.push(rr.systemPrompt.trim());
        lines.push('```');
        lines.push('');
      }

      lines.push('### 📥 LLM 질의 (Rerank Prompt)');
      lines.push('```markdown');
      lines.push(rr.prompt.trim());
      lines.push('```');
      lines.push('');

      lines.push('### 📤 LLM 원본 응답 (Raw Response)');
      lines.push('```text');
      lines.push(rr.rawOutput.trim());
      lines.push('```');
      lines.push('');
    } else {
      lines.push('*3단계 리랭킹이 수행되지 않았거나 생략되었습니다.*');
      lines.push('');
    }

    // 6. [4단계] 답변 생성 및 체이닝 단계들
    lines.push('---');
    lines.push('');
    lines.push('## 4️⃣ [4단계: 법률 검토 답변 작성 및 세부 보강]');
    if (this.steps.length > 0) {
      this.steps.forEach((step, idx) => {
        lines.push(`### 4-${idx + 1}. ${step.title}`);
        if (step.statusMessage) {
          lines.push(`- **상태 메시지**: \`${step.statusMessage}\``);
        }
        lines.push('');

        if (step.systemPrompt) {
          lines.push('#### 📥 시스템 프롬프트 (System Prompt)');
          lines.push('```text');
          lines.push(step.systemPrompt.trim());
          lines.push('```');
          lines.push('');
        }

        lines.push('#### 📥 LLM 질의 (Prompt)');
        lines.push('```markdown');
        lines.push(step.prompt.trim());
        lines.push('```');
        lines.push('');

        lines.push('#### 📤 LLM 응답 (Raw Output)');
        lines.push('```markdown');
        lines.push(step.rawOutput.trim());
        lines.push('```');
        lines.push('');
      });
    } else {
      lines.push('*4단계 답변 생성 단계 데이터가 없습니다.*');
      lines.push('');
    }

    // 7. [5단계] 최종 산출물 및 인용 조문
    lines.push('---');
    lines.push('');
    lines.push('## 5️⃣ [5단계: 최종 산출물 및 근거 법조문 카드]');
    if (this.finalResultData) {
      const fr = this.finalResultData;
      lines.push(`- **확정된 근거 법조문 개수**: ${fr.references.length}건`);
      if (fr.references.length > 0) {
        lines.push('### 📜 최종 선별된 근거 법조문 카드');
        fr.references.forEach((ref, idx) => {
          const titleSuffix = ref.articleTitle ? ` (${ref.articleTitle})` : '';
          const matchReasonsStr = ref.matchReasons && ref.matchReasons.length > 0
            ? ` [${ref.matchReasons.join(', ')}]`
            : '';
          const scorePercent = (ref.score * 100).toFixed(1);
          lines.push(`${idx + 1}. **[${ref.lawName}] ${ref.articleNumber}${titleSuffix}** - 유사도: ${scorePercent}%${matchReasonsStr}`);
        });
        lines.push('');
      }

      lines.push('### 💬 최종 생성 답변 전문 (Final Answer)');
      lines.push('');
      lines.push(fr.fullAnswer.trim());
      lines.push('');
    }

    // 8. 에러 정보 (있는 경우)
    if (this.errorInfo) {
      lines.push('---');
      lines.push('');
      lines.push('## ⚠️ [파이프라인 실행 중 발생한 오류]');
      lines.push('```text');
      lines.push(this.errorInfo);
      lines.push('```');
      lines.push('');
    } else if (!this.finalResultData) {
      // 최종 결과 및 오류가 아직 기록되지 않은 실시간 진행 중 상태 안내
      lines.push('---');
      lines.push('');
      lines.push('## ⏳ [파이프라인 실시간 진행 중]');
      lines.push('> 💡 RAG 파이프라인이 현재 단계별로 실행 중입니다. 각 단계가 완료될 때마다 이 파일이 실시간으로 자동 갱신됩니다.');
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * logs/ 디렉터리에 yyyymmddhhiiss.log 파일로 저장하고 완료될 때까지 대기합니다.
   * 진행 중인 쓰기 큐를 await하여 최종 무결성을 보장합니다.
   */
  public async saveToFile(): Promise<string> {
    this.triggerPersist();
    await this.writeQueue;
    return this.targetPath || '';
  }
}

/**
 * RAG 질의응답 로거 팩토리 (Single Source of Truth)
 */
export class QueryLogger {
  public static startSession(query: string): QueryLogSession {
    const session = new QueryLogSession(query, new Date());
    // 세션 인스턴스 생성 즉시 초기 파일 생성 (실시간 추적 시작)
    session.triggerPersist();
    return session;
  }

  /**
   * logs/ 디렉터리 내 로그 파일(.log) 중 최신 maxKeep개만 남기고 오래된 파일을 안전하게 삭제합니다.
   * 
   * @param maxKeep 유지할 최신 로그 파일 최대 개수 (기본값: 20개)
   */
  public static async pruneOldLogs(maxKeep: number = 20): Promise<void> {
    try {
      if (!fsSync.existsSync(LOGS_DIR)) {
        return;
      }

      const entries = await fs.readdir(LOGS_DIR, { withFileTypes: true });
      const logFiles = entries
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.log'))
        .map((e) => e.name);

      if (logFiles.length <= maxKeep) {
        return;
      }

      // 파일 수정 시간(mtime) 및 파일명 기준 최신순 정렬
      const fileStats = await Promise.all(
        logFiles.map(async (name) => {
          try {
            const stat = await fs.stat(path.join(LOGS_DIR, name));
            return { name, mtimeMs: stat.mtimeMs };
          } catch {
            return { name, mtimeMs: 0 };
          }
        })
      );

      fileStats.sort((a, b) => {
        if (b.mtimeMs !== a.mtimeMs) {
          return b.mtimeMs - a.mtimeMs;
        }
        return b.name.localeCompare(a.name);
      });

      const filesToDelete = fileStats.slice(maxKeep);
      for (const item of filesToDelete) {
        try {
          await fs.unlink(path.join(LOGS_DIR, item.name));
        } catch {
          // 개별 파일 삭제 실패 시 스킵
        }
      }

      console.log(`🧹 [QueryLogger] logs/ 보관 한도(${maxKeep}개) 초과 파일 ${filesToDelete.length}건 자동 정리 완료`);
    } catch (err) {
      console.warn('⚠️ [QueryLogger] 오래된 로그 정리 중 경고:', err);
    }
  }
}
