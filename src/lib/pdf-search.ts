import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

type PdfMatch = {
  page: number;
  snippet: string;
};

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function buildSnippet(text: string, query: string): string {
  const normalized = text.toLowerCase();
  const idx = normalized.indexOf(query.toLowerCase());
  if (idx < 0) {
    return text.slice(0, 220);
  }

  const start = Math.max(0, idx - 90);
  const end = Math.min(text.length, idx + query.length + 130);
  const prefix = start > 0 ? "... " : "";
  const suffix = end < text.length ? " ..." : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

export async function searchTextPdfFromUrl(url: string, query: string): Promise<{
  searchable: boolean;
  matches: PdfMatch[];
}> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Unable to fetch PDF attachment");
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return { searchable: true, matches: [] };
  }

  const loadingTask = getDocument({
    data: bytes,
    useSystemFonts: true,
  } as any);

  try {
    const pdf = await loadingTask.promise;
    const matches: PdfMatch[] = [];
    let extractedTextPages = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = cleanText(
        (content.items as Array<{ str?: string }>)
          .map((item) => (typeof item?.str === "string" ? item.str : ""))
          .join(" ")
      );

      if (pageText.length > 0) {
        extractedTextPages += 1;
      }

      if (pageText.toLowerCase().includes(normalizedQuery)) {
        matches.push({
          page: pageNumber,
          snippet: buildSnippet(pageText, normalizedQuery),
        });
      }

      if (matches.length >= 20) break;
    }

    await pdf.destroy();

    if (extractedTextPages === 0) {
      return { searchable: false, matches: [] };
    }

    return { searchable: true, matches };
  } finally {
    await loadingTask.destroy();
  }
}
