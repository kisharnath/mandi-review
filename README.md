# Mandi Data Review (v2)

A website for checking the mandi price data that the [Mandi scraper](https://github.com/vicharanashala/Mandi) collects, and for deciding what each crop and mandi name means.

This branch (`v2`) works on the **v2 collections**, built by the scraper's `maintenance/migrate_v2.py`: either `v2_`-prefixed collections next to v1 in `Price` (`MONGODB_DB=Price`, `V2_COLLECTION_PREFIX=v2_`) or a separate database (`MONGODB_DB=PriceV2`, no prefix). v1 collections are only read, and `available_mandi` is shared. The `main` branch is the v1 site.

| Page | What it is for |
| --- | --- |
| **Today** | Prices saved per state for a day, how many farmers can see (approved product), missing mandis, the last scrape run |
| **Statistics** | The whole database at a glance: prices per day for 30 days, share of listings with a product and a mandi by state and source, name-link status, wrong prices by problem, mandis with a location |
| **Scrape runs** | Every run, per source: worked or failed, records fetched and saved, per-state counts, the error |
| **Review list** | Counts of names waiting for review, plus failed scrapes, odd prices and unknown state spellings |
| **Wrong prices** | Prices that cannot be right (0 or below, min above max, modal outside min–max, no price at all, no modal). Edit a price, or tick rows and delete them; admins can delete every match of one problem at once (up to 10,000) |
| **Crop names** | Every crop name each source uses. Approve it as a product, reject it, or create the crop/product it needs. Tabs: Pending, Double-check (approved by the migration, not by a person), Approved, Rejected |
| **Mandi names** | Every mandi name each source uses in a state. Approve it as an `available_mandi` record, reject it, or add a new mandi |
| **Farmer words** | Words farmers use for a crop (dhan, धान, jhona) and the product they mean. Pending words (claimed by two crops, or looking wrong) give no answer until approved; add missing words here |
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

**Wrong prices.** A deleted price is first copied to `deleted_price_records` with who deleted it, when and why; copy it back to `price_records` to undo. An edit keeps the scraped values in `price_before_edit`. Both close the matching "price looks wrong" item on the Review list. Prices that have min and max but no modal (almost all Meghalaya, whose modal field the scraper does not read yet) are real prices: they can be edited or deleted one by one, but not deleted in bulk.

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
5. `vercel.json` runs the site in Mumbai (`bom1`), next to the database (Atlas `asia-south1`). Every page makes several database calls, so a site running far from the database (Vercel's default is Washington, `iad1`) is several times slower. If the project's Function Region setting overrides it, set it to Mumbai there too.

## Users

`APP_USERS="name:password:role,..."` where role is `admin`, `reviewer` (both can change data) or `viewer` (read only). `AUTH_SECRET` must be at least 32 characters (`openssl rand -base64 48`).

## Tests

```bash
npm test                                                     # name-check rules
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm run test:db   # every data change, on a throwaway database
```

`test:db` creates and drops its own database. Never point it at a real one.
