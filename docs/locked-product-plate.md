# Locked Product Plate

## Recommendation

Creative Studio should treat Locked Product Plate as a shot-mode contract and compositing plan, not as another long packaging description in the H3 prompt.

The current application has a local creative control plane and an autonomous MiniMax H3 Ref2VA ComfyUI execution path. That graph accepts the remote Qwen-produced prompt and product reference images and returns one generated video stream; it does not expose alpha, masks, a background-only output, a foreground layer, or a compositing node. The repository also has no FFmpeg dependency or existing media post-processing service.

The clean first implementation is therefore:

1. Store a first-class shot mode in the H3 brief.
2. Generate a short, deterministic plate plan in the H3GenerationBrief for the remote Qwen prompt engine.
3. Keep the autonomous Remote Compute submission and existing H3 graph boundary unchanged.
4. Add a later compositor at the output boundary that consumes the plan, an approved product cutout, and the generated environment video.

This preserves the current workflow while making the intended foreground/background responsibility explicit. It avoids asking H3 to reproduce packaging pixels that can be composited from the original asset.

## Implemented mode

`H3VideoBrief.lockedProductPlateMode` supports:

- `Off` — existing full-shot H3 generation behavior.
- `Full Shot` — the original product image is the foreground plate for the entire shot.
- `Opening Hero` — the original product image is locked during the opening hero beat.
- `Final Hero` — the original product image is locked during the final hero beat.

The field is optional when reading old saved H3 records. Legacy records normalize to `Off`, while new sessions store the selected value inside the existing brief JSON. No database schema migration or Remote Compute request change is required.

The H3 setup exposes the mode in Advanced Settings. Choosing a non-off mode automatically assigns the selected product asset to the Product Reference role when no usable product image is assigned. Turning the mode off does not remove an existing reference selection.

## Generated shot contract

When enabled, the generated prompt contains one `locked_product_plate` block with this responsibility split:

- `source_plate`: use the original supplied product asset as the foreground plate; preserve its source pixels, printed artwork, edges, proportions, closure, material appearance, and opacity.
- `generated_layer`: generate only the background/environment, light, foam, water, particles, and atmosphere around a reserved product footprint.
- `compositing`: place the original plate over the generated environment; optional contact shadow and reflection passes may sit beneath or around the plate, never over source product pixels.
- `motion`: keep the plate front-facing and let camera, light, and environment motion provide the animation for the selected scope.

The block is intentionally separate from the compact reference-authority lock. It does not enumerate the front label, and it does not ask H3 to redraw, relabel, retexture, or regenerate the package.

For `Opening Hero` and `Final Hero`, the locked scope is the named hero beat rather than the entire timeline. If a later or earlier beat needs a meaningful rotation, that beat must use generated product coverage or additional angle references; the original front plate must not be warped into a fake side or rear view.

## Compositing architecture

The future execution layer should use a deterministic, non-generative compositor with a small manifest produced by the H3 plan:

```text
product master image
        │
        ├─ approved alpha/cutout or manually reviewed mask ── foreground product plate
        │                                                       │
H3 environment/background video ───────────────────────────────┼─ composite
        │                                                       │
        └─ optional scene-derived shadow/reflection pass ──────┘
                                                               │
                                                        final video
```

The cutout step should be performed once and reviewed. It should preserve the original product pixels and edge geometry; generative inpainting or an H3 redraw must not be used to repair the plate. If the source asset already contains a suitable alpha channel, that alpha can be reused after validation. Otherwise, a deterministic segmentation/mask tool or a manually approved mask should create the RGBA plate.

FFmpeg is the recommended later implementation boundary because it can handle image/video frame-rate normalization, scaling, alpha overlay, optional blend layers, audio mapping, and final encoding without changing the existing H3 graph. The compositor should be a separate service/module with typed inputs such as:

```text
sourcePlatePath
backgroundVideoPath
optionalShadowPath
optionalReflectionPath
plateScope: full-shot | opening-hero | final-hero
anchor / scale / crop policy
outputPath
```

The first implementation deliberately does not bundle FFmpeg or pretend that the current Remote Compute graph returns separate layers. The prompt and plan are ready for that service, and the existing generated H3 video remains usable as the environment/action source until the service is added.

## Automatic recommendation

The app recommends Locked Product Plate when all of the following are true:

- the brief clearly describes a front-facing, readable hero or packshot;
- no rotation, turn, spin, orbit, rear, back, or side reveal is requested;
- the selected camera/action controls or idea indicate minimal product movement; and
- Product Fidelity is `Exact` or a usable product reference is attached, so packaging pixels are explicitly required to remain exact.

The suggested scope is selected from the language of the brief:

- explicit opening-hero language → `Opening Hero`;
- explicit full-shot/static/throughout language → `Full Shot`;
- otherwise a hero ending → `Final Hero`.

The recommendation is shown without silently changing the user's mode. Selecting a non-off mode is an explicit decision; the UI then ensures a usable selected-product reference is present for the existing H3 handoff.

Rotation cues suppress the recommendation and explain why. This avoids presenting a front plate as a solution for a shot that requires a new viewpoint.

## Fidelity improvement

The improvement comes from changing ownership of the pixels:

- H3 no longer needs to synthesize the product face during a locked shot.
- Printed text and logo pixels come directly from the original product asset.
- The generated model spends its capacity on light, water, foam, atmosphere, camera movement, and other environmental animation.
- Shadows and reflections can be integrated around the product without repainting its face.
- `Full Shot`, `Opening Hero`, and `Final Hero` make the locked interval explicit for later compositing and review.

The H3 prompt remains concise. Product metadata still supplies verified physical constraints for non-plate shots and for planning, but the plate block is the authoritative instruction for locked-shot foreground pixels.

## Limitations

- The current Remote Compute graph still produces one H3 video stream. It does not yet emit a background-only video, alpha channel, shadow pass, or final composite automatically.
- The current implementation is workflow planning and prompt/output-mode support. A future compositor is required to turn the plan into a finished plate-composited video.
- A front-facing plate is not a valid substitute for a real rotation. Rotating products still require H3 generation, multiple-angle references, or separately prepared angle plates.
- Locked Product Plate is best for front-facing hero shots with minimal product motion and environmental animation around the product.
- Opening/final plate scopes require careful timing and alignment in the future compositor; the mode does not infer a physically changing product viewpoint.
- Camera moves that substantially change perspective may require plate reprojection or a new plate, even when the product appears mostly front-facing.
- A shadow or reflection pass must be derived from the scene and reviewed so it does not obscure or alter the original packaging artwork.

## Files

- `src/domain/types.ts` — persisted H3 mode and UI options.
- `src/domain/locked-product-plate.ts` — mode normalization, suitability recommendation, typed plan, and prompt block.
- `src/domain/h3.ts` — retains legacy prompt helpers for older saved/image workflows; the autonomous H3 page uses `h3-generation-brief.ts` and does not call the ChatGPT helpers.
- `src/ui/H3VideoPromptsPage.tsx` — mode selection, reference assignment, and recommendation display.
- `workflows/minimax-h3-api.json` — unchanged existing Remote Compute graph.
