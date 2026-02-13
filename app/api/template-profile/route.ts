import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rateLimit";
import { detectHeadingCandidates, hashTemplateText } from "@/lib/usgCustomTemplate";
import {
  sanitizeTemplateProfile,
  TEMPLATE_PROFILE_VERSION
} from "@/lib/usgTemplateProfile";
import { USG_FIELD_KEYS } from "@/lib/usgTemplate";

export const runtime = "nodejs";

const MODEL_NAME = "gemini-2.5-flash";
const MAX_TEMPLATE_CHARS = 80_000;

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip") || "unknown";
}

function extractJson(text: string) {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("No JSON object found in response");
  }
  return JSON.parse(text.slice(firstBrace, lastBrace + 1));
}

function stripControlChars(text: string) {
  return text.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g,
    ""
  );
}

function escapeNewlinesInsideJsonStrings(text: string) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (!inString) {
      out += char;
      if (char === "\"") {
        inString = true;
      }
      continue;
    }

    if (escaped) {
      out += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      out += char;
      escaped = true;
      continue;
    }

    if (char === "\"") {
      out += char;
      inString = false;
      continue;
    }

    if (char === "\n") {
      out += "\\n";
      continue;
    }
    if (char === "\r") {
      out += "\\r";
      continue;
    }

    out += char;
  }
  return out;
}

function removeTrailingCommas(text: string) {
  return text.replace(/,\s*([}\]])/g, "$1");
}

function parseModelJson(rawText: string) {
  const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const unfenced = fenceMatch ? fenceMatch[1] : rawText;
  try {
    return extractJson(unfenced);
  } catch {
    const sanitized = stripControlChars(unfenced);
    try {
      return extractJson(sanitized);
    } catch {
      const repairedNewlines = escapeNewlinesInsideJsonStrings(sanitized);
      try {
        return extractJson(repairedNewlines);
      } catch {
        const repairedCommas = removeTrailingCommas(repairedNewlines);
        try {
          return extractJson(repairedCommas);
        } catch {
          return null;
        }
      }
    }
  }
}

function buildFallbackProfileSeed(templateText: string) {
  const headingCandidates = detectHeadingCandidates(templateText);
  const headings = headingCandidates.map((item) => item.line).filter(Boolean);
  const uniqueHeadings = Array.from(new Set(headings)).slice(0, 24);

  const sections =
    uniqueHeadings.length > 0
      ? uniqueHeadings.map((heading, index) => ({
          id: `section_${index + 1}`,
          heading,
          depends_on: [] as string[],
          normal_hint: ""
        }))
      : [
          {
            id: "section_1",
            heading: "Observations",
            depends_on: [] as string[],
            normal_hint: ""
          }
        ];

  return {
    sections,
    fields: [] as Array<{
      id: string;
      label: string;
      type: string;
      section_id: string;
      normal_hint: string;
    }>,
    notes: ["Fallback profile generated due to AI JSON parse failure."]
  };
}

async function callGeminiTemplateIntelligence(params: {
  apiKey: string;
  templateText: string;
  templateGender: string;
  forceValidJson?: boolean;
}) {
  const systemText =
    "You are a radiology template intelligence assistant. Output JSON only.";

  const userText = `Analyze this USG whole abdomen report template and propose a deterministic profile for code-based filling.

STRICT RULES:
- Return JSON only. No markdown/code fences.
- Include only USG whole abdomen clinically relevant sections/fields.
- No admin/noise/chatter fields.
- Prefer mapping to existing canonical keys where possible.
- For new fields, create stable snake_case ids.
- Each section should list depends_on field ids.
- Keep sections/fields concise and practical.
- Field type must be one of: text, number, boolean, measurement.

Input metadata:
- template_gender: ${params.templateGender || "male"}
- canonical_field_ids: ${USG_FIELD_KEYS.join(", ")}
- profile_version: ${TEMPLATE_PROFILE_VERSION}

Return JSON schema:
{
  "sections": [
    {
      "id": "section_id",
      "heading": "Template Heading",
      "depends_on": ["field_id_1", "field_id_2"],
      "normal_hint": ""
    }
  ],
  "fields": [
    {
      "id": "new_field_id",
      "label": "Readable Field Label",
      "type": "text",
      "section_id": "section_id",
      "normal_hint": ""
    }
  ],
  "notes": []
}

TEMPLATE TEXT:\n${params.templateText}${
    params.forceValidJson
      ? "\n\nFINAL CHECK: return syntactically valid JSON only, matching the schema exactly."
      : ""
  }`;

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
            parts: [{ text: `${systemText}\n\n${userText}` }]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096
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

  return text;
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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not configured." },
      { status: 500 }
    );
  }

  let templateText = "";
  let templateGender = "male";

  try {
    const body = await request.json();
    templateText = String(body?.template_text || "").replace(/\r\n/g, "\n");
    templateGender = String(body?.template_gender || "male");
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }

  if (!templateText.trim()) {
    return NextResponse.json(
      { error: "template_text is required." },
      { status: 400 }
    );
  }

  if (templateText.length > MAX_TEMPLATE_CHARS) {
    return NextResponse.json(
      { error: `template_text exceeds ${MAX_TEMPLATE_CHARS} characters.` },
      { status: 413 }
    );
  }

  const templateHash = hashTemplateText(templateText.trim());

  let rawText = "";
  let parsed: Record<string, unknown> | null = null;
  let intelligenceError = "";
  try {
    rawText = await callGeminiTemplateIntelligence({
      apiKey,
      templateText,
      templateGender
    });
    parsed = parseModelJson(rawText) as Record<string, unknown> | null;
    if (!parsed) {
      rawText = await callGeminiTemplateIntelligence({
        apiKey,
        templateText,
        templateGender,
        forceValidJson: true
      });
      parsed = parseModelJson(rawText) as Record<string, unknown> | null;
    }
    if (!parsed) {
      throw new Error("Template intelligence returned invalid JSON.");
    }
  } catch (error) {
    intelligenceError =
      (error as Error).message || "Template intelligence failed.";
    parsed = buildFallbackProfileSeed(templateText) as Record<string, unknown>;
  }

  const profile = sanitizeTemplateProfile(
    {
      ...(parsed || {}),
      approved: false,
      template_hash: templateHash
    },
    { templateHash }
  );

  if (!profile) {
    return NextResponse.json(
      { error: "Failed to build a valid template profile." },
      { status: 500 }
    );
  }

  const notes = Array.isArray(parsed?.notes)
    ? parsed.notes
        .map((note) => String(note || "").trim())
        .filter(Boolean)
        .slice(0, 20)
    : [];
  if (intelligenceError) {
    notes.unshift(`AI parsing fallback used: ${intelligenceError}`);
  }

  return NextResponse.json({
    template_hash: templateHash,
    profile,
    notes
  });
}
