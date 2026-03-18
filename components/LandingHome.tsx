"use client";

import Image from "next/image";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode
} from "react";

type AuthMode = "signin" | "signup";

type LandingHomeProps = {
  authMode: AuthMode;
  authName: string;
  authEmail: string;
  authPhone: string;
  authPassword: string;
  brandName: string;
  errorToast?: ReactNode;
  isAuthLoading: boolean;
  onAuthEmailChange: (value: string) => void;
  onAuthPhoneChange: (value: string) => void;
  onAuthNameChange: (value: string) => void;
  onAuthPasswordChange: (value: string) => void;
  onAuthSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSetAuthMode: (mode: AuthMode) => void;
};

const navItems = [
  { label: "How it works", href: "#workflow", icon: "spark" as const },
  { label: "Features", href: "#features", icon: "grid" as const },
  { label: "Pricing", href: "#pricing", icon: "coin" as const }
];

const partnerBadges = [
  {
    title: "Ultrasound-ready study templates",
    icon: "templates" as const
  },
  {
    title: "Custom doctor and clinic profiles",
    icon: "profiles" as const
  },
  {
    title: "Saved recordings with case recall",
    icon: "recordings" as const
  },
  {
    title: "Built cleanly for desktop and mobile",
    icon: "devices" as const
  }
];

const workflowSteps = [
  {
    step: "01",
    title: "Open the dashboard and pick the right case flow",
    body: "Start from the worklist, choose the right study template, and keep every active report inside one clean reporting workspace.",
    bullets: [
      "Active worklist for ongoing studies",
      "Template-aware case selection",
      "Draft and follow-up reports stay visible"
    ],
    preview: "dashboard" as const
  },
  {
    step: "02",
    title: "Record findings while the checklist keeps the study structured",
    body: "Dictate once while the recording panel keeps organ-wise findings organized, so nothing important is missed during reporting.",
    bullets: [
      "Live recording with progress state",
      "Checklist-style organ tracking",
      "Clear structure for abdomen and routine studies"
    ],
    preview: "recording" as const
  },
  {
    step: "03",
    title: "Review the generated draft and deliver the final report",
    body: "Generated findings, impression text, and export actions stay in the same editor so the report is ready to review and send faster.",
    bullets: [
      "Structured findings and impression block",
      "Review before final sign-off",
      "PDF and DOCX export from the editor"
    ],
    preview: "report" as const
  }
];

const featureSections = [
  {
    eyebrow: "Why it feels faster",
    title: "Templates remove repetitive formatting before the first word is dictated",
    body: "raddie.ai is designed around structured radiology reporting, so doctors are not rebuilding the same layout, headings, and impression flow on every case.",
    bullets: [
      "Fast template selection for recurring ultrasound and routine studies",
      "Custom profile setup for practice-specific formats and preferences",
      "Structured findings that are easier to review, edit, and finalize"
    ]
  },
  {
    eyebrow: "Why work keeps moving",
    title: "Saved worklists and recordings keep unfinished reports moving",
    body: "Draft, pending, and completed studies stay in one system, so doctors and reviewers can reopen work later without losing the recording, edits, or case state.",
    bullets: [
      "Draft, pending, and completed worklist states in one place",
      "Recording recall for reopened reports and interrupted sessions",
      "Issue review support when edited reports need another pass"
    ]
  }
];

const valueCards = [
  {
    icon: "repeat" as const,
    title: "Less manual repetition",
    body: "Templates, saved profiles, and structured sections cut down the repeated formatting work that slows down routine reporting."
  },
  {
    icon: "visibility" as const,
    title: "Better review visibility",
    body: "Drafts, pending sign-off, edited reports, and final exports stay visible inside one workflow instead of being scattered across tools."
  },
  {
    icon: "delivery" as const,
    title: "Faster final delivery",
    body: "Once the report is approved, the final PDF or DOCX is ready immediately from the same editor without extra handoff steps."
  }
];

const pricingPlans = [
  {
    name: "Starter access",
    price: "Free",
    note: "For individual doctors who want to try the reporting workflow end to end.",
    features: [
      "Template selection and dictation flow",
      "Editable structured report output",
      "PDF and DOCX export",
      "Saved worklist and recordings"
    ],
    cta: "Try for free",
    mode: "signup" as const,
    featured: false
  },
  {
    name: "Team rollout",
    price: "Custom",
    note: "For clinics and reporting teams that want a branded reporting workflow at production quality.",
    features: [
      "Multi-doctor onboarding",
      "Custom template profile setup",
      "Admin review workflow",
      "Branded reporting experience"
    ],
    cta: "Get started",
    mode: "signup" as const,
    featured: true
  }
];

type HeroAnimationStyle = CSSProperties & {
  "--delay"?: string;
  "--drift"?: string;
  "--line-width"?: string;
  "--reduce-x"?: string;
  "--reduce-y"?: string;
  "--reduce-scale"?: string;
};

const heroWaveBars = [18, 30, 22, 38, 26, 42, 28, 36, 22];

const heroFlowTokens = [
  {
    text: "normal liver",
    top: "18%",
    delay: "0.15s",
    drift: "-12px",
    reduceX: "18%",
    reduceY: "-4px",
    reduceScale: "0.95"
  },
  {
    text: "no lesion",
    top: "44%",
    delay: "1.25s",
    drift: "8px",
    reduceX: "42%",
    reduceY: "6px",
    reduceScale: "0.95"
  },
  {
    text: "kidneys normal",
    top: "68%",
    delay: "2.35s",
    drift: "-10px",
    reduceX: "66%",
    reduceY: "-3px",
    reduceScale: "0.88"
  }
] as const;

const heroReportLines = [
  { text: "Liver: Normal echotexture.", width: "100%" },
  { text: "Gall bladder: No calculus.", width: "100%" },
  { text: "Pancreas: Unremarkable.", width: "100%" },
  { text: "Spleen: Normal size.", width: "100%" },
  { text: "Kidneys: No hydronephrosis.", width: "100%" },
  { text: "Impression: No acute finding.", width: "100%" }
] as const;

function HeroPipelineIllustration() {
  return (
    <div className="relative mx-auto w-full max-w-[760px]">
      <div className="hero-pipeline-shell">
        <div className="hero-pipeline-glow hero-pipeline-glow-primary" />
        <div className="hero-pipeline-glow hero-pipeline-glow-secondary" />

        <div className="hero-pipeline-scene">
          <div className="hero-pipeline-stream" aria-hidden="true">
            <div className="hero-pipeline-wave-ribbon">
              {heroWaveBars.map((height, index) => (
                <span
                  key={`${height}-${index}`}
                  style={
                    {
                      height,
                      animationDelay: `${index * 0.11}s`
                    } as CSSProperties
                  }
                />
              ))}
            </div>

            {heroFlowTokens.map((token) => (
              <span
                key={token.text}
                className="hero-pipeline-token"
                style={
                  {
                    top: token.top,
                    "--delay": token.delay,
                    "--drift": token.drift,
                    "--reduce-x": token.reduceX,
                    "--reduce-y": token.reduceY,
                    "--reduce-scale": token.reduceScale
                  } as HeroAnimationStyle
                }
              >
                {token.text}
              </span>
            ))}
          </div>

          <div className="hero-pipeline-filter" aria-hidden="true">
            <span />
            <span />
          </div>

          <div className="hero-pipeline-report">
            <div className="hero-pipeline-report-sheet">
              <div className="hero-pipeline-report-content">
                {heroReportLines.map((line, index) => (
                  <div key={line.text} className="hero-pipeline-report-row">
                    <span className="hero-pipeline-report-ghost">{line.text}</span>
                    <span
                      className={`hero-pipeline-report-type hero-pipeline-report-type-${index + 1}`}
                      style={{ "--line-width": line.width } as HeroAnimationStyle}
                    >
                      {line.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkflowDashboardPreview() {
  return (
    <div className="workflow-preview-shell workflow-preview-dashboard h-[14.5rem] overflow-hidden rounded-[1.75rem] bg-[#f4f7fb] p-4">
      <div className="workflow-preview-card flex h-full flex-col overflow-hidden rounded-[1.45rem] border border-white bg-white p-4 shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
            Dashboard
          </p>
          <span className="workflow-dashboard-chip rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
            3 active
          </span>
        </div>

        <div className="mt-4 space-y-2.5">
          {[
            ["USG Whole Abdomen", "Ready to dictate"],
            ["KUB Follow-up", "Draft open"],
            ["Pelvis Study", "Pending review"]
          ].map(([title, state], index) => (
            <div
              key={title}
              style={{ animationDelay: `${index * 0.16}s` }}
              className={`workflow-dashboard-row workflow-dashboard-row-select-${index + 1} rounded-[1.15rem] border px-4 py-2.5 ${
                index === 0 ? "workflow-dashboard-row-active" : ""
              }`}
            >
              <p className="text-sm font-semibold text-slate-950">{title}</p>
              <p className="mt-1 text-xs text-slate-500">{state}</p>
            </div>
          ))}
        </div>

        <div className="mt-auto grid gap-3 sm:grid-cols-2">
          <div className="workflow-dashboard-panel rounded-[1.15rem] bg-slate-950 px-4 py-3.5 text-white">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Template</p>
            <p className="mt-2 text-sm font-semibold">Abdomen profile loaded</p>
          </div>
          <div className="workflow-dashboard-panel workflow-dashboard-panel-delay rounded-[1.15rem] border border-slate-200 bg-white px-4 py-3.5">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Session</p>
            <p className="mt-2 text-sm font-semibold text-slate-950">Recording ready</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkflowRecordingPreview() {
  return (
    <div className="workflow-preview-shell workflow-preview-recording h-[14.5rem] overflow-hidden rounded-[1.75rem] bg-[#f4f7fb] p-4">
      <div className="workflow-preview-card flex h-full flex-col overflow-hidden rounded-[1.45rem] border border-white bg-white p-4 shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
        <div className="flex flex-col items-center">
          <div className="workflow-recording-orb flex h-14 w-14 items-center justify-center rounded-full bg-primary text-2xl text-white shadow-lg shadow-primary/25">
            •
          </div>
          <p className="workflow-recording-clock mt-3 text-base font-semibold text-slate-950">
            Recording... 02:34
          </p>
          <div className="workflow-recording-wave mt-3 flex h-10 items-end gap-1.5">
            {[12, 22, 16, 26, 18, 30, 20, 28, 16, 24].map((height, index) => (
              <span
                key={`${height}-${index}`}
                className="workflow-recording-wave-bar w-2.5 rounded-full bg-gradient-to-t from-primary to-sky-300"
                style={{
                  height,
                  animationDelay: `${index * 0.08}s`
                }}
              />
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">High quality dictation detected</p>
        </div>

        <div className="mt-4 rounded-[1.15rem] bg-slate-50 p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
            Findings checklist
          </p>
          <div className="mt-3 space-y-2">
            {[
              ["Liver", "Captured"],
              ["Gall bladder", "Captured"],
              ["Kidneys", "In progress"],
              ["Spleen", "Pending"]
            ].map(([organ, state], index) => (
              <div
                key={organ}
                style={{ animationDelay: `${index * 0.14}s` }}
                className="workflow-recording-check-row flex items-center justify-between rounded-2xl bg-white px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`workflow-recording-check-dot h-2.5 w-2.5 rounded-full ${
                      index < 2 ? "bg-emerald-500" : index === 2 ? "bg-primary" : "bg-slate-300"
                    }`}
                  />
                  <span className="text-sm font-medium text-slate-800">{organ}</span>
                </div>
                <span className="text-xs font-semibold text-slate-500">{state}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkflowReportPreview() {
  return (
    <div className="workflow-preview-shell workflow-preview-report h-[14.5rem] overflow-hidden rounded-[1.75rem] bg-[#f4f7fb] p-4">
      <div className="workflow-preview-card flex h-full flex-col overflow-hidden rounded-[1.45rem] border border-white bg-white p-4 shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
        <div className="flex gap-2 rounded-[1.2rem] bg-slate-100 p-1">
          {["Findings", "Impression", "Export"].map((tab, index) => (
            <span
              key={tab}
              className={`workflow-report-tab workflow-report-tab-${index + 1} rounded-[0.95rem] px-3 py-2 text-xs font-semibold`}
            >
              {tab}
            </span>
          ))}
        </div>

        <div className="workflow-report-editor mt-4 flex-1 rounded-[1.25rem] border border-slate-200 bg-white px-4 py-4">
          <div className="workflow-report-panel workflow-report-panel-1 space-y-2.5 text-sm leading-6 text-slate-700">
            <p className="workflow-report-line">
              <span className="font-semibold text-slate-950">Liver:</span> Normal in size and
              echotexture.
            </p>
            <p className="workflow-report-line">
              <span className="font-semibold text-slate-950">Gall bladder:</span> No calculus or
              sludge identified.
            </p>
            <p className="workflow-report-line">
              <span className="font-semibold text-slate-950">Kidneys:</span> No hydronephrosis.
            </p>
          </div>

          <div className="workflow-report-panel workflow-report-panel-2 space-y-3 text-sm leading-6 text-slate-700">
            <p className="workflow-report-summary-label text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
              Impression
            </p>
            <p className="rounded-[1rem] bg-slate-100 px-4 py-3 font-medium text-slate-950">
              No significant abnormality detected on this examination.
            </p>
            <p className="text-sm text-slate-500">Ready for final doctor review.</p>
          </div>

          <div className="workflow-report-panel workflow-report-panel-3 space-y-3 text-sm leading-6 text-slate-700">
            <p className="workflow-report-summary-label text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
              Export ready
            </p>
            <div className="flex items-center justify-between rounded-[1rem] bg-slate-100 px-4 py-3">
              <span className="font-medium text-slate-950">PDF report</span>
              <span className="text-xs font-semibold text-primary">Ready</span>
            </div>
            <div className="flex items-center justify-between rounded-[1rem] bg-slate-100 px-4 py-3">
              <span className="font-medium text-slate-950">DOCX copy</span>
              <span className="text-xs font-semibold text-primary">Ready</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkflowPreview({ preview }: { preview: (typeof workflowSteps)[number]["preview"] }) {
  if (preview === "dashboard") return <WorkflowDashboardPreview />;
  if (preview === "recording") return <WorkflowRecordingPreview />;
  return <WorkflowReportPreview />;
}

function BrandMark({
  className,
  sizes
}: {
  className: string;
  sizes: string;
}) {
  return (
    <div className={`relative overflow-hidden bg-white ${className}`}>
      <Image
        src="/raddie.png"
        alt="raddie.ai logo"
        fill
        sizes={sizes}
        className="object-cover"
      />
    </div>
  );
}

function RolloutIcon({ icon }: { icon: (typeof partnerBadges)[number]["icon"] }) {
  const common = "h-5 w-5 stroke-[1.8]";

  if (icon === "templates") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={common}>
        <rect x="4" y="5" width="16" height="14" rx="3" className="stroke-current" />
        <path d="M8 9h8M8 13h5" className="stroke-current" strokeLinecap="round" />
      </svg>
    );
  }

  if (icon === "profiles") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={common}>
        <circle cx="12" cy="9" r="3.25" className="stroke-current" />
        <path d="M6.5 18c1.2-2.5 3.13-3.75 5.5-3.75S16.3 15.5 17.5 18" className="stroke-current" strokeLinecap="round" />
      </svg>
    );
  }

  if (icon === "recordings") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={common}>
        <rect x="9" y="5" width="6" height="10" rx="3" className="stroke-current" />
        <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v2.5M8.5 19.5h7" className="stroke-current" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" className={common}>
      <rect x="4" y="6" width="10" height="8" rx="1.8" className="stroke-current" />
      <path d="M8 18h2" className="stroke-current" strokeLinecap="round" />
      <rect x="16" y="8" width="4" height="8" rx="1.5" className="stroke-current" />
    </svg>
  );
}

function ValueCardIcon({ icon }: { icon: (typeof valueCards)[number]["icon"] }) {
  const common = "h-5 w-5 stroke-[1.8]";

  if (icon === "repeat") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={common}>
        <path d="M7 8h9a3 3 0 0 1 3 3v1M17 5l3 3-3 3" className="stroke-current" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M17 16H8a3 3 0 0 1-3-3v-1M7 19l-3-3 3-3" className="stroke-current" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (icon === "visibility") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={common}>
        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" className="stroke-current" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="2.5" className="stroke-current" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" className={common}>
      <path d="M5 12.5 9 16.5 19 6.5" className="stroke-current" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 12v6a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h8" className="stroke-current" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ActionIcon({
  icon,
  className = "h-4 w-4 stroke-[1.9]"
}: {
  icon: "spark" | "grid" | "coin" | "login" | "play" | "pricing";
  className?: string;
}) {
  if (icon === "spark") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" className="stroke-current" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (icon === "grid") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" className="stroke-current" />
        <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" className="stroke-current" />
        <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" className="stroke-current" />
        <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" className="stroke-current" />
      </svg>
    );
  }

  if (icon === "coin") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <circle cx="12" cy="12" r="7.5" className="stroke-current" />
        <path d="M14.7 9.4c-.5-.75-1.5-1.2-2.7-1.2-1.5 0-2.6.73-2.6 1.9 0 1.1.92 1.54 2.53 1.9 1.73.4 3.07.88 3.07 2.42 0 1.33-1.2 2.18-2.95 2.18-1.35 0-2.52-.49-3.18-1.42M12 7v10" className="stroke-current" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (icon === "login") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path d="M10 7H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h3" className="stroke-current" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 8l4 4-4 4M17 12H9" className="stroke-current" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (icon === "pricing") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path d="M5 7.5h14M5 12h10M5 16.5h8" className="stroke-current" strokeLinecap="round" />
        <circle cx="18" cy="16.5" r="2" className="stroke-current" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M8 6.5v11l9-5.5-9-5.5Z" className="stroke-current" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function LandingHome({
  authMode,
  authEmail,
  authName,
  authPhone,
  authPassword,
  brandName,
  errorToast,
  isAuthLoading,
  onAuthEmailChange,
  onAuthPhoneChange,
  onAuthNameChange,
  onAuthPasswordChange,
  onAuthSubmit,
  onSetAuthMode
}: LandingHomeProps) {
  const [isAuthSheetOpen, setIsAuthSheetOpen] = useState(false);
  const [showFloatingMobileCta, setShowFloatingMobileCta] = useState(false);
  const heroSectionRef = useRef<HTMLElement | null>(null);

  const updateHeroBlobPosition = (clientX: number, clientY: number, opacity: string) => {
    const heroElement = heroSectionRef.current;
    if (!heroElement) return;

    const bounds = heroElement.getBoundingClientRect();
    const x = ((clientX - bounds.left) / bounds.width) * 100;
    const y = ((clientY - bounds.top) / bounds.height) * 100;

    heroElement.style.setProperty("--hero-blob-x", `${Math.max(6, Math.min(94, x))}%`);
    heroElement.style.setProperty("--hero-blob-y", `${Math.max(10, Math.min(90, y))}%`);
    heroElement.style.setProperty("--hero-blob-opacity", opacity);
  };

  useEffect(() => {
    if (!isAuthSheetOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsAuthSheetOpen(false);
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isAuthSheetOpen]);

  useEffect(() => {
    const heroElement = heroSectionRef.current;
    if (!heroElement || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setShowFloatingMobileCta(!entry.isIntersecting);
      },
      {
        threshold: 0.05,
        rootMargin: "0px 0px -10% 0px"
      }
    );

    observer.observe(heroElement);
    return () => observer.disconnect();
  }, []);

  const openAuthSheet = (mode: AuthMode) => {
    onSetAuthMode(mode);
    setIsAuthSheetOpen(true);
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[linear-gradient(180deg,#f7faff_0%,#edf4ff_28%,#ffffff_100%)] text-slate-900">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-8rem] top-[-6rem] h-72 w-72 rounded-full bg-primary/15 blur-3xl" />
        <div className="absolute right-[-9rem] top-28 h-96 w-96 rounded-full bg-sky-200/50 blur-3xl" />
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(15, 23, 42, 0.08) 1px, transparent 0)",
            backgroundSize: "24px 24px"
          }}
        />
      </div>

      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <a href="#top" className="flex items-center gap-3 text-slate-950 no-underline">
            <BrandMark
              className="h-11 w-11 rounded-2xl shadow-lg shadow-slate-900/10"
              sizes="44px"
            />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
                Radiology workspace
              </p>
              <p className="font-display text-xl font-bold tracking-tight">{brandName}</p>
            </div>
          </a>

          <div className="flex items-center gap-3 lg:gap-5">
            <nav className="hidden items-center gap-5 text-sm font-medium text-slate-600 lg:flex">
              {navItems.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="inline-flex items-center gap-2 transition hover:text-slate-950"
                >
                  <ActionIcon icon={item.icon} className="h-4 w-4 stroke-[1.8]" />
                  {item.label}
                </a>
              ))}
            </nav>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-primary hover:text-primary"
              onClick={() => openAuthSheet("signin")}
            >
              <ActionIcon icon="login" />
              Login
            </button>
            <button
              type="button"
              className="hidden items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90 sm:inline-flex"
              onClick={() => openAuthSheet("signup")}
            >
              <ActionIcon icon="play" />
              Try for free
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="relative z-10">
        <section
          ref={heroSectionRef}
          className="hero-section-shell mx-auto max-w-7xl px-4 pb-14 pt-6 sm:px-6 sm:pt-10 lg:px-8 lg:pb-24 lg:pt-16"
          onPointerEnter={(event) => updateHeroBlobPosition(event.clientX, event.clientY, "0.82")}
          onPointerMove={(event) => updateHeroBlobPosition(event.clientX, event.clientY, "0.82")}
          onPointerLeave={() => {
            heroSectionRef.current?.style.setProperty("--hero-blob-opacity", "0");
          }}
        >
          <div className="hero-section-cursor-blob" aria-hidden="true" />
          <div className="mb-4 flex lg:hidden">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-primary shadow-sm backdrop-blur">
              <span className="h-2 w-2 rounded-full bg-primary" />
              Structured radiology reporting from dictation to delivery
            </div>
          </div>

          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] lg:items-center lg:gap-12">
            <div className="order-2 max-w-3xl lg:order-1">
              <div className="hidden items-center gap-2 rounded-full border border-primary/15 bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-primary shadow-sm backdrop-blur lg:inline-flex">
                <span className="h-2 w-2 rounded-full bg-primary" />
                Structured radiology reporting from dictation to delivery
              </div>

              <h1 className="mt-6 font-display text-5xl font-bold leading-[0.96] tracking-[-0.05em] text-slate-950 sm:text-6xl xl:text-7xl">
                Dictate once. Deliver polished radiology reports faster.
              </h1>

              <p className="mt-6 max-w-2xl text-base leading-8 text-slate-600 sm:text-lg">
                {brandName} brings structured templates, saved audio, worklist states, and export
                actions into one radiology workspace so doctors spend less time formatting and
                more time reviewing, signing off, and sending reports.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 text-sm font-semibold text-white shadow-xl shadow-primary/20 transition hover:bg-primary/90"
                  onClick={() => openAuthSheet("signup")}
                >
                  <ActionIcon icon="play" />
                  Try for free
                </button>
                <a
                  href="#pricing"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-6 py-3.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                >
                  <ActionIcon icon="pricing" />
                  See pricing
                </a>
              </div>
            </div>

            <div className="order-1 lg:order-2">
              <HeroPipelineIllustration />
            </div>
          </div>
        </section>

        <section className="border-y border-slate-200/80 bg-white/80">
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-primary">
                  Built for rollout
                </p>
                <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
                  A cleaner reporting workflow for individual doctors and growing clinic teams
                </h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[48rem] lg:grid-cols-4">
                {partnerBadges.map((item) => (
                  <div
                    key={item.title}
                    className="flex min-h-[8.5rem] flex-col items-center rounded-2xl border border-slate-200 bg-white px-6 py-4 text-center shadow-sm"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/8 text-primary">
                      <RolloutIcon icon={item.icon} />
                    </div>
                    <div className="mt-3 flex min-h-[2.5rem] items-start">
                      <p
                        className="mx-auto max-w-[11rem] text-sm font-medium leading-5 text-slate-600"
                        style={{
                          display: "-webkit-box",
                          WebkitBoxOrient: "vertical",
                          WebkitLineClamp: 2,
                          overflow: "hidden"
                        }}
                      >
                        {item.title}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="workflow" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-primary">
              How it works
            </p>
            <h2 className="mt-3 text-4xl font-bold tracking-tight text-slate-950">
              Why reporting feels faster inside raddie.ai
            </h2>
            <p className="mt-4 text-base leading-8 text-slate-600">
              The speed comes from removing avoidable friction: less manual formatting, fewer
              tool switches, easier case recovery, and a shorter path from spoken findings to
              final exported report.
            </p>
          </div>

          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {workflowSteps.map((step) => (
              <article
                key={step.step}
                className="flex h-full min-h-[41rem] flex-col overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_26px_60px_rgba(15,23,42,0.08)]"
              >
                <div className="shrink-0 p-4 pb-0">
                  <WorkflowPreview preview={step.preview} />
                </div>

                <div className="flex flex-1 flex-col px-5 pb-5 pt-5">
                  <p className="text-sm font-semibold uppercase tracking-[0.22em] text-primary">
                    {step.step}
                  </p>
                  <h3 className="mt-3 min-h-[4rem] text-[1.6rem] font-bold leading-tight tracking-tight text-slate-950">
                    {step.title}
                  </h3>
                  <p className="mt-3 text-[15px] leading-7 text-slate-600">{step.body}</p>
                  <div className="mt-5 space-y-2.5">
                    {step.bullets.map((bullet) => (
                      <div key={bullet} className="flex items-start gap-3 text-sm text-slate-600">
                        <span className="mt-1 h-2.5 w-2.5 rounded-full bg-primary" />
                        <span>{bullet}</span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-auto pt-6">
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 self-start rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90"
                      onClick={() => openAuthSheet("signup")}
                    >
                      <ActionIcon icon="play" />
                      Try for free
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="features" className="mx-auto max-w-7xl px-4 pb-8 sm:px-6 lg:px-8 lg:pb-14">
          <div className="grid gap-5 lg:grid-cols-2">
            {featureSections.map((section) => (
              <article
                key={section.title}
                className="flex h-full min-h-[26rem] flex-col rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm shadow-slate-200/40"
              >
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-primary">
                  {section.eyebrow}
                </p>
                <h3 className="mt-4 min-h-[6.5rem] text-3xl font-bold tracking-tight text-slate-950">
                  {section.title}
                </h3>
                <p className="mt-4 text-base leading-8 text-slate-600">{section.body}</p>
                <div className="mt-6 space-y-3">
                  {section.bullets.map((bullet) => (
                    <div
                      key={bullet}
                      className="flex items-start gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600"
                    >
                      <span className="mt-1 h-2.5 w-2.5 rounded-full bg-primary" />
                      <span>{bullet}</span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-18">
          <div className="rounded-[2.25rem] bg-slate-950 px-6 py-8 text-white shadow-[0_28px_80px_rgba(15,23,42,0.22)] sm:px-8 lg:px-10 lg:py-10">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-blue-200">
                  Why teams choose it
                </p>
                <h2 className="mt-3 text-4xl font-bold tracking-tight">
                  Built to help radiology teams finish more reports with less operational drag
                </h2>
              </div>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-100"
                onClick={() => openAuthSheet("signup")}
              >
                Try for free
              </button>
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-3">
              {valueCards.map((item) => (
                <div
                  key={item.title}
                  className="flex h-full min-h-[14.5rem] flex-col rounded-[1.75rem] border border-white/10 bg-white/5 p-5"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-blue-200">
                    <ValueCardIcon icon={item.icon} />
                  </div>
                  <h3 className="mt-4 min-h-[3.5rem] text-xl font-bold tracking-tight text-white">
                    {item.title}
                  </h3>
                  <p className="mt-3 text-base leading-8 text-slate-200">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="mx-auto max-w-7xl px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-28">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-primary">
              Pricing
            </p>
            <h2 className="mt-3 text-4xl font-bold tracking-tight text-slate-950">
              Start quickly, then scale the workflow across your team
            </h2>
            <p className="mt-4 text-base leading-8 text-slate-600">
              Start with individual access, then expand into a branded clinic workflow with
              custom templates, review controls, and a more polished reporting experience for the
              whole team.
            </p>
          </div>

          <div className="mt-10 grid gap-5 lg:grid-cols-2">
            {pricingPlans.map((plan) => (
              <article
                key={plan.name}
                className={`flex h-full min-h-[27rem] flex-col rounded-[2rem] border p-6 shadow-sm shadow-slate-200/40 ${
                  plan.featured
                    ? "border-primary/25 bg-primary/5"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.22em] text-primary">
                      {plan.name}
                    </p>
                    <h3 className="mt-3 text-4xl font-bold tracking-tight text-slate-950">
                      {plan.price}
                    </h3>
                    <p className="mt-3 min-h-[3.5rem] text-sm leading-7 text-slate-600">
                      {plan.note}
                    </p>
                  </div>
                  {plan.featured && (
                    <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white">
                      Recommended
                    </span>
                  )}
                </div>

                <div className="mt-6 flex-1 space-y-3">
                  {plan.features.map((feature) => (
                    <div key={feature} className="flex items-start gap-3 text-sm text-slate-600">
                      <span className="mt-1 h-2.5 w-2.5 rounded-full bg-primary" />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  className={`mt-8 inline-flex w-full items-center justify-center rounded-2xl px-5 py-3.5 text-sm font-semibold transition ${
                    plan.featured
                      ? "bg-primary text-white shadow-xl shadow-primary/20 hover:bg-primary/90"
                      : "border border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
                  }`}
                  onClick={() => openAuthSheet(plan.mode)}
                >
                  {plan.cta}
                </button>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white/90">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 text-sm text-slate-500 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center gap-3 text-slate-950">
            <BrandMark className="h-10 w-10 rounded-2xl shadow-sm shadow-slate-900/10" sizes="40px" />
            <span className="font-semibold">{brandName}</span>
          </div>
          <p>Voice-first radiology drafting, review, and export from a single workspace.</p>
        </div>
      </footer>

      {showFloatingMobileCta && (
        <button
          type="button"
          className="fixed left-4 right-4 z-30 inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3.5 text-sm font-semibold text-white shadow-2xl shadow-primary/30 transition hover:bg-primary/90 sm:hidden"
          style={{ bottom: "max(1rem, env(safe-area-inset-bottom))" }}
          onClick={() => openAuthSheet("signup")}
        >
          <ActionIcon icon="play" />
          Try for free
        </button>
      )}

      {isAuthSheetOpen && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close auth sheet"
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm"
            onClick={() => setIsAuthSheetOpen(false)}
          />

          <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-5xl rounded-t-[2rem] border border-slate-200 bg-white shadow-[0_-24px_80px_rgba(15,23,42,0.18)] lg:bottom-auto lg:left-1/2 lg:top-1/2 lg:w-[min(92vw,64rem)] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-[2rem]">
            <div className="mx-auto mt-3 h-1.5 w-14 rounded-full bg-slate-200 lg:hidden" />
            <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
              <div className="hidden rounded-l-[2rem] bg-slate-950 p-8 text-white lg:flex lg:flex-col lg:justify-between">
                <div>
                  <BrandMark
                    className="h-14 w-14 rounded-3xl shadow-lg shadow-slate-950/20"
                    sizes="56px"
                  />
                  <p className="mt-5 text-xs font-semibold uppercase tracking-[0.28em] text-blue-200">
                    Radiology workspace
                  </p>
                  <h2 className="mt-3 text-4xl font-bold tracking-tight">{brandName}</h2>
                  <p className="mt-4 max-w-sm text-base leading-8 text-slate-300">
                    Built for radiology teams that want faster report turnaround without giving up
                    structure, review quality, or polished final output.
                  </p>
                </div>

                <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-200">
                    What makes it useful
                  </p>
                  <div className="mt-4 space-y-3">
                    {[
                      "Structured templates shorten the path from dictation to final draft",
                      "Saved recordings and worklists keep unfinished studies moving",
                      "Review and export stay inside the same focused workspace"
                    ].map((item) => (
                      <div key={item} className="flex items-start gap-3">
                        <span className="mt-1 h-2.5 w-2.5 rounded-full bg-sky-300" />
                        <span className="text-sm leading-7 text-slate-300">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="relative p-5 sm:p-6 lg:p-8">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.22em] text-primary">
                      Access workspace
                    </p>
                    <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
                      {authMode === "signup" ? "Create your account" : "Continue to dashboard"}
                    </h2>
                  </div>
                  <button
                    type="button"
                    className="rounded-full border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
                    onClick={() => setIsAuthSheetOpen(false)}
                  >
                    Close
                  </button>
                </div>

                <div className="mb-5 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1.5">
                  <button
                    type="button"
                    className={`rounded-2xl px-4 py-2.5 text-sm font-semibold transition ${
                      authMode === "signin"
                        ? "bg-white text-slate-950 shadow-sm"
                        : "text-slate-500"
                    }`}
                    onClick={() => onSetAuthMode("signin")}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    className={`rounded-2xl px-4 py-2.5 text-sm font-semibold transition ${
                      authMode === "signup"
                        ? "bg-white text-slate-950 shadow-sm"
                        : "text-slate-500"
                    }`}
                    onClick={() => onSetAuthMode("signup")}
                  >
                    Create account
                  </button>
                </div>

                <form className="space-y-4" onSubmit={onAuthSubmit}>
                  {authMode === "signup" && (
                    <>
                      <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Doctor name
                        </label>
                        <input
                          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10"
                          value={authName}
                          onChange={(event) => onAuthNameChange(event.target.value)}
                          placeholder="Dr. Name"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Phone number
                        </label>
                        <input
                          type="tel"
                          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10"
                          value={authPhone}
                          onChange={(event) => onAuthPhoneChange(event.target.value)}
                          placeholder="+91 98765 43210"
                        />
                      </div>
                    </>
                  )}

                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Email
                    </label>
                    <input
                      type="email"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10"
                      value={authEmail}
                      onChange={(event) => onAuthEmailChange(event.target.value)}
                      placeholder="doctor@hospital.com"
                      required
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Password
                    </label>
                    <input
                      type="password"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10"
                      value={authPassword}
                      onChange={(event) => onAuthPasswordChange(event.target.value)}
                      placeholder="••••••••"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isAuthLoading}
                    className="inline-flex w-full items-center justify-center rounded-2xl bg-primary px-5 py-3.5 text-sm font-semibold text-white shadow-xl shadow-primary/20 transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isAuthLoading
                      ? "Please wait..."
                      : authMode === "signup"
                        ? "Create account"
                        : "Sign in"}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {errorToast}
    </div>
  );
}
