# Feature: Payment and Earnings

## Intent
A confirmed payment through Stripe automatically distributes earnings to the relevant collaborators and awards points to the seller — with no manual intervention and no risk of double-processing.

---

## Scenarios

### Scenario: Seller initiates checkout for a proposal
```
Given a proposal in 'handoff_ready' state with an amount and a client contact
When an admin or PM creates a checkout session
Then a Stripe customer is created or reused for the lead
And a payment record is created with status 'pending'
And a Stripe Checkout session is created and linked to the payment
And the client receives a URL to complete payment
```

### Scenario: Stripe confirms payment (webhook)
```
Given a 'checkout.session.completed' event from Stripe
When the webhook handler receives it
And the event has not been processed before (idempotency via event ledger)
Then the payment status is updated to 'succeeded'
And the linked project status is updated to 'in_progress'
And earnings are distributed to the seller and platform
And 50 points are credited to the seller's points ledger
```

### Scenario: Duplicate webhook delivery is ignored
```
Given a Stripe event that was already processed (exists in stripe_webhook_events)
When the webhook receives the same event again
Then the handler returns 200 without executing side effects
And no earnings, status changes, or points are duplicated
```

### Scenario: Payment fails
```
Given a 'payment_intent.payment_failed' event from Stripe
When the webhook handler receives it
Then the payment status is updated to 'failed'
And no earnings or points are distributed
And the project status remains unchanged
```

### Scenario: Seller requests a withdrawal
```
Given a seller with a positive pending payout balance
When they submit a withdrawal request
Then a withdrawal_request record is created with status 'pending'
And the seller sees it listed in their earnings dashboard
```

---

## Earnings distribution rules

| Lead origin | Seller | Developer | Platform |
|---|---|---|---|
| Outbound | $100 fixed | — | 50% of (amount − $100) |
| Inbound | — | 50% of base | 50% of base |

Points: seller always earns 50 pts per confirmed payment, regardless of origin.

---

## API surface

| Method | Route | Role |
|---|---|---|
| POST | `/api/payments/checkout` | admin, pm |
| POST | `/api/webhooks/stripe` | public (signature-verified) |
| GET | `/api/earnings` | sales, admin |
| GET | `/api/earnings/history` | sales, admin |
| POST | `/api/earnings/withdraw` | sales, admin |
| POST | `/api/payouts/initiate` | admin |

---

## Invariants

- Every Stripe webhook event is recorded in `stripe_webhook_events` before side effects execute.
- A proposal that already has a `succeeded` payment cannot generate a new checkout session.
- An open pending session is reused (not duplicated) if it is still active on Stripe.
- Stripe signature is verified on every webhook call. Unsigned requests are rejected with 400.
- Withdrawal approval is manual (admin marks as paid outside the app). No auto-transfer.
