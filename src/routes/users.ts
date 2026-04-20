import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authDevice } from "../lib/auth.utils.js";
import { router } from "../router.js";
import { UserRole } from "@prisma/client";
import type express from "express";

async function requireUser(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  try {
    const device = await authDevice(req);

    if (!device) {
      return res.status(401).json({
        error: "Unauthorized",
      });
    }

    if (!device.user) {
      return res.status(401).json({
        error: "Unauthorized",
      });
    }

    (req as any).auth = {
      deviceId: device.id,
      userId: device.user.id,
      familyId: device.user.familyId,
      role: device.user.role,
      name: device.user.name,
    };

    next();
  } catch (e) {
    return res.status(500).json({
      error: "Auth failed",
    });
  }
}

async function updateUserAvatar(params: {
  actorUserId: string;
  targetUserId: string;
  avatarItemId: string | null;
  requireParentForOtherUser: boolean;
}) {
  const { actorUserId, targetUserId, avatarItemId, requireParentForOtherUser } = params;

  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: {
      id: true,
      familyId: true,
      role: true,
    },
  });

  if (!actor) {
    return {
      status: 404 as const,
      body: { error: "Actor user not found" },
    };
  }

  if (!actor.familyId) {
    return {
      status: 400 as const,
      body: { error: "Actor user is not in a family" },
    };
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      familyId: true,
    },
  });

  if (!targetUser) {
    return {
      status: 404 as const,
      body: { error: "Target user not found" },
    };
  }

  if (targetUser.familyId !== actor.familyId) {
    return {
      status: 403 as const,
      body: { error: "Target user is not in actor's family" },
    };
  }

  if (
    requireParentForOtherUser &&
    actor.id !== targetUser.id &&
    actor.role !== "PARENT"
  ) {
    return {
      status: 403 as const,
      body: { error: "Only parent can update another user's avatar" },
    };
  }

  if (avatarItemId !== null) {
    const item = await prisma.familyLibraryItem.findUnique({
      where: { id: avatarItemId },
      select: {
        id: true,
        familyId: true,
      },
    });

    if (!item || item.familyId !== actor.familyId) {
      return {
        status: 400 as const,
        body: { error: "Library item not found in actor's family" },
      };
    }
  }

  const updated = await prisma.user.update({
    where: { id: targetUser.id },
    data: {
      avatarItemId,
    },
    select: {
      id: true,
      familyId: true,
      role: true,
      name: true,
      avatarItemId: true,
      avatarItem: {
        select: {
          id: true,
        },
      },
    },
  });

  return {
    status: 200 as const,
    body: {
      ok: true,
      user: mapUserDto(updated),
    },
  };
}

function buildLibraryItemFileUrl(itemId: string): string {
  const baseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "") ?? "";
  return `${baseUrl}/v1/library/items/${itemId}/file`;
}

const updateMyAvatarSchema = z.object({
  avatarItemId: z.string().min(1).nullable(),
});

function mapUserDto(user: {
  id: string;
  familyId: string | null;
  role: UserRole;
  name: string | null;
  avatarItemId: string | null;
  avatarItem?: { id: string } | null;
}) {
  return {
    id: user.id,
    familyId: user.familyId,
    role: user.role,
    name: user.name,
    avatarItemId: user.avatarItemId,
    avatarImageUrl: user.avatarItem
      ? buildLibraryItemFileUrl(user.avatarItem.id)
      : null,
  };
}
router.patch("/v1/users/me/avatar", requireUser, async (req, res) => {
  const device = await authDevice(req);

  if (!device || !device.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = updateMyAvatarSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid body",
      details: parsed.error.flatten(),
    });
  }

  const result = await updateUserAvatar({
    actorUserId: device.user.id,
    targetUserId: device.user.id,
    avatarItemId: parsed.data.avatarItemId,
    requireParentForOtherUser: false,
  });

  return res.status(result.status).json(result.body);
});

router.patch("/v1/users/:userId/avatar", requireUser, async (req, res) => {
  const device = await authDevice(req);

  if (!device || !device.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = updateMyAvatarSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid body",
      details: parsed.error.flatten(),
    });
  }

  const rawUserId = req.params.userId;

  if (typeof rawUserId !== "string") {
    return res.status(400).json({
      error: "Invalid userId",
    });
  }

  const result = await updateUserAvatar({
    actorUserId: device.user.id,
    targetUserId: rawUserId,
    avatarItemId: parsed.data.avatarItemId,
    requireParentForOtherUser: true,
  });

  return res.status(result.status).json(result.body);
});

export default router;