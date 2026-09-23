# Benefits / Ingredients Visual QA

All final samples were generated through the real local Qwen + MiniMax H3 T2VA production path with zero staged or submitted product references.

| Sample | Duration | Visual result | QA |
|---|---:|---|---|
| Serum — Benefits | 15 s | Uneven, dull-looking skin-layer macro settles into a brighter, more even-looking radiant surface; no product | PASS |
| Skin Cream — Benefits | 9 s | Dry cheek macro becomes dewier, moisturized-looking, and supple while retaining natural texture; no product | PASS |
| Cleanser — Benefits | 11 s | Human post-cleansing moment ends with fresh, comfortable, clean-looking skin; no product | PASS |
| Serum — Ingredients | 12 s | Clear serum droplets and active-inspired particles interact with a simplified skin layer; no product or text | PASS |
| Cleanser — Ingredients | 11 s | Cleanser formulation droplet, verified-ingredient-inspired particles, and fine foam ring; no product or text | PASS |
| Toner — Ingredients | 12 s | Fine watery mist, hydration droplets, active-inspired particles, and skin-layer interaction; no product or text | PASS |

The first exploratory Serum — Ingredients render exposed an incompatible foam style. QA rejected it, product-specific creative-style compatibility was added, and the final Serum sample above was regenerated and passed. An in-progress incompatible Cleanser mist render was stopped before completion and regenerated with the corrected runner.

The final machine-readable records and archived-video SHA-256 values are in `manifest.json`; contact sheets are stored beside this report.
