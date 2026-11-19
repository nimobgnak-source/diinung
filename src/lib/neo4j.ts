import neo4j, { Driver } from "neo4j-driver";

let driver: Driver | null = null;

export function getNeo4jDriver(): Driver {
  if (!driver) {
    const uri = process.env.NEO4J_URI || "bolt://localhost:7687";
    const user = process.env.NEO4J_USERNAME || "neo4j";
    const password = process.env.NEO4J_PASSWORD || "";

    driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }
  return driver;
}

/**
 * Neo4j 특수 객체(Integer, Node, Relationship, Path 등)를
 * JSON 직렬화 및 LLM 프롬프트 해석에 적합한 순수 객체로 변환합니다.
 */
export function normalizeNeo4jValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (neo4j.isInt(value)) {
    return value.toNumber();
  }

  // 날짜/시간 타입은 '2026-05-20' 같은 문자열로 변환
  if (
    neo4j.isDate(value) ||
    neo4j.isDateTime(value) ||
    neo4j.isLocalDateTime(value) ||
    neo4j.isTime(value) ||
    neo4j.isLocalTime(value) ||
    neo4j.isDuration(value)
  ) {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(normalizeNeo4jValue);
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;

    // Path 객체 처리 (segments 배열 보유)
    if (Array.isArray(obj.segments) && obj.start && obj.end) {
      const segments = obj.segments as Array<{
        start: { labels?: string[]; properties?: Record<string, unknown> };
        relationship: { type?: string; properties?: Record<string, unknown> };
        end: { labels?: string[]; properties?: Record<string, unknown> };
      }>;

      const steps = segments.map((seg) => {
        const startProps = (normalizeNeo4jValue(seg.start?.properties) ||
          {}) as Record<string, unknown>;
        const endProps = (normalizeNeo4jValue(seg.end?.properties) ||
          {}) as Record<string, unknown>;
        return {
          from: startProps.name || startProps.id || seg.start?.labels?.[0],
          fromLabels: seg.start?.labels || [],
          relation: seg.relationship?.type || "",
          to: endProps.name || endProps.id || seg.end?.labels?.[0],
          toLabels: seg.end?.labels || [],
        };
      });

      const nodeChain =
        steps.length > 0
          ? [
              steps[0].from,
              ...steps.map((s) => `-[:${s.relation}]-> ${s.to}`),
            ].join(" ")
          : "";

      return {
        _type: "Path",
        length: segments.length,
        pathSummary: nodeChain,
        steps,
      };
    }

    // Node 객체 처리 (labels 및 properties 보유)
    if (Array.isArray(obj.labels) && obj.properties !== undefined) {
      return {
        _type: "Node",
        labels: obj.labels,
        properties: normalizeNeo4jValue(obj.properties),
      };
    }

    // Relationship 객체 처리 (type, start, end, properties 보유)
    if (
      typeof obj.type === "string" &&
      obj.properties !== undefined &&
      (obj.start !== undefined || obj.startNodeElementId !== undefined)
    ) {
      return {
        _type: "Relationship",
        type: obj.type,
        properties: normalizeNeo4jValue(obj.properties),
      };
    }

    const normalizedRecord: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      normalizedRecord[k] = normalizeNeo4jValue(v);
    }
    return normalizedRecord;
  }

  return value;
}

/**
 * 읽기 전용 Cypher 쿼리만 안전하게 실행하는 헬퍼 함수
 */
export async function runReadQuery<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  const cleanedCypher = cypher.trim().replace(/;+\s*$/, "");
  const upper = cleanedCypher.toUpperCase();
  const forbiddenKeywords = [
    "DELETE",
    "DETACH",
    "DROP",
    "CREATE",
    "MERGE",
    "SET",
    "REMOVE",
  ];

  for (const keyword of forbiddenKeywords) {
    const regex = new RegExp(`\\b${keyword}\\b`, "i");
    if (regex.test(upper)) {
      throw new Error(
        `보안 정책상 데이터 변경 쿼리(${keyword})는 실행할 수 없습니다. 읽기 전용(MATCH, RETURN) 쿼리만 허용됩니다.`
      );
    }
  }

  const drv = getNeo4jDriver();
  const database = process.env.NEO4J_DATABASE || "neo4j";
  const session = drv.session({
    database,
    defaultAccessMode: neo4j.session.READ,
  });

  try {
    const result = await session.run(cleanedCypher, params);
    return result.records.map(
      (record) => normalizeNeo4jValue(record.toObject()) as T
    );
  } finally {
    await session.close();
  }
}
