// Shared helpers for Click-to-WhatsApp (CTWA) attribution.
// Used by webhook-meta and webhook-uazapi to keep the attribution model consistent.

export type CtwaProvider = 'meta_cloud' | 'uazapi';

export interface CtwaInput {
  provider: CtwaProvider;
  ctwa_clid?: string | null;   // Meta only (referral.ctwa_clid)
  ad_id?: string | null;       // Meta only (referral.source_id)
  network?: string | null;     // 'instagram' | 'facebook' | null
  source_url?: string | null;
  headline?: string | null;
  body?: string | null;
  image_url?: string | null;
  media_type?: string | null;
}

export interface CtwaContactRow {
  id: string;
  utm_source?: string | null;
  utm_campaign?: string | null;
  ad_id?: string | null;
  ctwa_clid?: string | null;
  custom_fields?: Record<string, unknown> | null;
}

/** Derive network from the ad source URL (host). */
export function deriveNetworkFromUrl(sourceUrl?: string | null): string | null {
  if (!sourceUrl) return null;
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    if (host.includes('instagram.com')) return 'instagram';
    if (host.includes('facebook.com') || host === 'fb.me' || host.endsWith('.fb.me') || host === 'fb.com' || host.endsWith('.fb.com')) return 'facebook';
    return null;
  } catch {
    return null;
  }
}

/** Derive network from UAZAPI's entryPointConversionApp (only trust known values). */
export function deriveNetworkFromApp(app?: string | null): string | null {
  if (!app) return null;
  const v = String(app).toLowerCase().trim();
  if (v === 'instagram') return 'instagram';
  if (v === 'facebook') return 'facebook';
  return null;
}

/**
 * Build a non-destructive UPDATE patch to record CTWA attribution on a contact.
 * - source = 'ctwa'
 * - utm_medium = 'ctwa'
 * - ctwa_clid: last-touch (only when new value is non-null)
 * - ad_id: only overwrite when new value is non-null (Meta)
 * - custom_fields.ctwa: merged, first_seen_at preserved, last_seen_at bumped
 * Preserves every other key of custom_fields.
 */
export function buildCtwaPatch(existing: CtwaContactRow | null | undefined, input: CtwaInput): Record<string, unknown> {
  const nowIso = new Date().toISOString();
  const existingCustom = (existing?.custom_fields ?? {}) as Record<string, unknown>;
  const existingCtwa = (existingCustom.ctwa ?? {}) as Record<string, unknown>;

  const mergedCtwa: Record<string, unknown> = {
    ...existingCtwa,
    provider: input.provider ?? existingCtwa.provider ?? null,
    network: input.network ?? existingCtwa.network ?? null,
    ctwa_clid: input.ctwa_clid ?? existingCtwa.ctwa_clid ?? null,
    ad_id: input.ad_id ?? existingCtwa.ad_id ?? null,
    headline: input.headline ?? existingCtwa.headline ?? null,
    body: input.body ?? existingCtwa.body ?? null,
    source_url: input.source_url ?? existingCtwa.source_url ?? null,
    image_url: input.image_url ?? existingCtwa.image_url ?? null,
    media_type: input.media_type ?? existingCtwa.media_type ?? null,
    first_seen_at: existingCtwa.first_seen_at ?? nowIso,
    last_seen_at: nowIso,
  };

  const patch: Record<string, unknown> = {
    source: 'ctwa',
    utm_source: input.network ?? existing?.utm_source ?? 'meta',
    utm_medium: 'ctwa',
    utm_campaign: input.headline ?? existing?.utm_campaign ?? null,
    custom_fields: { ...existingCustom, ctwa: mergedCtwa },
  };

  if (input.ad_id) patch.ad_id = input.ad_id;
  if (input.ctwa_clid) patch.ctwa_clid = input.ctwa_clid;

  return patch;
}
