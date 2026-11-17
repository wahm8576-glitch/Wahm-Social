import { ForgotForm } from "@/components/auth/ForgotForm";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({ title: "نسيت كلمة المرور | Frostly", path: "/forgot-password", noindex: true });

export default function Page() {
  return (
    <div className="container-w py-16">
      <ForgotForm />
    </div>
  );
}
