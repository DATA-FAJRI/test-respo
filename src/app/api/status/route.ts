import { NextResponse } from "next/server";
import { LLM_MODEL, llmAvailable } from "@/lib/llm/extract";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ llm: llmAvailable(), model: llmAvailable() ? LLM_MODEL : null });
}
