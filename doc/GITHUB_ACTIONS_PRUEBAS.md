# Pruebas y GitHub Actions

## Qué se ha configurado

1. **Jest** como motor de pruebas (unit tests).
2. **Scripts en `package.json`**:
   - `npm test` — ejecuta todas las pruebas.
   - `npm run test:watch` — modo watch (re-ejecuta al cambiar archivos).
   - `npm run test:cov` — pruebas con reporte de cobertura.
3. **Workflow de GitHub Actions** (`.github/workflows/ci.yml`):
   - Se ejecuta en cada **push** a `main` o `master`.
   - Se ejecuta en cada **pull request** hacia `main` o `master`.
   - Instala dependencias, genera Prisma, hace build y ejecuta las pruebas.

## Qué necesitas para que se refleje en Actions

1. **Repositorio en GitHub**  
   Tu proyecto debe estar en GitHub (no solo en local).

2. **Subir el workflow**  
   Haz commit y push de la carpeta `.github/workflows/ci.yml`:
   ```bash
   git add .github/workflows/ci.yml
   git add package.json package-lock.json jest.config.js src/app.controller.spec.ts
   git commit -m "ci: añadir Jest y workflow de GitHub Actions"
   git push origin main
   ```
   (Usa `master` si esa es tu rama por defecto.)

3. **Ver los resultados**  
   En GitHub: pestaña **Actions**. Ahí verás cada ejecución del workflow (por push o PR) y si las pruebas pasan o fallan.

## Cómo añadir más pruebas

- Crea archivos `*.spec.ts` junto a tu código (por ejemplo `usuarios.service.spec.ts`).
- O centraliza tests en una carpeta `test/` y ajusta `testRegex` en `jest.config.js` si lo prefieres.

Las instrucciones de la “prueba” están en el **workflow** (`.github/workflows/ci.yml`): qué ramas disparan el job, qué pasos se ejecutan (install, prisma generate, build, test). Cada push a esas ramas ejecuta ese flujo y lo ves en la pestaña Actions.

## Rama por defecto distinta

Si tu rama por defecto no es `main` ni `master`, edita `.github/workflows/ci.yml` y cambia:

```yaml
on:
  push:
    branches: [main, master]   # Añade o deja solo tu rama, ej: [develop]
  pull_request:
    branches: [main, master]
```

## Ejecutar pruebas en local

```bash
npm install
npm test
```

Así compruebas que todo pasa antes de hacer push.
