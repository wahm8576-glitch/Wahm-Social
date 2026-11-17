import { adminAction } from "@/lib/admin/guard";
import { resetCircuits } from "@/lib/sources/health";

export const dynamic = "force-dynamic";

/** op=reset — close every circuit breaker so all sources are tried again right away. */
export async function POST(req: Request) {
  return adminAction("sources", async () => {
    resetCircuits();
    return "تم تصفير القواطع — كل المصادر بتنجرب من جديد";
  })(req);
}
