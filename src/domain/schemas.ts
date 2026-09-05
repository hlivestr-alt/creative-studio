import { z } from 'zod';
import { captionModes, computeModes, h3PromptEngineModelId, h3ReferenceImageSizeOptions, h3SeedModeOptions, h3SchedulerOptions, h3WorkflowAspectRatioValues, postStructures, productIds, workflowModes } from './types';

export const productUnprintedSurfaceAppearanceSchema = z.object({
  appliesTo: z.string().min(1),
  verification: z.string().min(1),
  content: z.literal('blank'),
  text: z.literal('none'),
  graphics: z.literal('none'),
  logos: z.literal('none'),
  barcode: z.literal('none'),
  regulatoryCopy: z.literal('none'),
  instructions: z.literal('none'),
  labels: z.literal('none'),
  finish: z.string().min(1)
});

export const productSurfaceAppearanceSchema = z.object({
  appliesTo: z.string().min(1),
  verification: z.string().min(1),
  content: z.string().min(1),
  printedArtwork: z.string().min(1),
  text: z.string().min(1),
  graphics: z.string().min(1),
  logos: z.string().min(1),
  barcode: z.string().min(1),
  regulatoryCopy: z.string().min(1),
  instructions: z.string().min(1),
  labels: z.string().min(1),
  finish: z.string().min(1),
  continuity: z.string().min(1)
});

const productBlankSurfaceAppearanceSchema = productSurfaceAppearanceSchema.extend({
  content: z.literal('blank'),
  printedArtwork: z.literal('none'),
  text: z.literal('none'),
  graphics: z.literal('none'),
  logos: z.literal('none'),
  barcode: z.literal('none'),
  regulatoryCopy: z.literal('none'),
  instructions: z.literal('none'),
  labels: z.literal('none')
});

export const productComponentMeasurementSchema = z.object({
  component: z.string().min(1),
  heightCm: z.number().positive().optional(),
  widthCm: z.number().positive().optional(),
  notes: z.string().min(1).optional()
});

export const productDimensionsSchema = z.object({
  measurementAuthority: z.string().min(1),
  overallHeightCm: z.number().positive().optional(),
  widthCm: z.number().positive().optional(),
  widthBottomCm: z.number().positive().optional(),
  widthTopCm: z.number().positive().optional(),
  diameterCm: z.number().positive().optional(),
  componentMeasurements: z.array(productComponentMeasurementSchema),
  notes: z.array(z.string().min(1))
});

export const productContentsAppearanceSchema = z.object({
  appliesTo: z.string().min(1),
  verification: z.string().min(1),
  color: z.string().min(1),
  transparency: z.string().min(1),
  visualConsistency: z.string().min(1),
  visibleThroughPackageWalls: z.boolean(),
  packageVisibility: z.string().min(1),
  forbiddenColorInterpretations: z.array(z.string().min(1)).min(1),
  stylingSeparation: z.string().min(1)
});

export const productPhysicalIdentitySchema = z.object({
  packageType: z.string().min(1),
  packageComponents: z.array(z.string().min(1)).min(1),
  size: z.string().min(1),
  shape: z.string().min(1),
  proportions: z.string().min(1),
  closureType: z.string().min(1),
  physicalMaterial: z.string().min(1),
  surfaceAppearance: z.string().min(1),
  transparency: z.string().min(1),
  visibleGlassTransparency: z.boolean(),
  frontSurfaceAppearance: productSurfaceAppearanceSchema,
  rearSurfaceAppearance: productBlankSurfaceAppearanceSchema,
  sideSurfaceAppearance: productBlankSurfaceAppearanceSchema,
  opacityBehavior: z.string().min(1),
  contentsVisibility: z.string().min(1),
  colorAppearance: z.string().min(1),
  labelAppearance: z.string().min(1),
  referenceAuthority: z.string().min(1),
  referencePresentationState: z.array(z.string().min(1)).min(1),
  unprintedSurfaceAppearance: productUnprintedSurfaceAppearanceSchema,
  dimensions: productDimensionsSchema,
  contentsAppearance: productContentsAppearanceSchema.optional(),
  forbiddenInterpretations: z.array(z.string().min(1)).min(1)
});

export const productSchema = z.object({
  id: z.enum(productIds),
  officialName: z.string().min(1), shortName: z.string().min(1), size: z.string().min(1), role: z.string().min(1),
  imagePath: z.string().min(1), referenceImagePaths: z.array(z.string()).optional(), packagingDescription: z.string().min(1),
  physicalIdentity: productPhysicalIdentitySchema,
  ingredients: z.array(z.string()).min(1), benefitTerritories: z.array(z.string()).min(1), safeCopy: z.array(z.string()).min(1),
  topics: z.array(z.string()).min(1), visualMotifs: z.array(z.string()).min(1), textureCues: z.array(z.string()).min(1),
  usagePosition: z.string().min(1), packagingRestrictions: z.array(z.string()).min(1), isHero: z.boolean()
});

export const productsSchema = z.array(productSchema).superRefine((products, ctx) => {
  const ids = new Set(products.map((product) => product.id));
  for (const id of productIds) if (!ids.has(id)) ctx.addIssue({ code: 'custom', message: `Missing product ${id}` });
});

export const brandSchema = z.object({
  brand: z.string(), series: z.string(), coreIdea: z.string(), personality: z.array(z.string()),
  palette: z.record(z.string(), z.string()), visualDirection: z.array(z.string()), defaultPromptKeywords: z.array(z.string()),
  productReferenceInstruction: z.string(), source: z.string()
});

export const claimRulesSchema = z.object({ approved: z.array(z.string()).min(1), avoidUnlessApproved: z.array(z.string()).min(1), rule: z.string(), source: z.string() });

export const h3WorkflowSettingsSchema = z.object({
  durationSeconds: z.number().finite().min(4).max(15),
  aspectRatio: z.enum(h3WorkflowAspectRatioValues),
  megapixels: z.number().finite().min(0.1).max(16),
  multiple: z.number().int().min(8).max(128).refine((value) => value % 4 === 0, 'H3 multiple must be divisible by 4'),
  fps: z.literal(24),
  steps: z.number().int().min(1),
  scheduler: z.enum(h3SchedulerOptions),
  seedMode: z.enum(h3SeedModeOptions),
  seed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  refImageSize: z.enum(h3ReferenceImageSizeOptions)
});

export const h3PromptEngineSettingsSchema = z.object({
  provider: z.literal('lmstudio-remote'),
  endpoint: z.string().url().refine((url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:'
        && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
        && parsed.port === '1234'
        && /^\/v1\/?$/.test(parsed.pathname)
        && !parsed.search
        && !parsed.hash;
    } catch { return false; }
  }, 'LM Studio endpoint must be http://127.0.0.1:1234/v1 on the execution PC loopback interface'),
  model: z.literal(h3PromptEngineModelId),
  temperature: z.number().finite().min(0).max(2),
  repairAttempts: z.number().int().min(0).max(5),
  disableThinking: z.boolean(),
  unloadModelBeforeH3: z.boolean(),
  timeoutSeconds: z.number().int().min(10).max(900)
});

export const appSettingsSchema = z.object({
  chatGptUrl: z.string().url().refine((url) => url.startsWith('https://'), 'ChatGPT URL must use HTTPS'),
  computeMode: z.enum(computeModes),
  remoteComfyUrl: z.string().url().refine((url) => url.startsWith('https://'), 'Remote ComfyUI URL must use HTTPS'),
  remoteComfyWorkflowPath: z.string(),
  remoteOutputDirectory: z.string().min(1),
  remoteAutoDownload: z.boolean(),
  defaultLanguage: z.enum(['Indonesian', 'English']),
  defaultFormat: z.enum(['Instagram Feed 4:5', 'Square 1:1', 'Story / TikTok 9:16']),
  defaultCreativity: z.enum(['Safe', 'Balanced', 'Experimental']),
  defaultWorkflowMode: z.enum(workflowModes),
  defaultPostStructure: z.enum(postStructures),
  defaultCaptionMode: z.enum(captionModes),
  recentHistoryWindow: z.number().int().min(1).max(100),
  productAssetsDirectory: z.string().min(1), referencesDirectory: z.string().min(1),
  splitRatio: z.number().min(0.28).max(0.72),
  h3WorkflowSettings: h3WorkflowSettingsSchema,
  h3SystemPromptPath: z.string().min(1),
  h3PromptEngine: h3PromptEngineSettingsSchema
});
