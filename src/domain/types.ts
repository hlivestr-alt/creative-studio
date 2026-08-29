export const productIds = ['cleanser', 'toner', 'serum', 'eye-cream', 'skin-cream', 'mask', 'full-series'] as const;
export type ProductId = (typeof productIds)[number];
export type ProductSelection = ProductId | 'auto';
export type HistoryStatus = 'Prepared' | 'Used' | 'Rejected' | 'Archived';
export type Language = 'Indonesian' | 'English';
export type PostFormat = 'Instagram Feed 4:5' | 'Square 1:1' | 'Story / TikTok 9:16';
export type Creativity = 'Safe' | 'Balanced' | 'Experimental';
export type TextAmount = 'No Text' | 'Minimal' | 'Educational' | 'Promotional';
export const captionModes = ['SHORT', 'STANDARD', 'DETAILED', 'NONE'] as const;
export type CaptionMode = (typeof captionModes)[number];
export type WorkspaceLayout = 'split' | 'controls' | 'chatgpt';
export const workflowModes = ['DIRECT_IMAGE', 'EXPLORE_IDEAS'] as const;
export type WorkflowMode = (typeof workflowModes)[number];

export const postStructures = ['SINGLE_IMAGE', 'CAROUSEL'] as const;
export type PostStructure = (typeof postStructures)[number];
export const slideCountOptions = ['AUTO', 3, 4, 5, 6, 7, 8] as const;
export type RequestedSlideCount = (typeof slideCountOptions)[number];

export const workflowModeOptions: ReadonlyArray<{ value: WorkflowMode; label: string; description: string }> = [
  { value: 'DIRECT_IMAGE', label: 'Direct Image Prompt', description: 'Create one finished image concept and prompt ready for approval.' },
  { value: 'EXPLORE_IDEAS', label: 'Explore 3 Ideas', description: 'Generate three creative directions before choosing one.' }
];

export const postStructureOptions: ReadonlyArray<{ value: PostStructure; label: string; description: string }> = [
  { value: 'SINGLE_IMAGE', label: 'Single Image', description: 'Create one complete Instagram image.' },
  { value: 'CAROUSEL', label: 'Carousel', description: 'Create a coordinated multi-slide Instagram carousel.' }
];

export const captionModeOptions: ReadonlyArray<{ value: CaptionMode; label: string; description: string }> = [
  { value: 'STANDARD', label: 'Standard', description: 'About 80–150 words.' },
  { value: 'SHORT', label: 'Short', description: 'About 30–70 words.' },
  { value: 'DETAILED', label: 'Detailed', description: 'About 150–250 words.' },
  { value: 'NONE', label: 'None', description: 'Do not generate a caption or hashtags.' }
];

export interface ChatPanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface Product {
  id: ProductId;
  officialName: string;
  shortName: string;
  size: string;
  role: string;
  imagePath: string;
  referenceImagePaths?: string[];
  packagingDescription: string;
  ingredients: string[];
  benefitTerritories: string[];
  safeCopy: string[];
  topics: string[];
  visualMotifs: string[];
  textureCues: string[];
  usagePosition: string;
  packagingRestrictions: string[];
  isHero: boolean;
}

export interface CreativeSettings {
  product: ProductSelection;
  workflowMode: WorkflowMode;
  postStructure: PostStructure;
  requestedSlideCount: RequestedSlideCount;
  postType: string;
  topic: string;
  visualStyle: string;
  textAmount: TextAmount;
  captionMode: CaptionMode;
  language: Language;
  format: PostFormat;
  creativity: Creativity;
}

export interface AppSettings {
  chatGptUrl: string;
  defaultLanguage: Language;
  defaultFormat: PostFormat;
  defaultCreativity: Creativity;
  defaultWorkflowMode: WorkflowMode;
  defaultPostStructure: PostStructure;
  defaultCaptionMode: CaptionMode;
  recentHistoryWindow: number;
  productAssetsDirectory: string;
  referencesDirectory: string;
  splitRatio: number;
}

export interface HistoryRecord {
  id: number;
  createdAt: string;
  product: ProductId;
  workflowMode: WorkflowMode;
  postStructure: PostStructure;
  requestedSlideCount: RequestedSlideCount | null;
  captionMode: CaptionMode;
  postType: string;
  topic: string;
  visualStyle: string;
  creativityLevel: Creativity;
  format: PostFormat;
  language: Language;
  preparedBrief: string;
  conceptTitle: string | null;
  headline: string | null;
  status: HistoryStatus;
  notes: string | null;
}

export type HistoryInput = Omit<HistoryRecord, 'id' | 'createdAt'>;

export interface HistoryUpdate {
  status?: HistoryStatus;
  conceptTitle?: string | null;
  headline?: string | null;
  notes?: string | null;
}

export interface RotationRecommendation {
  productId: ProductId;
  reason: string;
  scores: Record<string, number>;
}

export interface DashboardSummary {
  recommendation: RotationRecommendation;
  recent: HistoryRecord[];
  usedCounts: Record<string, number>;
}
