import { prisma } from "../lib/prisma.js";
import { buildLibraryItemImageUrl } from "../lib/url.helpers.js";

export type LibraryItemDto = {
  id: string;
  label: string;
  imageUrl: string | null;
  source: "FAMILY_PHOTO" | "ARASAAC";
  sourceRef: string | null;
};

export type LibrarySetDto = {
  id: string;
  name: string;
  cover: LibraryItemDto | null;
  itemsCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export function toLibraryItemDto(item: {
  id: string;
  label: string;
  source: "FAMILY_PHOTO" | "ARASAAC";
  sourceRef: string | null;
}): LibraryItemDto {
  return {
    id: item.id,
    label: item.label,
    imageUrl: buildLibraryItemImageUrl(item),
    source: item.source,
    sourceRef: item.sourceRef,
  };
}

export function pickSetCover(set: {
  coverItem: {
    id: string;
    label: string;
    source: "FAMILY_PHOTO" | "ARASAAC";
    sourceRef: string | null;
  } | null;
  items: Array<{
    item: {
      id: string;
      label: string;
      source: "FAMILY_PHOTO" | "ARASAAC";
      sourceRef: string | null;
    };
  }>;
}): LibraryItemDto | null {
  const item = set.coverItem ?? set.items[0]?.item ?? null;
  return item ? toLibraryItemDto(item) : null;
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

export function uniquePreserveOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

export async function ensureCoverBelongsToFamily(familyId: string, coverItemId: string | null) {
  if (!coverItemId) return true;

  const row = await prisma.familyLibraryItem.findFirst({
    where: { id: coverItemId, familyId },
    select: { id: true },
  });

  return !!row;
}

export async function ensureItemIdsBelongToFamily(familyId: string, itemIds: string[]) {
  if (itemIds.length === 0) return true;

  const rows = await prisma.familyLibraryItem.findMany({
    where: { familyId, id: { in: itemIds } },
    select: { id: true },
  });

  return rows.length === itemIds.length;
}
