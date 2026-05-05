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

### Branch protection (requiere GitHub Team — $4/usuario/mes)

Las siguientes reglas están definidas pero **no están enforced técnicamente** porque el plan actual es Free:

- **`master`**: prohibir push directo, solo merge desde `release/*` vía PR
- **`develop`**: prohibir push directo, requerir PR para cualquier merge

Hasta activar el plan Team, estas reglas aplican por **convención del equipo**.

Para activar cuando se upgradee el plan:
1. Ir a `Settings → Branches → Add branch ruleset`
2. Crear regla para `master`: require PR, restrict push
3. Crear regla para `develop`: require PR, restrict push

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