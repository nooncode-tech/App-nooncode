# v0 Integration Spec — Prototype Generation

Documento técnico preparado para cuando el cliente entregue las credenciales de v0.
Estado actual: workspaces quedan en `pending_generation` indefinidamente.

---

## Qué hace v0

v0 (v0.dev por Vercel) genera componentes React/Next.js a partir de un prompt de texto.
La idea es: el vendedor solicita un prototipo → se describe la app del cliente → v0 genera el código UI → el workspace pasa de `pending_generation` a `ready`.

---

## Lo que necesitamos del cliente

| Item | Descripción |
|---|---|
| API Key de v0 | Cuenta v0 Pro en v0.dev → Settings → API Keys |
| Formato de prompt | ¿Quieren que el vendedor escriba el brief, o se genera automáticamente desde los datos del lead? |

---

## Arquitectura de la integración

### Flujo actual
```
Vendedor solicita prototipo
  → workspace creado con status = 'pending_generation'
  → STOP (nada más pasa)
```

### Flujo con v0
```
Vendedor solicita prototipo
  → workspace creado con status = 'pending_generation'
  → POST /api/prototypes/[workspaceId]/generate
      → llama v0 API con prompt del lead
      → guarda resultado en prototype_workspaces.generated_content (columna nueva)
      → actualiza status = 'ready'
  → UI muestra el componente generado en la vista del workspace
```

---

## Cambios necesarios cuando llegue la API key

### 1. Variable de entorno
```
V0_API_KEY=<key del cliente>
```

### 2. Nueva migración de base de datos
Agregar columna `generated_content` a `prototype_workspaces`:
```sql
alter table public.prototype_workspaces
  add column generated_content text,
  add column generated_at timestamptz,
  add column generation_prompt text;
```

### 3. Nuevo endpoint
`POST /api/prototypes/[workspaceId]/generate`
- Roles: admin, pm
- Lee el workspace y el lead de origen
- Construye el prompt con nombre del cliente, industria, etiquetas y notas del lead
- Llama v0 API
- Guarda el código generado y actualiza status a `ready`

### 4. UI
- Vista del workspace muestra el código generado (con syntax highlight o preview)
- Botón "Generar" en la vista de delivery del workspace
- Estado visual: `pending_generation` → spinner, `ready` → muestra resultado

---

## Prompt base sugerido

```
Genera un prototipo de aplicación web para un cliente con las siguientes características:
- Nombre: {lead.name}
- Empresa: {lead.company}
- Industria: {lead.tags}
- Descripción del proyecto: {proposal.content}
- Presupuesto estimado: {proposal.amount}

El prototipo debe ser un componente React moderno con Tailwind CSS.
Enfócate en la pantalla principal / dashboard del producto.
```

---

## Riesgo

La API pública de v0 es limitada y puede no estar disponible para todos los planes.
Alternativa si v0 no está disponible: usar OpenAI GPT-4o con el mismo prompt para generar código React.
El endpoint y la arquitectura son idénticos — solo cambia la llamada a la API externa.

---

*Preparado el 2026-03-25 — pendiente de API key del cliente*
