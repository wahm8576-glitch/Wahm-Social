import { Suspense } from "react";
import { ResetForm } from "@/components/auth/ResetForm";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({ title: "تعيين كلمة مرور جديدة | Frostly", path: "/reset-password", noindex: true });
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="container-w py-16">
      <Suspense>
        <ResetForm />
      </Suspense>
    </div>
  );
}
