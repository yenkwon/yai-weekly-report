import fs from 'node:fs';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const KO_DAYS = {
  '월': 'mon',
  '화': 'tue',
  '수': 'wed',
  '목': 'thu',
  '금': 'fri',
  '토': 'sat',
  '일': 'sun',
};

export function loadCorrections(week, path = './data/corrections.json') {
  if (!fs.existsSync(path)) return emptyCorrections(week);

  const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  const row = raw?.[week] || {};
  return normalizeCorrections(week, row);
}

export function applyCorrectionsToConfig(cfg, corrections) {
  if (!corrections.categoryOverrides.length) return cfg;
  validateBuckets(cfg.catmap.buckets, corrections.categoryOverrides);

  return {
    ...cfg,
    catmap: {
      ...cfg.catmap,
      keywordOverrides: [
        ...corrections.categoryOverrides,
        ...cfg.catmap.keywordOverrides,
      ],
    },
  };
}

export function mergeSleepOverrides(...overrides) {
  const merged = {};
  for (const override of overrides) {
    for (const [day, value] of Object.entries(normalizeSleepOverride(override))) {
      merged[day] = value;
    }
  }
  return Object.keys(merged).length ? merged : null;
}

function normalizeCorrections(week, row) {
  const notes = normalizeNotes(row.notes);
  const sleepOverride = normalizeSleepOverride(row.sleepOverride);
  const categoryOverrides = normalizeCategoryOverrides(row.categoryOverrides);

  return {
    week,
    present: Boolean(notes.length || Object.keys(sleepOverride).length || categoryOverrides.length),
    notes,
    sleepOverride,
    categoryOverrides,
  };
}

function emptyCorrections(week) {
  return {
    week,
    present: false,
    notes: [],
    sleepOverride: {},
    categoryOverrides: [],
  };
}

function normalizeNotes(notes) {
  if (!notes) return [];
  const values = Array.isArray(notes) ? notes : [notes];
  return values.map((note) => String(note || '').trim()).filter(Boolean);
}

function normalizeSleepOverride(override) {
  if (!override) return {};
  const normalized = {};
  for (const [rawDay, rawValue] of Object.entries(override)) {
    const day = normalizeDay(rawDay);
    const value = Number(rawValue);
    if (!day) throw new Error(`Invalid sleep override day: ${rawDay}`);
    if (!Number.isFinite(value) || value < 0 || value > 24) {
      throw new Error(`Invalid sleep override value for ${rawDay}: ${rawValue}`);
    }
    normalized[day] = value;
  }
  return normalized;
}

function normalizeCategoryOverrides(overrides) {
  if (!Array.isArray(overrides)) return [];
  return overrides
    .map((item) => {
      if (!item || !item.bucket) return null;
      const match = item.match || (item.title ? escapeRegExp(item.title) : null);
      if (!match) return null;
      const pattern = String(match);
      validateRegex(pattern);
      return {
        match: pattern,
        bucket: String(item.bucket).trim(),
        label: String(item.title || item.match || match).trim(),
        note: item.note ? String(item.note).trim() : '',
      };
    })
    .filter(Boolean);
}

function validateRegex(pattern) {
  try {
    new RegExp(pattern, 'i');
  } catch (err) {
    throw new Error(`Invalid correction match regex "${pattern}": ${err.message}`);
  }
}

function normalizeDay(day) {
  const value = String(day || '').trim().toLowerCase();
  if (DAYS.includes(value)) return value;
  return KO_DAYS[day] || null;
}

function validateBuckets(buckets, overrides) {
  const allowed = new Set(buckets);
  const invalid = overrides.filter((item) => !allowed.has(item.bucket));
  if (invalid.length) {
    throw new Error(`Invalid correction bucket(s): ${invalid.map((item) => item.bucket).join(', ')}`);
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
