import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { MarkdownLawParser } from './markdownParser.js';
import { ParsedLawDocument } from '../types/law.js';

export interface ScanOptions {
  /** 특정 법령명 필터링 (없으면 전체) */
  targetLawNames?: string[];
  /** 현행 법령(상태: 시행)만 파싱할지 여부 (기본값: true) */
  onlyActiveStatus?: boolean;
  /** 동일 법령/구분 중 가장 최신 시행일자 문서만 유지 (기본값: true) */
  keepLatestOnly?: boolean;
  /** 최대 파싱할 법령 수 (테스트용, 미지정시 전체) */
  limit?: number;
}

export class LawScanner {
  private parser: MarkdownLawParser;

  constructor() {
    this.parser = new MarkdownLawParser();
  }

  /**
   * 주어진 raw 디렉터리 경로를 검사하여 실제 법령 폴더가 위치한 유효 경로를 반환합니다.
   * - rawDir 바로 아래에 법령 폴더가 있거나, legalize-kr 저장소 원본처럼 rawDir/kr 하위에 위치한 경우 모두 자동 감지합니다.
   */
  public static resolveEffectiveDir(rawDir: string): string {
    if (!fs.existsSync(rawDir)) {
      return rawDir;
    }

    const krSubDir = path.join(rawDir, 'kr');
    if (fs.existsSync(krSubDir) && fs.statSync(krSubDir).isDirectory()) {
      const topLevelDirs = fs
        .readdirSync(rawDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== 'kr' && d.name !== '.git');
      // rawDir 바로 아래에 다른 법령 디렉터리가 없고 kr/만 존재하는 경우 kr 디렉터리를 스캔 대상으로 자동 전환
      if (topLevelDirs.length === 0) {
        return krSubDir;
      }
    }

    return rawDir;
  }

  /**
   * 지정된 디렉터리 내의 법령 마크다운 파일들을 스캔하고 파싱합니다.
   */
  public async scanDirectory(
    rawDir: string,
    options: ScanOptions = {}
  ): Promise<ParsedLawDocument[]> {
    const {
      targetLawNames,
      onlyActiveStatus = true,
      keepLatestOnly = true,
      limit,
    } = options;

    if (!fs.existsSync(rawDir)) {
      throw new Error(`디렉터리가 존재하지 않습니다: ${rawDir}`);
    }

    const effectiveRawDir = LawScanner.resolveEffectiveDir(rawDir);
    const lawDirs = fs.readdirSync(effectiveRawDir, { withFileTypes: true });
    const finalResults: ParsedLawDocument[] = [];

    for (const lawDir of lawDirs) {
      if (!lawDir.isDirectory()) {
        continue;
      }

      const lawName = lawDir.name;
      if (targetLawNames && !targetLawNames.includes(lawName)) {
        continue;
      }

      const fullLawDirPath = path.join(effectiveRawDir, lawName);
      const docs = this.scanSingleLaw(fullLawDirPath, { onlyActiveStatus, keepLatestOnly });
      finalResults.push(...docs);

      if (limit && finalResults.length >= limit) {
        return finalResults.slice(0, limit);
      }
    }

    return finalResults;
  }

  /**
   * 지정된 raw 디렉터리 내의 대상 법령 디렉터리 이름 목록을 반환합니다.
   */
  public getLawDirectoryNames(rawDir: string, targetLawNames?: string[]): string[] {
    if (!fs.existsSync(rawDir)) {
      throw new Error(`디렉터리가 존재하지 않습니다: ${rawDir}`);
    }

    const effectiveDir = LawScanner.resolveEffectiveDir(rawDir);
    const entries = fs.readdirSync(effectiveDir, { withFileTypes: true });
    const dirNames: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (targetLawNames && !targetLawNames.includes(entry.name)) {
        continue;
      }
      dirNames.push(entry.name);
    }

    return dirNames.sort();
  }

  /**
   * 단일 법령 디렉터리 내의 마크다운 파일들을 스캔하여 최신 시행 법령 문서를 추출합니다.
   */
  public scanSingleLaw(
    lawDirPath: string,
    options: Pick<ScanOptions, 'onlyActiveStatus' | 'keepLatestOnly'> = {}
  ): ParsedLawDocument[] {
    const { onlyActiveStatus = true, keepLatestOnly = true } = options;

    if (!fs.existsSync(lawDirPath)) {
      return [];
    }

    const files = fs.readdirSync(lawDirPath);
    const docsByLawKey = new Map<string, ParsedLawDocument[]>();

    for (const fileName of files) {
      if (!fileName.endsWith('.md')) {
        continue;
      }

      const filePath = path.join(lawDirPath, fileName);
      const rawContent = fs.readFileSync(filePath, 'utf-8');

      if (onlyActiveStatus) {
        const { data } = matter(rawContent);
        const status = String(data.상태 || '');
        if (status !== '시행') {
          continue;
        }
      }

      const parsed = this.parser.parse(rawContent, filePath);
      if (parsed.chunks.length === 0) {
        continue;
      }

      const lawKey = `${parsed.metadata.제목}_${parsed.metadata.법령구분 || '법률'}`;
      const existing = docsByLawKey.get(lawKey) || [];
      existing.push(parsed);
      docsByLawKey.set(lawKey, existing);
    }

    const finalResults: ParsedLawDocument[] = [];

    for (const [, docs] of docsByLawKey) {
      if (!keepLatestOnly || docs.length === 1) {
        finalResults.push(...docs);
        continue;
      }

      docs.sort((a, b) => {
        const dateA = new Date(a.metadata.시행일자 || 0).getTime();
        const dateB = new Date(b.metadata.시행일자 || 0).getTime();
        if (dateB !== dateA) {
          return dateB - dateA;
        }
        return b.chunks.length - a.chunks.length;
      });

      finalResults.push(docs[0]);
    }

    return finalResults;
  }
}

