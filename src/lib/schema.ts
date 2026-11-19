/**
 * 페스타그래프(FestaGraph) — 2026 전국 주요 대학 축제 및 출연 아티스트 지식그래프
 * 데이터: edge_all_수정본.xlsx → data/festival/*.csv → Neo4j AuraDB
 * (적재: scripts/xlsx-to-csv.mjs, scripts/load-graph.mjs)
 */

export type NodeCategory = "지역" | "대학" | "축제" | "아티스트" | "장르";

export interface GraphNode {
  id: string;
  label: NodeCategory;
  name: string;
  /** 같은 이름의 캠퍼스 구분 등 화면 표시용 이름 (예: '성균관대학교 (경기)') */
  displayName?: string;
  /** 노드 상세 바에 표시할 속성 (한국어 키) */
  props?: Record<string, string>;
}

export interface GraphEdge {
  id: string;
  source: string; // node id
  target: string; // node id
  relation: string;
}

export const NODE_LEGEND: Array<{
  label: NodeCategory;
  display: string;
  upperTag: string;
  color: string;
  bgLight: string;
}> = [
  { label: "지역", display: "지역", upperTag: "REGION", color: "#0D7A68", bgLight: "#E6F4F1" },
  { label: "대학", display: "대학", upperTag: "UNIVERSITY", color: "#2563EB", bgLight: "#EBF2FE" },
  { label: "축제", display: "축제", upperTag: "FESTIVAL", color: "#C83E82", bgLight: "#FCEEF5" },
  { label: "아티스트", display: "아티스트", upperTag: "ARTIST", color: "#5E43D8", bgLight: "#F0EDFC" },
  { label: "장르", display: "장르", upperTag: "GENRE", color: "#B86B19", bgLight: "#FDF3E7" },
];

/** 기획서 Ⅲ. 핵심 질문 3개 + 대표 탐색 질문 */
export const HERO_RECOMMENDED_QUESTIONS = [
  "수도권과 비수도권 축제에 모두 출연한 아티스트는 누구이고, 어떤 장르야?",
  "여러 대학 축제에 가장 많이 출연한 아티스트와 그 주 장르는?",
  "남자 아이돌을 섭외한 축제를 연 대학들은 주로 어느 지역에 있어?",
  "잔나비가 출연한 축제는 어느 대학 축제야?",
];

export const INITIAL_CYPHER_PREVIEW = `MATCH (a:아티스트)-[:출연함]->(f:축제)<-[:개최함]-(c:대학)
WITH a, count(DISTINCT f) AS 출연축제수
ORDER BY 출연축제수 DESC LIMIT 5
OPTIONAL MATCH (a)-[:속함 {role: 'main'}]->(g:장르)
RETURN a.name AS 아티스트, 출연축제수, collect(g.name) AS 주장르`;

export const INITIAL_PREVIEW_GRAPH: {
  title: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
} = {
  title: '"가장 많은 축제에 출연한 아티스트, 잔나비" 미리보기',
  nodes: [
    { id: "artist-042", label: "아티스트", name: "잔나비", props: { 성별: "남", "출연 축제 수": "8" } },
    { id: "genre-001", label: "장르", name: "밴드" },
    { id: "festival-010", label: "축제", name: '봄대동제 MASTERPEACE "SOULMATE"', props: { 시즌: "봄", 기간: "2026-05-27 ~ 2026-05-29" } },
    { id: "festival-018", label: "축제", name: "부산대학교 대동제 피우리오", props: { 시즌: "봄", 기간: "2026-05-26 ~ 2026-05-28" } },
    { id: "festival-022", label: "축제", name: "GRACIA 축제", props: { 시즌: "봄", 기간: "2026-05-06 ~ 2026-05-08" } },
    { id: "college-006", label: "대학", name: "경희대학교", displayName: "경희대학교 (서울)", props: { 소재지: "서울", 권역: "수도권" } },
    { id: "college-012", label: "대학", name: "부산대학교", props: { 소재지: "부산", 권역: "영남권" } },
    { id: "college-015", label: "대학", name: "조선대학교", props: { 소재지: "광주", 권역: "호남권" } },
  ],
  edges: [
    { id: "p1", source: "artist-042", target: "genre-001", relation: "속함" },
    { id: "p2", source: "artist-042", target: "festival-010", relation: "출연함" },
    { id: "p3", source: "artist-042", target: "festival-018", relation: "출연함" },
    { id: "p4", source: "artist-042", target: "festival-022", relation: "출연함" },
    { id: "p5", source: "college-006", target: "festival-010", relation: "개최함" },
    { id: "p6", source: "college-012", target: "festival-018", relation: "개최함" },
    { id: "p7", source: "college-015", target: "festival-022", relation: "개최함" },
  ],
};

/**
 * Text-to-Cypher용 정적 스키마 설명 + Few-Shot.
 * 실제 개체 목록(대학·축제·아티스트 이름, 별칭)은 route.ts가 DB에서 읽어 [개체 사전]으로 덧붙입니다.
 */
export const FESTA_GRAPH_SCHEMA_PROMPT = `
## 1. 프로젝트 개요
- 프로젝트명: 2026 전국 주요 대학 축제 및 출연 아티스트 지식그래프 (팀 페스타그래프 FestaGraph)
- 목적: 대학별 축제 라인업과 섭외 장르를 지역·대학 단위로 비교 및 시각화
- 기준 시점: 2026년 2월 ~ 12월 / 출처: 각 대학 총학생회 공식 인스타그램, campustival.com
- 범위 제외: 외부인이 참여할 수 없는 학내 행사(예: 합동응원전, 동아리 연합 축제)

## 2. 노드 라벨과 속성 (라벨·관계 타입은 한글 그대로 사용)
- (:지역 {id, name, region})  예: name '서울'·'경기'·'부산', region(권역) '수도권'·'영남권'·'호남권'·'충청권'·'강원권'·'제주권'
- (:대학 {id, name, display_name, type, location, founded_year, student_count})
  - type: '사립대학교' 또는 '국립대학교'. location: 지역 이름(서울/경기/...)
  - ⚠️ 같은 대학의 캠퍼스가 별도 노드인 경우가 있음: 성균관대학교(서울·경기), 경희대학교(서울·경기), 홍익대학교(서울·세종). 구분이 필요하면 display_name 또는 location을 쓰고, 대학 수를 셀 때는 count(DISTINCT c.name)을 쓸 것.
- (:축제 {id, name, venue, start_date, end_date, season})
  - start_date/end_date: Neo4j date 타입 (예: f.start_date >= date('2026-09-01')). season: '봄' 또는 '가을'
  - 이름에 따옴표·부제가 포함됨(예: '입실렌티: 지.야의 함성 "주인공"'). 축제 이름은 반드시 CONTAINS로 부분 일치 검색할 것.
- (:아티스트 {id, name, gender, aliases})
  - gender: '남' / '여' / '혼성' (일부 아티스트는 null)
  - name은 '영문 (한글)' 형태가 많음(예: 'LE SSERAFIM (르세라핌)', 'aespa'). aliases는 출연 원본 표기 목록(예: aespa의 aliases = ['에스파']).
- (:장르 {id, name})  name: '밴드', '아이돌·팝', '싱어송라이터', '힙합', '발라드', '기타' (6개)

## 3. 관계 (총 4종)
- (:대학)-[:위치함]->(:지역)
- (:대학)-[:개최함]->(:축제)
- (:아티스트)-[:출연함 {review_status}]->(:축제)
- (:아티스트)-[:속함 {role, review_status}]->(:장르)  role: 'main'(주 장르) / 'sub'(부 장르) / '미분류'
- 모든 관계의 review_status(검수상태): '정상' 또는 '확인필요'(공개 자료로 보완했으나 팀 검수 전인 관계)

## 4. 용어 → 그래프 매핑 규칙
- '수도권/비수도권': 지역.region 기준 (비수도권 = region <> '수도권')
- 'K-POP', '아이돌': 장르 '아이돌·팝'. '남돌/남자 아이돌' = 아이돌·팝 + gender '남', '여돌/걸그룹' = 아이돌·팝 + gender '여'
- '주 장르/대표 장르' = 속함.role = 'main'
- '봄 축제/가을 축제' = 축제.season
- 대학 약칭(고려대, 연대, 성대 등)은 c.name CONTAINS '고려대' 처럼 부분 일치로 찾을 것. ('연대'→'연세대', '성대'→'성균관대', '경북대'처럼 그대로 쓰는 경우가 대부분)
- 아티스트 검색: WHERE a.name CONTAINS '키워드' OR '키워드' IN a.aliases (한글/영문 어느 쪽으로 물어도 찾을 수 있게)

## 5. 데이터 유의사항 (edge_all_수정본 기준)
- 장르가 없는 아티스트 2명(SINCE, 무한한사람들), 성별이 없는 아티스트 3명(SINCE, 무한한사람들, 신인류)이 있음. 장르 조건을 걸면 이들은 제외되므로, 장르가 필요 없는 질문에는 장르를 OPTIONAL MATCH로 붙일 것.
- 서울대학교 '봄 축제 LUMINES'의 출연진은 보도 기사 기반 일부(5팀, review_status '확인필요')만 있고, '가을 축제 LUMINES'는 출연 데이터가 없음.
- 출연 기록 없이 장르만 있는 아티스트가 7명 있음(예: 하현상, FTISLAND).
- 스컬&하하, 우디&보라 같은 듀오 표기는 개별 아티스트(스컬·하하, 우디 (Woody)·보라)로 분리되어 있음. 원래 표기는 aliases에 있음.

## 6. 대표 질문별 표준 Cypher (Few-Shot)
- 질문: "수도권과 비수도권 축제에 모두 출연한 아티스트는 누구이고 어떤 장르야?" (기획서 핵심 질문 1)
MATCH (a:아티스트)-[:출연함]->(:축제)<-[:개최함]-(:대학)-[:위치함]->(l:지역)
WITH a, collect(DISTINCT CASE WHEN l.region = '수도권' THEN '수도권' ELSE '비수도권' END) AS 권역
WHERE size(권역) = 2
OPTIONAL MATCH (a)-[r:속함]->(g:장르)
RETURN a.name AS 아티스트, collect(DISTINCT g.name + '(' + coalesce(r.role, '-') + ')') AS 장르
ORDER BY 아티스트

- 질문: "여러 대학 축제에 가장 많이 출연한 아티스트와 주 장르는?" (기획서 핵심 질문 2)
MATCH (a:아티스트)-[:출연함]->(f:축제)<-[:개최함]-(c:대학)
WITH a, count(DISTINCT f) AS 출연축제수, collect(DISTINCT c.name) AS 출연대학
ORDER BY 출연축제수 DESC LIMIT 5
OPTIONAL MATCH (a)-[:속함 {role: 'main'}]->(g:장르)
RETURN a.name AS 아티스트, 출연축제수, 출연대학, collect(g.name) AS 주장르

- 질문: "남자 아이돌을 섭외한 축제를 개최한 대학들은 주로 어느 지역에 있어?" (기획서 핵심 질문 3)
MATCH (a:아티스트 {gender: '남'})-[:속함]->(:장르 {name: '아이돌·팝'})
MATCH (a)-[:출연함]->(f:축제)<-[:개최함]-(c:대학)-[:위치함]->(l:지역)
RETURN l.region AS 권역, count(DISTINCT c.name) AS 대학수, collect(DISTINCT c.name) AS 대학, collect(DISTINCT a.name) AS 섭외아티스트
ORDER BY 대학수 DESC

- 질문: "잔나비가 출연한 축제는 어느 대학 축제야?"
MATCH (a:아티스트)-[:출연함]->(f:축제)<-[:개최함]-(c:대학)
WHERE a.name CONTAINS '잔나비' OR '잔나비' IN a.aliases
RETURN f.name AS 축제, c.display_name AS 대학, f.season AS 시즌, toString(f.start_date) AS 시작일
ORDER BY f.start_date

- 질문: "고려대 입실렌티 라인업 알려줘"
MATCH (c:대학)-[:개최함]->(f:축제)<-[:출연함]-(a:아티스트)
WHERE c.name CONTAINS '고려대' AND f.name CONTAINS '입실렌티'
OPTIONAL MATCH (a)-[:속함 {role: 'main'}]->(g:장르)
RETURN f.name AS 축제, a.name AS 아티스트, g.name AS 주장르
ORDER BY 아티스트

- 질문: "대학별로 가장 많이 섭외한 장르는?"
MATCH (c:대학)-[:개최함]->(:축제)<-[:출연함]-(a:아티스트)-[:속함 {role: 'main'}]->(g:장르)
WITH c.name AS 대학, g.name AS 장르, count(DISTINCT a) AS 아티스트수
ORDER BY 대학, 아티스트수 DESC
WITH 대학, collect({장르: 장르, 아티스트수: 아티스트수}) AS 분포
RETURN 대학, 분포[0].장르 AS 최다장르, 분포[0].아티스트수 AS 아티스트수, 분포 AS 전체분포
ORDER BY 대학

- 질문: "권역별 축제에 출연한 밴드 수를 비교해줘"
MATCH (l:지역)<-[:위치함]-(:대학)-[:개최함]->(:축제)<-[:출연함]-(a:아티스트)-[:속함]->(:장르 {name: '밴드'})
RETURN l.region AS 권역, count(DISTINCT a) AS 밴드수, collect(DISTINCT a.name) AS 밴드
ORDER BY 밴드수 DESC

- 질문: "에스파와 같은 축제에 출연한 아티스트는?"
MATCH (a:아티스트)-[:출연함]->(f:축제)<-[:출연함]-(other:아티스트)
WHERE (a.name CONTAINS '에스파' OR '에스파' IN a.aliases) AND other <> a
RETURN f.name AS 축제, collect(DISTINCT other.name) AS 함께출연한아티스트

- 질문: "가을에 열린 축제 중 힙합 아티스트가 가장 많이 나온 축제는?"
MATCH (c:대학)-[:개최함]->(f:축제 {season: '가을'})<-[:출연함]-(a:아티스트)-[:속함]->(:장르 {name: '힙합'})
RETURN f.name AS 축제, c.display_name AS 대학, count(DISTINCT a) AS 힙합아티스트수, collect(DISTINCT a.name) AS 아티스트
ORDER BY 힙합아티스트수 DESC LIMIT 5

- 질문: "국립대와 사립대 축제의 섭외 장르 차이는?"
MATCH (c:대학)-[:개최함]->(:축제)<-[:출연함]-(a:아티스트)-[:속함 {role: 'main'}]->(g:장르)
RETURN c.type AS 설립유형, g.name AS 장르, count(DISTINCT a) AS 아티스트수
ORDER BY 설립유형, 아티스트수 DESC
`;
