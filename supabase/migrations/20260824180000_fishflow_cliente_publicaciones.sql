-- ─────────────────────────────────────────────────────────────────────────────
-- FishFlow como cliente de sí misma — pestaña Publicaciones del /admin
--
-- El módulo de programación (Blotato) es multi-tenant y filtra TODO por
-- client_id: los destinos salen de content_settings.blotato_accounts, las
-- imágenes viven en content-media/{client_id}/… y el historial en
-- content_schedules. Para que el /admin pueda publicar en las cuentas propias
-- hace falta, entonces, que FishFlow exista como cliente. No tiene tablero ni
-- cobros: gateway_primary = 'none'.
--
-- Cuentas de Blotato (workspace de FishFlow, verificadas el 2026-08-24):
--   Instagram @fishflow.mx        → accountId 64411
--   Facebook  página "FishFlow"   → accountId 45904, pageId 1108037932403531
--
-- Cadencia acordada con Rafa: lunes, miércoles y viernes a las 12:00 CDMX en
-- ambas cuentas. Es solo la sugerencia de fecha del compositor — al programar
-- se puede escribir cualquier otra.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── 1. El cliente ────────────────────────────────────────────────────────────
insert into public.clients (id, name, gateway_primary, vertical, slug, active)
values (
  'b0d1a4f6-3c58-4a7e-9d21-7fe6c0a13b42',
  'FishFlow',
  'none',
  'automatizacion',
  'fishflow',
  true
)
on conflict (id) do update
  set name    = excluded.name,
      vertical = excluded.vertical,
      slug     = excluded.slug,
      active   = excluded.active;


-- ─── 2. Guardrails de marca ───────────────────────────────────────────────────
-- La columna aceptaba 'salud' y 'legal'. FishFlow estrena 'marca': el riesgo de
-- su cuenta no es clínico ni jurídico sino anunciar un módulo que todavía no
-- corre en ningún cliente. Las reglas viven en /api/content/draft.
alter table public.content_settings
  drop constraint if exists content_settings_guardrails_check;

alter table public.content_settings
  add constraint content_settings_guardrails_check
  check (guardrails is null or guardrails in ('salud', 'legal', 'marca'));


-- ─── 3. Voz y destinos ────────────────────────────────────────────────────────
insert into public.content_settings (
  client_id, brand_display_name, social_handle, signature,
  default_hashtags, sensitive, guardrails, voice_profile, blotato_accounts
)
values (
  'b0d1a4f6-3c58-4a7e-9d21-7fe6c0a13b42',
  'FishFlow',
  '@fishflow.mx',
  '📩 raf@fishflow.mx',
  '#PyMEsMexico #AutomatizacionCDMX #IAparaNegocios #NegociosLocales #EmprendimientoMexico',
  false,
  'marca',
  $voz$Escribes las publicaciones de FishFlow (@fishflow.mx), una empresa mexicana que lleva automatización e inteligencia artificial a los negocios que normalmente se quedan fuera del buen software: estéticas, consultorios, talleres, despachos, administradores de edificios y comercios locales de CDMX. Construye el sistema a la medida de cada vertical —cobros en línea, agenda con confirmación automática, inventario, contabilidad de ventas, publicación en redes, análisis con IA— y lo opera con el cliente, no se lo entrega y se va. La fundó Rafael Nolasco, con más de veinte años vendiendo tecnología a empresas grandes.

QUIÉN HABLA
La marca en primera persona del plural ("construimos", "lo operamos contigo"), o en segunda persona dirigida al dueño ("tus clientes reciben el aviso solos"). Nunca en tercera persona sobre sí misma.

A QUIÉN LE HABLA
Al dueño de un negocio chico que ya tiene clientes pero opera a mano: cobra por transferencia y persigue el comprobante, agenda por WhatsApp, lleva el inventario en un cuaderno. No es un comprador técnico y no tiene tiempo. No le hables al programador ni al consultor.

TONO
- De tú, nunca de usted. Cercano sin ser informal de más.
- Directo: una idea por frase. El dueño lee en su hora de comida.
- Confianza técnica sin jerga: di qué hace, no cómo funciona por dentro. Nada de "pipeline", "endpoint", "stack", "modelo", ni nombres de herramientas.
- Tangible: "cada venta se registra sola", no "implementamos un módulo de registro transaccional".
- Honesto: nada de frases vacías como "soluciones integrales", "transformación digital" o "potencia tu negocio".

LOS TRES PILARES (todo texto toca al menos uno)
1. A la medida, no de molde: cada negocio es distinto y su sistema también; se empieza con un diagnóstico, no con un catálogo.
2. Te lo operamos, no solo te lo entregamos: la automatización corre y FishFlow la cuida.
3. Resultados que se notan en semanas, no proyectos eternos.

CIERRE
Siempre invita a la conversación, no a la compra, y termina con el contacto en su propio renglón: 📩 raf@fishflow.mx$voz$,
  $cuentas$[
    {
      "key": "fishflow_ig",
      "label": "Instagram @fishflow.mx",
      "platform": "instagram",
      "accountId": "64411",
      "cadence": [
        { "dow": 1, "hour": 12, "minute": 0 },
        { "dow": 3, "hour": 12, "minute": 0 },
        { "dow": 5, "hour": 12, "minute": 0 }
      ]
    },
    {
      "key": "fishflow_fb",
      "label": "Facebook FishFlow",
      "platform": "facebook",
      "accountId": "45904",
      "pageId": "1108037932403531",
      "cadence": [
        { "dow": 1, "hour": 12, "minute": 0 },
        { "dow": 3, "hour": 12, "minute": 0 },
        { "dow": 5, "hour": 12, "minute": 0 }
      ]
    }
  ]$cuentas$::jsonb
)
on conflict (client_id) do update
  set brand_display_name = excluded.brand_display_name,
      social_handle      = excluded.social_handle,
      signature          = excluded.signature,
      default_hashtags   = excluded.default_hashtags,
      guardrails         = excluded.guardrails,
      voice_profile      = excluded.voice_profile,
      blotato_accounts   = excluded.blotato_accounts;


-- ─── 4. Acceso ────────────────────────────────────────────────────────────────
-- Las políticas de Storage validan con user_has_access_to_client(), que mira
-- user_client_access y NO conoce el correo de admin: sin esta fila, subir el
-- arte desde el /admin fallaría con un error de permisos del bucket.
insert into public.user_client_access (user_id, client_id, role)
select u.id, 'b0d1a4f6-3c58-4a7e-9d21-7fe6c0a13b42', 'admin'
from auth.users u
where u.email = 'rafaelnolasco@gmail.com'
on conflict (user_id, client_id) do nothing;
