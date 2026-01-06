"use client";

import React from "react";

type EditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

export default function Editor({
  value,
  onChange,
  placeholder,
  disabled = false
}: EditorProps) {
  return (
    <textarea
      className="input min-h-[240px] resize-y text-base leading-relaxed"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    />
  );
}
