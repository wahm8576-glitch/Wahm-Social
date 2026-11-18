import { adminAction, back } from "@/lib/admin/guard";
import { Users, Payments } from "@/lib/server/db";
import { grantPatch, GrantError, type GrantDuration } from "@/lib/billing/admin-grant";
import type { PlanId } from "@/lib/plans";

export const dynamic = "force-dynamic";

const PLANS: PlanId[] = ["free", "pro", "business"];
const DURATIONS: GrantDuration[] = ["month", "year", "days", "until"];

export async function POST(req: Request) {
  return adminAction("billing", async (r, form) => {
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const plan = String(form.get("plan") ?? "") as PlanId;
    const duration = String(form.get("duration") ?? "month") as GrantDuration;
    const daysRaw = String(form.get("days") ?? "").trim();
    const until = String(form.get("until") ?? "").trim();
    const extend = form.get("extend") === "on";
    if (!email) throw new Error("أدخل بريد المستخدم");
    if (!PLANS.includes(plan)) throw new Error("خطة غير صالحة");
    if (plan !== "free" && !DURATIONS.includes(duration)) throw new Error("مدة غير صالحة");
    const user = Users.byEmail(email);
    if (!user) throw new Error("ما فيه حساب بهذا البريد");
    try {
      const patch = grantPatch(
        { plan, duration, days: daysRaw ? Number(daysRaw) : undefined, until: until || undefined, extend },
        Date.now(),
        { userId: user.id, plan: user.plan, planRenewsAt: user.planRenewsAt },
      );
      if (plan === "free") {
        Users.update(user.id, { plan: "free", planRenewsAt: undefined });
        Payments.create({ userId: user.id, plan: "free", interval: "custom", amount: 0, currency: "USD", provider: "admin", status: "paid" });
        return back(r, "billing", { ok: `تم إلغاء اشتراك ${user.email} وإرجاعه للخطة المجانية.`, email: user.email });
      }
      Users.update(user.id, { plan: patch.plan, planRenewsAt: patch.planRenewsAt });
      Payments.create({
        userId: user.id,
        plan: patch.plan,
        interval: patch.interval,
        amount: 0,
        currency: "USD",
        provider: "admin",
        status: "paid",
      });
      const untilTxt = patch.planRenewsAt
        ? new Date(patch.planRenewsAt).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })
        : "";
      return back(r, "billing", { ok: `تم ${extend ? "تمديد" : "تفعيل"} ${patch.plan} لـ ${user.email} حتى ${untilTxt} (توقيت آسيا/الرياض).`, email: user.email });
    } catch (e) {
      if (e instanceof GrantError) throw new Error(e.message);
      throw e;
    }
  })(req);
}
