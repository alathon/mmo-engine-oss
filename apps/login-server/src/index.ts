import express from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { LoginResponse } from "@mmo/shared-protocol";
import { logger } from "@mmo/shared-servers";
import cors from "cors";

const DEFAULT_PORT = 3000;
const TOKEN_EXPIRY = "7d";

const getAuthTokenSecret = (): string => {
  return process.env.AUTH_TOKEN_SECRET || "dev-secret";
};

const createDisplayName = (playerId: string): string => {
  return `Player ${playerId.slice(0, 6)}`;
};

const createLoginResponse = (): LoginResponse => {
  const playerId = randomUUID();
  const displayName = createDisplayName(playerId);

  const token = jwt.sign({ playerId, displayName }, getAuthTokenSecret(), {
    expiresIn: TOKEN_EXPIRY,
  });

  return { token, playerId, displayName };
};

const allowedOrigins = ["http://localhost:5173", "https://mmo-client-9e9o.onrender.com"];

const app = express();

const options: cors.CorsOptions = {
  origin: allowedOrigins,
};

app.use(cors(options));
app.use(express.json());
app.use((request, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
});

app.post("/login", (_request, res) => {
  const response = createLoginResponse();
  res.json(response);
});

app.get("/healthz", (_request, res) => {
  res.send("ok");
});

app.listen(process.env.PORT || DEFAULT_PORT, () => {
  logger.info("Login server listening");
});
