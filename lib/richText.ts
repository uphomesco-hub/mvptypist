"use client";

export type TextSegment = {
  text: string;
  bold: boolean;
  underline: boolean;
  alignment: TextAlignment;
};

export type TextAlignment = "left" | "center" | "right";

export type TextLine = {
  segments: TextSegment[];
  alignment: TextAlignment;
};

type TextStyle = {
  bold: boolean;
  underline: boolean;
  alignment: TextAlignment;
};

const BLOCK_TAGS = new Set(["DIV", "P", "LI", "TR"]);

function mergeStyle(base: TextStyle, overrides: Partial<TextStyle>) {
  return {
    bold: overrides.bold ?? base.bold,
    underline: overrides.underline ?? base.underline,
    alignment: overrides.alignment ?? base.alignment
  };
}

function getAlignmentFromElement(element: HTMLElement): TextAlignment | null {
  const inlineStyle = element.getAttribute("style") || "";
  const alignAttr = (element.getAttribute("align") || "").trim().toLowerCase();

  if (/text-align\s*:\s*center/i.test(inlineStyle) || alignAttr === "center") {
    return "center";
  }
  if (/text-align\s*:\s*right/i.test(inlineStyle) || alignAttr === "right") {
    return "right";
  }
  if (/text-align\s*:\s*left/i.test(inlineStyle) || alignAttr === "left") {
    return "left";
  }

  return null;
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

  const alignment = getAlignmentFromElement(element);
  if (alignment) {
    next = mergeStyle(next, { alignment });
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
    walkNodes(node, { bold: false, underline: false, alignment: "left" }, segments)
  );

  const lines: TextLine[] = [{ segments: [], alignment: "left" }];
  segments.forEach((segment) => {
    const parts = segment.text.split(/\n/);
    parts.forEach((part, index) => {
      if (part) {
        const currentLine = lines[lines.length - 1];
        if (!currentLine.segments.length) {
          currentLine.alignment = segment.alignment;
        }
        currentLine.segments.push({
          text: part,
          bold: segment.bold,
          underline: segment.underline,
          alignment: segment.alignment
        });
      }
      if (index < parts.length - 1) {
        lines.push({ segments: [], alignment: segment.alignment });
      }
    });
  });

  while (lines.length > 1 && lines[lines.length - 1].segments.length === 0) {
    lines.pop();
  }

  return lines;
}
