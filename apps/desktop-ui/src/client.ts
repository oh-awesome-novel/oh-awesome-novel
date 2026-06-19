import { createOanClient } from '@oh-awesome-novel/client';

export const oanClient = createOanClient({
  backendBaseUrl: import.meta.env.VITE_OAN_BACKEND_BASE_URL,
});
