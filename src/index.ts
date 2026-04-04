import express from "express";
import cors from "cors";
import crypto from "crypto";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { FamilyService } from "./family.service.js";
import {
  SendAacMessageSchema,
  SendAacReplySchema,
  AacMessageIdParamsSchema,
  ArasaacSearchQuerySchema,
  CreateCommandSchema,
  CreateFamilySchema,
  JoinFamilySchema,
  CreateInviteSchema,
  HeartbeatSchema,
  GetAacMessagesQuerySchema
} from "./family.schemas.js";
import path from "path";
import fs from "fs";
import multer from "multer";
import sharp from "sharp";
import { LocalStorageService } from "./storage.service.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
  log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["warn", "error"],
});

const familyService = new FamilyService(prisma);

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.resolve(process.cwd(), "uploads");
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 8080}`;

const storageService = new LocalStorageService(UPLOADS_DIR);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
});

function buildLibraryItemFileUrl(itemId: string): string {
  return `${PUBLIC_BASE_URL}/v1/library/items/${itemId}/file`;
}

function buildLibraryItemImageUrl(item: {
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

app.post("/v1/cards/family-photo/upload", upload.single("file"), async (req, res) => {
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

const ARASAAC_API_BASE = process.env.ARASAAC_API_BASE || "https://api.arasaac.org";
const ARASAAC_LANG = process.env.ARASAAC_LANG || "en";


function buildArasaacSearchUrl(query: string, lang: string) {
  const encoded = encodeURIComponent(query.trim());

  return `${ARASAAC_API_BASE}/v1/pictograms/${lang}/search/${encoded}`;
}

function buildArasaacImageUrl(id: string | number) {
  return `${ARASAAC_API_BASE}/v1/pictograms/${id}?download=false`;
}

function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

const BatterySchema = z.object({
  batteryPercent: z.number().int().min(0).max(100),
  isCharging: z.boolean(),
  reportedAt: z.string().datetime().optional(),
});

async function authDevice(req: express.Request) {
  const auth = req.header("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;

  const token = auth.slice("Bearer ".length).trim();
  const tokenHash = sha256(token);

  return prisma.device.findFirst({
    where: { tokenHash },
    include: {
      user: true,
    },
  });
}

app.get("/health", (_req, res) => res.json({ ok: true }));

const RegisterSchema = z.object({
  deviceId: z.string().min(2).max(64),
  name: z.string().max(128).optional(),
});

async function ensureBootstrapOwner() {
  // 1) пытаемся найти любую семью/пользователя (самый первый запуск)
  const existing = await prisma.user.findFirst({ where: { role: "PARENT" } });
  if (existing) return existing;

  // 2) если никого нет — создаём семью + пользователя-родителя
  const family = await prisma.family.create({ data: { name: "Family" } });
  return prisma.user.create({
    data: {
      familyId: family.id,
      role: "PARENT",
      name: "Owner",
    },
  });
}

app.post("/v1/devices/register", async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);

  const { deviceId, name } = parsed.data;
  const token = newToken();
  const tokenHash = sha256(token);

  // ensure we have at least one owner user to attach devices to
  const owner = await ensureBootstrapOwner();

  const device = await prisma.device.upsert({
    where: { deviceId },
    update: { name: name ?? null, tokenHash, userId: owner.id },
    create: { deviceId, name: name ?? null, tokenHash, userId: owner.id },
  });

  res.json({ deviceId: device.deviceId, token });
});

const TelemetrySchema = z.object({
  type: z.string().min(1).max(32),
  payload: z.record(z.string(), z.any()),
});

app.post("/v1/telemetry", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const parsed = TelemetrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);

  await prisma.telemetry.create({
    data: { deviceId: device.deviceId, type: parsed.data.type, payload: parsed.data.payload },
  });

  await prisma.device.update({
    where: { deviceId: device.deviceId },
    data: { lastSeenAt: new Date() },
  });

  res.json({ ok: true });
});

app.get("/v1/devices/:deviceId/status", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });
  if (device.deviceId !== req.params.deviceId) return res.status(403).json({ error: "Forbidden" });

  const lastBattery = await prisma.telemetry.findFirst({
    where: { deviceId: device.deviceId, type: "battery" },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    deviceId: device.deviceId,
    name: device.name,
    lastSeenAt: device.lastSeenAt,
    battery: lastBattery?.payload ?? null,
    batteryAt: lastBattery?.createdAt ?? null,
  });
});

app.post("/v1/battery", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const parsed = BatterySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);

  const reportedAt = parsed.data.reportedAt ? new Date(parsed.data.reportedAt) : null;

  await prisma.deviceState.upsert({
    where: { deviceId: device.deviceId },
    update: {
      batteryPercent: parsed.data.batteryPercent,
      isCharging: parsed.data.isCharging,
      reportedAt,
    },
    create: {
      deviceId: device.deviceId,
      batteryPercent: parsed.data.batteryPercent,
      isCharging: parsed.data.isCharging,
      reportedAt,
    },
  });

  await prisma.device.update({
    where: { deviceId: device.deviceId },
    data: { lastSeenAt: new Date() },
  });

  // опционально: история
  await prisma.telemetry.create({
    data: { deviceId: device.deviceId, type: "battery", payload: parsed.data },
  });

  res.json({ ok: true });
});

app.get("/v1/commands/pending", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const items = await prisma.command.findMany({
    where: { deviceId: device.deviceId, status: "queued" },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  res.json({ items });
});

app.post("/v1/commands/:id/ack", async (req, res) => {
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

app.post("/v1/families/create", async (req, res) => {
  const parsed = CreateFamilySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);

  try {
    const result = await familyService.createFamily(parsed.data);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create family" });
  }
});

app.post("/v1/invites", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const parsed = CreateInviteSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json(parsed.error);

  try {
    const result = await familyService.createInvite(
      device.deviceId,
      parsed.data.role,
      parsed.data.expiresInMinutes ?? 60
    );
    res.json(result);
  } catch (e: any) {
    console.error(e);
    if (e?.message === "DEVICE_NOT_FOUND") {
      return res.status(404).json({ error: "Device not found" });
    }
    res.status(500).json({ error: "Failed to create invite" });
  }
});

app.post("/v1/families/join", async (req, res) => {
  const parsed = JoinFamilySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);

  try {
    const result = await familyService.joinFamilyByCode(parsed.data);
    res.json(result);
  } catch (e: any) {
    console.error(e);

    if (e?.message === "INVITE_NOT_FOUND") {
      return res.status(404).json({ error: "Invite not found" });
    }
    if (e?.message === "INVITE_ALREADY_USED") {
      return res.status(409).json({ error: "Invite already used" });
    }
    if (e?.message === "INVITE_EXPIRED") {
      return res.status(410).json({ error: "Invite expired" });
    }

    res.status(500).json({ error: "Failed to join family" });
  }
});

app.get("/v1/families/me", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const family = await prisma.family.findUnique({
    where: { id: device.user.familyId },
    include: {
      users: {
        include: {
          devices: {
            include: {
              state: true
            },
            orderBy: { createdAt: "asc" }
          }
        },
        orderBy: { createdAt: "asc" }
      }
    }
  });

  res.json({
    family: {
      id: family?.id,
      name: family?.name
    },
    me: {
      userId: device.user.id,
      deviceId: device.deviceId,
      role: device.user.role
    },
    users: family?.users
  });
});

app.post("/v1/devices/heartbeat", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const parsed = HeartbeatSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json(parsed.error);

  const data = parsed.data;

  await prisma.device.update({
    where: { deviceId: device.deviceId },
    data: {
      lastSeenAt: new Date(),
      platform: data.platform ?? device.platform,
      model: data.model ?? device.model,
      osVersion: data.osVersion ?? device.osVersion,
      appVersion: data.appVersion ?? device.appVersion,
    },
  });

  if (
    data.batteryPercent !== undefined ||
    data.isCharging !== undefined ||
    data.reportedAt !== undefined
  ) {
    await prisma.deviceState.upsert({
      where: { deviceId: device.deviceId },
      update: {
        batteryPercent: data.batteryPercent ?? undefined,
        volumePercent: data.volumePercent ?? undefined,
        isCharging: data.isCharging ?? undefined,
        reportedAt: data.reportedAt ? new Date(data.reportedAt) : undefined,
      },
      create: {
        deviceId: device.deviceId,
        batteryPercent: data.batteryPercent ?? null,
        
        isCharging: data.isCharging ?? null,
        reportedAt: data.reportedAt ? new Date(data.reportedAt) : null,
      },
    });
  }

  res.json({ ok: true, now: new Date().toISOString() });
});

app.post("/v1/devices/:deviceId/commands", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  if (device.user.role !== "PARENT") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const parsed = CreateCommandSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);

  const target = await prisma.device.findUnique({
    where: { deviceId: req.params.deviceId },
    include: { user: true },
  });

  if (!target) return res.status(404).json({ error: "Device not found" });

  if (target.user.familyId !== device.user.familyId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const cmd = await prisma.command.create({
    data: {
      deviceId: target.deviceId,
      type: parsed.data.type,
      payload: parsed.data.payload,
      status: "queued",
    },
  });

  res.json({ ok: true, commandId: cmd.id });
});

app.get("/v1/arasaac/search", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const parsed = ArasaacSearchQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json(parsed.error);

  const q = parsed.data.q.trim();
  if (!q) return res.json({ items: [] });

  try {
    const url = buildArasaacSearchUrl(q, ARASAAC_LANG);
    const response = await fetch(url, {
      headers: {
        "accept": "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("ARASAAC search failed", response.status, text);
      return res.status(502).json({ error: "ARASAAC search failed" });
    }

    const raw = await response.json();

    /**
     * Тут deliberately мягкий mapper, потому что форма ответа ARASAAC
     * может отличаться в зависимости от endpoint/version.
     */
    const sourceItems = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.items)
      ? raw.items
      : Array.isArray(raw?.pictograms)
      ? raw.pictograms
      : [];

    const items = sourceItems
      .map((item: any) => {
        const id = item?._id ?? item?.id ?? item?.pictogram ?? item?.pictogram_id;
        if (id == null) return null;

        const label =
          item?.keywords?.find?.((x: any) => x?.keyword)?.keyword ??
          item?.keyword ??
          item?.text ??
          item?.name ??
          String(id);

        return {
          id: String(id),
          label: String(label),
          imageUrl: buildArasaacImageUrl(id),
        };
      })
      .filter(Boolean);

    res.json({ items });
  } catch (e) {
    console.error("ARASAAC proxy error", e);
    res.status(502).json({ error: "ARASAAC proxy error" });
  }
});

app.post("/v1/messages/aac", async (req, res) => {
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

app.get("/v1/messages/aac/:id", async (req, res) => {
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

app.post("/v1/messages/aac/:id/reply", async (req, res) => {
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

app.get("/v1/messages/aac", async (req, res) => {
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

type LibraryItemDto = {
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

function toLibraryItemDto(item: {
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

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function uniquePreserveOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

async function ensureItemIdsBelongToFamily(familyId: string, itemIds: string[]) {
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

async function ensureCoverBelongsToFamily(familyId: string, coverItemId: string | null) {
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

function pickSetCover(set: {
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

  const name =
    typeof req.body?.name === "string"
      ? req.body.name.trim()
      : undefined;

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

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal Server Error" });
});

const port = Number(process.env.PORT || 8080);
app.listen(port, "0.0.0.0", () => console.log(`API on :${port}`));
