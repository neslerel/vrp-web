# VRP — Clarke & Wright y búsqueda tabú (versión web)

Aplicación didáctica para explicar el problema de rutas de vehículos (VRP) a estudiantes de ingeniería civil.
Es la versión web de la aplicación de escritorio en C# (`../VRP.zip`): el mismo problema, los mismos algoritmos y la misma pantalla única, pero en el navegador y sin instalar nada.

## Qué hace

- El estudiante elige el número de puntos de entrega (2–60), de vehículos (1–20) y su capacidad.
- Las coordenadas de los puntos y de la central se generan al azar, y las demandas también, de modo que el problema tenga sentido (la demanda total no supera el 80 % de la capacidad de la flota).
- Dos algoritmos, ejecutables **paso a paso**, de forma automática o de una vez:
  - **Clarke & Wright** (ahorros): tabla de ahorros con el motivo de cada fusión o rechazo.
  - **Búsqueda tabú**: vecindario de reubicar, intercambiar y 2-opt, con penalización por exceso de carga, lista tabú, criterio de aspiración, tabla de iteraciones y gráfica de convergencia.
- Mapa con las rutas, el candidato actual resaltado y la flota de vehículos con su carga.
- Matriz de distancias.

Novedades respecto a la versión de escritorio:

- **Semilla en el enlace.** Al generar un problema, la dirección se actualiza (`#n=15&k=4&q=100&seed=42`). El botón «Copiar enlace» permite que toda la clase vea exactamente el mismo problema.
- Funciona en el móvil o la tableta (el diseño se apila en una columna).

## Desarrollo

Requiere Node 20 o superior.

```bash
npm install
npm run dev        # servidor de desarrollo
npm test           # pruebas del modelo (Vitest)
npm run build      # genera dist/ (comprueba tipos y empaqueta)
npm run preview    # sirve dist/ en local
```

## Estructura

| Fichero | Contenido |
|---|---|
| `src/model.ts` | Instancia, generación aleatoria, rutas, algoritmo de Clarke & Wright e interfaz `Solver` |
| `src/tabu.ts` | Búsqueda tabú |
| `src/rng.ts` | Generador aleatorio con semilla (mulberry32) |
| `src/draw.ts` | Dibujo del mapa, de la flota y de la gráfica de convergencia (canvas) |
| `src/main.ts` | Interfaz: controles, tablas, temporizador y eventos |
| `src/vrp.test.ts` | Pruebas: ahorros de una instancia conocida, factibilidad, monotonía, conservación de puntos y coste |

La lógica de cálculo (`model.ts`, `tabu.ts`) no depende del navegador, igual que en la versión C#.

## Publicar en GitHub Pages

1. Sube esta carpeta (`vrp-web`) como raíz de un repositorio, con la rama `main`.
2. En el repositorio: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. El flujo `.github/workflows/pages.yml` ejecuta las pruebas, construye y publica en cada `push` a `main`.
4. La dirección será `https://<usuario>.github.io/<repositorio>/`. La app usa rutas relativas (`base: './'`), así que funciona en cualquier subruta.

Dos cosas a tener en cuenta con un repositorio **privado**:

- GitHub Pages en repositorios privados solo está disponible con planes de pago (Pro, Team o Enterprise). Con una cuenta gratuita hay que hacer el repositorio público o publicar en otro sitio.
- La página publicada es **pública** aunque el repositorio sea privado (salvo en Enterprise Cloud con acceso restringido). Aquí no hay datos sensibles, pero conviene saberlo.

Alternativa sin GitHub: copiar el contenido de `dist/` a cualquier alojamiento estático (por ejemplo, el Plesk de la UPV).

## Rendimiento

La búsqueda tabú evalúa todo el vecindario en cada iteración. Con 60 puntos, «Resolver todo» con 2.000 iteraciones tarda del orden de 5-6 segundos; el cálculo se hace en trozos para que la pantalla no se quede congelada. Con los valores por defecto (15 puntos, 100 iteraciones) es instantáneo.

## Diferencias conocidas respecto a la versión C#

- La semilla genera problemas distintos a los de la versión de escritorio (cambia el generador de números aleatorios), aunque los algoritmos son los mismos.
- En la versión web, el valor 0 de «Semilla» elige una semilla al azar y la escribe en el campo para poder repetir el problema.
