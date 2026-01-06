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
    id: "USG_ABDOMEN",
    title: "USG Abdomen",
    allowedTopics: [
      "Liver",
      "Gallbladder",
      "Biliary tree",
      "Pancreas",
      "Spleen",
      "Kidneys",
      "Urinary bladder",
      "Aorta",
      "Ascites"
    ],
    headings: ["Hepatobiliary", "Pancreas", "Spleen", "Renal", "Other"]
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
