import type { Metadata } from "next";
import { pageMetadata } from "../site-metadata";

export const metadata: Metadata = pageMetadata(
  "/findings",
  "Tokenized Stock Premium Research | Closing Bell",
  "Explore Closing Bell's measured xStock price gaps, data sources, persistence checks, and the research questions that remain open.",
);

export default function FindingsLayout({ children }: LayoutProps<"/findings">) {
  return children;
}
