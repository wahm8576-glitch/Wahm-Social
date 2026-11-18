import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ResetForm } from "@/components/auth/ResetForm";
import { buildMetadata } from "@/lib/seo";
import { getSettings } from "@/lib/site/store";
import { clientFirebaseConfig } from "@/lib/firebase/config";

export const metadata = buildMetadata({ title: "تعيين كلمة مرور جديدة | Frostly", path: "/reset-password", noindex: true });
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: { mode?: string; oobCode?: string } }) {
  await getSettings();
  const mode = searchParams.mode || "";
  const oob = searchParams.oobCode || "";
  // Firebase action emails may land here with mode=verifyEmail when the custom action URL is /reset-password.
  if (mode === "verifyEmail" && oob) {
    redirect(`/verify-email?oobCode=${encodeURIComponent(oob)}`);
  }
  const firebase = clientFirebaseConfig();
  return (
    <div className="container-w py-16">
      <Suspense>
        <ResetForm firebase={firebase} />
      </Suspense>
    </div>
  );
}
