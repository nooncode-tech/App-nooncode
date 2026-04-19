\# QA Auth Runtime Checklist



\## Scope

Validate real auth/session runtime only. Do not open new scopes.



\## Preconditions

\- Local app running on http://localhost:3000

\- Real Supabase project connected

\- `.env.local` configured

\- Auth seed executed successfully

\- At least one valid seeded user available

\- Ignore hydration warnings caused by browser extensions unless there is direct evidence they come from the app



\## Functional Validation Order



\### 1. Real login

\- Open `/`

\- Sign in with a real seeded user

\- Expected result: login succeeds and redirects to `/dashboard`



\### 2. Protected dashboard access with session

\- Confirm `/dashboard` loads correctly after login

\- Expected result: dashboard shell renders without auth error



\### 3. Refresh keeps session

\- Refresh while authenticated on `/dashboard`

\- Expected result: session persists and dashboard remains accessible



\### 4. Logout

\- Trigger logout from authenticated area

\- Expected result: session closes and app returns to public/login route



\### 5. Protected route redirect without session

\- With session closed, open `/dashboard`

\- Expected result: redirect to `/`



\### 6. Protected child route redirect without session

\- With session closed, open `/dashboard/leads`

\- Expected result: redirect to `/`



\## Notes

\- Distinguish auth failure from post-login redirect failure

\- Do not treat manual URL access and in-app navigation as the same validation

\- When a fix is applied, re-run the full checklist in the same order

\- Before commit, validate diff is minimal and related only to the fix



\## Current Known Result

\- Real Supabase auth runtime validated

\- Post-login redirect from home page was fixed in `app/page.tsx`

\- Login, logout, refresh, and protected-route redirects validated successfully

