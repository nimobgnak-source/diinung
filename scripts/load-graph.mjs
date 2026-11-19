// Loads data/festival/*.csv (exported from the team workbook edge_all_수정본.xlsx by scripts/xlsx-to-csv.mjs)
// into the Neo4j database configured in .env.local.
//   node scripts/load-graph.mjs           # add/update (MERGE by id, safe to re-run)
//   node scripts/load-graph.mjs --reset   # DELETE ALL existing nodes/constraints first
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data", "festival");
const require = createRequire(path.join(root, "package.json"));
const neo4j = require("neo4j-driver");
const RESET = process.argv.includes("--reset");

// sheet -> Neo4j label (the team's Korean class names are kept as labels)
const NODE_SHEETS = { 지역: "지역", 대학: "대학", 축제: "축제", 아티스트: "아티스트", 장르: "장르" };
const CONSTRAINT_NAMES = { 지역: "region_id", 대학: "college_id", 축제: "festival_id", 아티스트: "artist_id", 장르: "genre_id" };
const IDENT = /^[\p{L}_][\p{L}\p{N}_]*$/u;

function loadEnv() {
  const env = {};
  for (const line of readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

/** RFC 4180 CSV parser (quoted fields with commas/quotes/newlines). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((v) => v !== "")) rows.push(row); }
  const [header, ...data] = rows;
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}
const readCsv = (sheet) => parseCsv(readFileSync(path.join(dataDir, `${sheet}.csv`), "utf8"));

/** Excel serial date (e.g. 46154) or ISO text -> 'YYYY-MM-DD' */
function toIsoDate(v) {
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const m = v.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
}
const toInt = (v) => (v && /^\d+$/.test(v) ? neo4j.int(v) : null);

// ---------- build node rows ----------
const aliasRows = readCsv("아티스트_별칭");
const aliasesById = {};
for (const a of aliasRows) {
  const original = a["원본 표기"], unified = a["통일 표기(노드명)"], id = a["artist_id"];
  if (id && original && original !== unified) (aliasesById[id] ??= new Set()).add(original);
}

const colleges = readCsv("대학");
const nameCount = {};
for (const c of colleges) nameCount[c.name] = (nameCount[c.name] ?? 0) + 1;

const nodeRows = {
  지역: readCsv("지역").map((r) => ({ id: r.id, name: r.name, region: r.region })),
  대학: colleges.map((r) => ({
    id: r.id,
    name: r.name,
    // 같은 대학의 다른 캠퍼스(예: 성균관대학교 서울/경기)를 구분하는 표시명
    display_name: nameCount[r.name] > 1 ? `${r.name} (${r.location})` : r.name,
    type: r.type || null,
    location: r.location || null,
    founded_year: toInt(r.founded_year),
    student_count: toInt(r.student_count),
  })),
  축제: readCsv("축제").map((r) => {
    const start = toIsoDate(r.start_date), end = toIsoDate(r.end_date);
    const month = start ? +start.slice(5, 7) : null;
    return {
      id: r.id,
      name: r.name,
      venue: r.location || null,
      start_date: start,
      end_date: end,
      season: month === null ? null : month <= 6 ? "봄" : "가을",
    };
  }),
  아티스트: readCsv("아티스트").map((r) => ({
    id: r.id,
    name: r.name,
    gender: r.gender || null,
    aliases: [...(aliasesById[r.id] ?? [])],
  })),
  장르: readCsv("장르").map((r) => ({ id: r.id, name: r.name })),
};

const edges = readCsv("edge_all").filter((e) => e.source_id && e.target_id && e.relationship);

// ---------- load ----------
const env = loadEnv();
const driver = neo4j.driver(env.NEO4J_URI, neo4j.auth.basic(env.NEO4J_USERNAME, env.NEO4J_PASSWORD));
const session = driver.session({ database: env.NEO4J_DATABASE, defaultAccessMode: neo4j.session.WRITE });

try {
  if (RESET) {
    const before = await session.run("MATCH (n) RETURN count(n) AS n");
    await session.run("MATCH (n) CALL (n) { DETACH DELETE n } IN TRANSACTIONS OF 500 ROWS");
    const constraints = await session.run("SHOW CONSTRAINTS YIELD name RETURN name");
    for (const r of constraints.records) await session.run(`DROP CONSTRAINT \`${r.get("name")}\` IF EXISTS`);
    console.log(`reset: deleted ${before.records[0].get("n").toNumber()} nodes and ${constraints.records.length} constraints`);
  }

  for (const [sheet, label] of Object.entries(NODE_SHEETS)) {
    if (!IDENT.test(label)) throw new Error(`bad label ${label}`);
    await session.run(`CREATE CONSTRAINT ${CONSTRAINT_NAMES[sheet]} IF NOT EXISTS FOR (n:${label}) REQUIRE n.id IS UNIQUE`);
    const rows = nodeRows[sheet];
    await session.run(
      `UNWIND $rows AS row
       MERGE (n:${label} {id: row.id})
       SET n += row {.*, start_date: null, end_date: null},
           n.start_date = CASE WHEN row.start_date IS NULL THEN null ELSE date(row.start_date) END,
           n.end_date = CASE WHEN row.end_date IS NULL THEN null ELSE date(row.end_date) END`,
      { rows }
    );
    console.log(`nodes  ${label.padEnd(6)} ${rows.length}`);
  }

  // group edges by (source label, rel type, target label) so the Cypher can use static labels
  const groups = {};
  for (const e of edges) {
    const sl = NODE_SHEETS[e.source_class], tl = NODE_SHEETS[e.target_class], rel = e.relationship;
    if (![sl, tl, rel].every((x) => x && IDENT.test(x))) throw new Error(`bad edge row ${JSON.stringify(e)}`);
    (groups[`${sl}|${rel}|${tl}`] ??= []).push({
      s: e.source_id,
      t: e.target_id,
      role: e.role || null,
      // 검수상태: '정상' / '확인필요' (팀 검수 전 공개자료 기반 보완 데이터)
      review_status: e["검수상태"] || null,
    });
  }

  let matched = 0;
  const missing = [];
  for (const [key, items] of Object.entries(groups)) {
    const [sl, rel, tl] = key.split("|");
    const res = await session.run(
      `UNWIND $items AS it
       OPTIONAL MATCH (a:${sl} {id: it.s})
       OPTIONAL MATCH (b:${tl} {id: it.t})
       FOREACH (_ IN CASE WHEN a IS NOT NULL AND b IS NOT NULL THEN [1] ELSE [] END |
         MERGE (a)-[r:${rel}]->(b)
         SET r.role = it.role, r.review_status = it.review_status)
       RETURN it.s AS s, it.t AS t, a IS NOT NULL AND b IS NOT NULL AS ok`,
      { items }
    );
    for (const r of res.records) {
      if (r.get("ok")) matched++;
      else missing.push(`${r.get("s")} -[${rel}]-> ${r.get("t")}`);
    }
    console.log(`edges  ${key.replace(/\|/g, " ")}  ${items.length}`);
  }
  console.log(`edges  matched ${matched} / ${edges.length} rows`);
  if (missing.length) console.log("unmatched:", missing);

  const check = await session.run(
    "MATCH (n) WITH count(n) AS nodes OPTIONAL MATCH ()-[r]->() RETURN nodes, count(r) AS rels"
  );
  const rec = check.records[0];
  const expectedNodes = Object.values(nodeRows).reduce((s, r) => s + r.length, 0);
  console.log(`db now: ${rec.get("nodes").toNumber()} nodes (expected ${expectedNodes}), ${rec.get("rels").toNumber()} relationships`);
} finally {
  await session.close();
  await driver.close();
}
