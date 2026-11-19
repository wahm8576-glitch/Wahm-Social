import { adminAction, back } from "@/lib/admin/guard";
import { generateBatch, disableOneCode, disableWholeBatch, peekReveal } from "@/lib/billing/codes-service";
import { db } from "@/lib/server/db";
import type { CodeDurationKind, PaidPlan } from "@/lib/billing/codes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  return adminAction("codes", async (r, form) => {
    const op = String(form.get("op") ?? "generate");
    if (op === "disable_code") {
      disableOneCode(String(form.get("codeId") ?? ""));
      return back(r, "codes", { ok: "تم تعطيل الكود." });
    }
    if (op === "disable_batch") {
      disableWholeBatch(String(form.get("batchId") ?? ""));
      return back(r, "codes", { ok: "تم تعطيل كل أكواد هذه الدفعة." });
    }
    if (op === "generate") {
      const count = Number(String(form.get("count") ?? "").trim());
      const plan = String(form.get("plan") ?? "") as PaidPlan;
      const durationKind = String(form.get("duration") ?? "month") as CodeDurationKind;
      const daysRaw = String(form.get("days") ?? "").trim();
      const { reveal } = generateBatch({
        count,
        plan,
        durationKind,
        days: daysRaw ? Number(daysRaw) : undefined,
        label: String(form.get("label") ?? ""),
        note: String(form.get("note") ?? ""),
        expiresOn: String(form.get("expiresOn") ?? ""),
        maxUses: Number(String(form.get("maxUses") ?? "1").trim() || "1"),
        createdBy: "admin",
      });
      try {
        await db.flushRemote(true);
      } catch {
        /* local store still has the batch */
      }
      return back(r, "codes", { ok: `تم توليد ${reveal.codes.length} كود. حمّلها الآن — لن تظهر النص الكامل مرة ثانية.`, reveal: reveal.id });
    }
    throw new Error("عملية غير صالحة");
  })(req);
}

/** One-time download of plaintext codes from the in-memory reveal cache. */
export async function GET(req: Request) {
  const { isAdmin } = await import("@/lib/admin/session");
  if (!(await isAdmin())) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const id = url.searchParams.get("reveal") ?? "";
  const format = url.searchParams.get("format") === "txt" ? "txt" : "csv";
  const reveal = peekReveal(id);
  if (!reveal) return new Response("انتهت صلاحية التحميل. الأكواد لا تُحفظ كنص كامل.", { status: 410, headers: { "content-type": "text/plain; charset=utf-8" } });
  const exp = reveal.expiresAt ? new Date(reveal.expiresAt).toISOString() : "";
  let body: string;
  if (format === "txt") body = reveal.codes.join("\n") + "\n";
  else {
    const rows = ["code,plan,days,maxUses,expiresAt,batchId,label", ...reveal.codes.map((c) => `${c},${reveal.plan},${reveal.days},${reveal.maxUses},${exp},${reveal.batchId},${csv(reveal.label)}`)];
    body = rows.join("\n") + "\n";
  }
  const filename = `frostly-codes-${reveal.batchId}.${format}`;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": format === "txt" ? "text/plain; charset=utf-8" : "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

function csv(s: string) {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
