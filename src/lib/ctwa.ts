// Client-side helpers to read CTWA (Click-to-WhatsApp) attribution from a contact.

export interface CtwaInfo {
  network: string | null;      // 'instagram' | 'facebook' | null
  headline: string | null;
  sourceUrl: string | null;
  body: string | null;
  imageUrl: string | null;
  ctwaClid: string | null;
  adId: string | null;
  provider: string | null;
}

interface ContactLike {
  source?: string | null;
  ctwa_clid?: string | null;
  custom_fields?: Record<string, unknown> | null;
}

export function getCtwaInfo(contact: ContactLike | null | undefined): CtwaInfo | null {
  if (!contact) return null;
  const cf = (contact.custom_fields ?? {}) as Record<string, unknown>;
  const ctwa = cf.ctwa as Record<string, unknown> | undefined;
  const hasCtwa = contact.source === 'ctwa' || !!contact.ctwa_clid || !!ctwa;
  if (!hasCtwa) return null;
  const get = (k: string) => (ctwa && typeof ctwa[k] === 'string' ? (ctwa[k] as string) : null);
  return {
    network: get('network'),
    headline: get('headline'),
    sourceUrl: get('source_url'),
    body: get('body'),
    imageUrl: get('image_url'),
    ctwaClid: (contact.ctwa_clid as string | null) ?? get('ctwa_clid'),
    adId: get('ad_id'),
    provider: get('provider'),
  };
}

export function networkLabel(network: string | null | undefined): string {
  if (network === 'instagram') return 'Instagram';
  if (network === 'facebook') return 'Facebook';
  return 'Meta';
}
