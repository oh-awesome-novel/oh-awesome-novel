const POSIX_ABSOLUTE_PATH = /(^|[\s'"`(:=])(\/(?:[^\s'"`()/]+\/)+[^\s'"`(),;/]*)/gu;
const WINDOWS_ABSOLUTE_PATH = /(^|[\s'"`(:=])([A-Za-z]:[\\/](?:[^\s'"`()\\/]+[\\/])*[^\s'"`(),;\\/]*)/gu;

/**
 * Error messages from the change engine and filesystem layers can embed host
 * absolute paths. The HTTP boundary must not leak them to the renderer, so
 * each one is reduced to its final segment.
 */
export function redactHostPaths(message: string): string {
  return message
    .replace(POSIX_ABSOLUTE_PATH, (_match, prefix: string, path: string) => prefix + redactPath(path, '/'))
    .replace(WINDOWS_ABSOLUTE_PATH, (_match, prefix: string, path: string) => prefix + redactPath(path, /[\\/]/u));
}

function redactPath(path: string, separator: string | RegExp): string {
  const trailing = /[.]+$/u.exec(path)?.[0] ?? '';
  const trimmed = trailing ? path.slice(0, -trailing.length) : path;
  const segments = trimmed.split(separator).filter((segment) => segment.length > 0);
  const last = segments.at(-1);
  return `${last ? `<host-path>/${last}` : '<host-path>'}${trailing}`;
}
