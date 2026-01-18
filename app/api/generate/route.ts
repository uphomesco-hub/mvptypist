import { Buffer } from "buffer";
import { NextRequest, NextResponse } from "next/server";
import { getTemplateById } from "@/lib/templates";
import { rateLimit } from "@/lib/rateLimit";
import {
  buildUsgReport,
  USG_ABDOMEN_FEMALE_TEMPLATE,
  USG_ABDOMEN_MALE_TEMPLATE,
  USG_FIELD_KEYS,
  type UsgFieldOverrides,
  type UsgGender
} from "@/lib/usgTemplate";

const MODEL_NAME = "gemini-2.5-flash";
const DEBUG_GEMINI_LOG = process.env.DEBUG_GEMINI_LOG === "true";
const DEBUG_GEMINI_CLIENT = process.env.DEBUG_GEMINI_CLIENT === "true";
const DEFAULT_DISCLAIMER =
  "Draft only. Must be reviewed and signed by the doctor.";
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const FORBIDDEN_HEADERS = [
  "impression",
  "conclusion",
  "diagnosis",
  "plan",
  "advice",
  "recommendation"
];

export const runtime = "nodejs";

let GEMINI_SUPPORTS_RESPONSE_MIME_TYPE: boolean | null = null;

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip") || "unknown";
}

function sanitizeObservations(text: string, forbiddenHeaders: string[]) {
  const lines = text.split(/\r?\n/);
  let removed = false;
  const cleaned = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return true;
    }
    const matches = forbiddenHeaders.some((word) =>
      new RegExp(`^${word}\\b`, "i").test(trimmed)
    );
    if (matches) {
      removed = true;
    }
    return !matches;
  });

  return {
    text: cleaned.join("\n").trim(),
    removed
  };
}

function extractJson(text: string) {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("No JSON object found in response");
  }
  const jsonSlice = text.slice(firstBrace, lastBrace + 1);
  return JSON.parse(jsonSlice);
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

function parseJsonStringValue(text: string, startIndex: number) {
  let value = "";
  let escaped = false;
  for (let i = startIndex + 1; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) {
      switch (char) {
        case "n":
          value += "\n";
          break;
        case "r":
          value += "\r";
          break;
        case "t":
          value += "\t";
          break;
        case "\"":
          value += "\"";
          break;
        case "\\":
          value += "\\";
          break;
        case "u": {
          const hex = text.slice(i + 1, i + 5);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            value += String.fromCharCode(parseInt(hex, 16));
            i += 4;
          }
          break;
        }
        default:
          value += char;
      }
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      return { value, endIndex: i };
    }
    value += char;
  }
  return null;
}

function parseJsonStringValueLenient(text: string, startIndex: number) {
  let value = "";
  let escaped = false;
  for (let i = startIndex + 1; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) {
      switch (char) {
        case "n":
          value += "\n";
          break;
        case "r":
          value += "\r";
          break;
        case "t":
          value += "\t";
          break;
        case "\"":
          value += "\"";
          break;
        case "\\":
          value += "\\";
          break;
        case "u": {
          const hex = text.slice(i + 1, i + 5);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            value += String.fromCharCode(parseInt(hex, 16));
            i += 4;
          }
          break;
        }
        default:
          value += char;
      }
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      return { value, endIndex: i, complete: true };
    }
    value += char;
  }
  return { value, endIndex: text.length - 1, complete: false };
}

function extractStringField(rawText: string, field: string) {
  const fieldIndex = rawText.indexOf(`"${field}"`);
  if (fieldIndex === -1) {
    return null;
  }
  const colonIndex = rawText.indexOf(":", fieldIndex);
  if (colonIndex === -1) {
    return null;
  }
  const quoteIndex = rawText.indexOf("\"", colonIndex + 1);
  if (quoteIndex === -1) {
    return null;
  }
  const parsed = parseJsonStringValue(rawText, quoteIndex);
  return parsed ? parsed.value : null;
}

function extractStringFieldLenient(rawText: string, field: string) {
  const fieldIndex = rawText.indexOf(`"${field}"`);
  if (fieldIndex === -1) {
    return null;
  }
  const colonIndex = rawText.indexOf(":", fieldIndex);
  if (colonIndex === -1) {
    return null;
  }
  const quoteIndex = rawText.indexOf("\"", colonIndex + 1);
  if (quoteIndex === -1) {
    return null;
  }
  const parsed = parseJsonStringValueLenient(rawText, quoteIndex);
  return parsed ? parsed.value : null;
}

function extractFlagsField(rawText: string) {
  const match = rawText.match(/"flags"\s*:\s*(\[[\s\S]*?\])/);
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function fallbackParse(rawText: string) {
  const template_id = extractStringField(rawText, "template_id");
  const observations = extractStringField(rawText, "observations");
  const disclaimer = extractStringField(rawText, "disclaimer");
  const patient_name = extractStringField(rawText, "patient_name");
  const patient_gender = extractStringField(rawText, "patient_gender");
  const exam_date = extractStringField(rawText, "exam_date");
  const conclusion = extractStringField(rawText, "conclusion");
  const flags = extractFlagsField(rawText);
  const fields: Record<string, string> = {};
  for (const key of USG_FIELD_KEYS) {
    const value = extractStringField(rawText, key as string);
    if (value) {
      fields[key as string] = value;
    }
  }

  if (
    !template_id &&
    !observations &&
    !disclaimer &&
    !patient_name &&
    !patient_gender &&
    !exam_date &&
    !conclusion &&
    !flags &&
    Object.keys(fields).length === 0
  ) {
    return null;
  }

  return {
    template_id,
    observations,
    disclaimer,
    patient_name,
    patient_gender,
    exam_date,
    conclusion,
    flags,
    fields: Object.keys(fields).length ? fields : undefined
  };
}

function fallbackParseLenient(rawText: string) {
  const template_id = extractStringFieldLenient(rawText, "template_id");
  const observations = extractStringFieldLenient(rawText, "observations");
  const disclaimer = extractStringFieldLenient(rawText, "disclaimer");
  const patient_name = extractStringFieldLenient(rawText, "patient_name");
  const patient_gender = extractStringFieldLenient(rawText, "patient_gender");
  const exam_date = extractStringFieldLenient(rawText, "exam_date");
  const conclusion = extractStringFieldLenient(rawText, "conclusion");
  const flags = extractFlagsField(rawText);
  const fields: Record<string, string> = {};
  for (const key of USG_FIELD_KEYS) {
    const value = extractStringFieldLenient(rawText, key as string);
    if (value) {
      fields[key as string] = value;
    }
  }

  if (
    !template_id &&
    !observations &&
    !disclaimer &&
    !patient_name &&
    !patient_gender &&
    !exam_date &&
    !conclusion &&
    !flags &&
    Object.keys(fields).length === 0
  ) {
    return null;
  }

  return {
    template_id,
    observations,
    disclaimer,
    patient_name,
    patient_gender,
    exam_date,
    conclusion,
    flags,
    fields: Object.keys(fields).length ? fields : undefined
  };
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
      const repaired = escapeNewlinesInsideJsonStrings(sanitized);
      try {
        return extractJson(repaired);
      } catch {
        return fallbackParse(repaired) ?? fallbackParseLenient(repaired);
      }
    }
  }
}

function getFieldValue(source: Record<string, unknown> | null, keys: string[]) {
  if (!source) return "";
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

function buildUsgFieldOverrides(parsed: Record<string, unknown>) {
  const source =
    parsed.fields && typeof parsed.fields === "object"
      ? (parsed.fields as Record<string, unknown>)
      : parsed;

  const overrides: UsgFieldOverrides = {
    liver_main: getFieldValue(source, ["liver_main", "liverMain"]),
    liver_focal_lesion: getFieldValue(source, [
      "liver_focal_lesion",
      "liverFocalLesion"
    ]),
    liver_hepatic_veins: getFieldValue(source, [
      "liver_hepatic_veins",
      "liverHepaticVeins",
      "hepatic_veins",
      "hepaticVeins"
    ]),
    liver_ihbr: getFieldValue(source, ["liver_ihbr", "liverIhbr"]),
    liver_portal_vein: getFieldValue(source, [
      "liver_portal_vein",
      "liverPortalVein"
    ]),
    gallbladder_main: getFieldValue(source, [
      "gallbladder_main",
      "gallBladderMain",
      "gall_bladder_main"
    ]),
    gallbladder_calculus_sludge: getFieldValue(source, [
      "gallbladder_calculus_sludge",
      "gallBladderCalculusSludge",
      "gall_bladder_calculus_sludge"
    ]),
    cbd_main: getFieldValue(source, [
      "cbd_main",
      "cbdMain",
      "cbd",
      "common_bile_duct"
    ]),
    pancreas_main: getFieldValue(source, ["pancreas_main", "pancreasMain"]),
    pancreas_echotexture: getFieldValue(source, [
      "pancreas_echotexture",
      "pancreasEchotexture"
    ]),
    spleen_main: getFieldValue(source, ["spleen_main", "spleenMain"]),
    spleen_focal_lesion: getFieldValue(source, [
      "spleen_focal_lesion",
      "spleenFocalLesion"
    ]),
    kidneys_size: getFieldValue(source, [
      "kidneys_size",
      "kidney_size",
      "kidneysSize",
      "kidneySize"
    ]),
    kidneys_main: getFieldValue(source, ["kidneys_main", "kidneysMain"]),
    kidneys_cmd: getFieldValue(source, ["kidneys_cmd", "kidneysCmd", "cmd"]),
    kidneys_cortical_scarring: getFieldValue(source, [
      "kidneys_cortical_scarring",
      "kidneysCorticalScarring",
      "cortical_scarring"
    ]),
    kidneys_parenchyma: getFieldValue(source, [
      "kidneys_parenchyma",
      "kidneysParenchyma",
      "parenchyma"
    ]),
    kidneys_calculus_hydronephrosis: getFieldValue(source, [
      "kidneys_calculus_hydronephrosis",
      "kidneysCalculusHydronephrosis",
      "renal_calculus_hydronephrosis"
    ]),
    bladder_main: getFieldValue(source, ["bladder_main", "bladderMain"]),
    bladder_mass_calculus: getFieldValue(source, [
      "bladder_mass_calculus",
      "bladderMassCalculus"
    ]),
    prostate_main: getFieldValue(source, ["prostate_main", "prostateMain"]),
    prostate_echotexture: getFieldValue(source, [
      "prostate_echotexture",
      "prostateEchotexture"
    ]),
    uterus_main: getFieldValue(source, ["uterus_main", "uterusMain"]),
    uterus_myometrium: getFieldValue(source, [
      "uterus_myometrium",
      "uterusMyometrium",
      "myometrium"
    ]),
    endometrium_measurement_mm: getFieldValue(source, [
      "endometrium_measurement_mm",
      "endometriumMeasurementMm",
      "endometrium_mm"
    ]),
    ovaries_main: getFieldValue(source, ["ovaries_main", "ovariesMain"]),
    adnexal_mass: getFieldValue(source, ["adnexal_mass", "adnexalMass"]),
    peritoneal_fluid: getFieldValue(source, [
      "peritoneal_fluid",
      "peritonealFluid",
      "free_fluid"
    ]),
    lymph_nodes: getFieldValue(source, ["lymph_nodes", "lymphNodes"]),
    impression: getFieldValue(source, ["impression", "conclusion"]),
    correlate_clinically: getFieldValue(source, [
      "correlate_clinically",
      "correlateClinically"
    ])
  };

  return overrides;
}

function hasAllUsgFieldKeys(fields: unknown) {
  if (!fields || typeof fields !== "object") {
    return false;
  }
  return USG_FIELD_KEYS.every((key) =>
    Object.prototype.hasOwnProperty.call(fields, key)
  );
}

function normalizeAudioMimeType(file: File) {
  const trimmed = (file.type || "").trim();
  if (trimmed) {
    const base = trimmed.split(";")[0]?.trim() || trimmed;
    if (base === "video/webm") return "audio/webm";
    if (base === "video/mp4") return "audio/mp4";
    if (base === "audio/x-m4a") return "audio/mp4";
    if (base === "audio/x-wav" || base === "audio/wave") return "audio/wav";
    return base;
  }
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".wav")) return "audio/wav";
  if (name.endsWith(".mp3")) return "audio/mpeg";
  if (name.endsWith(".m4a")) return "audio/mp4";
  if (name.endsWith(".mp4")) return "audio/mp4";
  if (name.endsWith(".webm")) return "audio/webm";
  if (name.endsWith(".ogg")) return "audio/ogg";
  return "";
}

function normalizeGender(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  if (["male", "m", "man", "boy"].includes(trimmed)) return "male";
  if (["female", "f", "woman", "girl"].includes(trimmed)) return "female";
  return "";
}

function genderLabelFromKey(gender: UsgGender) {
  return gender === "female" ? "Female" : "Male";
}

function isUsgTemplateId(templateId: string) {
  return templateId === "USG_ABDOMEN_MALE" || templateId === "USG_ABDOMEN_FEMALE";
}

function templateGenderFromId(templateId: string): UsgGender {
  return templateId === "USG_ABDOMEN_FEMALE" ? "female" : "male";
}

async function callGemini(params: {
  apiKey: string;
  userText: string;
  systemText: string;
  audioBase64: string;
  mimeType: string;
  maxOutputTokens?: number;
  temperature?: number;
}) {
  const combinedText = `${params.systemText}\n\n${params.userText}`;
  let data: any = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const generationConfig: Record<string, unknown> = {
      temperature: params.temperature ?? 0.2,
      maxOutputTokens: params.maxOutputTokens ?? 2048
    };
    if (GEMINI_SUPPORTS_RESPONSE_MIME_TYPE !== false) {
      generationConfig.responseMimeType = "application/json";
    }

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
              parts: [
                { text: combinedText },
                {
                  inlineData: {
                    mimeType: params.mimeType,
                    data: params.audioBase64
                  }
                }
              ]
            }
          ],
          generationConfig
        })
      }
    );

    if (response.ok) {
      data = await response.json();
      if (GEMINI_SUPPORTS_RESPONSE_MIME_TYPE == null) {
        GEMINI_SUPPORTS_RESPONSE_MIME_TYPE = true;
      }
      break;
    }

    const errorText = await response.text();
    if (
      response.status === 400 &&
      GEMINI_SUPPORTS_RESPONSE_MIME_TYPE !== false &&
      /responseMimeType/i.test(errorText)
    ) {
      GEMINI_SUPPORTS_RESPONSE_MIME_TYPE = false;
      continue;
    }
    if (attempt === 0 && (response.status === 500 || response.status === 503)) {
      if (DEBUG_GEMINI_LOG) {
        console.log(
          "[gemini] transient error, retrying:",
          response.status,
          errorText
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 650));
      continue;
    }
    throw new Error(`Gemini API error: ${response.status} ${errorText}`);
  }

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

  const formData = await request.formData();
  const templateId = formData.get("template_id")?.toString();
  const audioFile = formData.get("audio_file");

  if (!templateId) {
    return NextResponse.json({ error: "template_id is required." }, { status: 400 });
  }

  const template = getTemplateById(templateId);
  if (!template) {
    return NextResponse.json({ error: "Unknown template_id." }, { status: 400 });
  }

  if (!audioFile || !(audioFile instanceof File)) {
    return NextResponse.json({ error: "audio_file is required." }, { status: 400 });
  }

  if (audioFile.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: "Audio file exceeds 12MB." },
      { status: 413 }
    );
  }

  const mimeType = normalizeAudioMimeType(audioFile);
  if (!mimeType || !mimeType.startsWith("audio/")) {
    return NextResponse.json(
      {
        error:
          "Unsupported audio type. Please upload a .wav, .mp3, .m4a, .mp4, .webm, or .ogg file."
      },
      { status: 400 }
    );
  }

  const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
  const audioBase64 = audioBuffer.toString("base64");

  const isUsg = isUsgTemplateId(template.id);
  const templateGender = isUsg ? templateGenderFromId(template.id) : "male";
  const usgTemplateText =
    templateGender === "female"
      ? USG_ABDOMEN_FEMALE_TEMPLATE
      : USG_ABDOMEN_MALE_TEMPLATE;

  const systemText = isUsg
    ? `You are a radiology documentation assistant. Follow strict rules and output JSON only.\n\nSTRICT RULES:\n- Return JSON only. No markdown, no code fences.\n- Use the provided USG Whole Abdomen template for context, but do NOT output it directly.\n- Output MUST include the full fields object with ALL keys present. Do NOT omit keys.\n- Fill ONLY the fields object, patient_name, patient_gender, and exam_date.\n- If a field is not explicitly mentioned, return an empty string for that field.\n- Strings must be valid JSON (no unescaped newlines).\n- If uncertain, write "[Unclear - needs review]" and add a flag.\n- For endometrium_measurement_mm, return numbers only (no units).\n\nReturn JSON ONLY with schema:\n{\n  "template_id": "${template.id}",\n  "patient_name": "",\n  "patient_gender": "",\n  "exam_date": "",\n  "fields": {\n    "liver_main": "",\n    "liver_focal_lesion": "",\n    "liver_hepatic_veins": "",\n    "liver_ihbr": "",\n    "liver_portal_vein": "",\n    "gallbladder_main": "",\n    "gallbladder_calculus_sludge": "",\n    "cbd_main": "",\n    "pancreas_main": "",\n    "pancreas_echotexture": "",\n    "spleen_main": "",\n    "spleen_focal_lesion": "",\n    "kidneys_size": "",\n    "kidneys_main": "",\n    "kidneys_cmd": "",\n    "kidneys_cortical_scarring": "",\n    "kidneys_parenchyma": "",\n    "kidneys_calculus_hydronephrosis": "",\n    "bladder_main": "",\n    "bladder_mass_calculus": "",\n    "prostate_main": "",\n    "prostate_echotexture": "",\n    "uterus_main": "",\n    "uterus_myometrium": "",\n    "endometrium_measurement_mm": "",\n    "ovaries_main": "",\n    "adnexal_mass": "",\n    "peritoneal_fluid": "",\n    "lymph_nodes": "",\n    "impression": "",\n    "correlate_clinically": ""\n  },\n  "flags": [],\n  "disclaimer": "${DEFAULT_DISCLAIMER}"\n}`
    : `You are a radiology documentation assistant. Follow strict rules and output JSON only.\n\nSTRICT RULES:\n- Output must contain ONLY OBSERVATIONS / FINDINGS.\n- Do NOT include Impression, Conclusion, Diagnosis, Advice, Plan, or Recommendations.\n- Do NOT add normal findings unless explicitly spoken in the audio.\n- Do NOT infer missing info. If uncertain, write "[Unclear - needs review]" and add a flag.\n- Pay special attention to negations, laterality, and measurements/units.\n\nReturn JSON ONLY with schema:\n{\n  "template_id": "...",\n  "observations": "...",\n  "flags": ["..."],\n  "disclaimer": "${DEFAULT_DISCLAIMER}"\n}`;

  const userText = isUsg
    ? `Template: ${template.title} (${template.id})\nAllowed topics: ${template.allowedTopics.join(", ")}\nPreferred order: ${template.headings?.join(" > ") || "Use logical order"}\n\nPATIENT INFO:\n- patient_name: full patient name as spoken (if mentioned)\n- patient_gender: male/female as spoken (if mentioned)\n- exam_date: date as spoken (if mentioned)\n\nFIELD GUIDANCE (values plug into the report builder):\n- liver_main: sentence/phrase describing liver size/echotexture\n- liver_focal_lesion: full sentence\n- liver_hepatic_veins: full sentence\n- liver_ihbr: full sentence\n- liver_portal_vein: full sentence\n- gallbladder_main: sentence/phrase describing wall/contour\n- gallbladder_calculus_sludge: full sentence\n- cbd_main: full sentence (e.g., "CBD is normal." or "CBD measures 6 mm and is normal.")\n- pancreas_main: sentence/phrase for size/shape/contour\n- pancreas_echotexture: full sentence\n- spleen_main: sentence/phrase\n- spleen_focal_lesion: full sentence\n- kidneys_size: include right/left measurements if mentioned (e.g., "Right Kidney    : 116x46 mm      Left kidney   :   105x52 mm")\n- kidneys_main: full sentence\n- kidneys_cmd: full sentence\n- kidneys_cortical_scarring: full sentence\n- kidneys_parenchyma: full sentence\n- kidneys_calculus_hydronephrosis: full sentence\n- bladder_main: sentence/phrase\n- bladder_mass_calculus: full sentence\n- prostate_main: full sentence (male only)\n- prostate_echotexture: full sentence (male only)\n- uterus_main: full sentence (female only)\n- uterus_myometrium: full sentence (female only)\n- endometrium_measurement_mm: number only (female only)\n- ovaries_main: full sentence (female only)\n- adnexal_mass: full sentence (female only)\n- peritoneal_fluid: full sentence\n- lymph_nodes: full sentence\n- impression: conclusion or significant findings sentence if mentioned; empty if not mentioned\n- correlate_clinically: "Please correlate clinically." if dictated; empty if not mentioned\n\nAllowed field keys: ${USG_FIELD_KEYS.join(", ")}\n\nUSG WHOLE ABDOMEN TEMPLATE (for context only; do not output directly):\n${usgTemplateText}\n`
    : `Template: ${template.title} (${template.id})\nAllowed topics: ${template.allowedTopics.join(", ")}\nPreferred order: ${template.headings?.join(" > ") || "Use logical order"}\n\nForbidden output sections: Impression, Conclusion, Diagnosis, Advice, Plan, Recommendations.\nOnly return OBSERVATIONS / FINDINGS.\n\nDo NOT add facts that are not explicitly spoken in the audio.`;

  let rawText: string;
  let debugRawText: string | null = null;

  try {
    rawText = await callGemini({
      apiKey,
      userText,
      systemText,
      audioBase64,
      mimeType,
      maxOutputTokens: isUsg ? 4096 : 2048,
      temperature: 0.2
    });
    debugRawText = rawText;
    if (DEBUG_GEMINI_LOG) {
      console.log("[gemini] raw response:", rawText);
    }
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Gemini request failed." },
      { status: 500 }
    );
  }

  let parsed = parseModelJson(rawText);
  if (!parsed) {
    try {
      const retryText = await callGemini({
        apiKey,
        userText: `${userText}\n\nRETURN VALID JSON ONLY. No markdown or code fences.`,
        systemText,
        audioBase64,
        mimeType,
        maxOutputTokens: isUsg ? 4096 : 2048,
        temperature: 0.2
      });
      debugRawText = retryText;
      if (DEBUG_GEMINI_LOG) {
        console.log("[gemini] retry raw response:", retryText);
      }
      parsed = parseModelJson(retryText);
    } catch {
      // handled below
    }
  }

  if (!parsed) {
    const errorPayload: { error: string; debug?: { rawText: string } } = {
      error: "Gemini returned invalid JSON."
    };
    if (DEBUG_GEMINI_CLIENT && debugRawText) {
      errorPayload.debug = { rawText: debugRawText };
    }
    return NextResponse.json(errorPayload, { status: 500 });
  }

  if (isUsg && !hasAllUsgFieldKeys((parsed as Record<string, unknown>).fields)) {
    try {
      const retryText = await callGemini({
        apiKey,
        userText: `${userText}\n\nRETURN VALID JSON ONLY. INCLUDE ALL fields KEYS EVEN IF EMPTY. DO NOT OMIT ANY KEY.`,
        systemText,
        audioBase64,
        mimeType,
        maxOutputTokens: isUsg ? 4096 : 2048,
        temperature: 0.2
      });
      debugRawText = retryText;
      if (DEBUG_GEMINI_LOG) {
        console.log("[gemini] retry raw response:", retryText);
      }
      const retryParsed = parseModelJson(retryText);
      if (retryParsed) {
        parsed = retryParsed;
      }
    } catch {
      // keep original parsed
    }
  }

  if (DEBUG_GEMINI_LOG) {
    console.log("[gemini] parsed response:", parsed);
  }

  let observationsRaw = "";
  const flagsRaw = Array.isArray(parsed?.flags)
    ? parsed.flags.map((flag: unknown) => String(flag))
    : [];
  const extraFlags: string[] = [];

  if (isUsg) {
    const overrides = buildUsgFieldOverrides(parsed as Record<string, unknown>);

    const patientSource = parsed as Record<string, unknown>;
    const rawPatientName = getFieldValue(patientSource, [
      "patient_name",
      "patientName",
      "name"
    ]);
    const rawPatientGender = getFieldValue(patientSource, [
      "patient_gender",
      "patientGender",
      "gender",
      "sex"
    ]);
    const rawExamDate = getFieldValue(patientSource, [
      "exam_date",
      "examDate",
      "date"
    ]);

    const normalizedGender = normalizeGender(rawPatientGender);
    let effectiveGender = templateGender;
    if (normalizedGender) {
      effectiveGender = normalizedGender as UsgGender;
      if (effectiveGender !== templateGender) {
        extraFlags.push(
          `Gender mismatch: template=${genderLabelFromKey(
            templateGender
          )}, audio=${genderLabelFromKey(effectiveGender)}`
        );
      }
    } else if (rawPatientGender.trim()) {
      extraFlags.push("Patient gender unclear; using template gender");
    }

    observationsRaw = buildUsgReport({
      gender: effectiveGender,
      patient: {
        name: rawPatientName,
        gender: genderLabelFromKey(effectiveGender),
        date: rawExamDate
      },
      overrides
    });
  } else {
    observationsRaw =
      typeof (parsed as any)?.observations === "string"
        ? (parsed as any).observations
        : "";
  }

  const disclaimerRaw =
    typeof parsed?.disclaimer === "string" && parsed.disclaimer.trim()
      ? parsed.disclaimer
      : DEFAULT_DISCLAIMER;

  const sanitized = isUsg
    ? { text: observationsRaw, removed: false }
    : sanitizeObservations(observationsRaw, FORBIDDEN_HEADERS);
  const emptyObservations = !sanitized.text.trim();
  const flagsRawWithExtra = [...flagsRaw, ...extraFlags];
  const flags = sanitized.removed
    ? Array.from(new Set(["Removed forbidden section", ...flagsRawWithExtra]))
    : flagsRawWithExtra;
  const finalFlags = emptyObservations
    ? Array.from(new Set(["No clear findings detected in audio", ...flags]))
    : flags;

  const responsePayload: {
    template_id: string;
    observations: string;
    flags: string[];
    disclaimer: string;
    debug?: { rawText: string };
  } = {
    template_id: template.id,
    observations: emptyObservations
      ? "[Unclear - needs review]"
      : sanitized.text,
    flags: finalFlags,
    disclaimer: disclaimerRaw
  };

  if (DEBUG_GEMINI_CLIENT && debugRawText) {
    responsePayload.debug = {
      rawText: debugRawText
    };
  }

  return NextResponse.json(responsePayload);
}
