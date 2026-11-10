import assert from "node:assert/strict";
import test from "node:test";
import { createPasswordResetUrl } from "./passwordResetUrl.js";

test("uses the configured website URL", () => {
  const url = createPasswordResetUrl({
    appUrl: "https://hyqual.example",
    origin: "https://other.example",
    allowedOrigins: ["https://other.example"],
    production: true,
    token: "reset-token",
  });

  assert.equal(url, "https://hyqual.example/reset-password?token=reset-token");
});

test("uses an allowlisted request origin when APP_URL is missing in production", () => {
  const url = createPasswordResetUrl({
    origin: "https://hyqual.example",
    allowedOrigins: ["https://hyqual.example"],
    production: true,
    token: "reset-token",
  });

  assert.equal(url, "https://hyqual.example/reset-password?token=reset-token");
});

test("allows a configured local website URL when testing against a production API", () => {
  const url = createPasswordResetUrl({
    appUrl: "http://localhost:5173",
    origin: "http://localhost:5173",
    allowedOrigins: ["http://localhost:5173"],
    production: true,
    token: "reset-token",
  });

  assert.equal(url, "http://localhost:5173/reset-password?token=reset-token");
});

test("uses localhost as the development fallback", () => {
  const url = createPasswordResetUrl({
    allowedOrigins: [],
    production: false,
    token: "reset-token",
  });

  assert.equal(url, "http://localhost:5173/reset-password?token=reset-token");
});

test("rejects unallowlisted production origins", () => {
  assert.throws(() => createPasswordResetUrl({
    origin: "https://untrusted.example",
    allowedOrigins: ["https://hyqual.example"],
    production: true,
    token: "reset-token",
  }), { message: "APP_URL must be configured with the public website URL." });
});
