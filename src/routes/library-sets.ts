import { prisma } from "../lib/prisma.js";
import { authDevice } from "../lib/auth.utils.js";
import {
  toLibraryItemDto,
  pickSetCover,
  normalizeStringArray,
  uniquePreserveOrder,
  ensureCoverBelongsToFamily,
  ensureItemIdsBelongToFamily,
} from "../service/library.utils.js";

import { router } from "../router.js";

router.get("/v1/library/sets", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  try {
    const sets = await prisma.familyLibrarySet.findMany({
      where: { familyId: device.user.familyId },
      include: {
        coverItem: true,
        items: {
          orderBy: { sortOrder: "asc" },
          take: 1,
          include: { item: true },
        },
        _count: { select: { items: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
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

router.post("/v1/library/sets/move", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const setIds = uniquePreserveOrder(normalizeStringArray(req.body?.setIds));

  if (setIds.length === 0) {
    return res.status(400).json({ error: "setIds is required" });
  }

  try {
    const existingSets = await prisma.familyLibrarySet.findMany({
      where: {
        familyId: device.user.familyId,
        id: { in: setIds },
      },
      select: { id: true },
    });

    if (existingSets.length !== setIds.length) {
      return res.status(400).json({ error: "Some setIds do not belong to this family" });
    }

    await prisma.$transaction(
      setIds.map((setId, index) =>
        prisma.familyLibrarySet.update({
          where: { id: setId },
          data: { sortOrder: index },
        })
      )
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("library sets move failed", e);
    return res.status(500).json({ error: "Failed to reorder library sets" });
  }
});

router.get("/v1/library/sets/:id", async (req, res) => {
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
          include: { item: true },
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

router.post("/v1/library/sets", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const itemIds = uniquePreserveOrder(normalizeStringArray(req.body?.itemIds));
  const coverItemId =
    typeof req.body?.coverItemId === "string" && req.body.coverItemId.trim().length > 0
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

    const lastSet = await prisma.familyLibrarySet.findFirst({
      where: { familyId: device.user.familyId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const nextSortOrder = (lastSet?.sortOrder ?? -1) + 1;

    const created = await prisma.familyLibrarySet.create({
      data: {
        familyId: device.user.familyId,
        sortOrder: nextSortOrder,
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

router.patch("/v1/library/sets/:id", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const name =
    typeof req.body?.name === "string" ? req.body.name.trim() : undefined;

  const coverItemId =
    req.body?.coverItemId === null
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

router.delete("/v1/library/sets/:id", async (req, res) => {
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
