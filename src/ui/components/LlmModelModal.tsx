import React, { useState, useEffect, useRef } from 'react';
import { apiUrl } from '../services/apiClient.js';
import { API_ENDPOINTS } from '../../config/sharedConstants.js';
import {
  X,
  Cpu,
  Download,
  Trash2,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  HardDrive,
  Filter,
  Sparkles,
  RefreshCw,
  Loader2,
  Search,
} from 'lucide-react';
import type {
  AvailableLlmModel,
  HfGgufItem as HfFileItem,
  ModelDownloadProgress as DownloadProgress,
  PresetModel,
  PresetModelWithStatus,
} from '../../types/law.js';
import { formatBytes } from '../../utils/formatUtils.js';

type PresetModelItem = PresetModelWithStatus;

interface LlmModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableModels: AvailableLlmModel[];
  currentModelName: string;
  onSelectModel: (filename: string) => Promise<void>;
  onRefreshModels: () => Promise<void>;
}

type ModalTab = 'presets' | 'installed' | 'huggingface';

export const LlmModelModal: React.FC<LlmModelModalProps> = ({
  isOpen,
  onClose,
  availableModels,
  currentModelName,
  onSelectModel,
  onRefreshModels,
}) => {
  const [activeTab, setActiveTab] = useState<ModalTab>('presets');
  const [presets, setPresets] = useState<PresetModelItem[]>([]);
  const [isLoadingPresets, setIsLoadingPresets] = useState(false);

  // HF 저장소 탐색 상태
  const [customRepo, setCustomRepo] = useState('');
  const [isSearchingHf, setIsSearchingHf] = useState(false);
  const [hfFiles, setHfFiles] = useState<HfFileItem[]>([]);
  const [hfSearchError, setHfSearchError] = useState('');

  // 다운로드 진행 상태
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>({
    status: 'idle',
    repo: '',
    filename: '',
    percent: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    downloadedMB: '0.0',
    totalMB: '0.0',
    speedMBs: '0.0',
    message: '',
  });

  // 삭제 진행 상태
  const [deletingFilename, setDeletingFilename] = useState<string | null>(null);

  // SSE 연결 ref
  const eventSourceRef = useRef<EventSource | null>(null);

  // 프리셋 목록 불러오기
  const fetchPresets = async () => {
    setIsLoadingPresets(true);
    try {
      const res = await fetch(apiUrl(API_ENDPOINTS.LLM_PRESETS));
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.presets)) {
          setPresets(data.presets);
        }
      }
    } catch (err) {
      console.error('프리셋 조회 실패:', err);
    } finally {
      setIsLoadingPresets(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchPresets();
      // 만약 설치된 모델이 없으면 자동으로 프리셋 탭 오픈
      if (availableModels.length === 0) {
        setActiveTab('presets');
      }
    }
  }, [isOpen, availableModels.length]);

  // 다운로드 SSE 스트림 구독
  const startDownloadSse = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const sse = new EventSource(apiUrl(API_ENDPOINTS.LLM_DOWNLOAD_STREAM));
    eventSourceRef.current = sse;

    sse.addEventListener('progress', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as DownloadProgress;
        setDownloadProgress(data);
      } catch {
        // 무시
      }
    });

    sse.addEventListener('done', async (e: MessageEvent) => {
      let completedFilename = '';
      try {
        const data = JSON.parse(e.data) as DownloadProgress;
        setDownloadProgress(data);
        if (data.status === 'completed' && data.filename) {
          completedFilename = data.filename;
        }
      } catch {
        // 무시
      }
      sse.close();
      eventSourceRef.current = null;
      await onRefreshModels();
      if (completedFilename) {
        console.log(`🎉 모델 다운로드 완료 -> 자동 선택 및 활성화: ${completedFilename}`);
        await onSelectModel(completedFilename);
      }
      await fetchPresets();
    });

    sse.onerror = () => {
      sse.close();
      eventSourceRef.current = null;
    };
  };

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // 모델 다운로드 실행
  const handleStartDownload = async (repo: string, filePath: string) => {
    if (downloadProgress.status === 'downloading') {
      alert('이미 다른 모델 다운로드가 진행 중입니다.');
      return;
    }

    startDownloadSse();

    try {
      const res = await fetch(apiUrl(API_ENDPOINTS.LLM_DOWNLOAD), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo, filePath }),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || '다운로드 요청에 실패했습니다.');
      }
    } catch (err) {
      console.error('다운로드 요청 에러:', err);
      alert('다운로드 서버 통신 오류');
    }
  };

  // 다운로드 취소
  const handleCancelDownload = async () => {
    try {
      await fetch(apiUrl(API_ENDPOINTS.LLM_DOWNLOAD_CANCEL), { method: 'POST' });
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setDownloadProgress((prev) => ({ ...prev, status: 'idle', message: '다운로드가 취소되었습니다.' }));
    } catch (err) {
      console.error('다운로드 취소 에러:', err);
    }
  };

  // 커스텀 HF 저장소 검색
  const handleSearchHfRepo = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = customRepo.trim();
    if (!trimmed) return;

    setIsSearchingHf(true);
    setHfSearchError('');
    setHfFiles([]);

    try {
      const res = await fetch(apiUrl(`${API_ENDPOINTS.LLM_HF_FILES}?repo=${encodeURIComponent(trimmed)}`));
      const data = await res.json();

      if (!res.ok) {
        setHfSearchError(data.error || '저장소를 찾을 수 없거나 GGUF 모델이 없습니다.');
      } else {
        setHfFiles(data.files || []);
        if (!data.files || data.files.length === 0) {
          setHfSearchError('해당 저장소에서 .gguf 가중치 파일을 찾지 못했습니다.');
        }
      }
    } catch (err: any) {
      setHfSearchError(err?.message || 'Hugging Face 조회 중 오류가 발생했습니다.');
    } finally {
      setIsSearchingHf(false);
    }
  };

  // 외부 브라우저에서 URL 열기 (Tauri 데스크톱 및 웹 호환)
  const handleOpenExternalUrl = async (url: string) => {
    try {
      await fetch(apiUrl(API_ENDPOINTS.SYSTEM_OPEN_URL), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
    } catch {
      window.open(url, '_blank');
    }
  };

  // 모델 삭제 실행
  const handleDeleteModel = async (filename: string) => {
    setDeletingFilename(filename);
    try {
      const res = await fetch(apiUrl(API_ENDPOINTS.LLM_MODEL), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || '모델 삭제에 실패했습니다.');
      } else {
        await onRefreshModels();
        await fetchPresets();
      }
    } catch (err) {
      console.error('모델 삭제 오류:', err);
      alert('모델 삭제 중 통신 오류가 발생했습니다.');
    } finally {
      setDeletingFilename(null);
    }
  };

  // 총 점유 용량 계산
  const totalDiskBytes = availableModels.reduce((acc, m) => acc + (m.sizeBytes || 0), 0);
  const totalDiskFormatted = formatBytes(totalDiskBytes);

  if (!isOpen) return null;

  return (
    <div
      className="llm-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && downloadProgress.status !== 'downloading') {
          onClose();
        }
      }}
    >
      <div className="llm-modal-container">
        {/* 모달 헤더 */}
        <div className="llm-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div className="llm-modal-header-icon">
              <Cpu size={22} />
            </div>
            <div>
              <h2 className="llm-modal-header-title">
                온디바이스 LLM 모델 관리자
              </h2>
              <p className="llm-modal-header-desc">
                로컬 하드웨어 가속(Metal / CUDA / Vulkan / CPU) 모델 다운로드 및 디스크 관리
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              if (downloadProgress.status !== 'downloading') {
                onClose();
              }
            }}
            disabled={downloadProgress.status === 'downloading'}
            className="llm-modal-close-btn"
            style={{
              opacity: downloadProgress.status === 'downloading' ? 0.25 : 1,
              cursor: downloadProgress.status === 'downloading' ? 'not-allowed' : 'pointer',
            }}
            aria-label="닫기"
            title={downloadProgress.status === 'downloading' ? '다운로드 진행 중에는 닫을 수 없습니다' : '닫기'}
          >
            <X size={20} />
          </button>
        </div>

        {/* 탭 네비게이션: 1. 추천 모델 목록, 2. 설치된 모델, 3. Hugging Face 탐색 가이드 */}
        <div className="llm-modal-tabs">
          <button
            onClick={() => downloadProgress.status !== 'downloading' && setActiveTab('presets')}
            disabled={downloadProgress.status === 'downloading'}
            className={`llm-modal-tab-btn ${activeTab === 'presets' ? 'active' : ''}`}
            style={{
              opacity: downloadProgress.status === 'downloading' ? 0.35 : 1,
              cursor: downloadProgress.status === 'downloading' ? 'not-allowed' : 'pointer',
            }}
          >
            <Sparkles size={16} />
            추천 모델 목록
          </button>
          <button
            onClick={() => downloadProgress.status !== 'downloading' && setActiveTab('installed')}
            disabled={downloadProgress.status === 'downloading'}
            className={`llm-modal-tab-btn ${activeTab === 'installed' ? 'active' : ''}`}
            style={{
              opacity: downloadProgress.status === 'downloading' ? 0.35 : 1,
              cursor: downloadProgress.status === 'downloading' ? 'not-allowed' : 'pointer',
            }}
          >
            <HardDrive size={16} />
            설치된 모델
            <span className={`llm-modal-tab-badge ${activeTab === 'installed' ? 'active' : ''}`}>
              {availableModels.length}
            </span>
          </button>
          <button
            onClick={() => downloadProgress.status !== 'downloading' && setActiveTab('huggingface')}
            disabled={downloadProgress.status === 'downloading'}
            className={`llm-modal-tab-btn ${activeTab === 'huggingface' ? 'active' : ''}`}
            style={{
              opacity: downloadProgress.status === 'downloading' ? 0.35 : 1,
              cursor: downloadProgress.status === 'downloading' ? 'not-allowed' : 'pointer',
            }}
          >
            <Search size={16} />
            Hugging Face 탐색 가이드
          </button>
        </div>

        {/* 다운로드 중 전체 화면 집중 & 조작 방지 풀 블로킹 오버레이 */}
        {downloadProgress.status === 'downloading' && (
          <div className="llm-download-blocking-overlay">
            <div className="llm-download-card">
              <div className="llm-download-card-header">
                <div className="llm-download-icon-box">
                  <Loader2 size={24} className="spin animate-spin" />
                </div>
                <div>
                  <h3 className="llm-download-card-title">모델 가중치 다운로드 중</h3>
                  <div className="llm-download-card-file">{downloadProgress.filename}</div>
                </div>
              </div>

              <div className="llm-download-gauge-wrap">
                <div className="llm-download-gauge-row">
                  <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                    다운로드 진행률
                  </span>
                  <span className="llm-download-percent">{downloadProgress.percent}%</span>
                </div>
                <div className="llm-download-progress-track">
                  <div
                    className="llm-download-progress-fill"
                    style={{ width: `${downloadProgress.percent}%` }}
                  />
                </div>
              </div>

              <div className="llm-download-metrics">
                <div className="llm-download-metric-box">
                  <span className="llm-download-metric-label">다운로드 용량</span>
                  <span className="llm-download-metric-value">
                    {downloadProgress.downloadedMB} / {downloadProgress.totalMB} MB
                  </span>
                </div>
                <div className="llm-download-metric-box">
                  <span className="llm-download-metric-label">실시간 전송 속도</span>
                  <span className="llm-download-metric-value" style={{ color: 'var(--accent-primary)' }}>
                    ⚡ {downloadProgress.speedMBs} MB/s
                  </span>
                </div>
              </div>

              <div className="llm-download-notice">
                ⚠️ 다운로드 중에는 모델 파일 무결성 보호를 위해 다른 작업이 제한됩니다.<br />
                다운로드를 중단하려면 아래 취소 버튼을 눌러주세요.
              </div>

              <button
                type="button"
                onClick={handleCancelDownload}
                className="llm-download-cancel-btn"
              >
                <X size={16} />
                다운로드 취소
              </button>
            </div>
          </div>
        )}

        {/* 탭 본문 영역 */}
        <div className="llm-modal-body">
          {/* 탭 1: 추천 모델 목록 */}
          {activeTab === 'presets' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {availableModels.length === 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px 16px',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(59, 130, 246, 0.08)',
                    border: '1px solid rgba(59, 130, 246, 0.25)',
                    marginBottom: '4px',
                  }}
                >
                  <Sparkles size={20} style={{ color: 'var(--accent-primary, #3b82f6)', flexShrink: 0 }} />
                  <div style={{ fontSize: '0.86rem', lineHeight: 1.45, color: 'var(--text-main)' }}>
                    <div style={{ fontWeight: 600, marginBottom: '2px' }}>
                      설치된 온디바이스 LLM 모델이 없습니다.
                    </div>
                    <div style={{ color: 'var(--text-muted)' }}>
                      아래 공식 추천 모델 중 원하시는 모델을 다운로드하시면 기기 내부에서 안전하게 로컬 AI 답변 생성을 바로 이용하실 수 있습니다.
                    </div>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                  한국어 법률 질의에 최적화된 공식 검증 추천 모델입니다.
                </span>
                <button
                  onClick={fetchPresets}
                  disabled={isLoadingPresets}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-dim)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontSize: '0.82rem',
                    fontWeight: 500,
                  }}
                >
                  <RefreshCw size={13} className={isLoadingPresets ? 'spin animate-spin' : ''} />
                  새로고침
                </button>
              </div>

              {presets.map((preset) => (
                <div
                  key={preset.repo}
                  className="llm-modal-card"
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <h4 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 600, color: 'var(--text-main)' }}>
                        {preset.name}
                      </h4>
                      <span className="llm-size-pill">
                        {preset.sizeLabel}
                      </span>
                    </div>
                    <p style={{ margin: '0 0 8px', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
                      {preset.description}
                    </p>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {preset.tags.map((tag) => (
                        <span key={tag} className="llm-tag-chip">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div style={{ flexShrink: 0 }}>
                    {preset.isInstalled ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="llm-badge-installed">
                          <CheckCircle2 size={14} />
                          설치됨
                        </span>
                        {preset.installedFilename && preset.installedFilename !== currentModelName && (
                          <button
                            onClick={() => onSelectModel(preset.installedFilename!)}
                            className="llm-btn-secondary"
                          >
                            전환
                          </button>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => handleStartDownload(preset.repo, preset.defaultFile)}
                        disabled={downloadProgress.status === 'downloading'}
                        className="llm-btn-primary"
                      >
                        <Download size={14} />
                        다운로드
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 탭 2: 설치된 모델 관리 (디스크 정리 & 삭제) */}
          {activeTab === 'installed' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div
                style={{
                  padding: '14px 20px',
                  background: 'var(--bg-card)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.88rem' }}>
                  <HardDrive size={18} color="var(--accent-primary)" />
                  <span style={{ color: 'var(--text-muted)' }}>설치된 모델 디스크 총 사용량:</span>
                  <strong style={{ color: 'var(--text-main)', fontSize: '0.95rem' }}>{totalDiskFormatted}</strong>
                </div>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-dim)', fontWeight: 500 }}>
                  총 {availableModels.length}개 모델
                </span>
              </div>

              {availableModels.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-dim)' }}>
                  <AlertCircle size={36} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
                  <p style={{ margin: '0 0 16px', fontSize: '0.95rem', color: 'var(--text-muted)' }}>
                    설치된 온디바이스 GGUF 모델이 없습니다.
                  </p>
                  <button
                    onClick={() => setActiveTab('presets')}
                    className="llm-btn-primary"
                  >
                    <Sparkles size={14} />
                    추천 모델 둘러보기
                  </button>
                </div>
              ) : (
                availableModels.map((model) => {
                  const isCurrent = model.filename === currentModelName || model.isCurrent;
                  const isDeleting = deletingFilename === model.filename;
                  const sizeFormatted = formatBytes(model.sizeBytes);

                  return (
                    <div
                      key={model.filename}
                      className={`llm-modal-card ${isCurrent ? 'is-current' : ''}`}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)' }}>
                            {model.title || model.name}
                          </span>
                          {model.quant && (
                            <span className="llm-tag-chip">
                              {model.quant}
                            </span>
                          )}
                          {isCurrent && (
                            <span className="llm-badge-installed">
                              <CheckCircle2 size={13} />
                              현재 사용 중
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', wordBreak: 'break-all' }}>
                          파일명: <code style={{ color: 'var(--text-muted)' }}>{model.filename}</code> • 용량: <strong style={{ color: 'var(--text-main)' }}>{sizeFormatted}</strong>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        {!isCurrent && (
                          <button
                            onClick={() => onSelectModel(model.filename)}
                            className="llm-btn-secondary"
                          >
                            선택
                          </button>
                        )}

                        <button
                          onClick={() => {
                            const confirmed = window.confirm(
                              `[${model.title || model.name}] 모델을 디스크에서 영구 삭제하시겠습니까?\n\n• 파일명: ${model.filename}\n• 디스크 용량: ${sizeFormatted}`
                            );
                            if (confirmed) {
                              handleDeleteModel(model.filename);
                            }
                          }}
                          disabled={isDeleting}
                          className="llm-btn-danger"
                          title="디스크에서 영구 삭제"
                        >
                          {isDeleting ? <Loader2 size={15} className="spin animate-spin" /> : <Trash2 size={15} />}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* 탭 3: Hugging Face 탐색 가이드 & 커스텀 다운로드 */}
          {activeTab === 'huggingface' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              {/* 허깅페이스 바로가기 배너 */}
              <div className="llm-hf-banner">
                <div>
                  <h4 style={{ margin: '0 0 4px', fontSize: '0.98rem', fontWeight: 600, color: 'var(--accent-amber)' }}>
                    🤗 Hugging Face에서 호환 모델 직접 탐색하기
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
                    본 앱 전용 필터(GGUF / Text-Generation)가 자동 적용된 링크에서 전 세계 최신 모델을 확인하세요.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    handleOpenExternalUrl(
                      'https://huggingface.co/models?pipeline_tag=text-generation&library=gguf&sort=trending'
                    )
                  }
                  className="llm-btn-primary"
                  style={{
                    background: 'var(--accent-amber)',
                    color: '#ffffff',
                    textDecoration: 'none',
                    fontWeight: 700,
                    cursor: 'pointer',
                    border: 'none',
                  }}
                >
                  HF 검색 열기
                  <ExternalLink size={14} />
                </button>
              </div>

              {/* 필터 가이드 그리드 */}
              <div
                style={{
                  padding: '16px 20px',
                  background: 'var(--bg-card)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                  <Filter size={16} color="var(--accent-primary)" />
                  <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)' }}>
                    필수 필터 및 최적 권장 사양 가이드
                  </span>
                </div>
                <div className="llm-info-grid">
                  <div className="llm-info-box">
                    <div style={{ fontWeight: 600, color: 'var(--accent-primary)', marginBottom: '4px' }}>1. 포맷 (필수)</div>
                    <div style={{ color: 'var(--text-muted)', lineHeight: 1.4, fontSize: '0.82rem' }}>
                      <code>GGUF</code> (.gguf) 파일만 로컬 가속 엔진(Metal/CUDA/Vulkan/CPU)에서 직접 로드 가능합니다. (safetensors 등은 변환 필요)
                    </div>
                  </div>
                  <div className="llm-info-box">
                    <div style={{ fontWeight: 600, color: 'var(--accent-primary)', marginBottom: '4px' }}>2. 사양별 권장 파라미터 크기</div>
                    <div style={{ color: 'var(--text-muted)', lineHeight: 1.4, fontSize: '0.82rem' }}>
                      • <strong>순수 CPU / 내장 GPU</strong>: <code>0.5B ~ 1.5B</code><br />
                      • <strong>외장 GPU (VRAM 8GB+ / Mac 16GB+)</strong>: <code>7B ~ 8B</code> 고성능 모델 추천
                    </div>
                  </div>
                  <div className="llm-info-box">
                    <div style={{ fontWeight: 600, color: 'var(--accent-primary)', marginBottom: '4px' }}>3. 추천 양자화 (Quant)</div>
                    <div style={{ color: 'var(--text-muted)', lineHeight: 1.4, fontSize: '0.82rem' }}>
                      • <strong>속도/용량 최적</strong>: <code>Q4_K_M</code><br />
                      • <strong>고정밀도 (여유 VRAM 보유 시)</strong>: <code>Q5_K_M</code>, <code>Q8_0</code>
                    </div>
                  </div>
                  <div className="llm-info-box">
                    <div style={{ fontWeight: 600, color: 'var(--accent-primary)', marginBottom: '4px' }}>4. 한국어 사전학습 여부</div>
                    <div style={{ color: 'var(--text-muted)', lineHeight: 1.4, fontSize: '0.82rem' }}>
                      <code>Korean</code> 태그 또는 한국어 전문 사전학습(LG EXAONE, 네이버, 코난 등) 모델이 법률 문맥에서 가장 정확합니다.
                    </div>
                  </div>
                </div>
              </div>

              {/* 저장소명 직접 입력 다운로드 */}
              <div
                style={{
                  padding: '18px 20px',
                  background: 'var(--bg-card)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <h4 style={{ margin: '0 0 6px', fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-main)' }}>
                  커스텀 Hugging Face 저장소에서 다운로드
                </h4>
                <p style={{ margin: '0 0 14px', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                  저장소 ID(예: <code>LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF</code> 또는 <code>Qwen/Qwen2.5-1.5B-Instruct-GGUF</code>)를 입력하면 포함된 GGUF 파일들을 조회합니다.
                </p>

                <form onSubmit={handleSearchHfRepo} style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                  <input
                    type="text"
                    value={customRepo}
                    onChange={(e) => setCustomRepo(e.target.value)}
                    placeholder="업체명/저장소명 입력 (예: LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF)"
                    className="llm-input"
                  />
                  <button
                    type="submit"
                    disabled={isSearchingHf || !customRepo.trim()}
                    className="llm-btn-primary"
                  >
                    {isSearchingHf ? <Loader2 size={15} className="spin animate-spin" /> : <Search size={15} />}
                    파일 조회
                  </button>
                </form>

                {hfSearchError && (
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'rgba(239, 68, 68, 0.08)',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                      color: 'var(--accent-rose)',
                      fontSize: '0.82rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <AlertCircle size={15} />
                    {hfSearchError}
                  </div>
                )}

                {hfFiles.length > 0 && (
                  <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', fontWeight: 600 }}>
                      발견된 GGUF 가중치 파일 ({hfFiles.length}개):
                    </div>
                    {hfFiles.map((file) => {
                      const isAlreadyInstalled = availableModels.some((m) => m.filename.toLowerCase() === file.path.toLowerCase());
                      return (
                        <div
                          key={file.path}
                          className="llm-modal-card"
                          style={{ padding: '12px 16px' }}
                        >
                          <div style={{ overflow: 'hidden', minWidth: 0 }}>
                            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                              {file.path}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '2px' }}>
                              크기: {file.sizeFormatted}
                            </div>
                          </div>
                          <div style={{ flexShrink: 0 }}>
                            {isAlreadyInstalled ? (
                              <span className="llm-badge-installed">
                                <CheckCircle2 size={13} />
                                설치됨
                              </span>
                            ) : (
                              <button
                                onClick={() => handleStartDownload(customRepo.trim(), file.path)}
                                disabled={downloadProgress.status === 'downloading'}
                                className="llm-btn-primary"
                                style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                              >
                                <Download size={13} />
                                다운로드
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

