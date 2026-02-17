export type Template = {
  id: string;
  title: string;
  allowedTopics: string[];
  headings?: string[];
};

export const templates: Template[] = [
  {
    id: "CT_HEAD",
    title: "CT Head",
    allowedTopics: [
      "Brain parenchyma",
      "Hemorrhage",
      "Midline shift",
      "Ventricles and cisterns",
      "Extra-axial spaces",
      "Skull bones",
      "Paranasal sinuses"
    ],
    headings: ["Parenchyma", "Ventricles", "Extra-axial", "Bones/Sinuses"]
  },
  {
    id: "CT_CHEST",
    title: "CT Chest",
    allowedTopics: [
      "Lungs and airways",
      "Pleura",
      "Mediastinum",
      "Heart and great vessels",
      "Lymph nodes",
      "Chest wall",
      "Upper abdomen"
    ],
    headings: ["Lungs", "Pleura", "Mediastinum", "Cardiac/Vessels", "Other"]
  },
  {
    id: "MRI_BRAIN",
    title: "MRI Brain",
    allowedTopics: [
      "Brain parenchyma",
      "Diffusion restriction",
      "Hemorrhage",
      "Midline shift",
      "Ventricles",
      "Posterior fossa",
      "Pituitary/sella",
      "Orbits",
      "Paranasal sinuses"
    ],
    headings: ["Parenchyma", "Diffusion", "Ventricles", "Posterior Fossa", "Other"]
  },
  {
    id: "MRI_LUMBAR_SPINE",
    title: "MRI Lumbar Spine",
    allowedTopics: [
      "Vertebral alignment",
      "Marrow signal",
      "Disc levels (L1-L2 to L5-S1)",
      "Canal stenosis",
      "Foraminal stenosis",
      "Conus/cauda",
      "Paraspinal soft tissues"
    ],
    headings: ["Alignment", "Discs", "Canal/Foramina", "Neural Elements", "Soft Tissues"]
  },
  {
    id: "XRAY_CHEST",
    title: "X-ray Chest",
    allowedTopics: [
      "Lung fields",
      "Pleura",
      "Cardiac silhouette",
      "Mediastinum",
      "Diaphragm",
      "Bones",
      "Lines/tubes"
    ],
    headings: ["Lungs", "Pleura", "Cardiomediastinal", "Bones/Devices"]
  },
  {
    id: "XRAY_KNEE",
    title: "X-ray Knee",
    allowedTopics: [
      "Bony alignment",
      "Joint spaces",
      "Fracture/dislocation",
      "Osteophytes",
      "Soft tissue swelling",
      "Effusion"
    ],
    headings: ["Alignment", "Bones", "Joint Spaces", "Soft Tissues"]
  },
  {
    id: "USG_ABDOMEN_MALE",
    title: "USG Whole Abdomen (Male)",
    allowedTopics: [
      "Liver",
      "Gall bladder",
      "CBD",
      "Pancreas",
      "Spleen",
      "Kidneys",
      "Urinary bladder",
      "Prevoid volume",
      "Postvoid volume",
      "Prostate",
      "Peritoneal cavity",
      "Lymph nodes",
      "Impression",
      "Correlation"
    ],
    headings: [
      "Liver",
      "Gall bladder",
      "Pancreas",
      "Spleen",
      "Kidneys",
      "Urinary Bladder",
      "Prostate",
      "Peritoneal cavity",
      "Lymph nodes",
      "Impression"
    ]
  },
  {
    id: "USG_ABDOMEN_FEMALE",
    title: "USG Whole Abdomen (Female)",
    allowedTopics: [
      "Liver",
      "Gall bladder",
      "CBD",
      "Pancreas",
      "Spleen",
      "Kidneys",
      "Urinary bladder",
      "Prevoid volume",
      "Postvoid volume",
      "Uterus",
      "Adenexa",
      "Peritoneal cavity",
      "Lymph nodes",
      "Impression"
    ],
    headings: [
      "Liver",
      "Gall bladder",
      "Pancreas",
      "Spleen",
      "Kidneys",
      "Urinary Bladder",
      "Uterus",
      "Adenexa",
      "Peritoneal cavity",
      "Lymph nodes",
      "Impression"
    ]
  },
  {
    id: "USG_KUB_MALE",
    title: "USG KUB (Male)",
    allowedTopics: [
      "Right kidney",
      "Left kidney",
      "Urinary bladder",
      "Prevoid volume",
      "Postvoid volume",
      "Prostate",
      "Impression",
      "Correlation"
    ],
    headings: [
      "Kidneys",
      "Urinary Bladder",
      "Prostate",
      "Impression"
    ]
  },
  {
    id: "USG_KUB_FEMALE",
    title: "USG KUB (Female)",
    allowedTopics: [
      "Right kidney",
      "Left kidney",
      "Urinary bladder",
      "Prevoid volume",
      "Postvoid volume",
      "Uterus",
      "Impression",
      "Correlation"
    ],
    headings: [
      "Kidneys",
      "Urinary Bladder",
      "Uterus",
      "Impression"
    ]
  },
  {
    id: "USG_ABDOMEN_CUSTOM",
    title: "USG Whole Abdomen (Custom)",
    allowedTopics: [
      "Custom heading mapping",
      "Deterministic section fill",
      "Liver / Gall bladder / CBD / Pancreas / Spleen",
      "Kidneys / Bladder / Prostate / Uterus / Adnexa",
      "Peritoneum / Lymph nodes / Impression / Note"
    ],
    headings: [
      "Custom Template Text",
      "Heading Mapping",
      "Deterministic Section Fill"
    ]
  },
  {
    id: "DOPPLER_LOWER_LIMB",
    title: "Doppler Lower Limb",
    allowedTopics: [
      "Common femoral vein",
      "Femoral vein",
      "Popliteal vein",
      "Calf veins",
      "Compressibility",
      "Flow pattern",
      "Thrombus"
    ],
    headings: ["Proximal Veins", "Distal Veins", "Flow/Thrombus"]
  }
];

export function getTemplateById(id: string): Template | undefined {
  return templates.find((template) => template.id === id);
}
