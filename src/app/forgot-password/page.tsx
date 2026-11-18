import { ForgotForm } from "@/components/auth/ForgotForm";
import { buildMetadata } from "@/lib/seo";
import { getSettings } from "@/lib/site/store";

export const metadata = buildMetadata({ title: "نسيت كلمة المرور | Frostly", path: "/forgot-password", noindex: true });

export const dynamic = "force-dynamic";

export default async function Page() {
  await getSettings();
  return (
    <div className="container-w py-16">
      <ForgotForm />
    </div>
  );
}
