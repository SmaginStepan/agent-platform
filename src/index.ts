import express from "express";
import cors from "cors";
import crypto from "crypto";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function authDevice(req: express.Request) {
  const auth = req.header("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length).trim();
  const tokenHash = sha256(token);
  return prisma.device.findFirst({ where: { tokenHash } });
}

app.get("/health", (_req, res) => res.json({ ok: true }));

const RegisterSchema = z.object({
  deviceId: z.string().min(2).max(64),
  name: z.string().max(128).optional(),
});

app.post("/v1/devices/register", async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);

  const { deviceId, name } = parsed.data;
  const token = newToken();
  const tokenHash = sha256(token);

  const device = await prisma.device.upsert({
    where: { deviceId },
    update: { name, tokenHash },
    create: { deviceId, name, tokenHash },
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

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`API on :${port}`));
