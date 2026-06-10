import type { ProviderFactory } from "@amp/core";
import type { ProviderKind } from "@amp/shared";
import { createCliProvider } from "./cli.js";
import { createApiTextProvider } from "./apiText.js";
import { createApiImageProvider } from "./apiImage.js";
import { createWebProvider } from "./web.js";

export const providerFactories: Record<ProviderKind, ProviderFactory> = {
  cli: createCliProvider,
  "api-text": createApiTextProvider,
  "api-image": createApiImageProvider,
  web: createWebProvider,
};

export { createCliProvider, createApiTextProvider, createApiImageProvider, createWebProvider };
