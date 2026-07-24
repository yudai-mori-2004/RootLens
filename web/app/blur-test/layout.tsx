import type { Metadata } from "next";
import type { ReactNode } from "react";

// 現場検証用の内部ツール。 検索に載せない。
export const metadata: Metadata = {
  title: "ぼかしテスト | RootLens",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
