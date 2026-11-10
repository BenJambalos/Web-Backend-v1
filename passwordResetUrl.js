function isLoopbackUrl(value) {
  try {
    const { hostname } = new URL(value);
    return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  } catch {
    return false;
  }
}

export function createPasswordResetUrl({ appUrl, origin, allowedOrigins, production, token }) {
  let baseUrl = appUrl?.trim();
  if (!baseUrl || (production && isLoopbackUrl(baseUrl))) {
    if (origin && allowedOrigins.includes(origin) && (!production || !isLoopbackUrl(origin))) {
      baseUrl = origin;
    } else if (!production && !baseUrl) {
      baseUrl = "http://localhost:5173";
    }
  }

  if (!baseUrl) {
    const error = new Error("APP_URL must be configured with the public website URL.");
    error.status = 503;
    throw error;
  }

  let resetUrl;
  try {
    resetUrl = new URL("/reset-password", baseUrl);
  } catch {
    const error = new Error("APP_URL must be a valid URL.");
    error.status = 503;
    throw error;
  }

  if (!["http:", "https:"].includes(resetUrl.protocol)) {
    const error = new Error("APP_URL must use HTTP or HTTPS.");
    error.status = 503;
    throw error;
  }
  if (production && isLoopbackUrl(resetUrl.toString())) {
    const error = new Error("APP_URL must use the public website URL in production.");
    error.status = 503;
    throw error;
  }

  if (token !== undefined) resetUrl.searchParams.set("token", token);
  return resetUrl.toString();
}
