"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Editor from "@/components/Editor";
import { templates } from "@/lib/templates";
import { exportDocx } from "@/lib/exportDocx";
import { exportPdf } from "@/lib/exportPdf";

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 5 * 60;

function formatBytes(bytes: number) {
  if (!bytes) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
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
    audio.onloadedmetadata = () => {
      resolve(audio.duration || 0);
    };
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

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === templateId),
    [templateId]
  );

  useEffect(() => {
    return () => {
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = isFullscreen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isFullscreen]);

  const resetAudio = () => {
    if (isRecording) {
      stopRecording();
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
    }
    audioUrlRef.current = null;
    setAudioUrl(null);
    setAudioFile(null);
    setAudioDuration(null);
    setElapsedSeconds(0);
    setError(null);
  };

  const applyAudioFile = async (file: File) => {
    if (file.size > MAX_AUDIO_BYTES) {
      setError("Audio exceeds 12MB. Please upload a smaller file.");
      return;
    }

    const url = URL.createObjectURL(file);
    try {
      const duration = await getAudioDuration(url);
      if (duration > MAX_AUDIO_SECONDS) {
        URL.revokeObjectURL(url);
        setError("Audio exceeds 5 minutes. Please shorten the dictation.");
        return;
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
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
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      setElapsedSeconds(0);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm"
        });
        stream.getTracks().forEach((track) => track.stop());
        const file = new File([blob], `dictation-${Date.now()}.webm`, {
          type: blob.type || "audio/webm"
        });
        await applyAudioFile(file);
      };

      recorder.start();
      setIsRecording(true);
      const startTime = Date.now();

      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }

      timerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setElapsedSeconds(elapsed);
        if (elapsed >= MAX_AUDIO_SECONDS) {
          setError("Max recording length is 5 minutes.");
          stopRecording();
        }
      }, 1000);
    } catch (recordError) {
      setError((recordError as Error).message);
    }
  };

  const stopRecording = () => {
    if (!isRecording) return;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
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

    setIsGenerating(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("template_id", templateId);
      formData.append("audio_file", audioFile);

      const response = await fetch("/api/generate", {
        method: "POST",
        body: formData
      });

      const payload = await response.json();

      if (payload?.debug?.rawText) {
        console.info("[Gemini raw]", payload.debug.rawText);
      }
      if (payload?.debug?.blockReplacements?.length) {
        console.info("[Gemini block replacements]", payload.debug.blockReplacements);
      }

      if (!response.ok) {
        throw new Error(payload?.error || "Generation failed.");
      }

      const observationsText = String(payload.observations || "");
      setObservations(observationsText);
      setFlags(Array.isArray(payload.flags) ? payload.flags : []);
      setDisclaimer(String(payload.disclaimer || ""));
      setRawJson(JSON.stringify(payload, null, 2));
    } catch (generateError) {
      setError((generateError as Error).message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(observations);
    } catch {
      setError("Unable to copy. Please copy manually.");
    }
  };

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(rawJson);
    } catch {
      setError("Unable to copy JSON. Please copy manually.");
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-10">
      <header className="flex flex-col gap-3">
        <span className="pill">Findings draft only</span>
        <h1 className="text-4xl font-semibold text-ink-900 md:text-5xl">
          Radiology AI Typist (MVP)
        </h1>
        <p className="max-w-2xl text-sm text-mist-700 md:text-base">
          Record one continuous dictation, generate a findings-only draft, and edit
          the output before sharing with the patient file.
        </p>
      </header>

      <section className="card flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">1) Select Template</h2>
          <p className="text-sm text-mist-600">
            Choose the radiology template to scope the findings.
          </p>
        </div>
        <select
          className="input"
          value={templateId}
          onChange={(event) => setTemplateId(event.target.value)}
        >
          <option value="">Select a template</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.title}
            </option>
          ))}
        </select>
        {selectedTemplate && (
          <div className="rounded-2xl border border-mist-200 bg-mist-50 p-4 text-sm text-mist-700">
            <p className="font-medium text-ink-800">Allowed topics</p>
            <p>{selectedTemplate.allowedTopics.join(", ")}</p>
          </div>
        )}
      </section>

      <section className="card flex flex-col gap-5">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">2) Record or Upload</h2>
          <p className="text-sm text-mist-600">
            Record a single continuous dictation (max 5 minutes / 12MB) or upload
            an audio file.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            className="btn btn-accent"
            onClick={startRecording}
            disabled={isRecording}
          >
            Start recording
          </button>
          <button
            className="btn btn-secondary"
            onClick={stopRecording}
            disabled={!isRecording}
          >
            Stop
          </button>
          <button className="btn btn-secondary" onClick={resetAudio}>
            Reset
          </button>
          <label className="btn btn-secondary cursor-pointer">
            Upload audio
            <input
              type="file"
              accept="audio/wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/webm"
              className="hidden"
              onChange={handleUpload}
            />
          </label>
          <span className="text-xs text-mist-600">
            Recording time: {formatDuration(elapsedSeconds)}
          </span>
        </div>

        {audioUrl && (
          <div className="grid gap-3 md:grid-cols-[2fr,1fr]">
            <div className="rounded-2xl border border-mist-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-mist-500">
                Playback
              </p>
              <audio className="mt-3 w-full" controls src={audioUrl} />
            </div>
            <div className="rounded-2xl border border-mist-200 bg-white p-4 text-sm text-mist-700">
              <p>
                File size: <span className="font-semibold">{formatBytes(audioFile?.size || 0)}</span>
              </p>
              <p>
                Duration: <span className="font-semibold">{formatDuration(audioDuration)}</span>
              </p>
              <p>
                Format: <span className="font-semibold">{audioFile?.type || "audio"}</span>
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="card flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">3) Generate Draft</h2>
          <p className="text-sm text-mist-600">
            Generates findings-only JSON from Gemini.
          </p>
        </div>
        <button
          className="btn btn-primary min-w-[180px]"
          onClick={handleGenerate}
          disabled={!templateId || !audioFile || isGenerating}
        >
          {isGenerating ? "Generating..." : "Generate"}
        </button>
      </section>

      <section className="card flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink-900">
              OBSERVATIONS / FINDINGS (Editable)
            </h2>
            <p className="text-sm text-mist-600">
              Edit the generated findings before saving or exporting.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="pill">Editable</span>
            <button
              className="btn btn-secondary"
              onClick={() => setIsFullscreen(true)}
              disabled={!observations}
            >
              Fullscreen
            </button>
          </div>
        </div>

        <Editor
          value={observations}
          onChange={setObservations}
          placeholder="Generated observations will appear here."
          disabled={isGenerating}
        />

        <div className="flex flex-wrap gap-3">
          <button className="btn btn-secondary" onClick={handleCopy}>
            Copy Full Text
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => exportDocx("radiology-findings.docx", observations)}
            disabled={!observations}
          >
            Download .docx
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => exportPdf("radiology-findings.pdf", observations)}
            disabled={!observations}
          >
            Download PDF
          </button>
          {rawJson && (
            <button className="btn btn-secondary" onClick={handleCopyJson}>
              Copy Full JSON
            </button>
          )}
        </div>

        <div className="rounded-2xl border border-mist-200 bg-mist-50 p-4">
          <p className="text-sm font-semibold text-ink-900">Flags</p>
          {flags.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-mist-700">
              {flags.map((flag) => (
                <li key={flag}>{flag}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-mist-600">No flags yet.</p>
          )}
        </div>

        <p className="text-xs text-mist-600">{disclaimer || "Draft only."}</p>
      </section>

      {isFullscreen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-ink-900/50 p-4 md:p-10">
          <div className="card mx-auto flex max-w-5xl flex-col gap-4 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-ink-900">
                  OBSERVATIONS / FINDINGS (Fullscreen)
                </h2>
                <p className="text-sm text-mist-600">
                  Edit and review the full report comfortably.
                </p>
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => setIsFullscreen(false)}
              >
                Exit fullscreen
              </button>
            </div>

            <Editor
              value={observations}
              onChange={setObservations}
              placeholder="Generated observations will appear here."
              disabled={isGenerating}
            />

            <div className="flex flex-wrap gap-3">
              <button className="btn btn-secondary" onClick={handleCopy}>
                Copy Full Text
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => exportDocx("radiology-findings.docx", observations)}
                disabled={!observations}
              >
                Download .docx
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => exportPdf("radiology-findings.pdf", observations)}
                disabled={!observations}
              >
                Download PDF
              </button>
              {rawJson && (
                <button className="btn btn-secondary" onClick={handleCopyJson}>
                  Copy Full JSON
                </button>
              )}
            </div>

            <div className="rounded-2xl border border-mist-200 bg-mist-50 p-4">
              <p className="text-sm font-semibold text-ink-900">Flags</p>
              {flags.length ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-mist-700">
                  {flags.map((flag) => (
                    <li key={flag}>{flag}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-mist-600">No flags yet.</p>
              )}
            </div>

            <p className="text-xs text-mist-600">{disclaimer || "Draft only."}</p>
          </div>
        </div>
      )}

      {error && (
        <section className="rounded-2xl border border-accent-500/30 bg-white p-4 text-sm text-accent-600">
          {error}
        </section>
      )}

      <footer className="text-center text-xs text-mist-600">
        Data not stored. Draft only.
      </footer>
    </main>
  );
}
