import NavBar from "../../components/shared/NavBar";
import SiteFooter from "../../components/shared/SiteFooter";
import DocsSidebar from "../../components/docs/DocsSidebar";
import s from "../../components/docs/docs.module.css";

export const metadata = {
  title: {
    default: "Docs",
    template: "%s | RootLens Docs",
  },
  description: "Technical documentation for RootLens and Title Protocol.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <NavBar />
      <div className={s.docsLayout}>
        <DocsSidebar />
        <main className={s.main}>
          {children}
        </main>
      </div>
      <SiteFooter />
    </>
  );
}
