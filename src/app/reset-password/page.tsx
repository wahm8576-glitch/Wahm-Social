import { Suspense } from "react";
import { ResetForm } from "@/components/auth/ResetForm";
import { buildMetadata } from "@/lib/seo";
import { getSettings } from "@/lib/site/store";
import { clientFirebaseConfig } from "@/lib/firebase/config";

export const metadata = buildMetadata({ title: "تعيين كلمة مرور جديدة | Frostly", path: "/reset-password", noindex: true });
export const dynamic = "force-dynamic";

export default async function Page() {
  await getSettings();
  const firebase = clientFirebaseConfig();
  return (
    <div className="container-w py-16">
      <Suspense>
        <ResetForm firebase={firebase} />
      </Suspense>
    </div>
  );
}
