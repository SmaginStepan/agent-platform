import { router } from "../router.js";
import { prisma } from "../lib/prisma.js";
import { authDevice } from "../lib/auth.utils.js";
import {
  conversationPresets,
  conversationPresetSummaries,
  InstallPresetSchema,
  PresetCell,
} from "../service/conversation-presets.js";
import {
  gridSortOrder,
  HttpError,
  lockConversationSection,
} from "../service/conversation.utils.js";

const SECTION = "CONVERSATION";

router.get("/v1/conversation/presets", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  res.json({ ok: true, items: conversationPresetSummaries });
});

router.post("/v1/conversation/presets/:id/install", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  // Effective role: an elevated child (adult mode) may install.
  if (device.user.role !== "PARENT") {
    return res.status(403).json({ error: "Only parents can edit child home" });
  }

  const preset = conversationPresets.get(req.params.id);
  if (!preset) return res.status(404).json({ error: "Preset not found" });

  const parsed = InstallPresetSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json(parsed.error);

  const { language } = parsed.data;
  const mode = parsed.data.mode ?? "EMPTY_ONLY";

  if (!preset.languages.includes(language)) {
    return res.status(400).json({ error: `Unsupported language ${language}` });
  }

  const familyId = device.user.familyId;
  const userId = device.user.id;

  const allCells: PresetCell[] = [];
  const collect = (cells: PresetCell[]) => {
    for (const cell of cells) {
      allCells.push(cell);
      if (cell.page) collect(cell.page.cells);
    }
  };
  collect(preset.root.cells);

  const itemKey = (sourceRef: string, label: string) => `${sourceRef}\u0000${label}`;
  const cellItemKey = (cell: PresetCell) =>
    itemKey(String(cell.arasaacId), cell.label[language]);

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        await lockConversationSection(tx, familyId);

        const existingCount = await tx.childHomeNode.count({
          where: { familyId, section: SECTION },
        });

        if (existingCount > 0) {
          if (mode === "EMPTY_ONLY") throw new HttpError(409, { error: "LIBRARY_NOT_EMPTY" });

          // REPLACE: remove the CONVERSATION tree leaves-first (library items stay).
          while (
            (
              await tx.childHomeNode.deleteMany({
                where: { familyId, section: SECTION, children: { none: {} } },
              })
            ).count > 0
          );
        }

        // Library items: reuse the family's ARASAAC item with the same
        // sourceRef and label, otherwise create one.
        const itemIds = new Map<string, string>();
        const existingItems = await tx.familyLibraryItem.findMany({
          where: {
            familyId,
            source: "ARASAAC",
            sourceRef: { in: [...new Set(allCells.map((c) => String(c.arasaacId)))] },
          },
          orderBy: { createdAt: "asc" },
          select: { id: true, sourceRef: true, label: true },
        });
        for (const item of existingItems) {
          const key = itemKey(item.sourceRef!, item.label);
          if (!itemIds.has(key)) itemIds.set(key, item.id);
        }

        const wanted = new Set(allCells.map(cellItemKey));
        const itemsReused = [...wanted].filter((k) => itemIds.has(k)).length;

        const missing = new Map<string, PresetCell>();
        for (const cell of allCells) {
          const key = cellItemKey(cell);
          if (!itemIds.has(key) && !missing.has(key)) missing.set(key, cell);
        }

        const created = await tx.familyLibraryItem.createManyAndReturn({
          data: [...missing.values()].map((cell) => ({
            familyId,
            createdByUserId: userId,
            label: cell.label[language],
            source: "ARASAAC" as const,
            sourceRef: String(cell.arasaacId),
          })),
          select: { id: true, sourceRef: true, label: true },
        });
        for (const item of created) itemIds.set(itemKey(item.sourceRef!, item.label), item.id);

        // Nodes, one page level at a time so MENU ids exist before their
        // children. Created rows are matched back by (parentId, cell), which is
        // unique within the preset.
        let nodesCreated = 0;
        let level = preset.root.cells.map((cell) => ({ cell, parentId: null as string | null }));

        while (level.length > 0) {
          const rows = await tx.childHomeNode.createManyAndReturn({
            data: level.map(({ cell, parentId }) => ({
              familyId,
              itemId: itemIds.get(cellItemKey(cell))!,
              parentId,
              section: SECTION,
              type: cell.type,
              gridRow: cell.row,
              gridCol: cell.col,
              color: cell.color,
              sortOrder: gridSortOrder(cell.row, cell.col),
            })),
            select: { id: true, parentId: true, gridRow: true, gridCol: true },
          });
          nodesCreated += rows.length;

          const nodeIds = new Map(
            rows.map((r) => [`${r.parentId}|${r.gridRow}|${r.gridCol}`, r.id])
          );

          level = level.flatMap(({ cell, parentId }) =>
            cell.page
              ? cell.page.cells.map((child) => ({
                  cell: child,
                  parentId: nodeIds.get(`${parentId}|${cell.row}|${cell.col}`)!,
                }))
              : []
          );
        }

        return { nodesCreated, itemsCreated: created.length, itemsReused };
      },
      { timeout: 30_000, maxWait: 10_000 }
    );

    return res.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json(e.body);
    throw e;
  }
});
