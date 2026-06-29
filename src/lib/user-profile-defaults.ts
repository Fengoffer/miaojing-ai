import type { PoolClient } from 'pg';

const ADJECTIVES = ['云朵', '星河', '松风', '月白', '晴川', '青柚', '琥珀', '小满', '竹影', '橘光', '海盐', '霁蓝'];
const NOUNS = ['画师', '旅人', '造梦家', '观察员', '收藏家', '调色师', '冒险家', '灵感师', '策展人', '星愿者', '小导演', '光影客'];
const AVATAR_KINDS = ['person', 'cat', 'bear', 'bunny', 'fox'] as const;
const PALETTES = [
  ['#7dd3fc', '#c084fc', '#fdf2f8', '#0f172a'],
  ['#fbbf24', '#fb7185', '#fff7ed', '#3b1d0f'],
  ['#86efac', '#38bdf8', '#f0fdf4', '#052e2b'],
  ['#f9a8d4', '#a78bfa', '#fdf4ff', '#312e81'],
  ['#fdba74', '#60a5fa', '#eff6ff', '#1e3a8a'],
];

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick<T>(items: readonly T[], seed: number, offset = 0): T {
  return items[(seed + offset) % items.length];
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  }[char] || char));
}

export function normalizeUsername(value: string | null | undefined, fallback: string): string {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

export function generateChineseNickname(seedValue: string): string {
  const seed = hashString(seedValue || crypto.randomUUID());
  return `${pick(ADJECTIVES, seed)}${pick(NOUNS, seed >>> 5)}${String(seed % 1000).padStart(3, '0')}`;
}

export function generateDefaultAvatarDataUrl(seedValue: string, labelValue?: string | null): string {
  const seed = hashString(seedValue || crypto.randomUUID());
  const [primary, secondary, surface, ink] = pick(PALETTES, seed);
  const kind = pick(AVATAR_KINDS, seed >>> 3);
  const label = escapeXml((labelValue || '').trim().slice(0, 1) || '妙');
  const blush = seed % 2 === 0 ? '#fb7185' : '#f472b6';
  const earLeft = kind === 'cat'
    ? '<path d="M76 92 L110 44 L126 108 Z" fill="url(#face)" stroke="rgba(255,255,255,.6)" stroke-width="5"/>'
    : kind === 'bunny'
      ? '<ellipse cx="105" cy="54" rx="19" ry="48" fill="url(#face)" transform="rotate(-16 105 54)"/>'
      : kind === 'bear' || kind === 'fox'
        ? '<circle cx="103" cy="86" r="26" fill="url(#face)" stroke="rgba(255,255,255,.58)" stroke-width="5"/>'
        : '';
  const earRight = kind === 'cat'
    ? '<path d="M180 108 L196 44 L232 92 Z" fill="url(#face)" stroke="rgba(255,255,255,.6)" stroke-width="5"/>'
    : kind === 'bunny'
      ? '<ellipse cx="205" cy="54" rx="19" ry="48" fill="url(#face)" transform="rotate(16 205 54)"/>'
      : kind === 'bear' || kind === 'fox'
        ? '<circle cx="213" cy="86" r="26" fill="url(#face)" stroke="rgba(255,255,255,.58)" stroke-width="5"/>'
        : '';
  const nose = kind === 'person'
    ? `<path d="M160 147 c-7 10 -1 18 10 16" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round" opacity=".44"/>`
    : `<path d="M151 151 q9 -8 18 0 q-9 11 -18 0Z" fill="${ink}" opacity=".72"/>`;
  const hair = kind === 'person'
    ? `<path d="M90 133 c16 -58 58 -83 112 -57 c29 14 40 44 35 70 c-23 -20 -42 -17 -66 -36 c-26 26 -52 28 -81 23Z" fill="${secondary}" opacity=".92"/>`
    : '';
  const muzzle = kind === 'person' ? '' : '<ellipse cx="160" cy="165" rx="39" ry="26" fill="rgba(255,255,255,.54)"/>';
  const whiskers = kind === 'cat' || kind === 'fox'
    ? `<path d="M101 155 h36 M101 174 h36 M183 155 h36 M183 174 h36" stroke="${ink}" stroke-width="4" stroke-linecap="round" opacity=".38"/>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320">
  <defs>
    <radialGradient id="bg" cx="34%" cy="25%" r="78%">
      <stop offset="0%" stop-color="${surface}"/>
      <stop offset="48%" stop-color="${primary}"/>
      <stop offset="100%" stop-color="${secondary}"/>
    </radialGradient>
    <linearGradient id="face" x1="72" y1="64" x2="236" y2="246" gradientUnits="userSpaceOnUse">
      <stop stop-color="#fff8f0"/>
      <stop offset=".58" stop-color="#ffd7b5"/>
      <stop offset="1" stop-color="#f8a978"/>
    </linearGradient>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="18" stdDeviation="16" flood-color="#111827" flood-opacity=".22"/>
    </filter>
  </defs>
  <rect width="320" height="320" rx="80" fill="url(#bg)"/>
  <circle cx="254" cy="58" r="34" fill="rgba(255,255,255,.34)"/>
  <circle cx="68" cy="250" r="44" fill="rgba(255,255,255,.20)"/>
  <g filter="url(#soft)">
    ${earLeft}${earRight}
    <circle cx="160" cy="153" r="83" fill="url(#face)" stroke="rgba(255,255,255,.68)" stroke-width="6"/>
    ${hair}
    <circle cx="128" cy="144" r="9" fill="${ink}"/>
    <circle cx="192" cy="144" r="9" fill="${ink}"/>
    <circle cx="125" cy="142" r="3" fill="#fff"/>
    <circle cx="189" cy="142" r="3" fill="#fff"/>
    ${muzzle}
    ${nose}
    ${whiskers}
    <path d="M137 184 q23 18 46 0" fill="none" stroke="${ink}" stroke-width="6" stroke-linecap="round" opacity=".62"/>
    <circle cx="105" cy="169" r="13" fill="${blush}" opacity=".30"/>
    <circle cx="215" cy="169" r="13" fill="${blush}" opacity=".30"/>
  </g>
  <g transform="translate(218 222)">
    <circle cx="34" cy="34" r="30" fill="rgba(255,255,255,.78)" stroke="rgba(255,255,255,.86)" stroke-width="3"/>
    <text x="34" y="45" text-anchor="middle" font-size="30" font-weight="800" font-family="Arial, sans-serif" fill="${ink}">${label}</text>
  </g>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

let userDisplayProfileSchemaReady = false;
let userDisplayProfileSchemaWarned = false;

export async function ensureUserDisplayProfileSchema(client: PoolClient): Promise<void> {
  if (userDisplayProfileSchemaReady) return;
  try {
    await client.query(`
      ALTER TABLE profiles
        ADD COLUMN IF NOT EXISTS display_nickname VARCHAR(128)
    `);

    await client.query(`
      UPDATE profiles
         SET display_nickname = COALESCE(NULLIF(display_nickname, ''), NULLIF(nickname, ''), split_part(email, '@', 1))
       WHERE display_nickname IS NULL OR display_nickname = ''
    `);
    userDisplayProfileSchemaReady = true;
  } catch (error) {
    if (error && typeof error === 'object' && (error as { code?: string }).code === '42501') {
      if (!userDisplayProfileSchemaWarned) {
        console.warn('[user-profile-defaults] skipped optional schema check because the database user is not the table owner');
        userDisplayProfileSchemaWarned = true;
      }
      userDisplayProfileSchemaReady = true;
      return;
    }
    throw error;
  }
}
