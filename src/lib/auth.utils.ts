
import express from "express";
import { prisma } from "./prisma.js";
import crypto from "crypto";

export function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function newInviteCode(length = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export async function authDevice(req: express.Request) {
  const auth = req.header("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;

  const token = auth.slice("Bearer ".length).trim();
  const tokenHash = sha256(token);
  const requestedFamilyId = req.header("x-family-id") ?? null;

  const device = await prisma.device.findFirst({
    where: { tokenHash },
    include: {
      users: {
        include: { user: true },
        orderBy: { user: { createdAt: "asc" } },
      },
    },
  });

  if (!device || !device.users.length) return null;

  const du = requestedFamilyId
    ? device.users.find((du) => du.user.familyId === requestedFamilyId)
    : device.users[0];

  if (!du) return null;

  const { users: _users, ...deviceFields } = device;

  // Temporary "adult mode" elevation: a CHILD device that entered the family
  // PIN holds a short-lived elevation token on its DeviceUser row. When a
  // valid token is presented via the `x-elevation` header, the caller acts as
  // PARENT until it expires. `realRole` always exposes the underlying role so
  // callers that must gate on the real role (e.g. managing the PIN) can.
  const realRole = du.user.role;
  let user = du.user;
  let elevated = false;

  const now = new Date();
  const elevationHeader = req.header("x-elevation");
  const isExpired = du.elevationExpiresAt !== null && du.elevationExpiresAt <= now;

  if (
    elevationHeader &&
    !isExpired &&
    du.elevationTokenHash !== null &&
    du.elevationExpiresAt !== null &&
    du.elevationTokenHash === sha256(elevationHeader)
  ) {
    user = { ...du.user, role: "PARENT" };
    elevated = true;
  } else if (isExpired) {
    // Lazily clear an expired elevation the next time we encounter the row.
    await prisma.deviceUser.update({
      where: { deviceId_userId: { deviceId: du.deviceId, userId: du.userId } },
      data: { elevationTokenHash: null, elevationExpiresAt: null },
    });
  }

  return { ...deviceFields, user, realRole, elevated };
}
