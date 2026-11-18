import { NextResponse } from "next/server";
import { z } from "zod";
import { extractFromText, extractFromUrl } from "@/lib/extractListing";
import type { ExtractResponse } from "@/lib/schema";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.union([
  z.object({ url: z.string().url(), force: z.boolean().optional() }),
  z.object({ text: z.string().min(50, "Collez au moins quelques lignes du texte de l'annonce."), url: z.string().url().nullish(), force: z.boolean().optional() }),
]);

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues.map((i) => i.message).join(" ; ") : "Requête invalide.";
    return NextResponse.json<ExtractResponse>({ ok: false, error: msg }, { status: 400 });
  }
  try {
    const result =
      "text" in body ? await extractFromText(body.text, body.url ?? null, { force: body.force }) : await extractFromUrl(body.url, { force: body.force });
    return NextResponse.json<ExtractResponse>(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json<ExtractResponse>({ ok: false, error: msg }, { status: 502 });
  }
}
