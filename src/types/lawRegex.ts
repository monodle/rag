/**
 * 대한민국 법령명 정규표현식 패턴 (Single Source of Truth)
 * 
 * - '...등에 관한 법률', '...에 관한 법률', '...에 관한 특례법'
 * - '개인정보 보호법' 등 띄어쓰기가 포함된 주요 개별 법률
 * - '○○법률', '○○법', '○○시행령', '○○시행규칙', '○○규정', '○○조례'
 */
export const LAW_NAME_PATTERN =
  '(?:(?:[가-힣0-9·]+(?:\\s+[가-힣0-9·]+){1,5}\\s*(?:등에\\s*관한\\s*법률|에\\s*관한\\s*법률|에\\s*관한\\s*특례법))|(?:개인정보\\s*보호법)|(?:[가-힣]{2,20}(?:법률|법|시행령|시행규칙|규정|조례)))';

/**
 * 텍스트 내에서 '법령명 + 조문 번호(항/호/목 포함)'를 캡처하는 전역 정규표현식
 */
export const LAW_ARTICLE_CAPTURE_REGEX = new RegExp(
  `(${LAW_NAME_PATTERN}\\s+제\\d+조(?:의\\d+)?(?:\\s*제\\d+항)?(?:\\s*제\\d+호)?(?:\\s*[가-힣]목)?(?:\\([^)\\n]+\\)?)?)`,
  'g'
);

/**
 * 전체 문자열이 단일 '법령명 + 조문 번호'인지 판별하는 엄격 정규표현식
 */
export const IS_LAW_ARTICLE_REGEX = new RegExp(
  `^${LAW_NAME_PATTERN}\\s+제\\d+조(?:의\\d+)?(?:\\s*제\\d+항)?(?:\\s*제\\d+호)?(?:\\s*[가-힣]목)?(?:\\([^)\\n]+\\)?)?$`
);

/**
 * 텍스트에서 단독 조문 번호(예: "제10조", "제10조의2")를 매칭하는 정규표현식
 */
export const ARTICLE_NUMBER_REGEX = /제\s*(\d+(?:조의\d+|조))/g;

/**
 * 한 줄 전체가 단독 조문 번호 및 괄호 제목 형태인지 판별하는 정규표현식 (예: "제10조", "제10조의2(구류)")
 */
export const ARTICLE_HEADER_LINE_REGEX = /^제\s*\d+(?:조의\d+|조)?(?:\([^\)]*\))?$/;

/**
 * 조문 번호 문자열에서 공백을 제거하여 표준 규격(예: "제 50 조" -> "제50조")으로 정규화합니다.
 */
export function normalizeArticleNumber(raw: string): string {
  if (!raw) return '';
  return raw.replace(/\s+/g, '');
}

/**
 * 텍스트에서 언급되거나 인용된 조문 번호 목록(중복 제거)을 추출합니다 (SSOT).
 * 
 * @param text 본문 또는 답변 텍스트
 * @returns 정규화된 조문 번호 세트 (예: Set(['제50조', '제6조의3']))
 */
export function extractArticleNumbers(text: string): Set<string> {
  const matches = new Set<string>();
  if (!text) return matches;

  const regex = new RegExp(ARTICLE_NUMBER_REGEX.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match[1]) {
      const normalized = `제${match[1].replace(/\s+/g, '')}`;
      matches.add(normalized);
    }
  }

  return matches;
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
