import type { Metadata } from "next";
import { clientMetadata } from "@/lib/clientOg";

export const metadata: Metadata = clientMetadata("TBA Telecom", "tba");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
