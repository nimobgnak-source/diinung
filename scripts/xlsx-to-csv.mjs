// Exports the cleaned sheets of the team's festival workbook to data/festival/*.csv
// (no npm dependency: .xlsx is a zip, read here with Node's built-in zlib)
//   node scripts/xlsx-to-csv.mjs ["edge_all_수정본.xlsx"]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Minimal zip reader: returns { "path/in/zip": Buffer } using the central directory. */
function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip/xlsx file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(dataStart, dataStart + size);
    files[name] = method === 8 ? inflateRawSync(data) : Buffer.from(data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const xlsx = path.resolve(root, process.argv[2] ?? "edge_all_수정본.xlsx");
const outDir = path.join(root, "data", "festival");
// Sheets used for loading. 'edge_all_원본' is the untouched original and must NOT be loaded.
const SHEETS = ["지역", "대학", "축제", "아티스트", "장르", "아티스트_별칭", "edge_all"];

const zip = unzip(readFileSync(xlsx));
{
  const dec = (s) =>
    s
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
  const textOf = (x) => dec([...x.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));
  const read = (p) => {
    const f = zip[p.replace(/\\/g, "/")];
    if (!f) throw new Error(`missing ${p} in workbook`);
    // Some tools save with namespace-prefixed tags (<x:sheet>, <x:row>); strip tag prefixes
    // so the parsing below works for both styles (attribute prefixes like r:id are kept).
    return f.toString("utf8").replace(/<(\/?)[A-Za-z][\w.-]*:(?=[A-Za-z])/g, "<$1");
  };

  let shared = [];
  try {
    shared = [...read("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  } catch { /* workbook without shared strings */ }

  const wb = read("xl/workbook.xml");
  const rels = read("xl/_rels/workbook.xml.rels");
  const colIdx = (ref) => [...ref.match(/^[A-Z]+/)[0]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const quote = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

  mkdirSync(outDir, { recursive: true });
  for (const m of wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const name = dec(m[1]);
    if (!SHEETS.includes(name)) continue;
    const rel = [...rels.matchAll(/<Relationship [^>]*>/g)].map((x) => x[0]).find((x) => x.includes(`Id="${m[2]}"`));
    const target = rel.match(/Target="([^"]+)"/)[1].replace(/^\/?xl\//, "");
    const xml = read(`xl/${target}`);

    const rows = [];
    for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1], body = c[2] ?? "";
        const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
        const t = attrs.match(/t="([^"]+)"/)?.[1];
        let v;
        if (t === "s") v = shared[+body.match(/<v>(\d+)<\/v>/)?.[1]] ?? "";
        else if (t === "inlineStr") v = textOf(body);
        else v = dec(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
        row[ref ? colIdx(ref) : row.length] = v;
      }
      const filled = Array.from(row, (x) => x ?? "");
      if (filled.some((v) => v.trim() !== "")) rows.push(filled);
    }
    const width = Math.max(...rows.map((r) => r.length));
    const csv = rows.map((r) => Array.from({ length: width }, (_, i) => quote(r[i] ?? "")).join(",")).join("\n");
    writeFileSync(path.join(outDir, `${name}.csv`), "﻿" + csv + "\n");
    console.log(`${name}.csv  ${rows.length - 1} rows`);
  }
}
