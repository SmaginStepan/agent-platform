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

const AacCardSchema = z.object({
  id: z.string(),
  label: z.string(),
  imageUrl: z.string().nullable().optional(),
  source: z.string(),
  sourceRef: z.string().nullable().optional(),
  storageKey: z.string().nullable().optional(),
}).catchall(z.unknown());

const AacWaitStepSchema = z.object({
  type: z.literal("WAIT"),
  seconds: z.number().int().min(1).max(24 * 60 * 60),
});

const AacSuggestedReplySchema = z.union([
  AacCardSchema,
  AacWaitStepSchema,
]);

export const SendAacMessageSchema = z.object({
  targetUserId: z.string(),

  mode: z.enum(["NORMAL", "SEQUENCE"]).default("NORMAL"),

  cards: z.array(AacCardSchema),

  suggestedReplies: z.array(AacSuggestedReplySchema).default([]),
}).superRefine((data, ctx) => {
  if (data.mode === "SEQUENCE" && data.suggestedReplies.length < 2) {
    ctx.addIssue({
      code: "custom",
      path: ["suggestedReplies"],
      message: "SEQUENCE mode requires at least 2 steps",
    });
  }

  if (data.mode !== "SEQUENCE") {
    data.suggestedReplies.forEach((reply, index) => {
      if ("type" in reply && reply.type === "WAIT") {
        ctx.addIssue({
          code: "custom",
          path: ["suggestedReplies", index],
          message: "WAIT steps are allowed only in SEQUENCE mode",
        });
      }
    });
  }
});

export const AacMessageIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const SendAacReplySchema = z.object({
  reply: AacCardSchema,
});

export const GetAacMessagesQuerySchema = z.object({
  scope: z.enum(["all", "inbox", "outbox"]).optional().default("all"),
  fromUserId: z.string().min(1).optional(),
  toUserId: z.string().min(1).optional(),
});

export const UpdateNameSchema = z.object({
  name: z.string().trim().min(1).max(100),
});


export const updateMyAvatarSchema = z.object({
  avatarItemId: z.string().min(1).nullable(),
});