import type { Template } from "@/lib/templates";

export type ReportStatus = "draft" | "pending_review" | "completed" | "discarded";

export type ReportRecord = {
  id: string;
  templateId: string;
  templateTitle: string;
  patientName: string;
  patientGender: string;
  patientDate: string;
  patientId: string;
  accession: string;
  status: ReportStatus;
  observationsHtml: string;
  observationsText: string;
  rawJson: string;
  flags: string[];
  disclaimer: string;
  audioName: string;
  audioSize: number;
  audioType: string;
  audioDurationSec: number;
  audioStoragePath: string;
  audioDownloadUrl: string;
  generationMs: number;
  generatedAtMs: number;
  customTemplateText: string;
  customTemplateGender: "male" | "female";
  customTemplateMappingJson: string;
  customTemplateProfileJson: string;
  createdAtMs: number;
  updatedAtMs: number;
};

export type DashboardStats = {
  completedToday: number;
  avgTurnaroundMin: number;
  pendingSignoff: number;
  aiAccuracyPct: number;
};

export function parseTimestampToMillis(value: unknown) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (
    typeof value === "object" &&
    value !== null &&
    "toMillis" in value &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    return ((value as { toMillis: () => number }).toMillis() || 0);
  }
  return 0;
}

export function fileNameSafe(text: string) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "audio";
}

export function parsePatientFromReport(text: string) {
  const reportText = String(text || "");
  const lines = reportText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
  const head = lines.join(" | ");
  const line1 = lines[0] || "";

  const nameMatch =
    head.match(/name\s*:\s*([^|]+?)(?=\s{2,}gender\s*:|$|\|)/i) ||
    head.match(/patient\s*name\s*[:,-]?\s*([a-z .'-]{2,60})/i);
  const genderMatch =
    head.match(/gender\s*:\s*([^|]+?)(?=\s{2,}date\s*:|$|\|)/i) ||
    head.match(/\b(male|female)\b/i);
  const dateMatch =
    head.match(/date\s*:\s*([^|]+)$/i) ||
    head.match(/\b(\d{1,2}\s+[a-zA-Z]+\s+\d{4})\b/);

  const patientName = (nameMatch?.[1] || "").trim() || "Unknown Patient";
  const patientGender = (genderMatch?.[1] || "").trim() || "Unknown";
  const patientDate = (dateMatch?.[1] || "").trim() || "";

  return { patientName, patientGender, patientDate };
}

function dayStartMs(now: Date) {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

export function deriveDashboardStats(reports: ReportRecord[]): DashboardStats {
  const todayStart = dayStartMs(new Date());
  const completedToday = reports.filter(
    (item) => item.status === "completed" && item.updatedAtMs >= todayStart
  ).length;
  const pendingSignoff = reports.filter(
    (item) => item.status === "pending_review"
  ).length;

  const generationSamples = reports
    .map((item) => item.generationMs || 0)
    .filter((value) => value > 0);
  const avgTurnaroundMin = generationSamples.length
    ? Math.max(
        1,
        Math.round(
          generationSamples.reduce((sum, ms) => sum + ms, 0) /
            generationSamples.length /
            60000
        )
      )
    : 0;

  const totalFlags = reports.reduce((sum, item) => sum + item.flags.length, 0);
  const flagsPerStudy = reports.length ? totalFlags / reports.length : 0;
  const aiAccuracyPct = reports.length
    ? Math.max(80, Math.round((1 - Math.min(flagsPerStudy / 6, 0.2)) * 1000) / 10)
    : 98.2;

  return {
    completedToday,
    avgTurnaroundMin,
    pendingSignoff,
    aiAccuracyPct
  };
}

export function labelForStatus(status: ReportStatus) {
  if (status === "discarded") return "Discarded";
  if (status === "completed") return "Completed";
  if (status === "pending_review") return "Pending Review";
  return "Draft";
}

export function statusBadgeClasses(status: ReportStatus) {
  if (status === "discarded") {
    return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  }
  if (status === "completed") {
    return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300";
  }
  if (status === "pending_review") {
    return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300";
  }
  return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
}

export function modalityForTemplateId(
  templateId: string,
  allTemplates: Template[]
) {
  const found = allTemplates.find((item) => item.id === templateId);
  return found?.title || templateId || "Unknown Template";
}
