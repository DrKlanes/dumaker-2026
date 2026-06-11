# dumaker.com

Landing de una sola página: carrusel horizontal de proyectos. HTML + CSS + JS vanilla, sin build step.

**Estado: Fase 1 (esqueleto) — en construcción.**

## Desarrollo local

No hay build. Para servir en local (el `fetch` de los JSON necesita un servidor, no `file://`):

```
npx serve .
# o
python -m http.server 3000
```

## Deploy

Push a `main` → GitHub Actions publica a GitHub Pages → dumaker.com.

## Editar contenido

(Se documentará al cierre de la Fase 1: `data/cards.json` y `data/ahora.json`.)
