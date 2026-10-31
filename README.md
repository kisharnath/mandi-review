# Mandi Data Review (v2)

A website for checking the mandi price data that the [Mandi scraper](https://github.com/vicharanashala/Mandi) collects, and for deciding what each crop and mandi name means.

This branch (`v2`) works on the **v2 collections**, built by the scraper's `maintenance/migrate_v2.py`: either `v2_`-prefixed collections next to v1 in `Price` (`MONGODB_DB=Price`, `V2_COLLECTION_PREFIX=v2_`) or a separate database (`MONGODB_DB=PriceV2`, no prefix). v1 collections are only read, and `available_mandi` is shared. The `main` branch is the v1 site.

| Page | What it is for |
| --- | --- |
| **Today** | Prices saved per state for a day, how many farmers can see (approved product), missing mandis, the last scrape run |
| **Scrape runs** | Every run, per source: worked or failed, records fetched and saved, per-state counts, the error |
| **Review list** | Counts of names waiting for review, plus failed scrapes, odd prices and unknown state spellings |
| **Crop names** | Every crop name each source uses. Approve it as a product, reject it, or create the crop/product it needs. Tabs: Pending, Double-check (approved by the migration, not by a person), Approved, Rejected |
| **Mandi names** | Every mandi name each source uses in a state. Approve it as an `available_mandi` record, reject it, or add a new mandi |
| **Crops & products** | Crops, their products and default product, and every name approved for each product |
| **Mandis** | Every mandi; edit district, postcode and location (the `available_mandi` schema is not changed) |
| **States** | Every spelling the sources use for each state |
| **All data** | Every collection, with search, filters, paging and a full view of any record |
| **Change history** | Who changed what, when, before and after |

## How a decision takes effect

The scraper copies `product_id` / `mandi_id` onto listings **only from approved rows** in `crop_names` and `mandi_names`, on every run. When you approve, change or reject a name here, the website updates that row and immediately refreshes the matching `listings`. Price records are never rewritten: a price points only at its listing.

- **Pending** names show no price to farmers. That is deliberate: no price is better than a wrong one.
- **Approved by migration** means the old (v1) match was unambiguous and plausible, but nobody has checked it. Work through the *Double-check* tab.
- A name can mean different products for different varieties (agmarknet "paddy" with variety "basmati"). Use *One variety means a different product* on the crop name page.

Every change is written to `audit_log`.

## Run locally

```bash
cp .env.example .env.local   # MONGODB_URI, MONGODB_DB, V2_COLLECTION_PREFIX, APP_USERS, AUTH_SECRET
npm install
npm run dev                  # http://localhost:3000
```

## Deploy on Vercel

1. Push this repo to GitHub and import it in Vercel (framework: Next.js). Deploy the `v2` branch, or merge it to `main`.
2. In **Settings → Environment Variables** set `MONGODB_URI`, `MONGODB_DB` (`Price`), `V2_COLLECTION_PREFIX` (`v2_`), `APP_USERS`, `AUTH_SECRET`.
3. In MongoDB Atlas **Network Access**, allow Vercel to connect (usually `0.0.0.0/0`), and use a database user with `readWrite` on `Price`.
4. Heavy pages declare `maxDuration = 60`, which Vercel allows on all plans.

## Users

`APP_USERS="name:password:role,..."` where role is `admin`, `reviewer` (both can change data) or `viewer` (read only). `AUTH_SECRET` must be at least 32 characters (`openssl rand -base64 48`).

## Tests

```bash
npm test                                                     # name-check rules
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm run test:db   # every data change, on a throwaway database
```

`test:db` creates and drops its own database. Never point it at a real one.
