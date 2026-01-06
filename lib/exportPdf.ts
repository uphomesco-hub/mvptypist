"use client";

import { jsPDF } from "jspdf";

export function exportPdf(fileName: string, text: string) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - margin * 2;

  const lines = doc.splitTextToSize(text || "", maxWidth);
  let y = margin;

  lines.forEach((line: string) => {
    if (y > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += 18;
  });

  doc.save(fileName);
}
