"use client";

export type TextSegment = {
  text: string;
  bold: boolean;
  underline: boolean;
};

type TextStyle = {
  bold: boolean;
  underline: boolean;
};

const BLOCK_TAGS = new Set(["DIV", "P", "LI", "TR"]);

function mergeStyle(base: TextStyle, overrides: Partial<TextStyle>) {
  return {
    bold: overrides.bold ?? base.bold,
    underline: overrides.underline ?? base.underline
  };
}

function styleFromElement(
  element: HTMLElement,
  current: TextStyle
): TextStyle {
  const tag = element.tagName.toUpperCase();
  let next = { ...current };

  if (tag === "B" || tag === "STRONG") {
    next = mergeStyle(next, { bold: true });
  }
  if (tag === "U") {
    next = mergeStyle(next, { underline: true });
  }

  if (tag === "SPAN") {
    const style = element.getAttribute("style") || "";
    if (/font-weight\s*:\s*(bold|600|700|800|900)/i.test(style)) {
      next = mergeStyle(next, { bold: true });
    }
    if (/text-decoration\s*:\s*underline/i.test(style)) {
      next = mergeStyle(next, { underline: true });
    }
  }

  return next;
}

function walkNodes(
  node: Node,
  style: TextStyle,
  segments: TextSegment[]
) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent || "").replace(/\u00a0/g, " ");
    if (text) {
      segments.push({ text, ...style });
    }
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const element = node as HTMLElement;
  const tag = element.tagName.toUpperCase();

  if (tag === "BR") {
    segments.push({ text: "\n", ...style });
    return;
  }

  const nextStyle = styleFromElement(element, style);
  const isBlock = BLOCK_TAGS.has(tag);
  const isTableCell = tag === "TD" || tag === "TH";

  element.childNodes.forEach((child) => walkNodes(child, nextStyle, segments));

  if (isTableCell) {
    segments.push({ text: "\t", ...style });
  }

  if (isBlock) {
    segments.push({ text: "\n", ...style });
  }
}

export function htmlToLines(html: string) {
  const parser = new DOMParser();
  const document = parser.parseFromString(html || "", "text/html");
  const segments: TextSegment[] = [];

  document.body.childNodes.forEach((node) =>
    walkNodes(node, { bold: false, underline: false }, segments)
  );

  const lines: TextSegment[][] = [[]];
  segments.forEach((segment) => {
    const parts = segment.text.split(/\n/);
    parts.forEach((part, index) => {
      if (part) {
        lines[lines.length - 1].push({
          text: part,
          bold: segment.bold,
          underline: segment.underline
        });
      }
      if (index < parts.length - 1) {
        lines.push([]);
      }
    });
  });

  while (lines.length > 1 && lines[lines.length - 1].length === 0) {
    lines.pop();
  }

  return lines;
}
