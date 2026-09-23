import type { Language } from './types';

export const CTA_CONTENT_TYPE = 'CTA / End Card' as const;
export type CtaStyle = 'Auto' | 'Price' | 'Shop' | 'Benefit' | 'Minimal Premium' | 'Promo';
export interface CtaSettings {
  style: CtaStyle;
  duration: number;
  price: string;
  action: string;
  benefit: string;
  promo: string;
}
export const defaultCtaSettings: CtaSettings = { style: 'Auto', duration: 8, price: '', action: '', benefit: '', promo: '' };
export const ctaStyles: CtaStyle[] = ['Auto', 'Price', 'Shop', 'Benefit', 'Minimal Premium', 'Promo'];
export const isCtaEndCard = (value: string | null | undefined): boolean => value === CTA_CONTENT_TYPE;

export function ctaEligibleStyles(settings: CtaSettings): Exclude<CtaStyle, 'Auto'>[] {
  return [
    ...(settings.price.trim() ? ['Price' as const] : []),
    'Shop',
    ...(settings.benefit.trim() ? ['Benefit' as const] : []),
    'Minimal Premium',
    ...(settings.promo.trim() ? ['Promo' as const] : [])
  ];
}

export function resolveCtaStyle(settings: CtaSettings, seed: number, previous?: CtaStyle): Exclude<CtaStyle, 'Auto'> {
  const eligible = ctaEligibleStyles(settings);
  if (settings.style !== 'Auto') {
    if (!eligible.includes(settings.style)) throw new Error(`${settings.style} CTA requires its corresponding copy.`);
    return settings.style;
  }
  const candidates = eligible.length > 1 ? eligible.filter(style => style !== previous) : eligible;
  return candidates[(seed >>> 0) % candidates.length];
}

export function ctaLines(style: Exclude<CtaStyle, 'Auto'>, settings: CtaSettings, language: Language): string[] {
  const action = settings.action || (language === 'English' ? 'Shop now' : 'Cek sekarang');
  switch (style) {
    case 'Price': return [settings.price, action];
    case 'Benefit': return [settings.benefit, action];
    case 'Promo': return [settings.promo, action];
    case 'Shop': return [action];
    case 'Minimal Premium': return ['PROYA 5X Vitamin C', action];
  }
}
