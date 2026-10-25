import React, { useState, useEffect } from 'react';
import {
  Trash2,
  AlertTriangle,
  RotateCcw,
  HardDrive,
  Database,
  Cpu,
  FileText,
  X,
  Loader2,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';
import { apiUrl } from '../services/apiClient.js';
import { API_ENDPOINTS } from '../../config/sharedConstants.js';
import type { StorageBreakdown } from '../../types/law.js';

interface AppUninstallModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ActionType = 'idle' | 'confirm_reset' | 'confirm_uninstall' | 'processing' | 'done';

export const AppUninstallModal: React.FC<AppUninstallModalProps> = ({ isOpen, onClose }) => {
  const [storage, setStorage] = useState<StorageBreakdown | null>(null);
  const [loadingStorage, setLoadingStorage] = useState(false);
  const [actionType, setActionType] = useState<ActionType>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // 스토리지 사용량 조회
  const fetchStorageUsage = async () => {
    setLoadingStorage(true);
    setErrorMessage('');
    try {
      const res = await fetch(apiUrl(API_ENDPOINTS.SYSTEM_STORAGE));
      if (!res.ok) throw new Error('저장 공간 정보를 불러오지 못했습니다.');
      const data: StorageBreakdown = await res.json();
      setStorage(data);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : '저장 공간 조회 실패');
    } finally {
      setLoadingStorage(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setActionType('idle');
      setStatusMessage('');
      setErrorMessage('');
      fetchStorageUsage();
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  // 데이터 전체 초기화 실행
  const handleExecuteReset = async () => {
    setActionType('processing');
    setStatusMessage('모든 데이터(온디바이스 모델, 벡터 DB, 캐시, 로그)를 안전하게 정리하는 중입니다...');
    setErrorMessage('');

    try {
      const res = await fetch(apiUrl(API_ENDPOINTS.SYSTEM_RESET_DATA), {
        method: 'POST',
      });
      if (!res.ok) throw new Error('데이터 초기화 중 오류가 발생했습니다.');

      setActionType('done');
      setStatusMessage('데이터가 모두 초기화되었습니다. 깨끗한 상태로 재시작하기 위해 잠시 후 새로고침합니다.');
      setTimeout(() => {
        window.location.reload();
      }, 2500);
    } catch (err: unknown) {
      setActionType('idle');
      setErrorMessage(err instanceof Error ? err.message : '초기화 실패');
    }
  };

  // 앱 완전 삭제(Uninstall) 실행
  const handleExecuteUninstall = async () => {
    setActionType('processing');
    setStatusMessage('저장 공간 정리 및 애플리케이션 완전 삭제(Uninstall)를 진행 중입니다...');
    setErrorMessage('');

    try {
      const res = await fetch(apiUrl(API_ENDPOINTS.SYSTEM_UNINSTALL), {
        method: 'POST',
      });
      if (!res.ok) throw new Error('앱 삭제 절차를 시작하지 못했습니다.');

      const data = await res.json();
      setActionType('done');
      setStatusMessage(
        data.message ||
          '앱과 데이터 삭제 절차가 완료되었습니다. 1~2초 후 애플리케이션이 완전히 종료됩니다.'
      );
    } catch (err: unknown) {
      setActionType('idle');
      setErrorMessage(err instanceof Error ? err.message : '삭제 실패');
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.78)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && actionType !== 'processing') {
          onClose();
        }
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '560px',
          background: 'var(--surface-color, #1e1e24)',
          borderRadius: '20px',
          border: '1px solid var(--border-color, rgba(255, 255, 255, 0.12))',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.6), 0 0 30px rgba(239, 68, 68, 0.15)',
          padding: '28px 28px 24px',
          color: 'var(--text-primary, #ffffff)',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}
      >
        {/* 상단 닫기 버튼 */}
        {actionType !== 'processing' && actionType !== 'done' && (
          <button
            type="button"
            onClick={onClose}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary, #94a3b8)',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="닫기"
          >
            <X size={18} />
          </button>
        )}

        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ef4444',
              flexShrink: 0,
            }}
          >
            <Trash2 size={22} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
              앱 및 저장 데이터 관리
            </h3>
            <p
              style={{
                margin: '3px 0 0',
                fontSize: '13px',
                color: 'var(--text-secondary, #94a3b8)',
              }}
            >
              사용자 디렉터리 내 AI 모델, 벡터 DB 및 앱 완전 삭제를 관리합니다.
            </p>
          </div>
        </div>

        {/* 에러 메시지 알림 */}
        {errorMessage && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '10px',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#fca5a5',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <AlertTriangle size={16} />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* 진행 중 / 완료 상태 뷰 */}
        {actionType === 'processing' && (
          <div
            style={{
              padding: '36px 16px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '14px',
            }}
          >
            <Loader2 size={36} className="spin" color="#ef4444" />
            <div style={{ fontSize: '15px', fontWeight: 600 }}>{statusMessage}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary, #94a3b8)' }}>
              프로세스와 데이터 파일을 안전하게 정리하고 있습니다. 잠시만 기다려주세요.
            </div>
          </div>
        )}

        {actionType === 'done' && (
          <div
            style={{
              padding: '36px 16px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '14px',
            }}
          >
            <CheckCircle2 size={40} color="#10b981" />
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#34d399' }}>정리 완료</div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary, #94a3b8)', lineHeight: 1.5 }}>
              {statusMessage}
            </div>
          </div>
        )}

        {/* 기본 보기: 저장 공간 점유 현황 및 2가지 선택 옵션 */}
        {actionType === 'idle' && (
          <>
            {/* 디스크 점유 현황 카드 */}
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                borderRadius: '14px',
                border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                  paddingBottom: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600 }}>
                  <HardDrive size={16} color="#60a5fa" />
                  <span>현재 앱 점유 디스크 공간</span>
                </div>
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#60a5fa' }}>
                  {loadingStorage ? '계산 중...' : storage ? storage.formattedTotal : '-'}
                </div>
              </div>

              {storage && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '10px',
                    fontSize: '12px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'rgba(0, 0, 0, 0.2)',
                      padding: '8px 10px',
                      borderRadius: '8px',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8' }}>
                      <Cpu size={13} color="#a78bfa" /> 온디바이스 모델
                    </span>
                    <span style={{ fontWeight: 600 }}>{storage.formattedModels}</span>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'rgba(0, 0, 0, 0.2)',
                      padding: '8px 10px',
                      borderRadius: '8px',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8' }}>
                      <Database size={13} color="#34d399" /> 법령 벡터 DB
                    </span>
                    <span style={{ fontWeight: 600 }}>{storage.formattedDatabase}</span>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'rgba(0, 0, 0, 0.2)',
                      padding: '8px 10px',
                      borderRadius: '8px',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8' }}>
                      <HardDrive size={13} color="#38bdf8" /> 백엔드 엔진
                    </span>
                    <span style={{ fontWeight: 600 }}>{storage.formattedEngine}</span>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'rgba(0, 0, 0, 0.2)',
                      padding: '8px 10px',
                      borderRadius: '8px',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8' }}>
                      <FileText size={13} color="#fbbf24" /> 캐시 및 로그
                    </span>
                    <span style={{ fontWeight: 600 }}>{storage.formattedLogs}</span>
                  </div>
                </div>
              )}

              {storage?.appDataRoot && (
                <div
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-secondary, #64748b)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={storage.appDataRoot}
                >
                  저장 경로: {storage.appDataRoot}
                </div>
              )}
            </div>

            {/* 작업 모드 선택 카드 2가지 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* 옵션 1: 데이터 전체 초기화 */}
              <div
                style={{
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '14px',
                  padding: '16px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '14px',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 600 }}>
                    <RotateCcw size={16} color="#60a5fa" />
                    <span>데이터 전체 초기화 (Reset Data)</span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary, #94a3b8)', lineHeight: 1.4 }}>
                    앱 프로그램은 그대로 두고, 모델·벡터 DB·캐시 데이터만 삭제하여 처음 상태로 되돌립니다.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActionType('confirm_reset')}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '10px',
                    background: 'rgba(59, 130, 246, 0.15)',
                    border: '1px solid rgba(59, 130, 246, 0.35)',
                    color: '#60a5fa',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(59, 130, 246, 0.25)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(59, 130, 246, 0.15)';
                  }}
                >
                  초기화 선택
                </button>
              </div>

              {/* 옵션 2: 앱 및 데이터 완전 삭제 (Uninstall) */}
              <div
                style={{
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: '14px',
                  padding: '16px',
                  background: 'rgba(239, 68, 68, 0.04)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '14px',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '14px',
                      fontWeight: 600,
                      color: '#f87171',
                    }}
                  >
                    <ShieldAlert size={16} color="#ef4444" />
                    <span>앱 및 데이터 완전 삭제 (Uninstall)</span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary, #94a3b8)', lineHeight: 1.4 }}>
                    저장된 데이터뿐만 아니라, <strong>설치된 앱 프로그램 자체를 휴지통으로 이동/제거</strong>하고 완전히 종료합니다.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActionType('confirm_uninstall')}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '10px',
                    background: 'rgba(239, 68, 68, 0.18)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    color: '#f87171',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.3)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.18)';
                  }}
                >
                  완전 삭제 선택
                </button>
              </div>
            </div>
          </>
        )}

        {/* 확인 단계: 데이터 초기화 확인 */}
        {actionType === 'confirm_reset' && (
          <div
            style={{
              padding: '12px 4px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '14px',
                borderRadius: '12px',
                background: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid rgba(59, 130, 246, 0.25)',
              }}
            >
              <AlertTriangle size={24} color="#60a5fa" style={{ flexShrink: 0 }} />
              <div style={{ fontSize: '13px', lineHeight: 1.5 }}>
                다운로드된 <strong>AI 모델 파일</strong>과 <strong>법령 벡터 데이터베이스</strong>, 대화 내역이 모두 삭제됩니다.
                이 작업은 취소할 수 없습니다. 계속 진행하시겠습니까?
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setActionType('idle')}
                style={{
                  padding: '9px 18px',
                  borderRadius: '10px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: 'var(--text-primary, #ffffff)',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleExecuteReset}
                style={{
                  padding: '9px 20px',
                  borderRadius: '10px',
                  background: '#2563eb',
                  border: 'none',
                  color: '#ffffff',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                네, 데이터 초기화 실행
              </button>
            </div>
          </div>
        )}

        {/* 확인 단계: 앱 및 데이터 완전 삭제(Uninstall) 확인 */}
        {actionType === 'confirm_uninstall' && (
          <div
            style={{
              padding: '12px 4px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '14px',
                borderRadius: '12px',
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
              }}
            >
              <ShieldAlert size={28} color="#ef4444" style={{ flexShrink: 0 }} />
              <div style={{ fontSize: '13px', lineHeight: 1.5 }}>
                <strong>모든 사용자 데이터가 삭제</strong>되고, 설치된 <strong>애플리케이션 프로그램이 휴지통으로 이동(또는 언인스톨러 실행)</strong>된 후 앱이 완전히 종료됩니다.
                정말로 삭제하시겠습니까?
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setActionType('idle')}
                style={{
                  padding: '9px 18px',
                  borderRadius: '10px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: 'var(--text-primary, #ffffff)',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleExecuteUninstall}
                style={{
                  padding: '9px 20px',
                  borderRadius: '10px',
                  background: '#dc2626',
                  border: 'none',
                  color: '#ffffff',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                네, 앱 및 데이터 완전 삭제
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
