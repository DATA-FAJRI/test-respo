import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { ListingDataSchema, type ListingData } from "@/lib/schema";
import { SYSTEM_PROMPT, buildUserPrompt, parseJsonObject } from "./prompt";

export const LLM_MODEL = process.env.LOCCOMPARE_MODEL || "claude-opus-5-5";
const MAX_PAGE_CHARS = 60_000;

export function llmAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export type LlmInput = {
  url: string | null;
  pageText: string;
  structured?: string | null;
  preExtracted?: Partial<ListingData> | null;
};

export async function extractWithLlm(input: LlmInput): Promise<{ data: ListingData; notes: string[] }> {
  const client = new Anthropic();
  const notes: string[] = [];
  let pageText = input.pageText;
  if (pageText.length > MAX_PAGE_CHARS) {
    notes.push(`Texte de la page très long (${pageText.length} caractères) : seuls les ${MAX_PAGE_CHARS} premiers ont été analysés.`);
    pageText = pageText.slice(0, MAX_PAGE_CHARS);
  }

  const userContent = buildUserPrompt({ ...input, pageText });

  const callOnce = async (extra?: string) => {
    const stream = client.beta.messages.stream({
      model: LLM_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: extra ? `${userContent}\n\n${extra}` : userContent }],
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new Error("Le modèle a refusé de traiter cette page.");
    if (msg.stop_reason === "max_tokens") throw new Error("Réponse du LLM tronquée (max_tokens).");
    return msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");
  };

  let raw: unknown;
  try {
    raw = parseJsonObject(await callOnce());
  } catch (e) {
    if (e instanceof SyntaxError || (e instanceof Error && /pas renvoyé de JSON/.test(e.message))) {
      // une seconde tentative avec un rappel explicite
      raw = parseJsonObject(await callOnce("Ta réponse précédente n'était pas un JSON valide. Réponds uniquement par l'objet JSON."));
    } else throw e;
  }
  const parsed = ListingDataSchema.safeParse(raw);
  if (!parsed.success) throw new Error("JSON du LLM invalide : " + parsed.error.issues.slice(0, 3).map((i) => i.message).join("; "));
  return { data: parsed.data, notes };
}
