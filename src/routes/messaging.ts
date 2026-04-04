import { prisma } from "../lib/prisma.js";
import { authDevice } from "../lib/auth.utils.js";
import { AacMessageIdParamsSchema, GetAacMessagesQuerySchema, SendAacMessageSchema, SendAacReplySchema } from "../service/family.schemas.js";
import { router } from "../router.js";


router.get("/v1/commands/pending", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const items = await prisma.command.findMany({
    where: { deviceId: device.deviceId, status: "queued" },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  res.json({ items });
});router.post("/v1/commands/:id/ack", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const cmd = await prisma.command.findFirst({
    where: { id: req.params.id, deviceId: device.deviceId },
  });

  if (!cmd) return res.status(404).json({ error: "Not found" });

  await prisma.command.update({
    where: { id: cmd.id },
    data: {
      status: "acked",
      ackedAt: new Date(),
    },
  });

  res.json({ ok: true });
});
router.post("/v1/messages/aac", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const parsed = SendAacMessageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);

  const targetUser = await prisma.user.findFirst({
    where: {
      id: parsed.data.targetUserId,
      familyId: device.user.familyId,
    },
    include: {
      devices: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!targetUser) return res.status(404).json({ error: "Target user not found" });

  const targetDevice = targetUser.devices[0];
  if (!targetDevice) {
    return res.status(409).json({ error: "Target user has no devices" });
  }

  const message = await prisma.aacMessage.create({
    data: {
      familyId: device.user.familyId,
      fromUserId: device.user.id,
      toUserId: targetUser.id,
      message: parsed.data.cards,
      suggestedReplies: parsed.data.suggestedReplies ?? [],
    },
  });

  await prisma.command.create({
    data: {
      deviceId: targetDevice.deviceId,
      type: "aac_message_available",
      payload: {
        messageId: message.id,
      },
      status: "queued",
    },
  });

  res.json({ ok: true, messageId: message.id });
});

router.get("/v1/messages/aac/:id", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const parsed = AacMessageIdParamsSchema.safeParse(req.params);
  if (!parsed.success) return res.status(400).json(parsed.error);

  const message = await prisma.aacMessage.findFirst({
    where: {
      id: parsed.data.id,
      familyId: device.user.familyId,
    },
    include: {
      fromUser: true,
      toUser: true,
      reply: true,
    },
  });

  if (!message) return res.status(404).json({ error: "Message not found" });

  res.json({
    id: message.id,
    fromUser: {
      id: message.fromUser.id,
      name: message.fromUser.name ?? "",
    },
    toUser: {
      id: message.toUser.id,
      name: message.toUser.name ?? "",
    },
    message: message.message,
    suggestedReplies: message.suggestedReplies,
    reply: message.reply
      ? {
        id: message.reply.id,
        reply: message.reply.reply,
        createdAt: message.reply.createdAt.toISOString(),
      }
      : null,
    createdAt: message.createdAt.toISOString(),
    answeredAt: message.answeredAt?.toISOString() ?? null,
  });
});

router.post("/v1/messages/aac/:id/reply", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const paramsParsed = AacMessageIdParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) return res.status(400).json(paramsParsed.error);

  const bodyParsed = SendAacReplySchema.safeParse(req.body);
  if (!bodyParsed.success) return res.status(400).json(bodyParsed.error);

  const message = await prisma.aacMessage.findFirst({
    where: {
      id: paramsParsed.data.id,
      familyId: device.user.familyId,
    },
    include: {
      fromUser: {
        include: {
          devices: {
            orderBy: { createdAt: "asc" },
          },
        },
      },
      toUser: true,
      reply: true,
    },
  });

  if (!message) return res.status(404).json({ error: "Message not found" });

  if (message.toUserId !== device.user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (message.reply) {
    return res.status(409).json({ error: "Message already answered" });
  }

  const senderDevice = message.fromUser.devices[0];
  if (!senderDevice) {
    return res.status(409).json({ error: "Sender has no devices" });
  }

  const reply = await prisma.aacReply.create({
    data: {
      messageId: message.id,
      fromUserId: device.user.id,
      toUserId: message.fromUserId,
      reply: bodyParsed.data.reply,
    },
  });

  await prisma.aacMessage.update({
    where: { id: message.id },
    data: {
      answeredAt: new Date(),
    },
  });

  await prisma.command.create({
    data: {
      deviceId: senderDevice.deviceId,
      type: "aac_reply_available",
      payload: {
        messageId: message.id,
      },
      status: "queued",
    },
  });

  res.json({ ok: true, replyId: reply.id });
});

router.get("/v1/messages/aac", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const parsed = GetAacMessagesQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json(parsed.error);

  const { scope, fromUserId, toUserId } = parsed.data;

  const where: any = {
    familyId: device.user.familyId,
  };

  if (scope === "inbox") {
    where.toUserId = device.user.id;
  } else if (scope === "outbox") {
    where.fromUserId = device.user.id;
  }

  if (fromUserId) {
    where.fromUserId = fromUserId;
  }

  if (toUserId) {
    where.toUserId = toUserId;
  }

  const items = await prisma.aacMessage.findMany({
    where,
    orderBy: {
      createdAt: "desc",
    },
    include: {
      fromUser: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
      toUser: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
      reply: true,
    },
  });

  return res.json({
    ok: true,
    items: items.map((m) => ({
      id: m.id,
      familyId: m.familyId,

      fromUserId: m.fromUserId,
      toUserId: m.toUserId,

      fromUser: m.fromUser
        ? {
          id: m.fromUser.id,
          name: m.fromUser.name,
          role: m.fromUser.role,
        }
        : null,

      toUser: m.toUser
        ? {
          id: m.toUser.id,
          name: m.toUser.name,
          role: m.toUser.role,
        }
        : null,

      message: m.message,
      suggestedReplies: m.suggestedReplies,

      reply: m.reply
        ? {
          id: m.reply.id,
          messageId: m.reply.messageId,
          fromUserId: m.reply.fromUserId,
          reply: m.reply.reply,
          createdAt: m.reply.createdAt,
        }
        : null,

      createdAt: m.createdAt,
      answeredAt: m.answeredAt,
    })),
  });
});

