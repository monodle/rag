# 📋 내장 LanceDB 전환 및 GitHub Releases 배포 계획서

## 1. 개요 및 추진 배경
* **현황**: Docker 컨테이너 기반 Qdrant 벡터 데이터베이스를 사용 중으로, 사용자가 데스크톱 앱을 단독으로 실행하기 위해 Docker Desktop 설치 및 컨테이너 구동이 강제됨.
* **목표**: 
  1. 외부 Docker 의존성을 완전히 제거하고 프로세스 내장형(In-process/Embedded) **LanceDB**로 전환.
  2. 수 시간 소요되는 로컬 벡터화(임베딩)를 사용자에게 전가하지 않고, 기존 Qdrant의 기구축 벡터 데이터를 **재임베딩 없이 고속 이전**.
  3. 대용량 벡터 DB를 GitHub Releases Asset으로 호스팅하고, Tauri 앱 실행 시 1회 자동 동기화(다운로드/압축 해제) 지원.

---

## 2. 아키텍처 비교

### AS-IS (Docker 기반)
```
[사용자 환경]
  ├── Docker Desktop 필수 실행
  │     └── Qdrant 컨테이너 (Port: 6333)
  └── Tauri 앱 / Node 백엔드
        └── HTTP / REST API 통신
```

### TO-BE (완전 독립형 데스크톱 앱)
```
[사용자 환경]
  └── Tauri 데스크톱 앱 (Docker 완전 불필요)
        ├── 첫 실행 시 GitHub Releases에서 기구축 DB 자동 다운로드 (1회)
        └── 내장 LanceDB (로컬 파일 기반 Zero-Network 벡터 검색)
```

---

## 3. 세부 단계별 실행 계획 (Milestones)

### Phase 1. Qdrant ➔ LanceDB 마이그레이션 스크립트 작성
- [x] `@lancedb/lancedb` 의존성 설치 완료 (v0.40.0)
- [x] Docker Qdrant의 Scroll API를 통해 `vector` + `payload` 메타데이터 스트리밍 추출
- [x] 재임베딩 연산 없이 LanceDB 테이블 스키마에 일괄 적재(Batch Bulk Insert) 유틸리티 구현 (`src/scripts/migrateQdrantToLanceDb.ts`, `pnpm db:migrate`)
- [x] 변환된 LanceDB 데이터의 레코드 수(206,447건) 및 768차원 벡터 정합성 검증 완료 (소요 시간: 63.2초, 디스크 용량: 766.9MB)

### Phase 2. RAG 검색 엔진(Retriever) LanceDB 연동
- [x] 기존 `QdrantService`를 대체할 내장 `LanceDbService` 구현 (`src/indexer/lanceDbService.ts`)
  - `vectorSearch(queryVector, topK, filter)` 및 Cosine 거리 ➔ 유사도 정규화 변환
  - 법령명, 조문번호 메타데이터 필터링 SQL 쿼리 적용
- [x] 다형적 벡터 저장소 팩토리 및 인터페이스 구현 (`src/indexer/vectorStore.ts`, `IVectorStoreService`)
- [x] RAG 파이프라인(`RagPipelineService`) 및 백엔드 서버(`RagServer`)의 검색 엔진 의존성을 LanceDB 기본으로 교체
- [x] 기존 코사인 유사도 점수 체계 및 임계치(Threshold) 검증 완료 (`pnpm run search` 테스트 성공)

### Phase 3. 데이터베이스 패키징 및 GitHub Releases 릴리즈 자동화
- [x] `pnpm db:pack` 스크립트 구현 및 압축 완료 (`src/scripts/packageDb.ts`)
  - 원본 LanceDB(766.9MB) ➔ `data/korean_laws_lancedb.tar.gz` (636.1MB, 16초 소요)
  - SHA256 체크섬: `71efd53cc34cdcd3fd445a9bcebcbaf45eacf6d0d2b10d21328d8a6cfe40aacb`
- [x] `pnpm db:release` 스크립트 구현 (`src/scripts/releaseDb.ts`)
  - 로컬 **GitHub CLI(`gh`)** 연동 자동 릴리즈 생성 및 업로드
  - 태그(`data-v1`) 기반 에셋 배포 준비 완료

### Phase 4. Tauri 앱 내 최초 실행 부트스트랩 (자동 다운로드)
- [ ] 앱 시작 시 로컬 AppData 내 LanceDB 존재 여부 검사
- [ ] 데이터베이스 부재 시:
  - 프론트엔드 UI에 "법률 데이터베이스 초기 다운로드 및 동기화 중... (진행률 %)" 모달/프로그레스 바 표시
  - 다운로드 스트림 수신 및 로컬 압축 해제 처리
- [ ] 데이터 준비 완료 시 검색 화면으로 자연스러운 화면 전환

### Phase 5. Docker 의존성 정리 및 프로덕션 빌드 검증
- [ ] `docker-compose.yml`, `README.md`, `setup.sh`의 도커 요구사항 제거 및 가이드 갱신
- [ ] `pnpm tauri dev`를 통해 도커 없이 앱 시작부터 질의응답까지 전 과정 동작 확인
- [ ] `pnpm tauri build`로 최종 인스톨러 생성 및 독립 구동 테스트

---

## 4. 데이터 스키마 정의 (LanceDB Table: `korean_laws`)

| 필드명 | 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | `Utf8` | 고유 식별자 (`법령ID_조문번호`) |
| `vector` | `FixedSizeList<Float32>[768]` | EmbeddingGemma-2 768차원 조문 벡터 |
| `law_name` | `Utf8` | 법령명 (예: 도로교통법) |
| `article_no` | `Int32` | 조문 번호 (예: 14) |
| `article_title` | `Utf8` | 조문 제목 (예: 차로의 설치 등) |
| `article_text` | `Utf8` | 조문 본문 전문 |
| `path` | `Utf8` | 상위 편/장/절 계층 경로 |
| `enforcement_date` | `Utf8` | 최신 시행일자 (YYYY-MM-DD) |
| `law_url` | `Utf8` | 국가법령정보센터 링크 |

---

## 5. 예상 리스크 및 대응 방안

1. **다운로드 중 네트워크 단절**:
   - 일시적인 네트워크 오류 시 재시도 로직 및 부분 다운로드 체크섬 검증 방어 코드 추가.
2. **첫 다운로드 용량 부담**:
   - LanceDB 파일 압축(`tar.gz`) 시 원본 대비 용량이 대폭 축소되어 수백 MB 수준으로 배포 가능.
3. **OS별 파일 권한 문제**:
   - OS 표준 사용자 데이터 경로(`app_data_dir`)를 엄격히 준수하여 권한 에러 사전 차단.
