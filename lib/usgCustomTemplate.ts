import {
  buildUsgReport,
  isHighRiskUsgOrganState,
  type UsgFieldOverrides,
  type UsgGender,
  type UsgOrganStateMap,
  type UsgPatientInfo
} from "@/lib/usgTemplate";

export const CUSTOM_TEMPLATE_ID = "USG_ABDOMEN_CUSTOM";
export const CUSTOM_TEMPLATE_MAPPING_STORAGE_KEY =
  "mvptypist.customTemplateMappings.v1";

export const CUSTOM_TEMPLATE_SECTION_KEYS = [
  "LIVER",
  "GALL_CBD",
  "PANCREAS",
  "SPLEEN",
  "KIDNEYS",
  "BLADDER",
  "PROSTATE",
  "UTERUS",
  "ADNEXA",
  "PELVIC",
  "PERITONEUM",
  "LYMPH",
  "PERITONEUM_NODES",
  "IMPRESSION",
  "NOTE"
] as const;

export type CustomTemplateSectionKey =
  (typeof CUSTOM_TEMPLATE_SECTION_KEYS)[number];

export type CustomTemplateMapping = Partial<
  Record<CustomTemplateSectionKey, string>
>;

export type HeadingCandidate = {
  index: number;
  line: string;
};

type SectionDetection = {
  key: CustomTemplateSectionKey;
  index: number;
  headingLine: string;
};

export type CustomRenderResult = {
  text: string;
  sectionsDetected: number;
  sectionsReplaced: number;
  usedFallbackDetection: boolean;
  forcedCanonicalFallback?: boolean;
  fallbackReason?: string;
};

const GENDER_INAPPLICABLE_SECTIONS: Record<UsgGender, CustomTemplateSectionKey[]> = {
  male: ["UTERUS", "ADNEXA"],
  female: ["PROSTATE"]
};

const ORGAN_SECTION_MAP: Array<{
  organ: keyof UsgOrganStateMap;
  section: CustomTemplateSectionKey;
}> = [
  { organ: "liver", section: "LIVER" },
  { organ: "gallbladder", section: "GALL_CBD" },
  { organ: "pancreas", section: "PANCREAS" },
  { organ: "spleen", section: "SPLEEN" },
  { organ: "kidneys", section: "KIDNEYS" },
  { organ: "bladder", section: "BLADDER" },
  { organ: "prostate", section: "PROSTATE" },
  { organ: "uterus", section: "UTERUS" },
  { organ: "adnexa", section: "ADNEXA" }
];

const HEADER_LINE_SKIP_PATTERN =
  /^(name|patient\s*name|patient|gender|sex|age|id|mrn|uhid|accession|date|exam\s*date|clinical\s*history|history)\b/i;
const BULLET_OR_NUMBER_PREFIX = /^(?:[-*•]\s+|\d+[.)]\s+)/;
const LONG_PARAGRAPH_PUNCTUATION = /[.;][^\n]*[.;]/;
const PLACEHOLDER_PATTERN =
  /^(?:[_\-./\s]+|na|n\/a|unknown|nil|none|\[.*\]|<.*>|\{\{.*\}\})$/i;

const SECTION_DEPENDENCIES: Record<
  CustomTemplateSectionKey,
  (keyof UsgFieldOverrides)[]
> = {
  LIVER: [
    "liver_main",
    "liver_focal_lesion",
    "liver_hepatic_veins",
    "liver_ihbr",
    "liver_portal_vein"
  ],
  GALL_CBD: [
    "gallbladder_main",
    "gallbladder_calculus_sludge",
    "cbd_main"
  ],
  PANCREAS: ["pancreas_main", "pancreas_echotexture"],
  SPLEEN: ["spleen_main", "spleen_focal_lesion"],
  KIDNEYS: [
    "kidneys_size",
    "kidneys_main",
    "kidneys_cmd",
    "kidneys_cortical_scarring",
    "kidneys_parenchyma",
    "kidneys_calculus_hydronephrosis"
  ],
  BLADDER: ["bladder_main", "bladder_mass_calculus"],
  PROSTATE: ["prostate_main", "prostate_echotexture"],
  UTERUS: [
    "uterus_main",
    "uterus_myometrium",
    "endometrium_measurement_mm"
  ],
  ADNEXA: ["ovaries_main", "adnexal_mass"],
  PELVIC: ["peritoneal_fluid", "adnexal_mass"],
  PERITONEUM: ["peritoneal_fluid"],
  LYMPH: ["lymph_nodes"],
  PERITONEUM_NODES: ["peritoneal_fluid", "lymph_nodes"],
  IMPRESSION: ["impression"],
  NOTE: ["correlate_clinically"]
};

const SECTION_KEYWORDS: Record<CustomTemplateSectionKey, string[]> = {
  LIVER: ["liver", "hepatic", "portal vein", "ihbr"],
  GALL_CBD: [
    "gall",
    "gallbladder",
    "gall bladder",
    "cbd",
    "common bile duct",
    "chole"
  ],
  PANCREAS: ["pancreas", "pancreatic"],
  SPLEEN: ["spleen", "splenic"],
  KIDNEYS: ["kidney", "kidneys", "renal"],
  BLADDER: ["bladder", "urinary bladder"],
  PROSTATE: ["prostate"],
  UTERUS: ["uterus", "myometrium", "endometrium", "endometrial"],
  ADNEXA: ["adnexa", "adenexa", "ovary", "ovaries", "adnexal"],
  PELVIC: ["pelvis", "pelvic", "pouch of douglas", "pod"],
  PERITONEUM: ["peritoneum", "peritoneal", "ascites", "free fluid"],
  LYMPH: ["lymph", "node", "adenopathy"],
  PERITONEUM_NODES: [
    "peritoneum",
    "peritoneal",
    "lymph",
    "nodes",
    "peritoneum and nodes"
  ],
  IMPRESSION: ["impression", "conclusion", "significant findings"],
  NOTE: ["note", "remarks", "correlate", "clinical correlation"]
};

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function normalizeHeadingForMatch(text: string) {
  return normalizeWhitespace(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function detectHeadingCandidates(templateText: string): HeadingCandidate[] {
  const lines = templateText.split(/\r?\n/);
  const candidates: HeadingCandidate[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || "";
    const trimmed = line.trim();
    if (!trimmed) continue;

    const words = countWords(trimmed);
    if (trimmed.length > 90) continue;
    if (words > 12) continue;
    if (HEADER_LINE_SKIP_PATTERN.test(trimmed)) continue;
    if (BULLET_OR_NUMBER_PREFIX.test(trimmed)) continue;
    if (/^[\W_]+$/.test(trimmed)) continue;
    if (LONG_PARAGRAPH_PUNCTUATION.test(trimmed)) continue;

    const punctuationCount = (trimmed.match(/[:.,;!?]/g) || []).length;
    if (punctuationCount > 2) continue;
    if (/[.?!]$/.test(trimmed) && words > 7) continue;

    candidates.push({ index, line: trimmed });
  }

  return candidates;
}

export function classifyHeadingCandidate(line: string): CustomTemplateSectionKey | null {
  const normalized = normalizeHeadingForMatch(line);
  if (!normalized) return null;

  let bestKey: CustomTemplateSectionKey | null = null;
  let bestScore = 0;

  for (const key of CUSTOM_TEMPLATE_SECTION_KEYS) {
    const keywords = SECTION_KEYWORDS[key];
    let score = 0;
    for (const keyword of keywords) {
      const keywordNorm = normalizeHeadingForMatch(keyword);
      if (!keywordNorm) continue;
      if (normalized === keywordNorm) {
        score += 6;
      } else if (
        normalized.startsWith(keywordNorm) ||
        normalized.endsWith(keywordNorm)
      ) {
        score += 4;
      } else if (normalized.includes(keywordNorm)) {
        score += 2;
      }
    }

    if (
      key === "PERITONEUM_NODES" &&
      /peritone/i.test(normalized) &&
      /lymph|node/i.test(normalized)
    ) {
      score += 6;
    }

    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  if (!bestKey || bestScore < 2) return null;
  return bestKey;
}

export function autoMapHeadingCandidates(
  candidates: HeadingCandidate[]
): CustomTemplateMapping {
  const mapping: CustomTemplateMapping = {};
  const usedIndexes = new Set<number>();

  for (const key of CUSTOM_TEMPLATE_SECTION_KEYS) {
    for (const candidate of candidates) {
      if (usedIndexes.has(candidate.index)) continue;
      if (classifyHeadingCandidate(candidate.line) !== key) continue;
      mapping[key] = candidate.line;
      usedIndexes.add(candidate.index);
      break;
    }
  }

  return mapping;
}

export function hashTemplateText(templateText: string) {
  let hash = 2166136261;
  for (let i = 0; i < templateText.length; i += 1) {
    hash ^= templateText.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `t${(hash >>> 0).toString(16)}`;
}

export function sanitizeCustomTemplateMapping(input: unknown): CustomTemplateMapping {
  let parsed: unknown = input;

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {};
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return {};
  }

  const result: CustomTemplateMapping = {};
  for (const key of CUSTOM_TEMPLATE_SECTION_KEYS) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 200) continue;
    result[key] = trimmed;
  }

  return result;
}

function isMeaningfulOverrideValue(value: string | undefined) {
  return Boolean(typeof value === "string" && value.trim());
}

export function hasSectionOverrides(
  section: CustomTemplateSectionKey,
  overrides: UsgFieldOverrides
) {
  const fields = SECTION_DEPENDENCIES[section] || [];
  return fields.some((field) => isMeaningfulOverrideValue(overrides[field]));
}

function isSectionApplicableForGender(
  section: CustomTemplateSectionKey,
  gender: UsgGender
) {
  return !GENDER_INAPPLICABLE_SECTIONS[gender].includes(section);
}

function isSectionDrivenByHighRiskOrganState(
  section: CustomTemplateSectionKey,
  organStates?: UsgOrganStateMap
) {
  if (!organStates) return false;
  for (const entry of ORGAN_SECTION_MAP) {
    if (entry.section !== section) continue;
    if (isHighRiskUsgOrganState(organStates[entry.organ])) {
      return true;
    }
  }
  return false;
}

function appendSectionLine(store: Record<CustomTemplateSectionKey, string[]>, key: CustomTemplateSectionKey, line: string) {
  const trimmed = normalizeWhitespace(line);
  if (!trimmed) return;
  store[key].push(trimmed);
}

function startsWithHeading(line: string, heading: string) {
  return normalizeHeadingForMatch(line).startsWith(normalizeHeadingForMatch(heading));
}

function extractHeadingValue(line: string) {
  const colonIndex = line.indexOf(":");
  if (colonIndex === -1) return "";
  return normalizeWhitespace(line.slice(colonIndex + 1));
}

function extractCanonicalSectionValues(
  reportText: string,
  gender: UsgGender
): Record<CustomTemplateSectionKey, string> {
  const buckets: Record<CustomTemplateSectionKey, string[]> = {
    LIVER: [],
    GALL_CBD: [],
    PANCREAS: [],
    SPLEEN: [],
    KIDNEYS: [],
    BLADDER: [],
    PROSTATE: [],
    UTERUS: [],
    ADNEXA: [],
    PELVIC: [],
    PERITONEUM: [],
    LYMPH: [],
    PERITONEUM_NODES: [],
    IMPRESSION: [],
    NOTE: []
  };

  const lines = reportText.split(/\r?\n/);
  let carrySection: CustomTemplateSectionKey | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^name\s*:/i.test(line) || /^sonography\b/i.test(line)) {
      carrySection = null;
      continue;
    }
    if (/^-{5,}\s*end/i.test(line)) {
      carrySection = null;
      continue;
    }
    if (/sonography has its limitations/i.test(line)) {
      carrySection = null;
      continue;
    }

    if (startsWithHeading(line, "Liver:")) {
      appendSectionLine(buckets, "LIVER", extractHeadingValue(line));
      carrySection = "LIVER";
      continue;
    }
    if (
      startsWithHeading(line, "Gall bladder:") ||
      startsWithHeading(line, "Gall Bladder:") ||
      startsWithHeading(line, "Gallbladder:")
    ) {
      appendSectionLine(buckets, "GALL_CBD", extractHeadingValue(line));
      carrySection = "GALL_CBD";
      continue;
    }
    if (startsWithHeading(line, "Pancreas:")) {
      appendSectionLine(buckets, "PANCREAS", extractHeadingValue(line));
      carrySection = "PANCREAS";
      continue;
    }
    if (startsWithHeading(line, "Spleen:")) {
      appendSectionLine(buckets, "SPLEEN", extractHeadingValue(line));
      carrySection = "SPLEEN";
      continue;
    }
    if (startsWithHeading(line, "Kidneys:")) {
      appendSectionLine(buckets, "KIDNEYS", extractHeadingValue(line));
      carrySection = "KIDNEYS";
      continue;
    }
    if (startsWithHeading(line, "Urinary Bladder:")) {
      appendSectionLine(buckets, "BLADDER", extractHeadingValue(line));
      carrySection = "BLADDER";
      continue;
    }
    if (startsWithHeading(line, "Prostate:")) {
      appendSectionLine(buckets, "PROSTATE", extractHeadingValue(line));
      carrySection = "PROSTATE";
      continue;
    }
    if (startsWithHeading(line, "Uterus:")) {
      appendSectionLine(buckets, "UTERUS", extractHeadingValue(line));
      carrySection = "UTERUS";
      continue;
    }
    if (
      startsWithHeading(line, "Adenexa:") ||
      startsWithHeading(line, "Adnexa:")
    ) {
      appendSectionLine(buckets, "ADNEXA", extractHeadingValue(line));
      carrySection = "ADNEXA";
      continue;
    }
    if (/^(impression\s*:|significant findings\s*:)/i.test(line)) {
      appendSectionLine(
        buckets,
        "IMPRESSION",
        line.replace(/^(impression\s*:|significant findings\s*:)/i, "")
      );
      carrySection = "IMPRESSION";
      continue;
    }
    if (/^please correlate clinically\.?$/i.test(line)) {
      appendSectionLine(buckets, "NOTE", line);
      carrySection = "NOTE";
      continue;
    }

    if (/lymph\s*nodes?/i.test(line)) {
      appendSectionLine(buckets, "LYMPH", line);
      carrySection = "LYMPH";
      continue;
    }
    if (/peritone|ascites|free fluid/i.test(line)) {
      appendSectionLine(buckets, "PERITONEUM", line);
      if (/pelvi/i.test(line)) {
        appendSectionLine(buckets, "PELVIC", line);
      }
      carrySection = "PERITONEUM";
      continue;
    }
    if (/pelvi/i.test(line)) {
      appendSectionLine(buckets, "PELVIC", line);
      carrySection = "PELVIC";
      continue;
    }

    if (carrySection === "KIDNEYS" || carrySection === "PROSTATE") {
      appendSectionLine(buckets, carrySection, line);
    }
  }

  if (!buckets.PELVIC.length && gender === "female") {
    if (buckets.UTERUS.length || buckets.ADNEXA.length) {
      const merged = [...buckets.UTERUS, ...buckets.ADNEXA].join(" ").trim();
      if (merged) buckets.PELVIC.push(merged);
    }
  }

  const mergedPeritoneumNodes = [...buckets.PERITONEUM, ...buckets.LYMPH];
  if (mergedPeritoneumNodes.length) {
    buckets.PERITONEUM_NODES = mergedPeritoneumNodes;
  }

  const output = {} as Record<CustomTemplateSectionKey, string>;
  for (const key of CUSTOM_TEMPLATE_SECTION_KEYS) {
    const linesForKey = buckets[key];
    output[key] = linesForKey.join("\n").trim();
  }

  return output;
}

function resolveMappedSections(
  lines: string[],
  mapping: CustomTemplateMapping,
  candidates: HeadingCandidate[]
): { sections: SectionDetection[]; usedFallbackDetection: boolean } {
  const sections: SectionDetection[] = [];
  const usedIndexes = new Set<number>();
  const normalizedLineIndexes = new Map<string, number[]>();

  for (let index = 0; index < lines.length; index += 1) {
    const normalized = normalizeHeadingForMatch(lines[index] || "");
    if (!normalized) continue;
    const arr = normalizedLineIndexes.get(normalized) || [];
    arr.push(index);
    normalizedLineIndexes.set(normalized, arr);
  }

  const assignSection = (
    key: CustomTemplateSectionKey,
    index: number,
    headingLine: string
  ) => {
    if (usedIndexes.has(index)) return;
    usedIndexes.add(index);
    sections.push({ key, index, headingLine });
  };

  for (const key of CUSTOM_TEMPLATE_SECTION_KEYS) {
    const mapped = mapping[key];
    if (!mapped) continue;
    const normalized = normalizeHeadingForMatch(mapped);
    if (!normalized) continue;

    const candidatesForHeading = normalizedLineIndexes.get(normalized) || [];
    for (const index of candidatesForHeading) {
      if (usedIndexes.has(index)) continue;
      assignSection(key, index, lines[index] || mapped);
      break;
    }
  }

  let usedFallbackDetection = false;
  for (const key of CUSTOM_TEMPLATE_SECTION_KEYS) {
    if (sections.some((entry) => entry.key === key)) continue;

    for (const candidate of candidates) {
      if (usedIndexes.has(candidate.index)) continue;
      if (classifyHeadingCandidate(candidate.line) !== key) continue;
      assignSection(key, candidate.index, lines[candidate.index] || candidate.line);
      usedFallbackDetection = true;
      break;
    }
  }

  sections.sort((a, b) => a.index - b.index);
  return { sections, usedFallbackDetection };
}

function splitReplacementLines(text: string, preferMultipleLines: boolean) {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const explicitLines = trimmed
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  if (explicitLines.length > 1) {
    return explicitLines;
  }

  const single = explicitLines[0] || normalizeWhitespace(trimmed);
  if (!preferMultipleLines) {
    return [single];
  }

  return single
    .split(/(?<=[.!?])\s+(?=[A-Z0-9(])/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
}

function applyExistingLineStyle(existingBodyLines: string[], replacementText: string) {
  const nonEmptySample = existingBodyLines.find((line) => line.trim());
  const preferMultipleLines = existingBodyLines.filter((line) => line.trim()).length > 1;
  const replacementLines = splitReplacementLines(replacementText, preferMultipleLines);
  if (!replacementLines.length) return [];

  if (!nonEmptySample) {
    return replacementLines;
  }

  const bulletMatch = nonEmptySample.match(/^(\s*)([-*•]\s+).*/);
  if (bulletMatch) {
    const [, indent, marker] = bulletMatch;
    return replacementLines.map((line) => `${indent}${marker}${line}`);
  }

  const numberedMatch = nonEmptySample.match(/^(\s*)(\d+)([.)]\s+).*/);
  if (numberedMatch) {
    const [, indent, start, suffix] = numberedMatch;
    const startNumber = parseInt(start, 10);
    const safeStart = Number.isFinite(startNumber) ? startNumber : 1;
    return replacementLines.map(
      (line, index) => `${indent}${safeStart + index}${suffix}${line}`
    );
  }

  const indentMatch = nonEmptySample.match(/^(\s*).*/);
  const indent = indentMatch ? indentMatch[1] : "";
  return replacementLines.map((line) => `${indent}${line}`);
}

function isPlaceholderValue(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return PLACEHOLDER_PATTERN.test(trimmed);
}

function replaceLabeledValue(
  line: string,
  labelPattern: RegExp,
  value: string
): string {
  if (!value.trim()) return line;

  if (!labelPattern.test(line)) {
    return line;
  }

  const directMatch = line.match(/^\s*([^:]+:\s*)(.*)$/);
  if (directMatch && labelPattern.test(directMatch[1])) {
    const prefix = directMatch[1];
    const currentValue = directMatch[2] || "";
    if (isPlaceholderValue(currentValue)) {
      return `${prefix}${value}`;
    }
  }

  const inlineRegex = new RegExp(
    `(${labelPattern.source}\s*:\s*)([^\n]*?)(?=(\s+[A-Z][A-Z ]*\s*:|$))`,
    "i"
  );

  return line.replace(inlineRegex, (match, prefix: string, current: string) => {
    if (!isPlaceholderValue(current)) {
      return match;
    }
    return `${prefix}${value}`;
  });
}

export function applyDeterministicHeaderUpdates(params: {
  templateText: string;
  patientName?: string;
  patientGenderLabel?: string;
  examDate?: string;
}) {
  const { templateText, patientName = "", patientGenderLabel = "", examDate = "" } = params;

  let text = templateText;

  if (patientName) {
    text = text
      .replace(/\{\{\s*patient[_\s-]*name\s*\}\}/gi, patientName)
      .replace(/\[\s*patient[_\s-]*name\s*\]/gi, patientName)
      .replace(/<\s*patient[_\s-]*name\s*>/gi, patientName);
  }

  if (patientGenderLabel) {
    text = text
      .replace(/\{\{\s*patient[_\s-]*(gender|sex)\s*\}\}/gi, patientGenderLabel)
      .replace(/\[\s*patient[_\s-]*(gender|sex)\s*\]/gi, patientGenderLabel)
      .replace(/<\s*patient[_\s-]*(gender|sex)\s*>/gi, patientGenderLabel);
  }

  if (examDate) {
    text = text
      .replace(/\{\{\s*(exam[_\s-]*date|date)\s*\}\}/gi, examDate)
      .replace(/\[\s*(exam[_\s-]*date|date)\s*\]/gi, examDate)
      .replace(/<\s*(exam[_\s-]*date|date)\s*>/gi, examDate);
  }

  const lines = text.split(/\r?\n/);
  const nextLines = lines.map((line) => {
    let next = line;
    if (patientName) {
      next = replaceLabeledValue(next, /(?:patient\s*name|name)/i, patientName);
    }
    if (patientGenderLabel) {
      next = replaceLabeledValue(next, /(?:gender|sex)/i, patientGenderLabel);
    }
    if (examDate) {
      next = replaceLabeledValue(next, /(?:exam\s*date|date)/i, examDate);
    }
    return next;
  });

  return nextLines.join("\n");
}

export function renderCustomTemplateDeterministically(params: {
  templateText: string;
  mapping: CustomTemplateMapping;
  overrides: UsgFieldOverrides;
  gender: UsgGender;
  patient: UsgPatientInfo;
  suppressedFields?: (keyof UsgFieldOverrides)[];
  organStates?: UsgOrganStateMap;
}): CustomRenderResult {
  const {
    templateText,
    mapping,
    overrides,
    gender,
    patient,
    suppressedFields = [],
    organStates
  } = params;

  const canonicalReport = buildUsgReport({
    gender,
    patient,
    overrides,
    suppressedFields
  });

  const canonicalSections = extractCanonicalSectionValues(canonicalReport, gender);
  const withHeaderUpdates = applyDeterministicHeaderUpdates({
    templateText,
    patientName: patient.name,
    patientGenderLabel: patient.gender,
    examDate: patient.date
  });

  const lines = withHeaderUpdates.split(/\r?\n/);
  const candidates = detectHeadingCandidates(withHeaderUpdates);
  const { sections, usedFallbackDetection } = resolveMappedSections(
    lines,
    mapping,
    candidates
  );

  const detectedSectionKeys = new Set(sections.map((section) => section.key));
  if (organStates) {
    for (const entry of ORGAN_SECTION_MAP) {
      if (!isHighRiskUsgOrganState(organStates[entry.organ])) continue;
      const canonicalText = canonicalSections[entry.section] || "";
      if (!canonicalText.trim()) continue;
      if (detectedSectionKeys.has(entry.section)) continue;
      return {
        text: canonicalReport,
        sectionsDetected: sections.length,
        sectionsReplaced: 0,
        usedFallbackDetection,
        forcedCanonicalFallback: true,
        fallbackReason:
          "Custom template fallback to canonical report due to unresolved organ-state section mapping."
      };
    }
  }

  if (!sections.length) {
    return {
      text: canonicalReport,
      sectionsDetected: 0,
      sectionsReplaced: 0,
      usedFallbackDetection
    };
  }

  const output = [...lines];
  let sectionsReplaced = 0;

  for (let i = sections.length - 1; i >= 0; i -= 1) {
    const section = sections[i];
    const nextSection = sections[i + 1];
    const start = section.index + 1;
    const end = nextSection ? nextSection.index : output.length;

    const replacementText = canonicalSections[section.key] || "";
    const hasOverrides = hasSectionOverrides(section.key, overrides);
    const sectionApplicable = isSectionApplicableForGender(section.key, gender);
    const highRiskStateSection = isSectionDrivenByHighRiskOrganState(
      section.key,
      organStates
    );
    const shouldForceClear =
      !sectionApplicable ||
      ((hasOverrides || highRiskStateSection) && !replacementText.trim());
    const shouldReplace =
      shouldForceClear ||
      (hasOverrides && replacementText.trim().length > 0) ||
      (highRiskStateSection && replacementText.trim().length > 0);

    if (!shouldReplace) {
      continue;
    }

    const existingBodyLines = output.slice(start, end);
    const replacementLines = shouldForceClear
      ? []
      : applyExistingLineStyle(existingBodyLines, replacementText);

    if (!shouldForceClear && !replacementLines.length) {
      continue;
    }

    output.splice(start, Math.max(0, end - start), ...replacementLines);
    sectionsReplaced += 1;
  }

  return {
    text: output.join("\n"),
    sectionsDetected: sections.length,
    sectionsReplaced,
    usedFallbackDetection
  };
}
