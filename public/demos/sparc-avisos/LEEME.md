# Demo — Avisos oportunos SPARC

Demo interactivo del módulo de avisos y reporte mensual, para que **Eduardo Curiel**
vea cómo funcionaría antes de contratarlo. Construido por FishFlow, septiembre 2026.

## Qué muestra

Un flujo de cuatro pasos que se recorre a clics:

1. **Elegir el aviso** — cuatro tipos, cada uno con su origen distinto:
   aviso urgente (incidencia detectada), reporte mensual (cierre financiero),
   convocatoria de asamblea (acuerdo del comité) y recordatorio de cuota
   (calendario de cobranza).
2. **Generar borrador** — se ve el origen del que parte y se dispara la redacción.
3. **Revisar y editar** — asunto y cuerpo editables de verdad; al tocarlos aparece
   la etiqueta "Editado por ti".
4. **Aprobar y enviar** — resultado con métricas y el correo tal como le llega al
   condómino en su celular.

## Por qué está armado así

El módulo no se vende por el correo, se vende por **el control**: el borrador se
propone, Eduardo lo edita, y nada sale sin su aprobación. Por eso los tres
mensajes que el demo repite en pantalla son:

- Nada sale sin tu aprobación.
- Cada condómino recibe su propio correo: nadie ve la dirección de nadie más.
- Queda registro de qué se envió, a quién y a qué hora.

El recordatorio de cuota sale a 11 destinatarios y no a 48, a propósito: enseña
que el envío es segmentado y que quien ya pagó no recibe un correo que no le toca.

## Estado real de lo que muestra

La mecánica es la misma que ya corre con **Mario Citalán**:
`app/api/newsletter/draft` genera el borrador, él lo edita, y
`app/api/newsletter/send` lo manda individual a cada persona
(tabla `newsletter_campaigns`).

Para SPARC **no existe todavía**: hay que dar de alta el cliente, la lista de
condóminos por edificio y los perfiles de voz por tipo de aviso. Eso es
configuración, no desarrollo desde cero. El banner del demo y la nota al pie
lo dicen con todas sus letras.

Pendiente antes de encender envíos reales: `TEST_MODE` sigue en `true` en
`api/newsletter/send`, y falta el List-Unsubscribe con token por destinatario.

## Estándares aplicados

- Bloque RESPONSIVE BASE de `public/demos/_template/` intacto.
- Favicon y logo de la marca del cliente.
- Test de 3 anchos pasado en los tres pasos del flujo (390 / 820 / 1280),
  sin scroll horizontal en ninguno.
- Sin dependencias externas salvo las fuentes.

## Pendiente de validar con SPARC

- Nombre real del desarrollo piloto (hoy dice "Residencial Cumbres").
- Número real de condóminos por edificio (hoy 48).
- Correo remitente: `avisos@sparcgroup.mx` está puesto en el copy y hay que
  darlo de alta al comprar el dominio.
- El texto de los cuatro avisos: son ejemplos redactados por FishFlow, no
  comunicados reales de SPARC.
