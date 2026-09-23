import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { Language, ProductId } from './types';
import { ctaLines, resolveCtaStyle, type CtaSettings, type CtaStyle } from './cta-settings';
export { CTA_CONTENT_TYPE, ctaEligibleStyles, ctaLines, ctaStyles, defaultCtaSettings, isCtaEndCard, resolveCtaStyle } from './cta-settings';
export type { CtaSettings, CtaStyle } from './cta-settings';

export interface CtaRenderRequest {
  productId: ProductId;
  masterPath: string;
  outputPath: string;
  settings: CtaSettings;
  language: Language;
  aspectRatio: string;
  seed: number;
  previousStyle?: CtaStyle;
  ffmpegPath?: string;
}

export interface CtaProductPrice { discounted: string; original: string; }

export const CTA_LAYOUTS = ['Center Hero', 'Product Left / Price Right', 'Product Lower / Offer Upper', 'Minimal Premium'] as const;
export type CtaLayout = typeof CTA_LAYOUTS[number];

/** Auto compositions rotate deterministically without introducing random or remote dependencies. */
export function resolveCtaLayout(seed: number): CtaLayout {
  return CTA_LAYOUTS[(seed >>> 0) % CTA_LAYOUTS.length];
}

/** Fixed approved sales prices. These strings are rendered verbatim. */
export const CTA_PRODUCT_PRICES: Readonly<Record<ProductId, CtaProductPrice>> = Object.freeze({
  cleanser: { discounted: 'Rp89.000', original: 'Rp222.500' },
  toner: { discounted: 'Rp102.990', original: 'Rp257.475' },
  'skin-cream': { discounted: 'Rp119.900', original: 'Rp299.750' },
  'eye-cream': { discounted: 'Rp74.990', original: 'Rp187.500' },
  serum: { discounted: 'Rp116.990', original: 'Rp267.500' },
  mask: { discounted: 'Rp15.000', original: 'Rp37.500' },
  'full-series': { discounted: 'Rp429.900', original: 'Rp1.074.750' }
});

interface LayoutGeometry {
  productX: number; productY: number; productSize: number;
  cardX: number; cardY: number; cardWidth: number; cardHeight: number;
  textAlign: 'left' | 'center';
  buttonX: number; buttonY: number; buttonWidth: number; buttonHeight: number;
  eyebrowY?: number;
}

function verticalGeometry(layout: CtaLayout, width: number, height: number): LayoutGeometry {
  const sx = width / 720;
  const sy = height / 1280;
  const scale = Math.min(sx, sy);
  const geometry: Record<CtaLayout, LayoutGeometry> = {
    'Center Hero': { productX: 55, productY: 92, productSize: 610, cardX: 80, cardY: 760, cardWidth: 560, cardHeight: 205, textAlign: 'center', buttonX: 145, buttonY: 1010, buttonWidth: 430, buttonHeight: 82 },
    'Product Left / Price Right': { productX: -110, productY: 225, productSize: 610, cardX: 322, cardY: 385, cardWidth: 336, cardHeight: 245, textAlign: 'left', buttonX: 322, buttonY: 690, buttonWidth: 336, buttonHeight: 82, eyebrowY: 340 },
    'Product Lower / Offer Upper': { productX: 50, productY: 425, productSize: 620, cardX: 82, cardY: 145, cardWidth: 556, cardHeight: 245, textAlign: 'center', buttonX: 150, buttonY: 1050, buttonWidth: 420, buttonHeight: 82 },
    'Minimal Premium': { productX: 60, productY: 95, productSize: 600, cardX: 88, cardY: 745, cardWidth: 544, cardHeight: 230, textAlign: 'left', buttonX: 88, buttonY: 1005, buttonWidth: 420, buttonHeight: 82, eyebrowY: 700 }
  };
  const g = geometry[layout];
  return {
    ...g,
    productX: Math.round(g.productX * sx), productY: Math.round(g.productY * sy), productSize: Math.round(g.productSize * scale),
    cardX: Math.round(g.cardX * sx), cardY: Math.round(g.cardY * sy), cardWidth: Math.round(g.cardWidth * sx), cardHeight: Math.round(g.cardHeight * sy),
    buttonX: Math.round(g.buttonX * sx), buttonY: Math.round(g.buttonY * sy), buttonWidth: Math.round(g.buttonWidth * sx), buttonHeight: Math.round(g.buttonHeight * sy),
    eyebrowY: g.eyebrowY === undefined ? undefined : Math.round(g.eyebrowY * sy)
  };
}

function roundedDistance(x: number, y: number, width: number, height: number, radius: number): number {
  const dx = Math.abs(x - width / 2) - (width / 2 - radius);
  const dy = Math.abs(y - height / 2) - (height / 2 - radius);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius;
}

/** Writes a deterministic anti-aliased RGBA card used as an FFmpeg overlay. */
function writeRoundedSurface(path: string, width: number, height: number, rgb: readonly [number, number, number], opacity: number, radius: number, shadow: number): void {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const bodyDistance = roundedDistance(x, y - shadow * 0.15, width - shadow * 2, height - shadow * 2, radius);
      const shadowDistance = roundedDistance(x, y - shadow * 0.15 - 5, width - shadow, height - shadow, radius + 2);
      const bodyAlpha = Math.max(0, Math.min(1, 0.75 - bodyDistance));
      const shadowAlpha = Math.max(0, Math.min(0.18, (shadow + 2 - Math.max(0, shadowDistance)) / Math.max(1, shadow) * 0.18));
      const alpha = Math.max(shadowAlpha, bodyAlpha * opacity);
      const highlight = bodyAlpha > 0 ? Math.round(10 * (1 - y / height)) : 0;
      pixels[index] = Math.min(255, rgb[0] + highlight);
      pixels[index + 1] = Math.min(255, rgb[1] + highlight);
      pixels[index + 2] = Math.min(255, rgb[2] + highlight);
      pixels[index + 3] = Math.round(alpha * 255);
    }
  }
  writeFileSync(path, pixels);
}

/** A translucent glass halo gives the verified cutout a lit surface to sit against. */
function writeGlassHalo(path: string, size: number): void {
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const dx = (x + 0.5 - size / 2) / (size / 2);
    const dy = (y + 0.5 - size / 2) / (size / 2);
    const radius = Math.hypot(dx, dy);
    const edge = Math.exp(-Math.pow((radius - 0.78) / 0.055, 2)) * 0.14;
    const center = Math.exp(-Math.pow(radius / 0.68, 2)) * 0.11;
    const glint = Math.exp(-Math.pow((dx + 0.31) / 0.14, 2) - Math.pow((dy + 0.37) / 0.3, 2)) * 0.12;
    const offset = (y * size + x) * 4;
    pixels[offset] = 255; pixels[offset + 1] = 221; pixels[offset + 2] = 183;
    pixels[offset + 3] = Math.round(Math.min(0.32, edge + center + glint) * 255);
  }
  writeFileSync(path, pixels);
}

function textX(geometry: LayoutGeometry, inset: number): string {
  return geometry.textAlign === 'center' ? `${geometry.cardX} + (${geometry.cardWidth}-text_w)/2` : String(geometry.cardX + inset);
}

function fade(start: number, duration = 0.28): string {
  return `if(lt(t\\,${start})\\,0\\,if(lt(t\\,${start + duration})\\,(t-${start})/${duration}\\,1))`;
}

function filterPath(path: string): string { return path.replace(/\\/g, '/').replace(':', '\\:'); }

/** Composites the verified PNG bytes as an overlay. No model or product reconstruction. */
export async function renderCtaEndCard(request: CtaRenderRequest): Promise<{ path: string; style: Exclude<CtaStyle, 'Auto'>; layout: CtaLayout; sha256: string; size: number }> {
  const { masterPath, outputPath, settings } = request;
  if (!existsSync(masterPath) || !/\.png$/i.test(masterPath)) throw new Error(`Verified PNG product master missing: ${masterPath}`);
  if (!Number.isInteger(settings.duration) || settings.duration < 8 || settings.duration > 15) throw new Error('CTA duration must be an integer from 8 to 15 seconds.');
  const price = CTA_PRODUCT_PRICES[request.productId];
  const effectiveSettings = price ? { ...settings, price: price.discounted } : settings;
  const style = resolveCtaStyle(effectiveSettings, request.seed, request.previousStyle);
  const layout = resolveCtaLayout(request.seed);
  const lines = ctaLines(style, effectiveSettings, request.language);
  if (lines.some(line => !line.trim() || /[\r\n]/.test(line))) throw new Error('CTA text must be non-empty single-line copy.');
  const [ratioW, ratioH] = request.aspectRatio.split(':').map(Number);
  if (!ratioW || !ratioH || ratioW / ratioH > 3 || ratioH / ratioW > 3) throw new Error('Unsupported CTA aspect ratio.');
  const width = ratioW <= ratioH ? 720 : Math.round(720 * ratioW / ratioH / 2) * 2;
  const height = ratioW <= ratioH ? Math.round(720 * ratioH / ratioW / 2) * 2 : 720;
  const vertical = height > width;
  const geometry = vertical ? verticalGeometry(layout, width, height) : verticalGeometry('Product Left / Price Right', width, height);
  const palette = [
    { base: 'fffaf5', glow: 'f6e4d2', glow2: 'f3d3b4', ink: '352b27', button: [174, 70, 35] as const },
    { base: 'faf6f1', glow: 'ecd9c6', glow2: 'f2d9be', ink: '352b27', button: [53, 42, 37] as const },
    { base: 'fffaf6', glow: 'f4e0d0', glow2: 'efd0b6', ink: '352b27', button: [174, 70, 35] as const },
    { base: 'f9f6f2', glow: 'ebe1d6', glow2: 'eed5c4', ink: '352b27', button: [53, 42, 37] as const }
  ][CTA_LAYOUTS.indexOf(layout)];
  mkdirSync(dirname(outputPath), { recursive: true });
  const work = mkdtempSync(join(dirname(outputPath), '.proya-cta-'));
  try {
    const regularFont = process.platform === 'win32' ? 'C\\:/Windows/Fonts/arial.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
    const boldFont = process.platform === 'win32' ? 'C\\:/Windows/Fonts/arialbd.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
    const buttonFile = join(work, 'button.rgba');
    const cardFile = join(work, 'card.rgba');
    const haloFile = join(work, 'halo.rgba');
    const haloSize = Math.round(Math.min(width, height) * 0.66);
    writeGlassHalo(haloFile, haloSize);
    writeRoundedSurface(buttonFile, geometry.buttonWidth, geometry.buttonHeight, palette.button, 0.98, Math.round(geometry.buttonHeight / 2), 8);
    writeRoundedSurface(cardFile, geometry.cardWidth, geometry.cardHeight, [255, 254, 251], layout === 'Minimal Premium' ? 0.82 : 0.92, 28, 14);

    const originalFile = join(work, 'price-original.txt');
    const discountedFile = join(work, 'price-discounted.txt');
    const actionFile = join(work, 'price-action.txt');
    const eyebrowFile = join(work, 'eyebrow.txt');
    const auxiliaryFile = join(work, 'auxiliary.txt');
    const action = effectiveSettings.action || (request.language === 'English' ? 'Shop now' : 'Cek sekarang');
    writeFileSync(originalFile, price.original, 'utf8');
    writeFileSync(discountedFile, price.discounted, 'utf8');
    writeFileSync(actionFile, `${action}  →`, 'utf8');
    writeFileSync(eyebrowFile, style === 'Promo' && effectiveSettings.promo ? effectiveSettings.promo : request.language === 'English' ? 'SPECIAL OFFER' : 'PENAWARAN SPESIAL', 'utf8');
    const auxiliary = style === 'Benefit' ? effectiveSettings.benefit : style === 'Promo' ? effectiveSettings.promo : '';
    writeFileSync(auxiliaryFile, auxiliary, 'utf8');

    const originalSize = Math.round(Math.max(24, Math.min(31, geometry.cardWidth * 0.064)));
    const discountedSize = Math.round(Math.max(42, Math.min(73, geometry.cardWidth * (layout === 'Product Left / Price Right' ? 0.14 : 0.13))));
    const actionSize = Math.round(Math.max(22, Math.min(34, geometry.buttonWidth / Math.max(10, [...`${action} →`].length * 0.58))));
    const inset = Math.max(28, Math.round(geometry.cardWidth * 0.08));
    const originalY = geometry.cardY + Math.round(geometry.cardHeight * 0.27);
    const discountedY = geometry.cardY + Math.round(geometry.cardHeight * 0.47);
    const priceX = textX(geometry, inset);
    const strikeWidth = Math.round([...price.original].length * originalSize * 0.55);
    const strikeX = geometry.textAlign === 'center' ? geometry.cardX + Math.round((geometry.cardWidth - strikeWidth) / 2) : geometry.cardX + inset;
    const productDrift = `5*cos(4*PI*t/${settings.duration})`;
    const buttonStart = settings.duration * 0.45;
    const buttonRise = `18*max(0\\,1-(t-${buttonStart})/${settings.duration * 0.08})`;
    const productScale = Math.max(160, geometry.productSize);

    const filters = [
      `[0:v]format=rgba[base]`,
      `[2:v]scale=${Math.round(width * 1.12)}:${Math.round(height * 1.12)},crop=${width}:${height}:x='(in_w-out_w)/2+18*sin(2*PI*t/${settings.duration})':y='(in_h-out_h)/2+14*cos(2*PI*t/${settings.duration})',format=rgba[glow]`,
      `[base][glow]blend=all_mode=normal:all_opacity=0.42[lit]`,
      `[3:v]scale=${Math.round(width * 1.08)}:${Math.round(height * 1.08)},crop=${width}:${height}:x='(in_w-out_w)/2-16*sin(2*PI*t/${settings.duration})':y='(in_h-out_h)/2+12*sin(2*PI*t/${settings.duration})',format=rgba[glow2]`,
      `[lit][glow2]blend=all_mode=softlight:all_opacity=0.3,noise=alls=3:allf=t+u[depth]`,
      `[depth][4:v]overlay=x='-overlay_w+(main_w+2*overlay_w)*t/${settings.duration}':y=0:eval=frame:format=auto[moving]`,
      `[1:v]setpts=N/(24*TB),scale=w='${productScale}*(1+0.018*t/${settings.duration})':h='${productScale}*(1+0.018*t/${settings.duration})':eval=frame:force_original_aspect_ratio=decrease,format=rgba,split[hero][shadowSource]`,
      `[shadowSource]colorchannelmixer=rr=0:gg=0:bb=0:aa=0.2,gblur=sigma=20[shadow]`,
      `[7:v]format=rgba[glass]`,
      `[moving][glass]overlay=x='${geometry.productX + Math.round((geometry.productSize - haloSize) / 2)}+7*sin(2*PI*t/${settings.duration})':y='${geometry.productY + Math.round((geometry.productSize - haloSize) / 2)}+10*cos(2*PI*t/${settings.duration})':eval=frame:format=auto[haloed]`,
      `[haloed][shadow]overlay=x='${geometry.productX + 15}':y='${geometry.productY + 24}':eval=frame:format=auto[staged]`,
      `[staged][hero]overlay=x='${geometry.productX}+3*sin(2*PI*t/${settings.duration})':y='${geometry.productY}+${productDrift}':eval=frame:format=auto[product]`,
      `[5:v]format=rgba[card]`,
      `[product][card]overlay=x=${geometry.cardX}:y=${geometry.cardY}:format=auto[carded]`,
      `[carded]drawtext=fontfile='${regularFont}':textfile='${filterPath(originalFile)}':fontcolor=0xb84b42:fontsize=${originalSize}:x='${priceX}':y=${originalY}:alpha='${fade(settings.duration * 0.21, settings.duration * 0.07)}'[original]`,
      `[original]drawbox=x=${strikeX}:y=${originalY + Math.round(originalSize * 0.57)}:w=${strikeWidth}:h=2:color=0xb84b42@0.9:t=fill:enable='gte(t,${settings.duration * 0.29})'[strike]`,
      `[strike]drawtext=fontfile='${boldFont}':textfile='${filterPath(discountedFile)}':fontcolor=0x${palette.ink}:fontsize=${discountedSize}:x='${priceX}':y=${discountedY}:alpha='${fade(settings.duration * 0.32, settings.duration * 0.1)}':shadowcolor=white@0.42:shadowx=1:shadowy=2[priced]`,
      `[6:v]format=rgba[button]`,
      `[priced][button]overlay=x=${geometry.buttonX}:y='${geometry.buttonY}+${buttonRise}':enable='gte(t,${buttonStart})':eval=frame:format=auto[buttoned]`,
      `[buttoned]drawtext=fontfile='${boldFont}':textfile='${filterPath(actionFile)}':fontcolor=white:fontsize=${actionSize}:x='${geometry.buttonX}+(${geometry.buttonWidth}-text_w)/2':y='${geometry.buttonY}+(${geometry.buttonHeight}-text_h)/2-2+${buttonRise}':alpha='${fade(buttonStart, settings.duration * 0.08)}'[cta]`
    ];
    let label = 'cta';
    if (geometry.eyebrowY !== undefined) {
      filters.push(`[${label}]drawtext=fontfile='${boldFont}':textfile='${filterPath(eyebrowFile)}':fontcolor=0xc85b25:fontsize=${Math.round(22 * width / 720)}:x=${layout === 'Product Left / Price Right' ? geometry.cardX + inset : geometry.cardX}:y=${geometry.eyebrowY}:alpha='${fade(settings.duration * 0.12)}'[eyebrow]`);
      label = 'eyebrow';
    }
    if (auxiliary) {
      const auxiliarySize = Math.round(Math.max(21, Math.min(29, geometry.cardWidth / Math.max(16, [...auxiliary].length * 0.54))));
      filters.push(`[${label}]drawtext=fontfile='${regularFont}':textfile='${filterPath(auxiliaryFile)}':fontcolor=0x6e4b3a:fontsize=${auxiliarySize}:x='${priceX}':y=${geometry.cardY + Math.round(geometry.cardHeight * 0.78)}:alpha='${fade(settings.duration * 0.4)}'[aux]`);
      label = 'aux';
    }

    const temporaryOutput = join(work, 'end-card.mp4');
    const sweepWidth = Math.max(90, Math.round(width * 0.18));
    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=0x${palette.base}:s=${width}x${height}:r=24:d=${settings.duration}`,
      '-loop', '1', '-framerate', '24', '-i', resolve(masterPath),
      '-f', 'lavfi', '-i', `gradients=s=${width}x${height}:r=24:d=${settings.duration}:c0=0x${palette.glow}:c1=0x${palette.base}:type=radial:speed=0.018`,
      '-f', 'lavfi', '-i', `gradients=s=${width}x${height}:r=24:d=${settings.duration}:c0=0x${palette.base}:c1=0x${palette.glow2}:type=circular:speed=0.012`,
      '-f', 'lavfi', '-i', `color=c=white@0.11:s=${sweepWidth}x${height}:r=24:d=${settings.duration},format=rgba,gblur=sigma=${Math.round(sweepWidth * 0.32)}`,
      '-stream_loop', '-1', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${geometry.cardWidth}x${geometry.cardHeight}`, '-framerate', '24', '-i', cardFile,
      '-stream_loop', '-1', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${geometry.buttonWidth}x${geometry.buttonHeight}`, '-framerate', '24', '-i', buttonFile,
      '-stream_loop', '-1', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${haloSize}x${haloSize}`, '-framerate', '24', '-i', haloFile,
      '-filter_complex', filters.join(';'), '-map', `[${label}]`, '-t', String(settings.duration), '-r', '24', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', temporaryOutput
    ];
    await new Promise<void>((done, fail) => {
      const child = spawn(request.ffmpegPath ?? 'ffmpeg', args, { cwd: work, windowsHide: true });
      let error = '';
      child.stderr.on('data', chunk => { error += String(chunk).slice(0, 8192); });
      child.on('error', fail);
      child.on('close', code => code === 0 ? done() : fail(new Error(`CTA FFmpeg failed (${code}): ${error}`)));
    });
    renameSync(temporaryOutput, outputPath);
    return { path: resolve(outputPath), style, layout, size: statSync(outputPath).size, sha256: createHash('sha256').update(readFileSync(outputPath)).digest('hex') };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
