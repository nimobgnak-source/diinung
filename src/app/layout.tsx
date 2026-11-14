import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "먼작귀그래프 | 극장판 <치이카와: 인어섬의 비밀> 지식그래프",
  description:
    "극장판 <치이카와: 인어섬의 비밀> Neo4j AuraDB 지식그래프 기반 GraphRAG 서비스",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased min-h-screen bg-[#FAF7F0] text-[#231B1A]">
        {children}
      </body>
    </html>
  );
}
