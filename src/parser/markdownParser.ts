import matter from 'gray-matter';
import { LawFrontmatter, LawArticleChunk, ParsedLawDocument } from '../types/law.js';
import { cleanMarkdownEscapes } from '../utils/formatUtils.js';
import { ARTICLE_HEADER_MARKDOWN_REGEX } from '../types/lawRegex.js';

export class MarkdownLawParser {
  private static readonly ARTICLE_HEADER_REGEX = ARTICLE_HEADER_MARKDOWN_REGEX;
  private static readonly CHAPTER_HEADER_REGEX = /^##\s+(제\d+[편장관](?:\s+[^\n]+)?)/;
  private static readonly SECTION_HEADER_REGEX = /^###\s+(제\d+절(?:\s+[^\n]+)?)/;
  private static readonly ADDENDUM_HEADER_REGEX = /^##\s+(부칙.*)/;

  /**
   * 마크다운 텍스트를 파싱하여 메타데이터와 조문 청크 목록을 반환합니다.
   */
  public parse(markdownContent: string, filePath: string): ParsedLawDocument {
    const { data, content } = matter(markdownContent);
    const metadata = data as LawFrontmatter;

    const lawName = metadata.제목 || '미상 법령';
    const lawType = metadata.법령구분 || '법률';
    const effectiveDate = String(metadata.시행일자 || '');
    const status = String(metadata.상태 || '시행');
    const sourceUrl = metadata.출처 || '';

    const lines = content.split('\n');
    const chunks: LawArticleChunk[] = [];

    let currentChapter = '';
    let currentSection = '';
    let currentArticleNumber = '';
    let currentArticleTitle = '';
    let currentArticleLines: string[] = [];

    const flushCurrentArticle = () => {
      if (!currentArticleNumber || currentArticleLines.length === 0) {
        return;
      }

      const bodyText = cleanMarkdownEscapes(currentArticleLines.join('\n').trim());
      if (!bodyText) {
        return;
      }

      const chapterPath = [currentChapter, currentSection].filter(Boolean).join(' > ');
      const headerSummary = currentArticleTitle
        ? `${currentArticleNumber}(${currentArticleTitle})`
        : currentArticleNumber;

      const contextualHeader = chapterPath
        ? `[${lawName} > ${chapterPath} > ${headerSummary}]`
        : `[${lawName} > ${headerSummary}]`;

      const fullContent = `${contextualHeader}\n${headerSummary}\n${bodyText}`;

      chunks.push({
        id: `${lawName}_${currentArticleNumber.replace(/\s+/g, '')}`,
        lawName,
        lawType,
        chapterPath,
        articleNumber: currentArticleNumber,
        articleTitle: currentArticleTitle,
        content: fullContent,
        effectiveDate,
        status,
        sourceUrl,
        filePath,
      });

      currentArticleLines = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 부칙 처리: 본칙 조문 파싱 완료 후 부칙 이후 텍스트는 조문 청크에서 제외
      if (MarkdownLawParser.ADDENDUM_HEADER_REGEX.test(line)) {
        flushCurrentArticle();
        break;
      }

      // 장/편/관 헤더
      const chapterMatch = line.match(MarkdownLawParser.CHAPTER_HEADER_REGEX);
      if (chapterMatch) {
        currentChapter = chapterMatch[1].trim();
        currentSection = '';
        continue;
      }

      // 절 헤더
      const sectionMatch = line.match(MarkdownLawParser.SECTION_HEADER_REGEX);
      if (sectionMatch) {
        currentSection = sectionMatch[1].trim();
        continue;
      }

      // 조문 헤더 (##### 제N조 또는 ##### 제N조 (제목))
      const articleMatch = line.match(MarkdownLawParser.ARTICLE_HEADER_REGEX);
      if (articleMatch) {
        flushCurrentArticle();
        currentArticleNumber = articleMatch[1].trim();
        currentArticleTitle = (articleMatch[2] || '').trim();
        continue;
      }

      // 현재 조문 본문 수집
      if (currentArticleNumber) {
        currentArticleLines.push(line);
      }
    }

    // 마지막 조문 플러시
    flushCurrentArticle();

    return {
      metadata,
      chunks,
    };
  }
}
