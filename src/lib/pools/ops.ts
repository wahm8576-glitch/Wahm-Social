/** Pure list operations on a pool inside the secrets bag (used inside saveSecrets). */
import { mergedPool } from "./read";
import { poolSecretKey, type PoolEntry, type PoolKind } from "./types";

export const MAX_ENTRIES = 25;

export function currentList(secrets: Record<string, string>, kind: PoolKind, env: NodeJS.ProcessEnv = process.env): PoolEntry[] {
  return mergedPool(secrets, kind, env);
}

export function writeList(secrets: Record<string, string>, kind: PoolKind, list: PoolEntry[]) {
  secrets[poolSecretKey(kind)] = JSON.stringify(list.slice(0, MAX_ENTRIES));
  return secrets;
}

export function newId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export type PoolOp = "delete" | "up" | "down" | "toggle" | "label" | "top";

export function applyOp(list: PoolEntry[], op: PoolOp, id: string, label?: string): PoolEntry[] {
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) throw new Error("العنصر غير موجود (حدّث الصفحة)");
  const out = list.slice();
  switch (op) {
    case "delete":
      out.splice(i, 1);
      break;
    case "toggle":
      out[i] = { ...out[i], enabled: !out[i].enabled };
      break;
    case "label":
      out[i] = { ...out[i], label: (label ?? "").slice(0, 60) };
      break;
    case "up":
      if (i > 0) [out[i - 1], out[i]] = [out[i], out[i - 1]];
      break;
    case "down":
      if (i < out.length - 1) [out[i + 1], out[i]] = [out[i], out[i + 1]];
      break;
    case "top":
      out.unshift(...out.splice(i, 1));
      break;
  }
  return out;
}
