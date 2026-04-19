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

router.patch("/me/avatar", requireUser, async (req, res) => {
    const device = await authDevice(req);
    if (!device) return res.status(401).json({ error: "Unauthorized" });
    if (!device.user) {
    return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = device.user.id;

    const parsed = updateMyAvatarSchema.safeParse(req.body);

    if (!parsed.success) {
    return res.status(400).json({
        error: "Invalid body",
        details: parsed.error.flatten(),
    });
    }

    const { avatarItemId } = parsed.data;

    const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
        id: true,
        familyId: true,
    },
    });

    if (!user) {
    return res.status(404).json({ error: "User not found" });
    }

    if (!user.familyId) {
    return res.status(400).json({ error: "User is not in a family" });
    }

    if (avatarItemId !== null) {
    const item = await prisma.familyLibraryItem.findUnique({
        where: { id: avatarItemId },
        select: {
        id: true,
        familyId: true,
        },
    });

    if (!item || item.familyId !== user.familyId) {
        return res.status(400).json({
        error: "Library item not found in user's family",
        });
    }
    }

    const updated = await prisma.user.update({
    where: { id: userId },
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

    return res.json({
        ok: true,
        user: mapUserDto(updated),
    });
});

export default router;