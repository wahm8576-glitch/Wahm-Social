import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { handler } from "@/lib/server/respond";
import { PlatformError } from "@/lib/platforms/types";
import { clientIp } from "@/lib/server/rateLimit";
import { redeemForUser } from "@/lib/billing/codes-service";
import { getDict } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

const Body = z.object({ code: z.string().min(1).max(80) });

export const POST = handler(async (req: Request) => {
  const user = await requireUser();
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new PlatformError("invalid_input", "Invalid code", 400);
  const { locale } = getDict();
  const out = await redeemForUser({ rawCode: parsed.data.code, user, ip: clientIp(req), locale });
  if (!out.ok) {
    const message = locale === "en" ? out.messageEn : out.messageAr;
    throw new PlatformError(out.code === "rate_limited" ? "rate_limited" : "invalid_input", message, out.status);
  }
  return NextResponse.json({
    ok: true,
    data: { plan: out.plan, planRenewsAt: out.planRenewsAt, extended: out.extended },
  });
});
