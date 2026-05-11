import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import router from "./routes";
import publicRouter from "./routes/public";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/auth";
import { customDomain } from "./middlewares/customDomain";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(customDomain);

// Serve static brand assets (WebForge logo, etc.)
app.use("/static", express.static(path.join(__dirname, "../public")));

app.use("/api", publicRouter);

app.use(authMiddleware);

app.use("/api", router);

export default app;
