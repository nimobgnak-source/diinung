import { NextRequest, NextResponse } from "next/server";
import { runReadQuery } from "@/lib/neo4j";
import { generateContentWithFallback } from "@/lib/gemini";
import {
  CHIIKAWA_GRAPH_SCHEMA_PROMPT,
  KNOWN_NODE_NAMES,
  GraphNode,
  GraphEdge,
  NodeCategory,
} from "@/lib/schema";

function cleanCypherString(raw: string): string {
  return raw
    .replace(/```cypher/gi, "")
    .replace(/```/g, "")
    .trim()
    .replace(/;+\s*$/, "");
}

function collectMentionedNodeNames(
  data: unknown,
  question: string,
  cypher: string
): string[] {
  const found = new Set<string>();
  const serialized = JSON.stringify(data || "");
  const combinedText = `${question} ${cypher} ${serialized}`;

  for (const name of KNOWN_NODE_NAMES) {
    if (combinedText.includes(name)) {
      found.add(name);
    }
  }

  // 띄어쓰기가 포함된 질문 표현도 공식 Event/CulturalElement 명칭과 매핑
  const aliasPairs: Array<[string, string]> = [
    ["랏코 납치", "랏코납치"],
    ["동료 구출", "동료구출"],
    ["세이렌 조우", "세이렌조우"],
    ["세이렌 위협", "세이렌위협"],
    ["세이렌 토벌", "세이렌토벌"],
    ["인어 살해", "인어살해"],
    ["영생 획득", "영생획득"],
    ["인어조림 섭취", "인어조림섭취"],
    ["인어 조림 섭취", "인어조림섭취"],
    ["인어섬 방문", "인어섬방문"],
    ["인어섬 송별회", "인어섬송별회"],
    ["전단지 수령", "전단지수령"],
    ["토벌 의뢰", "토벌의뢰"],
    ["인어 설화", "인어설화"],
    ["바다 신앙", "바다신앙"],
    ["생선 조림", "생선조림"],
    ["단팥 과자", "단팥과자"],
    ["오사카 사투리", "오사카사투리"],
    ["공동체 음악", "공동체음악"],
    ["먼작귀", "치이카와"],
    ["가르마", "하치와레"],
    ["토끼", "우사기"],
    ["하늘다람쥐", "모몽가"],
    ["밤만쥬", "쿠리만쥬"],
    ["해달", "랏코"],
    ["헌책방", "카니"],
    ["섬 아저씨", "시마지로"],
    ["한잎이", "히토하"],
    ["두잎이", "후타바"],
  ];

  for (const [alias, canonical] of aliasPairs) {
    if (combinedText.includes(alias)) {
      found.add(canonical);
    }
  }

  return Array.from(found);
}

interface SubgraphRow {
  sourceId: string;
  sourceLabel: string;
  sourceProps: Record<string, unknown>;
  relType: string;
  targetId: string;
  targetLabel: string;
  targetProps: Record<string, unknown>;
}

async function fetchSubgraphForNames(names: string[]): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
  evidencePaths: string[];
}> {
  if (names.length === 0) {
    return { nodes: [], edges: [], evidencePaths: [] };
  }

  // 1차: 매칭된 노드들 사이의 직접 연결 조회
  let rows = await runReadQuery<SubgraphRow>(
    `MATCH (a)-[r]->(b)
     WHERE a.name IN $names AND b.name IN $names
     RETURN a.id AS sourceId, labels(a)[0] AS sourceLabel, properties(a) AS sourceProps,
            type(r) AS relType,
            b.id AS targetId, labels(b)[0] AS targetLabel, properties(b) AS targetProps
     LIMIT 30`,
    { names }
  );

  // 직접 연결이 너무 적으면 1-hop 이웃 관계까지 확장
  if (rows.length < 2) {
    rows = await runReadQuery<SubgraphRow>(
      `MATCH (a)-[r]->(b)
       WHERE a.name IN $names OR b.name IN $names
       RETURN a.id AS sourceId, labels(a)[0] AS sourceLabel, properties(a) AS sourceProps,
              type(r) AS relType,
              b.id AS targetId, labels(b)[0] AS targetLabel, properties(b) AS targetProps
       LIMIT 20`,
      { names }
    );
  }

  const nodeMap = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const evidenceSet = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const sName = String(row.sourceProps?.name || row.sourceId);
    const tName = String(row.targetProps?.name || row.targetId);

    if (!nodeMap.has(sName)) {
      nodeMap.set(sName, {
        id: String(row.sourceProps?.id || row.sourceId || sName),
        label: (row.sourceLabel || "Character") as NodeCategory,
        name: sName,
        name_kor: row.sourceProps?.name_kor
          ? String(row.sourceProps.name_kor)
          : undefined,
        type: row.sourceProps?.type ? String(row.sourceProps.type) : undefined,
        personality: row.sourceProps?.personality
          ? String(row.sourceProps.personality)
          : undefined,
        immortality:
          typeof row.sourceProps?.immortality === "boolean"
            ? row.sourceProps.immortality
            : undefined,
        skills: row.sourceProps?.skills
          ? String(row.sourceProps.skills)
          : undefined,
      });
    }

    if (!nodeMap.has(tName)) {
      nodeMap.set(tName, {
        id: String(row.targetProps?.id || row.targetId || tName),
        label: (row.targetLabel || "Event") as NodeCategory,
        name: tName,
        name_kor: row.targetProps?.name_kor
          ? String(row.targetProps.name_kor)
          : undefined,
        type: row.targetProps?.type ? String(row.targetProps.type) : undefined,
        personality: row.targetProps?.personality
          ? String(row.targetProps.personality)
          : undefined,
        immortality:
          typeof row.targetProps?.immortality === "boolean"
            ? row.targetProps.immortality
            : undefined,
        skills: row.targetProps?.skills
          ? String(row.targetProps.skills)
          : undefined,
      });
    }

    const edgeKey = `${sName}__${row.relType}__${tName}`;
    if (!edges.some((e) => `${e.source}__${e.relation}__${e.target}` === edgeKey)) {
      edges.push({
        id: `edge_${i}_${edgeKey}`,
        source: sName,
        target: tName,
        relation: row.relType,
      });
    }

    evidenceSet.add(`${sName} -[${row.relType}]-> ${tName}`);
  }

  // 그래프 시각화가 한눈에 들어오도록 최대 12개 핵심 노드 위주로 정리
  const nodes = Array.from(nodeMap.values()).slice(0, 12);
  const allowedNames = new Set(nodes.map((n) => n.name));
  const filteredEdges = edges.filter(
    (e) => allowedNames.has(e.source) && allowedNames.has(e.target)
  );

  return {
    nodes,
    edges: filteredEdges,
    evidencePaths: Array.from(evidenceSet).slice(0, 6),
  };
}

export async function GET() {
  try {
    const counts = await runReadQuery<{ label: string; count: number }>(
      "MATCH (n) RETURN labels(n)[0] AS label, count(n) AS count"
    );
    const scopeMap: Record<string, number> = {
      Character: 15,
      Event: 13,
      Place: 9,
      Object: 10,
      Ability: 4,
      CulturalElement: 8,
    };

    for (const row of counts) {
      if (row.label) {
        scopeMap[row.label] = Number(row.count);
      }
    }

    return NextResponse.json({
      connected: true,
      scope: scopeMap,
    });
  } catch (err) {
    return NextResponse.json(
      {
        connected: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 503 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, contextCypher, contextSummary } = body as {
      message?: string;
      contextCypher?: string;
      contextSummary?: string;
    };

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "질문 내용을 입력해 주세요." },
        { status: 400 }
      );
    }

    // 1. Neo4j AuraDB 연결 확인 및 실시간 스키마 검증
    let liveSchemaSummary = "";
    try {
      const labels = await runReadQuery<{ label: string }>(
        "CALL db.labels() YIELD label RETURN label"
      );
      const relTypes = await runReadQuery<{ relationshipType: string }>(
        "CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType"
      );
      liveSchemaSummary = `활성 노드 라벨: ${labels.map((l) => l.label).join(", ")}\n활성 관계 타입: ${relTypes.map((r) => r.relationshipType).join(", ")}`;
    } catch (dbErr) {
      return NextResponse.json(
        {
          error:
            "Neo4j 데이터베이스에 연결할 수 없습니다. .env.local의 접속 정보(NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD)와 AuraDB 실행 상태를 확인해 주세요.",
          details: dbErr instanceof Error ? dbErr.message : String(dbErr),
        },
        { status: 503 }
      );
    }

    // 2. Gemini(자동 재시도 + Fallback Chain: gemini-3.8-flash -> gemini-3.5-flash-lite -> gemini-2.5-flash)를 이용한 Text-to-Cypher 변환
    const cypherPrompt = `당신은 극장판 '치이카와: 인어섬의 비밀' Neo4j AuraDB 지식 그래프 전문 Cypher 엔지니어입니다.
아래 [AuraDB 상세 그래프 스키마 및 개체 사전]을 엄격히 준수하여 사용자의 자연어 질문을 해결할 수 있는 최적의 읽기 전용(MATCH, OPTIONAL MATCH, WITH, WHERE, RETURN, ORDER BY, UNWIND) Cypher 쿼리 1개만 작성하세요.

[핵심 작성 규칙]
1. 절대 데이터를 수정하거나 삭제하는 키워드(CREATE, MERGE, DELETE, DETACH, DROP, SET, REMOVE)를 사용하지 마세요.
2. 마크다운 코드 블록(\`\`\`cypher)이나 설명 없이 오직 실행 가능한 순수 Cypher 쿼리 문자열만 출력하세요.
3. 노드 이름(name)의 띄어쓰기를 정확히 지키세요:
   - Event 노드의 name은 모두 붙여쓰기입니다: '전단지수령', '인어섬방문', '세이렌조우', '토벌의뢰', '랏코납치', '동료구출', '세이렌위협', '세이렌토벌', '인어살해', '영생획득', '인어조림섭취', '인어섬송별회', '귀환'
   - Object 노드 중 띄어쓰기가 있는 이름: '인어 비늘', '인어 조림', '매운 카레', '캐롤라이나 리퍼 가루', '전설의 동물 도감'
   - Place 노드 중 띄어쓰기가 있는 이름: '치이카와의 집', '히토하와 후타바의 집', '세이렌의 거처', '인어섬 마을', '시마지로의 가게'
   - CulturalElement 노드의 name은 모두 붙여쓰기입니다: '축제', '인어설화', '바다신앙', '생선조림', '단팥과자', '탄산', '오사카사투리', '공동체음악'
4. 능력(Ability)이나 영생 여부 질문 시 별도의 Ability 노드를 찾지 말고 Character 노드의 \`skills\` 및 \`immortality\` 속성을 조회하세요.
5. 친구 관계(FRIENDS_OF)나 대립 관계(RIVAL_OF)는 방향에 관계없이 조회될 수 있도록 무방향 패턴 \`-[:FRIENDS_OF]-\` 또는 \`-[:RIVAL_OF]-\`을 우선 활용하세요.

[실시간 DB 상태]
${liveSchemaSummary}

${contextCypher ? `[이전 검색 컨텍스트 Cypher]\n${contextCypher}\n` : ""}
${contextSummary ? `[이전 검색 요약]\n${contextSummary}\n` : ""}

[AuraDB 상세 그래프 스키마 및 개체 사전]
${CHIIKAWA_GRAPH_SCHEMA_PROMPT}

[사용자 질문]
${message}`;

    const cypherRes = await generateContentWithFallback(cypherPrompt);

    let generatedCypher = cleanCypherString(cypherRes.text || "");
    let records: Record<string, unknown>[] = [];
    let fallbackUsed = false;

    // 3. 생성된 Cypher 쿼리 실행 (오류 시 1회 자가 수정 재시도 포함)
    try {
      records = await runReadQuery(generatedCypher);
    } catch (queryErr) {
      const errMsg =
        queryErr instanceof Error ? queryErr.message : String(queryErr);

      const retryPrompt = `${cypherPrompt}

[이전 생성 쿼리]
${generatedCypher}

[발생한 오류]
${errMsg}

위 오류를 수정하여 올바른 읽기 전용 Cypher 쿼리만 다시 출력하세요.`;

      const retryRes = await generateContentWithFallback(retryPrompt);

      generatedCypher = cleanCypherString(retryRes.text || "");
      records = await runReadQuery(generatedCypher);
    }

    // 4. 만약 1차 쿼리 결과가 0건인 경우, 그래프 전체 핵심 연결 컨텍스트를 보조 조회하여 근거 확보
    if (records.length === 0) {
      fallbackUsed = true;
      const fallbackCypher = `MATCH (a)-[r]->(b)
RETURN labels(a)[0] AS 시작분류, a.name AS 시작노드, a.name_kor AS 시작별칭, a.skills AS 기술, a.immortality AS 영생여부,
       type(r) AS 관계,
       labels(b)[0] AS 도착분류, b.name AS 도착노드, b.type AS 도착유형
ORDER BY 관계, 시작노드`;
      records = await runReadQuery(fallbackCypher);
    }

    // 5. 조회 결과 및 질문에서 언급된 노드들의 서브그래프(노드+관계)와 경로 뱃지 추출
    const mentionedNames = collectMentionedNodeNames(
      fallbackUsed ? [] : records,
      message,
      generatedCypher
    );
    const subgraph = await fetchSubgraphForNames(
      mentionedNames.length > 0
        ? mentionedNames
        : ["치이카와", "세이렌", "랏코", "랏코납치", "동료구출", "토벌봉", "세이렌의 거처"]
    );

    // 6. 조회된 그래프 데이터를 기반으로 한국어 근거 기반(Grounded) 답변 생성
    const answerPrompt = `당신은 극장판 '치이카와: 인어섬의 비밀' 지식 그래프(Neo4j AuraDB) 기반 GraphRAG AI 챗봇입니다.
반드시 아래 [조회된 그래프 데이터]와 [실제 그래프 경로]에 근거하여 사용자의 질문에 한국어로 명확하고 간결하며 친절하게 답변하세요.

[답변 작성 지침]
1. **철저한 근거 기반(Grounded Generation)**: 조회된 그래프 데이터에 존재하는 노드, 속성, 관계만 사용하여 답변하세요. 그래프에 없는 외부 설정(TVA 성우 등 제외 범위)은 절대 추측하거나 지어내지 마세요.
2. **핵심 키워드 강조**: 답변 문장 안에서 핵심 노드명(예: **치이카와**, **토벌봉**, **세이렌 토벌**, **랏코 납치**, **동료 구출** 등)은 마크다운 굵은 글씨(\`**이름**\`)로 강조해 주세요.
3. **간결하고 자연스러운 서술**: 2~4문장 내외로 핵심 인과관계와 연결 고리를 명확하게 설명해 주세요.

[사용자 질문]
${message}

[실행된 Cypher 쿼리]
${generatedCypher}

[실제 그래프 경로]
${subgraph.evidencePaths.join(", ")}

[조회된 그래프 데이터 (${records.length}건)]
${JSON.stringify(records.slice(0, 30), null, 2)}`;

    const answerRes = await generateContentWithFallback(answerPrompt);

    return NextResponse.json({
      answer: answerRes.text || "답변을 생성하지 못했습니다.",
      modelUsed: answerRes.modelUsed,
      cypher: generatedCypher,
      records,
      recordCount: records.length,
      fallbackUsed,
      graph: {
        nodes: subgraph.nodes,
        edges: subgraph.edges,
      },
      evidencePaths: subgraph.evidencePaths,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "요청 처리 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
