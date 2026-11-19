/**
 * Telegram bot webhook. Verifies X-Telegram-Bot-Api-Secret-Token, answers
 * pre_checkout_query within seconds, and activates plans on successful_payment.
 */
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { BillingEvents, Payments, Users } from "@/lib/server/db";
import {
  applyStarsPayment,
  preCheckoutDecision,
  type StarsUser,
  verifyStarPayload,
  StarPayloadError,
} from "@/lib/billing/stars";
import {
  answerPreCheckoutQuery,
  invoiceDescription,
  invoiceTitle,
  sanitizeTelegramError,
  sendStarsInvoice,
  telegramConfigured,
} from "@/lib/billing/telegram";

export const dynamic = "force-dynamic";

function timingEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

function text(chatId: number, text: string) {
  return import("@/lib/billing/telegram").then((m) => m.telegramCall("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true }));
}

export async function POST(req: Request) {
  if (!telegramConfigured() || !env.telegramWebhookSecret) return NextResponse.json({ ok: false }, { status: 503 });
  const header = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!timingEqual(header, env.telegramWebhookSecret)) return NextResponse.json({ ok: false }, { status: 401 });

  let update: Record<string, unknown>;
  try {
    update = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  try {
    const pre = update.pre_checkout_query as
      | { id: string; invoice_payload?: string; currency?: string; total_amount?: number; from?: { id?: number } }
      | undefined;
    if (pre?.id) {
      const decision = preCheckoutDecision(pre, env.jwtSecret, (id) => Users.byId(id) as StarsUser | undefined);
      await answerPreCheckoutQuery(pre.id, decision.ok, decision.ok ? undefined : decision.error);
      return NextResponse.json({ ok: true });
    }

    const message = update.message as
      | {
          chat?: { id?: number };
          from?: { id?: number };
          text?: string;
          successful_payment?: {
            invoice_payload?: string;
            currency?: string;
            total_amount?: number;
            telegram_payment_charge_id?: string;
            is_recurring?: boolean;
            is_first_recurring?: boolean;
            subscription_expiration_date?: number;
          };
        }
      | undefined;

    const chatId = message?.chat?.id;
    const sp = message?.successful_payment;
    if (sp && chatId) {
      applyStarsPayment(sp, {
        findUser: (id) => Users.byId(id) as StarsUser | undefined,
        updateUser: (id, patch) => {
          Users.update(id, patch);
        },
        addPayment: (p) => {
          Payments.create(p);
        },
        seenCharge: (id) => BillingEvents.has(`xtr:${id}`),
        markCharge: (id) => BillingEvents.add(`xtr:${id}`, "telegram_stars"),
      }, env.jwtSecret, { telegramUserId: message.from?.id });
      await text(chatId, "تم الدفع بنجاح ✅ تم تفعيل اشتراكك في فروستلي. يمكنك العودة إلى الموقع: " + env.siteUrl + "/account?upgraded=1");
      return NextResponse.json({ ok: true });
    }

    const raw = (message?.text ?? "").trim();
    const cmd = raw.split(/\s+/)[0]?.split("@")[0]?.toLowerCase() ?? "";
    const arg = raw.split(/\s+/).slice(1).join(" ").trim();
    if (chatId && (cmd === "/start" || cmd === "/paysupport" || cmd === "/terms")) {
      if (cmd === "/paysupport") {
        await text(chatId, "دعم مدفوعات فروستلي:\nللدفع والاسترجاع راسلنا على wahmsec@gmail.com أو راجع سياسة الاسترجاع:\n" + env.siteUrl + "/refund");
      } else if (cmd === "/terms") {
        await text(chatId, "شروط استخدام فروستلي:\n" + env.siteUrl + "/terms\n\nسياسة الاسترجاع (14 يوماً):\n" + env.siteUrl + "/refund");
      } else if (arg) {
        try {
          const data = verifyStarPayload(arg, env.jwtSecret);
          await sendStarsInvoice({
            chatId,
            title: invoiceTitle(data.plan, data.interval),
            description: invoiceDescription(data.plan, data.interval, data.stars),
            payload: arg,
            stars: data.stars,
            interval: data.interval,
          });
        } catch (e) {
          const expired = e instanceof StarPayloadError && e.message === "expired";
          await text(chatId, expired ? "انتهت صلاحية رابط الدفع. ارجع إلى صفحة الأسعار في الموقع وابدأ من جديد:\n" + env.siteUrl + "/pricing" : "رابط الدفع غير صالح. ابدأ الاشتراك من الموقع:\n" + env.siteUrl + "/pricing");
        }
      } else {
        await text(
          chatId,
          "أهلاً بك في بوت الدفع فروستلي ⭐\nمن هنا تدفع بنجوم Telegram لاشتراك برو أو أعمال.\n\nابدأ من صفحة الأسعار (لازم تكون مسجّل دخول):\n" + env.siteUrl + "/pricing",
        );
      }
    }
  } catch (e) {
    console.error("[telegram] webhook:", sanitizeTelegramError(e));
  }
  return NextResponse.json({ ok: true });
}
