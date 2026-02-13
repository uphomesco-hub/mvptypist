import { normalizeHeadingForMatch } from "@/lib/usgCustomTemplate";

export const TEMPLATE_PROFILE_VERSION = 1;
const MAX_SECTIONS = 48;
const MAX_FIELDS = 160;
const MAX_DEPENDS_ON = 64;

export type TemplateProfileFieldType =
  | "text"
  | "number"
  | "boolean"
  | "measurement";

export type TemplateProfileSection = {
  id: string;
  heading: string;
  depends_on: string[];
  normal_hint: string;
};

export type TemplateProfileField = {
  id: string;
  label: string;
  type: TemplateProfileFieldType;
  section_id: string;
  normal_hint: string;
};

export type TemplateProfile = {
  version: number;
  template_hash: string;
  created_at: string;
  updated_at: string;
  approved: boolean;
  sections: TemplateProfileSection[];
  fields: TemplateProfileField[];
};

export type ProfileSectionRenderResult = {
  text: string;
  sectionsDetected: number;
  sectionsReplaced: number;
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function toSnakeId(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!slug) return "field";
  return /^[a-z_]/.test(slug) ? slug : `f_${slug}`;
}

function sanitizeDependsOn(input: unknown) {
  if (!Array.isArray(input)) return [] as string[];
  const values: string[] = [];
  for (const value of input.slice(0, MAX_DEPENDS_ON)) {
    const id = toSnakeId(normalizeText(value));
    if (!id) continue;
    if (values.includes(id)) continue;
    values.push(id);
  }
  return values;
}

function sanitizeFieldType(input: unknown): TemplateProfileFieldType {
  const type = normalizeText(input).toLowerCase();
  if (type === "number") return "number";
  if (type === "boolean") return "boolean";
  if (type === "measurement") return "measurement";
  return "text";
}

export function sanitizeTemplateProfile(
  input: unknown,
  options: { templateHash?: string } = {}
): TemplateProfile | null {
  let parsed: unknown = input;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const raw = parsed as Record<string, unknown>;
  const template_hash = normalizeText(options.templateHash || raw.template_hash);
  const sectionsRaw = Array.isArray(raw.sections) ? raw.sections : [];
  const fieldsRaw = Array.isArray(raw.fields) ? raw.fields : [];

  const sectionIds = new Set<string>();
  const sections: TemplateProfileSection[] = [];
  for (const item of sectionsRaw.slice(0, MAX_SECTIONS)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const heading = normalizeText(row.heading);
    if (!heading) continue;
    let id = toSnakeId(normalizeText(row.id || heading));
    if (sectionIds.has(id)) {
      id = `${id}_${sections.length + 1}`;
    }
    sectionIds.add(id);
    sections.push({
      id,
      heading,
      depends_on: sanitizeDependsOn(row.depends_on),
      normal_hint: normalizeText(row.normal_hint)
    });
  }

  const fields: TemplateProfileField[] = [];
  const fieldIds = new Set<string>();
  for (const item of fieldsRaw.slice(0, MAX_FIELDS)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const label = normalizeText(row.label || row.id);
    if (!label) continue;
    let id = toSnakeId(normalizeText(row.id || label));
    if (fieldIds.has(id)) continue;
    fieldIds.add(id);
    const sectionIdSource = normalizeText(row.section_id);
    const section_id =
      sectionIdSource && sectionIds.has(toSnakeId(sectionIdSource))
        ? toSnakeId(sectionIdSource)
        : sections[0]?.id || "general";

    fields.push({
      id,
      label,
      type: sanitizeFieldType(row.type),
      section_id,
      normal_hint: normalizeText(row.normal_hint)
    });
  }

  const created_at = normalizeText(raw.created_at) || nowIso();
  const updated_at = nowIso();
  const approved = Boolean(raw.approved);

  return {
    version: TEMPLATE_PROFILE_VERSION,
    template_hash,
    created_at,
    updated_at,
    approved,
    sections,
    fields
  };
}

export function profileFieldIds(profile: TemplateProfile | null) {
  if (!profile) return [] as string[];
  return profile.fields.map((field) => field.id);
}

export function buildProfileExtraFieldsSeed(profile: TemplateProfile | null) {
  const out: Record<string, string> = {};
  for (const fieldId of profileFieldIds(profile)) {
    out[fieldId] = "";
  }
  return out;
}

function normalizeValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return "";
}

export function extractProfileExtraFields(
  parsed: Record<string, unknown>,
  profile: TemplateProfile | null
) {
  const fieldIds = profileFieldIds(profile);
  const seed = buildProfileExtraFieldsSeed(profile);
  if (!fieldIds.length) {
    return seed;
  }

  const sourceRaw =
    parsed.extra_fields && typeof parsed.extra_fields === "object"
      ? (parsed.extra_fields as Record<string, unknown>)
      : parsed.extraFields && typeof parsed.extraFields === "object"
      ? (parsed.extraFields as Record<string, unknown>)
      : {};

  for (const fieldId of fieldIds) {
    const value = normalizeValue(sourceRaw[fieldId]);
    if (!value) continue;
    seed[fieldId] = value;
  }

  return seed;
}

export function extractUnmappedFindings(parsed: Record<string, unknown>) {
  const candidates = [
    parsed.unmapped_findings,
    parsed.unmappedFindings,
    parsed.other_observations,
    parsed.otherObservations
  ];

  const findings: string[] = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const text = normalizeText(item);
        if (!text) continue;
        findings.push(text);
      }
      if (findings.length) break;
      continue;
    }
    if (typeof candidate === "string" && candidate.trim()) {
      findings.push(normalizeText(candidate));
      break;
    }
  }

  return Array.from(new Set(findings.map((item) => item.toLowerCase())))
    .map((lower) => findings.find((item) => item.toLowerCase() === lower) || "")
    .filter(Boolean);
}

function formatFieldValueLine(fieldMap: Map<string, TemplateProfileField>, key: string, value: string) {
  const field = fieldMap.get(key);
  if (!field) {
    return value;
  }
  return `${field.label}: ${value}`;
}

function splitReplacementLines(text: string, preferMultipleLines: boolean) {
  const trimmed = normalizeText(text);
  if (!trimmed) return [] as string[];

  if (!preferMultipleLines) {
    return [trimmed];
  }

  return trimmed
    .split(/(?<=[.!?])\s+(?=[A-Z0-9(])/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
}

function applyExistingLineStyle(existingBodyLines: string[], replacementText: string) {
  const nonEmptySample = existingBodyLines.find((line) => line.trim());
  const preferMultipleLines = existingBodyLines.filter((line) => line.trim()).length > 1;
  const replacementLines = splitReplacementLines(replacementText, preferMultipleLines);
  if (!replacementLines.length) return [] as string[];

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

export function renderProfileSectionsDeterministically(params: {
  templateText: string;
  profile: TemplateProfile | null;
  values: Record<string, string>;
}) {
  const { templateText, profile, values } = params;
  if (!profile || !profile.sections.length) {
    return {
      text: templateText,
      sectionsDetected: 0,
      sectionsReplaced: 0
    } as ProfileSectionRenderResult;
  }

  const lines = templateText.split(/\r?\n/);
  const usedIndexes = new Set<number>();
  const matchedSections: Array<{
    section: TemplateProfileSection;
    index: number;
  }> = [];

  for (const section of profile.sections) {
    const target = normalizeHeadingForMatch(section.heading);
    if (!target) continue;
    let foundIndex = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (usedIndexes.has(i)) continue;
      const candidate = normalizeHeadingForMatch(lines[i] || "");
      if (!candidate) continue;
      if (candidate !== target) continue;
      foundIndex = i;
      break;
    }
    if (foundIndex === -1) continue;
    usedIndexes.add(foundIndex);
    matchedSections.push({ section, index: foundIndex });
  }

  if (!matchedSections.length) {
    return {
      text: templateText,
      sectionsDetected: 0,
      sectionsReplaced: 0
    } as ProfileSectionRenderResult;
  }

  matchedSections.sort((a, b) => a.index - b.index);
  const output = [...lines];
  const fieldMap = new Map(profile.fields.map((field) => [field.id, field]));
  let replaced = 0;

  for (let i = matchedSections.length - 1; i >= 0; i -= 1) {
    const current = matchedSections[i];
    const next = matchedSections[i + 1];
    const start = current.index + 1;
    const end = next ? next.index : output.length;

    const dependencyValues = current.section.depends_on
      .map((id) => ({ id, value: normalizeText(values[id]) }))
      .filter((entry) => Boolean(entry.value));

    if (!dependencyValues.length) {
      continue;
    }

    const replacementText = dependencyValues
      .map((entry) => formatFieldValueLine(fieldMap, entry.id, entry.value))
      .join("\n");

    const existingBody = output.slice(start, end);
    const replacementLines = applyExistingLineStyle(existingBody, replacementText);
    output.splice(start, Math.max(0, end - start), ...replacementLines);
    replaced += 1;
  }

  return {
    text: output.join("\n"),
    sectionsDetected: matchedSections.length,
    sectionsReplaced: replaced
  } as ProfileSectionRenderResult;
}

export function suggestProfileFieldIdsFromFindings(findings: string[]) {
  const suggestions: string[] = [];
  for (const finding of findings) {
    const tokens = finding
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .filter((token) => !["the", "is", "are", "with", "and", "of", "in"].includes(token));
    if (!tokens.length) continue;
    const proposal = toSnakeId(tokens.slice(0, 4).join("_"));
    if (!proposal) continue;
    if (suggestions.includes(proposal)) continue;
    suggestions.push(proposal);
    if (suggestions.length >= 6) break;
  }
  return suggestions;
}
