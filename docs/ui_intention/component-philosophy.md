# UI Intention: Component Philosophy

## Stack

- **Next.js 16 App Router** — pages are Server Components by default. `"use client"` is added only when interactivity is required.
- **React 19** — with Server Components and Actions available.
- **Tailwind CSS v4** — utility-first. No custom CSS files unless absolutely necessary.
- **shadcn/ui** — base component library under `components/ui/`. Do not modify these directly — extend via composition.

---

## Component responsibility model

### Server Components (default)
Used for: data-fetching pages, layout wrappers, read-only display.
Rule: no event handlers, no useState, no useEffect.

### Client Components (`"use client"`)
Used for: forms, dialogs, interactive lists, real-time updates.
Rule: receive data as props from a Server Component parent. Minimize the client boundary.

### Container / Presentational split
The dashboard follows a loose container-presentational pattern:
- Container: fetches or receives data, handles mutations, owns state.
- Presentational: renders UI from props, emits callbacks, has no data dependencies.

Example: `lead-form-dialog.tsx` owns the form state and submission. The lead card is a dumb display component.

---

## Dialog pattern

All create/edit actions use dialogs (`components/ui/dialog.tsx`) — not separate pages. The trigger is always co-located with the relevant list or card, not in a top-level action bar.

Dialogs are controlled (open/close state lives in the parent). They close on successful submit and stay open on validation errors.

---

## Form validation

Forms use **Zod schemas** for validation. The same schema is used on both the client (for UX feedback) and the server (for API validation). Schema lives in `lib/server/[domain]/schema.ts`.

Client forms are uncontrolled or lightly controlled — avoid mirroring every field in useState. Let the form submission handle the data.

---

## Data flow

```
Server Component (page)
  → fetches via lib/server/ functions or API route
  → passes data as props to Client Components

Client Component
  → renders from props
  → mutations via fetch() to /api/* routes
  → optimistic updates via local state (not global store)
```

`lib/data-context.tsx` is a **known exception** — it is a large client-side provider that fetches domain data in bulk. This is architectural debt. New features should NOT add to it. Instead, use per-page server fetching or dedicated API calls from the component that needs the data.

---

## Styling conventions

- Spacing, color, and typography: Tailwind utilities only.
- Component variants: `class-variance-authority` (cva) for multi-variant components.
- Dark mode: not implemented. If added, use Tailwind's `dark:` prefix, not a CSS variable override.
- Icons: Lucide React (`lucide-react`). One import per icon, named import.

---

## What NOT to do

- Do not add global state (Zustand, Redux, Jotai) for data that comes from the server. Fetch it server-side or via a targeted API call.
- Do not use `useEffect` to fetch data. Use Server Components or React Query if client-side fetching is genuinely required.
- Do not create wrapper components that only add a className. Use the shadcn component directly with a `className` prop.
- Do not put business logic in components. Components render. Business logic lives in `lib/`.
