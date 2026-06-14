// Basic-Auth gate for the operator admin surface (GET /admin + the admin mutation
// routes). Credentials come from env: SPNR_ADMIN_USER (default "admin") and
// SPNR_ADMIN_PASSWORD. If no password is configured the gate FAILS CLOSED with 503
// — the panel must never run open. Wrong/absent creds => 401 + WWW-Authenticate so
// browsers prompt. The public advertiser portal (/v2/*) and /health stay OPEN and
// must NOT mount this middleware.

import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";

const REALM = "spnr admin";

/** Constant-time string compare that never short-circuits on length. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // timingSafeEqual requires equal lengths; compare lengths via a fixed buffer so
  // a length mismatch still costs a comparison rather than leaking via an early return.
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** Parse a `Basic <base64>` Authorization header into {user, pass}, or null. */
function parseBasicAuth(header: string | undefined): { user: string; pass: string } | null {
  if (!header) return null;
  const [scheme, encoded] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "basic" || !encoded) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return null;
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return null;
  return { user: decoded.slice(0, sep), pass: decoded.slice(sep + 1) };
}

function challenge(res: Response, status: number, message: string): void {
  res.setHeader("WWW-Authenticate", `Basic realm="${REALM}", charset="UTF-8"`);
  res.status(status).type("text/plain").send(message);
}

/**
 * Express middleware enforcing operator Basic Auth.
 *
 * - SPNR_ADMIN_PASSWORD unset/empty -> 503 (fail closed, never open).
 * - Missing/invalid credentials     -> 401 + WWW-Authenticate: Basic.
 * - Matching credentials            -> next().
 */
export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const expectedUser = process.env.SPNR_ADMIN_USER || "admin";
  const expectedPass = process.env.SPNR_ADMIN_PASSWORD;

  if (!expectedPass) {
    res.status(503).type("text/plain").send("admin password not set");
    return;
  }

  const creds = parseBasicAuth(req.headers.authorization);
  if (!creds) {
    challenge(res, 401, "authentication required");
    return;
  }

  // Evaluate both comparisons (no short-circuit) to avoid leaking which field failed.
  const userOk = safeEqual(creds.user, expectedUser);
  const passOk = safeEqual(creds.pass, expectedPass);
  if (!userOk || !passOk) {
    challenge(res, 401, "invalid credentials");
    return;
  }

  next();
}
