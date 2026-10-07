import type { Metadata } from "next";
import { UploadWizard } from "@/components/upload/UploadWizard";

export const metadata: Metadata = { title: "Upload a game", robots: { index: false } };

type Props = { params: Promise<{ slug?: string[] }> };

/** `/upload` starts a new game; `/upload/<slug>` resumes or edits an existing one. */
export default async function Page({ params }: Props) {
  const { slug } = await params;
  return <UploadWizard slug={slug?.[0]} />;
}
