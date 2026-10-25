/**
 * 브라우저 및 서버 공용 텍스트/데이터 포맷팅 유틸리티 (Single Source of Truth)
 *
 * Node.js 내장 모듈에 의존하지 않으므로 Vite 번들 및 브라우저 환경에서도 안전하게 임포트할 수 있습니다.
 */

/**
 * 파일 크기(Bytes)를 사람이 읽기 좋은 표준 단위(B, KB, MB, GB, TB)로 포맷팅합니다 (SSOT).
 *
 * @param bytes 정수 바이트 크기
 * @returns 포맷팅된 문자열 (예: "2.4 GB", "960 MB")
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0 || !Number.isFinite(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const idx = Math.min(i, units.length - 1);
  const val = bytes / Math.pow(1024, idx);
  return `${val.toFixed(val >= 100 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

/**
 * 모델 파일명 또는 식별자로부터 UI 및 로그에 표시할 깔끔한 표시명을 파싱합니다 (SSOT).
 *
 * @param rawModelName 원본 모델 경로 또는 식별자 (예: 'EXAONE-4.0-1.2B-Q4_K_M.gguf')
 * @returns 사용자 친화적 모델 표시명
 */
export function formatModelDisplayName(rawModelName?: string): { title: string; quant: string } {
  if (!rawModelName || !rawModelName.trim()) {
    return { title: '온디바이스 LLM', quant: '' };
  }

  const clean = rawModelName.trim().replace(/\.gguf$/i, '');
  const quantMatch = clean.match(/[-_]([QqIi][0-9][A-Za-z0-9_]*)$/);
  const quant = quantMatch ? quantMatch[1].toUpperCase() : '';
  const baseName = quantMatch ? clean.slice(0, quantMatch.index) : clean;

  const title = baseName
    .replace(/^onnx-community\//i, '')
    .replace(/-ONNX$/i, '')
    .replace(/-GGUF$/i, '')
    .replace(/[-_]it$/i, '')
    .replace(/[-_]Instruct$/i, '');

  return { title, quant };
}

/**
 * 마크다운 이스케이프 문자(예: 1\. -> 1., \( -> ()를 사람이 읽기 좋은 일반 문장 형식으로 정제합니다 (SSOT).
 */
export function cleanMarkdownEscapes(text?: string): string {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/(\d+)\\\./g, '$1.')
    .replace(/\\([()[\]\-*+~])/g, '$1');
}
