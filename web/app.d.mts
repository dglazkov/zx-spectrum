// Types for app.mjs, which vite.config.ts and the tests import.
export function buildApp(): string;
export function startApp(dir: string, options?: { env?: Record<string, string>; log?: (line: string) => void }): Promise<{ url: string; close(): Promise<void> }>;
