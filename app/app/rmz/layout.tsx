import type { Metadata } from "next";
import { clientMetadata } from "@/lib/clientOg";

export const metadata: Metadata = clientMetadata("RMZ Cocinas y Closets", "rmz");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
