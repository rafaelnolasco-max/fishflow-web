# Pruebas de aceptación — monitor normativo

```
deno test -A supabase/functions/regintel-normativo/test/
```

Corren contra instantáneas en `fixtures/`, nunca contra el estado en vivo.

| Fixture | Origen |
|---|---|
| `dof_*`, `nota_*` | Índices y notas reales del DOF (las notas, recortadas al cuerpo) |
| `arcsa_docs_B.html` | Página real de ARCSA del 01-oct-2026 |
| `arcsa_docs_A.html` | La misma, con el 16057 reemplazado por el 14955 y su título v4 (sintética: el 14955 ya no está publicado) |
| `cofepris_formatos_A/B.html` | Recorte de 7 renglones con la estructura real; en A el FF-COFEPRIS-01 lleva el ID 1098801 (sintético), en B el real 1103837 v2.0 |
| `cofepris_portada_actual.html` | Recorte real de la portada |
| `cofepris_portada_2018.html`, `gobmx_desafio.html` | Sintéticas: portada cacheada de 2018 y desafío anti-bot |
| `clasificador_grabado.json` | Respuestas reales de Claude de la corrida del 01-oct-2026 |
