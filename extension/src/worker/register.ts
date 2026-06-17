// Device registration against the existing POST /v1/register. Web sessions then
// appear in the same /admin/devices connected-session panel as CLI devices, with
// os:"web". Idempotent: the server upserts on device_id.
import { CLIENT_VERSION, K } from "../config.js";
import { backendUrl } from "./backend.js";
import { getOrCreateIdentity } from "./identity.js";

export async function ensureRegistered(): Promise<void> {
  const already = (await chrome.storage.local.get(K.registered))[K.registered] as boolean | undefined;
  if (already) return;

  const { id } = await getOrCreateIdentity();
  const base = await backendUrl();
  const email = (await chrome.storage.local.get("spnr.email"))["spnr.email"] as string | undefined;

  const res = await fetch(`${base}/v1/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      device_id: id.deviceId,
      pubkey: id.pubHex,
      os: "web",
      arch: navigator.userAgent.includes("Win") ? "x86_64" : "unknown",
      hostname: "claude.ai",
      version: CLIENT_VERSION,
      ...(email ? { email } : {}),
    }),
  });
  if (res.ok) await chrome.storage.local.set({ [K.registered]: true });
}
