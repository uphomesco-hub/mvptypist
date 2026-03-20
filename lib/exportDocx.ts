"use client";

import {
  AlignmentType,
  Document,
  Packer,
  Paragraph,
  TextRun,
  UnderlineType
} from "docx";
import { htmlToLines } from "@/lib/richText";

function paragraphAlignment(alignment: "left" | "center" | "right") {
  if (alignment === "center") return AlignmentType.CENTER;
  if (alignment === "right") return AlignmentType.RIGHT;
  return AlignmentType.LEFT;
}

export async function exportDocx(fileName: string, html: string) {
  const lines = htmlToLines(html || "");
  const paragraphs = lines.length
    ? lines.map((line) => {
        if (!line.segments.length) {
          return new Paragraph("");
        }
        return new Paragraph({
          alignment: paragraphAlignment(line.alignment),
          children: line.segments.map(
            (segment) =>
              new TextRun({
                text: segment.text,
                bold: segment.bold,
                underline: segment.underline
                  ? { type: UnderlineType.SINGLE }
                  : undefined
              })
          )
        });
      })
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
