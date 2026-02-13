"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as mammoth from "mammoth";
import Editor from "@/components/Editor";
import { templates } from "@/lib/templates";
import { exportDocx } from "@/lib/exportDocx";
import { exportPdf } from "@/lib/exportPdf";
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

function isSkippableLine(trimmedLine: string) {
  return SKIP_LINE_PATTERNS.some((pattern) => pattern.test(trimmedLine));
}

function formatReportHtml(text: string, templateId: string) {
  const defaultLines = buildDefaultLineSet(templateId);
  const hasDefaults = defaultLines.size > 0;
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!line) return "";
      const trimmed = line.trim();
      if (IMPRESSION_PATTERN.test(trimmed)) {
        return `<strong><u>${escapeHtml(line)}</u></strong>`;
      }
      const normalized = normalizeLine(line);
      const heading = startsWithHeading(trimmed);
      let isNormal = defaultLines.has(normalized) || isSkippableLine(trimmed);
      if (!isNormal && !heading) {
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
  if (!totalSeconds && totalSeconds !== 0) return "--:--";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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
  return { mapping, gender };
}

function saveCustomTemplateConfig(params: {
  templateText: string;
  mapping: CustomTemplateMapping;
  gender: UsgGender;
}) {
  if (typeof window === "undefined") return;
  const { templateText, mapping, gender } = params;
  const trimmedTemplate = templateText.trim();
  if (!trimmedTemplate) return;
  const hash = hashTemplateText(trimmedTemplate);
  const records = readStoredCustomTemplateConfigs();
  records[hash] = {
    mapping: sanitizeCustomTemplateMapping(mapping),
    gender,
    updatedAt: new Date().toISOString()
  };
  window.localStorage.setItem(
    CUSTOM_TEMPLATE_MAPPING_STORAGE_KEY,
    JSON.stringify(records)
  );
}

function isCustomUsgTemplate(templateId: string) {
  return templateId === CUSTOM_TEMPLATE_ID;
}

function labelForSectionKey(sectionKey: CustomTemplateSectionKey) {
  return sectionKey.replace(/_/g, " ");
}

export default function Home() {
  const [templateId, setTemplateId] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [observations, setObservations] = useState("");
  const [flags, setFlags] = useState<string[]>([]);
  const [disclaimer, setDisclaimer] = useState("");
  const [rawJson, setRawJson] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeView, setActiveView] = useState<"dashboard" | "recording" | "report">("dashboard");
  const [customTemplateText, setCustomTemplateText] = useState("");
  const [customTemplateGender, setCustomTemplateGender] = useState<UsgGender>("male");
  const [customTemplateMapping, setCustomTemplateMapping] = useState<CustomTemplateMapping>({});
  const [customTemplateSource, setCustomTemplateSource] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordedBytesRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const fullscreenEditorRef = useRef<HTMLDivElement | null>(null);
  const generateAfterStopRef = useRef(false);

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
  const observationsPlain = useMemo(() => htmlToPlainText(observations), [observations]);
  const hasObservations = Boolean(observationsPlain.trim());

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
    if (!isCustomTemplateMode || !customTemplateText.trim()) {
      return;
    }
    const stored = loadCustomTemplateConfig(customTemplateText);
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
    setCustomTemplateMapping(validMapping);
    if (stored?.gender) {
      setCustomTemplateGender(stored.gender);
    }
  }, [
    isCustomTemplateMode,
    customTemplateText,
    customHeadingCandidates,
    customHeadingOptions
  ]);

  useEffect(() => {
    if (!isCustomTemplateMode || !customTemplateText.trim()) {
      return;
    }
    saveCustomTemplateConfig({
      templateText: customTemplateText,
      mapping: customTemplateMapping,
      gender: customTemplateGender
    });
  }, [
    isCustomTemplateMode,
    customTemplateText,
    customTemplateMapping,
    customTemplateGender
  ]);

  const applyCustomTemplateText = (nextText: string, source: string) => {
    const normalized = nextText.replace(/\r\n/g, "\n");
    setCustomTemplateText(normalized);
    setCustomTemplateSource(source);
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

  const resetAudio = () => {
    generateAfterStopRef.current = false;
    if (isRecording) stopRecording();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
    setAudioUrl(null);
    setAudioFile(null);
    setAudioDuration(null);
    setElapsedSeconds(0);
    setError(null);
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
      setError(null);
      return true;
    } catch (audioError) {
      URL.revokeObjectURL(url);
      setError((audioError as Error).message);
      return false;
    }
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

    setIsGenerating(true);
    setError(null);

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
      }

      const response = await fetch(API_ENDPOINT, { method: "POST", body: formData });
      const payload = await response.json();

      if (!response.ok) throw new Error(payload?.error || "Generation failed.");

      const observationsText = String(payload.observations || "");
      setObservations(formatReportHtml(observationsText, templateId));
      setFlags(Array.isArray(payload.flags) ? payload.flags : []);
      setDisclaimer(String(payload.disclaimer || ""));
      setRawJson(JSON.stringify(payload, null, 2));
      setActiveView("report");
    } catch (generateError) {
      setError((generateError as Error).message);
    } finally {
      setIsGenerating(false);
    }
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
            setActiveView("report");
            await handleGenerate(file);
          }
        }
      };

      recorder.start(1000);
      setIsRecording(true);
      const startTime = Date.now();
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setElapsedSeconds(elapsed);
      }, 1000);
    } catch (recordError) {
      setError((recordError as Error).message);
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setIsRecording(false);
      return;
    }
    recorder.stop();
    setIsRecording(false);
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
    setActiveView("report");
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
  const canGoRecording = Boolean(templateId) && customTemplateReady;
  const canGoReport = Boolean(audioFile);
  const canProcessAudio = Boolean(templateId) && customTemplateReady;
  const recordingTime = isRecording ? elapsedSeconds : audioDuration || elapsedSeconds;

  if (activeView === "dashboard") {
    return (
      <div className="flex h-screen overflow-hidden bg-background-light dark:bg-background-dark font-display text-slate-800 dark:text-slate-200">
        <aside className="hidden w-64 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:flex">
          <div className="p-6">
            <div className="flex items-center gap-2 text-primary">
              <span className="material-icons-round text-3xl">analytics</span>
              <span className="text-xl font-bold tracking-tight">altrixa.ai</span>
            </div>
          </div>
          <nav className="flex-1 space-y-1 px-3">
            <button className="sidebar-item-active flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left font-medium transition-colors">
              <span className="material-icons-round">dashboard</span>
              Dashboard
            </button>
            <button
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left font-medium text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
              onClick={() => canGoRecording && setActiveView("recording")}
              disabled={!canGoRecording}
            >
              <span className="material-icons-round">mic</span>
              Recording
            </button>
            <button
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left font-medium text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
              onClick={() => canGoReport && setActiveView("report")}
              disabled={!canGoReport}
            >
              <span className="material-icons-round">edit_note</span>
              Report Editor
            </button>
          </nav>
          <div className="border-t border-slate-200 p-4 dark:border-slate-800">
            <div className="flex items-center gap-3 p-2">
              <img
                className="h-10 w-10 rounded-full object-cover shadow-sm"
                alt="Radiologist"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuAQY8yGZ6jxkfslrkZwrL2UAZXeSbxx_gxAuQb8CBi7XV92sG5i644A5-6WJQTcujmf1y90Odf01PKlPXRuLz_0wHfDQ2SR160F7g36KKQhtm1VU76QxxWNHG3smwGxmWUdJNatDBE2QVzL5boNFB0IsBgpSteGrlivpyoiFf-QbC1l3ZAwBkyn4ODppXSjxiOtYt4TToa4_DTNJaJsjjIO2w6YsfUtSGPoxWIFg5TNW1PkdUDGxF4gt5FQ1PUYCZTLNe61RTDIQg"
              />
              <div className="overflow-hidden">
                <p className="truncate text-sm font-semibold">Dr. Julian Vance</p>
                <p className="truncate text-xs text-slate-500">Senior Radiologist</p>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto">
          <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200 bg-white/80 px-4 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/80 md:px-8">
            <div className="flex w-full items-center gap-4 rounded-full border border-slate-200 bg-slate-100 px-4 py-2 dark:border-slate-700 dark:bg-slate-800 md:max-w-96">
              <span className="material-icons-round text-slate-400">search</span>
              <input
                className="w-full border-none bg-transparent p-0 text-sm focus:ring-0"
                placeholder="Search Patient ID, Name, or Accession #"
                type="text"
              />
            </div>
            <div className="ml-4 hidden items-center gap-6 md:flex">
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
                  Welcome back, Dr. Vance
                </h1>
                <p className="mt-1 text-slate-500">
                  Select a template card to begin. The exact Stitch workflow is now connected.
                </p>
              </div>
              <button
                className="hidden items-center gap-3 rounded-xl bg-primary px-6 py-3 font-semibold text-white shadow-lg shadow-primary/20 transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 md:flex"
                disabled={!canGoRecording}
                onClick={() => setActiveView("recording")}
              >
                <span className="material-icons-round">add_circle</span>
                Start New Report
              </button>
            </section>

            <div className="mb-10 grid grid-cols-1 gap-6 md:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Completed Today</p>
                <div className="mt-2 flex items-end justify-between">
                  <h2 className="text-2xl font-bold">24</h2>
                  <span className="text-xs font-medium text-green-500">+12% vs avg</span>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Avg. Turnaround</p>
                <div className="mt-2 flex items-end justify-between">
                  <h2 className="text-2xl font-bold">18m</h2>
                  <span className="text-xs font-medium text-primary">-4m with AI</span>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Pending Sign-off</p>
                <div className="mt-2 flex items-end justify-between">
                  <h2 className="text-2xl font-bold text-orange-500">8</h2>
                  <span className="text-xs text-slate-400">Priority</span>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">AI Accuracy</p>
                <div className="mt-2 flex items-end justify-between">
                  <h2 className="text-2xl font-bold">98.2%</h2>
                  <span className="material-icons-round text-lg text-blue-400">verified</span>
                </div>
              </div>
            </div>

            <section className="mb-10">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Quick Templates</h2>
                <button className="text-sm font-semibold text-primary hover:underline">Manage All</button>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {templates.map((template, index) => {
                  const visual = TEMPLATE_VISUALS[index % TEMPLATE_VISUALS.length];
                  const isSelected = template.id === templateId;
                  return (
                    <button
                      key={template.id}
                      onClick={() => setTemplateId(template.id)}
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
            </section>

            {isCustomTemplateMode && (
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
              </section>
            )}

            <section>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Active Worklist</h2>
                <div className="hidden gap-2 md:flex">
                  <button className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
                    <span className="material-icons-round text-sm">filter_list</span>
                    Filter
                  </button>
                  <button className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
                    View All
                  </button>
                </div>
              </div>
              <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:block dark:border-slate-800 dark:bg-slate-900">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:border-slate-800 dark:bg-slate-800/50">
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Patient</th>
                      <th className="px-6 py-4">Accession #</th>
                      <th className="px-6 py-4">Modality</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    <tr className="group transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold uppercase text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                          In Progress
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-900 dark:text-white">Elena Rodriguez</div>
                        <div className="text-xs text-slate-500">Age: 42 • ID: 882910</div>
                      </td>
                      <td className="px-6 py-4 font-mono text-sm text-slate-600 dark:text-slate-400">ACC-44921-X</td>
                      <td className="px-6 py-4">
                        <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium dark:bg-slate-800">Chest X-Ray</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary opacity-0 transition-opacity group-hover:opacity-100"
                          onClick={() => {
                            if (!templateId) setTemplateId("XRAY_CHEST");
                            setActiveView("recording");
                          }}
                        >
                          Resume Report
                        </button>
                      </td>
                    </tr>
                    <tr className="group transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-2 py-1 text-xs font-semibold uppercase text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                          Pending Review
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-900 dark:text-white">James McAvoy</div>
                        <div className="text-xs text-slate-500">Age: 68 • ID: 110294</div>
                      </td>
                      <td className="px-6 py-4 font-mono text-sm text-slate-600 dark:text-slate-400">ACC-44930-M</td>
                      <td className="px-6 py-4">
                        <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium dark:bg-slate-800">Brain MRI</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                          onClick={() => canGoReport && setActiveView("report")}
                          disabled={!canGoReport}
                        >
                          Sign Off
                        </button>
                      </td>
                    </tr>
                    <tr className="group transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                          Draft
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-900 dark:text-white">Sarah Chen</div>
                        <div className="text-xs text-slate-500">Age: 29 • ID: 339201</div>
                      </td>
                      <td className="px-6 py-4 font-mono text-sm text-slate-600 dark:text-slate-400">ACC-44935-C</td>
                      <td className="px-6 py-4">
                        <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium dark:bg-slate-800">Abdominal CT</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          className="rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 opacity-0 transition-opacity group-hover:opacity-100 dark:bg-slate-700 dark:text-slate-200"
                          onClick={() => canGoReport && setActiveView("report")}
                          disabled={!canGoReport}
                        >
                          Edit Draft
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="space-y-3 md:hidden">
                <div className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2 py-1 text-[11px] font-semibold uppercase text-blue-700">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                      In Progress
                    </span>
                    <span className="text-xs font-medium text-slate-400">ACC-44921-X</span>
                  </div>
                  <p className="font-semibold text-slate-900">Elena Rodriguez</p>
                  <p className="text-xs text-slate-500">Chest X-Ray • Age 42 • ID 882910</p>
                  <button
                    className="mt-3 w-full rounded-lg bg-primary/10 px-3 py-2 text-xs font-bold text-primary"
                    onClick={() => {
                      if (!templateId) setTemplateId("XRAY_CHEST");
                      setActiveView("recording");
                    }}
                  >
                    Resume Report
                  </button>
                </div>
                <div className="rounded-xl border border-orange-100 bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-1 text-[11px] font-semibold uppercase text-orange-700">
                      Pending Review
                    </span>
                    <span className="text-xs font-medium text-slate-400">ACC-44930-M</span>
                  </div>
                  <p className="font-semibold text-slate-900">James McAvoy</p>
                  <p className="text-xs text-slate-500">Brain MRI • Age 68 • ID 110294</p>
                  <button
                    className="mt-3 w-full rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => canGoReport && setActiveView("report")}
                    disabled={!canGoReport}
                  >
                    Sign Off
                  </button>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold uppercase text-slate-600">
                      Draft
                    </span>
                    <span className="text-xs font-medium text-slate-400">ACC-44935-C</span>
                  </div>
                  <p className="font-semibold text-slate-900">Sarah Chen</p>
                  <p className="text-xs text-slate-500">Abdominal CT • Age 29 • ID 339201</p>
                  <button
                    className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => canGoReport && setActiveView("report")}
                    disabled={!canGoReport}
                  >
                    Edit Draft
                  </button>
                </div>
              </div>
            </section>
          </div>
        </main>

        <div className="fixed bottom-6 right-6 z-50 hidden md:block">
          <div className="w-72 transform rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl transition-all hover:-translate-y-1 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white">
                <span className="material-icons-round text-sm">settings_voice</span>
              </div>
              <div>
                <p className="text-xs font-bold uppercase leading-tight tracking-tighter text-slate-900 dark:text-white">
                  altrixa.ai
                </p>
                <p className="text-[10px] font-medium text-green-500">Listening for wake word...</p>
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
              <p className="text-xs italic text-slate-500">
                &quot;Select a template card, then start dictation to generate report draft...&quot;
              </p>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <div className="flex gap-1">
                <div className="h-3 w-1 animate-pulse rounded-full bg-primary/40" />
                <div className="h-5 w-1 rounded-full bg-primary" />
                <div className="h-2 w-1 animate-pulse rounded-full bg-primary/60" />
                <div className="h-4 w-1 rounded-full bg-primary/80" />
              </div>
              <span className="text-[10px] font-bold text-primary">VOICE ON</span>
            </div>
          </div>
        </div>

        {canGoRecording && (
          <div
            className="fixed bottom-5 right-4 z-40 md:hidden"
            style={{ bottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
          >
            <button
              className="flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white shadow-xl shadow-primary/30 transition-all active:scale-95"
              onClick={() => setActiveView("recording")}
            >
              <span className="material-icons-round">add_circle</span>
              Start New Report
            </button>
          </div>
        )}

        {error && <div className="floating-error">{error}</div>}
      </div>
    );
  }

  if (activeView === "recording") {
    return (
      <div className="flex min-h-screen flex-col bg-background-light text-slate-800 dark:bg-background-dark dark:text-slate-200">
        <header className="sticky top-0 z-50 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900 md:px-6">
          <div className="flex items-center gap-4 md:gap-6">
            <button
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              onClick={() => setActiveView("dashboard")}
            >
              Back
            </button>
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-primary p-1.5 text-white">
                <span className="material-icons text-xl leading-none">mic</span>
              </div>
              <h1 className="text-lg font-bold tracking-tight">
                <span className="text-primary">altrixa.ai</span>
              </h1>
            </div>
            <div className="hidden h-6 w-px bg-slate-200 md:block dark:bg-slate-800" />
            <div className="hidden flex-col md:flex">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Current Session</span>
              <span className="text-sm font-medium">{selectedTemplate?.title || "Select template from dashboard"}</span>
            </div>
          </div>
          <div className="hidden items-center gap-8 md:flex">
            <div className="flex gap-6">
              <div className="text-right">
                <p className="text-xs font-medium uppercase text-slate-500">Patient Name</p>
                <p className="text-sm font-semibold">Jane Doe</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium uppercase text-slate-500">Patient ID</p>
                <p className="text-sm font-semibold text-primary">#882-X</p>
              </div>
            </div>
          </div>
        </header>

        <main className="flex flex-1 overflow-hidden pb-52 md:pb-0">
          <aside className="hidden w-16 flex-col items-center gap-4 border-r border-slate-200 bg-white py-6 md:flex dark:border-slate-800 dark:bg-slate-900">
            <button
              className="rounded-xl p-2 text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-200"
              title="Dashboard"
              onClick={() => setActiveView("dashboard")}
            >
              <span className="material-icons-round">dashboard</span>
            </button>
            <button
              className="rounded-xl bg-primary/10 p-2 text-primary"
              title="Recording"
              onClick={() => setActiveView("recording")}
            >
              <span className="material-icons-round">mic</span>
            </button>
            <button
              className="rounded-xl p-2 text-slate-400 transition-colors hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-slate-200"
              title="Report Editor"
              onClick={() => canGoReport && setActiveView("report")}
              disabled={!canGoReport}
            >
              <span className="material-icons-round">edit_note</span>
            </button>
          </aside>

          <div className="relative flex flex-1 flex-col">
            <div className="flex flex-1 flex-col items-center justify-center p-6 md:p-12">
              <div className="mb-12 text-center">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-primary">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                  </span>
                  {isRecording ? "Recording Live" : "Recorder Ready"}
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
                        opacity: isRecording ? 1 : 0.5
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
                  {audioFile ? (
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
                className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition-all hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300"
                onClick={startRecording}
                disabled={isRecording}
                title="Start recording"
              >
                <span className="material-icons">{isRecording ? "radio_button_checked" : "play_arrow"}</span>
              </button>
              <button
                className="group flex h-14 items-center gap-3 rounded-full bg-primary px-8 font-bold text-white shadow-lg shadow-primary/30 transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={stopAndProcess}
                disabled={!canProcessAudio || isGenerating}
                title="Stop and process report"
              >
                <span className="material-icons transition-transform group-hover:scale-110">stop</span>
                {isGenerating ? "PROCESSING..." : "STOP & PROCESS REPORT"}
              </button>
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
                {audioFile ? "4/7 COMPLETED" : "0/7 COMPLETED"}
              </span>
            </div>
            <div className="space-y-6">
              <div>
                <h4 className="mb-3 text-xs font-bold uppercase tracking-tighter text-slate-400">
                  {selectedTemplate?.title || "Select template"}
                </h4>
                <div className="space-y-3">
                  {(selectedTemplate?.allowedTopics || ["Lungs & Pleura", "Cardiac Silhouette", "Impression"])
                    .slice(0, 6)
                    .map((topic, index) => {
                      const checked = audioFile ? index < 2 : false;
                      return (
                        <div key={topic} className="flex items-center gap-3">
                          {checked ? (
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20">
                              <span className="material-icons text-[14px] font-bold text-primary">check</span>
                            </div>
                          ) : (
                            <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-primary/30" />
                          )}
                          <span className={`text-sm font-medium ${checked ? "text-slate-900 dark:text-slate-100" : "text-slate-500"}`}>
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
                Reset Audio
              </button>
              <button
                onClick={() => canGoReport && setActiveView("report")}
                disabled={!canGoReport}
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
                  Reset
                </button>
              </div>
              <div className="grid grid-cols-[3rem,1fr,3rem] items-center gap-2">
                <button
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition-all hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300"
                  onClick={startRecording}
                  disabled={isRecording}
                  title="Start recording"
                >
                  <span className="material-icons">{isRecording ? "radio_button_checked" : "play_arrow"}</span>
                </button>
                <button
                  className="group flex h-12 flex-col items-center justify-center rounded-xl bg-primary px-3 text-white shadow-lg shadow-primary/30 transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={stopAndProcess}
                  disabled={!canProcessAudio || isGenerating}
                  title="Stop and process report"
                >
                  <span className="text-[10px] font-medium uppercase tracking-wide">
                    {isGenerating ? "Please wait" : "Complete & Generate"}
                  </span>
                  <span className="text-sm font-bold">{isGenerating ? "Processing..." : "Stop & Process"}</span>
                </button>
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
                disabled={!canGoReport}
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
              >
                Open Editor
              </button>
            </div>
          </div>
        </main>

        <footer className="hidden items-center justify-between border-t border-slate-200 bg-white px-6 py-2 text-[11px] font-medium text-slate-400 md:flex dark:border-slate-800 dark:bg-slate-900">
          <div className="flex gap-4">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-green-500" /> MIC: Sennheiser SC 660
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-slate-400" /> NETWORK: 42ms Latency
            </span>
          </div>
          <div>AI ENGINE: altrixa.ai | EN-US</div>
        </footer>

        {error && <div className="floating-error">{error}</div>}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background-light font-display text-slate-900 dark:bg-background-dark dark:text-slate-100">
      <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 md:px-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-4">
          <button
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            onClick={() => setActiveView("recording")}
          >
            Back
          </button>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-white">
            <span className="material-icons-round">analytics</span>
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">altrixa.ai</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Radiology Reporting Suite v2.4</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="mr-4 hidden flex-col items-end md:flex">
            <span className="text-sm font-semibold">Dr. Julian Thorne</span>
            <span className="text-xs uppercase tracking-wider text-slate-500">Radiologist</span>
          </div>
          <button className="relative rounded-full p-2 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800">
            <span className="material-icons-round text-slate-600 dark:text-slate-400">notifications</span>
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full border-2 border-white bg-red-500 dark:border-slate-900" />
          </button>
          <div className="h-10 w-10 overflow-hidden rounded-full bg-slate-200">
            <img
              className="h-full w-full object-cover"
              alt="Doctor"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuAVPFf5Ek559wPD6xWW4U2RWMQLw23KV5yVjaWpaR3SgH0IwJoep762T0EW_nM27M8b2kGkv7ifSxGSwJeQ9hWnFk1nbzImHjHz8hVzCB7PjU2UsMpogLJazOvs2o1BmZ6dddzyQM2MVBa0BCnazXmZ5932LcPOZevjSiv6_EqvuOqN9BrXYvWVw2AgQ8Sm1CDhR3qUfOezcS3th7WVTFhYxGgbLGVFk5XxepSo6i16qNk1PggQTn0QgrqhPbznQt0LMDpxwpHZ8Q"
            />
          </div>
        </div>
      </header>

      <section className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 md:px-8 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-4 md:gap-6">
          <div className="flex flex-col">
            <span className="text-xs font-bold uppercase tracking-tighter text-slate-500">Patient</span>
            <span className="font-semibold text-slate-800 dark:text-white">Johnathan Doe</span>
          </div>
          <div className="hidden h-8 w-px bg-slate-200 md:block dark:bg-slate-800" />
          <div className="flex flex-col">
            <span className="text-xs font-bold uppercase tracking-tighter text-slate-500">ID / DOB</span>
            <span className="font-medium text-slate-700 dark:text-slate-300">#PX-9921 • 12 May 1984</span>
          </div>
          <div className="hidden h-8 w-px bg-slate-200 md:block dark:bg-slate-800" />
          <div className="flex flex-col">
            <span className="text-xs font-bold uppercase tracking-tighter text-slate-500">Modality</span>
            <span className="rounded bg-primary/10 px-2 py-0.5 text-sm font-medium text-primary">
              {selectedTemplate?.title || "Template not selected"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1.5 text-xs font-medium text-green-600 dark:bg-green-900/20 dark:text-green-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
            Auto-saved 2m ago
          </span>
          <span className="text-xs italic text-slate-400">Draft ID: 882-C</span>
        </div>
      </section>

      <main className="flex flex-grow flex-col overflow-hidden md:flex-row">
        <aside className="hidden w-16 flex-col items-center gap-4 border-r border-slate-200 bg-white py-6 md:flex dark:border-slate-800 dark:bg-slate-900">
          <button
            className="rounded-xl p-2 text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-200"
            title="Dashboard"
            onClick={() => setActiveView("dashboard")}
          >
            <span className="material-icons-round">dashboard</span>
          </button>
          <button
            className="rounded-xl p-2 text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-200"
            title="Recording"
            onClick={() => setActiveView("recording")}
          >
            <span className="material-icons-round">mic</span>
          </button>
          <button
            className="rounded-xl bg-primary/10 p-2 text-primary"
            title="Report Editor"
            onClick={() => setActiveView("report")}
          >
            <span className="material-icons-round">edit_note</span>
          </button>
          <div className="my-2 h-px w-8 bg-slate-200 dark:bg-slate-700" />
          <button className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" title="Patient History">
            <span className="material-icons-round">history</span>
          </button>
          <button className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" title="Imaging Viewer">
            <span className="material-icons-round">visibility</span>
          </button>
          <button className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" title="Settings">
            <span className="material-icons-round">settings</span>
          </button>
        </aside>

        <div className="custom-scrollbar flex flex-grow flex-col overflow-y-auto p-4 md:p-6">
          <div className="mx-auto w-full max-w-4xl space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-4">
                <button
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={isRecording ? stopRecording : startRecording}
                >
                  <span className="material-icons-round">{isRecording ? "stop" : "mic"}</span>
                </button>
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-100">Add Audio Clarification</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {audioFile ? `${audioFile.name} • ${formatDuration(audioDuration)} • ${formatBytes(audioFile.size)}` : "Click mic to record or upload audio files"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="cursor-pointer rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                  Upload
                  <input
                    type="file"
                    accept="audio/wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/webm,audio/ogg"
                    className="hidden"
                    onChange={handleUpload}
                  />
                </label>
                <button
                  className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  onClick={resetAudio}
                >
                  Reset
                </button>
                <button
                  className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => handleGenerate()}
                  disabled={!templateId || !audioFile || isGenerating || !isBackendConfigured || !customTemplateReady}
                >
                  {isGenerating ? "Generating..." : "Generate"}
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
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

              <Editor
                value={observations}
                onChange={setObservations}
                placeholder="Generated report will appear here."
                disabled={isGenerating}
                ref={editorRef}
                className="report-editor"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 py-6 dark:border-slate-800">
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
              <button
                className="flex items-center gap-2 rounded-lg bg-primary px-8 py-2.5 font-bold text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary/90"
                onClick={() => setActiveView("dashboard")}
              >
                Finalize Report
                <span className="material-icons-round text-lg">check_circle</span>
              </button>
            </div>
          </div>
        </div>

        <aside className="custom-scrollbar w-full overflow-y-auto border-l border-slate-200 bg-white p-6 lg:w-80 dark:border-slate-800 dark:bg-slate-900">
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
              <button
                className="w-full rounded-lg border border-slate-200 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                onClick={() => setActiveView("recording")}
              >
                Back to Recording
              </button>
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

      <div className="fixed bottom-6 right-6 lg:hidden">
        <button className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-2xl">
          <span className="material-icons-round">auto_awesome</span>
        </button>
      </div>

      {error && <div className="floating-error">{error}</div>}

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
            <Editor
              value={observations}
              onChange={setObservations}
              placeholder="Generated report will appear here."
              disabled={isGenerating}
              ref={fullscreenEditorRef}
              className="report-editor full"
            />
          </div>
        </div>
      )}
    </div>
  );
}
