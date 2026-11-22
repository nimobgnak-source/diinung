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
      label: "아티스트" as NodeCategory,
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
        <strong key={idx} className="font-bold text-[#F5F0FF]">
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
      /(\b(?:MATCH|OPTIONAL MATCH|WHERE|RETURN|WITH|ORDER BY|DESC|ASC|DISTINCT|UNWIND|AS|AND|OR|IN|LIMIT|CONTAINS|COUNT|COLLECT)\b|"[^"]*"|'[^']*'|:[\p{L}_]+(?:\|[\p{L}_]+)*)/gu
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
              "CONTAINS",
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
            <span key={tokIdx} className="text-[#E9E3FF]">
              {tok}
            </span>
          );
        })}
      </div>
    );
  });
}

/**
 * 이퀄라이저 막대 애니메이션 (음악 분위기 장식)
 */
function Equalizer({ small = false }: { small?: boolean }) {
  const colors = ["#FF3FD0", "#B05CFF", "#7B5CFF", "#2AF0FF", "#FF3FD0"];
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-end gap-[3px] ${small ? "h-3.5" : "h-5"}`}
    >
      {colors.map((c, i) => (
        <span
          key={i}
          className="eq-bar w-[3px] rounded-full"
          style={{ backgroundColor: c, animationDelay: `${i * 0.13}s` }}
        />
      ))}
    </span>
  );
}

export default function HomePage() {
  // 상단 DATA SCOPE 카운트 상태
  // (AuraDB 실측값으로 갱신되기 전 기본값: 적재 데이터 기준)
  const [scopeCounts, setScopeCounts] = useState<Record<string, number>>({
    지역: 17,
    대학: 19,
    축제: 25,
    아티스트: 123,
    장르: 6,
  });

  // 메인 Hero 검색 상태
  const [searchQuery, setSearchQuery] = useState(
    HERO_RECOMMENDED_QUESTIONS[0]
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
      content: "가장 많은 대학 축제에 출연한 아티스트는 누구야?",
    },
    {
      id: "init-assistant",
      role: "assistant",
      content:
        "**잔나비**가 **8개** 대학 축제에 출연해 가장 많았고, 주 장르는 **밴드**입니다. 그 다음은 **YB (윤도현 밴드)**·**프로미스나인**(각 6개)입니다.",
      evidencePaths: [
        "잔나비 -[속함]-> 밴드",
        "잔나비 -[출연함]-> GRACIA 축제",
        "조선대학교 -[개최함]-> GRACIA 축제",
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

  // 그래프 노드 좌표 계산
  const positionedNodes: PositionedNode[] = useMemo(() => {
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

  // 같은 이름의 캠퍼스 노드가 있으므로 id로 연결
  const nodeById = useMemo(() => {
    const map = new Map<string, PositionedNode>();
    for (const n of positionedNodes) {
      map.set(n.id, n);
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
    <div className="min-h-screen bg-[#0B0820] text-[#F5F0FF] relative overflow-x-hidden">
      {/* 은은한 파스텔 배경 블러 장식 */}
      <div className="pointer-events-none fixed -top-24 -right-24 w-96 h-96 rounded-full bg-[#FF3FD0]/25 blur-3xl" />
      <div className="pointer-events-none fixed -bottom-32 -left-24 w-96 h-96 rounded-full bg-[#5A3CFF]/30 blur-3xl" />
      {/* 무대 조명 빔 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="stage-beam stage-beam-left" />
        <div className="stage-beam stage-beam-right" />
      </div>

      {/* 1. 상단 네비게이션 헤더 */}
      <header className="border-b border-[#2B2457] bg-[#0B0820]/80 backdrop-blur-xs">
        <div className="max-w-5xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Equalizer />
            <span className="text-lg font-extrabold tracking-tight text-[#FF3FD0] neon-text">
              페스타그래프
            </span>
            <span className="text-xs text-[#A99FD6] font-medium">
              2026 전국 주요 대학 축제 · 출연 아티스트 지식그래프
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FF3B5C]/50 bg-[#FF3B5C]/10 px-2.5 py-0.5 text-[10px] font-extrabold tracking-widest text-[#FF6B85]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#FF3B5C] live-dot" />
            LIVE
          </span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-7 space-y-8 relative z-10">
        {/* DATA SCOPE 배지 바 */}
        <section className="rounded-xl border border-[#2B2457] bg-white/[0.04] px-5 py-3 shadow-2xs flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <span className="font-extrabold text-[#FF3FD0] tracking-wider">
            DATA SCOPE
          </span>
          <span className="text-[#A99FD6]">
            기준 시점{" "}
            <strong className="text-[#F5F0FF] font-semibold">
              2026.02~2026.12
            </strong>
          </span>
          <span className="text-[#3A3170]">|</span>
          {NODE_LEGEND.map((item) => (
            <span key={item.label} className="text-[#A99FD6]">
              {item.display}{" "}
              <strong className="text-[#F5F0FF] font-semibold">
                {scopeCounts[item.label] ?? "-"}
              </strong>
            </span>
          ))}
        </section>

        {/* 2. 메인 Hero 검색창 & Text-to-Cypher 실시간 변환 영역 */}
        <section className="space-y-5 pt-2">
          <div className="space-y-2.5">
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-[#F5F0FF]">
              대학 축제 라인업을,{" "}
              <span className="text-[#FF3FD0] neon-text">관계로</span> 다시 보기
            </h1>
            <p className="text-sm text-[#B4A9E0] leading-relaxed max-w-xl">
              지역·대학·축제·아티스트·장르가 연결된 2026 대학 축제 지도를 자연어로 묻고 그래프로 답을 얻습니다. 질문 하나가 Cypher 쿼리로 바뀌어 어느 지역, 어느 대학이 어떤 음악을 섭외했는지 보여줍니다.
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
            <div className="flex-1 flex items-center gap-3 rounded-xl border border-[#3A3170] bg-white/[0.04] px-4 py-3.5 shadow-2xs focus-within:border-[#FF3FD0] focus-within:ring-2 focus-within:ring-[#FF3FD0]/15 transition">
              <svg
                className="w-4 h-4 text-[#8E84BE] shrink-0"
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
                placeholder="예: 수도권과 비수도권 축제에 모두 출연한 아티스트는 누구야?"
                className="w-full bg-transparent text-sm text-[#F5F0FF] placeholder-[#7D73AE] focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={isSearching}
              className="rounded-xl bg-gradient-to-r from-[#FF3FD0] to-[#7B5CFF] hover:opacity-95 px-6 py-3.5 text-sm font-bold text-white shadow-[0_0_20px_rgba(255,63,208,0.45)] transition disabled:opacity-60 shrink-0 cursor-pointer"
            >
              {isSearching ? "♪ 변환 및 조회 중..." : "♪ 그래프로 검색"}
            </button>
          </form>

          {/* 자연어 -> CYPHER 자동 변환 코드 박스 */}
          <div className="space-y-2">
            <div className="text-[11px] font-bold text-[#2AF0FF] tracking-wide">
              자연어 → CYPHER 자동 변환
            </div>
            <div className="rounded-xl bg-[#07051A] border border-[#7B5CFF]/40 shadow-[0_0_24px_rgba(123,92,255,0.25)] px-5 py-4 font-mono text-xs sm:text-[13px] overflow-x-auto shadow-xs">
              {renderHighlightedCypher(currentCypher)}
            </div>
          </div>

          {/* 데이터 구성 · 노드 범례 */}
          <div className="space-y-2 pt-1">
            <div className="text-[11px] font-bold text-[#2AF0FF]">
              데이터 구성 · 노드 범례
            </div>
            <div className="flex flex-wrap gap-2">
              {NODE_LEGEND.map((item) => (
                <span
                  key={item.label}
                  className="inline-flex items-center gap-2 rounded-full border border-[#3A3170] bg-white/[0.04] px-3.5 py-1.5 text-xs font-medium text-[#E4DCFF] shadow-2xs"
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
            <div className="text-[11px] font-bold text-[#2AF0FF]">
              클릭 한 번으로 바로 질문해보세요
            </div>
            <div className="flex flex-wrap gap-2">
              {HERO_RECOMMENDED_QUESTIONS.map((q, idx) => (
                <button
                  key={idx}
                  type="button"
                  disabled={isSearching}
                  onClick={() => executeGraphSearch(q)}
                  className="rounded-full border border-[#3A3170] bg-white/[0.04] hover:border-[#FF3FD0] hover:bg-[#FF3FD0]/10 px-4 py-2 text-xs text-[#E4DCFF] transition shadow-2xs disabled:opacity-50 cursor-pointer text-left"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* 3. 검색 결과 그래프 & 조회 데이터 뷰어 */}
        <section className="rounded-2xl border border-[#2B2457] bg-white/[0.04] p-6 shadow-2xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-extrabold text-[#F5F0FF]">
              검색 결과 그래프
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-[#8E84BE]">{graphTitle}</span>
              <div className="inline-flex rounded-lg border border-[#3A3170] bg-[#0B0820] p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setViewMode("graph")}
                  className={`px-2.5 py-1 rounded-md font-medium transition cursor-pointer ${
                    viewMode === "graph"
                      ? "bg-[#FF3FD0]/20 text-[#FF7BE3] shadow-2xs"
                      : "text-[#B4A9E0]"
                  }`}
                >
                  그래프 뷰
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("table")}
                  className={`px-2.5 py-1 rounded-md font-medium transition cursor-pointer ${
                    viewMode === "table"
                      ? "bg-[#FF3FD0]/20 text-[#FF7BE3] shadow-2xs"
                      : "text-[#B4A9E0]"
                  }`}
                >
                  결과 표 ({records.length})
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("json")}
                  className={`px-2.5 py-1 rounded-md font-medium transition cursor-pointer ${
                    viewMode === "json"
                      ? "bg-[#FF3FD0]/20 text-[#FF7BE3] shadow-2xs"
                      : "text-[#B4A9E0]"
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
                <defs>
                  <filter id="node-glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="7" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                {/* 엣지(관계 선 및 중앙 다크 배지) 렌더링 */}
                {graphEdges.map((edge) => {
                  const s = nodeById.get(edge.source);
                  const t = nodeById.get(edge.target);
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
                        stroke="#6A5CC2" strokeOpacity={0.7}
                        strokeWidth={1.6}
                      />
                      <rect
                        x={mx - badgeWidth / 2}
                        y={my - 11}
                        width={badgeWidth}
                        height={22}
                        rx={5}
                        fill="#120D2E" stroke="#7B5CFF" strokeOpacity={0.6}
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
                  const isSelected = selectedNode?.id === node.id;
                  // 축제 이름처럼 긴 이름은 원 안에 들어가도록 줄임 (전체 이름은 하단 상세 바에 표시)
                  const fullTitle = node.displayName || node.name;
                  const displayTitle =
                    fullTitle.length > 8 ? `${fullTitle.slice(0, 7)}…` : fullTitle;

                  return (
                    <g
                      key={node.id}
                      onClick={() => setSelectedNode(node)}
                      className="cursor-pointer group"
                    >
                      <title>{fullTitle}</title>
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
                        fill="#8E84BE"
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
                        filter="url(#node-glow)"
                        stroke="#FFFFFF"
                        strokeOpacity={isSelected ? 0.9 : 0.25}
                        strokeWidth={1.5}
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
            <div className="overflow-x-auto border border-[#2B2457] rounded-xl">
              {records.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#A99FD6]">
                  상단 검색창이나 추천 질문 칩을 클릭하면 AuraDB 조회 결과 표가 표시됩니다.
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#0B0820] border-b border-[#2B2457] text-[#C3B8EE]">
                    <tr>
                      {Object.keys(records[0]).map((key) => (
                        <th key={key} className="px-4 py-2.5 font-bold">
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#221C47]">
                    {records.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-white/5">
                        {Object.values(row).map((val, cIdx) => (
                          <td key={cIdx} className="px-4 py-2.5 text-[#F5F0FF]">
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
            <pre className="max-h-72 overflow-auto rounded-xl bg-[#07051A] border border-[#7B5CFF]/40 shadow-[0_0_24px_rgba(123,92,255,0.25)] p-4 text-[11px] text-[#E9E3FF] font-mono">
              {JSON.stringify(
                records.length > 0 ? records : { nodes: graphNodes, edges: graphEdges },
                null,
                2
              )}
            </pre>
          )}

          {/* 클릭된 노드 상세 속성 표시 바 */}
          {selectedNode && (
            <div className="rounded-xl bg-[#0B0820] border border-[#3A3170] px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-2.5">
                <span
                  className="px-2.5 py-0.5 rounded-full text-white font-bold text-[11px]"
                  style={{
                    backgroundColor: getCategoryStyle(selectedNode.label).color,
                  }}
                >
                  {selectedNode.label} · {selectedNode.id}
                </span>
                <strong className="text-sm font-extrabold text-[#F5F0FF]">
                  {selectedNode.displayName || selectedNode.name}
                </strong>
                {Object.entries(selectedNode.props ?? {}).map(([key, value]) => (
                  <span
                    key={key}
                    className="text-[#D2C8F5] bg-white/[0.04] border border-[#3A3170] px-2.5 py-0.5 rounded-md"
                  >
                    {key}: {value}
                  </span>
                ))}
              </div>
              <span className="text-[11px] text-[#8E84BE]">
                노드를 클릭하면 상세 속성을 볼 수 있습니다
              </span>
            </div>
          )}

          <p className="text-[11px] text-[#8E84BE]">
            * 실제 서비스에서는 Neo4j 기반 인터랙티브 그래프로 렌더링되며, 노드를 클릭하면 상세 속성과 연결 경로를 확인할 수 있습니다.
          </p>
        </section>

        {/* 4. 하단 그래프 기반 AI 챗봇 */}
        <section className="max-w-lg rounded-2xl border border-[#2B2457] bg-white/[0.04] p-5 shadow-2xs space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#FF3FD0] to-[#7B5CFF] flex items-center justify-center text-white text-xs font-extrabold shadow-2xs">
              ♪
            </div>
            <h3 className="text-sm font-extrabold text-[#F5F0FF]">
              그래프 기반 AI 챗봇
            </h3>
          </div>

          {/* 대화 목록 */}
          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {chatMessages.map((msg) =>
              msg.role === "user" ? (
                <div key={msg.id} className="flex justify-end">
                  <div className="rounded-2xl rounded-tr-xs bg-[#FF3FD0]/15 border border-[#FF3FD0]/40 text-[#FFD9F6] px-4 py-2.5 text-xs font-medium max-w-xs leading-relaxed">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div key={msg.id} className="space-y-2">
                  <div className="rounded-xl border border-[#2B2457] bg-white/[0.04] p-3.5 text-xs text-[#E4DCFF] leading-relaxed whitespace-pre-wrap">
                    {renderFormattedText(msg.content)}
                  </div>
                  {msg.evidencePaths && msg.evidencePaths.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {msg.evidencePaths.map((pathStr, pIdx) => (
                        <span
                          key={pIdx}
                          className="inline-block rounded-md bg-[#2AF0FF]/10 border border-[#2AF0FF]/35 px-2.5 py-1 text-[10.5px] font-mono font-semibold text-[#8FF7FF]"
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
              <div className="rounded-xl border border-[#2B2457] bg-white/[0.04] p-3 text-xs text-[#A99FD6] flex items-center gap-2.5">
                <Equalizer small />
                AuraDB 경로를 조회하여 답변을 생성하고 있습니다... (30초~1분)
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
              className="flex-1 rounded-xl border border-[#3A3170] bg-white/5 px-3.5 py-2.5 text-xs text-[#F5F0FF] placeholder-[#7D73AE] focus:outline-none focus:border-[#FF3FD0]"
            />
            <button
              type="submit"
              disabled={isChatLoading}
              aria-label="질문 전송"
              className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#FF3FD0] to-[#7B5CFF] flex items-center justify-center text-white shadow-2xs hover:opacity-95 disabled:opacity-50 cursor-pointer shrink-0"
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

          <p className="text-[10.5px] text-[#8E84BE]">
            * GraphRAG 방식 — 답변은 Cypher로 조회된 실제 경로에 기반합니다.
          </p>
        </section>

        {/* 하단 푸터 안내 */}
        <footer className="pt-2 pb-8 text-[11px] text-[#8E84BE]">
          디지털인문학 응용(COLA173-19) 팀 페스타그래프 · 데이터 출처: 각 대학 총학생회 공식 인스타그램, campustival.com (2026.02~2026.12 기준, 개최 직전 라인업 변경은 반영되지 않았을 수 있음)
        </footer>
      </main>
    </div>
  );
}
