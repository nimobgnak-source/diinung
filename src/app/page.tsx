"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  NODE_LEGEND,
  HERO_RECOMMENDED_QUESTIONS,
  INITIAL_CYPHER_PREVIEW,
  INITIAL_PREVIEW_GRAPH,
  GraphNode,
  GraphEdge,
  NodeCategory,
} from "@/lib/schema";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  evidencePaths?: string[];
  cypher?: string;
}

interface PositionedNode extends GraphNode {
  x: number;
  y: number;
  labelPos: "top" | "bottom";
}

function getCategoryStyle(label: NodeCategory) {
  return (
    NODE_LEGEND.find((item) => item.label === label) || {
      label: "Character" as NodeCategory,
      display: label,
      upperTag: String(label).toUpperCase(),
      color: "#C83E82",
      bgLight: "#FCEEF5",
    }
  );
}

/**
 * 마크다운 **강조** 텍스트를 깔끔한 볼드 태그로 렌더링
 */
function renderFormattedText(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={idx} className="font-bold text-[#231B1A]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

/**
 * Cypher 쿼리 문법 컬러 하이라이팅
 */
function renderHighlightedCypher(cypher: string) {
  const lines = cypher.split("\n");
  return lines.map((line, lineIdx) => {
    const tokens = line.split(
      /(\b(?:MATCH|OPTIONAL MATCH|WHERE|RETURN|WITH|ORDER BY|DESC|ASC|DISTINCT|UNWIND|AS|AND|OR|IN|LIMIT)\b|"[^"]*"|'[^']*'|:[A-Za-z_]+(?:\|[A-Za-z_]+)*)/g
    );
    return (
      <div key={lineIdx} className="leading-relaxed">
        {tokens.map((tok, tokIdx) => {
          if (!tok) return null;
          const upper = tok.toUpperCase();
          if (
            [
              "MATCH",
              "OPTIONAL MATCH",
              "WHERE",
              "RETURN",
              "WITH",
              "ORDER BY",
              "DESC",
              "ASC",
              "DISTINCT",
              "UNWIND",
              "AS",
              "AND",
              "OR",
              "IN",
              "LIMIT",
            ].includes(upper)
          ) {
            return (
              <span key={tokIdx} className="text-[#F07167] font-semibold">
                {tok}
              </span>
            );
          }
          if (tok.startsWith('"') || tok.startsWith("'")) {
            return (
              <span key={tokIdx} className="text-[#A8E6CF]">
                {tok}
              </span>
            );
          }
          if (tok.startsWith(":")) {
            return (
              <span key={tokIdx} className="text-[#F7C873]">
                {tok}
              </span>
            );
          }
          return (
            <span key={tokIdx} className="text-[#F3EDE2]">
              {tok}
            </span>
          );
        })}
      </div>
    );
  });
}

export default function HomePage() {
  // 상단 DATA SCOPE 카운트 상태
  const [scopeCounts, setScopeCounts] = useState<Record<string, number>>({
    Character: 15,
    Event: 13,
    Place: 9,
    Object: 10,
    Ability: 4,
    CulturalElement: 8,
  });

  // 메인 Hero 검색 상태
  const [searchQuery, setSearchQuery] = useState(
    "세이렌과 대립한 캐릭터들은 누구이고, 어떤 장소에서 마주쳤어?"
  );
  const [currentCypher, setCurrentCypher] = useState(INITIAL_CYPHER_PREVIEW);
  const [graphTitle, setGraphTitle] = useState(INITIAL_PREVIEW_GRAPH.title);
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>(
    INITIAL_PREVIEW_GRAPH.nodes
  );
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>(
    INITIAL_PREVIEW_GRAPH.edges
  );
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [viewMode, setViewMode] = useState<"graph" | "table" | "json">("graph");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(
    INITIAL_PREVIEW_GRAPH.nodes[0]
  );
  const [isSearching, setIsSearching] = useState(false);

  // 하단 그래프 기반 AI 챗봇 상태
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "init-user",
      role: "user",
      content: "치이카와는 세이렌을 토벌하기 위해 무엇을 사용했어?",
    },
    {
      id: "init-assistant",
      role: "assistant",
      content:
        "치이카와는 **토벌봉**을 사용해 세이렌 토벌에 나섰으며, 이 사건은 **랏코**가 납치된 사건이 원인이 되어 벌어진 **동료 구출** 사건으로 이어졌습니다.",
      evidencePaths: [
        "치이카와 -[USES]-> 토벌봉",
        "랏코 납치 -[CAUSES]-> 동료 구출",
      ],
    },
  ]);

  // 초기 마운트 시 AuraDB 실시간 노드 수 동기화
  useEffect(() => {
    fetch("/api/chat")
      .then((res) => res.json())
      .then((data) => {
        if (data?.scope) {
          setScopeCounts((prev) => ({ ...prev, ...data.scope }));
        }
      })
      .catch(() => {
        // 기본값 유지
      });
  }, []);

  // 그래프 노드 좌표 계산 (초기 미리보기는 시안과 100% 동일한 레이아웃 적용)
  const positionedNodes: PositionedNode[] = useMemo(() => {
    const presetCoords: Record<
      string,
      { x: number; y: number; labelPos: "top" | "bottom" }
    > = {
      세이렌: { x: 245, y: 115, labelPos: "top" },
      랏코: { x: 425, y: 115, labelPos: "top" },
      랏코납치: { x: 605, y: 115, labelPos: "top" },
      동료구출: { x: 605, y: 245, labelPos: "top" },
      "세이렌의 거처": { x: 780, y: 230, labelPos: "top" },
      치이카와: { x: 245, y: 315, labelPos: "bottom" },
      토벌봉: { x: 425, y: 315, labelPos: "bottom" },
    };

    const isDefaultPreview =
      graphNodes.length === INITIAL_PREVIEW_GRAPH.nodes.length &&
      graphNodes.every((n) => presetCoords[n.name]);

    if (isDefaultPreview) {
      return graphNodes.map((n) => ({
        ...n,
        ...presetCoords[n.name],
      }));
    }

    // 동적 서브그래프 레이아웃 (최대 12개 노드를 격자/타원형으로 깔끔하게 배치)
    const count = graphNodes.length;
    if (count === 0) return [];

    if (count <= 6) {
      const cols = Math.min(count, 3);
      return graphNodes.map((n, idx) => {
        const row = Math.floor(idx / cols);
        const col = idx % cols;
        const xSpacing = 240;
        const startX = 500 - ((cols - 1) * xSpacing) / 2;
        return {
          ...n,
          x: startX + col * xSpacing,
          y: row === 0 ? 130 : 295,
          labelPos: row === 0 ? "top" : "bottom",
        };
      });
    }

    const cx = 500;
    const cy = 215;
    const rx = 310;
    const ry = 130;
    return graphNodes.map((n, idx) => {
      const angle = (2 * Math.PI * idx) / count - Math.PI / 2;
      const x = Math.round(cx + rx * Math.cos(angle));
      const y = Math.round(cy + ry * Math.sin(angle));
      return {
        ...n,
        x,
        y,
        labelPos: y < cy ? "top" : "bottom",
      };
    });
  }, [graphNodes]);

  const nodeByName = useMemo(() => {
    const map = new Map<string, PositionedNode>();
    for (const n of positionedNodes) {
      map.set(n.name, n);
    }
    return map;
  }, [positionedNodes]);

  // 상단 자연어 검색 실행 함수
  const executeGraphSearch = async (queryText: string) => {
    const trimmed = queryText.trim();
    if (!trimmed || isSearching) return;

    setSearchQuery(trimmed);
    setIsSearching(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      const data = await res.json();

      if (!res.ok) {
        setChatMessages((prev) => [
          ...prev,
          { id: `${Date.now()}-u`, role: "user", content: trimmed },
          {
            id: `${Date.now()}-a`,
            role: "assistant",
            content: `⚠️ 오류 안내: ${data.error || "요청에 실패했습니다."}`,
          },
        ]);
        return;
      }

      if (data.cypher) {
        setCurrentCypher(data.cypher);
      }
      if (Array.isArray(data.records)) {
        setRecords(data.records);
      }
      if (data.graph?.nodes?.length > 0) {
        setGraphNodes(data.graph.nodes);
        setGraphEdges(data.graph.edges || []);
        setSelectedNode(data.graph.nodes[0]);
      }
      setGraphTitle(`"${trimmed}" 조회 그래프`);

      // 하단 AI 챗봇에도 검색 결과 연동 추가
      setChatMessages((prev) => [
        ...prev,
        { id: `${Date.now()}-u`, role: "user", content: trimmed },
        {
          id: `${Date.now()}-a`,
          role: "assistant",
          content: data.answer,
          evidencePaths: data.evidencePaths,
          cypher: data.cypher,
        },
      ]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { id: `${Date.now()}-u`, role: "user", content: trimmed },
        {
          id: `${Date.now()}-a`,
          role: "assistant",
          content: "⚠️ 서버와 통신하는 중 오류가 발생했습니다.",
        },
      ]);
    } finally {
      setIsSearching(false);
    }
  };

  // 하단 AI 챗봇 질문 전송 함수
  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = chatInput.trim();
    if (!trimmed || isChatLoading) return;

    setChatInput("");
    setIsChatLoading(true);
    setChatMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-u`, role: "user", content: trimmed },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          contextCypher: currentCypher,
          contextSummary: graphTitle,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setChatMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-err`,
            role: "assistant",
            content: `⚠️ 오류 안내: ${data.error || "요청에 실패했습니다."}`,
          },
        ]);
      } else {
        if (data.cypher) {
          setCurrentCypher(data.cypher);
        }
        if (Array.isArray(data.records)) {
          setRecords(data.records);
        }
        if (data.graph?.nodes?.length > 0) {
          setGraphNodes(data.graph.nodes);
          setGraphEdges(data.graph.edges || []);
          setSelectedNode(data.graph.nodes[0]);
          setGraphTitle(`"${trimmed}" 조회 그래프`);
        }

        setChatMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-a`,
            role: "assistant",
            content: data.answer,
            evidencePaths: data.evidencePaths,
            cypher: data.cypher,
          },
        ]);
      }
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-err`,
          role: "assistant",
          content: "⚠️ 서버와 통신하는 중 오류가 발생했습니다.",
        },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF7F0] text-[#231B1A] relative overflow-x-hidden">
      {/* 은은한 파스텔 배경 블러 장식 */}
      <div className="pointer-events-none fixed -top-24 -right-24 w-96 h-96 rounded-full bg-[#F9DCE8]/45 blur-3xl" />
      <div className="pointer-events-none fixed -bottom-32 -left-24 w-96 h-96 rounded-full bg-[#F5E4C8]/40 blur-3xl" />

      {/* 1. 상단 네비게이션 헤더 */}
      <header className="border-b border-[#EDE6DA] bg-[#FAF7F0]/90 backdrop-blur-xs">
        <div className="max-w-5xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-baseline gap-3">
            <span className="text-lg font-extrabold tracking-tight text-[#E04F80]">
              먼작귀그래프
            </span>
            <span className="text-xs text-[#8C827A] font-medium">
              극장판 &lt;치이카와: 인어섬의 비밀&gt; 지식그래프
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-7 space-y-8 relative z-10">
        {/* DATA SCOPE 배지 바 */}
        <section className="rounded-xl border border-[#EFEAE1] bg-white px-5 py-3 shadow-2xs flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <span className="font-extrabold text-[#E04F80] tracking-wider">
            DATA SCOPE
          </span>
          <span className="text-[#8C827A]">
            기준 시점{" "}
            <strong className="text-[#231B1A] font-semibold">
              전단지 수령~귀환
            </strong>
          </span>
          <span className="text-[#E6DFD5]">|</span>
          <span className="text-[#8C827A]">
            캐릭터{" "}
            <strong className="text-[#231B1A] font-semibold">
              {scopeCounts.Character ?? 15}
            </strong>
          </span>
          <span className="text-[#8C827A]">
            사건{" "}
            <strong className="text-[#231B1A] font-semibold">
              {scopeCounts.Event ?? 13}
            </strong>
          </span>
          <span className="text-[#8C827A]">
            장소{" "}
            <strong className="text-[#231B1A] font-semibold">
              {scopeCounts.Place ?? 9}
            </strong>
          </span>
          <span className="text-[#8C827A]">
            사물{" "}
            <strong className="text-[#231B1A] font-semibold">
              {scopeCounts.Object ?? 10}
            </strong>
          </span>
          <span className="text-[#8C827A]">
            능력{" "}
            <strong className="text-[#231B1A] font-semibold">
              {scopeCounts.Ability ?? 4}
            </strong>
          </span>
          <span className="text-[#8C827A]">
            문화요소{" "}
            <strong className="text-[#231B1A] font-semibold">
              {scopeCounts.CulturalElement ?? 8}
            </strong>
          </span>
        </section>

        {/* 2. 메인 Hero 검색창 & Text-to-Cypher 실시간 변환 영역 */}
        <section className="space-y-5 pt-2">
          <div className="space-y-2.5">
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-[#231B1A]">
              인어섬 이야기를,{" "}
              <span className="text-[#E04F80]">관계로</span> 다시 보기
            </h1>
            <p className="text-sm text-[#7A7067] leading-relaxed max-w-xl">
              캐릭터·사건·장소·사물·문화요소가 그물망처럼 엮인 치이카와의 세계를 자연어로 묻고 그래프로 답을 얻습니다. 질문 하나가 Cypher 쿼리로 바뀌어 인어섬의 서사를 가르쳐줍니다.
            </p>
          </div>

          {/* 자연어 검색 입력창 + [그래프로 검색] 버튼 */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              executeGraphSearch(searchQuery);
            }}
            className="flex flex-col sm:flex-row gap-2.5"
          >
            <div className="flex-1 flex items-center gap-3 rounded-xl border border-[#E6DFD5] bg-white px-4 py-3.5 shadow-2xs focus-within:border-[#E04F80] focus-within:ring-2 focus-within:ring-[#E04F80]/15 transition">
              <svg
                className="w-4 h-4 text-[#B0A69D] shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <circle cx="11" cy="11" r="8" />
                <path strokeLinecap="round" d="m21 21-4.3-4.3" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="세이렌과 대립한 캐릭터들은 누구이고, 어떤 장소에서 마주쳤어?"
                className="w-full bg-transparent text-sm text-[#231B1A] placeholder-[#A69C93] focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={isSearching}
              className="rounded-xl bg-gradient-to-r from-[#E65586] to-[#DE8B3B] hover:opacity-95 px-6 py-3.5 text-sm font-bold text-white shadow-xs transition disabled:opacity-60 shrink-0 cursor-pointer"
            >
              {isSearching ? "변환 및 조회 중..." : "그래프로 검색"}
            </button>
          </form>

          {/* 자연어 -> CYPHER 자동 변환 코드 박스 */}
          <div className="space-y-2">
            <div className="text-[11px] font-bold text-[#B07D2B] tracking-wide">
              자연어 → CYPHER 자동 변환
            </div>
            <div className="rounded-xl bg-[#231B1A] px-5 py-4 font-mono text-xs sm:text-[13px] overflow-x-auto shadow-xs">
              {renderHighlightedCypher(currentCypher)}
            </div>
          </div>

          {/* 데이터 구성 · 노드 범례 */}
          <div className="space-y-2 pt-1">
            <div className="text-[11px] font-bold text-[#B07D2B]">
              데이터 구성 · 노드 범례
            </div>
            <div className="flex flex-wrap gap-2">
              {NODE_LEGEND.map((item) => (
                <span
                  key={item.label}
                  className="inline-flex items-center gap-2 rounded-full border border-[#EAE3D5] bg-white px-3.5 py-1.5 text-xs font-medium text-[#3D332E] shadow-2xs"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  {item.display}
                </span>
              ))}
            </div>
          </div>

          {/* 클릭 한 번으로 바로 질문해보세요 (추천 질문 칩) */}
          <div className="space-y-2 pt-1">
            <div className="text-[11px] font-bold text-[#B07D2B]">
              클릭 한 번으로 바로 질문해보세요
            </div>
            <div className="flex flex-wrap gap-2">
              {HERO_RECOMMENDED_QUESTIONS.map((q, idx) => (
                <button
                  key={idx}
                  type="button"
                  disabled={isSearching}
                  onClick={() => executeGraphSearch(q)}
                  className="rounded-full border border-[#EAE3D5] bg-white hover:border-[#E04F80] hover:bg-[#FFF9FB] px-4 py-2 text-xs text-[#4A3F39] transition shadow-2xs disabled:opacity-50 cursor-pointer text-left"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* 3. 검색 결과 그래프 & 조회 데이터 뷰어 */}
        <section className="rounded-2xl border border-[#EFEAE1] bg-white p-6 shadow-2xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-extrabold text-[#231B1A]">
              검색 결과 그래프
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-[#9A8F85]">{graphTitle}</span>
              <div className="inline-flex rounded-lg border border-[#EAE3D5] bg-[#FAF7F0] p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setViewMode("graph")}
                  className={`px-2.5 py-1 rounded-md font-medium transition cursor-pointer ${
                    viewMode === "graph"
                      ? "bg-white text-[#E04F80] shadow-2xs"
                      : "text-[#7A7067]"
                  }`}
                >
                  그래프 뷰
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("table")}
                  className={`px-2.5 py-1 rounded-md font-medium transition cursor-pointer ${
                    viewMode === "table"
                      ? "bg-white text-[#E04F80] shadow-2xs"
                      : "text-[#7A7067]"
                  }`}
                >
                  결과 표 ({records.length})
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("json")}
                  className={`px-2.5 py-1 rounded-md font-medium transition cursor-pointer ${
                    viewMode === "json"
                      ? "bg-white text-[#E04F80] shadow-2xs"
                      : "text-[#7A7067]"
                  }`}
                >
                  JSON
                </button>
              </div>
            </div>
          </div>

          {viewMode === "graph" && (
            <div className="w-full overflow-x-auto">
              <svg
                viewBox="0 0 1000 410"
                className="w-full h-auto min-w-[680px] select-none"
              >
                {/* 엣지(관계 선 및 중앙 다크 배지) 렌더링 */}
                {graphEdges.map((edge) => {
                  const s = nodeByName.get(edge.source);
                  const t = nodeByName.get(edge.target);
                  if (!s || !t) return null;

                  const mx = (s.x + t.x) / 2;
                  const my = (s.y + t.y) / 2;
                  const badgeWidth = Math.max(edge.relation.length * 6.5 + 18, 66);

                  return (
                    <g key={edge.id}>
                      <line
                        x1={s.x}
                        y1={s.y}
                        x2={t.x}
                        y2={t.y}
                        stroke="#BEB5AC"
                        strokeWidth={1.6}
                      />
                      <rect
                        x={mx - badgeWidth / 2}
                        y={my - 11}
                        width={badgeWidth}
                        height={22}
                        rx={5}
                        fill="#231B1A"
                      />
                      <text
                        x={mx}
                        y={my + 3.5}
                        textAnchor="middle"
                        fill="#FFFFFF"
                        fontSize="9.5"
                        fontWeight="700"
                        fontFamily="monospace"
                      >
                        {edge.relation}
                      </text>
                    </g>
                  );
                })}

                {/* 노드(원형 배지 및 상/하단 클래스 태그) 렌더링 */}
                {positionedNodes.map((node) => {
                  const style = getCategoryStyle(node.label);
                  const isSelected = selectedNode?.name === node.name;
                  const displayTitle = node.displayName || node.name;

                  return (
                    <g
                      key={node.id}
                      onClick={() => setSelectedNode(node)}
                      className="cursor-pointer group"
                    >
                      {/* 선택 시 포커스 링 */}
                      {isSelected && (
                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={42}
                          fill="none"
                          stroke={style.color}
                          strokeWidth={2}
                          strokeDasharray="4 3"
                           opacity={0.75}
                        />
                      )}

                      {/* 상단 또는 하단 영문 클래스 라벨 */}
                      <text
                        x={node.x}
                        y={node.labelPos === "top" ? node.y - 44 : node.y + 52}
                        textAnchor="middle"
                        fill="#9A8F85"
                        fontSize="9"
                        fontWeight="600"
                        letterSpacing="0.04em"
                      >
                        {style.upperTag}
                      </text>

                      {/* 원형 노드 */}
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={35}
                        fill={style.color}
                      />

                      {/* 노드 내부 한글 이름 */}
                      <text
                        x={node.x}
                        y={node.y + 4}
                        textAnchor="middle"
                        fill="#FFFFFF"
                        fontSize={displayTitle.length > 5 ? "10.5" : "12"}
                        fontWeight="700"
                      >
                        {displayTitle}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}

          {viewMode === "table" && (
            <div className="overflow-x-auto border border-[#EFEAE1] rounded-xl">
              {records.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#8C827A]">
                  상단 검색창이나 추천 질문 칩을 클릭하면 AuraDB 조회 결과 표가 표시됩니다.
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#FAF7F0] border-b border-[#EFEAE1] text-[#6E6359]">
                    <tr>
                      {Object.keys(records[0]).map((key) => (
                        <th key={key} className="px-4 py-2.5 font-bold">
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F3EFE6]">
                    {records.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-[#FDFBF7]">
                        {Object.values(row).map((val, cIdx) => (
                          <td key={cIdx} className="px-4 py-2.5 text-[#231B1A]">
                            {typeof val === "object"
                              ? JSON.stringify(val)
                              : String(val ?? "-")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {viewMode === "json" && (
            <pre className="max-h-72 overflow-auto rounded-xl bg-[#231B1A] p-4 text-[11px] text-[#F3EDE2] font-mono">
              {JSON.stringify(
                records.length > 0 ? records : { nodes: graphNodes, edges: graphEdges },
                null,
                2
              )}
            </pre>
          )}

          {/* 클릭된 노드 상세 속성 표시 바 */}
          {selectedNode && (
            <div className="rounded-xl bg-[#FAF7F0] border border-[#EAE3D5] px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-2.5">
                <span
                  className="px-2.5 py-0.5 rounded-full text-white font-bold text-[11px]"
                  style={{
                    backgroundColor: getCategoryStyle(selectedNode.label).color,
                  }}
                >
                  {selectedNode.label} · {selectedNode.id}
                </span>
                <strong className="text-sm font-extrabold text-[#231B1A]">
                  {selectedNode.displayName || selectedNode.name}
                </strong>
                {selectedNode.name_kor &&
                  selectedNode.name_kor !== selectedNode.name && (
                    <span className="text-[#7A7067]">
                      (별칭: {selectedNode.name_kor})
                    </span>
                  )}
                {selectedNode.type && (
                  <span className="text-[#5C524A] bg-white border border-[#E6DFD5] px-2.5 py-0.5 rounded-md">
                    특징/유형: {selectedNode.type}
                  </span>
                )}
                {selectedNode.personality &&
                  selectedNode.personality !== "없음" && (
                    <span className="text-[#5C524A] bg-white border border-[#E6DFD5] px-2.5 py-0.5 rounded-md">
                      성격: {selectedNode.personality}
                    </span>
                  )}
                {selectedNode.skills && selectedNode.skills !== "없음" && (
                  <span className="text-[#2563EB] bg-[#EBF2FE] px-2.5 py-0.5 rounded-md font-semibold">
                    능력(skills): {selectedNode.skills}
                  </span>
                )}
                {selectedNode.immortality !== undefined && (
                  <span className="text-[#7C2D12] bg-[#F9EBE7] px-2.5 py-0.5 rounded-md font-medium">
                    영생 여부: {selectedNode.immortality ? "영생(true)" : "해당 없음"}
                  </span>
                )}
              </div>
              <span className="text-[11px] text-[#9A8F85]">
                노드를 클릭하면 상세 속성을 볼 수 있습니다
              </span>
            </div>
          )}

          <p className="text-[11px] text-[#9A8F85]">
            * 실제 서비스에서는 Neo4j 기반 인터랙티브 그래프로 렌더링되며, 노드를 클릭하면 상세 속성과 연결 경로를 확인할 수 있습니다.
          </p>
        </section>

        {/* 4. 하단 그래프 기반 AI 챗봇 */}
        <section className="max-w-lg rounded-2xl border border-[#EFEAE1] bg-white p-5 shadow-2xs space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#E65586] to-[#DE8B3B] flex items-center justify-center text-white text-xs font-extrabold shadow-2xs">
              G
            </div>
            <h3 className="text-sm font-extrabold text-[#231B1A]">
              그래프 기반 AI 챗봇
            </h3>
          </div>

          {/* 대화 목록 */}
          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {chatMessages.map((msg) =>
              msg.role === "user" ? (
                <div key={msg.id} className="flex justify-end">
                  <div className="rounded-2xl rounded-tr-xs bg-[#F6D5E1] text-[#6E223F] px-4 py-2.5 text-xs font-medium max-w-xs leading-relaxed">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div key={msg.id} className="space-y-2">
                  <div className="rounded-xl border border-[#EFEAE1] bg-[#FDFCFB] p-3.5 text-xs text-[#3D332E] leading-relaxed whitespace-pre-wrap">
                    {renderFormattedText(msg.content)}
                  </div>
                  {msg.evidencePaths && msg.evidencePaths.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {msg.evidencePaths.map((pathStr, pIdx) => (
                        <span
                          key={pIdx}
                          className="inline-block rounded-md bg-[#E6F4F1] border border-[#B8E2D8] px-2.5 py-1 text-[10.5px] font-mono font-semibold text-[#0D7A68]"
                        >
                          {pathStr}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            )}
            {isChatLoading && (
              <div className="rounded-xl border border-[#EFEAE1] bg-[#FDFCFB] p-3 text-xs text-[#8C827A]">
                AuraDB 경로를 조회하여 답변을 생성하고 있습니다...
              </div>
            )}
          </div>

          {/* 챗봇 입력 폼 */}
          <form onSubmit={handleChatSubmit} className="flex items-center gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="그래프에게 물어보기..."
              className="flex-1 rounded-xl border border-[#E6DFD5] bg-[#FAF7F0]/60 px-3.5 py-2.5 text-xs text-[#231B1A] placeholder-[#A69C93] focus:outline-none focus:border-[#E04F80]"
            />
            <button
              type="submit"
              disabled={isChatLoading}
              aria-label="질문 전송"
              className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#E65586] to-[#DE8B3B] flex items-center justify-center text-white shadow-2xs hover:opacity-95 disabled:opacity-50 cursor-pointer shrink-0"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"
                />
              </svg>
            </button>
          </form>

          <p className="text-[10.5px] text-[#9A8F85]">
            * GraphRAG 방식 — 답변은 Cypher로 조회된 실제 경로에 기반합니다.
          </p>
        </section>

        {/* 하단 푸터 안내 */}
        <footer className="pt-2 pb-8 text-[11px] text-[#9A8F85]">
          본 화면은 교육용 예시이며, 등장인물·서사는 기획서 데이터를 바탕으로 구성한 가상의 미리보기입니다.
        </footer>
      </main>
    </div>
  );
}
