# Creative Diversity Engine

The MiniMax H3 workflow uses a local Creative Diversity Engine to choose a
fresh, art-directed execution before the autonomous Qwen prompt engine and
Remote Compute submission. The unrelated Images workflow may still use the
visible ChatGPT handoff. H3 keeps product truth and creative variation as
separate layers:

- Product truth comes from the selected product record and its authoritative
  reference image. It includes identity, packaging, physical constraints,
  verified claims, and safety rules.
- Creative variation is the visual execution: space, composition, camera,
  lighting, motion, effects, pacing, and the opening/final devices.

The engine never mutates or samples product packaging data into a creative
choice. A new genome can change the environment around the Cleanser, for
example, but it cannot change the Cleanser reference, silhouette, label, or
verified product claims.

`createFixedProductTruth` exposes the allowed fact snapshot separately for
callers that need to pass both layers to a scheduler or audit log.

## CreativeGenome and CreativeFingerprint

`CreativeGenome` is the typed planning representation in
`src/domain/types.ts`. Its axes are:

`contentFamily`, `creativeArchetype`, `visualHook`, `environment`,
`composition`, `cameraPath`, `framing`, `lightingStyle`, `primaryMotion`,
`secondaryMotion`, `materialEffect`, `pacing`, `openingDevice`,
`transitionLanguage`, `endingDevice`, and `audioCharacter`.

The genome is history and planning data first. The render prompt only receives
the compact subset needed to execute the selected direction. It does not
receive the serialized genome object or product packaging prose.

`buildCreativeFingerprint` derives a stable signature and the list of major
dimensions. `compareCreativeFingerprints` returns weighted similarity and the
number of meaningful changed dimensions. Visual hook and creative archetype
have the highest weights because a wording-only change must not be mistaken
for a new concept.

## Family-specific grammars

`src/domain/creative-diversity.ts` stores compatible direction bundles in
`creativeFamilyGrammars`. The engine chooses a bundle rather than choosing
every axis independently. Product B-Roll has separate directions for minimal
luxury, macro texture, fluid choreography, architectural geometry, graphic
light/shadow, atmospheric mist, fresh wet surfaces, scientific clean,
kinetic commercial, abstract material worlds, and botanical structure. Each
direction also has compatible variants.

Cinematic Product Ad uses a different grammar built around motivated journeys,
ritual, scale, editorial narrative, shadow theatre, and cinematic escalation.
UGC, Product Demo, Product Transformation, Educational, Ingredient / Texture,
and Custom have their own grammars as well. This prevents a B-Roll vocabulary
from being reused as a generic prompt prefix for every family.

## Selection, overrides, and variety

`planCreativeGenome` accepts a product, content family, recent history, a
seed, and one of three variety levels:

- `Consistent` favors proven compatible directions while still preferring
  alternatives when they are available.
- `Balanced` is the default and applies normal novelty and repetition
  pressure.
- `Exploratory` raises novelty pressure and gives uncommon directions more
  room to win.

The engine recognizes high-confidence explicit instructions such as an
“orange laboratory” or an “overhead camera”. Those axes are locked for the
plan. The original user idea is also passed through unchanged into the typed
`H3GenerationBrief`, so unknown or more nuanced instructions are not
discarded. Unspecified axes may vary around the locked choices.

## Novelty preferences and safe fallback

The default history windows are:

- 24 recent concepts for the same product and content family;
- 48 recent concepts for the same product across families; and
- 96 recent concepts globally.

The strongest comparison is same product plus same family. The engine uses the
four-dimension, visual-hook/archetype, and weighted-similarity checks to rank
preferred candidates and to record bounded reroll diagnostics. They are soft
novelty preferences: a recent match never removes a hard-compatible direction
from the execution pool.

Rerolls are bounded by `maxRerolls` (12 by default), so a bad candidate cannot
loop forever. If the preferred novelty pool is exhausted, the planner returns
the best hard-compatible candidate using this deterministic order: highest
novelty score, least recent exact fingerprint use, lowest exact fingerprint
usage count, then the seeded tie-break. The plan records
`diversityFallbackUsed`, `diversityFallbackReason`, `rerollsUsed`,
`noveltyThresholdMissed`, and the full candidate-count diagnostic. The family
libraries are deliberately larger than the default same-family window, but
reuse remains valid when history is saturated.

## Repetition penalties and decay

For each creative axis, recent same-product/same-family values receive a
temporary penalty. Repeating a value several times increases its penalty;
older history entries contribute less through both generation-age decay and
time decay. Penalties are never permanent bans and history never turns the
compatible candidate count into zero. Once a direction ages out of the
relevant window, or enough generations pass, it can become more competitive
again.

The selected plan stores the penalty sources that affected it, including the
axis, repeated value, occurrence count, penalty, and recent generation IDs.
Development builds show these sources in the Creative Fingerprint inspector.

## Persistent history and lifecycle

Every new H3 plan is saved in `h3_prompt_history` with:

- the selected product and content family;
- `creativeGenomeJson` and `creativeFingerprintJson`;
- concise concept summary and novelty score;
- the reproducible creative seed;
- a local generation/job ID;
- repetition penalty sources;
- fallback and novelty-threshold diagnostics; and
- generation status.

The status begins at `planned`, becomes `prepared` when the brief and direct
settings snapshot are saved, then moves through the autonomous remote stages
(`UPLOADING_REFERENCES`, `WRITING_PROMPT`, `VALIDATING_PROMPT`,
`UNLOADING_LLM`, `QUEUED_H3`, `GENERATING_H3`, `RELEASING_H3_VRAM`, `DOWNLOADING`, and
`COMPLETE`) or a distinct failure stage. Failed jobs remain in history so the
same concept is not silently forgotten and can be diagnosed after an app
restart. Existing databases are migrated by the normal SQLite startup path;
legacy H3 rows remain readable and receive safe defaults.

## Deterministic seeds and future 24/7 use

The selection PRNG is seeded, and the selected seed and fingerprint are saved.
Calling the engine with the same product, family, history, and seed produces
the same genome. `reproduceCreativeGenome` rebuilds the fingerprint for an
approved genome without selecting a different direction.

A future unattended caller can repeatedly call the same planner with:

```ts
planCreativeGenome({
  product: cleanser,
  contentFamily: 'Product B-Roll',
  variety: 'Balanced',
  recentHistory,
  seed: nextSeed
});
```

The scheduler does not need to write concepts manually. It only needs to save
the returned plan as a history entry and pass the concise direction into
`H3GenerationBrief`. Remote ComfyUI, the patched prompt engine, the H3 model,
and product-fidelity metadata remain the execution boundary.
