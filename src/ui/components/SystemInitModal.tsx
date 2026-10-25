import React, { useState, useEffect } from 'react';
import { Loader2, Database, Cpu, AlertCircle } from 'lucide-react';
import appIcon from '../assets/app-icon.png';
import { APP_CONFIG } from '../../config/sharedConstants.js';

interface SystemInitModalProps {
  isOpen: boolean;
}

export const SystemInitModal: React.FC<SystemInitModalProps> = ({ isOpen }) => {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setSeconds(0);
      return;
    }
    const timer = setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  // 경과 시간에 따른 정밀 단계 및 진행률(%) 계산 (초기 기동 점근 곡선)
  const calculateProgress = (sec: number): { percent: number; statusText: string; isDelayed: boolean } => {
    if (sec <= 2) {
      return { percent: 15, statusText: '로컬 서비스 포트 연결 감지 중...', isDelayed: false };
    }
    if (sec <= 6) {
      const p = 15 + Math.round((sec - 2) * 8); // 15% -> 47%
      return { percent: p, statusText: '로컬 서비스 포트 연결 확인 중...', isDelayed: false };
    }
    if (sec <= 18) {
      const p = 47 + Math.round((sec - 6) * 2.2); // 47% -> 73%
      return { percent: p, statusText: '초경량 인스톨러: 백엔드 엔진 아카이브 압축 해제 중...', isDelayed: false };
    }
    if (sec <= 45) {
      const p = 73 + Math.round((sec - 18) * 0.5); // 73% -> 86%
      return { percent: p, statusText: '백엔드 엔진 런타임 검증 및 포트 바인딩 중...', isDelayed: false };
    }
    if (sec <= 60) {
      const extra = Math.min(12, Math.round((sec - 45) * 0.8));
      return {
        percent: Math.min(98, 86 + extra),
        statusText: '백엔드 엔진 온라인 패키지 다운로드 대기 중...',
        isDelayed: false,
      };
    }
    return {
      percent: 98,
      statusText: '백엔드 엔진 응답 지연 (엔진 파일 확인 필요)',
      isDelayed: true,
    };
  };

  const { percent, statusText, isDelayed } = calculateProgress(seconds);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.78)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        zIndex: 9998,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '500px',
          background: 'var(--surface-color, #1e1e24)',
          borderRadius: '20px',
          border: '1px solid var(--border-color, rgba(255, 255, 255, 0.12))',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.6), 0 0 30px rgba(99, 102, 241, 0.2)',
          padding: '36px 32px',
          color: 'var(--text-primary, #ffffff)',
          textAlign: 'center',
        }}
      >
        {/* 상단 앱 공식 아이콘 엠블럼 */}
        <div
          style={{
            position: 'relative',
            width: '80px',
            height: '80px',
            margin: '0 auto 24px',
          }}
        >
          <img
            src={appIcon}
            alt={APP_CONFIG.title}
            style={{
              width: '100%',
              height: '100%',
              borderRadius: '22px',
              objectFit: 'cover',
              boxShadow: '0 12px 28px rgba(0, 0, 0, 0.4), 0 0 20px rgba(99, 102, 241, 0.25)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: '-4px',
              right: '-4px',
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              background: '#4f46e5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '2.5px solid #1e1e24',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)',
            }}
          >
            <Loader2 size={15} color="#ffffff" className="animate-spin" />
          </div>
        </div>

        {/* 타이틀 및 설명 */}
        <h2 style={{ fontSize: '1.45rem', fontWeight: 700, margin: '0 0 10px', letterSpacing: '-0.02em' }}>
          시스템 엔진 초기화 중
        </h2>
        <p
          style={{
            fontSize: '0.92rem',
            color: 'var(--text-secondary, #a1a1aa)',
            margin: '0 0 28px',
            lineHeight: 1.6,
          }}
        >
          로컬 백엔드 서비스 및 RAG 검색 엔진 환경을 준비하고 있습니다.
          <br />
          준비가 완료되면 법률 데이터베이스 확인으로 자동 연결됩니다.
        </p>

        {/* 3단계 진행 플로우 인디케이터 */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            background: 'rgba(0, 0, 0, 0.25)',
            borderRadius: '14px',
            padding: '18px 16px',
            marginBottom: '24px',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.88rem' }}>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '8px',
                background: 'rgba(99, 102, 241, 0.2)',
                color: '#818cf8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Loader2 size={16} className="animate-spin" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: '#e0e7ff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>1단계: 백엔드 엔진 구동 및 API 연결</span>
                <span style={{ fontSize: '0.84rem', color: '#a5b4fc', fontWeight: 700 }}>
                  {percent}%
                </span>
              </div>
              <div
                style={{
                  fontSize: '0.76rem',
                  color: '#818cf8',
                  marginTop: '3px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {statusText}
              </div>
            </div>
            <span style={{ fontSize: '0.78rem', color: '#818cf8', fontWeight: 600, flexShrink: 0, marginLeft: '4px' }}>
              ({seconds}초)
            </span>
          </div>

          {/* 1단계 진행률 인디케이터 게이지 바 (퍼센티지 연동) */}
          <div
            style={{
              width: '100%',
              height: '6px',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              borderRadius: '3px',
              overflow: 'hidden',
              margin: '2px 0 4px',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${percent}%`,
                background: 'linear-gradient(90deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)',
                borderRadius: '3px',
                transition: 'width 0.4s ease-out',
                boxShadow: '0 0 10px rgba(99, 102, 241, 0.5)',
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.88rem', opacity: 0.55 }}>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#a1a1aa',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Database size={15} />
            </div>
            <div style={{ flex: 1 }}>2단계: 20만 조문 벡터 데이터베이스 동기화</div>
            <span style={{ fontSize: '0.78rem', color: '#71717a' }}>대기</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.88rem', opacity: 0.55 }}>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#a1a1aa',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Cpu size={15} />
            </div>
            <div style={{ flex: 1 }}>3단계: 온디바이스 추천 AI 모델 선택</div>
            <span style={{ fontSize: '0.78rem', color: '#71717a' }}>대기</span>
          </div>
        </div>

        {/* 60초 이상 지연 시 진단 경고 박스 */}
        {isDelayed && (
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              borderRadius: '12px',
              padding: '14px 16px',
              marginBottom: '20px',
              textAlign: 'left',
              display: 'flex',
              gap: '12px',
              alignItems: 'flex-start',
            }}
          >
            <AlertCircle size={20} color="#f87171" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ fontSize: '0.82rem', color: '#fca5a5', lineHeight: 1.5 }}>
              <div style={{ fontWeight: 700, color: '#fecaca', marginBottom: '4px' }}>
                백엔드 엔진 응답이 지연되고 있습니다
              </div>
              온라인 엔진 패키지 다운로드에 실패했거나 백엔드 런타임이 시작되지 않았습니다. 인터넷 연결 및 최신 릴리즈 상태를 확인해주세요.
            </div>
          </div>
        )}

        {/* 팁 안내 */}
        <div style={{ fontSize: '0.8rem', color: '#71717a' }}>
          💡 최초 실행 시에만 엔진 초기화 및 조문 DB 다운로드가 1회 진행됩니다.
        </div>
      </div>
    </div>
  );
};
