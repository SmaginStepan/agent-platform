import crypto from "crypto";
import sharp from "sharp";
import fs from "fs";
import multer from "multer";
import { prisma } from "../lib/prisma.js";
import { authDevice } from "../lib/auth.utils.js";
import { LocalStorageService } from "../service/storage.service.js";
import { buildLibraryItemImageUrl, UPLOADS_DIR } from "../lib/url.helpers.js";
import { toLibraryItemDto } from "../service/library.utils.js";
import { router } from "../router.js";

const storageService = new LocalStorageService(UPLOADS_DIR);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
});

router.post("/v1/library/items/upload", upload.single("file"), async (req, res) => {
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

    return res.json({
      ok: true,
      item: {
        id: card.id,
        label: card.label ?? "",
        imageUrl: buildLibraryItemImageUrl(card),
        source: "FAMILY_PHOTO",
      },
    });
  } catch (e) {
    console.error("family-photo upload failed", e);
    return res.status(500).json({ error: "Failed to upload family photo" });
  }
});

router.get("/v1/library/items", async (req, res) => {
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
      orderBy: { createdAt: "desc" },
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

router.get("/v1/library/items/:id/file", async (req, res) => {
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

router.patch("/v1/library/items/:id", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const label = typeof req.body?.label === "string" ? req.body.label.trim() : null;
  if (!label) {
    return res.status(400).json({ error: "label is required" });
  }

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

    const updated = await prisma.familyLibraryItem.update({
      where: { id: item.id },
      data: { label },
    });

    return res.json({ ok: true, item: toLibraryItemDto(updated) });
  } catch (e) {
    console.error("library item rename failed", e);
    return res.status(500).json({ error: "Failed to rename library item" });
  }
});

router.delete("/v1/library/items/:id", async (req, res) => {
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
      data: { coverItemId: null },
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

router.post("/v1/library/items/arasaac", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const label = typeof req.body?.label === "string" ? req.body.label.trim() : "";
  const sourceRef = typeof req.body?.sourceRef === "string" ? req.body.sourceRef.trim() : "";

  if (!label) {
    return res.status(400).json({ error: "label is required" });
  }

  if (!sourceRef) {
    return res.status(400).json({ error: "sourceRef is required" });
  }

  try {
    const existing = await prisma.familyLibraryItem.findFirst({
      where: {
        familyId: device.user.familyId,
        source: "ARASAAC",
        sourceRef,
      },
    });

    if (existing) {
      return res.json({ ok: true, item: toLibraryItemDto(existing) });
    }

    const item = await prisma.familyLibraryItem.create({
      data: {
        familyId: device.user.familyId,
        createdByUserId: device.user.id,
        label,
        source: "ARASAAC",
        sourceRef,
        storageKey: null,
        mimeType: null,
        width: null,
        height: null,
        fileSizeBytes: null,
      },
    });

    return res.json({ ok: true, item: toLibraryItemDto(item) });
  } catch (e) {
    console.error("library arasaac item create failed", e);
    return res.status(500).json({ error: "Failed to add ARASAAC item" });
  }
});
