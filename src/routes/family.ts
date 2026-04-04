import { prisma } from "../lib/prisma.js";
import { authDevice } from "../lib/auth.utils.js";
import { CreateFamilySchema, CreateInviteSchema, JoinFamilySchema } from "../service/family.schemas.js";
import { FamilyService } from "../service/family.service.js";
import { Router } from "express";

const app = Router();

export const familyService = new FamilyService(prisma);

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

