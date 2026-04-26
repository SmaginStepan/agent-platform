import express from "express";
import cors from "cors";
import "./routes/arasaac.js";
import "./routes/devices.js";
import "./routes/family.js";
import "./routes/library.js";
import "./routes/messaging.js";
import "./routes/users.js";
import "./routes/child-home.js";
import { router } from "./router.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use('/', router);

app.get("/health", (_req, res) => res.json({ ok: true }));


app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal Server Error" });
});


const port = Number(process.env.PORT || 8080);
app.listen(port, "0.0.0.0", () => console.log(`API on :${port}`));
