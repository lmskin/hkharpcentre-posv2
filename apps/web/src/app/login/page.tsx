import { redirect } from "next/navigation";
import { isAuthRequired } from "@/lib/session";
import { LoginFormClient } from "@/components/LoginFormClient";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (!isAuthRequired()) {
    redirect("/");
  }
  return <LoginFormClient />;
}
