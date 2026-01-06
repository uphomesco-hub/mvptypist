"use client";

import { Document, Packer, Paragraph, TextRun } from "docx";

export async function exportDocx(fileName: string, text: string) {
  const lines = text.split(/\r?\n/);
  const paragraphs = lines.length
    ? lines.map((line) => new Paragraph({ children: [new TextRun(line)] }))
    : [new Paragraph("")];

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: paragraphs
      }
    ]
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
