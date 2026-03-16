import { z } from "zod";

export const CreateFamilySchema = z.object({
  userName: z.string().trim().min(1).max(100),
  deviceName: z.string().trim().min(1).max(100),
  deviceId: z.string().trim().min(2).max(64),
  familyName: z.string().trim().min(1).max(100).optional(),
});

export const CreateInviteSchema = z.object({
  expiresInMinutes: z.number().int().min(1).max(60 * 24 * 30).optional(),
});

export const JoinFamilySchema = z.object({
  code: z.string().trim().min(4).max(32),
  userName: z.string().trim().min(1).max(100),
  deviceName: z.string().trim().min(1).max(100),
  deviceId: z.string().trim().min(2).max(64),
});