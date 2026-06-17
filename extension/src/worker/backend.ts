// Resolves the backend base URL (overridable via storage for local testing).
import { DEFAULT_BACKEND, K } from "../config.js";

export async function backendUrl(): Promise<string> {
  const override = (await chrome.storage.local.get(K.backend))[K.backend] as string | undefined;
  return (override || DEFAULT_BACKEND).replace(/\/+$/, "");
}
