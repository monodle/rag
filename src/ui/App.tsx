import React, { useState, useRef, useEffect } from 'react';
import {
  Scale,
  Send,
  BookOpen,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  ShieldAlert,
  Database,
  Cpu,
  MessageSquarePlus,
  ArrowUpRight,
  Sun,
  Moon,
  Loader2,
  Sparkles,
  CheckCircle2,
  Square,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { DbSyncModal } from './components/DbSyncModal.js';
import { LlmModelModal } from './components/LlmModelModal.js';
import { SystemInitModal } from './components/SystemInitModal.js';
import { AppUninstallModal } from './components/AppUninstallModal.js';
import {
  ReferenceArticle,
  UnifiedLlmStatus,
  AvailableLlmModel,
  DbSyncProgress,
  ServerStatsResponse,
  ProcessLogItem,
  DbStatusResponse,
  LlmModelsResponse,
} from '../types/law.js';
import {
  DEFAULT_UI_VISIBLE_REFS,
  MIN_REFERENCE_SCORE_THRESHOLD,
  API_ENDPOINTS,
  PRESET_QUERIES,
  STORAGE_KEYS,
} from '../config/sharedConstants.js';
import {
  LAW_ARTICLE_CAPTURE_REGEX,
  IS_LAW_ARTICLE_REGEX,
} from '../types/lawRegex.js';
import { cleanMarkdownEscapes } from '../utils/formatUtils.js';
import { apiUrl } from './services/apiClient.js';


type ThemeMode = 'light' | 'dark';

const APP_VERSION = import.meta.env.APP_VERSION || '1.0.0';
const THEME_STORAGE_KEY = STORAGE_KEYS.THEME_MODE;

function getInitialThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') {
    return saved;
  }
  // 기본 선호도: OS가 다크 모드면 다크, 아니면 라이트
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function cleanProcessStep(step: string): string {
  if (!step) return '';
  return step
    .replace(/\[\s*[\d.]+\s*단계(?:-[^\]]+)?(?:\s*완료)?\s*\]\s*/g, '')
    .replace(/\[\s*완료\s*\]\s*/g, '')
    .replace(/\s*완료\s*$/g, '')
    .replace(/\s*완료\s*(?=\()/g, ' ')
    .trim();
}

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  references?: ReferenceArticle[];
  processLogs?: ProcessLogItem[];
}



function renderKeywordTagsLine(
  line: string,
  key: React.Key,
  onKeywordClick?: (keyword: string) => void,
  isGenerating?: boolean
) {
  const parts = line.split('#');
  let label = parts[0].trim().replace(/[:：\s]+$/, '');
  if (!label) {
    label = '🏷️ 관련 키워드';
  }
  const keywords = parts
    .slice(1)
    .map((k) => k.replace(/^[#\s]+|[#\s]+$/g, '').trim())
    .filter((k) => Boolean(k) && !/^(키워드\d*|실제법률용어\d*|단어\d*|keyword\d*)$/i.test(k));

  if (keywords.length === 0) {
    return null;
  }

  return (
    <div key={key} className="keyword-tags-container">
      <span className="keyword-tags-label">{label}:</span>
      <div className="keyword-tags-list">
        {keywords.map((kw, kIdx) => (
          <button
            key={kIdx}
            type="button"
            className="keyword-tag-chip"
            disabled={isGenerating}
            onClick={() => onKeywordClick?.(kw)}
            title={isGenerating ? '답변 생성 중...' : `클릭하여 "${kw}" 관련 내용 바로 질문하기`}
          >
            <span className="keyword-tag-hash">#</span>
            <span className="keyword-tag-text">{kw}</span>
            <ArrowUpRight size={12} className="keyword-tag-icon" />
          </button>
        ))}
      </div>
    </div>
  );
}

function renderInline(
  text: string,
  onLawClick?: (lawQuery: string) => void,
  isGenerating?: boolean
) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, pIdx) => {
    const isBold = part.startsWith('**') && part.endsWith('**');
    const content = isBold ? part.slice(2, -2) : part;

    const lawParts = content.split(LAW_ARTICLE_CAPTURE_REGEX);
    const rendered = lawParts.map((subPart, sIdx) => {
      if (IS_LAW_ARTICLE_REGEX.test(subPart)) {
        // onLawClick이 제공된 경우: 인터랙티브 버튼으로 렌더링
        if (onLawClick) {
          return (
            <button
              key={sIdx}
              type="button"
              className="law-inline-btn"
              disabled={isGenerating}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onLawClick(subPart);
              }}
              title={
                isGenerating
                  ? '답변 생성 중에는 질문할 수 없습니다.'
                  : `클릭하여 "${subPart}" 관련 내용 바로 질문하기`
              }
            >
              <span>{subPart}</span>
              <ArrowUpRight size={13} className="law-inline-btn-icon" />
            </button>
          );
        }

        // 드릴다운 카드 내부 등 버튼 중첩 방지를 위해 정적 하이라이트 배지 span으로 렌더링
        return (
          <span key={sIdx} className="law-inline-chip-static">
            {subPart}
          </span>
        );
      }
      return subPart;
    });

    return isBold ? (
      <strong key={pIdx} className="md-bold">
        {rendered}
      </strong>
    ) : (
      <React.Fragment key={pIdx}>{rendered}</React.Fragment>
    );
  });
}

interface MarkdownTableBlock {
  type: 'table';
  headers: string[];
  rows: string[][];
}

interface MarkdownHeadingBlock {
  type: 'heading';
  level: number;
  text: string;
}

interface MarkdownTextBlock {
  type: 'text';
  lines: string[];
}

interface MarkdownDrilldownItem {
  question: string;
  subText?: string;
}

interface MarkdownDrilldownBlock {
  type: 'drilldown';
  title: string;
  items: MarkdownDrilldownItem[];
}

type MarkdownBlock = MarkdownTableBlock | MarkdownHeadingBlock | MarkdownTextBlock | MarkdownDrilldownBlock;

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const cleaned = cleanMarkdownEscapes(text);
  const rawLines = cleaned.split('\n');
  const blocks: MarkdownBlock[] = [];

  let currentTableLines: string[] = [];
  let currentTextLines: string[] = [];
  let activeDrilldown: MarkdownDrilldownBlock | null = null;

  const flushText = () => {
    if (currentTextLines.length > 0) {
      blocks.push({ type: 'text', lines: [...currentTextLines] });
      currentTextLines = [];
    }
  };

  const flushDrilldown = () => {
    if (activeDrilldown) {
      if (activeDrilldown.items.length > 0) {
        blocks.push(activeDrilldown);
      } else {
        blocks.push({ type: 'heading', level: 3, text: activeDrilldown.title });
      }
      activeDrilldown = null;
    }
  };

  const flushTable = () => {
    if (currentTableLines.length >= 2) {
      const headerLine = currentTableLines[0];
      const headers = headerLine
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());

      const isDivider = /^[\s|:-]+$/.test(currentTableLines[1]);
      const dataStartIdx = isDivider ? 2 : 1;

      const rows: string[][] = [];
      for (let i = dataStartIdx; i < currentTableLines.length; i++) {
        const rowCols = currentTableLines[i]
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim());
        if (rowCols.length > 0) {
          rows.push(rowCols);
        }
      }

      blocks.push({ type: 'table', headers, rows });
    } else if (currentTableLines.length > 0) {
      currentTextLines.push(...currentTableLines);
    }
    currentTableLines = [];
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const isTableLine = /^\s*\|.+\|\s*$/.test(line);

    if (isTableLine) {
      flushDrilldown();
      flushText();
      currentTableLines.push(line);
      continue;
    }

    if (currentTableLines.length > 0) {
      flushTable();
    }

    const isDrilldownHeadingText = (text: string) => {
      const clean = text.replace(/[*_#`:]/g, '').trim();
      return (
        /(?:추천|후속|드릴다운|추가\s*확인|연관\s*질문|함께\s*볼\s*질문)/i.test(clean) &&
        /(?:질문|질의|드릴다운|안내)/i.test(clean)
      ) || /^(?:🔍\s*)?(?:\d+\.?\s*)?추천\s*(?:후속\s*)?질문/i.test(clean);
    };

    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flushDrilldown();
      flushText();

      const headingText = headingMatch[2].trim();
      if (isDrilldownHeadingText(headingText)) {
        activeDrilldown = {
          type: 'drilldown',
          title: headingText,
          items: [],
        };
      } else {
        blocks.push({
          type: 'heading',
          level: headingMatch[1].length,
          text: headingText,
        });
      }
      continue;
    }

    // 마크다운 헤딩(#) 없이 볼드(**...**) 또는 텍스트 라인으로 추천 후속 질문이 시작된 경우
    const isPseudoHeading = /^(?:\*\*|__)?(?:#{1,4}\s*)?(?:[🔍💡📌]\s*)?(?:\d+\.?\s*)?(?:추천\s*(?:후속\s*)?질문|후속\s*(?:질문|질의)|드릴다운)[^\n]*(?:\*\*|__)?[:：]?\s*$/i.test(line.trim());
    if (isPseudoHeading && !activeDrilldown) {
      flushDrilldown();
      flushText();
      activeDrilldown = {
        type: 'drilldown',
        title: line.replace(/[*_#`:]/g, '').trim() || '추천 후속 질문',
        items: [],
      };
      continue;
    }

    // 드릴다운 항목 수집 중인 경우
    if (activeDrilldown) {
      const itemMatch = line.match(/^\s*(?:\d+[.)]|[-*•])\s*(.+)$/);
      if (itemMatch) {
        let questionText = itemMatch[1].trim();
        // 앞뒤 따옴표 제거 (예: "질문?" -> 질문?)
        questionText = questionText.replace(/^["'“”](.*)["'“”]$/, '$1').trim();
        if (questionText) {
          activeDrilldown.items.push({ question: questionText });
          continue;
        }
      } else if (!line.trim()) {
        // 공백 라인은 건너뛰되 드릴다운 컨텍스트 유지
        continue;
      } else {
        // 번호 없는 부연 설명 줄(예: '-> 실제 현장에서는...', '※ 설명...')인 경우
        // 드릴다운을 조기 종료하지 않고 직전 아이템의 보조 설명(subText)으로 흡수
        if (activeDrilldown.items.length > 0) {
          const lastItem = activeDrilldown.items[activeDrilldown.items.length - 1];
          const cleanSub = line.trim().replace(/^[-*•→>⇒\s]+/, '').trim();
          if (cleanSub) {
            lastItem.subText = lastItem.subText ? `${lastItem.subText} ${cleanSub}` : cleanSub;
          }
          continue;
        }
      }
    }

    currentTextLines.push(line);
  }

  if (currentTableLines.length > 0) {
    flushTable();
  }
  flushDrilldown();
  flushText();

  return blocks;
}

function renderFormattedText(
  text?: string,
  onLawClick?: (lawQuery: string) => void,
  isGenerating?: boolean,
  onDrilldownClick?: (questionText: string) => void,
  onKeywordClick?: (keywordText: string) => void
) {
  if (!text || typeof text !== 'string') return null;
  const blocks = parseMarkdownBlocks(text);

  return (
    <div className="formatted-markdown-body">
      {blocks.map((block, bIdx) => {
        if (block.type === 'heading') {
          const Tag = `h${Math.min(block.level + 1, 6)}` as keyof React.JSX.IntrinsicElements;
          return (
            <Tag key={bIdx} className={`md-heading md-h${block.level}`}>
              {renderInline(block.text, onLawClick, isGenerating)}
            </Tag>
          );
        }

        if (block.type === 'table') {
          return (
            <div key={bIdx} className="md-table-wrapper">
              <table className="md-table">
                {block.headers.length > 0 && (
                  <thead>
                    <tr>
                      {block.headers.map((h, hIdx) => (
                        <th key={hIdx}>{renderInline(h, onLawClick, isGenerating)}</th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {block.rows.map((row, rIdx) => (
                    <tr key={rIdx}>
                      {row.map((cell, cIdx) => (
                        <td key={cIdx}>{renderInline(cell, onLawClick, isGenerating)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (block.type === 'drilldown') {
          const displayTitle = block.title.replace(/\s*\(드릴다운\)/g, '').trim();
          return (
            <div key={bIdx} className="drilldown-section-wrapper">
              <div className="drilldown-header-row">
                <h4 className="md-heading md-h3 drilldown-heading">
                  {renderInline(displayTitle, onLawClick, isGenerating)}
                </h4>
                <span className="drilldown-hint">💡 클릭하여 이어서 질문</span>
              </div>
              <div className="drilldown-items-list">
                {block.items.map((item, idx) => {
                  const cleanItemText = item.question.replace(/\*\*/g, '').trim();
                  return (
                    <button
                      key={idx}
                      type="button"
                      className="drilldown-chip-btn"
                      disabled={isGenerating}
                      onClick={() => onDrilldownClick?.(cleanItemText)}
                      title={`"${cleanItemText}" 바로 질문하기`}
                    >
                      <div className="drilldown-chip-num">{idx + 1}</div>
                      <div className="drilldown-chip-content">
                        {/* 드릴다운 버튼 내부에서는 중첩 button 생성을 막기 위해 onLawClick을 전달하지 않음 */}
                        <div className="drilldown-question-text">
                          {renderInline(item.question)}
                        </div>
                        {item.subText && (
                          <div className="drilldown-subtext">
                            → {renderInline(item.subText)}
                          </div>
                        )}
                      </div>
                      <ArrowUpRight size={15} className="drilldown-chip-arrow" />
                    </button>
                  );
                })}
              </div>
            </div>
          );
        }

        return (
          <div key={bIdx} className="md-paragraph">
            {block.lines.map((line, lIdx) => {
              const isKeywordLine = /(?:🏷️|📌|📎|🔗|키워드|관련\s*(?:법령|법률|법규|용어|키워드|쟁점)|태그)/i.test(line) && line.includes('#');
              if (isKeywordLine) {
                return renderKeywordTagsLine(line, lIdx, onKeywordClick, isGenerating);
              }
              return (
                <React.Fragment key={lIdx}>
                  {renderInline(line, onLawClick, isGenerating)}
                  {lIdx < block.lines.length - 1 && <br />}
                </React.Fragment>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function getSuggestedQuestion(ref: ReferenceArticle): string {
  const titlePart = ref.articleTitle ? `(${ref.articleTitle})` : '';
  return `${ref.lawName} ${ref.articleNumber}${titlePart}의 구체적인 적용 요건과 해석 기준은 어떻게 되나요?`;
}

export default function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [expandedRefs, setExpandedRefs] = useState<Record<string, boolean>>({});
  const [visibleRefsCount, setVisibleRefsCount] = useState<Record<string, number>>({});
  const [expandedArticleBodies, setExpandedArticleBodies] = useState<Record<string, boolean>>({});
  const [llmStatus, setLlmStatus] = useState<UnifiedLlmStatus>({
    enabled: false,
    isReady: false,
    isInitializing: true,
    modelName: '',
    gpu: 'none',
    engine: 'disabled',
  });
  const [availableModels, setAvailableModels] = useState<AvailableLlmModel[]>([]);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  const [isUninstallModalOpen, setIsUninstallModalOpen] = useState(false);
  const [systemStats, setSystemStats] = useState({
    totalPoints: 0,
    lawsCount: 0,
    vectorBackend: 'lancedb',
    isLoaded: false,
  });
  const [statusText, setStatusText] = useState('관련 법령 조문 검색 및 법률 근거 분석 중...');
  const [liveLogs, setLiveLogs] = useState<ProcessLogItem[]>([]);
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({});
  const [dbSyncProgress, setDbSyncProgress] = useState<DbSyncProgress>({
    status: 'checking',
    percent: 0,
    downloadedMB: '0.0',
    totalMB: '',
    message: '',
  });
  const [showDbSyncModal, setShowDbSyncModal] = useState(false);
  const [isBackendReady, setIsBackendReady] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasAutoOpenedModelModalRef = useRef<boolean>(false);

  const startDbSync = () => {
    setShowDbSyncModal(true);
    setDbSyncProgress({
      status: 'downloading',
      percent: 0,
      downloadedMB: '0.0',
      totalMB: '',
      message: '다운로드 시작 중...',
    });

    const eventSource = new EventSource(apiUrl(API_ENDPOINTS.DB_SYNC));

    eventSource.addEventListener('progress', (e) => {
      try {
        const data = JSON.parse(e.data);
        setDbSyncProgress(data);
      } catch (err) {
        console.error('Failed to parse db sync progress:', err);
      }
    });

    eventSource.addEventListener('done', (e) => {
      try {
        const data = JSON.parse(e.data);
        setDbSyncProgress(data);
        if (data.status === 'completed') {
          setTimeout(async () => {
            setShowDbSyncModal(false);
            // DB 동기화 완료 후 모델이 없으면 1회 자동으로 모델 관리자 오픈
            if (!hasAutoOpenedModelModalRef.current) {
              try {
                const res = await fetch(apiUrl(API_ENDPOINTS.LLM_MODELS));
                if (res.ok) {
                  const mData = await res.json();
                  const models = Array.isArray(mData.models) ? mData.models : [];
                  setAvailableModels(models);
                  if (models.length === 0) {
                    hasAutoOpenedModelModalRef.current = true;
                    setIsModelModalOpen(true);
                  }
                }
              } catch (err) {
                console.error('모델 상태 확인 실패:', err);
              }
            }
          }, 1200);
        }
      } catch (err) {
        console.error('Failed to parse done event:', err);
      }
      eventSource.close();
    });

    eventSource.onerror = () => {
      setDbSyncProgress((prev) => ({
        ...prev,
        status: 'error',
        message: '서버와 연결이 끊어졌거나 다운로드 중 오류가 발생했습니다.',
      }));
      eventSource.close();
    };
  };

  const hasCompletedInitialCheckRef = useRef(false);

  const checkInitialSetup = async () => {
    if (hasCompletedInitialCheckRef.current) return;
    try {
      let isDbMissing = false;
      const dbRes = await fetch(apiUrl(API_ENDPOINTS.DB_STATUS));
      if (!dbRes.ok) {
        return; // 서버 응답 대기 후 다음 틱에서 재시도
      }

      const dbData: DbStatusResponse = await dbRes.json();
      hasCompletedInitialCheckRef.current = true;
      setIsBackendReady(true);

      if (dbData.ready === false) {
        isDbMissing = true;
        startDbSync();
      }

      const modelsRes = await fetch(apiUrl(API_ENDPOINTS.LLM_MODELS));
      if (modelsRes.ok) {
        const data: LlmModelsResponse = await modelsRes.json();
        const models = Array.isArray(data.models) ? data.models : [];
        setAvailableModels(models);
        if (data.currentModel && !llmStatus.modelName) {
          setLlmStatus((prev) => ({ ...prev, modelName: data.currentModel ?? '' }));
        }

        // DB 동기화 모달이 뜨지 않은 정상 상태이고, 모델이 0개이며, 이전에 자동 오픈한 적이 없다면 자동 오픈
        if (!isDbMissing && models.length === 0 && !hasAutoOpenedModelModalRef.current) {
          hasAutoOpenedModelModalRef.current = true;
          setIsModelModalOpen(true);
        }
      }
    } catch {
      // 백엔드 프로세스 부팅 중일 때는 예외 로그 없이 다음 폴링 틱에서 재시도
    }
  };

  const fetchModels = async () => {
    try {
      const res = await fetch(apiUrl(API_ENDPOINTS.LLM_MODELS));
      if (res.ok) {
        const data: LlmModelsResponse = await res.json();
        if (Array.isArray(data.models)) {
          setAvailableModels(data.models);
        }
        if (data.currentModel && !llmStatus.modelName) {
          setLlmStatus((prev) => ({ ...prev, modelName: data.currentModel ?? '' }));
        }
      }
    } catch (err) {
      console.error('Failed to fetch available models:', err);
    }
  };

  const isBusy = isGenerating || isLoading;
  const isLlmActionDisabled = isBusy || isModelLoading;

  const handleToggleLlm = async (enabled: boolean) => {
    if (isBusy || isModelLoading) return;
    if (enabled && availableModels.length === 0) {
      setIsModelModalOpen(true);
      return;
    }
    setIsModelLoading(true);
    try {
      const res = await fetch(apiUrl(API_ENDPOINTS.LLM_TOGGLE), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status) {
          setLlmStatus(data.status);
        }
      }
      await fetchModels();
    } catch (err) {
      console.error('Failed to toggle LLM:', err);
    } finally {
      setIsModelLoading(false);
    }
  };

  const handleSelectModel = async (modelFilename: string) => {
    if (!modelFilename || isBusy || isModelLoading) return;
    setIsModelLoading(true);
    try {
      const res = await fetch(apiUrl(API_ENDPOINTS.LLM_MODEL), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelFilename }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status) {
          setLlmStatus(data.status);
        }
      }
      await fetchModels();
    } catch (err) {
      console.error('Failed to select model:', err);
    } finally {
      setIsModelLoading(false);
    }
  };

  // 테마 모드 동기화 (HTML data-theme 속성 반영)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode);
  }, [themeMode]);

  const handleThemeChange = (mode: ThemeMode) => {
    setThemeMode(mode);
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  };

  const messagesContainerRef = useRef<HTMLElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isUserInteractingRef = useRef<boolean>(false);
  const isAtBottomRef = useRef<boolean>(true);

  // 컨테이너 스크롤 위치 감지 (바닥 근처인지 판단)
  const handleContainerScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    isAtBottomRef.current = atBottom;
  };

  const handleMouseDown = () => {
    isUserInteractingRef.current = true;
  };

  const handleMouseUp = () => {
    isUserInteractingRef.current = false;
  };

  const scrollToBottom = (isStreaming = false, force = false) => {
    // 사용자가 마우스를 누르고 있거나 텍스트를 드래그 중인 경우 스크롤 중지
    if (isUserInteractingRef.current) return;
    // 스트리밍 중 사용자가 위로 스크롤해서 이전 내용을 읽고 있는 경우 강제 스크롤 중지 (force가 아닐 때)
    if (isStreaming && !isAtBottomRef.current && !force) return;

    const container = messagesContainerRef.current;
    if (!container) return;

    if (isStreaming) {
      // 답변 생성 중 텍스트가 늘어나거나 생각 단계가 추가될 때 바닥으로 실시간 스크롤 추적
      requestAnimationFrame(() => {
        if (!container || isUserInteractingRef.current) return;
        const maxScroll = container.scrollHeight - container.clientHeight;
        if (maxScroll > 0) {
          container.scrollTop = maxScroll;
        }
      });
    } else {
      // 답변 시작 및 완료 시: 최하단 부드러운 스크롤
      requestAnimationFrame(() => {
        if (!container) return;
        const maxScroll = container.scrollHeight - container.clientHeight;
        if (maxScroll > 0) {
          container.scrollTo({ top: maxScroll, behavior: 'smooth' });
        }
      });
    }
  };

  // 입력창이 나타나거나 사라질 때 컨테이너 높이 변화를 감지하여 바닥에 착 붙도록 유지
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      if (isAtBottomRef.current && !isUserInteractingRef.current) {
        const maxScroll = container.scrollHeight - container.clientHeight;
        if (maxScroll > 0) {
          container.scrollTop = maxScroll;
        }
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    // 답변 생성 중(로딩 또는 스트리밍 중) 메시지나 실시간 생각 단계(liveLogs, statusText)가 갱신될 때 실시간 자동 스크롤
    if (isGenerating || isLoading) {
      scrollToBottom(true);
    }
  }, [messages, isGenerating, isLoading, liveLogs, statusText]);

  // 답변 생성이 완료되면(입력창이 다시 올라올 때) 바닥까지 매끄럽게 스크롤 및 입력창 포커스
  useEffect(() => {
    if (!isGenerating && messages.length > 0) {
      isAtBottomRef.current = true;
      scrollToBottom(false);

      const timer = setTimeout(() => {
        scrollToBottom(false);
        textareaRef.current?.focus();
      }, 360);
      return () => clearTimeout(timer);
    }
  }, [isGenerating, messages.length]);

  // 우클릭 방지 및 마우스 드래그 전역 감지
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handleGlobalMouseUp = () => {
      isUserInteractingRef.current = false;
    };

    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, []);

  // 서버 상태 및 LLM 사전 로드 상태 확인 (2.5초 간격 폴링)
  useEffect(() => {
    checkInitialSetup();

    const fetchStatus = async () => {
      try {
        const res = await fetch(apiUrl(API_ENDPOINTS.STATS));
        if (res.ok) {
          setIsBackendReady(true);
          const data: ServerStatsResponse = await res.json();
          if (data.llm) {
            setLlmStatus(data.llm);
          }
          if (typeof data.pointsCount === 'number') {
            setSystemStats({
              totalPoints: data.pointsCount,
              lawsCount: typeof data.lawsCount === 'number' ? data.lawsCount : 0,
              vectorBackend: data.vectorBackend || 'lancedb',
              isLoaded: true,
            });
          }
        }
      } catch {
        // 서버 연결 대기
      }
    };

    fetchStatus();
    const interval = setInterval(() => {
      if (!hasCompletedInitialCheckRef.current) {
        checkInitialSetup();
      }
      fetchStatus();
      fetchModels();
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  const toggleReference = (messageId: string) => {
    setExpandedRefs((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  };

  const toggleArticleBody = (key: string) => {
    setExpandedArticleBodies((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const toggleProcessLog = (messageId: string) => {
    setExpandedLogs((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  };

  const handleCancelGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    setIsGenerating(false);
    setStatusText('답변 생성이 중단되었습니다.');
  };

  const handleSendMessage = async (queryText?: string) => {
    const textToSend = (queryText || inputValue).trim();
    if (!textToSend || isGenerating || !isBackendReady) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      sender: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsGenerating(true);
    setIsLoading(true);
    setLiveLogs([]);
    setStatusText('질문 분석 및 관련 법령 조문 검색 중...');
    isAtBottomRef.current = true;
    isUserInteractingRef.current = false;

    // 질문 전송 즉시 및 렌더링 직후 최하단으로 부드럽게 스크롤하여 질문과 생각 단계 박스가 모두 잘 보이도록 처리
    scrollToBottom(false, true);
    setTimeout(() => {
      isAtBottomRef.current = true;
      scrollToBottom(false, true);
    }, 60);
    setTimeout(() => {
      isAtBottomRef.current = true;
      scrollToBottom(false, true);
    }, 180);

    const assistantMsgId = crypto.randomUUID();
    let hasCreatedAssistantBubble = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pendingReferences: any[] = [];
    let accumulatedLogs: ProcessLogItem[] = [];

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(apiUrl(API_ENDPOINTS.CHAT), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          query: textToSend,
          stream: true,
        }),
      });


      if (!response.ok) {
        throw new Error(`서버 응답 오류 (${response.status})`);
      }

      if (!response.body) {
        throw new Error('응답 스트림을 읽을 수 없습니다.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          if (!part.trim()) continue;
          let event = 'message';
          let dataStr = '';

          for (const line of part.split('\n')) {
            if (line.startsWith('event: ')) {
              event = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              dataStr = line.slice(6);
            }
          }

          if (!dataStr) continue;

          try {
            const data = JSON.parse(dataStr);

            if (event === 'status') {
              const msg = data.message || '처리 중...';
              setStatusText(msg);

              const newLog: ProcessLogItem = {
                id: crypto.randomUUID(),
                step: msg,
                timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                status: msg.includes('완료') ? 'done' : 'loading',
              };

              // 직전 항목 완료 처리 후 새 항목 추가
              accumulatedLogs = accumulatedLogs.map((item) => ({ ...item, status: 'done' as const }));
              accumulatedLogs.push(newLog);
              setLiveLogs([...accumulatedLogs]);

              if (hasCreatedAssistantBubble) {
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantMsgId ? { ...m, processLogs: accumulatedLogs } : m))
                );
              }
            } else if (event === 'references') {
              // 답변 완료 후 계산된 핵심 근거 법조문 데이터 수신 (79% 이상만 보장)
              const rawRefs = Array.isArray(data) ? data : [];
              const refs = rawRefs.filter((r: ReferenceArticle) => r && r.score >= MIN_REFERENCE_SCORE_THRESHOLD);
              pendingReferences = refs;
              if (hasCreatedAssistantBubble) {
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantMsgId ? { ...m, references: refs } : m))
                );
              }
            } else if (event === 'token') {
              const tokenText = typeof data.token === 'string' ? data.token : '';
              if (!tokenText) continue;

              // 유효한 첫 토큰이 도착했을 때 어시스턴트 말풍선 생성 & 로딩 인디케이터 해제
              if (!hasCreatedAssistantBubble) {
                hasCreatedAssistantBubble = true;
                setIsLoading(false);
                setMessages((prev) => [
                  ...prev,
                  {
                    id: assistantMsgId,
                    sender: 'assistant',
                    text: tokenText,
                    timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
                    references: pendingReferences && pendingReferences.length > 0 ? pendingReferences : undefined,
                    processLogs: accumulatedLogs.length > 0 ? accumulatedLogs : undefined,
                  },
                ]);
              } else {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId ? { ...m, text: m.text + tokenText } : m
                  )
                );
              }
            } else if (event === 'done') {
              accumulatedLogs = accumulatedLogs.map((item) => ({ ...item, status: 'done' as const }));
              const rawDoneRefs = Array.isArray(data.references)
                ? data.references
                : pendingReferences && pendingReferences.length > 0
                  ? pendingReferences
                  : undefined;
              const finalRefs = rawDoneRefs
                ? rawDoneRefs.filter((r: ReferenceArticle) => r && r.score >= MIN_REFERENCE_SCORE_THRESHOLD)
                : undefined;

              if (data.answer) {
                if (!hasCreatedAssistantBubble) {
                  hasCreatedAssistantBubble = true;
                  setIsLoading(false);
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: assistantMsgId,
                      sender: 'assistant',
                      text: data.answer,
                      timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
                      references: finalRefs,
                      processLogs: accumulatedLogs.length > 0 ? accumulatedLogs : undefined,
                    },
                  ]);
                } else {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsgId
                        ? {
                          ...m,
                          text: !m.text.trim() ? data.answer : m.text,
                          references: finalRefs ?? m.references,
                          processLogs: accumulatedLogs.length > 0 ? accumulatedLogs : m.processLogs,
                        }
                        : m
                    )
                  );
                }
              } else if (finalRefs && hasCreatedAssistantBubble) {
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantMsgId ? { ...m, references: finalRefs, processLogs: accumulatedLogs } : m))
                );
              }
            } else if (event === 'error') {
              throw new Error(data.error || '답변 생성 실패');
            }
          } catch (pErr) {
            console.error('SSE 파싱 오류:', pErr, dataStr);
          }
        }
      }

      // 스트림이 종료되었으나 버블이 생성되지 않았거나 텍스트가 빈 상태인 경우 방어
      if (!hasCreatedAssistantBubble) {
        throw new Error('서버로부터 답변 데이터를 수신하지 못하고 연결이 종료되었습니다.');
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId && !m.text
              ? {
                ...m,
                text: '*(로컬 LLM 답변 생성이 완료되지 못했습니다. 검색된 아래 근거 법조문 카드를 확인해주세요.)*',
              }
              : m
          )
        );
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        const cancelNote = '*(사용자에 의해 답변 생성이 중단되었습니다.)*';
        if (!hasCreatedAssistantBubble) {
          setMessages((prev) => [
            ...prev,
            {
              id: assistantMsgId,
              sender: 'assistant',
              text: cancelNote,
              timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
              processLogs: accumulatedLogs.length > 0 ? accumulatedLogs.map((l) => ({ ...l, status: 'done' as const })) : undefined,
            },
          ]);
        } else {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, text: m.text ? `${m.text}\n\n${cancelNote}` : cancelNote }
                : m
            )
          );
        }
        return;
      }

      const errorMessageText = `⚠️ 백엔드 API 서버 연결 상태를 확인해주세요. (오류: ${err instanceof Error ? err.message : String(err)})\n\n💡 터미널에서 \`pnpm run search "${textToSend}"\` 명령으로 직접 Qdrant 유사 조문 검색을 실행할 수 있습니다.`;
      if (!hasCreatedAssistantBubble) {
        setMessages((prev) => [
          ...prev,
          {
            id: assistantMsgId,
            sender: 'assistant',
            text: errorMessageText,
            timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
          },
        ]);
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, text: m.text ? `${m.text}\n\n${errorMessageText}` : errorMessageText }
              : m
          )
        );
      }
    } finally {
      setIsLoading(false);
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const clearChat = () => {
    if (isBusy) return;
    setMessages([]);
  };

  return (
    <div className="app-container" id="law-rag-app">
      {/* 사이드바 */}
      <aside className="sidebar" id="app-sidebar">
        <header className="sidebar-header">
          <div className="brand-title">
            <div className="brand-icon">
              <Scale size={20} color="#fff" />
            </div>
            <div className="brand-text">
              <h1>대한민국 법령 RAG</h1>
              <span>온디바이스 AI 어시스턴트</span>
            </div>
          </div>
        </header>

        <div className="sidebar-content">
          <div>
            <h2 className="section-title">법령 데이터베이스 현황</h2>
            <div className="law-badge-list" id="law-badge-list">
              <div className="law-badge">
                <span>대한민국 현행 법령 전체</span>
                <span className="count">
                  {systemStats.isLoaded
                    ? `${systemStats.lawsCount.toLocaleString()}개 법률`
                    : '조회 중...'}
                </span>
              </div>
              <div className="law-badge">
                <span>인덱싱된 현행 조문</span>
                <span className="count">
                  {systemStats.isLoaded
                    ? `${systemStats.totalPoints.toLocaleString()}조`
                    : '조회 중...'}
                </span>
              </div>
              <div className="law-badge">
                <span>포괄 법령 체계</span>
                <span className="count">법률 · 시행령 · 규칙</span>
              </div>
            </div>
          </div>

          <div>
            <h2 className="section-title">시스템 인프라 상태</h2>
            <div className="system-status-panel">
              <div className="status-row">
                <span>벡터 데이터베이스</span>
                <span className="status-indicator">
                  <span className="dot online"></span>
                  {systemStats.vectorBackend === 'lancedb' ? 'LanceDB (내장)' : 'Qdrant (768d)'}
                </span>
              </div>
              <div className="status-row">
                <span>로컬 임베딩 모델</span>
                <span style={{ color: '#60a5fa', fontWeight: 600 }}>EmbeddingGemma-2</span>
              </div>
              <div className="status-block-llm">
                <div className="status-row">
                  <span>온디바이스 LLM</span>
                  <div className="llm-header-right">
                    <span className="status-indicator">
                      <span
                        className={`dot ${llmStatus.enabled === false
                          ? 'offline'
                          : isModelLoading || !llmStatus.isReady
                            ? 'loading'
                            : 'online'
                          }`}
                        style={{
                          backgroundColor:
                            llmStatus.enabled === false
                              ? '#64748b'
                              : isModelLoading || !llmStatus.isReady
                                ? '#f59e0b'
                                : '#10b981',
                        }}
                      />
                      <span
                        style={{
                          color:
                            llmStatus.enabled === false
                              ? '#94a3b8'
                              : isModelLoading || !llmStatus.isReady
                                ? '#fbbf24'
                                : '#34d399',
                          fontWeight: 600,
                          fontSize: '11px',
                        }}
                      >
                        {llmStatus.enabled === false
                          ? '비활성화'
                          : isModelLoading || !llmStatus.isReady
                            ? '메모리 로딩 중...'
                            : 'Metal 가속 활성'}
                      </span>
                    </span>
                    <label
                      className={`llm-toggle-switch ${isLlmActionDisabled ? 'disabled' : ''}`}
                      title={
                        isBusy
                          ? '답변 생성 중에는 온디바이스 LLM을 변경할 수 없습니다.'
                          : llmStatus.enabled
                            ? '온디바이스 LLM 끄기 (메모리 해제)'
                            : '온디바이스 LLM 켜기 (메모리 로드)'
                      }
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(llmStatus.enabled)}
                        disabled={isLlmActionDisabled}
                        onChange={(e) => handleToggleLlm(e.target.checked)}
                      />
                      <span className="llm-toggle-slider" />
                    </label>
                  </div>
                </div>

                {/* data/models 내 모델 선택 드롭다운 셀렉터 및 관리 버튼 */}
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <div
                    className={`llm-model-selector-wrapper ${llmStatus.enabled === false ? 'disabled' : ''
                      } ${isLlmActionDisabled ? 'action-disabled' : ''}`}
                    style={{ flex: 1 }}
                    title={
                      isBusy
                        ? '답변 생성 중에는 모델을 변경할 수 없습니다.'
                        : llmStatus.enabled === false
                          ? '모델을 선택하면 온디바이스 LLM이 활성화되고 메모리에 로드됩니다.'
                          : '선택 시 해당 모델을 메모리에 로드합니다.'
                    }
                  >
                    <Cpu size={13} className="llm-model-select-icon" />
                    <select
                      className="llm-model-select"
                      value={llmStatus.modelName || (availableModels[0]?.filename ?? '')}
                      disabled={isLlmActionDisabled}
                      onFocus={fetchModels}
                      onMouseDown={fetchModels}
                      onChange={(e) => handleSelectModel(e.target.value)}
                    >
                      {availableModels.length > 0 ? (
                        availableModels.map((m) => (
                          <option key={m.filename} value={m.filename}>
                            {m.title} {m.quant ? `(${m.quant})` : ''}
                          </option>
                        ))
                      ) : (
                        <option value="">
                          설치된 모델 없음 (관리 열기)
                        </option>
                      )}
                    </select>
                    {isModelLoading ? (
                      <Loader2 size={12} className="spin llm-model-select-arrow" />
                    ) : (
                      <ChevronDown size={12} className="llm-model-select-arrow" />
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsModelModalOpen(true)}
                    disabled={isBusy}
                    title="온디바이스 LLM 모델 관리 (다운로드/삭제/Hugging Face 탐색)"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '32px',
                      height: '32px',
                      borderRadius: '8px',
                      background: 'rgba(59, 130, 246, 0.12)',
                      border: '1px solid rgba(59, 130, 246, 0.28)',
                      color: '#60a5fa',
                      cursor: isBusy ? 'not-allowed' : 'pointer',
                      flexShrink: 0,
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(59, 130, 246, 0.25)';
                      e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.5)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(59, 130, 246, 0.12)';
                      e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.28)';
                    }}
                    aria-label="모델 관리"
                  >
                    <SlidersHorizontal size={15} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <footer className="sidebar-footer">
          <div style={{ display: 'flex', gap: '6px', width: '100%', alignItems: 'center' }}>
            <button
              id="clear-history-button"
              className="clear-btn"
              onClick={clearChat}
              disabled={isBusy}
              title={isBusy ? '답변 생성 중에는 대화를 비울 수 없습니다.' : '대화 내역 비우기'}
              style={{ flex: 1 }}
            >
              <RotateCcw size={13} className="clear-btn-icon" />
              <span>대화 비우기</span>
            </button>
            <button
              id="app-uninstall-button"
              className="clear-btn"
              onClick={() => setIsUninstallModalOpen(true)}
              disabled={isBusy}
              title="앱 및 저장 데이터 관리 (초기화 / 완전 삭제)"
              style={{
                width: '32px',
                padding: '0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                color: '#ef4444',
                borderColor: 'rgba(239, 68, 68, 0.28)',
                background: 'rgba(239, 68, 68, 0.08)',
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
          <div className="app-version-badge" title={`대한민국 법령 RAG v${APP_VERSION}`}>
            <span className="app-version-dot" />
            <span>v{APP_VERSION}</span>
          </div>
        </footer>
      </aside>

      {/* 메인 챗 영역 */}
      <main className="chat-main" id="chat-main-container">
        {/* 메시지 뷰 */}
        <section
          className="messages-container"
          id="messages-container"
          ref={messagesContainerRef}
          onScroll={handleContainerScroll}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
        >
          {messages.length === 0 ? (
            <div className="welcome-container" id="welcome-view">
              <div className="welcome-top-bar">
                <div className="theme-controller" role="group" aria-label="테마 설정">
                  <button
                    type="button"
                    className={`theme-tab-btn ${themeMode === 'light' ? 'active' : ''}`}
                    onClick={() => handleThemeChange('light')}
                    title="라이트 모드로 전환"
                  >
                    <Sun size={13} />
                    <span>라이트</span>
                  </button>
                  <button
                    type="button"
                    className={`theme-tab-btn ${themeMode === 'dark' ? 'active' : ''}`}
                    onClick={() => handleThemeChange('dark')}
                    title="다크 모드로 전환"
                  >
                    <Moon size={13} />
                    <span>다크</span>
                  </button>
                </div>
              </div>

              <div className="welcome-badge">
                <Database size={14} />
                <span>
                  {systemStats.totalPoints > 0
                    ? `${systemStats.totalPoints.toLocaleString()}개 대한민국 현행 조문 벡터 인덱싱 완료`
                    : '대한민국 현행 조문 벡터 인덱싱 시스템'}
                </span>
              </div>

              <h2 className="welcome-title">
                법조문에 기반한 정확하고<br />
                신뢰할 수 있는 법률 답변을 제공합니다
              </h2>

              <p className="welcome-desc">
                궁금하신 법률 내용을 질문하시면 관련 법령 조문을 정밀 분석하여 신뢰할 수 있는 법적 근거와 함께 답변해 드립니다.
              </p>

              <div className="preset-grid" id="preset-query-grid">
                {PRESET_QUERIES.map((preset, idx) => (
                  <button
                    key={idx}
                    id={`preset-btn-${idx + 1}`}
                    className="preset-card"
                    onClick={() => handleSendMessage(preset.text)}
                    disabled={isGenerating || !isBackendReady}
                  >
                    <span className="preset-tag">#{preset.tag}</span>
                    <span className="preset-text">{preset.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div key={msg.id} className={`message-row ${msg.sender}`} id={`message-${msg.id}`}>
                <div className={`message-avatar ${msg.sender}`}>
                  {msg.sender === 'user' ? '나' : <Scale size={18} />}
                </div>

                <div className="message-content">
                  <div className="message-author">
                    {msg.sender === 'user' ? '사용자 질문' : '법률 어시스턴트'} • {msg.timestamp}
                  </div>

                  <div className="message-bubble">
                    {msg.sender === 'assistant' && msg.processLogs && msg.processLogs.length > 0 && (
                      <div className="process-logs-wrapper">
                        <button
                          type="button"
                          className="process-logs-toggle"
                          onClick={() => toggleProcessLog(msg.id)}
                          title="답변 도출 과정 확인"
                        >
                          <div className="process-logs-toggle-left">
                            <Sparkles size={13} className="process-sparkle-icon" />
                            <span>법률 검토 및 답변 도출 과정 ({msg.processLogs.length}개 과정)</span>
                          </div>
                          {expandedLogs[msg.id] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        {expandedLogs[msg.id] && (
                          <div className="process-logs-content">
                            {msg.processLogs.map((log, lIdx) => (
                              <div key={log.id || lIdx} className="process-log-step-row">
                                <span className="process-log-icon">✓</span>
                                <span className="process-log-text">{cleanProcessStep(log.step)}</span>
                                <span className="process-log-time">{log.timestamp}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {msg.text.trim() ? (
                      <>
                        {renderFormattedText(
                          msg.text,
                          (lawQuery) => {
                            if (!isGenerating) {
                              handleSendMessage(`${lawQuery} 관련 규정과 상세 내용을 알려줘`);
                            }
                          },
                          isGenerating,
                          (drilldownQuestion) => {
                            if (!isGenerating) {
                              handleSendMessage(drilldownQuestion);
                            }
                          },
                          (keywordText) => {
                            if (!isGenerating) {
                              handleSendMessage(`${keywordText} 관련 법적 기준과 세부 요건을 알려줘`);
                            }
                          }
                        )}
                        {isGenerating && idx === messages.length - 1 && msg.sender === 'assistant' && (
                          <span className="stream-cursor" />
                        )}
                      </>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        법률 답변을 정리하는 중입니다...
                      </span>
                    )}
                  </div>

                  {/* 인용된 법조문 카드 (답변 생성이 시작된 후 노출, 79% 이상만 노출) */}
                  {msg.text && msg.references && msg.references.length > 0 && (() => {
                    const validReferences = msg.references.filter((ref) => ref.score >= MIN_REFERENCE_SCORE_THRESHOLD);
                    if (validReferences.length === 0) return null;

                    return (
                      <div className="references-box">
                        <div
                          className="references-header"
                          onClick={() => toggleReference(msg.id)}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <BookOpen size={14} />
                            근거 법조문 {validReferences.length}건 참조됨
                          </span>
                          {expandedRefs[msg.id] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </div>

                        {expandedRefs[msg.id] && (() => {
                          const currentLimit = visibleRefsCount[msg.id] ?? DEFAULT_UI_VISIBLE_REFS;
                          const displayedRefs = validReferences.slice(0, currentLimit);
                          const hasMore = currentLimit < validReferences.length;
                          const nextBatchSize = Math.min(DEFAULT_UI_VISIBLE_REFS, validReferences.length - currentLimit);

                          return (
                            <div className="references-content">
                              {displayedRefs.map((ref, rIdx) => {
                                const itemKey = `${msg.id}-${rIdx}`;
                                const suggestedQuery = getSuggestedQuestion(ref);
                                const isBodyExpanded = !!expandedArticleBodies[itemKey];

                                return (
                                  <div key={rIdx} className="ref-item">
                                    <div className="ref-item-header">
                                      <div className="ref-title-group">
                                        <span className="ref-law-title" title={`${ref.lawName} ${ref.articleNumber} ${ref.articleTitle || ''}`}>
                                          📜 {ref.lawName} {ref.articleNumber}{' '}
                                          {ref.articleTitle ? `(${ref.articleTitle})` : ''}
                                        </span>
                                        {ref.chapterPath && (
                                          <span className="ref-chapter-path" title={ref.chapterPath}>
                                            {ref.chapterPath}
                                          </span>
                                        )}
                                      </div>
                                      <div className="ref-header-actions">
                                        <span className="ref-score">
                                          {(ref.score * 100).toFixed(1)}%
                                        </span>
                                        <button
                                          type="button"
                                          className="ref-body-toggle-btn"
                                          onClick={() => toggleArticleBody(itemKey)}
                                          title={isBodyExpanded ? '법조문 전문 접기' : '법조문 전문 보기'}
                                        >
                                          {isBodyExpanded ? (
                                            <>
                                              <ChevronUp size={12} />
                                              <span>접기</span>
                                            </>
                                          ) : (
                                            <>
                                              <ChevronDown size={12} />
                                              <span>전문 보기</span>
                                            </>
                                          )}
                                        </button>
                                      </div>
                                    </div>

                                    {/* 답변 내용 기반 매칭 근거 뱃지 */}
                                    {ref.matchReasons && ref.matchReasons.length > 0 && (
                                      <div className="ref-match-reasons">
                                        {ref.matchReasons.map((reason, mIdx) => (
                                          <span key={mIdx} className="ref-match-badge">
                                            🎯 {reason}
                                          </span>
                                        ))}
                                      </div>
                                    )}

                                    {/* 법조문 전문 본문 */}
                                    {isBodyExpanded && (
                                      <div className="ref-item-body">
                                        {renderFormattedText(
                                          ref.content,
                                          (lawQuery) => {
                                            if (!isGenerating) {
                                              handleSendMessage(`${lawQuery} 관련 규정과 상세 내용을 알려줘`);
                                            }
                                          },
                                          isGenerating
                                        )}
                                      </div>
                                    )}

                                    {/* 추천 질문 원클릭 전송 카드 */}
                                    <div
                                      className={`ref-suggested-query ${isGenerating ? 'disabled' : ''}`}
                                      onClick={() => {
                                        if (!isGenerating) {
                                          handleSendMessage(suggestedQuery);
                                        }
                                      }}
                                      role="button"
                                      tabIndex={0}
                                      title="클릭 시 이 조문으로 즉시 질문합니다"
                                    >
                                      <div className="ref-query-icon-wrap">
                                        <MessageSquarePlus size={13} />
                                      </div>
                                      <div className="ref-query-text-wrap">
                                        <span className="ref-query-label">추천 질의:</span>
                                        <span className="ref-query-text">"{suggestedQuery}"</span>
                                      </div>
                                      <ArrowUpRight size={13} className="ref-query-arrow" />
                                    </div>
                                  </div>
                                );
                              })}

                              {validReferences.length > DEFAULT_UI_VISIBLE_REFS && (
                                <div className="ref-more-container">
                                  {hasMore && (
                                    <button
                                      type="button"
                                      className="ref-more-btn"
                                      onClick={() =>
                                        setVisibleRefsCount((prev) => ({
                                          ...prev,
                                          [msg.id]: currentLimit + DEFAULT_UI_VISIBLE_REFS,
                                        }))
                                      }
                                    >
                                      <ChevronDown size={14} />
                                      <span>근거 법조문 {nextBatchSize}건 더보기 ({currentLimit}/{validReferences.length}건)</span>
                                    </button>
                                  )}
                                  {currentLimit > DEFAULT_UI_VISIBLE_REFS && (
                                    <button
                                      type="button"
                                      className="ref-more-btn ref-collapse-btn"
                                      onClick={() =>
                                        setVisibleRefsCount((prev) => ({
                                          ...prev,
                                          [msg.id]: DEFAULT_UI_VISIBLE_REFS,
                                        }))
                                      }
                                    >
                                      <ChevronUp size={14} />
                                      <span>기본 {DEFAULT_UI_VISIBLE_REFS}건만 접어보기</span>
                                    </button>
                                  )}
                                </div>
                              )}

                            </div>
                          );
                        })()}
                      </div>
                    );
                  })()}

                  {msg.sender === 'assistant' && msg.text && (
                    <div className="disclaimer-banner">
                      <ShieldAlert size={14} />
                      <span>
                        본 답변은 법제처 공개 데이터를 참고한 참고용 정보이며, 법적 분쟁 시 공인 법률 전문가의 자문을 받으시기 바랍니다.
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {isLoading && (
            <div className="message-row assistant">
              <div className="message-avatar assistant">
                <Scale size={18} />
              </div>
              <div className="message-content">
                <div className="message-author">법률 어시스턴트 • {cleanProcessStep(statusText)}</div>
                <div className="message-bubble live-process-bubble">
                  <div className="live-process-header">
                    <div className="live-process-header-left">
                      <Loader2 size={15} className="live-process-spinner" />
                      <span className="live-process-status-text">{cleanProcessStep(statusText)}</span>
                    </div>
                    <button
                      type="button"
                      className="live-header-cancel-btn"
                      onClick={handleCancelGeneration}
                      title="답변 생성 중단"
                    >
                      <Square size={10} className="cancel-square-icon" />
                      <span>중단</span>
                    </button>
                  </div>

                  {liveLogs.length > 0 && (
                    <div className="live-process-timeline">
                      {liveLogs.map((log, lIdx) => (
                        <div key={log.id || lIdx} className={`live-process-step ${log.status}`}>
                          <span className="live-step-indicator">
                            {log.status === 'done' ? (
                              <CheckCircle2 size={13} className="text-emerald" />
                            ) : (
                              <span className="live-step-pulse" />
                            )}
                          </span>
                          <span className="live-step-label">{cleanProcessStep(log.step)}</span>
                          <span className="live-step-time">{log.timestamp}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} className="messages-bottom-spacer" />
        </section>

        {/* 하단 입력바 (답변 생성 시 부드럽게 아래로 슬라이드되어 숨김) */}
        <footer className={`input-area-container ${isGenerating ? 'is-generating-hidden' : ''}`}>
          <div className="input-box-wrapper">
            <textarea
              ref={textareaRef}
              id="chat-input"
              className="chat-input"
              placeholder="법률 관련 질문을 입력하세요 (예: 주 52시간제 규정, 퇴직금 지급 요건, 절도죄 처벌 등)..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isGenerating}
              rows={1}
            />

            <div className="input-actions-bar">
              <span className="input-hint">Enter로 전송, Shift + Enter로 줄바꿈</span>
              {isGenerating ? (
                <button
                  id="stop-button"
                  className="send-button stop-mode"
                  onClick={handleCancelGeneration}
                  title="생성 중단"
                >
                  <Square size={14} className="stop-square-icon" />
                </button>
              ) : (
                <button
                  id="send-button"
                  className="send-button"
                  onClick={() => handleSendMessage()}
                  disabled={!inputValue.trim() || !isBackendReady}
                  title="질문 전송"
                >
                  <Send size={16} />
                </button>
              )}
            </div>
          </div>
        </footer>
      </main>

      <SystemInitModal isOpen={!isBackendReady} />

      {showDbSyncModal && (
        <DbSyncModal progress={dbSyncProgress} onRetry={startDbSync} />
      )}

      <LlmModelModal
        isOpen={isModelModalOpen}
        onClose={() => setIsModelModalOpen(false)}
        availableModels={availableModels}
        currentModelName={llmStatus.modelName}
        onSelectModel={async (filename) => {
          await handleSelectModel(filename);
          setIsModelModalOpen(false);
        }}
        onRefreshModels={fetchModels}
      />

      <AppUninstallModal
        isOpen={isUninstallModalOpen}
        onClose={() => setIsUninstallModalOpen(false)}
      />
    </div>
  );
}
