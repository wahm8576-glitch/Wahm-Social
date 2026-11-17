import "server-only";
/** Per-entry test buttons: proxies, Worker relays, TikTok sessions, Instagram sessions. */
import { proxiedFetch } from "../server/http";
import { rewriteViaRelay } from "../server/relay";
import { formatLines, probeCountik, probeInstagram, probeIp, probeTikTok, probeTikwm, type ProbeLine } from "./probe";
import type { PoolEntry, PoolKind } from "./types";

export interface TestResult {
  at: string;
  ok: boolean;
  summary: string;
}

const g = globalThis as unknown as { __frostlyPoolTests?: Map<string, TestResult> };
const results = () => (g.__frostlyPoolTests ??= new Map());
export const lastTest = (kind: PoolKind, id: string) => results().get(`${kind}:${id}`);

function viaRelay(base: string): typeof fetch {
  return ((input: string, init?: RequestInit) => {
    // The Worker sets its own UA and drops cookies; only pass accept.
    const h = (init?.headers ?? {}) as Record<string, string>;
    return fetch(rewriteViaRelay(input, base), { ...init, headers: { accept: h.accept ?? "*/*" } });
  }) as unknown as typeof fetch;
}

function igCookie(e: PoolEntry): string {
  const c = e.ig!;
  const ds = c.dsUserId || decodeURIComponent(c.sessionid).split(":")[0].replace(/\D/g, "");
  return [["sessionid", c.sessionid], ["ds_user_id", ds], ["csrftoken", c.csrftoken], ["mid", c.mid], ["datr", c.datr]]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

export async function testEntry(kind: PoolKind, e: PoolEntry): Promise<string> {
  let lines: ProbeLine[] = [];
  let title = "";
  if (kind === "proxies") {
    const f = (await proxiedFetch(e.url!))!;
    title = `اختبار البروكسي «${e.label || e.id}»:`;
    const [ip, tt, tw, ig] = await Promise.all([probeIp(f), probeTikTok(f), probeTikwm(f), probeInstagram(f)]);
    const ck = await probeCountik(f, tt.secUid);
    lines = [ip, tt, tw, ck, ig];
  } else if (kind === "relays") {
    const f = viaRelay(e.url!.replace(/\/+$/, ""));
    title = `اختبار الـ Worker «${e.label || e.id}»:`;
    const [tt, tw] = await Promise.all([probeTikTok(f), probeTikwm(f)]);
    const ck = await probeCountik(f, tt.secUid);
    lines = [tt, tw, ck];
  } else if (kind === "tiktok") {
    // Session pages are personalised: send them through the active proxy (or direct), never the Worker.
    const f = (await proxiedFetch()) ?? fetch;
    title = `اختبار جلسة تيك توك «${e.label || e.id}» (عبر البروكسي النشط):`;
    lines = [await probeTikTok(f, e.cookie)];
  } else {
    const f = (await proxiedFetch(undefined, "ig")) ?? fetch;
    title = `اختبار جلسة انستقرام «${e.label || e.id}» (عبر البروكسي النشط):`;
    lines = [await probeInstagram(f, igCookie(e), e.ig?.csrftoken)];
  }
  const relevant = kind === "tiktok" ? lines.every((l) => l.verdict === "ok" && !/❌/.test(l.note ?? "")) : lines.some((l) => l.verdict === "ok");
  const summary = lines.map((l) => `${l.target.replace(".com", "")}:${l.verdict === "ok" ? "✅" : l.verdict === "blocked" ? "⛔" : l.verdict === "error" ? "❌" : "⚠️"}${l.target === "IP الخروج" && l.note ? ` ${l.note}` : ""}`).join(" · ");
  results().set(`${kind}:${e.id}`, { at: new Date().toISOString(), ok: relevant, summary });
  return formatLines(title, lines);
}
