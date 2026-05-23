# Write-Up: GeM BidPlus Procurement Scraper

## 1. Approach and Tools Used

I built an automated data extraction pipeline using **Node.js** and **Playwright** to scrape awarded bid data from the GeM BidPlus portal. The system follows a multi-step approach: it first applies status and outcome filters on the listing page, paginates through results to collect at least 30 bid entries, then drills down into each bid's result page to extract financial evaluation details including vendor-wise prices, L1/L2/L3 rankings, and winner information.

The architecture is modular — extractors handle DOM parsing, a data cleaner normalizes vendor names and flags anomalies, and separate modules handle CSV/JSON export and insight generation. Column mapping is done dynamically using header text matching rather than hardcoded indices.

## 2. Challenges Faced

The biggest challenge was **inconsistent table structures** across bid result pages. Some bids use single-packet views while others use multi-packet layouts with different column orders. The "Items" and "Quantity" fields on listing cards were often merged into a single text block, requiring regex-based splitting. Vendor names also contained regulatory tags like "(MSE)", "(MII)" that needed stripping for proper deduplication.

## 3. How I Handled Failures

The scraper implements **retry logic with exponential backoff** (up to 3 attempts) for page navigation failures. Each bid detail extraction runs in an isolated try-catch block — if one bid fails, the error is logged and the scraper proceeds to the next. Detail pages open in separate browser tabs and are closed in `finally` blocks to prevent resource leaks.

## 4. What Would Break

The scraper would break if GeM changes its **DOM selectors** (e.g., `#bidCard`, `a.bid_no_hover`, table structures), introduces **CAPTCHA** or aggressive bot detection, or significantly alters the page's AJAX loading behavior. Rate limiting or IP blocking during large-scale runs is also a risk.

## 5. How I Would Improve It

I would add **proxy rotation** for resilience, implement **persistent state checkpointing** so interrupted runs can resume, use a **database** instead of flat files for incremental scraping, and add **automated tests** with saved HTML snapshots to catch selector breakage early.
