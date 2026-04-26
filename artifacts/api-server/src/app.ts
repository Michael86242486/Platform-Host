import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";

import router from "./routes";
import { logger } from "./lib/logger";
import { clerk } from "./middlewares/auth";
import { customDomain } from "./middlewares/customDomain";

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
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Public host-based serving for custom domains. This runs BEFORE Clerk so that
// requests to user domains never trigger auth and are served as plain HTML.
app.use(customDomain);

app.use(clerk);

app.use("/api", router);

export default app;
