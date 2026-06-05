import { prisma } from "../lib/prisma.js";
import { pushSyncCommandsToDevice } from "../lib/firebase.js";

let running = false;

function hhmmNow(date = new Date()): string {
  return date.toTimeString().slice(0, 5);
}

function weekdayNow(date = new Date()): number {
  const jsDay = date.getDay(); // 0 Sunday
  return jsDay === 0 ? 7 : jsDay; // 1 Monday ... 7 Sunday
}

function dateOnlyNow(date = new Date()): Date {
  return new Date(date.toISOString().slice(0, 10));
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

async function runScheduleTick() {
  if (running) return;
  running = true;

  try {
    const now = new Date();
    const time = hhmmNow(now);
    const weekday = weekdayNow(now);
    const today = dateOnlyNow(now);

    const families = await prisma.family.findMany({
      select: { id: true },
    });

    for (const family of families) {
      const items = await prisma.scheduleItem.findMany({
        where: {
          familyId: family.id,
          isEnabled: true,
          time: { lte: time },
          OR: [
            { mode: "DATE", date: today },
            { mode: "WEEKDAY", weekday },
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
          user: {
            familyId: family.id,
            role: "CHILD",
          },
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