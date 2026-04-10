import DeleteAccountPage from "../../components/lp/DeleteAccountPage";
import SiteLayout from "../../components/shared/SiteLayout";

export const metadata = {
  title: "Delete Account — RootLens",
  description: "Request deletion of your RootLens account and associated data.",
};

export default async function DeleteAccount() {
  return (
    <SiteLayout>
      <DeleteAccountPage />
    </SiteLayout>
  );
}
