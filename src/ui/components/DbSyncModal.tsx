import React from 'react';
import { Database, Download, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import type { DbSyncProgress } from '../../types/law.js';
import { TOTAL_INDEXED_ARTICLES_ESTIMATE } from '../../config/sharedConstants.js';

interface DbSyncModalProps {
  progress: DbSyncProgress;
  onRetry: () => void;
}

export const DbSyncModal: React.FC<DbSyncModalProps> = ({ progress, onRetry }) => {
  const isError = progress.status === 'error';
  const isCompleted = progress.status === 'completed';

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '520px',
          background: 'var(--surface-color, #1e1e24)',
          borderRadius: '16px',
          border: '1px solid var(--border-color, rgba(255, 255, 255, 0.12))',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 24px rgba(99, 102, 241, 0.15)',
          padding: '32px',
          color: 'var(--text-primary, #ffffff)',
          textAlign: 'center',
        }}
      >
        {/* 아이콘 헤더 */}
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: isError
              ? 'rgba(239, 68, 68, 0.15)'
              : isCompleted
                ? 'rgba(34, 197, 94, 0.15)'
                : 'rgba(99, 102, 241, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            border: `1px solid ${isError
                ? 'rgba(239, 68, 68, 0.3)'
                : isCompleted
                  ? 'rgba(34, 197, 94, 0.3)'
                  : 'rgba(99, 102, 241, 0.3)'
              }`,
          }}
        >
          {isError ? (
            <AlertCircle size={32} color="#ef4444" />
          ) : isCompleted ? (
            <CheckCircle2 size={32} color="#22c55e" />
          ) : progress.status === 'downloading' ? (
            <Download size={32} color="#6366f1" className="animate-bounce" />
          ) : (
            <Database size={32} color="#6366f1" />
          )}
        </div>

        {/* 타이틀 및 설명 */}
        <h2 style={{ fontSize: '1.4rem', fontWeight: 700, margin: '0 0 8px' }}>
          {isCompleted
            ? '법률 데이터베이스 준비 완료'
            : isError
              ? '데이터베이스 동기화 실패'
              : '법률 데이터베이스 최초 동기화'}
        </h2>
        <p style={{ fontSize: '0.92rem', color: 'var(--text-secondary, #a1a1aa)', margin: '0 0 24px', lineHeight: 1.5 }}>
          {isCompleted
            ? `${TOTAL_INDEXED_ARTICLES_ESTIMATE.toLocaleString()}건의 현행 법령 조문 벡터 데이터가 성공적으로 준비되었습니다.`
            : isError
              ? '네트워크 또는 파일 다운로드 중 문제가 발생했습니다.'
              : '로컬에서 초고속 검색을 지원하기 위해 20만 조문 벡터 데이터베이스를 1회 자동 구성합니다.'}
        </p>

        {/* 프로그레스 바 영역 */}
        {!isError && (
          <div style={{ marginBottom: '20px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.82rem',
                color: 'var(--text-secondary, #a1a1aa)',
                marginBottom: '8px',
              }}
            >
              <span>{progress.message}</span>
              <span style={{ fontWeight: 600, color: 'var(--text-primary, #ffffff)' }}>
                {progress.status === 'downloading'
                  ? `${progress.percent}% (${progress.downloadedMB}MB / ${progress.totalMB}MB)`
                  : `${progress.percent}%`}
              </span>
            </div>

            <div
              style={{
                width: '100%',
                height: '8px',
                background: 'rgba(255, 255, 255, 0.08)',
                borderRadius: '999px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${progress.percent}%`,
                  background: isCompleted
                    ? 'linear-gradient(90deg, #22c55e, #10b981)'
                    : 'linear-gradient(90deg, #6366f1, #a855f7)',
                  borderRadius: '999px',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
        )}

        {/* 에러 상태 시 재시도 버튼 */}
        {isError && (
          <div style={{ marginTop: '20px' }}>
            <button
              onClick={onRetry}
              style={{
                padding: '10px 24px',
                borderRadius: '8px',
                background: '#6366f1',
                color: '#ffffff',
                border: 'none',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <Loader2 size={16} />
              다시 시도
            </button>
          </div>
        )}

        <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary, #71717a)', marginTop: '20px' }}>
          💡 최초 1회만 약 630MB 다운로드가 진행되며, 이후에는 오프라인 상태에서도 즉시 실행됩니다.
        </div>
      </div>
    </div>
  );
};
