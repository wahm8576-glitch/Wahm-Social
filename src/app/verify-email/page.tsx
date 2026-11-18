import { Suspense } from "react";
import { VerifyEmailForm } from "@/components/auth/VerifyEmailForm";
import { buildMetadata } from "@/lib/seo";
import { getSettings } from "@/lib/site/store";
import { clientFirebaseConfig } from "@/lib/firebase/config";

export const metadata = buildMetadata({ title: "تأكيد البريد الإلكتروني | Frostly", path: "/verify-email", noindex: true });
export const dynamic = "force-dynamic";

export default async function Page() {
  await getSettings();
  const firebase = clientFirebaseConfig();
  return (
    <div className="container-w py-16">
      <Suspense>
        <VerifyEmailForm firebase={firebase} />
      </Suspense>
    </div>
  );
}
