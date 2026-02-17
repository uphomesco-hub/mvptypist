"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as mammoth from "mammoth";
import type { User } from "firebase/auth";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "firebase/auth";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import Editor from "@/components/Editor";
import { templates } from "@/lib/templates";
import { exportDocx } from "@/lib/exportDocx";
import { exportPdf } from "@/lib/exportPdf";
import { getFirebaseClient, isFirebaseClientConfigured } from "@/lib/firebaseClient";
import {
  computeObservationEditStats,
  deriveDashboardStats,
  extractObservationCoreText,
  fileNameSafe,
  labelForStatus,
  modalityForTemplateId,
  parsePatientFromReport,
  parseTimestampToMillis,
  statusBadgeClasses,
  type ReportRecord,
  type ReportStatus
} from "@/lib/firebasePersistence";
import {
  type UsgGender,
  USG_ABDOMEN_FEMALE_TEMPLATE,
  USG_ABDOMEN_MALE_TEMPLATE
} from "@/lib/usgTemplate";
import {
  CUSTOM_TEMPLATE_ID,
  CUSTOM_TEMPLATE_MAPPING_STORAGE_KEY,
  CUSTOM_TEMPLATE_SECTION_KEYS,
  autoMapHeadingCandidates,
  detectHeadingCandidates,
  hashTemplateText,
  sanitizeCustomTemplateMapping,
  type CustomTemplateMapping,
  type CustomTemplateSectionKey
} from "@/lib/usgCustomTemplate";
import {
  sanitizeTemplateProfile,
  type TemplateProfile
} from "@/lib/usgTemplateProfile";

const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const MAX_INLINE_AUDIO_BYTES = 100 * 1024 * 1024;
const TARGET_AUDIO_BITRATE = 96_000;
const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg"
];
const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || "").trim();
const IS_GITHUB_PAGES = process.env.NEXT_PUBLIC_GITHUB_PAGES === "true";
const API_ENDPOINT = API_BASE_URL
  ? `${API_BASE_URL.replace(/\/$/, "")}/api/generate`
  : "/api/generate";
const TEMPLATE_PROFILE_ENDPOINT = API_BASE_URL
  ? `${API_BASE_URL.replace(/\/$/, "")}/api/template-profile`
  : "/api/template-profile";
const ISSUE_SUMMARY_ENDPOINT = API_BASE_URL
  ? `${API_BASE_URL.replace(/\/$/, "")}/api/admin-issue-summary`
  : "/api/admin-issue-summary";
const ADMIN_EMAIL = "yashovrat56@gmail.com";
const DEFAULT_PROFILE_IMAGE_URL =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuAQY8yGZ6jxkfslrkZwrL2UAZXeSbxx_gxAuQb8CBi7XV92sG5i644A5-6WJQTcujmf1y90Odf01PKlPXRuLz_0wHfDQ2SR160F7g36KKQhtm1VU76QxxWNHG3smwGxmWUdJNatDBE2QVzL5boNFB0IsBgpSteGrlivpyoiFf-QbC1l3ZAwBkyn4ODppXSjxiOtYt4TToa4_DTNJaJsjjIO2w6YsfUtSGPoxWIFg5TNW1PkdUDGxF4gt5FQ1PUYCZTLNe61RTDIQg";
const REPORT_HEADINGS = [
  "Liver:",
  "Gall bladder:",
  "Pancreas:",
  "Spleen:",
  "Kidneys:",
  "Urinary Bladder:",
  "Prostate:",
  "Uterus:",
  "Adenexa:",
  "Adnexa:"
];
const IMPRESSION_PATTERN = /^(impression:|significant findings\s*:)/i;
const SKIP_LINE_PATTERNS = [/^name:/i, /^sonography\b/i, /^-{6,}/, /^non obstructing/i];

const TEMPLATE_VISUALS = [
  { icon: "air", iconWrap: "bg-blue-50 text-primary dark:bg-blue-900/20", accent: "text-primary" },
  {
    icon: "psychology",
    iconWrap: "bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400",
    accent: "text-purple-600 dark:text-purple-400"
  },
  {
    icon: "reorder",
    iconWrap: "bg-orange-50 text-orange-600 dark:bg-orange-900/20 dark:text-orange-400",
    accent: "text-orange-600 dark:text-orange-400"
  },
  {
    icon: "monitor_heart",
    iconWrap: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400",
    accent: "text-emerald-600 dark:text-emerald-400"
  }
] as const;

const estimateBase64Size = (bytes: number) => Math.ceil(bytes / 3) * 4;

const pickSupportedMimeType = () => {
  if (typeof MediaRecorder === "undefined") return null;
  for (const mimeType of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mimeType)) return mimeType;
  }
  return null;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getDefaultTemplateText(templateId: string) {
  if (templateId === "USG_ABDOMEN_FEMALE") return USG_ABDOMEN_FEMALE_TEMPLATE;
  if (templateId === "USG_ABDOMEN_MALE") return USG_ABDOMEN_MALE_TEMPLATE;
  return "";
}

function normalizeLine(text: string) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function buildDefaultLineSet(templateId: string) {
  const template = getDefaultTemplateText(templateId);
  if (!template) return new Set<string>();
  return new Set(template.split(/\r?\n/).map(normalizeLine).filter(Boolean));
}

function startsWithHeading(trimmedLine: string) {
  return REPORT_HEADINGS.find((label) =>
    trimmedLine.toLowerCase().startsWith(label.toLowerCase())
  );
}

function normalizeHeadingKey(heading: string) {
  return heading.replace(/[:\s]+/g, "").toLowerCase();
}

function splitIntoSentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+|;\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildDefaultSectionSentenceMap(templateId: string) {
  const template = getDefaultTemplateText(templateId);
  const map: Record<string, Set<string>> = {};
  if (!template) return map;

  for (const line of template.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const heading = startsWithHeading(trimmed);
    if (!heading) continue;
    const headingIndex = line.toLowerCase().indexOf(heading.toLowerCase());
    const body =
      headingIndex >= 0
        ? line.slice(headingIndex + heading.length).trim()
        : trimmed.slice(heading.length).trim();
    if (!body) continue;
    const key = normalizeHeadingKey(heading);
    if (!map[key]) map[key] = new Set<string>();
    for (const sentence of splitIntoSentences(body)) {
      map[key].add(normalizeLine(sentence));
    }
  }

  return map;
}

function formatHeadingLine(params: {
  line: string;
  heading: string | null;
  highlight: boolean;
}) {
  const { line, heading, highlight } = params;
  if (!heading) {
    return highlight
      ? `<strong><u>${escapeHtml(line)}</u></strong>`
      : escapeHtml(line);
  }
  const lineLower = line.toLowerCase();
  const headingLower = heading.toLowerCase();
  const headingIndex = lineLower.indexOf(headingLower);
  if (headingIndex === -1) {
    return highlight
      ? `<strong><u>${escapeHtml(line)}</u></strong>`
      : escapeHtml(line);
  }
  const beforeHeading = line.slice(0, headingIndex);
  const headingText = line.slice(headingIndex, headingIndex + heading.length);
  const afterHeading = line.slice(headingIndex + heading.length);
  if (!highlight) {
    return `${escapeHtml(beforeHeading)}<strong>${escapeHtml(headingText)}</strong>${escapeHtml(afterHeading)}`;
  }
  const highlightedBody = afterHeading.trim()
    ? `<strong><u>${escapeHtml(afterHeading)}</u></strong>`
    : "";
  return `${escapeHtml(beforeHeading)}<strong>${escapeHtml(headingText)}</strong>${highlightedBody}`;
}

function formatHeadingLineWithSentenceDiff(params: {
  line: string;
  heading: string;
  defaultSectionSentences: Record<string, Set<string>>;
}) {
  const { line, heading, defaultSectionSentences } = params;
  const headingIndex = line.toLowerCase().indexOf(heading.toLowerCase());
  if (headingIndex === -1) {
    return escapeHtml(line);
  }

  const beforeHeading = line.slice(0, headingIndex);
  const headingText = line.slice(headingIndex, headingIndex + heading.length);
  const bodyText = line.slice(headingIndex + heading.length).trim();
  if (!bodyText) {
    return `${escapeHtml(beforeHeading)}<strong>${escapeHtml(headingText)}</strong>`;
  }

  const sentences = splitIntoSentences(bodyText);
  if (!sentences.length) {
    return `${escapeHtml(beforeHeading)}<strong>${escapeHtml(headingText)}</strong> ${escapeHtml(bodyText)}`;
  }

  const normalSet = defaultSectionSentences[normalizeHeadingKey(heading)];
  if (!normalSet?.size) {
    return `${escapeHtml(beforeHeading)}<strong>${escapeHtml(headingText)}</strong> ${escapeHtml(bodyText)}`;
  }

  const tagged = sentences.map((sentence) => {
    const isNormal =
      normalSet.has(normalizeLine(sentence)) || isSkippableLine(sentence);
    return { sentence, isNormal };
  });
  const hasAbnormal = tagged.some((item) => !item.isNormal);
  const ordered = hasAbnormal
    ? [
        ...tagged.filter((item) => !item.isNormal),
        ...tagged.filter((item) => item.isNormal)
      ]
    : tagged;

  const bodyHtml = ordered
    .map((item) =>
      item.isNormal
        ? escapeHtml(item.sentence)
        : `<strong><u>${escapeHtml(item.sentence)}</u></strong>`
    )
    .join(" ");

  return `${escapeHtml(beforeHeading)}<strong>${escapeHtml(headingText)}</strong> ${bodyHtml}`;
}

function isSkippableLine(trimmedLine: string) {
  return SKIP_LINE_PATTERNS.some((pattern) => pattern.test(trimmedLine));
}

function formatReportHtml(text: string, templateId: string) {
  const defaultLines = buildDefaultLineSet(templateId);
  const defaultSectionSentences = buildDefaultSectionSentenceMap(templateId);
  const hasDefaults = defaultLines.size > 0;
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!line) return "";
      const trimmed = line.trim();
      if (IMPRESSION_PATTERN.test(trimmed)) {
        return `<strong><u>${escapeHtml(line)}</u></strong>`;
      }
      const heading = startsWithHeading(trimmed);
      if (heading) {
        if (!hasDefaults) {
          return formatHeadingLine({
            line,
            heading,
            highlight: false
          });
        }
        return formatHeadingLineWithSentenceDiff({
          line,
          heading,
          defaultSectionSentences
        });
      }
      const normalized = normalizeLine(line);
      let isNormal = defaultLines.has(normalized) || isSkippableLine(trimmed);
      if (!isNormal) {
        for (const label of REPORT_HEADINGS) {
          const normalizedWithHeading = normalizeLine(`${label} ${line}`);
          if (defaultLines.has(normalizedWithHeading)) {
            isNormal = true;
            break;
          }
        }
      }
      return formatHeadingLine({
        line,
        heading: heading || null,
        highlight: hasDefaults && !isNormal
      });
    })
    .join("<br>");
}

function htmlToPlainText(html: string) {
  if (!html) return "";
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/div>\s*<div>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n")
    .replace(/<\/li>\s*<li>/gi, "\n")
    .replace(/<\/(div|p|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return withBreaks
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 MB";
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(totalSeconds: number | null) {
  if (
    typeof totalSeconds !== "number" ||
    !Number.isFinite(totalSeconds) ||
    totalSeconds < 0
  ) {
    return "--:--";
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatGeneratedTime(valueMs: number) {
  if (!valueMs || !Number.isFinite(valueMs)) return "N/A";
  return new Date(valueMs).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function getAudioDuration(url: string) {
  return new Promise<number>((resolve, reject) => {
    const audio = new Audio();
    audio.src = url;
    audio.preload = "metadata";
    audio.onloadedmetadata = () => resolve(audio.duration || 0);
    audio.onerror = () => reject(new Error("Unable to load audio metadata"));
  });
}

type StoredCustomTemplateConfig = {
  mapping: CustomTemplateMapping;
  gender: UsgGender;
  profile?: TemplateProfile | null;
  updatedAt: string;
};

function readStoredCustomTemplateConfigs() {
  if (typeof window === "undefined") return {} as Record<string, StoredCustomTemplateConfig>;
  const raw = window.localStorage.getItem(CUSTOM_TEMPLATE_MAPPING_STORAGE_KEY);
  if (!raw) return {} as Record<string, StoredCustomTemplateConfig>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {} as Record<string, StoredCustomTemplateConfig>;
    }
    return parsed as Record<string, StoredCustomTemplateConfig>;
  } catch {
    return {} as Record<string, StoredCustomTemplateConfig>;
  }
}

function loadCustomTemplateConfig(templateText: string) {
  const hash = hashTemplateText(templateText.trim());
  const records = readStoredCustomTemplateConfigs();
  const record = records[hash];
  if (!record || typeof record !== "object") return null;
  const mapping = sanitizeCustomTemplateMapping(record.mapping || {});
  const gender: UsgGender = record.gender === "female" ? "female" : "male";
  const profile = sanitizeTemplateProfile(record.profile || null, {
    templateHash: hash
  });
  return { mapping, gender, profile };
}

function saveCustomTemplateConfig(params: {
  templateText: string;
  mapping: CustomTemplateMapping;
  gender: UsgGender;
  profile?: TemplateProfile | null;
}) {
  if (typeof window === "undefined") return;
  const { templateText, mapping, gender, profile } = params;
  const trimmedTemplate = templateText.trim();
  if (!trimmedTemplate) return;
  const hash = hashTemplateText(trimmedTemplate);
  const records = readStoredCustomTemplateConfigs();
  records[hash] = {
    mapping: sanitizeCustomTemplateMapping(mapping),
    gender,
    profile: sanitizeTemplateProfile(profile || null, {
      templateHash: hash
    }),
    updatedAt: new Date().toISOString()
  };
  window.localStorage.setItem(
    CUSTOM_TEMPLATE_MAPPING_STORAGE_KEY,
    JSON.stringify(records)
  );
}

const TEMPLATE_PROFILE_LEARNING_STORAGE_KEY =
  "mvptypist.templateProfileLearning.v1";

function recordUnmappedFindingsLearning(params: {
  templateText: string;
  findings: string[];
}) {
  if (typeof window === "undefined") return;
  const { templateText, findings } = params;
  const templateHash = hashTemplateText(templateText.trim());
  if (!templateHash || !findings.length) return;

  let store: Record<string, Record<string, number>> = {};
  try {
    const raw = window.localStorage.getItem(
      TEMPLATE_PROFILE_LEARNING_STORAGE_KEY
    );
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        store = parsed as Record<string, Record<string, number>>;
      }
    }
  } catch {
    store = {};
  }

  const templateStore = store[templateHash] || {};
  for (const finding of findings) {
    const normalized = String(finding || "").trim().toLowerCase();
    if (!normalized) continue;
    templateStore[normalized] = (templateStore[normalized] || 0) + 1;
  }
  store[templateHash] = templateStore;
  window.localStorage.setItem(
    TEMPLATE_PROFILE_LEARNING_STORAGE_KEY,
    JSON.stringify(store)
  );
}

function readUnmappedFindingsLearning(templateText: string) {
  if (typeof window === "undefined") return [] as Array<{ finding: string; count: number }>;
  const templateHash = hashTemplateText(templateText.trim());
  if (!templateHash) return [] as Array<{ finding: string; count: number }>;
  try {
    const raw = window.localStorage.getItem(TEMPLATE_PROFILE_LEARNING_STORAGE_KEY);
    if (!raw) return [] as Array<{ finding: string; count: number }>;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return [] as Array<{ finding: string; count: number }>;
    }
    const templateStore = (parsed as Record<string, unknown>)[templateHash];
    if (!templateStore || typeof templateStore !== "object") {
      return [] as Array<{ finding: string; count: number }>;
    }
    const pairs = Object.entries(templateStore as Record<string, unknown>)
      .map(([finding, count]) => ({
        finding,
        count: typeof count === "number" ? count : 0
      }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
    return pairs;
  } catch {
    return [] as Array<{ finding: string; count: number }>;
  }
}

function isCustomUsgTemplate(templateId: string) {
  return templateId === CUSTOM_TEMPLATE_ID;
}

function labelForSectionKey(sectionKey: CustomTemplateSectionKey) {
  return sectionKey.replace(/_/g, " ");
}

type DoctorProfile = {
  displayName: string;
  role: string;
  email: string;
  avatarUrl: string;
};

type SavedCustomTemplate = {
  id: string;
  name: string;
  templateText: string;
  gender: UsgGender;
  mapping: CustomTemplateMapping;
  profile: TemplateProfile | null;
  templateHash: string;
  useCount: number;
  lastUsedAtMs: number;
  updatedAtMs: number;
};

type AdminIssue = {
  issueId: string;
  reportId: string;
  ownerUid: string;
  ownerEmail: string;
  ownerName: string;
  patientName: string;
  templateTitle: string;
  status: ReportStatus;
  updatedAtMs: number;
  aiText: string;
  finalText: string;
  changeCount: number;
};

type IssueSummaryPayload = {
  summary: string;
  key_changes: string[];
  likely_model_gaps: string[];
  quality_score: number;
  source: "ai" | "fallback";
};

function ownerUidFromDocPath(path: string) {
  const parts = String(path || "").split("/");
  if (parts.length >= 4 && parts[0] === "users" && parts[2] === "reports") {
    return parts[1];
  }
  return "";
}

function fallbackOwnerNameFromEmail(email: string) {
  const localPart = String(email || "").trim().split("@")[0] || "";
  if (!localPart) return "";
  return localPart.replace(/[._-]+/g, " ").trim();
}

function resolveOwnerName(rawName: unknown, ownerEmail: string) {
  const explicit = String(rawName || "").trim();
  if (explicit) return explicit;
  const fallback = fallbackOwnerNameFromEmail(ownerEmail);
  if (fallback) return fallback;
  return "Unknown owner";
}

function randomAccessionId() {
  return `ACC-${Math.floor(10000 + Math.random() * 90000)}-${Math.random()
    .toString(36)
    .slice(2, 3)
    .toUpperCase()}`;
}

function firebaseErrorMessage(error: unknown) {
  const message = String((error as { message?: string })?.message || "Unknown error");
  if (message.includes("auth/invalid-credential")) {
    return "Invalid credentials. Check email and password.";
  }
  if (message.includes("auth/email-already-in-use")) {
    return "Email already registered. Sign in instead.";
  }
  if (message.includes("auth/weak-password")) {
    return "Password is too weak (minimum 6 characters).";
  }
  return message;
}

function storageAudioLoadErrorMessage(error: unknown) {
  const code = String((error as { code?: string })?.code || "");
  const message = String((error as { message?: string })?.message || "");
  if (code.includes("storage/object-not-found")) {
    return "Saved recording file was not found in Firebase Storage.";
  }
  if (
    code.includes("storage/unauthorized") ||
    code.includes("storage/unauthenticated")
  ) {
    return "Storage read is blocked by Firebase rules. Allow authenticated read for users/{uid}/recordings/**.";
  }
  if (code.includes("storage/retry-limit-exceeded")) {
    return "Storage request timed out. Please retry.";
  }
  if (code.includes("storage/invalid-url") || message.includes("Audio fetch failed")) {
    return "Saved recording URL is stale/invalid. Please re-record once to refresh it.";
  }
  return message || "Could not load previous recording from Firebase.";
}

export default function Home() {
  const firebaseClient = useMemo(() => getFirebaseClient(), []);
  const [templateId, setTemplateId] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [processingTopicProgress, setProcessingTopicProgress] = useState(0);
  const [observations, setObservations] = useState("");
  const [flags, setFlags] = useState<string[]>([]);
  const [disclaimer, setDisclaimer] = useState("");
  const [rawJson, setRawJson] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeView, setActiveView] = useState<
    "dashboard" | "recording" | "report" | "admin" | "profile"
  >("dashboard");
  const [customTemplateText, setCustomTemplateText] = useState("");
  const [customTemplateGender, setCustomTemplateGender] = useState<UsgGender>("male");
  const [customTemplateMapping, setCustomTemplateMapping] = useState<CustomTemplateMapping>({});
  const [customTemplateSource, setCustomTemplateSource] = useState("");
  const [customTemplateProfile, setCustomTemplateProfile] = useState<TemplateProfile | null>(null);
  const [customTemplateProfileDraft, setCustomTemplateProfileDraft] = useState("");
  const [customTemplateProfileNotes, setCustomTemplateProfileNotes] = useState<string[]>([]);
  const [isAnalyzingTemplateProfile, setIsAnalyzingTemplateProfile] = useState(false);
  const [authReady, setAuthReady] = useState(!isFirebaseClientConfigured);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [isReportsLoading, setIsReportsLoading] = useState(false);
  const [activeReportId, setActiveReportId] = useState("");
  const [isSavingReport, setIsSavingReport] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [worklistStatusFilter, setWorklistStatusFilter] = useState<
    "all" | ReportStatus
  >("all");
  const [isQuickTemplatesExpanded, setIsQuickTemplatesExpanded] = useState(false);
  const [isManageTemplatesOpen, setIsManageTemplatesOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [allowRecordingFromReport, setAllowRecordingFromReport] = useState(false);
  const [isLoadingSavedAudio, setIsLoadingSavedAudio] = useState(false);
  const [detectedMicLabel, setDetectedMicLabel] = useState("Mic not initialized");
  const [inputLatencyMs, setInputLatencyMs] = useState<number | null>(null);
  const [savedCustomTemplates, setSavedCustomTemplates] = useState<
    SavedCustomTemplate[]
  >([]);
  const [isSavedCustomTemplatesLoading, setIsSavedCustomTemplatesLoading] =
    useState(false);
  const [activeCustomTemplateId, setActiveCustomTemplateId] = useState("");
  const [customTemplateLabel, setCustomTemplateLabel] = useState("");
  const [adminIssues, setAdminIssues] = useState<AdminIssue[]>([]);
  const [isAdminIssuesLoading, setIsAdminIssuesLoading] = useState(false);
  const [selectedAdminIssueId, setSelectedAdminIssueId] = useState("");
  const [isIssueSummaryLoading, setIsIssueSummaryLoading] = useState(false);
  const [issueSummaries, setIssueSummaries] = useState<
    Record<string, IssueSummaryPayload>
  >({});
  const [isMobileProfileMenuOpen, setIsMobileProfileMenuOpen] = useState(false);
  const [profileDraftName, setProfileDraftName] = useState("");
  const [profileAvatarFile, setProfileAvatarFile] = useState<File | null>(null);
  const [profileAvatarPreviewUrl, setProfileAvatarPreviewUrl] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isProfileImageMenuOpen, setIsProfileImageMenuOpen] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordedBytesRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const recordingStartMsRef = useRef<number | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const fullscreenEditorRef = useRef<HTMLDivElement | null>(null);
  const generateAfterStopRef = useRef(false);
  const loadedSavedAudioReportIdRef = useRef("");
  const reportAudioCacheRef = useRef<Record<string, File>>({});
  const loadedCustomConfigHashRef = useRef("");
  const customTemplateSaveTimerRef = useRef<number | null>(null);
  const worklistSectionRef = useRef<HTMLElement | null>(null);
  const wasSearchModeRef = useRef(false);
  const mobileProfileMenuRef = useRef<HTMLDivElement | null>(null);
  const profileAvatarObjectUrlRef = useRef<string | null>(null);
  const profileImageMenuRef = useRef<HTMLDivElement | null>(null);
  const profileImageUploadInputRef = useRef<HTMLInputElement | null>(null);
  const profileImageCameraInputRef = useRef<HTMLInputElement | null>(null);

  const isBackendConfigured = !IS_GITHUB_PAGES || Boolean(API_BASE_URL);
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === templateId),
    [templateId]
  );
  const isCustomTemplateMode = isCustomUsgTemplate(templateId);
  const customHeadingCandidates = useMemo(
    () =>
      customTemplateText.trim()
        ? detectHeadingCandidates(customTemplateText)
        : [],
    [customTemplateText]
  );
  const customHeadingOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: string[] = [];
    for (const candidate of customHeadingCandidates) {
      if (seen.has(candidate.line)) continue;
      seen.add(candidate.line);
      options.push(candidate.line);
    }
    return options;
  }, [customHeadingCandidates]);
  const customLearningSuggestions = useMemo(
    () =>
      customTemplateText.trim()
        ? readUnmappedFindingsLearning(customTemplateText)
        : [],
    [customTemplateText, rawJson]
  );
  const observationsPlain = useMemo(() => htmlToPlainText(observations), [observations]);
  const hasObservations = Boolean(observationsPlain.trim());
  const dashboardStats = useMemo(() => deriveDashboardStats(reports), [reports]);
  const searchedReports = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter((item) =>
      [
        item.patientName,
        item.patientId,
        item.accession,
        item.templateTitle,
        item.status
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [reports, searchQuery]);
  const filteredReports = useMemo(() => {
    if (worklistStatusFilter === "all") return searchedReports;
    return searchedReports.filter((item) => item.status === worklistStatusFilter);
  }, [searchedReports, worklistStatusFilter]);
  const worklistCounts = useMemo(() => {
    const draft = reports.filter((item) => item.status === "draft").length;
    const pending = reports.filter((item) => item.status === "pending_review").length;
    const completed = reports.filter((item) => item.status === "completed").length;
    return {
      all: reports.length,
      draft,
      pending_review: pending,
      completed
    };
  }, [reports]);
  const nextPatientIdSeed = useMemo(() => {
    let maxSeen = 999;
    for (const report of reports) {
      const numeric = Number.parseInt(String(report.patientId || "").trim(), 10);
      if (Number.isFinite(numeric) && numeric > maxSeen) {
        maxSeen = numeric;
      }
    }
    return Math.max(1000, maxSeen + 1);
  }, [reports]);
  const recentTemplateIds = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const item of reports) {
      const key = item.templateId;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      ordered.push(key);
    }
    return ordered;
  }, [reports]);
  const quickTemplates = useMemo(() => {
    const rank = new Map<string, number>();
    for (let i = 0; i < recentTemplateIds.length; i += 1) {
      rank.set(recentTemplateIds[i], i);
    }
    return [...templates].sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.id) ? rank.get(b.id)! : Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return templates.findIndex((item) => item.id === a.id) -
        templates.findIndex((item) => item.id === b.id);
    });
  }, [recentTemplateIds]);
  const activeReport = useMemo(
    () => reports.find((item) => item.id === activeReportId) || null,
    [reports, activeReportId]
  );
  const activeReportStatus = activeReport?.status || null;
  const doctorName =
    doctorProfile?.displayName ||
    currentUser?.displayName ||
    (currentUser?.email ? currentUser.email.split("@")[0] : "Doctor");
  const doctorAvatarUrl =
    String(
      doctorProfile?.avatarUrl ||
        currentUser?.photoURL ||
        DEFAULT_PROFILE_IMAGE_URL
    ).trim() || DEFAULT_PROFILE_IMAGE_URL;
  const profileAvatarDisplayUrl = profileAvatarPreviewUrl || doctorAvatarUrl;
  const isSearchMode = Boolean(searchQuery.trim());
  const isAdmin =
    String(currentUser?.email || "").trim().toLowerCase() === ADMIN_EMAIL;
  const selectedAdminIssue =
    adminIssues.find((item) => item.issueId === selectedAdminIssueId) || null;
  const selectedAdminIssueSummary = selectedAdminIssue
    ? issueSummaries[selectedAdminIssue.issueId] || null
    : null;
  const adminIssueCount = adminIssues.length;
  const visibleQuickTemplates = isQuickTemplatesExpanded
    ? quickTemplates
    : quickTemplates.slice(0, 4);
  const sidebarWidthClass = isSidebarCollapsed ? "w-20" : "w-64";
  const sidebarOffsetClass = isSidebarCollapsed ? "lg:ml-20" : "lg:ml-64";
  const recordingSidebarTopics = useMemo(() => {
    const fallback = [
      "Liver",
      "Gall bladder",
      "CBD",
      "Pancreas",
      "Spleen",
      "Kidneys"
    ];
    const selectedTopics = selectedTemplate?.allowedTopics || fallback;
    const topics = selectedTopics.slice(0, 6);
    return topics.length ? topics : fallback;
  }, [selectedTemplate]);

  useEffect(() => {
    return () => {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = isFullscreen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isFullscreen]);

  useEffect(() => {
    if (isSearchMode && !wasSearchModeRef.current) {
      const timer = window.setTimeout(() => {
        const node = worklistSectionRef.current;
        if (!node) return;
        node.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
      wasSearchModeRef.current = true;
      return () => window.clearTimeout(timer);
    }
    if (!isSearchMode) {
      wasSearchModeRef.current = false;
    }
  }, [isSearchMode]);

  useEffect(() => {
    if (activeView !== "recording" || !isGenerating) {
      setProcessingTopicProgress(0);
      return;
    }
    setProcessingTopicProgress(0);
    let completed = 0;
    const total = recordingSidebarTopics.length;
    const timer = window.setInterval(() => {
      completed = Math.min(total, completed + 1);
      setProcessingTopicProgress(completed);
      if (completed >= total) {
        window.clearInterval(timer);
      }
    }, 320);
    return () => window.clearInterval(timer);
  }, [activeView, isGenerating, recordingSidebarTopics.length]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => {
      setError(null);
    }, 10000);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    const fallbackName =
      doctorProfile?.displayName ||
      currentUser?.displayName ||
      (currentUser?.email ? currentUser.email.split("@")[0] : "");
    setProfileDraftName(fallbackName);
  }, [doctorProfile?.displayName, currentUser?.displayName, currentUser?.email]);

  useEffect(() => {
    return () => {
      if (profileAvatarObjectUrlRef.current) {
        URL.revokeObjectURL(profileAvatarObjectUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isMobileProfileMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!mobileProfileMenuRef.current?.contains(target)) {
        setIsMobileProfileMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isMobileProfileMenuOpen]);

  useEffect(() => {
    if (!isProfileImageMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!profileImageMenuRef.current?.contains(target)) {
        setIsProfileImageMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isProfileImageMenuOpen]);

  useEffect(() => {
    if (activeView === "admin" && !isAdmin) {
      setActiveView("dashboard");
    }
  }, [activeView, isAdmin]);

  useEffect(() => {
    if (activeView !== "dashboard") {
      setIsMobileProfileMenuOpen(false);
    }
  }, [activeView]);

  useEffect(() => {
    if (activeView !== "profile") {
      setIsProfileImageMenuOpen(false);
    }
  }, [activeView]);

  useEffect(() => {
    if (!firebaseClient) {
      setAuthReady(true);
      return;
    }
    const unsubscribe = onAuthStateChanged(firebaseClient.auth, async (user) => {
      setCurrentUser(user);
      if (!user) {
        setDoctorProfile(null);
        setReports([]);
        setActiveReportId("");
        setAuthReady(true);
        return;
      }
      try {
        const profileRef = doc(
          firebaseClient.db,
          `users/${user.uid}/profile/main`
        );
        const profileSnap = await getDoc(profileRef);
        const existing = profileSnap.data() as Record<string, unknown> | undefined;
        const fallbackName =
          user.displayName || user.email?.split("@")[0] || "Doctor";
        const profile: DoctorProfile = {
          displayName:
            String(existing?.displayName || "").trim() || fallbackName,
          role: String(existing?.role || "Radiologist"),
          email: String(existing?.email || user.email || ""),
          avatarUrl: String(existing?.avatarUrl || user.photoURL || "")
        };
        await setDoc(
          profileRef,
          {
            displayName: profile.displayName,
            role: profile.role,
            email: profile.email,
            avatarUrl: profile.avatarUrl,
            updatedAt: serverTimestamp(),
            createdAt: existing?.createdAt || serverTimestamp()
          },
          { merge: true }
        );
        setDoctorProfile(profile);
      } catch (profileError) {
        setError(firebaseErrorMessage(profileError));
      } finally {
        setAuthReady(true);
      }
    });
    return () => unsubscribe();
  }, [firebaseClient]);

  useEffect(() => {
    if (!firebaseClient || !currentUser) {
      setReports([]);
      setIsReportsLoading(false);
      return;
    }
    setIsReportsLoading(true);
    const reportsQuery = query(
      collection(firebaseClient.db, `users/${currentUser.uid}/reports`),
      orderBy("updatedAt", "desc"),
      limit(100)
    );

    const unsubscribe = onSnapshot(
      reportsQuery,
      (snapshot) => {
        const next: ReportRecord[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          const statusRaw = String(data.status || "draft");
          const status: ReportStatus =
            statusRaw === "completed" ||
            statusRaw === "pending_review" ||
            statusRaw === "discarded"
              ? statusRaw
              : "draft";
          return {
            id: docSnap.id,
            templateId: String(data.templateId || ""),
            templateTitle: String(data.templateTitle || ""),
            patientName: String(data.patientName || "Unknown Patient"),
            patientGender: String(data.patientGender || ""),
            patientDate: String(data.patientDate || ""),
            patientId: String(data.patientId || ""),
            accession: String(data.accession || ""),
            status,
            observationsHtml: String(data.observationsHtml || ""),
            observationsText: String(data.observationsText || ""),
            aiGeneratedObservationsText: String(data.aiGeneratedObservationsText || ""),
            hasObservationEdits: Boolean(data.hasObservationEdits),
            observationEditCount: Number(data.observationEditCount || 0),
            ownerUid: String(data.ownerUid || currentUser.uid),
            ownerEmail: String(data.ownerEmail || currentUser.email || ""),
            ownerName: resolveOwnerName(
              data.ownerName,
              String(data.ownerEmail || currentUser.email || "")
            ),
            rawJson: String(data.rawJson || ""),
            flags: Array.isArray(data.flags)
              ? data.flags.map((item) => String(item || ""))
              : [],
            disclaimer: String(data.disclaimer || ""),
            audioName: String(data.audioName || ""),
            audioSize: Number(data.audioSize || 0),
            audioType: String(data.audioType || ""),
            audioDurationSec: Number(data.audioDurationSec || 0),
            audioStoragePath: String(data.audioStoragePath || ""),
            audioDownloadUrl: String(data.audioDownloadUrl || ""),
            generationMs: Number(data.generationMs || 0),
            generatedAtMs:
              parseTimestampToMillis(data.generatedAt) ||
              parseTimestampToMillis(data.createdAt),
            customTemplateText: String(data.customTemplateText || ""),
            customTemplateGender:
              String(data.customTemplateGender || "male") === "female"
                ? "female"
                : "male",
            customTemplateMappingJson: String(data.customTemplateMappingJson || ""),
            customTemplateProfileJson: String(data.customTemplateProfileJson || ""),
            createdAtMs: parseTimestampToMillis(data.createdAt),
            updatedAtMs: parseTimestampToMillis(data.updatedAt)
          };
        });
        setReports(next.filter((item) => item.status !== "discarded"));
        setIsReportsLoading(false);
      },
      (snapshotError) => {
        setError(firebaseErrorMessage(snapshotError));
        setIsReportsLoading(false);
      }
    );
    return () => unsubscribe();
  }, [firebaseClient, currentUser]);

  useEffect(() => {
    if (!firebaseClient || !currentUser || !isAdmin) {
      setAdminIssues([]);
      setIsAdminIssuesLoading(false);
      return;
    }
    setIsAdminIssuesLoading(true);
    const issuesQuery = query(
      collectionGroup(firebaseClient.db, "reports"),
      orderBy("updatedAt", "desc"),
      limit(300)
    );
    const unsubscribe = onSnapshot(
      issuesQuery,
      (snapshot) => {
        const next: AdminIssue[] = [];
        for (const docSnap of snapshot.docs) {
          const data = docSnap.data() as Record<string, unknown>;
          const reportId = docSnap.id;
          const ownerUid = String(data.ownerUid || ownerUidFromDocPath(docSnap.ref.path));
          const ownerEmail = String(data.ownerEmail || "");
          const ownerName = resolveOwnerName(data.ownerName, ownerEmail);
          const statusRaw = String(data.status || "draft");
          const status: ReportStatus =
            statusRaw === "completed" ||
            statusRaw === "pending_review" ||
            statusRaw === "discarded"
              ? statusRaw
              : "draft";
          const aiText = String(data.aiGeneratedObservationsText || "").trim();
          const finalText = String(data.observationsText || "").trim();
          const hasComparableAiBaseline = aiText.length > 0;
          const hasStoredEditFlag = typeof data.hasObservationEdits === "boolean";
          if (!hasComparableAiBaseline && !hasStoredEditFlag) {
            continue;
          }
          const stats = computeObservationEditStats(aiText, finalText);
          const hasObservationEdits = hasStoredEditFlag
            ? Boolean(data.hasObservationEdits)
            : stats.hasEdits;
          if (!hasObservationEdits) {
            continue;
          }
          next.push({
            issueId: `${ownerUid}:${reportId}`,
            reportId,
            ownerUid,
            ownerEmail,
            ownerName,
            patientName: String(data.patientName || "Unknown Patient"),
            templateTitle: String(data.templateTitle || data.templateId || "Unknown Template"),
            status,
            updatedAtMs: parseTimestampToMillis(data.updatedAt),
            aiText: aiText || finalText,
            finalText,
            changeCount: Number(data.observationEditCount || stats.changeCount || 1)
          });
        }
        setAdminIssues(next);
        setIsAdminIssuesLoading(false);
      },
      (snapshotError) => {
        setError(firebaseErrorMessage(snapshotError));
        setIsAdminIssuesLoading(false);
      }
    );
    return () => unsubscribe();
  }, [firebaseClient, currentUser, isAdmin]);

  useEffect(() => {
    if (!adminIssues.length) {
      setSelectedAdminIssueId("");
      return;
    }
    if (!adminIssues.some((item) => item.issueId === selectedAdminIssueId)) {
      setSelectedAdminIssueId(adminIssues[0].issueId);
    }
  }, [adminIssues, selectedAdminIssueId]);

  useEffect(() => {
    if (!firebaseClient || !currentUser) {
      setSavedCustomTemplates([]);
      setIsSavedCustomTemplatesLoading(false);
      return;
    }
    setIsSavedCustomTemplatesLoading(true);
    const templatesQuery = query(
      collection(firebaseClient.db, `users/${currentUser.uid}/savedCustomTemplates`),
      orderBy("lastUsedAt", "desc"),
      limit(50)
    );
    const unsubscribe = onSnapshot(
      templatesQuery,
      (snapshot) => {
        const next = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          const templateText = String(data.templateText || "");
          const templateHash =
            String(data.templateHash || "").trim() ||
            hashTemplateText(templateText.trim());
          const mapping = sanitizeCustomTemplateMapping(data.mapping || {});
          const profile = sanitizeTemplateProfile(data.profile || null, {
            templateHash
          });
          const entry: SavedCustomTemplate = {
            id: docSnap.id,
            name: String(data.name || "").trim() || `Custom ${docSnap.id.slice(0, 6)}`,
            templateText,
            gender: data.gender === "female" ? "female" : "male",
            mapping,
            profile,
            templateHash,
            useCount: Number(data.useCount || 0),
            lastUsedAtMs: parseTimestampToMillis(data.lastUsedAt),
            updatedAtMs: parseTimestampToMillis(data.updatedAt)
          };
          return entry;
        });
        setSavedCustomTemplates(next);
        setIsSavedCustomTemplatesLoading(false);
      },
      (snapshotError) => {
        setError(firebaseErrorMessage(snapshotError));
        setIsSavedCustomTemplatesLoading(false);
      }
    );
    return () => unsubscribe();
  }, [firebaseClient, currentUser]);

  useEffect(() => {
    if (!firebaseClient || !currentUser || !activeReportId) {
      return;
    }
    if (!observationsPlain.trim()) {
      return;
    }
    const timer = window.setTimeout(async () => {
      const aiGeneratedObservationsText =
        activeReport?.aiGeneratedObservationsText ||
        extractObservationCoreText(observationsPlain);
      const editStats = computeObservationEditStats(
        aiGeneratedObservationsText,
        observationsPlain
      );
      try {
        await setDoc(
          doc(firebaseClient.db, `users/${currentUser.uid}/reports/${activeReportId}`),
          {
            ownerName: doctorName,
            observationsHtml: observations,
            observationsText: observationsPlain,
            aiGeneratedObservationsText,
            hasObservationEdits: editStats.hasEdits,
            observationEditCount: editStats.changeCount,
            rawJson,
            flags,
            disclaimer,
            updatedAt: serverTimestamp()
          },
          { merge: true }
        );
      } catch (autosaveError) {
        setError(firebaseErrorMessage(autosaveError));
      }
    }, 1200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    firebaseClient,
    currentUser,
    activeReportId,
    observations,
    observationsPlain,
    activeReport?.aiGeneratedObservationsText,
    rawJson,
    flags,
    disclaimer,
    doctorName
  ]);

  useEffect(() => {
    if (!isCustomTemplateMode || !customTemplateText.trim()) {
      return;
    }
    let cancelled = false;
    const run = async () => {
      const templateHash = hashTemplateText(customTemplateText.trim());
      let stored = loadCustomTemplateConfig(customTemplateText);

      if (firebaseClient && currentUser && templateHash) {
        try {
          const cloudRef = doc(
            firebaseClient.db,
            `users/${currentUser.uid}/customTemplates/${templateHash}`
          );
          const cloudSnap = await getDoc(cloudRef);
          if (cloudSnap.exists()) {
            const cloudData = cloudSnap.data() as Record<string, unknown>;
            stored = {
              mapping: sanitizeCustomTemplateMapping(cloudData.mapping || {}),
              gender: cloudData.gender === "female" ? "female" : "male",
              profile: sanitizeTemplateProfile(cloudData.profile || null, {
                templateHash
              })
            };
          }
        } catch (cloudError) {
          setError(firebaseErrorMessage(cloudError));
        }
      }

      if (cancelled) return;
      const autoMapping = autoMapHeadingCandidates(customHeadingCandidates);
      const nextMapping = sanitizeCustomTemplateMapping(
        stored?.mapping || autoMapping
      );
      const validMapping: CustomTemplateMapping = {};
      for (const key of CUSTOM_TEMPLATE_SECTION_KEYS) {
        const mappedHeading = nextMapping[key];
        if (!mappedHeading) continue;
        if (!customHeadingOptions.includes(mappedHeading)) continue;
        validMapping[key] = mappedHeading;
      }

      if (loadedCustomConfigHashRef.current !== templateHash) {
        setCustomTemplateMapping(validMapping);
        if (stored?.gender) {
          setCustomTemplateGender(stored.gender);
        }
        if (stored?.profile) {
          setCustomTemplateProfile(stored.profile);
          setCustomTemplateProfileDraft(JSON.stringify(stored.profile, null, 2));
        } else {
          setCustomTemplateProfile(null);
          setCustomTemplateProfileDraft("");
        }
        loadedCustomConfigHashRef.current = templateHash;
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [
    isCustomTemplateMode,
    customTemplateText,
    customHeadingCandidates,
    customHeadingOptions,
    firebaseClient,
    currentUser
  ]);

  useEffect(() => {
    if (!isCustomTemplateMode || !customTemplateText.trim()) return;
    const templateHash = hashTemplateText(customTemplateText.trim());
    const matched = savedCustomTemplates.find(
      (item) => item.id === activeCustomTemplateId || item.templateHash === templateHash
    );
    if (!matched) return;
    if (!activeCustomTemplateId) {
      setActiveCustomTemplateId(matched.id);
    }
    if (!customTemplateLabel.trim()) {
      setCustomTemplateLabel(matched.name);
    }
  }, [
    isCustomTemplateMode,
    customTemplateText,
    savedCustomTemplates,
    activeCustomTemplateId,
    customTemplateLabel
  ]);

  useEffect(() => {
    if (!isCustomTemplateMode || !customTemplateText.trim()) {
      return;
    }
    saveCustomTemplateConfig({
      templateText: customTemplateText,
      mapping: customTemplateMapping,
      gender: customTemplateGender,
      profile: customTemplateProfile
    });
    if (!firebaseClient || !currentUser) {
      return;
    }

    if (customTemplateSaveTimerRef.current) {
      window.clearTimeout(customTemplateSaveTimerRef.current);
    }
    customTemplateSaveTimerRef.current = window.setTimeout(async () => {
      try {
        const templateHash = hashTemplateText(customTemplateText.trim());
        if (!templateHash) return;
        await setDoc(
          doc(
            firebaseClient.db,
            `users/${currentUser.uid}/customTemplates/${templateHash}`
          ),
          {
            templateText: customTemplateText.trim(),
            mapping: sanitizeCustomTemplateMapping(customTemplateMapping),
            gender: customTemplateGender,
            profile: sanitizeTemplateProfile(customTemplateProfile || null, {
              templateHash
            }),
            source: customTemplateSource,
            updatedAt: serverTimestamp()
          },
          { merge: true }
        );
      } catch (cloudSaveError) {
        setError(firebaseErrorMessage(cloudSaveError));
      }
    }, 600);

    return () => {
      if (customTemplateSaveTimerRef.current) {
        window.clearTimeout(customTemplateSaveTimerRef.current);
      }
    };
  }, [
    isCustomTemplateMode,
    customTemplateText,
    customTemplateMapping,
    customTemplateGender,
    customTemplateProfile,
    customTemplateSource,
    firebaseClient,
    currentUser
  ]);

  const applyCustomTemplateText = (nextText: string, source: string) => {
    const normalized = nextText.replace(/\r\n/g, "\n");
    setCustomTemplateText(normalized);
    setCustomTemplateSource(source);
    setCustomTemplateProfileNotes([]);
    loadedCustomConfigHashRef.current = "";
  };

  const handleLoadSavedCustomTemplate = (record: SavedCustomTemplate) => {
    if (!record.templateText.trim()) {
      setError("Selected saved custom template is empty.");
      return;
    }
    setTemplateId(CUSTOM_TEMPLATE_ID);
    setActiveCustomTemplateId(record.id);
    setCustomTemplateLabel(record.name);
    setCustomTemplateGender(record.gender);
    setCustomTemplateMapping(sanitizeCustomTemplateMapping(record.mapping || {}));
    setCustomTemplateProfile(record.profile);
    setCustomTemplateProfileDraft(
      record.profile ? JSON.stringify(record.profile, null, 2) : ""
    );
    applyCustomTemplateText(record.templateText, `saved template: ${record.name}`);
    setError(null);
  };

  const handleSaveCurrentCustomTemplate = async () => {
    if (!firebaseClient || !currentUser) {
      setError("Sign in to save custom templates.");
      return;
    }
    if (!customTemplateText.trim()) {
      setError("Paste or upload template text before saving.");
      return;
    }
    const templateHash = hashTemplateText(customTemplateText.trim());
    const normalizedProfile = sanitizeTemplateProfile(customTemplateProfile || null, {
      templateHash
    });
    const saveId =
      activeCustomTemplateId ||
      doc(collection(firebaseClient.db, `users/${currentUser.uid}/savedCustomTemplates`)).id;
    const name =
      customTemplateLabel.trim() ||
      `Custom Template ${new Date().toLocaleDateString()}`;
    try {
      const isExisting = Boolean(activeCustomTemplateId);
      await setDoc(
        doc(
          firebaseClient.db,
          `users/${currentUser.uid}/savedCustomTemplates/${saveId}`
        ),
        {
          name,
          templateText: customTemplateText.trim(),
          templateHash,
          gender: customTemplateGender,
          mapping: sanitizeCustomTemplateMapping(customTemplateMapping),
          profile: normalizedProfile,
          canonicalFieldIds: normalizedProfile?.fields?.map((field) => field.id) || [],
          sectionIds: normalizedProfile?.sections?.map((section) => section.id) || [],
          useCount: activeCustomTemplateId
            ? (savedCustomTemplates.find((item) => item.id === saveId)?.useCount || 0)
            : 0,
          lastUsedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          ...(isExisting ? {} : { createdAt: serverTimestamp() })
        },
        { merge: true }
      );
      setActiveCustomTemplateId(saveId);
      setCustomTemplateLabel(name);
      setCustomTemplateSource(`saved template: ${name}`);
      setError(null);
    } catch (saveError) {
      setError(firebaseErrorMessage(saveError));
    }
  };

  const handleAutoMapCustomTemplate = () => {
    const autoMapping = autoMapHeadingCandidates(customHeadingCandidates);
    const validMapping: CustomTemplateMapping = {};
    for (const key of CUSTOM_TEMPLATE_SECTION_KEYS) {
      const mappedHeading = autoMapping[key];
      if (!mappedHeading) continue;
      if (!customHeadingOptions.includes(mappedHeading)) continue;
      validMapping[key] = mappedHeading;
    }
    setCustomTemplateMapping(validMapping);
  };

  const handleCustomTemplateFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith(".txt")) {
        applyCustomTemplateText(await file.text(), file.name);
      } else if (lowerName.endsWith(".docx")) {
        const arrayBuffer = await file.arrayBuffer();
        const extracted = await mammoth.extractRawText({ arrayBuffer });
        applyCustomTemplateText(extracted.value || "", file.name);
      } else {
        throw new Error("Unsupported template file. Please upload .txt or .docx.");
      }
      setError(null);
    } catch (uploadError) {
      setError((uploadError as Error).message);
    } finally {
      event.target.value = "";
    }
  };

  const applyCustomTemplateProfileDraft = () => {
    const sanitized = sanitizeTemplateProfile(customTemplateProfileDraft, {
      templateHash: hashTemplateText(customTemplateText.trim())
    });
    if (!sanitized) {
      setError("Profile JSON is invalid. Please review and try again.");
      return false;
    }
    setCustomTemplateProfile(sanitized);
    setCustomTemplateProfileDraft(JSON.stringify(sanitized, null, 2));
    setError(null);
    return true;
  };

  const handleAnalyzeTemplateProfile = async () => {
    if (!customTemplateText.trim()) {
      setError("Paste or upload custom template text before AI analysis.");
      return;
    }
    if (!isBackendConfigured) {
      setError("Template intelligence is disabled on this static site. Configure NEXT_PUBLIC_API_BASE_URL.");
      return;
    }
    setIsAnalyzingTemplateProfile(true);
    setError(null);
    try {
      const response = await fetch(TEMPLATE_PROFILE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_text: customTemplateText,
          template_gender: customTemplateGender
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Template intelligence failed.");
      }
      const sanitized = sanitizeTemplateProfile(payload?.profile || null, {
        templateHash: hashTemplateText(customTemplateText.trim())
      });
      if (!sanitized) {
        throw new Error("AI returned an invalid template profile.");
      }
      setCustomTemplateProfile(sanitized);
      setCustomTemplateProfileDraft(JSON.stringify(sanitized, null, 2));
      setCustomTemplateProfileNotes(
        Array.isArray(payload?.notes)
          ? payload.notes.map((note: unknown) => String(note || "")).filter(Boolean)
          : []
      );
    } catch (profileError) {
      setError((profileError as Error).message);
    } finally {
      setIsAnalyzingTemplateProfile(false);
    }
  };

  const setProfileApproved = (approved: boolean) => {
    const parsed =
      sanitizeTemplateProfile(customTemplateProfileDraft, {
        templateHash: hashTemplateText(customTemplateText.trim())
      }) || customTemplateProfile;
    if (!parsed) {
      setError("Create or apply a valid template profile before approval.");
      return;
    }
    const nextProfile = {
      ...parsed,
      approved
    };
    const sanitized = sanitizeTemplateProfile(nextProfile, {
      templateHash: hashTemplateText(customTemplateText.trim())
    });
    if (!sanitized) {
      setError("Unable to update profile approval state.");
      return;
    }
    setCustomTemplateProfile(sanitized);
    setCustomTemplateProfileDraft(JSON.stringify(sanitized, null, 2));
    setError(null);
  };

  const resetAudio = () => {
    generateAfterStopRef.current = false;
    loadedSavedAudioReportIdRef.current = "";
    if (isRecording) stopRecording();
    setIsRecordingPaused(false);
    recordingStartMsRef.current = null;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
    setAudioUrl(null);
    setAudioFile(null);
    setAudioDuration(null);
    setElapsedSeconds(0);
    setError(null);
  };

  const handleSelectTemplate = (nextTemplateId: string) => {
    setTemplateId(nextTemplateId);
    setActiveReportId("");
    loadedCustomConfigHashRef.current = "";
    setObservations("");
    setRawJson("");
    setFlags([]);
    setDisclaimer("");
  };

  const startNewReportSession = () => {
    setAllowRecordingFromReport(true);
    loadedSavedAudioReportIdRef.current = "";
    setActiveReportId("");
    setAudioFile(null);
    setAudioDuration(null);
    setAudioUrl(null);
    setObservations("");
    setRawJson("");
    setFlags([]);
    setDisclaimer("");
    setActiveView("recording");
  };

  const applyAudioFile = async (file: File) => {
    if (file.size > MAX_AUDIO_BYTES) {
      setError("Audio exceeds 100MB. Please upload a smaller file.");
      return false;
    }
    if (estimateBase64Size(file.size) > MAX_INLINE_AUDIO_BYTES) {
      setError("Audio is too large for inline upload after base64 encoding (100MB limit).");
      return false;
    }
    const url = URL.createObjectURL(file);
    try {
      const duration = await getAudioDuration(url);
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = url;
      setAudioUrl(url);
      setAudioFile(file);
      setAudioDuration(duration);
      setDetectedMicLabel("Uploaded audio");
      setError(null);
      return true;
    } catch (audioError) {
      URL.revokeObjectURL(url);
      setError((audioError as Error).message);
      return false;
    }
  };

  const loadSavedAudioForReport = async (report: ReportRecord | null) => {
    if (!report) {
      setError("No report is selected for audio restore.");
      return false;
    }
    const cachedAudio = reportAudioCacheRef.current[report.id];
    if (!cachedAudio && !report.audioDownloadUrl && !report.audioStoragePath) {
      setError("No previously saved recording exists for this report.");
      return false;
    }
    if (loadedSavedAudioReportIdRef.current === report.id && audioFile) return true;

    setIsLoadingSavedAudio(true);
    try {
      if (cachedAudio) {
        const appliedCached = await applyAudioFile(cachedAudio);
        if (appliedCached) {
          loadedSavedAudioReportIdRef.current = report.id;
          return true;
        }
      }

      const fetchAudioThroughProxy = async (downloadUrl: string) => {
        const response = await fetch("/api/audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audioDownloadUrl: downloadUrl })
        });
        if (!response.ok) {
          let message = `Audio proxy failed (${response.status})`;
          try {
            const payload = (await response.json()) as Record<string, unknown>;
            if (typeof payload.error === "string" && payload.error.trim()) {
              message = payload.error.trim();
            }
          } catch {
            // Keep status-based fallback message.
          }
          throw new Error(message);
        }
        return response.blob();
      };

      let blob: Blob | null = null;
      let loadError: unknown = null;

      // Prefer persisted download URL through same-origin API proxy (avoids browser CORS).
      if (report.audioDownloadUrl) {
        try {
          blob = await fetchAudioThroughProxy(report.audioDownloadUrl);
        } catch (proxyError) {
          loadError = proxyError;
        }
      }

      // Fallback: derive a fresh download URL from storage path, then proxy it.
      if (!blob && firebaseClient && report.audioStoragePath) {
        try {
          const freshUrl = await getDownloadURL(
            storageRef(firebaseClient.storage, report.audioStoragePath)
          );
          blob = await fetchAudioThroughProxy(freshUrl);
        } catch (storagePathError) {
          loadError = storagePathError;
        }
      }

      if (!blob || !blob.size) {
        if (loadError) throw loadError;
        throw new Error("Saved recording is unavailable or empty.");
      }
      const fallbackExt = (blob.type.split("/")[1] || "webm").split(";")[0];
      const file = new File(
        [blob],
        report.audioName || `saved-recording-${report.id}.${fallbackExt}`,
        { type: report.audioType || blob.type || "audio/webm" }
      );
      reportAudioCacheRef.current[report.id] = file;
      const applied = await applyAudioFile(file);
      if (!applied) return false;
      loadedSavedAudioReportIdRef.current = report.id;
      return true;
    } catch (loadError) {
      setError(storageAudioLoadErrorMessage(loadError));
      return false;
    } finally {
      setIsLoadingSavedAudio(false);
    }
  };

  const handleAuthSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!firebaseClient) {
      setError(
        "Firebase is not configured. Add NEXT_PUBLIC_FIREBASE_* environment variables."
      );
      return;
    }
    if (!authEmail.trim() || !authPassword.trim()) {
      setError("Email and password are required.");
      return;
    }
    setIsAuthLoading(true);
    setError(null);
    try {
      if (authMode === "signup") {
        const created = await createUserWithEmailAndPassword(
          firebaseClient.auth,
          authEmail.trim(),
          authPassword
        );
        const displayName = authName.trim() || authEmail.trim().split("@")[0];
        if (displayName) {
          await updateProfile(created.user, { displayName });
        }
      } else {
        await signInWithEmailAndPassword(
          firebaseClient.auth,
          authEmail.trim(),
          authPassword
        );
      }
      setAuthPassword("");
    } catch (authError) {
      setError(firebaseErrorMessage(authError));
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    if (!firebaseClient) return;
    try {
      await signOut(firebaseClient.auth);
      if (profileAvatarObjectUrlRef.current) {
        URL.revokeObjectURL(profileAvatarObjectUrlRef.current);
        profileAvatarObjectUrlRef.current = null;
      }
      setProfileAvatarPreviewUrl("");
      setProfileAvatarFile(null);
      setIsMobileProfileMenuOpen(false);
      setIsProfileImageMenuOpen(false);
      setAllowRecordingFromReport(false);
      setTemplateId("");
      setAudioFile(null);
      setObservations("");
      setRawJson("");
      setFlags([]);
      setDisclaimer("");
      setSavedCustomTemplates([]);
      setCustomTemplateLabel("");
      setActiveCustomTemplateId("");
      setAdminIssues([]);
      setSelectedAdminIssueId("");
      setIssueSummaries({});
      reportAudioCacheRef.current = {};
      setWorklistStatusFilter("all");
      setSearchQuery("");
      setActiveView("dashboard");
    } catch (signOutError) {
      setError(firebaseErrorMessage(signOutError));
    }
  };

  const handleOpenProfileView = () => {
    setIsMobileProfileMenuOpen(false);
    setActiveView("profile");
  };

  const triggerProfileImagePicker = (mode: "camera" | "library") => {
    setIsProfileImageMenuOpen(false);
    if (mode === "camera") {
      profileImageCameraInputRef.current?.click();
      return;
    }
    profileImageUploadInputRef.current?.click();
  };

  const handleProfileImageChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setIsProfileImageMenuOpen(false);
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.");
      event.target.value = "";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image size should be under 5 MB.");
      event.target.value = "";
      return;
    }
    if (profileAvatarObjectUrlRef.current) {
      URL.revokeObjectURL(profileAvatarObjectUrlRef.current);
    }
    const objectUrl = URL.createObjectURL(file);
    profileAvatarObjectUrlRef.current = objectUrl;
    setProfileAvatarPreviewUrl(objectUrl);
    setProfileAvatarFile(file);
    event.target.value = "";
  };

  const handleSaveProfile = async () => {
    if (!firebaseClient || !currentUser) {
      setError("Please sign in to update your profile.");
      return;
    }
    const nextName = profileDraftName.trim();
    if (!nextName) {
      setError("Display name is required.");
      return;
    }
    setIsSavingProfile(true);
    setError(null);
    try {
      let avatarUrl = doctorAvatarUrl;
      if (profileAvatarFile) {
        const avatarPath = `users/${currentUser.uid}/profile/avatar-${Date.now()}-${fileNameSafe(
          profileAvatarFile.name || "avatar"
        )}`;
        const avatarRef = storageRef(firebaseClient.storage, avatarPath);
        await uploadBytes(avatarRef, profileAvatarFile, {
          contentType: profileAvatarFile.type || "image/jpeg"
        });
        avatarUrl = await getDownloadURL(avatarRef);
      }

      const nextRole = doctorProfile?.role || "Radiologist";
      const nextEmail = currentUser.email || doctorProfile?.email || "";
      await setDoc(
        doc(firebaseClient.db, `users/${currentUser.uid}/profile/main`),
        {
          displayName: nextName,
          role: nextRole,
          email: nextEmail,
          avatarUrl,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
      await updateProfile(currentUser, {
        displayName: nextName,
        photoURL: avatarUrl
      });
      setDoctorProfile({
        displayName: nextName,
        role: nextRole,
        email: nextEmail,
        avatarUrl
      });
      if (profileAvatarObjectUrlRef.current) {
        URL.revokeObjectURL(profileAvatarObjectUrlRef.current);
        profileAvatarObjectUrlRef.current = null;
      }
      setProfileAvatarPreviewUrl("");
      setProfileAvatarFile(null);
      setIsProfileImageMenuOpen(false);
      setActiveView("dashboard");
    } catch (profileError) {
      setError(firebaseErrorMessage(profileError));
    } finally {
      setIsSavingProfile(false);
    }
  };

  const openReportFromWorklist = (report: ReportRecord) => {
    const allowReRecord = report.status === "pending_review" || report.status === "draft";
    const hasSavedAudio =
      Boolean(report.audioDownloadUrl) ||
      Boolean(report.audioStoragePath) ||
      Boolean(reportAudioCacheRef.current[report.id]);
    setAllowRecordingFromReport(allowReRecord);
    loadedSavedAudioReportIdRef.current = "";
    setActiveReportId(report.id);
    setTemplateId(report.templateId);
    setObservations(report.observationsHtml || formatReportHtml(report.observationsText, report.templateId));
    setFlags(report.flags || []);
    setDisclaimer(report.disclaimer || "");
    setRawJson(report.rawJson || "");
    setAudioFile(null);
    setAudioDuration(report.audioDurationSec || null);
    setAudioUrl(null);
    if (hasSavedAudio) {
      if (allowReRecord) {
        void loadSavedAudioForReport(report);
      } else {
        void (async () => {
          const loaded = await loadSavedAudioForReport(report);
          // Completed/non-pending reports should allow playback, not regenerate from loaded audio.
          if (loaded) setAudioFile(null);
        })();
      }
    }

    if (report.templateId === CUSTOM_TEMPLATE_ID && report.customTemplateText.trim()) {
      const templateHash = hashTemplateText(report.customTemplateText.trim());
      const linkedSavedTemplate = savedCustomTemplates.find(
        (item) => item.templateHash === templateHash
      );
      setActiveCustomTemplateId(linkedSavedTemplate?.id || "");
      setCustomTemplateLabel(linkedSavedTemplate?.name || "");
      setCustomTemplateText(report.customTemplateText);
      setCustomTemplateSource("firebase");
      setCustomTemplateGender(report.customTemplateGender || "male");
      try {
        const mappingParsed = JSON.parse(report.customTemplateMappingJson || "{}");
        setCustomTemplateMapping(sanitizeCustomTemplateMapping(mappingParsed));
      } catch {
        setCustomTemplateMapping({});
      }
      const sanitized = sanitizeTemplateProfile(report.customTemplateProfileJson || null, {
        templateHash
      });
      setCustomTemplateProfile(sanitized);
      setCustomTemplateProfileDraft(sanitized ? JSON.stringify(sanitized, null, 2) : "");
    }

    setActiveView("report");
  };

  const persistReport = async (params: {
    reportId?: string;
    status: ReportStatus;
    sourceAudio?: File | null;
    observationsHtml: string;
    observationsText: string;
    generationMs?: number;
    rawPayloadJson: string;
    flagList: string[];
    disclaimerText: string;
  }) => {
    if (!firebaseClient || !currentUser || !templateId) return "";
    setIsSavingReport(true);
    const reportId =
      params.reportId ||
      activeReportId ||
      doc(collection(firebaseClient.db, `users/${currentUser.uid}/reports`)).id;

    try {
      const counterRef = doc(
        firebaseClient.db,
        `users/${currentUser.uid}/meta/counters`
      );
      const allocateNextPatientId = async () => {
        const nextId = await runTransaction(firebaseClient.db, async (tx) => {
          const counterSnap = await tx.get(counterRef);
          const counterData = counterSnap.data() as Record<string, unknown> | undefined;
          const storedNext = Number(counterData?.nextPatientId || 0);
          const nextPatientId =
            Number.isFinite(storedNext) && storedNext >= 1000
              ? Math.floor(storedNext)
              : nextPatientIdSeed;
          tx.set(
            counterRef,
            { nextPatientId: nextPatientId + 1, updatedAt: serverTimestamp() },
            { merge: true }
          );
          return nextPatientId;
        });
        return String(nextId);
      };

      let audioStoragePath = activeReport?.audioStoragePath || "";
      let audioDownloadUrl = activeReport?.audioDownloadUrl || "";
      const sourceAudio = params.sourceAudio || null;
      if (sourceAudio) {
        audioStoragePath = `users/${currentUser.uid}/recordings/${reportId}-${Date.now()}-${fileNameSafe(
          sourceAudio.name
        )}`;
        const targetRef = storageRef(firebaseClient.storage, audioStoragePath);
        await uploadBytes(targetRef, sourceAudio, {
          contentType: sourceAudio.type || "audio/webm"
        });
        audioDownloadUrl = await getDownloadURL(targetRef);
      }

      const patientMeta = parsePatientFromReport(params.observationsText);
      const reportRef = doc(
        firebaseClient.db,
        `users/${currentUser.uid}/reports/${reportId}`
      );
      const existingSnap = await getDoc(reportRef);
      const existingData = existingSnap.data() as Record<string, unknown> | undefined;
      const existingPatientId = String(
        activeReport?.patientId || existingData?.patientId || ""
      ).trim();
      const resolvedPatientId =
        existingPatientId || (await allocateNextPatientId());
      const existingGeneratedAtMs = parseTimestampToMillis(existingData?.generatedAt);
      const resolvedGeneratedAtMs =
        activeReport?.generatedAtMs || existingGeneratedAtMs || Date.now();
      const existingAiGeneratedObservationsText = String(
        activeReport?.aiGeneratedObservationsText ||
          existingData?.aiGeneratedObservationsText ||
          ""
      ).trim();
      const aiGeneratedObservationsText =
        params.status === "pending_review"
          ? extractObservationCoreText(params.observationsText)
          : existingAiGeneratedObservationsText ||
            extractObservationCoreText(params.observationsText);
      const editStats = computeObservationEditStats(
        aiGeneratedObservationsText,
        params.observationsText
      );
      await setDoc(
        reportRef,
        {
          ownerUid: currentUser.uid,
          ownerEmail: currentUser.email || "",
          ownerName: doctorName,
          templateId,
          templateTitle: selectedTemplate?.title || templateId,
          patientName: patientMeta.patientName,
          patientGender: patientMeta.patientGender,
          patientDate: patientMeta.patientDate,
          patientId: resolvedPatientId,
          accession: activeReport?.accession || randomAccessionId(),
          status: params.status,
          observationsHtml: params.observationsHtml,
          observationsText: params.observationsText,
          aiGeneratedObservationsText,
          hasObservationEdits: editStats.hasEdits,
          observationEditCount: editStats.changeCount,
          rawJson: params.rawPayloadJson,
          flags: params.flagList,
          disclaimer: params.disclaimerText,
          audioName: sourceAudio?.name || activeReport?.audioName || "",
          audioSize: sourceAudio?.size || activeReport?.audioSize || 0,
          audioType: sourceAudio?.type || activeReport?.audioType || "",
          audioDurationSec:
            audioDuration || activeReport?.audioDurationSec || 0,
          audioStoragePath,
          audioDownloadUrl,
          generationMs: params.generationMs || activeReport?.generationMs || 0,
          generatedAt: new Date(resolvedGeneratedAtMs),
          customTemplateText: isCustomTemplateMode ? customTemplateText : "",
          customTemplateGender: isCustomTemplateMode
            ? customTemplateGender
            : "male",
          customTemplateMappingJson: isCustomTemplateMode
            ? JSON.stringify(customTemplateMapping)
            : "",
          customTemplateProfileJson:
            isCustomTemplateMode && customTemplateProfile
              ? JSON.stringify(customTemplateProfile)
              : "",
          updatedAt: serverTimestamp(),
          createdAt: activeReport?.createdAtMs
            ? new Date(activeReport.createdAtMs)
            : serverTimestamp()
        },
        { merge: true }
      );

      if (isCustomTemplateMode && customTemplateText.trim()) {
        const templateHash = hashTemplateText(customTemplateText.trim());
        const normalizedProfile = sanitizeTemplateProfile(customTemplateProfile || null, {
          templateHash
        });
        const autoTemplateId = activeCustomTemplateId || templateHash;
        const existingSaved = savedCustomTemplates.find(
          (item) => item.id === autoTemplateId || item.templateHash === templateHash
        );
        const resolvedTemplateId = existingSaved?.id || autoTemplateId;
        const resolvedName =
          customTemplateLabel.trim() ||
          existingSaved?.name ||
          `Custom Template ${new Date().toLocaleDateString()}`;
        await setDoc(
          doc(
            firebaseClient.db,
            `users/${currentUser.uid}/savedCustomTemplates/${resolvedTemplateId}`
          ),
          {
            name: resolvedName,
            templateText: customTemplateText.trim(),
            templateHash,
            gender: customTemplateGender,
            mapping: sanitizeCustomTemplateMapping(customTemplateMapping),
            profile: normalizedProfile,
            canonicalFieldIds: normalizedProfile?.fields?.map((field) => field.id) || [],
            sectionIds: normalizedProfile?.sections?.map((section) => section.id) || [],
            lastUsedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            useCount: increment(1),
            ...(existingSaved ? {} : { createdAt: serverTimestamp() })
          },
          { merge: true }
        );
        setActiveCustomTemplateId(resolvedTemplateId);
      }

      if (sourceAudio) {
        reportAudioCacheRef.current[reportId] = sourceAudio;
      }
      setActiveReportId(reportId);
      return reportId;
    } catch (persistError) {
      setError(firebaseErrorMessage(persistError));
      return "";
    } finally {
      setIsSavingReport(false);
    }
  };

  const handleFinalizeReport = async () => {
    if (!hasObservations) {
      setError("Generate a report before finalizing.");
      return;
    }
    if (!firebaseClient || !currentUser) {
      setActiveView("dashboard");
      return;
    }
    await persistReport({
      reportId: activeReportId || undefined,
      status: "completed",
      observationsHtml: observations,
      observationsText: observationsPlain,
      rawPayloadJson: rawJson,
      flagList: flags,
      disclaimerText: disclaimer
    });
    setAllowRecordingFromReport(false);
    setActiveReportId("");
    setActiveView("dashboard");
  };

  const handleMarkDraft = async () => {
    if (!hasObservations) {
      setError("Generate a report before saving as draft.");
      return;
    }
    if (!firebaseClient || !currentUser) {
      return;
    }
    await persistReport({
      reportId: activeReportId || undefined,
      status: "draft",
      observationsHtml: observations,
      observationsText: observationsPlain,
      rawPayloadJson: rawJson,
      flagList: flags,
      disclaimerText: disclaimer
    });
    setAllowRecordingFromReport(false);
    setActiveReportId("");
    setActiveView("dashboard");
  };

  const handleDiscardReport = async () => {
    if (!firebaseClient || !currentUser) {
      return;
    }
    const confirmed = window.confirm(
      "Discard this report? It will be removed from your worklist and cannot be undone."
    );
    if (!confirmed) return;
    await persistReport({
      reportId: activeReportId || undefined,
      status: "discarded",
      observationsHtml: observations,
      observationsText: observationsPlain,
      rawPayloadJson: rawJson,
      flagList: flags,
      disclaimerText: disclaimer
    });
    setAllowRecordingFromReport(false);
    setActiveReportId("");
    setActiveView("dashboard");
  };

  const handleGenerate = async (audioOverride?: File | null) => {
    const sourceAudio = audioOverride || audioFile;
    if (!sourceAudio || !templateId) return;
    if (!isBackendConfigured) {
      setError("Generation is disabled on this static site. Configure NEXT_PUBLIC_API_BASE_URL.");
      return;
    }
    if (isCustomTemplateMode && !customTemplateText.trim()) {
      setError("Add custom template text before generating.");
      return;
    }
    if (
      isCustomTemplateMode &&
      (!customTemplateProfile || !customTemplateProfile.approved)
    ) {
      setError("Run AI Template Intelligence, review profile JSON, and approve profile before generating.");
      return;
    }

    setIsGenerating(true);
    setError(null);
    const generationStartMs = Date.now();

    try {
      const formData = new FormData();
      formData.append("template_id", templateId);
      formData.append("audio_file", sourceAudio);
      if (isCustomTemplateMode) {
        formData.append("custom_template_text", customTemplateText);
        formData.append("custom_template_gender", customTemplateGender);
        formData.append(
          "custom_template_mapping",
          JSON.stringify(customTemplateMapping)
        );
        if (customTemplateProfile) {
          formData.append(
            "custom_template_profile",
            JSON.stringify(customTemplateProfile)
          );
        }
      }

      const response = await fetch(API_ENDPOINT, { method: "POST", body: formData });
      const rawResponse = await response.text();
      let payload: Record<string, unknown> = {};
      try {
        payload = rawResponse ? (JSON.parse(rawResponse) as Record<string, unknown>) : {};
      } catch {
        throw new Error(
          response.ok
            ? "Server returned invalid JSON. Please retry."
            : `Generation failed (${response.status}). Server returned non-JSON response.`
        );
      }

      if (!response.ok) {
        const apiError =
          typeof payload.error === "string" && payload.error.trim()
            ? payload.error
            : "Generation failed.";
        throw new Error(apiError);
      }

      const observationsText = String(payload.observations || "");
      const observationsHtml = formatReportHtml(observationsText, templateId);
      const nextFlags = Array.isArray(payload.flags) ? payload.flags : [];
      const nextDisclaimer = String(payload.disclaimer || "");
      const rawPayloadJson = JSON.stringify(payload, null, 2);

      setObservations(observationsHtml);
      setFlags(nextFlags);
      setDisclaimer(nextDisclaimer);
      const profileFeedback =
        payload.profile_feedback && typeof payload.profile_feedback === "object"
          ? (payload.profile_feedback as Record<string, unknown>)
          : null;
      if (
        isCustomTemplateMode &&
        Array.isArray(profileFeedback?.unmapped_findings)
      ) {
        recordUnmappedFindingsLearning({
          templateText: customTemplateText,
          findings: profileFeedback.unmapped_findings.map((item: unknown) =>
            String(item || "")
          )
        });
      }
      setRawJson(rawPayloadJson);

      await persistReport({
        reportId: activeReportId || undefined,
        status: "pending_review",
        sourceAudio,
        observationsHtml,
        observationsText,
        generationMs: Date.now() - generationStartMs,
        rawPayloadJson,
        flagList: nextFlags,
        disclaimerText: nextDisclaimer
      });
      setAllowRecordingFromReport(true);
      setActiveView("report");
    } catch (generateError) {
      setError((generateError as Error).message);
    } finally {
      setIsGenerating(false);
    }
  };

  const startElapsedTimer = (elapsedAtStart: number) => {
    recordingStartMsRef.current = Date.now() - elapsedAtStart * 1000;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      const startMs = recordingStartMsRef.current;
      if (!startMs) return;
      const elapsed = Math.floor((Date.now() - startMs) / 1000);
      setElapsedSeconds(elapsed);
    }, 1000);
  };

  const startRecording = async () => {
    if (isRecording) return;
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Audio recording is not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const primaryTrack = stream.getAudioTracks()[0];
      if (primaryTrack) {
        const nextMicLabel = primaryTrack.label?.trim() || "Default microphone";
        setDetectedMicLabel(nextMicLabel);
      }
      try {
        const AudioContextCtor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (AudioContextCtor) {
          const context = new AudioContextCtor();
          const baseLatencyMs = Math.round((context.baseLatency || 0) * 1000);
          setInputLatencyMs(baseLatencyMs > 0 && Number.isFinite(baseLatencyMs) ? baseLatencyMs : null);
          await context.close();
        }
      } catch {
        setInputLatencyMs(null);
      }
      const mimeType = pickSupportedMimeType();
      const options: MediaRecorderOptions = { audioBitsPerSecond: TARGET_AUDIO_BITRATE };
      if (mimeType) options.mimeType = mimeType;

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, options);
      } catch {
        recorder = new MediaRecorder(stream);
      }

      recorderRef.current = recorder;
      chunksRef.current = [];
      recordedBytesRef.current = 0;
      setIsRecordingPaused(false);
      setElapsedSeconds(0);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
          recordedBytesRef.current += event.data.size;
          if (
            recordedBytesRef.current > MAX_AUDIO_BYTES ||
            estimateBase64Size(recordedBytesRef.current) > MAX_INLINE_AUDIO_BYTES
          ) {
            setError("Recording reached the 100MB inline limit. Please stop and upload a smaller file.");
            stopRecording();
          }
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        if (!blob.size) {
          setError("No audio captured. Please try recording again.");
          generateAfterStopRef.current = false;
          return;
        }

        const file = new File([blob], `dictation-${Date.now()}.webm`, {
          type: blob.type || "audio/webm"
        });
        const applied = await applyAudioFile(file);
        if (generateAfterStopRef.current) {
          generateAfterStopRef.current = false;
          if (applied) {
            await handleGenerate(file);
          }
        }
      };

      recorder.start(1000);
      setIsRecording(true);
      startElapsedTimer(0);
    } catch (recordError) {
      setError((recordError as Error).message);
    }
  };

  const pauseRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    try {
      recorder.pause();
      setIsRecordingPaused(true);
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    } catch {
      // ignore pause failures from unsupported browser implementations
    }
  };

  const resumeRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "paused") return;
    try {
      recorder.resume();
      setIsRecordingPaused(false);
      startElapsedTimer(elapsedSeconds);
    } catch {
      // ignore resume failures from unsupported browser implementations
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setIsRecording(false);
      setIsRecordingPaused(false);
      return;
    }
    recorder.stop();
    setIsRecording(false);
    setIsRecordingPaused(false);
    recordingStartMsRef.current = null;
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopAndProcess = async () => {
    if (isRecording) {
      generateAfterStopRef.current = true;
      stopRecording();
      return;
    }
    if (!audioFile) {
      setError("Record or upload audio before processing.");
      return;
    }
    await handleGenerate(audioFile);
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await applyAudioFile(file);
    event.target.value = "";
  };

  const handleCopy = async () => {
    const text = observationsPlain.trim();
    if (!text) {
      setError("Nothing to copy yet.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setError("Unable to copy. Please copy manually.");
    }
  };

  const handleCopyJson = async () => {
    if (!rawJson) return;
    try {
      await navigator.clipboard.writeText(rawJson);
    } catch {
      setError("Unable to copy JSON. Please copy manually.");
    }
  };

  const handleAnalyzeIssue = async (issue: AdminIssue, forceRefresh = false) => {
    setSelectedAdminIssueId(issue.issueId);
    if (!forceRefresh && issueSummaries[issue.issueId]) {
      return;
    }
    setIsIssueSummaryLoading(true);
    try {
      const response = await fetch(ISSUE_SUMMARY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ai_text: issue.aiText,
          final_text: issue.finalText
        })
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(String(payload.error || "Issue analysis failed."));
      }
      const summary: IssueSummaryPayload = {
        summary: String(payload.summary || "No summary available."),
        key_changes: Array.isArray(payload.key_changes)
          ? payload.key_changes.map((item) => String(item || "")).filter(Boolean)
          : [],
        likely_model_gaps: Array.isArray(payload.likely_model_gaps)
          ? payload.likely_model_gaps
              .map((item) => String(item || ""))
              .filter(Boolean)
          : [],
        quality_score: Number.isFinite(Number(payload.quality_score))
          ? Number(payload.quality_score)
          : 80,
        source: String(payload.source || "fallback") === "ai" ? "ai" : "fallback"
      };
      setIssueSummaries((current) => ({
        ...current,
        [issue.issueId]: summary
      }));
    } catch (analysisError) {
      setError((analysisError as Error).message);
    } finally {
      setIsIssueSummaryLoading(false);
    }
  };

  const toggleAbnormalFormatting = () => {
    const activeEditor = isFullscreen ? fullscreenEditorRef.current : editorRef.current;
    if (!activeEditor) return;
    activeEditor.focus();
    const isBold = document.queryCommandState("bold");
    const isUnderline = document.queryCommandState("underline");
    if (isBold && isUnderline) {
      document.execCommand("underline");
      document.execCommand("bold");
    } else {
      if (!isBold) document.execCommand("bold");
      if (!isUnderline) document.execCommand("underline");
    }
    setObservations(activeEditor.innerHTML);
  };

  const customTemplateReady = !isCustomTemplateMode || Boolean(customTemplateText.trim());
  const customTemplateProfileReady =
    !isCustomTemplateMode || Boolean(customTemplateProfile?.approved);
  const canGoRecording =
    Boolean(templateId) && customTemplateReady && customTemplateProfileReady;
  const canGoReport = Boolean(audioFile || activeReportId || observationsPlain.trim());
  const canProcessAudio =
    Boolean(templateId) && customTemplateReady && customTemplateProfileReady;
  const safeAudioDuration =
    typeof audioDuration === "number" && Number.isFinite(audioDuration) && audioDuration >= 0
      ? audioDuration
      : null;
  const recordingTime = isRecording ? elapsedSeconds : safeAudioDuration ?? elapsedSeconds;
  const showStopAndProcess = isRecording || Boolean(audioFile);
  const baseCompletedTopics = audioFile
    ? Math.min(2, recordingSidebarTopics.length)
    : isRecording
      ? 1
      : 0;
  const completedTopics = isGenerating
    ? Math.max(baseCompletedTopics, processingTopicProgress)
    : baseCompletedTopics;
  const isCompletedReportView = activeReportStatus === "completed";
  const goToRecordingFromReport = () => {
    if (isCompletedReportView || !allowRecordingFromReport) return;
    setActiveView("recording");
    if (!audioFile) {
      void loadSavedAudioForReport(activeReport);
    }
  };
  const goToRecordingForReRecord = () => {
    if (isCompletedReportView || !allowRecordingFromReport) return;
    resetAudio();
    setActiveView("recording");
  };
  const canStartNewFromDashboard = canGoRecording;
  const canResumeReportFromDashboard =
    Boolean(activeReportId) &&
    (activeReportStatus === "pending_review" ||
      activeReportStatus === "draft" ||
      (!activeReportStatus && allowRecordingFromReport));
  const errorToast = error ? (
    <div className="floating-error">
      <div className="flex items-start gap-3">
        <p className="flex-1">{error}</p>
        <button
          type="button"
          aria-label="Dismiss error"
          className="rounded px-1 text-base leading-none text-red-500 hover:bg-red-50 hover:text-red-700"
          onClick={() => setError(null)}
        >
          ×
        </button>
      </div>
    </div>
  ) : null;

  if (isFirebaseClientConfigured && !authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-light dark:bg-background-dark">
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-4 text-sm font-semibold text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
          Connecting to Firebase...
        </div>
      </div>
    );
  }

  if (isFirebaseClientConfigured && !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-light px-4 dark:bg-background-dark">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-5 text-center">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">altrixa.ai</h1>
            <p className="mt-1 text-sm text-slate-500">
              Sign in to access your templates, reports, and recordings.
            </p>
          </div>
          <form className="space-y-3" onSubmit={handleAuthSubmit}>
            {authMode === "signup" && (
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                  Doctor Name
                </label>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  value={authName}
                  onChange={(event) => setAuthName(event.target.value)}
                  placeholder="Dr. Name"
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Email
              </label>
              <input
                type="email"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                placeholder="doctor@hospital.com"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Password
              </label>
              <input
                type="password"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            <button
              type="submit"
              disabled={isAuthLoading}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/20 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isAuthLoading
                ? "Please wait..."
                : authMode === "signup"
                  ? "Create Account"
                  : "Sign In"}
            </button>
          </form>
          <button
            type="button"
            className="mt-3 w-full text-sm font-medium text-primary hover:underline"
            onClick={() => setAuthMode((current) => (current === "signin" ? "signup" : "signin"))}
          >
            {authMode === "signin"
              ? "New doctor? Create account"
              : "Already registered? Sign in"}
          </button>
        </div>
        {errorToast}
      </div>
    );
  }

  if (activeView === "dashboard") {
    return (
      <div className="flex h-screen overflow-hidden bg-background-light dark:bg-background-dark font-display text-slate-800 dark:text-slate-200">
        <aside
          className={`hidden ${sidebarWidthClass} flex-col border-r border-slate-200 bg-white transition-all duration-200 dark:border-slate-800 dark:bg-slate-900 lg:flex`}
        >
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-2 text-primary">
              <span className="material-icons-round text-3xl">analytics</span>
              {!isSidebarCollapsed && (
                <span className="text-xl font-bold tracking-tight">altrixa.ai</span>
              )}
            </div>
            <button
              type="button"
              className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={() => setIsSidebarCollapsed((current) => !current)}
              title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <span className="material-icons-round text-base">
                {isSidebarCollapsed ? "chevron_right" : "chevron_left"}
              </span>
            </button>
          </div>
          <nav className="flex-1 space-y-1 px-3">
            <button className="sidebar-item-active flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left font-medium transition-colors">
              <span className="material-icons-round">dashboard</span>
              {!isSidebarCollapsed && "Dashboard"}
            </button>
            <button
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left font-medium text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
              onClick={() => canStartNewFromDashboard && startNewReportSession()}
              disabled={!canStartNewFromDashboard}
            >
              <span className="material-icons-round">mic</span>
              {!isSidebarCollapsed && "Recording"}
            </button>
            <button
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left font-medium text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
              onClick={() => canResumeReportFromDashboard && setActiveView("report")}
              disabled={!canResumeReportFromDashboard}
            >
              <span className="material-icons-round">edit_note</span>
              {!isSidebarCollapsed && "Report Editor"}
            </button>
            {isAdmin && (
              <button
                className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left font-medium text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                onClick={() => setActiveView("admin")}
              >
                <span className="material-icons-round">bug_report</span>
                {!isSidebarCollapsed &&
                  `Admin Issues${adminIssueCount ? ` (${adminIssueCount})` : ""}`}
              </button>
            )}
          </nav>
          <div className="border-t border-slate-200 p-4 dark:border-slate-800">
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
              onClick={handleOpenProfileView}
            >
              <img
                className="h-10 w-10 rounded-full object-cover shadow-sm"
                alt="Radiologist"
                src={doctorAvatarUrl}
              />
              {!isSidebarCollapsed && (
                <div className="overflow-hidden">
                  <p className="truncate text-sm font-semibold">{doctorName}</p>
                  <p className="truncate text-xs text-slate-500">
                    {doctorProfile?.role || "Radiologist"}
                  </p>
                </div>
              )}
            </button>
            {!isSidebarCollapsed && currentUser && (
              <button
                className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={handleSignOut}
              >
                Sign Out
              </button>
            )}
          </div>
        </aside>

        <main className="flex-1 overflow-x-hidden overflow-y-auto">
          <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-2 border-b border-slate-200 bg-white/80 px-4 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/80 md:px-8">
            <div className="flex min-w-0 flex-1 items-center gap-3 rounded-full border border-slate-200 bg-slate-100 px-4 py-2 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25 dark:border-slate-700 dark:bg-slate-800 md:max-w-96 md:flex-none">
              <span className="material-icons-round text-slate-400">search</span>
              <input
                className="dashboard-search-input min-w-0 w-full border-none bg-transparent p-0 text-base focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 md:text-sm"
                placeholder="Search Patient ID, Name, or Accession #"
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>
            <div
              ref={mobileProfileMenuRef}
              className="relative flex flex-shrink-0 items-center md:hidden"
            >
              <button
                className="inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900"
                onClick={() => setIsMobileProfileMenuOpen((current) => !current)}
                title="Profile menu"
              >
                <img
                  src={doctorAvatarUrl}
                  alt="Profile"
                  className="h-full w-full rounded-full object-cover"
                />
              </button>
              {isMobileProfileMenuOpen && (
                <div className="absolute right-0 top-11 z-30 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                  <button
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    onClick={handleOpenProfileView}
                  >
                    <span className="material-icons-round text-sm">person</span>
                    Edit Profile
                  </button>
                  {isAdmin && (
                    <button
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                      onClick={() => {
                        setIsMobileProfileMenuOpen(false);
                        setActiveView("admin");
                      }}
                    >
                      <span className="material-icons-round text-sm">bug_report</span>
                      Admin Issues ({adminIssueCount})
                    </button>
                  )}
                  <button
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                    onClick={() => {
                      setIsMobileProfileMenuOpen(false);
                      void handleSignOut();
                    }}
                  >
                    <span className="material-icons-round text-sm">logout</span>
                    Logout
                  </button>
                </div>
              )}
            </div>
            <div className="ml-4 hidden items-center gap-6 md:flex">
              {isAdmin && (
                <button
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  onClick={() => setActiveView("admin")}
                >
                  <span className="material-icons-round text-sm">bug_report</span>
                  Issues {adminIssueCount}
                </button>
              )}
              <div className="flex items-center gap-2 rounded-full border border-green-100 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-600 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
                <span className="material-icons-round text-sm">mic</span>
                AI Voice Ready
              </div>
              <button className="relative text-slate-500 transition-colors hover:text-primary">
                <span className="material-icons-round">notifications</span>
                <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
              </button>
            </div>
          </header>

          <div className="mx-auto max-w-7xl p-4 pb-36 md:p-8 md:pb-8">
            <section className="mb-10 flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  Welcome back, {doctorName}
                </h1>
                <p className="mt-1 text-slate-500">
                  Select a template card to begin. The exact Stitch workflow is now connected.
                </p>
              </div>
              <button
                className="hidden items-center gap-3 rounded-xl bg-primary px-6 py-3 font-semibold text-white shadow-lg shadow-primary/20 transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 md:flex"
                disabled={!canGoRecording}
                onClick={startNewReportSession}
              >
                <span className="material-icons-round">add_circle</span>
                Start New Report
              </button>
            </section>

            {!isSearchMode && (
              <div className="mb-10 grid grid-cols-1 gap-6 md:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Completed Today</p>
                  <div className="mt-2 flex items-end justify-between">
                    <h2 className="text-2xl font-bold">{dashboardStats.completedToday}</h2>
                    <span className="text-xs font-medium text-green-500">Live from Firebase</span>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Avg. Turnaround</p>
                  <div className="mt-2 flex items-end justify-between">
                    <h2 className="text-2xl font-bold">{dashboardStats.avgTurnaroundMin || 0}m</h2>
                    <span className="text-xs font-medium text-primary">from generated reports</span>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Pending Sign-off</p>
                  <div className="mt-2 flex items-end justify-between">
                    <h2 className="text-2xl font-bold text-orange-500">{dashboardStats.pendingSignoff}</h2>
                    <span className="text-xs text-slate-400">Priority</span>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">AI Accuracy</p>
                  <div className="mt-2 flex items-end justify-between">
                    <h2 className="text-2xl font-bold">{dashboardStats.aiAccuracyPct}%</h2>
                    <span className="material-icons-round text-lg text-blue-400">verified</span>
                  </div>
                </div>
              </div>
            )}

            {!isSearchMode && (
              <section className="mb-10">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Quick Templates</h2>
                <button
                  className="text-sm font-semibold text-primary hover:underline"
                  onClick={() => setIsManageTemplatesOpen((current) => !current)}
                  type="button"
                >
                  {isManageTemplatesOpen ? "Close All" : "Manage All"}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {visibleQuickTemplates.map((template, index) => {
                  const visual = TEMPLATE_VISUALS[index % TEMPLATE_VISUALS.length];
                  const isSelected = template.id === templateId;
                  const recentRank = recentTemplateIds.indexOf(template.id);
                  const isRecent = recentRank >= 0 && recentRank < 4;
                  return (
                    <button
                      key={template.id}
                      onClick={() => handleSelectTemplate(template.id)}
                      className={`group rounded-xl border bg-white p-5 text-left shadow-sm transition-all dark:bg-slate-900 ${
                        isSelected
                          ? "scale-[1.02] border-primary ring-2 ring-primary/25 shadow-xl shadow-primary/20 dark:border-primary"
                          : "border-slate-200 hover:-translate-y-0.5 hover:border-primary dark:border-slate-800"
                      }`}
                    >
                      <div
                        className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg transition-transform group-hover:scale-110 ${visual.iconWrap}`}
                      >
                        <span className="material-icons-round">{visual.icon}</span>
                      </div>
                      <h3 className="font-bold text-slate-900 dark:text-white">{template.title}</h3>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                        {template.allowedTopics.slice(0, 2).join(", ")}
                        {template.allowedTopics.length > 2 ? "..." : ""}
                      </p>
                      <div className="mt-4 flex items-center justify-between">
                        {isSelected ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase text-primary">
                            <span className="material-icons-round text-[12px]">check_circle</span>
                            Selected
                          </span>
                        ) : isRecent ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-1 text-[10px] font-bold uppercase text-green-700 dark:bg-green-900/30 dark:text-green-300">
                            <span className="material-icons-round text-[12px]">history</span>
                            Recent
                          </span>
                        ) : (
                          <span className={`text-[10px] font-bold uppercase text-slate-400 ${visual.accent}`}>
                            {template.allowedTopics.length} Topics
                          </span>
                        )}
                        <span
                          className={`material-icons-round transition-colors ${
                            isSelected
                              ? "text-primary"
                              : "text-slate-300 group-hover:text-primary"
                          }`}
                        >
                          arrow_forward
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
              {quickTemplates.length > 4 && (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() =>
                      setIsQuickTemplatesExpanded((current) => !current)
                    }
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {isQuickTemplatesExpanded
                      ? "Show Less Templates"
                      : `Show More Templates (${quickTemplates.length - 4})`}
                  </button>
                </div>
              )}
              {isManageTemplatesOpen && (
                <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-800/50">
                    All Templates
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {quickTemplates.map((template, index) => {
                      const isSelected = template.id === templateId;
                      const visual = TEMPLATE_VISUALS[index % TEMPLATE_VISUALS.length];
                      return (
                        <button
                          key={`manage-${template.id}`}
                          type="button"
                          onClick={() => {
                            handleSelectTemplate(template.id);
                            setIsManageTemplatesOpen(false);
                          }}
                          className={`flex w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors last:border-b-0 dark:border-slate-800 ${
                            isSelected
                              ? "bg-primary/10"
                              : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <span
                              className={`flex h-8 w-8 items-center justify-center rounded-lg ${visual.iconWrap}`}
                            >
                              <span className="material-icons-round text-sm">{visual.icon}</span>
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                                {template.title}
                              </p>
                              <p className="truncate text-xs text-slate-500">
                                {template.allowedTopics.slice(0, 3).join(", ")}
                              </p>
                            </div>
                          </div>
                          <span
                            className={`text-xs font-bold uppercase ${
                              isSelected ? "text-primary" : "text-slate-400"
                            }`}
                          >
                            {isSelected ? "Selected" : "Use"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              </section>
            )}

            {!isSearchMode && isCustomTemplateMode && (
              <section className="mb-10 rounded-2xl border border-primary/20 bg-white p-5 shadow-sm dark:border-primary/30 dark:bg-slate-900">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                      Custom Template Setup
                    </h2>
                    <p className="text-sm text-slate-500">
                      Configure once here. altrixa.ai will fill mapped sections deterministically during generation.
                    </p>
                  </div>
                  <span className="rounded bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
                    USG Custom
                  </span>
                </div>

                <div className="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/40 lg:grid-cols-3">
                  <label className="text-xs font-semibold text-slate-500 lg:col-span-1">
                    Template Name
                    <input
                      value={customTemplateLabel}
                      onChange={(event) => setCustomTemplateLabel(event.target.value)}
                      placeholder="e.g. Dr Yash - Abdomen v1"
                      className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    />
                  </label>
                  <div className="text-xs font-semibold text-slate-500 lg:col-span-1">
                    Saved Templates
                    <select
                      value={activeCustomTemplateId}
                      onChange={(event) => {
                        const nextId = event.target.value;
                        setActiveCustomTemplateId(nextId);
                        const selected = savedCustomTemplates.find((item) => item.id === nextId);
                        if (selected) {
                          handleLoadSavedCustomTemplate(selected);
                        }
                      }}
                      className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    >
                      <option value="">
                        {isSavedCustomTemplatesLoading
                          ? "Loading..."
                          : "Select saved custom template"}
                      </option>
                      {savedCustomTemplates.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.useCount} uses)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end gap-2 lg:col-span-1">
                    <button
                      onClick={handleSaveCurrentCustomTemplate}
                      type="button"
                      className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90"
                    >
                      Save Current Template
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="space-y-3">
                    <textarea
                      value={customTemplateText}
                      onChange={(event) =>
                        applyCustomTemplateText(event.target.value, "manual edit")
                      }
                      placeholder="Paste custom USG template text here..."
                      className="h-48 w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
                        Upload .txt/.docx
                        <input
                          type="file"
                          accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                          className="hidden"
                          onChange={handleCustomTemplateFileUpload}
                        />
                      </label>
                      <button
                        onClick={handleAutoMapCustomTemplate}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                        type="button"
                      >
                        Auto-map headings
                      </button>
                      <div className="min-w-[11rem] text-xs font-semibold text-slate-500">
                        Source:{" "}
                        <span className="text-slate-700 dark:text-slate-200">
                          {customTemplateSource || "Paste or upload"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs font-semibold text-slate-500">
                        Baseline Gender
                        <select
                          value={customTemplateGender}
                          onChange={(event) =>
                            setCustomTemplateGender(
                              event.target.value === "female" ? "female" : "male"
                            )
                          }
                          className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        >
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                        </select>
                      </label>
                      <div className="text-xs font-semibold text-slate-500">
                        Headings Detected
                        <div className="mt-1 rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                          {customHeadingOptions.length}
                        </div>
                      </div>
                    </div>

                    <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                      {CUSTOM_TEMPLATE_SECTION_KEYS.map((sectionKey) => (
                        <label
                          key={sectionKey}
                          className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300"
                        >
                          <span className="min-w-[8rem]">{labelForSectionKey(sectionKey)}</span>
                          <select
                            value={customTemplateMapping[sectionKey] || ""}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              setCustomTemplateMapping((current) => {
                                const next = { ...current };
                                if (!nextValue) {
                                  delete next[sectionKey];
                                  return next;
                                }
                                next[sectionKey] = nextValue;
                                return next;
                              });
                            }}
                            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                          >
                            <option value="">Not mapped</option>
                            {customHeadingOptions.map((heading) => (
                              <option key={`${sectionKey}-${heading}`} value={heading}>
                                {heading}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                        Template Intelligence Profile
                      </h3>
                      <p className="text-xs text-slate-500">
                        One-time AI proposal. Review/edit JSON, then approve before dictation.
                      </p>
                    </div>
                    <span
                      className={`rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
                        customTemplateProfile?.approved
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                      }`}
                    >
                      {customTemplateProfile?.approved ? "Approved" : "Pending Approval"}
                    </span>
                  </div>

                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={handleAnalyzeTemplateProfile}
                      className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isAnalyzingTemplateProfile || !customTemplateText.trim()}
                      type="button"
                    >
                      {isAnalyzingTemplateProfile
                        ? "Analyzing..."
                        : "AI Analyze Template"}
                    </button>
                    <button
                      onClick={applyCustomTemplateProfileDraft}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                      type="button"
                    >
                      Apply Edited JSON
                    </button>
                    <button
                      onClick={() => setProfileApproved(true)}
                      className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700 hover:bg-green-100 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300 dark:hover:bg-green-900/30"
                      type="button"
                    >
                      Approve Profile
                    </button>
                    <button
                      onClick={() => setProfileApproved(false)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                      type="button"
                    >
                      Mark Pending
                    </button>
                  </div>

                  <textarea
                    value={customTemplateProfileDraft}
                    onChange={(event) => setCustomTemplateProfileDraft(event.target.value)}
                    placeholder='{"sections":[...],"fields":[...]}'
                    className="h-44 w-full rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs text-slate-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  />

                  {customTemplateProfileNotes.length > 0 && (
                    <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-200">
                      <p className="mb-1 font-semibold uppercase tracking-wide">
                        AI Notes
                      </p>
                      <ul className="list-disc space-y-1 pl-4">
                        {customTemplateProfileNotes.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {customLearningSuggestions.length > 0 && (
                    <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs text-violet-800 dark:border-violet-900/40 dark:bg-violet-900/20 dark:text-violet-200">
                      <p className="mb-1 font-semibold uppercase tracking-wide">
                        Profile Update Suggestions
                      </p>
                      <p className="mb-1 text-[11px]">
                        Repeated unmapped findings seen in prior reports. Consider adding fields for these.
                      </p>
                      <ul className="list-disc space-y-1 pl-4">
                        {customLearningSuggestions.map((item) => (
                          <li key={`${item.finding}-${item.count}`}>
                            {item.finding} ({item.count}x)
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </section>
            )}

            {isSearchMode && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  Search mode active: showing Active Worklist first for faster lookup.
                </p>
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Clear Search
                </button>
              </div>
            )}

            <section ref={worklistSectionRef} tabIndex={-1} className="outline-none">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Active Worklist</h2>
                <div className="hidden items-center gap-2 md:flex">
                  <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900">
                    {filteredReports.length} records
                  </span>
                </div>
              </div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setWorklistStatusFilter("all")}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    worklistStatusFilter === "all"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  }`}
                >
                  All ({worklistCounts.all})
                </button>
                <button
                  onClick={() => setWorklistStatusFilter("draft")}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    worklistStatusFilter === "draft"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  }`}
                >
                  Draft ({worklistCounts.draft})
                </button>
                <button
                  onClick={() => setWorklistStatusFilter("pending_review")}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    worklistStatusFilter === "pending_review"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  }`}
                >
                  Pending ({worklistCounts.pending_review})
                </button>
                <button
                  onClick={() => setWorklistStatusFilter("completed")}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    worklistStatusFilter === "completed"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  }`}
                >
                  Completed ({worklistCounts.completed})
                </button>
              </div>
              <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:block dark:border-slate-800 dark:bg-slate-900">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:border-slate-800 dark:bg-slate-800/50">
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Patient</th>
                      <th className="px-6 py-4">Generated</th>
                      <th className="px-6 py-4">Modality</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {isReportsLoading && (
                      <tr>
                        <td className="px-6 py-6 text-sm text-slate-500" colSpan={5}>
                          Loading reports...
                        </td>
                      </tr>
                    )}
                    {!isReportsLoading && filteredReports.length === 0 && (
                      <tr>
                        <td className="px-6 py-6 text-sm text-slate-500" colSpan={5}>
                          No saved reports yet. Generate a report to create your worklist.
                        </td>
                      </tr>
                    )}
                    {filteredReports.slice(0, 30).map((item) => (
                      <tr key={item.id} className="group transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold uppercase ${statusBadgeClasses(
                              item.status
                            )}`}
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            {labelForStatus(item.status)}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-semibold text-slate-900 dark:text-white">{item.patientName}</div>
                          <div className="text-xs text-slate-500">ID: {item.patientId || "N/A"}</div>
                        </td>
                        <td className="px-6 py-4 font-mono text-sm text-slate-600 dark:text-slate-400">
                          {formatGeneratedTime(
                            item.generatedAtMs || item.createdAtMs || item.updatedAtMs
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium dark:bg-slate-800">
                            {modalityForTemplateId(item.templateId, templates)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary opacity-0 transition-opacity group-hover:opacity-100"
                            onClick={() => openReportFromWorklist(item)}
                          >
                            Open Report
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-3 md:hidden">
                {isReportsLoading && (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-sm">
                    Loading reports...
                  </div>
                )}
                {!isReportsLoading && filteredReports.length === 0 && (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-sm">
                    No reports saved yet.
                  </div>
                )}
                {filteredReports.slice(0, 10).map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-2 flex items-center justify-between">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-semibold uppercase ${statusBadgeClasses(
                          item.status
                        )}`}
                      >
                        {labelForStatus(item.status)}
                      </span>
                      <span className="text-xs font-medium text-slate-400">
                        {formatGeneratedTime(
                          item.generatedAtMs || item.createdAtMs || item.updatedAtMs
                        )}
                      </span>
                    </div>
                    <p className="font-semibold text-slate-900">{item.patientName}</p>
                    <p className="text-xs text-slate-500">
                      {modalityForTemplateId(item.templateId, templates)} • ID {item.patientId || "N/A"}
                    </p>
                    <button
                      className="mt-3 w-full rounded-lg bg-primary/10 px-3 py-2 text-xs font-bold text-primary"
                      onClick={() => openReportFromWorklist(item)}
                    >
                      Open Report
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </main>

        {canGoRecording && (
          <div
            className="fixed bottom-5 right-4 z-40 md:hidden"
            style={{ bottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
          >
            <button
              className="flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white shadow-xl shadow-primary/30 transition-all active:scale-95"
              onClick={startNewReportSession}
            >
              <span className="material-icons-round">add_circle</span>
              Start New Report
            </button>
          </div>
        )}

        {errorToast}
      </div>
    );
  }

  if (activeView === "profile") {
    return (
      <div className="flex h-[100dvh] overflow-hidden bg-background-light dark:bg-background-dark font-display text-slate-900 dark:text-slate-100">
        <aside
          className={`hidden ${sidebarWidthClass} flex-col border-r border-slate-200 bg-white transition-all duration-200 dark:border-slate-800 dark:bg-slate-900 lg:flex`}
        >
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-2 text-primary">
              <span className="material-icons-round text-3xl">analytics</span>
              {!isSidebarCollapsed && (
                <span className="text-xl font-bold tracking-tight">altrixa.ai</span>
              )}
            </div>
            <button
              type="button"
              className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={() => setIsSidebarCollapsed((current) => !current)}
              title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <span className="material-icons-round text-base">
                {isSidebarCollapsed ? "chevron_right" : "chevron_left"}
              </span>
            </button>
          </div>
          <nav className="flex-1 space-y-1 px-3">
            <button
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left font-medium text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              onClick={() => setActiveView("dashboard")}
            >
              <span className="material-icons-round">dashboard</span>
              {!isSidebarCollapsed && "Dashboard"}
            </button>
            <button
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left font-medium text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
              onClick={() => canStartNewFromDashboard && startNewReportSession()}
              disabled={!canStartNewFromDashboard}
            >
              <span className="material-icons-round">mic</span>
              {!isSidebarCollapsed && "Recording"}
            </button>
            <button
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left font-medium text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
              onClick={() => canResumeReportFromDashboard && setActiveView("report")}
              disabled={!canResumeReportFromDashboard}
            >
              <span className="material-icons-round">edit_note</span>
              {!isSidebarCollapsed && "Report Editor"}
            </button>
            {isAdmin && (
              <button
                className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left font-medium text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                onClick={() => setActiveView("admin")}
              >
                <span className="material-icons-round">bug_report</span>
                {!isSidebarCollapsed &&
                  `Admin Issues${adminIssueCount ? ` (${adminIssueCount})` : ""}`}
              </button>
            )}
            <button className="flex w-full items-center gap-3 rounded-lg bg-primary/10 px-3 py-3 text-left font-medium text-primary">
              <span className="material-icons-round">person</span>
              {!isSidebarCollapsed && "Profile"}
            </button>
          </nav>
          <div className="border-t border-slate-200 p-4 dark:border-slate-800">
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
              onClick={handleOpenProfileView}
            >
              <img
                className="h-10 w-10 rounded-full object-cover shadow-sm"
                alt="Radiologist"
                src={doctorAvatarUrl}
              />
              {!isSidebarCollapsed && (
                <div className="overflow-hidden">
                  <p className="truncate text-sm font-semibold">{doctorName}</p>
                  <p className="truncate text-xs text-slate-500">
                    {doctorProfile?.role || "Radiologist"}
                  </p>
                </div>
              )}
            </button>
            {!isSidebarCollapsed && currentUser && (
              <button
                className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={handleSignOut}
              >
                Sign Out
              </button>
            )}
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto">
          <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 md:px-8">
            <div className="flex items-center gap-3">
              <button
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 lg:hidden"
                onClick={() => setActiveView("dashboard")}
              >
                Dashboard
              </button>
              <div>
                <h1 className="text-base font-bold text-slate-900 dark:text-white md:text-lg">
                  Edit Profile
                </h1>
                <p className="text-xs text-slate-500">Update your name and profile image.</p>
              </div>
            </div>
            <button
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              onClick={() => setActiveView("dashboard")}
            >
              Back
            </button>
          </header>

          <div className="mx-auto w-full max-w-3xl p-4 md:p-8">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-6">
              <div className="flex flex-col items-center gap-4 sm:flex-row">
                <div ref={profileImageMenuRef} className="relative">
                  <button
                    type="button"
                    className="group relative h-24 w-24 overflow-hidden rounded-full border border-slate-200 shadow-sm dark:border-slate-700"
                    onClick={() => setIsProfileImageMenuOpen((current) => !current)}
                    title="Change profile image"
                  >
                    <img
                      className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                      src={profileAvatarDisplayUrl}
                      alt="Profile preview"
                    />
                    <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-slate-900/70 via-transparent to-transparent pb-2 text-[10px] font-semibold text-white opacity-0 transition group-hover:opacity-100">
                      Change
                    </div>
                  </button>
                  {isProfileImageMenuOpen && (
                    <div className="absolute left-1/2 top-28 z-20 w-44 -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                        onClick={() => triggerProfileImagePicker("camera")}
                      >
                        <span className="material-icons-round text-sm">photo_camera</span>
                        Take Picture
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                        onClick={() => triggerProfileImagePicker("library")}
                      >
                        <span className="material-icons-round text-sm">image</span>
                        Upload Image
                      </button>
                    </div>
                  )}
                  <input
                    ref={profileImageUploadInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleProfileImageChange}
                  />
                  <input
                    ref={profileImageCameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleProfileImageChange}
                  />
                </div>
                <div className="w-full">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Profile Image
                  </p>
                  <p className="text-xs text-slate-500">
                    Click the image to take a picture or upload one (up to 5 MB).
                  </p>
                  {profileAvatarFile && (
                    <p className="mt-3 truncate text-xs text-slate-500">
                      Selected: {profileAvatarFile.name}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-6">
                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                  Display Name
                </label>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  value={profileDraftName}
                  onChange={(event) => setProfileDraftName(event.target.value)}
                  placeholder="Dr. Name"
                />
                <p className="mt-2 text-xs text-slate-500">
                  Email: {doctorProfile?.email || currentUser?.email || "N/A"}
                </p>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-2">
                <button
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-md shadow-primary/20 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleSaveProfile}
                  disabled={isSavingProfile}
                >
                  <span className="material-icons-round text-base">
                    {isSavingProfile ? "autorenew" : "save"}
                  </span>
                  {isSavingProfile ? "Saving..." : "Save Profile"}
                </button>
                <button
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  onClick={() => setActiveView("dashboard")}
                  disabled={isSavingProfile}
                >
                  Cancel
                </button>
                <button
                  className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-100 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30"
                  onClick={handleSignOut}
                  disabled={isSavingProfile}
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        </main>

        {errorToast}
      </div>
    );
  }

  if (activeView === "admin" && isAdmin) {
    return (
      <div className="flex h-[100dvh] overflow-hidden bg-background-light dark:bg-background-dark font-display text-slate-900 dark:text-slate-100">
        <aside
          className={`hidden ${sidebarWidthClass} flex-col border-r border-slate-200 bg-white transition-all duration-200 dark:border-slate-800 dark:bg-slate-900 lg:flex`}
        >
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-2 text-primary">
              <span className="material-icons-round text-3xl">analytics</span>
              {!isSidebarCollapsed && (
                <span className="text-xl font-bold tracking-tight">altrixa.ai</span>
              )}
            </div>
            <button
              type="button"
              className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={() => setIsSidebarCollapsed((current) => !current)}
              title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <span className="material-icons-round text-base">
                {isSidebarCollapsed ? "chevron_right" : "chevron_left"}
              </span>
            </button>
          </div>
          <nav className="flex-1 space-y-1 px-3">
            <button
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left font-medium text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              onClick={() => setActiveView("dashboard")}
            >
              <span className="material-icons-round">dashboard</span>
              {!isSidebarCollapsed && "Dashboard"}
            </button>
            <button
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left font-medium text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
              onClick={() => canStartNewFromDashboard && startNewReportSession()}
              disabled={!canStartNewFromDashboard}
            >
              <span className="material-icons-round">mic</span>
              {!isSidebarCollapsed && "Recording"}
            </button>
            <button
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left font-medium text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
              onClick={() => canResumeReportFromDashboard && setActiveView("report")}
              disabled={!canResumeReportFromDashboard}
            >
              <span className="material-icons-round">edit_note</span>
              {!isSidebarCollapsed && "Report Editor"}
            </button>
            <button className="flex w-full items-center gap-3 rounded-lg bg-primary/10 px-3 py-3 text-left font-medium text-primary">
              <span className="material-icons-round">bug_report</span>
              {!isSidebarCollapsed && `Admin Issues (${adminIssueCount})`}
            </button>
          </nav>
          <div className="border-t border-slate-200 p-4 dark:border-slate-800">
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
              onClick={handleOpenProfileView}
            >
              <img
                className="h-10 w-10 rounded-full object-cover shadow-sm"
                alt="Radiologist"
                src={doctorAvatarUrl}
              />
              {!isSidebarCollapsed && (
                <div className="overflow-hidden">
                  <p className="truncate text-sm font-semibold">{doctorName}</p>
                  <p className="truncate text-xs text-slate-500">
                    {doctorProfile?.role || "Radiologist"}
                  </p>
                </div>
              )}
            </button>
            {!isSidebarCollapsed && currentUser && (
              <button
                className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={handleSignOut}
              >
                Sign Out
              </button>
            )}
          </div>
        </aside>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 md:px-6">
            <div className="flex items-center gap-3">
              <button
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 md:hidden"
                onClick={() => setActiveView("dashboard")}
              >
                Dashboard
              </button>
              <div>
                <h1 className="text-base font-bold text-slate-900 dark:text-white md:text-lg">
                  Admin Issue Dashboard
                </h1>
                <p className="text-[11px] text-slate-500 md:text-xs">
                  {adminIssueCount} edited reports where doctors changed AI observations.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase text-primary">
                Admin
              </span>
              <button
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 md:hidden"
                onClick={handleSignOut}
              >
                Sign Out
              </button>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 overflow-hidden p-3 md:p-6">
            <div className="grid min-h-0 w-full flex-1 gap-4 xl:grid-cols-[360px,minmax(0,1fr)]">
              <section className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Edited Reports
                  </h2>
                  <p className="text-xs text-slate-500">
                    Select a case to compare AI output vs final report.
                  </p>
                </div>
                <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
                  {isAdminIssuesLoading && (
                    <div className="rounded-lg px-3 py-4 text-sm text-slate-500">
                      Loading issues...
                    </div>
                  )}
                  {!isAdminIssuesLoading && adminIssues.length === 0 && (
                    <div className="rounded-lg px-3 py-4 text-sm text-slate-500">
                      No edited reports detected yet.
                    </div>
                  )}
                  {adminIssues.map((issue) => {
                    const isActive = issue.issueId === selectedAdminIssueId;
                    return (
                      <button
                        key={issue.issueId}
                        className={`mb-2 w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                          isActive
                            ? "border-primary/40 bg-primary/10"
                            : "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
                        }`}
                        onClick={() => setSelectedAdminIssueId(issue.issueId)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {issue.patientName}
                          </p>
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                            {issue.changeCount}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-500">
                          {issue.templateTitle}
                        </p>
                        <p className="mt-1 truncate text-xs font-semibold text-slate-600 dark:text-slate-300">
                          {issue.ownerName}
                        </p>
                        <p className="truncate text-[11px] text-slate-400">
                          {issue.ownerEmail || issue.ownerUid || "Unknown"}
                        </p>
                        <div className="mt-2 flex items-center justify-between text-[11px]">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold uppercase ${statusBadgeClasses(
                              issue.status
                            )}`}
                          >
                            {labelForStatus(issue.status)}
                          </span>
                          <span className="text-slate-400">
                            {formatGeneratedTime(issue.updatedAtMs)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                {!selectedAdminIssue ? (
                  <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-sm text-slate-500">
                    Select an issue from the left panel.
                  </div>
                ) : (
                  <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                          {selectedAdminIssue.patientName}
                        </h2>
                        <p className="text-sm text-slate-500">
                          {selectedAdminIssue.templateTitle}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Owner:{" "}
                          {selectedAdminIssue.ownerName}
                          {" ("}
                          {selectedAdminIssue.ownerEmail ||
                            selectedAdminIssue.ownerUid ||
                            "Unknown"}
                          {")"}
                          {" • "}
                          Updated: {formatGeneratedTime(selectedAdminIssue.updatedAtMs)}
                          {" • "}
                          {selectedAdminIssue.changeCount} observation edits
                        </p>
                      </div>
                      <button
                        className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white shadow-md shadow-primary/20 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => void handleAnalyzeIssue(selectedAdminIssue, true)}
                        disabled={isIssueSummaryLoading}
                      >
                        {isIssueSummaryLoading ? "Analyzing..." : "Analyze with AI"}
                      </button>
                    </div>

                    <div className="mt-4 grid gap-4 2xl:grid-cols-2">
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          AI Generated Report
                        </p>
                        <textarea
                          readOnly
                          value={selectedAdminIssue.aiText}
                          className="custom-scrollbar h-[32vh] w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 md:h-[37vh] xl:h-[41vh]"
                        />
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Final Edited Report
                        </p>
                        <textarea
                          readOnly
                          value={selectedAdminIssue.finalText}
                          className="custom-scrollbar h-[32vh] w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 md:h-[37vh] xl:h-[41vh]"
                        />
                      </div>
                    </div>

                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          AI Change Summary
                        </h3>
                        {selectedAdminIssueSummary && (
                          <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase text-primary">
                            {selectedAdminIssueSummary.source === "ai"
                              ? "Gemini"
                              : "Fallback"}{" "}
                            • Score {selectedAdminIssueSummary.quality_score}
                          </span>
                        )}
                      </div>
                      {!selectedAdminIssueSummary && !isIssueSummaryLoading && (
                        <p className="text-sm text-slate-500">
                          Click &quot;Analyze with AI&quot; to generate a concise issue summary.
                        </p>
                      )}
                      {isIssueSummaryLoading && (
                        <p className="text-sm text-slate-500">
                          Running comparison...
                        </p>
                      )}
                      {selectedAdminIssueSummary && (
                        <div className="space-y-3">
                          <p className="text-sm text-slate-700 dark:text-slate-200">
                            {selectedAdminIssueSummary.summary}
                          </p>
                          {selectedAdminIssueSummary.key_changes.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Key Changes
                              </p>
                              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-200">
                                {selectedAdminIssueSummary.key_changes.map((item, index) => (
                                  <li key={`change-${index}`}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {selectedAdminIssueSummary.likely_model_gaps.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Likely Model Gaps
                              </p>
                              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-200">
                                {selectedAdminIssueSummary.likely_model_gaps.map((item, index) => (
                                  <li key={`gap-${index}`}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </div>
          </div>
        </main>

        {errorToast}
      </div>
    );
  }

  if (activeView === "recording") {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-background-light text-slate-800 dark:bg-background-dark dark:text-slate-200">
        <header className={`${sidebarOffsetClass} sticky top-0 z-50 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900 md:px-8`}>
          <div className="flex items-center gap-6">
            <button
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 md:hidden"
              onClick={() => setActiveView("dashboard")}
            >
              Dashboard
            </button>
            <div className="flex flex-col">
              <span className="text-xs font-medium uppercase text-slate-500">Template</span>
              <span className="text-sm font-semibold">{selectedTemplate?.title || "Not selected"}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-medium uppercase text-slate-500">Patient</span>
              <span className="text-sm font-semibold">{activeReport?.patientName || "Not set"}</span>
            </div>
            <div className="hidden flex-col md:flex">
              <span className="text-xs font-medium uppercase text-slate-500">Status</span>
              <span className="text-sm font-semibold text-primary">
                {isGenerating ? "Generating" : isRecording ? "Recording" : "Ready"}
              </span>
            </div>
          </div>
          <div className="hidden rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase text-primary md:inline-flex">
            Recording
          </div>
        </header>

        <main className={`${sidebarOffsetClass} flex min-h-0 flex-1 overflow-hidden pb-52 md:pb-0`}>
          <aside
            className={`hidden ${sidebarWidthClass} fixed inset-y-0 left-0 z-40 flex-col border-r border-slate-200 bg-white transition-all duration-200 dark:border-slate-800 dark:bg-slate-900 lg:flex`}
          >
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-2 text-primary">
                <span className="material-icons-round text-3xl">analytics</span>
                {!isSidebarCollapsed && (
                  <span className="text-xl font-bold tracking-tight">altrixa.ai</span>
                )}
              </div>
              <button
                type="button"
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                onClick={() => setIsSidebarCollapsed((current) => !current)}
                title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                <span className="material-icons-round text-base">
                  {isSidebarCollapsed ? "chevron_right" : "chevron_left"}
                </span>
              </button>
            </div>
            <nav className="flex-1 space-y-1 px-3">
              <button
                className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left font-medium text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                title="Dashboard"
                onClick={() => setActiveView("dashboard")}
              >
                <span className="material-icons-round">dashboard</span>
                {!isSidebarCollapsed && "Dashboard"}
              </button>
              <button
                className="flex w-full items-center gap-3 rounded-lg bg-primary/10 px-3 py-3 text-left font-medium text-primary"
                title="Recording"
                onClick={() => setActiveView("recording")}
              >
                <span className="material-icons-round">mic</span>
                {!isSidebarCollapsed && "Recording"}
              </button>
              <button
                className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left font-medium text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
                title="Report Editor"
                onClick={() => canGoReport && setActiveView("report")}
                disabled={!canGoReport || isGenerating}
              >
                <span className="material-icons-round">edit_note</span>
                {!isSidebarCollapsed && "Report Editor"}
              </button>
              {isAdmin && (
                <button
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left font-medium text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                  title="Admin Issues"
                  onClick={() => setActiveView("admin")}
                >
                  <span className="material-icons-round">bug_report</span>
                  {!isSidebarCollapsed &&
                    `Admin Issues${adminIssueCount ? ` (${adminIssueCount})` : ""}`}
                </button>
              )}
            </nav>
            <div className="border-t border-slate-200 p-4 dark:border-slate-800">
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                onClick={handleOpenProfileView}
              >
                <img
                  className="h-10 w-10 rounded-full object-cover shadow-sm"
                  alt="Radiologist"
                  src={doctorAvatarUrl}
                />
                {!isSidebarCollapsed && (
                  <div className="overflow-hidden">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{doctorName}</p>
                    <p className="truncate text-xs text-slate-500">{doctorProfile?.role || "Radiologist"}</p>
                  </div>
                )}
              </button>
              {!isSidebarCollapsed && currentUser && (
                <button
                  className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  onClick={handleSignOut}
                >
                  Sign Out
                </button>
              )}
            </div>
          </aside>

          <div className="relative flex flex-1 flex-col">
            <div className="flex flex-1 flex-col items-center justify-center p-6 md:p-12">
              <div className="mb-12 text-center">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-primary">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                  </span>
                  {isRecording
                    ? isRecordingPaused
                      ? "Recording Paused"
                      : "Recording Live"
                    : "Recorder Ready"}
                </div>
                <h2 className="text-3xl font-bold text-slate-900 dark:text-white">Dictating Report Findings</h2>
                <p className="mt-2 text-slate-500">AI is processing your speech in real-time...</p>
              </div>

              <div className="waveform-container w-full max-w-2xl">
                {Array.from({ length: 16 }).map((_, index) => {
                  const heights = [48, 96, 64, 128, 192, 144, 224, 256, 160, 256, 224, 192, 128, 64, 96, 48];
                  return (
                    <div
                      key={index}
                      className="bar"
                      style={{
                        height: `${heights[index]}px`,
                        opacity: isRecording ? (isRecordingPaused ? 0.6 : 1) : 0.5
                      }}
                    />
                  );
                })}
              </div>

              <div className="mt-12 font-mono text-5xl font-bold tracking-tighter text-slate-900 dark:text-white">
                {formatDuration(recordingTime)}
              </div>
            </div>

            <div className="h-48 overflow-hidden border-t border-slate-200 bg-white/60 p-8 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/60">
              <div className="mx-auto max-w-3xl">
                <p className="text-lg leading-relaxed text-slate-400">
                  {isLoadingSavedAudio ? (
                    <>
                      Loading previous recording... You can hit{" "}
                      <span className="font-medium italic text-slate-900 underline decoration-primary/30 underline-offset-4 dark:text-white">
                        Stop &amp; Generate
                      </span>{" "}
                      to regenerate, or start recording for a new dictation.
                    </>
                  ) : audioFile ? (
                    <>
                      Audio captured successfully. <span className="font-medium italic text-slate-900 underline decoration-primary/30 underline-offset-4 dark:text-white">{audioFile.name}</span> is ready for
                      processing. Size: <span className="font-medium text-slate-900 dark:text-white">{formatBytes(audioFile.size)}</span>.
                    </>
                  ) : (
                    <>
                      ...findings include normal <span className="font-medium italic text-slate-900 underline decoration-primary/30 underline-offset-4 dark:text-white">cardiac silhouette size</span>. The lungs are clear bilaterally with no evidence of focal consolidation...
                    </>
                  )}
                  <span className="ml-1 inline-block h-6 w-1.5 animate-pulse bg-primary align-middle" />
                </p>
              </div>
            </div>

            <div className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-wrap items-center gap-3 rounded-full border border-slate-200 bg-white p-3 shadow-2xl shadow-slate-300/40 dark:border-slate-700 dark:bg-slate-800 dark:shadow-none md:flex">
              <button
                className={`flex h-14 items-center justify-center rounded-full font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                  showStopAndProcess
                    ? "w-14 bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300"
                    : "gap-3 bg-primary px-8 text-white shadow-lg shadow-primary/30 hover:bg-primary/90"
                }`}
                onClick={() => {
                  if (!isRecording) {
                    void startRecording();
                    return;
                  }
                  if (isRecordingPaused) {
                    resumeRecording();
                    return;
                  }
                  pauseRecording();
                }}
                disabled={isGenerating}
                title={!isRecording ? "Start recording" : isRecordingPaused ? "Resume recording" : "Pause recording"}
              >
                <span className="material-icons">
                  {!isRecording ? "play_arrow" : isRecordingPaused ? "play_arrow" : "pause"}
                </span>
                {!showStopAndProcess && "START RECORDING"}
              </button>
              {showStopAndProcess && (
                <button
                  className="group flex h-14 items-center gap-3 rounded-full bg-primary px-8 font-bold text-white shadow-lg shadow-primary/30 transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={stopAndProcess}
                  disabled={!canProcessAudio || isGenerating}
                  title="Stop and process report"
                >
                  <span
                    className={`material-icons transition-transform ${
                      isGenerating ? "animate-spin" : "group-hover:scale-110"
                    }`}
                  >
                    {isGenerating ? "autorenew" : "stop"}
                  </span>
                  {isGenerating ? "GENERATING REPORT..." : "STOP & GENERATE"}
                </button>
              )}
              <label className="flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-slate-100 text-slate-600 transition-all hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300">
                <span className="material-icons">upload_file</span>
                <input
                  type="file"
                  accept="audio/wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/webm,audio/ogg"
                  className="hidden"
                  onChange={handleUpload}
                />
              </label>
            </div>
          </div>

          <aside className="hidden w-80 overflow-y-auto border-l border-slate-200 bg-white p-6 lg:block dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-8 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">Report Template</h3>
              <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary">
                {completedTopics}/{recordingSidebarTopics.length} COMPLETED
              </span>
            </div>
            <div className="space-y-6">
              <div>
                <h4 className="mb-3 text-xs font-bold uppercase tracking-tighter text-slate-400">
                  {selectedTemplate?.title || "Select template"}
                </h4>
                <div className="space-y-3">
                  {recordingSidebarTopics.map((topic, index) => {
                    const checked = index < completedTopics;
                    return (
                      <div key={topic} className="flex items-center gap-3">
                        {checked ? (
                          <div
                            className={`flex h-5 w-5 items-center justify-center rounded-full ${
                              isGenerating
                                ? "bg-green-100 dark:bg-green-900/40"
                                : "bg-primary/20"
                            }`}
                          >
                            <span
                              className={`material-icons text-[14px] font-bold ${
                                isGenerating ? "text-green-600 dark:text-green-400" : "text-primary"
                              }`}
                            >
                              check
                            </span>
                          </div>
                        ) : (
                          <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-primary/30" />
                        )}
                        <span
                          className={`text-sm font-medium ${
                            checked
                              ? isGenerating
                                ? "text-green-700 dark:text-green-300"
                                : "text-slate-900 dark:text-slate-100"
                              : "text-slate-500"
                          }`}
                        >
                          {topic}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="mt-12 rounded-xl border border-primary/5 bg-background-light p-4 dark:bg-slate-800">
              <div className="mb-2 flex items-center gap-2">
                <span className="material-icons text-sm text-primary">info</span>
                <p className="text-[11px] font-bold uppercase text-slate-500">Pro Tip</p>
              </div>
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                Mention &quot;Impression&quot; followed by your conclusion to automatically populate the final section.
              </p>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={resetAudio}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {audioFile ? "Re-record" : "Reset Audio"}
              </button>
              <button
                onClick={() => canGoReport && setActiveView("report")}
                disabled={!canGoReport || isGenerating}
                className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Open Editor
              </button>
            </div>
          </aside>

          <div
            className="fixed inset-x-3 z-40 md:hidden"
            style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          >
            <div className="rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Current Template</p>
                  <p className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {selectedTemplate?.title || "Template not selected"}
                  </p>
                </div>
                <button
                  onClick={resetAudio}
                  className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
                >
                  {audioFile ? "Re-record" : "Reset"}
                </button>
              </div>
              <div
                className={`grid items-center gap-2 ${
                  showStopAndProcess ? "grid-cols-[3rem,1fr,3rem]" : "grid-cols-[1fr,3rem]"
                }`}
              >
                <button
                  className={`flex h-12 items-center justify-center rounded-xl font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                    showStopAndProcess
                      ? "w-12 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300"
                      : "gap-2 bg-primary px-4 text-white shadow-lg shadow-primary/30 hover:bg-primary/90"
                  }`}
                  onClick={() => {
                    if (!isRecording) {
                      void startRecording();
                      return;
                    }
                    if (isRecordingPaused) {
                      resumeRecording();
                      return;
                    }
                    pauseRecording();
                  }}
                  disabled={isGenerating}
                  title={!isRecording ? "Start recording" : isRecordingPaused ? "Resume recording" : "Pause recording"}
                >
                  <span className="material-icons">
                    {!isRecording ? "play_arrow" : isRecordingPaused ? "play_arrow" : "pause"}
                  </span>
                  {!showStopAndProcess && <span className="text-sm">Start Recording</span>}
                </button>
                {showStopAndProcess && (
                  <button
                    className="group flex h-12 flex-col items-center justify-center rounded-xl bg-primary px-3 text-white shadow-lg shadow-primary/30 transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={stopAndProcess}
                    disabled={!canProcessAudio || isGenerating}
                    title="Stop and process report"
                  >
                    <span className="text-[10px] font-medium uppercase tracking-wide">
                      {isGenerating ? "Generating" : "Stop & Generate"}
                    </span>
                    <span className="flex items-center gap-1 text-sm font-bold">
                      {isGenerating && <span className="material-icons animate-spin text-sm">autorenew</span>}
                      {isGenerating ? "Processing..." : "Generate"}
                    </span>
                  </button>
                )}
                <label className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-slate-100 text-slate-600 transition-all hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300">
                  <span className="material-icons">upload_file</span>
                  <input
                    type="file"
                    accept="audio/wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/webm,audio/ogg"
                    className="hidden"
                    onChange={handleUpload}
                  />
                </label>
              </div>
              <button
                onClick={() => canGoReport && setActiveView("report")}
                disabled={!canGoReport || isGenerating}
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
              >
                Open Editor
              </button>
            </div>
          </div>
        </main>

        <footer className={`${sidebarOffsetClass} hidden items-center justify-between border-t border-slate-200 bg-white px-6 py-2 text-[11px] font-medium text-slate-400 md:flex dark:border-slate-800 dark:bg-slate-900`}>
          <div className="flex gap-4">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-green-500" /> MIC: {detectedMicLabel}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-slate-400" /> INPUT LATENCY:{" "}
              {inputLatencyMs ? `${inputLatencyMs} ms` : "N/A"}
            </span>
          </div>
          <div>AI ENGINE: altrixa.ai | EN-US</div>
        </footer>

        {errorToast}
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] min-h-screen flex-col overflow-hidden bg-background-light font-display text-slate-900 dark:bg-background-dark dark:text-slate-100 md:h-screen">
      <header className={`${sidebarOffsetClass} sticky top-0 z-50 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 md:px-8 dark:border-slate-800 dark:bg-slate-900`}>
        <div className="flex items-center gap-6">
          <button
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 md:hidden"
            onClick={() => setActiveView("dashboard")}
          >
            Dashboard
          </button>
          <div className="flex flex-col">
            <span className="text-xs font-medium uppercase text-slate-500">Template</span>
            <span className="text-sm font-semibold">{selectedTemplate?.title || "Not selected"}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-medium uppercase text-slate-500">Patient</span>
            <span className="text-sm font-semibold">{activeReport?.patientName || "Unknown Patient"}</span>
          </div>
          <div className="hidden flex-col md:flex">
            <span className="text-xs font-medium uppercase text-slate-500">Status</span>
            <span className="text-sm font-semibold text-primary">
              {activeReportStatus ? labelForStatus(activeReportStatus) : "Draft"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden flex-col items-end md:flex">
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
              ID / Date
            </span>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {activeReport?.patientId || "N/A"} • {activeReport?.patientDate || "N/A"}
            </span>
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1.5 text-[10px] font-medium text-green-600 dark:bg-green-900/20 dark:text-green-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
            {isSavingReport ? "Saving..." : "Saved"}
          </span>
          <span className="hidden text-[10px] italic text-slate-400 md:inline">
            Draft ID: {activeReportId || "new"}
          </span>
          <div className="hidden rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase text-primary md:inline-flex">
            Report Editor
          </div>
        </div>
      </header>

      <main
        className={`${sidebarOffsetClass} flex min-h-0 flex-grow flex-col overflow-x-hidden overflow-y-auto pb-28 md:flex-row md:overflow-hidden md:pb-0`}
      >
        <aside
          className={`hidden ${sidebarWidthClass} fixed inset-y-0 left-0 z-40 flex-col border-r border-slate-200 bg-white transition-all duration-200 dark:border-slate-800 dark:bg-slate-900 lg:flex`}
        >
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-2 text-primary">
              <span className="material-icons-round text-3xl">analytics</span>
              {!isSidebarCollapsed && (
                <span className="text-xl font-bold tracking-tight">altrixa.ai</span>
              )}
            </div>
            <button
              type="button"
              className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={() => setIsSidebarCollapsed((current) => !current)}
              title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <span className="material-icons-round text-base">
                {isSidebarCollapsed ? "chevron_right" : "chevron_left"}
              </span>
            </button>
          </div>
          <nav className="flex-1 space-y-1 px-3">
            <button
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left font-medium text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              title="Dashboard"
              onClick={() => setActiveView("dashboard")}
            >
              <span className="material-icons-round">dashboard</span>
              {!isSidebarCollapsed && "Dashboard"}
            </button>
            <button
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left font-medium text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800"
              title="Recording"
              onClick={() =>
                !isCompletedReportView &&
                allowRecordingFromReport &&
                goToRecordingFromReport()
              }
              disabled={isCompletedReportView || !allowRecordingFromReport}
            >
              <span className="material-icons-round">mic</span>
              {!isSidebarCollapsed && "Recording"}
            </button>
            <button
              className="flex w-full items-center gap-3 rounded-lg bg-primary/10 px-3 py-3 text-left font-medium text-primary"
              title="Report Editor"
              onClick={() => setActiveView("report")}
            >
              <span className="material-icons-round">edit_note</span>
              {!isSidebarCollapsed && "Report Editor"}
            </button>
            {isAdmin && (
              <button
                className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left font-medium text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                title="Admin Issues"
                onClick={() => setActiveView("admin")}
              >
                <span className="material-icons-round">bug_report</span>
                {!isSidebarCollapsed &&
                  `Admin Issues${adminIssueCount ? ` (${adminIssueCount})` : ""}`}
              </button>
            )}
          </nav>
          <div className="border-t border-slate-200 p-4 dark:border-slate-800">
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
              onClick={handleOpenProfileView}
            >
              <img
                className="h-10 w-10 rounded-full object-cover shadow-sm"
                alt="Radiologist"
                src={doctorAvatarUrl}
              />
              {!isSidebarCollapsed && (
                <div className="overflow-hidden">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{doctorName}</p>
                  <p className="truncate text-xs text-slate-500">{doctorProfile?.role || "Radiologist"}</p>
                </div>
              )}
            </button>
            {!isSidebarCollapsed && currentUser && (
              <button
                className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={handleSignOut}
              >
                Sign Out
              </button>
            )}
          </div>
        </aside>

        <div className="flex min-h-0 flex-grow flex-col overflow-visible p-3 md:overflow-hidden md:p-6">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 md:min-h-0 md:flex-1 md:gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-4">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-100">Audio Actions</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {isLoadingSavedAudio
                      ? "Loading saved recording..."
                      : audioFile
                        ? `${audioFile.name} • ${formatDuration(audioDuration)} • ${formatBytes(audioFile.size)}`
                        : activeReport?.audioName
                          ? `${activeReport.audioName} • ${formatDuration(audioDuration || activeReport.audioDurationSec)}`
                          : "No audio loaded"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isCompletedReportView ? (
                  <span className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-300">
                    Completed report: listen-only
                  </span>
                ) : (
                  <>
                    <button
                      className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => handleGenerate()}
                      disabled={
                        !audioFile ||
                        isGenerating ||
                        isLoadingSavedAudio ||
                        !isBackendConfigured ||
                        !customTemplateReady ||
                        !customTemplateProfileReady
                      }
                    >
                      {isGenerating ? "Generating..." : "Regenerate (Same Audio)"}
                    </button>
                    <button
                      className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      onClick={goToRecordingForReRecord}
                      disabled={!allowRecordingFromReport || isGenerating}
                    >
                      Re-record
                    </button>
                  </>
                )}
              </div>
            </div>

            {audioUrl && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                  Listen to Recording
                </p>
                <audio controls preload="metadata" src={audioUrl} className="w-full" />
              </div>
            )}

            <div className="flex min-h-[56vh] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:min-h-0 md:flex-1 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between border-b border-slate-200 bg-slate-50/50 px-4 py-2 dark:border-slate-800 dark:bg-slate-800/50">
                <div className="flex items-center gap-1">
                  <button
                    className="rounded p-1.5 text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-700"
                    onClick={toggleAbnormalFormatting}
                    disabled={!hasObservations}
                    title="Toggle bold + underline"
                  >
                    <span className="material-icons-round text-lg">format_bold</span>
                  </button>
                  <button
                    className="rounded p-1.5 text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-700"
                    onClick={handleCopy}
                    disabled={!hasObservations}
                    title="Copy text"
                  >
                    <span className="material-icons-round text-lg">content_copy</span>
                  </button>
                  <button
                    className="rounded p-1.5 text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-700"
                    onClick={() => exportDocx("radiology-report.docx", observations)}
                    disabled={!hasObservations}
                    title="Download DOCX"
                  >
                    <span className="material-icons-round text-lg">description</span>
                  </button>
                  <button
                    className="rounded p-1.5 text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-700"
                    onClick={() => exportPdf("radiology-report.pdf", observations)}
                    disabled={!hasObservations}
                    title="Download PDF"
                  >
                    <span className="material-icons-round text-lg">picture_as_pdf</span>
                  </button>
                  <button
                    className="rounded p-1.5 text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-700"
                    onClick={() => setIsFullscreen(true)}
                    disabled={!hasObservations}
                    title="Fullscreen"
                  >
                    <span className="material-icons-round text-lg">open_in_full</span>
                  </button>
                  {rawJson && (
                    <button
                      className="rounded p-1.5 text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-700"
                      onClick={handleCopyJson}
                      title="Copy JSON"
                    >
                      <span className="material-icons-round text-lg">data_object</span>
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium uppercase text-slate-500">AI Polish</span>
                  <button className="relative flex h-4 w-8 items-center rounded-full bg-primary">
                    <span className="absolute right-0.5 h-3 w-3 rounded-full bg-white" />
                  </button>
                </div>
              </div>

              <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
                <Editor
                  value={observations}
                  onChange={setObservations}
                  placeholder="Generated report will appear here."
                  disabled={isGenerating}
                  ref={editorRef}
                  className="report-editor viewport"
                />
              </div>
            </div>

            <div className="hidden flex-shrink-0 flex-wrap items-center justify-between gap-4 border-t border-slate-200 py-3 md:flex dark:border-slate-800">
              <div className="flex gap-2">
                <button
                  className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold transition-all hover:bg-white dark:border-slate-700 dark:hover:bg-slate-800"
                  onClick={() => exportPdf("radiology-report.pdf", observations)}
                  disabled={!hasObservations}
                >
                  <span className="material-icons-round text-lg text-slate-500">picture_as_pdf</span>
                  Download PDF
                </button>
                <button
                  className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold transition-all hover:bg-white dark:border-slate-700 dark:hover:bg-slate-800"
                  onClick={() => exportDocx("radiology-report.docx", observations)}
                  disabled={!hasObservations}
                >
                  <span className="material-icons-round text-lg text-slate-500">description</span>
                  Download DOCX
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-5 py-2.5 text-sm font-bold text-amber-700 transition-all hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/50"
                  onClick={handleMarkDraft}
                  disabled={!hasObservations || isSavingReport}
                >
                  {isSavingReport ? "Saving..." : isCompletedReportView ? "Move to Draft" : "Save as Draft"}
                  <span className="material-icons-round text-lg">edit_note</span>
                </button>
                <button
                  className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition-all hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  onClick={handleDiscardReport}
                  disabled={isSavingReport}
                >
                  {isSavingReport ? "Saving..." : "Discard"}
                  <span className="material-icons-round text-lg">delete_outline</span>
                </button>
                {!isCompletedReportView && (
                  <button
                    className="flex items-center gap-2 rounded-lg bg-primary px-8 py-2.5 font-bold text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={handleFinalizeReport}
                    disabled={!hasObservations || isSavingReport}
                  >
                    {isSavingReport ? "Saving..." : "Finalize Report"}
                    <span className="material-icons-round text-lg">check_circle</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <aside className="custom-scrollbar hidden w-full overflow-y-auto border-l border-slate-200 bg-white p-6 lg:block lg:w-80 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-bold">
              <span className="material-icons-round text-primary">auto_awesome</span>
              Smart Insights
            </h3>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">
              {flags.length || 3} New
            </span>
          </div>

          <div className="mt-6 space-y-4">
            <div className="group relative overflow-hidden rounded-xl border border-primary/10 bg-background-light p-4 dark:bg-slate-800/50">
              <div className="mb-3 flex items-center gap-2 text-primary">
                <span className="material-icons-round text-sm">psychology</span>
                <span className="text-xs font-bold uppercase tracking-wider">Terminology Improvement</span>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                AI suggests improving phrasing for higher clinical specificity where applicable.
              </p>
              <button
                className="mt-3 w-full rounded-lg bg-primary/10 py-2 text-xs font-bold text-primary transition-colors hover:bg-primary/20"
                onClick={toggleAbnormalFormatting}
                disabled={!hasObservations}
              >
                Highlight Abnormal Text
              </button>
            </div>

            <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/30 dark:bg-red-900/10">
              <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                <span className="material-icons-round text-sm">error_outline</span>
                <span className="text-xs font-bold uppercase tracking-wider">Potential Flag</span>
              </div>
              {flags.length ? (
                <ul className="list-disc space-y-1 pl-4 text-sm text-slate-700 dark:text-slate-300">
                  {flags.map((flag) => (
                    <li key={flag}>{flag}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-700 dark:text-slate-300">No model flags returned yet.</p>
              )}
            </div>

            <div className="space-y-3 rounded-xl border border-slate-200 bg-background-light p-4 dark:border-slate-700 dark:bg-slate-800/50">
              <div className="flex items-center gap-2 text-slate-500">
                <span className="material-icons-round text-sm">history_edu</span>
                <span className="text-xs font-bold uppercase tracking-wider">Follow-up Template</span>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {disclaimer || "Draft only. Must be reviewed and signed by the doctor."}
              </p>
              {!isCompletedReportView && allowRecordingFromReport && (
                <button
                  className="w-full rounded-lg border border-slate-200 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  onClick={goToRecordingForReRecord}
                >
                  Re-record in Recording
                </button>
              )}
            </div>

            <div className="mt-6 border-t border-slate-100 pt-6 dark:border-slate-800">
              <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500">AI Confidence</span>
                  <span className="text-xs font-bold text-green-500">94%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div className="h-full w-[94%] bg-green-500" />
                </div>
              </div>
            </div>
          </div>
        </aside>
      </main>

      <div
        className="fixed inset-x-3 z-50 md:hidden"
        style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          <div className="flex items-center gap-2 overflow-x-auto">
            <button
              className="min-w-[4.5rem] rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              onClick={() => exportPdf("radiology-report.pdf", observations)}
              disabled={!hasObservations}
            >
              PDF
            </button>
            <button
              className="min-w-[4.5rem] rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              onClick={() => exportDocx("radiology-report.docx", observations)}
              disabled={!hasObservations}
            >
              DOCX
            </button>
            <button
              className="min-w-[4.5rem] rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200"
              onClick={handleMarkDraft}
              disabled={!hasObservations || isSavingReport}
            >
              Draft
            </button>
            <button
              className="min-w-[4.5rem] rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              onClick={handleDiscardReport}
              disabled={isSavingReport}
            >
              Discard
            </button>
            {!isCompletedReportView && (
              <button
                className="min-w-[5.5rem] rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white"
                onClick={handleFinalizeReport}
                disabled={!hasObservations || isSavingReport}
              >
                Finalize
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="fixed bottom-24 right-4 z-40 lg:hidden">
        <button className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-2xl">
          <span className="material-icons-round">auto_awesome</span>
        </button>
      </div>

      {errorToast}

      {isFullscreen && (
        <div className="fullscreen-wrap">
          <div className="fullscreen-card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">REPORT (Fullscreen)</h3>
              <button
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                onClick={() => setIsFullscreen(false)}
              >
                Exit
              </button>
            </div>
            <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
              <Editor
                value={observations}
                onChange={setObservations}
                placeholder="Generated report will appear here."
                disabled={isGenerating}
                ref={fullscreenEditorRef}
                className="report-editor full mobile-full"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
