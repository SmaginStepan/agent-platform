import { z } from "zod";

export const ChildHomeNodeTypeSchema = z.enum(["MENU", "ACTION"]);
export const ChildHomeTargetModeSchema = z.enum([
  "ALL_PARENTS",
  "SELECTED_USERS",
  "NONE",
]);

export const GetChildHomeQuerySchema = z.object({
  parentId: z.string().optional().nullable(),
});

export const CreateChildHomeNodeSchema = z.object({
  itemId: z.string().min(1),
  parentId: z.string().nullable().optional(),
  type: ChildHomeNodeTypeSchema,
  sortOrder: z.number().int().optional(),

  targetMode: ChildHomeTargetModeSchema.optional(),
  targetUserIds: z.array(z.string()).optional(),

  blinkEnabled: z.boolean().optional(),
  blinkSeconds: z.number().int().min(0).max(600).optional(),
});

export const UpdateChildHomeNodeSchema = z.object({
  itemId: z.string().min(1).optional(),
  parentId: z.string().nullable().optional(),
  type: ChildHomeNodeTypeSchema.optional(),
  sortOrder: z.number().int().optional(),
  labelOverride: z.string().trim().min(1).max(100).nullable().optional(),

  targetMode: ChildHomeTargetModeSchema.optional(),
  targetUserIds: z.array(z.string()).optional(),

  blinkEnabled: z.boolean().optional(),
  blinkSeconds: z.number().int().min(0).max(600).optional(),
});

export const ChildHomeNodeIdParamsSchema = z.object({
  id: z.string().min(1),
});