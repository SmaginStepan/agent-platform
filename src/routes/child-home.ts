import { router } from "../router.js";
import { prisma } from "../lib/prisma.js";
import { authDevice } from "../lib/auth.utils.js";
import { buildLibraryItemImageUrl } from "../lib/url.helpers.js";
import { pushSyncCommandsToDevice } from "../lib/firebase.js";
import {
  ChildHomeNodeIdParamsSchema,
  CreateChildHomeNodeSchema,
  GetChildHomeQuerySchema,
  UpdateChildHomeNodeSchema,
} from "../service/child-home.schemas.js";
import {
  gridSortOrder,
  HttpError,
  lockConversationSection,
} from "../service/conversation.utils.js";

// Which node types are valid in each section. HOME is unchanged (MENU/ACTION);
// the CONVERSATION library uses MENU (folder) and WORD.
function typeAllowedInSection(section: string, type: string): boolean {
  if (section === "CONVERSATION") return type === "MENU" || type === "WORD";
  return type === "MENU" || type === "ACTION";
}

// gridRow/gridCol/color are CONVERSATION-only: HOME rejects them on write.
// null is accepted as "not set" so clients that serialise nulls keep working.
function hasGridFields(data: {
  gridRow?: number | null;
  gridCol?: number | null;
  color?: string | null;
}) {
  return data.gridRow != null || data.gridCol != null || data.color != null;
}

function mapNode(node: any) {
  const isConversation = node.section === "CONVERSATION";
  return {
    id: node.id,
    familyId: node.familyId,
    itemId: node.itemId,
    parentId: node.parentId,
    section: node.section,
    type: node.type,
    sortOrder: node.sortOrder,
    labelOverride: node.labelOverride,
    isVisible: node.isVisible,
    targetMode: node.targetMode,
    blinkEnabled: node.blinkEnabled,
    blinkSeconds: node.blinkSeconds,
    gridRow: isConversation ? node.gridRow ?? null : null,
    gridCol: isConversation ? node.gridCol ?? null : null,
    color: isConversation ? node.color ?? null : null,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    item: node.item
      ? {
          id: node.item.id,
          label: node.labelOverride ? node.labelOverride : node.item.label,
          source: node.item.source,
          sourceRef: node.item.sourceRef,
          imageUrl: buildLibraryItemImageUrl(node.item),
        }
      : null,
    targets: node.targets ?? [],
  };
}

async function validateTargetUsers(familyId: string, userIds?: string[]) {
  if (!userIds || userIds.length === 0) return true;

  const count = await prisma.user.count({
    where: {
      id: { in: userIds },
      familyId,
      role: "PARENT",
    },
  });

  return count === userIds.length;
}

router.get("/v1/child-home/nodes", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const parsed = GetChildHomeQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json(parsed.error);

  const section = parsed.data.section ?? "HOME";

  const parentId =
    parsed.data.parentId === undefined || parsed.data.parentId === ""
      ? null
      : parsed.data.parentId;

  // Returns every node at this level ordered by grid cell, then sortOrder (no
  // visibility filtering for either section — HOME visibility is applied
  // client-side as it is today). HOME nodes have no grid cell, so for HOME
  // this is the same sortOrder ordering as before.
  const nodes = await prisma.childHomeNode.findMany({
    where: {
      familyId: device.user.familyId,
      section,
      parentId,
    },
    orderBy: [
      { gridRow: { sort: "asc", nulls: "last" } },
      { gridCol: { sort: "asc", nulls: "last" } },
      { sortOrder: "asc" },
      { createdAt: "asc" },
    ],
    include: {
      item: true,
      targets: true,
    },
  });

  res.json({ ok: true, items: nodes.map(mapNode) });
});

router.post("/v1/child-home/nodes", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  if (device.user.role !== "PARENT") {
    return res.status(403).json({ error: "Only parents can edit child home" });
  }

  const parsed = CreateChildHomeNodeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);

  const section = parsed.data.section ?? "HOME";

  if (!typeAllowedInSection(section, parsed.data.type)) {
    return res
      .status(400)
      .json({ error: `type ${parsed.data.type} is not allowed in section ${section}` });
  }

  if (section !== "CONVERSATION" && hasGridFields(parsed.data)) {
    return res
      .status(400)
      .json({ error: "gridRow, gridCol and color are only allowed in section CONVERSATION" });
  }

  const item = await prisma.familyLibraryItem.findFirst({
    where: {
      id: parsed.data.itemId,
      familyId: device.user.familyId,
    },
  });

  if (!item) return res.status(404).json({ error: "Library item not found" });

  if (parsed.data.parentId) {
    // Parent must be a MENU in the same family AND the same section.
    const parent = await prisma.childHomeNode.findFirst({
      where: {
        id: parsed.data.parentId,
        familyId: device.user.familyId,
        section,
        type: "MENU",
      },
    });

    if (!parent) return res.status(404).json({ error: "Parent menu not found" });
  }

  const parentId = parsed.data.parentId ?? null;

  if (section === "CONVERSATION") {
    // CONVERSATION nodes ignore visibility/target/blink: store defaults, never
    // create targets, never fail when those fields are sent. With a grid cell
    // the node takes that cell (409 if taken); without one it is appended to
    // the end of its level as before.
    const familyId = device.user.familyId;
    const { gridRow, gridCol } = parsed.data;

    try {
      const node = await prisma.$transaction(async (tx) => {
        await lockConversationSection(tx, familyId);

        let sortOrder: number;
        if (gridRow != null && gridCol != null) {
          const occupant = await tx.childHomeNode.findFirst({
            where: { familyId, section, parentId, gridRow, gridCol },
            select: { id: true },
          });
          if (occupant) throw new HttpError(409, { error: "CELL_OCCUPIED" });
          sortOrder = gridSortOrder(gridRow, gridCol);
        } else {
          const last = await tx.childHomeNode.findFirst({
            where: { familyId, section, parentId },
            orderBy: { sortOrder: "desc" },
            select: { sortOrder: true },
          });
          sortOrder = last ? last.sortOrder + 1 : 0;
        }

        return tx.childHomeNode.create({
          data: {
            familyId,
            itemId: parsed.data.itemId,
            parentId,
            section,
            type: parsed.data.type,
            sortOrder,
            labelOverride: parsed.data.labelOverride ?? null,
            gridRow: gridRow ?? null,
            gridCol: gridCol ?? null,
            color: parsed.data.color ?? null,
            // isVisible / targetMode / blink* keep their schema defaults; no targets
          },
          include: {
            item: true,
            targets: true,
          },
        });
      });

      return res.json({ ok: true, item: mapNode(node) });
    } catch (e) {
      if (e instanceof HttpError) return res.status(e.status).json(e.body);
      throw e;
    }
  }

  // HOME (unchanged behaviour)
  if (parsed.data.targetMode === "SELECTED_USERS") {
    const ok = await validateTargetUsers(
      device.user.familyId,
      parsed.data.targetUserIds
    );

    if (!ok) return res.status(400).json({ error: "Invalid target users" });
  }


  const node = await prisma.childHomeNode.create({
    data: {
      familyId: device.user.familyId,
      itemId: parsed.data.itemId,
      parentId,
      section,
      type: parsed.data.type,
      sortOrder: parsed.data.sortOrder ?? 0,
      isVisible: parsed.data.isVisible ?? true  ,
      labelOverride: parsed.data.labelOverride ?? null,
      targetMode: parsed.data.targetMode ?? "ALL_PARENTS",
      blinkEnabled: parsed.data.blinkEnabled ?? true,
      blinkSeconds: parsed.data.blinkSeconds ?? 60,
      targets: {
        create:
          parsed.data.targetUserIds?.map((userId) => ({
            userId,
          })) ?? [],
      },
    },
    include: {
      item: true,
      targets: true,
    },
  });

  res.json({ ok: true, item: mapNode(node) });
});

router.patch("/v1/child-home/nodes/:id", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  if (device.user.role !== "PARENT") {
    return res.status(403).json({ error: "Only parents can edit child home" });
  }

  const paramsParsed = ChildHomeNodeIdParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) return res.status(400).json(paramsParsed.error);

  const bodyParsed = UpdateChildHomeNodeSchema.safeParse(req.body);
  if (!bodyParsed.success) return res.status(400).json(bodyParsed.error);

  const existing = await prisma.childHomeNode.findFirst({
    where: {
      id: paramsParsed.data.id,
      familyId: device.user.familyId,
    },
  });

  if (!existing) return res.status(404).json({ error: "Node not found" });

  if (existing.section !== "CONVERSATION" && hasGridFields(bodyParsed.data)) {
    return res
      .status(400)
      .json({ error: "gridRow, gridCol and color are only allowed in section CONVERSATION" });
  }

  // Section is immutable; a type change must stay valid for the node's section
  // (CONVERSATION may switch MENU <-> WORD; HOME stays MENU/ACTION).
  if (
    bodyParsed.data.type &&
    !typeAllowedInSection(existing.section, bodyParsed.data.type)
  ) {
    return res.status(400).json({
      error: `type ${bodyParsed.data.type} is not allowed in section ${existing.section}`,
    });
  }

  if (bodyParsed.data.itemId) {
    const item = await prisma.familyLibraryItem.findFirst({
      where: {
        id: bodyParsed.data.itemId,
        familyId: device.user.familyId,
      },
    });

    if (!item) return res.status(404).json({ error: "Library item not found" });
  }

  if (bodyParsed.data.parentId) {
    // Parent must be a MENU in the same family AND the same (immutable) section.
    const parent = await prisma.childHomeNode.findFirst({
      where: {
        id: bodyParsed.data.parentId,
        familyId: device.user.familyId,
        section: existing.section,
        type: "MENU",
      },
    });

    if (!parent) return res.status(404).json({ error: "Parent menu not found" });
  }

  if (existing.section === "CONVERSATION") {
    // CONVERSATION nodes ignore visibility/target/blink: never create targets,
    // never fail when those fields are sent; leave them at their defaults.
    //
    // Grid moves: into an empty cell just moves; onto a sibling's cell in the
    // same page swaps the two nodes; onto an occupied cell in another page is
    // 409 (no swap across pages). A node that keeps its cell but changes page
    // must also find that cell free.
    const data = bodyParsed.data;
    const familyId = device.user.familyId;

    try {
      const result = await prisma.$transaction(async (tx) => {
        await lockConversationSection(tx, familyId);

        // Re-read under the lock: positions may have moved since the check above.
        const current = await tx.childHomeNode.findUnique({
          where: { id: existing.id },
        });
        if (!current) throw new HttpError(404, { error: "Node not found" });

        const parentId =
          data.parentId === undefined ? current.parentId : data.parentId;
        const parentChanged = parentId !== current.parentId;

        const gridRow = data.gridRow === undefined ? current.gridRow : data.gridRow;
        const gridCol = data.gridCol === undefined ? current.gridCol : data.gridCol;

        const include = { item: true, targets: true } as const;
        let swapped = null;

        if (
          gridRow !== null &&
          gridCol !== null &&
          (data.gridRow !== undefined || parentChanged)
        ) {
          const occupant = await tx.childHomeNode.findFirst({
            where: {
              familyId,
              section: "CONVERSATION",
              parentId,
              gridRow,
              gridCol,
              id: { not: current.id },
            },
            select: { id: true },
          });

          if (occupant) {
            if (parentChanged) throw new HttpError(409, { error: "CELL_OCCUPIED" });

            // Same page: the occupant takes this node's previous cell.
            swapped = await tx.childHomeNode.update({
              where: { id: occupant.id },
              data: {
                gridRow: current.gridRow,
                gridCol: current.gridCol,
                sortOrder:
                  current.gridRow !== null && current.gridCol !== null
                    ? gridSortOrder(current.gridRow, current.gridCol)
                    : current.sortOrder,
              },
              include,
            });
          }
        }

        const node = await tx.childHomeNode.update({
          where: { id: current.id },
          data: {
            itemId: data.itemId,
            parentId: data.parentId === undefined ? undefined : data.parentId,
            type: data.type,
            labelOverride: data.labelOverride,
            gridRow,
            gridCol,
            color: data.color,
            sortOrder:
              gridRow !== null && gridCol !== null
                ? gridSortOrder(gridRow, gridCol)
                : data.sortOrder,
          },
          include,
        });

        return { node, swapped };
      });

      return res.json({
        ok: true,
        item: mapNode(result.node),
        ...(result.swapped && { swapped: mapNode(result.swapped) }),
      });
    } catch (e) {
      if (e instanceof HttpError) return res.status(e.status).json(e.body);
      throw e;
    }
  }

  // HOME (unchanged behaviour)
  if (
    bodyParsed.data.targetUserIds !== undefined ||
    bodyParsed.data.targetMode === "SELECTED_USERS"
  ) {
    const ok = await validateTargetUsers(
      device.user.familyId,
      bodyParsed.data.targetUserIds
    );

    if (!ok) return res.status(400).json({ error: "Invalid target users" });
  }

  const node = await prisma.$transaction(async (tx) => {
    if (bodyParsed.data.targetUserIds) {
      await tx.childHomeNodeTarget.deleteMany({
        where: { nodeId: existing.id },
      });

      await tx.childHomeNodeTarget.createMany({
        data: bodyParsed.data.targetUserIds.map((userId) => ({
          nodeId: existing.id,
          userId,
        })),
      });
    }

    return tx.childHomeNode.update({
      where: { id: existing.id },
      data: {
        itemId: bodyParsed.data.itemId,
        parentId:
          bodyParsed.data.parentId === undefined
            ? undefined
            : bodyParsed.data.parentId,
        type: bodyParsed.data.type,
        isVisible: bodyParsed.data.isVisible,
        labelOverride: bodyParsed.data.labelOverride,
        sortOrder: bodyParsed.data.sortOrder,
        targetMode: bodyParsed.data.targetMode,
        blinkEnabled: bodyParsed.data.blinkEnabled,
        blinkSeconds: bodyParsed.data.blinkSeconds,
      },
      include: {
        item: true,
        targets: true,
      },
    });
  });

  res.json({ ok: true, item: mapNode(node) });
});

router.delete("/v1/child-home/nodes/:id", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  if (device.user.role !== "PARENT") {
    return res.status(403).json({ error: "Only parents can edit child home" });
  }

  const parsed = ChildHomeNodeIdParamsSchema.safeParse(req.params);
  if (!parsed.success) return res.status(400).json(parsed.error);

  const node = await prisma.childHomeNode.findFirst({
    where: {
      id: parsed.data.id,
      familyId: device.user.familyId,
    },
  });

  if (!node) return res.status(404).json({ error: "Node not found" });

    const childrenCount = await prisma.childHomeNode.count({
    where: {
      familyId: device.user.familyId,
      parentId: node.id,
    },
  });

  if (childrenCount > 0) {
    return res.status(409).json({ error: "Delete child nodes first" });
  }

  await prisma.$transaction(async (tx) => {
    await tx.childHomeNodeTarget.deleteMany({
      where: { nodeId: node.id },
    });


    await tx.childHomeNode.delete({
      where: { id: node.id },
    });
  });

  res.json({ ok: true });
});

router.post("/v1/child-home/actions/:id/request", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const parsed = ChildHomeNodeIdParamsSchema.safeParse(req.params);
  if (!parsed.success) return res.status(400).json(parsed.error);

  const node = await prisma.childHomeNode.findFirst({
    where: {
      id: parsed.data.id,
      familyId: device.user.familyId,
    },
    include: {
      item: true,
      targets: true,
    },
  });

  if (!node) return res.status(404).json({ error: "Action not found" });

  // CONVERSATION nodes are not actionable.
  if (node.section === "CONVERSATION") {
    return res.status(400).json({ error: "CONVERSATION nodes cannot be requested" });
  }

  if (node.type !== "ACTION") return res.status(404).json({ error: "Action not found" });

  type Recipient = { id: string; deviceIds: string[] };
  let recipients: Recipient[] = [];

  const toRecipients = (users: Array<{ id: string; deviceUsers: Array<{ device: { deviceId: string } }> }>): Recipient[] =>
    users.map((u) => ({ id: u.id, deviceIds: u.deviceUsers.map((du) => du.device.deviceId) }));

  if (node.targetMode === "ALL_PARENTS") {
    const users = await prisma.user.findMany({
      where: { familyId: device.user.familyId, role: "PARENT" },
      include: { deviceUsers: { include: { device: { select: { deviceId: true } } } } },
    });
    recipients = toRecipients(users);
  } else if (node.targetMode === "SELECTED_USERS") {
    const userIds = node.targets.map((t: any) => t.userId);
    const users = await prisma.user.findMany({
      where: { familyId: device.user.familyId, id: { in: userIds }, role: "PARENT" },
      include: { deviceUsers: { include: { device: { select: { deviceId: true } } } } },
    });
    recipients = toRecipients(users);
  }

  const requestCard = {
    id: node.item.id,
    label: node.item.label,
    source: node.item.source,
    sourceRef: node.item.sourceRef,
    imageUrl: buildLibraryItemImageUrl(node.item),
  };

  const cType = "aac_message_available";

  for (const recipient of recipients) {
    const message = await prisma.aacMessage.create({
      data: {
        familyId: device.user.familyId,
        fromUserId: device.user.id,
        toUserId: recipient.id,
        message: [requestCard],
        suggestedReplies: [],
      },
    });

    for (const deviceId of recipient.deviceIds) {
      await prisma.command.create({
        data: { deviceId, type: cType, payload: { messageId: message.id }, status: "queued" },
      });
      try {
        await pushSyncCommandsToDevice(deviceId, cType);
      } catch (e) {
        console.error("Failed to send FCM push for child request", e);
      }
    }
  }

  res.json({
    ok: true,
    sentCount: recipients.length,
    blinkEnabled: node.blinkEnabled,
    blinkSeconds: node.blinkSeconds,
  });
});