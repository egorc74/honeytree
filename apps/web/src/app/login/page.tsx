import type { Metadata } from "next";
import { AuthPage } from "@/components/AuthPage";

export const metadata: Metadata = { title: "Log in" };

export default function Page() {
  return <AuthPage mode="login" />;
}
