import type { Metadata } from "next";
import WhyBlockchainPage from "../../components/lp/WhyBlockchainPage";
import SiteLayout from "../../components/shared/SiteLayout";

export const metadata: Metadata = {
  title: "Why Blockchain",
  description:
    "Why RootLens records every license on a public ledger. AI training data rights, verifiable on-chain.",
};

export default async function Page() {
  return (
    <SiteLayout>
      <WhyBlockchainPage />
    </SiteLayout>
  );
}
