import express from "express";
import { prisma } from "../index.js";
import crypto from "crypto";


export async function authDevice(req: express.Request) {
  const auth = req.header("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;

  const token = auth.slice("Bearer ".length).trim();
  const tokenHash = sha256(token);

  return prisma.device.findFirst({
    where: { tokenHash },
    include: {
      user: true,
    },
  });
}

export function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

