# Mandi Data Review

A website for checking the mandi price data that the [Mandi scraper](https://github.com/vicharanashala/Mandi) collects, and for fixing crop and mandi matching.

| Page | What it is for |
| --- | --- |
| **Today** | Prices saved per state for a day, how many usual mandis are missing, and the last scrape run |
| **Scrape runs** | Every run, per source: worked or failed, records fetched and saved, the error |
| **Review list** | Problems to check: failed scrapes, crop names not matched, matches that look wrong, unknown mandis, odd prices. Fix them or mark them checked, one by one or in bulk |
| **Crop matching** | Every crop name mandis use, its crop group, and flags. Search, pick a name, match it to the right group or create a new one |
| **Crop groups** | Each group with all its names; rename, turn off, or remove a wrong name |
| **Mandis** | Every mandi; edit district, postcode and location |
| **All data** | Every collection in the database, with search, filters, paging and a full view of any record |
| **Change history** | Who changed what, when, and how many rows it touched |

## How matching works (read before changing data)

The scraper matches a crop name to a crop group by an **exact** match against the group's `aliases`, and writes the result onto every listing on every run. So the website changes the group's `aliases` (the source of truth) **and** the listings (`markets_commodities`) **and** the prices (`price_records`). The next scrape then gives the same answer. Mandi names work the same way through `available_mandi.aliases`.

A name is only ever kept in one crop group, so the scraper's exact match can't be ambiguous.

The website writes to the live database. Every change is recorded in `audit_log` with before and after values.

## Collections

Reads `markets_commodities`, `price_records`, `available_mandi` and `commodity_alias_lookup`. Also uses:

- `ingestion_runs`: written by the scraper (branch `fix/review-pipeline`), one document per source per run
- `review_items`: written by the scraper and by "Scan current data"; one document per problem, keyed so repeats update the same item
- `audit_log`: written by this website

## Run locally

```bash
cp .env.example .env.local   # fill in MONGODB_URI, APP_USERS, AUTH_SECRET
npm install
npm run dev                  # http://localhost:3000
```

## Deploy on Vercel

1. Push this repo to GitHub, then import it in Vercel (framework: Next.js, no build settings to change).
2. In **Settings → Environment Variables** add `MONGODB_URI`, `MONGODB_DB`, `APP_USERS` and `AUTH_SECRET` (see `.env.example`).
3. In MongoDB Atlas **Network Access**, allow Vercel to connect. Vercel has no fixed IPs on most plans, so this usually means `0.0.0.0/0`; the database user's password is then the only protection, so use a strong one and a user limited to this database.
4. Some pages run large queries. They declare `maxDuration = 60`, which Vercel allows on all plans.

## Users

`APP_USERS="name:password:role,..."` where role is `admin`, `reviewer` (both can change data) or `viewer` (read only). Sessions last 7 days.

## First-time cleanup of existing data

The existing groups contain many wrong matches (for example `hen` under groundnut, `tur` under brinjal). To list them all in the review list without changing anything:

```bash
npm run scan        # or press "Scan current data" on the Review list page
```

Then work through **Crop matching → Looks wrong / Not matched**.

## Tests

```bash
npm test                                                     # matching rules
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm run test:db   # every data change, on a throwaway database
```

`test:db` creates and drops its own database. Never point it at production.
