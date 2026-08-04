# Fotos de la maqueta — Muebles Toño (demo /demos/tono)

Suelta aquí las fotos y aparecen solas en la página. No hay que tocar código salvo escribir el nombre del archivo.

## Cómo conectar cada foto
1. Guarda la foto en esta carpeta `/img` (ideal cuadrada, ~1000×1000 px, .jpg o .webp).
2. En `index.html`, dentro del arreglo `PRODUCTS`, pon el nombre en el campo `photo` del modelo. Ejemplo:
   - Antes: `photo:""`
   - Después: `photo:"img/alacena-nordica.jpg"`
3. Mientras `photo` esté vacío, el modelo muestra un placeholder con la etiqueta "Foto próximamente" (no se ve roto).

## Otros archivos que puedes dejar aquí
- `favicon.png` — ícono de la marca (pestaña del navegador).
- `og-cover.jpg` — imagen que se ve al compartir la página en Facebook/WhatsApp (1200×630 px).

## Marca
El nombre "Casa Nogal", el color y los datos de contacto son PLACEHOLDER.
Se cambian en un solo lugar: el objeto `BRAND` al inicio del `<script>` en `index.html`.
Cuando Toño confirme su nombre real de negocio, se actualiza ahí.
