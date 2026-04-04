import crypto from "crypto";
import sharp from "sharp";
import { app, prisma } from "../index.js";
import { authDevice } from "../lib/auth.utils.js";
import multer from "multer";
import { LocalStorageService } from "../service/storage.service.js";
import fs from "fs";
import { buildLibraryItemImageUrl, UPLOADS_DIR } from "../lib/url.helpers.js";

export const storageService = new LocalStorageService(UPLOADS_DIR);

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
});


export async function ensureCoverBelongsToFamily(familyId: string, coverItemId: string | null) {
  if (!coverItemId) return true;

  const row = await prisma.familyLibraryItem.findFirst({
    where: {
      id: coverItemId,
      familyId,
    },
    select: { id: true },
  });

  return !!row;
}
export async function ensureItemIdsBelongToFamily(familyId: string, itemIds: string[]) {
  if (itemIds.length === 0) return true;

  const rows = await prisma.familyLibraryItem.findMany({
    where: {
      familyId,
      id: { in: itemIds },
    },
    select: { id: true },
  });

  return rows.length === itemIds.length;
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

export type LibraryItemDto = {
  id: string;
  label: string;
  imageUrl: string | null;
  source: "FAMILY_PHOTO" | "ARASAAC";
  sourceRef: string | null;
};

type LibrarySetDto = {
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

app.post("/v1/library/items/upload", upload.single("file"), async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  if (!req.file) {
    return res.status(400).json({ error: "File is required" });
  }

  const label = typeof req.body.label === "string" ? req.body.label.trim() : "";
  if (!label) {
    return res.status(400).json({ error: "Label is required" });
  }

  const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedMimeTypes.includes(req.file.mimetype)) {
    return res.status(400).json({ error: "Unsupported file type" });
  }

  try {
    const processed = await sharp(req.file.buffer)
      .rotate()
      .resize(512, 512, { fit: "cover" })
      .webp({ quality: 80 })
      .toBuffer();

    const meta = await sharp(processed).metadata();

    const cardId = crypto.randomUUID();
    const storageKey = `family-photo/${device.user.familyId}/${cardId}.webp`;

    const stored = await storageService.put({
      key: storageKey,
      body: processed,
      contentType: "image/webp",
    });

    const card = await prisma.familyLibraryItem.create({
      data: {
        id: cardId,
        familyId: device.user.familyId,
        createdByUserId: device.user.id,
        label,
        source: "FAMILY_PHOTO",
        storageKey: stored.storageKey,
        mimeType: stored.contentType,
        width: meta.width ?? null,
        height: meta.height ?? null,
        fileSizeBytes: stored.sizeBytes,
      },
    });

    const imageUrl = buildLibraryItemImageUrl(card);

    return res.json({
      ok: true,
      item: {
        id: card.id,
        label: card.label ?? "",
        imageUrl: imageUrl,
        source: "FAMILY_PHOTO",
      },
    });
  } catch (e) {
    console.error("family-photo upload failed", e);
    return res.status(500).json({ error: "Failed to upload family photo" });
  }
});

app.get("/v1/library/items", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const source = typeof req.query.source === "string" ? req.query.source : undefined;

  try {
    const where: any = {
      familyId: device.user.familyId,
    };

    if (source === "FAMILY_PHOTO") {
      where.source = "FAMILY_PHOTO";
    } else if (source === "ARASAAC") {
      where.source = "ARASAAC";
    }

    const items = await prisma.familyLibraryItem.findMany({
      where,
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json({
      ok: true,
      items: items.map((item) => ({
        id: item.id,
        label: item.label,
        imageUrl: buildLibraryItemImageUrl(item),
        source: item.source,
        sourceRef: item.sourceRef,
      })),
    });
  } catch (e) {
    console.error("library items list failed", e);
    return res.status(500).json({ error: "Failed to load library items" });
  }
});

app.get("/v1/library/items/:id/file", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  try {
    const item = await prisma.familyLibraryItem.findFirst({
      where: {
        id: req.params.id,
        familyId: device.user.familyId,
      },
    });

    if (!item) {
      return res.status(404).json({ error: "Library item not found" });
    }

    if (!item.storageKey) {
      return res.status(400).json({ error: "This library item has no local file" });
    }

    const absolutePath = storageService.getAbsolutePath(item.storageKey);

    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: "File not found" });
    }

    res.setHeader("Content-Type", item.mimeType || "application/octet-stream");
    return res.sendFile(absolutePath);
  } catch (e) {
    console.error("library item file failed", e);
    return res.status(500).json({ error: "Failed to read library item file" });
  }
});

app.delete("/v1/library/items/:id", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  try {
    const item = await prisma.familyLibraryItem.findFirst({
      where: {
        id: req.params.id,
        familyId: device.user.familyId,
      },
    });

    if (!item) {
      return res.status(404).json({ error: "Library item not found" });
    }

    if (item.source !== "FAMILY_PHOTO") {
      return res.status(400).json({ error: "Only uploaded family photos can be deleted for now" });
    }

    if (item.storageKey) {
      const absolutePath = storageService.getAbsolutePath(item.storageKey);
      if (fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
      }
    }

    await prisma.familyLibrarySet.updateMany({
      where: {
        familyId: device.user.familyId,
        coverItemId: item.id,
      },
      data: {
        coverItemId: null,
      },
    });

    await prisma.familyLibraryItem.delete({
      where: { id: item.id },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("library item delete failed", e);
    return res.status(500).json({ error: "Failed to delete library item" });
  }
});

app.delete("/v1/library/items/:id", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  try {
    const item = await prisma.familyLibraryItem.findFirst({
      where: {
        id: req.params.id,
        familyId: device.user.familyId,
      },
    });

    if (!item) {
      return res.status(404).json({ error: "Library item not found" });
    }

    if (item.source !== "FAMILY_PHOTO") {
      return res.status(400).json({ error: "Only uploaded family photos can be deleted for now" });
    }

    if (item.storageKey) {
      const absolutePath = storageService.getAbsolutePath(item.storageKey);
      if (fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
      }
    }

    await prisma.familyLibrarySet.updateMany({
      where: {
        familyId: device.user.familyId,
        coverItemId: item.id,
      },
      data: {
        coverItemId: null,
      },
    });

    await prisma.familyLibraryItem.delete({
      where: { id: item.id },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("library item delete failed", e);
    return res.status(500).json({ error: "Failed to delete library item" });
  }
});
app.get("/v1/library/sets", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  try {
    const sets = await prisma.familyLibrarySet.findMany({
      where: {
        familyId: device.user.familyId,
      },
      include: {
        coverItem: true,
        items: {
          orderBy: { sortOrder: "asc" },
          take: 1,
          include: {
            item: true,
          },
        },
        _count: {
          select: {
            items: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json({
      ok: true,
      sets: sets.map((set) => ({
        id: set.id,
        name: set.name,
        cover: pickSetCover(set),
        itemsCount: set._count.items,
        createdAt: set.createdAt,
        updatedAt: set.updatedAt,
      })),
    });
  } catch (e) {
    console.error("library sets list failed", e);
    return res.status(500).json({ error: "Failed to load library sets" });
  }
});
app.get("/v1/library/sets/:id", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  try {
    const set = await prisma.familyLibrarySet.findFirst({
      where: {
        id: req.params.id,
        familyId: device.user.familyId,
      },
      include: {
        coverItem: true,
        items: {
          orderBy: { sortOrder: "asc" },
          include: {
            item: true,
          },
        },
      },
    });

    if (!set) {
      return res.status(404).json({ error: "Library set not found" });
    }

    return res.json({
      ok: true,
      set: {
        id: set.id,
        name: set.name,
        cover: pickSetCover(set),
        items: set.items.map((row) => toLibraryItemDto(row.item)),
        createdAt: set.createdAt,
        updatedAt: set.updatedAt,
      },
    });
  } catch (e) {
    console.error("library set details failed", e);
    return res.status(500).json({ error: "Failed to load library set" });
  }
});

app.post("/v1/library/sets", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const itemIds = uniquePreserveOrder(normalizeStringArray(req.body?.itemIds));
  const coverItemId = typeof req.body?.coverItemId === "string" && req.body.coverItemId.trim().length > 0
    ? req.body.coverItemId.trim()
    : null;

  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }

  try {
    const itemsOk = await ensureItemIdsBelongToFamily(device.user.familyId, itemIds);
    if (!itemsOk) {
      return res.status(400).json({ error: "Some itemIds do not belong to this family" });
    }

    const coverOk = await ensureCoverBelongsToFamily(device.user.familyId, coverItemId);
    if (!coverOk) {
      return res.status(400).json({ error: "coverItemId does not belong to this family" });
    }

    const created = await prisma.familyLibrarySet.create({
      data: {
        familyId: device.user.familyId,
        createdByUserId: device.user.id,
        name,
        coverItemId,
        items: {
          create: itemIds.map((itemId, index) => ({
            itemId,
            sortOrder: index,
          })),
        },
      },
      include: {
        coverItem: true,
        items: {
          orderBy: { sortOrder: "asc" },
          include: { item: true },
        },
      },
    });

    return res.json({
      ok: true,
      set: {
        id: created.id,
        name: created.name,
        cover: pickSetCover(created),
        items: created.items.map((row) => toLibraryItemDto(row.item)),
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
    });
  } catch (e) {
    console.error("library set create failed", e);
    return res.status(500).json({ error: "Failed to create library set" });
  }
});

app.patch("/v1/library/sets/:id", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const name = typeof req.body?.name === "string"
    ? req.body.name.trim()
    : undefined;

  const coverItemId = req.body?.coverItemId === null
    ? null
    : typeof req.body?.coverItemId === "string" && req.body.coverItemId.trim().length > 0
      ? req.body.coverItemId.trim()
      : undefined;

  if (name !== undefined && !name) {
    return res.status(400).json({ error: "name must not be empty" });
  }

  try {
    const existing = await prisma.familyLibrarySet.findFirst({
      where: {
        id: req.params.id,
        familyId: device.user.familyId,
      },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Library set not found" });
    }

    if (coverItemId !== undefined) {
      const coverOk = await ensureCoverBelongsToFamily(device.user.familyId, coverItemId);
      if (!coverOk) {
        return res.status(400).json({ error: "coverItemId does not belong to this family" });
      }
    }

    const updated = await prisma.familyLibrarySet.update({
      where: { id: existing.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(coverItemId !== undefined ? { coverItemId } : {}),
      },
      include: {
        coverItem: true,
        items: {
          orderBy: { sortOrder: "asc" },
          include: { item: true },
        },
      },
    });

    return res.json({
      ok: true,
      set: {
        id: updated.id,
        name: updated.name,
        cover: pickSetCover(updated),
        items: updated.items.map((row) => toLibraryItemDto(row.item)),
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (e) {
    console.error("library set patch failed", e);
    return res.status(500).json({ error: "Failed to update library set" });
  }
});

app.put("/v1/library/sets/:id/items", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const itemIds = uniquePreserveOrder(normalizeStringArray(req.body?.itemIds));

  try {
    const existing = await prisma.familyLibrarySet.findFirst({
      where: {
        id: req.params.id,
        familyId: device.user.familyId,
      },
      select: {
        id: true,
        coverItemId: true,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Library set not found" });
    }

    const itemsOk = await ensureItemIdsBelongToFamily(device.user.familyId, itemIds);
    if (!itemsOk) {
      return res.status(400).json({ error: "Some itemIds do not belong to this family" });
    }

    const nextCoverItemId = existing.coverItemId && itemIds.includes(existing.coverItemId)
      ? existing.coverItemId
      : null;

    const updated = await prisma.$transaction(async (tx) => {
      await tx.familyLibrarySetItem.deleteMany({
        where: { setId: existing.id },
      });

      await tx.familyLibrarySet.update({
        where: { id: existing.id },
        data: {
          coverItemId: nextCoverItemId,
        },
      });

      if (itemIds.length > 0) {
        await tx.familyLibrarySetItem.createMany({
          data: itemIds.map((itemId, index) => ({
            setId: existing.id,
            itemId,
            sortOrder: index,
          })),
        });
      }

      return tx.familyLibrarySet.findUniqueOrThrow({
        where: { id: existing.id },
        include: {
          coverItem: true,
          items: {
            orderBy: { sortOrder: "asc" },
            include: { item: true },
          },
        },
      });
    });

    return res.json({
      ok: true,
      set: {
        id: updated.id,
        name: updated.name,
        cover: pickSetCover(updated),
        items: updated.items.map((row) => toLibraryItemDto(row.item)),
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (e) {
    console.error("library set items replace failed", e);
    return res.status(500).json({ error: "Failed to replace library set items" });
  }
});

app.delete("/v1/library/sets/:id", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  try {
    const existing = await prisma.familyLibrarySet.findFirst({
      where: {
        id: req.params.id,
        familyId: device.user.familyId,
      },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Library set not found" });
    }

    await prisma.familyLibrarySet.delete({
      where: { id: existing.id },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("library set delete failed", e);
    return res.status(500).json({ error: "Failed to delete library set" });
  }
});
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
