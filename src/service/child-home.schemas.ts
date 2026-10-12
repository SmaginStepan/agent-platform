import { z } from "zod";

// MENU/ACTION are the HOME types; WORD is CONVERSATION-only. Section/type
// compatibility is enforced in the route (it depends on the node's section).
export const ChildHomeNodeTypeSchema = z.enum(["MENU", "ACTION", "WORD"]);
export const ChildHomeSectionSchema = z.enum(["HOME", "CONVERSATION"]);
export const ChildHomeTargetModeSchema = z.enum([
  "ALL_PARENTS",
  "SELECTED_USERS",
  "NONE",
]);

// CONVERSATION-only word-class colours (null = default).
export const ConversationColorSchema = z.enum([
  "PRONOUN",
  "VERB",
  "NOUN",
  "DESCRIPTOR",
  "ADVERB",
  "PREPOSITION",
  "QUESTION",
  "NEGATION",
  "SOCIAL",
  "MISC",
  "FOLDER",
]);

// 0..99 so that sortOrder = gridRow * 100 + gridCol is unique and ordered.
export const GridIndexSchema = z.number().int().min(0).max(99);

const gridFields = {
  gridRow: GridIndexSchema.nullable().optional(),
  gridCol: GridIndexSchema.nullable().optional(),
  color: ConversationColorSchema.nullable().optional(),
};

// gridRow/gridCol come as a pair: both omitted, both null or both set.
function refineGridPair(
  v: { gridRow?: number | null; gridCol?: number | null },
  ctx: z.RefinementCtx
) {
  const kind = (x: number | null | undefined) =>
    x === undefined ? "absent" : x === null ? "null" : "set";
  if (kind(v.gridRow) !== kind(v.gridCol)) {
    ctx.addIssue({
      code: "custom",
      path: ["gridCol"],
      message: "gridRow and gridCol must be sent together",
    });
  }
}

export const GetChildHomeQuerySchema = z.object({
  section: ChildHomeSectionSchema.optional(),
  parentId: z.string().optional().nullable(),
});

export const CreateChildHomeNodeSchema = z.object({
  section: ChildHomeSectionSchema.optional(),
  itemId: z.string().min(1),
  parentId: z.string().nullable().optional(),
  type: ChildHomeNodeTypeSchema,
  sortOrder: z.number().int().optional(),
  labelOverride: z.string().trim().min(1).max(100).nullable().optional(),
  isVisible: z.boolean().optional(),

  targetMode: ChildHomeTargetModeSchema.optional(),
  targetUserIds: z.array(z.string()).optional(),

  blinkEnabled: z.boolean().optional(),
  blinkSeconds: z.number().int().min(0).max(600).optional(),

  ...gridFields,
}).superRefine(refineGridPair);

export const UpdateChildHomeNodeSchema = z.object({
  itemId: z.string().min(1).optional(),
  parentId: z.string().nullable().optional(),
  type: ChildHomeNodeTypeSchema.optional(),
  sortOrder: z.number().int().optional(),
  labelOverride: z.string().trim().min(1).max(100).nullable().optional(),
  isVisible: z.boolean().optional(),

  targetMode: ChildHomeTargetModeSchema.optional(),
  targetUserIds: z.array(z.string()).optional(),

  blinkEnabled: z.boolean().optional(),
  blinkSeconds: z.number().int().min(0).max(600).optional(),

  ...gridFields,
}).superRefine(refineGridPair);

export const ChildHomeNodeIdParamsSchema = z.object({
  id: z.string().min(1),
});