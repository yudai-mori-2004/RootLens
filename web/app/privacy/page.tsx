import PrivacyPolicyPage from "../../components/lp/PrivacyPolicyPage";
import SiteLayout from "../../components/shared/SiteLayout";

export const metadata = {
  title: "Privacy Policy",
  description: "RootLens privacy policy and data handling practices.",
};

export default async function PrivacyPolicy() {
  return (
    <SiteLayout>
      <PrivacyPolicyPage />
    </SiteLayout>
  );
}
