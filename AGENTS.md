# AGENTS.md - Agent Guidelines for This Repository

This repository contains a **Next.js-based GraphRAG chatbot** project that ingests project proposals from Google Docs and structured data from Google Sheets into a Neo4j knowledge graph, enabling graph exploration and grounded Q&A. When working on this project, Antigravity and all other AI coding agents must follow the guidelines below.

## 1. Core Project Architecture & Objectives

- **Frontend / API Server:** Next.js (App Router) application located in the root directory.
- **Knowledge Graph Database:** Neo4j (target database for schema inspection and Cypher query execution).
- **Reference Materials:** Project proposal documents (`.md`) and structured data files (`.csv`, `.cypher`) placed inside the project workspace.
- **Primary Agent Responsibilities:**
  1. Analyze the current Neo4j graph schema alongside the project proposal to identify further graph traversal and query scenarios.
  2. Implement a RAG chatbot pipeline that translates natural language questions into Cypher queries (Text-to-Cypher) and generates grounded responses from the retrieved graph results.

## 2. Development Server Rules (Do **NOT** Run `npm run build`)

- **Always use the development server (`npm run dev`).** Rely on Hot Module Replacement (HMR) to preview changes interactively while iterating on the application.
- **Never run `npm run build` inside an agent session.** Running a production build overwrites the `.next` folder with production assets, breaking hot-reload and leaving the development server in an inconsistent state. Production builds should only be executed outside the agent workflow right before deployment.

## 3. Neo4j & Data Safety Guidelines (Critical)

- **Read-Only Queries First:** When implementing Text-to-Cypher logic or exploring the database via MCP, generate and execute only read-only queries (`MATCH`, `RETURN`, `CALL db.schema.*`, etc.).
- **Block Destructive Operations:** Never execute queries that delete or overwrite existing Neo4j graph data (`DELETE`, `DETACH DELETE`, `DROP`, etc.) without explicit user approval.
- **Grounded Responses (Prevent Hallucinations):** Ensure the RAG chatbot strictly bases its answers on the nodes and relationships retrieved from Neo4j, citing graph evidence rather than fabricating unsupported information.

## 4. Environment Variables & Security

- Store Neo4j credentials (`NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`) and LLM API keys (`GEMINI_API_KEY`) exclusively in `.env.local`.
- Ensure `.env.local` is listed in `.gitignore` and **never** commit or push secrets to the remote GitHub repository.
- If new environment variables are introduced, document only the key names in `.env.example` and prompt the user to supply the values locally.

## 5. Dependencies & Coding Conventions

- When adding or updating packages (e.g., `neo4j-driver`, `@google/genai`), keep `package-lock.json` in sync and restart the development server if necessary.
- Use TypeScript (`.tsx` / `.ts`) or clean modern JavaScript consistently for components, API routes, and utilities.
- Write all user-facing UI text, chatbot system prompts, and user-facing error messages in **Korean** by default.

## 6. Useful Commands Recap

| Command         | Purpose                                                 |
| :-------------- | :------------------------------------------------------ |
| `npm run dev`   | Start the Next.js development server with HMR (default) |
| `npm run lint`  | Run ESLint code quality and syntax checks               |
| `npm run test`  | Execute the test suite (if configured)                  |
| `npm run build` | **Production build — do not run during agent sessions** |
