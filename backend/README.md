# HIVE Encyclopedia — Backend

Cloudflare Worker + D1 (SQLite) + R2. Public API on top of Wikidata Q-IDs.

## What's here

- `wrangler.toml` — Cloudflare config (D1 + R2 bindings, commented until resources created)
- `migrations/0001_init.sql` — Full schema: entries, atomic_claims, sources, claim_sources, translations, challenges, verification_log, users, nodes, source_blocklist
- `src/index.js` — Worker entry point + router
- `src/db.js` — D1 query helpers (parameterized, no SQL injection)
- `src/routes/` — Route handlers per resource

## API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Service health |
| `GET` | `/api/entry/:qid` | Fetch entry + atomic claims by Wikidata Q-ID |
| `GET` | `/api/entry/:qid/claims` | Atomic claims only |
| `POST` | `/api/entry` | Submit a verified entry (extension/AI quorum) |
| `GET` | `/api/claim/:id` | One claim + its sources |
| `GET` | `/api/source/:id` | Source metadata |
| `POST` | `/api/challenge` | Submit a challenge **with mandatory citations** |
| `POST` | `/api/verify` | Log a verification round |
| `GET` | `/api/recent` | Recent verified entries (homepage feed) |
| `GET` | `/api/wikidata/entity/:qid` | Proxy to Wikidata API (avoids CORS) |
| `GET` | `/api/wikidata/search?q=...` | Wikidata entity search |

## Deployment (to be run by Nir)

> ⚠️ These commands create real Cloudflare resources on your account. Costs:
> - D1: free up to 5GB storage + 5M reads/day
> - R2: $0.015/GB/month (negligible at our scale)
> - Workers: free up to 100K requests/day

### Step 1: Create the D1 database

```bash
cd "C:/Users/Nir Yanushevsky/Claude Projects/hive-backend"
npx wrangler d1 create hive-encyclopedia
```

This prints a `database_id`. Paste it into `wrangler.toml` (uncomment the `[[d1_databases]]` block).

### Step 2: Run the schema migration

```bash
npx wrangler d1 execute hive-encyclopedia --remote --file=./migrations/0001_init.sql
```

### Step 3: Create the R2 bucket (for snapshots/dumps)

```bash
npx wrangler r2 bucket create hive-encyclopedia-content
```

Uncomment the `[[r2_buckets]]` block in `wrangler.toml`.

### Step 4: Deploy the Worker

```bash
npx wrangler deploy
```

This gives you a URL like `https://hive-encyclopedia.niryanush.workers.dev`.

### Step 5: Smoke test

```bash
curl https://hive-encyclopedia.niryanush.workers.dev/api/health
# Expect: { "ok": true, "service": "hive-encyclopedia", ... }

curl https://hive-encyclopedia.niryanush.workers.dev/api/wikidata/entity/Q937
# Expect: Einstein metadata from Wikidata
```

### Step 6: Connect to a custom domain (optional)

If you have `hive-ny.com` or similar:

```bash
npx wrangler deploy --routes "api.hive-ny.com/*"
```

Or via Cloudflare dashboard → Workers → Triggers → Custom Domains.

## Source classification (dirgom)

Challenges must include sources. Each source has a type A–H:

| Type | Description | Weight | Examples |
|---|---|---:|---|
| A | Peer-reviewed academic | 100 | PubMed, Nature, arXiv (post-review) |
| B | Government / official | 90 | census.gov, ECB, court documents |
| C | Trusted databases | 80 | Crossref, ORCID, IMDb |
| D | Established news | 70 | Reuters, AP, BBC, NYT |
| E | Books, reputable publishers | 70 | OUP, Cambridge UP, Penguin |
| F | Primary documents | 60 | Letters, archival records |
| G | Other encyclopedias | 50 | Britannica, Wikipedia |
| H | Expert testimony | 40 | Recognized authority quotes |

### Challenge thresholds

- Challenge an **established** claim: need ≥2 type-A/B sources OR ≥3 type-C/D
- Challenge a **well-supported** claim: need ≥1 type-A OR ≥2 type-B/C
- Challenge a **disputed** claim: any type-D+ source

Anything below D is auto-rejected (see `source_blocklist` table).

## Roadmap

- [x] Schema + Worker scaffold
- [x] Wikidata proxy
- [x] Challenge endpoint with citation validation
- [ ] Google OAuth (currently anonymous-friendly)
- [ ] Background re-verification queue
- [ ] Wikipedia ingestion pipeline (Featured Articles first)
- [ ] Translation layer (one entry → N languages)
- [ ] Mirror nodes (volunteer machines mirror the dataset)
- [ ] Weekly dumps to public storage
