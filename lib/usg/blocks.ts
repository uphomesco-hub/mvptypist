import type { UsgFieldOverrides } from "@/lib/usgTemplate";

export type UsgBlockId =
  | "LIVER"
  | "GALLBLADDER"
  | "CBD"
  | "PANCREAS"
  | "SPLEEN"
  | "KIDNEYS"
  | "ADRENAL"
  | "BLADDER"
  | "PROSTATE_UTERUS_ADNEXA"
  | "AORTA_IVC"
  | "BOWEL"
  | "PERITONEAL"
  | "IMPRESSION";

export type UsgBlockDef = {
  id: UsgBlockId;
  heading: string;
  fieldKeys: (keyof UsgFieldOverrides)[];
  measurementRange?: {
    field: keyof UsgFieldOverrides;
    min?: number;
    max?: number;
  };
};

export const USG_BLOCKS: UsgBlockDef[] = [
  {
    id: "LIVER",
    heading: "Liver:",
    fieldKeys: [
      "liver_main",
      "liver_focal_lesion",
      "liver_ihbr",
      "liver_portal_vein"
    ]
  },
  {
    id: "GALLBLADDER",
    heading: "Gall Bladder:",
    fieldKeys: [
      "gallbladder_main",
      "gallbladder_calculus_sludge",
      "gallbladder_pericholecystic_fluid"
    ]
  },
  {
    id: "CBD",
    heading: "Common Bile Duct:",
    fieldKeys: [
      "cbd_caliber",
      "cbd_measurement_mm",
      "cbd_intraluminal_calculus"
    ],
    measurementRange: { field: "cbd_measurement_mm", min: 2, max: 7 }
  },
  {
    id: "PANCREAS",
    heading: "Pancreas:",
    fieldKeys: ["pancreas_main", "pancreas_focal_lesion", "pancreas_duct"]
  },
  {
    id: "SPLEEN",
    heading: "Spleen:",
    fieldKeys: [
      "spleen_size",
      "spleen_measurement_cm",
      "spleen_echotexture",
      "spleen_focal_lesion"
    ],
    measurementRange: { field: "spleen_measurement_cm", min: 8, max: 13 }
  },
  {
    id: "KIDNEYS",
    heading: "Kidneys:",
    fieldKeys: [
      "kidneys_main",
      "kidneys_cmd",
      "kidneys_calculus_hydronephrosis"
    ]
  },
  {
    id: "ADRENAL",
    heading: "Adrenal Glands:",
    fieldKeys: ["adrenal_main"]
  },
  {
    id: "BLADDER",
    heading: "Urinary Bladder:",
    fieldKeys: ["bladder_main", "bladder_mass_calculus"]
  },
  {
    id: "PROSTATE_UTERUS_ADNEXA",
    heading: "Prostate / Uterus & Adnexa:",
    fieldKeys: [
      "prostate_main",
      "prostate_measurement_g",
      "prostate_focal_lesion",
      "uterus_main",
      "uterus_myometrium",
      "endometrium_measurement_mm",
      "ovaries_main",
      "adnexal_mass"
    ]
  },
  {
    id: "AORTA_IVC",
    heading: "Aorta & IVC:",
    fieldKeys: ["aorta_ivc_main"]
  },
  {
    id: "BOWEL",
    heading: "Bowel Loops:",
    fieldKeys: ["bowel_loops_main"]
  },
  {
    id: "PERITONEAL",
    heading: "Peritoneal Cavity:",
    fieldKeys: ["peritoneal_fluid"]
  },
  {
    id: "IMPRESSION",
    heading: "Impression:",
    fieldKeys: ["impression"]
  }
];

export function getUsgBlock(id: UsgBlockId) {
  return USG_BLOCKS.find((block) => block.id === id);
}

export function getUsgBlockByHeading(heading: string) {
  return USG_BLOCKS.find((block) => block.heading === heading);
}

export function getUsgBlockOrderHeadings() {
  return USG_BLOCKS.map((block) => block.heading);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function replaceSectionByHeading(params: {
  reportText: string;
  heading: string;
  replacementLines: string[];
}) {
  const { reportText, heading, replacementLines } = params;
  const headings = getUsgBlockOrderHeadings();
  const index = headings.indexOf(heading);
  if (index === -1) {
    return reportText;
  }
  const nextHeading = headings[index + 1];

  const startNeedle = `\n${heading}\n`;
  const startIndex = reportText.indexOf(startNeedle);
  if (startIndex === -1) {
    return reportText;
  }
  const contentStart = startIndex + startNeedle.length;

  let contentEnd = reportText.length;
  if (nextHeading) {
    const nextNeedle = `\n\n${nextHeading}\n`;
    const nextIndex = reportText.indexOf(nextNeedle, contentStart);
    if (nextIndex !== -1) {
      contentEnd = nextIndex + 2; // keep the blank line before the next heading
    } else {
      const looseIndex = reportText.search(
        new RegExp(`\n\n${escapeRegExp(nextHeading)}\n`)
      );
      if (looseIndex !== -1) {
        contentEnd = looseIndex + 2;
      }
    }
  }

  const replacementBody = replacementLines.join("\n").trim();
  const withTrailingBlankLine = replacementBody ? `${replacementBody}\n\n` : "\n";
  return (
    reportText.slice(0, contentStart) +
    withTrailingBlankLine +
    reportText.slice(contentEnd)
  );
}

export function extractSectionByHeading(params: {
  reportText: string;
  heading: string;
}) {
  const { reportText, heading } = params;
  const headings = getUsgBlockOrderHeadings();
  const index = headings.indexOf(heading);
  if (index === -1) {
    return null;
  }
  const nextHeading = headings[index + 1];

  const startNeedle = `\n${heading}\n`;
  const startIndex = reportText.indexOf(startNeedle);
  if (startIndex === -1) {
    return null;
  }
  const contentStart = startIndex + startNeedle.length;

  let contentEnd = reportText.length;
  if (nextHeading) {
    const nextNeedle = `\n\n${nextHeading}\n`;
    const nextIndex = reportText.indexOf(nextNeedle, contentStart);
    if (nextIndex !== -1) {
      contentEnd = nextIndex;
    }
  }

  const body = reportText.slice(contentStart, contentEnd).trim();
  return body ? body.split(/\r?\n/).filter((line) => line.trim()) : [];
}

export function containsLaterality(text: string) {
  return /\b(left|right|bilateral)\b/i.test(text);
}

export function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
