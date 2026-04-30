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

function mapNode(node: any) {
  return {
    id: node.id,
    familyId: node.familyId,
    itemId: node.itemId,
    parentId: node.parentId,
    type: node.type,
    sortOrder: node.sortOrder,
    labelOverride: node.labelOverride,
    targetMode: node.targetMode,
    blinkEnabled: node.blinkEnabled,
    blinkSeconds: node.blinkSeconds,
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

  const parentId =
    parsed.data.parentId === undefined || parsed.data.parentId === ""
      ? null
      : parsed.data.parentId;

  const nodes = await prisma.childHomeNode.findMany({
    where: {
      familyId: device.user.familyId,
      parentId,
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
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

  const item = await prisma.familyLibraryItem.findFirst({
    where: {
      id: parsed.data.itemId,
      familyId: device.user.familyId,
    },
  });

  if (!item) return res.status(404).json({ error: "Library item not found" });

  if (parsed.data.parentId) {
    const parent = await prisma.childHomeNode.findFirst({
      where: {
        id: parsed.data.parentId,
        familyId: device.user.familyId,
        type: "MENU",
      },
    });

    if (!parent) return res.status(404).json({ error: "Parent menu not found" });
  }

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
      parentId: parsed.data.parentId ?? null,
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
    const parent = await prisma.childHomeNode.findFirst({
      where: {
        id: bodyParsed.data.parentId,
        familyId: device.user.familyId,
        type: "MENU",
      },
    });

    if (!parent) return res.status(404).json({ error: "Parent menu not found" });
  }

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
      type: "ACTION",
    },
    include: {
      item: true,
      targets: true,
    },
  });

  if (!node) return res.status(404).json({ error: "Action not found" });

  let recipients: Array<{ id: string; devices: Array<{ deviceId: string }> }> =
    [];

  if (node.targetMode === "ALL_PARENTS") {
    recipients = await prisma.user.findMany({
      where: {
        familyId: device.user.familyId,
        role: "PARENT",
      },
      include: {
        devices: true,
      },
    });
  } else if (node.targetMode === "SELECTED_USERS") {
    const userIds = node.targets.map((t: any) => t.userId);

    recipients = await prisma.user.findMany({
      where: {
        familyId: device.user.familyId,
        id: { in: userIds },
        role: "PARENT",
      },
      include: {
        devices: true,
      },
    });
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

    for (const targetDevice of recipient.devices) {
      await prisma.command.create({
        data: {
          deviceId: targetDevice.deviceId,
          type: cType,
          payload: {
            messageId: message.id,
          },
          status: "queued",
        },
      });

      try {
        await pushSyncCommandsToDevice(targetDevice.deviceId, cType);
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