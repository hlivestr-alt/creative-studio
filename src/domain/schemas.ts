import { z } from 'zod';
import { captionModes, postStructures, productIds, workflowModes } from './types';

export const productSchema = z.object({
  id: z.enum(productIds),
  officialName: z.string().min(1), shortName: z.string().min(1), size: z.string().min(1), role: z.string().min(1),
  imagePath: z.string().min(1), referenceImagePaths: z.array(z.string()).optional(), packagingDescription: z.string().min(1),
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

export const appSettingsSchema = z.object({
  chatGptUrl: z.string().url().refine((url) => url.startsWith('https://'), 'ChatGPT URL must use HTTPS'),
  defaultLanguage: z.enum(['Indonesian', 'English']),
  defaultFormat: z.enum(['Instagram Feed 4:5', 'Square 1:1', 'Story / TikTok 9:16']),
  defaultCreativity: z.enum(['Safe', 'Balanced', 'Experimental']),
  defaultWorkflowMode: z.enum(workflowModes),
  defaultPostStructure: z.enum(postStructures),
  defaultCaptionMode: z.enum(captionModes),
  recentHistoryWindow: z.number().int().min(1).max(100),
  productAssetsDirectory: z.string().min(1), referencesDirectory: z.string().min(1),
  splitRatio: z.number().min(0.28).max(0.72)
});
