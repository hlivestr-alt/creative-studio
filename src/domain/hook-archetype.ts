import type { ProductId } from './types';

export const hookArchetypes = ['Problem Only', 'Problem → After'] as const;
export type HookArchetype = typeof hookArchetypes[number];

export const HOOK_ARCHETYPE_WEIGHTS = {
  'Problem Only': 0.55,
  'Problem → After': 0.45
} as const satisfies Record<HookArchetype, number>;

/** Draw exactly once when a genuinely new Hook job is created. */
export function selectHookArchetype(random: () => number = Math.random): HookArchetype {
  return random() < HOOK_ARCHETYPE_WEIGHTS['Problem Only'] ? 'Problem Only' : 'Problem → After';
}

export interface HookAppearanceTheme {
  problem: string;
  after: string;
}

export const hookAppearanceThemes: Readonly<Record<ProductId, HookAppearanceTheme>> = {
  'eye-cream': {
    problem: 'tired-looking dark under-eyes with a visible dark under-eye or eye-bag appearance and a naturally tired expression',
    after: 'the same eye area looks more refreshed, rested, brighter, and fresher while retaining natural skin texture'
  },
  serum: {
    problem: 'visible dark-spot appearance, dull-looking skin, and uneven-looking tone',
    after: 'the complexion looks brighter, more even, and more radiant without impossible total removal of pigmentation'
  },
  cleanser: {
    problem: 'just-washed skin with matte, dry-looking cheeks, a visibly tight uncomfortable expression, and a hand touching the face; show dryness without acne, rash, irritation, or strong redness',
    after: 'the same cheeks look clean, fresh, soft, comfortable, and subtly hydrated with a natural moisture sheen rather than stripped'
  },
  toner: {
    problem: 'dull, dehydrated-looking, tired skin immediately after cleansing',
    after: 'the skin looks refreshed, hydrated, softly dewy, prepared, and comfortable'
  },
  'skin-cream': {
    problem: 'dry-looking skin, rough-looking texture, and a tight or uncomfortable expression',
    after: 'the skin looks moisturized, softer, more supple, and comfortable'
  },
  mask: {
    problem: 'tired, stressed, warm or overheated-looking skin and a person wanting a calming skincare moment',
    after: 'the same person looks refreshed and relaxed, with a calmer and soothed-looking appearance'
  },
  'full-series': {
    problem: 'a familiar concern such as dull, dry, dehydrated, or tired-looking skin',
    after: 'the same person looks healthier, fresher, more comfortable, and naturally radiant'
  }
};

export const hookTransitionIdeas = [
  'a hand passing across the face',
  'a natural head turn and return',
  'a mirror wipe',
  'a towel briefly passing through frame',
  'the camera moving behind a foreground object',
  'a natural blink or head movement',
  'a clean match cut',
  'a subtle whip transition',
  'a restrained lighting transition',
  'a believable time-of-day transition'
] as const;
