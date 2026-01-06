export type UsgFieldOverrides = {
  liver_main?: string;
  liver_focal_lesion?: string;
  liver_ihbr?: string;
  liver_portal_vein?: string;
  gallbladder_main?: string;
  gallbladder_calculus_sludge?: string;
  gallbladder_pericholecystic_fluid?: string;
  cbd_caliber?: string;
  cbd_measurement_mm?: string;
  cbd_intraluminal_calculus?: string;
  pancreas_main?: string;
  pancreas_focal_lesion?: string;
  pancreas_duct?: string;
  spleen_size?: string;
  spleen_measurement_cm?: string;
  spleen_echotexture?: string;
  spleen_focal_lesion?: string;
  kidneys_main?: string;
  kidneys_cmd?: string;
  kidneys_calculus_hydronephrosis?: string;
  adrenal_main?: string;
  bladder_main?: string;
  bladder_mass_calculus?: string;
  prostate_main?: string;
  prostate_measurement_g?: string;
  prostate_focal_lesion?: string;
  uterus_main?: string;
  uterus_myometrium?: string;
  endometrium_measurement_mm?: string;
  ovaries_main?: string;
  adnexal_mass?: string;
  aorta_ivc_main?: string;
  bowel_loops_main?: string;
  peritoneal_fluid?: string;
  impression?: string;
};

export type UsgSectionAdditions = {
  liver?: string;
  gallBladder?: string;
  commonBileDuct?: string;
  pancreas?: string;
  spleen?: string;
  kidneys?: string;
  adrenalGlands?: string;
  urinaryBladder?: string;
  prostateUterusAdnexa?: string;
  aortaIvc?: string;
  bowelLoops?: string;
  peritonealCavity?: string;
  impression?: string;
};

export const USG_DEFAULT_FIELDS: Required<UsgFieldOverrides> = {
  liver_main: "normal in size, shape, and echotexture",
  liver_focal_lesion: "No focal space-occupying lesion is seen.",
  liver_ihbr: "not dilated",
  liver_portal_vein: "normal in caliber with hepatopetal flow",
  gallbladder_main: "well distended with normal wall thickness",
  gallbladder_calculus_sludge: "No evidence of calculus or sludge is seen.",
  gallbladder_pericholecystic_fluid: "No pericholecystic fluid is noted.",
  cbd_caliber: "normal in caliber",
  cbd_measurement_mm: "___",
  cbd_intraluminal_calculus: "No intraluminal calculus is seen.",
  pancreas_main: "normal in size and echotexture",
  pancreas_focal_lesion: "no focal lesion",
  pancreas_duct: "not dilated",
  spleen_size: "normal",
  spleen_measurement_cm: "___",
  spleen_echotexture: "homogeneous",
  spleen_focal_lesion: "No focal lesion is seen.",
  kidneys_main: "normal in size, shape, and position",
  kidneys_cmd: "maintained",
  kidneys_calculus_hydronephrosis: "No renal calculus or hydronephrosis is seen.",
  adrenal_main: "normal",
  bladder_main: "well distended with normal wall thickness",
  bladder_mass_calculus: "No intraluminal mass or calculus is seen.",
  prostate_main: "normal in size and echotexture",
  prostate_measurement_g: "___",
  prostate_focal_lesion: "no focal lesion",
  uterus_main: "normal in size and shape",
  uterus_myometrium: "normal",
  endometrium_measurement_mm: "___",
  ovaries_main: "normal in size and appearance",
  adnexal_mass: "No adnexal mass is seen.",
  aorta_ivc_main: "normal in caliber",
  bowel_loops_main: "no abnormal wall thickening or mass",
  peritoneal_fluid: "No free fluid is seen.",
  impression: "Normal ultrasonography of the whole abdomen."
};

export const USG_FIELD_KEYS = Object.keys(
  USG_DEFAULT_FIELDS
) as (keyof UsgFieldOverrides)[];

function ensurePeriod(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function resolveField(
  overrides: UsgFieldOverrides,
  key: keyof UsgFieldOverrides
) {
  const value = overrides[key];
  const trimmed = typeof value === "string" ? value.trim() : "";
  const fallback = USG_DEFAULT_FIELDS[key] as string;
  return trimmed ? trimmed : fallback;
}

function resolveSentence(
  overrides: UsgFieldOverrides,
  key: keyof UsgFieldOverrides
) {
  const value = resolveField(overrides, key);
  return ensurePeriod(value);
}

function resolveAddition(additions: UsgSectionAdditions, key: keyof UsgSectionAdditions) {
  const value = additions[key];
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return ensurePeriod(trimmed);
}

export function buildUsgReport(
  overrides: UsgFieldOverrides = {},
  additions: UsgSectionAdditions = {}
) {
  const lines: string[] = [];
  const maybePush = (value: string) => {
    if (value) {
      lines.push(value);
    }
  };

  lines.push("ULTRASONOGRAPHY - WHOLE ABDOMEN");
  lines.push("");
  lines.push("Patient Name:");
  lines.push("Age / Sex:");
  lines.push("Patient ID:");
  lines.push("Referring Doctor:");
  lines.push("Date of Examination:");
  lines.push("Indication:");
  lines.push("");
  lines.push("Liver:");
  lines.push(
    `The liver is ${resolveField(overrides, "liver_main")} with smooth margins.`
  );
  lines.push(resolveSentence(overrides, "liver_focal_lesion"));
  lines.push(
    `The intrahepatic biliary radicles are ${resolveField(overrides, "liver_ihbr")}.`
  );
  lines.push(
    `The portal vein is ${resolveField(overrides, "liver_portal_vein")}.`
  );
  maybePush(resolveAddition(additions, "liver"));
  lines.push("");
  lines.push("Gall Bladder:");
  lines.push(
    `The gall bladder is ${resolveField(overrides, "gallbladder_main")}.`
  );
  lines.push(resolveSentence(overrides, "gallbladder_calculus_sludge"));
  lines.push(resolveSentence(overrides, "gallbladder_pericholecystic_fluid"));
  maybePush(resolveAddition(additions, "gallBladder"));
  lines.push("");
  lines.push("Common Bile Duct:");
  lines.push(
    `The common bile duct is ${resolveField(
      overrides,
      "cbd_caliber"
    )} and measures ${resolveField(overrides, "cbd_measurement_mm")} mm.`
  );
  lines.push(resolveSentence(overrides, "cbd_intraluminal_calculus"));
  maybePush(resolveAddition(additions, "commonBileDuct"));
  lines.push("");
  lines.push("Pancreas:");
  lines.push(
    `The pancreas is ${resolveField(overrides, "pancreas_main")} with ${resolveField(
      overrides,
      "pancreas_focal_lesion"
    )}.`
  );
  lines.push(
    `The pancreatic duct is ${resolveField(overrides, "pancreas_duct")}.`
  );
  maybePush(resolveAddition(additions, "pancreas"));
  lines.push("");
  lines.push("Spleen:");
  lines.push(
    `The spleen is ${resolveField(overrides, "spleen_size")} in size, measuring ${resolveField(
      overrides,
      "spleen_measurement_cm"
    )} cm, with ${resolveField(overrides, "spleen_echotexture")} echotexture.`
  );
  lines.push(resolveSentence(overrides, "spleen_focal_lesion"));
  maybePush(resolveAddition(additions, "spleen"));
  lines.push("");
  lines.push("Kidneys:");
  lines.push(
    `Both kidneys are ${resolveField(overrides, "kidneys_main")} with ${resolveField(
      overrides,
      "kidneys_cmd"
    )} corticomedullary differentiation.`
  );
  lines.push(resolveSentence(overrides, "kidneys_calculus_hydronephrosis"));
  maybePush(resolveAddition(additions, "kidneys"));
  lines.push("");
  lines.push("Adrenal Glands:");
  lines.push(
    `Both adrenal glands appear ${resolveField(overrides, "adrenal_main")}.`
  );
  maybePush(resolveAddition(additions, "adrenalGlands"));
  lines.push("");
  lines.push("Urinary Bladder:");
  lines.push(
    `The urinary bladder is ${resolveField(overrides, "bladder_main")}.`
  );
  lines.push(resolveSentence(overrides, "bladder_mass_calculus"));
  maybePush(resolveAddition(additions, "urinaryBladder"));
  lines.push("");
  lines.push("Prostate / Uterus & Adnexa:");
  lines.push(
    `In male patients, the prostate gland is ${resolveField(
      overrides,
      "prostate_main"
    )}, measuring ${resolveField(
      overrides,
      "prostate_measurement_g"
    )} grams, with ${resolveField(overrides, "prostate_focal_lesion")}.`
  );
  lines.push(
    `In female patients, the uterus is ${resolveField(
      overrides,
      "uterus_main"
    )} with ${resolveField(
      overrides,
      "uterus_myometrium"
    )} myometrial echotexture.`
  );
  lines.push(
    `The endometrial thickness measures ${resolveField(
      overrides,
      "endometrium_measurement_mm"
    )} mm and is appropriate for age and phase of the menstrual cycle.`
  );
  lines.push(`Both ovaries are ${resolveField(overrides, "ovaries_main")}.`);
  lines.push(resolveSentence(overrides, "adnexal_mass"));
  maybePush(resolveAddition(additions, "prostateUterusAdnexa"));
  lines.push("");
  lines.push("Aorta & IVC:");
  lines.push(
    `The abdominal aorta and inferior vena cava are ${resolveField(
      overrides,
      "aorta_ivc_main"
    )}.`
  );
  maybePush(resolveAddition(additions, "aortaIvc"));
  lines.push("");
  lines.push("Bowel Loops:");
  lines.push(
    `The visualized bowel loops show ${resolveField(
      overrides,
      "bowel_loops_main"
    )}.`
  );
  maybePush(resolveAddition(additions, "bowelLoops"));
  lines.push("");
  lines.push("Peritoneal Cavity:");
  lines.push(resolveSentence(overrides, "peritoneal_fluid"));
  maybePush(resolveAddition(additions, "peritonealCavity"));
  lines.push("");
  lines.push("Impression:");
  lines.push(resolveSentence(overrides, "impression"));
  maybePush(resolveAddition(additions, "impression"));

  return lines.join("\n");
}

export const USG_ABDOMEN_TEMPLATE = buildUsgReport();
