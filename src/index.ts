import express from "express";
import cors from "cors";
import crypto from "crypto";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { FamilyService } from "./family.service.js";
import { CreateCommandSchema, CreateFamilySchema, JoinFamilySchema, CreateInviteSchema, HeartbeatSchema } from "./family.schemas.js";

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

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal Server Error" });
});

const port = Number(process.env.PORT || 8080);
app.listen(port, "0.0.0.0", () => console.log(`API on :${port}`));
