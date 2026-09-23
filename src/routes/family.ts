import { authDevice, newToken, sha256 } from "../lib/auth.utils.js";
import { prisma } from "../lib/prisma.js";
import { router } from "../router.js";
import { CreateFamilySchema, CreateInviteSchema, JoinFamilySchema, UpdateFamilySchema, UpdateNameSchema } from "../service/family.schemas.js";
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
      device.user.familyId,
      device.user.id,
      parsed.data.role,
      parsed.data.expiresInMinutes ?? 60
    );
    res.json(result);
  } catch (e: any) {
    console.error(e);
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

router.get("/v1/me/families", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  // IMPORTANT: return the REAL roles from the user rows here. This must not
  // apply the x-elevation PARENT override (the client relies on these roles and
  // must not persist a temporarily elevated role), so we read roles straight
  // from the DeviceUser/user rows rather than from authDevice's resolved user.
  const memberships = await prisma.deviceUser.findMany({
    where: { deviceId: device.deviceId },
    include: {
      user: {
        select: { id: true, name: true, role: true, familyId: true },
      },
    },
  });

  const families = await prisma.family.findMany({
    where: { id: { in: memberships.map((m) => m.user.familyId) } },
    select: { id: true, name: true },
  });

  const familyMap = new Map(families.map((f) => [f.id, f]));

  return res.json({
    ok: true,
    families: memberships.map((m) => ({
      familyId: m.user.familyId,
      familyName: familyMap.get(m.user.familyId)?.name ?? null,
      userId: m.user.id,
      userName: m.user.name,
      role: m.user.role,
    })),
  });
});

router.get("/v1/families/me", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const family = await prisma.family.findUnique({
    where: { id: device.user.familyId },
    include: {
      users: {
        include: {
          avatarItem: { select: { id: true } },
          deviceUsers: { include: { device: { include: { state: true } } } },
        },
        orderBy: { createdAt: "asc" },
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
      devices: user.deviceUsers.map((du) => du.device),
    }))
  });
});


router.patch("/v1/families/me", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const parsed = UpdateFamilySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);

  // Setting/clearing the family PIN is a REAL-parent-only action: an elevated
  // CHILD (see authDevice x-elevation) must not be able to change the gate that
  // constrains it. Other fields (name/timezone) keep their existing behaviour.
  if (parsed.data.adultPin !== undefined && device.realRole !== "PARENT") {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const family = await prisma.family.update({
      where: { id: device.user.familyId },
      data: {
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.timezone !== undefined && { timezone: parsed.data.timezone }),
        ...(parsed.data.adultPin !== undefined && {
          adultPinHash: parsed.data.adultPin === "" ? null : sha256(parsed.data.adultPin),
        }),
      },
      select: { id: true, name: true, timezone: true },
    });

    return res.json({ ok: true, family });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to update family" });
  }
});

// --- Temporary "adult mode" elevation for CHILD devices ---
// A child device that enters the family PIN receives a short-lived elevation
// token; presenting it via the `x-elevation` header makes authDevice treat the
// caller as PARENT until it expires (4h).
const ELEVATION_TTL_MS = 4 * 60 * 60 * 1000;
const ELEVATION_MAX_FAILED_ATTEMPTS = 5;
const ELEVATION_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
// deviceId -> timestamps (ms) of recent failed PIN attempts (in-memory, best-effort)
const failedElevationAttempts = new Map<string, number[]>();

router.post("/v1/families/me/elevate", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const pin = (req.body as { pin?: unknown } | null)?.pin;
  if (typeof pin !== "string") return res.status(400).json({ error: "pin is required" });

  const family = await prisma.family.findUnique({
    where: { id: device.user.familyId },
    select: { adultPinHash: true },
  });

  if (!family?.adultPinHash) {
    return res.status(403).json({ error: "ADULT_MODE_NOT_ENABLED" });
  }

  const now = Date.now();
  const recent = (failedElevationAttempts.get(device.deviceId) ?? []).filter(
    (t) => now - t < ELEVATION_ATTEMPT_WINDOW_MS
  );

  if (recent.length >= ELEVATION_MAX_FAILED_ATTEMPTS) {
    failedElevationAttempts.set(device.deviceId, recent);
    return res.status(429).json({ error: "TOO_MANY_ATTEMPTS" });
  }

  if (sha256(pin) !== family.adultPinHash) {
    recent.push(now);
    failedElevationAttempts.set(device.deviceId, recent);
    return res.status(403).json({ error: "WRONG_PIN" });
  }

  // success: clear the failure counter and issue a fresh elevation token
  failedElevationAttempts.delete(device.deviceId);

  const elevationToken = newToken();
  const expiresAt = new Date(now + ELEVATION_TTL_MS);

  await prisma.deviceUser.update({
    where: { deviceId_userId: { deviceId: device.deviceId, userId: device.user.id } },
    data: {
      elevationTokenHash: sha256(elevationToken),
      elevationExpiresAt: expiresAt,
    },
  });

  return res.json({ ok: true, elevationToken, expiresAt: expiresAt.toISOString() });
});

router.delete("/v1/families/me/elevate", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  await prisma.deviceUser.update({
    where: { deviceId_userId: { deviceId: device.deviceId, userId: device.user.id } },
    data: { elevationTokenHash: null, elevationExpiresAt: null },
  });

  return res.json({ ok: true });
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

router.delete("/v1/users/:userId", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  // Destructive: require the REAL parent role, so a temporarily elevated
  // child (adult mode) cannot delete users.
  if (device.realRole !== "PARENT") {
    return res.status(403).json({ error: "REAL_PARENT_REQUIRED" });
  }

  const userId = req.params.userId;

  if (userId === device.user.id) {
    return res.status(400).json({ error: "Cannot delete current user" });
  }

  try {
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        familyId: device.user.familyId,
      },
      select: {
        id: true,
        role: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    await prisma.user.delete({
      where: { id: user.id },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to delete user" });
  }
});

router.delete("/v1/families/me", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  // Destructive: require the REAL parent role, so a temporarily elevated
  // child (adult mode) cannot delete the family.
  if (device.realRole !== "PARENT") {
    return res.status(403).json({ error: "REAL_PARENT_REQUIRED" });
  }

  try {
    await prisma.family.delete({
      where: {
        id: device.user.familyId,
      },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to delete family" });
  }
});