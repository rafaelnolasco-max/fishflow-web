import type { Metadata } from "next";
import { clientMetadata } from "@/lib/clientOg";

export const metadata: Metadata = clientMetadata("Lukon Telemática", "lukon");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
