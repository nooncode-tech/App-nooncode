## Descripción

<!-- Qué cambia y por qué. Una o dos oraciones. -->

## Tipo de cambio

- [ ] Bug fix
- [ ] Feature nueva
- [ ] Refactor (sin cambio de comportamiento)
- [ ] Seguridad / hardening
- [ ] Documentación
- [ ] Infra / config

## Issue relacionado

<!-- Closes #123 / Fixes #123 -->

---

## Checklist

### General
- [ ] El código compila sin errores (`pnpm build`)
- [ ] TypeScript sin errores (`pnpm typecheck`)
- [ ] Lint sin errores (`pnpm lint`)
- [ ] Tests pasan (`npm test`)

### Seguridad
- [ ] No hay secrets, tokens ni API keys en el código
- [ ] Inputs validados con Zod en los endpoints afectados
- [ ] Endpoints nuevos tienen rate limiting si son públicos o de alto riesgo
- [ ] Contenido generado por IA sanitizado antes de guardarse

### Base de datos
- [ ] Migraciones incluidas si hay cambios de schema
- [ ] RLS actualizado si hay tablas nuevas o cambios de acceso
- [ ] `database.types.ts` regenerado si hay cambios de schema

### Observabilidad
- [ ] Routes nuevas usan `logger.info/error` con contexto relevante
- [ ] Errores capturados con `errorToLogContext(error)`

### Dominio afectado
- [ ] Leads / Proposals
- [ ] Projects / Tasks
- [ ] Payments / Earnings
- [ ] Maxwell / AI
- [ ] Auth / Roles
- [ ] Notifications
- [ ] Wallet / Rewards
- [ ] Client Portal
- [ ] Prototypes / v0

---

## ¿Cómo probar?

<!-- Pasos concretos para verificar el cambio -->

1. 
2. 
3. 

## Screenshots (si aplica)

<!-- Para cambios de UI -->
