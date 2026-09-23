"use strict";

// src/local-runner/api.ts
var import_node_http = require("http");
var import_node_fs4 = require("fs");
var import_node_path4 = require("path");

// src/local-runner/staging.ts
var import_node_crypto2 = require("crypto");
var import_node_fs3 = require("fs");
var import_node_path3 = require("path");

// src/domain/types.ts
var productIds = ["cleanser", "toner", "serum", "eye-cream", "skin-cream", "mask", "full-series"];
var captionModes = ["SHORT", "STANDARD", "DETAILED", "NONE"];
var workflowModes = ["DIRECT_IMAGE", "EXPLORE_IDEAS"];
var computeModes = ["local", "remote"];
var h3PromptEngineModelId = "qwen/qwen3.8-27b";
var h3PromptEngineProductionDefaults = {
  temperature: 0.2,
  repairAttempts: 2,
  disableThinking: true,
  timeoutSeconds: 600
};
var h3WorkflowAspectRatioValues = ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"];
var h3ContentTypes = ["Hook", "Benefits", "Ingredients", "Product", "Support B-Roll", "CTA / End Card"];
var legacyH3ContentTypes = ["Cinematic Product Ad", "UGC Content", "Product Demo", "Product B-Roll", "Product Transformation", "Educational", "Ingredient / Texture", "Custom"];
var h3ReferenceImageSizeOptions = ["match", "max"];
var h3SchedulerOptions = ["simple", "normal", "beta"];
var h3SeedModeOptions = ["random", "fixed"];
var postStructures = ["SINGLE_IMAGE", "CAROUSEL"];

// src/domain/comfy-workflow.ts
var h3ReferenceImageSlotLimit = 9;
function normalizedReferenceImages(variables) {
  const explicitValues = variables.referenceImages ?? [];
  const explicitReferences = explicitValues.filter((value) => typeof value === "string" && value.trim().length > 0);
  if (explicitReferences.length) return explicitReferences;
  return variables.productReference?.trim() ? [variables.productReference] : [];
}
function h3PlaceholderValues(variables) {
  const referenceImages = normalizedReferenceImages(variables);
  const values = {
    H3_PROMPT: variables.prompt ?? "",
    H3_GENERATION_BRIEF: variables.generationBrief ?? "",
    H3_REFERENCE_CONTEXT: variables.referenceContext ?? "",
    H3_MEDIA_MANIFEST: variables.mediaManifest ?? "",
    H3_SYSTEM_PROMPT: variables.systemPrompt ?? "",
    H3_LM_STUDIO_ENDPOINT: variables.lmStudioEndpoint ?? "http://127.0.0.1:1234/v1",
    // The autonomous H3 node is hard-wired to the one supported prompt model.
    H3_LM_STUDIO_MODEL: h3PromptEngineModelId,
    H3_TEMPERATURE: variables.temperature ?? h3PromptEngineProductionDefaults.temperature,
    H3_REPAIR_ATTEMPTS: variables.repairAttempts ?? h3PromptEngineProductionDefaults.repairAttempts,
    H3_DISABLE_THINKING: variables.disableThinking ?? h3PromptEngineProductionDefaults.disableThinking,
    H3_UNLOAD_MODEL: variables.unloadModel ?? true,
    H3_PROMPT_TIMEOUT: variables.promptTimeout ?? h3PromptEngineProductionDefaults.timeoutSeconds,
    H3_LANGUAGE: variables.language ?? "Indonesian",
    H3_PROMPT_ASPECT_RATIO: variables.promptAspectRatio ?? variables.aspectRatio,
    H3_MODE: variables.mode,
    H3_DURATION: variables.duration,
    H3_ASPECT_RATIO: variables.aspectRatio,
    H3_WIDTH: variables.width,
    H3_HEIGHT: variables.height,
    H3_FPS: variables.fps,
    H3_FRAMES: variables.frames,
    H3_MEGAPIXELS: variables.megapixels,
    H3_MULTIPLE: variables.multiple,
    H3_STEPS: variables.steps ?? 20,
    H3_SEED: variables.seed,
    H3_REF_IMAGE_SIZE: variables.refImageSize ?? "match",
    H3_SCHEDULER: variables.scheduler ?? "simple",
    H3_OUTPUT_PREFIX: variables.outputPrefix
  };
  for (let index = 0; index < 9; index += 1) {
    values[`H3_REF_IMAGE_${index}`] = referenceImages[index] ?? "";
  }
  if (variables.firstFrame) values.H3_FIRST_FRAME = variables.firstFrame;
  if (variables.lastFrame) values.H3_LAST_FRAME = variables.lastFrame;
  if (variables.productReference) values.H3_PRODUCT_REFERENCE = variables.productReference;
  return values;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
function formatWorkflowError(message) {
  return new Error(`Invalid ComfyUI API workflow: ${message}`);
}
function parseComfyApiWorkflow(value) {
  if (!isRecord(value)) throw formatWorkflowError("the top level must be a node map object");
  if ("nodes" in value || "links" in value || "groups" in value || "version" in value) {
    throw formatWorkflowError("the supplied file looks like UI workflow JSON; export the workflow in ComfyUI API format");
  }
  const entries = Object.entries(value);
  if (entries.length === 0) throw formatWorkflowError("the node map is empty");
  for (const [nodeId, node] of entries) {
    if (!isRecord(node) || typeof node.class_type !== "string" || !node.class_type.trim()) {
      throw formatWorkflowError(`node ${nodeId} must contain a non-empty class_type`);
    }
    if (!isRecord(node.inputs)) throw formatWorkflowError(`node ${nodeId} must contain an inputs object`);
  }
  return cloneJson(value);
}
function replacePlaceholders(value, replacements) {
  if (typeof value === "string") {
    let result = value;
    let replacedPrompt = false;
    let replacedBrief = false;
    for (const [name, replacement] of Object.entries(replacements)) {
      if (typeof result !== "string") break;
      const token = `{{${name}}}`;
      if (result === token) {
        if (name === "H3_PROMPT") replacedPrompt = true;
        if (name === "H3_GENERATION_BRIEF") replacedBrief = true;
        result = replacement;
        break;
      }
      if (result.includes(token)) {
        result = result.replaceAll(token, String(replacement));
        if (name === "H3_PROMPT") replacedPrompt = true;
        if (name === "H3_GENERATION_BRIEF") replacedBrief = true;
      }
    }
    return { value: result, replacedPrompt, replacedBrief };
  }
  if (Array.isArray(value)) {
    let replacedPrompt = false;
    let replacedBrief = false;
    const next = value.map((item) => {
      const replacement = replacePlaceholders(item, replacements);
      replacedPrompt ||= replacement.replacedPrompt;
      replacedBrief ||= replacement.replacedBrief;
      return replacement.value;
    });
    return { value: next, replacedPrompt, replacedBrief };
  }
  if (isRecord(value)) {
    let replacedPrompt = false;
    let replacedBrief = false;
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      const replacement = replacePlaceholders(item, replacements);
      replacedPrompt ||= replacement.replacedPrompt;
      replacedBrief ||= replacement.replacedBrief;
      next[key] = replacement.value;
    }
    return { value: next, replacedPrompt, replacedBrief };
  }
  return { value, replacedPrompt: false, replacedBrief: false };
}
function collectUnresolved(value, found) {
  if (typeof value === "string") {
    for (const match of value.matchAll(/{{H3_[A-Z0-9_]+}}/g)) found.add(match[0]);
  } else if (Array.isArray(value)) {
    for (const item of value) collectUnresolved(item, found);
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) collectUnresolved(item, found);
  }
}
function collectH3WorkflowPlaceholders(workflow) {
  const found = /* @__PURE__ */ new Set();
  for (const node of Object.values(workflow)) collectUnresolved(node.inputs, found);
  return [...found].sort();
}
function referenceImageIndex(inputName) {
  const match = /^ref_images\.ref_image_(\d+)$/.exec(inputName);
  return match ? Number(match[1]) : null;
}
function nextNumericNodeId(workflow) {
  const numericIds = Object.keys(workflow).map((nodeId) => Number(nodeId)).filter((nodeId) => Number.isInteger(nodeId));
  return String((numericIds.length ? Math.max(...numericIds) : 0) + 1);
}
function ensureReferenceImageInputs(workflow, referenceCount) {
  const node = workflow["136"];
  if (!node || node.class_type !== "MiniMaxH3ReferenceToVideo" || referenceCount <= 0) return;
  if (referenceCount > h3ReferenceImageSlotLimit) {
    throw formatWorkflowError(`the MiniMax H3 node supports at most ${h3ReferenceImageSlotLimit} reference image slot(s), but ${referenceCount} were supplied`);
  }
  for (let index = 0; index < referenceCount; index += 1) {
    const inputName = `ref_images.ref_image_${index}`;
    if (inputName in node.inputs) continue;
    const nodeId = nextNumericNodeId(workflow);
    workflow[nodeId] = {
      class_type: "LoadImage",
      inputs: { image: `{{H3_REF_IMAGE_${index}}}` },
      _meta: { title: `Load Ref2VA Image ${index + 1}` }
    };
    node.inputs[inputName] = [nodeId, 0];
  }
}
function pruneUnusedReferenceInputs(workflow, referenceImages) {
  const node = workflow["136"];
  if (!node || node.class_type !== "MiniMaxH3ReferenceToVideo") return;
  const connectedInputs = Object.keys(node.inputs).map(referenceImageIndex).filter((index) => index !== null).sort((left, right) => left - right);
  const supportedCount = connectedInputs.length;
  const populatedCount = referenceImages.filter((value) => typeof value === "string" && value.trim()).length;
  if (populatedCount > supportedCount) {
    throw formatWorkflowError(`the workflow exposes ${supportedCount} reference image slot(s), but ${populatedCount} were supplied`);
  }
  for (const inputName of Object.keys(node.inputs)) {
    const index = referenceImageIndex(inputName);
    if (index !== null && index >= populatedCount) delete node.inputs[inputName];
  }
}
function prepareH3ComfyWorkflow(template, variables) {
  const workflow = parseComfyApiWorkflow(template);
  const replacements = h3PlaceholderValues(variables);
  const referenceImages = normalizedReferenceImages(variables);
  ensureReferenceImageInputs(workflow, referenceImages.length);
  let replacedPrompt = false;
  let replacedBrief = false;
  for (const node of Object.values(workflow)) {
    const replacement = replacePlaceholders(node.inputs, replacements);
    node.inputs = replacement.value;
    replacedPrompt ||= replacement.replacedPrompt;
    replacedBrief ||= replacement.replacedBrief;
  }
  if (!replacedPrompt && !replacedBrief) throw formatWorkflowError("add the {{H3_PROMPT}} or {{H3_GENERATION_BRIEF}} placeholder to the H3 prompt-engine input before submitting");
  const unresolved = /* @__PURE__ */ new Set();
  for (const node of Object.values(workflow)) collectUnresolved(node.inputs, unresolved);
  if (unresolved.size) throw formatWorkflowError(`required placeholders remain unresolved: ${Array.from(unresolved).sort().join(", ")}`);
  pruneUnusedReferenceInputs(workflow, referenceImages);
  return workflow;
}

// workflows/minimax-h3-api.json
var minimax_h3_api_default = {
  "92": {
    inputs: {
      filename_prefix: "{{H3_OUTPUT_PREFIX}}",
      format: "auto",
      "format.codec": "auto",
      codec: "auto",
      "video-preview": "",
      video: [
        "130",
        0
      ]
    },
    class_type: "SaveVideo",
    _meta: {
      title: "Save Video"
    }
  },
  "115": {
    inputs: {
      aspect_ratio: "{{H3_ASPECT_RATIO}}",
      megapixels: "{{H3_MEGAPIXELS}}",
      multiple: "{{H3_MULTIPLE}}"
    },
    class_type: "ResolutionSelector",
    _meta: {
      title: "Resolution Selector (Size)",
      proya_h3_workflow_defaults: {
        durationSeconds: 8,
        aspectRatio: "9:16",
        megapixels: 0.98,
        multiple: 32,
        fps: 24,
        steps: 20,
        scheduler: "simple",
        seedMode: "random",
        seed: 0,
        refImageSize: "max"
      }
    }
  },
  "119": {
    inputs: {
      vae_name: "minimax_h3_video_vae_fp16.safetensors"
    },
    class_type: "VAELoader",
    _meta: {
      title: "Load VAE"
    }
  },
  "120": {
    inputs: {
      vae_name: "minimax_h3_audio_vae_fp32.safetensors"
    },
    class_type: "VAELoader",
    _meta: {
      title: "Load VAE"
    }
  },
  "121": {
    inputs: {
      samples: [
        "125",
        0
      ],
      vae: [
        "120",
        0
      ]
    },
    class_type: "VAEDecodeAudio",
    _meta: {
      title: "VAE Decode Audio"
    }
  },
  "122": {
    inputs: {
      samples: [
        "125",
        0
      ],
      vae: [
        "119",
        0
      ]
    },
    class_type: "VAEDecode",
    _meta: {
      title: "VAE Decode"
    }
  },
  "123": {
    inputs: {
      sampler_name: "res_multistep"
    },
    class_type: "KSamplerSelect",
    _meta: {
      title: "KSamplerSelect"
    }
  },
  "124": {
    inputs: {
      scheduler: "{{H3_SCHEDULER}}",
      steps: [
        "142",
        0
      ],
      denoise: 1,
      model: [
        "127",
        0
      ]
    },
    class_type: "BasicScheduler",
    _meta: {
      title: "BasicScheduler"
    }
  },
  "125": {
    inputs: {
      noise: [
        "129",
        0
      ],
      guider: [
        "126",
        0
      ],
      sampler: [
        "123",
        0
      ],
      sigmas: [
        "124",
        0
      ],
      latent_image: [
        "136",
        1
      ]
    },
    class_type: "SamplerCustomAdvanced",
    _meta: {
      title: "SamplerCustomAdvanced"
    }
  },
  "126": {
    inputs: {
      model: [
        "141",
        0
      ],
      conditioning: [
        "136",
        0
      ]
    },
    class_type: "BasicGuider",
    _meta: {
      title: "Basic Guider"
    }
  },
  "127": {
    inputs: {
      unet_name: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
      weight_dtype: "default"
    },
    class_type: "UNETLoader",
    _meta: {
      title: "Load Diffusion Model"
    }
  },
  "128": {
    inputs: {
      clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
      type: "minimax",
      device: "default"
    },
    class_type: "CLIPLoader",
    _meta: {
      title: "Load CLIP"
    }
  },
  "129": {
    inputs: {
      noise_seed: "{{H3_SEED}}"
    },
    class_type: "RandomNoise",
    _meta: {
      title: "RandomNoise"
    }
  },
  "130": {
    inputs: {
      fps: "{{H3_FPS}}",
      bit_depth: 8,
      color_space: "sRGB",
      images: [
        "122",
        0
      ],
      audio: [
        "121",
        0
      ]
    },
    class_type: "CreateVideo",
    _meta: {
      title: "Create Video"
    }
  },
  "131": {
    inputs: {
      expression: "{{H3_FRAMES}} + 0",
      "values.a": [
        "132",
        0
      ]
    },
    class_type: "ComfyMathExpression",
    _meta: {
      title: "Math Expression"
    }
  },
  "132": {
    inputs: {
      value: 5
    },
    class_type: "PrimitiveFloat",
    _meta: {
      title: "Float (Duration)"
    }
  },
  "136": {
    inputs: {
      prompt: [
        "151",
        0
      ],
      width: [
        "115",
        0
      ],
      height: [
        "115",
        1
      ],
      length: [
        "131",
        1
      ],
      ref_image_size: "{{H3_REF_IMAGE_SIZE}}",
      clip: [
        "128",
        0
      ],
      vae: [
        "119",
        0
      ],
      audio_vae: [
        "120",
        0
      ],
      "ref_images.ref_image_0": [
        "137",
        0
      ],
      "ref_images.ref_image_1": [
        "139",
        0
      ]
    },
    class_type: "MiniMaxH3ReferenceToVideo",
    _meta: {
      title: "MiniMax H3 Reference to Video"
    }
  },
  "147": {
    inputs: {
      value: "{{H3_GENERATION_BRIEF}}"
    },
    class_type: "PrimitiveStringMultiline",
    _meta: {
      title: "H3 Generation Brief (Intermediate)"
    }
  },
  "148": {
    inputs: {
      value: "{{H3_REFERENCE_CONTEXT}}"
    },
    class_type: "PrimitiveStringMultiline",
    _meta: {
      title: "H3 Reference Context"
    }
  },
  "149": {
    inputs: {
      basic_prompt: [
        "147",
        0
      ],
      mode: "ref2va",
      duration_seconds: "{{H3_DURATION}}",
      reference_context: [
        "148",
        0
      ],
      media_manifest: [
        "153",
        0
      ],
      endpoint: "{{H3_LM_STUDIO_ENDPOINT}}",
      model: "{{H3_LM_STUDIO_MODEL}}",
      api_key: "",
      temperature: "{{H3_TEMPERATURE}}",
      timeout_seconds: "{{H3_PROMPT_TIMEOUT}}",
      repair_attempts: "{{H3_REPAIR_ATTEMPTS}}",
      disable_thinking: "{{H3_DISABLE_THINKING}}",
      allow_remote_endpoint: false,
      use_remote_model: true,
      aspect_ratio: "{{H3_PROMPT_ASPECT_RATIO}}",
      frame_count: "{{H3_FRAMES}}",
      delivery_target: "api_v2",
      dialogue_language: "{{H3_LANGUAGE}}",
      target_megapixels: 0,
      system_prompt_override: "{{H3_SYSTEM_PROMPT}}"
    },
    class_type: "MiniMaxH3PromptEnhancer",
    _meta: {
      title: "MiniMax H3 Prompt Enhancer (Qwen / LM Studio)"
    }
  },
  "150": {
    inputs: {
      prompt: [
        "149",
        0
      ],
      mode: "ref2va",
      duration_seconds: "{{H3_DURATION}}",
      source_prompt: [
        "147",
        0
      ],
      reference_context: [
        "148",
        0
      ],
      media_manifest: [
        "153",
        0
      ],
      aspect_ratio: "{{H3_PROMPT_ASPECT_RATIO}}",
      frame_count: "{{H3_FRAMES}}",
      delivery_target: "api_v2",
      dialogue_language: "{{H3_LANGUAGE}}"
    },
    class_type: "MiniMaxH3PromptValidator",
    _meta: {
      title: "MiniMax H3 Prompt Validator"
    }
  },
  "151": {
    inputs: {
      prompt: [
        "152",
        0
      ],
      valid: [
        "152",
        1
      ],
      validation_report: [
        "152",
        2
      ],
      unload_succeeded: [
        "152",
        3
      ],
      unload_error: [
        "152",
        4
      ]
    },
    class_type: "MiniMaxH3PromptValidityGate",
    _meta: {
      title: "Block Invalid H3 Prompt After Qwen Cleanup"
    }
  },
  "152": {
    inputs: {
      prompt: [
        "150",
        0
      ],
      valid: [
        "150",
        1
      ],
      validation_report: [
        "150",
        2
      ],
      endpoint: "{{H3_LM_STUDIO_ENDPOINT}}",
      model: [
        "149",
        8
      ],
      instance_id: [
        "149",
        9
      ],
      unload: "{{H3_UNLOAD_MODEL}}"
    },
    class_type: "MiniMaxH3UnloadLMStudioModel",
    _meta: {
      title: "Finalize Qwen Cleanup Before Validity Gate"
    }
  },
  "153": {
    inputs: {
      value: "{{H3_MEDIA_MANIFEST}}"
    },
    class_type: "PrimitiveStringMultiline",
    _meta: {
      title: "H3 Authoritative Media Manifest"
    }
  },
  "137": {
    inputs: {
      image: "{{H3_REF_IMAGE_0}}"
    },
    class_type: "LoadImage",
    _meta: {
      title: "Load Image"
    }
  },
  "138": {
    inputs: {
      value: "{{H3_PROMPT}}"
    },
    class_type: "PrimitiveStringMultiline",
    _meta: {
      title: "Input Text (Prompt)"
    }
  },
  "139": {
    inputs: {
      image: "{{H3_REF_IMAGE_1}}"
    },
    class_type: "LoadImage",
    _meta: {
      title: "Load Image"
    }
  },
  "141": {
    inputs: {
      switch: [
        "146",
        0
      ],
      on_false: [
        "127",
        0
      ],
      on_true: [
        "145",
        0
      ]
    },
    class_type: "ComfySwitchNode",
    _meta: {
      title: "If/Else Switch (model)"
    }
  },
  "142": {
    inputs: {
      switch: [
        "146",
        0
      ],
      on_false: [
        "143",
        0
      ],
      on_true: [
        "144",
        0
      ]
    },
    class_type: "ComfySwitchNode",
    _meta: {
      title: "If/Else Switch (Steps)"
    }
  },
  "143": {
    inputs: {
      value: "{{H3_STEPS}}"
    },
    class_type: "PrimitiveInt",
    _meta: {
      title: "Int (Full)"
    }
  },
  "144": {
    inputs: {
      value: 4
    },
    class_type: "PrimitiveInt",
    _meta: {
      title: "Int (Lightning LoRA)"
    }
  },
  "145": {
    inputs: {
      lora_name: "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors",
      strength_model: 1,
      model: [
        "127",
        0
      ]
    },
    class_type: "LoraLoaderModelOnly",
    _meta: {
      title: "Load LoRA"
    }
  },
  "146": {
    inputs: {
      value: false
    },
    class_type: "PrimitiveBoolean",
    _meta: {
      title: "Boolean (Enable Lightning LoRA)"
    }
  }
};

// src/domain/support-b-roll.ts
var SUPPORT_B_ROLL_CONTENT_TYPE = "Support B-Roll";
function isSupportBRoll(contentType) {
  return contentType === SUPPORT_B_ROLL_CONTENT_TYPE;
}
function isNoProductVideo(contentType) {
  return contentType === "Hook" || contentType === "Benefits" || contentType === "Ingredients" || isSupportBRoll(contentType);
}
function supportBRollTheme(product) {
  switch (product) {
    case "cleanser":
      return "cleansing, a fresh reset, foam, water, a clean bathroom, and the first skincare step";
    case "toner":
      return "hydration, mist, dewy freshness, a prep step, and a refreshing reset";
    case "serum":
      return "brightening, dark spots, glow, vitamin C, and an active-treatment feeling";
    case "eye-cream":
      return "tired eyes, under-eye concern, a refreshed eye area, and a rested look";
    case "skin-cream":
      return "dryness, moisture-barrier comfort, and supple nourished skin";
    case "mask":
      return "soothing, calming, cooling comfort, and a pampering ritual";
    case "full-series":
      return "a generic skincare beauty or science theme";
  }
}
function supportBRollReferencePlan(plan) {
  return {
    firstFrame: { source: "none", description: "", path: null },
    lastFrame: { source: "none", description: "", path: null },
    productReference: { source: "none", description: "", path: null },
    styleReference: plan.styleReference.source === "custom" ? { source: "custom", description: plan.styleReference.description, path: null } : { source: "none", description: "", path: null },
    referenceImages: []
  };
}
function supportBRollGuardrails(product) {
  return `Use the selected product only as a semantic theme driver: ${supportBRollTheme(product)}. This is reusable non-product supporting footage. Do not show any skincare product, packaging, packshot, bottle, tube, jar, box, product label, PROYA branding, brand logo, or fake product text. Ignore any conflicting user direction that requests one of those forbidden visuals. Human/lifestyle footage, abstract beauty footage, and science animation are allowed. Avoid on-screen text unless the existing caption or subtitle settings explicitly request it. The result must work as standalone b-roll, hook footage, a cutaway, educational filler, or a transition.`;
}

// data/products.json
var products_default = [
  {
    id: "cleanser",
    officialName: "PROYA 5X Vitamin C Facial Cleanser",
    shortName: "Cleanser",
    size: "100g",
    role: "Gentle cleansing and brightening preparation",
    imagePath: "product-assets/cleanser.png",
    packagingDescription: "Wide upright warm orange opaque squeeze tube, white flip-top base cap, black framed front label, black PROYA wordmark, prominent white VITAMIN C text.",
    physicalIdentity: {
      packageType: "squeeze tube",
      packageComponents: ["tube body", "flip-top base cap"],
      size: "100g",
      shape: "wide upright tube with a crimped top seam, gently tapered sides, and flat white base cap",
      proportions: "tall and broad; wider than the Eye Cream tube",
      closureType: "white flip-top base cap",
      physicalMaterial: "unknown / do not infer; match visible reference",
      surfaceAppearance: "smooth glossy warm-orange tube surface with soft edge highlights",
      transparency: "opaque warm-orange tube body; package walls do not reveal contents",
      visibleGlassTransparency: false,
      frontSurfaceAppearance: {
        appliesTo: "front printed face of the tube body; white flip-top base cap remains a separate closure surface",
        verification: "verified from the supplied Cleanser front master reference",
        content: "official printed artwork",
        printedArtwork: "the official black framed front label, black PROYA wordmark, prominent white VITAMIN C, product name, and 100g marking only",
        text: "official front packaging text only",
        graphics: "official black frame and front graphics only",
        logos: "official black PROYA wordmark only",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "official centered black front label only",
        finish: "smooth glossy warm-orange opaque tube surface with soft edge highlights",
        continuity: "the front face is the only printed face; official artwork does not wrap onto the rear or side surfaces"
      },
      rearSurfaceAppearance: {
        appliesTo: "rear, side, and otherwise unprinted tube surfaces",
        verification: "verified PROYA catalog knowledge",
        content: "blank",
        printedArtwork: "none",
        text: "none",
        graphics: "none",
        logos: "none",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "none",
        finish: "continue the same smooth glossy warm-orange opaque tube appearance",
        continuity: "clean blank uninterrupted continuation of the same opaque warm-orange tube color and glossy finish"
      },
      sideSurfaceAppearance: {
        appliesTo: "left and right side surfaces of the tube body",
        verification: "verified PROYA catalog knowledge",
        content: "blank",
        printedArtwork: "none",
        text: "none",
        graphics: "none",
        logos: "none",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "none",
        finish: "continue the same smooth glossy warm-orange opaque tube appearance",
        continuity: "clean blank uninterrupted continuation of the same opaque warm-orange tube color and glossy finish"
      },
      opacityBehavior: "opaque orange tube body with non-see-through package walls; white lid is opaque where shown; surface highlights do not reveal the interior",
      contentsVisibility: "contents are not visible through the opaque tube walls; no internal product completion through the package",
      colorAppearance: "warm orange body with white base cap and black-and-white front graphics",
      labelAppearance: "centered black rectangular frame; black PROYA wordmark; prominent white VITAMIN C; product name and 100g marking in the positions shown",
      referenceAuthority: "The supplied Cleanser reference image is highest authority for every visible packaging property; metadata only supplements it.",
      referencePresentationState: ["tube is upright", "flip-top base cap is attached and closed"],
      unprintedSurfaceAppearance: {
        appliesTo: "rear, side, and otherwise unprinted tube surfaces",
        verification: "verified PROYA catalog knowledge",
        content: "blank",
        text: "none",
        graphics: "none",
        logos: "none",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "none",
        finish: "continue the same smooth glossy warm-orange opaque tube appearance"
      },
      dimensions: {
        measurementAuthority: "manually measured from the actual PROYA Cleanser product",
        overallHeightCm: 14,
        widthBottomCm: 3.5,
        widthTopCm: 6,
        componentMeasurements: [{ component: "white lid", heightCm: 2 }],
        notes: ["Overall height is authoritative", "Do not infer any unrecorded depth or component dimension"]
      },
      forbiddenInterpretations: ["bottle", "dropper", "pump or spray mechanism", "jar", "sachet", "Serum-style glass packaging"]
    },
    ingredients: ["5X Vitamin C Derivatives", "Amino Acid Surfactant"],
    benefitTerritories: ["Gentle daily cleansing", "Fresh, brighter-looking skin", "Soft fine foam", "Comfortable non-tight-feeling finish", "Prepares skin for the next skincare steps"],
    safeCopy: ["Membersihkan lembut tanpa rasa tertarik.", "Bantu kulit tampak segar dan lebih cerah.", "Busa halus untuk langkah awal rutinitasmu."],
    topics: ["Why gentle cleansing matters", "Start bright", "Fine foam texture", "Morning freshness", "Prep before toner"],
    visualMotifs: ["Soft foam clouds", "White creamy bubbles", "Water splash", "Citrus glow", "Clean white-orange studio"],
    textureCues: ["fine dense foam", "soft creamy bubbles"],
    usagePosition: "Step 1 \u2014 cleanse morning and evening",
    packagingRestrictions: ["Must remain a squeeze tube", "Preserve the white base cap", "Do not turn into a bottle", "Keep the black framed label and orange-white identity"],
    isHero: false
  },
  {
    id: "toner",
    officialName: "PROYA 5X Vitamin C Toner",
    shortName: "Toner",
    size: "100ml",
    role: "Hydration, secondary cleansing support, and preparation",
    imagePath: "product-assets/toner.png",
    packagingDescription: "Tall cylindrical warm orange bottle with white spray pump assembly and tall clear outer cap; black framed label with black PROYA wordmark and prominent white VITAMIN C text.",
    physicalIdentity: {
      packageType: "spray-pump bottle",
      packageComponents: ["bottle body", "spray pump assembly", "outer protective cap"],
      size: "100ml",
      shape: "tall straight cylindrical bottle body with a tall protective outer cap",
      proportions: "slender and tall; pump-and-cap assembly occupies the upper portion",
      closureType: "white spray pump assembly under a tall clear outer protective cap",
      physicalMaterial: "unknown / do not infer; match visible reference",
      surfaceAppearance: "smooth glossy opaque orange bottle body; opaque white pump assembly; clear glossy outer cap",
      transparency: "opaque bottle body; transparent outer protective cap only",
      visibleGlassTransparency: false,
      frontSurfaceAppearance: {
        appliesTo: "front printed face of the orange bottle body; white pump assembly and clear outer cap remain separate components",
        verification: "verified from the supplied Toner front master reference",
        content: "official printed artwork",
        printedArtwork: "the official centered black framed label, black PROYA wordmark, prominent white VITAMIN C, TONER, and 100ml marking only",
        text: "official front packaging text only",
        graphics: "official black frame and front graphics only",
        logos: "official black PROYA wordmark only",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "official centered front label only",
        finish: "smooth glossy opaque warm-orange bottle-body surface; opaque white pump assembly; clear glossy outer cap",
        continuity: "the front face is the only printed face; official artwork does not wrap onto the rear or side surfaces"
      },
      rearSurfaceAppearance: {
        appliesTo: "rear, side, and otherwise unprinted bottle-body surfaces",
        verification: "verified PROYA catalog knowledge",
        content: "blank",
        printedArtwork: "none",
        text: "none",
        graphics: "none",
        logos: "none",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "none",
        finish: "continue the same smooth glossy opaque warm-orange bottle-body appearance; the clear outer cap remains clear and unprinted",
        continuity: "clean blank uninterrupted continuation of the same opaque warm-orange bottle-body color and finish; the clear cap stays clear without added print"
      },
      sideSurfaceAppearance: {
        appliesTo: "left and right side surfaces of the opaque bottle body; corresponding side-facing pump and outer-cap surfaces",
        verification: "verified PROYA catalog knowledge",
        content: "blank",
        printedArtwork: "none",
        text: "none",
        graphics: "none",
        logos: "none",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "none",
        finish: "continue the same smooth glossy opaque warm-orange bottle-body appearance; the clear outer cap remains clear and unprinted",
        continuity: "clean blank uninterrupted continuation of the same opaque warm-orange bottle-body color and finish; the clear cap stays clear without added print"
      },
      opacityBehavior: "opaque orange bottle body and opaque white pump assembly; only the separate outer protective cap is clear; bottle walls do not reveal contents",
      contentsVisibility: "contents are not visible through the opaque bottle body; the clear outer cap shows only the pump assembly it encloses, not invented liquid detail",
      colorAppearance: "warm orange body, white pump assembly, clear outer cap, black-and-white front graphics",
      labelAppearance: "centered tall black rectangular frame; black PROYA wordmark; prominent white VITAMIN C; TONER and 100ml markings in the positions shown",
      referenceAuthority: "The supplied Toner reference image is highest authority for every visible packaging property; metadata only supplements it.",
      referencePresentationState: ["bottle is upright", "spray pump is installed", "outer protective cap is fitted over the pump"],
      unprintedSurfaceAppearance: {
        appliesTo: "rear, side, and otherwise unprinted bottle-body surfaces",
        verification: "verified PROYA catalog knowledge",
        content: "blank",
        text: "none",
        graphics: "none",
        logos: "none",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "none",
        finish: "continue the same smooth glossy opaque warm-orange bottle-body appearance; the clear outer cap remains clear and unprinted"
      },
      dimensions: {
        measurementAuthority: "manually measured from the actual PROYA Toner product",
        overallHeightCm: 14,
        widthCm: 4,
        componentMeasurements: [
          { component: "white pump assembly", heightCm: 4.5, notes: "May overlap other measured upper components; not additive" },
          { component: "white base portion", heightCm: 2, notes: "May overlap other measured upper components; not additive" },
          { component: "transparent protective cap", heightCm: 3, notes: "May overlap other measured upper components; not additive" }
        ],
        notes: ["Verified overall height is 14 cm and overrides any derived total", "Pump, base, and cap measurements may overlap physically and must never be summed to calculate overall height"]
      },
      forbiddenInterpretations: ["glass serum bottle", "transparent or frosted bottle body", "dropper bottle", "Serum-style packaging", "squeeze tube", "jar", "visible liquid through the bottle body"]
    },
    ingredients: ["5X Vitamin C Derivatives", "Hyaluronic Acid", "Plant Extracts"],
    benefitTerritories: ["Refreshing hydration", "Helps replenish moisture", "Prepares skin for the next skincare step", "Fresh radiant appearance", "Lightweight everyday toner"],
    safeCopy: ["Hydrasi ringan untuk kulit terasa segar.", "Bantu menjaga kelembapan sebelum serum.", "Mist, hydrate, glow."],
    topics: ["Hydration prep", "Fine mist ritual", "Why toner comes before serum", "Dehydrated-looking skin", "Morning refresh"],
    visualMotifs: ["Fine facial mist", "Water droplets", "Transparent acrylic", "Water ripple", "Dewy glass"],
    textureCues: ["fine mist", "lightweight watery hydration"],
    usagePosition: "Step 2 \u2014 mist from approximately 15\u201320 cm after cleansing",
    packagingRestrictions: ["Must remain a spray/pump bottle", "Preserve the clear outer cap", "Do not convert into a dropper bottle", "Keep the cylindrical orange body"],
    isHero: false
  },
  {
    id: "serum",
    officialName: "PROYA 5X Vitamin C Serum",
    shortName: "Serum",
    size: "30ml",
    role: "Hero brightening treatment",
    imagePath: "product-assets/serum.png",
    packagingDescription: "Short rounded amber-orange bottle with narrow shoulders and a white dropper; black framed label, black PROYA wordmark, prominent white VITAMIN C text.",
    physicalIdentity: {
      packageType: "dropper bottle",
      packageComponents: ["bottle body", "dropper closure"],
      size: "30ml",
      shape: "short rounded bottle with curved shoulders, narrow neck, and round base",
      proportions: "compact body with a tall white dropper closure",
      closureType: "white bulb-and-collar dropper",
      physicalMaterial: "glass",
      surfaceAppearance: "opaque painted/coated glossy amber-orange exterior matching the supplied reference",
      transparency: "opaque; no visible internal liquid",
      visibleGlassTransparency: false,
      frontSurfaceAppearance: {
        appliesTo: "front printed face of the coated amber-orange bottle body; white dropper remains a separate closure",
        verification: "verified from the supplied Serum front master reference",
        content: "official printed artwork",
        printedArtwork: "the official centered black framed label, black PROYA wordmark, prominent white VITAMIN C, SERUM, and 30ml marking only",
        text: "official front packaging text only",
        graphics: "official black frame and front graphics only",
        logos: "official black PROYA wordmark only",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "official centered black front label only",
        finish: "opaque painted/coated glossy amber-orange exterior matching the supplied reference",
        continuity: "the front face is the only printed face; official artwork does not wrap onto the rear or side surfaces"
      },
      rearSurfaceAppearance: {
        appliesTo: "rear, side, and otherwise unprinted bottle surfaces",
        verification: "verified PROYA catalog knowledge",
        content: "blank",
        printedArtwork: "none",
        text: "none",
        graphics: "none",
        logos: "none",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "none",
        finish: "continue the same opaque painted/coated glossy amber-orange appearance with no visible internal liquid",
        continuity: "clean blank uninterrupted continuation of the same opaque painted/coated glossy amber-orange color and finish"
      },
      sideSurfaceAppearance: {
        appliesTo: "left and right side surfaces of the coated amber-orange bottle body",
        verification: "verified PROYA catalog knowledge",
        content: "blank",
        printedArtwork: "none",
        text: "none",
        graphics: "none",
        logos: "none",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "none",
        finish: "continue the same opaque painted/coated glossy amber-orange appearance with no visible internal liquid",
        continuity: "clean blank uninterrupted continuation of the same opaque painted/coated glossy amber-orange color and finish"
      },
      opacityBehavior: "opaque painted/coated amber-orange bottle body; bottle walls block the view of contents; highlights are surface reflections only",
      contentsVisibility: "actual liquid is not visible through the coated bottle walls; only a separately exposed dropper liquid may be shown according to the verified contents appearance",
      colorAppearance: "amber-orange coated body with white dropper and black-and-white front graphics",
      labelAppearance: "centered black rectangular frame; black PROYA wordmark; prominent white VITAMIN C; SERUM and 30ml markings in the positions shown",
      referenceAuthority: "The supplied Serum reference image is highest authority for visible appearance; verified glass material must not override the opaque coated appearance.",
      referencePresentationState: ["bottle is upright", "dropper closure is installed"],
      unprintedSurfaceAppearance: {
        appliesTo: "rear, side, and otherwise unprinted bottle surfaces",
        verification: "verified PROYA catalog knowledge",
        content: "blank",
        text: "none",
        graphics: "none",
        logos: "none",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "none",
        finish: "continue the same opaque painted/coated glossy amber-orange appearance with no visible internal liquid"
      },
      dimensions: {
        measurementAuthority: "manually measured from the actual PROYA Serum product",
        overallHeightCm: 10,
        widthCm: 3,
        componentMeasurements: [{ component: "white dropper assembly", heightCm: 3.5 }],
        notes: ["Overall height is authoritative", "Component height is a proportion cue and must not be used to infer unrecorded bottle-body height"]
      },
      contentsAppearance: {
        appliesTo: "actual Serum liquid when exposed through a dropper, droplet, pour, macro shot, or transformation",
        verification: "manually verified from the actual PROYA Serum product",
        color: "clear and colorless",
        transparency: "transparent",
        visualConsistency: "water-like",
        visibleThroughPackageWalls: false,
        packageVisibility: "not visible through the opaque painted/coated amber-orange bottle walls",
        forbiddenColorInterpretations: ["golden", "amber", "yellow", "orange"],
        stylingSeparation: "Orange or golden brand lighting and environmental effects may remain, but they must not recolor the actual Serum liquid"
      },
      forbiddenInterpretations: ["transparent glass bottle", "frosted glass bottle", "visible serum through the bottle", "pump or spray mechanism", "tall Toner proportions", "tube", "jar"]
    },
    ingredients: ["5X Vitamin C Derivatives", "Tranexamic Acid", "Arbutin", "Ergothioneine", "Carnosine", "Mandelic Acid"],
    benefitTerritories: ["Intensive brightening care", "Helps improve the appearance of dull skin", "Helps fade the look of dark spots", "Supports a more even-looking skin tone", "Lightweight texture", "Natural radiant appearance"],
    safeCopy: ["Hero serum untuk bantu kulit kusam tampak lebih cerah.", "Bantu menyamarkan tampilan noda hitam.", "5X Vitamin C, satu langkah brightening harian."],
    topics: ["Brightening hero", "Dull and uneven-looking skin", "5X Vitamin C technology", "Lightweight serum texture", "Dark-spot appearance care", "Mandelic Acid in the serum"],
    visualMotifs: ["Hero pedestal", "Clear colorless serum droplet", "Dropper above bottle", "Molecular graphics", "Orange halo", "Glass refraction"],
    textureCues: ["clear colorless transparent water-like serum", "clear transparent droplet"],
    usagePosition: "Treatment step \u2014 apply after toner and eye cream in the documented routine",
    packagingRestrictions: ["Must remain a short rounded dropper bottle", "Preserve the white dropper", "Do not add a pump", "Keep front-label balance and 30ml marking"],
    isHero: true
  },
  {
    id: "eye-cream",
    officialName: "PROYA 5X Vitamin C Eye Cream",
    shortName: "Eye Cream",
    size: "20g",
    role: "Bright-looking, hydrated, smoother eye-area care",
    imagePath: "product-assets/eye-cream.png",
    packagingDescription: "Slim narrow warm orange squeeze tube with small white base cap; black PROYA wordmark, prominent white VITAMIN C text, fine black frame lines.",
    physicalIdentity: {
      packageType: "slim squeeze tube",
      packageComponents: ["tube body", "base cap"],
      size: "20g",
      shape: "very narrow elongated tube with a crimped top seam and small flat white base cap",
      proportions: "very tall and slender; distinctly narrower than the Cleanser tube",
      closureType: "small white base cap",
      physicalMaterial: "unknown / do not infer; match visible reference",
      surfaceAppearance: "smooth glossy warm-orange tube surface with bright vertical highlights",
      transparency: "match the orange tube appearance exactly; do not infer transparency or reveal contents",
      visibleGlassTransparency: false,
      frontSurfaceAppearance: {
        appliesTo: "front printed face of the narrow tube body; small white base cap remains a separate closure surface",
        verification: "verified from the supplied Eye Cream front master reference",
        content: "official printed artwork",
        printedArtwork: "the official fine black frame lines, black PROYA wordmark, prominent white VITAMIN C, ingredient text, and 20g marking only",
        text: "official front packaging text only",
        graphics: "official fine black frame lines and front graphics only",
        logos: "official black PROYA wordmark only",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "official upper front label area only",
        finish: "smooth glossy warm-orange tube surface with bright vertical highlights",
        continuity: "the front face is the only printed face; official artwork does not wrap onto the rear or side surfaces"
      },
      rearSurfaceAppearance: {
        appliesTo: "rear, side, and otherwise unprinted tube surfaces",
        verification: "verified PROYA catalog knowledge",
        content: "blank",
        printedArtwork: "none",
        text: "none",
        graphics: "none",
        logos: "none",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "none",
        finish: "continue the same smooth glossy warm-orange tube appearance without revealing contents",
        continuity: "clean blank uninterrupted continuation of the same warm-orange tube color and glossy finish"
      },
      sideSurfaceAppearance: {
        appliesTo: "left and right side surfaces of the narrow tube body",
        verification: "verified PROYA catalog knowledge",
        content: "blank",
        printedArtwork: "none",
        text: "none",
        graphics: "none",
        logos: "none",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "none",
        finish: "continue the same smooth glossy warm-orange tube appearance without revealing contents",
        continuity: "clean blank uninterrupted continuation of the same warm-orange tube color and glossy finish"
      },
      opacityBehavior: "opaque package body; match the reference-visible warm-orange finish; package walls do not reveal contents",
      contentsVisibility: "contents are not visible through the opaque tube walls; do not add internal product visibility",
      colorAppearance: "warm orange body with small white base cap and black-and-white front graphics",
      labelAppearance: "fine black frame lines around the upper label area; black PROYA wordmark; prominent white VITAMIN C; ingredient text and 20g marking in the positions shown",
      referenceAuthority: "The supplied Eye Cream reference image is highest authority for every visible packaging property; metadata only supplements it.",
      referencePresentationState: ["tube is upright", "base cap is attached and closed"],
      unprintedSurfaceAppearance: {
        appliesTo: "rear, side, and otherwise unprinted tube surfaces",
        verification: "verified PROYA catalog knowledge",
        content: "blank",
        text: "none",
        graphics: "none",
        logos: "none",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "none",
        finish: "continue the same smooth glossy warm-orange tube appearance without revealing contents"
      },
      dimensions: {
        measurementAuthority: "manually measured from the actual PROYA Eye Cream product",
        overallHeightCm: 13,
        widthBottomCm: 1.5,
        widthTopCm: 3,
        componentMeasurements: [{ component: "white closure/lid", heightCm: 3 }],
        notes: ["Overall height is authoritative", "Do not infer any unrecorded depth or component dimension"]
      },
      forbiddenInterpretations: ["bottle", "glass packaging", "dropper", "pump or spray mechanism", "jar", "wide Cleanser proportions"]
    },
    ingredients: ["5X Vitamin C Derivatives", "Niacinamide", "Ergothioneine"],
    benefitTerritories: ["Helps brighten the look of the eye area", "Helps reduce the appearance of dark circles", "Hydrating eye-area care", "Smoother refreshed appearance", "Lightweight gentle-looking care"],
    safeCopy: ["Bantu area mata tampak lebih cerah dan segar.", "Perawatan ringan untuk tampilan dark circle.", "Hydrate, smooth, brighten."],
    topics: ["Tired-looking eyes", "Dark-circle appearance", "Gentle eye-area ritual", "Silky texture", "Morning eye refresh"],
    visualMotifs: ["Smooth silk ribbon", "Soft morning light", "Pearl-white cream", "Subtle eye-contour curve", "Delicate glow"],
    textureCues: ["silky fine cream", "pearl-white ribbon"],
    usagePosition: "Eye-care step \u2014 use a pea-sized amount after cleansing",
    packagingRestrictions: ["Must remain a slim squeeze tube", "Preserve the small white base cap", "Do not turn into a jar", "Keep the long narrow proportions"],
    isHero: false
  },
  {
    id: "skin-cream",
    officialName: "PROYA 5X Vitamin C Skin Cream",
    shortName: "Skin Cream",
    size: "50g",
    role: "Moisture lock and skin-barrier support",
    imagePath: "product-assets/skin-cream.png",
    packagingDescription: "Low round warm orange cream jar shown open in the supplied reference, with glossy white cream visible through the open top and its detached white lid positioned underneath the jar for the photograph; black framed curved label and black PROYA wordmark.",
    physicalIdentity: {
      packageType: "cream jar",
      packageComponents: ["jar body", "detachable lid"],
      size: "50g",
      shape: "low round wide-mouth jar body with circular rim; the detached lid shown underneath is separate and is not part of the permanent jar silhouette",
      proportions: "short and wide jar body; substantially wider than tall; detached lid remains a separate component",
      closureType: "detachable lid; exact mechanism follows reference",
      physicalMaterial: "unknown / do not infer; match visible reference",
      surfaceAppearance: "smooth glossy orange jar exterior; detached white lid shown underneath as a separate component; glossy white cream visibly exposed at the open top",
      transparency: "match the orange jar walls as shown; cream is visible only through the open top, not through invented transparent walls",
      visibleGlassTransparency: false,
      frontSurfaceAppearance: {
        appliesTo: "front printed face of the orange jar body; detached white lid remains a separate component and its visible face follows the reference",
        verification: "verified from the supplied Skin Cream front master reference",
        content: "official printed artwork",
        printedArtwork: "the official black curved rectangular frame, centered black PROYA wordmark, prominent white VITAMIN C, SKIN CREAM text, and visible size marking only",
        text: "official front packaging text only",
        graphics: "official black curved frame and front graphics only",
        logos: "official black PROYA wordmark only",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "official curved front label area only",
        finish: "smooth glossy warm-orange jar exterior; glossy white cream is exposed only through the open top; detached lid is white as shown",
        continuity: "the jar front is the only printed face; official artwork does not wrap onto the rear or side surfaces; the detached lid is not a second label"
      },
      rearSurfaceAppearance: {
        appliesTo: "rear, side, and otherwise unprinted jar-body and detachable-lid surfaces",
        verification: "verified PROYA catalog knowledge",
        content: "blank",
        printedArtwork: "none",
        text: "none",
        graphics: "none",
        logos: "none",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "none",
        finish: "continue the corresponding smooth glossy warm-orange jar-body appearance and the detached lid's white appearance",
        continuity: "clean blank uninterrupted continuation of the same warm-orange jar color and glossy finish; detached lid remains a separate blank white component"
      },
      sideSurfaceAppearance: {
        appliesTo: "left and right side surfaces of the orange jar body and side-facing surfaces of the detached white lid",
        verification: "verified PROYA catalog knowledge",
        content: "blank",
        printedArtwork: "none",
        text: "none",
        graphics: "none",
        logos: "none",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "none",
        finish: "continue the corresponding smooth glossy warm-orange jar-body appearance and the detached lid's white appearance",
        continuity: "clean blank uninterrupted continuation of the same warm-orange jar color and glossy finish; detached lid remains a separate blank white component"
      },
      opacityBehavior: "opaque warm-orange jar walls; no contents show through the jar body; glossy white cream is visible only through the open top; detached lid is opaque white where shown",
      contentsVisibility: "cream is visible only through the open jar top in the verified open presentation; it is not visible through the opaque orange jar walls",
      colorAppearance: "warm orange jar body, separate white lid, white cream, and black-and-white curved front graphics",
      labelAppearance: "black curved rectangular frame following the jar face; centered black PROYA wordmark; prominent white VITAMIN C; SKIN CREAM text in the positions shown",
      referenceAuthority: "The supplied Skin Cream reference image is highest authority for every visible packaging property. The detached lid shown underneath the jar is authoritative for the lid's visible appearance.",
      referencePresentationState: ["jar is open", "lid is removed from the jar", "removed lid is positioned underneath the jar in the supplied reference", "cream is visible only through the open jar top"],
      unprintedSurfaceAppearance: {
        appliesTo: "rear, side, and otherwise unprinted jar-body and detachable-lid surfaces",
        verification: "verified PROYA catalog knowledge",
        content: "blank",
        text: "none",
        graphics: "none",
        logos: "none",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "none",
        finish: "continue the corresponding smooth glossy warm-orange jar-body appearance and the detached lid's white appearance"
      },
      dimensions: {
        measurementAuthority: "manually measured from the actual PROYA Skin Cream product",
        overallHeightCm: 4.2,
        diameterCm: 6,
        componentMeasurements: [{ component: "white detachable lid", heightCm: 1.2 }],
        notes: ["Overall height and diameter are authoritative", "Do not derive jar-body height by subtracting lid height from overall height"]
      },
      forbiddenInterpretations: ["bottle", "dropper", "pump or spray mechanism", "tube", "sachet", "transparent serum-style container", "permanent white base", "integrated white pedestal", "double-base jar", "second lid", "duplicate closure"]
    },
    ingredients: ["5X Vitamin C Derivatives", "Tranexamic Acid", "Alpha-Arbutin"],
    benefitTerritories: ["Locks in moisture", "Helps support the skin barrier", "Helps smooth dry-feeling skin", "Soft comfortable cream texture", "Moisturized supple feel"],
    safeCopy: ["Kunci kelembapan untuk kulit terasa lembut dan nyaman.", "Bantu mendukung skin barrier.", "Lock in the glow."],
    topics: ["Moisture-locking final step", "Skin barrier support", "Cream swirl texture", "Dry-feeling skin comfort", "Night routine finish"],
    visualMotifs: ["Cream swirl macro", "Soft cloud forms", "Glossy white texture", "Rounded cream pedestal", "Warm orange backlight"],
    textureCues: ["glossy soft white cream", "smooth swirl", "rich but not greasy"],
    usagePosition: "Final skincare step \u2014 apply after treatment to lock in moisture",
    packagingRestrictions: ["Must remain a low round cream jar with one detachable lid", "The master reference shows the jar open with cream visible only through the open top", "The white component underneath the jar is the removed lid, not a permanent base or pedestal", "The detached lid shown in the reference is authoritative for the lid's visible appearance", "Do not invent a second lid, duplicate closure, or additional base"],
    isHero: false
  },
  {
    id: "mask",
    officialName: "PROYA Cooling & Soothing Face Mask",
    shortName: "Face Mask",
    size: "25ml / sheet",
    role: "Cooling, soothing hydration and refreshing care",
    imagePath: "product-assets/mask.png",
    packagingDescription: "Flat portrait orange sachet with rounded corners, notched sides, centered black framed label, black PROYA wordmark, white COOLING & SOOTHING title, and vivid green botanical line illustration across the lower portion.",
    physicalIdentity: {
      packageType: "single-use flat sachet",
      packageComponents: ["sealed sachet"],
      size: "25ml / sheet",
      shape: "flat portrait rectangular pouch with rounded corners, sealed perimeter, and opposing side notches near the top",
      proportions: "tall flat rectangle; no rigid three-dimensional container volume",
      closureType: "sealed tear-open sachet; no separate cap, pump, dropper, or lid",
      physicalMaterial: "unknown / do not infer; match visible reference",
      surfaceAppearance: "flat orange printed packet with a fine patterned sealed border and smooth softly reflective face",
      transparency: "opaque; contents are not visible",
      visibleGlassTransparency: false,
      frontSurfaceAppearance: {
        appliesTo: "front printed face of the flat sachet",
        verification: "verified from the supplied Face Mask front master reference",
        content: "official printed artwork",
        printedArtwork: "the official centered black framed label, black PROYA wordmark, white COOLING & SOOTHING title, vivid green botanical line illustration, and 25ml marking only",
        text: "official front packaging text only",
        graphics: "official black frame and vivid green botanical front illustration only",
        logos: "official black PROYA wordmark only",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "official centered front label only",
        finish: "flat orange printed packet with a fine patterned sealed border and smooth softly reflective face",
        continuity: "the front face is the only printed face; official label and botanical artwork do not wrap onto the rear or side edges"
      },
      rearSurfaceAppearance: {
        appliesTo: "rear and otherwise unprinted sachet surfaces",
        verification: "verified PROYA catalog knowledge",
        content: "blank",
        printedArtwork: "none",
        text: "none",
        graphics: "none",
        logos: "none",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "none",
        finish: "continue the same orange softly reflective packet surface without duplicating the front botanical artwork",
        continuity: "clean blank uninterrupted continuation of the same opaque orange sachet color and softly reflective finish"
      },
      sideSurfaceAppearance: {
        appliesTo: "left and right side edges and notched side surfaces of the flat sachet",
        verification: "verified PROYA catalog knowledge",
        content: "blank",
        printedArtwork: "none",
        text: "none",
        graphics: "none",
        logos: "none",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "none",
        finish: "continue the same orange softly reflective packet surface without duplicating the front botanical artwork",
        continuity: "clean blank uninterrupted continuation of the same opaque orange sachet color and softly reflective finish"
      },
      opacityBehavior: "opaque sealed sachet; package walls do not reveal contents; reflections remain surface highlights only",
      contentsVisibility: "contents are not visible through the opaque sachet film",
      colorAppearance: "dominant warm orange with vivid green botanical line art and black-and-white label graphics",
      labelAppearance: "centered black rectangular label frame; black PROYA wordmark; white COOLING & SOOTHING title; green botanical illustration across the lower portion; 25ml marking near the bottom",
      referenceAuthority: "The supplied Face Mask reference image is highest authority for every visible packaging property; metadata only supplements it.",
      referencePresentationState: ["sachet is presented flat and front-facing"],
      unprintedSurfaceAppearance: {
        appliesTo: "rear and otherwise unprinted sachet surfaces",
        verification: "verified PROYA catalog knowledge",
        content: "blank",
        text: "none",
        graphics: "none",
        logos: "none",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "none",
        finish: "continue the same orange softly reflective packet surface without duplicating the front botanical artwork"
      },
      dimensions: {
        measurementAuthority: "manually measured from the actual PROYA Face Mask sachet",
        overallHeightCm: 17,
        widthCm: 11,
        componentMeasurements: [],
        notes: ["Overall height and width are authoritative", "The sachet remains flat; no package depth is verified"]
      },
      forbiddenInterpretations: ["rigid container", "bottle", "glass packaging", "dropper", "pump or spray mechanism", "jar", "tube", "standing container depth"]
    },
    ingredients: ["Centella Asiatica extract", "Portulaca extract", "Scutellaria extract", "Other plant extracts \u2014 not individually specified", "Hyaluronic Acid matrix"],
    benefitTerritories: ["Intensive hydration", "Cooling and soothing care", "Refreshing feel", "Helps replenish moisture", "For tired or dry-looking skin"],
    safeCopy: ["Cooling hydration reset untuk kulit terasa segar.", "Bantu menenangkan dan menjaga kelembapan.", "Cool, soothe, refresh."],
    topics: ["Cooling hydration reset", "Post-busy-day refresh", "Botanical soothing story", "15-minute ritual", "Dry-looking skin hydration"],
    visualMotifs: ["Water droplets", "Cooling mist", "Green botanical shadow", "Centella-inspired leaves", "Chilled glass", "Condensation"],
    textureCues: ["cooling mist", "dewy sheet", "water condensation"],
    usagePosition: "Optional care after cleansing, 2\u20133 times weekly; follow the pack/manual directions",
    packagingRestrictions: ["Must remain a flat sachet", "Preserve the green botanical illustration", "Orange remains dominant", "Do not convert into a bottle or jar"],
    isHero: false
  },
  {
    id: "full-series",
    officialName: "PROYA 5X Vitamin C Full Series",
    shortName: "Full Series",
    size: "6 products",
    role: "Complete brightening and hydration routine",
    imagePath: "product-assets/serum.png",
    referenceImagePaths: ["product-assets/cleanser.png", "product-assets/toner.png", "product-assets/eye-cream.png", "product-assets/serum.png", "product-assets/skin-cream.png", "product-assets/mask.png"],
    packagingDescription: "Complete six-product lineup. Every individual package must remain faithful to its own master PNG, with the Serum normally receiving the strongest visual emphasis.",
    physicalIdentity: {
      packageType: "composite six-product lineup",
      packageComponents: ["Cleanser package", "Toner package", "Eye Cream package", "Serum package", "Skin Cream jar body and detachable lid", "Face Mask sachet"],
      size: "6 products",
      shape: "six distinct product-specific silhouettes shown in their individual master references",
      proportions: "preserve each product's independent proportions and relative visual differences; do not homogenize the lineup",
      closureType: "product-specific; reproduce each closure only from that product's own master reference",
      physicalMaterial: "product-specific / do not infer or generalize; match each visible reference",
      surfaceAppearance: "product-specific; preserve each reference independently",
      transparency: "product-specific; never copy one product's opacity or transparency behavior to another",
      visibleGlassTransparency: false,
      frontSurfaceAppearance: {
        appliesTo: "front printed face of each corresponding product in the six-product lineup",
        verification: "verified from each supplied product master reference",
        content: "product-specific official printed artwork",
        printedArtwork: "only the official front artwork belonging to that corresponding product; never substitute another product's label",
        text: "official front packaging text for each corresponding product only",
        graphics: "official front graphics for each corresponding product only",
        logos: "official PROYA wordmark as shown on each corresponding product",
        barcode: "none unless visibly shown in a corresponding supplied reference",
        regulatoryCopy: "none unless visibly shown in a corresponding supplied reference",
        instructions: "none unless visibly shown in a corresponding supplied reference",
        labels: "the official front label belonging to each corresponding product only",
        finish: "each product's own verified visible color, material appearance, opacity, and finish",
        continuity: "each product's front face is the only printed face; no product's artwork wraps onto another product or onto its own rear or side surfaces"
      },
      rearSurfaceAppearance: {
        appliesTo: "rear, side, and otherwise unprinted surfaces of each corresponding product",
        verification: "verified PROYA catalog knowledge for all six products",
        content: "blank",
        printedArtwork: "none",
        text: "none",
        graphics: "none",
        logos: "none",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "none",
        finish: "continue each product's own verified color, material appearance, opacity, and surface finish without transferring traits between products",
        continuity: "clean blank uninterrupted continuation of each corresponding product's own package color and finish; never transfer traits between products"
      },
      sideSurfaceAppearance: {
        appliesTo: "side surfaces and edges of each corresponding product in the lineup",
        verification: "verified PROYA catalog knowledge for all six products",
        content: "blank",
        printedArtwork: "none",
        text: "none",
        graphics: "none",
        logos: "none",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "none",
        finish: "continue each product's own verified color, material appearance, opacity, and surface finish without transferring traits between products",
        continuity: "clean blank uninterrupted continuation of each corresponding product's own package color and finish; never transfer traits between products"
      },
      opacityBehavior: "product-specific; preserve each corresponding package's verified opacity and any separately verified clear component; never transfer transparency or content visibility between products",
      contentsVisibility: "product-specific; do not reveal contents through package walls unless the corresponding product metadata and reference explicitly show an opening or exposed contents",
      colorAppearance: "preserve the distinct orange, white, clear-cap, black-label, and green botanical details visible on each corresponding master reference",
      labelAppearance: "preserve every product's own label geometry, wording hierarchy, logo position, and size marking from its corresponding master reference",
      referenceAuthority: "All six supplied master references are independently authoritative; each reference governs only its corresponding product.",
      referencePresentationState: ["preserve each product's reference-specific component arrangement without treating staging as permanent geometry"],
      unprintedSurfaceAppearance: {
        appliesTo: "rear, side, and otherwise unprinted surfaces of each corresponding product",
        verification: "verified PROYA catalog knowledge for all six products",
        content: "blank",
        text: "none",
        graphics: "none",
        logos: "none",
        barcode: "none",
        regulatoryCopy: "none",
        instructions: "none",
        labels: "none",
        finish: "continue each product's own verified color, material appearance, opacity, and surface finish without transferring traits between products"
      },
      dimensions: {
        measurementAuthority: "No aggregate Full Series package measurement; use each component product's independently verified dimensions",
        componentMeasurements: [],
        notes: ["Never infer one product's dimensions from another", "Maintain relative scale from the six individual physicalIdentity.dimensions records", "Do not resize products to make a composition symmetrical"]
      },
      forbiddenInterpretations: ["homogenized package silhouettes", "shared closure design", "shared transparency or glassiness", "all bottles", "all rigid containers", "cross-product packaging trait transfer"]
    },
    ingredients: ["5X Vitamin C Derivatives across the series", "Product-specific supporting ingredients only as verified per product"],
    benefitTerritories: ["Multi-step daily care", "Brightening support", "Hydration", "Fresh glowing appearance", "Complete routine education"],
    safeCopy: ["Satu rangkaian, satu cerita brightening.", "Rutinitas 5X Vitamin C dari cleanse sampai moisture lock.", "Bright. Hydrated. Glowing."],
    topics: ["Complete routine", "Routine order", "Meet the full series", "One concern, multiple steps", "Serum as the hero"],
    visualMotifs: ["Cream and glass pedestals", "Warm citrus glow", "Water reflections", "Varying product heights", "Serum centered"],
    textureCues: ["foam, mist, serum droplet, silky eye cream, rich cream, dewy sheet"],
    usagePosition: "Cleanser \u2192 Mask when used \u2192 Toner \u2192 Eye Cream \u2192 Serum \u2192 Skin Cream",
    packagingRestrictions: ["Use all six master references", "Do not homogenize silhouettes", "Serum should usually be emphasized", "Do not stack products impossibly"],
    isHero: false
  }
];

// data/brand.json
var brand_default = {
  brand: "PROYA",
  series: "PROYA 5X Vitamin C Series",
  coreIdea: "Not just Vitamin C \u2014 the evolution of Vitamin C.",
  personality: ["Bright", "Fresh", "Scientific", "Clean", "Gentle", "Premium", "Trustworthy", "Modern", "Benefit-led", "Approachable"],
  palette: { orange: "#F6A300", citrusGlow: "#FFC54D", cream: "#FFF5E8", white: "#FFFFFF", black: "#111111", beige: "#F3E2C7", botanicalGreen: "#8DAA2A" },
  visualDirection: ["bright", "clean", "warm", "glossy", "hydrated", "premium", "scientific"],
  defaultPromptKeywords: ["premium skincare", "clean beauty advertising", "warm citrus glow", "soft studio lighting", "high clarity", "fresh hydration", "glossy reflections", "white and orange palette", "modern scientific beauty", "minimal commercial composition", "crisp e-commerce product photography"],
  productReferenceInstruction: "Use the attached product image as the exact packaging reference. Preserve the product's shape, proportions, cap, label layout, logo position, color, and packaging material. Do not redesign the packaging. Only change the environment, camera angle, lighting, props, and composition.",
  source: "references/PROYA_5X_Vitamin_C_AI_Branding_Guide.md"
};

// data/claim-rules.json
var claim_rules_default = {
  approved: [
    "brightening",
    "membantu mencerahkan tampilan kulit",
    "helps brighten the appearance of skin",
    "membantu menyamarkan tampilan noda hitam",
    "helps fade the look of dark spots",
    "membantu meratakan tampilan warna kulit",
    "hydrating",
    "membantu menjaga kelembapan",
    "gentle daily care",
    "supports the skin barrier",
    "helps skin look smoother",
    "fresh glowing appearance"
  ],
  avoidUnlessApproved: [
    "memutihkan permanen",
    "pasti putih",
    "putih dalam X hari",
    "menghilangkan flek permanen",
    "menghilangkan jerawat",
    "menyembuhkan",
    "mengobati",
    "anti-aging pasti",
    "hasil instan permanen",
    "works for everyone",
    "no side effects",
    "fake clinical percentages",
    "fake dermatology testing",
    "fake awards",
    "fake certifications",
    "unrealistic before/after claims"
  ],
  rule: "Prefer conservative cosmetic language. Never invent efficacy numbers, certifications, awards, testing, or guaranteed/permanent results.",
  source: "references/PROYA_5X_Vitamin_C_AI_Branding_Guide.md#16"
};

// src/domain/schemas.ts
var import_zod = require("zod");
var productUnprintedSurfaceAppearanceSchema = import_zod.z.object({
  appliesTo: import_zod.z.string().min(1),
  verification: import_zod.z.string().min(1),
  content: import_zod.z.literal("blank"),
  text: import_zod.z.literal("none"),
  graphics: import_zod.z.literal("none"),
  logos: import_zod.z.literal("none"),
  barcode: import_zod.z.literal("none"),
  regulatoryCopy: import_zod.z.literal("none"),
  instructions: import_zod.z.literal("none"),
  labels: import_zod.z.literal("none"),
  finish: import_zod.z.string().min(1)
});
var productSurfaceAppearanceSchema = import_zod.z.object({
  appliesTo: import_zod.z.string().min(1),
  verification: import_zod.z.string().min(1),
  content: import_zod.z.string().min(1),
  printedArtwork: import_zod.z.string().min(1),
  text: import_zod.z.string().min(1),
  graphics: import_zod.z.string().min(1),
  logos: import_zod.z.string().min(1),
  barcode: import_zod.z.string().min(1),
  regulatoryCopy: import_zod.z.string().min(1),
  instructions: import_zod.z.string().min(1),
  labels: import_zod.z.string().min(1),
  finish: import_zod.z.string().min(1),
  continuity: import_zod.z.string().min(1)
});
var productBlankSurfaceAppearanceSchema = productSurfaceAppearanceSchema.extend({
  content: import_zod.z.literal("blank"),
  printedArtwork: import_zod.z.literal("none"),
  text: import_zod.z.literal("none"),
  graphics: import_zod.z.literal("none"),
  logos: import_zod.z.literal("none"),
  barcode: import_zod.z.literal("none"),
  regulatoryCopy: import_zod.z.literal("none"),
  instructions: import_zod.z.literal("none"),
  labels: import_zod.z.literal("none")
});
var productComponentMeasurementSchema = import_zod.z.object({
  component: import_zod.z.string().min(1),
  heightCm: import_zod.z.number().positive().optional(),
  widthCm: import_zod.z.number().positive().optional(),
  notes: import_zod.z.string().min(1).optional()
});
var productDimensionsSchema = import_zod.z.object({
  measurementAuthority: import_zod.z.string().min(1),
  overallHeightCm: import_zod.z.number().positive().optional(),
  widthCm: import_zod.z.number().positive().optional(),
  widthBottomCm: import_zod.z.number().positive().optional(),
  widthTopCm: import_zod.z.number().positive().optional(),
  diameterCm: import_zod.z.number().positive().optional(),
  componentMeasurements: import_zod.z.array(productComponentMeasurementSchema),
  notes: import_zod.z.array(import_zod.z.string().min(1))
});
var productContentsAppearanceSchema = import_zod.z.object({
  appliesTo: import_zod.z.string().min(1),
  verification: import_zod.z.string().min(1),
  color: import_zod.z.string().min(1),
  transparency: import_zod.z.string().min(1),
  visualConsistency: import_zod.z.string().min(1),
  visibleThroughPackageWalls: import_zod.z.boolean(),
  packageVisibility: import_zod.z.string().min(1),
  forbiddenColorInterpretations: import_zod.z.array(import_zod.z.string().min(1)).min(1),
  stylingSeparation: import_zod.z.string().min(1)
});
var productPhysicalIdentitySchema = import_zod.z.object({
  packageType: import_zod.z.string().min(1),
  packageComponents: import_zod.z.array(import_zod.z.string().min(1)).min(1),
  size: import_zod.z.string().min(1),
  shape: import_zod.z.string().min(1),
  proportions: import_zod.z.string().min(1),
  closureType: import_zod.z.string().min(1),
  physicalMaterial: import_zod.z.string().min(1),
  surfaceAppearance: import_zod.z.string().min(1),
  transparency: import_zod.z.string().min(1),
  visibleGlassTransparency: import_zod.z.boolean(),
  frontSurfaceAppearance: productSurfaceAppearanceSchema,
  rearSurfaceAppearance: productBlankSurfaceAppearanceSchema,
  sideSurfaceAppearance: productBlankSurfaceAppearanceSchema,
  opacityBehavior: import_zod.z.string().min(1),
  contentsVisibility: import_zod.z.string().min(1),
  colorAppearance: import_zod.z.string().min(1),
  labelAppearance: import_zod.z.string().min(1),
  referenceAuthority: import_zod.z.string().min(1),
  referencePresentationState: import_zod.z.array(import_zod.z.string().min(1)).min(1),
  unprintedSurfaceAppearance: productUnprintedSurfaceAppearanceSchema,
  dimensions: productDimensionsSchema,
  contentsAppearance: productContentsAppearanceSchema.optional(),
  forbiddenInterpretations: import_zod.z.array(import_zod.z.string().min(1)).min(1)
});
var productSchema = import_zod.z.object({
  id: import_zod.z.enum(productIds),
  officialName: import_zod.z.string().min(1),
  shortName: import_zod.z.string().min(1),
  size: import_zod.z.string().min(1),
  role: import_zod.z.string().min(1),
  imagePath: import_zod.z.string().min(1),
  referenceImagePaths: import_zod.z.array(import_zod.z.string()).optional(),
  packagingDescription: import_zod.z.string().min(1),
  physicalIdentity: productPhysicalIdentitySchema,
  ingredients: import_zod.z.array(import_zod.z.string()).min(1),
  benefitTerritories: import_zod.z.array(import_zod.z.string()).min(1),
  safeCopy: import_zod.z.array(import_zod.z.string()).min(1),
  topics: import_zod.z.array(import_zod.z.string()).min(1),
  visualMotifs: import_zod.z.array(import_zod.z.string()).min(1),
  textureCues: import_zod.z.array(import_zod.z.string()).min(1),
  usagePosition: import_zod.z.string().min(1),
  packagingRestrictions: import_zod.z.array(import_zod.z.string()).min(1),
  isHero: import_zod.z.boolean()
});
var productsSchema = import_zod.z.array(productSchema).superRefine((products2, ctx) => {
  const ids = new Set(products2.map((product) => product.id));
  for (const id of productIds) if (!ids.has(id)) ctx.addIssue({ code: "custom", message: `Missing product ${id}` });
});
var brandSchema = import_zod.z.object({
  brand: import_zod.z.string(),
  series: import_zod.z.string(),
  coreIdea: import_zod.z.string(),
  personality: import_zod.z.array(import_zod.z.string()),
  palette: import_zod.z.record(import_zod.z.string(), import_zod.z.string()),
  visualDirection: import_zod.z.array(import_zod.z.string()),
  defaultPromptKeywords: import_zod.z.array(import_zod.z.string()),
  productReferenceInstruction: import_zod.z.string(),
  source: import_zod.z.string()
});
var claimRulesSchema = import_zod.z.object({ approved: import_zod.z.array(import_zod.z.string()).min(1), avoidUnlessApproved: import_zod.z.array(import_zod.z.string()).min(1), rule: import_zod.z.string(), source: import_zod.z.string() });
var h3WorkflowSettingsSchema = import_zod.z.object({
  durationSeconds: import_zod.z.number().finite().min(4).max(15),
  aspectRatio: import_zod.z.enum(h3WorkflowAspectRatioValues),
  megapixels: import_zod.z.number().finite().min(0.1).max(16),
  multiple: import_zod.z.number().int().min(8).max(128).refine((value) => value % 4 === 0, "H3 multiple must be divisible by 4"),
  fps: import_zod.z.literal(24),
  steps: import_zod.z.number().int().min(1),
  scheduler: import_zod.z.enum(h3SchedulerOptions),
  seedMode: import_zod.z.enum(h3SeedModeOptions),
  seed: import_zod.z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  refImageSize: import_zod.z.enum(h3ReferenceImageSizeOptions)
});
var h3PromptEngineSettingsSchema = import_zod.z.object({
  provider: import_zod.z.literal("lmstudio-remote"),
  endpoint: import_zod.z.string().url().refine((url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") && parsed.port === "1234" && /^\/v1\/?$/.test(parsed.pathname) && !parsed.search && !parsed.hash;
    } catch {
      return false;
    }
  }, "LM Studio endpoint must be http://127.0.0.1:1234/v1 on the execution PC loopback interface"),
  model: import_zod.z.literal(h3PromptEngineModelId),
  temperature: import_zod.z.number().finite().min(0).max(2),
  repairAttempts: import_zod.z.number().int().min(0).max(5),
  disableThinking: import_zod.z.boolean(),
  unloadModelBeforeH3: import_zod.z.boolean(),
  timeoutSeconds: import_zod.z.number().int().min(10).max(900)
});
var appSettingsSchema = import_zod.z.object({
  chatGptUrl: import_zod.z.string().url().refine((url) => url.startsWith("https://"), "ChatGPT URL must use HTTPS"),
  computeMode: import_zod.z.enum(computeModes),
  remoteComfyUrl: import_zod.z.literal("http://127.0.0.1:8188"),
  remoteComfyWorkflowPath: import_zod.z.string(),
  remoteOutputDirectory: import_zod.z.string().min(1),
  remoteAutoDownload: import_zod.z.boolean(),
  defaultLanguage: import_zod.z.enum(["Indonesian", "English"]),
  defaultFormat: import_zod.z.enum(["Instagram Feed 4:5", "Square 1:1", "Story / TikTok 9:16"]),
  defaultCreativity: import_zod.z.enum(["Safe", "Balanced", "Experimental"]),
  defaultWorkflowMode: import_zod.z.enum(workflowModes),
  defaultPostStructure: import_zod.z.enum(postStructures),
  defaultCaptionMode: import_zod.z.enum(captionModes),
  recentHistoryWindow: import_zod.z.number().int().min(1).max(100),
  productAssetsDirectory: import_zod.z.string().min(1),
  referencesDirectory: import_zod.z.string().min(1),
  splitRatio: import_zod.z.number().min(0.28).max(0.72),
  h3WorkflowSettings: h3WorkflowSettingsSchema,
  h3SystemPromptPath: import_zod.z.string().min(1),
  h3PromptEngine: h3PromptEngineSettingsSchema
});

// src/domain/data.ts
var products = productsSchema.parse(products_default);
var brand = brandSchema.parse(brand_default);
var claimRules = claimRulesSchema.parse(claim_rules_default);
var getProduct = (id) => products.find((product) => product.id === id);

// src/domain/creative-diversity.ts
var CREATIVE_DIVERSITY_SCHEMA_VERSION = 1;
var DEFAULT_CREATIVE_SEED = 1592639710;
var creativeGenomeAxisWeights = {
  visualHook: 2.2,
  creativeArchetype: 2.2,
  environment: 1.35,
  composition: 1.15,
  cameraPath: 1.35,
  framing: 0.9,
  lightingStyle: 1.1,
  primaryMotion: 1.35,
  secondaryMotion: 0.8,
  materialEffect: 1.1,
  pacing: 0.65,
  openingDevice: 0.8,
  transitionLanguage: 0.75,
  endingDevice: 0.65,
  audioCharacter: 0.45
};
var majorCreativeDimensions = [
  "visualHook",
  "creativeArchetype",
  "environment",
  "composition",
  "cameraPath",
  "framing",
  "lightingStyle",
  "primaryMotion",
  "materialEffect",
  "pacing",
  "openingDevice",
  "transitionLanguage",
  "endingDevice"
];
function createFixedProductTruth(product) {
  return {
    product: product.id,
    officialName: product.officialName,
    shortName: product.shortName,
    size: product.size,
    role: product.role,
    referencePath: product.imagePath,
    referenceImagePaths: [.../* @__PURE__ */ new Set([product.imagePath, ...product.referenceImagePaths ?? []])],
    packagingDescription: product.packagingDescription,
    physicalIdentity: product.physicalIdentity,
    verifiedIngredients: [...product.ingredients],
    verifiedClaims: [...product.benefitTerritories],
    safeCopy: [...product.safeCopy],
    packagingRestrictions: [...product.packagingRestrictions],
    safetyConstraints: [...product.packagingRestrictions, ...product.physicalIdentity.forbiddenInterpretations]
  };
}
var defaultCreativeDiversityOptions = {
  sameProductFamilyWindow: 24,
  sameProductWindow: 48,
  globalWindow: 96,
  minimumMeaningfulDifferences: 4,
  nearDuplicateSimilarity: 0.82,
  maxRerolls: 12,
  generationDecay: 0.86,
  dayDecay: 0.97,
  noveltyThreshold: 35
};
var CreativeConstraintError = class extends Error {
  code = "CREATIVE_CONSTRAINT_CONTRADICTION";
  conflicts;
  constructor(conflicts) {
    const details = conflicts.map((conflict) => `${conflict.axis}: ${conflict.values.join(" vs ")}`).join("; ");
    super(`Contradictory hard creative constraints: ${details}. Resolve the conflicting instruction and try again.`);
    this.name = "CreativeConstraintError";
    this.conflicts = conflicts;
  }
};
var normalizedGenomeCache = /* @__PURE__ */ new WeakMap();
function normalizedGenomeValues(genome) {
  const cached = normalizedGenomeCache.get(genome);
  if (cached) return cached;
  const values = {};
  for (const axis of Object.keys(creativeGenomeAxisWeights)) values[axis] = normalizeText(genome[axis]);
  normalizedGenomeCache.set(genome, values);
  return values;
}
function normalizedAxisValue(genome, axis) {
  return normalizedGenomeValues(genome)[axis];
}
function defineDirection(id, values, variants = []) {
  return { id, ...values, variants };
}
var productBRollDirections = [
  defineDirection("minimal-luxury", {
    creativeArchetype: "Minimal Luxury",
    visualHook: "a single amber reflection crosses a quiet hero in negative space",
    environment: "ivory gallery cyclorama with one matte stone plinth",
    composition: "asymmetric hero with generous negative space",
    cameraPath: "slow lateral slider with a restrained parallax drift",
    framing: "medium hero, product held off-center",
    lightingStyle: "soft daylight gradient with one warm edge",
    primaryMotion: "a narrow amber reflection travels across the scene",
    secondaryMotion: "the background shadow lengthens almost imperceptibly",
    materialEffect: "matte stone, silk paper, and a clean specular edge",
    pacing: "measured slow build",
    openingDevice: "begin on empty negative space before the reflection enters",
    transitionLanguage: "the reflection reveals the product as it passes",
    endingDevice: "quiet logo-facing hero hold",
    audioCharacter: "restrained glassy pulse with a soft room tone"
  }, [
    { visualHook: "a clean sun blade isolates the package from an ivory field", environment: "cream gallery plinth under a high window", composition: "low horizon with broad breathing room", cameraPath: "locked-off frame while light performs the move", framing: "wide three-quarter hero", lightingStyle: "hard morning beam softened at the edges", primaryMotion: "the sun blade sweeps from floor to shoulder", transitionLanguage: "the light cut becomes the reveal", endingDevice: "graphic still-life hold" },
    { visualHook: "a black-to-cream gradient opens like a luxury curtain around the hero", environment: "black velvet void fading into a cream sweep", composition: "center-weighted silhouette with deliberate empty margins", cameraPath: "slow vertical crane into the final frame", framing: "full product with breathing room", lightingStyle: "controlled two-tone gradient and fine rim light", primaryMotion: "the gradient rolls behind the product without moving it", materialEffect: "velvet shadow against a polished mineral surface", transitionLanguage: "the tonal field opens to the unchanged package", endingDevice: "precise front-facing lock" }
  ]),
  defineDirection("macro-texture", {
    creativeArchetype: "Macro Texture",
    visualHook: "macro droplets resolve through focus before the package comes clear",
    environment: "wet glass macro stage with a dark citrus-toned backdrop",
    composition: "extreme crop that moves from surface detail to product context",
    cameraPath: "precise focus pull with a micro-dolly",
    framing: "extreme close-up opening, tight product detail finish",
    lightingStyle: "raking specular light with crisp droplet highlights",
    primaryMotion: "condensation beads gather, separate, and slide across the foreground",
    secondaryMotion: "a thin highlight migrates along the package edge",
    materialEffect: "transparent water beads on glass, never a package material change",
    pacing: "slow tactile suspense",
    openingDevice: "open inside an abstract droplet before revealing scale",
    transitionLanguage: "focus resolves the texture into the product silhouette",
    endingDevice: "tight readable label hold",
    audioCharacter: "intimate droplets and a low crystalline tone"
  }, [
    { visualHook: "a soft-focus water bead becomes a sharp constellation of highlights", environment: "clear acrylic plane over pale citrus paper", composition: "diagonal texture field leading into the product", cameraPath: "rack focus from foreground bead to three-quarter package", framing: "macro-to-close transition", lightingStyle: "cool white pin lights with a warm back rim", primaryMotion: "beads roll down the acrylic in different speeds", materialEffect: "clear acrylic, water, and a subtle paper grain", transitionLanguage: "the last bead aligns with the package contour", endingDevice: "clean three-quarter detail hold" },
    { visualHook: "a veil of fine mist sharpens into the cap and shoulder through focus", environment: "black glass macro table with a humid air pocket", composition: "vertical crop built around a single contour", cameraPath: "slow focus pull with almost no spatial travel", framing: "close crop on shoulder and closure area", lightingStyle: "single hard rim cutting through cool haze", primaryMotion: "mist disperses as the contour resolves", materialEffect: "haze and glass foreground, product remains unchanged", transitionLanguage: "haze clears from abstract line to recognizable package", endingDevice: "detail hold with a final glint" }
  ]),
  defineDirection("fluid-choreography", {
    creativeArchetype: "Fluid Choreography",
    visualHook: "a foam crescent sculpts itself around the product without touching the label",
    environment: "shallow ivory water basin with a citrus-lit horizon",
    composition: "product anchored at the edge of a circular fluid path",
    cameraPath: "slow overhead arc that descends into a three-quarter view",
    framing: "wide basin geometry resolving to a medium hero",
    lightingStyle: "warm overhead glow with cool reflected fill",
    primaryMotion: "a controlled foam crescent travels in a loop around the base",
    secondaryMotion: "small ripples radiate outward and fade",
    materialEffect: "airy foam, clean water, and soft reflective ceramic",
    pacing: "balanced sculptural rhythm",
    openingDevice: "open on a circular ripple with the product just outside frame",
    transitionLanguage: "the foam arc completes the visual frame around the hero",
    endingDevice: "fluid settles into a thin halo around a stable product",
    audioCharacter: "tactile water ticks over a polished rhythmic bed"
  }, [
    { visualHook: "a vertical water column rises and parts to reveal the hero", environment: "deep cream basin with a dark orange back wall", composition: "centered vertical axis with layered depth", cameraPath: "controlled push through the falling water", framing: "medium-wide reveal into a centered hero", lightingStyle: "backlit translucent water with a citrus rim", primaryMotion: "one water column rises, splits, and falls behind the package", materialEffect: "transparent water column and ceramic basin", transitionLanguage: "the falling curtain opens the final read", endingDevice: "water settles behind the product", audioCharacter: "clean splash accents with a bright tonal swell" },
    { visualHook: "a ribbon of clear liquid traces an orbit and leaves the package untouched", environment: "black reflective liquid stage with a warm horizon line", composition: "off-center hero framed by one continuous orbit", cameraPath: "lateral tracking synchronized to the orbit", framing: "three-quarter medium shot with negative space", lightingStyle: "thin warm rim against a cool black field", primaryMotion: "a clear ribbon loops around the base and exits frame", secondaryMotion: "micro ripples follow the ribbon path", materialEffect: "reflective liquid surface and transparent fluid ribbon", transitionLanguage: "the orbit completes then falls away to the label", endingDevice: "minimal reflective hero hold", audioCharacter: "smooth liquid sweep with sparse low percussion" }
  ]),
  defineDirection("architectural-geometric", {
    creativeArchetype: "Architectural Geometry",
    visualHook: "moving geometric shadow architecture builds a frame around the package",
    environment: "sunlit acrylic blocks on a warm concrete set",
    composition: "wide geometric planes creating a strong diagonal corridor",
    cameraPath: "controlled lateral tracking parallel to the block faces",
    framing: "wide establishing geometry into a medium product lock",
    lightingStyle: "hard graphic shadows with precise orange bounce",
    primaryMotion: "acrylic blocks slide in measured increments behind the product",
    secondaryMotion: "shadow rectangles fold across the floor and recede",
    materialEffect: "frosted acrylic, concrete, and crisp projected shadow",
    pacing: "architectural measured rhythm",
    openingDevice: "start on an empty grid of light and hard edges",
    transitionLanguage: "each block movement adds one layer to the product frame",
    endingDevice: "final geometric alignment creates a clean hero window",
    audioCharacter: "dry modular clicks with a precise electronic bed"
  }, [
    { visualHook: "stacked translucent planes unlock one by one to expose the hero", environment: "pale orange architectural light box", composition: "centered vanishing point with nested frames", cameraPath: "straight controlled dolly through the nested planes", framing: "wide corridor to medium centered product", lightingStyle: "cool white plane light with orange seams", primaryMotion: "three planes retract in sequence behind the package", materialEffect: "translucent acrylic, brushed aluminum, and clean haze", transitionLanguage: "the last retracting plane reveals the full silhouette", endingDevice: "symmetrical architectural hold" },
    { visualHook: "a tiled shadow grid travels sideways and briefly turns the hero into a graphic cutout", environment: "black-and-cream grid room with an orange floor plane", composition: "side profile space with product at a rule-of-thirds anchor", cameraPath: "slow side-on tracking with no orbit", framing: "wide graphic side composition", lightingStyle: "hard venetian shadow grid with a warm edge", primaryMotion: "the grid of light slides across the set", materialEffect: "matte tile, black glass, and sharp shadow geometry", transitionLanguage: "the moving grid dissolves into a readable product frame", endingDevice: "shadow-free final hero hold" }
  ]),
  defineDirection("graphic-light-shadow", {
    creativeArchetype: "Graphic Light and Shadow",
    visualHook: "orange light bars cut across darkness and reveal the package in flashes",
    environment: "black studio with a suspended orange light grid",
    composition: "high-contrast silhouette with the product on a diagonal",
    cameraPath: "slow diagonal slide with a single deliberate reframing",
    framing: "tight medium hero with graphic negative space",
    lightingStyle: "hard cut light, deep shadow, and saturated amber rim",
    primaryMotion: "light bars travel across the set like a scanning sequence",
    secondaryMotion: "a narrow reflection glides along the closure",
    materialEffect: "black lacquer surface and crisp volumetric light",
    pacing: "confident editorial beats",
    openingDevice: "begin in near-black with one line of light",
    transitionLanguage: "each light bar reveals another product plane",
    endingDevice: "all bars align into a clean warm rim around the hero",
    audioCharacter: "minimal pulse, soft electrical hum, and one final chime"
  }, [
    { visualHook: "a rotating prism throws a moving orange window across the hero", environment: "dark mirrored studio with a suspended prism", composition: "product centered behind a shifting prism window", cameraPath: "small three-quarter orbit around the light source, not the package", framing: "medium centered hero", lightingStyle: "prismatic amber caustics against a deep blue-black field", primaryMotion: "the prism rotates and sweeps the color window across the set", materialEffect: "mirror, crystal, and controlled light caustics", transitionLanguage: "the last color window opens the label area", endingDevice: "warm prism edge with stable packaging", audioCharacter: "airy synth shimmer with restrained bass" },
    { visualHook: "a thin slit of daylight widens from shadow to a precise product portrait", environment: "charcoal room with a single sliding aperture", composition: "vertical split with product crossing the light boundary", cameraPath: "slow push toward the light boundary", framing: "full-height portrait crop", lightingStyle: "single hard daylight slit with soft ambient black", primaryMotion: "the aperture widens by degrees across the package", materialEffect: "charcoal matte wall and a satin floor reflection", transitionLanguage: "the light boundary settles exactly on the front face", endingDevice: "quiet light-box portrait hold" }
  ]),
  defineDirection("atmospheric-mist", {
    creativeArchetype: "Atmospheric Mist",
    visualHook: "a vertical mist veil parts in layers while the hero stays physically still",
    environment: "cool white fog chamber with a distant citrus glow",
    composition: "deep central corridor with product emerging from atmosphere",
    cameraPath: "slow forward drift through the mist layers",
    framing: "wide atmospheric opening into a medium hero",
    lightingStyle: "diffused backlight with a warm halo and soft bloom",
    primaryMotion: "mist curtains drift apart from the center outward",
    secondaryMotion: "fine haze catches a moving shaft of light",
    materialEffect: "volumetric haze, frosted glass, and matte floor",
    pacing: "slow breath-like reveal",
    openingDevice: "open in an abstract white field with no visible horizon",
    transitionLanguage: "each mist layer reveals more context without changing the product",
    endingDevice: "haze clears into a stable softly lit hero",
    audioCharacter: "airy breath, soft sub tone, and distant shimmer"
  }, [
    { visualHook: "a cool cloud rolls low across the floor and leaves a warm product island", environment: "low fog over a pale stone platform", composition: "low-angle island composition with open upper frame", cameraPath: "low lateral glide parallel to the platform", framing: "low medium hero with atmospheric foreground", lightingStyle: "cool floor haze under a warm overhead pool", primaryMotion: "the fog rolls around the platform and thins", materialEffect: "low cloud, pale stone, and a warm reflective patch", transitionLanguage: "the thinning fog sharpens the final silhouette", endingDevice: "island-like hero hold" },
    { visualHook: "fine vapor spirals upward and opens a clean column around the package", environment: "minimal white vapor room with a dark ceiling", composition: "vertical column framing the product from below", cameraPath: "gentle upward crane following the vapor", framing: "full product with vertical breathing room", lightingStyle: "cool diffuse top light with a narrow amber rim", primaryMotion: "vapor spirals upward then disperses above the cap", materialEffect: "fine vapor and clean matte surroundings", transitionLanguage: "the vapor column becomes a soft halo", endingDevice: "vertical centered hold" }
  ]),
  defineDirection("fresh-wet-surface", {
    creativeArchetype: "Fresh Wet Surface",
    visualHook: "condensation races across a wet stone surface and stops before the readable hero",
    environment: "freshly wet travertine slab with a pale citrus backdrop",
    composition: "low tabletop composition with the product beyond a reflective foreground",
    cameraPath: "slow tabletop push with shallow foreground parallax",
    framing: "low medium hero with wet foreground detail",
    lightingStyle: "bright post-rain daylight with a clean warm rim",
    primaryMotion: "a sheet of water travels across the stone and breaks into beads",
    secondaryMotion: "droplets tremble at the edge of the slab",
    materialEffect: "wet stone, transparent water, and clean reflected sky",
    pacing: "fresh balanced lift",
    openingDevice: "start on a reflective wet texture before finding the product",
    transitionLanguage: "the water line draws the eye from texture to product",
    endingDevice: "fresh dry read with a few controlled droplets remaining",
    audioCharacter: "bright water detail with a clean percussive tick"
  }, [
    { visualHook: "a rain line breaks into tiny beads that frame the product from below", environment: "dark slate ledge after rain with a light cream horizon", composition: "product high in frame above a bead-filled foreground", cameraPath: "slow rise from the ledge to the hero", framing: "low-angle close hero", lightingStyle: "soft overcast light with one golden break", primaryMotion: "the rain line runs across slate and fragments into beads", materialEffect: "slate, water beads, and a restrained reflective highlight", transitionLanguage: "the bead line becomes an underline for the package", endingDevice: "clean elevated hero hold" },
    { visualHook: "a mirror-thin water sheet recedes to reveal an untouched product island", environment: "white ceramic plane with a shallow water film", composition: "centered island surrounded by a receding reflective field", cameraPath: "overhead descent into a shallow three-quarter angle", framing: "wide overhead to medium hero", lightingStyle: "high-key white with a citrus reflection", primaryMotion: "the water film retracts in a smooth ring", materialEffect: "ceramic, transparent water film, and soft reflection", transitionLanguage: "the receding ring defines the final product boundary", endingDevice: "clean island tableau" }
  ]),
  defineDirection("scientific-clean", {
    creativeArchetype: "Scientific Clean",
    visualHook: "calibrated light sweeps through a clear lab field and resolves the hero with precision",
    environment: "bright materials laboratory with clear glass cylinders",
    composition: "orthographic-like grid with measured spacing and a single hero anchor",
    cameraPath: "controlled overhead descent into a straight-on product view",
    framing: "wide lab grid into a precise medium close-up",
    lightingStyle: "cool clinical white with a measured amber calibration line",
    primaryMotion: "a light scan passes across the lab plane and glass forms",
    secondaryMotion: "tiny air bubbles rise inside background glass only",
    materialEffect: "clear lab glass, brushed metal, and clean white acrylic",
    pacing: "precise calm progression",
    openingDevice: "open on a clean measurement grid without a product",
    transitionLanguage: "the scan completes the grid and reveals the product position",
    endingDevice: "calibrated front-facing hero with uncluttered white space",
    audioCharacter: "quiet laboratory hum with precise glass taps"
  }, [
    { visualHook: "an overhead calibration ring sweeps across a sterile field and leaves a sharp hero", environment: "white lab table with transparent calibration discs", composition: "top-down radial layout with the product at the center", cameraPath: "fixed overhead camera with a rotating light scan", framing: "orthographic full layout", lightingStyle: "high-key white with a narrow amber scan line", primaryMotion: "the calibration ring rotates across the table", materialEffect: "clear discs, white acrylic, and a soft glass reflection", transitionLanguage: "the final ring tightens around the product footprint", endingDevice: "top-down measured hold" },
    { visualHook: "glass columns rise in the background as a clean focus plane locks onto the hero", environment: "cool translucent lab wall with modular glass columns", composition: "product foregrounded against a rhythmic vertical grid", cameraPath: "straight rack focus with minimal forward travel", framing: "medium close hero against verticals", lightingStyle: "cool edge light with one warm product-side reflection", primaryMotion: "background glass columns elevate in staggered timing", materialEffect: "transparent glass, white polymer, and a soft haze layer", transitionLanguage: "the final column aligns with the product axis", endingDevice: "sharp laboratory portrait" }
  ]),
  defineDirection("kinetic-commercial", {
    creativeArchetype: "Kinetic Commercial",
    visualHook: "fast diagonal light passes create a new product frame on every beat",
    environment: "high-energy citrus set with angled reflective fins",
    composition: "diagonal hero staging with layered foreground passes",
    cameraPath: "energetic lateral track with two motivated speed ramps",
    framing: "medium hero with punchy close detail accents",
    lightingStyle: "bright commercial key with saturated orange streaks",
    primaryMotion: "reflective fins sweep past in a clean rhythmic sequence",
    secondaryMotion: "light streaks pulse across the floor and background",
    materialEffect: "mirror fins, glossy acrylic, and controlled motion blur",
    pacing: "fast confident cadence",
    openingDevice: "start with a sharp diagonal streak crossing an empty set",
    transitionLanguage: "each pass wipes into a new angle without losing geography",
    endingDevice: "all motion clears for a crisp product lock",
    audioCharacter: "tight commercial percussion with syncopated whooshes"
  }, [
    { visualHook: "three bright passes snap into a triangular frame around the hero", environment: "orange and white studio with rotating reflector blades", composition: "triangular geometry with the product at the apex", cameraPath: "fast controlled push-in with a final micro-lock", framing: "medium-wide to tight hero", lightingStyle: "high-key commercial light with bright edge streaks", primaryMotion: "reflector blades rotate through three timed passes", materialEffect: "satin reflector, glossy floor, and clean flare", transitionLanguage: "the third pass closes the triangle around the package", endingDevice: "tight product lock after the energy peak" },
    { visualHook: "a diagonal ribbon of light races around the set and brakes at the hero", environment: "deep orange gradient cyclorama with a polished floor", composition: "off-center hero on a strong diagonal axis", cameraPath: "lateral tracking move with a controlled brake", framing: "wide diagonal composition into medium hero", lightingStyle: "saturated orange sweep over a neutral key", primaryMotion: "one light ribbon circles the environment and decelerates", materialEffect: "polished floor, volumetric streak, and soft bloom", transitionLanguage: "the braking ribbon becomes the final contour highlight", endingDevice: "energetic but readable hold" }
  ]),
  defineDirection("abstract-material-world", {
    creativeArchetype: "Abstract Material World",
    visualHook: "translucent membranes fold into an impossible orange landscape around the hero",
    environment: "surreal translucent orange material world with no visible horizon",
    composition: "product as a small stable island inside layered abstract forms",
    cameraPath: "slow floating orbit through the material layers",
    framing: "wide surreal scale shot resolving to a medium hero",
    lightingStyle: "internal amber glow with cool translucent shadows",
    primaryMotion: "soft membranes fold and peel away in visible layers",
    secondaryMotion: "fine particles drift between the layers",
    materialEffect: "translucent film, soft silicone-like folds, and atmospheric particles",
    pacing: "dreamlike deliberate drift",
    openingDevice: "open inside an abstract translucent fold",
    transitionLanguage: "the folds widen to reveal the unchanged package as an anchor",
    endingDevice: "abstract layers freeze into a sculptural frame",
    audioCharacter: "airy granular texture with a warm sustained note"
  }, [
    { visualHook: "a soft orange paper canyon opens around the product like a miniature landscape", environment: "folded paper canyon in a cream-and-orange void", composition: "low product island surrounded by folded walls", cameraPath: "slow forward expedition through the paper canyon", framing: "low wide landscape to medium hero", lightingStyle: "sunrise gradient with deep folded shadows", primaryMotion: "paper planes unfold and create a path toward the hero", materialEffect: "folded paper, soft dust, and matte mineral floor", transitionLanguage: "the last plane folds flat behind the product", endingDevice: "miniature landscape hold" },
    { visualHook: "a cloud of amber threads braids itself into a luminous frame around the package", environment: "dark void with suspended amber fibers", composition: "centered product inside a slowly woven oval", cameraPath: "gentle vertical drift with a small parallax arc", framing: "medium centered hero with deep black space", lightingStyle: "self-lit amber fibers with a quiet cool rim", primaryMotion: "threads weave from opposite sides into a frame", materialEffect: "glowing fibers, soft haze, and black depth", transitionLanguage: "the braid tightens then stops around the silhouette", endingDevice: "luminous woven frame hold" }
  ]),
  defineDirection("botanical-structure", {
    creativeArchetype: "Botanical Structure",
    visualHook: "dry translucent leaf ribs unfold into an elegant frame around the product",
    environment: "sunlit botanical study with pale leaves and a warm stone surface",
    composition: "product centered inside a natural radial structure",
    cameraPath: "gentle overhead arc into a calm front-facing view",
    framing: "wide botanical context to medium hero",
    lightingStyle: "soft morning light with translucent leaf shadows",
    primaryMotion: "leaf ribs unfurl outward in a measured radial sequence",
    secondaryMotion: "small dust motes drift through the sunbeam",
    materialEffect: "translucent leaf membrane, stone, and fine pollen-like dust",
    pacing: "organic measured bloom",
    openingDevice: "open on a close abstract leaf vein",
    transitionLanguage: "the radial structure opens a clean product window",
    endingDevice: "natural frame settles around a readable hero",
    audioCharacter: "soft botanical rustle with a warm acoustic pulse"
  }, [
    { visualHook: "a single translucent leaf shadow travels from background to foreground and frames the hero", environment: "cream botanical studio with one sculptural leaf", composition: "off-center still life with a long shadow path", cameraPath: "locked-off still life with only shadow travel", framing: "wide editorial still life", lightingStyle: "hard low morning sun through a leaf", primaryMotion: "the leaf shadow drifts across the floor and stops at the base", materialEffect: "matte stone, translucent leaf, and crisp shadow", transitionLanguage: "the shadow line becomes a visual underline", endingDevice: "editorial still-life hold" },
    { visualHook: "fine orange pollen-like particles spiral into a halo while the package remains untouched", environment: "bright cream greenhouse haze with a warm backlight", composition: "centered halo around a stable product island", cameraPath: "slow circular drift around the atmosphere", framing: "medium hero with airy upper space", lightingStyle: "high-key greenhouse glow with amber particles", primaryMotion: "fine particles spiral upward and form a loose halo", materialEffect: "soft haze, controlled particles, and pale ceramic", transitionLanguage: "the halo opens at the label axis", endingDevice: "airy centered hold" }
  ])
];
var productCinematicAdDirections = [
  defineDirection("cinematic-arrival", {
    creativeArchetype: "Cinematic Arrival",
    visualHook: "a distant horizon light travels forward until it lands on the hero",
    environment: "large-scale dawn landscape with a polished platform",
    composition: "wide horizon establishing frame that compresses into a product portrait",
    cameraPath: "slow forward dolly with a motivated rise",
    framing: "epic wide opening to a close hero",
    lightingStyle: "sunrise gradient with a controlled citrus flare",
    primaryMotion: "the horizon glow advances across the platform",
    secondaryMotion: "fine atmospheric dust catches the advancing light",
    materialEffect: "polished platform, atmospheric depth, and soft lens flare",
    pacing: "cinematic escalation and settle",
    openingDevice: "begin on a nearly empty horizon",
    transitionLanguage: "the traveling light pulls the viewer into the product close-up",
    endingDevice: "hero holds at the peak of the sunrise",
    audioCharacter: "wide cinematic swell with a restrained final resolve"
  }, [
    { visualHook: "a sunset line crosses a vast set and turns a distant silhouette into the hero", environment: "warm desert-like studio horizon with a reflective floor", composition: "wide low horizon with product arriving from depth", cameraPath: "long-lens push through atmospheric layers", framing: "wide silhouette to medium hero", lightingStyle: "low golden sun with orange atmospheric haze", primaryMotion: "the silhouette advances as the horizon brightens", materialEffect: "reflective floor, haze, and warm dust", transitionLanguage: "the horizon line becomes the product rim light", endingDevice: "low heroic hold" }
  ]),
  defineDirection("ritual-sunrise", {
    creativeArchetype: "Ritual Sunrise",
    visualHook: "morning light moves through a quiet ritual and ends in a product still life",
    environment: "sunlit vanity with linen, ceramic, and a quiet window",
    composition: "intimate layered tabletop with a clear hero center",
    cameraPath: "gentle handheld-like drift with a final stillness",
    framing: "close tactile details into a medium lifestyle hero",
    lightingStyle: "natural morning light with warm reflected fill",
    primaryMotion: "a linen fold opens to reveal the product position",
    secondaryMotion: "window light shifts across ceramic and glass props",
    materialEffect: "linen, ceramic, clear glass, and soft reflected light",
    pacing: "warm intimate build",
    openingDevice: "start on the first light touching the tabletop",
    transitionLanguage: "each ritual detail leads to the product without a hard cut",
    endingDevice: "lived-in but polished vanity hold",
    audioCharacter: "quiet morning room tone with light tactile foley"
  }, [
    { visualHook: "a folded towel and a rising sun patch create a calm ritual path to the hero", environment: "bright bathroom shelf with stone and folded cotton", composition: "diagonal ritual path ending at the package", cameraPath: "slow slider following the path", framing: "detail-led medium hero", lightingStyle: "soft bathroom daylight with a warm reflected wall", primaryMotion: "the light patch moves along the shelf toward the product", materialEffect: "cotton, stone, glass, and gentle condensation", transitionLanguage: "the final light patch lands behind the label", endingDevice: "calm morning shelf hold" }
  ]),
  defineDirection("shadow-theatre", {
    creativeArchetype: "Shadow Theatre",
    visualHook: "a moving silhouette story plays across the set before the product enters the light",
    environment: "minimal black stage with a translucent screen",
    composition: "layered foreground screen, shadow plane, and product reveal zone",
    cameraPath: "measured side track across the theatrical layers",
    framing: "wide stage view into a sharp product portrait",
    lightingStyle: "directional spotlight with sculptural hard shadows",
    primaryMotion: "abstract silhouettes cross the screen and clear the hero zone",
    secondaryMotion: "a warm edge grows behind the product position",
    materialEffect: "translucent screen, black stage, and controlled haze",
    pacing: "dramatic reveal with a quiet landing",
    openingDevice: "begin with only a moving shadow on the screen",
    transitionLanguage: "the shadow exits to reveal the real package",
    endingDevice: "spotlight locks into a clean final portrait",
    audioCharacter: "cinematic low pulse with soft theatrical impacts"
  }, [
    { visualHook: "a paper-cut silhouette folds away to reveal the real hero in one continuous move", environment: "warm amber stage with a paper-cut screen", composition: "profile theatre with a deep product reveal pocket", cameraPath: "slow orbit around the screen edge", framing: "wide stage to close portrait", lightingStyle: "warm spotlight with black negative space", primaryMotion: "the paper-cut plane folds away in visible sections", materialEffect: "paper cutout, matte floor, and soft haze", transitionLanguage: "the folding screen becomes the final backdrop", endingDevice: "theatrical product portrait" }
  ]),
  defineDirection("light-pilgrimage", {
    creativeArchetype: "Light Pilgrimage",
    visualHook: "one traveling beam crosses changing worlds and finds the product at the end",
    environment: "sequence-like corridor of cream, orange, and black light fields",
    composition: "product revealed from depth on a strong central path",
    cameraPath: "continuous forward tracking through motivated light zones",
    framing: "wide corridor to close product lock",
    lightingStyle: "successive pools of light with a consistent warm thread",
    primaryMotion: "the camera and beam travel together through each field",
    secondaryMotion: "dust and soft reflections mark the beam path",
    materialEffect: "acrylic partitions, haze, and reflective floor",
    pacing: "purposeful cinematic journey",
    openingDevice: "begin in darkness with a single moving beam",
    transitionLanguage: "each light field motivates the next spatial move",
    endingDevice: "beam stops as the product reaches the final pool",
    audioCharacter: "ascending tonal journey with tactile transitions"
  }, [
    { visualHook: "a warm line of light descends through suspended frames until it lands on the hero", environment: "vertical gallery of floating frames", composition: "central axis with nested depth", cameraPath: "controlled upward crane through the frames", framing: "wide vertical scale to medium hero", lightingStyle: "single warm beam with cool ambient void", primaryMotion: "frames lower in sequence as the beam descends", materialEffect: "suspended acrylic, haze, and black depth", transitionLanguage: "the last frame opens directly onto the product", endingDevice: "vertical gallery lock" }
  ]),
  defineDirection("editorial-still-life", {
    creativeArchetype: "Editorial Still Life",
    visualHook: "an editorial tabletop rearranges itself into a refined product portrait",
    environment: "fashion-editorial tabletop with sculptural paper and mineral props",
    composition: "asymmetric magazine-cover arrangement with one clear hero",
    cameraPath: "slow overhead-to-front transition with precise stop",
    framing: "flat-lay detail into polished medium portrait",
    lightingStyle: "soft directional key with deliberate graphic falloff",
    primaryMotion: "paper and mineral forms slide into a balanced arrangement",
    secondaryMotion: "a small reflective accent rotates into the light",
    materialEffect: "paper, mineral, brushed metal, and silk shadow",
    pacing: "composed editorial rhythm",
    openingDevice: "begin with a partial flat-lay composition",
    transitionLanguage: "each object slides into place around the product",
    endingDevice: "finished cover-like still frame",
    audioCharacter: "subtle editorial ticks with a clean modern bed"
  }, [
    { visualHook: "a single sculptural sheet curves into a magazine-cover frame around the hero", environment: "cream paper studio with a black mineral slab", composition: "strong negative space and one sweeping curve", cameraPath: "slow three-quarter arc around the sheet", framing: "wide still life into medium close", lightingStyle: "softbox key with a crisp curve shadow", primaryMotion: "the sheet rolls into its final sculptural curve", materialEffect: "heavy paper, mineral, and controlled matte reflection", transitionLanguage: "the curve settles as a graphic border", endingDevice: "editorial cover hold" }
  ]),
  defineDirection("scale-shift", {
    creativeArchetype: "Scale Shift",
    visualHook: "a tiny texture world expands into a grand product landscape",
    environment: "surreal citrus terrain built from layered mineral textures",
    composition: "macro terrain foreground leading to a distant product hero",
    cameraPath: "accelerated pull-back from macro detail to wide reveal",
    framing: "extreme macro to epic wide product landscape",
    lightingStyle: "low warm sun across ridged texture with a clean rim",
    primaryMotion: "the camera pulls back as terrain lines organize around the product",
    secondaryMotion: "fine grains slide down the ridges",
    materialEffect: "mineral ridges, dry grains, and atmospheric depth",
    pacing: "surprise expansion and settle",
    openingDevice: "open so close to texture that scale is ambiguous",
    transitionLanguage: "the pull-back reveals the product as the scale anchor",
    endingDevice: "wide landscape hero with stable package read",
    audioCharacter: "deep reveal swell with granular texture accents"
  }, [
    { visualHook: "a microscopic orange crystal grows into a luminous platform beneath the hero", environment: "abstract crystal field with a black horizon", composition: "product elevated on a newly formed platform", cameraPath: "macro pull-back followed by a slow rise", framing: "macro crystal to wide platform hero", lightingStyle: "internal orange crystal glow with cool rim", primaryMotion: "crystal facets extend outward into a platform", materialEffect: "translucent crystal, haze, and matte black depth", transitionLanguage: "the final facet locks under the product position", endingDevice: "elevated cinematic hold" }
  ]),
  defineDirection("material-metamorphosis", {
    creativeArchetype: "Material Metamorphosis",
    visualHook: "soft fabric, liquid light, and hard mineral planes trade places around the hero",
    environment: "abstract studio with fabric, reflective liquid, and mineral planes",
    composition: "product stable at center while materials orbit in layers",
    cameraPath: "controlled orbit around the environmental materials",
    framing: "medium product portrait with layered foreground",
    lightingStyle: "warm key with changing material reflections",
    primaryMotion: "fabric folds become reflected light, then settle into mineral planes",
    secondaryMotion: "liquid reflections travel across the floor",
    materialEffect: "fabric, reflective liquid light, and matte mineral",
    pacing: "rich tactile progression",
    openingDevice: "start inside a soft fabric fold",
    transitionLanguage: "each material hands the frame to the next",
    endingDevice: "all materials settle into a restrained hero environment",
    audioCharacter: "textural foley layered with a warm cinematic pad"
  }, [
    { visualHook: "a translucent orange film peels back to expose a mineral frame around the product", environment: "warm translucent film chamber over dark stone", composition: "centered hero behind a layered foreground veil", cameraPath: "slow push through the peeling film", framing: "tight veil opening into medium hero", lightingStyle: "backlit amber film with cool stone fill", primaryMotion: "the film peels in sections and reveals the stone plane", materialEffect: "translucent film, dark stone, and soft reflected light", transitionLanguage: "the last film edge becomes the product rim light", endingDevice: "material contrast hold" }
  ]),
  defineDirection("color-field-story", {
    creativeArchetype: "Color Field Story",
    visualHook: "three color fields pass through one another and leave a warm final product world",
    environment: "seamless color-field studio shifting from cream to orange to black",
    composition: "product held on a clean central axis through changing fields",
    cameraPath: "slow straight push with no perspective jump",
    framing: "medium portrait with expansive color around it",
    lightingStyle: "soft gradient fields with a precise product rim",
    primaryMotion: "large color fields glide behind the stable product",
    secondaryMotion: "a soft shadow maintains continuity across each field",
    materialEffect: "matte color planes and a controlled satin floor reflection",
    pacing: "bold but calm color progression",
    openingDevice: "begin in a pale field with the hero barely separated",
    transitionLanguage: "the color change carries the story without a cut",
    endingDevice: "warm PROYA-aligned color field and clean hold",
    audioCharacter: "minimal tonal color changes with a gentle final chord"
  }, [
    { visualHook: "a cool blue shadow is gradually overtaken by a warm orange field around the hero", environment: "dual-color studio split by a moving shadow", composition: "product at the boundary between cool and warm", cameraPath: "slow lateral move following the boundary", framing: "wide color split into medium hero", lightingStyle: "cool ambient field with a warm advancing key", primaryMotion: "the warm field crosses the set and replaces the cool shadow", materialEffect: "matte color field and a soft floor gradient", transitionLanguage: "the boundary settles just behind the package", endingDevice: "warm balanced portrait hold" }
  ])
];
var benefitResultDirections = [
  defineDirection("benefit-human-before-after", { creativeArchetype: "Human Before and After", visualHook: "the same natural skin area begins visibly dull, dry, tired, or uncomfortable and changes gradually toward the verified improved-looking result", environment: "simple bathroom or daylight vanity with empty surfaces and no skincare containers", composition: "matched close-up of the same person and skin area throughout", cameraPath: "steady close-up with one gentle move and no product reveal", framing: "human skin and expression fill the frame", lightingStyle: "consistent soft natural light that does not manufacture the result", primaryMotion: "the visible skin appearance changes gradually and believably", secondaryMotion: "a small expression relaxes as comfort or freshness becomes visible", materialEffect: "real skin texture with a restrained moisture sheen", pacing: "clear before, gradual transition, readable after", openingDevice: "begin directly on the relevant skin concern", transitionLanguage: "the same continuous human moment carries the appearance change", endingDevice: "hold the verified improved-looking result without perfecting natural skin", audioCharacter: "quiet natural ambience with a restrained tonal lift" }),
  defineDirection("benefit-skin-macro", { creativeArchetype: "Skin Macro Result", visualHook: "a realistic skin macro makes the verified texture, moisture, freshness, or radiance result visibly legible", environment: "clean abstract skin-macro space with no packaging or interface", composition: "one uninterrupted skin surface fills the frame", cameraPath: "slow parallel macro glide", framing: "extreme skin-surface close-up", lightingStyle: "neutral diffuse beauty light held consistent across the change", primaryMotion: "the surface becomes visibly fresher, smoother-looking, softer-looking, brighter-looking, or more hydrated-looking as authorized", secondaryMotion: "natural micro-highlights settle evenly", materialEffect: "realistic pores, fine texture, and subtle moisture", pacing: "measured cause-to-result progression", openingDevice: "open on the relevant visible concern", transitionLanguage: "the appearance change travels continuously across the skin surface", endingDevice: "calm natural-texture result hold", audioCharacter: "soft tactile ambience" }),
  defineDirection("benefit-hydration-result", { creativeArchetype: "Hydration Result", visualHook: "dry-looking skin gains a clear moisture sheen and a softer more supple appearance", environment: "minimal human skin close-up with no bathroom products or containers", composition: "cheek or hand-skin detail remains the sole subject", cameraPath: "gentle macro push-in", framing: "tight moisture-result close-up", lightingStyle: "soft neutral daylight with controlled highlights", primaryMotion: "moisture visibly spreads and the dry-looking surface relaxes", secondaryMotion: "fine texture remains natural while highlights become dewier", materialEffect: "clear hydration and realistic skin, never plastic gloss", pacing: "slow readable hydration progression", openingDevice: "begin on the dry-looking texture", transitionLanguage: "the moisture front motivates the visible result", endingDevice: "supple comfortable-looking skin hold", audioCharacter: "delicate water texture and quiet room tone" }),
  defineDirection("benefit-radiance-result", { creativeArchetype: "Radiance Result", visualHook: "a dull or uneven-looking complexion gradually becomes fresher, brighter-looking, and naturally radiant", environment: "plain daylight portrait setting with no products, logos, or written props", composition: "the same face and complexion remain centered for an honest comparison", cameraPath: "locked portrait with a slight final push", framing: "close beauty portrait that preserves natural skin detail", lightingStyle: "stable daylight exposure; the complexion change must be visible beyond lighting", primaryMotion: "tone appearance becomes more even-looking and radiance emerges gradually", secondaryMotion: "the person makes a small natural turn into the final view", materialEffect: "natural skin and a subtle healthy-looking sheen", pacing: "restrained visible progression", openingDevice: "begin on the dull or uneven-looking complexion", transitionLanguage: "a continuous facial movement bridges the states without a cut", endingDevice: "natural radiant-looking complexion hold", audioCharacter: "clean gentle tonal rise" }),
  defineDirection("benefit-comfort-result", { creativeArchetype: "Comfort Result", visualHook: "a person touching tight or uncomfortable-looking skin gradually relaxes as the skin appears calm and comfortable", environment: "quiet home mirror setting with an empty counter", composition: "fingertips, expression, and the relevant skin area tell the result", cameraPath: "steady intimate handheld close-up", framing: "close human detail with no product in frame or reflection", lightingStyle: "soft window light with realistic texture", primaryMotion: "the gesture changes from checking discomfort to a light relaxed touch", secondaryMotion: "expression and breathing settle naturally", materialEffect: "real skin with restrained softness and no retouching effect", pacing: "relatable problem-to-comfort beat", openingDevice: "open on the discomfort-checking gesture", transitionLanguage: "the same gesture softens as comfort becomes visible", endingDevice: "relaxed comfortable-looking skin and expression hold", audioCharacter: "quiet room tone and soft fabric movement" }),
  defineDirection("benefit-barrier-metaphor", { creativeArchetype: "Barrier Support Metaphor", visualHook: "a dry uneven skin-like surface becomes orderly and holds clear moisture beneath it", environment: "minimal beauty-science macro space without text, diagrams, or packaging", composition: "one simplified skin-like layer remains visually clear", cameraPath: "slow shallow glide along the surface", framing: "macro layer detail", lightingStyle: "clean diffuse scientific beauty light", primaryMotion: "gaps settle into a continuous calm surface while moisture remains contained", secondaryMotion: "small clear hydration highlights stabilize", materialEffect: "soft translucent biological forms and clear moisture", pacing: "simple restrained metaphor", openingDevice: "begin on the visibly uneven skin-like layer", transitionLanguage: "physical alignment creates the supported-looking final state", endingDevice: "calm continuous moisturized-looking layer hold", audioCharacter: "soft assembling texture without narration" })
];
var ingredientEducationDirections = [
  defineDirection("ingredient-macro-droplets", { creativeArchetype: "Ingredient Macro", visualHook: "one clear skincare droplet gathers and reveals suspended active-inspired particles with no symbols or labels", environment: "clean laboratory beauty macro setup without products", composition: "droplet and formulation texture fill the frame", cameraPath: "locked macro with a precise focus pull", framing: "extreme formulation close-up", lightingStyle: "high-key translucent beauty light", primaryMotion: "the droplet forms, elongates, and settles on clean glass or skin", secondaryMotion: "tiny particles diffuse naturally inside the droplet", materialEffect: "clear skincare liquid with realistic viscosity", pacing: "slow educational texture study", openingDevice: "begin inside the forming droplet", transitionLanguage: "focus reveals the formulation interaction", endingDevice: "calm settled droplet hold", audioCharacter: "tiny liquid detail and clean ambience" }),
  defineDirection("ingredient-foam-formulation", { creativeArchetype: "Foam Formulation", visualHook: "dense fine skincare foam develops from creamy cleanser and water in macro detail", environment: "clean laboratory sink-side macro with no packaging", composition: "foam structure, water, and hands dominate the frame", cameraPath: "controlled macro tracking move", framing: "tight foam and bubble structure", lightingStyle: "fresh diffuse laboratory light", primaryMotion: "cream and water build into a fine dense lather", secondaryMotion: "small bubbles expand and settle realistically", materialEffect: "soft cosmetic foam and clear water, never food", pacing: "clear formulation progression", openingDevice: "open where creamy cleanser meets water", transitionLanguage: "mixing action visibly builds the foam", endingDevice: "stable fine-lather macro hold", audioCharacter: "gentle water and foam foley" }),
  defineDirection("ingredient-mist-formulation", { creativeArchetype: "Mist Formulation", visualHook: "a fine watery skincare mist blooms through backlight and resolves into tiny clear droplets", environment: "clean bright beauty-science space with no bottle or dispenser visible", composition: "mist plume crosses a simple skin or glass background", cameraPath: "static high-speed-style close-up", framing: "macro mist and microdroplet detail", lightingStyle: "soft backlight with no flare or text", primaryMotion: "the fine mist travels, disperses, and lands as hydration droplets", secondaryMotion: "microdroplets merge and settle naturally", materialEffect: "clear watery formulation and realistic surface tension", pacing: "fresh single-action ingredient study", openingDevice: "begin just before mist enters the frame", transitionLanguage: "the plume connects airborne texture to settled droplets", endingDevice: "tiny clear droplets resting on the surface", audioCharacter: "soft airy spray and quiet laboratory ambience" }),
  defineDirection("ingredient-cream-formulation", { creativeArchetype: "Cream Formulation", visualHook: "a silky skincare cream ribbon folds into a smooth macro swirl", environment: "bright neutral formulation laboratory with no jar, tube, or branding", composition: "cream body and surface structure fill the frame", cameraPath: "slow shallow macro slide", framing: "extreme cream-texture close-up", lightingStyle: "broad soft light revealing density and gloss", primaryMotion: "the cosmetic cream folds and settles under its own weight", secondaryMotion: "one smooth ridge relaxes naturally", materialEffect: "silky cosmetic cream, never frosting or food", pacing: "calm tactile formulation study", openingDevice: "open on the forming cream fold", transitionLanguage: "the fold reveals viscosity and structure", endingDevice: "clean settled cream swirl hold", audioCharacter: "subtle tactile formulation sound" }),
  defineDirection("ingredient-active-particles", { creativeArchetype: "Active Particle Interaction", visualHook: "translucent active-inspired particles enter a clear hydration field and move toward a simplified skin surface", environment: "minimal beauty-science macro world without formulas, labels, or interface", composition: "one particle pathway makes the interaction legible", cameraPath: "gentle microscopic follow move", framing: "particle macro into skin-layer detail", lightingStyle: "clean high-key illumination with restrained warm accents", primaryMotion: "particles approach, diffuse, and settle through observable physical stages", secondaryMotion: "the hydration field responds with subtle ripples", materialEffect: "translucent particles, clear water, and soft skin-like layers", pacing: "simple visual explanation", openingDevice: "open close on one active-inspired particle", transitionLanguage: "particle movement reveals the skin context", endingDevice: "calm evenly dispersed interaction state", audioCharacter: "soft scientific shimmer without narration" }),
  defineDirection("ingredient-skin-layer", { creativeArchetype: "Skin Layer Visualization", visualHook: "clear hydration and verified-ingredient-inspired particles travel through a simplified translucent skin layer", environment: "clean biological beauty visualization without diagram text", composition: "one readable layer pathway occupies the frame", cameraPath: "smooth microscopic tracking move", framing: "macro cross-section view", lightingStyle: "soft clinical beauty light", primaryMotion: "droplets and particles enter, spread, and settle through the layer", secondaryMotion: "surface moisture highlights respond gently", materialEffect: "clear water, translucent biological layers, and soft particles", pacing: "stepwise educational progression", openingDevice: "begin above the simplified surface", transitionLanguage: "the ingredient path motivates the camera travel", endingDevice: "balanced hydrated-looking layer state", audioCharacter: "delicate water texture and soft pulse" }),
  defineDirection("ingredient-clean-lab", { creativeArchetype: "Clean Lab Aesthetic", visualHook: "a glass sample dish receives a precise skincare formulation droplet in pristine macro detail", environment: "bright clean laboratory bench with anonymous glassware and no labels", composition: "sample dish, droplet, and formulation texture form a sparse beauty still life", cameraPath: "small controlled lateral macro slide", framing: "close laboratory formulation study", lightingStyle: "clean daylight with restrained warm accents", primaryMotion: "one droplet enters the dish and spreads into a thin formulation layer", secondaryMotion: "a soft glass reflection shifts with the camera", materialEffect: "laboratory glass and skincare liquid or cream appropriate to the selected product", pacing: "precise calm study", openingDevice: "open on the empty sample dish and incoming droplet", transitionLanguage: "the dispense action reveals formulation behavior", endingDevice: "settled sample texture hold", audioCharacter: "quiet glass and liquid detail" }),
  defineDirection("ingredient-antioxidant-metaphor", { creativeArchetype: "Antioxidant Particle Metaphor", visualHook: "bright active-inspired particles calmly intercept harsh reactive-looking particles before a skin-like surface", environment: "clean microscopic beauty-science space without formulas or written science", composition: "two particle paths make the interaction immediately visible", cameraPath: "smooth tracking alongside the particle paths", framing: "macro particle interaction", lightingStyle: "luminous white with restrained citrus accents", primaryMotion: "the active-inspired particles meet and disperse the visual disturbance", secondaryMotion: "the skin-like surface remains calm and intact", materialEffect: "translucent particles, soft light, and simplified skin texture", pacing: "legible restrained metaphor", openingDevice: "start on the approaching visual disturbance", transitionLanguage: "the interaction resolves into calm dispersed light", endingDevice: "undisturbed skin-like surface hold", audioCharacter: "clean microscopic pulse without narration" })
];
var familyGrammars = {
  Hook: { contentFamily: "Hook", description: "Attention-grabbing, relatable skincare opening in the first one to three seconds.", directions: productBRollDirections },
  Benefits: { contentFamily: "Benefits", description: "Product-free human skin results and restrained visual metaphors using only the selected product\u2019s verified benefits.", directions: benefitResultDirections },
  Ingredients: { contentFamily: "Ingredients", description: "Product-free ingredient education, formulation macro, texture, and beauty-science visualization using only verified ingredients.", directions: ingredientEducationDirections },
  Product: { contentFamily: "Product", description: "Clear, practical, reference-faithful product footage from the first frame.", directions: [
    defineDirection("product-clean-hero", { creativeArchetype: "Clean Hero", visualHook: "the front-facing product is already clear in the first frame", environment: "simple cream studio tabletop or believable bathroom counter", composition: "product is the focal point, occupying about half the frame height", cameraPath: "static tripod or very gentle push-in", framing: "medium front-facing product portrait", lightingStyle: "soft even skincare light", primaryMotion: "product remains still while the camera moves slightly", secondaryMotion: "small natural reflection only", materialEffect: "realistic package gloss and clean countertop", pacing: "direct and edit-friendly", openingDevice: "begin with the whole front-facing product visible", transitionLanguage: "one continuous restrained product shot", endingDevice: "stable front-facing product hold", audioCharacter: "quiet natural room tone" }),
    defineDirection("product-vanity-shelf", { creativeArchetype: "Vanity or Shelf", visualHook: "the front-facing product is already visible on a real skincare vanity", environment: "clean bathroom vanity or tidy skincare shelf", composition: "product clearly separated from neutral everyday props", cameraPath: "short lateral slide or subtle handheld drift", framing: "medium close-up with the product prominent", lightingStyle: "soft natural daylight", primaryMotion: "camera moves gently while the product remains still", secondaryMotion: "minor natural background movement", materialEffect: "ceramic, cotton towel, and realistic packaging", pacing: "practical social-commerce insert", openingDevice: "begin with the product plainly visible on the vanity or shelf", transitionLanguage: "continuous small camera move", endingDevice: "front-readable product hold", audioCharacter: "quiet bathroom ambience" }),
    defineDirection("product-macro-detail", { creativeArchetype: "Macro Packaging Detail", visualHook: "the verified dropper, cap, or front package detail is visible immediately", environment: "clean skincare macro setup", composition: "one authentic packaging detail fills the close frame", cameraPath: "locked macro with a very small slide", framing: "tight packaging detail without losing product identity", lightingStyle: "soft light that keeps the package print legible", primaryMotion: "one small focus adjustment on the existing detail", secondaryMotion: "none", materialEffect: "reference-accurate package surface", pacing: "short edit-ready detail", openingDevice: "begin already framed on the real package detail", transitionLanguage: "continuous detail shot with no reveal", endingDevice: "steady detail hold", audioCharacter: "subtle handling sound" }),
    defineDirection("product-usage-dispensing", { creativeArchetype: "Usage or Dispensing", visualHook: "the front-facing product and its dispenser are visible from the start", environment: "natural sink-side or vanity setting", composition: "product and hand remain clear in a close skincare frame", cameraPath: "stable tripod close-up", framing: "close product and dropper or texture view", lightingStyle: "soft daylight", primaryMotion: "one natural product-specific dispensing or application action", secondaryMotion: "clear serum texture settles naturally when shown", materialEffect: "real packaging, natural skin, and verified product texture", pacing: "simple practical demonstration", openingDevice: "begin with product already visible beside the hand", transitionLanguage: "the usage action carries one continuous shot", endingDevice: "front-readable product and texture hold", audioCharacter: "gentle dispensing foley" }),
    defineDirection("product-top-down", { creativeArchetype: "Top-Down Product", visualHook: "the entire reference-faithful product is already visible in a clean flat lay", environment: "light bathroom counter with one neutral towel or tray", composition: "product dominates an uncluttered top-down arrangement", cameraPath: "locked overhead tripod or tiny lateral slide", framing: "full product with safe margins", lightingStyle: "large soft daylight source", primaryMotion: "product stays still as the camera moves minimally", secondaryMotion: "none", materialEffect: "clean stone, cotton, and real package finish", pacing: "restrained edit-ready insert", openingDevice: "begin on the complete product flat lay", transitionLanguage: "continuous top-down product shot", endingDevice: "stable full-product hold", audioCharacter: "soft room tone" })
  ] },
  "CTA / End Card": {
    contentFamily: "CTA / End Card",
    description: "Local premium product end cards; the selected direction is metadata only and never sent to a model.",
    directions: productBRollDirections
  },
  "Product B-Roll": {
    contentFamily: "Product B-Roll",
    description: "Practical, clean social-commerce inserts with a visible, reference-faithful product, restrained camera movement, and natural skincare settings.",
    directions: [
      defineDirection("vanity-daylight", { creativeArchetype: "Bathroom Vanity Daylight", visualHook: "the product sits naturally beside a clean sink as soft window light moves across it", environment: "believable bright bathroom vanity with ceramic, mirror, and folded towel", composition: "simple off-center product placement with useful edit space", cameraPath: "gentle short push-in from a stable tripod", framing: "medium product context into a clean close-up", lightingStyle: "natural daylight with soft bathroom fill", primaryMotion: "a hand places the product down naturally and leaves frame", secondaryMotion: "small water highlights move on the sink", materialEffect: "clean ceramic, mirror glass, cotton, and a few realistic water droplets", pacing: "restrained two-second insert rhythm", openingDevice: "begin on the empty vanity position", transitionLanguage: "the placement motivates the small push-in", endingDevice: "stable front-readable product hold", audioCharacter: "quiet room tone and a soft placement sound" }),
      defineDirection("skincare-shelf", { creativeArchetype: "Skincare Shelf Insert", visualHook: "a hand reaches to a tidy skincare shelf and selects the product", environment: "realistic bathroom skincare shelf in soft morning light", composition: "product clearly separated from a few unbranded neutral objects", cameraPath: "controlled handheld move with minimal drift", framing: "shelf-level medium close-up", lightingStyle: "soft natural window light", primaryMotion: "the product is picked up once at a readable pace", secondaryMotion: "minor natural hand and sleeve movement", materialEffect: "painted shelf, glass, and cotton towel", pacing: "quick practical insert with a clean cut point", openingDevice: "open with the product already visible on the shelf", transitionLanguage: "the hand movement carries the frame", endingDevice: "brief readable product-in-hand hold", audioCharacter: "natural shelf and handling foley" }),
      defineDirection("countertop-slider", { creativeArchetype: "Clean Countertop Slide", visualHook: "the product rests on a clean countertop with an immediately readable front", environment: "bright uncluttered skincare countertop", composition: "simple product-first composition with negative space", cameraPath: "small lateral slider move of only a few centimeters", framing: "close product shot suitable for a one-to-three-second edit", lightingStyle: "soft studio daylight without dramatic contrast", primaryMotion: "the product remains still while the camera makes one restrained slide", secondaryMotion: "a subtle natural reflection shifts on the counter", materialEffect: "matte stone, soft reflection, and clean glass", pacing: "calm and edit-friendly", openingDevice: "start on a clear three-quarter product view", transitionLanguage: "continuous short lateral motion", endingDevice: "stable front package read", audioCharacter: "minimal clean room tone" }),
      defineDirection("handheld-closeup", { creativeArchetype: "Social Handheld Close-Up", visualHook: "a natural hand-held close-up shows the product at believable human scale", environment: "simple sink-side bathroom environment", composition: "product centered loosely with phone-like breathing room", cameraPath: "controlled handheld approach with tiny natural movement", framing: "tight social-commerce product close-up", lightingStyle: "honest diffuse daylight", primaryMotion: "the hand turns the product only enough to settle the front toward camera", secondaryMotion: "minor focus correction and natural wrist movement", materialEffect: "natural skin, ceramic, and soft towel texture", pacing: "direct and useful short-form insert", openingDevice: "enter with the product already in hand", transitionLanguage: "one natural reframe creates the detail shot", endingDevice: "front-facing product hold", audioCharacter: "subtle handling foley" }),
      defineDirection("top-down-counter", { creativeArchetype: "Top-Down Counter Shot", visualHook: "the product is placed into a clean top-down skincare arrangement", environment: "light stone countertop with one towel and one simple tray", composition: "uncluttered flat arrangement with the package silhouette fully visible", cameraPath: "locked overhead tripod", framing: "top-down close shot with crop-safe margins", lightingStyle: "large soft source with gentle natural shadow", primaryMotion: "a hand places the product once and withdraws", secondaryMotion: "none beyond the soft settling shadow", materialEffect: "stone, cotton, and ceramic", pacing: "precise one-to-two-second insert", openingDevice: "open on the receiving surface", transitionLanguage: "the placement supplies the entire action", endingDevice: "clean overhead hold", audioCharacter: "soft placement tap" }),
      defineDirection("pump-detail", { creativeArchetype: "Pump and Cap Detail", visualHook: "a simple macro isolates the real cap, pump, or dropper detail from the reference product", environment: "clean bright vanity detail setup", composition: "package mechanism fills the frame without losing product identity", cameraPath: "static macro with a small focus pull", framing: "extreme packaging detail to close product context", lightingStyle: "soft controlled light with realistic highlights", primaryMotion: "a hand performs one natural cap, pump, or dropper action appropriate to the product", secondaryMotion: "a restrained highlight tracks the movement", materialEffect: "reference-accurate packaging surfaces and clean skin", pacing: "clear functional detail", openingDevice: "open already focused on the mechanism", transitionLanguage: "focus shifts gently from mechanism to package", endingDevice: "mechanism and product settle unchanged", audioCharacter: "close tactile click or pump foley" }),
      defineDirection("macro-packaging", { creativeArchetype: "Packaging Macro Insert", visualHook: "a macro view travels across the real package finish and front design", environment: "soft neutral tabletop studio", composition: "tight crop keeps reference-visible package details dominant", cameraPath: "very small parallel macro slide", framing: "extreme close-up with shallow but usable focus", lightingStyle: "broad softbox reflection without flare or light streaks", primaryMotion: "camera movement reveals one packaging detail while the product stays still", secondaryMotion: "soft reflection moves naturally across the finish", materialEffect: "reference-accurate package finish on a neutral surface", pacing: "slow enough to read within a short insert", openingDevice: "start on a recognizable package contour", transitionLanguage: "the slide resolves toward the front design", endingDevice: "brief sharp detail hold", audioCharacter: "quiet tactile texture" }),
      defineDirection("water-droplet-sink", { creativeArchetype: "Sink-Side Water Detail", visualHook: "a few clean water droplets catch daylight beside the naturally placed product", environment: "simple clean sink or shower ledge", composition: "product remains the readable anchor with droplets as secondary detail", cameraPath: "tripod close-up with a gentle push-in", framing: "close product and surface detail", lightingStyle: "natural bathroom daylight with soft highlights", primaryMotion: "small droplets slide across the surface without touching or altering the package", secondaryMotion: "a quiet sink reflection shifts", materialEffect: "clean water, ceramic, and reference-faithful packaging", pacing: "fresh restrained insert", openingDevice: "open on one droplet beside the product", transitionLanguage: "focus moves from droplet to product", endingDevice: "clean readable product hold", audioCharacter: "subtle water detail and room tone" }),
      defineDirection("soft-studio", { creativeArchetype: "Soft Studio Product Insert", visualHook: "the product stands plainly on a light neutral surface in soft studio light", environment: "minimal cream or white tabletop setup", composition: "straightforward product framing with practical negative space", cameraPath: "locked tripod or very gentle push-in", framing: "medium close product shot", lightingStyle: "soft even studio illumination with low contrast", primaryMotion: "the product remains stationary and unchanged", secondaryMotion: "only a slight natural shadow shift", materialEffect: "matte neutral surface and accurate packaging finish", pacing: "simple reusable insert", openingDevice: "begin directly on the product", transitionLanguage: "one restrained move preserves continuity", endingDevice: "steady front-facing hold", audioCharacter: "minimal neutral sound bed" }),
      defineDirection("natural-pickup", { creativeArchetype: "Natural Pick-Up and Place-Down", visualHook: "a hand naturally picks up the product from a vanity and returns it to the same spot", environment: "lived-in but tidy morning bathroom", composition: "human hand establishes scale while the product stays unobstructed", cameraPath: "stable shoulder-level handheld close-up", framing: "medium-close interaction shot", lightingStyle: "soft morning daylight", primaryMotion: "one believable pick-up or place-down action", secondaryMotion: "small towel and sleeve movement", materialEffect: "skin, cotton, ceramic, and accurate packaging", pacing: "natural social-commerce timing", openingDevice: "start with the product already present", transitionLanguage: "the hand action creates obvious edit points", endingDevice: "product upright and readable in context", audioCharacter: "natural handling and bathroom ambience" }),
      defineDirection("mirror-side-static", { creativeArchetype: "Mirror-Side Static Insert", visualHook: "the product stands beside a clean mirror with a soft realistic reflection", environment: "simple daylight bathroom mirror ledge", composition: "front-readable product and partial reflection with open edit space", cameraPath: "locked tripod with no orbit", framing: "clean medium close-up", lightingStyle: "soft side daylight with natural mirror fill", primaryMotion: "the product remains still while a hand briefly straightens it", secondaryMotion: "a faint reflected towel movement stays secondary", materialEffect: "mirror glass, ceramic ledge, cotton, and accurate packaging", pacing: "quiet one-to-three-second insert", openingDevice: "begin on the product already in context", transitionLanguage: "one small hand adjustment supplies the edit beat", endingDevice: "stable product and reflection hold", audioCharacter: "natural bathroom room tone" }),
      defineDirection("dispense-counter-detail", { creativeArchetype: "Simple Dispensing Detail", visualHook: "one appropriate skincare dose is dispensed beside the reference-faithful product", environment: "bright clean sink-side demonstration surface", composition: "dispensing action is clear while the real product stays visible at the edge", cameraPath: "static close-up with a tiny focus shift", framing: "functional macro insert", lightingStyle: "soft daylight with low contrast", primaryMotion: "one pump, dropper release, squeeze, or scoop appropriate to the selected product", secondaryMotion: "the texture settles naturally on skin or a clean surface", materialEffect: "realistic skincare texture, natural skin, and accurate packaging", pacing: "short practical demonstration", openingDevice: "start on the package mechanism and receiving surface", transitionLanguage: "the single dispense action carries the shot", endingDevice: "clean texture detail with product context", audioCharacter: "close tactile dispensing foley" })
    ]
  },
  "Support B-Roll": {
    contentFamily: "Support B-Roll",
    description: "Reusable non-product beauty footage guided by the selected product theme without showing products, packaging, labels, or branding.",
    directions: [
      defineDirection("problem-hook", { creativeArchetype: "Problem Hook", visualHook: "a relatable skincare concern is immediately visible in a natural human moment", environment: "a believable clean bathroom or bedroom mirror setting with no branded objects", composition: "the person and concern area remain the visual focus with uncluttered negative space", cameraPath: "a subtle handheld approach or restrained mirror-side push", framing: "human close-up that reads clearly as reusable hook footage", lightingStyle: "honest soft morning light with skin-friendly fill", primaryMotion: "the person notices the concern and reacts through a small natural gesture", secondaryMotion: "quiet room detail and reflected daylight move gently", materialEffect: "natural skin, mirror glass, clean water, and soft fabric", pacing: "quick relatable opening that settles cleanly", openingDevice: "begin directly on the recognizable concern or reaction", transitionLanguage: "the gesture creates a clean cutaway point without introducing a product", endingDevice: "hold on a neutral thoughtful expression or clean concern detail", audioCharacter: "natural room tone with restrained nonverbal sound" }),
      defineDirection("skin-beauty-close-up", { creativeArchetype: "Skin Beauty Close-Up", visualHook: "light glides across healthy-looking skin texture and catches a fresh hydrated glow", environment: "minimal skin-beauty portrait space with no products or branded props", composition: "cheek, eye area, or facial skin texture fills the frame with elegant negative space", cameraPath: "slow macro slide with a precise focus pull across skin texture", framing: "extreme beauty close-up suitable for a clean cutaway", lightingStyle: "soft luminous beauty light with controlled warm highlights", primaryMotion: "a gentle head turn changes how hydration and texture catch the light", secondaryMotion: "fine hair and soft background highlights move subtly", materialEffect: "natural skin texture, soft moisture sheen, and airy light", pacing: "calm tactile progression", openingDevice: "open on an abstract skin highlight before texture resolves", transitionLanguage: "focus and light reveal the beauty detail continuously", endingDevice: "clean luminous skin hold with room for an edit", audioCharacter: "soft airy texture with subtle water-like accents" }),
      defineDirection("science-animation", { creativeArchetype: "Science Animation", visualHook: "luminous active particles enter a stylized skin-layer world and begin a clear visual journey", environment: "abstract scientific skin-layer animation with no packaging, branding, or product shapes", composition: "layered cross-section with one clear particle pathway and readable depth", cameraPath: "smooth microscopic tracking move through the stylized layers", framing: "macro scientific view that remains visually simple", lightingStyle: "clean white light with restrained warm vitamin-inspired accents", primaryMotion: "particles travel, diffuse, or organize through the layers in an observable sequence", secondaryMotion: "soft cellular pulses and tiny suspended particles support the main pathway", materialEffect: "translucent biological layers, clean light, and abstract particles", pacing: "clear educational progression without text labels", openingDevice: "begin close on one particle before the surrounding layers appear", transitionLanguage: "the particle movement motivates travel from one layer to the next", endingDevice: "settle on a calm balanced layer state without making a medical claim", audioCharacter: "clean scientific pulse with delicate microscopic texture" }),
      defineDirection("aesthetic-transition", { creativeArchetype: "Aesthetic Transition", visualHook: "soft orange-white beauty light bends through a clean water ripple and fills the frame", environment: "abstract cream, white, water, glass, and warm-light beauty space with no objects resembling packaging", composition: "simple flowing forms create a full-frame transition plate", cameraPath: "floating forward move through light, ripple, or translucent material", framing: "abstract full-frame composition designed for flexible editing", lightingStyle: "luminous white with restrained warm orange gradients", primaryMotion: "one ripple, light sweep, or translucent veil crosses the frame continuously", secondaryMotion: "small caustics and suspended highlights echo the main movement", materialEffect: "clear water, soft glass distortion, satin light, and airy haze", pacing: "smooth loop-friendly transition rhythm", openingDevice: "begin on a clean visual field with motion entering from one edge", transitionLanguage: "the moving material briefly fills the lens to create a natural edit point", endingDevice: "resolve to a clean bright field or loopable ripple state", audioCharacter: "soft liquid sweep with a light tonal shimmer" })
    ]
  },
  "Cinematic Product Ad": {
    contentFamily: "Cinematic Product Ad",
    description: "Narrative campaign films with a motivated journey, emotional escalation, and a deliberate final brand image.",
    directions: productCinematicAdDirections
  },
  "UGC Content": {
    contentFamily: "UGC Content",
    description: "Believable creator-led short-form executions with natural interaction and everyday spatial grammar.",
    directions: [
      defineDirection("creator-bathroom-check-in", { creativeArchetype: "Creator Bathroom Check-In", visualHook: "a casual morning check-in turns the product toward a window-lit bathroom mirror", environment: "realistic bright bathroom vanity", composition: "handheld off-center selfie-to-product framing", cameraPath: "natural handheld move with one deliberate reframe", framing: "medium creator frame to close product detail", lightingStyle: "soft window daylight and practical bathroom fill", primaryMotion: "creator hand brings the product into the mirror-side light", secondaryMotion: "small natural hand and towel movement", materialEffect: "ceramic, towel, glass, and believable room texture", pacing: "conversational and quick", openingDevice: "creator enters mid-thought with the product just out of frame", transitionLanguage: "spoken gesture leads naturally to the product close-up", endingDevice: "casual product-to-camera hold", audioCharacter: "natural room tone with light creator speech" }, [{ visualHook: "a quick mirror glance reveals the product in a believable morning routine", environment: "small lived-in bathroom with a fogged mirror edge", composition: "creator reflection on one side, product on the other", cameraPath: "handheld mirror pan into a close product detail", framing: "phone-like medium to close-up", lightingStyle: "mixed window and warm vanity light", primaryMotion: "the creator wipes a small mirror patch and lifts the product", materialEffect: "glass condensation, ceramic, and soft fabric", transitionLanguage: "the cleared mirror patch becomes the product window", endingDevice: "friendly close-up hold" }]),
      defineDirection("creator-vanity-demo", { creativeArchetype: "Creator Vanity Demo", visualHook: "a hand-held product recommendation lands in a tight, honest vanity close-up", environment: "lived-in bedroom vanity with cosmetics kept secondary", composition: "natural desk-level framing with product entering from the edge", cameraPath: "small handheld push-in and focus correction", framing: "medium creator shot into close product detail", lightingStyle: "soft practical lamp mixed with cool window fill", primaryMotion: "creator picks up and rotates the package toward camera", secondaryMotion: "hair, sleeve, and vanity reflections move naturally", materialEffect: "wood, fabric, ceramic, and subtle mirror reflection", pacing: "quick conversational beats", openingDevice: "start with a spoken problem and an empty hand gesture", transitionLanguage: "the gesture introduces the product at the exact moment of relevance", endingDevice: "authentic recommendation hold", audioCharacter: "clean spoken creator audio with light room tone" }),
      defineDirection("creator-texture-reaction", { creativeArchetype: "Creator Texture Reaction", visualHook: "a genuine reaction cuts from face to a macro product detail without losing the room", environment: "bright home vanity with a clean counter", composition: "face-to-hand visual rhythm with product close to lens", cameraPath: "handheld rack focus between creator and product", framing: "portrait close-up with a brief macro insert", lightingStyle: "natural daylight with soft skin-friendly fill", primaryMotion: "creator brings the product close, then gestures back to camera", secondaryMotion: "subtle focus breathing and natural hand motion", materialEffect: "clean counter, soft daylight, and shallow depth", pacing: "natural quick reaction", openingDevice: "open on the creator reaction before the product is shown", transitionLanguage: "focus transfers from reaction to package detail", endingDevice: "creator and product share the final frame", audioCharacter: "natural speech with a small tactile product sound" }),
      defineDirection("creator-day-in-life", { creativeArchetype: "Creator Day-in-the-Life", visualHook: "the product appears as one believable beat inside a moving everyday routine", environment: "sunlit bedroom-to-bathroom daily routine", composition: "observational side framing with product crossing the foreground", cameraPath: "lightly stabilized walk-and-follow movement", framing: "medium lifestyle frame with close product insert", lightingStyle: "natural mixed daylight that changes with the room", primaryMotion: "creator carries the product from one routine station to another", secondaryMotion: "background routine movement continues naturally", materialEffect: "linen, tile, glass, and real room surfaces", pacing: "unhurried but native to short-form video", openingDevice: "begin mid-routine with a natural environmental action", transitionLanguage: "the product appears as part of the routine rather than a reveal stunt", endingDevice: "product left in use-position with a brief glance to camera", audioCharacter: "natural room tone, footsteps, and optional speech" })
    ]
  },
  "Product Demo": {
    contentFamily: "Product Demo",
    description: "Instructional demonstrations that make one product action observable and useful.",
    directions: [
      defineDirection("demo-precision-dispense", { creativeArchetype: "Precision Dispense", visualHook: "one measured dispense lands cleanly in a controlled macro demonstration", environment: "clean bathroom counter with a neutral tray", composition: "overhead action zone with product and receiving surface aligned", cameraPath: "fixed overhead with a small controlled descent", framing: "overhead wide to tight action close-up", lightingStyle: "bright softbox with a precise highlight on the action", primaryMotion: "the product is positioned and one measured dispense is shown", secondaryMotion: "small controlled reflection moves across the counter", materialEffect: "ceramic tray, clear glass, and clean counter", pacing: "clear instructional rhythm", openingDevice: "open on the receiving surface and the product entering frame", transitionLanguage: "the camera follows the action from setup to result", endingDevice: "clean result hold with product readable", audioCharacter: "tactile dispense sound with light instructional voice" }),
      defineDirection("demo-routine-sequence", { creativeArchetype: "Routine Sequence", visualHook: "three clean routine beats connect the product to a believable use moment", environment: "bright vanity with a calm morning window", composition: "repeating stations create a left-to-right action path", cameraPath: "smooth lateral track across the routine stations", framing: "medium product-and-hand frames with detail inserts", lightingStyle: "consistent daylight across each station", primaryMotion: "hand, product, and surface move through three observable steps", secondaryMotion: "soft curtain light changes across the background", materialEffect: "stone, towel, ceramic, and glass", pacing: "balanced instructional progression", openingDevice: "start on the first routine surface before product enters", transitionLanguage: "each handoff motivates the next station", endingDevice: "product returns to a tidy final position", audioCharacter: "clean foley with a calm explanatory voice" }),
      defineDirection("demo-surface-reveal", { creativeArchetype: "Surface Reveal Demo", visualHook: "a controlled close-up shows the product action against a bright, legible surface", environment: "high-key white demonstration table", composition: "product and action occupy opposite thirds with clear negative space", cameraPath: "slow push-in that stays parallel to the demonstration plane", framing: "medium close-up with a precise action crop", lightingStyle: "clinical high-key light with soft shadow control", primaryMotion: "the requested product action progresses across the surface", secondaryMotion: "a measured highlight tracks the motion", materialEffect: "white acrylic, clear vessel, and soft shadow", pacing: "deliberate and legible", openingDevice: "open on the empty surface and tool position", transitionLanguage: "the action creates a visible before-to-after path", endingDevice: "stable product and result hold", audioCharacter: "clean instructional foley and optional narration" }),
      defineDirection("demo-human-scale", { creativeArchetype: "Human-Scale Demonstration", visualHook: "a hand and product share the frame so scale and action remain immediately understandable", environment: "warm neutral bathroom shelf", composition: "human hand establishes scale beside an upright product", cameraPath: "gentle shoulder-level slide with a close action insert", framing: "human-scale medium shot to close detail", lightingStyle: "soft warm daylight with natural fill", primaryMotion: "the hand performs the requested action at a readable pace", secondaryMotion: "background towel and light move subtly", materialEffect: "wood, ceramic, soft cotton, and glass", pacing: "calm practical instruction", openingDevice: "begin with the hand reaching into the shelf", transitionLanguage: "hand motion guides the viewer through the action", endingDevice: "product returned upright in context", audioCharacter: "close tactile foley with concise voice guidance" })
    ]
  },
  "Product Transformation": {
    contentFamily: "Product Transformation",
    description: "Cause-and-effect transformation films where materials, structures, or spaces visibly change into a product-led final state.",
    directions: [
      defineDirection("mechanical-assembly", { creativeArchetype: "Mechanical Assembly", visualHook: "separate structural parts unlock, fold, and align into a product silhouette", environment: "monumental mechanical chamber with warm industrial light", composition: "wide machine geometry with a central transformation axis", cameraPath: "cinematic forward dolly with a controlled arc", framing: "epic wide to exact final hero", lightingStyle: "hard industrial shafts with warm citrus edge", primaryMotion: "panels unlock, sections retract, and components align in sequence", secondaryMotion: "dust and light respond to each mechanical step", materialEffect: "metal, acrylic, shadow, and controlled atmosphere", pacing: "escalating mechanical rhythm", openingDevice: "open on an active structure before the product is recognizable", transitionLanguage: "each mechanical cause visibly produces the next form", endingDevice: "final seams close into a stable product hold", audioCharacter: "detailed mechanical foley with cinematic music" }),
      defineDirection("liquid-to-form", { creativeArchetype: "Liquid to Form", visualHook: "a flowing liquid path gathers into a stable product-bearing form", environment: "dark reflective basin under a warm horizon", composition: "fluid path enters from depth and converges at the hero", cameraPath: "low tracking move following the flow into the final form", framing: "wide fluid landscape to close product silhouette", lightingStyle: "low warm rim with cool reflective fill", primaryMotion: "the fluid stream divides, gathers, and leaves a stable final form", secondaryMotion: "ripples transmit the change through the basin", materialEffect: "reflective liquid, glass, and soft vapor", pacing: "smooth build with a clear convergence", openingDevice: "start inside the moving fluid with scale unresolved", transitionLanguage: "the flow narrows until the product becomes legible", endingDevice: "fluid calms around the product", audioCharacter: "liquid movement, low swell, and a clean final tone" }),
      defineDirection("architectural-collapse", { creativeArchetype: "Architectural Collapse", visualHook: "a clean architectural volume compresses in visible stages and reveals the hero", environment: "bright geometric building interior with a deep horizon", composition: "symmetrical architectural axis opening into a product space", cameraPath: "steady central push with a precise final lock", framing: "large architectural wide to medium hero", lightingStyle: "graphic daylight with moving structural shadows", primaryMotion: "floors compress, columns retract, and facades fold inward", secondaryMotion: "light bands shift as the volume changes", materialEffect: "concrete, glass, acrylic, and dust motes", pacing: "monumental then precise", openingDevice: "open on the complete structure before collapse begins", transitionLanguage: "each compression step exposes another layer of the product destination", endingDevice: "architecture settles behind the exact product", audioCharacter: "deep structural impacts with controlled cinematic score" }),
      defineDirection("material-weave", { creativeArchetype: "Material Weave", visualHook: "threads, film, and light weave together until the product is the only stable anchor", environment: "abstract fiber chamber with a cream-to-orange gradient", composition: "central anchor inside converging material diagonals", cameraPath: "floating orbit through the weaving materials", framing: "medium-wide material world to close hero", lightingStyle: "backlit fibers with a soft warm key", primaryMotion: "threads cross, knot, and separate into an open frame", secondaryMotion: "light particles follow the weave direction", materialEffect: "fiber, translucent film, and atmospheric glow", pacing: "rhythmic transformation", openingDevice: "start on a single thread crossing the lens", transitionLanguage: "the weave opens progressively around the product", endingDevice: "woven frame settles without covering the package", audioCharacter: "textural thread sounds with a rising tonal bed" })
    ]
  },
  "Educational": {
    contentFamily: "Educational",
    description: "Text-free visual skincare explanations using skin, hydration, barrier, cleansing, pigmentation, and ingredient-action metaphors that work without labels.",
    directions: [
      defineDirection("skin-brightening", { creativeArchetype: "Visual Brightening", visualHook: "a macro skin surface gradually changes from dull uneven light to a fresh even glow", environment: "clean abstract skin macro world with no interface or text", composition: "one continuous skin surface fills the frame", cameraPath: "slow parallel macro glide", framing: "extreme skin-surface close-up", lightingStyle: "soft neutral light becoming gently brighter", primaryMotion: "light and surface appearance improve gradually without a written comparison", secondaryMotion: "tiny natural highlights become more even", materialEffect: "realistic skin texture and soft moisture sheen", pacing: "clear visual cause and effect", openingDevice: "begin on the dull-looking surface", transitionLanguage: "the visible change travels continuously across the surface", endingDevice: "calm brighter-looking skin hold", audioCharacter: "clean gentle tonal lift" }),
      defineDirection("hydration-entry", { creativeArchetype: "Hydration Journey", visualHook: "clear moisture droplets enter a dry-looking stylized skin surface and visibly soften it", environment: "simplified translucent skin-layer world without labels", composition: "one clear moisture path through readable layers", cameraPath: "smooth microscopic tracking move", framing: "macro cross-section view", lightingStyle: "clean soft light with watery highlights", primaryMotion: "droplets absorb and spread through the dry-looking layer", secondaryMotion: "the surface becomes smoother and more supple", materialEffect: "clear water, translucent skin layers, and soft cellular forms", pacing: "simple stepwise visual explanation", openingDevice: "open on one droplet above the dry surface", transitionLanguage: "droplet movement motivates travel into the layer", endingDevice: "balanced hydrated-looking layer state", audioCharacter: "delicate water texture and soft pulse" }),
      defineDirection("barrier-metaphor", { creativeArchetype: "Moisture Barrier Metaphor", visualHook: "loose translucent skin-like tiles organize into a calm continuous protective surface", environment: "minimal biological macro space with no symbols or wording", composition: "layered surface viewed at a clear shallow angle", cameraPath: "gentle push along the surface", framing: "macro layer detail", lightingStyle: "clean diffuse scientific light", primaryMotion: "gaps close as the visual barrier becomes orderly and continuous", secondaryMotion: "moisture remains visibly contained beneath the surface", materialEffect: "soft translucent biological tiles and clear moisture", pacing: "measured and understandable", openingDevice: "begin on the visibly uneven barrier", transitionLanguage: "each physical alignment supports the next", endingDevice: "intact calm surface hold", audioCharacter: "soft assembling textures" }),
      defineDirection("cleansing-pores", { creativeArchetype: "Visual Cleansing", visualHook: "water and soft cleansing foam lift visible oil-like debris from a simplified pore surface", environment: "clean stylized skin macro environment without diagrams or labels", composition: "one pore region remains the visual focus", cameraPath: "controlled macro push-in", framing: "close skin-surface cutaway", lightingStyle: "bright clinical-soft illumination", primaryMotion: "foam surrounds and carries debris away with water", secondaryMotion: "the surface settles cleanly without becoming artificial", materialEffect: "soft foam, clear water, realistic skin texture", pacing: "direct cleansing progression", openingDevice: "open on the visible debris at the pore surface", transitionLanguage: "the foam movement explains the action visually", endingDevice: "clean calm surface hold", audioCharacter: "light foam and water foley" }),
      defineDirection("pigmentation-concept", { creativeArchetype: "Dark-Spot Visual Concept", visualHook: "clustered dark pigment-like particles within a stylized skin layer gradually disperse into a more even pattern", environment: "abstract skin-layer macro with no medical labels", composition: "particle cluster and surrounding layer share a simple frame", cameraPath: "slow lateral macro track", framing: "cross-section detail", lightingStyle: "neutral clean light with warm skin tones", primaryMotion: "the dense cluster separates and redistributes visually", secondaryMotion: "the surface illumination becomes more even", materialEffect: "translucent layers and soft pigment-like particles", pacing: "clear restrained progression", openingDevice: "begin on the concentrated particle cluster", transitionLanguage: "particle dispersion carries the explanation", endingDevice: "more even-looking visual state", audioCharacter: "subtle particle shimmer" }),
      defineDirection("antioxidant-metaphor", { creativeArchetype: "Antioxidant Visual Metaphor", visualHook: "bright active-inspired particles calmly intercept harsh reactive particles before they reach a skin-like surface", environment: "clean microscopic beauty-science space without formulas or writing", composition: "two particle paths make the interaction immediately visible", cameraPath: "smooth tracking alongside the particles", framing: "macro particle interaction", lightingStyle: "luminous white with restrained citrus accents", primaryMotion: "active-inspired particles meet and neutralize the incoming visual disturbance", secondaryMotion: "the skin-like surface remains calm", materialEffect: "translucent particles, soft light, and a simplified skin surface", pacing: "legible visual metaphor", openingDevice: "start on the approaching reactive particles", transitionLanguage: "the collision resolves into calm light", endingDevice: "undisturbed surface hold", audioCharacter: "clean microscopic pulse" }),
      defineDirection("ingredient-action", { creativeArchetype: "Ingredient Action Visualization", visualHook: "translucent active-inspired particles travel toward and interact with a simplified skin surface", environment: "minimal beauty-science macro world with no text or interface", composition: "one clear particle pathway leads into the skin surface", cameraPath: "gentle microscopic follow move", framing: "particle macro into skin-layer detail", lightingStyle: "clean high-key light with warm citrus accents", primaryMotion: "particles approach, diffuse, and settle through visible physical stages", secondaryMotion: "soft moisture highlights respond at the surface", materialEffect: "clear particles, water, and translucent biological layers", pacing: "simple visual explanation", openingDevice: "open close on one particle", transitionLanguage: "particle movement reveals the surrounding skin context", endingDevice: "calm balanced skin-layer state", audioCharacter: "soft scientific shimmer without narration" })
    ]
  },
  "Ingredient / Texture": {
    contentFamily: "Ingredient / Texture",
    description: "Skincare-specific product textures, dispensing actions, and ingredient-inspired macro visuals; product presence is optional and generic luxury advertising is excluded.",
    directions: [
      defineDirection("serum-droplet", { creativeArchetype: "Serum Droplet Macro", visualHook: "one translucent skincare serum droplet gathers at a dropper tip and releases cleanly", environment: "bright clean skincare macro setup", composition: "dropper tip and serum bead fill the frame", cameraPath: "static macro with a precise focus pull", framing: "extreme droplet close-up", lightingStyle: "soft high-key beauty light", primaryMotion: "the serum bead forms, elongates, and drops onto clean skin or glass", secondaryMotion: "a small glossy highlight moves through the droplet", materialEffect: "clear colorless lightweight serum with realistic viscosity", pacing: "slow tactile dispensing detail", openingDevice: "begin on the forming bead", transitionLanguage: "the release leads naturally to the receiving surface", endingDevice: "droplet settles and begins to spread", audioCharacter: "tiny liquid release and soft clean ambience" }),
      defineDirection("serum-spread", { creativeArchetype: "Lightweight Serum Spread", visualHook: "a translucent serum bead spreads smoothly across clean skin in macro view", environment: "minimal skincare application close-up", composition: "skin texture and the clear serum remain the only visual subjects", cameraPath: "small parallel macro slide", framing: "extreme skin-and-serum detail", lightingStyle: "soft diffuse light with a clean moisture highlight", primaryMotion: "one fingertip gently spreads the serum into a thin glossy layer", secondaryMotion: "the wet edge thins and absorbs naturally", materialEffect: "clear lightweight serum and realistic skin texture", pacing: "gentle application progression", openingDevice: "open on the intact serum bead", transitionLanguage: "the fingertip movement creates a continuous spread", endingDevice: "fresh hydrated-looking skin detail", audioCharacter: "soft tactile application foley" }),
      defineDirection("cream-ribbon", { creativeArchetype: "Cream Ribbon Macro", visualHook: "a small skincare cream ribbon is dispensed onto a clean surface", environment: "bright neutral beauty macro setup", composition: "the ribbon texture fills the frame with optional package context at the edge", cameraPath: "locked macro tripod", framing: "extreme texture detail", lightingStyle: "broad soft light that reveals cream body and gloss", primaryMotion: "the cream extrudes in one smooth controlled ribbon", secondaryMotion: "the ribbon settles under its own weight", materialEffect: "silky dense skincare cream, never food or frosting", pacing: "clear tactile dispense", openingDevice: "begin at the nozzle or receiving surface", transitionLanguage: "the extrusion itself carries the shot", endingDevice: "clean cream ribbon hold", audioCharacter: "subtle dispense texture" }),
      defineDirection("foam-lather", { creativeArchetype: "Cleanser Foam Macro", visualHook: "dense soft skincare foam builds between wet hands in close macro detail", environment: "clean sink-side skincare context", composition: "foam and natural hand movement dominate the frame", cameraPath: "controlled handheld macro close-up", framing: "tight foam and lather detail", lightingStyle: "fresh bathroom daylight", primaryMotion: "cleanser and water work into a fine dense lather", secondaryMotion: "small bubbles expand and settle realistically", materialEffect: "soft cleansing foam, clear water, and natural skin", pacing: "practical texture demonstration", openingDevice: "open on the creamy cleanser meeting water", transitionLanguage: "rubbing action visibly builds the foam", endingDevice: "dense soft lather hold", audioCharacter: "gentle water and foam foley" }),
      defineDirection("fine-mist", { creativeArchetype: "Fine Hydration Mist", visualHook: "a fine skincare mist blooms across skin and resolves into tiny clear droplets", environment: "clean bright beauty close-up", composition: "mist plume crosses a simple skin background", cameraPath: "static high-speed-style close-up", framing: "macro mist and droplet detail", lightingStyle: "soft backlight that makes the mist visible without flare", primaryMotion: "one controlled mist spray travels and lands on skin", secondaryMotion: "microdroplets settle naturally", materialEffect: "clear watery skincare mist and realistic skin", pacing: "fresh single-action insert", openingDevice: "begin just before the mist enters frame", transitionLanguage: "the plume connects the spray to the droplets", endingDevice: "tiny hydration droplets resting on skin", audioCharacter: "soft spray and airy room tone" }),
      defineDirection("essence-fabric", { creativeArchetype: "Sheet Mask Essence Macro", visualHook: "clear essence beads across hydrated sheet-mask fabric in extreme close-up", environment: "clean cooling skincare macro setup", composition: "wet fabric fibers and essence droplets fill the frame", cameraPath: "slow shallow macro slide", framing: "extreme fabric and essence detail", lightingStyle: "cool soft beauty light", primaryMotion: "one essence droplet travels along the soaked fabric fibers", secondaryMotion: "the fabric shifts subtly with moisture", materialEffect: "hydrated cosmetic sheet fabric and clear watery essence", pacing: "calm tactile detail", openingDevice: "open on the soaked fiber pattern", transitionLanguage: "the droplet path reveals the material structure", endingDevice: "fresh saturated fabric hold", audioCharacter: "soft water texture" }),
      defineDirection("citrus-ingredient", { creativeArchetype: "Vitamin-C-Inspired Citrus Macro", visualHook: "fresh citrus peel and translucent bright citrus liquid create a clean vitamin-C-inspired skincare visual", environment: "bright laboratory-clean macro surface", composition: "citrus texture, liquid, and glass remain sparse and beauty-oriented", cameraPath: "small controlled macro slide", framing: "ingredient extreme close-up", lightingStyle: "clean daylight with restrained orange warmth", primaryMotion: "a clear bright droplet moves from citrus peel toward a glass skincare sample dish", secondaryMotion: "tiny natural liquid highlights shift", materialEffect: "fresh citrus peel, clear bright liquid, and laboratory glass", pacing: "clean ingredient study, not a beverage or food advertisement", openingDevice: "open on the citrus peel texture", transitionLanguage: "the droplet path connects botanical source to skincare context", endingDevice: "droplet resting in a clean sample dish", audioCharacter: "fresh liquid detail and subtle laboratory ambience" }),
      defineDirection("active-particles", { creativeArchetype: "Active Ingredient Particle Macro", visualHook: "translucent skincare active-inspired particles move through clear hydration droplets", environment: "minimal clean laboratory-style beauty macro world", composition: "particles and water form one simple interaction with no formulas or labels", cameraPath: "gentle microscopic follow move", framing: "extreme particle-and-droplet close-up", lightingStyle: "high-key translucent illumination with restrained citrus accents", primaryMotion: "particles enter, diffuse through, and settle inside the hydration field", secondaryMotion: "small water ripples respond physically", materialEffect: "translucent active-inspired particles, clear water, and clean glass", pacing: "legible skincare ingredient visualization", openingDevice: "begin on one particle entering a droplet", transitionLanguage: "diffusion reveals the surrounding hydration field", endingDevice: "calm evenly dispersed particles", audioCharacter: "clean microscopic shimmer" })
    ]
  },
  "Custom": {
    contentFamily: "Custom",
    description: "A flexible but still art-directed grammar used when the user supplies a specific creative world.",
    directions: [
      defineDirection("user-led-tableau", { creativeArchetype: "User-Led Tableau", visualHook: "the requested world builds one deliberate visual frame around the product", environment: "user-specified environment interpreted as an art-directed set", composition: "composition follows the strongest user-specified spatial cue", cameraPath: "camera path follows the user request with restrained continuity", framing: "framing chosen to preserve the requested subject relationship", lightingStyle: "lighting motivated by the requested world", primaryMotion: "the user-specified action develops in observable steps", secondaryMotion: "supporting environmental motion stays subordinate", materialEffect: "environmental materials only; product truth remains locked", pacing: "balanced unless the user requests another pace", openingDevice: "open on the user-specified establishing cue", transitionLanguage: "continuous transition motivated by the requested action", endingDevice: "requested final state with a readable product", audioCharacter: "audio follows the requested tone and remains secondary to the visual idea" }),
      defineDirection("user-led-portrait", { creativeArchetype: "User-Led Portrait", visualHook: "one strong user-specified visual cue turns the product into a distinct portrait", environment: "user-specified portrait environment", composition: "deliberate portrait composition with clear product priority", cameraPath: "single motivated portrait move", framing: "portrait framing selected from the user cue", lightingStyle: "portrait light shaped by the specified atmosphere", primaryMotion: "one central action carries the portrait", secondaryMotion: "minimal environmental motion supports the action", materialEffect: "set materials follow the user world, never package identity", pacing: "measured portrait timing", openingDevice: "strong portrait opening image", transitionLanguage: "visual cue evolves into the product read", endingDevice: "distinct final portrait hold", audioCharacter: "sparse sound character shaped by the user idea" }),
      defineDirection("user-led-world-build", { creativeArchetype: "User-Led World Build", visualHook: "the specified world assembles around a stable product anchor through visible cause and effect", environment: "user-specified world with a clear spatial anchor", composition: "layered environment that keeps the product geography legible", cameraPath: "continuous tracking through the world build", framing: "wide world context to stable hero", lightingStyle: "motivated world light with a product-safe key", primaryMotion: "environmental structures or materials assemble in sequence", secondaryMotion: "small effects echo the main build", materialEffect: "world-building materials remain separate from the package", pacing: "progressive build and settle", openingDevice: "open on the world before the product action begins", transitionLanguage: "the world build naturally reveals the hero", endingDevice: "finished world with an unchanged product hold", audioCharacter: "world-specific texture with a clean final resolve" })
    ]
  }
};
function getCreativeFamilyGrammar(contentFamily) {
  return familyGrammars[contentFamily] ?? familyGrammars["Cinematic Product Ad"];
}
function normalizeText(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function normalizeSeed(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) return Math.trunc(seed) >>> 0;
  if (typeof seed === "string" && seed.trim()) return hashString(seed.trim());
  return DEFAULT_CREATIVE_SEED;
}
function resolveCreativeProduct(product) {
  if (typeof product !== "string") return product;
  const resolved = getProduct(product);
  if (!resolved) throw new Error(`Unknown product '${product}' supplied to the Creative Diversity Engine.`);
  return resolved;
}
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = state + 1831565813 >>> 0;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
function stableSignature(genome) {
  const normalized = normalizedGenomeValues(genome);
  const source = [normalizeText(genome.contentFamily), ...majorCreativeDimensions.map((axis) => normalized[axis]), normalized.audioCharacter].join("|");
  return `creative-v${CREATIVE_DIVERSITY_SCHEMA_VERSION}-${hashString(source).toString(16).padStart(8, "0")}`;
}
function buildCreativeFingerprint(genome) {
  return {
    ...genome,
    signature: stableSignature(genome),
    majorDimensions: [...majorCreativeDimensions]
  };
}
function compareCreativeFingerprints(a, b) {
  const normalizedA = normalizedGenomeValues(a);
  const normalizedB = normalizedGenomeValues(b);
  const differentAxes = Object.keys(creativeGenomeAxisWeights).filter((axis) => normalizedA[axis] !== normalizedB[axis]);
  const totalWeight = Object.values(creativeGenomeAxisWeights).reduce((sum, weight) => sum + weight, 0);
  const sameWeight = Object.keys(creativeGenomeAxisWeights).filter((axis) => normalizedA[axis] === normalizedB[axis]).reduce((sum, axis) => sum + creativeGenomeAxisWeights[axis], 0);
  const majorDifferences = differentAxes.filter((axis) => majorCreativeDimensions.includes(axis));
  return {
    similarity: Number((sameWeight / totalWeight).toFixed(4)),
    differentAxes,
    meaningfulDifferenceCount: majorDifferences.length,
    visualHookChanged: differentAxes.includes("visualHook"),
    creativeArchetypeChanged: differentAxes.includes("creativeArchetype")
  };
}
function isNearDuplicate(candidate, previous, options = {}) {
  const comparison = compareCreativeFingerprints(candidate, previous);
  if ("signature" in candidate && "signature" in previous && candidate.signature === previous.signature) return true;
  const overridden = new Set(options.overriddenAxes ?? []);
  const availableMajorAxes = majorCreativeDimensions.filter((axis) => !overridden.has(axis));
  const effectiveDifferenceCount = comparison.differentAxes.filter((axis) => majorCreativeDimensions.includes(axis) && !overridden.has(axis)).length;
  const minimumDifferences = Math.min(options.minimumMeaningfulDifferences ?? 4, availableMajorAxes.length);
  const availableHookOrArchetype = !overridden.has("visualHook") || !overridden.has("creativeArchetype");
  const hookOrArchetypeChanged = !overridden.has("visualHook") && comparison.visualHookChanged || !overridden.has("creativeArchetype") && comparison.creativeArchetypeChanged;
  if (comparison.similarity >= (options.nearDuplicateSimilarity ?? 0.82)) return true;
  if (effectiveDifferenceCount < minimumDifferences) return true;
  if (availableHookOrArchetype && !hookOrArchetypeChanged) return true;
  return false;
}
function normalizeContentFamily(value) {
  return [...h3ContentTypes, ...legacyH3ContentTypes].includes(value) ? value : "Product";
}
function resolveCreativeFamilyForH3VideoType(value) {
  if (value === void 0 || value === null || value.trim() === "") return "Product";
  if (![...h3ContentTypes, ...legacyH3ContentTypes].includes(value)) {
    throw new Error(`Unsupported H3 video type '${value}' supplied to Creative Diversity.`);
  }
  return value;
}
function creativeHistoryRecord(record) {
  const genome = record.creativeGenome ?? record.brief.creativeGenome ?? null;
  if (!genome) return null;
  return {
    id: record.generationJobId ?? `h3-record-${record.id}`,
    product: record.product,
    contentFamily: normalizeContentFamily(record.contentType ?? record.brief.contentType),
    genome,
    fingerprint: record.creativeFingerprint ?? buildCreativeFingerprint(genome),
    conceptSummary: record.conceptSummary ?? record.brief.videoIdea ?? null,
    createdAt: record.createdAt,
    generationJobId: record.generationJobId,
    generationStatus: record.generationStatus
  };
}
function toCreativeHistoryEntries(records) {
  return records.map(creativeHistoryRecord).filter((record) => record !== null);
}
function asCreativeHistoryEntries(history) {
  if (!history?.length) return [];
  if ("genome" in history[0]) return history;
  return toCreativeHistoryEntries(history);
}
function matchPhrase(text, pattern) {
  const match = text.match(pattern);
  return match?.[0]?.trim() || null;
}
function extractCreativeOverrides(userIdea = "", specialInstructions = "") {
  const text = `${userIdea} ${specialInstructions}`.trim();
  const axes = {};
  const sourcePhrases = [];
  const conflicts = [];
  const setAxis = (axis, value, source) => {
    if (!value.trim() || axes[axis]) return;
    axes[axis] = value.trim();
    if (source?.trim()) sourcePhrases.push(source.trim());
  };
  const labeledHook = text.match(/(?:visual\s+hook|primary\s+hook|hook)\s*[:=-]\s*([^.;\n]+)/i);
  if (labeledHook?.[1]) setAxis("visualHook", labeledHook[1], labeledHook[0]);
  const labeledArchetype = text.match(/(?:creative\s+archetype|archetype)\s*[:=-]\s*([^.;\n]+)/i);
  if (labeledArchetype?.[1]) setAxis("creativeArchetype", labeledArchetype[1], labeledArchetype[0]);
  const environmentPatterns = [
    /\b(?:an?\s+)?orange\s+(?:laboratory|lab)\b/i,
    /\b(?:an?\s+)?(?:white|black|clean|clinical|futuristic)\s+(?:laboratory|lab)\b/i,
    /\b(?:in|inside|within)\s+(?:an?\s+)?[a-z-]+\s+(?:laboratory|lab|bathroom|bedroom|vanity|greenhouse|studio|gallery|kitchen)\b/i,
    /\b(?:bathroom|bedroom|vanity|laboratory|lab|greenhouse|gallery|kitchen|desert|forest|black studio|white studio)\b/i
  ];
  for (const pattern of environmentPatterns) {
    const phrase = matchPhrase(text, pattern);
    if (phrase) {
      const cleaned = phrase.replace(/^(?:in|inside|within)\s+/i, "").replace(/^(?:an?|the)\s+/i, "");
      setAxis("environment", cleaned, phrase);
      break;
    }
  }
  const normalizeCameraLock = (value) => {
    const normalized = value.trim().toLowerCase();
    if (/\b(?:static|locked[- ]off|fixed)\b/.test(normalized)) return "locked-off static camera";
    if (/\b(?:orbit|orbital|circular)\b/.test(normalized)) return "controlled orbital camera";
    if (/\boverhead|top[- ]?down\b/.test(normalized)) return "overhead top-down camera";
    if (/\bhandheld\b/.test(normalized)) return "natural handheld camera";
    if (/\b(?:lateral|sideways)\b/.test(normalized)) return "controlled lateral tracking camera";
    if (/\b(?:macro|extreme close[- ]?up)\b/.test(normalized)) return "macro close camera";
    return value.trim();
  };
  const explicitCameraLocks = [...text.matchAll(/\bcamera(?:\s+path)?\s*(?::|=|\bis\b|\blocked\s+to\b)\s*([^.;,\n]+?)(?=\s+(?:(?:and|then|also)\s+)?(?:separately\s+)?camera(?:\s+path)?\s*(?::|=|\bis\b|\blocked\s+to\b)|$)/gi)].map((match) => ({ value: normalizeCameraLock(match[1]), source: match[0].trim() })).filter((lock2) => lock2.value.length > 0);
  if (explicitCameraLocks.length > 0) {
    setAxis("cameraPath", explicitCameraLocks[0].value, explicitCameraLocks[0].source);
    const values = [...new Set(explicitCameraLocks.map((lock2) => normalizeText(lock2.value)))];
    if (values.length > 1) {
      conflicts.push({
        axis: "cameraPath",
        values: explicitCameraLocks.map((lock2) => lock2.value),
        sourcePhrases: explicitCameraLocks.map((lock2) => lock2.source)
      });
    }
  }
  const cameraPatterns = [
    [/\boverhead\s+(?:camera|view|shot|angle)\b|\btop[- ]?down\s+(?:camera|view|shot|angle)?\b/i, "overhead top-down camera"],
    [/\b(?:locked[- ]off|static)\s+camera\b/i, "locked-off static camera"],
    [/\bhandheld\s+(?:camera|framing|shot)\b/i, "natural handheld camera"],
    [/\b(?:macro|extreme close[- ]up)\s+(?:camera|shot|view|framing)\b/i, "macro close camera"],
    [/\b(?:lateral|sideways)\s+(?:tracking|track|slider)\b/i, "controlled lateral tracking camera"],
    [/\b(?:orbit|orbital)\s+camera\b/i, "controlled orbital camera"]
  ];
  for (const [pattern, value] of cameraPatterns) {
    const phrase = matchPhrase(text, pattern);
    if (phrase) {
      setAxis("cameraPath", value, phrase);
      break;
    }
  }
  const compositionPatterns = [
    [/\b(?:extreme\s+)?macro\s+(?:composition|framing|shot|close[- ]?up)\b/i, "extreme macro composition"],
    [/\b(?:wide|wide[- ]angle)\s+(?:composition|shot|framing|view)\b/i, "wide environmental composition"],
    [/\boff[- ]center|asymmetric\s+(?:composition|framing)?\b/i, "asymmetric off-center composition"],
    [/\bcentered\s+(?:composition|framing|hero|product)\b/i, "centered hero composition"]
  ];
  for (const [pattern, value] of compositionPatterns) {
    const phrase = matchPhrase(text, pattern);
    if (phrase) {
      setAxis("composition", value, phrase);
      break;
    }
  }
  const lightingPatterns = [
    [/\bhard\s+(?:graphic\s+)?shadows?\b/i, "hard graphic shadow lighting"],
    [/\bsoft\s+(?:diffused|diffuse)\s+light(?:ing)?\b/i, "soft diffused lighting"],
    [/\b(?:warm|golden)\s+(?:studio\s+)?light(?:ing)?\b/i, "warm studio lighting"],
    [/\b(?:cool|clinical)\s+(?:studio\s+)?light(?:ing)?\b/i, "cool clean lighting"],
    [/\bneon\s+light(?:ing)?\b/i, "neon graphic lighting"]
  ];
  for (const [pattern, value] of lightingPatterns) {
    const phrase = matchPhrase(text, pattern);
    if (phrase) {
      setAxis("lightingStyle", value, phrase);
      break;
    }
  }
  const pacing = matchPhrase(text, /\b(?:very\s+)?(?:slow|fast|rapid|quick|balanced)\s+(?:paced|pace|rhythm|tempo)\b/i);
  if (pacing) setAxis("pacing", pacing.toLowerCase().includes("fast") || pacing.toLowerCase().includes("rapid") || pacing.toLowerCase().includes("quick") ? "fast" : pacing.toLowerCase().includes("slow") ? "slow" : "balanced", pacing);
  const motion = matchPhrase(text, /\b(?:slow\s+push[- ]?in|straight\s+push[- ]?in|lateral\s+track(?:ing)?|controlled\s+orbit|vertical\s+water[- ]column|foam\s+crescent|moving\s+geometric\s+shadow(?:s)?|focus\s+pull)\b/i);
  if (motion) setAxis("primaryMotion", motion, motion);
  return { axes, fields: Object.keys(axes), sourcePhrases, conflicts };
}
function materializeGenome(contentFamily, direction, variantIndex) {
  const variant = variantIndex > 0 ? direction.variants?.[variantIndex - 1] ?? {} : {};
  const { id: _id, variants: _variants, ...base } = direction;
  void _id;
  void _variants;
  return {
    schemaVersion: CREATIVE_DIVERSITY_SCHEMA_VERSION,
    contentFamily,
    ...base,
    ...variant
  };
}
function candidateGenomes(grammar) {
  const candidates = [];
  for (const direction of grammar.directions) {
    candidates.push(materializeGenome(grammar.contentFamily, direction, 0));
    for (let variantIndex = 1; variantIndex <= (direction.variants?.length ?? 0); variantIndex += 1) {
      candidates.push(materializeGenome(grammar.contentFamily, direction, variantIndex));
    }
  }
  return candidates;
}
function applyOverrides(genome, overrides) {
  const next = { ...genome };
  for (const [axis, value] of Object.entries(overrides.axes)) {
    if (value?.trim()) next[axis] = value.trim();
  }
  return next;
}
function activeHistory(history) {
  return history.filter((entry) => entry.generationStatus !== "rejected" && entry.generationStatus !== "archived");
}
function daysSince(createdAt, now3) {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, (now3.getTime() - timestamp) / 864e5);
}
function historyAgeFactor(entry, index, now3, options) {
  const generationFactor = Math.pow(options.generationDecay, index);
  const dayFactor = Math.pow(options.dayDecay, daysSince(entry.createdAt, now3));
  return generationFactor * dayFactor;
}
function sameProductFamilyHistory(product, contentFamily, history, options) {
  return activeHistory(history).filter((entry) => entry.product === product && entry.contentFamily === contentFamily).slice(0, options.sameProductFamilyWindow);
}
function selectedValuePenaltySources(genome, product, contentFamily, history, overrides, now3, options) {
  const relevant = sameProductFamilyHistory(product, contentFamily, history, options);
  const sources = [];
  const overridden = new Set(overrides.fields);
  const relevantValues = /* @__PURE__ */ new Map();
  for (const [index, entry] of relevant.entries()) {
    for (const axis of Object.keys(creativeGenomeAxisWeights)) {
      const key = `${axis}\0${normalizedAxisValue(entry.fingerprint ?? entry.genome, axis)}`;
      const matches = relevantValues.get(key) ?? [];
      matches.push({ entry, index });
      relevantValues.set(key, matches);
    }
  }
  for (const axis of Object.keys(creativeGenomeAxisWeights)) {
    if (overridden.has(axis)) continue;
    const value = genome[axis];
    const matches = relevantValues.get(`${axis}\0${normalizedAxisValue(genome, axis)}`) ?? [];
    if (!matches.length) continue;
    const weighted = matches.reduce((sum, item) => sum + historyAgeFactor(item.entry, item.index, now3, options), 0);
    const penalty = Number((weighted * creativeGenomeAxisWeights[axis] * 5).toFixed(2));
    sources.push({
      axis,
      value,
      occurrences: matches.length,
      penalty,
      recentGenerationIds: matches.slice(0, 5).map(({ entry }) => entry.generationJobId ?? entry.id)
    });
  }
  return sources.sort((a, b) => b.penalty - a.penalty || a.axis.localeCompare(b.axis));
}
function noveltyScoreFor(genome, product, contentFamily, history, now3, options) {
  const usable = activeHistory(history);
  if (!usable.length) return 100;
  const sameFamily = usable.filter((entry) => entry.product === product && entry.contentFamily === contentFamily).slice(0, options.sameProductFamilyWindow);
  const sameProduct = usable.filter((entry) => entry.product === product).slice(0, options.sameProductWindow);
  const comparisonSet = sameFamily.length ? sameFamily : sameProduct.length ? sameProduct : usable.slice(0, options.globalWindow);
  if (!comparisonSet.length) return 100;
  const weightedSimilarities = comparisonSet.map((entry, index) => {
    const comparison = compareCreativeFingerprints(genome, entry.fingerprint ?? entry.genome);
    const scopeWeight = sameFamily.includes(entry) ? 1 : sameProduct.includes(entry) ? 0.55 : 0.2;
    return comparison.similarity * scopeWeight * historyAgeFactor(entry, index, now3, options);
  });
  const strongest = Math.max(...weightedSimilarities, 0);
  return Math.round(Math.max(0, Math.min(100, (1 - strongest) * 100)));
}
function summarizeConcept(product, genome) {
  return `${product.shortName}: ${genome.visualHook}. ${genome.primaryMotion}; ${genome.cameraPath}; finish with ${genome.endingDevice}.`;
}
function rejectionFor(candidate, entry, options, overrides) {
  const comparison = compareCreativeFingerprints(candidate.fingerprint, entry.fingerprint ?? entry.genome);
  if (!isNearDuplicate(candidate.fingerprint, entry.fingerprint ?? entry.genome, {
    minimumMeaningfulDifferences: options.minimumMeaningfulDifferences,
    nearDuplicateSimilarity: options.nearDuplicateSimilarity,
    overriddenAxes: overrides.fields
  })) return null;
  const reason = candidate.fingerprint.signature === (entry.fingerprint ?? buildCreativeFingerprint(entry.genome)).signature ? "exact fingerprint duplicate" : comparison.meaningfulDifferenceCount < options.minimumMeaningfulDifferences ? `only ${comparison.meaningfulDifferenceCount} meaningful dimensions changed` : !comparison.visualHookChanged && !comparison.creativeArchetypeChanged ? "visual hook and creative archetype both repeated" : `weighted similarity ${Math.round(comparison.similarity * 100)}% exceeds the near-duplicate threshold`;
  return {
    candidateSignature: candidate.fingerprint.signature,
    creativeArchetype: candidate.genome.creativeArchetype,
    visualHook: candidate.genome.visualHook,
    reason,
    againstGenerationId: entry.generationJobId ?? entry.id,
    similarity: comparison.similarity,
    meaningfulDifferenceCount: comparison.meaningfulDifferenceCount
  };
}
function candidateHistoryStats(candidate, history) {
  const matches = history.filter((entry) => (entry.fingerprint ?? buildCreativeFingerprint(entry.genome)).signature === candidate.fingerprint.signature);
  if (!matches.length) return { lastUsedAt: null, historicalUsageCount: 0 };
  const timestamps = matches.map((entry) => Date.parse(entry.createdAt)).filter((timestamp) => Number.isFinite(timestamp));
  return {
    lastUsedAt: timestamps.length ? Math.max(...timestamps) : 0,
    historicalUsageCount: matches.length
  };
}
function compareFallbackCandidates(a, b) {
  if (a.noveltyScore !== b.noveltyScore) return b.noveltyScore - a.noveltyScore;
  const aLastUsedAt = a.lastUsedAt ?? Number.NEGATIVE_INFINITY;
  const bLastUsedAt = b.lastUsedAt ?? Number.NEGATIVE_INFINITY;
  if (aLastUsedAt !== bLastUsedAt) return aLastUsedAt - bLastUsedAt;
  if (a.historicalUsageCount !== b.historicalUsageCount) return a.historicalUsageCount - b.historicalUsageCount;
  if (a.randomRank !== b.randomRank) return b.randomRank - a.randomRank;
  return a.fingerprint.signature.localeCompare(b.fingerprint.signature);
}
var benefitArchetypesByProduct = {
  cleanser: ["Human Before and After", "Skin Macro Result", "Comfort Result"],
  toner: ["Human Before and After", "Skin Macro Result", "Hydration Result", "Radiance Result", "Comfort Result"],
  serum: ["Human Before and After", "Skin Macro Result", "Radiance Result"],
  "eye-cream": ["Human Before and After", "Skin Macro Result", "Comfort Result"],
  "skin-cream": ["Human Before and After", "Skin Macro Result", "Hydration Result", "Comfort Result", "Barrier Support Metaphor"],
  mask: ["Human Before and After", "Skin Macro Result", "Hydration Result", "Comfort Result"],
  "full-series": ["Human Before and After", "Skin Macro Result"]
};
var ingredientArchetypesByProduct = {
  cleanser: ["Ingredient Macro", "Foam Formulation", "Active Particle Interaction", "Skin Layer Visualization", "Clean Lab Aesthetic", "Antioxidant Particle Metaphor"],
  toner: ["Ingredient Macro", "Mist Formulation", "Active Particle Interaction", "Skin Layer Visualization", "Clean Lab Aesthetic", "Antioxidant Particle Metaphor"],
  serum: ["Ingredient Macro", "Active Particle Interaction", "Skin Layer Visualization", "Clean Lab Aesthetic", "Antioxidant Particle Metaphor"],
  "eye-cream": ["Ingredient Macro", "Cream Formulation", "Active Particle Interaction", "Skin Layer Visualization", "Clean Lab Aesthetic", "Antioxidant Particle Metaphor"],
  "skin-cream": ["Ingredient Macro", "Cream Formulation", "Active Particle Interaction", "Skin Layer Visualization", "Clean Lab Aesthetic", "Antioxidant Particle Metaphor"],
  mask: ["Ingredient Macro", "Active Particle Interaction", "Skin Layer Visualization", "Clean Lab Aesthetic"],
  "full-series": ["Ingredient Macro", "Active Particle Interaction", "Skin Layer Visualization", "Clean Lab Aesthetic"]
};
function isProductContentCompatible(genome, product) {
  if (genome.contentFamily === "Benefits") return benefitArchetypesByProduct[product.id].includes(genome.creativeArchetype);
  if (genome.contentFamily === "Ingredients") return ingredientArchetypesByProduct[product.id].includes(genome.creativeArchetype);
  return true;
}
function isHardCompatible(genome, product, contentFamily, overrides) {
  if (genome.contentFamily !== contentFamily) return false;
  if (!isProductContentCompatible(genome, product)) return false;
  return overrides.fields.every((axis) => {
    const required = overrides.axes[axis];
    return !required || normalizeText(genome[axis]) === normalizeText(required);
  });
}
function boundedNoveltyThreshold(value) {
  return Number.isFinite(value) ? Math.max(0, value) : defaultCreativeDiversityOptions.noveltyThreshold;
}
function varietyProfile(variety) {
  if (variety === "Consistent") return { novelty: 0.7, penalty: 0.85, rarity: 0.45, jitter: 2.5 };
  if (variety === "Exploratory") return { novelty: 1.35, penalty: 1.35, rarity: 1.1, jitter: 5.5 };
  return { novelty: 1, penalty: 1, rarity: 0.8, jitter: 4 };
}
var CreativeDiversityEngine = class {
  options;
  constructor(options = {}) {
    this.options = {
      ...defaultCreativeDiversityOptions,
      ...options,
      noveltyThreshold: boundedNoveltyThreshold(options.noveltyThreshold ?? defaultCreativeDiversityOptions.noveltyThreshold)
    };
  }
  plan(input) {
    const product = resolveCreativeProduct(input.product);
    const contentFamily = resolveCreativeFamilyForH3VideoType(input.contentFamily);
    const grammar = getCreativeFamilyGrammar(contentFamily);
    const history = asCreativeHistoryEntries(input.recentHistory);
    const overrides = extractCreativeOverrides(input.userIdea, input.specialInstructions);
    if (overrides.conflicts?.length) throw new CreativeConstraintError(overrides.conflicts);
    const seed = normalizeSeed(input.seed);
    const random = seededRandom(seed);
    const now3 = input.now ?? /* @__PURE__ */ new Date();
    const variety = input.variety ?? "Balanced";
    const profile = varietyProfile(variety);
    const candidates = candidateGenomes(grammar).map((genome) => applyOverrides(genome, overrides));
    const hardCompatibleCandidates = candidates.filter((genome) => isHardCompatible(genome, product, contentFamily, overrides));
    if (!hardCompatibleCandidates.length) {
      throw new Error(`No Creative Diversity direction satisfies the explicit hard constraints for ${contentFamily}.`);
    }
    const recentFamily = sameProductFamilyHistory(product.id, contentFamily, history, this.options);
    const archetypeCounts = /* @__PURE__ */ new Map();
    for (const entry of recentFamily) archetypeCounts.set(normalizeText(entry.genome.creativeArchetype), (archetypeCounts.get(normalizeText(entry.genome.creativeArchetype)) ?? 0) + 1);
    const scored = hardCompatibleCandidates.map((genome) => {
      const fingerprint = buildCreativeFingerprint(genome);
      const penalties = selectedValuePenaltySources(genome, product.id, contentFamily, history, overrides, now3, this.options);
      const noveltyScore = noveltyScoreFor(genome, product.id, contentFamily, history, now3, this.options);
      const penalty = penalties.reduce((sum, source) => sum + source.penalty, 0);
      const archetypeCount = archetypeCounts.get(normalizeText(genome.creativeArchetype)) ?? 0;
      const rarity = 18 / (1 + archetypeCount);
      const randomRank = random();
      const score = noveltyScore * profile.novelty - penalty * profile.penalty + rarity * profile.rarity + randomRank * profile.jitter;
      const historyRejection = recentFamily.map((entry) => rejectionFor({ genome, fingerprint, noveltyScore, penalties, score, randomRank, historyRejection: null, lastUsedAt: null, historicalUsageCount: 0 }, entry, this.options, overrides)).find((rejection) => rejection !== null) ?? null;
      const historyStats = candidateHistoryStats({ genome, fingerprint, noveltyScore, penalties, score, randomRank, historyRejection, lastUsedAt: null, historicalUsageCount: 0 }, recentFamily);
      return { genome, fingerprint, noveltyScore, penalties, score, randomRank, historyRejection, ...historyStats };
    }).sort((a, b) => b.score - a.score || a.randomRank - b.randomRank || a.fingerprint.signature.localeCompare(b.fingerprint.signature));
    const rejections = [];
    const maxRerolls = Math.max(0, this.options.maxRerolls);
    const noveltyThreshold = boundedNoveltyThreshold(this.options.noveltyThreshold);
    const fallbackCandidate = [...scored].sort(compareFallbackCandidates)[0];
    if (!fallbackCandidate) throw new Error(`No Creative Diversity direction satisfies the explicit hard constraints for ${contentFamily}.`);
    let selected;
    let rerollsUsed = 0;
    let historyRejectionsEncountered = 0;
    for (const candidate of scored) {
      const belowNoveltyThreshold = candidate.noveltyScore < noveltyThreshold;
      if (!candidate.historyRejection && !belowNoveltyThreshold) {
        selected = candidate;
        break;
      }
      if (rerollsUsed >= maxRerolls) break;
      if (candidate.historyRejection) {
        historyRejectionsEncountered += 1;
        rejections.push(candidate.historyRejection);
      }
      rerollsUsed += 1;
    }
    const diversityFallbackUsed = !selected;
    if (!selected) selected = fallbackCandidate;
    const noveltyThresholdMissed = selected.noveltyScore < noveltyThreshold;
    const historyFilteredCandidateCount = scored.filter((candidate) => candidate.historyRejection !== null).length;
    const diversityFallbackReason = diversityFallbackUsed ? historyRejectionsEncountered > 0 || historyFilteredCandidateCount > 0 ? "compatible_pool_exhausted" : "novelty_threshold_missed" : null;
    const diversityDiagnostics = {
      selectedContentType: contentFamily,
      resolvedCreativeFamily: contentFamily,
      candidateFamilySearched: contentFamily,
      candidateCount: candidates.length,
      hardCompatibleCandidateCount: hardCompatibleCandidates.length,
      historyFilteredCandidateCount,
      noveltyThreshold,
      noveltyThresholdMissed,
      diversityFallbackUsed,
      diversityFallbackReason,
      rerollsUsed,
      noveltyScore: selected.noveltyScore
    };
    return {
      product: product.id,
      productTruth: createFixedProductTruth(product),
      contentFamily,
      genome: selected.genome,
      fingerprint: selected.fingerprint,
      conceptSummary: summarizeConcept(product, selected.genome),
      noveltyScore: selected.noveltyScore,
      creativeSeed: seed,
      generationJobId: input.generationJobId ?? null,
      repetitionPenaltySources: selected.penalties,
      rejectedCandidates: rejections,
      userOverrides: overrides,
      diversityFallbackUsed,
      diversityFallbackReason,
      rerollsUsed,
      noveltyThresholdMissed,
      diversityDiagnostics
    };
  }
  simulate(input) {
    const product = resolveCreativeProduct(input.product);
    const count = Math.max(1, Math.floor(input.count ?? 100));
    const seed = normalizeSeed(input.seed);
    const history = [];
    const plans = [];
    const rejectedConcepts = [];
    const distribution = {};
    const simulationStart = input.now ?? new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
    const addDistribution = (axis, value) => {
      const axisDistribution = distribution[axis] ?? {};
      axisDistribution[value] = (axisDistribution[value] ?? 0) + 1;
      distribution[axis] = axisDistribution;
    };
    for (let index = 0; index < count; index += 1) {
      const planTime = new Date(simulationStart.getTime() + index * 6e4);
      const plan = this.plan({ ...input, product, recentHistory: history, now: planTime, seed: seed + index * 7919 >>> 0, generationJobId: `simulation-${String(index + 1).padStart(3, "0")}` });
      plans.push(plan);
      rejectedConcepts.push(...plan.rejectedCandidates);
      for (const axis of Object.keys(creativeGenomeAxisWeights)) addDistribution(axis, plan.genome[axis]);
      history.unshift({ id: plan.generationJobId ?? `simulation-${index + 1}`, generationJobId: plan.generationJobId, product: plan.product, contentFamily: plan.contentFamily, genome: plan.genome, fingerprint: plan.fingerprint, conceptSummary: plan.conceptSummary, createdAt: planTime.toISOString(), generationStatus: "planned" });
    }
    const consecutiveDifferenceCounts = plans.slice(1).map((plan, index) => compareCreativeFingerprints(plan.fingerprint, plans[index].fingerprint).meaningfulDifferenceCount);
    return {
      product: product.id,
      contentFamily: input.contentFamily,
      count,
      seed,
      plans,
      distribution,
      archetypeDistribution: distribution.creativeArchetype ?? {},
      cameraDistribution: distribution.cameraPath ?? {},
      environmentDistribution: distribution.environment ?? {},
      consecutiveDifferenceCounts,
      rejectedConcepts
    };
  }
};
function planCreativeGenome(input) {
  return new CreativeDiversityEngine(input.options).plan(input);
}

// src/domain/h3.ts
var H3_FPS = 24;
var H3_MIN_DURATION = 4;
var H3_MAX_DURATION = 15;
var h3ContentTypeOptions = h3ContentTypes;
function referenceImageSizeForFidelity(fidelity) {
  return fidelity === "High" ? "max" : "match";
}
function h3ReferenceFidelity(brief) {
  if (brief.refImageSize === "max") return "High";
  if (brief.refImageSize === "match") return "Standard";
  if (brief.referenceFidelity === "Standard" || brief.referenceFidelity === "High") return brief.referenceFidelity;
  const hasConcreteReference = brief.references.productReference.source === "selected-product" || brief.references.productReference.source === "local-file" || brief.references.referenceImages?.some((slot) => slot.asset.source === "selected-product" || slot.asset.source === "local-file") === true;
  return brief.productFidelity === "Exact" || hasConcreteReference ? "High" : "Standard";
}
function h3RefImageSize(brief) {
  if (brief.refImageSize === "match" || brief.refImageSize === "max") return brief.refImageSize;
  return referenceImageSizeForFidelity(h3ReferenceFidelity(brief));
}
function h3Scheduler(brief) {
  return brief.scheduler === "normal" || brief.scheduler === "beta" ? brief.scheduler : "simple";
}
function h3WorkflowSettingsFromBrief(brief) {
  const aspectRatio = brief.aspectRatio === "Custom" ? brief.customAspectRatio.trim() : brief.aspectRatio;
  return {
    durationSeconds: brief.duration,
    aspectRatio,
    megapixels: brief.megapixels,
    multiple: brief.multiple,
    fps: brief.fps,
    steps: brief.steps ?? 20,
    scheduler: h3Scheduler(brief),
    seedMode: brief.seedMode === "fixed" ? "fixed" : "random",
    seed: brief.seed ?? 0,
    refImageSize: h3RefImageSize(brief)
  };
}
var h3ProductScopedIdentityRule = "Keep each product's identity scoped to that product; never transfer traits between products.";
var h3ProductReferenceRules = "Use verified unseen-surface metadata only when choreography reveals it; do not add generic packaging copy.";
var minimaxH3SystemInstruction = [
  "Act as a MiniMax H3 video prompt director. Think chronologically from initial state to motion/action onset to continuous development to final state/settle.",
  "Keep spatial continuity understandable, describe observable intermediate physical actions, and use reference images only for their stated roles.",
  "When a product image is supplied, let its pixels control visible packaging; written data adds only a relevant verified correction and never reconstructs front artwork.",
  h3ProductScopedIdentityRule,
  "Use one concise 3\u20135 sentence product lock at the first product-bearing beat; do not repeat it in later beats.",
  h3ProductReferenceRules,
  "Add one short blank-surface sentence only when choreography reveals a rear or side surface; otherwise keep product motion minimal and use environmental motion."
].join(" ");
function calculateH3FrameLength(durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds < H3_MIN_DURATION || durationSeconds > H3_MAX_DURATION) {
    throw new RangeError(`H3 duration must be between ${H3_MIN_DURATION} and ${H3_MAX_DURATION} seconds`);
  }
  const targetFrames = durationSeconds * H3_FPS;
  return Math.min(5 + 17 * Math.ceil((targetFrames - 5) / 17), 5 + 17 * Math.floor((H3_MAX_DURATION * H3_FPS - 5) / 17));
}
function createH3ReferencePlan(product) {
  return {
    firstFrame: { source: "none", description: "", path: null },
    lastFrame: { source: "selected-product", description: `Exact ${product.shortName} final hero frame`, path: product.imagePath },
    productReference: { source: "selected-product", description: `${product.officialName} packaging reference`, path: product.imagePath },
    styleReference: { source: "none", description: "", path: null }
  };
}
function createOptionalH3ReferencePlan(_product) {
  void _product;
  return {
    firstFrame: { source: "none", description: "", path: null },
    lastFrame: { source: "none", description: "", path: null },
    productReference: { source: "none", description: "", path: null },
    styleReference: { source: "none", description: "", path: null }
  };
}
var h3ReferenceSlotNodeIds = ["137", "139"];
function isConcreteH3Reference(asset) {
  return asset.source === "selected-product" || asset.source === "local-file";
}
function referenceAssetIdentity(asset) {
  return asset.path?.trim().toLowerCase() || `${asset.source}:${cleanText(asset.description).toLowerCase()}`;
}
function defaultRef2VAReferenceSlots(references) {
  if (references.referenceImages?.length) return references.referenceImages;
  const slots = [];
  if (isConcreteH3Reference(references.productReference)) slots.push({ role: "product-front", asset: references.productReference });
  if (isConcreteH3Reference(references.styleReference)) slots.push({ role: "style", asset: references.styleReference });
  return slots;
}
function buildH3ReferenceSlotMappings(references) {
  const seen = /* @__PURE__ */ new Set();
  return defaultRef2VAReferenceSlots(references).filter((slot) => isConcreteH3Reference(slot.asset)).filter((slot) => {
    const identity = referenceAssetIdentity(slot.asset);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).map((slot, index) => ({
    pictureNumber: index + 1,
    pictureTag: `<Picture ${index + 1}>`,
    refImageIndex: index,
    refInput: `ref_images.ref_image_${index}`,
    nodeId: h3ReferenceSlotNodeIds[index] ?? null,
    role: slot.role,
    asset: slot.asset
  }));
}
function cleanText(value) {
  return value.trim().replace(/\s+/g, " ");
}

// src/domain/minimax-h3-workflow.ts
var comfyAspectRatios = {
  "1:1": { selectorValue: "1:1 (Square)", widthRatio: 1, heightRatio: 1 },
  "2:3": { selectorValue: "2:3 (Portrait Photo)", widthRatio: 2, heightRatio: 3 },
  "3:2": { selectorValue: "3:2 (Photo)", widthRatio: 3, heightRatio: 2 },
  "3:4": { selectorValue: "3:4 (Portrait Standard)", widthRatio: 3, heightRatio: 4 },
  "4:3": { selectorValue: "4:3 (Standard)", widthRatio: 4, heightRatio: 3 },
  "9:16": { selectorValue: "9:16 (Portrait Widescreen)", widthRatio: 9, heightRatio: 16 },
  "16:9": { selectorValue: "16:9 (Widescreen)", widthRatio: 16, heightRatio: 9 },
  "21:9": { selectorValue: "21:9 (Ultrawide)", widthRatio: 21, heightRatio: 9 }
};
var minimaxH3ReferenceSlotMappings = [
  { pictureTag: "<Picture 1>", refInput: "ref_images.ref_image_0", nodeId: "137", placeholder: "{{H3_REF_IMAGE_0}}", role: "first connected reference image" },
  { pictureTag: "<Picture 2>", refInput: "ref_images.ref_image_1", nodeId: "139", placeholder: "{{H3_REF_IMAGE_1}}", role: "second connected reference image" }
];
var minimaxH3ReferenceImageLimit = h3ReferenceImageSlotLimit;
var minimaxH3ReferenceImageSizeValues = h3ReferenceImageSizeOptions;
var minimaxH3SchedulerValues = h3SchedulerOptions;
var minimaxH3WorkflowMappings = [
  { placeholder: "{{H3_DURATION}}", nodeId: "149", inputName: "duration_seconds", classType: "MiniMaxH3PromptEnhancer", role: "Requested duration for prompt enhancement" },
  { placeholder: "{{H3_LANGUAGE}}", nodeId: "149", inputName: "dialogue_language", classType: "MiniMaxH3PromptEnhancer", role: "Requested dialogue language" },
  { placeholder: "{{H3_UNLOAD_MODEL}}", nodeId: "152", inputName: "unload", classType: "MiniMaxH3UnloadLMStudioModel", role: "Configured LM Studio model handoff" },
  /** Kept as a disconnected migration input so older saved requests remain readable. */
  { placeholder: "{{H3_PROMPT}}", nodeId: "138", inputName: "value", classType: "PrimitiveStringMultiline", role: "Prompt text linked to node 136 prompt" },
  { placeholder: "{{H3_GENERATION_BRIEF}}", nodeId: "147", inputName: "value", classType: "PrimitiveStringMultiline", role: "Structured H3 brief linked to MiniMaxH3PromptEnhancer" },
  { placeholder: "{{H3_REFERENCE_CONTEXT}}", nodeId: "148", inputName: "value", classType: "PrimitiveStringMultiline", role: "Reference context linked to enhancer and validator" },
  { placeholder: "{{H3_MEDIA_MANIFEST}}", nodeId: "153", inputName: "value", classType: "PrimitiveStringMultiline", role: "Authoritative media manifest linked to enhancer and validator" },
  { placeholder: "{{H3_SYSTEM_PROMPT}}", nodeId: "149", inputName: "system_prompt_override", classType: "MiniMaxH3PromptEnhancer", role: "Exact system-prompt override passed to the remote Qwen node" },
  { placeholder: "{{H3_LM_STUDIO_ENDPOINT}}", nodeId: "149", inputName: "endpoint", classType: "MiniMaxH3PromptEnhancer", role: "LM Studio loopback endpoint on the execution PC" },
  { placeholder: "{{H3_LM_STUDIO_MODEL}}", nodeId: "149", inputName: "model", classType: "MiniMaxH3PromptEnhancer", role: `Fixed autonomous prompt model ${h3PromptEngineModelId}; other LM Studio models are ignored` },
  { placeholder: "{{H3_PROMPT_ASPECT_RATIO}}", nodeId: "149", inputName: "aspect_ratio", classType: "MiniMaxH3PromptEnhancer", role: "Raw target aspect ratio for the enhancer" },
  { placeholder: "{{H3_TEMPERATURE}}", nodeId: "149", inputName: "temperature", classType: "MiniMaxH3PromptEnhancer", role: "Exact configured prompt temperature" },
  { placeholder: "{{H3_PROMPT_TIMEOUT}}", nodeId: "149", inputName: "timeout_seconds", classType: "MiniMaxH3PromptEnhancer", role: "Exact rewrite and repair request timeout" },
  { placeholder: "{{H3_REPAIR_ATTEMPTS}}", nodeId: "149", inputName: "repair_attempts", classType: "MiniMaxH3PromptEnhancer", role: "Bounded sequential repair count" },
  { placeholder: "{{H3_DISABLE_THINKING}}", nodeId: "149", inputName: "disable_thinking", classType: "MiniMaxH3PromptEnhancer", role: "Configured thinking switch" },
  { placeholder: "{{H3_ASPECT_RATIO}}", nodeId: "115", inputName: "aspect_ratio", classType: "ResolutionSelector", role: "Resolution preset; node 115 derives width and height" },
  { placeholder: "{{H3_MEGAPIXELS}}", nodeId: "115", inputName: "megapixels", classType: "ResolutionSelector", role: "Resolution pixel budget" },
  { placeholder: "{{H3_MULTIPLE}}", nodeId: "115", inputName: "multiple", classType: "ResolutionSelector", role: "Resolution rounding multiple" },
  { placeholder: "{{H3_FRAMES}}", nodeId: "131", inputName: "expression", classType: "ComfyMathExpression", role: "Frame count output linked to node 136 length" },
  { placeholder: "{{H3_FPS}}", nodeId: "130", inputName: "fps", classType: "CreateVideo", role: "Output video FPS" },
  { placeholder: "{{H3_STEPS}}", nodeId: "143", inputName: "value", classType: "PrimitiveInt", role: "UI Steps branch value routed by node 142 to BasicScheduler node 124" },
  { placeholder: "{{H3_SEED}}", nodeId: "129", inputName: "noise_seed", classType: "RandomNoise", role: "Sampling noise seed" },
  { placeholder: "{{H3_REF_IMAGE_SIZE}}", nodeId: "136", inputName: "ref_image_size", classType: "MiniMaxH3ReferenceToVideo", role: "Reference image sizing: match or max" },
  { placeholder: "{{H3_SCHEDULER}}", nodeId: "124", inputName: "scheduler", classType: "BasicScheduler", role: "Sampling scheduler; production default is simple" },
  { placeholder: "{{H3_REF_IMAGE_0}}", nodeId: "137", inputName: "image", classType: "LoadImage", role: "ref_image_0 / <Picture 1>" },
  { placeholder: "{{H3_REF_IMAGE_1}}", nodeId: "139", inputName: "image", classType: "LoadImage", role: "ref_image_1 / <Picture 2>" },
  { placeholder: "{{H3_OUTPUT_PREFIX}}", nodeId: "92", inputName: "filename_prefix", classType: "SaveVideo", role: "Remote output prefix" }
];
var minimaxH3RequiredPlaceholders = [...new Set(minimaxH3WorkflowMappings.map(({ placeholder }) => placeholder))].sort();
function workflowError(message) {
  return new Error(`Invalid ComfyUI API workflow: ${message}`);
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isLink(value, nodeId, outputIndex) {
  return Array.isArray(value) && value.length === 2 && value[0] === nodeId && value[1] === outputIndex;
}
function validateMiniMaxH3ApiWorkflowTemplate(value) {
  const workflow = parseComfyApiWorkflow(value);
  if (JSON.stringify(collectH3WorkflowPlaceholders(workflow)) !== JSON.stringify(minimaxH3RequiredPlaceholders)) {
    throw workflowError("production placeholder contract differs from the supported MiniMax H3 mappings; refresh the configured workflow file");
  }
  if ("max_tokens" in (workflow["149"]?.inputs ?? {}) || "max_output_tokens" in (workflow["149"]?.inputs ?? {})) {
    throw workflowError("node 149 output-token inputs must be absent; LM Studio manages output length");
  }
  for (const mapping of minimaxH3WorkflowMappings) {
    const node = workflow[mapping.nodeId];
    if (!node || node.class_type !== mapping.classType) {
      throw workflowError(`expected node ${mapping.nodeId} to be ${mapping.classType} for ${mapping.placeholder}`);
    }
    const input = node.inputs[mapping.inputName];
    if (typeof input !== "string" || !input.includes(mapping.placeholder)) {
      throw workflowError(`expected ${mapping.placeholder} at node ${mapping.nodeId} input ${mapping.inputName}`);
    }
  }
  const h3Node = workflow["136"];
  if (!h3Node || h3Node.class_type !== "MiniMaxH3ReferenceToVideo") throw workflowError("expected node 136 to be MiniMaxH3ReferenceToVideo");
  const requiredLinks = [
    ["prompt", "151", 0],
    ["width", "115", 0],
    ["height", "115", 1],
    ["length", "131", 1],
    ["ref_images.ref_image_0", "137", 0],
    ["ref_images.ref_image_1", "139", 0]
  ];
  for (const [inputName, sourceNode, outputIndex] of requiredLinks) {
    if (!isLink(h3Node.inputs[inputName], sourceNode, outputIndex)) {
      throw workflowError(`node 136 input ${inputName} must remain linked to node ${sourceNode} output ${outputIndex}`);
    }
  }
  const enhancer = workflow["149"];
  if (!enhancer || enhancer.class_type !== "MiniMaxH3PromptEnhancer" || !isLink(enhancer.inputs.basic_prompt, "147", 0) || !isLink(enhancer.inputs.reference_context, "148", 0) || !isLink(enhancer.inputs.media_manifest, "153", 0) || enhancer.inputs.mode !== "ref2va" || !String(enhancer.inputs.system_prompt_override).includes("{{H3_SYSTEM_PROMPT}}")) {
    throw workflowError("node 149 must enhance the intermediate brief with the reference context and the final system-prompt override");
  }
  const validator = workflow["150"];
  if (!validator || validator.class_type !== "MiniMaxH3PromptValidator" || !isLink(validator.inputs.prompt, "149", 0) || !isLink(validator.inputs.source_prompt, "147", 0) || !isLink(validator.inputs.reference_context, "148", 0) || !isLink(validator.inputs.media_manifest, "153", 0)) {
    throw workflowError("node 150 must validate the enhancer output against the original brief and reference context");
  }
  const gate = workflow["151"];
  if (!gate || gate.class_type !== "MiniMaxH3PromptValidityGate" || !isLink(gate.inputs.prompt, "152", 0) || !isLink(gate.inputs.valid, "152", 1) || !isLink(gate.inputs.validation_report, "152", 2) || !isLink(gate.inputs.unload_succeeded, "152", 3) || !isLink(gate.inputs.unload_error, "152", 4)) {
    throw workflowError("node 151 must be a blocking validity gate after exact Qwen cleanup");
  }
  const unload = workflow["152"];
  if (!unload || unload.class_type !== "MiniMaxH3UnloadLMStudioModel" || !isLink(unload.inputs.prompt, "150", 0) || !isLink(unload.inputs.valid, "150", 1) || !isLink(unload.inputs.validation_report, "150", 2) || !isLink(unload.inputs.model, "149", 8) || !isLink(unload.inputs.instance_id, "149", 9)) {
    throw workflowError("node 152 must unload the exact LM Studio model instance after validation and before the validity gate");
  }
  const stepsSwitch = workflow["142"];
  if (!stepsSwitch || stepsSwitch.class_type !== "ComfySwitchNode" || !isLink(stepsSwitch.inputs.switch, "146", 0) || !isLink(stepsSwitch.inputs.on_false, "143", 0) || !isLink(stepsSwitch.inputs.on_true, "144", 0)) {
    throw workflowError("the active steps switch must remain node 142 with node 146 selecting node 143 or node 144");
  }
  const sampler = workflow["125"];
  if (!sampler || sampler.class_type !== "SamplerCustomAdvanced" || !isLink(sampler.inputs.sigmas, "124", 0)) {
    throw workflowError("node 125 must consume the BasicScheduler sigmas output from node 124");
  }
  const samplerSelector = workflow["123"];
  if (!samplerSelector || samplerSelector.class_type !== "KSamplerSelect" || samplerSelector.inputs.sampler_name !== "res_multistep" || !isLink(sampler.inputs.sampler, "123", 0)) {
    throw workflowError("node 125 must use node 123 KSamplerSelect with sampler_name res_multistep");
  }
  const lightningToggle = workflow["146"];
  if (!lightningToggle || lightningToggle.class_type !== "PrimitiveBoolean" || lightningToggle.inputs.value !== false) {
    throw workflowError("node 146 must keep Lightning LoRA disabled so node 143 is the active steps input");
  }
  return workflow;
}
var minimaxH3T2VARequiredPlaceholders = [...new Set(minimaxH3WorkflowMappings.filter(({ placeholder }) => !["{{H3_REF_IMAGE_SIZE}}", "{{H3_REF_IMAGE_0}}", "{{H3_REF_IMAGE_1}}"].includes(placeholder)).map(({ placeholder }) => placeholder))].sort();
function validateMiniMaxH3T2VAApiWorkflowTemplate(value) {
  const workflow = parseComfyApiWorkflow(value);
  if (JSON.stringify(collectH3WorkflowPlaceholders(workflow)) !== JSON.stringify(minimaxH3T2VARequiredPlaceholders)) {
    throw workflowError("T2VA placeholder contract differs from the supported MiniMax H3 mappings");
  }
  for (const mapping of minimaxH3WorkflowMappings.filter(({ placeholder }) => !["{{H3_REF_IMAGE_SIZE}}", "{{H3_REF_IMAGE_0}}", "{{H3_REF_IMAGE_1}}"].includes(placeholder))) {
    const node = workflow[mapping.nodeId];
    if (!node || node.class_type !== mapping.classType) throw workflowError(`expected node ${mapping.nodeId} to be ${mapping.classType} for ${mapping.placeholder}`);
    const input = node.inputs[mapping.inputName];
    if (typeof input !== "string" || !input.includes(mapping.placeholder)) throw workflowError(`expected ${mapping.placeholder} at node ${mapping.nodeId} input ${mapping.inputName}`);
  }
  const h3Node = workflow["136"];
  if (!h3Node || h3Node.class_type !== "MiniMaxH3ImageToVideo") throw workflowError("expected T2VA node 136 to be MiniMaxH3ImageToVideo");
  const requiredLinks = [
    ["prompt", "151", 0],
    ["width", "115", 0],
    ["height", "115", 1],
    ["length", "131", 1],
    ["clip", "128", 0],
    ["vae", "119", 0]
  ];
  for (const [inputName, sourceNode, outputIndex] of requiredLinks) {
    if (!isLink(h3Node.inputs[inputName], sourceNode, outputIndex)) throw workflowError(`T2VA node 136 input ${inputName} must remain linked to node ${sourceNode} output ${outputIndex}`);
  }
  if ("first_frame" in h3Node.inputs || "last_frame" in h3Node.inputs || Object.keys(h3Node.inputs).some((name) => name.startsWith("ref_"))) {
    throw workflowError("T2VA node 136 must not contain frame or reference inputs");
  }
  const diffusion = workflow["127"];
  if (!diffusion || diffusion.class_type !== "UNETLoader" || diffusion.inputs.unet_name !== "minimax_h3_fl2va_pruned_int8_convrot.safetensors") {
    throw workflowError("T2VA node 127 must load the matching FL2VA pruned INT8 ConvRot model");
  }
  const enhancer = workflow["149"];
  if (!enhancer || enhancer.class_type !== "MiniMaxH3PromptEnhancer" || enhancer.inputs.mode !== "t2va" || !isLink(enhancer.inputs.basic_prompt, "147", 0) || !isLink(enhancer.inputs.reference_context, "148", 0) || !isLink(enhancer.inputs.media_manifest, "153", 0)) throw workflowError("T2VA node 149 must preserve the prompt-engine chain in t2va mode");
  const validator = workflow["150"];
  if (!validator || validator.class_type !== "MiniMaxH3PromptValidator" || validator.inputs.mode !== "t2va" || !isLink(validator.inputs.prompt, "149", 0) || !isLink(validator.inputs.source_prompt, "147", 0) || !isLink(validator.inputs.reference_context, "148", 0) || !isLink(validator.inputs.media_manifest, "153", 0)) throw workflowError("T2VA node 150 must preserve validation in t2va mode");
  const gate = workflow["151"];
  if (!gate || gate.class_type !== "MiniMaxH3PromptValidityGate" || !isLink(gate.inputs.prompt, "152", 0) || !isLink(gate.inputs.valid, "152", 1) || !isLink(gate.inputs.validation_report, "152", 2) || !isLink(gate.inputs.unload_succeeded, "152", 3) || !isLink(gate.inputs.unload_error, "152", 4)) throw workflowError("T2VA must preserve the blocking validity gate after Qwen cleanup");
  const unload = workflow["152"];
  if (!unload || unload.class_type !== "MiniMaxH3UnloadLMStudioModel" || !isLink(unload.inputs.prompt, "150", 0) || !isLink(unload.inputs.valid, "150", 1) || !isLink(unload.inputs.validation_report, "150", 2) || !isLink(unload.inputs.model, "149", 8) || !isLink(unload.inputs.instance_id, "149", 9)) throw workflowError("T2VA must preserve exact-instance Qwen unload before the validity gate");
  const stepsSwitch = workflow["142"];
  const sampler = workflow["125"];
  const samplerSelector = workflow["123"];
  const lightningToggle = workflow["146"];
  if (!stepsSwitch || stepsSwitch.class_type !== "ComfySwitchNode" || !isLink(stepsSwitch.inputs.switch, "146", 0) || !isLink(stepsSwitch.inputs.on_false, "143", 0) || !isLink(stepsSwitch.inputs.on_true, "144", 0)) throw workflowError("T2VA must preserve the steps switch");
  if (!sampler || sampler.class_type !== "SamplerCustomAdvanced" || !isLink(sampler.inputs.sigmas, "124", 0) || !isLink(sampler.inputs.sampler, "123", 0)) throw workflowError("T2VA must preserve the sampler graph");
  if (!samplerSelector || samplerSelector.class_type !== "KSamplerSelect" || samplerSelector.inputs.sampler_name !== "res_multistep") throw workflowError("T2VA must preserve res_multistep sampling");
  if (!lightningToggle || lightningToggle.class_type !== "PrimitiveBoolean" || lightningToggle.inputs.value !== false) throw workflowError("T2VA must keep the unrelated Lightning LoRA branch disabled");
  return workflow;
}
function deriveMiniMaxH3T2VAWorkflowTemplate(ref2vaTemplate) {
  const workflow = validateMiniMaxH3ApiWorkflowTemplate(ref2vaTemplate);
  workflow["127"].inputs.unet_name = "minimax_h3_fl2va_pruned_int8_convrot.safetensors";
  workflow["136"] = {
    ...workflow["136"],
    class_type: "MiniMaxH3ImageToVideo",
    inputs: {
      prompt: ["151", 0],
      width: ["115", 0],
      height: ["115", 1],
      length: ["131", 1],
      clip: ["128", 0],
      vae: ["119", 0]
    },
    _meta: { title: "MiniMax H3 Text to Video" }
  };
  delete workflow["137"];
  delete workflow["139"];
  workflow["149"].inputs.mode = "t2va";
  workflow["150"].inputs.mode = "t2va";
  return validateMiniMaxH3T2VAApiWorkflowTemplate(workflow);
}
function resolveH3Resolution(aspectRatio, megapixels, multiple) {
  const ratio = comfyAspectRatios[aspectRatio.trim()];
  if (!ratio) throw new Error(`H3 aspect ratio ${aspectRatio || "(empty)"} is not supported by workflow node 115 (ResolutionSelector).`);
  if (!Number.isFinite(megapixels) || megapixels < 0.1 || megapixels > 16) throw new Error("H3 megapixels must be between 0.1 and 16.");
  if (!Number.isInteger(multiple) || multiple < 8 || multiple > 128 || multiple % 4 !== 0) throw new Error("H3 resolution multiple must be an integer from 8 to 128 in steps of 4.");
  const totalPixels = megapixels * 1024 * 1024;
  const scale = Math.sqrt(totalPixels / (ratio.widthRatio * ratio.heightRatio));
  return {
    selectorValue: ratio.selectorValue,
    width: Math.round(ratio.widthRatio * scale / multiple) * multiple,
    height: Math.round(ratio.heightRatio * scale / multiple) * multiple
  };
}
function validateH3Seed(seed) {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("H3 seed must be a non-negative safe integer.");
}
function validateH3WorkflowSettings(settings) {
  if (!Number.isFinite(settings.durationSeconds) || settings.durationSeconds < 4 || settings.durationSeconds > 15) throw new Error("H3 duration must be between 4 and 15 seconds.");
  if (settings.fps !== 24) throw new Error("The configured MiniMax H3 workflow requires 24 FPS.");
  if (!Number.isInteger(settings.steps) || settings.steps < 1) throw new Error("H3 steps must be a positive integer.");
  if (!minimaxH3SchedulerValues.includes(settings.scheduler)) throw new Error("MiniMax H3 scheduler must be simple, normal, or beta.");
  if (!h3SeedModeOptions.includes(settings.seedMode)) throw new Error("H3 seed mode must be random or fixed.");
  validateH3Seed(settings.seed);
  if (!minimaxH3ReferenceImageSizeValues.includes(settings.refImageSize)) throw new Error("MiniMax H3 ref_image_size must be match or max.");
  const resolution = resolveH3Resolution(settings.aspectRatio, settings.megapixels, settings.multiple);
  const frameLength = calculateH3FrameLength(settings.durationSeconds);
  return {
    ...settings,
    frameLength,
    resolvedWidth: resolution.width,
    resolvedHeight: resolution.height
  };
}
function readH3WorkflowTemplateDefaults(value) {
  const workflow = validateMiniMaxH3ApiWorkflowTemplate(value);
  const metadata = workflow["115"]?._meta;
  if (!isRecord2(metadata) || !isRecord2(metadata.proya_h3_workflow_defaults)) {
    throw workflowError("node 115 is missing _meta.proya_h3_workflow_defaults");
  }
  const candidate = metadata.proya_h3_workflow_defaults;
  const snapshot = validateH3WorkflowSettings(candidate);
  return {
    durationSeconds: snapshot.durationSeconds,
    aspectRatio: snapshot.aspectRatio,
    megapixels: snapshot.megapixels,
    multiple: snapshot.multiple,
    fps: snapshot.fps,
    steps: snapshot.steps,
    scheduler: snapshot.scheduler,
    seedMode: snapshot.seedMode,
    seed: snapshot.seed,
    refImageSize: snapshot.refImageSize
  };
}
var h3WorkflowTemplateDefaults = readH3WorkflowTemplateDefaults(minimax_h3_api_default);
function validateMiniMaxH3GenerationRequest(request) {
  const hasAutonomousBrief = Boolean(request.generationBrief && request.generationBriefText?.trim());
  if (!hasAutonomousBrief && !request.prompt?.trim()) throw new Error("H3 generation requires a structured generation brief.");
  const supportBRoll = isNoProductVideo(request.generationBrief?.contentType);
  const expectedMode = supportBRoll ? "T2VA" : "REF2VA";
  if (request.mode !== expectedMode) throw new Error(`The selected content requires MiniMax H3 ${expectedMode === "REF2VA" ? "Ref2VA" : "T2VA"}, but the request resolved ${request.mode}.`);
  if (!Number.isFinite(request.duration) || request.duration < 4 || request.duration > 15) throw new Error("H3 duration must be between 4 and 15 seconds.");
  if (request.fps !== 24) throw new Error("The configured MiniMax H3 workflow requires 24 FPS.");
  const expectedFrames = calculateH3FrameLength(request.duration);
  if (!Number.isInteger(request.frames) || request.frames !== expectedFrames) throw new Error(`H3 frame count must be ${expectedFrames} for ${request.duration} seconds at 24 FPS.`);
  if (request.firstFrame || request.lastFrame || request.firstFramePath || request.lastFramePath) throw new Error("The configured Ref2VA workflow does not expose first-frame or last-frame inputs. Use a matching I2VA/FL2VA/L2VA API workflow for endpoint frames.");
  if (request.refImageSize !== void 0 && !minimaxH3ReferenceImageSizeValues.includes(request.refImageSize)) throw new Error("MiniMax H3 ref_image_size must be match or max.");
  if (request.scheduler !== void 0 && !minimaxH3SchedulerValues.includes(request.scheduler)) throw new Error("MiniMax H3 scheduler must be simple, normal, or beta.");
  if (request.steps !== void 0 && (!Number.isInteger(request.steps) || request.steps < 1)) throw new Error("H3 steps must be a positive integer.");
  if (request.seed !== void 0) validateH3Seed(request.seed);
  if (request.promptEngine) {
    validateH3PromptEngineSettings(request.promptEngine);
  }
  if (request.generationBrief) {
    if (request.generationBrief.workflowMode !== expectedMode) throw new Error(`The H3 generation brief must keep workflow mode ${expectedMode}.`);
    if (request.generationBrief.duration !== request.duration || request.generationBrief.aspectRatio !== request.aspectRatio) throw new Error("H3 generation brief target values do not match the direct workflow settings.");
    const expectedManifest = request.generationBrief.mediaManifest?.trim();
    if (!expectedManifest) throw new Error("The autonomous H3 generation brief is missing its authoritative media_manifest contract.");
    if (request.mediaManifest?.trim() && request.mediaManifest.trim() !== expectedManifest) throw new Error("H3 media_manifest does not match the generation brief contract.");
    if (request.allowedReferenceLabels && JSON.stringify(request.allowedReferenceLabels) !== JSON.stringify(request.generationBrief.allowedReferenceLabels)) throw new Error("H3 allowed reference labels do not match the generation brief contract.");
  }
  if (request.workflowSettings) {
    const snapshot = validateH3WorkflowSettings(request.workflowSettings);
    if (request.duration !== snapshot.durationSeconds || request.frames !== snapshot.frameLength) throw new Error("H3 request values do not match its workflow settings snapshot for duration or frame length.");
    if (request.aspectRatio !== snapshot.aspectRatio || request.megapixels !== snapshot.megapixels || request.multiple !== snapshot.multiple || request.fps !== snapshot.fps) throw new Error("H3 request values do not match its workflow settings snapshot.");
    if (request.steps !== void 0 && request.steps !== snapshot.steps) throw new Error("H3 request steps do not match its workflow settings snapshot.");
    if (request.scheduler !== void 0 && request.scheduler !== snapshot.scheduler) throw new Error("H3 request scheduler does not match its workflow settings snapshot.");
    if (request.refImageSize !== void 0 && request.refImageSize !== snapshot.refImageSize) throw new Error("H3 request ref_image_size does not match its workflow settings snapshot.");
    if (request.seed !== void 0 && request.seed !== snapshot.seed) throw new Error("H3 request seed does not match its workflow settings snapshot.");
  }
  const referenceImages = request.referenceImages?.filter((reference) => Boolean(
    reference.filename?.trim() || reference.path?.trim() || reference.remoteFilename?.trim() || reference.localPath?.trim()
  )) ?? [];
  if (referenceImages.length > minimaxH3ReferenceImageLimit) throw new Error(`The configured Ref2VA workflow supports at most ${minimaxH3ReferenceImageLimit} reference image slots.`);
  if (request.generationBrief) {
    const declaredPictureCount = request.generationBrief.references.filter((reference) => reference.source !== "none").length;
    const physicalPictureCount = referenceImages.length || (request.productReference?.trim() || request.productReferencePath?.trim() ? 1 : 0);
    if (declaredPictureCount !== physicalPictureCount) throw new Error(`H3 reference contract declares ${declaredPictureCount} connected picture(s), but ${physicalPictureCount} physical reference input(s) were supplied.`);
  }
  if (supportBRoll && (referenceImages.length || request.productReference?.trim() || request.productReferencePath?.trim())) throw new Error("Support B-Roll T2VA must not receive any product or reference image.");
  if (request.generationBrief && !supportBRoll && !request.productReference?.trim() && !request.productReferencePath?.trim()) throw new Error("The autonomous Ref2VA workflow requires a product reference path for <Picture 1>.");
  if (!supportBRoll && !referenceImages.length && !request.productReference?.trim() && !request.productReferencePath?.trim()) throw new Error("The configured Ref2VA workflow requires {{H3_REF_IMAGE_0}}, but no local or remote reference image is available.");
  return resolveH3Resolution(request.aspectRatio, request.megapixels, request.multiple);
}
function validateH3PromptEngineSettings(settings) {
  if (settings.provider !== "lmstudio-remote") throw new Error("H3 Prompt Engine must use the remote LM Studio provider.");
  if (!isValidH3PromptEngineEndpoint(settings.endpoint)) throw new Error("H3 Prompt Engine endpoint must be http://127.0.0.1:1234/v1 on the execution PC.");
  if (settings.model !== h3PromptEngineModelId) throw new Error(`H3 Prompt Engine model is fixed to ${h3PromptEngineModelId}.`);
  if (!Number.isFinite(settings.temperature) || settings.temperature < 0 || settings.temperature > 2) throw new Error("H3 Prompt Engine temperature must be between 0 and 2.");
  if (!Number.isInteger(settings.repairAttempts) || settings.repairAttempts < 0 || settings.repairAttempts > 5) throw new Error("H3 Prompt Engine repair attempts must be an integer between 0 and 5.");
  if (typeof settings.disableThinking !== "boolean") throw new Error("H3 Prompt Engine disable thinking must be a boolean.");
  if (typeof settings.unloadModelBeforeH3 !== "boolean") throw new Error("H3 Prompt Engine unload setting must be a boolean.");
  if (!Number.isInteger(settings.timeoutSeconds) || settings.timeoutSeconds < 10 || settings.timeoutSeconds > 900) throw new Error("H3 Prompt Engine timeout must be an integer between 10 and 900 seconds.");
  return { ...settings };
}
function normalizeAutonomousH3PromptEngineSettings(settings) {
  return { ...settings, model: h3PromptEngineModelId, unloadModelBeforeH3: true };
}
function isValidH3PromptEngineEndpoint(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") && parsed.port === "1234" && /^\/v1\/?$/.test(parsed.pathname) && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

// src/domain/cta-end-card.ts
var import_node_child_process = require("child_process");
var import_node_crypto = require("crypto");
var import_node_path = require("path");
var import_node_fs = require("fs");

// src/domain/cta-settings.ts
var CTA_CONTENT_TYPE = "CTA / End Card";
var defaultCtaSettings = { style: "Auto", duration: 8, price: "", action: "", benefit: "", promo: "" };
var isCtaEndCard = (value) => value === CTA_CONTENT_TYPE;
function ctaEligibleStyles(settings) {
  return [
    ...settings.price.trim() ? ["Price"] : [],
    "Shop",
    ...settings.benefit.trim() ? ["Benefit"] : [],
    "Minimal Premium",
    ...settings.promo.trim() ? ["Promo"] : []
  ];
}
function resolveCtaStyle(settings, seed, previous) {
  const eligible = ctaEligibleStyles(settings);
  if (settings.style !== "Auto") {
    if (!eligible.includes(settings.style)) throw new Error(`${settings.style} CTA requires its corresponding copy.`);
    return settings.style;
  }
  const candidates = eligible.length > 1 ? eligible.filter((style) => style !== previous) : eligible;
  return candidates[(seed >>> 0) % candidates.length];
}
function ctaLines(style, settings, language) {
  const action = settings.action || (language === "English" ? "Shop now" : "Cek sekarang");
  switch (style) {
    case "Price":
      return [settings.price, action];
    case "Benefit":
      return [settings.benefit, action];
    case "Promo":
      return [settings.promo, action];
    case "Shop":
      return [action];
    case "Minimal Premium":
      return ["PROYA 5X Vitamin C", action];
  }
}

// src/domain/cta-end-card.ts
var CTA_LAYOUTS = ["Center Hero", "Product Left / Price Right", "Product Lower / Offer Upper", "Minimal Premium"];
function resolveCtaLayout(seed) {
  return CTA_LAYOUTS[(seed >>> 0) % CTA_LAYOUTS.length];
}
var CTA_PRODUCT_PRICES = Object.freeze({
  cleanser: { discounted: "Rp89.000", original: "Rp222.500" },
  toner: { discounted: "Rp102.990", original: "Rp257.475" },
  "skin-cream": { discounted: "Rp119.900", original: "Rp299.750" },
  "eye-cream": { discounted: "Rp74.990", original: "Rp187.500" },
  serum: { discounted: "Rp116.990", original: "Rp267.500" },
  mask: { discounted: "Rp15.000", original: "Rp37.500" },
  "full-series": { discounted: "Rp429.900", original: "Rp1.074.750" }
});
function verticalGeometry(layout, width, height) {
  const sx = width / 720;
  const sy = height / 1280;
  const scale = Math.min(sx, sy);
  const geometry = {
    "Center Hero": { productX: 55, productY: 92, productSize: 610, cardX: 80, cardY: 760, cardWidth: 560, cardHeight: 205, textAlign: "center", buttonX: 145, buttonY: 1010, buttonWidth: 430, buttonHeight: 82 },
    "Product Left / Price Right": { productX: -110, productY: 225, productSize: 610, cardX: 322, cardY: 385, cardWidth: 336, cardHeight: 245, textAlign: "left", buttonX: 322, buttonY: 690, buttonWidth: 336, buttonHeight: 82, eyebrowY: 340 },
    "Product Lower / Offer Upper": { productX: 50, productY: 425, productSize: 620, cardX: 82, cardY: 145, cardWidth: 556, cardHeight: 245, textAlign: "center", buttonX: 150, buttonY: 1050, buttonWidth: 420, buttonHeight: 82 },
    "Minimal Premium": { productX: 60, productY: 95, productSize: 600, cardX: 88, cardY: 745, cardWidth: 544, cardHeight: 230, textAlign: "left", buttonX: 88, buttonY: 1005, buttonWidth: 420, buttonHeight: 82, eyebrowY: 700 }
  };
  const g = geometry[layout];
  return {
    ...g,
    productX: Math.round(g.productX * sx),
    productY: Math.round(g.productY * sy),
    productSize: Math.round(g.productSize * scale),
    cardX: Math.round(g.cardX * sx),
    cardY: Math.round(g.cardY * sy),
    cardWidth: Math.round(g.cardWidth * sx),
    cardHeight: Math.round(g.cardHeight * sy),
    buttonX: Math.round(g.buttonX * sx),
    buttonY: Math.round(g.buttonY * sy),
    buttonWidth: Math.round(g.buttonWidth * sx),
    buttonHeight: Math.round(g.buttonHeight * sy),
    eyebrowY: g.eyebrowY === void 0 ? void 0 : Math.round(g.eyebrowY * sy)
  };
}
function roundedDistance(x, y, width, height, radius) {
  const dx = Math.abs(x - width / 2) - (width / 2 - radius);
  const dy = Math.abs(y - height / 2) - (height / 2 - radius);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius;
}
function writeRoundedSurface(path, width, height, rgb, opacity, radius, shadow) {
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
  (0, import_node_fs.writeFileSync)(path, pixels);
}
function writeGlassHalo(path, size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const dx = (x + 0.5 - size / 2) / (size / 2);
    const dy = (y + 0.5 - size / 2) / (size / 2);
    const radius = Math.hypot(dx, dy);
    const edge = Math.exp(-Math.pow((radius - 0.78) / 0.055, 2)) * 0.14;
    const center = Math.exp(-Math.pow(radius / 0.68, 2)) * 0.11;
    const glint = Math.exp(-Math.pow((dx + 0.31) / 0.14, 2) - Math.pow((dy + 0.37) / 0.3, 2)) * 0.12;
    const offset = (y * size + x) * 4;
    pixels[offset] = 255;
    pixels[offset + 1] = 221;
    pixels[offset + 2] = 183;
    pixels[offset + 3] = Math.round(Math.min(0.32, edge + center + glint) * 255);
  }
  (0, import_node_fs.writeFileSync)(path, pixels);
}
function textX(geometry, inset) {
  return geometry.textAlign === "center" ? `${geometry.cardX} + (${geometry.cardWidth}-text_w)/2` : String(geometry.cardX + inset);
}
function fade(start, duration = 0.28) {
  return `if(lt(t\\,${start})\\,0\\,if(lt(t\\,${start + duration})\\,(t-${start})/${duration}\\,1))`;
}
function filterPath(path) {
  return path.replace(/\\/g, "/").replace(":", "\\:");
}
async function renderCtaEndCard(request) {
  const { masterPath, outputPath, settings } = request;
  if (!(0, import_node_fs.existsSync)(masterPath) || !/\.png$/i.test(masterPath)) throw new Error(`Verified PNG product master missing: ${masterPath}`);
  if (!Number.isInteger(settings.duration) || settings.duration < 8 || settings.duration > 15) throw new Error("CTA duration must be an integer from 8 to 15 seconds.");
  const price = CTA_PRODUCT_PRICES[request.productId];
  const effectiveSettings = price ? { ...settings, price: price.discounted } : settings;
  const style = resolveCtaStyle(effectiveSettings, request.seed, request.previousStyle);
  const layout = resolveCtaLayout(request.seed);
  const lines = ctaLines(style, effectiveSettings, request.language);
  if (lines.some((line2) => !line2.trim() || /[\r\n]/.test(line2))) throw new Error("CTA text must be non-empty single-line copy.");
  const [ratioW, ratioH] = request.aspectRatio.split(":").map(Number);
  if (!ratioW || !ratioH || ratioW / ratioH > 3 || ratioH / ratioW > 3) throw new Error("Unsupported CTA aspect ratio.");
  const width = ratioW <= ratioH ? 720 : Math.round(720 * ratioW / ratioH / 2) * 2;
  const height = ratioW <= ratioH ? Math.round(720 * ratioH / ratioW / 2) * 2 : 720;
  const vertical = height > width;
  const geometry = vertical ? verticalGeometry(layout, width, height) : verticalGeometry("Product Left / Price Right", width, height);
  const palette = [
    { base: "fffaf5", glow: "f6e4d2", glow2: "f3d3b4", ink: "352b27", button: [174, 70, 35] },
    { base: "faf6f1", glow: "ecd9c6", glow2: "f2d9be", ink: "352b27", button: [53, 42, 37] },
    { base: "fffaf6", glow: "f4e0d0", glow2: "efd0b6", ink: "352b27", button: [174, 70, 35] },
    { base: "f9f6f2", glow: "ebe1d6", glow2: "eed5c4", ink: "352b27", button: [53, 42, 37] }
  ][CTA_LAYOUTS.indexOf(layout)];
  (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(outputPath), { recursive: true });
  const work = (0, import_node_fs.mkdtempSync)((0, import_node_path.join)((0, import_node_path.dirname)(outputPath), ".proya-cta-"));
  try {
    const regularFont = process.platform === "win32" ? "C\\:/Windows/Fonts/arial.ttf" : "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
    const boldFont = process.platform === "win32" ? "C\\:/Windows/Fonts/arialbd.ttf" : "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
    const buttonFile = (0, import_node_path.join)(work, "button.rgba");
    const cardFile = (0, import_node_path.join)(work, "card.rgba");
    const haloFile = (0, import_node_path.join)(work, "halo.rgba");
    const haloSize = Math.round(Math.min(width, height) * 0.66);
    writeGlassHalo(haloFile, haloSize);
    writeRoundedSurface(buttonFile, geometry.buttonWidth, geometry.buttonHeight, palette.button, 0.98, Math.round(geometry.buttonHeight / 2), 8);
    writeRoundedSurface(cardFile, geometry.cardWidth, geometry.cardHeight, [255, 254, 251], layout === "Minimal Premium" ? 0.82 : 0.92, 28, 14);
    const originalFile = (0, import_node_path.join)(work, "price-original.txt");
    const discountedFile = (0, import_node_path.join)(work, "price-discounted.txt");
    const actionFile = (0, import_node_path.join)(work, "price-action.txt");
    const eyebrowFile = (0, import_node_path.join)(work, "eyebrow.txt");
    const auxiliaryFile = (0, import_node_path.join)(work, "auxiliary.txt");
    const action = effectiveSettings.action || (request.language === "English" ? "Shop now" : "Cek sekarang");
    (0, import_node_fs.writeFileSync)(originalFile, price.original, "utf8");
    (0, import_node_fs.writeFileSync)(discountedFile, price.discounted, "utf8");
    (0, import_node_fs.writeFileSync)(actionFile, `${action}  \u2192`, "utf8");
    (0, import_node_fs.writeFileSync)(eyebrowFile, style === "Promo" && effectiveSettings.promo ? effectiveSettings.promo : request.language === "English" ? "SPECIAL OFFER" : "PENAWARAN SPESIAL", "utf8");
    const auxiliary = style === "Benefit" ? effectiveSettings.benefit : style === "Promo" ? effectiveSettings.promo : "";
    (0, import_node_fs.writeFileSync)(auxiliaryFile, auxiliary, "utf8");
    const originalSize = Math.round(Math.max(24, Math.min(31, geometry.cardWidth * 0.064)));
    const discountedSize = Math.round(Math.max(42, Math.min(73, geometry.cardWidth * (layout === "Product Left / Price Right" ? 0.14 : 0.13))));
    const actionSize = Math.round(Math.max(22, Math.min(34, geometry.buttonWidth / Math.max(10, [...`${action} \u2192`].length * 0.58))));
    const inset = Math.max(28, Math.round(geometry.cardWidth * 0.08));
    const originalY = geometry.cardY + Math.round(geometry.cardHeight * 0.27);
    const discountedY = geometry.cardY + Math.round(geometry.cardHeight * 0.47);
    const priceX = textX(geometry, inset);
    const strikeWidth = Math.round([...price.original].length * originalSize * 0.55);
    const strikeX = geometry.textAlign === "center" ? geometry.cardX + Math.round((geometry.cardWidth - strikeWidth) / 2) : geometry.cardX + inset;
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
    let label = "cta";
    if (geometry.eyebrowY !== void 0) {
      filters.push(`[${label}]drawtext=fontfile='${boldFont}':textfile='${filterPath(eyebrowFile)}':fontcolor=0xc85b25:fontsize=${Math.round(22 * width / 720)}:x=${layout === "Product Left / Price Right" ? geometry.cardX + inset : geometry.cardX}:y=${geometry.eyebrowY}:alpha='${fade(settings.duration * 0.12)}'[eyebrow]`);
      label = "eyebrow";
    }
    if (auxiliary) {
      const auxiliarySize = Math.round(Math.max(21, Math.min(29, geometry.cardWidth / Math.max(16, [...auxiliary].length * 0.54))));
      filters.push(`[${label}]drawtext=fontfile='${regularFont}':textfile='${filterPath(auxiliaryFile)}':fontcolor=0x6e4b3a:fontsize=${auxiliarySize}:x='${priceX}':y=${geometry.cardY + Math.round(geometry.cardHeight * 0.78)}:alpha='${fade(settings.duration * 0.4)}'[aux]`);
      label = "aux";
    }
    const temporaryOutput = (0, import_node_path.join)(work, "end-card.mp4");
    const sweepWidth = Math.max(90, Math.round(width * 0.18));
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=0x${palette.base}:s=${width}x${height}:r=24:d=${settings.duration}`,
      "-loop",
      "1",
      "-framerate",
      "24",
      "-i",
      (0, import_node_path.resolve)(masterPath),
      "-f",
      "lavfi",
      "-i",
      `gradients=s=${width}x${height}:r=24:d=${settings.duration}:c0=0x${palette.glow}:c1=0x${palette.base}:type=radial:speed=0.018`,
      "-f",
      "lavfi",
      "-i",
      `gradients=s=${width}x${height}:r=24:d=${settings.duration}:c0=0x${palette.base}:c1=0x${palette.glow2}:type=circular:speed=0.012`,
      "-f",
      "lavfi",
      "-i",
      `color=c=white@0.11:s=${sweepWidth}x${height}:r=24:d=${settings.duration},format=rgba,gblur=sigma=${Math.round(sweepWidth * 0.32)}`,
      "-stream_loop",
      "-1",
      "-f",
      "rawvideo",
      "-pixel_format",
      "rgba",
      "-video_size",
      `${geometry.cardWidth}x${geometry.cardHeight}`,
      "-framerate",
      "24",
      "-i",
      cardFile,
      "-stream_loop",
      "-1",
      "-f",
      "rawvideo",
      "-pixel_format",
      "rgba",
      "-video_size",
      `${geometry.buttonWidth}x${geometry.buttonHeight}`,
      "-framerate",
      "24",
      "-i",
      buttonFile,
      "-stream_loop",
      "-1",
      "-f",
      "rawvideo",
      "-pixel_format",
      "rgba",
      "-video_size",
      `${haloSize}x${haloSize}`,
      "-framerate",
      "24",
      "-i",
      haloFile,
      "-filter_complex",
      filters.join(";"),
      "-map",
      `[${label}]`,
      "-t",
      String(settings.duration),
      "-r",
      "24",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "17",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      temporaryOutput
    ];
    await new Promise((done, fail) => {
      const child = (0, import_node_child_process.spawn)(request.ffmpegPath ?? "ffmpeg", args, { cwd: work, windowsHide: true });
      let error = "";
      child.stderr.on("data", (chunk) => {
        error += String(chunk).slice(0, 8192);
      });
      child.on("error", fail);
      child.on("close", (code) => code === 0 ? done() : fail(new Error(`CTA FFmpeg failed (${code}): ${error}`)));
    });
    (0, import_node_fs.renameSync)(temporaryOutput, outputPath);
    return { path: (0, import_node_path.resolve)(outputPath), style, layout, size: (0, import_node_fs.statSync)(outputPath).size, sha256: (0, import_node_crypto.createHash)("sha256").update((0, import_node_fs.readFileSync)(outputPath)).digest("hex") };
  } finally {
    (0, import_node_fs.rmSync)(work, { recursive: true, force: true });
  }
}

// src/local-runner/store.ts
var import_node_fs2 = require("fs");
var import_node_module = require("module");
var import_node_path2 = require("path");
var { DatabaseSync } = (0, import_node_module.createRequire)(`${process.cwd()}/proya-local-runner-native.cjs`)("node:sqlite");
var now = () => (/* @__PURE__ */ new Date()).toISOString();
var LocalRunnerStore = class {
  constructor(path) {
    this.path = path;
    (0, import_node_fs2.mkdirSync)((0, import_node_path2.dirname)(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        bundle_hash TEXT NOT NULL,
        current_job_id TEXT,
        revision INTEGER NOT NULL,
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_assets (
        session_id TEXT NOT NULL REFERENCES sessions(id),
        asset_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size INTEGER NOT NULL,
        PRIMARY KEY(session_id, asset_id)
      );
      CREATE TABLE IF NOT EXISTS settings_versions (
        session_id TEXT NOT NULL REFERENCES sessions(id),
        version INTEGER NOT NULL,
        json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(session_id, version)
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        scheduler_key TEXT NOT NULL,
        phase TEXT NOT NULL,
        prompt_id TEXT,
        revision INTEGER NOT NULL,
        json TEXT NOT NULL,
        UNIQUE(session_id, scheduler_key)
      );
      CREATE TABLE IF NOT EXISTS job_events (
        revision INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        job_id TEXT,
        event_type TEXT NOT NULL,
        json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_runner_jobs_session_revision ON jobs(session_id, revision);
      CREATE INDEX IF NOT EXISTS idx_runner_events_session_revision ON job_events(session_id, revision);
    `);
  }
  path;
  database;
  transaction(operation) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const value = operation();
      this.database.exec("COMMIT");
      return value;
    } catch (reason) {
      this.database.exec("ROLLBACK");
      throw reason;
    }
  }
  event(sessionId, jobId, eventType, payload) {
    const result = this.database.prepare("INSERT INTO job_events(session_id,job_id,event_type,json,created_at) VALUES(?,?,?,?,?)").run(sessionId, jobId, eventType, JSON.stringify(payload), now());
    return Number(result.lastInsertRowid);
  }
  stageSession(session, assetRows) {
    return this.transaction(() => {
      const existing = this.getSession(session.sessionId);
      if (existing) {
        if (existing.bundleHash !== session.bundleHash) throw new Error("Session ID already exists with a different bundle hash.");
        return existing;
      }
      const revision = this.event(session.sessionId, null, "SESSION_STAGED", { bundleHash: session.bundleHash });
      const staged = { ...session, revision, updatedAt: now() };
      this.database.prepare("INSERT INTO sessions(id,status,bundle_hash,current_job_id,revision,json) VALUES(?,?,?,?,?,?)").run(staged.sessionId, staged.status, staged.bundleHash, staged.currentJobId, staged.revision, JSON.stringify(staged));
      const assetStatement = this.database.prepare("INSERT INTO session_assets(session_id,asset_id,product_id,path,sha256,size) VALUES(?,?,?,?,?,?)");
      for (const asset of assetRows) assetStatement.run(staged.sessionId, asset.id, asset.productId, asset.path, asset.sha256, asset.size);
      this.database.prepare("INSERT INTO settings_versions(session_id,version,json,created_at) VALUES(?,?,?,?)").run(staged.sessionId, staged.settingsVersion, JSON.stringify(staged.bundle.settings), staged.createdAt);
      return staged;
    });
  }
  getSession(id) {
    const row = this.database.prepare("SELECT json FROM sessions WHERE id=?").get(id);
    return row ? JSON.parse(row.json) : null;
  }
  stagingPersistence(sessionId) {
    const assets = this.database.prepare("SELECT COUNT(*) AS count FROM session_assets WHERE session_id=?").get(sessionId);
    const settings = this.database.prepare("SELECT version FROM settings_versions WHERE session_id=? ORDER BY version").all(sessionId);
    return { assetRecordCount: Number(assets.count), settingsVersions: settings.map((row) => Number(row.version)) };
  }
  currentSession() {
    const row = this.database.prepare("SELECT json FROM sessions ORDER BY revision DESC LIMIT 1").get();
    return row ? JSON.parse(row.json) : null;
  }
  listSessions() {
    return this.database.prepare("SELECT json FROM sessions ORDER BY revision DESC").all().map((row) => JSON.parse(row.json));
  }
  saveSession(session, eventType = "SESSION_UPDATED") {
    return this.transaction(() => {
      const revision = this.event(session.sessionId, session.currentJobId, eventType, session);
      const saved = { ...session, revision, updatedAt: now() };
      this.database.prepare("UPDATE sessions SET status=?,current_job_id=?,revision=?,json=? WHERE id=?").run(saved.status, saved.currentJobId, saved.revision, JSON.stringify(saved), saved.sessionId);
      return saved;
    });
  }
  saveSettings(sessionId, version, settings) {
    return this.transaction(() => {
      const session = this.getSession(sessionId);
      if (!session) throw new Error("Unknown session.");
      if (!Number.isSafeInteger(version) || version <= session.settingsVersion) throw new Error("Settings version must increase monotonically.");
      this.database.prepare("INSERT INTO settings_versions(session_id,version,json,created_at) VALUES(?,?,?,?)").run(sessionId, version, JSON.stringify(settings), now());
      const revision = this.event(sessionId, session.currentJobId, "SETTINGS_COMMITTED", { version });
      const saved = { ...session, settingsVersion: version, revision, updatedAt: now() };
      this.database.prepare("UPDATE sessions SET revision=?,json=? WHERE id=?").run(revision, JSON.stringify(saved), sessionId);
      return saved;
    });
  }
  getSettings(sessionId, version) {
    const row = this.database.prepare("SELECT json FROM settings_versions WHERE session_id=? AND version=?").get(sessionId, version);
    if (!row) throw new Error(`Settings version ${version} does not exist.`);
    return JSON.parse(row.json);
  }
  createJob(job) {
    return this.transaction(() => {
      const existing = this.database.prepare("SELECT json FROM jobs WHERE session_id=? AND scheduler_key=?").get(job.sessionId, job.schedulerKey);
      if (existing) return JSON.parse(existing.json);
      const revision = this.event(job.sessionId, job.jobId, "JOB_CREATED", { phase: job.phase, schedulerKey: job.schedulerKey });
      const created = { ...job, revision, updatedAt: now() };
      this.database.prepare("INSERT INTO jobs(id,session_id,scheduler_key,phase,prompt_id,revision,json) VALUES(?,?,?,?,?,?,?)").run(created.jobId, created.sessionId, created.schedulerKey, created.phase, created.promptId, created.revision, JSON.stringify(created));
      return created;
    });
  }
  updateJob(jobId, phase, update = {}) {
    return this.transaction(() => {
      const current = this.getJob(jobId);
      if (!current) throw new Error("Unknown job.");
      const revision = this.event(current.sessionId, current.jobId, `JOB_${phase}`, update);
      const timestamp = now();
      const saved = { ...current, ...update, phase, revision, updatedAt: timestamp, ...["COMPLETED", "FAILED"].includes(phase) && !update.completedAt ? { completedAt: current.completedAt ?? timestamp } : {} };
      this.database.prepare("UPDATE jobs SET phase=?,prompt_id=?,revision=?,json=? WHERE id=?").run(saved.phase, saved.promptId, saved.revision, JSON.stringify(saved), jobId);
      return saved;
    });
  }
  getJob(id) {
    const row = this.database.prepare("SELECT json FROM jobs WHERE id=?").get(id);
    return row ? JSON.parse(row.json) : null;
  }
  listJobs(sessionId, afterRevision = 0) {
    const rows = sessionId ? this.database.prepare("SELECT json FROM jobs WHERE session_id=? AND revision>? ORDER BY revision").all(sessionId, afterRevision) : this.database.prepare("SELECT json FROM jobs WHERE revision>? ORDER BY revision").all(afterRevision);
    return rows.map((row) => JSON.parse(row.json));
  }
  eventCount() {
    return Number(this.database.prepare("SELECT COUNT(*) AS count FROM job_events").get().count);
  }
  close() {
    this.database.close();
  }
};
function newPersistedSession(bundle, bundleHash, sessionDirectory) {
  const timestamp = now();
  return {
    sessionId: bundle.sessionId,
    status: "STAGED",
    bundleHash,
    bundle,
    sessionDirectory,
    productIndex: 0,
    contentTypeIndex: 0,
    cycleNumber: 1,
    cycleSeed: 1592639710,
    currentJobId: null,
    settingsVersion: bundle.initialSettingsVersion,
    stopAfterCurrent: false,
    stopNow: false,
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastError: null
  };
}

// src/local-runner/types.ts
var LOCAL_RUNNER_VERSION = "2.1.4-production.20260912";
var REQUIRED_QWEN_MODEL = "qwen/qwen3.8-27b";
var SESSION_BUNDLE_SCHEMA_VERSION = 1;
var LOCAL_COMFY_URL = "http://127.0.0.1:8188";
var LOCAL_LM_STUDIO_URL = "http://127.0.0.1:1234";
var DEFAULT_API_ADDRESS = "127.0.0.1";
var DEFAULT_API_PORT = 8787;
var DEFAULT_STATE_ROOT = String.raw`D:\AI Videos\.proya-auto`;
var DEFAULT_ARCHIVE_ROOT = String.raw`D:\AI Videos`;

// src/local-runner/staging.ts
var sha256 = (value) => (0, import_node_crypto2.createHash)("sha256").update(value).digest("hex");
function canonicalBundleHash(bundle) {
  const canonical = { ...bundle };
  delete canonical.bundleSha256;
  return sha256(JSON.stringify(canonical));
}
var SessionBundleConflictError = class extends Error {
};
function requireSafeName(value, label) {
  if (!value || (0, import_node_path3.basename)(value) !== value || value.includes("..") || /[\\/:*?"<>|]/.test(value)) throw new Error(`${label} is unsafe.`);
}
function imageDimensions(bytes, mimeType) {
  if (mimeType === "image/png") {
    if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Invalid PNG image signature.");
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (mimeType === "image/jpeg") {
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) throw new Error("Invalid JPEG image signature.");
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 255) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      offset += Math.max(2, length + 2);
    }
    throw new Error("JPEG dimensions could not be decoded.");
  }
  if (bytes.length < 30 || bytes.subarray(0, 4).toString("ascii") !== "RIFF" || bytes.subarray(8, 12).toString("ascii") !== "WEBP") throw new Error("Invalid WebP image signature.");
  const kind = bytes.subarray(12, 16).toString("ascii");
  if (kind === "VP8X") return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  throw new Error("Only extended WebP headers are supported for staging verification.");
}
function validateBundle(bundle, archiveRoot) {
  if (bundle.schemaVersion !== SESSION_BUNDLE_SCHEMA_VERSION) throw new Error(`Unsupported bundle schema version ${bundle.schemaVersion}.`);
  if (bundle.expectedRunnerVersion !== LOCAL_RUNNER_VERSION) throw new Error(`Bundle expects runner ${bundle.expectedRunnerVersion}; installed runner is ${LOCAL_RUNNER_VERSION}.`);
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(bundle.sessionId)) throw new Error("Session ID must be a UUID.");
  if (!bundle.selectedProducts.length || !bundle.selectedContentTypes.length) throw new Error("Bundle must select products and content types.");
  if (new Set(bundle.selectedProducts).size !== bundle.selectedProducts.length || new Set(bundle.selectedContentTypes).size !== bundle.selectedContentTypes.length) throw new Error("Bundle selections contain duplicates.");
  if (bundle.selectedContentTypes.some((type) => ![...h3ContentTypeOptions, ...legacyH3ContentTypes].includes(type))) throw new Error("Bundle contains an unsupported content type.");
  if (bundle.ordering.productOrder.length !== bundle.selectedProducts.length || bundle.ordering.productOrder.some((id) => !bundle.selectedProducts.includes(id))) throw new Error("Product order does not match product selection.");
  if (bundle.ordering.contentTypeOrder.length !== bundle.selectedContentTypes.length || bundle.ordering.contentTypeOrder.some((type) => !bundle.selectedContentTypes.includes(type))) throw new Error("Content order does not match content selection.");
  if ((0, import_node_path3.resolve)(bundle.archiveRoot).toLowerCase() !== (0, import_node_path3.resolve)(archiveRoot).toLowerCase()) throw new Error(`Archive root must be ${archiveRoot}.`);
  if (!/^[0-9a-f]{64}$/.test(bundle.bundleSha256) || canonicalBundleHash(bundle) !== bundle.bundleSha256) throw new Error("Bundle SHA-256 mismatch.");
  if (!bundle.systemPrompt.trim() || sha256(bundle.systemPrompt) !== bundle.systemPromptSha256.toLowerCase()) throw new Error("System prompt hash mismatch.");
  if (sha256(JSON.stringify(bundle.workflow)) !== bundle.workflowSha256.toLowerCase()) throw new Error("Workflow hash mismatch.");
  validateMiniMaxH3ApiWorkflowTemplate(bundle.workflow);
  if (bundle.selectedContentTypes.some(isNoProductVideo)) {
    if (!bundle.supportBRollWorkflow || !bundle.supportBRollWorkflowSha256) throw new Error("Support B-Roll requires the staged T2VA workflow.");
    if (sha256(JSON.stringify(bundle.supportBRollWorkflow)) !== bundle.supportBRollWorkflowSha256.toLowerCase()) throw new Error("Support B-Roll T2VA workflow hash mismatch.");
    validateMiniMaxH3T2VAApiWorkflowTemplate(bundle.supportBRollWorkflow);
  }
  const products2 = new Map(bundle.products.map((product) => [product.id, product]));
  const assets = new Map(bundle.assets.map((asset) => [asset.id, asset]));
  const bindings = new Map(bundle.productReferences.map((binding) => [binding.productId, binding.assetIds]));
  const productAssetsRequired = bundle.selectedContentTypes.some((contentType) => !isNoProductVideo(contentType));
  for (const id of bundle.selectedProducts) {
    const product = products2.get(id);
    if (!product) throw new Error(`Missing product metadata for ${id}.`);
    if (!productAssetsRequired) continue;
    const requiredPaths = [product.imagePath, ...product.referenceImagePaths ?? []].map((path) => path.replaceAll("\\", "/").toLowerCase());
    const assetIds = bindings.get(id);
    if (!assetIds?.length) throw new Error(`Missing product asset mapping for ${id}.`);
    const mapped = assetIds.map((assetId) => assets.get(assetId) ?? (() => {
      throw new Error(`Missing product asset ${assetId}.`);
    })());
    if (mapped.some((asset) => asset.productId !== id)) throw new Error(`Product ${id} references an asset owned by another product.`);
    for (const required of requiredPaths) if (!mapped.some((asset) => asset.sourcePath.replaceAll("\\", "/").toLowerCase() === required)) throw new Error(`Product ${id} is missing required verified master ${required}.`);
  }
}
function verifyArchiveWritable(archiveRoot) {
  (0, import_node_fs3.mkdirSync)(archiveRoot, { recursive: true });
  const probe = (0, import_node_path3.join)(archiveRoot, `.proya-shadow-write-${(0, import_node_crypto2.randomUUID)()}`);
  (0, import_node_fs3.writeFileSync)(probe, "shadow-readiness");
  (0, import_node_fs3.rmSync)(probe);
}
async function stageSessionBundle(bundle, dependencies) {
  validateBundle(bundle, dependencies.archiveRoot);
  const existing = dependencies.store.getSession(bundle.sessionId);
  const bundleHash = canonicalBundleHash(bundle);
  if (existing) {
    if (existing.bundleHash !== bundleHash) throw new SessionBundleConflictError("Session ID already exists with a different bundle hash.");
    return { staged: true, sessionId: existing.sessionId, revision: existing.revision, bundleHash, sessionDirectory: existing.sessionDirectory, mode: "shadow" };
  }
  if (bundle.selectedContentTypes.some((type) => !isCtaEndCard(type))) {
    const [comfy, lmStudio] = await Promise.all([dependencies.comfy.readiness(), dependencies.lmStudio.readiness()]);
    if (!comfy.ready) throw new Error(`ComfyUI unavailable: ${comfy.error}`);
    if (!lmStudio.ready) throw new Error(`LM Studio unavailable: ${lmStudio.error}`);
  }
  verifyArchiveWritable(dependencies.archiveRoot);
  const sessionsRoot = (0, import_node_path3.join)(dependencies.stateRoot, "sessions");
  (0, import_node_fs3.mkdirSync)(sessionsRoot, { recursive: true });
  const temporary = (0, import_node_path3.join)(sessionsRoot, `.stage-${bundle.sessionId}-${(0, import_node_crypto2.randomUUID)()}`);
  const destination = (0, import_node_path3.join)(sessionsRoot, bundle.sessionId);
  (0, import_node_fs3.mkdirSync)((0, import_node_path3.join)(temporary, "assets"), { recursive: true });
  (0, import_node_fs3.mkdirSync)((0, import_node_path3.join)(temporary, "logs"), { recursive: true });
  const assetRows = [];
  try {
    for (const asset of bundle.assets) {
      requireSafeName(asset.id, "Asset ID");
      requireSafeName(asset.filename, "Asset filename");
      const bytes = Buffer.from(asset.base64, "base64");
      if (bytes.length !== asset.size || sha256(bytes) !== asset.sha256.toLowerCase()) throw new Error(`Asset hash or size mismatch for ${asset.id}.`);
      const dimensions = imageDimensions(bytes, asset.mimeType);
      if (dimensions.width <= 0 || dimensions.height <= 0) throw new Error(`Asset ${asset.id} has invalid dimensions.`);
      const path = (0, import_node_path3.join)(temporary, "assets", `${asset.id}__${asset.filename}`);
      (0, import_node_fs3.writeFileSync)(path, bytes, { flush: true });
      if ((0, import_node_fs3.statSync)(path).size !== asset.size || sha256((0, import_node_fs3.readFileSync)(path)) !== asset.sha256.toLowerCase()) throw new Error(`Staged asset verification failed for ${asset.id}.`);
      assetRows.push({ id: asset.id, productId: asset.productId, path: (0, import_node_path3.join)(destination, "assets", `${asset.id}__${asset.filename}`), sha256: asset.sha256.toLowerCase(), size: asset.size });
    }
    (0, import_node_fs3.writeFileSync)((0, import_node_path3.join)(temporary, "manifest.json"), JSON.stringify({ ...bundle, assets: bundle.assets.map((asset) => ({ id: asset.id, productId: asset.productId, sourcePath: asset.sourcePath, filename: asset.filename, mimeType: asset.mimeType, size: asset.size, sha256: asset.sha256 })), bundleHash }, null, 2), { flush: true });
    (0, import_node_fs3.writeFileSync)((0, import_node_path3.join)(temporary, "workflow.json"), JSON.stringify(bundle.workflow, null, 2), { flush: true });
    if (bundle.supportBRollWorkflow) (0, import_node_fs3.writeFileSync)((0, import_node_path3.join)(temporary, "workflow-support-b-roll-t2va.json"), JSON.stringify(bundle.supportBRollWorkflow, null, 2), { flush: true });
    (0, import_node_fs3.writeFileSync)((0, import_node_path3.join)(temporary, "system-prompt.md"), bundle.systemPrompt, { flush: true });
    (0, import_node_fs3.renameSync)(temporary, destination);
    const session = dependencies.store.stageSession(newPersistedSession(bundle, bundleHash, destination), assetRows);
    return { staged: true, sessionId: session.sessionId, revision: session.revision, bundleHash, sessionDirectory: destination, mode: "shadow" };
  } catch (reason) {
    (0, import_node_fs3.rmSync)(temporary, { recursive: true, force: true });
    if (!dependencies.store.getSession(bundle.sessionId)) (0, import_node_fs3.rmSync)(destination, { recursive: true, force: true });
    throw reason;
  }
}

// src/local-runner/api.ts
function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}
async function body(request, maximumBytes = 128 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maximumBytes) throw new Error("Request body exceeds the staging limit.");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function createRunnerApi(runner2) {
  return (0, import_node_http.createServer)(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${runner2.address}:${runner2.port}`);
      const method = request.method ?? "GET";
      if (method === "GET" && url.pathname === "/proya/auto/capabilities") return json(response, 200, runner2.capabilities());
      if (method === "GET" && url.pathname === "/proya/auto/version") return json(response, 200, { version: runner2.capabilities().runnerVersion, mode: runner2.mode });
      if (method === "GET" && url.pathname === "/proya/auto/health") return json(response, 200, await runner2.health());
      if (method === "GET" && url.pathname === "/proya/auto/session/current") return json(response, 200, { session: runner2.currentSession() });
      const sessionMatch = method === "GET" ? url.pathname.match(/^\/proya\/auto\/session\/([0-9a-f-]+)$/i) : null;
      if (sessionMatch) {
        const session = runner2.session(sessionMatch[1]);
        return json(response, session ? 200 : 404, { session, persistence: session ? runner2.stagingPersistence(sessionMatch[1]) : null });
      }
      if (method === "GET" && url.pathname === "/proya/auto/jobs") {
        const afterRevision = Number(url.searchParams.get("afterRevision") ?? 0);
        return json(response, 200, { jobs: runner2.jobs(url.searchParams.get("sessionId") ?? void 0, Number.isSafeInteger(afterRevision) ? afterRevision : 0) });
      }
      if (method === "POST" && url.pathname === "/proya/auto/stage") return json(response, 201, await runner2.stage(await body(request)));
      if (method === "POST" && url.pathname === "/proya/auto/start") {
        if (runner2.mode === "shadow") return json(response, 405, { error: "Canary Start is disabled in shadow mode." });
        const input = await body(request);
        if (typeof input.sessionId !== "string" || typeof input.bundleHash !== "string") return json(response, 400, { error: "Start requires sessionId and bundleHash." });
        return json(response, 202, await runner2.startCanary(input.sessionId, input.bundleHash));
      }
      const settingsMatch = method === "POST" ? url.pathname.match(/^\/proya\/auto\/session\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\/settings$/i) : null;
      if (settingsMatch) {
        const input = await body(request);
        if (!Number.isSafeInteger(input.version) || Number(input.version) < 1 || !input.settings || typeof input.settings !== "object") return json(response, 400, { error: "Settings update requires a positive integer version and settings object." });
        return json(response, 200, { session: runner2.updateSettings(settingsMatch[1], Number(input.version), input.settings) });
      }
      const stopAfterMatch = method === "POST" ? url.pathname.match(/^\/proya\/auto\/session\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\/stop-after-current$/i) : null;
      if (stopAfterMatch) return json(response, 202, { session: runner2.requestStopAfterCurrent(stopAfterMatch[1]) });
      const stopNowMatch = method === "POST" ? url.pathname.match(/^\/proya\/auto\/session\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\/stop-now$/i) : null;
      if (stopNowMatch) return json(response, 202, { session: runner2.requestStopNow(stopNowMatch[1]) });
      const syncMatch = method === "POST" ? url.pathname.match(/^\/proya\/auto\/jobs\/([^/]+)\/laptop-synced$/) : null;
      if (syncMatch) {
        const input = await body(request);
        if (typeof input.path !== "string" || !input.path) return json(response, 400, { error: "Local output sync acknowledgement requires a path." });
        return json(response, 200, { job: runner2.acknowledgeLocalOutputSync(decodeURIComponent(syncMatch[1]), input.path) });
      }
      const artifactMatch = method === "GET" ? url.pathname.match(/^\/proya\/auto\/jobs\/([^/]+)\/artifact$/) : null;
      if (artifactMatch) {
        const job = runner2.jobs().find((candidate) => candidate.jobId === decodeURIComponent(artifactMatch[1]));
        if (!job || job.phase !== "COMPLETED" || !job.archivePath || !job.archiveSha256 || !(0, import_node_fs4.existsSync)(job.archivePath)) return json(response, 404, { error: "Completed job artifact not found." });
        const root = (0, import_node_path4.resolve)(runner2.archiveRoot);
        const path = (0, import_node_path4.resolve)(job.archivePath);
        const relation = (0, import_node_path4.relative)(root, path);
        if (!relation || relation.startsWith("..") || (0, import_node_path4.isAbsolute)(relation)) return json(response, 403, { error: "Artifact path is outside the authoritative archive." });
        const size = (0, import_node_fs4.statSync)(path).size;
        const match = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
        const start = match ? Number(match[1]) : 0;
        const end = match?.[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        if (start < 0 || end < start || start >= size) {
          response.writeHead(416, { "Content-Range": `bytes */${size}` });
          return response.end();
        }
        const headers = { "Content-Type": "video/mp4", "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes", "X-PROYA-SHA256": job.archiveSha256, "Cache-Control": "no-store" };
        if (match) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
        response.writeHead(match ? 206 : 200, headers);
        (0, import_node_fs4.createReadStream)(path, { start, end }).pipe(response);
        return;
      }
      if (url.pathname.startsWith("/proya/auto/")) return json(response, 405, { error: "Runner route or method is not enabled." });
      return json(response, 404, { error: "Not found." });
    } catch (reason) {
      return json(response, reason instanceof SessionBundleConflictError ? 409 : 400, { error: reason instanceof Error ? reason.message : String(reason) });
    }
  });
}

// src/local-runner/runner.ts
var import_node_crypto5 = require("crypto");
var import_node_path8 = require("path");

// src/domain/auto-h3.ts
function shuffled(values, random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function advanceAutoCursor(session, seed, random = Math.random) {
  const next = { ...session, currentJobId: null, contentTypeIndex: session.contentTypeIndex + 1 };
  if (next.contentTypeIndex < next.contentTypeOrder.length) return next;
  next.contentTypeIndex = 0;
  next.productIndex++;
  if (next.productIndex >= next.productOrder.length) {
    next.productIndex = 0;
    next.cycleNumber++;
    next.cycleSeed = seed;
    next.productOrder = session.shuffleProducts ? shuffled(session.selectedProducts, random) : [...session.selectedProducts];
  }
  next.contentTypeOrder = session.shuffleContentTypes ? shuffled(session.selectedContentTypes, random) : [...session.selectedContentTypes];
  return next;
}
function isTransientTransport(reason) {
  const message = reason instanceof Error ? `${reason.message} ${String(reason.cause ?? "")}` : String(reason);
  return /fetch failed|network|socket|disconnect|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|connection|timed?\s*out|timeout|\b5\d{2}\b/i.test(message);
}
function safeOutputComponent(value) {
  const safe = value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  return safe && !/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(safe) ? safe : `_${safe || "output"}`;
}

// src/domain/hook-archetype.ts
var HOOK_ARCHETYPE_WEIGHTS = {
  "Problem Only": 0.55,
  "Problem \u2192 After": 0.45
};
function selectHookArchetype(random = Math.random) {
  return random() < HOOK_ARCHETYPE_WEIGHTS["Problem Only"] ? "Problem Only" : "Problem \u2192 After";
}
var hookAppearanceThemes = {
  "eye-cream": {
    problem: "tired-looking dark under-eyes with a visible dark under-eye or eye-bag appearance and a naturally tired expression",
    after: "the same eye area looks more refreshed, rested, brighter, and fresher while retaining natural skin texture"
  },
  serum: {
    problem: "visible dark-spot appearance, dull-looking skin, and uneven-looking tone",
    after: "the complexion looks brighter, more even, and more radiant without impossible total removal of pigmentation"
  },
  cleanser: {
    problem: "just-washed skin with matte, dry-looking cheeks, a visibly tight uncomfortable expression, and a hand touching the face; show dryness without acne, rash, irritation, or strong redness",
    after: "the same cheeks look clean, fresh, soft, comfortable, and subtly hydrated with a natural moisture sheen rather than stripped"
  },
  toner: {
    problem: "dull, dehydrated-looking, tired skin immediately after cleansing",
    after: "the skin looks refreshed, hydrated, softly dewy, prepared, and comfortable"
  },
  "skin-cream": {
    problem: "dry-looking skin, rough-looking texture, and a tight or uncomfortable expression",
    after: "the skin looks moisturized, softer, more supple, and comfortable"
  },
  mask: {
    problem: "tired, stressed, warm or overheated-looking skin and a person wanting a calming skincare moment",
    after: "the same person looks refreshed and relaxed, with a calmer and soothed-looking appearance"
  },
  "full-series": {
    problem: "a familiar concern such as dull, dry, dehydrated, or tired-looking skin",
    after: "the same person looks healthier, fresher, more comfortable, and naturally radiant"
  }
};
var hookTransitionIdeas = [
  "a hand passing across the face",
  "a natural head turn and return",
  "a mirror wipe",
  "a towel briefly passing through frame",
  "the camera moving behind a foreground object",
  "a natural blink or head movement",
  "a clean match cut",
  "a subtle whip transition",
  "a restrained lighting transition",
  "a believable time-of-day transition"
];

// src/domain/h3-generation-brief.ts
var H3_SINGLE_SHOT_TIMING_CONTRACT = "TIMING CONTRACT\nThis is one continuous shot. Do not write numeric event times inside shot prose. Do not introduce timestamped events unless explicitly supplied by user. Describe progression chronologically with words such as begins, then, gradually, toward the end, and finally.";
var H3_REPAIR_CONTRACT = "When the validator reports an error, repair only the invalid portions of the final prompt. Remove invented quoted text and unauthorized speech; preserve exact literal text only when the source authorized it. For authorized visible dialogue, keep one stable (Sx) ID and an explicit vocal action in the same sentence as each <d> block; never convert visible dialogue to voiceover. As needed, remove numeric event times from shot prose, remove every undeclared reference label, preserve declared labels and their roles, and never create a new label number. Keep the one-shot chronology and all verified product facts.";
var H3_DETAIL_CONTRACT = "For REF2VA enhanced production, make the detailed description at least 350 English words (aim for 370\u2013400) using meaningful product-reference fidelity, spatial layout, physical texture behavior, camera path, and lighting continuity. Describe an observable cause, physical response, and settled visual result within the one shot; do not merely say the benefit is implied by lighting. This is a shot-design brief, not spoken copy. Do not pad with dialogue, claims, repeated adjectives, or irrelevant spectacle.";
var H3_NO_GENERATED_TEXT_CONSTRAINT = "NO readable text. NO typography, labels, words, letters, subtitles, captions, infographic wording, fake scientific writing, floating formulas, UI screens, or logos created by the model. Existing real packaging text from the authoritative product reference is allowed only when that real product is visible; never invent additional text.";
var productTextureGuidance = {
  cleanser: "Show actual cleanser texture: a creamy cleanser ribbon, dense soft foam, lather macro, or cleanser spreading with water.",
  toner: "Show actual toner texture: fine mist, clear watery droplets, hydration droplets on skin, or a lightweight watery texture.",
  serum: "Show actual serum texture: a translucent clear serum droplet or bead, a dropper releasing liquid, serum spreading across skin, or a glossy lightweight serum texture.",
  "eye-cream": "Show actual eye-cream texture: a small cream ribbon, silky cream texture, gentle spreading, or under-eye application texture.",
  "skin-cream": "Show actual skin-cream texture: a rich cream swirl or scoop, a cream smear, nourishing texture macro, or a soft glossy cream surface.",
  mask: "Show actual mask texture: soaked sheet fabric, clear essence droplets, hydrated fabric macro, or cooling watery essence.",
  "full-series": "Choose one unmistakable skincare texture such as foam, mist, clear serum, cream, or essence and show its physical behavior clearly."
};
var hookConcerns = {
  cleanser: "At a bathroom sink after washing, a person pats their face dry, then touches cheeks that feel dry and tight and visibly reacts to the uncomfortable stripped feeling.",
  toner: "A person studies tired, dull, dehydrated-looking skin in a mirror after cleansing and wants a refreshing hydration reset before the next skincare step.",
  serum: "A person notices visible dark spots, uneven-looking tone, or dull skin in a mirror, leans closer, and gently points to the concern.",
  "eye-cream": "A tired person notices dark under-eyes or eye bags in a mirror and gently checks the eye area with a fingertip.",
  "skin-cream": "A person feels dry, rough, tight, less supple skin on a cheek and checks it in the mirror, wanting moisture and comfort.",
  mask: "A tired, stressed, overheated-looking person checks their face in a mirror and pauses for a soothing, cooling moment.",
  "full-series": "A person checks a familiar skin concern in a bathroom mirror: dullness, dryness, or tired-looking skin. Make the specific concern clear through their expression and gesture."
};
var benefitVisualGuidance = {
  cleanser: "Show fresh, comfortable, clean-looking human skin after cleansing, with natural texture and no stripped, tight, irritated, or overly dry appearance.",
  toner: "Show tired or dehydrated-looking human skin becoming fresher, dewier, hydrated-looking, prepared, and comfortable only within the verified benefit list.",
  serum: "Show dull or uneven-looking human skin becoming brighter-looking, more radiant-looking, or more even-looking; show improved dark-spot appearance only because that benefit is verified for this serum.",
  "eye-cream": "Show a tired-looking under-eye area becoming more refreshed-looking, limited strictly to the verified eye-area appearance benefits.",
  "skin-cream": "Show dry-looking human skin becoming more moisturized-looking, soft, supple, comfortable, or use a restrained moisture-barrier support metaphor only within the verified benefits.",
  mask: "Show tired or stressed-looking human skin becoming calmer-looking and refreshed-looking, using a soothing, cooling, recovery feeling only where supported by the verified benefits.",
  "full-series": "Choose one product-specific verified result and show it through human skin or a restrained skincare visual metaphor; never combine or transfer claims between products."
};
var ingredientVisualGuidance = {
  cleanser: "Use cleanser formulation and ingredient education imagery: dense soft foam, creamy cleanser macro, water interaction, clean laboratory macro, or active-inspired particles interacting with a simplified skin surface.",
  toner: "Use toner formulation and ingredient education imagery: fine mist, clear watery droplets, hydration moving toward skin, clean laboratory macro, or active-inspired particles in a watery field.",
  serum: "Use serum formulation and ingredient education imagery: clear colorless serum droplets, lightweight serum texture, active-inspired particles, antioxidant-style particle interaction, simplified skin layers, or clean laboratory macro.",
  "eye-cream": "Use eye-cream formulation and ingredient education imagery: silky cream macro, a small cream ribbon, moisture interaction with a simplified skin surface, active-inspired particles, or clean laboratory macro.",
  "skin-cream": "Use cream formulation and ingredient education imagery: rich cream swirl, cream smear, moisture-barrier layer visualization, active-inspired particles, or clean laboratory macro.",
  mask: "Use mask formulation and ingredient education imagery: soaked sheet fibers, clear essence droplets, cooling watery texture, verified botanical macro, hydration interaction, or clean laboratory macro.",
  "full-series": "Choose one verified product-specific ingredient and one matching skincare formulation visualization; do not merge ingredients across products."
};
function hookDirection(product, brief, archetype) {
  const theme = hookAppearanceThemes[product.id];
  if (archetype === "Problem \u2192 After") return {
    concept: `A believable before-and-after moment: begin with ${theme.problem}, transition naturally, then show that ${theme.after}.`,
    visualHook: "Open directly on the same person noticing the clearly readable skin concern; establish the before state immediately without sound.",
    creativeArchetype: archetype,
    environment: "One ordinary bathroom or vanity setting maintained across the before and after, with empty counters and no toiletries, dispensers, containers, or bottles in view.",
    composition: "Keep the same person, face, relevant skin area, wardrobe, and framing recognizable across the transition; no product, package, bottle, or dispenser may appear, even blurred in the background or mirror.",
    cameraPath: "Steady close-up or gentle handheld move, one natural transition, then a stable after-state hold.",
    framing: "Human face close enough to compare the same skin area before and after, with a consistent mirror or sink context.",
    lightingStyle: "Soft natural bathroom light with restrained improvement; keep natural texture and avoid a retouched or perfect-skin result.",
    primaryMotion: "The person checks the concern, transitions naturally, and settles into the believable improved-looking state.",
    secondaryMotion: "Small facial reaction, breathing, and relaxed expression changes only.",
    materialEffect: "Real skin and ordinary bathroom surfaces; no face morphing, magic particles, or abstract transformation effects.",
    pacing: "Use roughly the first 35\u201350% for the problem, the middle for the transition, and the remaining 40\u201355% for a readable after state.",
    openingDevice: "Begin with the face and problem state in the first frame.",
    transitionLanguage: "Choose one restrained social-video transition from the allowed examples in the content contract.",
    endingDevice: "Hold the improved-looking state long enough to read; never reduce it to the final half-second.",
    audioCharacter: "Quiet natural room tone or restrained music; no invented speech."
  };
  const concern = hookConcerns[product.id];
  return {
    concept: concern,
    visualHook: "Open directly on the person noticing the skin concern; the expression and small gesture must read without sound.",
    creativeArchetype: archetype,
    environment: "Ordinary bathroom or vanity in natural light, with empty counters and no toiletries, dispensers, containers, or bottles in view.",
    composition: "Face and the relevant skin area dominate; keep every product, package, bottle, and dispenser out, including blurred background and mirror reflections.",
    cameraPath: "Simple steady close-up or gentle handheld move following the person and mirror reflection.",
    framing: "Human face close enough to recognize the specific concern, with a clear mirror context.",
    lightingStyle: "Soft natural bathroom light that reveals realistic skin texture without exaggeration.",
    primaryMotion: "The person notices, checks, and gently touches or points to the concern.",
    secondaryMotion: "Small natural facial reaction and breathing only.",
    materialEffect: "Real skin and ordinary bathroom surfaces; no abstract effects.",
    pacing: clean(brief.pacing, "Immediate, simple, and relatable."),
    openingDevice: "Begin with the face and concern in the first frame.",
    transitionLanguage: "Stay with the same human moment; do not turn into a product reveal.",
    endingDevice: "Hold the recognizable concern and curiosity with no product visible.",
    audioCharacter: "Quiet natural room tone or restrained music."
  };
}
function h3ContentTypeContract(product, contentType, hookArchetype = "Problem Only") {
  if (contentType === "Hook") return [
    "PERSON AND SKIN-CONCERN HOOK CONTRACT",
    `Internal Hook archetype: ${hookArchetype}.`,
    ...hookArchetype === "Problem \u2192 After" ? [
      `BEFORE appearance: ${hookAppearanceThemes[product.id].problem}.`,
      `AFTER appearance: ${hookAppearanceThemes[product.id].after}.`,
      "Show both states clearly, using the same person and same general setting. The change is cosmetic-looking and believable: never an instant medical cure, miraculous transformation, different person, heavily altered face, impossible perfect skin, or complete erasure of natural texture.",
      ...product.id === "cleanser" ? ["For Cleanser, communicate tight dryness through matte texture, fine dry-looking cheek detail, touch, and expression\u2014not acne, rash, irritation, or strong redness. Make the after state visibly softer and naturally moisture-comfortable."] : [],
      `Use one natural transition, for example ${hookTransitionIdeas.slice(0, 6).join(", ")}. No explosions, sci-fi, face morph, full-face magic particles, product reveal, or flashy luxury transition.`
    ] : [
      `Product-specific concern: ${hookConcerns[product.id]}`,
      "Focus entirely on the relatable problem. The person and recognizable problem are the primary subject from the first frame through the end. Show a believable mirror or sink moment, natural expression, and one clear gesture. The concern must be understandable on mute."
    ],
    "No product at any point: no bottle, pump bottle, dispenser, tube, jar, sachet, toiletries, packaging, logo, product reference, product hero shot, product reveal, or product in the background or mirror. Keep counters visually empty.",
    "No invented dialogue, medical claims, exaggerated skin damage, gimmicky text, or infographic overlays.",
    "NO readable text, captions, subtitles, logos, product labels, UI screens, or packaging of any kind."
  ];
  if (contentType === "Benefits" || contentType === "Ingredients") {
    const facts = verifiedContentFacts(product, contentType);
    const visualGuidance = contentType === "Benefits" ? benefitVisualGuidance[product.id] : ingredientVisualGuidance[product.id];
    return [
      `PRODUCT-FREE VERIFIED ${contentType.toUpperCase()} CONTRACT`,
      `Authoritative ${contentType.toLowerCase()} for ${product.officialName} ONLY: ${facts.join("; ")}.`,
      `Choose only from these exact product-specific facts. Do not add, expand, exaggerate, or borrow any ${contentType.toLowerCase()} from another product. Visual storytelling only; no medical claims or fake scientific labels.`,
      "The selected product is semantic fact guidance only. ZERO product references and ZERO visible product: no bottle, package, packshot, container, tube, jar, sachet, dispenser, label, logo, product hero, product reveal, product spinning, pedestal shot, packaging-first composition, or product B-roll, including in backgrounds and reflections.",
      visualGuidance,
      contentType === "Benefits" ? "Show the verified effect, result, experience, or a restrained visual metaphor. Prefer human skin close-ups, a believable before-and-after-style appearance change, hydrated skin macro, brighter-looking complexion, skin comfort, dewy skin, or subtle texture improvement. The visible result must come from observable skin or material change, not merely color grading or lighting." : "Make the ingredient, formulation texture, beauty-science interaction, or ingredient-to-skin visualization the subject. Prefer macro droplets, foam, mist, cream, serum, particles, simplified skin layers, and clean laboratory beauty imagery. Botanical or citrus imagery is allowed only when genuinely relevant to the verified ingredient list. Never drift into food, beverage, or generic luxury-product advertising.",
      contentType === "Ingredients" ? "No fake chemical formulas, molecular labels, ingredient labels, diagram wording, scientific UI, or invented scientific symbols." : "No written benefit claim, comparison label, before/after caption, or in-scene marketing copy.",
      H3_NO_GENERATED_TEXT_CONSTRAINT
    ];
  }
  if (contentType === "Product") return [
    "CLEAR PRODUCT FOOTAGE FIRST \u2014 PRODUCT CONTRACT",
    "The selected product is visible from FRAME 1 and remains the focal point for most of this single continuous shot. In whole-product hero shots, it occupies roughly 35\u201360% of frame height.",
    "Use practical skincare footage: clean hero, vanity or shelf, macro packaging or dropper detail, natural usage or dispensing, or a simple top-down shot. Keep it clean, believable, premium, and easy to cut into TikTok/Reels.",
    "No wall, door, curtain, darkness, transformation, sci-fi, environment-first, pedestal-rise, or particle reveal. No hidden entrance or product appearing halfway through. No architecture, sports-car, perfume, or luxury-reveal commercial treatment.",
    "Use a static camera, gentle push-in, short lateral slide, subtle handheld move, or small macro/parallax move. No orbit, fast rotation, aggressive sweep, extreme low angle, or depth-of-field hunting.",
    "Keep the product mostly front-facing and still. Preserve reference silhouette, color, closure, label hierarchy, and front-facing identity. Minimize perspective deformation, packaging motion blur, and side/back views.",
    "Packaging print is visual appearance inherited from the verified reference, not text to rewrite. Never invent package wording, extra labels, floating words, or graphics.",
    H3_NO_GENERATED_TEXT_CONSTRAINT
  ];
  if (contentType === "Product B-Roll") return [
    "PRACTICAL PRODUCT B-ROLL CONTRACT",
    "Create a practical, clean, natural, social-commerce insert designed to cut into a TikTok or Reels edit for one to three seconds. The authoritative product should normally remain visible and reference-faithful.",
    "Prefer a bathroom vanity, skincare shelf, clean countertop, simple sink setting, soft studio tabletop, top-down shot, macro packaging detail, natural pick-up or place-down, cap/pump/dropper detail, or appropriate dispensing action.",
    "Use a tripod, controlled handheld camera, small slider, simple macro move, or gentle push-in. Keep movement restrained and provide a stable edit point.",
    "Reject luxury automotive or perfume-ad language: no sports-car-commercial lighting, black glossy supercar stage, aggressive orbit, huge lens flare, excessive light streaks, sci-fi reveal, dramatic transformation, monumental architecture, or ultra-luxury spectacle.",
    "Preserve the product directly from the authoritative reference; do not redesign, transform, or approximate its packaging."
  ];
  if (contentType === "Educational") return [
    "TEXT-FREE EDUCATIONAL CONTRACT",
    "Create a visual explanation that remains understandable with zero text overlay. Product presence is optional when the visual explanation works better without it.",
    "Use only skincare visual cause and effect such as a skin-surface macro, dull-looking skin becoming visually brighter, hydration entering dry-looking skin, a moisture-barrier metaphor, cleansing oil or debris from pores, pigmentation particle dispersion, simplified skin layers, or ingredient particles interacting visually with skin.",
    H3_NO_GENERATED_TEXT_CONSTRAINT,
    "Do not ask H3 to spell anything or draw a written diagram. Any requested caption or subtitle belongs to a deterministic post-generation application overlay if one is available; it must not appear in the model-generated footage."
  ];
  if (contentType === "Ingredient / Texture") return [
    "SKINCARE INGREDIENT / TEXTURE CONTRACT",
    productTextureGuidance[product.id],
    "The actual skincare ingredient, texture, dispensing, foam, mist, cream, serum, droplet, or essence is the primary subject. The product may appear as useful context but does not need to dominate every shot.",
    "Ingredient-inspired alternatives may show vitamin-C-inspired citrus macro, translucent active-inspired particles, antioxidant particle visualization, water or hydration, botanical ingredient macro, bright citrus liquid, ingredient droplets, or clean laboratory-style skincare ingredients.",
    "Keep every visual unmistakably skincare/beauty-oriented. Do not drift into a food or beverage advertisement, random unrelated flowers, generic abstract luxury advertising, product transformation, chemistry text labels, fake ingredient names, or floating written formulas.",
    H3_NO_GENERATED_TEXT_CONSTRAINT
  ];
  return [];
}
function verifiedContentFacts(product, contentType) {
  const catalogProduct = getProduct(product.id);
  const facts = contentType === "Benefits" ? product.benefitTerritories : product.ingredients;
  const catalogFacts = contentType === "Benefits" ? catalogProduct?.benefitTerritories : catalogProduct?.ingredients;
  if (!Array.isArray(facts) || !facts.length || facts.some((fact) => typeof fact !== "string" || !fact.trim()) || !catalogFacts || JSON.stringify(facts) !== JSON.stringify(catalogFacts)) {
    throw new Error(`Verified ${contentType.toLowerCase()} are missing for ${product.id}; generation was not submitted.`);
  }
  return [...catalogFacts];
}
function clean(value, fallback) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}
function withoutSpeechDirection(value) {
  return value.replace(/\bmid-thought\b/gi, "mid-action").replace(/\bspoken gesture\b/gi, "visible gesture").replace(/\b(?:creator speech|creator voice|voice[ -]?over|narration|narrator|spoken|speech|dialogue|instructional voice|explanatory voice)\b/gi, "instrumental cue").replace(/\b(?:speaks?|talks?)\b/gi, "gestures").replace(/\s+/g, " ").trim();
}
var speechScopedTypes = /* @__PURE__ */ new Set(["Hook", "Benefits", "Ingredients", "Product", "Support B-Roll"]);
function userSpeechRequest(brief) {
  if (brief.musicOnly) return { mode: "none", request: "" };
  const directions = [brief.videoIdea, brief.specialInstructions];
  for (const direction of directions) {
    for (const sentence of direction.split(/[.!?;\n]+/).map((value) => value.trim()).filter(Boolean)) {
      const cue = /\b(voice[ -]?over|narrat(?:ion|or|e|es|ing)|off[ -]?screen voice|dialogue|spoken (?:line|words)|speaks?|says?|talks?)\b/i.exec(sentence);
      if (!cue) continue;
      const before = sentence.slice(0, cue.index);
      if (/\b(?:no|without|avoid|omit|never|do not|don't)\s+(?:(?:any|human|spoken|audible|generated)\s+){0,3}$/i.test(before)) continue;
      const mode = /voice[ -]?over|narrat|off[ -]?screen voice/i.test(cue[0]) ? "voiceover" : "visible-dialogue";
      return { mode, request: sentence };
    }
  }
  return { mode: "none", request: "" };
}
function directionFromGenome(brief, genome) {
  const fallback = clean(brief.videoIdea, "A controlled cinematic product reveal.");
  const direction = {
    concept: fallback,
    visualHook: clean(genome?.visualHook, "A tactile opening detail that resolves to the product."),
    creativeArchetype: clean(genome?.creativeArchetype, "Cinematic product reveal"),
    environment: clean(genome?.environment, "A clean, premium studio environment."),
    composition: clean(genome?.composition, "The product remains the clear visual anchor."),
    cameraPath: clean(genome?.cameraPath, "A deliberate forward camera move with a calm hero hold."),
    framing: clean(genome?.framing, "Medium-to-close product framing with safe breathing room."),
    lightingStyle: clean(genome?.lightingStyle, "Soft directional light with controlled specular highlights."),
    primaryMotion: clean(genome?.primaryMotion, "One legible product-centered motion."),
    secondaryMotion: clean(genome?.secondaryMotion, "Subtle environmental motion only."),
    materialEffect: clean(genome?.materialEffect, "A restrained material response that supports the product surface."),
    pacing: clean(genome?.pacing, brief.pacing),
    openingDevice: clean(genome?.openingDevice, "Open on the visual hook before the full package reveal."),
    transitionLanguage: clean(genome?.transitionLanguage, "One smooth transition into the hero composition."),
    endingDevice: clean(genome?.endingDevice, clean(brief.customEnding, brief.ending)),
    audioCharacter: clean(genome?.audioCharacter, clean(brief.sound, "Premium, restrained sound design."))
  };
  if (!brief.musicOnly) return direction;
  return Object.fromEntries(Object.entries(direction).map(([key, value]) => [key, withoutSpeechDirection(value)]));
}
function factDirection(product, factType, facts, brief, genome) {
  const matchingGenome = genome?.contentFamily === factType ? genome : null;
  if (matchingGenome) return directionFromGenome({ ...brief, videoIdea: `Create a product-free visual story using only the verified ${factType.toLowerCase()}: ${facts.join("; ")}.` }, matchingGenome);
  if (factType === "Benefits") return {
    concept: `Show one believable human skin result using only these verified benefits: ${facts.join("; ")}.`,
    visualHook: "Open directly on the relevant human skin appearance or experience; no product or packaging is visible.",
    creativeArchetype: "Human Skin Result",
    environment: "Simple daylight bathroom or beauty close-up with empty surfaces and no toiletries, containers, labels, or logos.",
    composition: "The same human skin area remains the primary subject throughout.",
    cameraPath: "Steady close-up or slow macro glide with no reveal choreography.",
    framing: "Close enough to read natural skin texture and the verified appearance result.",
    lightingStyle: "Consistent neutral beauty light; the result must not depend only on color or exposure change.",
    primaryMotion: "The relevant skin appearance changes gradually and believably within the verified benefit boundaries.",
    secondaryMotion: "Small natural expression, touch, or moisture-highlight changes only.",
    materialEffect: "Natural skin texture with a restrained skincare result, never an impossible or medical transformation.",
    pacing: "Readable starting state, gradual progression, and a stable result hold.",
    openingDevice: "Begin on the relevant skin state in the first frame.",
    transitionLanguage: "Use one continuous human or skin-macro progression without a product reveal.",
    endingDevice: "Hold the verified improved-looking result with natural texture intact.",
    audioCharacter: "Quiet natural ambience or restrained music without narration."
  };
  return {
    concept: `Create a product-free ingredient and formulation visualization using only these verified ingredients: ${facts.join("; ")}.`,
    visualHook: "Open on a skincare formulation macro, texture, or active-inspired interaction; no product or packaging is visible.",
    creativeArchetype: "Ingredient Education Macro",
    environment: "Clean laboratory beauty macro space without labels, formulas, UI, branding, containers, or packages.",
    composition: "The ingredient-inspired particles, formulation texture, or ingredient-to-skin interaction fills the frame.",
    cameraPath: "Controlled macro glide or microscopic follow move.",
    framing: "Extreme texture, droplet, foam, mist, cream, particle, or skin-layer detail.",
    lightingStyle: "Clean diffuse laboratory beauty light with restrained translucent highlights.",
    primaryMotion: "The verified-ingredient-inspired formulation interaction develops through observable physical stages.",
    secondaryMotion: "Small droplets, ripples, diffusion, foam, or surface response supports the main action.",
    materialEffect: ingredientVisualGuidance[product.id],
    pacing: "Simple educational progression with a stable final texture or interaction state.",
    openingDevice: "Begin directly on the formulation or ingredient-inspired interaction.",
    transitionLanguage: "Let physical diffusion, spreading, misting, foaming, or absorption carry the continuous shot.",
    endingDevice: "Hold the settled formulation or beauty-science interaction with no text or product.",
    audioCharacter: "Subtle liquid, foam, or clean laboratory ambience without narration."
  };
}
function conceptExposesSurface(brief, genome, surface) {
  const concept = [
    brief.videoIdea,
    brief.specialInstructions,
    genome?.openingDevice,
    genome?.cameraPath,
    genome?.primaryMotion,
    genome?.secondaryMotion,
    genome?.endingDevice
  ].filter(Boolean).join(" ").toLowerCase();
  if (surface === "rear") return /\b(rear|back|backside|reverse|turn(?:s|ed|ing)?|rotate|around|360)\b/.test(concept);
  return /\b(side|profile|lateral|turn(?:s|ed|ing)?|rotate|around|360)\b/.test(concept);
}
function correctionForProduct(product, brief, genome) {
  const corrections = [];
  if (product.id === "cleanser") corrections.push("Preserve the product geometry directly from <Picture 1>. It is a wide, gently tapered squeeze tube with a white base flip-cap and glossy opaque orange finish. Do not simplify it into a cylindrical bottle/tube or matte surface.");
  if (product.id === "toner") corrections.push("The orange bottle body is opaque; the protective outer cap is the only transparent component.");
  if (product.id === "serum") corrections.push("The bottle appears opaque/coated; any visible serum liquid is clear and colorless.");
  if (product.physicalIdentity.rearSurfaceAppearance.content === "blank" && conceptExposesSurface(brief, genome, "rear")) corrections.push("If the rear surface is revealed, preserve it as a blank continuation with no invented label, logo, barcode, or copy.");
  if (product.physicalIdentity.sideSurfaceAppearance.content === "blank" && conceptExposesSurface(brief, genome, "side")) corrections.push("If a side surface is revealed, preserve it as a blank continuation with no invented printed artwork.");
  return corrections;
}
function referencesFromPlan(plan, allowEmpty = false) {
  const mapped = buildH3ReferenceSlotMappings(plan).map((mapping) => ({
    pictureTag: mapping.pictureTag,
    slot: mapping.refImageIndex,
    role: referenceRole(mapping),
    description: clean(mapping.asset.description, referenceRole(mapping)),
    source: mapping.asset.source,
    subjectTag: isProductReferenceRole(mapping) ? "<Subject 1>" : void 0
  }));
  if (mapped.length > 0 || allowEmpty) return mapped;
  return [{
    pictureTag: "<Picture 1>",
    slot: 0,
    role: "product identity and packaging truth",
    description: "No product reference was selected. Ref2VA submission will be blocked until one is selected.",
    source: "none"
  }];
}
function isProductReferenceRole(mapping) {
  return mapping.role === "product-front" || mapping.role === "product-back" || mapping.role === "product-side";
}
function referenceRole(mapping) {
  if (isProductReferenceRole(mapping)) return "product identity and packaging truth";
  if (mapping.role === "style") return "optional look and lighting reference";
  return "additional visual reference";
}
function uniqueLabels(values) {
  return Array.from(new Set(values));
}
function buildH3ReferenceContract(references, mode = "REF2VA") {
  const connectedReferences = references.filter((reference) => reference.source !== "none");
  const subjectGroups = /* @__PURE__ */ new Map();
  for (const reference of connectedReferences) {
    if (!reference.subjectTag) continue;
    const group = subjectGroups.get(reference.subjectTag) ?? [];
    group.push(reference);
    subjectGroups.set(reference.subjectTag, group);
  }
  const subjects = Array.from(subjectGroups.entries());
  const allowedReferenceLabels = {
    subjects: uniqueLabels(subjects.map(([subjectTag]) => subjectTag)),
    pictures: uniqueLabels(connectedReferences.map((reference) => reference.pictureTag)),
    videos: [],
    audios: []
  };
  const mediaManifest = JSON.stringify({
    items: connectedReferences.map((reference) => ({
      type: "picture",
      role: reference.role,
      description: reference.description
    })),
    subjects: subjects.map(([subjectTag, subjectReferences], index) => ({
      id: Number(subjectTag.match(/\d+/)?.[0] ?? index + 1),
      description: `The selected product represented by ${subjectReferences.map((reference) => reference.pictureTag).join(" and ")}; preserve visible product identity from the connected pixels.`,
      sources: subjectReferences.map((reference) => reference.pictureTag)
    })),
    mode: mode.toLowerCase()
  }, null, 2);
  return { mediaManifest, allowedReferenceLabels };
}
function buildH3ReferenceContext(brief) {
  const referenceLines = brief.references.map((reference) => `${reference.pictureTag} \u2014 ${reference.role}: ${reference.description}`);
  const allowedLines = [
    "AUTHORITATIVE REFERENCE CONTRACT",
    `Allowed subject labels: ${brief.allowedReferenceLabels.subjects.join(", ") || "none"}`,
    `Allowed picture labels: ${brief.allowedReferenceLabels.pictures.join(", ") || "none"}`,
    isNoProductVideo(brief.contentType) ? "This job has no visible product identity reference. Keep all people, skin, props, particles, and environments in ordinary prose." : "Only the selected product may receive a reusable subject label; people, hands, props, and environments remain ordinary prose unless separately declared by a connected reference.",
    "Do not introduce any new subject or picture labels."
  ];
  const subjectDefinitions = brief.references.filter((reference) => reference.subjectTag).map((reference) => `${reference.subjectTag} is the selected product represented by ${reference.pictureTag}; preserve visible product identity from the connected pixels.`);
  return [...referenceLines, ...allowedLines, ...subjectDefinitions].join("\n");
}
function buildH3GenerationBrief(input) {
  const { product, brief } = input;
  const contentType = brief.contentType ?? "Cinematic Product Ad";
  const factType = contentType === "Benefits" || contentType === "Ingredients" ? contentType : null;
  const speech = speechScopedTypes.has(contentType) ? userSpeechRequest(brief) : void 0;
  const productIdeaFallback = "Show the reference-faithful product clearly from the first frame in a practical front-facing skincare shot.";
  const effectiveBrief = contentType === "Product" && !brief.videoIdea.trim() ? { ...brief, videoIdea: productIdeaFallback } : brief;
  const facts = factType ? verifiedContentFacts(product, factType) : [];
  const supportBRoll = isSupportBRoll(contentType);
  const noProduct = isNoProductVideo(contentType);
  const hookArchetype = contentType === "Hook" ? brief.hookArchetype ?? "Problem Only" : void 0;
  const suppliedReferencePlan = input.references ?? brief.references;
  const referencePlan = noProduct ? supportBRollReferencePlan(suppliedReferencePlan) : suppliedReferencePlan;
  const references = referencesFromPlan(referencePlan, noProduct);
  const workflowMode = noProduct ? "T2VA" : "REF2VA";
  const referenceContract = buildH3ReferenceContract(references, workflowMode);
  const rawCreativeDirection = factType ? factDirection(product, factType, facts, brief, input.genome ?? brief.creativeGenome) : contentType === "Hook" ? hookDirection(product, brief, hookArchetype) : directionFromGenome(effectiveBrief, input.genome ?? brief.creativeGenome);
  const creativeDirection = speech?.mode === "none" ? Object.fromEntries(Object.entries(rawCreativeDirection).map(([key, value]) => [key, withoutSpeechDirection(value)])) : rawCreativeDirection;
  const baseSpecialInstructions = factType ? `Only verified ${factType.toLowerCase()} for ${product.officialName}: ${facts.join("; ")}. The product is semantic fact guidance only. Ignore any user or creative direction that implies another claim, ingredient, package, product shot, product reveal, or readable text. Keep the footage entirely product-free.` : supportBRoll ? `${supportBRollGuardrails(product.id)}${brief.specialInstructions.trim() ? ` User direction: ${clean(brief.specialInstructions, "")}` : ""}` : contentType === "Hook" ? hookArchetype === "Problem \u2192 After" ? `Show a clear, believable progression from ${hookAppearanceThemes[product.id].problem} to ${hookAppearanceThemes[product.id].after}. Use the same person and setting. Keep sink and counter surfaces empty: no product, pump bottle, dispenser, toiletries, packaging, branding, or logo anywhere, including reflections.` : `${hookConcerns[product.id]} Keep the person and concern dominant through the entire shot. Keep sink and counter surfaces empty: no product, pump bottle, dispenser, toiletries, packaging, branding, or logo anywhere, including reflections.` : clean(brief.specialInstructions, "Preserve product identity and keep the action visually legible.");
  const textOnlyStyleNote = !factType && referencePlan.styleReference.source === "custom" && referencePlan.styleReference.description.trim() ? ` Text-only style direction (not a connected image): ${clean(referencePlan.styleReference.description, "keep the requested look and lighting direction")}` : "";
  return {
    schemaVersion: 1,
    workflowMode,
    product: product.id,
    contentType,
    contentFamily: contentType,
    ...hookArchetype ? { hookArchetype } : {},
    duration: brief.duration,
    aspectRatio: brief.aspectRatio === "Custom" ? "9:16" : brief.aspectRatio,
    language: brief.language,
    videoIdea: factType ? `Create a visual ${factType.toLowerCase()} story for ${product.officialName} using only: ${facts.join("; ")}.` : contentType === "Hook" ? rawCreativeDirection.concept : clean(effectiveBrief.videoIdea, supportBRoll ? `Create reusable skincare support footage about ${supportBRollTheme(product.id)}.` : "Create a polished product reveal."),
    creativeDirection,
    productCorrections: noProduct ? [] : correctionForProduct(product, brief, input.genome ?? brief.creativeGenome),
    references,
    mediaManifest: referenceContract.mediaManifest,
    allowedReferenceLabels: referenceContract.allowedReferenceLabels,
    musicOnly: brief.musicOnly,
    captions: brief.captions,
    subtitles: brief.subtitles,
    sound: brief.sound,
    specialInstructions: `${baseSpecialInstructions}${textOnlyStyleNote}`,
    ...speech ? { speechMode: speech.mode, speechRequest: factType ? "" : speech.request } : {}
  };
}
function line(label, value) {
  return `${label}: ${typeof value === "boolean" ? value ? "yes" : "no" : value}`;
}
function serializeH3GenerationBrief(brief) {
  const direction = brief.creativeDirection;
  const supportBRoll = isSupportBRoll(brief.contentType);
  const noProduct = isNoProductVideo(brief.contentType);
  const factType = brief.contentType === "Benefits" || brief.contentType === "Ingredients" ? brief.contentType : null;
  const textFreeContent = brief.contentType === "Educational" || brief.contentType === "Ingredient / Texture" || brief.contentType === "Benefits" || brief.contentType === "Ingredients" || brief.contentType === "Hook" || brief.contentType === "Product";
  const contentTypeContract = h3ContentTypeContract(getProduct(brief.product), brief.contentType, brief.hookArchetype);
  const workflowMode = noProduct ? "T2VA" : "REF2VA";
  const referenceLines = brief.references.map((reference) => `${reference.pictureTag} | ${reference.role} | ${reference.description}${reference.subjectTag ? ` | authoritative subject ${reference.subjectTag}` : ""}`);
  const correctionLines = brief.productCorrections.length > 0 ? brief.productCorrections : ["No additional product-specific correction is required."];
  const audioAndTextLines = [
    line("Music only", brief.musicOnly),
    line("Captions", brief.captions),
    line("Subtitles", brief.subtitles),
    line("Sound direction", brief.sound),
    brief.speechMode === "none" ? "SPEECH MODE: NONE. The user did not request spoken audio. No dialogue, voiceover, narration, speaker IDs, <d> blocks, quoted speech, or invented spoken lines. Dialogue language is metadata only and does not authorize speech." : brief.speechMode === "visible-dialogue" ? "SPEECH MODE: VISIBLE DIALOGUE. Keep the visible speaker on screen; never replace with voiceover or narration. Each <d> block needs the same stable (Sx) ID for that speaker and an explicit vocal action in the same sentence." : brief.speechMode === "voiceover" ? "SPEECH MODE: VOICEOVER. Only the explicitly requested off-screen speech is authorized." : brief.musicOnly ? "No dialogue, voiceover, narration, creator speech, or other human speech." : "Human speech is permitted only when explicitly requested by the creative direction.",
    ...brief.speechRequest ? [`User-authored speech direction: ${brief.speechRequest}`] : [],
    "Quotation marks denote literal source-authorized spoken or written words only. Never quote texture, ingredient, benefit, visual, or camera descriptions; soft fine foam, lightweight watery serum, hydrated skin appearance, and fine mist remain unquoted visual prose.",
    textFreeContent ? "Do not generate captions or any other readable text in the H3 footage. If captions were requested, reserve them for a deterministic post-generation application overlay if available." : brief.captions ? "Captions may be generated only when they are explicitly requested by the final H3 direction." : "No generated captions or marketing text overlays.",
    textFreeContent ? "Do not generate subtitles or speech transcription in the H3 footage. If subtitles were requested, reserve them for a deterministic post-generation application overlay if available." : brief.subtitles ? "Subtitles may be generated only when they are explicitly requested by the final H3 direction." : "No generated subtitles or speech transcription.",
    noProduct ? "There must be no visible product packaging or product text." : "Visible product packaging is not a generated caption or subtitle."
  ];
  return [
    `WORKFLOW MODE LOCK: ${workflowMode}.`,
    `Format the result as ${workflowMode}.`,
    "Do not switch generation modes.",
    "",
    "H3 GENERATION BRIEF",
    line("Workflow mode", `${workflowMode} (locked)`),
    line(noProduct ? "Semantic theme source" : "Product", brief.product),
    line("Content type", brief.contentType),
    ...brief.hookArchetype ? [line("Internal Hook archetype", brief.hookArchetype)] : [],
    line("Target duration seconds", brief.duration),
    line("Target aspect ratio", brief.aspectRatio),
    line("Dialogue language", brief.language),
    "",
    H3_SINGLE_SHOT_TIMING_CONTRACT,
    brief.contentType === "Hook" ? brief.hookArchetype === "Problem \u2192 After" ? "For T2VA, describe the problem, natural transition, and believable after state in one continuous shot. Keep the same person and setting, natural skin texture, and substantial time for both states; no product, packshot, or reference image." : "For T2VA production, describe the observable skin concern, human reaction, believable home setting, camera path, and lighting continuity in one continuous shot. Keep the face and problem prominent throughout; no product, packshot, or reference image." : H3_DETAIL_CONTRACT,
    "",
    ...contentTypeContract.length ? ["CONTENT TYPE CONTRACT", ...contentTypeContract, ""] : [],
    "CREATIVE DIRECTION",
    line("Concept", direction.concept),
    line("Visual hook", direction.visualHook),
    line("Archetype", direction.creativeArchetype),
    line("Environment", direction.environment),
    line("Composition", direction.composition),
    line("Camera path", direction.cameraPath),
    line("Framing", direction.framing),
    line("Lighting", direction.lightingStyle),
    line("Primary motion", direction.primaryMotion),
    line("Secondary motion", direction.secondaryMotion),
    line("Material response", direction.materialEffect),
    line("Pacing", direction.pacing),
    line("Opening device", direction.openingDevice),
    line("Transition language", direction.transitionLanguage),
    line("Ending device", direction.endingDevice),
    line("Audio character", direction.audioCharacter),
    "",
    "REFERENCE MAP",
    ...referenceLines,
    "",
    "ALLOWED REFERENCE LABELS",
    `Subjects: ${brief.allowedReferenceLabels.subjects.join(", ") || "none"}`,
    `Pictures: ${brief.allowedReferenceLabels.pictures.join(", ") || "none"}`,
    noProduct ? "No product or brand subject is declared. People, skin, props, particles, and environments remain ordinary prose." : "Only the selected product may receive a reusable subject label; people, hands, props, and environments remain ordinary prose unless separately declared by a connected reference.",
    "Only the declared labels above may appear in the final prompt. Do not introduce any new subject or picture labels.",
    "",
    supportBRoll ? "NON-PRODUCT SUPPORT B-ROLL CONTRACT" : brief.contentType === "Hook" ? "PRODUCT-FREE HUMAN HOOK CONTRACT" : factType ? `PRODUCT-FREE VERIFIED ${factType.toUpperCase()} AUTHORITY` : "PRODUCT / REFERENCE AUTHORITY",
    noProduct ? "The selected product is metadata for the skin-concern theme only; it must not appear visually." : "Reference pixels own the exact silhouette, proportions, cap or lid shape, printed front design, and surface appearance.",
    noProduct ? "Do not show a product, packaging, packshot, bottle, tube, jar, box, label, PROYA branding, logo, or fake product text." : "Qwen owns the scene, action, lighting, camera, pacing, sound, and H3 syntax.",
    supportBRoll ? "Create reusable human/lifestyle, skin beauty, science-animation, or abstract transition footage matching the selected archetype." : brief.contentType === "Hook" ? "Create a relatable human opening around the visible skin concern. Keep all product and packaging out of the entire shot, including the background." : factType ? `Use only the authoritative verified ${factType.toLowerCase()} listed in this brief. Show ${factType === "Benefits" ? "the visible result or experience" : "ingredient, formulation, texture, or beauty-science interaction"} without any product or packaging.` : "Preserve <Subject 1> exactly from <Picture 1>; use only the short product-specific correction below and do not reconstruct package geometry unnecessarily.",
    "",
    "PRODUCT CORRECTIONS",
    ...correctionLines.map((correction) => `- ${correction}`),
    "",
    "AUDIO AND TEXT",
    ...audioAndTextLines,
    "",
    "REPAIR CONTRACT",
    H3_REPAIR_CONTRACT,
    "",
    "SPECIAL INSTRUCTIONS",
    brief.specialInstructions
  ].join("\n");
}

// src/domain/auto-duration.ts
var AUTO_DURATION_MIN = 8;
var AUTO_DURATION_MAX = 15;
function selectAutoDuration(random = Math.random) {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError("Random duration source must return a value in [0, 1).");
  return AUTO_DURATION_MIN + Math.floor(value * (AUTO_DURATION_MAX - AUTO_DURATION_MIN + 1));
}

// src/local-runner/localhost-comfy.ts
var import_node_crypto3 = require("crypto");
function exactLocalOrigin(value, expected) {
  const url = new URL(value);
  if (url.origin !== expected || url.username || url.password) throw new Error(`Runner endpoint must be exactly ${expected}.`);
  return url.origin;
}
function errorText(reason) {
  return reason instanceof Error ? reason.message : String(reason);
}
var LocalComfyClient = class {
  constructor(mode = "shadow", fetchImpl = fetch, baseUrl = LOCAL_COMFY_URL) {
    this.mode = mode;
    this.fetchImpl = fetchImpl;
    this.baseUrl = exactLocalOrigin(baseUrl, LOCAL_COMFY_URL);
  }
  mode;
  fetchImpl;
  baseUrl;
  async request(path, init = {}) {
    const url = new URL(path, `${this.baseUrl}/`);
    if (url.origin !== LOCAL_COMFY_URL) throw new Error("Runner refused a non-local ComfyUI request.");
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if ((init.method ?? "GET") === "GET") {
      headers.set("Cache-Control", "no-cache, no-store");
      headers.set("Pragma", "no-cache");
    }
    const response = await this.fetchImpl(url, { ...init, headers, cache: "no-store" });
    const text = await response.text();
    let value = text;
    try {
      value = text ? JSON.parse(text) : {};
    } catch {
    }
    if (!response.ok) throw new Error(`${url.pathname} failed (${response.status}): ${typeof value === "string" ? value : JSON.stringify(value)}`);
    return { value, status: response.status, url: url.toString() };
  }
  objectInfo() {
    return this.request("/object_info");
  }
  queue() {
    return this.request(`/queue?proya_fresh=${crypto.randomUUID()}`);
  }
  history(promptId) {
    return this.request(promptId ? `/history/${encodeURIComponent(promptId)}?proya_fresh=${crypto.randomUUID()}` : `/history?proya_fresh=${crypto.randomUUID()}`);
  }
  systemStats() {
    return this.request(`/system_stats?proya_fresh=${crypto.randomUUID()}`);
  }
  view(query) {
    return this.request(`/view?${query.toString()}`);
  }
  uploadImage(body2) {
    return this.request("/upload/image", { method: "POST", body: body2 });
  }
  async prompt(_body) {
    void _body;
    if (this.mode === "shadow") throw new Error("SHADOW SAFETY: POST /prompt is forbidden.");
    throw new Error("Generation mode is not implemented in Phase 1.");
  }
  async free(_activeProductionWorkload = false) {
    void _activeProductionWorkload;
    if (this.mode === "shadow") throw new Error("SHADOW SAFETY: POST /free is forbidden.");
    throw new Error("Generation mode is not implemented in Phase 1.");
  }
  async readiness() {
    try {
      const [objectInfo, stats, queue] = await Promise.all([this.objectInfo(), this.systemStats(), this.queue()]);
      return { ready: true, checkedAt: (/* @__PURE__ */ new Date()).toISOString(), error: null, details: { objectInfoStatus: objectInfo.status, systemStatsStatus: stats.status, queueStatus: queue.status } };
    } catch (reason) {
      return { ready: false, checkedAt: (/* @__PURE__ */ new Date()).toISOString(), error: errorText(reason) };
    }
  }
  async reconcileIdentity(identity) {
    const [queue, history] = await Promise.all([this.queue(), this.history()]);
    const validId = (id) => typeof id === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id);
    const contains = (value) => typeof value === "string" ? value.includes(identity) : Array.isArray(value) ? value.some(contains) : Boolean(value && typeof value === "object" && Object.values(value).some(contains));
    for (const payload of [queue.value, history.value]) {
      if (!payload || typeof payload !== "object") continue;
      for (const [key, value] of Object.entries(payload)) {
        if (validId(key) && contains(value)) return key;
        if (Array.isArray(value)) {
          for (const item of value) if (Array.isArray(item) && validId(item[1]) && contains(item)) return item[1];
        }
      }
    }
    return null;
  }
  static submissionHash(body2) {
    return (0, import_node_crypto3.createHash)("sha256").update(JSON.stringify(body2)).digest("hex");
  }
};
var LocalLmStudioClient = class {
  constructor(fetchImpl = fetch, baseUrl = LOCAL_LM_STUDIO_URL) {
    this.fetchImpl = fetchImpl;
    this.baseUrl = exactLocalOrigin(baseUrl, LOCAL_LM_STUDIO_URL);
  }
  fetchImpl;
  baseUrl;
  async readiness() {
    const checkedAt = (/* @__PURE__ */ new Date()).toISOString();
    const unavailable = (error) => ({
      ready: false,
      checkedAt,
      error,
      details: { requiredModel: REQUIRED_QWEN_MODEL, available: false, matchedField: null, matchedValue: null }
    });
    try {
      const url = new URL("/api/v1/models", `${this.baseUrl}/`);
      const response = await this.fetchImpl(url, { headers: { Accept: "application/json", "Cache-Control": "no-cache, no-store" }, cache: "no-store" });
      if (!response.ok) throw new Error(`LM Studio model inspection failed (${response.status}).`);
      const payload = await response.json();
      const records = Array.isArray(payload) ? payload : payload && typeof payload === "object" ? [...Array.isArray(payload.data) ? payload.data : [], ...Array.isArray(payload.models) ? payload.models : []] : [];
      const identifierFields = ["key", "id", "model", "identifier", "model_key", "path"];
      let match = null;
      for (const entry of records) {
        if (!entry || typeof entry !== "object") continue;
        const item = entry;
        for (const field of identifierFields) {
          const value = item[field];
          if (typeof value === "string" && value === REQUIRED_QWEN_MODEL) {
            match = { field, value };
            break;
          }
        }
        if (match) break;
      }
      if (!match) return unavailable(`LM Studio does not list the exact required model ${REQUIRED_QWEN_MODEL}.`);
      return { ready: true, checkedAt, error: null, details: { requiredModel: REQUIRED_QWEN_MODEL, available: true, matchedField: match.field, matchedValue: match.value } };
    } catch (reason) {
      return unavailable(errorText(reason));
    }
  }
};

// src/local-runner/canary-executor.ts
var import_node_fs7 = require("fs");
var import_node_path7 = require("path");

// electron/main/auto-h3-transport.ts
var AmbiguousSubmissionError = class extends Error {
  constructor() {
    super("Submission acceptance is unknown. Reconciling the same job every 5 seconds; no replacement will be submitted.");
  }
};
async function submitExactlyOnce(post, reconcile) {
  try {
    return await post();
  } catch (error) {
    if (!isTransientTransport(error)) throw error;
    try {
      const adopted = await reconcile();
      if (adopted) return adopted;
    } catch {
    }
    throw new AmbiguousSubmissionError();
  }
}
function remoteJobIdentity(queue, history, identity) {
  const hasIdentity = (value) => {
    if (typeof value === "string") return value === identity || value.includes(`/${identity}`) || value.startsWith(`${identity}_`);
    if (Array.isArray(value)) return value.some(hasIdentity);
    if (value && typeof value === "object") return Object.values(value).some(hasIdentity);
    return false;
  };
  const validId = (id) => typeof id === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id);
  if (queue && typeof queue === "object") {
    for (const entries of Object.values(queue)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) if (Array.isArray(entry) && validId(entry[1]) && hasIdentity(entry)) return entry[1];
    }
  }
  if (history && typeof history === "object") {
    for (const [id, entry] of Object.entries(history)) if (validId(id) && hasIdentity(entry)) return id;
  }
  return null;
}

// electron/main/compute-provider.ts
var import_node_crypto4 = require("crypto");
var import_node_fs6 = require("fs");
var import_node_path6 = require("path");

// electron/main/reference-authorization.ts
var import_node_fs5 = require("fs");
var import_node_path5 = require("path");
var maxLocalReferenceUploadBytes = 25 * 1024 * 1024;

// electron/main/compute-provider.ts
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function asString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
var PROMPT_CLEANUP_MARKER = /\[PROYA_LLM_CLEANUP\]\s*(\{.*\})\s*$/s;
function promptCleanupAudit(message) {
  const match = PROMPT_CLEANUP_MARKER.exec(message);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[1]);
    if (!isRecord3(parsed)) return {};
    const requested = typeof parsed.unload_requested === "boolean" ? parsed.unload_requested : void 0;
    const succeeded = typeof parsed.unload_succeeded === "boolean" ? parsed.unload_succeeded : void 0;
    const error = asString(parsed.unload_error);
    const instanceId = asString(parsed.instance_id) ?? asString(parsed.llm_instance_id);
    const duration = asNumber(parsed.unload_duration_ms);
    return {
      ...requested === void 0 ? {} : { llmUnloadRequested: requested },
      ...succeeded === void 0 ? {} : { llmUnloadSucceeded: succeeded },
      ...parsed.unload_error === null ? { llmUnloadError: null } : error ? { llmUnloadError: error } : {},
      ...instanceId ? { llmInstanceId: instanceId } : {},
      ...duration === null ? {} : { llmUnloadDurationMs: duration }
    };
  } catch {
    return {};
  }
}
function promptGateFailureStage(message) {
  if (/\bPROMPT_VALIDATION_FAILED\b/i.test(message)) return "PROMPT_VALIDATION_FAILED";
  if (/\bLLM_UNLOAD_FAILED\b/i.test(message)) return "LLM_UNLOAD_FAILED";
  return null;
}
function isCanonicalComfyPromptId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) && value === value.toLowerCase();
}
function requireCanonicalComfyPromptId(value) {
  if (!isCanonicalComfyPromptId(value)) throw new Error("ComfyUI did not return a canonical prompt UUID. The local job cannot be tracked safely.");
  return value;
}
function errorMessage(reason) {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return "Unknown ComfyUI error";
  }
}
function classifyH3PromptEngineError(message) {
  const originalMessage = message.replace(PROMPT_CLEANUP_MARKER, "").trim();
  if (/\b(?:timed?\s*out|time\s*out|timeout|deadline\s+exceeded|client\s+disconnected|stopping\s+generation)\b/i.test(originalMessage)) {
    return "PROMPT_GENERATION_TIMEOUT";
  }
  if (/(?:connection\s+refused|cannot\s+reach|could\s+not\s+connect|connection\s+(?:reset|failed)|network\s+unavailable|model\s+(?:is\s+)?(?:not\s+found|unavailable|not\s+loaded)|(?:no|missing)\s+(?:active\s+|suitable\s+)?(?:chat\s+|prompt\s+)?model|returned\s+HTTP\s+[45]\d{2}|endpoint)/i.test(originalMessage)) {
    return "LLM_UNAVAILABLE";
  }
  return "PROMPT_GENERATION_FAILED";
}
function h3PromptEngineAudit(settings) {
  if (!settings) return {};
  const model = h3PromptEngineModelId;
  return {
    ...model ? { llmModel: model, llmModelId: model } : {},
    llmTemperature: settings.temperature,
    llmTimeoutSeconds: settings.timeoutSeconds,
    llmRepairAttempts: settings.repairAttempts,
    repairAttemptsConfigured: settings.repairAttempts,
    llmDisableThinking: settings.disableThinking,
    llmUnloadRequested: settings.unloadModelBeforeH3
  };
}
function h3PromptEngineErrorMessage(message, settings) {
  if (promptGateFailureStage(message)) return message;
  if (classifyH3PromptEngineError(message) !== "PROMPT_GENERATION_TIMEOUT") return message;
  const timeoutSeconds = settings?.timeoutSeconds ?? 600;
  return `Prompt generation exceeded the configured ${timeoutSeconds}-second timeout for the rewrite and repair attempts.`;
}
function physicalReferenceMap(request, referenceImages) {
  return (request.generationBrief?.references ?? []).filter((reference) => reference.source !== "none").map((reference, index) => ({
    ...reference,
    physicalInput: `ref_images.ref_image_${index}`,
    nodeId: minimaxH3ReferenceSlotMappings[index]?.nodeId ?? null,
    uploadedFilename: referenceImages[index] ?? null
  }));
}
function promptEngineStatus(_settings, overrides = {}) {
  const models = overrides.models ?? [];
  const targetAvailable = overrides.observedModelId === h3PromptEngineModelId || models.includes(h3PromptEngineModelId);
  const observedModelId = targetAvailable ? h3PromptEngineModelId : null;
  return {
    enhancerInstalled: false,
    validatorInstalled: false,
    requiredNodesInstalled: false,
    error: null,
    checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
    ...overrides,
    models: targetAvailable ? [h3PromptEngineModelId] : [],
    observedModelId,
    observedInstanceId: targetAvailable ? overrides.observedInstanceId ?? null : null,
    lmStudioConnected: Boolean(overrides.lmStudioConnected && targetAvailable),
    qwenReady: Boolean(overrides.qwenReady && targetAvailable),
    selectedModel: observedModelId
  };
}
function includesString(value, expected) {
  return Array.isArray(value) && value.some((item) => item === expected);
}
function hasPatchedPromptEngineSchema(objectInfo) {
  if (!isRecord3(objectInfo)) return false;
  const enhancer = objectInfo.MiniMaxH3PromptEnhancer;
  const unload = objectInfo.MiniMaxH3UnloadLMStudioModel;
  if (!isRecord3(enhancer) || !isRecord3(unload)) return false;
  const unloadInputOrder = isRecord3(unload.input_order) ? unload.input_order : {};
  return includesString(enhancer.output_name, "llm_model_id") && includesString(enhancer.output_name, "llm_instance_id") && includesString(unload.output_name, "instance_id") && includesString(unload.output_name, "unload_duration_ms") && includesString(unloadInputOrder.required, "instance_id");
}
function promptEngineModelNames(payload) {
  if (!isRecord3(payload) || !Array.isArray(payload.models)) return [];
  return payload.models.map((model) => {
    if (typeof model === "string") return model.trim();
    if (!isRecord3(model)) return "";
    return asString(model.key) ?? asString(model.id) ?? asString(model.model_id) ?? "";
  }).filter((model) => Boolean(model));
}
function parsePromptEngineDiscovery(payload) {
  const record = isRecord3(payload) ? payload : {};
  const models = promptEngineModelNames(payload);
  const explicitModel = [
    record.observed_model_id,
    record.observedModelId,
    record.model_id,
    record.modelId,
    record.selected_model,
    record.selectedModel
  ].map(asString).find((value) => Boolean(value)) ?? null;
  const targetAvailable = explicitModel === h3PromptEngineModelId || models.includes(h3PromptEngineModelId);
  const observedModelId = targetAvailable ? h3PromptEngineModelId : null;
  const observedInstanceId = targetAvailable && (explicitModel === null || explicitModel === h3PromptEngineModelId) ? [
    record.observed_instance_id,
    record.observedInstanceId,
    record.instance_id,
    record.instanceId
  ].map(asString).find((value) => Boolean(value)) ?? null : null;
  const routeError = asString(record.error);
  const error = routeError ?? (observedModelId ? null : `${h3PromptEngineModelId} is not available in LM Studio on this PC.`);
  return { models: targetAvailable ? [h3PromptEngineModelId] : [], observedModelId, observedInstanceId, error };
}
function isLocalFilesystemPath(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("/");
}
function pathWithin(root, target) {
  const relativePath = (0, import_node_path6.relative)((0, import_node_path6.resolve)(root), (0, import_node_path6.resolve)(target));
  return relativePath === "" || !relativePath.startsWith("..") && !(0, import_node_path6.isAbsolute)(relativePath);
}
function samePath(left, right) {
  const normalizedLeft = (0, import_node_path6.resolve)(left);
  const normalizedRight = (0, import_node_path6.resolve)(right);
  return process.platform === "win32" ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase() : normalizedLeft === normalizedRight;
}
function sanitizedSegment(value, fallback) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || fallback;
}
function referenceMimeType(filePath) {
  const extension = (0, import_node_path6.extname)(filePath).toLowerCase();
  if (extension === ".png") return { extension, mimeType: "image/png" };
  if (extension === ".jpg" || extension === ".jpeg") return { extension, mimeType: "image/jpeg" };
  if (extension === ".webp") return { extension, mimeType: "image/webp" };
  throw new Error("Reference upload rejected: only PNG, JPEG, and WebP images are supported.");
}
function remoteReferenceFilename(product, filePath, contents) {
  const slug = sanitizedSegment(product ?? "reference", "reference");
  const hash = (0, import_node_crypto4.createHash)("sha256").update(contents).digest("hex").slice(0, 16);
  return `PROYA_H3_REF_${slug}_${hash}${referenceMimeType(filePath).extension}`;
}
function combineComfyFilename(name, subfolder) {
  return subfolder ? `${subfolder.replace(/^[/\\]+|[/\\]+$/g, "")}/${name}` : name;
}
function normalizeComfyUrl(value) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("ComfyUI URL must use HTTP or HTTPS");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch (reason) {
    throw new Error(reason instanceof Error ? reason.message : "ComfyUI URL is invalid", { cause: reason });
  }
}
function endpointFor(baseUrl, path) {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  const separator = path.indexOf("?");
  const pathname = separator >= 0 ? path.slice(0, separator) : path;
  url.pathname = `${basePath}/${pathname.replace(/^\/+/, "")}`;
  url.search = separator >= 0 ? path.slice(separator + 1) : "";
  url.hash = "";
  return url.toString();
}
function isFreshControlPlaneGet(path, method) {
  if ((method ?? "GET").toUpperCase() !== "GET") return false;
  const pathname = path.split("?", 1)[0].replace(/^\/+/, "");
  return pathname === "queue" || pathname === "history" || pathname.startsWith("history/") || pathname === "system_stats";
}
function redactedControlPlaneUrl(value) {
  const url = new URL(value);
  return `<remote>${url.pathname}${url.search}`;
}
function websocketEndpointFor(baseUrl, clientId) {
  const url = new URL(endpointFor(baseUrl, "ws"));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.search = new URLSearchParams({ clientId }).toString();
  return url.toString();
}
function authHeaders(auth) {
  return auth.type === "bearer" ? { Authorization: `Bearer ${auth.token}` } : {};
}
function outputKind(key) {
  const lower = key.toLowerCase();
  if (lower.includes("video") || lower.includes("gif")) return "video";
  if (lower.includes("audio")) return "audio";
  if (lower.includes("image")) return "image";
  return key || "file";
}
function outputKindForCandidate(key, filename) {
  const lower = key.toLowerCase();
  if (lower.includes("video") || lower.includes("gif") || /\.(mp4|webm|mov|mkv|avi|gif)$/i.test(filename)) return "video";
  return outputKind(key);
}
function createOutputUrl(baseUrl, output) {
  const url = new URL(endpointFor(baseUrl, "view"));
  url.search = new URLSearchParams({ filename: output.filename, subfolder: output.subfolder, type: output.type }).toString();
  return url.toString();
}
function extractComfyOutputs(baseUrl, outputs) {
  if (!isRecord3(outputs)) return [];
  const found = [];
  const seen = /* @__PURE__ */ new Set();
  for (const [nodeId, nodeOutput] of Object.entries(outputs)) {
    if (!isRecord3(nodeOutput)) continue;
    for (const [key, value] of Object.entries(nodeOutput)) {
      const candidates = Array.isArray(value) ? value : [value];
      for (const candidate of candidates) {
        if (!isRecord3(candidate)) continue;
        const filename = asString(candidate.filename) ?? asString(candidate.name);
        if (!filename) continue;
        const output = {
          nodeId,
          kind: outputKindForCandidate(key, filename),
          filename,
          subfolder: asString(candidate.subfolder) ?? "",
          type: asString(candidate.type) ?? "output",
          url: ""
        };
        output.url = createOutputUrl(baseUrl, output);
        const identity = `${output.nodeId}:${output.kind}:${output.filename}:${output.subfolder}:${output.type}`;
        if (!seen.has(identity)) {
          seen.add(identity);
          found.push(output);
        }
      }
    }
  }
  return found;
}
function findComfyVideoOutputs(outputs, preferredNodeId = "92") {
  const videos = outputs.filter((output) => output.kind === "video");
  const preferred = videos.filter((output) => output.nodeId === preferredNodeId);
  return preferred.length > 0 ? preferred : videos;
}
function queueItemPromptId(item) {
  if (Array.isArray(item)) return asString(item[1]);
  if (isRecord3(item)) return asString(item.prompt_id);
  return null;
}
function queueItemNumber(item) {
  if (Array.isArray(item)) return asNumber(item[0]);
  if (isRecord3(item)) return asNumber(item.number);
  return null;
}
function findHistoryEntry(payload, remotePromptId) {
  if (!isRecord3(payload)) return null;
  const direct = payload[remotePromptId];
  if (isRecord3(direct)) return direct;
  if (Array.isArray(payload.history)) {
    const entry = payload.history.find((item) => isRecord3(item) && item.prompt_id === remotePromptId);
    return isRecord3(entry) ? entry : null;
  }
  return payload.prompt_id === remotePromptId ? payload : null;
}
function historyEntries(payload) {
  if (!isRecord3(payload)) return [];
  const entries = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (promptId, entry) => {
    if (!isCanonicalComfyPromptId(promptId) || !isRecord3(entry) || seen.has(promptId)) return;
    seen.add(promptId);
    entries.push({ promptId, entry });
  };
  for (const [promptId, entry] of Object.entries(payload)) add(promptId, entry);
  if (Array.isArray(payload.history)) {
    for (const entry of payload.history) if (isRecord3(entry)) add(entry.prompt_id, entry);
  }
  add(payload.prompt_id, payload);
  return entries;
}
function findHistoryEntryByIdentity(payload, identity, baseUrl) {
  const needle = identity.trim();
  if (!needle) return null;
  for (const candidate of historyEntries(payload)) {
    const outputs = extractComfyOutputs(baseUrl, candidate.entry.outputs);
    const exactOutput = outputs.some((output) => output.kind === "video" && output.filename.includes(needle));
    let serialized = "";
    try {
      serialized = JSON.stringify(candidate.entry);
    } catch {
    }
    if (exactOutput || serialized.includes(needle)) return candidate;
  }
  return null;
}
function historyError(entry) {
  const executionError = entry.execution_error;
  if (typeof executionError === "string" && executionError.trim()) return executionError.trim();
  if (isRecord3(executionError)) {
    const message = asString(executionError.exception_message) ?? asString(executionError.message);
    if (message) return message;
  }
  const status = entry.status;
  const statusRecord = isRecord3(status) ? status : null;
  const statusText = (asString(statusRecord?.status_str) ?? (typeof status === "string" ? status : "")).toLowerCase();
  if (Array.isArray(statusRecord?.messages)) {
    for (const message of statusRecord.messages) {
      if (!Array.isArray(message)) continue;
      const detail = isRecord3(message[1]) ? message[1] : null;
      const text = asString(detail?.exception_message) ?? asString(detail?.message);
      if (text && String(message[0]).toLowerCase().includes("error")) return text;
    }
  }
  if (statusText.includes("error") || statusText.includes("fail") || statusText.includes("interrupt") || statusText.includes("cancel")) return statusText;
  return null;
}
function historyStatus(entry) {
  const status = entry.status;
  const statusRecord = isRecord3(status) ? status : null;
  const statusText = (asString(statusRecord?.status_str) ?? (typeof status === "string" ? status : "")).toLowerCase();
  const execInfo = isRecord3(statusRecord?.exec_info) ? statusRecord.exec_info : null;
  const queueRemaining = asNumber(execInfo?.queue_remaining);
  const completed = statusRecord?.completed === true || ["success", "complete", "completed"].includes(statusText);
  if (completed) return { status: "completed", progress: 1, queueRemaining };
  if (statusText.includes("running") || statusText.includes("executing") || entry.execution_start_time !== void 0) return { status: "running", progress: null, queueRemaining };
  return { status: "queued", progress: null, queueRemaining };
}
function parseComfySystemStats(payload, url, latencyMs) {
  if (!isRecord3(payload)) throw new Error("ComfyUI system stats did not return a JSON object");
  const root = payload;
  const system = isRecord3(root.system) ? root.system : {};
  const cuda = isRecord3(root.cuda) ? root.cuda : {};
  const devices = Array.isArray(root.devices) && isRecord3(root.devices[0]) ? root.devices[0] : {};
  const comfyVersion = asString(system.comfyui_version) ?? asString(root.comfyui_version) ?? asString(root.version);
  const gpuName = asString(devices.name) ?? asString(cuda.gpu) ?? asString(cuda.name) ?? asString(root.gpu);
  const vramTotalBytes = asNumber(devices.vram_total) ?? asNumber(cuda.vram_total) ?? asNumber(root.vram_total);
  const vramFreeBytes = asNumber(devices.vram_free) ?? asNumber(cuda.vram_free) ?? asNumber(root.vram_free);
  return { connected: true, url, comfyVersion, gpuName, vramTotalBytes, vramFreeBytes, latencyMs };
}
function wait(milliseconds, signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolveWait) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolveWait();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}
function statusRank(status) {
  return { preparing: 0, uploading_reference: 0, submitted: 0, queued: 1, running: 2, completed: 3, failed: 3, error: 3 }[status];
}
function pipelineStageForNode(nodeId) {
  if (nodeId === "149") return "WRITING_PROMPT";
  if (nodeId === "150" || nodeId === "151") return "VALIDATING_PROMPT";
  if (nodeId === "152") return "UNLOADING_LLM";
  if (nodeId === "136" || nodeId === "125" || nodeId === "127" || nodeId === "128" || nodeId === "129" || nodeId === "130" || nodeId === "131" || nodeId === "92") return "GENERATING_H3";
  return void 0;
}
function firstString(value, preferredKeys = []) {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item, preferredKeys);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord3(value)) return null;
  for (const key of preferredKeys) {
    const found = firstString(value[key], preferredKeys);
    if (found) return found;
  }
  for (const item of Object.values(value)) {
    const found = firstString(item, preferredKeys);
    if (found) return found;
  }
  return null;
}
function repairAttemptsFromOutput(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = repairAttemptsFromOutput(item);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value === "string") {
    try {
      return repairAttemptsFromOutput(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!isRecord3(value)) return null;
  for (const key of ["repairAttemptsUsed", "repair_attempts_used"]) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  for (const key of ["manifest", "enhancement_manifest", "enhancementManifest"]) {
    const found = repairAttemptsFromOutput(value[key]);
    if (found !== null) return found;
  }
  for (const item of Object.values(value)) {
    const found = repairAttemptsFromOutput(item);
    if (found !== null) return found;
  }
  return null;
}
function outputSlot(value, slot) {
  if (Array.isArray(value)) return value[slot];
  if (!isRecord3(value)) return void 0;
  for (const key of ["result", "output"]) {
    const result = value[key];
    if (Array.isArray(result)) return result[slot];
  }
  return void 0;
}
function textSlot(value, slot) {
  if (Array.isArray(value)) return value[slot];
  if (!isRecord3(value) || !Array.isArray(value.text)) return void 0;
  return value.text[slot];
}
function finiteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}
function serializedOutput(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value === null || value === void 0) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}
function parseJsonRecord(value) {
  if (isRecord3(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parseJsonRecord(item);
      if (parsed) return parsed;
    }
    return null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return isRecord3(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function structuredOutput(value) {
  if (!isRecord3(value)) return null;
  for (const key of ["proya_h3_structured_output", "h3_structured_output", "structured_output"]) {
    const parsed = parseJsonRecord(value[key]);
    if (parsed) return parsed;
  }
  if (["enhanced_prompt", "enhancement_manifest", "repair_attempts_used", "prompt", "valid", "validation_report", "unload_requested", "unload_succeeded", "instance_id", "llm_instance_id"].some((key) => key in value)) return value;
  const ui = value.ui;
  return isRecord3(ui) ? structuredOutput(ui) : null;
}
function executionMetadata(outputs) {
  if (!isRecord3(outputs)) return {};
  const enhancerOutput = outputs["149"];
  const validatorOutput = outputs["150"];
  const unloadOutput = outputs["152"];
  const enhancerStructured = structuredOutput(enhancerOutput);
  const validatorStructured = structuredOutput(validatorOutput);
  const unloadStructured = structuredOutput(unloadOutput);
  const structuredPrompt = asString(enhancerStructured?.enhanced_prompt) ?? asString(enhancerStructured?.enhancedPrompt) ?? asString(validatorStructured?.prompt);
  const fallbackPrompt = asString(outputSlot(enhancerOutput, 0)) ?? asString(outputSlot(validatorOutput, 0)) ?? asString(textSlot(validatorOutput, 0));
  const finalEnhancedPrompt = structuredPrompt ?? fallbackPrompt;
  const structuredValidationReport = serializedOutput(validatorStructured?.validation_report) ?? serializedOutput(validatorStructured?.validationReport);
  const fallbackValidationReport = asString(outputSlot(validatorOutput, 2)) ?? asString(textSlot(validatorOutput, 1));
  const validationReport = structuredValidationReport ?? fallbackValidationReport;
  const structuredRepairAttempts = repairAttemptsFromOutput(enhancerStructured);
  const fallbackRepairAttempts = repairAttemptsFromOutput(enhancerOutput);
  const repairAttemptsUsed = structuredRepairAttempts ?? fallbackRepairAttempts ?? (enhancerOutput !== void 0 ? 0 : null);
  const enhancementManifest = serializedOutput(enhancerStructured?.enhancement_manifest) ?? serializedOutput(enhancerStructured?.enhancementManifest);
  const manifestRecord = parseJsonRecord(enhancerStructured?.enhancement_manifest) ?? parseJsonRecord(enhancerStructured?.enhancementManifest) ?? parseJsonRecord(outputSlot(enhancerOutput, 2));
  const reportedModelId = asString(enhancerStructured?.model_id) ?? asString(enhancerStructured?.llm_model_id) ?? asString(enhancerStructured?.observed_model_id) ?? asString(enhancerStructured?.modelId) ?? asString(manifestRecord?.model_id) ?? asString(manifestRecord?.modelId) ?? asString(outputSlot(enhancerOutput, 8));
  const observedModelId = reportedModelId === h3PromptEngineModelId ? h3PromptEngineModelId : null;
  const observedInstanceId = reportedModelId && reportedModelId !== h3PromptEngineModelId ? null : asString(enhancerStructured?.model_instance_id) ?? asString(enhancerStructured?.llm_instance_id) ?? asString(enhancerStructured?.observed_instance_id) ?? asString(enhancerStructured?.instance_id) ?? asString(enhancerStructured?.modelInstanceId) ?? asString(manifestRecord?.model_instance_id) ?? asString(manifestRecord?.modelInstanceId) ?? asString(outputSlot(enhancerOutput, 9));
  const rewriteDiagnostics = serializedOutput(enhancerStructured?.rewrite_diagnostics) ?? serializedOutput(enhancerStructured?.rewriteDiagnostics);
  const structuredUnloadSucceeded = outputBoolean(unloadStructured?.unload_succeeded, ["unload_succeeded", "unloaded", "success"]) ?? outputBoolean(unloadStructured?.unloadSucceeded, ["unload_succeeded", "unloaded", "success"]);
  const structuredUnloadRequested = outputBoolean(unloadStructured?.unload_requested, ["unload_requested", "requested"]);
  const fallbackUnloadSucceeded = outputBoolean(outputSlot(unloadOutput, 3), ["unload_succeeded", "unloaded", "success"]);
  const unloadSucceeded = unloadStructured ? structuredUnloadSucceeded : fallbackUnloadSucceeded;
  const unloadError = unloadStructured ? asString(unloadStructured.unload_error) ?? asString(unloadStructured.unloadError) : asString(outputSlot(unloadOutput, 4));
  const unloadInstanceId = unloadStructured ? asString(unloadStructured.instance_id) ?? asString(unloadStructured.llm_instance_id) ?? asString(unloadStructured.instanceId) : asString(outputSlot(unloadOutput, 5));
  const llmInstanceId = unloadInstanceId ?? observedInstanceId;
  const llmUnloadDurationMs = unloadStructured ? finiteNumber(unloadStructured.unload_duration_ms) ?? finiteNumber(unloadStructured.llm_unload_duration_ms) : finiteNumber(outputSlot(unloadOutput, 6));
  return {
    ...finalEnhancedPrompt ? { finalEnhancedPrompt } : {},
    ...validationReport ? { validationReport } : {},
    ...repairAttemptsUsed !== null ? { repairAttemptsUsed } : {},
    ...enhancementManifest ? { enhancementManifest } : {},
    ...observedModelId === h3PromptEngineModelId ? { lmStudioModelId: h3PromptEngineModelId, llmModelId: h3PromptEngineModelId, llmModel: h3PromptEngineModelId } : {},
    ...rewriteDiagnostics ? { rewriteDiagnostics } : {},
    ...finalEnhancedPrompt ? { promptCaptureSource: structuredPrompt ? "structured" : "fallback_raw_history" } : {},
    ...validationReport ? { validationCaptureSource: structuredValidationReport ? "structured" : "fallback_raw_history" } : {},
    ...structuredUnloadRequested !== null ? { llmUnloadRequested: structuredUnloadRequested } : {},
    ...unloadSucceeded !== null ? { llmUnloadSucceeded: unloadSucceeded, llmUnloadError: unloadError } : {},
    ...llmInstanceId ? { llmInstanceId } : {},
    ...llmUnloadDurationMs !== null ? { llmUnloadDurationMs } : {}
  };
}
function outputBoolean(value, preferredKeys = []) {
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = outputBoolean(item, preferredKeys);
      if (found !== null) return found;
    }
  }
  if (isRecord3(value)) {
    for (const key of preferredKeys) {
      const found = outputBoolean(value[key], preferredKeys);
      if (found !== null) return found;
    }
    for (const item of Object.values(value)) {
      const found = outputBoolean(item, preferredKeys);
      if (found !== null) return found;
    }
  }
  return null;
}
var RemoteComfyComputeProvider = class {
  mode = "remote";
  baseUrl;
  workflowPath;
  auth;
  fetchImpl;
  webSocketFactory;
  pollIntervalMs;
  includeSubmissionJson;
  localReferenceRoots;
  maxReferenceUploadBytes;
  clientIds = /* @__PURE__ */ new Map();
  promptEngineByPromptId = /* @__PURE__ */ new Map();
  uploadCache = /* @__PURE__ */ new Map();
  inFlightUploads = /* @__PURE__ */ new Map();
  constructor(config) {
    this.baseUrl = normalizeComfyUrl(config.baseUrl);
    this.workflowPath = config.workflowPath;
    this.auth = config.auth ?? { type: "none" };
    if (this.auth.type === "bearer" && !this.auth.token.trim()) throw new Error("ComfyUI bearer token cannot be empty");
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.webSocketFactory = config.webSocketFactory ?? (typeof globalThis.WebSocket === "function" ? (url) => {
      const WebSocketConstructor = globalThis.WebSocket;
      return new WebSocketConstructor(url);
    } : null);
    this.pollIntervalMs = Math.max(250, config.pollIntervalMs ?? 1e3);
    this.includeSubmissionJson = config.includeSubmissionJson ?? false;
    this.localReferenceRoots = (config.localReferenceRoots ?? []).filter((root) => root.trim()).map((root) => (0, import_node_path6.resolve)(root));
    const configuredMax = config.maxReferenceUploadBytes;
    this.maxReferenceUploadBytes = configuredMax !== void 0 && Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : maxLocalReferenceUploadBytes;
  }
  async testConnection() {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1e4);
    try {
      const payload = await this.requestJson("/system_stats", { signal: controller.signal });
      return parseComfySystemStats(payload, this.baseUrl, Date.now() - startedAt);
    } finally {
      clearTimeout(timeout);
    }
  }
  async testPromptEngine(settings) {
    const status = promptEngineStatus(settings);
    if (!isValidH3PromptEngineEndpoint(settings.endpoint)) {
      return { ...status, error: "H3 Prompt Engine endpoint must be http://127.0.0.1:1234/v1 on the execution PC." };
    }
    let objectInfo;
    try {
      objectInfo = await this.requestJson("/object_info");
    } catch (reason) {
      return { ...status, error: `Could not inspect ComfyUI custom nodes: ${errorMessage(reason)}` };
    }
    const classes = isRecord3(objectInfo) ? Object.keys(objectInfo) : [];
    const enhancerInstalled = classes.includes("MiniMaxH3PromptEnhancer");
    const validatorInstalled = classes.includes("MiniMaxH3PromptValidator");
    const missingPatchedNodes = ["MiniMaxH3PromptEnhancer", "MiniMaxH3PromptValidator", "MiniMaxH3PromptValidityGate", "MiniMaxH3UnloadLMStudioModel"].filter((classType) => !classes.includes(classType));
    if (missingPatchedNodes.length > 0) {
      return { ...status, enhancerInstalled, validatorInstalled, requiredNodesInstalled: false, error: `Install ComfyUI-MiniMax-H3-Prompt-Enhancer and apply the Proya autonomous-H3 patch on the execution PC. Missing: ${missingPatchedNodes.join(", ")}` };
    }
    if (!hasPatchedPromptEngineSchema(objectInfo)) {
      return { ...status, enhancerInstalled, validatorInstalled, requiredNodesInstalled: false, error: "The local H3 prompt nodes are installed with a stale schema. Apply the latest pinned Proya autonomous-H3 patch and restart ComfyUI before generating." };
    }
    try {
      const modelsPayload = await this.requestJson("/minimax_h3_prompt_enhancer/models", {
        method: "POST",
        body: JSON.stringify({ endpoint: settings.endpoint, api_key: "", allow_remote_endpoint: false })
      });
      const discovery = parsePromptEngineDiscovery(modelsPayload);
      return {
        ...status,
        enhancerInstalled,
        validatorInstalled,
        requiredNodesInstalled: true,
        lmStudioConnected: Boolean(discovery.observedModelId) && !discovery.error,
        models: discovery.models,
        observedModelId: discovery.observedModelId,
        observedInstanceId: discovery.observedInstanceId,
        selectedModel: discovery.observedModelId,
        qwenReady: Boolean(discovery.observedModelId) && !discovery.error,
        error: discovery.error
      };
    } catch (reason) {
      return { ...status, enhancerInstalled, validatorInstalled, requiredNodesInstalled: true, error: `LM Studio discovery through ComfyUI failed: ${errorMessage(reason)}` };
    }
  }
  async submitH3(request, onState, authorization) {
    const localJobId = request.localJobId?.trim() || request.clientJobId?.trim() || null;
    let effectivePromptEngine = request.promptEngine ? normalizeAutonomousH3PromptEngineSettings(request.promptEngine) : null;
    let referenceUploads = [];
    let stage = "PREPARING";
    const publish = (status, overrides = {}) => {
      onState?.(this.makeState(localJobId, null, status, { ...h3PromptEngineAudit(effectivePromptEngine), referenceUploads, ...overrides }));
    };
    try {
      if (!this.workflowPath.trim()) throw new Error("Set an H3 API workflow file in Settings before submitting.");
      const resolution = validateMiniMaxH3GenerationRequest(request);
      const template = this.loadWorkflowTemplate(this.workflowPath, request.mode);
      publish("preparing", { pipelineStage: "PREPARING" });
      await this.testConnection();
      let effectiveRequest = request.promptEngine ? { ...request, promptEngine: effectivePromptEngine ?? void 0 } : request;
      if (request.generationBrief) {
        if (!request.promptEngine) throw new Error("H3 Prompt Engine settings are missing.");
        const autonomousPromptEngine = normalizeAutonomousH3PromptEngineSettings(request.promptEngine);
        const promptEngine = await this.testPromptEngine(autonomousPromptEngine);
        if (!promptEngine.requiredNodesInstalled || !promptEngine.enhancerInstalled || !promptEngine.validatorInstalled) {
          stage = "PROMPT_GENERATION_FAILED";
          throw new Error(promptEngine.error ?? "The local H3 prompt enhancer and validator are not installed.");
        }
        if (!promptEngine.lmStudioConnected) {
          stage = "LLM_UNAVAILABLE";
          throw new Error(promptEngine.error ?? "LM Studio unavailable.");
        }
        if (!promptEngine.observedModelId) {
          stage = "LLM_UNAVAILABLE";
          throw new Error(promptEngine.error ?? `${h3PromptEngineModelId} is not available in LM Studio on this PC.`);
        }
        if (!promptEngine.qwenReady) {
          stage = "LLM_UNAVAILABLE";
          throw new Error(promptEngine.error ?? "LM Studio did not return a usable Qwen model.");
        }
        effectiveRequest = { ...request, promptEngine: autonomousPromptEngine };
        effectivePromptEngine = effectiveRequest.promptEngine ?? null;
      }
      stage = "UPLOADING_REFERENCES";
      const remoteReferences = await this.prepareRemoteReferences(effectiveRequest, (status, overrides) => {
        publish(status, { pipelineStage: status === "uploading_reference" ? "UPLOADING_REFERENCES" : overrides?.pipelineStage, ...overrides });
      }, authorization);
      referenceUploads = remoteReferences.uploads;
      const referenceBindings = physicalReferenceMap(effectiveRequest, remoteReferences.referenceImages);
      stage = request.generationBrief ? "WRITING_PROMPT" : "PREPARING";
      publish("preparing", {
        pipelineStage: request.generationBrief ? "WRITING_PROMPT" : "PREPARING",
        referenceUploads,
        remoteUploadedFilename: referenceUploads[0]?.filename ?? null,
        generationBrief: effectiveRequest.generationBrief ?? null,
        referenceMap: effectiveRequest.generationBrief?.references ?? [],
        mediaManifest: effectiveRequest.mediaManifest ?? effectiveRequest.generationBrief?.mediaManifest ?? null,
        allowedReferenceLabels: effectiveRequest.allowedReferenceLabels ?? effectiveRequest.generationBrief?.allowedReferenceLabels ?? null,
        physicalReferenceMap: referenceBindings,
        promptEngine: effectiveRequest.promptEngine ?? null,
        ...h3PromptEngineAudit(effectiveRequest.promptEngine),
        lmStudioModelId: effectiveRequest.promptEngine?.model.trim() || null,
        temperature: effectiveRequest.promptEngine?.temperature ?? null,
        llmUnloadRequested: effectiveRequest.promptEngine?.unloadModelBeforeH3 ?? false
      });
      stage = "H3_QUEUE_FAILED";
      const workflow = this.prepareWorkflow(template, effectiveRequest, resolution, remoteReferences);
      const clientId = (0, import_node_crypto4.randomUUID)();
      const submission = { prompt: workflow, client_id: clientId, ...request.autoJobId ? { extra_data: { autoJobId: request.autoJobId, sessionId: request.autoSessionId, cycleNumber: request.autoCycleNumber, extra_pnginfo: { autoJobId: request.autoJobId, sessionId: request.autoSessionId, cycleNumber: request.autoCycleNumber } } } : {} };
      const submissionJson = JSON.stringify(submission, null, 2);
      if (request.autoJobId) publish("submitted", { submissionJson, pipelineStage: "QUEUED_H3" });
      const post = () => this.requestJson("/prompt", { method: "POST", body: submissionJson });
      const payload = request.autoJobId ? await submitExactlyOnce(post, async () => {
        const id = await this.reconcileAutoJob(request.autoJobId);
        return id ? { prompt_id: id } : null;
      }) : await post();
      const responseError = payload.error;
      const nodeErrors = payload.node_errors;
      if (!(request.autoJobId && isCanonicalComfyPromptId(payload.prompt_id)) && responseError !== void 0 && responseError !== null) throw new Error(`ComfyUI rejected the workflow: ${errorMessage(responseError)}`);
      if (!(request.autoJobId && isCanonicalComfyPromptId(payload.prompt_id)) && (Array.isArray(nodeErrors) && nodeErrors.length > 0 || isRecord3(nodeErrors) && Object.keys(nodeErrors).length > 0)) {
        throw new Error(`ComfyUI rejected one or more nodes: ${errorMessage(nodeErrors)}`);
      }
      if (request.autoJobId && !isCanonicalComfyPromptId(payload.prompt_id)) throw new AmbiguousSubmissionError();
      const remotePromptId = requireCanonicalComfyPromptId(payload.prompt_id);
      this.clientIds.set(remotePromptId, clientId);
      if (effectiveRequest.promptEngine) this.promptEngineByPromptId.set(remotePromptId, effectiveRequest.promptEngine);
      const queuePosition = asNumber(payload.number);
      const state = this.makeState(localJobId, remotePromptId, queuePosition !== null && queuePosition <= 0 ? "running" : "queued", {
        queuePosition,
        pipelineStage: "QUEUED_H3",
        referenceUploads,
        remoteUploadedFilename: referenceUploads[0]?.filename ?? null,
        generationBrief: effectiveRequest.generationBrief ?? null,
        referenceMap: effectiveRequest.generationBrief?.references ?? [],
        mediaManifest: effectiveRequest.mediaManifest ?? effectiveRequest.generationBrief?.mediaManifest ?? null,
        allowedReferenceLabels: effectiveRequest.allowedReferenceLabels ?? effectiveRequest.generationBrief?.allowedReferenceLabels ?? null,
        physicalReferenceMap: referenceBindings,
        promptEngine: effectiveRequest.promptEngine ?? null,
        ...h3PromptEngineAudit(effectiveRequest.promptEngine),
        lmStudioModelId: effectiveRequest.promptEngine?.model.trim() || null,
        temperature: effectiveRequest.promptEngine?.temperature ?? null,
        llmUnloadRequested: effectiveRequest.promptEngine?.unloadModelBeforeH3 ?? false,
        submissionJson: this.includeSubmissionJson || request.autoJobId ? submissionJson : void 0
      });
      onState?.(state);
      return state;
    } catch (reason) {
      if (request.autoJobId && (reason instanceof AmbiguousSubmissionError || isTransientTransport(reason))) {
        publish(reason instanceof AmbiguousSubmissionError ? "submitted" : "preparing", { connectionError: String(reason), pipelineStage: stage });
        throw reason;
      }
      const promptFailureStage = stage === "WRITING_PROMPT" ? classifyH3PromptEngineError(errorMessage(reason)) : null;
      const failureStage = stage === "UPLOADING_REFERENCES" ? "REFERENCE_UPLOAD_FAILED" : stage === "WRITING_PROMPT" ? promptFailureStage ?? "PROMPT_GENERATION_FAILED" : stage === "LLM_UNAVAILABLE" ? "LLM_UNAVAILABLE" : stage === "PROMPT_GENERATION_FAILED" ? "PROMPT_GENERATION_FAILED" : "H3_QUEUE_FAILED";
      publish("failed", { pipelineStage: failureStage, failureStage, error: h3PromptEngineErrorMessage(errorMessage(reason), effectivePromptEngine), referenceUploads, remoteUploadedFilename: referenceUploads[0]?.filename ?? null });
      throw reason;
    }
  }
  /**
   * Read the remote lifecycle directly before the Qwen handoff. A persisted
   * local status is never enough to decide that an H3 prompt is still active.
   */
  async inspectH3Lifecycle(remotePromptId, recoveryIdentity = null) {
    const queueResponse = await this.requestJsonResponse("/queue");
    const queue = queueResponse.payload;
    const queueDiagnostics = {
      queueSampleTimestamp: queueResponse.receivedAt,
      queueRequestUrl: redactedControlPlaneUrl(queueResponse.url),
      queueFreshness: "FRESH"
    };
    const running = Array.isArray(queue.queue_running) ? queue.queue_running : null;
    const pending = Array.isArray(queue.queue_pending) ? queue.queue_pending : null;
    if (!running || !pending) throw new Error("Cannot reconcile H3 lifecycle; /queue did not return running and pending arrays.");
    if (!isCanonicalComfyPromptId(remotePromptId)) {
      const queueState2 = running.length === 0 && pending.length === 0 ? "empty" : "busy_other";
      return { queueState: queueState2, historyState: "not_checked", remoteState: null, outputCaptured: false, ...queueDiagnostics };
    }
    let historyPayload = {};
    let historyDiagnostics = {
      historySampleTimestamp: null,
      historyRequestUrl: null,
      historyFreshness: "UNAVAILABLE"
    };
    try {
      const historyResponse = await this.requestJsonResponse(`/history/${encodeURIComponent(remotePromptId)}`);
      historyPayload = historyResponse.payload;
      historyDiagnostics = { historySampleTimestamp: historyResponse.receivedAt, historyRequestUrl: redactedControlPlaneUrl(historyResponse.url), historyFreshness: "FRESH" };
    } catch (reason) {
      if (!/\(404\)/.test(errorMessage(reason))) throw reason;
      if (isRecord3(reason)) historyDiagnostics = {
        historySampleTimestamp: asString(reason.receivedAt),
        historyRequestUrl: asString(reason.url) ? redactedControlPlaneUrl(asString(reason.url)) : null,
        historyFreshness: "FRESH"
      };
    }
    let promptIdForInspection = remotePromptId;
    let entry = findHistoryEntry(historyPayload, remotePromptId);
    let recoverySource = null;
    if (!entry && recoveryIdentity?.trim()) {
      let recentHistory = {};
      try {
        const recentResponse = await this.requestJsonResponse("/history");
        recentHistory = recentResponse.payload;
        historyDiagnostics = { historySampleTimestamp: recentResponse.receivedAt, historyRequestUrl: redactedControlPlaneUrl(recentResponse.url), historyFreshness: "FRESH" };
      } catch (reason) {
        if (!/\(404\)/.test(errorMessage(reason))) throw reason;
      }
      const recovered = findHistoryEntryByIdentity(recentHistory, recoveryIdentity, this.baseUrl);
      if (recovered) {
        promptIdForInspection = recovered.promptId;
        entry = recovered.entry;
        recoverySource = "recent_history";
      }
    }
    const runningItem = running.find((item) => queueItemPromptId(item) === promptIdForInspection);
    const pendingItem = pending.find((item) => queueItemPromptId(item) === promptIdForInspection);
    const queueState = runningItem !== void 0 ? "queue_running" : pendingItem !== void 0 ? "queue_pending" : running.length === 0 && pending.length === 0 ? "empty" : "busy_other";
    if (!entry) return { queueState, historyState: "missing", remoteState: null, outputCaptured: false, ...queueDiagnostics, ...historyDiagnostics };
    const error = historyError(entry);
    const outputs = extractComfyOutputs(this.baseUrl, entry.outputs);
    const parsedStatus = historyStatus(entry);
    const videoOutputCaptured = findComfyVideoOutputs(outputs).length > 0;
    const effectiveError = videoOutputCaptured ? null : error;
    const promptEngine = this.promptEngineByPromptId.get(promptIdForInspection) ?? this.promptEngineByPromptId.get(remotePromptId);
    const gateFailure = effectiveError ? promptGateFailureStage(effectiveError) : null;
    const classifiedError = effectiveError ? classifyH3PromptEngineError(effectiveError) : null;
    const promptFailure = !gateFailure && classifiedError && classifiedError !== "PROMPT_GENERATION_FAILED" ? classifiedError : null;
    const remoteState = this.makeState(null, promptIdForInspection, effectiveError ? "failed" : videoOutputCaptured || parsedStatus.status === "completed" ? "completed" : parsedStatus.status, {
      progress: effectiveError ? null : videoOutputCaptured ? 1 : parsedStatus.progress,
      queueRemaining: parsedStatus.queueRemaining,
      outputs,
      ...executionMetadata(entry.outputs),
      promptEngine: promptEngine ?? null,
      ...h3PromptEngineAudit(promptEngine),
      ...promptCleanupAudit(effectiveError ?? error ?? ""),
      ...gateFailure ? { pipelineStage: gateFailure, failureStage: gateFailure } : {},
      ...promptFailure ? { pipelineStage: promptFailure, failureStage: promptFailure } : {},
      error: effectiveError ? h3PromptEngineErrorMessage(effectiveError, promptEngine) : null
    });
    const historyState = effectiveError ? "failed" : videoOutputCaptured || parsedStatus.status === "completed" ? "completed" : parsedStatus.status === "running" ? "running" : "queued";
    return {
      queueState,
      historyState,
      remoteState,
      outputCaptured: outputs.length > 0,
      recoveredPromptId: recoverySource ? promptIdForInspection : null,
      recoverySource,
      ...queueDiagnostics,
      ...historyDiagnostics
    };
  }
  async getJobState(remotePromptId) {
    requireCanonicalComfyPromptId(remotePromptId);
    const historyPayload = await this.requestJson(`/history/${encodeURIComponent(remotePromptId)}`);
    const entry = findHistoryEntry(historyPayload, remotePromptId);
    if (entry) {
      const error = historyError(entry);
      const outputs = extractComfyOutputs(this.baseUrl, entry.outputs);
      const parsedStatus = historyStatus(entry);
      const promptEngine = this.promptEngineByPromptId.get(remotePromptId);
      const gateFailure = error ? promptGateFailureStage(error) : null;
      const classifiedError = error ? classifyH3PromptEngineError(error) : null;
      const promptFailure = !gateFailure && classifiedError && classifiedError !== "PROMPT_GENERATION_FAILED" ? classifiedError : null;
      return this.makeState(null, remotePromptId, error ? "failed" : parsedStatus.status, {
        progress: error ? null : parsedStatus.progress,
        queueRemaining: parsedStatus.queueRemaining,
        outputs,
        ...executionMetadata(entry.outputs),
        promptEngine: promptEngine ?? null,
        ...h3PromptEngineAudit(promptEngine),
        ...promptCleanupAudit(error ?? ""),
        ...gateFailure ? { pipelineStage: gateFailure, failureStage: gateFailure } : {},
        ...promptFailure ? { pipelineStage: promptFailure, failureStage: promptFailure } : {},
        error: error ? h3PromptEngineErrorMessage(error, promptEngine) : null
      });
    }
    const queue = await this.getQueue();
    const running = Array.isArray(queue.queue_running) ? queue.queue_running : [];
    const pending = Array.isArray(queue.queue_pending) ? queue.queue_pending : [];
    const runningItem = running.find((item) => queueItemPromptId(item) === remotePromptId);
    if (runningItem !== void 0) return this.makeState(null, remotePromptId, "running", { promptEngine: this.promptEngineByPromptId.get(remotePromptId) ?? null, ...h3PromptEngineAudit(this.promptEngineByPromptId.get(remotePromptId)), queuePosition: queueItemNumber(runningItem) });
    const pendingIndex = pending.findIndex((item) => queueItemPromptId(item) === remotePromptId);
    if (pendingIndex >= 0) return this.makeState(null, remotePromptId, "queued", { promptEngine: this.promptEngineByPromptId.get(remotePromptId) ?? null, ...h3PromptEngineAudit(this.promptEngineByPromptId.get(remotePromptId)), queuePosition: queueItemNumber(pending[pendingIndex]) ?? pendingIndex + 1 });
    return this.makeState(null, remotePromptId, "submitted", { promptEngine: this.promptEngineByPromptId.get(remotePromptId) ?? null, ...h3PromptEngineAudit(this.promptEngineByPromptId.get(remotePromptId)) });
  }
  async getQueue() {
    return this.requestJson("/queue");
  }
  async assertQueueIdle() {
    if (!await this.isQueueIdle(AbortSignal.timeout(5e3))) {
      throw new Error("ComfyUI is still executing or has pending jobs. Wait for H3 and its VRAM release before starting Qwen.");
    }
  }
  /**
   * Recover only a stale canonical Qwen instance before a new prompt job.
   * LM Studio is loopback-owned by the execution PC, so the ComfyUI extension
   * performs the native model inspection/unload and this client performs the
   * normal ComfyUI cache release after the extension confirms the queue is idle.
   */
  async recoverStaleQwen() {
    const audit = {
      activePromptJob: false,
      staleQwenDetected: false,
      staleQwenInstanceId: null,
      staleQwenUnloadAttempted: false,
      staleQwenUnloadSucceeded: null,
      staleQwenUnloadError: null,
      comfyFreeAttempted: false,
      comfyFreeSucceeded: null,
      observedFreeVram: null,
      qwenRecoveryError: null
    };
    const readFreeVram = async () => {
      try {
        const payload = await this.requestJson("/system_stats");
        if (!isRecord3(payload) || !Array.isArray(payload.devices)) return null;
        const gpu = payload.devices.find((device) => isRecord3(device) && asString(device.type) !== "cpu");
        return isRecord3(gpu) ? asNumber(gpu.vram_free) : null;
      } catch {
        return null;
      }
    };
    audit.observedFreeVram = await readFreeVram();
    let response;
    try {
      response = await this.requestJson("/proya/auto/qwen-recovery", {
        method: "POST",
        body: JSON.stringify({ endpoint: "http://127.0.0.1:1234/v1", api_key: "", allow_remote_endpoint: false })
      });
      Object.assign(audit, {
        activePromptJob: typeof response.activePromptJob === "boolean" ? response.activePromptJob : audit.activePromptJob,
        staleQwenDetected: typeof response.staleQwenDetected === "boolean" ? response.staleQwenDetected : audit.staleQwenDetected,
        staleQwenInstanceId: asString(response.staleQwenInstanceId),
        staleQwenUnloadAttempted: typeof response.staleQwenUnloadAttempted === "boolean" ? response.staleQwenUnloadAttempted : audit.staleQwenUnloadAttempted,
        staleQwenUnloadSucceeded: typeof response.staleQwenUnloadSucceeded === "boolean" ? response.staleQwenUnloadSucceeded : audit.staleQwenUnloadSucceeded,
        staleQwenUnloadError: asString(response.staleQwenUnloadError),
        qwenRecoveryError: asString(response.qwenRecoveryError) ?? asString(response.error)
      });
    } catch (reason) {
      audit.qwenRecoveryError = errorMessage(reason);
      audit.observedFreeVram = await readFreeVram();
      return audit;
    }
    if (audit.activePromptJob) {
      audit.qwenRecoveryError ??= "An active ComfyUI prompt job owns the execution queue; stale Qwen cleanup was skipped.";
      audit.observedFreeVram = await readFreeVram();
      return audit;
    }
    const totalVram = await this.readVramTotal();
    const excessiveVram = audit.observedFreeVram !== null && totalVram !== null && audit.observedFreeVram < this.requiredQwenFreeVramBytes(totalVram);
    if (audit.staleQwenDetected || excessiveVram) {
      audit.comfyFreeAttempted = true;
      try {
        await this.assertQueueIdle();
        await this.requestJson("/free", { method: "POST", body: JSON.stringify({ unload_models: true, free_memory: true }) });
        audit.comfyFreeSucceeded = true;
      } catch (reason) {
        audit.comfyFreeSucceeded = false;
        audit.qwenRecoveryError ??= `ComfyUI /free failed during stale Qwen recovery: ${errorMessage(reason)}`;
      }
    }
    audit.observedFreeVram = await readFreeVram() ?? audit.observedFreeVram;
    return audit;
  }
  async readVramTotal() {
    try {
      const payload = await this.requestJson("/system_stats");
      if (!isRecord3(payload) || !Array.isArray(payload.devices)) return null;
      const gpu = payload.devices.find((device) => isRecord3(device) && asString(device.type) !== "cpu");
      return isRecord3(gpu) ? asNumber(gpu.vram_total) : null;
    } catch {
      return null;
    }
  }
  async isQueueIdle(signal) {
    const queue = await this.requestJson("/queue", { signal });
    if (!queue || !Array.isArray(queue.queue_running) || !Array.isArray(queue.queue_pending)) {
      throw new Error("Cannot verify ComfyUI queue state; expected running and pending arrays.");
    }
    return queue.queue_running.length === 0 && queue.queue_pending.length === 0;
  }
  requiredQwenFreeVramBytes(totalBytes) {
    return totalBytes - Math.max(2 * 1024 ** 3, totalBytes * 0.1);
  }
  /** /free only acknowledges executor flags. Keep the GPU handoff open until idle cleanup settles. */
  async releaseH3Vram(authorization, onProgress) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2e4);
    let requested = false;
    let before = null;
    let after = null;
    let freeRequestUrl = null;
    const freeRequestBody = JSON.stringify({ unload_models: true, free_memory: true });
    let freeRequestStatus = null;
    let freeRequestResult = null;
    let requiredFreeBytes = null;
    let pollAttempts = 0;
    let postMeasurementFresh = false;
    const result = (succeeded, error) => ({
      h3VramReleaseRequested: requested,
      h3VramReleaseSucceeded: succeeded,
      h3VramReleaseDurationMs: Date.now() - startedAt,
      h3VramReleaseError: error,
      h3VramBeforeRelease: before,
      h3VramAfterRelease: after,
      h3FreeRequestUrl: freeRequestUrl,
      h3FreeRequestBody: freeRequestBody,
      h3FreeRequestStatus: freeRequestStatus,
      h3FreeRequestResult: freeRequestResult,
      h3VramRequiredFreeBytes: requiredFreeBytes,
      h3VramVerification: succeeded === true ? "PASSED" : succeeded === false ? "FAILED" : succeeded === null && requested ? "UNAVAILABLE" : null,
      h3VramPollAttempts: pollAttempts,
      h3VramPostMeasurementFresh: postMeasurementFresh
    });
    const publish = (succeeded = null, error = null) => onProgress?.(result(succeeded, error));
    const signal = () => AbortSignal.any([controller.signal, AbortSignal.timeout(3e3)]);
    let sampleNumber = 0;
    const snapshot = async () => {
      try {
        const sampleId = `${Date.now()}-${++sampleNumber}-${(0, import_node_crypto4.randomUUID)()}`;
        const payload = await this.requestJson(`/system_stats?proya_vram_sample=${encodeURIComponent(sampleId)}`, {
          signal: signal(),
          cache: "no-store",
          headers: { "Cache-Control": "no-cache, no-store", Pragma: "no-cache" }
        });
        if (!isRecord3(payload) || !Array.isArray(payload.devices)) return null;
        const devices = payload.devices.filter(isRecord3).map((device) => ({
          name: asString(device.name),
          type: asString(device.type),
          vramTotalBytes: asNumber(device.vram_total),
          vramFreeBytes: asNumber(device.vram_free),
          torchReservedBytes: asNumber(device.torch_vram_total)
        }));
        return { capturedAt: (/* @__PURE__ */ new Date()).toISOString(), devices };
      } catch {
        return null;
      }
    };
    try {
      if (authorization.completionProven !== true) throw new Error("H3 VRAM release requires an authoritative completed-lifecycle authorization.");
      const remotePromptId = authorization.previousPromptId;
      requireCanonicalComfyPromptId(remotePromptId);
      const idleDeadline = Date.now() + 3e3;
      while (!await this.isQueueIdle(signal())) {
        if (Date.now() >= idleDeadline) return result(false, "ComfyUI queue is busy; H3 VRAM release was not requested.");
        await wait(250, controller.signal);
      }
      before = await snapshot();
      const beforeGpu = before?.devices.filter((device) => device.type !== null && device.type !== "cpu") ?? [];
      requiredFreeBytes = beforeGpu.length > 0 && beforeGpu.every((device) => device.vramTotalBytes !== null && device.vramTotalBytes > 0) ? Math.max(...beforeGpu.map((device) => this.requiredQwenFreeVramBytes(device.vramTotalBytes))) : null;
      publish();
      if (!await this.isQueueIdle(signal())) return result(false, "ComfyUI queue became busy; H3 VRAM release was not requested.");
      requested = true;
      freeRequestUrl = endpointFor(this.baseUrl, "/free");
      publish();
      const freeResponse = await this.requestJsonResponse("/free", { method: "POST", body: freeRequestBody, signal: signal() });
      const freeCompletedAt = Date.now();
      freeRequestUrl = freeResponse.url;
      freeRequestStatus = freeResponse.status;
      freeRequestResult = typeof freeResponse.payload === "string" ? freeResponse.payload.slice(0, 500) : JSON.stringify(freeResponse.payload).slice(0, 500);
      if (!freeRequestResult) freeRequestResult = freeResponse.statusText || "HTTP success with empty response body";
      publish();
      const releaseDeadline = Math.min(startedAt + 19e3, Date.now() + 15e3);
      let consecutiveReleased = 0;
      let measuredRetained = false;
      while (Date.now() < releaseDeadline && !controller.signal.aborted) {
        await wait(1e3, controller.signal);
        if (!await this.isQueueIdle(signal())) return result(false, "ComfyUI became busy during the H3 VRAM handoff; release could not be verified.");
        const sampleRequestedAt = Date.now();
        after = await snapshot();
        pollAttempts += 1;
        postMeasurementFresh = Boolean(after && sampleRequestedAt >= freeCompletedAt && Date.parse(after.capturedAt) >= freeCompletedAt);
        const gpuDevices = after?.devices.filter((device) => device.type !== null && device.type !== "cpu") ?? [];
        const measurable = gpuDevices.length > 0 && gpuDevices.every((device) => device.torchReservedBytes !== null && device.torchReservedBytes >= 0 && device.vramTotalBytes !== null && device.vramTotalBytes > 0 && device.vramFreeBytes !== null && device.vramFreeBytes >= 0 && device.vramFreeBytes <= device.vramTotalBytes);
        if (measurable) requiredFreeBytes = Math.max(...gpuDevices.map((device) => this.requiredQwenFreeVramBytes(device.vramTotalBytes)));
        const released = postMeasurementFresh && measurable && gpuDevices.every((device) => device.torchReservedBytes <= 256 * 1024 * 1024 && device.vramFreeBytes >= this.requiredQwenFreeVramBytes(device.vramTotalBytes));
        const knownOccupied = gpuDevices.some((device) => (device.torchReservedBytes ?? 0) > 256 * 1024 * 1024 || device.vramTotalBytes !== null && device.vramTotalBytes > 0 && device.vramFreeBytes !== null && device.vramFreeBytes >= 0 && device.vramFreeBytes < this.requiredQwenFreeVramBytes(device.vramTotalBytes));
        if (released || knownOccupied) measuredRetained = knownOccupied;
        consecutiveReleased = released ? consecutiveReleased + 1 : 0;
        publish(released ? null : false, released ? null : measurable ? `GPU memory is not yet safe for Qwen: ${Math.min(...gpuDevices.map((device) => device.vramFreeBytes))} bytes free; need at least ${requiredFreeBytes} bytes.` : "Fresh post-release GPU telemetry is not yet measurable.");
        if (consecutiveReleased >= 2 && await this.isQueueIdle(signal())) return result(true, null);
      }
      if (!await this.isQueueIdle(signal())) return result(false, "ComfyUI queue is not idle after the H3 VRAM release wait.");
      return measuredRetained ? result(false, "GPU memory remains occupied after the bounded H3 VRAM release wait (ComfyUI caches or another process). Retry the handoff before starting Qwen.") : result(null, "ComfyUI accepted /free and the idle wait finished, but GPU telemetry could not verify H3 VRAM release.");
    } catch (reason) {
      if (isRecord3(reason)) {
        freeRequestStatus ??= asNumber(reason.status);
        freeRequestUrl ??= asString(reason.url);
        const responsePayload = reason.payload;
        if (responsePayload !== void 0) {
          try {
            freeRequestResult ??= JSON.stringify(responsePayload).slice(0, 500);
          } catch {
            freeRequestResult ??= errorMessage(responsePayload).slice(0, 500);
          }
        }
      }
      return result(false, `H3 VRAM release failed: ${errorMessage(reason)}`);
    } finally {
      clearTimeout(timeout);
    }
  }
  watchJob(remotePromptId, onState) {
    requireCanonicalComfyPromptId(remotePromptId);
    const controller = new AbortController();
    void this.monitorJob(remotePromptId, onState, controller.signal);
    return () => controller.abort();
  }
  getOutputUrl(output) {
    return createOutputUrl(this.baseUrl, output);
  }
  async downloadOutput(output, destinationDirectory, signal) {
    return this.downloadFile(output, destinationDirectory, this.getOutputUrl(output), signal);
  }
  async downloadAutoArchive(output, root, relativePath, destinationDirectory, signal) {
    const url = new URL(endpointFor(this.baseUrl, "/proya/auto/archive/file"));
    url.searchParams.set("root", root);
    url.searchParams.set("relativePath", relativePath);
    return this.downloadFile(output, destinationDirectory, url.toString(), signal);
  }
  async downloadFile(output, destinationDirectory, url, signal) {
    if (!output.filename.trim()) throw new Error("ComfyUI output is missing a filename.");
    const directory = (0, import_node_path6.resolve)(destinationDirectory);
    (0, import_node_fs6.mkdirSync)(directory, { recursive: true });
    const rawFilename = output.filename.replaceAll("\\", "/").split("/").pop() ?? "comfy-output";
    const sanitizedFilename = Array.from(rawFilename, (character) => {
      const code = character.charCodeAt(0);
      return code < 32 || '<>:"/|?*'.includes(character) ? "_" : character;
    }).join("");
    const safeFilename = sanitizedFilename && sanitizedFilename !== "." && sanitizedFilename !== ".." ? sanitizedFilename : "comfy-output";
    const extension = (0, import_node_path6.extname)(safeFilename);
    const stem = extension ? safeFilename.slice(0, -extension.length) : safeFilename;
    let localPath = (0, import_node_path6.join)(directory, safeFilename);
    let suffix = 1;
    while ((0, import_node_fs6.existsSync)(localPath)) {
      localPath = (0, import_node_path6.join)(directory, `${stem} (${suffix})${extension}`);
      suffix += 1;
    }
    const temporaryPath = (0, import_node_path6.join)(directory, `.${safeFilename}.${(0, import_node_crypto4.randomUUID)()}.part`);
    try {
      const response = await this.fetchImpl(url, { method: "GET", headers: new Headers(authHeaders(this.auth)), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6e5)]) : AbortSignal.timeout(6e5) });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`ComfyUI output download failed (${response.status})${detail.trim() ? `: ${detail.trim()}` : ""}`);
      }
      const contents = Buffer.from(await response.arrayBuffer());
      const expectedSize = Number(response.headers.get("content-length"));
      if (!contents.length || expectedSize > 0 && contents.length !== expectedSize) throw new Error("Downloaded output size verification failed");
      (0, import_node_fs6.writeFileSync)(temporaryPath, contents);
      (0, import_node_fs6.renameSync)(temporaryPath, localPath);
      return { output, localPath, downloadedAt: (/* @__PURE__ */ new Date()).toISOString() };
    } catch (reason) {
      if ((0, import_node_fs6.existsSync)(temporaryPath)) (0, import_node_fs6.unlinkSync)(temporaryPath);
      throw new Error(`Could not download ComfyUI output ${output.filename}: ${errorMessage(reason)}`, { cause: reason });
    }
  }
  loadWorkflowTemplate(filePath, mode) {
    const absolutePath = (0, import_node_path6.resolve)(filePath);
    let parsed;
    try {
      parsed = JSON.parse((0, import_node_fs6.readFileSync)(absolutePath, "utf8"));
    } catch (reason) {
      throw new Error(`Could not read H3 API workflow ${absolutePath}: ${errorMessage(reason)}`, { cause: reason });
    }
    if (mode === "T2VA") {
      try {
        return validateMiniMaxH3T2VAApiWorkflowTemplate(parsed);
      } catch {
        return deriveMiniMaxH3T2VAWorkflowTemplate(parsed);
      }
    }
    return validateMiniMaxH3ApiWorkflowTemplate(parsed);
  }
  prepareWorkflow(template, request, resolution, references) {
    const seed = request.workflowSettings?.seed ?? request.seed ?? (0, import_node_crypto4.randomInt)(0, 4294967296);
    const outputPrefix = request.autoJobId ?? `PROYA_H3_${(/* @__PURE__ */ new Date()).toISOString().replace(/[^0-9]/g, "").slice(0, 14)}_${seed}`;
    const promptEngine = request.promptEngine;
    return prepareH3ComfyWorkflow(template, {
      prompt: request.prompt,
      generationBrief: request.generationBriefText ?? request.prompt ?? "",
      referenceContext: request.referenceContext ?? "",
      mediaManifest: request.mediaManifest ?? request.generationBrief?.mediaManifest ?? "",
      systemPrompt: request.systemPromptOverride ?? "",
      lmStudioEndpoint: promptEngine?.endpoint,
      lmStudioModel: promptEngine?.model,
      temperature: promptEngine?.temperature,
      repairAttempts: promptEngine?.repairAttempts,
      disableThinking: promptEngine?.disableThinking,
      unloadModel: promptEngine?.unloadModelBeforeH3,
      promptTimeout: promptEngine?.timeoutSeconds,
      language: request.generationBrief?.language ?? "Indonesian",
      promptAspectRatio: request.generationBrief?.aspectRatio ?? request.aspectRatio,
      mode: request.mode,
      duration: request.duration,
      aspectRatio: resolution.selectorValue,
      width: resolution.width,
      height: resolution.height,
      fps: request.fps,
      frames: request.frames,
      megapixels: request.megapixels,
      multiple: request.multiple,
      steps: request.workflowSettings?.steps ?? request.steps ?? 20,
      seed,
      firstFrame: references.firstFrame,
      lastFrame: references.lastFrame,
      productReference: references.productReference,
      referenceImages: references.referenceImages,
      refImageSize: request.refImageSize,
      scheduler: request.scheduler,
      outputPrefix
    });
  }
  async prepareRemoteReferences(request, publish, authorization) {
    const uploads = [];
    const uploadBySource = /* @__PURE__ */ new Map();
    const upload = async (sourcePath, explicitlyAuthorizedPath) => {
      if (!sourcePath?.trim()) return null;
      publish("uploading_reference", { referenceUploads: uploads });
      const uploaded = await this.uploadLocalReference(sourcePath, request.product, explicitlyAuthorizedPath);
      if (!uploads.some((item) => item.sourcePath === uploaded.sourcePath && item.filename === uploaded.filename)) uploads.push(uploaded);
      uploadBySource.set(sourcePath, uploaded);
      return uploaded.filename;
    };
    const remoteOrUploaded = async (remoteFilename, localPath, explicitlyAuthorizedPath) => {
      if (localPath?.trim()) {
        const existing = uploadBySource.get(localPath);
        return existing?.filename ?? upload(localPath, explicitlyAuthorizedPath);
      }
      if (remoteFilename?.trim()) {
        if (isLocalFilesystemPath(remoteFilename.trim())) throw new Error("A local filesystem path cannot be sent to ComfyUI. Use the matching local reference path field so Creative Studio can upload it safely.");
        return remoteFilename.trim();
      }
      return null;
    };
    const usableReferenceInputs = request.referenceImages?.filter((reference) => Boolean(
      reference.remoteFilename?.trim() || reference.filename?.trim() || reference.localPath?.trim() || reference.path?.trim()
    )) ?? [];
    const requestedReferences = usableReferenceInputs.length ? usableReferenceInputs.map((reference) => ({
      remoteFilename: reference.remoteFilename?.trim() || reference.filename?.trim() || null,
      localPath: reference.localPath?.trim() || reference.path?.trim() || null
    })) : [{ remoteFilename: request.productReference, localPath: request.productReferencePath }];
    const referenceImages = [];
    for (const [index, reference] of requestedReferences.entries()) {
      const explicitlyAuthorizedPath = usableReferenceInputs.length ? index === 0 && reference.localPath && request.productReferencePath && reference.localPath === request.productReferencePath ? authorization?.productReferencePath : void 0 : authorization?.productReferencePath;
      const remoteReference = await remoteOrUploaded(reference.remoteFilename, reference.localPath, explicitlyAuthorizedPath);
      if (remoteReference) referenceImages.push(remoteReference);
    }
    return { firstFrame: null, lastFrame: null, productReference: referenceImages[0] ?? null, referenceImages, uploads };
  }
  resolveReferencePath(sourcePath, explicitlyAuthorizedPath) {
    const candidate = (0, import_node_path6.resolve)(sourcePath);
    let resolvedPath;
    try {
      resolvedPath = (0, import_node_fs6.realpathSync)(candidate);
    } catch (reason) {
      throw new Error(`Reference upload could not find ${sourcePath}: ${errorMessage(reason)}`, { cause: reason });
    }
    if (explicitlyAuthorizedPath) {
      if (!samePath(resolvedPath, explicitlyAuthorizedPath)) throw new Error("Reference upload was blocked because the source file was not the explicitly selected file.");
      return resolvedPath;
    }
    if (this.localReferenceRoots.length === 0) throw new Error("Reference upload is disabled until an allowed local product/reference folder is configured.");
    if (this.localReferenceRoots.length > 0 && !this.localReferenceRoots.some((root) => pathWithin(root, resolvedPath))) {
      throw new Error("Reference upload was blocked because the source file is outside the configured local reference folders.");
    }
    return resolvedPath;
  }
  async uploadLocalReference(sourcePath, product, explicitlyAuthorizedPath) {
    const resolvedPath = this.resolveReferencePath(sourcePath, explicitlyAuthorizedPath);
    let fileInfo;
    try {
      fileInfo = (0, import_node_fs6.statSync)(resolvedPath);
    } catch (reason) {
      throw new Error(`Reference upload could not inspect ${resolvedPath}: ${errorMessage(reason)}`, { cause: reason });
    }
    if (!fileInfo.isFile()) throw new Error("Reference upload requires a regular image file.");
    if (fileInfo.size <= 0) throw new Error("Reference upload rejected an empty image file.");
    if (fileInfo.size > this.maxReferenceUploadBytes) throw new Error(`Reference upload is too large. The maximum is ${Math.round(this.maxReferenceUploadBytes / (1024 * 1024))} MiB.`);
    const { mimeType } = referenceMimeType(resolvedPath);
    const cacheKey = `${resolvedPath}:${fileInfo.size}:${fileInfo.mtimeMs}:${product ?? "reference"}`;
    const cached = this.uploadCache.get(cacheKey);
    if (cached) return cached;
    const inFlight = this.inFlightUploads.get(cacheKey);
    if (inFlight) return inFlight;
    const contents = (0, import_node_fs6.readFileSync)(resolvedPath);
    const remoteName = remoteReferenceFilename(product, resolvedPath, contents);
    const pending = this.uploadReferenceFile(resolvedPath, remoteName, mimeType, contents).then((uploaded) => {
      this.uploadCache.set(cacheKey, uploaded);
      this.inFlightUploads.delete(cacheKey);
      return uploaded;
    }, (reason) => {
      this.inFlightUploads.delete(cacheKey);
      throw reason;
    });
    this.inFlightUploads.set(cacheKey, pending);
    return pending;
  }
  async uploadReferenceFile(sourcePath, remoteName, mimeType, contents) {
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array(contents)], { type: mimeType }), remoteName);
    form.append("type", "input");
    form.append("overwrite", "false");
    const payload = await this.requestJson("/upload/image", { method: "POST", body: form });
    const name = asString(payload.name) ?? remoteName;
    const subfolder = asString(payload.subfolder) ?? "";
    const type = asString(payload.type) ?? "input";
    return { sourcePath, filename: combineComfyFilename(name, subfolder), subfolder, type };
  }
  async reconcileAutoJob(identity) {
    const [queue, history] = await Promise.all([this.requestJson("/queue"), this.requestJson("/history")]);
    return remoteJobIdentity(queue, history, identity);
  }
  async archiveAutoOutput(output, root, relativePath) {
    return this.requestJson("/proya/auto/archive", { method: "POST", body: JSON.stringify({ output, root, relativePath }) });
  }
  async testAutoArchive(root) {
    await this.requestJson("/proya/auto/archive/check", { method: "POST", body: JSON.stringify({ root }) });
  }
  async interruptAutoJob(remotePromptId) {
    await this.requestJson("/proya/auto/interrupt", { method: "POST", body: JSON.stringify({ promptId: remotePromptId }) });
  }
  async requestJsonResponse(path, init = {}) {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    const multipart = typeof FormData !== "undefined" && init.body instanceof FormData;
    if (init.body !== void 0 && !multipart) headers.set("Content-Type", "application/json");
    for (const [key, value] of Object.entries(authHeaders(this.auth))) headers.set(key, value);
    const freshControlPlaneGet = isFreshControlPlaneGet(path, init.method);
    if (freshControlPlaneGet) {
      headers.set("Cache-Control", "no-cache, no-store, max-age=0");
      headers.set("Pragma", "no-cache");
    }
    const endpoint = new URL(endpointFor(this.baseUrl, path));
    if (freshControlPlaneGet) endpoint.searchParams.set("_proya_ts", `${Date.now()}-${(0, import_node_crypto4.randomUUID)()}`);
    const url = endpoint.toString();
    const response = await this.fetchImpl(url, { ...init, ...freshControlPlaneGet ? { cache: "no-store" } : {}, headers, signal: init.signal ?? AbortSignal.timeout(3e4) });
    const text = await response.text();
    let payload = {};
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
    const receivedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (!response.ok) {
      const requestError = new Error(`ComfyUI request ${path} failed (${response.status}): ${errorMessage(payload)}`);
      Object.assign(requestError, { status: response.status, statusText: response.statusText, payload, url, receivedAt });
      throw requestError;
    }
    return { payload, status: response.status, statusText: response.statusText, url, receivedAt };
  }
  async requestJson(path, init = {}) {
    return (await this.requestJsonResponse(path, init)).payload;
  }
  makeState(localJobId, remotePromptId, status, overrides = {}) {
    return {
      localJobId,
      remotePromptId,
      status,
      progress: null,
      currentNode: null,
      queuePosition: null,
      queueRemaining: null,
      outputs: [],
      referenceUploads: [],
      remoteUploadedFilename: null,
      localResultPath: null,
      downloadError: null,
      error: null,
      connectionError: null,
      serverUrl: this.baseUrl,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      ...overrides
    };
  }
  async monitorJob(remotePromptId, onState, signal) {
    let latest = this.makeState(null, remotePromptId, "submitted");
    let terminal2 = false;
    try {
      latest = await this.getJobState(remotePromptId);
      onState(latest);
      terminal2 = latest.status === "completed" || latest.status === "failed" || latest.status === "error";
    } catch (reason) {
      latest = { ...latest, connectionError: errorMessage(reason), updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
      onState(latest);
    }
    let socket = null;
    let reconnectTimer = null;
    const publish = (next) => {
      latest = { ...latest, ...next, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
      onState(latest);
      terminal2 = latest.status === "completed" || latest.status === "failed" || latest.status === "error";
    };
    const scheduleReconnect = () => {
      if (terminal2 || signal.aborted || reconnectTimer) return;
      const delay = 5e3;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectSocket();
      }, delay);
    };
    const connectSocket = () => {
      if (terminal2 || signal.aborted || !this.webSocketFactory || this.auth.type !== "none") return;
      const clientId = this.clientIds.get(remotePromptId) ?? (0, import_node_crypto4.randomUUID)();
      this.clientIds.set(remotePromptId, clientId);
      try {
        socket = this.webSocketFactory(websocketEndpointFor(this.baseUrl, clientId));
        socket.onopen = () => {
          void this.getJobState(remotePromptId).then((state) => publish({ ...state, progress: state.progress ?? latest.progress })).catch((reason) => publish({ connectionError: errorMessage(reason) }));
        };
        socket.onmessage = (event) => this.handleSocketMessage(event.data, remotePromptId, publish);
        socket.onerror = () => {
          if (!terminal2) scheduleReconnect();
        };
        socket.onclose = () => {
          if (!terminal2) scheduleReconnect();
        };
      } catch (reason) {
        publish({ connectionError: errorMessage(reason) });
        scheduleReconnect();
      }
    };
    connectSocket();
    try {
      while (!terminal2 && !signal.aborted) {
        await wait(latest.connectionError ? 5e3 : this.pollIntervalMs, signal);
        if (terminal2 || signal.aborted) break;
        try {
          const polled = await this.getJobState(remotePromptId);
          const preserveLiveProgress = polled.status !== "completed" && polled.status !== "failed" && polled.status !== "error";
          const effectiveStatus = statusRank(polled.status) < statusRank(latest.status) ? latest.status : polled.status;
          publish({
            ...polled,
            status: effectiveStatus,
            progress: preserveLiveProgress && polled.progress === null ? latest.progress : polled.progress,
            currentNode: preserveLiveProgress && polled.currentNode === null ? latest.currentNode : polled.currentNode,
            queuePosition: polled.queuePosition ?? latest.queuePosition,
            queueRemaining: polled.queueRemaining ?? latest.queueRemaining
          });
        } catch (reason) {
          publish({ connectionError: errorMessage(reason) });
        }
      }
    } finally {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const socketToClose = socket;
      socketToClose?.close();
    }
  }
  handleSocketMessage(raw, remotePromptId, publish) {
    if (typeof raw !== "string") return;
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isRecord3(message)) return;
    const data = isRecord3(message.data) ? message.data : {};
    const messagePromptId = asString(data.prompt_id);
    if (messagePromptId && messagePromptId !== remotePromptId) return;
    const type = asString(message.type);
    if (type === "status") {
      const status = isRecord3(data.status) ? data.status : {};
      const execInfo = isRecord3(status.exec_info) ? status.exec_info : {};
      publish({ queueRemaining: asNumber(execInfo.queue_remaining) });
    } else if (type === "execution_start") {
      publish({ status: "running", progress: 0, pipelineStage: "QUEUED_H3", connectionError: null });
    } else if (type === "executing") {
      const node = data.node;
      const currentNode = asString(node);
      const pipelineStage = pipelineStageForNode(currentNode);
      publish(node === null ? { progress: 1, currentNode: null, pipelineStage: "GENERATING_H3" } : { status: "running", currentNode, pipelineStage: pipelineStage ?? "GENERATING_H3", connectionError: null });
    } else if (type === "progress") {
      const value = asNumber(data.value);
      const maximum = asNumber(data.max);
      const currentNode = asString(data.node);
      publish({ status: "running", progress: value !== null && maximum !== null && maximum > 0 ? Math.min(1, Math.max(0, value / maximum)) : null, currentNode, pipelineStage: pipelineStageForNode(currentNode) ?? "GENERATING_H3", connectionError: null });
    } else if (type === "executed") {
      const nodeId = asString(data.node);
      const output = data.output;
      const next = { currentNode: nodeId, pipelineStage: pipelineStageForNode(nodeId) ?? "GENERATING_H3" };
      if (nodeId === "149" || nodeId === "150" || nodeId === "152") Object.assign(next, executionMetadata({ [nodeId]: output }));
      if (nodeId === "151") next.validationReport = asString(outputSlot(output, 2)) ?? firstString(output, ["validation_report", "report", "text"]);
      publish(next);
    } else if (type === "execution_error") {
      const currentNode = asString(data.node) ?? asString(data.node_id);
      const executionError = asString(data.exception_message) ?? asString(data.message) ?? "ComfyUI reported an execution error.";
      const gateFailure = pipelineStageForNode(currentNode) === "VALIDATING_PROMPT" ? promptGateFailureStage(executionError) : null;
      const failureStage = pipelineStageForNode(currentNode) === "WRITING_PROMPT" ? classifyH3PromptEngineError(executionError) : pipelineStageForNode(currentNode) === "VALIDATING_PROMPT" ? gateFailure ?? "PROMPT_VALIDATION_FAILED" : pipelineStageForNode(currentNode) === "UNLOADING_LLM" ? "LLM_UNLOAD_FAILED" : "H3_GENERATION_FAILED";
      const promptEngine = this.promptEngineByPromptId.get(remotePromptId);
      publish({
        status: "failed",
        currentNode,
        pipelineStage: failureStage,
        failureStage,
        error: h3PromptEngineErrorMessage(executionError, promptEngine),
        connectionError: null,
        ...promptCleanupAudit(executionError),
        promptEngine: promptEngine ?? null,
        ...currentNode === "152" ? { llmUnloadSucceeded: false, llmUnloadError: executionError } : {},
        ...h3PromptEngineAudit(promptEngine)
      });
    } else if (type === "execution_interrupted") {
      publish({ status: "failed", pipelineStage: "H3_GENERATION_FAILED", failureStage: "H3_GENERATION_FAILED", error: "ComfyUI interrupted the execution.", connectionError: null });
    }
  }
};

// src/domain/settings.ts
var LM_STUDIO_BASE_URL = "http://127.0.0.1:1234";
var defaultH3PromptEngineSettings = {
  provider: "lmstudio-remote",
  endpoint: `${LM_STUDIO_BASE_URL}/v1`,
  model: h3PromptEngineModelId,
  ...h3PromptEngineProductionDefaults,
  unloadModelBeforeH3: true
};

// src/local-runner/canary-executor.ts
function stagedAssetPath(session, assetId) {
  const asset = session.bundle.assets.find((candidate) => candidate.id === assetId);
  if (!asset) throw new Error(`Staged asset ${assetId} is missing.`);
  return (0, import_node_path7.join)(session.sessionDirectory, "assets", `${asset.id}__${asset.filename}`);
}
function buildRequest(session, job) {
  const settings = job.settingsSnapshot ?? session.bundle.settings;
  const workflow = settings.h3 ? settings.h3 : validateH3WorkflowSettings(h3WorkflowSettingsFromBrief(settings.brief));
  const promptEngine = settings.promptEngine ?? defaultH3PromptEngineSettings;
  const referenceImages = job.referenceAssetIds.map((assetId) => ({ localPath: stagedAssetPath(session, assetId) }));
  const supportBRoll = isNoProductVideo(job.contentType);
  return {
    autoJobId: job.jobId,
    autoSessionId: session.sessionId,
    autoCycleNumber: job.cycleNumber,
    localJobId: job.jobId,
    product: job.product,
    mode: supportBRoll ? "T2VA" : "REF2VA",
    generationBrief: job.generationBrief,
    generationBriefText: serializeH3GenerationBrief(job.generationBrief),
    referenceContext: buildH3ReferenceContext(job.generationBrief),
    mediaManifest: job.generationBrief.mediaManifest,
    allowedReferenceLabels: job.generationBrief.allowedReferenceLabels,
    promptEngine,
    systemPromptOverride: session.bundle.systemPrompt,
    duration: job.durationSeconds ?? workflow.durationSeconds,
    aspectRatio: workflow.aspectRatio,
    fps: workflow.fps,
    frames: workflow.frameLength,
    megapixels: workflow.megapixels,
    multiple: workflow.multiple,
    steps: workflow.steps,
    seed: workflow.seed,
    scheduler: workflow.scheduler,
    refImageSize: workflow.refImageSize,
    workflowSettings: workflow,
    firstFrame: null,
    lastFrame: null,
    productReference: null,
    referenceImages,
    productReferencePath: job.referenceAssetIds[0] ? stagedAssetPath(session, job.referenceAssetIds[0]) : null
  };
}
var terminal = (state) => ["completed", "failed", "error"].includes(state.status);
var LocalCanaryExecutor = class {
  providers = /* @__PURE__ */ new Map();
  provider(session, job) {
    const supportBRoll = isNoProductVideo(job.contentType);
    const providerKey = `${session.sessionId}:${supportBRoll ? "t2va" : "ref2va"}`;
    let provider = this.providers.get(providerKey);
    if (!provider) {
      provider = new RemoteComfyComputeProvider({
        baseUrl: "http://127.0.0.1:8188",
        workflowPath: (0, import_node_path7.join)(session.sessionDirectory, supportBRoll ? "workflow-support-b-roll-t2va.json" : "workflow.json"),
        auth: { type: "none" },
        includeSubmissionJson: true,
        localReferenceRoots: [(0, import_node_path7.join)(session.sessionDirectory, "assets")],
        pollIntervalMs: 1e3
      });
      this.providers.set(providerKey, provider);
    }
    return provider;
  }
  async executeStep(session, job, hooks) {
    if (isCtaEndCard(job.contentType)) {
      if (job.phase === "COMPLETED" || job.phase === "FAILED") return job;
      try {
        if (job.product === "full-series") throw new Error("CTA Full Series requires a verified composite master; the serum thumbnail is not a Full Series master.");
        const assetId = job.referenceAssetIds[0];
        if (!assetId) throw new Error(`CTA verified product master missing for ${job.product}.`);
        const settings = job.settingsSnapshot?.brief ?? session.bundle.settings.brief;
        const date = job.createdAt.slice(0, 10);
        const path = (0, import_node_path7.join)(session.bundle.archiveRoot, date, job.product, "CTA-End-Card", `${job.jobId}.mp4`);
        const result = await renderCtaEndCard({
          productId: job.product,
          masterPath: stagedAssetPath(session, assetId),
          outputPath: path,
          settings: { ...settings.cta ?? defaultCtaSettings, duration: job.durationSeconds ?? settings.duration },
          language: settings.language,
          aspectRatio: settings.aspectRatio === "Custom" ? "9:16" : settings.aspectRatio,
          seed: job.creativeSeed,
          previousStyle: job.ctaPreviousStyle
        });
        return hooks.update("COMPLETED", {
          archivePath: result.path,
          archiveSha256: result.sha256,
          archiveSize: result.size,
          ctaStyle: result.style,
          outputSize: result.size,
          outputFilename: result.path,
          archivedAt: (/* @__PURE__ */ new Date()).toISOString(),
          completedAt: (/* @__PURE__ */ new Date()).toISOString(),
          error: null
        });
      } catch (error) {
        return hooks.update("FAILED", { error: String(error), completedAt: (/* @__PURE__ */ new Date()).toISOString() });
      }
    }
    const provider = this.provider(session, job);
    let current = job;
    try {
      if (current.phase === "PREPARING") {
        const request = current.request ?? buildRequest(session, current);
        current = hooks.update("PREPARING", { request });
        const submitted = await provider.submitH3(request, (state) => {
          if (state.submissionJson && !current.submissionHash) current = hooks.update("SUBMISSION_INTENT_PERSISTED", { submissionHash: sha256(state.submissionJson), executionState: state });
          else if (state.remotePromptId) current = hooks.update(state.status === "running" ? "RUNNING" : "SUBMITTED", { promptId: state.remotePromptId, executionState: state });
          else current = hooks.update(current.phase, { executionState: state });
        }, request.productReferencePath ? { productReferencePath: request.productReferencePath } : void 0);
        if (!submitted.remotePromptId) return current;
        current = hooks.update(submitted.status === "running" ? "RUNNING" : "SUBMITTED", { promptId: submitted.remotePromptId, executionState: submitted });
      }
      if (current.phase === "SUBMISSION_INTENT_PERSISTED" && !current.promptId) {
        const recovered = await provider.reconcileAutoJob(current.jobId);
        return recovered ? hooks.update("SUBMITTED", { promptId: recovered }) : current;
      }
      if ((current.phase === "SUBMITTED" || current.phase === "RUNNING") && current.promptId) {
        const state = await provider.getJobState(current.promptId);
        current = hooks.update(state.status === "running" || state.status === "queued" || state.status === "submitted" ? "RUNNING" : current.phase, { executionState: state });
        if (!terminal(state)) return current;
        if (state.status !== "completed") return hooks.update("FAILED", { error: state.error ?? state.failureStage ?? "Canary H3 workflow failed." });
        const output = findComfyVideoOutputs(state.outputs)[0];
        if (!output) return hooks.update("FAILED", { error: "H3 completed without an authoritative SaveVideo output." });
        current = hooks.update("OUTPUT_CAPTURED", { outputFilename: output.filename, outputCapturedAt: (/* @__PURE__ */ new Date()).toISOString(), executionState: state });
      }
      if (current.phase === "OUTPUT_CAPTURED") {
        const output = findComfyVideoOutputs(current.executionState?.outputs ?? [])[0];
        if (!output) return hooks.update("FAILED", { error: "Captured output metadata is unavailable for local archive." });
        const relativePath = `${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}/${safeOutputComponent(current.product)}/${safeOutputComponent(current.contentType)}/${current.jobId}.mp4`;
        const archive = await provider.archiveAutoOutput(output, session.bundle.archiveRoot, relativePath);
        const archiveSha256 = sha256((0, import_node_fs7.readFileSync)(archive.path));
        current = hooks.update("ARCHIVED", { archivePath: archive.path, archiveSize: archive.size, outputSize: archive.size, archiveSha256, archivedAt: (/* @__PURE__ */ new Date()).toISOString() });
      }
      if (current.phase === "ARCHIVED" || current.phase === "RELEASING_VRAM") {
        if (!current.promptId) return hooks.update("FAILED", { error: "Cannot authorize local VRAM release without the persisted prompt ID." });
        const promptId = current.promptId;
        const attempts = (current.releaseAttempts ?? 0) + 1;
        current = hooks.update("RELEASING_VRAM", { releaseAttempts: attempts });
        const audit = await provider.releaseH3Vram({ previousJobId: current.jobId, previousPromptId: promptId, completionProven: true, completionEvidence: current.archivePath ? "china_archive" : "output" }, (next) => {
          current = hooks.update("RELEASING_VRAM", { vramAudit: next, releaseAttempts: attempts });
        });
        if (audit.h3VramReleaseSucceeded === true && audit.h3VramVerification === "PASSED" && audit.h3VramPostMeasurementFresh === true) return hooks.update("COMPLETED", { vramAudit: audit, error: null });
        if (attempts >= 3) return hooks.update("FAILED", { vramAudit: audit, error: audit.h3VramReleaseError ?? "Fresh local GPU telemetry did not verify VRAM release after three attempts." });
        return hooks.update("RELEASING_VRAM", { vramAudit: audit, error: audit.h3VramReleaseError ?? "Local VRAM verification pending retry." });
      }
      return current;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (/acceptance is unknown|fetch failed|network|socket|ECONN|ECONNREFUSED|timeout|temporar/i.test(message)) return current;
      return hooks.update("FAILED", { error: message });
    }
  }
};

// src/local-runner/runner.ts
var now2 = () => (/* @__PURE__ */ new Date()).toISOString();
var newSeed = () => (0, import_node_crypto5.randomInt)(0, 4294967296);
var h3ExecutionStages = /* @__PURE__ */ new Set([
  "QUEUED_H3",
  "GENERATING_H3",
  "RELEASING_H3_VRAM",
  "DOWNLOADING",
  "COMPLETE",
  "H3_GENERATION_FAILED",
  "REMOTE_STATE_LOST",
  "DOWNLOAD_FAILED"
]);
function h3LifecycleStarted(job) {
  if (isCtaEndCard(job.contentType)) return false;
  const pipelineStage = job.executionState?.pipelineStage;
  return Boolean(job.archivePath || job.vramAudit || pipelineStage && h3ExecutionStages.has(pipelineStage));
}
var LocalGenerationRunner = class {
  stateRoot;
  archiveRoot;
  address;
  port;
  store;
  comfy;
  lmStudio;
  mode;
  canaryExecutor;
  canaryTimer;
  driving = /* @__PURE__ */ new Set();
  startOperations = /* @__PURE__ */ new Map();
  closed = false;
  constructor(options = {}) {
    const configuredMode = options.mode ?? (process.env.RUNNER_MODE ?? "shadow").toLowerCase();
    if (configuredMode !== "shadow" && configuredMode !== "canary" && configuredMode !== "two-job-canary" && configuredMode !== "production") throw new Error("Runner mode must be shadow, canary, two-job-canary, or production.");
    this.mode = configuredMode;
    this.stateRoot = options.stateRoot ?? process.env.PROYA_AUTO_STATE_ROOT ?? DEFAULT_STATE_ROOT;
    this.archiveRoot = options.archiveRoot ?? process.env.PROYA_H3_ARCHIVE_ROOT ?? DEFAULT_ARCHIVE_ROOT;
    this.address = options.address ?? DEFAULT_API_ADDRESS;
    this.port = options.port ?? DEFAULT_API_PORT;
    this.store = options.store ?? new LocalRunnerStore((0, import_node_path8.join)(this.stateRoot, "runner.sqlite3"));
    this.comfy = options.comfy ?? new LocalComfyClient(this.mode);
    this.lmStudio = options.lmStudio ?? new LocalLmStudioClient();
    this.canaryExecutor = options.canaryExecutor ?? new LocalCanaryExecutor();
    this.canaryTimer = this.mode !== "shadow" ? setInterval(() => {
      void this.resumeCanaries();
    }, options.schedulerIntervalMs ?? 5e3) : null;
    if (this.mode !== "shadow") queueMicrotask(() => {
      void this.resumeCanaries();
    });
  }
  capabilities() {
    return {
      runnerVersion: LOCAL_RUNNER_VERSION,
      bundleSchemaVersion: SESSION_BUNDLE_SCHEMA_VERSION,
      mode: this.mode,
      listenAddress: `${this.address}:${this.port}`,
      comfyUrl: LOCAL_COMFY_URL,
      lmStudioUrl: LOCAL_LM_STUDIO_URL,
      archiveRoot: this.archiveRoot,
      generationEnabled: this.mode !== "shadow",
      promptSubmissionEnabled: this.mode !== "shadow",
      canaryStartEnabled: this.mode !== "shadow",
      maxJobsPerSession: this.mode === "production" ? null : this.mode === "two-job-canary" ? 2 : 1
    };
  }
  async health() {
    const [comfy, lmStudio] = await Promise.all([this.comfy.readiness(), this.lmStudio.readiness()]);
    const lmDetails = lmStudio.details && typeof lmStudio.details === "object" ? lmStudio.details : {};
    return {
      ready: comfy.ready && lmStudio.ready,
      mode: this.mode,
      checkedAt: now2(),
      comfy,
      lmStudio,
      lmStudioLocal: lmStudio.ready ? "ready" : "not_ready",
      qwenModelAvailable: lmDetails.available === true,
      requiredModel: lmDetails.requiredModel ?? null,
      matchedField: lmDetails.matchedField ?? null,
      matchedValue: lmDetails.matchedValue ?? null,
      stateDatabase: this.store.path,
      archiveRoot: this.archiveRoot
    };
  }
  async stage(bundle) {
    const result = await stageSessionBundle(bundle, { store: this.store, stateRoot: this.stateRoot, archiveRoot: this.archiveRoot, comfy: this.comfy, lmStudio: this.lmStudio });
    return { ...result, mode: this.mode };
  }
  currentSession() {
    return this.store.currentSession();
  }
  session(id) {
    return this.store.getSession(id);
  }
  stagingPersistence(id) {
    return this.store.stagingPersistence(id);
  }
  jobs(sessionId, afterRevision = 0) {
    return this.store.listJobs(sessionId, afterRevision);
  }
  startCanary(sessionId, bundleHash) {
    const same = this.startOperations.get(sessionId);
    if (same) return same;
    if (this.startOperations.size > 0) return Promise.reject(new Error("Another canary Start transaction is in progress."));
    const operation = this.commitCanaryStart(sessionId, bundleHash);
    this.startOperations.set(sessionId, operation);
    void operation.then(() => {
      this.startOperations.delete(sessionId);
    }, () => {
      this.startOperations.delete(sessionId);
    });
    return operation;
  }
  async commitCanaryStart(sessionId, bundleHash) {
    if (this.mode === "shadow") throw new Error("Canary Start is disabled in shadow mode.");
    const maxJobsPerSession = this.mode === "production" ? null : this.mode === "two-job-canary" ? 2 : 1;
    const startingStatus = this.mode === "production" ? "PRODUCTION_STARTING" : this.mode === "two-job-canary" ? "TWO_JOB_CANARY_STARTING" : "CANARY_STARTING";
    const runningStatuses = ["CANARY_STARTING", "CANARY_RUNNING", "TWO_JOB_CANARY_STARTING", "TWO_JOB_CANARY_RUNNING", "PRODUCTION_STARTING", "PRODUCTION_RUNNING"];
    const terminalStatuses = ["CANARY_FINISHED", "TWO_JOB_CANARY_FINISHED"];
    const session = this.requireSession(sessionId);
    if (session.bundleHash !== bundleHash) throw new Error("Start bundle identity does not match the staged session.");
    if ([...runningStatuses, ...terminalStatuses].includes(session.status)) return { started: true, idempotent: true, sessionId, bundleHash, revision: session.revision, status: session.status, maxJobsPerSession };
    if (session.status !== "STAGED") throw new Error(`Session ${sessionId} is not STAGED / READY.`);
    if (this.mode !== "production" && this.store.listJobs(sessionId).length > 0) throw new Error("Canary job limit already consumed for this session.");
    const active = this.store.listSessions().find((candidate) => candidate.sessionId !== sessionId && runningStatuses.includes(candidate.status));
    if (active) throw new Error(`Another canary session is active: ${active.sessionId}.`);
    const health = await this.health();
    if (session.bundle.selectedContentTypes.some((type) => !isCtaEndCard(type)) && health.ready !== true) throw new Error("Local Auto Run Start requires current local ComfyUI, Qwen, and archive readiness.");
    const started = this.store.saveSession({ ...session, status: startingStatus, lastError: null }, this.mode === "production" ? "PRODUCTION_START_COMMITTED" : "CANARY_START_COMMITTED");
    queueMicrotask(() => {
      void this.driveCanary(sessionId);
    });
    return { started: true, idempotent: false, sessionId, bundleHash, revision: started.revision, status: started.status, maxJobsPerSession };
  }
  updateSettings(sessionId, version, settings) {
    return this.store.saveSettings(sessionId, version, settings);
  }
  acknowledgeLocalOutputSync(jobId, path) {
    const job = this.store.getJob(jobId);
    if (!job || job.phase !== "COMPLETED" || !job.archiveSha256) throw new Error("Only a completed authoritative artifact can be marked synced.");
    return this.store.updateJob(jobId, job.phase, { laptopSyncedAt: now2(), laptopSyncPath: path });
  }
  requestStopAfterCurrent(sessionId) {
    const session = this.requireSession(sessionId);
    return this.store.saveSession({ ...session, stopAfterCurrent: true, status: session.currentJobId ? "STOPPING" : "STOPPED" }, "STOP_AFTER_CURRENT_COMMITTED");
  }
  requestStopNow(sessionId) {
    const session = this.requireSession(sessionId);
    return this.store.saveSession({ ...session, stopNow: true, stopAfterCurrent: true, status: "STOPPED" }, "STOP_NOW_COMMITTED");
  }
  /** Shadow-only scheduler simulation. It creates plans and durable jobs but never submits. */
  simulateNextJob(sessionId) {
    if (this.mode !== "shadow") throw new Error("Shadow simulation is disabled in autonomous canary modes.");
    return this.planJob(sessionId, "SHADOW_SIMULATING", "SHADOW_JOB_SELECTED");
  }
  planJob(sessionId, status, eventType) {
    const session = this.requireSession(sessionId);
    if (session.stopNow || session.stopAfterCurrent && !session.currentJobId) throw new Error("Session stop intent prevents another simulated job.");
    const productId = session.bundle.ordering.productOrder[session.productIndex];
    const contentType = session.bundle.ordering.contentTypeOrder[session.contentTypeIndex];
    const schedulerKey = `${session.cycleNumber}:${session.productIndex}:${session.contentTypeIndex}`;
    const existing = this.store.listJobs(sessionId).find((job2) => job2.schedulerKey === schedulerKey);
    if (existing) {
      if (session.currentJobId !== existing.jobId) this.store.saveSession({ ...session, status, currentJobId: existing.jobId }, `${eventType}_RECOVERED`);
      return existing;
    }
    const product = session.bundle.products.find((item) => item.id === productId);
    if (!product) throw new Error(`Staged metadata for ${productId} is missing.`);
    const settings = this.store.getSettings(sessionId, session.settingsVersion);
    const brief = structuredClone(settings.brief);
    brief.product = product.id;
    brief.contentType = contentType;
    brief.duration = selectAutoDuration();
    brief.hookArchetype = contentType === "Hook" ? brief.hookArchetype ?? selectHookArchetype() : void 0;
    const supportBRoll = isNoProductVideo(contentType);
    brief.references = supportBRoll ? supportBRollReferencePlan(createOptionalH3ReferencePlan(product)) : createH3ReferencePlan(product);
    const binding = session.bundle.productReferences.find((item) => item.productId === product.id);
    if (!supportBRoll && !binding?.assetIds.length) throw new Error(`Staged reference mapping for ${product.id} is missing.`);
    const primary = binding?.assetIds[0] ? session.bundle.assets.find((asset) => asset.id === binding.assetIds[0]) : void 0;
    if (!supportBRoll && !primary) throw new Error(`Staged master ${binding?.assetIds[0]} is missing.`);
    if (!supportBRoll && primary) brief.references.productReference = { source: "selected-product", description: `${product.officialName} packaging reference`, path: (0, import_node_path8.join)(session.sessionDirectory, "assets", `${primary.id}__${primary.filename}`) };
    const jobId = `h3-auto-${sessionId}-${session.cycleNumber}-${product.id}-${safeOutputComponent(contentType)}-${(0, import_node_crypto5.randomUUID)()}`;
    const creativeSeed = (newSeed() ^ session.cycleSeed) >>> 0;
    const history = this.store.listJobs(sessionId).map((job2) => ({
      id: job2.jobId,
      generationJobId: job2.jobId,
      product: job2.product,
      contentFamily: job2.contentType,
      genome: job2.creativeGenome,
      conceptSummary: null,
      createdAt: job2.createdAt,
      generationStatus: "planned"
    }));
    const plan = planCreativeGenome({ product, contentFamily: contentType, userIdea: brief.videoIdea, specialInstructions: brief.specialInstructions, recentHistory: history, variety: brief.creativeVariety, seed: creativeSeed, generationJobId: jobId, options: { sameProductFamilyWindow: 100, maxRerolls: 1e3 } });
    brief.creativeGenome = plan.genome;
    const generationBrief = buildH3GenerationBrief({ product, brief, genome: plan.genome, references: brief.references });
    const timestamp = now2();
    const job = this.store.createJob({
      jobId,
      sessionId,
      schedulerKey,
      phase: "PREPARING",
      cycleNumber: session.cycleNumber,
      productIndex: session.productIndex,
      contentTypeIndex: session.contentTypeIndex,
      product: product.id,
      contentType,
      durationSeconds: brief.duration,
      settingsVersion: session.settingsVersion,
      hookArchetype: brief.hookArchetype,
      settingsSnapshot: { ...structuredClone(settings), brief: structuredClone(brief), h3: validateH3WorkflowSettings(h3WorkflowSettingsFromBrief(brief)) },
      creativeSeed,
      ctaPreviousStyle: isCtaEndCard(contentType) ? this.store.listJobs(sessionId).filter((item) => item.product === product.id && isCtaEndCard(item.contentType) && item.ctaStyle).at(-1)?.ctaStyle : void 0,
      creativeGenome: plan.genome,
      creativeFingerprint: plan.fingerprint.signature,
      generationBrief,
      referenceAssetIds: supportBRoll ? [] : [...binding.assetIds],
      promptId: null,
      submissionHash: null,
      archivePath: null,
      archiveSize: null,
      archiveSha256: null,
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      error: null
    });
    this.store.saveSession({ ...session, status, currentJobId: job.jobId }, eventType);
    return job;
  }
  async resumeCanaries() {
    if (this.closed) return;
    for (const session of this.store.listSessions().filter(
      (candidate) => ["CANARY_STARTING", "CANARY_RUNNING", "TWO_JOB_CANARY_STARTING", "TWO_JOB_CANARY_RUNNING", "PRODUCTION_STARTING", "PRODUCTION_RUNNING"].includes(candidate.status) || candidate.status === "STOPPING" && candidate.stopAfterCurrent && candidate.currentJobId !== null
    )) await this.driveCanary(session.sessionId);
  }
  async driveCanary(sessionId) {
    if (this.closed || this.mode === "shadow" || this.driving.has(sessionId)) return;
    this.driving.add(sessionId);
    try {
      const maxJobs = this.mode === "production" ? null : this.mode === "two-job-canary" ? 2 : 1;
      const runningStatus = this.mode === "production" ? "PRODUCTION_RUNNING" : this.mode === "two-job-canary" ? "TWO_JOB_CANARY_RUNNING" : "CANARY_RUNNING";
      const finishedStatus = this.mode === "two-job-canary" ? "TWO_JOB_CANARY_FINISHED" : "CANARY_FINISHED";
      while (!this.closed) {
        let session = this.requireSession(sessionId);
        const stopping = session.status === "STOPPING" && session.stopAfterCurrent;
        if (session.status === "STOPPED" || session.stopNow) return;
        const jobs = this.store.listJobs(sessionId);
        if (maxJobs !== null && jobs.length > maxJobs) throw new Error(`CANARY SAFETY: more than ${maxJobs} jobs exist for the session.`);
        let job = session.currentJobId ? this.store.getJob(session.currentJobId) : null;
        if (!job) {
          if (stopping) {
            this.store.saveSession({ ...session, status: "STOPPED", currentJobId: null }, "CANARY_STOPPED_AFTER_CURRENT");
            return;
          }
          if (maxJobs !== null && jobs.length >= maxJobs) {
            this.store.saveSession({ ...session, status: finishedStatus, currentJobId: null, lastError: jobs.at(-1)?.error ?? null }, "CANARY_JOB_LIMIT_FINISHED");
            return;
          }
          job = this.planJob(sessionId, runningStatus, jobs.length === 0 ? "CANARY_JOB_SELECTED" : "CANARY_NEXT_JOB_SELECTED");
        } else if (!stopping && session.status !== runningStatus) {
          this.store.saveSession({ ...session, status: runningStatus, currentJobId: job.jobId }, "CANARY_RECOVERY_RESUMED");
        }
        session = this.requireSession(sessionId);
        const update = (phase, patch = {}) => this.store.updateJob(job.jobId, phase, patch);
        const result = await this.canaryExecutor.executeStep(session, this.store.getJob(job.jobId) ?? job, { update });
        if (this.closed) return;
        if (result.phase !== "COMPLETED" && result.phase !== "FAILED") return;
        if (isCtaEndCard(result.contentType)) await new Promise((resolveDelay) => setTimeout(resolveDelay, 5e3));
        const latest = this.requireSession(sessionId);
        if (latest.stopAfterCurrent || latest.stopNow) {
          this.store.saveSession({ ...latest, status: "STOPPED", currentJobId: null, lastError: result.error }, "CANARY_STOPPED_AFTER_CURRENT");
          return;
        }
        if (maxJobs !== null && this.store.listJobs(sessionId).length >= maxJobs) {
          this.store.saveSession({ ...latest, status: finishedStatus, currentJobId: null, lastError: result.error }, "CANARY_JOB_LIMIT_FINISHED");
          return;
        }
        const h3Started = h3LifecycleStarted(result);
        const vramVerified = result.vramAudit?.h3VramReleaseSucceeded === true && result.vramAudit?.h3VramVerification === "PASSED" && result.vramAudit?.h3VramPostMeasurementFresh === true;
        if (h3Started && !vramVerified) {
          this.store.saveSession({ ...latest, status: runningStatus, lastError: "Job terminal state is waiting for verified local VRAM cleanup." }, "CANARY_NEXT_JOB_BLOCKED_VRAM");
          return;
        }
        this.advanceCanaryCursor(result, runningStatus);
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      const job = this.store.listJobs(sessionId).at(-1);
      if (job && !["COMPLETED", "FAILED"].includes(job.phase)) this.store.updateJob(job.jobId, "FAILED", { error: message, completedAt: now2() });
      const session = this.store.getSession(sessionId);
      if (session) this.store.saveSession({ ...session, status: this.mode === "production" ? "FAILED" : this.mode === "two-job-canary" ? "TWO_JOB_CANARY_FINISHED" : "CANARY_FINISHED", currentJobId: null, lastError: message }, this.mode === "production" ? "PRODUCTION_INFRASTRUCTURE_FAILURE" : "CANARY_FATAL_FAILURE");
    } finally {
      this.driving.delete(sessionId);
    }
  }
  advanceCanaryCursor(job, runningStatus) {
    const session = this.requireSession(job.sessionId);
    if (session.currentJobId !== job.jobId) return;
    const advanced = advanceAutoCursor({
      selectedProducts: session.bundle.selectedProducts,
      selectedContentTypes: session.bundle.selectedContentTypes,
      shuffleProducts: session.bundle.ordering.shuffleProducts,
      shuffleContentTypes: session.bundle.ordering.shuffleContentTypes,
      chinaRoot: session.bundle.archiveRoot,
      laptopRoot: "",
      sessionId: session.sessionId,
      status: "RUNNING",
      startedAt: session.createdAt,
      stoppedAt: null,
      productOrder: session.bundle.ordering.productOrder,
      contentTypeOrder: session.bundle.ordering.contentTypeOrder,
      cycleNumber: session.cycleNumber,
      cycleSeed: session.cycleSeed,
      productIndex: session.productIndex,
      contentTypeIndex: session.contentTypeIndex,
      generatedCount: 0,
      completedCount: 0,
      failedCount: 0,
      pendingLaptopDownloads: 0,
      stopRequested: false,
      currentJobId: job.jobId,
      lastSuccessfulJobId: null,
      lastError: null
    }, newSeed());
    this.store.saveSession({ ...session, currentJobId: null, status: runningStatus, productIndex: advanced.productIndex, contentTypeIndex: advanced.contentTypeIndex, cycleNumber: advanced.cycleNumber, cycleSeed: advanced.cycleSeed, bundle: { ...session.bundle, ordering: { ...session.bundle.ordering, productOrder: advanced.productOrder, contentTypeOrder: advanced.contentTypeOrder } } }, "CANARY_CURSOR_ADVANCED");
  }
  simulatePhase(jobId, phase) {
    const job = this.store.getJob(jobId);
    if (!job) throw new Error("Unknown job.");
    const saved = this.store.updateJob(jobId, phase);
    if (phase === "COMPLETED" || phase === "FAILED") this.advanceAfterTerminal(saved);
    return saved;
  }
  persistSubmissionIntent(jobId, submission) {
    const job = this.store.getJob(jobId);
    if (!job) throw new Error("Unknown job.");
    return this.store.updateJob(jobId, "SUBMISSION_INTENT_PERSISTED", { submissionHash: LocalComfyClient.submissionHash(submission) });
  }
  async recoverSubmissionIntent(jobId) {
    const job = this.store.getJob(jobId);
    if (!job) throw new Error("Unknown job.");
    if (job.phase !== "SUBMISSION_INTENT_PERSISTED" || job.promptId) return { job, ambiguous: false };
    const promptId = await this.comfy.reconcileIdentity(job.jobId);
    if (!promptId) return { job, ambiguous: true };
    return { job: this.store.updateJob(jobId, "SUBMITTED", { promptId }), ambiguous: false };
  }
  async submitGeneration() {
    throw new Error("SHADOW SAFETY: generation submission is impossible in Phase 1.");
  }
  advanceAfterTerminal(job) {
    const session = this.requireSession(job.sessionId);
    if (session.currentJobId !== job.jobId) return;
    if (session.stopAfterCurrent || session.stopNow) {
      this.store.saveSession({ ...session, currentJobId: null, status: "STOPPED" }, "SHADOW_STOPPED_AFTER_TERMINAL");
      return;
    }
    const advanced = advanceAutoCursor({
      selectedProducts: session.bundle.selectedProducts,
      selectedContentTypes: session.bundle.selectedContentTypes,
      shuffleProducts: session.bundle.ordering.shuffleProducts,
      shuffleContentTypes: session.bundle.ordering.shuffleContentTypes,
      chinaRoot: session.bundle.archiveRoot,
      laptopRoot: "",
      sessionId: session.sessionId,
      status: "RUNNING",
      startedAt: session.createdAt,
      stoppedAt: null,
      productOrder: session.bundle.ordering.productOrder,
      contentTypeOrder: session.bundle.ordering.contentTypeOrder,
      cycleNumber: session.cycleNumber,
      cycleSeed: session.cycleSeed,
      productIndex: session.productIndex,
      contentTypeIndex: session.contentTypeIndex,
      generatedCount: 0,
      completedCount: 0,
      failedCount: 0,
      pendingLaptopDownloads: 0,
      stopRequested: false,
      currentJobId: job.jobId,
      lastSuccessfulJobId: null,
      lastError: null
    }, newSeed());
    this.store.saveSession({ ...session, currentJobId: null, status: "STAGED", productIndex: advanced.productIndex, contentTypeIndex: advanced.contentTypeIndex, cycleNumber: advanced.cycleNumber, cycleSeed: advanced.cycleSeed, bundle: { ...session.bundle, ordering: { ...session.bundle.ordering, productOrder: advanced.productOrder, contentTypeOrder: advanced.contentTypeOrder } } }, "SHADOW_CURSOR_ADVANCED");
  }
  requireSession(id) {
    const session = this.store.getSession(id);
    if (!session) throw new Error("Unknown session.");
    return session;
  }
  describeJob(job) {
    return { ...job, primaryReference: job.referenceAssetIds[0] ? (0, import_node_path8.basename)(job.referenceAssetIds[0]) : null };
  }
  close() {
    this.closed = true;
    if (this.canaryTimer) clearInterval(this.canaryTimer);
    this.store.close();
  }
};

// src/local-runner/service.ts
var import_node_fs8 = require("fs");
var import_node_path9 = require("path");
function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
var RunnerSingletonLock = class {
  path;
  owned = false;
  constructor(stateRoot) {
    (0, import_node_fs8.mkdirSync)(stateRoot, { recursive: true });
    this.path = (0, import_node_path9.join)(stateRoot, "runner.lock");
  }
  acquire() {
    if (this.owned) return;
    if ((0, import_node_fs8.existsSync)(this.path)) {
      try {
        const record = JSON.parse((0, import_node_fs8.readFileSync)(this.path, "utf8"));
        if (Number.isSafeInteger(record.pid) && processAlive(record.pid)) throw new Error(`Local Generation Runner is already active as PID ${record.pid}.`);
      } catch (reason) {
        if (reason instanceof Error && reason.message.startsWith("Local Generation Runner is already active")) throw reason;
      }
      (0, import_node_fs8.rmSync)(this.path, { force: true });
    }
    let descriptor = null;
    try {
      descriptor = (0, import_node_fs8.openSync)(this.path, "wx");
      (0, import_node_fs8.writeFileSync)(descriptor, JSON.stringify({ pid: process.pid, startedAt: (/* @__PURE__ */ new Date()).toISOString() }), { flush: true });
      this.owned = true;
    } finally {
      if (descriptor !== null) (0, import_node_fs8.closeSync)(descriptor);
    }
  }
  release() {
    if (!this.owned) return;
    try {
      const record = JSON.parse((0, import_node_fs8.readFileSync)(this.path, "utf8"));
      if (record.pid === process.pid) (0, import_node_fs8.rmSync)(this.path, { force: true });
    } finally {
      this.owned = false;
    }
  }
};

// src/local-runner/index.ts
var runner = new LocalGenerationRunner();
var lock = new RunnerSingletonLock(runner.stateRoot);
lock.acquire();
var server = createRunnerApi(runner);
var shutdown = () => {
  server.close(() => {
    runner.close();
    lock.release();
    process.exit(0);
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("uncaughtException", (reason) => {
  console.error(reason);
  shutdown();
});
server.listen(runner.port, runner.address, () => {
  console.log(JSON.stringify({ event: "runner-listening", ...runner.capabilities(), stateDatabase: runner.store.path }));
});
//# sourceMappingURL=runner.cjs.map