import { NextRequest, NextResponse } from "next/server";
import { runReadQuery } from "@/lib/neo4j";
import { generateText, LlmResult } from "@/lib/llm";
import {
  FESTA_GRAPH_SCHEMA_PROMPT,
  GraphNode,
  GraphEdge,
  NodeCategory,
} from "@/lib/schema";

// 배포(Vercel) 설정: neo4j-driver는 Node.js 런타임 필요, LLM 2~3회 호출로 응답이 30~60초 걸리므로 시간 제한 확대
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const NODE_LABELS: NodeCategory[] = ["지역", "대학", "축제", "아티스트", "장르"];

// ---------------------------------------------------------------------------
// Cypher 정리
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// DB 카탈로그 (스키마 요약 + 개체 사전 + 이름 색인) — 5분 캐시
// ---------------------------------------------------------------------------
interface CatalogNode {
  id: string;
  label: NodeCategory;
  name: string;
  display_name?: string | null;
  aliases?: string[] | null;
}

interface GraphCatalog {
  schemaSummary: string;
  entityDictionary: string;
  /** 검색어(이름·표시명·별칭·약칭) → 노드 id 목록 */
  nameIndex: Map<string, string[]>;
  nodeById: Map<string, CatalogNode>;
}

const CATALOG_TTL_MS = 5 * 60 * 1000;
let catalogCache: { value: GraphCatalog; at: number } | null = null;

/** 'LE SSERAFIM (르세라핌)' → ['LE SSERAFIM (르세라핌)', 'LE SSERAFIM', '르세라핌'] / '고려대학교' → [..., '고려대'] */
function searchTermsFor(n: CatalogNode): string[] {
  const terms = new Set<string>();
  const add = (t?: string | null) => {
    const v = (t ?? "").trim();
    if (v.length >= 2) terms.add(v);
  };
  add(n.name);
  add(n.display_name);
  for (const a of n.aliases ?? []) add(a);

  const paren = n.name.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (paren) {
    add(paren[1]);
    add(paren[2]);
  }
  if (n.label === "대학") add(n.name.replace(/학교$/, ""));
  return Array.from(terms);
}

async function getGraphCatalog(): Promise<GraphCatalog> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.value;
  }

  const [labelCounts, relCounts, nodes, colleges, festivals] = await Promise.all([
    runReadQuery<{ label: string; count: number }>(
      "MATCH (n) UNWIND labels(n) AS label RETURN label, count(*) AS count ORDER BY label"
    ),
    runReadQuery<{ type: string; count: number }>(
      "MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS count ORDER BY type"
    ),
    runReadQuery<CatalogNode>(
      `MATCH (n) WHERE n.id IS NOT NULL
       RETURN n.id AS id, labels(n)[0] AS label, n.name AS name,
              n.display_name AS display_name, n.aliases AS aliases`
    ),
    runReadQuery<{ name: string; loc: string; region: string; type: string }>(
      `MATCH (c:대학) OPTIONAL MATCH (c)-[:위치함]->(l:지역)
       RETURN coalesce(c.display_name, c.name) AS name, l.name AS loc, l.region AS region, c.type AS type
       ORDER BY region, name`
    ),
    runReadQuery<{ name: string; college: string; season: string; performers: number }>(
      `MATCH (f:축제) OPTIONAL MATCH (c:대학)-[:개최함]->(f)
       OPTIONAL MATCH (a:아티스트)-[:출연함]->(f)
       RETURN f.name AS name, coalesce(c.display_name, c.name) AS college, f.season AS season,
              count(DISTINCT a) AS performers
       ORDER BY college, name`
    ),
  ]);

  const nameIndex = new Map<string, string[]>();
  const nodeById = new Map<string, CatalogNode>();
  for (const n of nodes) {
    nodeById.set(n.id, n);
    for (const term of searchTermsFor(n)) {
      const ids = nameIndex.get(term) ?? [];
      if (!ids.includes(n.id)) ids.push(n.id);
      nameIndex.set(term, ids);
    }
  }

  const artists = nodes
    .filter((n) => n.label === "아티스트")
    .map((n) =>
      n.aliases && n.aliases.length > 0 ? `${n.name}[별칭:${n.aliases.join("/")}]` : n.name
    );

  const schemaSummary =
    `노드 라벨(건수): ${labelCounts.map((l) => `${l.label}(${l.count})`).join(", ")}\n` +
    `관계 타입(건수): ${relCounts.map((r) => `${r.type}(${r.count})`).join(", ")}`;

  const entityDictionary = [
    `[대학 ${colleges.length}개] ` +
      colleges.map((c) => `${c.name}(${c.loc}/${c.region}/${c.type})`).join(", "),
    `[축제 ${festivals.length}개] ` +
      festivals
        .map((f) => `${f.name} — ${f.college}, ${f.season}${f.performers === 0 ? ", 출연데이터 없음" : ""}`)
        .join(" | "),
    `[아티스트 ${artists.length}명] ` + artists.join(", "),
  ].join("\n");

  const value: GraphCatalog = { schemaSummary, entityDictionary, nameIndex, nodeById };
  catalogCache = { value, at: Date.now() };
  return value;
}

// ---------------------------------------------------------------------------
// 질문·결과에 등장한 노드 찾기
// ---------------------------------------------------------------------------
const MAX_FOCUS_IDS = 15;

/** 조회 결과(중첩 객체/배열/경로 포함)의 문자열 값 중 노드 이름과 '정확히' 일치하는 것만 수집 */
function collectExactIds(value: unknown, catalog: GraphCatalog, found: Set<string>): void {
  if (typeof value === "string") {
    for (const id of catalog.nameIndex.get(value.trim()) ?? []) found.add(id);
  } else if (Array.isArray(value)) {
    for (const item of value) collectExactIds(item, catalog, found);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectExactIds(item, catalog, found);
  }
}

/** 질문 문장과 Cypher 문자열 리터럴에 포함된 이름·별칭·약칭 → 노드 id */
function idsMentionedInText(question: string, cypher: string, catalog: GraphCatalog): string[] {
  const literals = Array.from(cypher.matchAll(/'([^']+)'|"([^"]+)"/g)).map((m) => m[1] ?? m[2]);
  const text = `${question} ${literals.join(" ")}`;
  const found = new Set<string>();
  // 긴 검색어부터 매칭해 '경희대학교 (서울)'이 '경희대'보다 먼저 잡히도록
  const terms = Array.from(catalog.nameIndex.keys()).sort((a, b) => b.length - a.length);
  for (const term of terms) {
    if (text.includes(term)) {
      for (const id of catalog.nameIndex.get(term) ?? []) found.add(id);
    }
  }
  return Array.from(found);
}

function collectFocusIds(
  records: unknown,
  question: string,
  cypher: string,
  catalog: GraphCatalog
): string[] {
  const ordered = new Set<string>(idsMentionedInText(question, cypher, catalog));
  const fromRecords = new Set<string>();
  collectExactIds(records, catalog, fromRecords);
  for (const id of fromRecords) ordered.add(id);
  return Array.from(ordered).slice(0, MAX_FOCUS_IDS);
}

// ---------------------------------------------------------------------------
// 시각화용 서브그래프
// ---------------------------------------------------------------------------
interface SubgraphRow {
  sourceId: string;
  sourceLabel: NodeCategory;
  sourceProps: Record<string, unknown>;
  relType: string;
  reviewStatus: string | null;
  targetId: string;
  targetLabel: NodeCategory;
  targetProps: Record<string, unknown>;
}

function displayProps(label: NodeCategory, p: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (k: string, v: unknown) => {
    if (v === null || v === undefined || v === "") return;
    if (Array.isArray(v)) {
      if (v.length > 0) out[k] = v.join(", ");
      return;
    }
    out[k] = String(v);
  };
  switch (label) {
    case "지역":
      put("권역", p.region);
      break;
    case "대학":
      put("소재지", p.location);
      put("설립유형", p.type);
      put("설립연도", p.founded_year);
      put("재학생 수", p.student_count);
      break;
    case "축제":
      put("시즌", p.season);
      if (p.start_date) out["기간"] = `${p.start_date} ~ ${p.end_date ?? p.start_date}`;
      put("장소", p.venue);
      break;
    case "아티스트":
      put("성별", p.gender);
      put("별칭", p.aliases);
      break;
  }
  return out;
}

function toGraphNode(id: string, label: NodeCategory, p: Record<string, unknown>): GraphNode {
  const name = String(p.name ?? id);
  const display = p.display_name ? String(p.display_name) : undefined;
  return {
    id,
    label,
    name,
    displayName: display && display !== name ? display : undefined,
    props: displayProps(label, p),
  };
}

const SUBGRAPH_RETURN = `RETURN a.id AS sourceId, labels(a)[0] AS sourceLabel, properties(a) AS sourceProps,
              type(r) AS relType, r.review_status AS reviewStatus,
              b.id AS targetId, labels(b)[0] AS targetLabel, properties(b) AS targetProps`;

async function fetchSubgraph(ids: string[]): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
  evidencePaths: string[];
  /** 검수상태 '확인필요'인 관계 (팀 검수 전 공개자료 기반) */
  unverifiedPaths: string[];
}> {
  if (ids.length === 0) return { nodes: [], edges: [], evidencePaths: [], unverifiedPaths: [] };

  // 1차: 관심 노드들 사이의 직접 연결
  let rows = await runReadQuery<SubgraphRow>(
    `MATCH (a)-[r]->(b) WHERE a.id IN $ids AND b.id IN $ids ${SUBGRAPH_RETURN} LIMIT 40`,
    { ids }
  );
  // 직접 연결이 거의 없으면 1-hop 이웃까지 확장
  if (rows.length < 2) {
    rows = await runReadQuery<SubgraphRow>(
      `MATCH (a)-[r]->(b) WHERE a.id IN $ids OR b.id IN $ids ${SUBGRAPH_RETURN} LIMIT 25`,
      { ids }
    );
  }

  const nodeMap = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const evidence: string[] = [];
  const unverified: string[] = [];
  const focus = new Set(ids);

  for (const row of rows) {
    if (!nodeMap.has(row.sourceId))
      nodeMap.set(row.sourceId, toGraphNode(row.sourceId, row.sourceLabel, row.sourceProps));
    if (!nodeMap.has(row.targetId))
      nodeMap.set(row.targetId, toGraphNode(row.targetId, row.targetLabel, row.targetProps));

    const key = `${row.sourceId}__${row.relType}__${row.targetId}`;
    if (!edges.some((e) => e.id === key)) {
      edges.push({ id: key, source: row.sourceId, target: row.targetId, relation: row.relType });
      const s = nodeMap.get(row.sourceId)!, t = nodeMap.get(row.targetId)!;
      const path = `${s.displayName ?? s.name} -[${row.relType}]-> ${t.displayName ?? t.name}`;
      evidence.push(path);
      if (row.reviewStatus === "확인필요") unverified.push(path);
    }
  }

  // 화면이 한눈에 들어오도록 최대 12개 노드. 질문/결과에 직접 등장한 노드를 우선 배치
  const all = Array.from(nodeMap.values());
  const nodes = [...all.filter((n) => focus.has(n.id)), ...all.filter((n) => !focus.has(n.id))].slice(0, 12);
  const allowed = new Set(nodes.map((n) => n.id));
  const filteredEdges = edges.filter((e) => allowed.has(e.source) && allowed.has(e.target));

  return { nodes, edges: filteredEdges, evidencePaths: evidence.slice(0, 6), unverifiedPaths: unverified };
}

// ---------------------------------------------------------------------------
// GET: 연결 상태 및 라벨별 노드 수
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  // TEMP 진단: 배포 환경에서 LLM 응답 시간 측정 (?diag=1)
  if (req.nextUrl.searchParams.get("diag") === "1") {
    const timeIt = async (fn: () => Promise<string>) => {
      const t = Date.now();
      try {
        const out = await fn();
        return { ok: true, ms: Date.now() - t, out: out.slice(0, 40) };
      } catch (e) {
        return { ok: false, ms: Date.now() - t, error: e instanceof Error ? e.message.slice(0, 300) : String(e) };
      }
    };
    const { generateWithExaone } = await import("@/lib/exaone");
    const { generateContentWithFallback } = await import("@/lib/gemini");
    const [exaone, gemini] = await Promise.all([
      timeIt(() => generateWithExaone("Reply with just: OK", { reasoningEffort: "low", maxTokens: 512, timeoutMs: 45_000 })),
      timeIt(async () => (await generateContentWithFallback("Reply with just: OK")).text),
    ]);
    return NextResponse.json({ exaone, gemini });
  }

  try {
    const counts = await runReadQuery<{ label: string; count: number }>(
      "MATCH (n) RETURN labels(n)[0] AS label, count(n) AS count"
    );
    const scope: Record<string, number> = Object.fromEntries(NODE_LABELS.map((l) => [l, 0]));
    for (const row of counts) {
      if (row.label) scope[row.label] = Number(row.count);
    }
    return NextResponse.json({ connected: true, scope });
  } catch (err) {
    return NextResponse.json(
      { connected: false, error: err instanceof Error ? err.message : String(err) },
      { status: 503 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST: 자연어 질문 → Cypher → 조회 → 근거 기반 답변
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, contextCypher, contextSummary } = body as {
      message?: string;
      contextCypher?: string;
      contextSummary?: string;
    };

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "질문 내용을 입력해 주세요." }, { status: 400 });
    }

    // 1. Neo4j 연결 확인 + 카탈로그(스키마 요약·개체 사전·이름 색인)
    let catalog: GraphCatalog;
    try {
      catalog = await getGraphCatalog();
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
    //    (호출 실패 시 Gemini Fallback Chain으로 자동 전환)
    const cypherPrompt = `당신은 '2026 전국 주요 대학 축제 및 출연 아티스트' Neo4j 지식그래프 전문 Cypher 엔지니어입니다.
아래 [그래프 스키마]와 [개체 사전]을 엄격히 준수하여 사용자의 자연어 질문에 답할 수 있는 읽기 전용(MATCH, OPTIONAL MATCH, WITH, WHERE, RETURN, ORDER BY, UNWIND) Cypher 쿼리 1개만 작성하세요.

[핵심 작성 규칙]
1. 데이터를 수정·삭제하는 키워드(CREATE, MERGE, DELETE, DETACH, DROP, SET, REMOVE)는 절대 사용하지 마세요.
2. 마크다운 코드 블록이나 설명 없이 실행 가능한 순수 Cypher 쿼리 문자열만 출력하세요.
3. 라벨과 관계 타입은 한글 그대로 씁니다: (:지역), (:대학), (:축제), (:아티스트), (:장르), [:위치함], [:개최함], [:출연함], [:속함]. 관계 방향을 지키세요.
4. 대학·축제·아티스트 이름은 정확히 일치하지 않을 수 있으므로 CONTAINS 부분 일치를 쓰고, 아티스트는 aliases 목록도 함께 검사하세요: \`WHERE a.name CONTAINS '키워드' OR '키워드' IN a.aliases\`
5. [개체 사전]에 있는 실제 이름을 참고해 사용자의 약칭·한글/영문 표기를 실제 이름의 일부로 바꿔 쓰세요(예: '르세라핌' → 'LE SSERAFIM (르세라핌)'에 CONTAINS '르세라핌').
6. 집계 질문(가장 많이, 몇 개, 비교)은 count(DISTINCT ...)로 세고 ORDER BY ... DESC를 쓰세요. 대학 수는 캠퍼스 중복을 피해 count(DISTINCT c.name)으로 세세요.
7. 장르나 성별 조건이 질문에 없으면 장르는 OPTIONAL MATCH로 붙이세요(장르 미분류 아티스트가 빠지지 않도록).
8. 결과 컬럼은 한국어 별칭(AS 아티스트, AS 축제, AS 대학 등)으로 만들고 DISTINCT로 중복을 제거하세요. 목록형 결과에는 LIMIT 50을 붙이세요.
9. 날짜는 toString(f.start_date)처럼 문자열로 반환하세요.
10. 아래 Few-Shot 예시 중 질문과 의미가 같은 것이 있으면 그 쿼리를 우선 재사용하세요.

[실시간 DB 상태]
${catalog.schemaSummary}

${contextCypher ? `[이전 검색 컨텍스트 Cypher]\n${contextCypher}\n` : ""}${contextSummary ? `[이전 검색 요약]\n${contextSummary}\n` : ""}
[그래프 스키마]
${FESTA_GRAPH_SCHEMA_PROMPT}

[개체 사전 (DB 실측)]
${catalog.entityDictionary}

[사용자 질문]
${message}`;

    // 1차 생성은 low, 오류 수정 재시도만 medium
    const cypherOpts = { reasoningEffort: "low" as const };
    const retryOpts = { reasoningEffort: "medium" as const };
    const llmCalls: LlmResult[] = [];

    const cypherRes = await generateText(cypherPrompt, cypherOpts);
    llmCalls.push(cypherRes);

    let generatedCypher = cleanCypherString(cypherRes.text || "");
    let records: Record<string, unknown>[] = [];
    let fallbackUsed = false;

    // 3. 생성된 Cypher 실행 (오류 시 1회 자가 수정 재시도)
    try {
      records = await runReadQuery(generatedCypher);
    } catch (queryErr) {
      const errMsg = queryErr instanceof Error ? queryErr.message : String(queryErr);
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
        console.warn("[chat] 재생성 Cypher도 실패:", retryErr instanceof Error ? retryErr.message : retryErr);
        records = [];
      }
    }

    // 4. 결과가 0건이면, 질문에 언급된 개체의 1-hop 이웃 관계만 보조 조회
    let supplementaryNote = "";
    if (records.length === 0) {
      const questionIds = idsMentionedInText(message, generatedCypher, catalog).slice(0, MAX_FOCUS_IDS);
      if (questionIds.length > 0) {
        fallbackUsed = true;
        records = await runReadQuery(
          `MATCH (a)-[r]-(b)
           WHERE a.id IN $ids
           RETURN DISTINCT labels(a)[0] AS 기준분류, coalesce(a.display_name, a.name) AS 기준노드,
                  CASE WHEN startNode(r) = a THEN '->' ELSE '<-' END AS 방향,
                  type(r) AS 관계, labels(b)[0] AS 연결분류, coalesce(b.display_name, b.name) AS 연결노드
           ORDER BY 기준노드, 관계, 연결노드
           LIMIT 60`,
          { ids: questionIds }
        );
        const names = questionIds.map((id) => catalog.nodeById.get(id)?.name ?? id);
        supplementaryNote = `\n※ 생성된 쿼리의 결과가 0건이어서, 질문에 언급된 개체(${names.join(", ")})의 주변 관계를 보조로 조회한 데이터입니다. 질문에 직접 답할 근거가 부족하면 그 사실을 솔직하게 밝히세요.`;
      }
    }

    // 5. 질문·결과에 등장한 노드로 시각화 서브그래프와 근거 경로 추출
    const focusIds = collectFocusIds(records, message, generatedCypher, catalog);
    const subgraph = await fetchSubgraph(
      focusIds.length > 0 ? focusIds : ["artist-042", "genre-001"] // 기본: 잔나비-밴드
    );

    // 6. 근거 기반 한국어 답변 생성
    const answerPrompt = `당신은 '2026 전국 주요 대학 축제 및 출연 아티스트' 지식그래프(Neo4j AuraDB) 기반 GraphRAG 챗봇 '페스타그래프'입니다.
반드시 아래 [조회된 그래프 데이터]와 [실제 그래프 경로]에 근거하여 사용자의 질문에 한국어로 명확하고 간결하며 친절하게 답변하세요.

[답변 작성 지침]
1. **철저한 근거 기반**: 조회된 데이터에 있는 노드·속성·관계만 사용하세요. 데이터에 없는 라인업, 날짜, 아티스트 정보를 추측하거나 지어내지 마세요.
2. **핵심 키워드 강조**: 대학·축제·아티스트·장르 이름은 마크다운 굵은 글씨(\`**이름**\`)로 강조하세요.
3. **간결한 서술**: 2~5문장으로 답하세요. 목록이 길면 대표 항목 5~8개만 언급하고 "외 N팀"처럼 요약하세요. 개수·순위 질문에는 숫자를 꼭 밝히세요.
4. **이름 표기**: 'LE SSERAFIM (르세라핌)'처럼 영문(한글) 표기는 한글 이름을 우선 쓰되 처음 한 번 원래 표기를 병기해도 됩니다. 같은 대학의 캠퍼스가 다르면 (서울)/(경기)처럼 구분하세요.
5. **근거 부족 시**: 조회 데이터가 0건이거나 질문과 무관하면 "지식 그래프에서 해당 정보를 찾지 못했습니다"라고 답하고, 대신 물어볼 수 있는 관련 질문을 1개 제안하세요.
6. 장르·성별 정보가 없는 아티스트가 일부 있으므로, 장르/성별 기준 집계에는 이들이 빠졌을 수 있다고 필요할 때 한 줄로 덧붙이세요.
7. 서울대 봄 축제(LUMINES) 출연진처럼 검수상태가 '확인필요'인 데이터가 답변에 쓰이면 "공개 보도 기반, 팀 검수 전"이라고 한 줄로 밝히세요.

[사용자 질문]
${message}

[실행된 Cypher 쿼리]
${generatedCypher}

[실제 그래프 경로]
${subgraph.evidencePaths.join(", ") || "(없음)"}
${subgraph.unverifiedPaths.length > 0 ? `\n[검수상태 '확인필요' 관계 — 공개 보도 기반, 팀 검수 전이므로 답변에 한 줄로 밝힐 것]\n${subgraph.unverifiedPaths.join(", ")}\n` : ""}
[조회된 그래프 데이터 (${records.length}건)]${supplementaryNote}
${records.length > 0 ? JSON.stringify(records.slice(0, 40)) : "(0건)"}`;

    // 근거 데이터가 이미 주어진 요약 작업이므로 추론 강도 low
    const answerRes = await generateText(answerPrompt, { reasoningEffort: "low" });
    llmCalls.push(answerRes);

    const exaoneErrors = llmCalls.map((c) => c.exaoneError).filter((e): e is string => Boolean(e));

    // 검수 전 데이터가 근거에 포함되면, LLM이 빠뜨려도 답변 끝에 반드시 안내
    let answer = answerRes.text || "답변을 생성하지 못했습니다.";
    if (subgraph.unverifiedPaths.length > 0 && !/확인필요|검수/.test(answer)) {
      answer += `\n\n※ 근거 중 ${subgraph.unverifiedPaths.length}건(예: ${subgraph.unverifiedPaths[0]})은 공개 보도를 기반으로 보완한 '확인필요' 데이터로, 팀 검수 전입니다.`;
    }

    return NextResponse.json({
      answer,
      unverifiedPaths: subgraph.unverifiedPaths,
      modelUsed: answerRes.modelUsed,
      provider: answerRes.provider,
      cypherModelUsed: cypherRes.modelUsed,
      llmFallbackUsed: llmCalls.some((c) => c.provider === "gemini"),
      ...(exaoneErrors.length > 0 ? { exaoneErrors } : {}),
      cypher: generatedCypher,
      records,
      recordCount: records.length,
      fallbackUsed,
      graph: { nodes: subgraph.nodes, edges: subgraph.edges },
      evidencePaths: subgraph.evidencePaths,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "요청 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
