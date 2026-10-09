// Types for server.mjs, which vite.config.ts and the tests import.
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

export interface Route {
  prefix: string;
  origin: string;
  /** Hosts (with a port, where it is not the scheme's) that redirects may go to. */
  hosts: string[];
  allow: RegExp;
  maxBytes: number;
  timeoutMs: number;
  query: boolean;
  cache: string;
}

export const ROUTES: Route[];
export function passTarget(rawPath: string, rawQuery?: string, routes?: Route[]): { route: Route; url: string } | null;
export function makePassThrough(routes?: Route[]): (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
export function passThrough(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
export function startServer(root: string, port: number): Server;
