import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rateLimit";
import { computeObservationEditStats } from "@/lib/firebasePersistence";

export const runtime = "nodejs";

const MODEL_NAME = "gemini-2.5-flash";
const MAX_TEXT_CHARS = 80_000;

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip") || "unknown";
}

function trimText(value: unknown) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function extractJson(text: string) {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }
  try {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildFallbackSummary(aiText: string, finalText: string) {
  const stats = computeObservationEditStats(aiText, finalText);
  if (!stats.hasEdits) {
    return {
      summary: "No observation-level edits detected between AI draft and final report.",
      key_changes: [] as string[],
      likely_model_gaps: [] as string[],
      quality_score: 96
    };
  }
  const additions = stats.finalCoreText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !stats.aiCoreText.toLowerCase().includes(line.toLowerCase()))
    .slice(0, 6);
  const removals = stats.aiCoreText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !stats.finalCoreText.toLowerCase().includes(line.toLowerCase()))
    .slice(0, 6);

  const keyChanges: string[] = [];
  if (additions.length) {
    keyChanges.push(`Added/expanded lines: ${additions.join(" | ")}`);
  }
  if (removals.length) {
    keyChanges.push(`Removed/replaced lines: ${removals.join(" | ")}`);
  }
  if (!keyChanges.length) {
    keyChanges.push("Wording-level edits detected without clear line additions/removals.");
  }

  const likelyGaps = [
    "Model may be under-capturing clinically preferred terminology in impression.",
    "Model output may need tighter phrasing normalization for radiology style."
  ];

  return {
    summary: `Detected ${stats.changeCount} observation-line changes between AI and finalized report.`,
    key_changes: keyChanges,
    likely_model_gaps: likelyGaps,
    quality_score: Math.max(55, 96 - stats.changeCount * 3)
  };
}

async function callGeminiIssueSummary(params: {
  apiKey: string;
  aiText: string;
  finalText: string;
}) {
  const prompt = `You are a radiology QA reviewer. Compare AI-generated findings vs final edited findings and output JSON only.

RULES:
- Focus on observation/finding edits only.
- Keep output concise and actionable.
- Mention where model extraction/terminology is weak.
- Do not include PHI.
- Return valid JSON only.

Schema:
{
  "summary": "",
  "key_changes": ["", ""],
  "likely_model_gaps": ["", ""],
  "quality_score": 0
}

AI_FINDINGS:
${params.aiText}

FINAL_FINDINGS:
${params.finalText}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/${MODEL_NAME}:generateContent?key=${params.apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1024
        }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map((part: { text?: string }) => part.text || "")
    .join("")
    .trim();
  if (!text) {
    throw new Error("Empty response from Gemini");
  }
  const parsed = extractJson(text);
  if (!parsed) {
    throw new Error("Invalid JSON from Gemini");
  }
  return parsed;
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const limit = rateLimit(ip);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "Rate limit exceeded. Try again later."
      },
      { status: 429 }
    );
  }

  let aiText = "";
  let finalText = "";
  try {
    const body = await request.json();
    aiText = trimText(body?.ai_text);
    finalText = trimText(body?.final_text);
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!aiText || !finalText) {
    return NextResponse.json(
      { error: "ai_text and final_text are required." },
      { status: 400 }
    );
  }
  if (aiText.length > MAX_TEXT_CHARS || finalText.length > MAX_TEXT_CHARS) {
    return NextResponse.json(
      { error: `Text exceeds ${MAX_TEXT_CHARS} characters.` },
      { status: 413 }
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const fallback = buildFallbackSummary(aiText, finalText);
    return NextResponse.json({
      ...fallback,
      source: "fallback"
    });
  }

  try {
    const parsed = await callGeminiIssueSummary({
      apiKey,
      aiText,
      finalText
    });
    const summary = trimText(parsed.summary);
    const keyChanges = Array.isArray(parsed.key_changes)
      ? parsed.key_changes.map((item) => trimText(item)).filter(Boolean).slice(0, 8)
      : [];
    const likelyModelGaps = Array.isArray(parsed.likely_model_gaps)
      ? parsed.likely_model_gaps
          .map((item) => trimText(item))
          .filter(Boolean)
          .slice(0, 8)
      : [];
    const rawScore = Number(parsed.quality_score);
    const qualityScore =
      Number.isFinite(rawScore) && rawScore >= 0
        ? Math.min(100, Math.max(0, Math.round(rawScore)))
        : 80;

    return NextResponse.json({
      summary:
        summary || "AI comparison completed. Review key changes and model gaps.",
      key_changes: keyChanges,
      likely_model_gaps: likelyModelGaps,
      quality_score: qualityScore,
      source: "ai"
    });
  } catch {
    const fallback = buildFallbackSummary(aiText, finalText);
    return NextResponse.json({
      ...fallback,
      source: "fallback"
    });
  }
}
