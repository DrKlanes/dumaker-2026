# dumaker.com

Landing de una sola página: carrusel horizontal infinito de proyectos.
HTML + CSS + JS vanilla, sin build step. **Fase 1 (esqueleto) completa.**

---

## Editar el contenido (sin tocar HTML)

Todo el contenido del carrusel vive en dos archivos JSON:

### `data/cards.json` — las 10 cards

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

**El número (00–09) NO se escribe**: es el orden del array. Reordenar
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

### `data/ahora.json` — el texto vivo de la card 00

```json
{ "texto": "junio 2026 / estoy trabajando en ..." }
```

Edita el texto, guarda, push. Eso es todo.

### Footer (Instagram · Ko-fi)

Los dos enlaces transversales están en `index.html`, bloque `<footer>`
(buscar `footer__link`). Pendientes de URL real.

---

## Desarrollo local

Sin build. Para servir en local (el `fetch` de los JSON necesita un
servidor, no vale abrir el archivo a pelo):

```
npx serve .
```

## Deploy

Push a `main` → GitHub Actions publica en GitHub Pages (~30s).
Staging: https://drklanes.github.io/dumaker-2026/

## Dominio dumaker.com (pendiente, decisión consciente)

dumaker.com aloja hoy la web antigua. Cuando toque sustituirla:

1. En el registrador del dominio, apuntar los registros A del apex a:
   `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.
2. En GitHub → Settings → Pages del repo, poner `dumaker.com` como
   custom domain y activar *Enforce HTTPS* cuando valide.

El archivo `CNAME` del repo ya está listo (los builds por workflow lo
ignoran; manda el ajuste de Settings).

---

## Arquitectura JS (para la Fase 2)

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
suavizada, `subscribe`/`getSnapshot`/`retain`). La capa WebGL entra como
`js/consumers/gl/` + un `import()` dinámico en main.js, sin tocar nada
de lo existente.

Notas:
- El carrusel es un loop infinito: 5 copias del set, recentrado
  invisible en reposo (`js/core/loop.js`).
- Grano base: PNGs en `assets/textures/`, regenerables con
  `node tools/generate-grain.mjs` (parámetros dentro).
- El favicon es un placeholder en colores de marca
  (`assets/favicon.svg`) — sustituir por el sello DMK cuando exista.
