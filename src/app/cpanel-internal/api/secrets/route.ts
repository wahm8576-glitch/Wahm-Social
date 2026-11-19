import { adminAction } from "@/lib/admin/guard";
import { SECRET_DEFS } from "@/lib/admin/secrets-def";
import { saveSecrets } from "@/lib/site/store";
import { validateProxyUrl } from "@/lib/admin/proxyTest";
import { env } from "@/lib/env";
import { deleteTelegramWebhook, ensureTelegramBot, sanitizeTelegramError } from "@/lib/billing/telegram";

export const dynamic = "force-dynamic";

/** Blank field = keep current; "clear_<key>" checkbox = remove the panel override (falls back to Render env). */
export async function POST(req: Request) {
  const page = new URL(req.url).searchParams.get("page") === "proxy" ? "proxy" : "keys";
  return adminAction(page, async (_req, form) => {
    let changed = 0;
    const prevToken = env.telegramBotToken;
    await saveSecrets((cur) => {
      for (const d of SECRET_DEFS) {
        if (form.get(`clear_${d.key}`) === "on") {
          if (cur[d.key]) changed++;
          delete cur[d.key];
          continue;
        }
        const v = String(form.get(d.key) ?? "").trim();
        if (!v) continue;
        if (v.length > 20_000) throw new Error(`${d.label}: القيمة طويلة جداً`);
        if (d.key === "scraperProxy") {
          const bad = validateProxyUrl(v);
          if (bad) throw new Error(bad);
        }
        cur[d.key] = v.replace(/[\r\n]+/g, d.multiline ? " " : "");
        changed++;
      }
      return cur;
    }, "admin: update secrets");
    const nextToken = env.telegramBotToken;
    let telegramNote = "";
    if (prevToken && prevToken !== nextToken) {
      await deleteTelegramWebhook(prevToken);
    }
    if (nextToken && (nextToken !== prevToken || String(form.get("telegramBotToken") ?? "").trim())) {
      try {
        const url = await ensureTelegramBot(true, _req);
        if (url && !String(url).startsWith("skipped")) telegramNote = " — تم تسجيل ويب هوك Telegram";
      } catch (e) {
        telegramNote = ` — حُفظ التوكن لكن تسجيل الويب هوك فشل: ${sanitizeTelegramError(e)}`;
      }
    }
    return changed ? `تم حفظ ${changed} قيمة (مشفّرة) ✅${telegramNote}` : "ما تغيّر شي";
  })(req);
}
