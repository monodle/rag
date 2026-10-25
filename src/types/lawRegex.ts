/**
 * 대한민국 법령명 정규표현식 패턴 (Single Source of Truth)
 * 
 * - '...등에 관한 법률', '...에 관한 법률', '...에 관한 특례법'
 * - '개인정보 보호법' 등 띄어쓰기가 포함된 주요 개별 법률
 * - '○○법률', '○○법', '○○시행령', '○○시행규칙', '○○규정', '○○조례'
 */
const LAW_NAME_PATTERN =
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
const ARTICLE_NUMBER_REGEX = /제\s*(\d+(?:조의\d+|조))/g;

/**
 * 한 줄 전체가 단독 조문 번호 및 괄호 제목 형태인지 판별하는 정규표현식 (예: "제10조", "제10조의2(구류)")
 */
export const ARTICLE_HEADER_LINE_REGEX = /^제\s*\d+(?:조의\d+|조)?(?:\([^\)]*\))?$/;

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
 * 마크다운 문서 파서용 조문 헤더 매칭 정규표현식 (Single Source of Truth)
 * 예: "##### 제10조 (근로조건의 명시)", "##### 제10조의2"
 */
export const ARTICLE_HEADER_MARKDOWN_REGEX = /^#####\s+(제\d+조(?:의\d+)?)(?:\s*\(([^)]+)\))?/;

/**
 * 사용자 질의 내 사법/형사/민사/제도 핵심 어휘 감지 정규표현식 (가드레일 단일 진실 공급원)
 */
export const OBVIOUS_LEGAL_KEYWORD_REGEX =
  /(법|법령|규정|조례|처벌|죄|불법|위법|형사|민사|재판|소송|기소|고소|고발|벌금|과태료|형벌|징역|손해배상|합의금|근로기준|퇴직금|임금|주휴|해고|계약|임대|임차|전세|월세|부동산|사기|절도|횡령|점유|배임|폭행|상해|음주운전|교통사고|명예훼손|모욕)/i;

/**
 * 한국어 조사 및 일반 불용어 세트 (Single Source of Truth)
 */
export const KOREAN_STOPWORDS: ReadonlySet<string> = new Set([
  '이', '그', '저', '것', '수', '등', '및', '또는', '관련', '대한', '대해', '경우',
  '따라', '의거', '규정', '따른', '의한', '위한', '통해', '하여', '하고', '하며',
  '있습니다', '합니다', '됩니다', '입니다', '할', '있는', '없는', '있으며',
  '경우에는', '관하여', '법률', '법령', '기준', '사항', '내용', '따르면', '대하여',
  '인가요', '무엇인가요', '어떻게', '때문에', '에서는', '으로', '에게', '에서',
  '하면', '시키면', '없이', '타인'
]);

/**
 * 단어 단위 불용어 판별 정규표현식 (Single Source of Truth)
 */
export const KOREAN_STOPWORDS_REGEX =
  /^(입니다|합니다|있습니다|없습니다|인가요|무엇인가요|어떻게|경우에는|대하여|통해|위하여|때문에|에서는|으로|에게|에서|하고|하면|시키면|없이|타인)$/i;



