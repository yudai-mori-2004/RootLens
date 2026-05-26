import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withWorkflow } from "workflow/next";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {};

// withWorkflow: "use workflow" / "use step" directive を SWC で transform し、
// workflow パッケージ (= WDK) が start(fn) で fn を認識できるようにする。
// v0.1.3 で API/workflow を v0.1.3/server から web に統合したので、 ここに追加。
export default withWorkflow(withNextIntl(nextConfig));
