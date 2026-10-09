// The ZXDB, through the ZXInfo API (https://api.zxinfo.dk/v3/, documented by its Swagger file swagger_v3.yaml and
// the project's wiki). The page asks it through its own server, at /zxinfo/: the API's answers carry its
// Access-Control-Allow-Origin header twice ("*, *"), which a browser refuses, and its redirect to internal.zxinfo.dk
// carries none (docs/web.md). The server also says who is asking, as the API asks its clients to.
//
// The archive's files come through the server too, at /archive/<path>, as they come without cross-origin headers.
// Pictures are shown straight from where they are.

/** A file of an entry, as ZXDB lists it. */
export interface ZxFile {
  readonly path: string;
  readonly size?: number;
  /** "Tape image", "Snapshot image", "Disk image", ... */
  readonly type: string;
  /** "Perfect tape (TZX)", "Tape (TAP)", "Snapshot (Z80)", ... */
  readonly format: string;
  /** "Original release (O)", "Re-release (R)", or null. */
  readonly origin?: string | null;
  readonly comments?: string | null;
}

/** An entry: a game, a program, a book. */
export interface ZxEntry {
  readonly id: string;
  readonly title: string;
  readonly year: number | null;
  /** "ZX-Spectrum 48K", "ZX-Spectrum 48K/128K", "ZX-Spectrum 128K", ... */
  readonly machine: string | null;
  /** "Available", "Distribution denied", "Never released", "MIA", ... */
  readonly availability: string | null;
  readonly publisher: string | null;
  readonly genre: string | null;
  /** Its loading screen (or a screen of it running), as a URL to show. */
  readonly screen: string | null;
  /** Its releases' files, the original release first. */
  readonly releases: readonly (readonly ZxFile[])[];
  /**
   * The cassette's inlay (the front of the original release's, where there is one) and its instructions as text, as
   * archive paths: null where ZXDB has none, undefined where the record did not say (a fetch of the entry will).
   */
  readonly inlay?: string | null;
  readonly instructions?: string | null;
  /** How it is played, as ZXDB lists it: "Kempston Joystick", "Cursor", "Redefineable keys", ... */
  readonly controls?: readonly string[];
}

/** The API's answer for one entry (`_source`, in compact mode), as far as the page reads it. */
export interface ZxSource {
  title?: string;
  originalYearOfRelease?: number | null;
  machineType?: string | null;
  availability?: string | null;
  genre?: string | null;
  publishers?: { name?: string }[];
  releases?: { files?: ZxFile[] }[];
  screens?: { url?: string; type?: string }[];
  additionalDownloads?: { path?: string; type?: string; format?: string; language?: string | null }[];
  controls?: { control?: string }[];
}

export interface ZxHit {
  _id: string;
  _source: ZxSource;
}

/** Where a picture's path is: ZXInfo's own screenshots (/zxscreens/) on zxinfo.dk, the archive's on spectrumcomputing.co.uk. */
export function pictureUrl(path: string): string {
  if (/^https?:/.test(path)) return path;
  if (path.startsWith('/zxscreens/')) return `https://zxinfo.dk/media${path}`;
  return `https://spectrumcomputing.co.uk${path}`;
}

/** Its picture: a loading screen first, then a screen of it running. */
function screenOf(s: ZxSource): string | null {
  const screens = s.screens ?? [];
  const loading = screens.find((x) => x.type === 'Loading screen' && x.url && !/\.scr$/i.test(x.url));
  const running = screens.find((x) => x.type === 'Running screen' && x.url && !/\.scr$/i.test(x.url));
  const any = loading ?? running ?? screens.find((x) => x.url && /\.(png|gif|jpe?g)$/i.test(x.url));
  return any?.url ? pictureUrl(any.url) : null;
}

/** The file's name with no publisher's or edition's mark: "Saboteur.jpg", not "Saboteur(Encore).jpg" or "JetSetWilly_Spanish.jpg". */
const plain = (path: string) => !/[()]|_(Spanish|French|German|Italian|historical)\b/i.test(path.split('/').pop() ?? '');

/** The front of the cassette's inlay: the original's, as ZXDB lists it first, before a re-release's. */
function inlayOf(s: ZxSource): string | null | undefined {
  if (!s.additionalDownloads) return undefined;
  const fronts = s.additionalDownloads.filter((d) => d.type === 'Inlay - Front' && d.path && /\.(jpe?g|png|gif)$/i.test(d.path));
  return (fronts.find((d) => plain(d.path!)) ?? fronts[0])?.path ?? null;
}

/** The instructions as text: in English (or no language given), the plain file before a variant. */
function instructionsOf(s: ZxSource): string | null | undefined {
  if (!s.additionalDownloads) return undefined;
  const texts = s.additionalDownloads.filter((d) => d.type === 'Instructions' && d.path && /TXT/.test(d.format ?? '') && (!d.language || /English/.test(d.language)));
  return (texts.find((d) => plain(d.path!)) ?? texts[0])?.path ?? null;
}

export function entryOf(hit: ZxHit): ZxEntry {
  const s = hit._source;
  return {
    id: hit._id,
    title: s.title ?? 'Untitled',
    year: s.originalYearOfRelease ?? null,
    machine: s.machineType ?? null,
    availability: s.availability ?? null,
    publisher: s.publishers?.[0]?.name ?? null,
    genre: s.genre ?? null,
    screen: screenOf(s),
    releases: (s.releases ?? []).map((r) => r.files ?? []),
    inlay: inlayOf(s),
    instructions: instructionsOf(s),
    controls: s.controls ? s.controls.map((c) => c.control ?? '').filter(Boolean) : undefined,
  };
}

export interface SearchResult {
  readonly total: number;
  readonly entries: readonly ZxEntry[];
}

export interface SearchOptions {
  readonly offset?: number;
  readonly size?: number;
  /** Only what ZXDB lists as Available: what the archive may hand out (the default). */
  readonly availableOnly?: boolean;
}

/**
 * The query string for a search of software for the Spectrum family (machinetype ZXSPECTRUM covers its variants,
 * contenttype SOFTWARE leaves out hardware and books), the most relevant first.
 */
export function searchQuery(text: string, { offset = 0, size = 24, availableOnly = true }: SearchOptions = {}): string {
  const q = new URLSearchParams({ query: text, mode: 'compact', size: String(size), offset: String(offset), sort: 'rel_desc', contenttype: 'SOFTWARE', machinetype: 'ZXSPECTRUM' });
  if (availableOnly) q.set('availability', 'Available');
  return q.toString();
}

/** Searches the ZXDB through the page's server. */
export async function search(text: string, options: SearchOptions & { signal?: AbortSignal; base?: string } = {}): Promise<SearchResult> {
  const base = options.base ?? '/zxinfo';
  const res = await fetch(`${base}/v3/search?${searchQuery(text, options)}`, { signal: options.signal });
  if (!res.ok) throw new Error(`the ZXDB search failed (${res.status})`);
  const body = (await res.json()) as { hits?: { total?: { value?: number } | number; hits?: ZxHit[] } };
  const total = typeof body.hits?.total === 'number' ? body.hits.total : (body.hits?.total?.value ?? 0);
  return { total, entries: (body.hits?.hits ?? []).map(entryOf) };
}

/** One entry, afresh. */
export async function fetchEntry(id: string, options: { signal?: AbortSignal; base?: string } = {}): Promise<ZxEntry> {
  const base = options.base ?? '/zxinfo';
  const res = await fetch(`${base}/v3/games/${encodeURIComponent(id)}?mode=compact`, { signal: options.signal });
  if (!res.ok) throw new Error(`the ZXDB has no entry ${id} (${res.status})`);
  return entryOf((await res.json()) as ZxHit);
}

/** An archive file's address through the page's server (for a picture: an <img> needs no cross-origin headers, but the archive's own pages may refuse to be linked to). */
export function archiveUrl(path: string): string {
  return `/archive${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** Fetches an archive file through the page's server, reporting progress (0–1) as it comes. */
export async function fetchArchive(path: string, progress?: (done: number) => void, signal?: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(archiveUrl(path), { signal });
  if (!res.ok) throw new Error(`the archive would not hand out ${path} (${res.status})`);
  // The length is for progress only: a body sent compressed is longer, decoded, than the length it came with.
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    progress?.(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
