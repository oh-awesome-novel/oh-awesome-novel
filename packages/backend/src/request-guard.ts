import { timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';

/**
 * Header the renderer uses to present the per-launch backend token.
 * The token is handed to the renderer out of band (Electron preload), so a
 * web page that merely knows the local port cannot obtain it.
 */
export const BACKEND_AUTH_TOKEN_HEADER = 'x-oan-token';

export interface BackendRequestGuardOptions {
  /** When set, every non-preflight request must carry this exact token. */
  authToken?: string;
  /** Extra browser origins (scheme://host[:port]) allowed to call the backend. */
  allowedOrigins?: readonly string[];
  /** The interface the server listens on; a non-loopback bind accepts that Host as well. */
  host?: string;
}

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]']);

/**
 * Rejects requests that did not come from the app itself:
 * - `Host` must name a loopback address (or the configured bind host), which
 *   defeats DNS rebinding where an attacker domain resolves to 127.0.0.1;
 * - a browser `Origin`, when present, must be a loopback origin, an explicitly
 *   allowed origin, or the opaque `null` origin of the file:// renderer
 *   (accepted only when a token is required, since sandboxed frames share it);
 * - when an auth token is configured, it must match.
 */
export function createBackendRequestGuard(options: BackendRequestGuardOptions): MiddlewareHandler {
  const expectedToken = options.authToken ? Buffer.from(options.authToken, 'utf8') : undefined;

  return async (context, next) => {
    if (!isAllowedHost(readRequestHostname(context), options.host)) {
      return context.json({ error: 'Forbidden host.' }, 403);
    }

    const origin = context.req.header('origin');
    if (origin !== undefined && !isAllowedBackendOrigin(origin, options)) {
      return context.json({ error: 'Forbidden origin.' }, 403);
    }

    if (expectedToken && context.req.method !== 'OPTIONS') {
      const presented = context.req.header(BACKEND_AUTH_TOKEN_HEADER);
      if (!presented || !tokensEqual(Buffer.from(presented, 'utf8'), expectedToken)) {
        return context.json({ error: 'Missing or invalid backend token.' }, 401);
      }
    }

    await next();
    return undefined;
  };
}

/** Returns the origin to echo in CORS responses, or undefined to deny. */
export function resolveBackendCorsOrigin(
  origin: string,
  options: BackendRequestGuardOptions,
): string | undefined {
  return isAllowedBackendOrigin(origin, options) ? origin : undefined;
}

export function isAllowedBackendOrigin(origin: string, options: BackendRequestGuardOptions): boolean {
  if (origin === 'null' || origin.startsWith('file://')) {
    return Boolean(options.authToken);
  }
  if (options.allowedOrigins?.includes(origin)) {
    return true;
  }

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
    && LOOPBACK_HOSTNAMES.has(parsed.hostname);
}

function isAllowedHost(hostname: string | undefined, bindHost: string | undefined): boolean {
  if (bindHost && WILDCARD_HOSTS.has(bindHost)) {
    return true;
  }
  if (!hostname) {
    return false;
  }

  const normalized = hostname.toLowerCase();
  return LOOPBACK_HOSTNAMES.has(normalized)
    || (bindHost !== undefined && normalized === bindHost.toLowerCase());
}

function readRequestHostname(context: Context): string | undefined {
  const host = context.req.header('host');
  if (host === undefined) {
    return new URL(context.req.url).hostname;
  }

  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return undefined;
  }
}

function tokensEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}
