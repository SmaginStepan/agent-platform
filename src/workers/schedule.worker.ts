import { prisma } from "../lib/prisma.js";
import { pushSyncCommandsToDevice } from "../lib/firebase.js";

let running = false;

function localClock(now: Date, timezone: string): { time: string; weekday: number; dateISO: string } {
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone, ...opts }).format(now);

  const time = fmt({ hour: "2-digit", minute: "2-digit", hour12: false });
  const dateISO = fmt({ year: "numeric", month: "2-digit", day: "2-digit" }); // "YYYY-MM-DD" via en-CA

  // en-CA weekday: "Monday".."Sunday" → 1..7
  const dayName = fmt({ weekday: "long" });
  const dayIndex = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].indexOf(dayName);
  const weekday = dayIndex === -1 ? 1 : dayIndex + 1;

  return { time, weekday, dateISO };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

async function runScheduleTick() {
  if (running) return;
  running = true;

  try {
    const now = new Date();

    const families = await prisma.family.findMany({
      select: { id: true, timezone: true },
    });

    for (const family of families) {
      const { time, weekday, dateISO } = localClock(now, family.timezone ?? "UTC");
      const today = new Date(dateISO); // midnight UTC, same as how the create handler stores dates

      const items = await prisma.scheduleItem.findMany({
        where: {
          familyId: family.id,
          isEnabled: true,
          time: { lte: time },
          OR: [
            { mode: "DATE", date: today },
            { mode: "WEEKDAY", weekdays: { has: weekday } },
          ],
        },
        orderBy: [
          { mode: "asc" },
          { time: "desc" },
          { sortOrder: "desc" },
        ],
      });

      const active = items.find((x) => x.mode === "DATE") ?? items[0] ?? null;

      const state = await prisma.scheduleRuntimeState.upsert({
        where: { familyId: family.id },
        create: {
          familyId: family.id,
          activeScheduleItemId: null,
        },
        update: {},
      });

      const activeId = active?.id ?? null;

      if (state.activeScheduleItemId === activeId) continue;

      await prisma.$transaction(async (tx) => {
        if (active) {
          const forceShow = asStringArray(active.forceShowChildHomeNodeIds);
          const forceHide = asStringArray(active.forceHideChildHomeNodeIds);

          if (forceShow.length > 0) {
            await tx.childHomeNode.updateMany({
              where: {
                familyId: family.id,
                id: { in: forceShow },
              },
              data: { isVisible: true },
            });
          }

          if (forceHide.length > 0) {
            await tx.childHomeNode.updateMany({
              where: {
                familyId: family.id,
                id: { in: forceHide },
              },
              data: { isVisible: false },
            });
          }
        }

        await tx.scheduleRuntimeState.update({
          where: { familyId: family.id },
          data: { activeScheduleItemId: activeId },
        });
      });

      const childDevices = await prisma.device.findMany({
        where: {
          users: { some: { user: { familyId: family.id } } },
        },
      });

      for (const device of childDevices) {
        await prisma.command.create({
          data: {
            deviceId: device.deviceId,
            type: "child_home_schedule_applied",
            payload: {
              scheduleItemId: activeId,
            },
            status: "queued",
          },
        });

        await pushSyncCommandsToDevice(device.deviceId, "child_home_schedule_applied")
          .catch((e) => console.error("Failed to push schedule command", e));
      }
    }
  } finally {
    running = false;
  }
}

export function startScheduleWorker() {
  void runScheduleTick();
  setInterval(() => {
    void runScheduleTick();
  }, 60_000);
}