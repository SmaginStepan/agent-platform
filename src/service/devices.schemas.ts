import { z } from "zod";

export const BatterySchema = z.object({
  batteryPercent: z.number().int().min(0).max(100),
  isCharging: z.boolean(),
  reportedAt: z.string().datetime().optional(),
});

export const RegisterSchema = z.object({
  deviceId: z.string().min(2).max(64),
  name: z.string().max(128).optional(),
});

export const TelemetrySchema = z.object({
  type: z.string().min(1).max(32),
  payload: z.record(z.string(), z.any()),
});

export const UpdateFcmTokenSchema = z.object({
  fcmToken: z.string().min(1).max(4096),
});