---
name: remove-controller-backgrounds
description: Remove branded, patterned, photographed, or watermarked backgrounds from remote-control product photos with the built-in image editing tool, preserve each controller faithfully, and save compressed WebP results under background-removed/. Use for controller or remote product-photo background removal, white-background catalog cutouts, resumable image batches, or continuing this repository's background-removal work without using the OpenAI API.
---

# Remove Controller Backgrounds

Create faithful controller product photos on a solid white background. Use the built-in image
editing tool included with the user's ChatGPT/Codex session. Never use an API key, the OpenAI
Image API, or a CLI image model for this workflow.

## Safety rules

- Confirm that the user asked to process images now. A question, cost discussion, or request to
  create/update this skill does not authorize image generation.
- Never modify, move, rename, or delete an original image.
- Save accepted results only below `<repo>/background-removed/`, mirroring the source path.
- Never overwrite an existing result unless the user explicitly asks to redo it. The helper
  enforces this.
- Process one image per image-generation call. Default to batches of 5 unless the user chooses a
  different size.
- Finish and save each image before starting the next. This makes subscription-limit interruptions
  resumable.
- If the built-in tool reports a usage limit, stop immediately and report progress. Do not switch
  to API billing and do not repeatedly retry.
- Do not commit results unless the user explicitly asks for a commit.

## One-time setup

Run from the repository root:

```bash
pnpm --dir .codex/skills/remove-controller-backgrounds install --frozen-lockfile
```

If dependencies are already installed, do not reinstall them.

## Select a batch

Show totals:

```bash
pnpm --dir .codex/skills/remove-controller-backgrounds run workflow -- status
```

List the next five unfinished sources:

```bash
pnpm --dir .codex/skills/remove-controller-backgrounds run workflow -- next --limit 5
```

The helper scans only image files exactly one folder below the repository root. It excludes
tooling, proof-of-concept files, and `background-removed/`. Existing mirrored WebP outputs count
as complete.

## Edit each image

For every path returned by `next`:

1. Load the local source with the image-viewing tool.
2. Call the built-in image editing tool once, using that source as the edit target/reference.
3. Use the exact prompt below. Replace only `<orientation>` with `portrait`, `landscape`, or
   `square`, matching the source canvas.
4. Inspect the generated image before accepting it.

```text
Use case: precise-object-edit
Asset type: ecommerce product photograph
Primary request: Remove only the photographed backdrop and supporting surface. Replace them with a perfectly uniform solid pure-white (#FFFFFF) background.
Input image: The supplied image is the edit target and the sole source of truth.
Subject: Preserve the complete remote control exactly as photographed.
Composition: Preserve the source orientation (<orientation>), camera angle, perspective, pose, scale, proportions, and generous padding. Keep the entire product visible and centered. Do not crop it.
Lighting: Preserve the product's original lighting and natural surface detail. Use no cast shadow, contact shadow, reflection, horizon, floor, gradient, or background texture.
Invariants: Keep the exact model, silhouette, buttons, button positions, printed labels, logos, colours, case or cover, openings, wear, and damage. The result must depict this specific physical item, not a cleaner or redesigned substitute.
Avoid: Do not rotate, straighten, reconstruct, beautify, retouch, sharpen, recolour, add, remove, move, invent, or rewrite any part of the product. No watermark, branding backdrop, props, hands, packaging, text additions, or extra objects.
Output: One clean catalogue photo containing only the unchanged remote control on solid white.
```

Reject the result and retry once with a short correction only when there is a material defect:

- changed, missing, invented, or illegible buttons/labels;
- changed controller shape, colour, cover, damage, pose, or perspective;
- cropped product;
- non-white background, shadow, reflection, watermark, or extra object.

Do not retry merely for tiny generative differences that are invisible at normal catalogue size.
After one failed retry, leave the source pending and continue; report it at the end.

## Save as compressed WebP

Pass the generated local file and its original relative source path to the helper:

```bash
pnpm --dir .codex/skills/remove-controller-backgrounds run workflow -- finalize \
  --source "brand/brand-1.webp" \
  --generated "/absolute/path/to/generated-image.png"
```

`finalize` performs these operations atomically:

- flattens transparency onto white;
- turns only the connected near-white border into solid `#FFFFFF`;
- saves lossy WebP at quality 86 with high encoder effort;
- mirrors the source as `background-removed/brand/brand-1.webp`;
- refuses to overwrite existing output.

Use `--quality 1..100` only when the user requests a different compression level.

## Finish the batch

Run `status` again. Report:

- number saved in this batch;
- relative output paths;
- remaining count;
- skipped or failed sources and why;
- whether a subscription limit stopped the batch;
- that built-in image editing was used and no API billing was used.
