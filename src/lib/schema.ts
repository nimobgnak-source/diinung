/**
 * 영화 ‘치이카와: 인어섬의 비밀’ (팀 A+토벌단)
 * 프로젝트 기획서 및 CSV / AuraDB 실측 그래프 스키마 정의
 */

export type NodeCategory =
  | "Character"
  | "Event"
  | "Place"
  | "Object"
  | "Ability"
  | "CulturalElement";

export interface GraphNode {
  id: string;
  label: NodeCategory;
  name: string;
  displayName?: string;
  name_kor?: string;
  type?: string;
  personality?: string;
  immortality?: boolean;
  skills?: string;
  description?: string;
}

export interface GraphEdge {
  id: string;
  source: string; // node name
  target: string; // node name
  relation: string;
}

export const NODE_LEGEND: Array<{
  label: NodeCategory;
  display: string;
  upperTag: string;
  color: string;
  bgLight: string;
}> = [
  {
    label: "Character",
    display: "Character",
    upperTag: "CHARACTER",
    color: "#C83E82",
    bgLight: "#FCEEF5",
  },
  {
    label: "Event",
    display: "Event",
    upperTag: "EVENT",
    color: "#B86B19",
    bgLight: "#FDF3E7",
  },
  {
    label: "Place",
    display: "Place",
    upperTag: "PLACE",
    color: "#0D7A68",
    bgLight: "#E6F4F1",
  },
  {
    label: "Object",
    display: "Object",
    upperTag: "OBJECT",
    color: "#5E43D8",
    bgLight: "#F0EDFC",
  },
  {
    label: "Ability",
    display: "Ability",
    upperTag: "ABILITY",
    color: "#2563EB",
    bgLight: "#EBF2FE",
  },
  {
    label: "CulturalElement",
    display: "Cultural Element",
    upperTag: "CULTURAL ELEMENT",
    color: "#7C2D12",
    bgLight: "#F9EBE7",
  },
];

export const HERO_RECOMMENDED_QUESTIONS = [
  "세이렌에게 납치된 캐릭터를 구출하기 위해 누가 참여했어?",
  "치이카와가 사용한 사물은 무엇이고 어떤 능력과 연결돼?",
  "인어섬의 사건들은 어떤 순서로 서로 영향을 주었어?",
  "일본 전통문화와 연관된 사물이나 사건은 무엇이야?",
];

export const INITIAL_CYPHER_PREVIEW = `MATCH (c:Character)-[:RIVAL_OF|KIDNAPS|ATTACKS]-(s:Character {name:"세이렌"})
MATCH (c)-[:PARTICIPATES_IN]->(e:Event)-[:OCCURS_AT]->(p:Place)
RETURN c.name AS 캐릭터, p.name AS 장소`;

export const INITIAL_PREVIEW_GRAPH: {
  title: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
} = {
  title: '"세이렌과 랏코 납치 사건" 미리보기',
  nodes: [
    {
      id: "C10",
      label: "Character",
      name: "세이렌",
      name_kor: "세이렌",
      type: "검은 만두 머리와 빨간 꼬리",
      personality: "선악을 구분하기 어려움",
      immortality: false,
      skills: "노래를 통한 식물 조종",
    },
    {
      id: "C06",
      label: "Character",
      name: "랏코",
      name_kor: "해달",
      type: "해달을 닮은 모습",
      personality: "침착하고 듬직함",
      immortality: false,
      skills: "언어 발화",
    },
    {
      id: "E05",
      label: "Event",
      name: "랏코납치",
      displayName: "랏코 납치",
      type: "납치 및 갈등",
    },
    {
      id: "E06",
      label: "Event",
      name: "동료구출",
      displayName: "동료 구출",
      type: "구조 및 탈출",
    },
    {
      id: "P04",
      label: "Place",
      name: "세이렌의 거처",
      type: "감금 시설",
    },
    {
      id: "C01",
      label: "Character",
      name: "치이카와",
      name_kor: "먼작귀",
      type: "동그란 귀와 작고 하얀 몸",
      personality: "소심하지만 다정하고 용감함",
      immortality: false,
      skills: "비밀 유지",
    },
    {
      id: "O02",
      label: "Object",
      name: "토벌봉",
      type: "무기",
    },
  ],
  edges: [
    {
      id: "e1",
      source: "세이렌",
      target: "랏코",
      relation: "KIDNAPS",
    },
    {
      id: "e2",
      source: "랏코",
      target: "랏코납치",
      relation: "PARTICIPATES_IN",
    },
    {
      id: "e3",
      source: "랏코납치",
      target: "동료구출",
      relation: "CAUSES",
    },
    {
      id: "e4",
      source: "동료구출",
      target: "세이렌의 거처",
      relation: "OCCURS_AT",
    },
    {
      id: "e5",
      source: "치이카와",
      target: "동료구출",
      relation: "PARTICIPATES_IN",
    },
    {
      id: "e6",
      source: "치이카와",
      target: "토벌봉",
      relation: "USES",
    },
  ],
};

export const KNOWN_NODE_NAMES = [
  // Character (15)
  "치이카와",
  "하치와레",
  "우사기",
  "모몽가",
  "쿠리만쥬",
  "랏코",
  "시사",
  "카니",
  "시마지로",
  "세이렌",
  "인어들",
  "섬주민",
  "히토하",
  "후타바",
  "섬 마을 촌장",
  // Event (13)
  "전단지수령",
  "인어섬방문",
  "세이렌조우",
  "토벌의뢰",
  "랏코납치",
  "동료구출",
  "세이렌위협",
  "세이렌토벌",
  "인어살해",
  "영생획득",
  "인어조림섭취",
  "인어섬송별회",
  "귀환",
  // Place (9)
  "치이카와의 집",
  "히토하와 후타바의 집",
  "선착장",
  "세이렌의 거처",
  "인어섬 마을",
  "시마지로의 가게",
  "숲",
  "해변",
  "동굴",
  // Object (10)
  "전단지",
  "토벌봉",
  "검",
  "인어 비늘",
  "사탕",
  "건전지",
  "인어 조림",
  "매운 카레",
  "캐롤라이나 리퍼 가루",
  "전설의 동물 도감",
  // CulturalElement (8)
  "축제",
  "인어설화",
  "바다신앙",
  "생선조림",
  "단팥과자",
  "탄산",
  "오사카사투리",
  "공동체음악",
];

export const CHIIKAWA_GRAPH_SCHEMA_PROMPT = `
## 1. 프로젝트 개요 및 도메인 배경
- 프로젝트명: 영화 ‘치이카와: 인어섬의 비밀’ 지식그래프 분석 (팀명: A+토벌단 - 박민진, 방민주, 석예린)
- 분석 목적: 국경과 문화를 넘어 흥행한 극장판 <치이카와: 인어섬의 비밀>의 요소를 **서사적 측면(사건과 인과관계)**, **문화적 측면(일본 전통·설화·음식·방언·음악)**, **관계적 측면(우호/적대/협력/구출/납치)**으로 구조화하여 분석함.
- 기준 시점: 전단지 수령 ~ 귀환

## 2. AuraDB 노드 라벨(Labels), 속성(Properties) 및 전체 개체 목록 (총 55개 노드 + 기획서 능력 속성 4종)
주의: 기획서 초안의 Ability(능력: 영생, 노래를 통한 식물 조종, 소용돌이 생성, 랩)는 실제 AuraDB에서 별도 노드가 아닌 **Character 노드의 skills(보유 기술) 및 immortality(영생 여부, boolean) 속성**으로 통합되어 저장되어 있습니다!

### (1) Character (등장인물, 총 15개)
- 속성:
  - id: 'C01' ~ 'C15'
  - name: 공식 명칭
  - name_kor: 한국어 별칭/음역 명칭 (사용자가 한국어 별칭으로 질문해도 name 또는 name_kor로 매칭할 것)
  - type: 외형적 특징
  - personality: 성격
  - immortality: 영생 여부 (boolean: true 또는 false — 히토하, 후타바만 true)
  - skills: 보유 능력/특기 문자열
- 전체 Character 노드 목록:
  - '치이카와' (name_kor: '먼작귀', immortality: false, skills: '비밀 유지', type: '동그란 귀와 작고 하얀 몸', personality: '소심하지만 다정하고 용감함')
  - '하치와레' (name_kor: '가르마', immortality: false, skills: '언어 발화', type: '파란색과 흰색의 고양이', personality: '다정하고 긍정적임')
  - '우사기' (name_kor: '토끼', immortality: false, skills: '랩', type: '노란색 몸과 긴 귀', personality: '활발하고 자유분방함')
  - '모몽가' (name_kor: '하늘다람쥐', immortality: false, skills: '떼쓰기', type: '하늘다람쥐를 닮은 모습', personality: '자기중심적이고 애교많음')
  - '쿠리만쥬' (name_kor: '밤만쥬', immortality: false, skills: '맛보기 대장', type: '베이지색 몸과 작은 수달 귀', personality: '느긋하고 먹기를 좋아함')
  - '랏코' (name_kor: '해달', immortality: false, skills: '언어 발화', type: '해달을 닮은 모습', personality: '침착하고 듬직함')
  - '시사' (name_kor: '시사', immortality: false, skills: '요리 대장', type: '시사(사자상)을 닮은 모습', personality: '성실하고 예의 바름')
  - '카니' (name_kor: '헌책방', immortality: false, skills: '집게로 절단하기', type: '게 모양 장식을 지닌 분홍색  ', personality: '다정하고 온순함')
  - '시마지로' (name_kor: '섬 아저씨', immortality: false, skills: '소용돌이 생성', type: '천 하나를 두른 아저씨의 모습', personality: '친절하고 사명감 있음')
  - '세이렌' (name_kor: '세이렌', immortality: false, skills: '노래를 통한 식물 조종', type: '검은 만두 머리와 빨간 꼬리', personality: '선악을 구분하기 어려움')
  - '인어들' (name_kor: '인어들', immortality: false, skills: '코러스', type: '하얀 몸과 빨간 꼬리', personality: '무리 지어 다니고 노래를 좋아함')
  - '섬주민' (name_kor: '섬주민', immortality: false, skills: '없음', type: '모두 회색으로 표시', personality: '없음')
  - '히토하' (name_kor: '한잎이', immortality: true, skills: '없음', type: '머리에 잎이 한 개 달림', personality: '순하고 호기심이 많음')
  - '후타바' (name_kor: '두잎이', immortality: true, skills: '없음', type: '머리에 잎이 두 개 달림', personality: '명랑하고 친근함')
  - '섬 마을 촌장' (name_kor: '섬 마을 촌장', immortality: false, skills: '없음', type: '회색으로 표시', personality: '없음')

### (2) Event (사건, 총 13개 — ⚠️ 모든 Event의 name은 띄어쓰기 없이 붙여쓰기 되어 있음!)
- 속성: id ('E01'~'E13'), name, type
- 전체 Event 노드 목록:
  - '전단지수령', '인어섬방문', '세이렌조우', '토벌의뢰', '랏코납치', '동료구출', '세이렌위협', '세이렌토벌', '인어살해', '영생획득', '인어조림섭취', '인어섬송별회', '귀환'

### (3) Place (장소, 총 9개 — ⚠️ 띄어쓰기 주의!)
- 속성: id ('P01'~'P09'), name, type
- 전체 Place 노드 목록:
  - '치이카와의 집', '히토하와 후타바의 집', '선착장', '세이렌의 거처', '인어섬 마을', '시마지로의 가게', '숲', '해변', '동굴'

### (4) Object (사물, 총 10개 — ⚠️ 띄어쓰기 주의!)
- 속성: id ('O01'~'O10'), name, type
- 전체 Object 노드 목록:
  - '전단지', '토벌봉', '검', '인어 비늘', '사탕', '건전지', '인어 조림', '매운 카레', '캐롤라이나 리퍼 가루', '전설의 동물 도감'

### (5) CulturalElement (문화적 요소, 총 8개 — ⚠️ 모두 붙여쓰기!)
- 속성: id ('CE01'~'CE08'), name, type
- 전체 CulturalElement 노드 목록:
  - '축제', '인어설화', '바다신앙', '생선조림', '단팥과자', '탄산', '오사카사투리', '공동체음악'

## 3. 관계(Relationship) 타입 및 방향성 (총 17종, 114개 관계)
1. 인물 간 관계:
   - (:Character)-[:FRIENDS_OF]-(:Character) : 친구 관계 (무방향 \`-[:FRIENDS_OF]-\` 권장)
   - (:Character)-[:RIVAL_OF]-(:Character) : 대립/적대 관계 (치이카와->세이렌, 랏코->세이렌)
   - (:Character)-[:ATTACKS]->(:Character) : 공격하다 (치이카와/하치와레/랏코/쿠리만쥬 -> 세이렌, 모몽가 -> 인어들)
   - (:Character)-[:RESCUES]->(:Character) : 구출하다 (치이카와 -> 랏코/섬주민, 모몽가 -> 치이카와)
   - (:Character)-[:KIDNAPS]->(:Character) : 납치하다 (세이렌 -> 하치와레/우사기/모몽가/랏코/카니/섬주민)
   - (:Character)-[:KILLS]->(:Character) : 살해하다 (히토하 -> 인어들)
2. 인물 - 사건 / 장소 / 사물 관계:
   - (:Character)-[:PARTICIPATES_IN]->(:Event) : 사건에 참여하다 (치이카와/하치와레/우사기는 '전단지수령', '인어섬방문', '세이렌조우', '토벌의뢰', '동료구출', '세이렌토벌', '인어섬송별회', '귀환' 8개 사건에 참여; 히토하/후타바는 '인어살해', '인어조림섭취', '영생획득' 3개 사건에 참여)
   - (:Character)-[:LIVES_IN]->(:Place) : 거주하다
   - (:Character)-[:TRAVELS_TO]->(:Place) : 여행/방문하다 ('인어섬 마을')
   - (:Character)-[:OPERATES]->(:Place) : 가게를 운영하다 (시마지로 -> 시마지로의 가게)
   - (:Character)-[:USES]->(:Object) : 사물을 사용하다 (치이카와 -> 토벌봉/사탕, 랏코 -> 검, 시사 -> 캐롤라이나 리퍼 가루)
   - (:Character)-[:EATS]->(:Object) : 음식을 먹다 (세이렌 -> 매운 카레/캐롤라이나 리퍼 가루. 히토하/후타바는 '인어조림섭취' Event에 PARTICIPATES_IN으로 연결됨)
3. 사건 - 사건 / 장소 / 사물 관계:
   - (:Event)-[:CAUSES]->(:Event) 및 (:Object {name: '전단지'})-[:CAUSES]->(:Event {name: '인어섬방문'}) : 사건 인과관계
   - (:Event)-[:OCCURS_AT]->(:Place) : 사건이 발생한 장소
   - (:Object)-[:REVEALS]->(:Event) : 사건의 진실을 밝히는 단서 ('인어 비늘', '전설의 동물 도감' -> '인어살해')
4. 문화적 요소 관계:
   - (:Event)-[:REFLECTS]->(:CulturalElement) 및 (:Character)-[:REFLECTS]->(:CulturalElement)
   - (:Object)-[:ASSOCIATED_WITH]->(:CulturalElement)

## 4. 대표 질문별 표준 Cypher 쿼리 예시 (Few-Shot)
- 질문: "세이렌에게 납치된 캐릭터를 구출하기 위해 누가 참여했어?"
MATCH (s:Character {name: '세이렌'})-[:KIDNAPS]->(victim:Character)
OPTIONAL MATCH (rescuer:Character)-[:RESCUES]->(victim)
OPTIONAL MATCH (helper:Character)-[:PARTICIPATES_IN]->(e:Event {name: '동료구출'})-[:OCCURS_AT]->(p:Place)
RETURN DISTINCT s.name AS 납치범, collect(DISTINCT victim.name) AS 납치된캐릭터, collect(DISTINCT rescuer.name) AS 직접구출자, collect(DISTINCT helper.name) AS 동료구출참여자, e.name AS 구출사건, p.name AS 발생장소

- 질문: "치이카와가 사용한 사물은 무엇이고 어떤 능력과 연결돼?"
MATCH (c:Character {name: '치이카와'})-[:USES]->(o:Object)
OPTIONAL MATCH (c)-[:PARTICIPATES_IN]->(e:Event)
RETURN c.name AS 캐릭터, c.skills AS 보유기술, c.personality AS 성격, collect(DISTINCT o.name) AS 사용사물, collect(DISTINCT o.type) AS 사물유형, collect(DISTINCT e.name) AS 참여사건

- 질문: "인어섬의 사건들은 어떤 순서로 서로 영향을 주었어?"
MATCH (e1:Event)-[:CAUSES]->(e2:Event)
OPTIONAL MATCH (e1)-[:OCCURS_AT]->(p1:Place)
OPTIONAL MATCH (e2)-[:OCCURS_AT]->(p2:Place)
RETURN e1.name AS 선행사건, p1.name AS 선행장소, e2.name AS 후속사건, p2.name AS 후속장소

- 질문: "일본 전통문화와 연관된 사물이나 사건은 무엇이야?"
MATCH (n)-[r:REFLECTS|ASSOCIATED_WITH]->(ce:CulturalElement)
RETURN labels(n)[0] AS 구분, n.name AS 개체명, type(r) AS 관계, ce.name AS 문화요소, ce.type AS 문화유형
ORDER BY ce.name, 구분
`;
