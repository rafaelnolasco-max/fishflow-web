# Blotato — fase 2 del módulo de Contenido

Estado al 2026-08-11: **no implementado**. Este documento es el plan, no un
registro de algo que ya exista en el código.

## Qué resuelve y qué no

Hoy el módulo termina en el texto: la IA escribe, el cliente aprueba, el tablero
exporta un CSV y Canva produce el arte. El último tramo —abrir Instagram, pegar,
subir la imagen, repetir en Facebook y en TikTok— sigue siendo manual. Eso es lo
que Blotato quita.

Lo que **no** quita: Blotato publica, no diseña. Necesita una URL pública de la
imagen o el video. Mientras el arte se produzca en Canva y se descargue a mano,
la automatización arranca a la mitad del camino. Por eso la fase 2 real son dos
piezas, no una:

1. **Subir el arte al tablero.** Un campo de imagen por publicación aprobada,
   guardado en Supabase Storage con URL pública. Sin esto Blotato no tiene qué
   publicar.
2. **Publicar o programar con Blotato.** El botón que hoy dice "Marcar
   publicada" pasa a ser "Programar" y devuelve una fecha real.

## La API

- Base: `https://backend.blotato.com/v2`, endpoint `POST /posts`
- Header de autenticación: `blotato-api-key: <API_KEY>`
- Límite: 30 solicitudes por minuto
- Plataformas: Twitter, LinkedIn, Facebook, Instagram, TikTok, Pinterest,
  Threads, Bluesky, YouTube y Webhook
- El body lleva `post` (con `accountId`, `content` y `target`) y, en la raíz,
  `scheduledTime` en ISO 8601 para programar a futuro (o `useNextFreeSlot`)
- Respuesta `201` con `postSubmissionId` para dar seguimiento

Dos detalles que aplican directo a JJ Laboral:

- **Instagram**: varias imágenes se convierten en carrusel automáticamente. Eso
  encaja con el formato "No te dejes engañar", que ya se publica partido en dos
  láminas.
- **`firstComment`**: publica texto como primer comentario. Es el lugar correcto
  para los 5 hashtags, que hoy van pegados al pie. El pie se lee más limpio y el
  alcance no se pierde.
- **Facebook**: exige `pageId` de las subcuentas y los videos van con
  `mediaType: "reel"`.

## Qué hay que construir

| # | Pieza | Dónde |
|---|-------|-------|
| 1 | Columnas `media_url` y `blotato_submission_id`, `scheduled_for` ya existe | migración sobre `content_posts` |
| 2 | Subida de imagen por publicación | `components/content/ContentTab.tsx` |
| 3 | Tabla `content_accounts`: `client_id`, `platform`, `blotato_account_id`, `page_id` | migración nueva, con RLS y `user_has_access_to_client()` |
| 4 | Ruta `POST /api/content/publish` | server-side, la API key nunca toca el navegador |
| 5 | Botón "Programar" con selector de fecha | `ContentTab.tsx` compartido |

La API key va en variable de entorno de Vercel (`BLOTATO_API_KEY`), y el
`accountId` por cliente y plataforma vive en la BD, no en el código: es la misma
regla que ya seguimos con la voz.

## Antes de escribir una línea

1. Conseguir la API key de Blotato y confirmar que el plan la incluye.
2. Conectar las cuentas de JJ Laboral (IG, FB, TikTok) dentro de Blotato y
   anotar el `accountId` de cada una y el `pageId` de la página de Facebook.
3. Decidir si la primera prueba se hace con JJ Laboral o con una cuenta de
   pruebas de FishFlow. **Recomendación: cuenta de pruebas.** Una publicación
   mal programada en la cuenta de un despacho de abogados no se deshace con un
   `undo`.

## Costo del cambio de alcance

La fase 2 convierte al módulo en algo que **publica solo**. Eso cambia el perfil
de riesgo: hoy ningún borrador sale sin que una persona lo lea. Vale la pena
conservar esa garantía — que "Programar" exija que la publicación esté en estado
`approved`, y que nunca haya un camino de `draft` directo a publicado.
