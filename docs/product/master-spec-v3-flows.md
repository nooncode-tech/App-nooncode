---
title: "NoonApp - Updated Flow Diagrams for Claude Code"
subtitle: "Inbound, outbound, post-payment Maxwell AI pipeline, client portal, developer operations and seller map"
author: "Noon"
date: "2026-05-09"
version: "3.0 - Expanded diagrams"
lang: es
---

# 1. Purpose

This document contains the updated flow diagrams for the latest NoonApp decisions. It should be used together with the master specification.

Core update:

```text
Maxwell orchestration -> GPT/specification -> V0 base/prototype -> Opus technical improvement -> Developer validation/completion
```

Maxwell is the unified AI orchestration identity of Noon. GPT, V0 and Opus are internal layers/capabilities in the pipeline.

# 2. Macro system flow

```mermaid
flowchart TD
    A[Client / Lead] --> B{Origin}
    B -->|Inbound| C[Noon Website]
    B -->|Outbound| D[NoonApp Internal - Sellers]

    C --> C1[Client talks with Maxwell]
    C1 --> C2[Maxwell asks necessary questions]
    C2 --> C3[Maxwell structures idea and generates prototype]
    C3 --> C4[Client requests proposal]
    C4 --> C5[Proposal generated]

    D --> D1[Maxwell Lead Engine or Seller creates lead]
    D1 --> D2[Map View / List View]
    D2 --> D3[Seller takes lead]
    D3 --> D4[Seller works lead: visit, contact, speech, prototype]
    D4 --> D5[Seller chooses fee: 100 / 300 / 500 USD]
    D5 --> D6[Seller generates/sends proposal]
    D6 --> C5

    C5 --> E[Client reviews proposal]
    E --> F[Client accepts]
    F --> G[Client authenticates before payment]
    G --> G1[Google Auth or Email Magic Link]
    G1 --> H[Client pays initial/activation]
    H --> I{Payment confirmed?}
    I -->|No| I1[No project activation]
    I -->|Yes| J[Project activated]

    J --> K[Client portal project created/linked]
    J --> L[Internal project created in NoonApp]
    J --> M[Maxwell AI MVP pipeline starts]

    L --> N[Developer board]
    N --> O[Developer takes project]
    O --> P[Developer principal / Responsable tecnico]

    M --> Q[First usable MVP/preview]
    Q --> K
    P --> R[Developer reviews, hardens, connects, completes]
    R --> S[Versions, requests, delivery or membership]
```

# 3. Inbound flow

```mermaid
flowchart TD
    A[Client visits Noon website] --> B[Client talks with Maxwell]
    B --> C[Maxwell grounds idea with necessary questions]
    C --> D{Client can keep detailing?}
    D -->|Yes| E[Maxwell collects more context]
    D -->|No / stuck| F[Maxwell applies product and creative judgment]
    E --> G[Maxwell structures project direction]
    F --> G
    G --> H[Maxwell may use public references if needed]
    H --> I[Prototype / advance generated]
    I --> J[Client requests proposal]
    J --> K[Proposal generated]
    K --> L[Client reviews proposal]
    L --> M[Client authenticates before payment]
    M --> N[Payment]
    N --> O{Payment confirmed?}
    O -->|Yes| P[Project activation]
    O -->|No| Q[No activation]
```

# 4. Outbound seller flow

```mermaid
flowchart TD
    A[Seller opens NoonApp] --> B[Seller Leads Board]
    B --> C[Map View / List View]
    C --> D[Real-time seller location + allowed radius]
    D --> E[Search leads in this zone]
    E --> F[Maxwell Lead Engine searches, audits, scores and deduplicates]
    F --> G[Actionable leads shown as Noon blue pins]
    G --> H[Recommended lead displayed with minimal card]
    H --> I[Seller takes lead]
    I --> J[Lead reserved according to rules]
    J --> K[Seller uses speech, contact, visit, prototype]
    K --> L[Seller chooses fixed fee: 100 / 300 / 500 USD]
    L --> M[Seller generates/sends proposal]
    M --> N[Client reviews proposal]
    N --> O[Client authenticates]
    O --> P[Client pays initial/activation]
    P --> Q{Payment confirmed?}
    Q -->|Yes| R[Seller earning confirmed]
    Q -->|Yes| S[Project activated]
    Q -->|No| T[No project activation / earning remains unconfirmed]
```

# 5. Post-payment Maxwell AI pipeline

```mermaid
flowchart TD
    A[Payment confirmed] --> B[Project activated]
    B --> C[Maxwell orchestration starts automatically]
    C --> D[GPT/specification: context, scope, product direction, prompt]
    D --> E[V0: first base/prototype]
    E --> F[Opus: technical improvement]
    F --> F1[Architecture, logic, scalability, best practices]
    F1 --> G[First operable MVP]
    G --> H[Minimum validation]
    H -->|Pass| I[Private Preview available in client portal]
    H -->|Fail| J[AI auto-fix]
    J --> K{Attempts <= 5?}
    K -->|Yes| H
    K -->|No| L[Escalate to PM / Developer]
    I --> M[Client can use/test preview]
    M --> N[Developer principal reviews, hardens, connects, completes]
    N --> O[New versions / delivery / membership]
```

# 6. Client portal and versioning flow

```mermaid
flowchart TD
    A[Project active in client portal] --> B[First usable preview available]
    B --> C{Project is website/web app?}
    C -->|Yes| D[Client can Publish after validation]
    C -->|No| E[Client reviews best applicable preview/demo]
    D --> F[Published public version]
    E --> G[Private review continues]
    F --> H[Developer sends corrected version]
    G --> H
    H --> I[Version passes minimum validation]
    I --> J[New version available in portal]
    J --> K[Client previews new version]
    K --> L{Update published version?}
    L -->|Yes| M[Public version updated]
    L -->|No| N[New version remains private preview]
    M --> O[Version history updated]
    N --> O
    O --> P{Rollback needed?}
    P -->|Yes| Q[Developer authorized or PM/Admin rollback]
    P -->|No| R[Continue development]
```

# 7. Client request flow

```mermaid
flowchart TD
    A[Client opens portal] --> B[Client submits request]
    B --> C[Request recorded]
    C --> D[Request goes directly to assigned developer/team]
    D --> E[Developer/team classifies request]
    E --> F{Request type}
    F -->|Bug / problem| G[Prioritize by impact]
    F -->|Material / file| H[Attach to project]
    F -->|Minor adjustment| I[Evaluate against scope]
    F -->|Monthly improvement| J[Evaluate against membership]
    F -->|New feature| K[Review scope]
    F -->|Scope change| L[Escalate if needed]
    G --> M[Queue]
    H --> M
    I --> M
    J --> M
    K --> N[Out of scope / new proposal if needed]
    L --> O[PM/Admin intervention]
    M --> P[Queued / In Progress / Completed]
```

# 8. Developer project responsibility flow

```mermaid
flowchart TD
    A[Project activated] --> B[Project appears in developer board]
    B --> C{Developer takes project?}
    C -->|Yes| D[Developer becomes developer principal]
    C -->|No after 2h| E[Pending Developer]
    E -->|No after 4h| F[Notify developers and PM]
    F -->|No after 8h| G[Urgent Assignment Needed]
    G -->|No after 24h| H[PM/Admin mandatory intervention]
    D --> I[In Preparation]
    I --> J[Review project context]
    J --> K[In Development]
    K --> L{Need collaborator?}
    L -->|Add directly or request| M[Collaborator added/requested]
    L -->|No| N[Continue]
    M --> N
    N --> O{Developer replacement needed?}
    O -->|Yes| P[Handoff + PM/Admin controlled replacement]
    O -->|No| Q[Continue to review/delivery]
```

# 9. Seller map flow

```mermaid
flowchart TD
    A[Seller opens Map View] --> B[Request location permission]
    B --> C{Permission granted?}
    C -->|Yes| D[Show real-time seller location]
    C -->|No| E[Show manual zone option / list fallback]
    D --> F[Show allowed radius]
    F --> G[Load actionable leads within radius and seller capacity]
    G --> H[Show Noon blue pins]
    H --> I[Recommended lead auto-selected]
    I --> J[Minimal card displayed]
    J --> K{Seller action}
    K -->|Take lead| L[Lead reserved / pin updates]
    K -->|How to get there| M[Open Google Maps / Apple Maps external]
    K -->|More details| N[Open full details bottom sheet/drawer]
    D --> O{Seller moves to new zone?}
    O -->|Yes| P[Update location/radius in real time]
    P --> Q[Show Search leads in this zone]
    Q --> R[Run Maxwell Lead Engine on action]
```

# 10. Financial visibility flow for seller fee

```mermaid
flowchart TD
    A[Seller chooses fixed fee] --> B{Fee selected}
    B -->|100 USD| C[Lower seller earning / easier close]
    B -->|300 USD| D[Balanced option]
    B -->|500 USD| E[Higher seller earning / higher initial price]
    C --> F[Fee added to initial payment]
    D --> F
    E --> F
    F --> G[Client sees total initial price]
    G --> H[Client pays]
    H --> I{Payment confirmed?}
    I -->|Yes| J[Seller earning confirmed]
    I -->|No| K[Seller earning remains potential/cancelled]
    J --> L[Wallet / payout rules]
```

# 11. Key flow notes

## 11.1 Publish is not Delivered

```text
Private Preview = client can view/test privately.
Published = client made a web version public.
Delivered = Noon completed and validated approved scope.
```

## 11.2 Client requests do not automatically change scope

```text
All requests enter. Execution depends on plan, scope, membership, capacity and priority.
```

## 11.3 AI does not replace developer

```text
Maxwell/GPT/V0/Opus generate and improve first operable MVP. Developer validates, hardens, connects, scales and completes.
```

## 11.4 Map is not navigation

```text
NoonApp map shows commercial opportunities. Google Maps/Apple Maps handle physical navigation.
```
