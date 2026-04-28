import { authDevice } from "../lib/auth.utils.js";
import { buildArasaacImageUrl, buildArasaacSearchUrl } from "../lib/url.helpers.js";
import { router } from "../router.js";
import { ArasaacSearchQuerySchema } from "../service/family.schemas.js";

const DEFAULT_ARASAAC_LANG = process.env.ARASAAC_LANG || "en";

function normalizeArasaacLang(value: unknown): string {
  const lang = String(value || "").trim().toLowerCase();

  if (["en", "es", "ru"].includes(lang)) return lang;

  return DEFAULT_ARASAAC_LANG;
}

router.get("/v1/arasaac/search", async (req, res) => {
  const device = await authDevice(req);
  if (!device) return res.status(401).json({ error: "Unauthorized" });

  const parsed = ArasaacSearchQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json(parsed.error);

  const q = parsed.data.q.trim();
  if (!q) return res.json({ items: [] });

  try {
    const lang = normalizeArasaacLang(req.query.lang);
    const url = buildArasaacSearchUrl(q, lang);
    const response = await fetch(url, {
      headers: {
        "accept": "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("ARASAAC search failed", response.status, text);
      return res.status(502).json({ error: "ARASAAC search failed" });
    }

    const raw = await response.json();

    /**
     * Тут deliberately мягкий mapper, потому что форма ответа ARASAAC
     * может отличаться в зависимости от endpoint/version.
     */
    const sourceItems = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.items)
        ? raw.items
        : Array.isArray(raw?.pictograms)
          ? raw.pictograms
          : [];

    const items = sourceItems
      .map((item: any) => {
        const id = item?._id ?? item?.id ?? item?.pictogram ?? item?.pictogram_id;
        if (id == null) return null;

        const label = item?.keywords?.find?.((x: any) => x?.keyword)?.keyword ??
          item?.keyword ??
          item?.text ??
          item?.name ??
          String(id);

        return {
          id: String(id),
          label: String(label),
          imageUrl: buildArasaacImageUrl(id),
        };
      })
      .filter(Boolean);

    res.json({ items });
  } catch (e) {
    console.error("ARASAAC proxy error", e);
    res.status(502).json({ error: "ARASAAC proxy error" });
  }
});


