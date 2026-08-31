import type { Metadata } from "next";
import { clientMetadata, CLIENT_NAMES } from "@/lib/clientOg";
import LoginClient from "./LoginForm";

/**
 * /login casi siempre es la primera parada real de un link de /app/[slug]:
 * el middleware manda ahí a cualquiera sin sesión (incluidos los crawlers
 * de WhatsApp/Facebook que arman la vista previa — nunca llegan a pisar
 * app/app/<slug>/layout.tsx). Por eso el og:image se decide aquí, leyendo
 * a qué cliente apunta ?next=, en vez de solo en el layout del panel.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}): Promise<Metadata> {
  const { next } = await searchParams;
  const slug = next?.match(/^\/app\/([a-z0-9_-]+)/i)?.[1];
  const nombre = slug ? CLIENT_NAMES[slug] : undefined;
  return nombre ? clientMetadata(nombre, slug!) : {};
}

export default function LoginPage() {
  return <LoginClient />;
}
