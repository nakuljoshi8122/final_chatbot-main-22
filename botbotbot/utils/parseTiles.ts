export interface TileProduct {
  id: string;
  name: string;
  price: string;
  category?: string;
  description?: string;
  features?: string[];
  tag?: string;
  color?: string;
  url: string;
  img: string;
  icon?: string;
}

export interface ChatTable {
  headers: string[];
  rows: string[][];
}

const TILES_BLOCK_RE = /<TILES>([\s\S]*?)<\/TILES>/gi;
const TILE_SINGULAR_RE = /<TILE>\s*(\{[\s\S]*?\})\s*<\/TILE>/gi;
const ORPHAN_TILE_JSON_RE =
  /\{[^{}]*"id"\s*:\s*"[^"]+"[^{}]*"name"\s*:\s*"[^"]+"[^{}]*\}/gi;
const TABLE_BLOCK_RE = /<TABLE>[\s\S]*?<\/TABLE>/gi;
const HTML_TABLE_RE = /<table[\s\S]*?<\/table>/gi;

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeFeatures(t: Record<string, unknown>): string[] {
  if (Array.isArray(t.features)) {
    return t.features.map(String).filter(Boolean).slice(0, 2);
  }
  if (Array.isArray(t.includes)) {
    return t.includes.map(String).filter(Boolean).slice(0, 2);
  }
  const fallback = [t.color, t.tag].filter(Boolean).map(String);
  return fallback.slice(0, 2);
}

const API_BASE = (process.env.EXPO_PUBLIC_API_URL || 'http://192.168.0.134:8000').replace(/\/$/, '');

function resolveTileImg(t: Record<string, unknown>, name: string): string {
  const id = t.id ? String(t.id) : '';
  const img = t.img ? String(t.img) : '';
  if (img && !img.includes('via.placeholder.com')) return img;
  if (id && !id.startsWith('tile-')) return `${API_BASE}/product-images/${id}.jpg`;
  return placeholderImg(name);
}

function tileFromEntry(t: Record<string, unknown>, i: number): TileProduct | null {
  if (!t?.name) return null;
  const name = String(t.name);
  return {
    id: String(t.id || `tile-${i}`),
    name,
    price: String(t.price || ''),
    category: t.category ? String(t.category) : undefined,
    description: t.description ? String(t.description) : undefined,
    features: normalizeFeatures(t),
    tag: t.tag ? String(t.tag) : undefined,
    color: t.color ? String(t.color) : undefined,
    url: String(
      t.url ||
        `https://www.adidas.co.in/${encodeURIComponent(name.toLowerCase().replace(/\s+/g, '-'))}`,
    ),
    img: resolveTileImg(t, name),
    icon: t.icon ? String(t.icon) : undefined,
  };
}

function ingestTilePayload(
  payload: string,
  tiles: TileProduct[],
  seen: Set<string>,
  startIndex: number,
): void {
  if (!payload) return;

  try {
    const parsed = JSON.parse(payload);
    const entries = Array.isArray(parsed) ? parsed : [parsed];

    entries.forEach((entry, i) => {
      if (!entry || typeof entry !== 'object') return;
      const tile = tileFromEntry(entry as Record<string, unknown>, startIndex + i);
      if (tile && !seen.has(tile.id)) {
        seen.add(tile.id);
        tiles.push(tile);
      }
    });
  } catch {
    // skip malformed payload
  }
}

/** Parse every <TILES> block in the response (agent sometimes emits more than one). */
function parseAllTiles(raw: string): TileProduct[] {
  const tiles: TileProduct[] = [];
  const seen = new Set<string>();

  for (const match of raw.matchAll(TILES_BLOCK_RE)) {
    ingestTilePayload(match[1]?.trim() ?? '', tiles, seen, tiles.length);
  }

  for (const match of raw.matchAll(TILE_SINGULAR_RE)) {
    ingestTilePayload(match[1]?.trim() ?? '', tiles, seen, tiles.length);
  }

  for (const match of raw.matchAll(ORPHAN_TILE_JSON_RE)) {
    ingestTilePayload(match[0]?.trim() ?? '', tiles, seen, tiles.length);
  }

  return tiles.slice(0, 20);
}

function parseHtmlTable(html: string): ChatTable | null {
  const headers: string[] = [];
  const rows: string[][] = [];

  const theadMatch = html.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
  if (theadMatch) {
    for (const m of theadMatch[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)) {
      headers.push(stripTags(m[1]));
    }
  }

  const tbodyHtml = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? html;
  const trMatches = tbodyHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);

  for (const tr of trMatches) {
    const rowHtml = tr[1];
    const isHeaderRow = /<th/i.test(rowHtml);

    if (isHeaderRow && headers.length) {
      continue;
    }

    const cells: string[] = [];
    const cellPattern = isHeaderRow && !headers.length
      ? /<th[^>]*>([\s\S]*?)<\/th>/gi
      : /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;

    for (const m of rowHtml.matchAll(cellPattern)) {
      cells.push(stripTags(m[1]));
    }

    if (!cells.length) continue;

    if (!headers.length && isHeaderRow) {
      headers.push(...cells);
    } else {
      rows.push(cells);
    }
  }

  if (!headers.length && !rows.length) return null;
  return { headers, rows };
}

function normalizeTableHtml(html: string): string {
  return html.replace(/\s+/g, ' ').trim().toLowerCase();
}

function collectTableHtmlSources(raw: string): string[] {
  const sources: string[] = [];
  const consumed = new Set<string>();

  for (const m of raw.matchAll(/<TABLE>([\s\S]*?)<\/TABLE>/gi)) {
    const chunk = m[1].trim();
    if (!chunk) continue;
    const key = normalizeTableHtml(chunk);
    if (!consumed.has(key)) {
      sources.push(chunk);
      consumed.add(key);
    }
  }

  for (const m of raw.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const chunk = m[0].trim();
    if (!chunk) continue;
    const key = normalizeTableHtml(chunk);
    if (!consumed.has(key)) {
      sources.push(chunk);
      consumed.add(key);
    }
  }

  return sources;
}

function parseTables(raw: string): ChatTable[] {
  const tables: ChatTable[] = [];
  const seen = new Set<string>();
  for (const html of collectTableHtmlSources(raw)) {
    const table = parseHtmlTable(html);
    if (!table || (!table.headers.length && !table.rows.length)) continue;
    const key = `${table.headers.join('|')}::${table.rows.map((r) => r.join('|')).join(';;')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tables.push(table);
  }
  return tables;
}

function looksLikeTileJson(text: string): boolean {
  const t = text.trim();
  return (
    (t.startsWith('[') && t.includes('"name"') && t.includes('"price"')) ||
    (t.startsWith('{') && t.includes('"name"') && t.includes('"price"'))
  );
}

/** Remove all TILES/TABLE blocks and any leftover HTML from visible chat text. */
export function cleanDisplayText(raw: string): string {
  let text = raw;

  // Repeat until stable — handles nested / duplicate blocks
  for (let i = 0; i < 5; i++) {
    const prev = text;
    text = text.replace(TILES_BLOCK_RE, ' ');
    text = text.replace(TILE_SINGULAR_RE, ' ');
    text = text.replace(ORPHAN_TILE_JSON_RE, ' ');
    text = text.replace(TABLE_BLOCK_RE, ' ');
    text = text.replace(HTML_TABLE_RE, ' ');
    if (text === prev) break;
  }

  // Unclosed <TILES>… (no closing tag)
  text = text.replace(/<TILES>[\s\S]*/gi, ' ');

  // Any remaining orphan </TILES> (valid blocks already removed above)
  if (/<\/TILES>/i.test(text)) {
    text = text.replace(/[\s\S]*?<\/TILES>/gi, ' ');
  }

  // Raw JSON tile payloads without wrapper tags
  if (looksLikeTileJson(text)) {
    text = '';
  }

  text = text.replace(/<\/?TABLE>/gi, ' ');
  text = text.replace(/<\/?TILES>/gi, ' ');
  text = text.replace(/<\/?TILE>/gi, ' ');
  text = text.replace(/<\/?thead>/gi, ' ');
  text = text.replace(/<\/?tbody>/gi, ' ');
  text = text.replace(/<\/?t[rhd][^>]*>/gi, ' ');
  text = text.replace(/<[^>]+>/g, ' ');

  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

export function parseAgentResponse(raw: string): {
  text: string;
  tiles: TileProduct[];
  tables: ChatTable[];
} {
  const tiles = parseAllTiles(raw);
  const tables = parseTables(raw);
  const text = cleanDisplayText(raw);

  return { text, tiles, tables };
}

export function placeholderImg(name: string): string {
  const label = encodeURIComponent(name.replace(/\s+/g, '+'));
  return `https://via.placeholder.com/300x300/000000/FFFFFF?text=${label}`;
}
