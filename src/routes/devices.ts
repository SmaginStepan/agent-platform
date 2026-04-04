import { app, prisma } from "../index.js";
import { TelemetrySchema } from "../service/devices.schemas.js";
import { RegisterSchema } from "../service/devices.schemas.js";
import { BatterySchema } from "../service/devices.schemas.js";
import { authDevice, newToken, sha256 } from "../lib/auth.utils.js";
import { CreateCommandSchema, HeartbeatSchema } from "../service/family.schemas.js";


export async function ensureBootstrapOwner() {
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
});app.get("/v1/devices/:deviceId/status", async (req, res) => {
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

  if (data.batteryPercent !== undefined ||
    data.isCharging !== undefined ||
    data.reportedAt !== undefined) {
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
