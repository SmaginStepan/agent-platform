import { prisma } from "../lib/prisma.js";
import { authDevice } from "../lib/auth.utils.js";
import {
  toLibraryItemDto,
  pickSetCover,
  normalizeStringArray,
  uniquePreserveOrder,
  ensureItemIdsBelongToFamily,
} from "../service/library.utils.js";
import { router } from "../router.js";

router.put("/v1/library/sets/:id/items", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const itemIds = uniquePreserveOrder(normalizeStringArray(req.body?.itemIds));

  try {
    const existing = await prisma.familyLibrarySet.findFirst({
      where: {
        id: req.params.id,
        familyId: device.user.familyId,
      },
      select: { id: true, coverItemId: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Library set not found" });
    }

    const itemsOk = await ensureItemIdsBelongToFamily(device.user.familyId, itemIds);
    if (!itemsOk) {
      return res.status(400).json({ error: "Some itemIds do not belong to this family" });
    }

    const nextCoverItemId =
      existing.coverItemId && itemIds.includes(existing.coverItemId)
        ? existing.coverItemId
        : null;

    const updated = await prisma.$transaction(async (tx) => {
      await tx.familyLibrarySetItem.deleteMany({
        where: { setId: existing.id },
      });

      await tx.familyLibrarySet.update({
        where: { id: existing.id },
        data: { coverItemId: nextCoverItemId },
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

router.post("/v1/library/sets/:id/items", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const itemIds = uniquePreserveOrder(normalizeStringArray(req.body?.itemIds));

  try {
    const existingSet = await prisma.familyLibrarySet.findFirst({
      where: {
        id: req.params.id,
        familyId: device.user.familyId,
      },
      include: {
        items: {
          orderBy: { sortOrder: "asc" },
          select: { itemId: true, sortOrder: true },
        },
      },
    });

    if (!existingSet) {
      return res.status(404).json({ error: "Library set not found" });
    }

    const itemsOk = await ensureItemIdsBelongToFamily(device.user.familyId, itemIds);
    if (!itemsOk) {
      return res.status(400).json({ error: "Some itemIds do not belong to this family" });
    }

    const existingIds = new Set(existingSet.items.map((x) => x.itemId));
    const newIds = itemIds.filter((id) => !existingIds.has(id));
    const nextSortOrder = existingSet.items.length;

    if (newIds.length > 0) {
      await prisma.familyLibrarySetItem.createMany({
        data: newIds.map((itemId, index) => ({
          setId: existingSet.id,
          itemId,
          sortOrder: nextSortOrder + index,
        })),
      });
    }

    const updated = await prisma.familyLibrarySet.findUniqueOrThrow({
      where: { id: existingSet.id },
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
    console.error("library set add items failed", e);
    return res.status(500).json({ error: "Failed to add items to library set" });
  }
});

router.delete("/v1/library/sets/:id/items/:itemId", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  try {
    const existingSet = await prisma.familyLibrarySet.findFirst({
      where: {
        id: req.params.id,
        familyId: device.user.familyId,
      },
      select: { id: true, coverItemId: true },
    });

    if (!existingSet) {
      return res.status(404).json({ error: "Library set not found" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.familyLibrarySetItem.deleteMany({
        where: {
          setId: existingSet.id,
          itemId: req.params.itemId,
        },
      });

      if (existingSet.coverItemId === req.params.itemId) {
        await tx.familyLibrarySet.update({
          where: { id: existingSet.id },
          data: { coverItemId: null },
        });
      }

      const rows = await tx.familyLibrarySetItem.findMany({
        where: { setId: existingSet.id },
        orderBy: { sortOrder: "asc" },
        select: { id: true },
      });

      for (let i = 0; i < rows.length; i++) {
        await tx.familyLibrarySetItem.update({
          where: { id: rows[i].id },
          data: { sortOrder: i },
        });
      }
    });

    const updated = await prisma.familyLibrarySet.findUniqueOrThrow({
      where: { id: existingSet.id },
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
    console.error("library set remove item failed", e);
    return res.status(500).json({ error: "Failed to remove item from library set" });
  }
});

router.post("/v1/library/sets/:id/move-items", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const itemIds = uniquePreserveOrder(normalizeStringArray(req.body?.itemIds));
  const targetSetId =
    typeof req.body?.targetSetId === "string" && req.body.targetSetId.trim().length > 0
      ? req.body.targetSetId.trim()
      : "";

  if (!targetSetId) {
    return res.status(400).json({ error: "targetSetId is required" });
  }

  try {
    const sourceSet = await prisma.familyLibrarySet.findFirst({
      where: {
        id: req.params.id,
        familyId: device.user.familyId,
      },
      include: {
        items: {
          orderBy: { sortOrder: "asc" },
          select: { itemId: true },
        },
      },
    });

    if (!sourceSet) {
      return res.status(404).json({ error: "Source set not found" });
    }

    const targetSet = await prisma.familyLibrarySet.findFirst({
      where: {
        id: targetSetId,
        familyId: device.user.familyId,
      },
      include: {
        items: {
          orderBy: { sortOrder: "asc" },
          select: { itemId: true },
        },
      },
    });

    if (!targetSet) {
      return res.status(404).json({ error: "Target set not found" });
    }

    const sourceItemIds = new Set(sourceSet.items.map((x) => x.itemId));
    const movableIds = itemIds.filter((id) => sourceItemIds.has(id));

    await prisma.$transaction(async (tx) => {
      await tx.familyLibrarySetItem.deleteMany({
        where: {
          setId: sourceSet.id,
          itemId: { in: movableIds },
        },
      });

      const targetExistingIds = new Set(targetSet.items.map((x) => x.itemId));
      const idsToAdd = movableIds.filter((id) => !targetExistingIds.has(id));

      if (idsToAdd.length > 0) {
        await tx.familyLibrarySetItem.createMany({
          data: idsToAdd.map((itemId, index) => ({
            setId: targetSet.id,
            itemId,
            sortOrder: targetSet.items.length + index,
          })),
        });
      }

      if (movableIds.includes(sourceSet.coverItemId ?? "")) {
        await tx.familyLibrarySet.update({
          where: { id: sourceSet.id },
          data: { coverItemId: null },
        });
      }
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("library set move items failed", e);
    return res.status(500).json({ error: "Failed to move items between sets" });
  }
});
