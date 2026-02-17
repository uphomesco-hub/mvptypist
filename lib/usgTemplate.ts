export type UsgGender = "male" | "female";

export type UsgPatientInfo = {
  name?: string;
  gender?: string;
  date?: string;
  age?: string;
  labNo?: string;
  referredBy?: string;
};

export type UsgFieldOverrides = {
  liver_main?: string;
  liver_focal_lesion?: string;
  liver_hepatic_veins?: string;
  liver_ihbr?: string;
  liver_portal_vein?: string;
  gallbladder_main?: string;
  gallbladder_calculus_sludge?: string;
  cbd_main?: string;
  pancreas_main?: string;
  pancreas_echotexture?: string;
  spleen_main?: string;
  spleen_focal_lesion?: string;
  kidneys_size?: string;
  kidneys_main?: string;
  kidneys_cmd?: string;
  kidneys_cortical_scarring?: string;
  kidneys_parenchyma?: string;
  kidneys_calculus_hydronephrosis?: string;
  bladder_main?: string;
  bladder_mass_calculus?: string;
  prostate_main?: string;
  prostate_echotexture?: string;
  uterus_main?: string;
  uterus_myometrium?: string;
  endometrium_measurement_mm?: string;
  ovaries_main?: string;
  adnexal_mass?: string;
  peritoneal_fluid?: string;
  lymph_nodes?: string;
  impression?: string;
  correlate_clinically?: string;
};

export type UsgOrganState =
  | "visualized"
  | "limited_visualization"
  | "not_visualized"
  | "not_assessed"
  | "surgically_absent";

export type UsgOrganKey =
  | "liver"
  | "gallbladder"
  | "pancreas"
  | "spleen"
  | "kidneys"
  | "bladder"
  | "prostate"
  | "uterus"
  | "adnexa";

export type UsgOrganStateMap = Record<UsgOrganKey, UsgOrganState>;

export type UsgConsistencyNormalization = {
  overrides: UsgFieldOverrides;
  suppressedFields: (keyof UsgFieldOverrides)[];
  organStates: UsgOrganStateMap;
};

const USG_END_OF_REPORT_LINE_MALE =
  "--------------------------------------------------------------END OF REPORT --------------------------------------------------------------";
const USG_END_OF_REPORT_LINE_FEMALE =
  "------------------------------------------------END of report -----------------------------------------------------------";
const USG_KUB_DEPARTMENT_LINE = "DEPARTMENT OF RADIO-DIAGNOSIS";
const USG_KUB_REFERRED_BY_DEFAULT = "DR. T C SADASUKHI";

const USG_LIMITATIONS_NOTE =
  "NON OBSTRUCTING URETERIC CALCULI MAY BE MISSED IN NON DILATED URETERS . SONOGRAPHY HAS ITS LIMITATIONS . IT CANNOT DETECT ALL ABNORMALITIES , SOME FINDINGS MAY BE MISSED DESPITE BEST EFFORTS OF DOCTOR . HENCE IN CASE OF ANY DISCREPANCY , KINDLY CONTACT THE UNDERSIGNED FOR REVIEW/ DISCUSSION";

const USG_DEFAULT_FIELDS_BASE: Required<UsgFieldOverrides> = {
  liver_main: "Is normal in size. Tissue echotexture is homogenous.",
  liver_focal_lesion: "No focal lesion seen.",
  liver_hepatic_veins: "Hepatic veins are not dilated.",
  liver_ihbr: "Intrahepatic biliary radicals are not dilated.",
  liver_portal_vein: "Portal vein is of normal diameter.",
  gallbladder_main: "is normal in contour & wall thickness.",
  gallbladder_calculus_sludge:
    "There is no evidence of any calculi or biliary sludge in visualized lumen of gall bladder.",
  cbd_main: "CBD is normal.",
  pancreas_main: "is normal in size, shape & contour.",
  pancreas_echotexture: "Tissue echotexture is homogenous.",
  spleen_main: "is normal in size, shape & echotexture.",
  spleen_focal_lesion: "No focal solid/ cystic lesion is seen.",
  kidneys_size: "",
  kidneys_main: "Both kidneys are normal in size, shape, position.",
  kidneys_cmd: "corticomedullary differentiation is maintained.",
  kidneys_cortical_scarring: "No cortical scarring seen.",
  kidneys_parenchyma: "Renal parenchymal & sinus echotexture. Appears normal.",
  kidneys_calculus_hydronephrosis:
    "NO calculus, mass lesion or hydronephrosis seen.",
  bladder_main: "partially filled",
  bladder_mass_calculus: "",
  prostate_main: "The volume of prostate gland is normal.",
  prostate_echotexture:
    "The prostate gland has homogeneous echotexture with intact capsule.",
  uterus_main: "Uterus is normal in size and shape.",
  uterus_myometrium: "Musculature shows normal echopattern.",
  endometrium_measurement_mm: "",
  ovaries_main: "both ovaries appears normal",
  adnexal_mass: "no cyst / mass seen",
  peritoneal_fluid: "No free fluid seen in peritoneal cavity",
  lymph_nodes: "No significantly enlarged lymph nodes seen",
  impression: "no significant abnormality seen in abdomen",
  correlate_clinically: "Please correlate clinically"
};

const USG_DEFAULT_FIELDS_MALE: Required<UsgFieldOverrides> = {
  ...USG_DEFAULT_FIELDS_BASE,
  kidneys_size: "",
  bladder_main: "partially filled",
  bladder_mass_calculus: "",
  ovaries_main: "",
  adnexal_mass: ""
};

const USG_DEFAULT_FIELDS_FEMALE: Required<UsgFieldOverrides> = {
  ...USG_DEFAULT_FIELDS_BASE,
  liver_main: "Is normal in size. Tissue echotexture is homogenous.",
  gallbladder_calculus_sludge:
    "There is evidence of multiple calculi or biliary sludge in visualized lumen of gall bladder.",
  spleen_main: "is normal in size, shape & echotexture.",
  kidneys_size: "",
  bladder_main: "walls are well defined & normal in thickness.",
  bladder_mass_calculus:
    "There is no filling defect,calculus or foreign body in bladder.",
  prostate_main: "",
  prostate_echotexture: "",
  adnexal_mass: "no cyst / mass seen",
  ovaries_main: "both ovaries appears normal",
  impression: "Chronic cholecystitis with cholilithiasis",
  correlate_clinically: ""
};

const USG_KUB_DEFAULT_FIELDS_MALE: Required<UsgFieldOverrides> = {
  ...USG_DEFAULT_FIELDS_MALE,
  impression: "No significant abnormality seen in KUB study",
  correlate_clinically: "Please correlate clinically"
};

const USG_KUB_DEFAULT_FIELDS_FEMALE: Required<UsgFieldOverrides> = {
  ...USG_DEFAULT_FIELDS_FEMALE,
  impression: "No significant abnormality seen in KUB study",
  correlate_clinically: "Please correlate clinically"
};

export const USG_FIELD_KEYS = Object.keys(
  USG_DEFAULT_FIELDS_MALE
) as (keyof UsgFieldOverrides)[];

const NOT_VISUALIZED_FRAGMENT =
  "(?:not\\s+(?:well\\s+)?visuali[sz]ed|not\\s+seen|not\\s+appreciable|non[-\\s]?visuali[sz]ed|poorly\\s+visuali[sz]ed|could\\s+not\\s+be\\s+visuali[sz]ed)";
const NOT_ASSESSED_FRAGMENT =
  "(?:not\\s+assessed|cannot\\s+be\\s+assessed|assessment\\s+is\\s+limited|limited\\s+evaluation|suboptimal\\s+evaluation)";
const LIMITED_VISUALIZATION_FRAGMENT =
  "(?:partially\\s+visuali[sz]ed|partially\\s+distended|underdistended|contracted|poor\\s+acoustic\\s+window|bowel\\s+gas)";

const NOT_VISUALIZED_PATTERN = new RegExp(NOT_VISUALIZED_FRAGMENT, "i");
const NOT_ASSESSED_PATTERN = new RegExp(NOT_ASSESSED_FRAGMENT, "i");
const LIMITED_VISUALIZATION_PATTERN = new RegExp(
  LIMITED_VISUALIZATION_FRAGMENT,
  "i"
);
const LOCAL_SURGICAL_STATUS_PATTERN = /\b(surgically\s+absent|removed)\b/i;

const ORGAN_TERMS: Record<UsgOrganKey, string[]> = {
  liver: ["liver", "hepatic"],
  gallbladder: ["gall bladder", "gallbladder", "gb"],
  pancreas: ["pancreas", "pancreatic"],
  spleen: ["spleen", "splenic"],
  kidneys: ["kidney", "kidneys", "renal"],
  bladder: ["bladder", "urinary bladder"],
  prostate: ["prostate"],
  uterus: ["uterus", "uterine", "myometrium", "endometrium", "endometrial"],
  adnexa: ["adnexa", "adenexa", "ovary", "ovaries", "adnexal"]
};

const ORGAN_SURGERY_PATTERNS: Record<UsgOrganKey, RegExp> = {
  liver: /\b(hepatectomy|post[-\s]?hepatectomy|liver\s+resection)\b/i,
  gallbladder: /\b(cholecystectomy|post[-\s]?cholecystectomy)\b/i,
  pancreas: /\b(pancreatectomy|post[-\s]?pancreatectomy)\b/i,
  spleen: /\b(splenectomy|post[-\s]?splenectomy)\b/i,
  kidneys: /\b(nephrectomy|post[-\s]?nephrectomy)\b/i,
  bladder: /\b(cystectomy|post[-\s]?cystectomy)\b/i,
  prostate: /\b(prostatectomy|post[-\s]?prostatectomy)\b/i,
  uterus: /\b(hysterectomy|post[-\s]?hysterectomy)\b/i,
  adnexa: /\b(oophorectomy|salpingo[-\s]?oophorectomy|post[-\s]?oophorectomy)\b/i
};

function ensurePeriod(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeImpressionTerminology(text: string) {
  return text
    .replace(/\bcystisis\b/gi, "cystitis")
    .replace(/\bcholilithiasis\b/gi, "cholelithiasis")
    .replace(/\bstones\b/gi, "calculi")
    .replace(/\bstone\b/gi, "calculus")
    .replace(/\s+/g, " ")
    .trim();
}

function hasBladderWallThickening(text: string) {
  if (!text.trim()) return false;
  return /(?:bladder\s*wall[^.\n]{0,60}thicken|wall\s+is\s+diffusely\s+thickened|diffuse\s+bladder\s+wall\s+thickening)/i.test(
    text
  );
}

function collectText(fields: UsgFieldOverrides, keys: (keyof UsgFieldOverrides)[]) {
  return keys
    .map((key) => fields[key])
    .filter(hasText)
    .map((value) => String(value).trim())
    .join(" ");
}

function buildOrganPhrasePattern(organKey: UsgOrganKey, phraseFragment: string) {
  const terms = ORGAN_TERMS[organKey];
  const termPattern = terms.map((term) => escapeRegExp(term)).join("|");
  return new RegExp(
    `(?:\\b(?:${termPattern})\\b[^.\\n]{0,80}${phraseFragment}|${phraseFragment}[^.\\n]{0,80}\\b(?:${termPattern})\\b)`,
    "i"
  );
}

function detectStateFromLocalText(
  text: string,
  surgeryPattern: RegExp
): UsgOrganState | null {
  if (!text.trim()) return null;
  if (surgeryPattern.test(text) || LOCAL_SURGICAL_STATUS_PATTERN.test(text)) {
    return "surgically_absent";
  }
  if (NOT_VISUALIZED_PATTERN.test(text)) {
    return "not_visualized";
  }
  if (NOT_ASSESSED_PATTERN.test(text)) {
    return "not_assessed";
  }
  if (LIMITED_VISUALIZATION_PATTERN.test(text)) {
    return "limited_visualization";
  }
  return null;
}

function detectStateFromGlobalText(
  text: string,
  organKey: UsgOrganKey,
  surgeryPattern: RegExp
): UsgOrganState | null {
  if (!text.trim()) return null;
  if (surgeryPattern.test(text)) {
    return "surgically_absent";
  }
  if (buildOrganPhrasePattern(organKey, NOT_VISUALIZED_FRAGMENT).test(text)) {
    return "not_visualized";
  }
  if (buildOrganPhrasePattern(organKey, NOT_ASSESSED_FRAGMENT).test(text)) {
    return "not_assessed";
  }
  if (
    buildOrganPhrasePattern(organKey, LIMITED_VISUALIZATION_FRAGMENT).test(text)
  ) {
    return "limited_visualization";
  }
  return null;
}

function inferOrganState(params: {
  organ: UsgOrganKey;
  localText: string;
  globalText: string;
}): UsgOrganState {
  const surgeryPattern = ORGAN_SURGERY_PATTERNS[params.organ];
  const local = detectStateFromLocalText(params.localText, surgeryPattern);
  if (local) return local;
  const global = detectStateFromGlobalText(
    params.globalText,
    params.organ,
    surgeryPattern
  );
  if (global) return global;
  return "visualized";
}

export function isHighRiskUsgOrganState(state: UsgOrganState) {
  return state !== "visualized";
}

function cloneAndTrimOverrides(overrides: UsgFieldOverrides) {
  const next: UsgFieldOverrides = {};
  for (const key of USG_FIELD_KEYS) {
    const value = overrides[key];
    if (typeof value !== "string") continue;
    next[key] = value.trim();
  }
  return next;
}

function enforceOrganSuppression(params: {
  overrides: UsgFieldOverrides;
  suppressed: Set<keyof UsgFieldOverrides>;
  state: UsgOrganState;
  mainField: keyof UsgFieldOverrides;
  detailFields: (keyof UsgFieldOverrides)[];
}) {
  const { overrides, suppressed, state, mainField, detailFields } = params;
  if (!isHighRiskUsgOrganState(state)) return;

  for (const field of detailFields) {
    overrides[field] = "";
    suppressed.add(field);
  }

  if (!hasText(overrides[mainField])) {
    suppressed.add(mainField);
  }
}

export function normalizeUsgOverridesForConsistency(params: {
  overrides?: UsgFieldOverrides;
  gender: UsgGender;
}): UsgConsistencyNormalization {
  const gender = params.gender;
  const normalizedOverrides = cloneAndTrimOverrides(params.overrides || {});
  const suppressed = new Set<keyof UsgFieldOverrides>();
  const globalText = collectText(normalizedOverrides, ["impression"]);

  const organStates: UsgOrganStateMap = {
    liver: inferOrganState({
      organ: "liver",
      localText: collectText(normalizedOverrides, [
        "liver_main",
        "liver_focal_lesion",
        "liver_hepatic_veins",
        "liver_ihbr",
        "liver_portal_vein"
      ]),
      globalText
    }),
    gallbladder: inferOrganState({
      organ: "gallbladder",
      localText: collectText(normalizedOverrides, [
        "gallbladder_main",
        "gallbladder_calculus_sludge",
        "cbd_main"
      ]),
      globalText
    }),
    pancreas: inferOrganState({
      organ: "pancreas",
      localText: collectText(normalizedOverrides, [
        "pancreas_main",
        "pancreas_echotexture"
      ]),
      globalText
    }),
    spleen: inferOrganState({
      organ: "spleen",
      localText: collectText(normalizedOverrides, [
        "spleen_main",
        "spleen_focal_lesion"
      ]),
      globalText
    }),
    kidneys: inferOrganState({
      organ: "kidneys",
      localText: collectText(normalizedOverrides, [
        "kidneys_size",
        "kidneys_main",
        "kidneys_cmd",
        "kidneys_cortical_scarring",
        "kidneys_parenchyma",
        "kidneys_calculus_hydronephrosis"
      ]),
      globalText
    }),
    bladder: inferOrganState({
      organ: "bladder",
      localText: collectText(normalizedOverrides, [
        "bladder_main",
        "bladder_mass_calculus"
      ]),
      globalText
    }),
    prostate: inferOrganState({
      organ: "prostate",
      localText: collectText(normalizedOverrides, [
        "prostate_main",
        "prostate_echotexture"
      ]),
      globalText
    }),
    uterus: inferOrganState({
      organ: "uterus",
      localText: collectText(normalizedOverrides, [
        "uterus_main",
        "uterus_myometrium",
        "endometrium_measurement_mm"
      ]),
      globalText
    }),
    adnexa: inferOrganState({
      organ: "adnexa",
      localText: collectText(normalizedOverrides, [
        "ovaries_main",
        "adnexal_mass"
      ]),
      globalText
    })
  };

  enforceOrganSuppression({
    overrides: normalizedOverrides,
    suppressed,
    state: organStates.liver,
    mainField: "liver_main",
    detailFields: [
      "liver_focal_lesion",
      "liver_hepatic_veins",
      "liver_ihbr",
      "liver_portal_vein"
    ]
  });
  enforceOrganSuppression({
    overrides: normalizedOverrides,
    suppressed,
    state: organStates.gallbladder,
    mainField: "gallbladder_main",
    detailFields: ["gallbladder_calculus_sludge"]
  });
  enforceOrganSuppression({
    overrides: normalizedOverrides,
    suppressed,
    state: organStates.pancreas,
    mainField: "pancreas_main",
    detailFields: ["pancreas_echotexture"]
  });
  enforceOrganSuppression({
    overrides: normalizedOverrides,
    suppressed,
    state: organStates.spleen,
    mainField: "spleen_main",
    detailFields: ["spleen_focal_lesion"]
  });
  enforceOrganSuppression({
    overrides: normalizedOverrides,
    suppressed,
    state: organStates.kidneys,
    mainField: "kidneys_main",
    detailFields: [
      "kidneys_size",
      "kidneys_cmd",
      "kidneys_cortical_scarring",
      "kidneys_parenchyma",
      "kidneys_calculus_hydronephrosis"
    ]
  });
  enforceOrganSuppression({
    overrides: normalizedOverrides,
    suppressed,
    state: organStates.bladder,
    mainField: "bladder_main",
    detailFields: ["bladder_mass_calculus"]
  });
  enforceOrganSuppression({
    overrides: normalizedOverrides,
    suppressed,
    state: organStates.prostate,
    mainField: "prostate_main",
    detailFields: ["prostate_echotexture"]
  });
  enforceOrganSuppression({
    overrides: normalizedOverrides,
    suppressed,
    state: organStates.uterus,
    mainField: "uterus_main",
    detailFields: ["uterus_myometrium", "endometrium_measurement_mm"]
  });
  enforceOrganSuppression({
    overrides: normalizedOverrides,
    suppressed,
    state: organStates.adnexa,
    mainField: "ovaries_main",
    detailFields: ["adnexal_mass"]
  });

  if (
    !hasText(normalizedOverrides.uterus_main) &&
    organStates.uterus === "surgically_absent"
  ) {
    normalizedOverrides.uterus_main =
      "Uterus is not visualized, likely post-hysterectomy status.";
    suppressed.delete("uterus_main");
  }
  if (
    !hasText(normalizedOverrides.gallbladder_main) &&
    organStates.gallbladder === "surgically_absent"
  ) {
    normalizedOverrides.gallbladder_main =
      "is not visualized, likely post-cholecystectomy status.";
    suppressed.delete("gallbladder_main");
  }
  if (
    !hasText(normalizedOverrides.prostate_main) &&
    organStates.prostate === "surgically_absent"
  ) {
    normalizedOverrides.prostate_main =
      "Prostate is not visualized, likely post-prostatectomy status.";
    suppressed.delete("prostate_main");
  }
  if (
    !hasText(normalizedOverrides.ovaries_main) &&
    organStates.adnexa === "surgically_absent"
  ) {
    normalizedOverrides.ovaries_main =
      "Both ovaries are not visualized, likely post-oophorectomy status.";
    suppressed.delete("ovaries_main");
  }

  if (gender === "male") {
    normalizedOverrides.uterus_main = "";
    normalizedOverrides.uterus_myometrium = "";
    normalizedOverrides.endometrium_measurement_mm = "";
    normalizedOverrides.ovaries_main = "";
    normalizedOverrides.adnexal_mass = "";
    suppressed.add("uterus_main");
    suppressed.add("uterus_myometrium");
    suppressed.add("endometrium_measurement_mm");
    suppressed.add("ovaries_main");
    suppressed.add("adnexal_mass");
  } else {
    normalizedOverrides.prostate_main = "";
    normalizedOverrides.prostate_echotexture = "";
    suppressed.add("prostate_main");
    suppressed.add("prostate_echotexture");
  }

  const normalizedImpression = normalizeImpressionTerminology(
    normalizedOverrides.impression || ""
  );
  const bladderText = collectText(normalizedOverrides, [
    "bladder_main",
    "bladder_mass_calculus"
  ]);
  const needsCystitisImpression =
    hasBladderWallThickening(bladderText) && !/\bcystitis\b/i.test(normalizedImpression);
  const impressionWithCystitis = needsCystitisImpression
    ? normalizedImpression
      ? `${normalizedImpression.replace(/[.;,\s]+$/g, "")}; features suggestive of cystitis`
      : "Features suggestive of cystitis"
    : normalizedImpression;
  normalizedOverrides.impression = impressionWithCystitis;

  return {
    overrides: normalizedOverrides,
    suppressedFields: Array.from(suppressed),
    organStates
  };
}

function resolveField(
  overrides: UsgFieldOverrides,
  defaults: Required<UsgFieldOverrides>,
  key: keyof UsgFieldOverrides,
  suppressedFields: Set<keyof UsgFieldOverrides>
) {
  if (suppressedFields.has(key)) {
    return "";
  }
  const value = overrides[key];
  const trimmed = typeof value === "string" ? value.trim() : "";
  const fallback = defaults[key] as string;
  return trimmed ? trimmed : fallback;
}

function joinSentences(parts: string[]) {
  return parts.map(ensurePeriod).filter(Boolean).join(" ");
}

function joinFragments(parts: string[]) {
  return parts.map((part) => part.trim()).filter(Boolean).join(" ");
}

function padTableCell(text: string, minWidth: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length >= minWidth) return normalized;
  return `${normalized}${" ".repeat(minWidth - normalized.length)}`;
}

function buildUsgKubHeaderTable(params: {
  labNo: string;
  date: string;
  name: string;
  ageSex: string;
  referredBy: string;
}) {
  const labelWidth = Math.max("REFERRED BY".length, "AGE / SEX".length, 8);
  const leftValueWidth = Math.max(
    params.labNo.length,
    params.name.length,
    params.referredBy.length,
    20
  );
  const rightValueWidth = Math.max(params.date.length, params.ageSex.length, 16);

  const border =
    `+${"-".repeat(labelWidth + 2)}` +
    `+${"-".repeat(leftValueWidth + 2)}` +
    `+${"-".repeat(labelWidth + 2)}` +
    `+${"-".repeat(rightValueWidth + 2)}+`;

  const row = (label1: string, value1: string, label2: string, value2: string) =>
    `| ${padTableCell(label1, labelWidth)} | ${padTableCell(
      value1,
      leftValueWidth
    )} | ${padTableCell(label2, labelWidth)} | ${padTableCell(
      value2,
      rightValueWidth
    )} |`;

  return [
    border,
    row("LAB NO.", params.labNo, "DATE", params.date),
    border,
    row("NAME", params.name, "AGE / SEX", params.ageSex),
    border,
    row("REFERRED BY", params.referredBy, "", ""),
    border
  ];
}

function resolvePatientInfo(patient: UsgPatientInfo, gender: UsgGender) {
  const name = patient.name?.trim() || "________________";
  const genderLabel =
    patient.gender?.trim() || (gender === "female" ? "Female" : "Male");
  const date = patient.date?.trim() || "____/____/______";
  return { name, gender: genderLabel, date };
}

function buildConclusionLine(
  conclusion: string,
  gender: UsgGender,
  defaults: Required<UsgFieldOverrides>,
  options?: { forceLabel?: string }
) {
  const label =
    options?.forceLabel ||
    (gender === "female" ? "Significant findings :" : "IMPRESSION:");
  const trimmed = conclusion.trim();
  if (!trimmed) {
    return ensurePeriod(`${label} ${defaults.impression}`);
  }
  if (/^(impression|conclusion|significant findings)\b/i.test(trimmed)) {
    return ensurePeriod(trimmed);
  }
  return ensurePeriod(`${label} ${trimmed}`);
}

export function buildUsgReport(params: {
  gender?: UsgGender;
  patient?: UsgPatientInfo;
  overrides?: UsgFieldOverrides;
  suppressedFields?: (keyof UsgFieldOverrides)[];
} = {}) {
  const gender = params.gender || "male";
  const consistency = normalizeUsgOverridesForConsistency({
    overrides: params.overrides || {},
    gender
  });
  const overrides = consistency.overrides;
  const suppressedFields = new Set([
    ...consistency.suppressedFields,
    ...(params.suppressedFields || [])
  ]);
  const defaults =
    gender === "female" ? USG_DEFAULT_FIELDS_FEMALE : USG_DEFAULT_FIELDS_MALE;
  const patient = resolvePatientInfo(params.patient || {}, gender);

  const lines: string[] = [];
  lines.push(
    `NAME: ${patient.name}    GENDER: ${patient.gender}    DATE: ${patient.date}`
  );
  lines.push("SONOGRAPHY WHOLE ABDOMEN");

  const liverLine = joinSentences([
    resolveField(overrides, defaults, "liver_main", suppressedFields),
    resolveField(overrides, defaults, "liver_focal_lesion", suppressedFields),
    resolveField(overrides, defaults, "liver_hepatic_veins", suppressedFields),
    resolveField(overrides, defaults, "liver_ihbr", suppressedFields),
    resolveField(overrides, defaults, "liver_portal_vein", suppressedFields)
  ]);
  if (liverLine) {
    lines.push(`Liver: ${liverLine}`);
  }

  const gallbladderLine = joinSentences([
    resolveField(overrides, defaults, "gallbladder_main", suppressedFields),
    resolveField(
      overrides,
      defaults,
      "gallbladder_calculus_sludge",
      suppressedFields
    ),
    resolveField(overrides, defaults, "cbd_main", suppressedFields)
  ]);
  if (gallbladderLine) {
    lines.push(`Gall bladder: ${gallbladderLine}`);
  }

  const pancreasLine = joinSentences([
    resolveField(overrides, defaults, "pancreas_main", suppressedFields),
    resolveField(overrides, defaults, "pancreas_echotexture", suppressedFields)
  ]);
  if (pancreasLine) {
    lines.push(`Pancreas: ${pancreasLine}`);
  }

  const spleenLine = joinSentences([
    resolveField(overrides, defaults, "spleen_main", suppressedFields),
    resolveField(overrides, defaults, "spleen_focal_lesion", suppressedFields)
  ]);
  if (spleenLine) {
    lines.push(`Spleen: ${spleenLine}`);
  }

  const kidneySize = resolveField(
    overrides,
    defaults,
    "kidneys_size",
    suppressedFields
  );
  if (kidneySize.trim()) {
    lines.push(`Kidneys: ${ensurePeriod(kidneySize)}`);
  }

  const kidneyDetails = joinSentences([
    resolveField(overrides, defaults, "kidneys_main", suppressedFields),
    resolveField(overrides, defaults, "kidneys_cmd", suppressedFields),
    resolveField(
      overrides,
      defaults,
      "kidneys_cortical_scarring",
      suppressedFields
    ),
    resolveField(overrides, defaults, "kidneys_parenchyma", suppressedFields),
    resolveField(
      overrides,
      defaults,
      "kidneys_calculus_hydronephrosis",
      suppressedFields
    )
  ]);
  if (kidneyDetails) {
    lines.push(kidneySize.trim() ? kidneyDetails : `Kidneys: ${kidneyDetails}`);
  }

  const bladderLine = joinSentences([
    resolveField(overrides, defaults, "bladder_main", suppressedFields),
    resolveField(overrides, defaults, "bladder_mass_calculus", suppressedFields)
  ]);
  if (bladderLine) {
    lines.push(`Urinary Bladder: ${bladderLine}`);
  }

  if (gender === "male") {
    const prostateMain = resolveField(
      overrides,
      defaults,
      "prostate_main",
      suppressedFields
    );
    if (prostateMain.trim()) {
      lines.push(`Prostate: ${ensurePeriod(prostateMain)}`);
    }
    const prostateEcho = resolveField(
      overrides,
      defaults,
      "prostate_echotexture",
      suppressedFields
    );
    if (prostateEcho.trim()) {
      lines.push(ensurePeriod(prostateEcho));
    }
  } else {
    const uterusMain = resolveField(
      overrides,
      defaults,
      "uterus_main",
      suppressedFields
    );
    const uterusMyometrium = resolveField(
      overrides,
      defaults,
      "uterus_myometrium",
      suppressedFields
    );
    const endometrium = resolveField(
      overrides,
      defaults,
      "endometrium_measurement_mm",
      suppressedFields
    );
    const endometriumIsSuppressed = suppressedFields.has(
      "endometrium_measurement_mm"
    );
    const endometriumLine = endometrium.trim()
      ? `Endometrial echoes are central (${endometrium} mm).`
      : endometriumIsSuppressed
      ? ""
      : "Endometrial echoes are central.";
    const uterusLine = joinFragments([
      ensurePeriod(uterusMain),
      ensurePeriod(uterusMyometrium),
      endometriumLine
    ]);
    if (uterusLine) {
      lines.push(`Uterus: ${uterusLine}`);
    }

    const adnexaLine = joinSentences([
      resolveField(overrides, defaults, "adnexal_mass", suppressedFields),
      resolveField(overrides, defaults, "ovaries_main", suppressedFields)
    ]);
    if (adnexaLine) {
      lines.push(`Adenexa: ${adnexaLine}`);
    }
  }

  const peritoneal = resolveField(
    overrides,
    defaults,
    "peritoneal_fluid",
    suppressedFields
  );
  if (peritoneal.trim()) {
    lines.push(ensurePeriod(peritoneal));
  }

  const lymphNodes = resolveField(
    overrides,
    defaults,
    "lymph_nodes",
    suppressedFields
  );
  if (lymphNodes.trim()) {
    lines.push(ensurePeriod(lymphNodes));
  }

  lines.push(
    buildConclusionLine(
      resolveField(overrides, defaults, "impression", suppressedFields),
      gender,
      defaults
    )
  );

  const correlation = resolveField(
    overrides,
    defaults,
    "correlate_clinically",
    suppressedFields
  );
  if (correlation.trim()) {
    lines.push(ensurePeriod(correlation));
  }

  const endOfReportLine =
    gender === "female"
      ? USG_END_OF_REPORT_LINE_FEMALE
      : USG_END_OF_REPORT_LINE_MALE;
  lines.push(endOfReportLine);
  lines.push(USG_LIMITATIONS_NOTE);

  return lines.join("\n");
}

export function buildUsgKubReport(params: {
  gender?: UsgGender;
  patient?: UsgPatientInfo;
  overrides?: UsgFieldOverrides;
  suppressedFields?: (keyof UsgFieldOverrides)[];
} = {}) {
  const gender = params.gender || "male";
  const consistency = normalizeUsgOverridesForConsistency({
    overrides: params.overrides || {},
    gender
  });
  const overrides = consistency.overrides;
  const suppressedFields = new Set([
    ...consistency.suppressedFields,
    ...(params.suppressedFields || [])
  ]);
  const defaults =
    gender === "female"
      ? USG_KUB_DEFAULT_FIELDS_FEMALE
      : USG_KUB_DEFAULT_FIELDS_MALE;
  const patient = resolvePatientInfo(params.patient || {}, gender);
  const labNo = params.patient?.labNo?.trim() || "____________________";
  const age = params.patient?.age?.trim() || "________";
  const referredBy =
    params.patient?.referredBy?.trim() || USG_KUB_REFERRED_BY_DEFAULT;
  const ageSex = `${age} / ${patient.gender}`;

  const lines: string[] = [];
  lines.push(USG_KUB_DEPARTMENT_LINE);
  lines.push("");
  lines.push(
    ...buildUsgKubHeaderTable({
      labNo,
      date: patient.date,
      name: patient.name,
      ageSex,
      referredBy
    })
  );
  lines.push("");
  lines.push("USG KUB");
  lines.push("");

  const kidneySize = resolveField(
    overrides,
    defaults,
    "kidneys_size",
    suppressedFields
  );
  if (kidneySize.trim()) {
    lines.push(`Kidneys: ${ensurePeriod(kidneySize)}`);
  }

  const kidneyDetails = joinSentences([
    resolveField(overrides, defaults, "kidneys_main", suppressedFields),
    resolveField(overrides, defaults, "kidneys_cmd", suppressedFields),
    resolveField(
      overrides,
      defaults,
      "kidneys_cortical_scarring",
      suppressedFields
    ),
    resolveField(overrides, defaults, "kidneys_parenchyma", suppressedFields),
    resolveField(
      overrides,
      defaults,
      "kidneys_calculus_hydronephrosis",
      suppressedFields
    )
  ]);
  if (kidneyDetails) {
    lines.push(kidneySize.trim() ? kidneyDetails : `Kidneys: ${kidneyDetails}`);
  }

  const bladderLine = joinSentences([
    resolveField(overrides, defaults, "bladder_main", suppressedFields),
    resolveField(overrides, defaults, "bladder_mass_calculus", suppressedFields)
  ]);
  if (bladderLine) {
    lines.push(`Urinary Bladder: ${bladderLine}`);
  }

  if (gender === "male") {
    const prostateMain = resolveField(
      overrides,
      defaults,
      "prostate_main",
      suppressedFields
    );
    if (prostateMain.trim()) {
      lines.push(`Prostate: ${ensurePeriod(prostateMain)}`);
    }
    const prostateEcho = resolveField(
      overrides,
      defaults,
      "prostate_echotexture",
      suppressedFields
    );
    if (prostateEcho.trim()) {
      lines.push(ensurePeriod(prostateEcho));
    }
  } else {
    const uterusMain = resolveField(
      overrides,
      defaults,
      "uterus_main",
      suppressedFields
    );
    const uterusMyometrium = resolveField(
      overrides,
      defaults,
      "uterus_myometrium",
      suppressedFields
    );
    const endometrium = resolveField(
      overrides,
      defaults,
      "endometrium_measurement_mm",
      suppressedFields
    );
    const endometriumIsSuppressed = suppressedFields.has(
      "endometrium_measurement_mm"
    );
    const endometriumLine = endometrium.trim()
      ? `Endometrial echoes are central (${endometrium} mm).`
      : endometriumIsSuppressed
      ? ""
      : "Endometrial echoes are central.";
    const uterusLine = joinFragments([
      ensurePeriod(uterusMain),
      ensurePeriod(uterusMyometrium),
      endometriumLine
    ]);
    if (uterusLine) {
      lines.push(`Uterus: ${uterusLine}`);
    }
  }

  lines.push(
    buildConclusionLine(
      resolveField(overrides, defaults, "impression", suppressedFields),
      gender,
      defaults,
      { forceLabel: "IMPRESSION:" }
    )
  );

  const correlation = resolveField(
    overrides,
    defaults,
    "correlate_clinically",
    suppressedFields
  );
  if (correlation.trim()) {
    lines.push(ensurePeriod(correlation));
  }

  return lines.join("\n");
}

export const USG_ABDOMEN_MALE_TEMPLATE = buildUsgReport({ gender: "male" });
export const USG_ABDOMEN_FEMALE_TEMPLATE = buildUsgReport({ gender: "female" });
export const USG_KUB_MALE_TEMPLATE = buildUsgKubReport({ gender: "male" });
export const USG_KUB_FEMALE_TEMPLATE = buildUsgKubReport({ gender: "female" });
