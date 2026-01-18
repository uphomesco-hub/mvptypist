export type UsgGender = "male" | "female";

export type UsgPatientInfo = {
  name?: string;
  gender?: string;
  date?: string;
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

const USG_END_OF_REPORT_LINE_MALE =
  "--------------------------------------------------------------END OF REPORT --------------------------------------------------------------";
const USG_END_OF_REPORT_LINE_FEMALE =
  "------------------------------------------------END of report -----------------------------------------------------------";

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

export const USG_FIELD_KEYS = Object.keys(
  USG_DEFAULT_FIELDS_MALE
) as (keyof UsgFieldOverrides)[];

function ensurePeriod(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function resolveField(
  overrides: UsgFieldOverrides,
  defaults: Required<UsgFieldOverrides>,
  key: keyof UsgFieldOverrides
) {
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
  defaults: Required<UsgFieldOverrides>
) {
  const label = gender === "female" ? "Significant findings :" : "IMPRESSION:";
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
} = {}) {
  const gender = params.gender || "male";
  const overrides = params.overrides || {};
  const defaults =
    gender === "female" ? USG_DEFAULT_FIELDS_FEMALE : USG_DEFAULT_FIELDS_MALE;
  const patient = resolvePatientInfo(params.patient || {}, gender);

  const lines: string[] = [];
  lines.push(
    `NAME: ${patient.name}    GENDER: ${patient.gender}    DATE: ${patient.date}`
  );
  lines.push("SONOGRAPHY WHOLE ABDOMEN");

  const liverLine = joinSentences([
    resolveField(overrides, defaults, "liver_main"),
    resolveField(overrides, defaults, "liver_focal_lesion"),
    resolveField(overrides, defaults, "liver_hepatic_veins"),
    resolveField(overrides, defaults, "liver_ihbr"),
    resolveField(overrides, defaults, "liver_portal_vein")
  ]);
  lines.push(`Liver: ${liverLine}`);

  const gallbladderLine = joinSentences([
    resolveField(overrides, defaults, "gallbladder_main"),
    resolveField(overrides, defaults, "gallbladder_calculus_sludge"),
    resolveField(overrides, defaults, "cbd_main")
  ]);
  lines.push(`Gall bladder: ${gallbladderLine}`);

  const pancreasLine = joinSentences([
    resolveField(overrides, defaults, "pancreas_main"),
    resolveField(overrides, defaults, "pancreas_echotexture")
  ]);
  lines.push(`Pancreas: ${pancreasLine}`);

  const spleenLine = joinSentences([
    resolveField(overrides, defaults, "spleen_main"),
    resolveField(overrides, defaults, "spleen_focal_lesion")
  ]);
  lines.push(`Spleen: ${spleenLine}`);

  const kidneySize = resolveField(overrides, defaults, "kidneys_size");
  if (kidneySize.trim()) {
    lines.push(`Kidneys: ${ensurePeriod(kidneySize)}`);
  }

  const kidneyDetails = joinSentences([
    resolveField(overrides, defaults, "kidneys_main"),
    resolveField(overrides, defaults, "kidneys_cmd"),
    resolveField(overrides, defaults, "kidneys_cortical_scarring"),
    resolveField(overrides, defaults, "kidneys_parenchyma"),
    resolveField(overrides, defaults, "kidneys_calculus_hydronephrosis")
  ]);
  if (kidneyDetails) {
    lines.push(kidneySize.trim() ? kidneyDetails : `Kidneys: ${kidneyDetails}`);
  }

  const bladderLine = joinSentences([
    resolveField(overrides, defaults, "bladder_main"),
    resolveField(overrides, defaults, "bladder_mass_calculus")
  ]);
  lines.push(`Urinary Bladder: ${bladderLine}`);

  if (gender === "male") {
    const prostateMain = resolveField(overrides, defaults, "prostate_main");
    if (prostateMain.trim()) {
      lines.push(`Prostate: ${ensurePeriod(prostateMain)}`);
    }
    const prostateEcho = resolveField(overrides, defaults, "prostate_echotexture");
    if (prostateEcho.trim()) {
      lines.push(ensurePeriod(prostateEcho));
    }
  } else {
    const uterusMain = resolveField(overrides, defaults, "uterus_main");
    const uterusMyometrium = resolveField(
      overrides,
      defaults,
      "uterus_myometrium"
    );
    const endometrium = resolveField(
      overrides,
      defaults,
      "endometrium_measurement_mm"
    );
    const endometriumLine = endometrium.trim()
      ? `Endometrial echoes are central (${endometrium} mm).`
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
      resolveField(overrides, defaults, "adnexal_mass"),
      resolveField(overrides, defaults, "ovaries_main")
    ]);
    if (adnexaLine) {
      lines.push(`Adenexa: ${adnexaLine}`);
    }
  }

  const peritoneal = resolveField(overrides, defaults, "peritoneal_fluid");
  if (peritoneal.trim()) {
    lines.push(ensurePeriod(peritoneal));
  }

  const lymphNodes = resolveField(overrides, defaults, "lymph_nodes");
  if (lymphNodes.trim()) {
    lines.push(ensurePeriod(lymphNodes));
  }

  lines.push(
    buildConclusionLine(
      resolveField(overrides, defaults, "impression"),
      gender,
      defaults
    )
  );

  const correlation = resolveField(
    overrides,
    defaults,
    "correlate_clinically"
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

export const USG_ABDOMEN_MALE_TEMPLATE = buildUsgReport({ gender: "male" });
export const USG_ABDOMEN_FEMALE_TEMPLATE = buildUsgReport({ gender: "female" });
