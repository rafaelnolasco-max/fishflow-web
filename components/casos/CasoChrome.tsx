import Link from "next/link";
import Image from "next/image";

const EMAIL = "raf@fishflow.mx";

export function CasoHeader() {
  return (
    <header className="border-b border-primary/10 bg-white/90 backdrop-blur sticky top-0 z-50">
      <div className="container max-w-5xl mx-auto flex items-center justify-between px-4 md:px-0 py-4">
        <Link href="/" className="flex items-center gap-2">
          <Image
            src="/logo-horizontal-mono.svg"
            alt="FishFlow"
            width={140}
            height={40}
            className="h-8 w-auto"
          />
        </Link>
        <div className="flex items-center gap-5 text-sm">
          <Link href="/casos" className="text-muted-foreground hover:text-foreground transition-colors">
            Casos de éxito
          </Link>
          <a
            href={`mailto:${EMAIL}?subject=Quiero%20un%20diagn%C3%B3stico%20para%20mi%20negocio`}
            className="rounded-md bg-primary px-4 py-2 font-semibold text-white hover:bg-primary/90 transition-colors"
          >
            Quiero un diagnóstico
          </a>
        </div>
      </div>
    </header>
  );
}

export function CasoFooter() {
  return (
    <footer style={{ backgroundColor: "#0D1B2A" }} className="text-white py-10 px-4 md:px-0 mt-20">
      <div className="container max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm">
        <Image
          src="/logo-horizontal.svg"
          alt="FishFlow"
          width={140}
          height={40}
          className="h-7 w-auto"
        />
        <div className="flex flex-wrap items-center justify-center gap-4 text-white/60">
          <Link href="/" className="hover:text-white transition-colors">Inicio</Link>
          <Link href="/casos" className="hover:text-white transition-colors">Casos de éxito</Link>
          <Link href="/aviso-de-privacidad" className="hover:text-white transition-colors">Aviso de privacidad</Link>
          <span>© {new Date().getFullYear()} FishFlow</span>
        </div>
      </div>
    </footer>
  );
}
