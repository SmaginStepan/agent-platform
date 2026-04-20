import { authDevice } from "../lib/auth.utils.js";
import { prisma } from "../lib/prisma.js";
import { router } from "../router.js";
import { CreateFamilySchema, CreateInviteSchema, JoinFamilySchema, UpdateNameSchema } from "../service/family.schemas.js";
import { FamilyService } from "../service/family.service.js";

export const familyService = new FamilyService(prisma);

function buildLibraryItemFileUrl(itemId: string): string {
  const baseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "") ?? "";
  return `${baseUrl}/v1/library/items/${itemId}/file`;
}

router.post("/v1/families/create", async (req, res) => {
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

router.post("/v1/invites", async (req, res) => {
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

router.post("/v1/families/join", async (req, res) => {
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

router.get("/v1/families/me", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const family = await prisma.family.findUnique({
    where: { id: device.user.familyId },
    include: {
      users: {
        include: {
          avatarItem: {
            select: {
              id: true,
            },
          },
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
    users: family?.users.map((user) => ({
      id: user.id,
      familyId: user.familyId,
      role: user.role,
      name: user.name,
      avatarItemId: user.avatarItemId,
      avatarImageUrl: user.avatarItem
        ? buildLibraryItemFileUrl(user.avatarItem.id)
        : null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      devices: user.devices,
    }))
  });
});


router.patch("/v1/families/me", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const parsed = UpdateNameSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);

  try {
    const family = await prisma.family.update({
      where: { id: device.user.familyId },
      data: { name: parsed.data.name },
      select: { id: true, name: true },
    });

    return res.json({ ok: true, family });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to update family" });
  }
});

router.patch("/v1/users/:userId", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  if (device.user.role !== "PARENT") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const parsed = UpdateNameSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);

  try {
    const user = await prisma.user.findFirst({
      where: {
        id: req.params.userId,
        familyId: device.user.familyId,
      },
      select: { id: true },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { name: parsed.data.name },
      select: { id: true, name: true, role: true },
    });

    return res.json({ ok: true, user: updated });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to update user" });
  }
});
