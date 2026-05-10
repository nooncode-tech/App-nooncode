---
title: "NoonApp - Master Update Specification for Claude Code"
subtitle: "Client portal, post-payment AI MVP pipeline, seller map, project delivery rules and outbound compensation"
author: "Noon"
date: "2026-05-09"
version: "3.0 - Expanded"
lang: es
---

# 1. Purpose

This document is the master specification for the next NoonApp updates. It is intended for Claude Code and technical contributors who need enough product, business, operational and architectural context to implement the changes without inventing rules or breaking existing flows.

The document consolidates the latest decisions about:

- the separation between the public website/client portal and the internal NoonApp;
- client authentication before payment;
- automatic project activation after payment confirmation;
- the Maxwell AI orchestration pipeline: GPT/specification -> V0 base/prototype -> Opus technical improvement -> developer validation/completion;
- the client-facing first usable MVP/preview;
- client-controlled publishing, versioning and rollback;
- direct client requests to the assigned developer/team;
- developer principal / technical responsibility rules;
- seller map experience similar to Uber Driver;
- outbound seller fixed fees of 100 USD, 300 USD or 500 USD;
- language localization based on device/browser language;
- Claude Code's authority to improve architecture and logic in a controlled, professional way.

This document is not a request to blindly rewrite the app. Claude Code must audit the repository first, explain the plan, then implement in controlled phases.

# 2. Core system separation

Noon has two connected but different product surfaces.

## 2.1 Website / client portal

The website/client portal is the client-facing experience. It is where the client interacts with Noon before and after payment.

It includes:

- public Noon website;
- Maxwell inbound experience on the website;
- client proposal review;
- authentication before payment;
- client account;
- client projects;
- private project workspace;
- first usable MVP preview;
- Publish / Update Published Version actions for web projects;
- client requests, materials, comments and support/change requests;
- project status, latest updates and visible history.

The client should not need to enter the internal NoonApp used by sellers, developers, PMs and Admins.

## 2.2 NoonApp internal platform

NoonApp is the internal operational platform. It is used by:

- sellers;
- developers;
- PMs;
- Admins;
- Maxwell Lead Engine;
- internal project boards;
- wallet/earnings;
- lead management;
- project execution;
- technical context, handoff, activity logs and operations.

## 2.3 Shared backend/project data

The website/client portal and NoonApp should connect through shared backend/project data.

The same project should have:

- a client-facing view in the website/client portal;
- an internal operational view in NoonApp.

Rule:

```text
Client portal = client-facing project experience.
NoonApp = internal operational platform.
Both read/write to shared project data according to permissions.
```

# 3. Claude Code execution authority and constraints

Claude Code is allowed to participate in improving the architecture, logic and internal structure of NoonApp. The goal is not merely to patch UI or add features quickly. The goal is to deliver a professional, scalable and coherent system.

## 3.1 Claude Code may improve

Claude Code may:

- audit the current repository;
- identify architectural risks;
- propose better separation of responsibilities;
- improve data loading strategy;
- reduce duplicated logic;
- improve service/module boundaries;
- improve project context handling;
- improve state management if needed;
- improve validation and error handling;
- improve logging and internal events;
- improve scalability and maintainability;
- document architecture and technical decisions;
- refactor progressively when necessary.

## 3.2 Claude Code must not act blindly

Claude Code must not:

- rewrite large parts without first auditing and explaining the plan;
- change business rules without approval;
- add paid services without approval;
- change hosting, infrastructure or payment behavior without approval;
- break the separation between client portal and internal NoonApp;
- expose seller/developer/internal financial data to clients;
- expose seller compensation to developers;
- expose client-sensitive project data to unrelated sellers/developers;
- turn client requests into unlimited scope;
- treat AI-generated MVP as final delivery;
- publish public versions without client action/consent;
- replace Google Maps or Apple Maps as a navigation system.

## 3.3 Required approach

Claude Code must work in this order:

1. Audit the repository and current architecture.
2. Identify existing tables, components, services, routes and flows.
3. Explain what already exists and what needs to change.
4. Propose the minimum coherent technical plan.
5. Implement in phases.
6. Validate each phase.
7. Document decisions and important changes.

Rule:

```text
Claude Code may improve architecture and logic for a professional and scalable delivery, but must audit first, explain the plan, respect approved product rules and avoid unnecessary rewrites.
```

# 4. Source of truth and terminology

## 4.1 Source of truth hierarchy

When there is conflict between sources, Claude Code should follow this order:

1. Approved current product rules in this document.
2. Existing current master docs in the repository if they do not conflict with this document.
3. Existing code behavior if it is consistent with current rules.
4. Older conversations or legacy docs only as secondary context.
5. Claude assumptions only when explicitly marked and proposed for approval.

## 4.2 Terms

Use these terms consistently:

- **Client portal**: client-facing project area inside the Noon website/portal.
- **NoonApp internal**: internal platform for sellers, developers, PMs and Admins.
- **Developer principal**: the primary developer responsible for the project.
- **Responsable tecnico**: Spanish equivalent of developer principal / technical responsible.
- **Collaborator**: additional developer supporting the developer principal.
- **Maxwell**: Noon AI orchestration identity/system.
- **AI MVP**: first usable AI-generated MVP/preview after payment.
- **Private Preview**: a version visible to the client but not publicly published.
- **Published**: a web/web app version that the client chose to make public.
- **Delivered**: formal delivery after Noon validates the agreed scope.

Do not call the developer principal the project "owner". Use developer principal, responsable tecnico or responsable principal.

# 5. End-to-end high-level flow

## 5.1 Inbound high-level flow

Inbound starts from the website.

Flow:

1. Client lands on the Noon website.
2. Client talks with Maxwell.
3. Maxwell asks only necessary questions to ground the idea.
4. If the client does not know what else to provide or does not want to continue answering, Maxwell applies product/creative judgment and completes the missing structure as best as possible.
5. Maxwell can use public references from the internet when useful to guide the prototype direction.
6. Maxwell generates a prototype/advance.
7. Client requests proposal.
8. Proposal is generated.
9. Client reviews proposal.
10. Client authenticates before payment.
11. Client pays.
12. Payment confirmation activates project.
13. Client portal project is created/linked.
14. Maxwell AI pipeline creates first usable AI MVP.
15. Developer principal takes project from internal developer board and completes development.

## 5.2 Outbound high-level flow

Outbound starts inside NoonApp internal.

Flow:

1. Seller opens NoonApp.
2. Seller uses Map View/List View in the seller leads board.
3. Maxwell Lead Engine generates/audits leads or seller creates a lead manually.
4. Seller sees leads on map/list and takes a lead.
5. Lead is reserved by seller according to existing lead reservation rules.
6. Seller uses speech, contact actions, visit, prototype and proposal tools.
7. Seller chooses fixed one-time fee: 100 USD, 300 USD or 500 USD.
8. Seller generates/sends outbound proposal through the system.
9. PM/Admin do not review every outbound proposal by default; they intervene by exception.
10. Client reviews proposal.
11. Client authenticates before payment.
12. Client pays initial/activation.
13. Payment confirmation activates project and confirms seller earning.
14. Project enters internal developer board and client portal.

# 6. Client authentication before payment

The client should be able to review the proposal without logging in. Authentication should be required before accepting and paying.

## 6.1 Recommended flow

1. Client opens proposal.
2. Client reviews scope, price, terms and payment model.
3. Client clicks Accept & Pay / Aceptar y pagar.
4. System asks client to authenticate.
5. Primary option: Continue with Google.
6. Fallback option: Continue with email / magic link.
7. After authentication, client proceeds to payment.
8. Payment confirmation links project, payment and client account.

## 6.2 Rule

```text
Client can review proposal without login.
Client must authenticate before payment so the project, payment and portal can be correctly linked to the client account.
```

## 6.3 Existing client vs new client

If client already has account:

- attach the new project to existing account.

If client does not have account:

- create account or secure access record;
- send magic link/email access;
- attach project to that account/access.

# 7. Payment and project activation

Payment confirmation is the official activation point.

## 7.1 Before payment confirmation

Do not activate:

- project workspace;
- internal developer execution;
- AI MVP pipeline;
- seller confirmed earning;
- developer earning confirmation;
- client project access as active project.

## 7.2 After payment confirmation

The system must:

1. Activate project.
2. Link project to client account.
3. Create/show project in client portal.
4. Create/show project in NoonApp internal.
5. Start Maxwell AI MVP pipeline automatically.
6. Make project available in developer board.
7. Register payment/activation event.
8. Confirm seller earning when applicable.

Rule:

```text
Payment confirmed -> project activated -> client portal project available -> internal project available -> Maxwell AI MVP pipeline starts.
```

# 8. Client portal / workspace

## 8.1 Location

The client workspace lives inside the website/client portal, not inside internal NoonApp.

Rule:

```text
Client sees their project inside the Noon website/client portal.
Internal teams manage the project inside NoonApp.
```

## 8.2 Client portal must show

The client project area should include:

- project summary;
- current visible status;
- approved proposal;
- first usable AI MVP preview;
- public link if published;
- versions and visible history;
- requests submitted by the client;
- request statuses;
- materials/files upload area;
- latest updates;
- comments/communication;
- support/change request entry;
- membership or payment model indicators where appropriate.

## 8.3 Client portal should not expose

The client must not see:

- seller compensation;
- developer earnings;
- Noon margin;
- internal technical notes not meant for client;
- internal escalation notes;
- internal risk assessments;
- private developer/PM/Admin data.

# 9. Client requests inside the portal

## 9.1 All requests enter the system

All client requests should be accepted into the system. The portal should not block the client from submitting requests. Execution depends on scope, membership, priority, capacity and timing.

Rule:

```text
All client requests enter the system, but they are not automatically executed immediately.
```

## 9.2 Direct to developer/team

Client requests should go directly to the assigned developer/team, not first through PM by default. This reduces friction.

PM/Admin maintain visibility and intervene when necessary.

Rule:

```text
Client request -> developer/team assigned -> classification/prioritization -> execution or escalation.
```

## 9.3 PM/Admin intervention cases

PM/Admin intervene when:

- request is out of scope;
- request affects pricing;
- request creates conflict;
- request overloads developer/team;
- request affects delivery timeline significantly;
- client/developer dispute occurs;
- priority or capacity issue requires management;
- request requires new proposal or plan upgrade.

## 9.4 Request states

Official states:

- Received;
- In Review;
- Needs Clarification;
- Queued;
- In Progress;
- Completed;
- Out of Scope;
- Escalated.

Client-facing language should be simple. Escalated can be displayed as Under internal review if needed.

## 9.5 Request types

Official request types:

- Material / file;
- Comment / clarification;
- Bug / problem;
- Minor adjustment;
- Support;
- Monthly improvement;
- New feature;
- Scope change;
- Urgent / critical incident.

The client may select a type, but developer/team can reclassify it.

## 9.6 Request priority

Priorities:

- Critical;
- High;
- Normal;
- Low;
- Backlog.

Client can mark something as important, but Noon defines operational priority.

Rule:

```text
The client can submit freely. Noon classifies, prioritizes and executes according to plan, scope, membership, capacity and risk.
```

# 10. Payment model and request execution

## 10.1 One-time payment

One-time payment covers the approved scope in the proposal.

The client can submit requests, but execution follows scope.

Usually included:

- bugs on agreed functionality;
- required materials;
- clarifications;
- minor adjustments inside scope;
- agreed deliverables.

Usually not automatically included:

- new features;
- major scope changes;
- post-delivery evolution beyond agreed support;
- advanced integrations not approved.

Rule:

```text
One-time payment = execution of approved scope, not unlimited product evolution.
```

## 10.2 Membership

Membership allows continued monthly maintenance/evolution within the plan.

It may include:

- maintenance;
- minor updates;
- support;
- progressive improvements;
- bug fixes;
- reasonable adjustments;
- month-to-month improvement within plan capacity.

It does not mean unlimited development.

Rule:

```text
Membership = continuous support/evolution within the contracted plan, not unlimited development.
```

# 11. Developer board and project claiming

## 11.1 Project appears in developer board after payment confirmation

Once payment is confirmed and project is activated, the project appears in the developer board.

Normal flow:

1. Project becomes available.
2. Developer reviews project context/handoff.
3. Developer takes project.
4. Developer becomes developer principal / responsable tecnico.

PM does not assign projects by default.

## 11.2 Project must start with one developer principal

Each project starts with exactly one developer principal.

Rule:

```text
Every project must initially have one developer principal / responsable tecnico.
```

Do not start a project with multiple equal developers by default.

## 11.3 No developer after activation

SLA for unclaimed projects:

- 0-2 hours: project visible normally.
- 2 hours: Pending Developer.
- 4 hours: internal notification to available developers and PM.
- 8 hours: Urgent Assignment Needed.
- 24 hours: PM/Admin must intervene and assign manually or resolve the blockage.

Rule:

```text
If no developer takes an activated project within 24 hours, PM/Admin must intervene.
```

## 11.4 When developer takes project

When a developer clicks Take Project:

- developer becomes developer principal;
- project is no longer available as a free project to other developers;
- project status becomes Claimed;
- then In Preparation when developer reviews context;
- developer sees own earning;
- PM/Admin keep visibility;
- client does not see this internal event directly.

Rule:

```text
Taking a project = assuming technical responsibility as developer principal.
```

# 12. Project context and handoff

## 12.1 Permanent project context

Every project must contain its operational/technical context inside the project itself. Context cannot live only in chats, memory, audio messages or handoff documents.

The project context should include:

- project summary;
- client/business context;
- approved scope;
- payment model;
- approved proposal;
- prototype/current MVP version;
- materials;
- current status;
- technical notes;
- open requests;
- risks/blockers;
- next steps;
- developer principal;
- collaborators;
- latest internal update;
- relevant history.

Rule:

```text
The project must always contain enough context for a developer, collaborator, PM/Admin or replacement developer to continue without reconstructing information from chats.
```

## 12.2 Handoff

Handoff is a transfer/update layer, not the only place where context lives.

A handoff is required for:

- replacing developer principal;
- adding a major collaborator;
- transferring responsibility;
- continuing after interruption.

Handoff must include:

- current state;
- what is done;
- what is pending;
- known problems;
- repository/files/links;
- technical decisions;
- materials received;
- open requests;
- next steps.

Rule:

```text
Handoff does not replace permanent project context. It updates/transfers it.
```

# 13. Collaborators

## 13.1 Adding or requesting collaborators

The developer principal may:

- add a collaborator directly, if permissions allow;
- request a collaborator, if formal approval is needed.

A collaborator may be needed for:

- technical support;
- specific skill;
- frontend/backend split;
- urgent capacity;
- review;
- integrations;
- specialized task.

## 13.2 Responsibility remains clear

Adding collaborators does not remove the developer principal's responsibility.

Rule:

```text
The project must always maintain a clear developer principal / responsable tecnico.
```

## 13.3 Collaborator visibility

Collaborator sees only what is needed for their part:

- project summary;
- task-related scope;
- prototype/preview;
- relevant materials;
- assigned tasks;
- technical comments relevant to the task;
- own earning if applicable.

Collaborator should not see by default:

- total client payment;
- Noon margin;
- seller commission;
- developer principal earning;
- sensitive internal notes;
- unrelated client personal information;
- configuration not needed for task.

## 13.4 Collaborator earnings

Adding a collaborator does not automatically split developer principal earning.

If collaboration is formal, there must be:

- fixed task earning; or
- approved split; or
- PM/Admin-approved compensation rule.

Rule:

```text
Collaboration does not mean automatic earning split.
```

# 14. Replacing developer principal

A developer principal can be replaced, but replacement must be controlled.

Cases:

- developer cannot continue;
- excessive delay;
- abandonment;
- missing skill;
- project complexity grows;
- conflict with client/team;
- overload.

Replacement flow:

1. Developer requests replacement or PM/Admin detects issue.
2. PM/Admin reviews reason.
3. Current project context is updated.
4. Handoff is required unless emergency.
5. New developer takes/is assigned project.
6. New developer becomes developer principal.
7. Earnings are reviewed if necessary.
8. Audit trail records the change.

Rule:

```text
Replacement of developer principal requires PM/Admin control, handoff/context update and audit trail.
```

# 15. Maxwell AI orchestration

## 15.1 Maxwell definition

Maxwell is Noon's unified AI orchestration identity/system. Maxwell is not only GPT. Maxwell can combine several AI capabilities internally.

For technical documentation, the internal pipeline can be described as:

```text
Maxwell orchestration -> GPT/specification -> V0 base/prototype -> Opus technical improvement -> Developer validation/completion
```

For clients/sellers, it can be simplified as:

```text
Maxwell prepares the first usable version of the project using Noon AI.
```

## 15.2 Role of each layer

GPT/specification:

- structures client context;
- understands requirements;
- defines product direction;
- extracts scope;
- prepares prompt/specification for generation;
- avoids starting from vague raw conversation.

V0 base/prototype:

- generates first visual/functional base;
- creates prototype or initial UI/flow;
- translates specification into an initial build/prototype.

Opus technical improvement:

- takes V0 output;
- analyzes it;
- organizes it;
- improves architecture;
- improves logic;
- improves scalability;
- applies better development practices;
- turns the V0 base into the best possible first operable MVP.

Developer principal:

- reviews everything;
- validates quality;
- hardens solution;
- connects real backend/data/integrations;
- fixes issues;
- scales according to plan;
- completes formal delivery.

## 15.3 Rule

```text
Maxwell orchestrates AI. GPT structures. V0 generates the base. Opus improves the base technically. Developer validates, hardens, connects and completes.
```

# 16. Automatic AI MVP after payment

## 16.1 Trigger

The AI MVP pipeline starts automatically after payment confirmation.

Rule:

```text
Payment confirmed -> Maxwell AI MVP pipeline starts automatically.
```

The client should not wait for a manual PM/developer click to begin this process.

## 16.2 Goal

The goal is to generate the best first usable MVP/preview possible for the client.

This is not a rough internal draft. It should be usable enough for the client to open, test, review and comment from the portal.

## 16.3 Not final delivery

The AI MVP is not final delivery.

Rule:

```text
First usable AI MVP / preview is not Delivered.
Delivered requires developer/team validation and completion of approved scope.
```

## 16.4 Developer role after AI MVP

After AI MVP is generated, developer principal must:

- review quality;
- fix bugs;
- improve UX/UI;
- remove weak/generated code;
- connect real data;
- implement permissions;
- connect Supabase/API/integrations if applicable;
- validate security;
- improve scalability;
- complete missing functionality;
- maintain/improve monthly if membership applies.

# 17. AI MVP context sources

The AI pipeline must not invent from nothing. It must generate from approved project context.

Priority order:

1. Approved proposal.
2. Approved/current prototype or advance.
3. Maxwell conversation/context.
4. Client materials.
5. Payment model/plan.
6. Noon rules and safety constraints.
7. Internal templates or reusable patterns if available.

Rule:

```text
Approved proposal > approved prototype > conversation context > materials > AI inference.
```

If client discussed something earlier but proposal does not include it, the AI must not automatically build it as part of paid scope.

# 18. AI MVP by project type

The AI MVP must adapt to the project type.

## 18.1 Website / landing

Generate:

- navigable first website;
- pages/sections;
- base copy;
- CTA;
- responsive layout;
- private preview;
- publish option after validation.

## 18.2 Web app / SaaS

Generate:

- initial app shell;
- routes;
- core screens;
- mock data if real data missing;
- base flows;
- private preview;
- publish option if appropriate.

## 18.3 E-commerce

Generate:

- catalog structure;
- product card layouts;
- mock/demo products if needed;
- cart/checkout base if included;
- admin or management flow only if approved.

## 18.4 Booking/reservations

Generate:

- services list;
- booking flow;
- calendar mock/base;
- confirmation flow;
- CTA and contact flow.

## 18.5 CRM/dashboard/internal tool

Generate:

- dashboard shell;
- tables/cards;
- filters;
- statuses;
- mock data;
- role-aware structure if relevant.

## 18.6 Mobile app

Generate:

- app shell or mobile prototype;
- key screens;
- navigable flow;
- preview/demo mode where possible;
- not public website publishing unless there is a web preview wrapper.

## 18.7 Automation/AI workflow

Generate:

- workflow logic;
- control interface;
- simulation or first runnable flow;
- explanation of automation steps;
- testable outputs where possible.

## 18.8 Backend/API/integration

Generate:

- architecture/base endpoints;
- data contracts;
- documentation;
- test environment or mock interface;
- no forced public preview if not appropriate.

Rule:

```text
Only web/web app projects should expose client-controlled Publish for public access. Non-web projects should use the best applicable preview/demo/review mode.
```

# 19. AI MVP validation and auto-fix

## 19.1 Minimum validation

Before showing the AI MVP as available to the client, the system should verify:

- preview loads;
- no critical visible crash;
- main route(s) work;
- no severe placeholder content;
- no sensitive internal data exposed;
- result matches approved scope;
- basic security/coherence checks pass.

## 19.2 Auto-fix cycles

If validation fails, AI should attempt to fix automatically.

Rule:

```text
Maxwell AI MVP pipeline can attempt up to 5 generation/validation/fix cycles before escalation.
```

Escalate earlier if:

- security risk;
- sensitive data exposure;
- out-of-scope result;
- blocking conflict between proposal/prototype/requirements;
- critical technical failure;
- missing critical client material;
- incoherent generation.

## 19.3 Client-visible status

Client should not see technical errors. Use clean messages:

- Preparing your project;
- Preparing your first version;
- First version available;
- Our team is preparing your project.

# 20. Preview, publishing, versions and rollback

## 20.1 Private Preview

The first usable AI MVP is first available as Private Preview in the client portal.

Private Preview means:

- client can open/test it;
- client can comment/request;
- it is not publicly published by default;
- it is not final delivery.

## 20.2 Publish

If the project is a website/web app and passes validation, the client can choose to publish.

Rule:

```text
Public publishing is client-controlled. It is not automatic by default.
```

The portal should offer an action:

- Publish;
- Publicar.

## 20.3 Published is not Delivered

Rule:

```text
Published != Delivered.
```

Published means the client made a version public.

Delivered means Noon completed and validated the approved scope.

## 20.4 Developer sends corrected versions

Developer principal can send corrected/updated versions to the portal.

Flow:

1. Developer improves version.
2. Version passes minimum validation.
3. Version appears in portal as new private preview.
4. Client reviews.
5. Client may update public version.
6. Previous public version remains in history.

## 20.5 Update Published Version

If the client has a public version, the client can choose to update the public version with a newer preview.

Rule:

```text
Developer can send versions. Client controls what becomes public.
```

## 20.6 Version history

Each project must maintain version history.

Version states may include:

- Draft;
- Ready for Client Preview;
- Client Preview;
- Published;
- Previous Published;
- Rolled Back;
- Delivered Version.

## 20.7 Rollback

Rollback may be needed if:

- a new public version has a critical bug;
- client published by mistake;
- client prefers previous version;
- wrong version was published;
- PM/Admin detects risk.

Permissions:

- client can request rollback;
- developer authorized can execute if permitted;
- PM/Admin can execute/control rollback;
- all rollback events must be logged.

## 20.8 Validation before client preview

Developer versions must pass minimum validation before becoming visible to client.

No broken, unsafe or incomplete version should be exposed to client.

# 21. Client feedback on versions

Client feedback must be linked to the version it refers to.

Rule:

```text
Every comment, request or feedback item about a version must be attached to that version.
```

Feedback types:

- general comment;
- visual correction;
- bug/problem;
- minor adjustment;
- new request;
- approval.

Feedback received does not automatically mean change approved. It must be classified according to scope, membership, priority and capacity.

# 22. Project histories and activity logs

Every project needs internal history and client-visible updates.

## 22.1 Internal activity log

For developer principal, authorized collaborators, PM/Admin.

Should record:

- project activated;
- AI MVP generated;
- AI MVP validation/fix/escalation;
- developer took project;
- collaborator added;
- client request created/classified/completed;
- version sent to portal;
- client published/updated public version;
- rollback;
- status changes;
- handoff;
- replacement;
- earnings adjustments;
- PM/Admin intervention.

## 22.2 Client-visible updates

Client sees simple, useful updates:

- project activated;
- first version available;
- new version available;
- public version updated;
- request received;
- request in progress;
- request completed;
- project delivered;
- membership/monthly update.

Rule:

```text
Internal history can be technical and operational. Client history must be clear, useful and non-sensitive.
```

# 23. Outbound seller flow

## 23.1 Lead sources

Outbound leads can come from:

- Maxwell Lead Engine;
- seller manual creation;
- shared/private seller leads according to existing rules.

## 23.2 Seller responsibility

In outbound, the seller is responsible for:

- how they present the proposal;
- when they present it;
- how they explain value;
- which fixed seller fee they choose;
- how they manage the commercial conversation;
- not promising anything outside the system/proposal.

NoonApp provides:

- lead audit;
- speech;
- prototype support;
- proposal structure;
- price logic;
- tools and records.

Rule:

```text
NoonApp provides tools. Seller owns the commercial presentation and strategy for that lead.
```

## 23.3 PM/Admin intervention

PM/Admin do not review every seller outbound proposal by default.

They intervene only when:

- conflict;
- abuse;
- dispute;
- extreme incoherence;
- out-of-scope issue;
- risk;
- operational escalation;
- seller promise outside proposal.

# 24. Seller fixed fees: 100 / 300 / 500 USD

## 24.1 Fee options

Seller chooses one of:

- 100 USD;
- 300 USD;
- 500 USD.

The seller chooses based on:

- desired earning;
- perceived opportunity;
- difficulty of closing;
- client price sensitivity;
- commercial strategy.

## 24.2 Economic rule

The seller fixed fee:

- is one-time;
- is charged inside the client's initial/activation payment;
- is not monthly;
- is not recurring;
- does not participate in membership/monthly payments;
- becomes confirmed earning only when client initial payment is confirmed.

Formula:

```text
Outbound initial payment = base activation price + seller fixed fee
```

## 24.3 Visibility

Client sees:

- total initial/activation price;
- monthly membership if applicable.

Client does not need to see seller fee breakdown.

Seller sees:

- selected fee;
- earning potential;
- earning confirmed after payment;
- payout/wallet status.

Developer does not see seller fee.

PM/Admin can see internal financial structure for audit and exceptions.

## 24.4 Earnings states

Seller fee states:

- Potential;
- Confirmed;
- Pending payout;
- Paid out;
- Cancelled.

Rule:

```text
Seller fee selected = potential earning. Client initial payment confirmed = confirmed earning.
```

# 25. Seller promises and disputes

Seller must not promise:

- delivery times not in proposal;
- features outside scope;
- manual discounts outside the system;
- unlimited changes;
- unlimited support;
- integrations not validated;
- source code/ownership if not included;
- membership conditions different from system rules;
- final automatic delivery by AI.

If client claims seller promised something different, PM/Admin review:

- official proposal;
- system records;
- seller notes/activity;
- available messages/evidence.

Rule:

```text
The official proposal generated/sent through NoonApp is the primary source of truth. External promises do not automatically change Noon obligations.
```

# 26. Seller commercial activity logging

NoonApp should automate activity logging when possible.

Automatic events may include:

- lead_taken;
- lead_viewed;
- prototype_generated;
- speech_used;
- contact_action_started;
- proposal_generated;
- proposal_sent;
- proposal_viewed;
- payment_confirmed;
- lead_released.

Manual seller entries should be needed only when the app cannot know what happened:

- visit performed;
- client interested;
- client not interested;
- follow-up scheduled;
- important commercial note;
- important verbal clarification.

Rule:

```text
Automate what the system can detect. Ask seller only for external or human-context events.
```

# 27. Seller map - concept

The seller map should feel similar in quality and utility to Uber Driver, but it is not a navigation app.

Purpose:

- show seller location in real time;
- show seller allowed radius;
- show actionable leads nearby;
- display recommended lead automatically;
- allow quick action from map;
- open external navigation when needed.

Rule:

```text
NoonApp map = commercial opportunity map. Google Maps/Apple Maps = navigation.
```

# 28. Seller map - provider and visual standard

## 28.1 Provider

Use free/open-source first.

Preferred:

```text
MapLibre GL JS + OpenFreeMap
```

Fallback:

```text
Google Maps, only if free/open-source approach is too complex, visually poor or technically risky, and after justification/approval.
```

## 28.2 Visual standard

The map must look premium, not like a generic default map.

Visual requirements:

- mobile-first;
- clean map style;
- pines using Noon blue #1200c5;
- recommended lead emphasized;
- subtle radius visualization;
- smooth map interactions;
- floating controls;
- polished card/bottom sheet;
- minimal clutter.

Rule:

```text
The map should feel comparable in quality to an app like Uber Driver while staying on a free/open-source map stack where possible.
```

# 29. Seller map - UX and behavior

## 29.1 Mobile

Mobile layout:

- full-screen map;
- seller real-time location;
- radius circle;
- lead pins;
- recommended lead card already open;
- minimal card;
- bottom sheet for details.

## 29.2 Desktop/tablet

Desktop/tablet layout:

- map + side panel;
- lead recommended at top of panel;
- list of leads;
- filters;
- details drawer/modal.

## 29.3 Lead recommended

Recommended lead is chosen by best commercial opportunity, not only nearest distance.

Factors:

- score;
- evidence strength;
- distance;
- available contact;
- availability;
- recency;
- likely ability to generate prototype/close.

## 29.4 Minimal card

The map card should show only:

- business name;
- distance;
- score/priority;
- main pain summarized;
- quick actions.

Full audit, contact, speech, evidence, objections, history and prototype live inside More details / Ver mas detalles.

## 29.5 Actions

Minimal map card actions:

- Take lead;
- How to get there / Como llegar;
- More details / Ver mas detalles.

After taking lead, actions may include:

- Contact;
- How to get there;
- More details.

Deep actions live inside details:

- generate prototype;
- speech;
- full contact;
- audit;
- objections;
- history;
- register activity;
- generate proposal;
- report lead.

## 29.6 Navigation

NoonApp does not replace Google Maps or Apple Maps.

The action Como llegar opens external navigation app.

## 29.7 Real-time location

Seller location updates in real time while using the map/leads module.

Lead generation is controlled by refresh/action, not continuous every second.

Rule:

```text
Seller location = real time while map is active. Lead generation = controlled refresh/search.
```

## 29.8 Search in this zone

The button Buscar leads en esta zona runs Maxwell Lead Engine using current map zone/location.

It must respect:

- seller radius;
- seller lead capacity/limit;
- score minimum;
- deduplication;
- privacy rules;
- availability;
- lead quality.

## 29.9 Map/List sync

Map View and List View are two views of the same lead data.

Filters, selected lead, taken state and lead availability must stay synchronized.

## 29.10 Loading and empty states

Handle:

- no location permission;
- GPS loading;
- no leads nearby;
- few leads;
- map provider error;
- lead generation error;
- zone outside radius.

If map fails, show List View fallback.

# 30. Seller map - data loading and privacy

## 30.1 Loading rule

Map must load leads according to seller allowed capacity/limit, not a fixed global number.

Rule:

```text
Map loads actionable leads within seller radius and seller allowed capacity.
```

Prioritize:

1. recommended lead;
2. highest score;
3. strongest evidence;
4. shorter distance;
5. useful contact;
6. recency.

## 30.2 Privacy

Use real-time location only while seller uses the map/leads module.

Allowed to store:

- zone used for search;
- lead taken from map;
- navigation opened event;
- approximate distance at lead take time;
- last operational zone.

Do not store:

- minute-by-minute tracking;
- background location without justification;
- full seller route;
- location visible to other sellers;
- personal movement history.

# 31. Seller map - metrics

Track internal events:

- map_opened;
- seller_location_updated;
- zone_search_started;
- zone_search_completed;
- recommended_lead_shown;
- lead_pin_selected;
- lead_details_opened;
- lead_taken_from_map;
- navigation_opened;
- prototype_generated_from_map;
- lead_contact_started_from_map.

Seller experience remains simple. PM/Admin can analyze metrics.

# 32. Language rules

NoonApp and client portal should detect language from:

- phone;
- device;
- browser.

If supported, use that language.

If not supported, fallback to English.

Initial supported languages:

- Spanish;
- English.

Applies to:

- client portal;
- seller app;
- system messages;
- notifications;
- project states;
- request states;
- map labels/actions;
- speech;
- AI MVP messages;
- buttons such as Publish, View details, Send request.

Rule:

```text
Use device/browser language when supported. If unsupported, default to English.
```

# 33. Notifications

## 33.1 Client notifications

Notify client for:

- project activated;
- first version available;
- new version available;
- request received;
- request status changed;
- clarification needed;
- public version published/updated;
- project delivered;
- membership/monthly update if applicable.

## 33.2 Developer notifications

Notify developer principal for:

- project taken;
- AI MVP ready;
- AI MVP escalated;
- client request submitted;
- client material uploaded;
- client feedback on version;
- bug/critical issue;
- PM/Admin intervention;
- collaborator request/status.

## 33.3 PM/Admin notifications

Notify PM/Admin for exceptions:

- project unclaimed after SLA;
- AI MVP escalated;
- out-of-scope request;
- developer replacement request;
- blocked project;
- client/developer conflict;
- risk of delay;
- suspected seller promise outside proposal;
- abuse or dispute.

Rule:

```text
Notify each role only about what they need. Avoid noise.
```

# 34. Infrastructure rules

Claude Code must audit existing infrastructure before adding anything new.

Check existing:

- auth;
- payment flow;
- project model;
- client account model;
- Vercel/deployment structure;
- Supabase/storage;
- preview/public URL handling;
- versioning support;
- portal routes;
- internal project board;
- map libraries/dependencies.

Rules:

- use existing infrastructure if coherent;
- if missing, propose minimal architecture before implementing;
- do not add paid services without approval;
- do not change hosting strategy without approval;
- do not publish public previews without validation and client action;
- document architecture decisions.

# 35. Implementation order for Claude Code

Recommended phases:

## Phase 0 - Audit and plan

- audit repo;
- identify existing architecture;
- identify tables/models/routes/components;
- identify conflicts with product rules;
- propose plan before implementation.

## Phase 1 - Documentation/context

- create/update docs for new rules;
- document client portal vs NoonApp internal;
- document AI MVP pipeline;
- document seller map;
- document seller fees;
- document project context/developer principal.

## Phase 2 - Auth/payment/portal activation

- auth before payment;
- Google Auth + email/magic link fallback;
- payment confirmation -> account/project link;
- portal project activation.

## Phase 3 - Client requests and project context

- request creation/types/states/priorities;
- direct to developer/team;
- PM/Admin visibility;
- project context permanent section;
- history/logs.

## Phase 4 - Developer board and project responsibility

- project available for developers;
- developer takes project;
- 24h escalation rule;
- developer principal terminology;
- collaborators;
- replacement/handoff.

## Phase 5 - Maxwell AI MVP pipeline

- Maxwell orchestration;
- GPT/specification;
- V0 generation;
- Opus improvement;
- 5-cycle auto-fix;
- preview availability;
- project type handling;
- escalation.

## Phase 6 - Versioning and publish

- Private Preview;
- Publish;
- Update Published Version;
- version history;
- rollback;
- validation before client preview.

## Phase 7 - Seller map

- MapLibre/OpenFreeMap first;
- Map/List sync;
- real-time seller location;
- pins #1200c5;
- recommended lead card;
- search in this zone;
- external navigation;
- metrics.

## Phase 8 - Seller fee updates

- 100/300/500 selection;
- initial payment integration;
- seller earning states;
- visibility by role;
- PM/Admin exception intervention.

# 36. Global acceptance criteria

The update is successful when:

- client can authenticate before payment;
- payment confirmation creates/links client portal project;
- project appears in internal NoonApp;
- Maxwell AI pipeline starts automatically after payment;
- GPT/V0/Opus/developer responsibilities are correctly represented;
- client can access first usable preview;
- client can submit requests from portal;
- requests go directly to developer/team;
- developer can take project from board;
- project has developer principal and permanent context;
- developer can send updated versions to portal;
- client controls Publish/Update Published Version;
- versions/history/rollback are tracked;
- seller map shows real-time location, radius, pins and recommended lead;
- seller map uses free/open-source provider first and Noon blue #1200c5;
- seller can choose 100/300/500 fixed fee in outbound;
- seller fee is part of initial payment and confirmed only after payment confirmed;
- texts use device/browser language when supported, otherwise English;
- Claude Code improved architecture/logical structure where needed without breaking approved product rules.

# 37. Non-goals / out of scope

Do not implement in this update unless explicitly approved:

- replacing Google Maps/Apple Maps with custom navigation;
- paid map/voice/scraping/hosting services;
- public publishing without client action;
- unlimited client request execution;
- automatic final delivery without developer validation;
- exposing internal financial breakdown to clients;
- exposing seller fee to developers;
- turning seller location into background tracking;
- rewriting all architecture without audit and plan;
- changing business model without approval.

# 38. Final instruction for Claude Code

```text
Audit the repository first. Identify existing architecture, tables, services, routes, components and flows. Then present a technical implementation plan for these updates before making large changes.

You may improve architecture, logic, modularity and scalability when needed for a professional delivery. However, you must respect the business/product rules in this document, avoid unnecessary rewrites, avoid paid services without approval, and protect existing inbound, outbound, payments, project, workspace, developer and seller flows.

Implement in phases, validate each phase, and document important decisions.
```
