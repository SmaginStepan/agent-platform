import { z } from "zod";

export const CreateFamilySchema = z.object({
  userName: z.string().trim().min(1).max(100),
  deviceName: z.string().trim().min(1).max(100),
  deviceId: z.string().trim().min(2).max(64),
  familyName: z.string().trim().min(1).max(100).optional(),
});

export const CreateInviteSchema = z.object({
  expiresInMinutes: z.number().int().min(1).max(60 * 24 * 30).optional(),
  role: z.enum(["PARENT", "CHILD"]),
});

export const JoinFamilySchema = z.object({
  code: z.string().trim().min(4).max(32),
  userName: z.string().trim().min(1).max(100),
  deviceName: z.string().trim().min(1).max(100),
  deviceId: z.string().trim().min(2).max(64),
});

export const CreateCommandSchema = z.object({
  type: z.string().min(1).max(32),
  payload: z.record(z.string(), z.any()),
});

export const HeartbeatSchema = z.object({
  batteryPercent: z.number().int().min(0).max(100).optional(),
  volumePercent: z.number().int().min(0).max(100).optional(),
  isCharging: z.boolean().optional(),
  reportedAt: z.string().datetime().optional(),

  platform: z.string().max(32).optional(),
  model: z.string().max(128).optional(),
  osVersion: z.string().max(64).optional(),
  appVersion: z.string().max(64).optional(),
});

export const ArasaacSearchQuerySchema = z.object({
  q: z.string().trim().min(1),
});

export const SendAacMessageSchema = z.object({
  targetUserId: z.string().min(1),
  cards: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      imageUrl: z.string().url(),
    })
  ).min(1),
});

