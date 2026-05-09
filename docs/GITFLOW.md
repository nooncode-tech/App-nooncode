# Gitflow — nooncode-org/App-nooncode

## Estado actual

### Hecho

- **Rama `main` renombrada a `master`** — es la rama de producción
- **Rama `develop` creada** — es la rama de integración y la rama default del repo
- **`develop` configurada como default** en GitHub — todos los PRs abren contra `develop` por defecto
- **Docs reorganizados** — archivos `.md` movidos de raíz a `docs/` con estructura por carpetas (`adrs/`, `tdrs/`, `features/`, `business/`, `context/`, `product/`, `ui_intention/`)
- **Remote actualizado** a `nooncode-org/App-nooncode` (la org se movió de `nooncode-tech`)

---

## Flujo de ramas

```
master        ← producción — solo recibe merges desde release/*
  ↑
release/*     ← preparación de release — sale de develop, mergea a master + develop
  ↑
develop       ← integración — rama default, recibe feature/*, hotfix/*, bugfix/*
  ↑
feature/*     ← nuevas funcionalidades
hotfix/*      ← fixes urgentes sobre master
bugfix/*      ← fixes sobre develop
```

### Reglas de flujo

| Rama origen | Merge hacia | Descripción |
|---|---|---|
| `feature/*` | `develop` | Nueva funcionalidad |
| `bugfix/*` | `develop` | Fix no urgente |
| `hotfix/*` | `master` + `develop` | Fix urgente en producción |
| `release/*` | `master` + `develop` | Cierre de release |

### Convenciones de nombres

```
feature/nombre-corto-descriptivo
bugfix/descripcion-del-bug
hotfix/descripcion-del-fix
release/v1.2.0
```

---

## Pendiente

### Branch protection vía Rulesets

Las reglas siguen aplicando por **convención del equipo** hasta que alguien con permisos de admin del repo las active en GitHub. La activación es una acción manual de UI (no se puede commitear) y queda fuera del scope del CI.

Reglas a aplicar a `master` y `develop`:

- Push directo prohibido — todo cambio entra por PR
- Force push prohibido
- Eliminación de la rama prohibida
- PR requerido antes de merge
- Status checks obligatorios (deben estar verdes para mergear):
  - `Lint, typecheck & test` (job de `.github/workflows/ci.yml`)
  - `Migration prefix check` (job de `.github/workflows/ci.yml`)
- Resolver todas las conversaciones del PR antes de mergear

Diferencias entre las dos ramas:

| Aspecto | `master` | `develop` |
|---|---|---|
| Origen permitido del PR | solo `release/*` y `hotfix/*` | `feature/*`, `bugfix/*`, `release/*`, `hotfix/*` |
| Aprobaciones requeridas | 1 (recomendado) | 0 (mientras el equipo sea pequeño) |

### Pasos de activación (UI de GitHub)

Ruta moderna: **Settings → Rules → Rulesets → New ruleset → New branch ruleset**.

Crear un ruleset por rama (más fácil de auditar) o uno con dos targets:

1. **Name**: `protect-master` (o `protect-develop`)
2. **Enforcement status**: `Active`
3. **Target branches**: `Include default branch` o `Include by pattern` con `master` / `develop`
4. **Rules** (marcar):
   - `Restrict deletions`
   - `Require a pull request before merging`
   - `Require status checks to pass`
     - `Require branches to be up to date before merging`
     - Add status check: `Lint, typecheck & test`
     - Add status check: `Migration prefix check`
   - `Block force pushes`
   - (Opcional `master`) `Require conversation resolution before merging`
5. Guardar.

> **Nota:** los status checks solo aparecen en el selector después de que el workflow haya corrido al menos una vez en el repo. Hacer un push inicial a la rama feature, esperar que CI corra, y luego configurar el ruleset.

### Caveats del plan Free

Los Rulesets están **disponibles en Free para repos públicos y privados** desde 2024. Las reglas de la lista anterior funcionan todas en Free. Lo que **sí** requiere plan pagado:

- `Require review from Code Owners` (requiere `CODEOWNERS` + plan Team o superior para repos privados)
- Push rulesets con patrones avanzados (regex, file size limits) — Team/Enterprise
- Bypass list granular por equipos — Team/Enterprise

Para el alcance actual (PR + status checks + no force push) el plan Free es suficiente.

---

## Estructura de docs

```
docs/
├── AGENTS.md           — instrucciones para agentes AI
├── GITFLOW.md          — este archivo
├── adrs/               — Architecture Decision Records
├── business/           — roadmaps y overview de negocio
├── context/            — artefactos de sesiones y contexto del agente
├── features/           — specs de features
├── product/            — documentos de producto
├── tdrs/               — Technical Decision Records
└── ui_intention/       — filosofía y navegación de UI
```