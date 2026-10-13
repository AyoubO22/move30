import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { config } from "./config.js";
import { q } from "./db.js";
import { HttpError, loadUser, csrfGuard } from "./security.js";
import { auth } from "./routes/auth.js";
import { me } from "./routes/me.js";
import { org } from "./routes/org.js";

const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        // Motion animates through inline style attributes.
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "https:"],
        "font-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
        "frame-ancestors": ["'self'", ...config.frameAncestors],
        "form-action": ["'self'"],
        "upgrade-insecure-requests": config.isProd ? [] : null,
      },
    },
    // Allow embedding in Microsoft Teams when configured; CSP frame-ancestors is the control.
    frameguard: config.frameAncestors.length ? false : { action: "sameorigin" },
    crossOriginEmbedderPolicy: false,
    hsts: config.isProd ? undefined : false,
  }));

  app.get("/healthz", async (_req, res) => {
    try { await q("SELECT 1"); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
  });

  const api = express.Router();
  api.use(express.json({ limit: "32kb" }));
  api.use(cookieParser());
  api.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  api.use(csrfGuard);
  api.use(loadUser);
  api.use("/auth", auth);
  api.use("/me", me);
  api.use("/org", org);
  api.use((_req, _res, next) => next(new HttpError(404, "Not found.", "not_found")));
  app.use("/api", api);

  if (existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: "1h", setHeaders: (res, file) => {
      if (file.includes(`${path.sep}assets${path.sep}`)) res.set("Cache-Control", "public, max-age=31536000, immutable");
    } }));
    app.get("*", (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return res.status(400).json({ error: first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input.", code: "invalid" });
    }
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON.", code: "invalid" });
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "Request too large.", code: "too_large" });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error(`[${req.method} ${req.path}]`, err);
    res.status(500).json({ error: "Something went wrong.", code: "server_error" });
  });

  return app;
}
