import { NextRequest, NextResponse } from "next/server";
import { runReadQuery } from "@/lib/neo4j";
import { generateText, LlmResult } from "@/lib/llm";
import {
  CHIIKAWA_GRAPH_SCHEMA_PROMPT,
  KNOWN_NODE_NAMES,
  GraphNode,
  GraphEdge,
  NodeCategory,
} from "@/lib/schema";

const CYPHER_START =
  /^\s*(MATCH|OPTIONAL\s+MATCH|WITH|UNWIND|CALL|RETURN)\b/i;

/**
 * LLM 출력에서 실행 가능한 Cypher 1개만 추출합니다.
 * - 코드블록(```cypher), <think> 블록, 앞뒤 설명 문장 제거
 * - 세미콜론으로 여러 문장이 오면 첫 문장만 사용
 */
function cleanCypherString(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");

  const fenced = text.match(/```(?:cypher)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1];

  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => CYPHER_START.test(l));
  if (start > 0) text = lines.slice(start).join("\n");

  const firstStatement = text.split(/;\s*(?:\r?\n|$)/)[0];
  return firstStatement.trim().replace(/;+\s*$/, "");
}

const KNOWN_NAME_SET = new Set<string>(KNOWN_NODE_NAMES);

/** 조회 결과(중첩 객체/배열/경로 포함)에서 노드 이름과 정확히 일치하는 문자열 값만 수집 */
function collectExactNames(value: unknown, found: Set<string>): void {
  if (typeof value === "string") {
    const v = value.trim();
    if (KNOWN_NAME_SET.has(v)) found.add(v);
  } else if (Array.isArray(value)) {
    for (const item of value) collectExactNames(item, found);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectExactNames(item, found);
  }
}

function collectMentionedNodeNames(
  data: unknown,
  question: string,
  cypher: string
): string[] {
  const found = new Set<string>();

  // 조회 결과는 부분 문자열이 아닌 '정확한 값'으로만 매칭
  // (예: '검'이 세이렌의 외형 '검은 만두 머리'에 잘못 매칭되는 문제 방지)
  collectExactNames(data, found);

  // 질문과 Cypher의 문자열 리터럴은 부분 문자열로 매칭하되, 한 글자 이름('검', '숲')은 제외
  const literals = Array.from(cypher.matchAll(/'([^']+)'|"([^"]+)"/g)).map(
    (m) => m[1] ?? m[2]
  );
  const combinedText = `${question} ${literals.join(" ")}`;
  for (const name of KNOWN_NODE_NAMES) {
    if (name.length >= 2 && combinedText.includes(name)) {
      found.add(name);
    }
  }
  for (const lit of literals) {
    if (KNOWN_NAME_SET.has(lit)) found.add(lit);
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

const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;
let schemaCache: { summary: string; at: number } | null = null;

/** 노드 라벨/관계 타입별 실측 건수. 매 요청마다 DB를 두 번 조회하지 않도록 캐시합니다. */
async function getLiveSchemaSummary(): Promise<string> {
  if (schemaCache && Date.now() - schemaCache.at < SCHEMA_CACHE_TTL_MS) {
    return schemaCache.summary;
  }
  const labels = await runReadQuery<{ label: string; count: number }>(
    "MATCH (n) UNWIND labels(n) AS label RETURN label, count(*) AS count ORDER BY label"
  );
  const rels = await runReadQuery<{ type: string; count: number }>(
    "MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS count ORDER BY type"
  );
  const summary =
    `활성 노드 라벨(건수): ${labels.map((l) => `${l.label}(${l.count})`).join(", ")}\n` +
    `활성 관계 타입(건수): ${rels.map((r) => `${r.type}(${r.count})`).join(", ")}`;
  schemaCache = { summary, at: Date.now() };
  return summary;
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

    // 1. Neo4j AuraDB 연결 확인 및 실시간 스키마 검증 (5분 캐시)
    let liveSchemaSummary = "";
    try {
      liveSchemaSummary = await getLiveSchemaSummary();
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

    // 2. K-EXAONE 2.5를 이용한 Text-to-Cypher 변환
    //    (호출 실패 시 Gemini Fallback Chain: gemini-3.8-flash -> gemini-3.5-flash-lite -> gemini-2.5-flash로 자동 전환)
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
6. 사용자가 별칭(먼작귀, 가르마, 토끼, 해달 등)으로 물으면 Character의 name으로 바꾸거나 \`WHERE c.name = '...' OR c.name_kor = '...'\`로 매칭하세요. 질문 속 띄어쓰기('랏코 납치')는 실제 name('랏코납치')으로 고쳐 쓰세요.
7. 원인·결과, 순서, '~을 거쳐' 같은 다단계 질문은 \`-[:CAUSES*1..10]->\` 가변 길이 경로를, 두 개체의 연결고리는 \`shortestPath((a)-[*1..8]-(b))\`를 쓰세요.
8. 경로(p)를 그대로 반환하지 말고 \`[n IN nodes(p) | n.name]\`, \`[r IN relationships(p) | type(r)]\`처럼 이름 목록으로 반환하세요.
9. 결과 컬럼은 한국어 별칭(AS 캐릭터, AS 사건 등)으로 읽기 쉽게 만들고, DISTINCT로 중복을 제거하세요. 목록형 결과에는 LIMIT 50을 붙이세요.
10. 발생 장소처럼 없을 수도 있는 정보는 OPTIONAL MATCH로 조회해 결과가 0건이 되지 않게 하세요.
11. 아래 Few-Shot 예시 중 질문과 의미가 같은 것이 있으면 그 쿼리를 우선 재사용하세요.

[실시간 DB 상태]
${liveSchemaSummary}

${contextCypher ? `[이전 검색 컨텍스트 Cypher]\n${contextCypher}\n` : ""}
${contextSummary ? `[이전 검색 요약]\n${contextSummary}\n` : ""}

[AuraDB 상세 그래프 스키마 및 개체 사전]
${CHIIKAWA_GRAPH_SCHEMA_PROMPT}

[사용자 질문]
${message}`;

    // 1차 생성은 low(Few-Shot 덕분에 정확도 동일, 응답 약 2배 빠름), 오류 수정 재시도만 medium
    const cypherOpts = { reasoningEffort: "low" as const };
    const retryOpts = { reasoningEffort: "medium" as const };
    const llmCalls: LlmResult[] = [];

    const cypherRes = await generateText(cypherPrompt, cypherOpts);
    llmCalls.push(cypherRes);

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

      const retryRes = await generateText(retryPrompt, retryOpts);
      llmCalls.push(retryRes);

      generatedCypher = cleanCypherString(retryRes.text || "");
      try {
        records = await runReadQuery(generatedCypher);
      } catch (retryErr) {
        // 재시도 쿼리도 실패하면 500으로 끝내지 않고 아래 보조 조회로 근거를 확보
        console.warn(
          "[chat] 재생성 Cypher도 실패:",
          retryErr instanceof Error ? retryErr.message : retryErr
        );
        records = [];
      }
    }

    // 4. 결과가 0건이면, 질문에 언급된 개체의 1-hop 이웃 관계만 보조 조회하여 근거 확보
    //    (그래프 전체를 덤프하면 질문과 무관한 데이터로 답변이 오염되므로 범위를 제한)
    let supplementaryNote = "";
    if (records.length === 0) {
      const questionNames = collectMentionedNodeNames([], message, generatedCypher);
      if (questionNames.length > 0) {
        fallbackUsed = true;
        records = await runReadQuery(
          `MATCH (a)-[r]-(b)
           WHERE a.name IN $names
           RETURN DISTINCT labels(a)[0] AS 기준분류, a.name AS 기준노드,
                  CASE WHEN startNode(r) = a THEN '->' ELSE '<-' END AS 방향,
                  type(r) AS 관계, labels(b)[0] AS 연결분류, b.name AS 연결노드
           ORDER BY 기준노드, 관계, 연결노드
           LIMIT 60`,
          { names: questionNames }
        );
        supplementaryNote = `\n※ 생성된 쿼리의 결과가 0건이어서, 질문에 언급된 개체(${questionNames.join(", ")})의 주변 관계를 보조로 조회한 데이터입니다. 질문에 직접 답할 근거가 부족하면 그 사실을 솔직하게 밝히세요.`;
      }
    }

    // 5. 조회 결과 및 질문에서 언급된 노드들의 서브그래프(노드+관계)와 경로 뱃지 추출
    const mentionedNames = collectMentionedNodeNames(
      records,
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
3. **간결하고 자연스러운 서술**: 2~4문장 내외로 핵심 인과관계와 연결 고리를 명확하게 설명해 주세요. 사건 흐름은 'A → B → C'처럼 순서대로 보여 주세요.
4. **이름 표기**: Event 이름은 읽기 쉽게 띄어 써도 됩니다(예: 랏코납치 → **랏코 납치**). 별칭(name_kor)이 있으면 처음 한 번 괄호로 병기하세요.
5. **근거 부족 시**: 조회 데이터가 0건이거나 질문과 무관하면 "지식 그래프에서 해당 정보를 찾지 못했습니다"라고 답하고, 대신 물어볼 수 있는 관련 질문을 1개 제안하세요.
6. Event의 type 속성은 일부 잘못 입력되어 있으므로 사건의 성격을 type 값으로 설명하지 마세요.

[사용자 질문]
${message}

[실행된 Cypher 쿼리]
${generatedCypher}

[실제 그래프 경로]
${subgraph.evidencePaths.join(", ") || "(없음)"}

[조회된 그래프 데이터 (${records.length}건)]${supplementaryNote}
${records.length > 0 ? JSON.stringify(records.slice(0, 30)) : "(0건)"}`;

    // 근거 데이터가 이미 주어진 요약 작업이므로 추론 강도를 low로 낮춰 응답 속도 확보
    const answerRes = await generateText(answerPrompt, { reasoningEffort: "low" });
    llmCalls.push(answerRes);

    const exaoneErrors = llmCalls
      .map((c) => c.exaoneError)
      .filter((e): e is string => Boolean(e));

    return NextResponse.json({
      answer: answerRes.text || "답변을 생성하지 못했습니다.",
      modelUsed: answerRes.modelUsed,
      provider: answerRes.provider,
      cypherModelUsed: cypherRes.modelUsed,
      llmFallbackUsed: llmCalls.some((c) => c.provider === "gemini"),
      ...(exaoneErrors.length > 0 ? { exaoneErrors } : {}),
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
