# GeM BidPlus Procurement Scraper & Analytics System

An industry-grade, modular, and resilient data extraction pipeline built with **Node.js** and **Playwright** for scraping and parsing bid results from the Government e-Marketplace (GeM) BidPlus procurement portal.

---

## 🏗️ Architecture & Features

This project utilizes a highly modular structure to extract, clean, analyze, and format procurement data from the live GeM portal:

```
gemedge_assignment/
├── outputs/               # Saved JSON & CSV data sets and analytics insights
├── scraper/
│   └── extractors.js      # Scrapes bid list cards & drill-down result tables
├── utils/
│   ├── dataCleaner.js     # Sanitizes names, values, duplicates & flags anomalies
│   └── logger.js          # Colored log helper with timestamps & severity levels
├── scraper.js             # Main orchestrator managing filters, pagination & pipeline
├── saveCsv.js             # Serializer for structured JSON and flat multi-row CSV
└── insights.js            # Analytical reporting engine for procurement statistics
```

### Key Technical Achievements:
- **Resilient Multi-Packet Parser**: Classifies and handles both single-packet (`/getSinglePacketResultView`) and multi-packet (`/getBidResultView`) tables dynamically.
- **Header-Based Column Mapping**: Maps columns dynamically based on text match (`Seller Name`, `Price`, `Rank`, `Status`), avoiding brittle, hardcoded index selections.
- **Tab-Isolated Execution Context**: Opens detail views in dedicated page contexts (tabs) and closes them, preserving parent page filtration state and pagination without reloading page listings.
- **Post-Scraping Data Integrity & Anomaly Detection**:
  - Cleans and normalizes seller names, stripping complex regulatory category tags.
  - Automatically identifies price anomalies (e.g., when the awarded winner's price is not the lowest bid among qualified vendors).
- **Graceful Error Handling & Exponential Backoff**: Retries failed navigations up to 3 times with progressive delays.

---

## 🛠️ Setup & Execution

### Prerequisites
- Node.js (v16+)
- npm

### Installation
1. Clone or download this repository to your workspace.
2. Install the required dependencies:
   ```bash
   npm install
   ```
3. Ensure Playwright browsers are installed:
   ```bash
   npx playwright install chromium
   ```

### Execution
Run the main orchestrator script:
```bash
node scraper.js
```
The scraper will initialize Chromium, apply the status and outcome filters, paginate to collect at least 30 bids, drill down to parse detailed evaluation results, and output the data inside the `outputs/` folder.

---

## 📊 Outputs & Insights

Upon completion, three main files are generated under `outputs/`:
1. `bids_data.json`: Hierarchical structured JSON data.
2. `bids_data.csv`: Flattened, multi-row relational spreadsheet matching bid details with their corresponding participant vendors.
3. `insights.json`: An analytics report calculating:
   - **Participation Rate**: Percentage of bids with high participation (> 3 bidders).
   - **L1 vs L2 price gap**: Average absolute and percentage gap between winner (L1) and runner-up (L2) prices.
   - **Repeat Winners**: Rank of bidders by frequency of winning.

---

## 🔍 Selector Inspection & Best Practices

Scraping dynamic enterprise and government portals requires a specialized set of techniques:

### 1. Handling Dynamic Content Loading
- **Observation**: Filters on the BidPlus portal trigger asynchronous AJAX refreshes rather than traditional page refreshes.
- **Best Practice**: After checking the `#bidrastatus` and `#bid_awarded` checkmarks, the scraper waits for a 5-second buffer or listens for network idle state to ensure the page has refreshed.
- **Pagination**: The Next button (`a.page-link.next`) modifies the URI hash (`#page-X`). We dynamically verify page transitions by storing the first bid ID on the current page and waiting for the DOM to update to a different first bid ID.

### 2. Bypass Detection & Politeness
- **User-Agent Spoofing**: We construct a browser context using a modern Chrome user-agent string to prevent default headless headers from triggering firewalls.
- **Viewport Constraints**: Setting a standard viewport simulates genuine user displays.
- **Rate-Limiting (Politeness Delay)**: The orchestrator introduces a 1000ms delay between processing each drill-down URL. This protects the server from traffic spikes and ensures stable sessions.
- **Session Maintenance**: Instead of scraping details concurrently, the scraper traverses detail links sequentially to prevent session invalidation or IP bans.

---

## 🛡️ Error Handling & Resiliency

Procurement portals can experience transient network failures. Our system is built with resilience in mind:
- **Exponential Backoff**: If a page navigation fails, it waits for `2^attempt * 1000ms` before retry, giving the portal server breathing room during load spikes.
- **Isolated Try-Catch**: If a single drill-down detail extraction fails (e.g., corrupted table structure or session timeout), the scraper logs the error, closes the tab, and proceeds to the next bid, ensuring one corrupt record doesn't sink the entire run.
- **Finally Blocks**: Crucial cleanups, such as closing tabs and closing the main browser instance, are placed inside `finally` blocks to prevent memory leaks and zombie browser processes.
