import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "페스타그래프 | 2026 전국 대학 축제 · 아티스트 지식그래프",
  description:
    "2026 전국 주요 대학 축제와 출연 아티스트를 잇는 Neo4j AuraDB 지식그래프 기반 GraphRAG 서비스",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased min-h-screen bg-[#0B0820] text-[#F5F0FF]">
        {children}
      </body>
    </html>
  );
}
