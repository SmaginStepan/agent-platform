import path from "path";

const ARASAAC_API_BASE = process.env.ARASAAC_API_BASE || "https://api.arasaac.org";

export function buildArasaacSearchUrl(query: string, lang: string) {
  const encoded = encodeURIComponent(query.trim());

  return `${ARASAAC_API_BASE}/v1/pictograms/${lang}/search/${encoded}`;
}

export function buildArasaacImageUrl(id: string | number) {
  return `${ARASAAC_API_BASE}/v1/pictograms/${id}?download=false`;
}

export const UPLOADS_DIR = process.env.UPLOADS_DIR || path.resolve(process.cwd(), "uploads");
export const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 8080}`;

function buildLibraryItemFileUrl(itemId: string): string {
  return `${PUBLIC_BASE_URL}/v1/library/items/${itemId}/file`;
}

export function buildLibraryItemImageUrl(item: {
  id: string;
  source: "FAMILY_PHOTO" | "ARASAAC";
  sourceRef: string | null;
}): string | null {
  if (item.source === "FAMILY_PHOTO") {
    return buildLibraryItemFileUrl(item.id);
  }

  if (item.source === "ARASAAC") {
    if (!item.sourceRef) return null;
    return buildArasaacImageUrl(item.sourceRef);
  }

  return null;
}
