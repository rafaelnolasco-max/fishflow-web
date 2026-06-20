import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Aviso de Privacidad | FishFlow",
  description:
    "Aviso de privacidad integral de FishFlow conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP).",
};

const UPDATED = "20 de junio de 2026";
const EMAIL = "raf@fishflow.mx";
// TODO: Reemplazar al protocolizar la SAPI con la razón social definitiva.
const RAZON_SOCIAL = "FishFlow [razón social pendiente de protocolización]";
const DOMICILIO = "Playa Pichilingue 132, C.P. 08840, Ciudad de México";

export default function AvisoPrivacidad() {
  return (
    <main style={{ backgroundColor: "#0D1B2A", minHeight: "100vh" }} className="text-white">
      {/* Header */}
      <header className="border-b border-white/10 py-5 px-4 md:px-0">
        <div className="container max-w-3xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo-horizontal.svg" alt="FishFlow" width={140} height={40} className="h-8 w-auto" />
          </Link>
          <Link href="/" className="text-sm text-white/60 hover:text-white transition-colors">
            ← Volver al inicio
          </Link>
        </div>
      </header>

      <article className="container max-w-3xl mx-auto px-4 md:px-0 py-12">
        <h1
          className="text-3xl md:text-4xl font-extrabold mb-2"
          style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}
        >
          Aviso de Privacidad
        </h1>
        <p className="text-white/50 text-sm mb-10">Última actualización: {UPDATED}</p>

        <div className="space-y-8 text-white/80 text-[15px] leading-7">
          <section>
            <p>
              En cumplimiento de la Ley Federal de Protección de Datos Personales en Posesión de los
              Particulares (LFPDPPP), su Reglamento y los Lineamientos del Aviso de Privacidad,{" "}
              <strong className="text-white">{RAZON_SOCIAL}</strong> (en adelante &ldquo;FishFlow&rdquo;)
              pone a su disposición el presente Aviso de Privacidad.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">1. Identidad y domicilio del responsable</h2>
            <p>
              El responsable del tratamiento de sus datos personales es FishFlow, con domicilio en{" "}
              {DOMICILIO}. Para cualquier asunto relacionado con este aviso puede contactarnos en{" "}
              <a href={`mailto:${EMAIL}`} className="underline" style={{ color: "#67D4E8" }}>
                {EMAIL}
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">2. Datos personales que recabamos</h2>
            <p>
              Cuando utilizas nuestro formulario de diagnóstico o agendas una sesión, recabamos los
              siguientes datos personales:
            </p>
            <ul className="list-disc pl-6 mt-3 space-y-1">
              <li>Nombre.</li>
              <li>Correo electrónico.</li>
              <li>
                Información que nos proporcionas voluntariamente sobre tu negocio y el problema que
                deseas resolver.
              </li>
            </ul>
            <p className="mt-3">
              No recabamos datos personales sensibles a través de nuestro sitio. Tampoco solicitamos
              datos financieros o patrimoniales en la etapa de contacto inicial.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">3. Finalidades del tratamiento</h2>
            <p>
              <strong className="text-white">Finalidades primarias</strong> (necesarias para la relación
              con FishFlow):
            </p>
            <ul className="list-disc pl-6 mt-3 space-y-1">
              <li>Atender tu solicitud de diagnóstico y elaborar una propuesta.</li>
              <li>Contactarte para dar seguimiento a tu solicitud.</li>
              <li>Prestar y administrar los servicios que llegues a contratar.</li>
            </ul>
            <p className="mt-4">
              <strong className="text-white">Finalidades secundarias</strong> (no necesarias, puedes
              oponerte):
            </p>
            <ul className="list-disc pl-6 mt-3 space-y-1">
              <li>Enviarte información sobre productos, servicios y novedades de FishFlow.</li>
            </ul>
            <p className="mt-3">
              Si no deseas que tus datos se traten para las finalidades secundarias, puedes manifestarlo
              enviando un correo a{" "}
              <a href={`mailto:${EMAIL}`} className="underline" style={{ color: "#67D4E8" }}>
                {EMAIL}
              </a>
              . Tu negativa no será motivo para negarte los servicios que solicitas.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">4. Transferencias y encargados</h2>
            <p>
              FishFlow no vende ni comercializa tus datos personales. Para operar el sitio y prestar los
              servicios, utilizamos proveedores tecnológicos que actúan como encargados y tratan los datos
              únicamente por cuenta de FishFlow:
            </p>
            <ul className="list-disc pl-6 mt-3 space-y-1">
              <li>Supabase — base de datos y almacenamiento.</li>
              <li>Vercel — alojamiento del sitio.</li>
              <li>Resend — envío de correos transaccionales.</li>
              <li>Cal.com — agendamiento de sesiones.</li>
            </ul>
            <p className="mt-3">
              Algunos de estos proveedores pueden almacenar información fuera de México. No realizamos
              transferencias que requieran tu consentimiento en términos del artículo 37 de la LFPDPPP.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">5. Derechos ARCO</h2>
            <p>
              Tienes derecho a Acceder, Rectificar y Cancelar tus datos personales, así como a Oponerte a
              su tratamiento (derechos ARCO). Para ejercerlos, envía una solicitud a{" "}
              <a href={`mailto:${EMAIL}`} className="underline" style={{ color: "#67D4E8" }}>
                {EMAIL}
              </a>{" "}
              indicando tu nombre, el derecho que deseas ejercer y la descripción clara de los datos
              involucrados. Responderemos tu solicitud en los plazos que marca la ley.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">6. Revocación del consentimiento</h2>
            <p>
              Puedes revocar en cualquier momento el consentimiento que nos hayas otorgado para el
              tratamiento de tus datos, enviando tu solicitud a{" "}
              <a href={`mailto:${EMAIL}`} className="underline" style={{ color: "#67D4E8" }}>
                {EMAIL}
              </a>
              . La revocación puede implicar que no podamos seguir prestándote determinados servicios.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">7. Uso de cookies</h2>
            <p>
              Nuestro sitio puede utilizar cookies y tecnologías similares para mejorar tu experiencia de
              navegación y analizar el uso del sitio. Puedes deshabilitar las cookies desde la
              configuración de tu navegador; algunas funciones podrían verse afectadas.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">8. Cambios al aviso de privacidad</h2>
            <p>
              Este aviso puede modificarse en cualquier momento para atender novedades legislativas,
              políticas internas o nuevos requerimientos. Publicaremos cualquier cambio en esta misma
              página, indicando la fecha de la última actualización.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-white/10">
          <Link href="/" className="text-sm hover:text-white transition-colors" style={{ color: "#67D4E8" }}>
            ← Volver al inicio
          </Link>
        </div>
      </article>
    </main>
  );
}
