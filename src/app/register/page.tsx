import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import { buildMetadata } from "@/lib/seo";
import { currentUser } from "@/lib/server/auth";
import { getSettings } from "@/lib/site/store";
import { clientFirebaseConfig } from "@/lib/firebase/config";

export const metadata = buildMetadata({ title: "register | Frostly", path: "/register", noindex: true });
export const dynamic = "force-dynamic";

export default async function Page() {
  if (await currentUser()) redirect("/account");
  await getSettings();
  const firebase = clientFirebaseConfig();
  return (
    <div className="container-w py-16">
      <Suspense>
        <AuthForm mode="register" firebase={firebase} />
      </Suspense>
    </div>
  );
}
