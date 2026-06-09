
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
  return { ...deviceFields, user: du.user };
}
