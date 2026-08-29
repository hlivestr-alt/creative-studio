import productsJson from '../../data/products.json';
import brandJson from '../../data/brand.json';
import claimsJson from '../../data/claim-rules.json';
import postTypesJson from '../../data/post-types.json';
import visualStylesJson from '../../data/visual-styles.json';
import { brandSchema, claimRulesSchema, productsSchema } from './schemas';
import type { Product } from './types';

export const products = productsSchema.parse(productsJson);
export const brand = brandSchema.parse(brandJson);
export const claimRules = claimRulesSchema.parse(claimsJson);
export const postTypes = postTypesJson as string[];
export const visualStyles = visualStylesJson as string[];

export const getProduct = (id: string) => products.find((product) => product.id === id);
export const getProductReferencePaths = (product: Product): string[] => product.referenceImagePaths?.length ? product.referenceImagePaths : [product.imagePath];
