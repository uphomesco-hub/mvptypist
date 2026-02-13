"use client";

import React, { useEffect, useRef } from "react";

type EditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

function htmlToText(html: string) {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/div>\s*<div>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function assignRef<T>(
  ref: React.ForwardedRef<T>,
  value: T | null
) {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
}

const Editor = React.forwardRef<HTMLDivElement, EditorProps>(function Editor(
  { value, onChange, placeholder, disabled = false, className },
  ref
) {
  const innerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!innerRef.current) return;
    if (innerRef.current.innerHTML !== value) {
      innerRef.current.innerHTML = value;
    }
  }, [value]);

  const isEmpty = !htmlToText(value);

  const handleInput = () => {
    if (!innerRef.current) return;
    onChange(innerRef.current.innerHTML);
  };

  return (
    <div className="relative">
      {placeholder && isEmpty && (
        <div className="pointer-events-none absolute left-4 top-3 text-sm text-mist-500">
          {placeholder}
        </div>
      )}
      <div
        ref={(node) => {
          innerRef.current = node;
          assignRef(ref, node);
        }}
        className={`w-full min-h-[240px] resize-y whitespace-pre-wrap border border-slate-200 bg-white px-6 py-5 text-base leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/20 ${
          disabled ? "cursor-not-allowed opacity-60" : ""
        } ${className || ""}`}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-disabled={disabled}
        onInput={handleInput}
        onBlur={handleInput}
      />
    </div>
  );
});

export default Editor;
