import { Buffer } from "buffer";
import { NextRequest, NextResponse } from "next/server";
import { getTemplateById } from "@/lib/templates";
import { rateLimit } from "@/lib/rateLimit";
import {
  buildUsgReport,
  USG_ABDOMEN_TEMPLATE,
  USG_DEFAULT_FIELDS,
  USG_FIELD_KEYS,
  type UsgFieldOverrides,
  type UsgSectionAdditions
} from "@/lib/usgTemplate";
import {
  type UsgBlockId,
  USG_BLOCKS,
  containsLaterality,
  extractSectionByHeading,
  replaceSectionByHeading,
  wordCount
} from "@/lib/usg/blocks";

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
  const match = rawText.match(/"flags"\\s*:\\s*(\\[[\\s\\S]*?\\])/);
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
    !flags &&
    Object.keys(fields).length === 0
  ) {
    return null;
  }

  return {
    template_id,
    observations,
    disclaimer,
    flags,
    fields: Object.keys(fields).length ? fields : undefined
  };
}

function fallbackParseLenient(rawText: string) {
  const template_id = extractStringFieldLenient(rawText, "template_id");
  const observations = extractStringFieldLenient(rawText, "observations");
  const disclaimer = extractStringFieldLenient(rawText, "disclaimer");
  const flags = extractFlagsField(rawText);
  const fields: Record<string, string> = {};
  for (const key of USG_FIELD_KEYS) {
    const value = extractStringFieldLenient(rawText, key as string);
    if (value) {
      fields[key as string] = value;
    }
  }
  const sectionKeys = [
    "liver",
    "gallBladder",
    "gall_bladder",
    "gallbladder",
    "commonBileDuct",
    "common_bile_duct",
    "cbd",
    "pancreas",
    "spleen",
    "kidneys",
    "kidney",
    "adrenalGlands",
    "adrenal_glands",
    "adrenals",
    "urinaryBladder",
    "urinary_bladder",
    "bladder",
    "prostateUterusAdnexa",
    "prostate_uterus_adnexa",
    "prostateUterus",
    "uterusAdnexa",
    "aortaIvc",
    "aorta_ivc",
    "aortaAndIvc",
    "bowelLoops",
    "bowel_loops",
    "peritonealCavity",
    "peritoneal_cavity",
    "impression"
  ];

  const sections: Record<string, string> = {};
  for (const key of sectionKeys) {
    const value = extractStringFieldLenient(rawText, key);
    if (value) {
      sections[key] = value;
    }
  }

  if (
    !template_id &&
    !observations &&
    !disclaimer &&
    !flags &&
    Object.keys(sections).length === 0 &&
    Object.keys(fields).length === 0
  ) {
    return null;
  }

  return {
    template_id,
    observations,
    disclaimer,
    flags,
    sections: Object.keys(sections).length ? sections : undefined,
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

function getSectionValue(
  source: Record<string, unknown> | null,
  keys: string[]
) {
  if (!source) return "";
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

function getFieldValue(
  source: Record<string, unknown> | null,
  keys: string[]
) {
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
    liver_main: getFieldValue(source, [
      "liver_main",
      "liverMain"
    ]),
    liver_focal_lesion: getFieldValue(source, [
      "liver_focal_lesion",
      "liverFocalLesion"
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
      "gallBladderCalculusSludge"
    ]),
    gallbladder_pericholecystic_fluid: getFieldValue(source, [
      "gallbladder_pericholecystic_fluid",
      "gallBladderPericholecysticFluid"
    ]),
    cbd_caliber: getFieldValue(source, ["cbd_caliber", "cbdCaliber"]),
    cbd_measurement_mm: getFieldValue(source, [
      "cbd_measurement_mm",
      "cbdMeasurementMm"
    ]),
    cbd_intraluminal_calculus: getFieldValue(source, [
      "cbd_intraluminal_calculus",
      "cbdIntraluminalCalculus"
    ]),
    pancreas_main: getFieldValue(source, [
      "pancreas_main",
      "pancreasMain"
    ]),
    pancreas_focal_lesion: getFieldValue(source, [
      "pancreas_focal_lesion",
      "pancreasFocalLesion"
    ]),
    pancreas_duct: getFieldValue(source, [
      "pancreas_duct",
      "pancreasDuct"
    ]),
    spleen_size: getFieldValue(source, ["spleen_size", "spleenSize"]),
    spleen_measurement_cm: getFieldValue(source, [
      "spleen_measurement_cm",
      "spleenMeasurementCm"
    ]),
    spleen_echotexture: getFieldValue(source, [
      "spleen_echotexture",
      "spleenEchotexture"
    ]),
    spleen_focal_lesion: getFieldValue(source, [
      "spleen_focal_lesion",
      "spleenFocalLesion"
    ]),
    kidneys_main: getFieldValue(source, [
      "kidneys_main",
      "kidneysMain"
    ]),
    kidneys_cmd: getFieldValue(source, [
      "kidneys_cmd",
      "kidneysCmd"
    ]),
    kidneys_calculus_hydronephrosis: getFieldValue(source, [
      "kidneys_calculus_hydronephrosis",
      "kidneysCalculusHydronephrosis"
    ]),
    adrenal_main: getFieldValue(source, [
      "adrenal_main",
      "adrenalMain"
    ]),
    bladder_main: getFieldValue(source, [
      "bladder_main",
      "bladderMain"
    ]),
    bladder_mass_calculus: getFieldValue(source, [
      "bladder_mass_calculus",
      "bladderMassCalculus"
    ]),
    prostate_main: getFieldValue(source, [
      "prostate_main",
      "prostateMain"
    ]),
    prostate_measurement_g: getFieldValue(source, [
      "prostate_measurement_g",
      "prostateMeasurementG"
    ]),
    prostate_focal_lesion: getFieldValue(source, [
      "prostate_focal_lesion",
      "prostateFocalLesion"
    ]),
    uterus_main: getFieldValue(source, [
      "uterus_main",
      "uterusMain"
    ]),
    uterus_myometrium: getFieldValue(source, [
      "uterus_myometrium",
      "uterusMyometrium"
    ]),
    endometrium_measurement_mm: getFieldValue(source, [
      "endometrium_measurement_mm",
      "endometriumMeasurementMm"
    ]),
    ovaries_main: getFieldValue(source, [
      "ovaries_main",
      "ovariesMain"
    ]),
    adnexal_mass: getFieldValue(source, [
      "adnexal_mass",
      "adnexalMass"
    ]),
    aorta_ivc_main: getFieldValue(source, [
      "aorta_ivc_main",
      "aortaIvcMain"
    ]),
    bowel_loops_main: getFieldValue(source, [
      "bowel_loops_main",
      "bowelLoopsMain"
    ]),
    peritoneal_fluid: getFieldValue(source, [
      "peritoneal_fluid",
      "peritonealFluid"
    ]),
    impression: getFieldValue(source, ["impression"])
  };

  return overrides;
}

function buildUsgAdditions(parsed: Record<string, unknown>) {
  const source =
    parsed.sections && typeof parsed.sections === "object"
      ? (parsed.sections as Record<string, unknown>)
      : null;

  const additions: UsgSectionAdditions = {
    liver: getSectionValue(source, ["liver"]),
    gallBladder: getSectionValue(source, [
      "gallBladder",
      "gall_bladder",
      "gallbladder"
    ]),
    commonBileDuct: getSectionValue(source, [
      "commonBileDuct",
      "common_bile_duct",
      "cbd"
    ]),
    pancreas: getSectionValue(source, ["pancreas"]),
    spleen: getSectionValue(source, ["spleen"]),
    kidneys: getSectionValue(source, ["kidneys", "kidney"]),
    adrenalGlands: getSectionValue(source, [
      "adrenalGlands",
      "adrenal_glands",
      "adrenals"
    ]),
    urinaryBladder: getSectionValue(source, [
      "urinaryBladder",
      "urinary_bladder",
      "bladder"
    ]),
    prostateUterusAdnexa: getSectionValue(source, [
      "prostateUterusAdnexa",
      "prostate_uterus_adnexa",
      "prostateUterus",
      "uterusAdnexa"
    ]),
    aortaIvc: getSectionValue(source, [
      "aortaIvc",
      "aorta_ivc",
      "aortaAndIvc"
    ]),
    bowelLoops: getSectionValue(source, ["bowelLoops", "bowel_loops"]),
    peritonealCavity: getSectionValue(source, [
      "peritonealCavity",
      "peritoneal_cavity"
    ]),
    impression: getSectionValue(source, ["impression"])
  };

  return additions;
}

function hasFieldOverrides(overrides: UsgFieldOverrides) {
  return Object.values(overrides).some(
    (value) => typeof value === "string" && value.trim()
  );
}

function hasAllUsgFieldKeys(fields: unknown) {
  if (!fields || typeof fields !== "object") {
    return false;
  }
  return USG_FIELD_KEYS.every((key) =>
    Object.prototype.hasOwnProperty.call(fields, key)
  );
}

const USG_BLOCK_ID_SET = new Set<UsgBlockId>(USG_BLOCKS.map((block) => block.id));
const USG_FIELD_KEY_SET = new Set<string>(USG_FIELD_KEYS as unknown as string[]);

function parseUsgBlockIdArray(value: unknown) {
  if (!Array.isArray(value)) {
    return new Set<UsgBlockId>();
  }
  const out = new Set<UsgBlockId>();
  for (const entry of value) {
    const blockId = String(entry) as UsgBlockId;
    if (USG_BLOCK_ID_SET.has(blockId)) {
      out.add(blockId);
    }
  }
  return out;
}

function parseUsgFieldKeyArray(value: unknown) {
  if (!Array.isArray(value)) {
    return new Set<keyof UsgFieldOverrides>();
  }
  const out = new Set<keyof UsgFieldOverrides>();
  for (const entry of value) {
    const key = String(entry);
    if (USG_FIELD_KEY_SET.has(key)) {
      out.add(key as keyof UsgFieldOverrides);
    }
  }
  return out;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stripRedundantPhrases(value: string, phrases: RegExp[]) {
  let out = value;
  for (const phrase of phrases) {
    out = out.replace(phrase, " ");
  }
  out = normalizeWhitespace(out);
  out = out.replace(/^[,.;:)\]]+/, "").trim();
  out = out.replace(/[(\[]+$/, "").trim();
  return out;
}

function normalizeNumericString(value: string) {
  const match = value.match(/-?\d+(?:\.\d+)?/);
  return match ? match[0] : "";
}

function normalizeUsgFields(overrides: UsgFieldOverrides) {
  const next: UsgFieldOverrides = { ...overrides };
  let changed = false;

  const setIfChanged = (key: keyof UsgFieldOverrides, value: string) => {
    const previous = overrides[key] || "";
    if (value !== previous) {
      next[key] = value;
      changed = true;
    }
  };

  const phraseClean = (
    key: keyof UsgFieldOverrides,
    phrases: RegExp[]
  ) => {
    const value = overrides[key];
    if (typeof value !== "string" || !value.trim()) return;
    const cleaned = stripRedundantPhrases(value, phrases);
    if (cleaned) {
      setIfChanged(key, cleaned);
    }
  };

  const sentenceClean = (
    key: keyof UsgFieldOverrides,
    phrases: RegExp[] = []
  ) => {
    const value = overrides[key];
    if (typeof value !== "string" || !value.trim()) return;
    const cleaned = stripRedundantPhrases(value, phrases);
    if (cleaned) {
      setIfChanged(key, cleaned);
    }
  };

  const numericClean = (key: keyof UsgFieldOverrides) => {
    const value = overrides[key];
    if (typeof value !== "string" || !value.trim()) return;
    const cleaned = normalizeNumericString(value);
    if (cleaned) {
      setIfChanged(key, cleaned);
    }
  };

  // Phrase slots: remove surrounding template words if model includes them.
  phraseClean("liver_main", [
    /\bthe\s+liver\s+is\b/gi,
    /\bwith\s+smooth\s+margins\b/gi
  ]);
  sentenceClean("liver_focal_lesion", [/\bthe\s+liver\b/gi]);
  phraseClean("liver_ihbr", [
    /\b(intrahepatic\s+)?biliary\s+radicles\s+are\b/gi,
    /\bihbr\b/gi
  ]);
  phraseClean("liver_portal_vein", [/\bportal\s+vein\s+is\b/gi]);

  phraseClean("gallbladder_main", [
    /\bthe\s+gall\s*bladder\s+is\b/gi,
    /\bthe\s+gall\s+bladder\s+is\b/gi
  ]);
  sentenceClean("gallbladder_calculus_sludge", [
    /\bthe\s+gall\s*bladder\b/gi,
    /\bthe\s+gall\s+bladder\b/gi
  ]);
  sentenceClean("gallbladder_pericholecystic_fluid");

  phraseClean("cbd_caliber", [
    /\b(common\s+bile\s+duct|cbd)\s+is\b/gi,
    /\bmeasures?\b/gi
  ]);
  if (typeof overrides.cbd_caliber === "string" && overrides.cbd_caliber.trim()) {
    const normalized = normalizeWhitespace(overrides.cbd_caliber);
    if (
      /^(no|not)\s+dilat(ed|ation)\b/i.test(normalized) ||
      /\bnot\s+dilated\b/i.test(normalized)
    ) {
      setIfChanged("cbd_caliber", "normal in caliber");
    }
  }
  numericClean("cbd_measurement_mm");
  sentenceClean("cbd_intraluminal_calculus");

  phraseClean("pancreas_main", [/\bthe\s+pancreas\s+is\b/gi]);
  phraseClean("pancreas_focal_lesion", [/\bwith\b/gi]);
  phraseClean("pancreas_duct", [/\bpancreatic\s+duct\s+is\b/gi]);

  phraseClean("spleen_size", [
    /\bthe\s+spleen\s+is\b/gi,
    /\bin\s+size\b/gi
  ]);
  numericClean("spleen_measurement_cm");
  phraseClean("spleen_echotexture", [
    /\becho\s*texture\b/gi,
    /\bechotexture\b/gi
  ]);
  sentenceClean("spleen_focal_lesion");

  phraseClean("kidneys_main", [
    /\bboth\s+kidneys\s+are\b/gi,
    /\bright\s+kidney\b/gi,
    /\bleft\s+kidney\b/gi
  ]);
  phraseClean("kidneys_cmd", [
    /\bcorticomedullary\s+differentiation\b/gi,
    /\bcmd\b/gi
  ]);
  sentenceClean("kidneys_calculus_hydronephrosis");

  phraseClean("adrenal_main", [
    /\bboth\s+adrenal\s+glands\s+appear\b/gi
  ]);

  phraseClean("bladder_main", [
    /\bthe\s+urinary\s+bladder\s+is\b/gi,
    /\bwith\s+normal\s+wall\s+thickness\b/gi,
    /\bwall\s+thickness\s+normal\b/gi
  ]);
  sentenceClean("bladder_mass_calculus");

  phraseClean("prostate_main", [/\bprostate\s+gland\s+is\b/gi]);
  numericClean("prostate_measurement_g");
  phraseClean("prostate_focal_lesion", [/\bwith\b/gi]);

  phraseClean("uterus_main", [/\buterus\s+is\b/gi]);
  phraseClean("uterus_myometrium", [
    /\bmyometrial\s+echotexture\b/gi,
    /\bmyometrium\b/gi
  ]);
  numericClean("endometrium_measurement_mm");
  phraseClean("ovaries_main", [/\bboth\s+ovaries\s+are\b/gi]);
  sentenceClean("adnexal_mass");

  phraseClean("aorta_ivc_main", [
    /\b(abdominal\s+)?aorta\b/gi,
    /\bivc\b/gi,
    /\binferior\s+vena\s+cava\b/gi
  ]);
  phraseClean("bowel_loops_main", [/\bshow\b/gi, /\bthe\s+visualized\b/gi]);
  sentenceClean("peritoneal_fluid");
  sentenceClean("impression");

  return { overrides: next, changed };
}

function normalizeForCompare(value: string) {
  return value
    .toLowerCase()
    .replace(/[\r\n]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasNegation(value: string) {
  return /\b(no|not|without|absent|negative for)\b/i.test(value);
}

function parseFirstNumber(value: string) {
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

const USG_ABNORMAL_KEYWORDS = [
  "enlarged",
  "hepatomegaly",
  "splenomegaly",
  "shrunken",
  "atrophic",
  "reduced",
  "lost",
  "poor",
  "absent",
  "coarse",
  "heterogeneous",
  "fatty",
  "cirrh",
  "dilated",
  "dilatation",
  "thick",
  "thickened",
  "stone",
  "calculus",
  "sludge",
  "polyp",
  "mass",
  "lesion",
  "cyst",
  "hydronephrosis",
  "hydroureter",
  "thrombus",
  "thrombosis",
  "aneurysm",
  "ascites",
  "free fluid",
  "collection"
];

function fieldIsMeasurement(key: keyof UsgFieldOverrides) {
  return (
    key === "cbd_measurement_mm" ||
    key === "spleen_measurement_cm" ||
    key === "prostate_measurement_g" ||
    key === "endometrium_measurement_mm"
  );
}

function fieldIndicatesAbnormal(
  key: keyof UsgFieldOverrides,
  value: string
) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/\[unclear/i.test(trimmed)) return true;

  if (fieldIsMeasurement(key)) {
    return false;
  }

  const lowered = trimmed.toLowerCase();
  if (hasNegation(lowered)) {
    return false;
  }

  return USG_ABNORMAL_KEYWORDS.some((keyword) => lowered.includes(keyword));
}

function detectUsgServerSignals(overrides: UsgFieldOverrides) {
  const abnormal = new Set<UsgBlockId>();
  const complex = new Set<UsgBlockId>();
  const abnormalFields = new Set<keyof UsgFieldOverrides>();
  const mismatchNotes: string[] = [];

  for (const block of USG_BLOCKS) {
    let abnormalFieldCount = 0;
    let isComplex = false;

    for (const key of block.fieldKeys) {
      const raw = overrides[key] || "";
      const value = String(raw);
      if (!value.trim()) {
        continue;
      }

      if (containsLaterality(value)) {
        isComplex = true;
      }

      if (wordCount(value) > 14) {
        isComplex = true;
      }

      if (fieldIsMeasurement(key)) {
        const number = parseFirstNumber(value);
        if (number != null && block.measurementRange?.field === key) {
          const { min, max } = block.measurementRange;
          if ((min != null && number < min) || (max != null && number > max)) {
            abnormalFieldCount += 1;
            abnormalFields.add(key);
          }
        }
        continue;
      }

      const def = USG_DEFAULT_FIELDS[key] || "";
      if (normalizeForCompare(value) === normalizeForCompare(def)) {
        continue;
      }

      if (fieldIndicatesAbnormal(key, value)) {
        abnormalFieldCount += 1;
        abnormalFields.add(key);
      }
    }

    if (abnormalFieldCount > 0) {
      abnormal.add(block.id);
      if (abnormalFieldCount >= 2) {
        isComplex = true;
      }
    }

    if (isComplex) {
      complex.add(block.id);
    }
  }

  return { abnormal, complex, abnormalFields, mismatchNotes };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      await sleep(650);
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

async function callGeminiTextOnly(params: {
  apiKey: string;
  text: string;
  maxOutputTokens?: number;
  temperature?: number;
}) {
  let data: any = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const generationConfig: Record<string, unknown> = {
      temperature: params.temperature ?? 0.2,
      maxOutputTokens: params.maxOutputTokens ?? 512
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
              parts: [{ text: params.text }]
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
          "[gemini] transient error (text-only), retrying:",
          response.status,
          errorText
        );
      }
      await sleep(650);
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

  const isUsg = template.id === "USG_ABDOMEN";

  const systemText = isUsg
    ? `You are a radiology documentation assistant. Follow strict rules and output JSON only.\n\nSTRICT RULES:\n- Return JSON only. No markdown, no code fences.\n- Use the provided USG Whole Abdomen template for context, but do NOT output it directly.\n- Output MUST include the full fields object with ALL keys present. Do NOT omit keys.\n- Fill ONLY the fields object with short phrases/sentences that plug into the template.\n- If a field is not explicitly mentioned, return an empty string for that field.\n- Strings must be valid JSON (no unescaped newlines).\n- Do NOT return a sections object.\n- If uncertain, write \"[Unclear — needs review]\" and add a flag.\n- Pay special attention to negations, laterality, and measurements/units.\n- For measurement fields (cbd_measurement_mm, spleen_measurement_cm, prostate_measurement_g, endometrium_measurement_mm), return numbers only (no units).\n\nReturn JSON ONLY with schema:\n{\n  \"template_id\": \"USG_ABDOMEN\",\n  \"fields\": {\n    \"liver_main\": \"\",\n    \"liver_focal_lesion\": \"\",\n    \"liver_ihbr\": \"\",\n    \"liver_portal_vein\": \"\",\n    \"gallbladder_main\": \"\",\n    \"gallbladder_calculus_sludge\": \"\",\n    \"gallbladder_pericholecystic_fluid\": \"\",\n    \"cbd_caliber\": \"\",\n    \"cbd_measurement_mm\": \"\",\n    \"cbd_intraluminal_calculus\": \"\",\n    \"pancreas_main\": \"\",\n    \"pancreas_focal_lesion\": \"\",\n    \"pancreas_duct\": \"\",\n    \"spleen_size\": \"\",\n    \"spleen_measurement_cm\": \"\",\n    \"spleen_echotexture\": \"\",\n    \"spleen_focal_lesion\": \"\",\n    \"kidneys_main\": \"\",\n    \"kidneys_cmd\": \"\",\n    \"kidneys_calculus_hydronephrosis\": \"\",\n    \"adrenal_main\": \"\",\n    \"bladder_main\": \"\",\n    \"bladder_mass_calculus\": \"\",\n    \"prostate_main\": \"\",\n    \"prostate_measurement_g\": \"\",\n    \"prostate_focal_lesion\": \"\",\n    \"uterus_main\": \"\",\n    \"uterus_myometrium\": \"\",\n    \"endometrium_measurement_mm\": \"\",\n    \"ovaries_main\": \"\",\n    \"adnexal_mass\": \"\",\n    \"aorta_ivc_main\": \"\",\n    \"bowel_loops_main\": \"\",\n    \"peritoneal_fluid\": \"\",\n    \"impression\": \"\"\n  },\n  \"ai_mentioned_fields\": [],\n  \"ai_abnormal_fields\": [],\n  \"ai_abnormal_blocks\": [],\n  \"ai_complex_blocks\": [],\n  \"flags\": [],\n  \"disclaimer\": \"Draft only. Must be reviewed and signed by the doctor.\"\n}`
    : `You are a radiology documentation assistant. Follow strict rules and output JSON only.\n\nSTRICT RULES:\n- Output must contain ONLY OBSERVATIONS / FINDINGS.\n- Do NOT include Impression, Conclusion, Diagnosis, Advice, Plan, or Recommendations.\n- Do NOT add normal findings unless explicitly spoken in the audio.\n- Do NOT infer missing info. If uncertain, write "[Unclear — needs review]" and add a flag.\n- Pay special attention to negations, laterality, and measurements/units.\n\nReturn JSON ONLY with schema:\n{\n  "template_id": "...",\n  "observations": "...",\n  "flags": ["..."],\n  "disclaimer": "Draft only. Must be reviewed and signed by the doctor."\n}`;

  const userText = isUsg
    ? `Template: ${template.title} (${template.id})\nAllowed topics: ${template.allowedTopics.join(", ")}\nPreferred order: ${template.headings?.join(" > ") || "Use logical order"}\n\nFIELD GUIDANCE (values plug into the fixed template):\n- liver_main: phrase for \"The liver is {liver_main} with smooth margins.\"\n- liver_focal_lesion: full sentence (e.g., \"No focal space-occupying lesion is seen.\" or a finding sentence)\n- liver_ihbr: phrase for \"The intrahepatic biliary radicles are {liver_ihbr}.\"\n- liver_portal_vein: phrase for \"The portal vein is {liver_portal_vein}.\"\n- gallbladder_main: phrase for \"The gall bladder is {gallbladder_main}.\"\n- gallbladder_calculus_sludge: full sentence\n- gallbladder_pericholecystic_fluid: full sentence\n- cbd_caliber: phrase for \"The common bile duct is {cbd_caliber}.\"\n- cbd_measurement_mm: number only\n- cbd_intraluminal_calculus: full sentence\n- pancreas_main: phrase for \"The pancreas is {pancreas_main} ...\"\n- pancreas_focal_lesion: phrase for \"with {pancreas_focal_lesion}.\"\n- pancreas_duct: phrase for \"The pancreatic duct is {pancreas_duct}.\"\n- spleen_size: phrase for \"The spleen is {spleen_size} in size\"\n- spleen_measurement_cm: number only\n- spleen_echotexture: phrase for \"with {spleen_echotexture} echotexture\"\n- spleen_focal_lesion: full sentence\n- kidneys_main: phrase for \"Both kidneys are {kidneys_main} ...\"\n- kidneys_cmd: phrase for \"with {kidneys_cmd} corticomedullary differentiation.\"\n- kidneys_calculus_hydronephrosis: full sentence\n- adrenal_main: phrase for \"Both adrenal glands appear {adrenal_main}.\"\n- bladder_main: phrase for \"The urinary bladder is {bladder_main}.\"\n- bladder_mass_calculus: full sentence\n- prostate_main: phrase for \"prostate gland is {prostate_main}\"\n- prostate_measurement_g: number only\n- prostate_focal_lesion: phrase for \"with {prostate_focal_lesion}.\"\n- uterus_main: phrase for \"uterus is {uterus_main}\"\n- uterus_myometrium: phrase for \"with {uterus_myometrium} myometrial echotexture.\"\n- endometrium_measurement_mm: number only\n- ovaries_main: phrase for \"Both ovaries are {ovaries_main}.\"\n- adnexal_mass: full sentence\n- aorta_ivc_main: phrase for \"aorta and IVC are {aorta_ivc_main}.\"\n- bowel_loops_main: phrase for \"bowel loops show {bowel_loops_main}.\"\n- peritoneal_fluid: full sentence\n- impression: full sentence\n\nAlso return:\n- ai_mentioned_fields: array of field keys explicitly mentioned in dictation (including normal statements and measurements)\n- ai_abnormal_fields: array of field keys that are abnormal/uncertain (subset of ai_mentioned_fields)\n- ai_abnormal_blocks: array of blockIds that contain abnormal findings (omit normal blocks)\n- ai_complex_blocks: array of blockIds where findings are complex (laterality left/right, multiple interdependent abnormalities, or slot overflow)\n- Allowed field keys: ${USG_FIELD_KEYS.join(", ")}\n- Allowed blockIds: ${USG_BLOCKS.map((block) => block.id).join(", ")}\n\nReturn empty string for any field not explicitly mentioned. Include ALL keys even if empty, and do NOT return sections.\n\nUSG WHOLE ABDOMEN BASE TEMPLATE (for context only; do not output directly):\n${USG_ABDOMEN_TEMPLATE}\n`
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

  const extraFlags: string[] = [];
  const blockReplacementDebug: Array<{
    blockId: UsgBlockId;
    ok: boolean;
    rawText?: string;
    error?: string;
  }> = [];
  let usgNormalized = false;
  let observationsRaw = "";

  if (isUsg) {
    const extracted = buildUsgFieldOverrides(parsed as Record<string, unknown>);
    const normalized = normalizeUsgFields(extracted);
    usgNormalized = normalized.changed;

    const additions = hasFieldOverrides(normalized.overrides)
      ? {}
      : buildUsgAdditions(parsed as Record<string, unknown>);

    const aiMentionedFields = parseUsgFieldKeyArray(
      (parsed as Record<string, unknown>)?.ai_mentioned_fields
    );
    const aiAbnormalFields = parseUsgFieldKeyArray(
      (parsed as Record<string, unknown>)?.ai_abnormal_fields
    );
    const aiAbnormal = parseUsgBlockIdArray(
      (parsed as Record<string, unknown>)?.ai_abnormal_blocks
    );
    const aiComplex = parseUsgBlockIdArray(
      (parsed as Record<string, unknown>)?.ai_complex_blocks
    );
    const serverSignals = detectUsgServerSignals(normalized.overrides);

    const aiAbnormalFromFields = new Set<UsgBlockId>();
    if (aiAbnormalFields.size > 0) {
      for (const block of USG_BLOCKS) {
        const hit = block.fieldKeys.some((key) => aiAbnormalFields.has(key));
        if (hit) aiAbnormalFromFields.add(block.id);
      }
    }
    const aiAbnormalEffective =
      aiAbnormalFields.size > 0 ? aiAbnormalFromFields : aiAbnormal;

    for (const block of USG_BLOCKS) {
      const aiIsAbnormal = aiAbnormalEffective.has(block.id);
      const serverIsAbnormal = serverSignals.abnormal.has(block.id);
      if (aiIsAbnormal !== serverIsAbnormal) {
        extraFlags.push(
          `Abnormality mismatch (${block.id}): AI=${aiIsAbnormal ? "abnormal" : "normal"}, Server=${serverIsAbnormal ? "abnormal" : "normal"}`
        );
      }
    }

    const fieldMismatchNotes: string[] = [];
    for (const key of USG_FIELD_KEYS) {
      const aiMentioned = aiMentionedFields.has(key) || aiAbnormalFields.has(key);
      if (!aiMentioned) continue;
      const aiIsAbnormal = aiAbnormalFields.has(key);
      const serverIsAbnormal = serverSignals.abnormalFields.has(key);
      if (aiIsAbnormal !== serverIsAbnormal) {
        fieldMismatchNotes.push(
          `${String(key)}: AI=${aiIsAbnormal ? "abnormal" : "normal"}, Server=${serverIsAbnormal ? "abnormal" : "normal"}`
        );
      }
    }
    if (fieldMismatchNotes.length) {
      const shown = fieldMismatchNotes.slice(0, 6);
      extraFlags.push(
        `Field abnormality mismatches: ${shown.join(" | ")}${
          fieldMismatchNotes.length > shown.length
            ? ` (+${fieldMismatchNotes.length - shown.length} more)`
            : ""
        }`
      );
    }

    observationsRaw = buildUsgReport(normalized.overrides, additions);

    const blocksToReplace = USG_BLOCKS.filter((block) => {
      if (block.id === "IMPRESSION") return false;
      const abnormalAgree =
        aiAbnormalFields.size > 0
          ? block.fieldKeys.some(
              (key) =>
                aiAbnormalFields.has(key) && serverSignals.abnormalFields.has(key)
            )
          : aiAbnormal.has(block.id) && serverSignals.abnormal.has(block.id);
      if (!abnormalAgree) return false;
      const complex =
        aiComplex.has(block.id) || serverSignals.complex.has(block.id);
      return complex;
    }).slice(0, 3);

    for (const block of blocksToReplace) {
      try {
        const defaultLines =
          extractSectionByHeading({
            reportText: USG_ABDOMEN_TEMPLATE,
            heading: block.heading
          }) || [];
        const currentLines =
          extractSectionByHeading({
            reportText: observationsRaw,
            heading: block.heading
          }) || [];

        const fieldsSubset: Record<string, string> = {};
        for (const key of block.fieldKeys) {
          const value = normalized.overrides[key] || "";
          fieldsSubset[key] = String(value);
        }

        const promptBase = `You are a radiology report writer.\nReturn JSON only. No markdown.\n\nTask: Rewrite ONLY the section body for blockId ${block.id} (${block.heading}).\n- Use ONLY the provided extracted field values. Do not add new findings.\n- If a field value is empty, assume the normal/default meaning shown in DEFAULT TEMPLATE LINES.\n- Keep the style consistent with the template.\n- Do not include the heading line (e.g., \"${block.heading}\") in your output.\n- Output must be COMPLETE and not truncated.\n\nReturn JSON schema:\n{\n  \"blockId\": \"${block.id}\",\n  \"lines\": [\"Sentence 1.\", \"Sentence 2.\"]\n}\n\nDEFAULT TEMPLATE LINES:\n${defaultLines.map((l) => `- ${l}`).join("\n")}\n\nCURRENT MERGED LINES:\n${currentLines.map((l) => `- ${l}`).join("\n")}\n\nEXTRACTED FIELD VALUES (source of truth):\n${JSON.stringify(fieldsSubset, null, 2)}\n`;

        let raw = await callGeminiTextOnly({
          apiKey,
          text: promptBase,
          maxOutputTokens: 768,
          temperature: 0.2
        });
        let parsedBlock = parseModelJson(raw);
        if (!parsedBlock) {
          raw = await callGeminiTextOnly({
            apiKey,
            text: `${promptBase}\n\nRETURN VALID JSON ONLY. Output must be exactly one JSON object. No markdown, no code fences.`,
            maxOutputTokens: 768,
            temperature: 0.1
          });
          parsedBlock = parseModelJson(raw);
        }

        const blockId = String((parsedBlock as any)?.blockId || "") as UsgBlockId;
        const rawLines = (parsedBlock as any)?.lines;
        const lines = Array.isArray(rawLines)
          ? rawLines.map((l: unknown) => String(l).trim()).filter(Boolean)
          : typeof rawLines === "string"
              ? rawLines
                  .split(/\r?\n/)
                  .map((l) => l.trim())
                  .filter(Boolean)
              : null;

        if (blockId !== block.id || !lines) {
          extraFlags.push(`Block replacement failed validation (${block.id})`);
          blockReplacementDebug.push({
            blockId: block.id,
            ok: false,
            rawText: raw,
            error: "Invalid JSON or schema mismatch"
          });
          continue;
        }

        const headings = new Set(USG_BLOCKS.map((b) => b.heading.toLowerCase()));
        const cleaned = lines
          .map((line: string) => {
            const trimmed = line.trim();
            if (headings.has(trimmed.toLowerCase())) return "";
            return trimmed.replace(/^[A-Za-z /&]+:\\s*/, "").trim();
          })
          .filter(Boolean);

        if (!cleaned.length) {
          extraFlags.push(`Block replacement returned empty (${block.id})`);
          blockReplacementDebug.push({
            blockId: block.id,
            ok: false,
            rawText: raw,
            error: "Empty lines after cleanup"
          });
          continue;
        }

        observationsRaw = replaceSectionByHeading({
          reportText: observationsRaw,
          heading: block.heading,
          replacementLines: cleaned
        });

        extraFlags.push(`Block replacement used: ${block.id}`);
        blockReplacementDebug.push({
          blockId: block.id,
          ok: true,
          rawText: raw
        });
      } catch (error) {
        extraFlags.push(
          `Block replacement error (${block.id}): ${(error as Error).message}`
        );
        blockReplacementDebug.push({
          blockId: block.id,
          ok: false,
          error: (error as Error).message
        });
      }
    }
  } else {
    observationsRaw =
      typeof (parsed as any)?.observations === "string"
        ? (parsed as any).observations
        : "";
  }
  const flagsRaw = Array.isArray(parsed?.flags)
    ? parsed.flags.map((flag: unknown) => String(flag))
    : [];
  const flagsRawWithExtra = [...flagsRaw, ...extraFlags];
  const disclaimerRaw =
    typeof parsed?.disclaimer === "string" && parsed.disclaimer.trim()
      ? parsed.disclaimer
      : DEFAULT_DISCLAIMER;

  const forbiddenHeaders = isUsg
    ? FORBIDDEN_HEADERS.filter((header) => header !== "impression")
    : FORBIDDEN_HEADERS;
  const sanitized = sanitizeObservations(observationsRaw, forbiddenHeaders);
  const emptyObservations = !sanitized.text.trim();
  const flags = sanitized.removed
    ? Array.from(new Set(["Removed forbidden section", ...flagsRawWithExtra]))
    : flagsRawWithExtra;
  const flagsWithNormalization = usgNormalized
    ? Array.from(new Set(["Normalized phrasing to match template", ...flags]))
    : flags;
  const finalFlags = emptyObservations
    ? Array.from(
        new Set([
          "No clear findings detected in audio",
          ...flagsWithNormalization
        ])
      )
    : flagsWithNormalization;

  const responsePayload: {
    template_id: string;
    observations: string;
    flags: string[];
    disclaimer: string;
    debug?: { rawText: string; blockReplacements?: unknown };
  } = {
    template_id: template.id,
    observations: emptyObservations
      ? "[Unclear — needs review]"
      : sanitized.text,
    flags: finalFlags,
    disclaimer: disclaimerRaw
  };

  if (DEBUG_GEMINI_CLIENT && debugRawText) {
    responsePayload.debug = {
      rawText: debugRawText,
      blockReplacements: blockReplacementDebug
    };
  }

  return NextResponse.json(responsePayload);
}
