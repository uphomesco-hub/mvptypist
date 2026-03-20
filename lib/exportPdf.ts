"use client";

import { jsPDF } from "jspdf";
import { htmlToLines, type TextAlignment, type TextSegment } from "@/lib/richText";

type Token = {
  text: string;
  bold: boolean;
  underline: boolean;
  isWhitespace: boolean;
};

const BASE_FONT = "helvetica";
const LINE_HEIGHT = 18;
const UNDERLINE_OFFSET = 2;

function segmentToTokens(segment: TextSegment) {
  return segment.text
    .split(/(\s+)/)
    .filter((part) => part.length > 0)
    .map((part) => ({
      text: part,
      bold: segment.bold,
      underline: segment.underline,
      isWhitespace: /^\s+$/.test(part)
    }));
}

function getTokenWidth(doc: jsPDF, token: Token) {
  doc.setFont(BASE_FONT, token.bold ? "bold" : "normal");
  return doc.getTextWidth(token.text);
}

export function exportPdf(fileName: string, html: string) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setFont(BASE_FONT, "normal");
  doc.setFontSize(12);

  const margin = 48;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - margin * 2;

  const lines = htmlToLines(html || "");
  let y = margin;

  const ensurePage = () => {
    if (y > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const lineWidth = (tokens: Token[]) =>
    tokens.reduce((sum, token) => sum + getTokenWidth(doc, token), 0);

  const renderLine = (tokens: Token[], alignment: TextAlignment) => {
    ensurePage();
    const totalWidth = lineWidth(tokens);
    let x = margin;
    if (alignment === "center") {
      x = margin + Math.max(0, (maxWidth - totalWidth) / 2);
    } else if (alignment === "right") {
      x = margin + Math.max(0, maxWidth - totalWidth);
    }
    tokens.forEach((token) => {
      const width = getTokenWidth(doc, token);
      if (token.isWhitespace) {
        x += width;
        return;
      }
      doc.setFont(BASE_FONT, token.bold ? "bold" : "normal");
      doc.text(token.text, x, y);
      if (token.underline) {
        doc.setLineWidth(0.8);
        doc.line(x, y + UNDERLINE_OFFSET, x + width, y + UNDERLINE_OFFSET);
      }
      x += width;
    });
    y += LINE_HEIGHT;
  };

  lines.forEach((line) => {
    if (!line.segments.length) {
      renderLine([], line.alignment);
      return;
    }

    let currentTokens: Token[] = [];
    let currentWidth = 0;

    const flushLine = () => {
      renderLine(currentTokens, line.alignment);
      currentTokens = [];
      currentWidth = 0;
    };

    line.segments.forEach((segment) => {
      const tokens = segmentToTokens(segment);
      tokens.forEach((token) => {
        const width = getTokenWidth(doc, token);
        const wouldOverflow = currentTokens.length > 0 &&
          !token.isWhitespace &&
          currentWidth + width > maxWidth;

        if (wouldOverflow) {
          flushLine();
        }

        if (currentTokens.length === 0 && token.isWhitespace) {
          return;
        }

        currentTokens.push(token);
        currentWidth += width;
      });
    });

    renderLine(currentTokens, line.alignment);
  });

  doc.save(fileName);
}
