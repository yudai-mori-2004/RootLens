import type { Metadata } from "next";
import LegalBasisPage from "../../components/lp/LegalBasisPage";
import SiteLayout from "../../components/shared/SiteLayout";

export const metadata: Metadata = {
  title: "Legal Foundation",
  description:
    "How RootLens licenses work legally. Backed by copyright law, international treaties, and case law.",
};

export default async function Page() {
  return (
    <SiteLayout>
      <LegalBasisPage />
    </SiteLayout>
  );
}
