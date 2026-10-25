/**
 * 백엔드 REST/SSE API 엔드포인트 URL 빌더 (SSOT)
 *
 * Tauri 데스크톱 웹뷰 환경(tauri:// 또는 http://tauri.localhost)에서는
 * 내부 웹뷰가 아닌 로컬 백엔드 서버(http://127.0.0.1:포트)를 직접 호출하도록 주소를 변환합니다.
 */

import { DEFAULT_PROD_SERVER_PORT, DEFAULT_DEV_SERVER_PORT } from '../../config/sharedConstants.js';

const DEFAULT_PROD_PORT = Number((import.meta.env as Record<string, string>)?.PROD_PORT) || DEFAULT_PROD_SERVER_PORT;
const DEFAULT_DEV_PORT = Number((import.meta.env as Record<string, string>)?.DEV_PORT) || DEFAULT_DEV_SERVER_PORT;

function isTauriEnvironment(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  // Tauri v2 전역 객체 또는 프로토콜 판별
  if ('__TAURI_INTERNALS__' in window || '__TAURI__' in window) {
    return true;
  }

  const { protocol, hostname } = window.location;
  if (protocol === 'tauri:' || hostname === 'tauri.localhost') {
    return true;
  }

  return false;
}

/**
 * 백엔드 베이스 URL 반환
 */
function getBackendBaseUrl(): string {
  const custom = import.meta.env.VITE_BACKEND_URL;
  if (custom && typeof custom === 'string' && custom.trim()) {
    return custom.trim().replace(/\/+$/, '');
  }

  if (isTauriEnvironment()) {
    const port = import.meta.env.DEV ? DEFAULT_DEV_PORT : DEFAULT_PROD_PORT;
    return `http://127.0.0.1:${port}`;
  }

  // 일반 브라우저 개발/배포 환경에서는 상대 경로 유지 (Vite proxy 등)
  return '';
}

/**
 * 상대 API 경로를 적절한 절대 URL(Tauri 환경) 또는 상대 URL(웹 환경)로 정규화
 *
 * @example
 * apiUrl('/api/stats') // Tauri: "http://127.0.0.1:34100/api/stats", Web: "/api/stats"
 */
export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const baseUrl = getBackendBaseUrl();

  if (!baseUrl) {
    return normalizedPath;
  }

  return `${baseUrl}${normalizedPath}`;
}
