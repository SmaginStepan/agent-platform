import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { authDevice } from "../lib/auth.utils.js";
import { router } from "../router.js";
import {
  CreateScheduleItemSchema,
  ScheduleItemIdParamsSchema,
  UpdateScheduleItemSchema,
} from "../service/family.schemas.js";

router.get("/v1/schedule/items", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const items = await prisma.scheduleItem.findMany({
    where: {
      familyId: device.user.familyId,
    },
    orderBy: [
      { mode: "asc" },
      { weekday: "asc" },
      { date: "asc" },
      { time: "asc" },
      { sortOrder: "asc" },
    ],
  });

  res.json({ ok: true, items });
});

router.post("/v1/schedule/items", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const parsed = CreateScheduleItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);

  const item = await prisma.scheduleItem.create({
    data: {
      familyId: device.user.familyId,
      mode: parsed.data.mode,
      weekday: parsed.data.mode === "WEEKDAY" ? parsed.data.weekday : null,
      date: parsed.data.mode === "DATE" ? new Date(parsed.data.date!) : null,
      time: parsed.data.time,
      cards: parsed.data.cards as Prisma.InputJsonValue,
      sortOrder: parsed.data.sortOrder ?? 0,
      isEnabled: parsed.data.isEnabled ?? true,
    },
  });

  res.json({ ok: true, item });
});

router.patch("/v1/schedule/items/:id", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const paramsParsed = ScheduleItemIdParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) return res.status(400).json(paramsParsed.error);

  const bodyParsed = UpdateScheduleItemSchema.safeParse(req.body);
  if (!bodyParsed.success) return res.status(400).json(bodyParsed.error);

  const existing = await prisma.scheduleItem.findFirst({
    where: {
      id: paramsParsed.data.id,
      familyId: device.user.familyId,
    },
  });

  if (!existing) return res.status(404).json({ error: "Schedule item not found" });

  const nextMode = bodyParsed.data.mode ?? existing.mode;

  const item = await prisma.scheduleItem.update({
    where: {
      id: existing.id,
    },
    data: {
      mode: bodyParsed.data.mode,

      weekday:
        nextMode === "WEEKDAY"
          ? bodyParsed.data.weekday ?? existing.weekday
          : null,

      date:
        nextMode === "DATE"
          ? bodyParsed.data.date
            ? new Date(bodyParsed.data.date)
            : existing.date
          : null,

      time: bodyParsed.data.time,
      cards: bodyParsed.data.cards as Prisma.InputJsonValue | undefined,
      sortOrder: bodyParsed.data.sortOrder,
      isEnabled: bodyParsed.data.isEnabled,
    },
  });

  res.json({ ok: true, item });
});

router.delete("/v1/schedule/items/:id", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const paramsParsed = ScheduleItemIdParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) return res.status(400).json(paramsParsed.error);

  const existing = await prisma.scheduleItem.findFirst({
    where: {
      id: paramsParsed.data.id,
      familyId: device.user.familyId,
    },
  });

  if (!existing) return res.status(404).json({ error: "Schedule item not found" });

  await prisma.scheduleItem.delete({
    where: {
      id: existing.id,
    },
  });

  res.json({ ok: true });
});