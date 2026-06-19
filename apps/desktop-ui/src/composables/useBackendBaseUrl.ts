export function resolveBackendBaseUrl(): string {
  return (
    window.ohAwesomeNovel?.backendBaseUrl ??
    import.meta.env.VITE_OAN_BACKEND_BASE_URL ??
    ''
  );
}
