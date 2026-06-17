# dumaker.com

Landing de una sola página: carrusel horizontal infinito de proyectos.
HTML + CSS + JS vanilla. En producción en [dumaker.com](https://dumaker.com).

---

## Editar el contenido (sin tocar HTML)

Todo el contenido del carrusel vive en dos archivos JSON:

### `data/cards.json` — las cards

Cada card es un objeto con estos campos:

| Campo | Qué es |
|---|---|
| `id` | Identificador en minúsculas-con-guiones. Aparece en la URL (`#diorame`). |
| `title` | El nombre del proyecto (también alimenta el menú). |
| `template` | `poster` (imagen de fondo) · `clip` (vídeo en loop) · `texto` (fondo rojo tipográfico). |
| `subtitle` | La línea corta bajo el título. `null` si no hay. |
| `asset` | Ruta de la imagen o el vídeo: `assets/cards/loquesea.webp` / `.mp4`. |
| `poster` | Solo para `clip`: imagen que se ve mientras el vídeo no reproduce. |
| `alt` | Descripción de la imagen (accesibilidad). |
| `href` | Destino del clic. `null` = card sin enlace (no rompe nada). |
| `newTab` | `true` = abre en pestaña nueva (destinos externos). |
| `hidden` | `true` = excluye la card del carrusel y el menú; la numeración se recalcula densa sin huecos. |

**El número NO se escribe**: es el orden del array (omitiendo las `hidden`). Reordenar
cards = mover bloques de líneas; la numeración y el menú se actualizan solos.

**Operaciones típicas:**
- *Cambiar una imagen*: sube el archivo nuevo a `assets/cards/` y cambia la ruta en `asset`.
- *Convertir póster → clip*: cambia `template` a `"clip"`, pon el `.mp4` en `asset` y una imagen en `poster`. Nada más — la reproducción por cercanía ya está gestionada.
- *Añadir el enlace de una card*: rellena `href` (debe empezar por `https://`, `/` o `#`).

**Reglas de oro del JSON** (los dos errores clásicos):
- Sin coma después del último elemento de una lista u objeto.
- Sin comentarios.

Si el archivo queda roto, la web no muere: muestra un aviso con la línea
exacta del error. En VS Code, el campo `$schema` subraya los errores en
rojo mientras editas.

**Pipeline de deploy:** `scripts/build-cards.js` regenera la zona de cards en
`index.html` en cada deploy (la GitHub Action lo corre antes de publicar). La
zona entre los marcadores `<!-- menu:auto:start/end -->` y
`<!-- cards:auto:start/end -->` **no se edita a mano** — la genera el script.
Para añadir, quitar o reordenar cards: editar solo `data/cards.json` y hacer push.

### `data/ahora.json` — el texto vivo de la card 00

```json
{ "texto": "junio 2026 / estoy trabajando en ..." }
```

Edita el texto, guarda, push. Eso es todo.

### Footer (Instagram · Ko-fi · Behance)

Los tres enlaces están en `index.html`, bloque `<footer>` (buscar `footer__link`).

---

## Desarrollo local

Para servir en local (el `fetch` de los JSON necesita un servidor, no vale
abrir el archivo a pelo):

```
npx serve .
```

## Deploy

Push a `main` → GitHub Actions publica en GitHub Pages (~30s) en
[dumaker.com](https://dumaker.com). Previsualización alternativa:
https://drklanes.github.io/dumaker-2026/

## Dominio

[dumaker.com](https://dumaker.com) en producción, HTTPS activo. cdmon actúa
solo como registrador (hosting cancelado).

---

## Arquitectura JS

```
js/core/       geometry · centerline · animator · snap · settle · loop
js/input/      wheel · drag · keyboard
js/consumers/  menu · video · cssBridge
js/main.js     único orquestador
```

Regla de dependencias: `core` no importa nada externo; `input` usa
animator+snap; `consumers` solo consumen `centerline`. **El contrato de
la Fase 2 es el payload de `js/core/centerline.js`** (dist por card con
vecina = ±1, `phase` circular, `unwrapped` monotónico, `velocity`
suavizada, `subscribe`/`getSnapshot`/`retain`). La capa WebGL vive en
`js/consumers/gl/` y se importa estáticamente en main.js, sin tocar nada
de lo existente.

Notas:
- El carrusel es un loop infinito: 5 copias del set, recentrado
  invisible en reposo (`js/core/loop.js`).
- Grano base: PNGs en `assets/textures/`, regenerables con
  `node tools/generate-grain.mjs` (parámetros dentro).

## Preset del efecto-firma (Fase 2)

**Única fuente de verdad: `js/consumers/gl/preset.json`.** La web lo
carga al arrancar la capa GL; `config.js` es solo andamiaje (no contiene
valores de preset, así no hay copia que se quede obsoleta). Si el JSON
falta o está roto, la GL no arranca y se ven las cards limpias de Fase 1.

Calibrar: abrir la web con `?gl=debug`, mover los sliders (cambian en
vivo), pulsar **export** (copia el JSON al portapapeles) y pegar ese
contenido en `preset.json` (conservando el bloque `_meta`). El botón
**import** aplica un JSON en vivo sin tocar el archivo. `?profile=lite`
fuerza el perfil móvil en desktop para probarlo.
