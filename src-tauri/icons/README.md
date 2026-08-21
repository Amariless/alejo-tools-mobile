# Ícono de la app

`icon.png` es la fuente original (a pantalla completa, sin margen) -- sirve
tal cual para el ícono legado de Android (`ic_launcher.png`/`_round`) y para
cualquier otra plataforma, pero **no** para la capa "foreground" del ícono
adaptativo de Android (`ic_launcher_foreground.png`, Android 8+): ese
formato recorta el foreground con una máscara (círculo, squircle, cuadrado
redondeado según el launcher) que varía por dispositivo, y si el dibujo llega
hasta el borde del lienzo, esa máscara le come el borde -- se ve "con zoom",
como reportó el usuario (bug real, corregido acá).

`icon-android-fg.png` es una versión del mismo ícono reescalada al ~62% y
centrada sobre un lienzo transparente (zona segura recomendada por Android:
que el contenido importante quede dentro del 66/108 central del lienzo).

Si se vuelve a correr `tauri icon`, hacerlo con el manifest de acá en vez de
pasar `icon.png` directo, para no reintroducir el bug:

```bash
npx tauri icon icons/icon-manifest.json -o icons
```

Eso regenera todo (desktop/iOS incluidos, aunque esta app no los usa) pero
solo el foreground de Android sale de `icon-android-fg.png` -- el resto
sigue viniendo de `icon.png` sin cambios.
