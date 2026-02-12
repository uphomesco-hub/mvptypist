"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Editor from "@/components/Editor";
import { templates } from "@/lib/templates";
import { exportDocx } from "@/lib/exportDocx";
import { exportPdf } from "@/lib/exportPdf";
import {
  USG_ABDOMEN_FEMALE_TEMPLATE,
  USG_ABDOMEN_MALE_TEMPLATE
} from "@/lib/usgTemplate";

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

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordedBytesRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const fullscreenEditorRef = useRef<HTMLDivElement | null>(null);

  const isBackendConfigured = !IS_GITHUB_PAGES || Boolean(API_BASE_URL);
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === templateId),
    [templateId]
  );
  const observationsPlain = useMemo(() => htmlToPlainText(observations), [observations]);
  const hasObservations = Boolean(observationsPlain.trim());

  useEffect(() => {
    return () => {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = isFullscreen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isFullscreen]);

  const resetAudio = () => {
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
      return;
    }
    if (estimateBase64Size(file.size) > MAX_INLINE_AUDIO_BYTES) {
      setError("Audio is too large for inline upload after base64 encoding (100MB limit).");
      return;
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
    } catch (audioError) {
      URL.revokeObjectURL(url);
      setError((audioError as Error).message);
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
          return;
        }
        const file = new File([blob], `dictation-${Date.now()}.webm`, {
          type: blob.type || "audio/webm"
        });
        await applyAudioFile(file);
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

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await applyAudioFile(file);
  };

  const handleGenerate = async () => {
    if (!audioFile || !templateId) return;
    if (!isBackendConfigured) {
      setError("Generation is disabled on this static site. Configure NEXT_PUBLIC_API_BASE_URL.");
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("template_id", templateId);
      formData.append("audio_file", audioFile);

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

  const canGoRecording = Boolean(templateId);
  const canGoReport = Boolean(audioFile);

  return (
    <main className="rad-shell">
      <aside className="rad-sidebar">
        <div className="rad-brand">
          <div className="rad-brand-icon">📊</div>
          <span>RadFlow AI</span>
        </div>
        <nav className="rad-nav">
          <button className={`rad-nav-item ${activeView === "dashboard" ? "active" : ""}`} onClick={() => setActiveView("dashboard")}>
            Dashboard
          </button>
          <button className={`rad-nav-item ${activeView === "recording" ? "active" : ""}`} onClick={() => setActiveView("recording")} disabled={!canGoRecording}>
            Recording
          </button>
          <button className={`rad-nav-item ${activeView === "report" ? "active" : ""}`} onClick={() => setActiveView("report")} disabled={!canGoReport}>
            Report Editor
          </button>
        </nav>
      </aside>

      <section className="rad-main">
        {activeView === "dashboard" && (
          <>
            <header className="rad-header">
              <div className="rad-search">Search Patient ID, Name, or Accession #</div>
              <div className="rad-ready">AI Voice Ready</div>
            </header>

            <section className="rad-hero card">
              <div>
                <h1>Welcome back</h1>
                <p>Select a template to start a new report workflow.</p>
              </div>
              <button className="btn btn-primary" disabled={!canGoRecording} onClick={() => setActiveView("recording")}>
                Start New Report
              </button>
            </section>

            <div className="rad-stats">
              <div className="card"><p>Completed Today</p><h3>24</h3></div>
              <div className="card"><p>Avg. Turnaround</p><h3>18m</h3></div>
              <div className="card"><p>Pending Sign-off</p><h3 className="warn">8</h3></div>
              <div className="card"><p>AI Accuracy</p><h3>98.2%</h3></div>
            </div>

            <section className="card rad-templates">
              <div className="rad-templates-head">
                <h2>Quick Templates</h2>
              </div>
              <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">Select a template</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>{template.title}</option>
                ))}
              </select>
              {selectedTemplate && (
                <div className="rad-allowed">
                  <p>Allowed topics</p>
                  <span>{selectedTemplate.allowedTopics.join(", ")}</span>
                </div>
              )}
            </section>
          </>
        )}

        {activeView === "recording" && (
          <section className="record-shell">
            <div className="record-main">
              <div className="record-top">
                <div className="record-status">{isRecording ? "Recording Live" : "Ready"}</div>
                <h2>Dictating Report Findings</h2>
                <p>AI is processing your speech in real-time...</p>
              </div>

              <div className="record-wave">
                {Array.from({ length: 16 }).map((_, i) => (
                  <div key={i} className="bar" style={{ height: `${36 + ((i * 31) % 130)}px` }} />
                ))}
              </div>

              <div className="record-time">{formatDuration(elapsedSeconds)}</div>

              {audioUrl && (
                <div className="card">
                  <audio controls src={audioUrl} className="w-full" />
                  <p className="meta">{formatBytes(audioFile?.size || 0)} · {formatDuration(audioDuration)} · {audioFile?.type || "audio"}</p>
                </div>
              )}

              <div className="record-controls">
                <button className="btn btn-secondary" onClick={startRecording} disabled={isRecording}>Start</button>
                <button className="btn btn-primary" onClick={stopRecording} disabled={!isRecording}>Stop</button>
                <label className="btn btn-secondary">
                  Upload
                  <input type="file" accept="audio/wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/webm" className="hidden" onChange={handleUpload} />
                </label>
                <button className="btn btn-secondary" onClick={resetAudio}>Reset</button>
                <button className="btn btn-primary" onClick={() => setActiveView("report")} disabled={!canGoReport}>Continue</button>
              </div>
            </div>

            <aside className="record-side card">
              <div className="side-head">
                <h3>Report Template</h3>
                <span>4/7 COMPLETED</span>
              </div>
              <ul>
                <li>✅ Lungs & Pleura</li>
                <li>✅ Cardiac Silhouette</li>
                <li>◻️ Impression</li>
              </ul>
              <p className="tip">Mention “Impression” followed by your conclusion to auto-populate final section.</p>
              <button className="btn btn-secondary" onClick={() => setActiveView("dashboard")}>Back to dashboard</button>
            </aside>
          </section>
        )}

        {activeView === "report" && (
          <>
            <section className="patient-bar card">
              <div><p>Patient</p><h4>Johnathan Doe</h4></div>
              <div><p>ID / DOB</p><h4>#PX-9921 • 12 May 1984</h4></div>
              <div><p>Template</p><h4>{selectedTemplate?.title || "Not selected"}</h4></div>
              <span className="autosave">Auto-saved</span>
            </section>

            <section className="report-grid">
              <div className="card report-editor-card">
                <div className="report-audio-bar">
                  <div>
                    <h3>Add Audio Clarification</h3>
                    <p>Record or upload additional dictation before regeneration.</p>
                  </div>
                  <div className="actions">
                    <button className="btn btn-secondary" onClick={startRecording} disabled={isRecording}>Rec</button>
                    <button className="btn btn-secondary" onClick={stopRecording} disabled={!isRecording}>Stop</button>
                    <label className="btn btn-secondary">Upload<input type="file" accept="audio/wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/webm" className="hidden" onChange={handleUpload} /></label>
                    <button className="btn btn-secondary" onClick={resetAudio}>Reset</button>
                  </div>
                </div>

                <div className="report-toolbar">
                  <div className="left">
                    <button className="tool" onClick={toggleAbnormalFormatting} disabled={!hasObservations}>B/U</button>
                    <button className="tool" onClick={handleCopy}>Copy</button>
                    {rawJson && <button className="tool" onClick={handleCopyJson}>JSON</button>}
                    <button className="tool" onClick={() => exportDocx("radiology-report.docx", observations)} disabled={!hasObservations}>DOCX</button>
                    <button className="tool" onClick={() => exportPdf("radiology-report.pdf", observations)} disabled={!hasObservations}>PDF</button>
                    <button className="tool" onClick={() => setIsFullscreen(true)} disabled={!hasObservations}>Fullscreen</button>
                  </div>
                  <button className="btn btn-primary" onClick={handleGenerate} disabled={!templateId || !audioFile || isGenerating || !isBackendConfigured}>
                    {isGenerating ? "Generating..." : "Generate"}
                  </button>
                </div>

                <Editor
                  value={observations}
                  onChange={setObservations}
                  placeholder="Generated report will appear here."
                  disabled={isGenerating}
                  ref={editorRef}
                  className="report-editor"
                />

                <div className="flags card">
                  <p>Flags</p>
                  {flags.length ? (
                    <ul>{flags.map((flag) => <li key={flag}>{flag}</li>)}</ul>
                  ) : (
                    <span>No flags yet.</span>
                  )}
                </div>

                <div className="report-footer-actions">
                  <button className="btn btn-secondary" onClick={() => setActiveView("recording")}>Back</button>
                  <button className="btn btn-primary" onClick={() => setActiveView("dashboard")}>Finish</button>
                </div>
              </div>

              <aside className="card insights">
                <div className="head"><h3>Smart Insights</h3><span>LIVE</span></div>
                <div className="insight">Dictation quality looks good. Keep findings grouped by organ/region.</div>
                <div className="insight warn">Review generated abnormalities before export/sign-off.</div>
                <div className="insight">Use “Impression” at the end for final summary bullets.</div>
                <p className="disclaimer">{disclaimer || "Draft only. Data not stored."}</p>
              </aside>
            </section>
          </>
        )}

        {error && <section className="error-box">{error}</section>}

        {isFullscreen && (
          <div className="fullscreen-wrap">
            <div className="fullscreen-card card">
              <div className="fullscreen-head">
                <h3>REPORT (Fullscreen)</h3>
                <button className="btn btn-secondary" onClick={() => setIsFullscreen(false)}>Exit</button>
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
      </section>
    </main>
  );
}
