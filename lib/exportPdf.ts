"use client";

import { jsPDF } from "jspdf";
import { htmlToLines, type TextSegment } from "@/lib/richText";

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

  const renderLine = (tokens: Token[]) => {
    ensurePage();
    let x = margin;
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

  lines.forEach((lineSegments) => {
    if (!lineSegments.length) {
      renderLine([]);
      return;
    }

    let currentTokens: Token[] = [];
    let currentWidth = 0;

    const flushLine = () => {
      renderLine(currentTokens);
      currentTokens = [];
      currentWidth = 0;
    };

    lineSegments.forEach((segment) => {
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

    renderLine(currentTokens);
  });

  doc.save(fileName);
}
