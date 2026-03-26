# ActAware — product roadmap (sources & compliance scope)

Last updated: March 2026.

## Scope today

ActAware monitors **17 official UK feeds** (GOV.UK, HMRC, Home Office, ICO, EHRC, Acas, TPR, HSE, Legislation.gov.uk, Employment Tribunal decisions, DWP employer-facing content, etc.). We turn changes into **plain-English, employer-focused summaries** — not legal advice.

We **do not** claim to capture every compliance obligation in the UK. The site disclaimer already states we do not guarantee completeness.

## Why we softened “zero blind spots”

That phrase implied total coverage. Independent review correctly noted gaps (e.g. **Employment Appeal Tribunal** binding precedent, sector regulators). We now describe the product as **daily clarity on core UK employer compliance** and publish this roadmap for transparency.

## Planned additions (priority order)

### 1. Employment Appeal Tribunal (EAT) — **highest priority**

- **Why:** ET first-instance decisions are not binding precedent; EAT / higher courts are where many key principles are settled.
- **Challenge:** No single official API; likely **BAILII** or similar ingestion, legal/ToS review, and extra AI summarisation cost per judgment.
- **Target:** After core product stability and paying customers; likely **Professional / Agency** tier or flagged “high importance” items.

### 2. DBS (Disclosure and Barring Service) — **medium**

- **Why:** Relevant for health, education, and care-sector employers; aligns with sector-tailored positioning.
- **Challenge:** Lower volume of changes; need clear employer-action framing.

### 3. CQC (and similar sector regulators) — **medium (Agency / advisors)**

- **Why:** Differentiator for consultants and multi-client practices (social care, etc.).
- **Challenge:** Scope creep if we try to cover every sector regulator at once — phase by sector.

### 4. Central Arbitration Committee (CAC) / Certification Officer — **lower**

- **Why:** Important for union recognition and collective bargaining — smaller subset of employers.
- **When:** If customer demand is clear.

### 5. Devolved administrations (Scotland / Wales) — **lower**

- **Why:** Much employment law is reserved; still, apprenticeships, some H&S or public-sector nuance can differ.
- **When:** After England-focused depth is solid.

### 6. GLAA → FWA

- Labour abuse licensing in agriculture / food is moving under the **Fair Work Agency** (timeline per government). We already monitor FWA; we’ll align naming and feeds as the transition completes.

## Explicitly out of scope (for now)

- **FCA / SM&CR** and similar **financial services conduct** regimes — adjacent but not the same as “general employer compliance”; would be a separate product line if ever offered.

## How we’ll decide

- Customer feedback and support themes  
- Cost (ingestion + AI) vs. value  
- Legal clarity on data use for each feed  

Questions: **hello@actaware.co.uk**
