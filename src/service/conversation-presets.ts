import fs from "fs";
import path from "path";
import { z } from "zod";
import { ConversationColorSchema, GridIndexSchema } from "./child-home.schemas.js";

// Read-only starter vocabularies for the CONVERSATION library, shipped as JSON
// in src/presets (served from the source tree like src/assets; tsc does not
// copy JSON into dist). Loaded and validated once at startup: an invalid file
// throws on import so the process fails loudly instead of serving bad data.

export type PresetCell = {
  type: "MENU" | "WORD";
  row: number;
  col: number;
  color: z.infer<typeof ConversationColorSchema>;
  arasaacId: number;
  label: Record<string, string>;
  page?: PresetPage;
};

export type PresetPage = {
  cols: number;
  rows: number;
  cells: PresetCell[];
};

const PresetCellSchema: z.ZodType<PresetCell> = z.lazy(() =>
  z.object({
    type: z.enum(["MENU", "WORD"]),
    row: GridIndexSchema,
    col: GridIndexSchema,
    color: ConversationColorSchema,
    arasaacId: z.number().int().positive(),
    label: z.record(z.string(), z.string()),
    page: PresetPageSchema.optional(),
  })
);

const PresetPageSchema: z.ZodType<PresetPage> = z.lazy(() =>
  z.object({
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
    cells: z.array(PresetCellSchema),
  })
);

const PresetFileSchema = z.object({
  id: z.string().min(1),
  version: z.number().int(),
  name: z.record(z.string(), z.string()),
  languages: z.array(z.string().min(1)).min(1),
  license: z.string(),
  colors: z.array(z.unknown()).optional(),
  root: PresetPageSchema,
});

export type ConversationPreset = z.infer<typeof PresetFileSchema> & {
  cardCount: number;
};

// Checks the rules the schema cannot express; returns the number of cells.
function checkPage(page: PresetPage, languages: string[], where: string): number {
  const cells = new Set<string>();
  let count = 0;

  page.cells.forEach((cell, i) => {
    const at = `${where}.cells[${i}]`;

    const key = `${cell.row},${cell.col}`;
    if (cells.has(key)) throw new Error(`${at}: duplicate cell row ${cell.row} col ${cell.col}`);
    cells.add(key);

    for (const lang of languages) {
      if (!cell.label[lang]?.trim()) throw new Error(`${at}: missing "${lang}" label`);
    }

    count++;
    if (cell.type === "MENU") {
      if (!cell.page) throw new Error(`${at}: MENU without page`);
      count += checkPage(cell.page, languages, `${at}.page`);
    } else if (cell.page) {
      throw new Error(`${at}: WORD must not have a page`);
    }
  });

  return count;
}

function loadPresets(): Map<string, ConversationPreset> {
  const dir = path.join(process.cwd(), "src/presets");
  const presets = new Map<string, ConversationPreset>();

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    try {
      const parsed = PresetFileSchema.safeParse(
        JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"))
      );
      if (!parsed.success) throw new Error(z.prettifyError(parsed.error));

      const cardCount = checkPage(parsed.data.root, parsed.data.languages, "root");

      if (presets.has(parsed.data.id)) throw new Error(`duplicate preset id ${parsed.data.id}`);
      presets.set(parsed.data.id, { ...parsed.data, cardCount });
    } catch (e: any) {
      throw new Error(`Invalid conversation preset ${file}: ${e?.message ?? e}`);
    }
  }

  if (presets.size === 0) throw new Error(`No conversation presets found in ${dir}`);
  return presets;
}

export const conversationPresets = loadPresets();

export const conversationPresetSummaries = [...conversationPresets.values()].map((p) => ({
  id: p.id,
  name: p.name,
  languages: p.languages,
  cardCount: p.cardCount,
  license: p.license,
}));

export const InstallPresetSchema = z.object({
  language: z.string().min(1),
  mode: z.enum(["EMPTY_ONLY", "REPLACE"]).optional(),
});
