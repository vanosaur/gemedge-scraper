/**
 * GeM BidPlus Extractors
 */

const {
    normalizeVendorName,
    parseNumeric
} = require("../utils/dataCleaner");

const logger = require("../utils/logger");


/* ---------------------------------------------------
   HELPERS
--------------------------------------------------- */

async function getText(locator) {
    if (await locator.count() === 0) return "";
    return (await locator.first().innerText()).trim();
}

async function getRowValue(card, label) {
    const row = card.locator(`.row:has-text('${label}')`);

    if (await row.count() === 0) return "";

    const text = await row.first().innerText();

    return text.replace(new RegExp(`${label}\\s*:`, "i"), "").trim();
}

function buildResultUrl(href) {
    if (!href) return null;

    return href.startsWith("http")
        ? href
        : `https://bidplus.gem.gov.in${href}`;
}

function cleanQuantity(str) {
    if (!str) return "0";
    const cleaned = str.replace(/,/g, "");
    const match = cleaned.match(/\d+/);
    return match ? match[0] : "0";
}


/* ---------------------------------------------------
   LISTING PAGE EXTRACTOR
--------------------------------------------------- */

async function extractListingData(page) {

    const cards = await page.locator("#bidCard .card").all();

    const bids = [];

    for (const card of cards) {

        try {

            // Bid ID
            const bidLink = card.locator("a.bid_no_hover");

            if (await bidLink.count() === 0) continue;

            const bid_id = await getText(bidLink);

            // Basic Details
            let category = "N/A";
            let quantity = "0";
            
            const itemRow = card.locator(".row:has-text('Items')");
            if (await itemRow.count() > 0) {
                const itemText = (await itemRow.first().innerText()).replace(/Items\s*:/i, "").trim();
                const parts = itemText.split(/Quantity\s*[:\-]?\s*/i);
                category = parts[0].trim();
                
                if (parts.length > 1) {
                    const qtyMatch = parts[1].trim().match(/[\d,.]+/);
                    if (qtyMatch) {
                        quantity = cleanQuantity(qtyMatch[0]);
                    }
                }
                
                // Fallback: if quantity still not a clean number, try the dedicated Quantity row
                if (!quantity || quantity === "0" || isNaN(parseInt(quantity, 10))) {
                    const qtyRaw = await getRowValue(card, "Quantity");
                    const rawMatch = qtyRaw.match(/[\d,.]+/);
                    if (rawMatch) quantity = cleanQuantity(rawMatch[0]);
                }
            }

            // Buyer Department
            let buyer = "N/A";

            const dept = card.locator(".col-md-5");

            if (await dept.count() > 0) {
                const deptText = await getText(dept);

                buyer = deptText.replace(
                    /Department Name And Address:\s*/i,
                    ""
                );
            }

            // Award Date
            const award_date =
                await getText(card.locator("span.end_date")) || "N/A";

            // Result URL
            let result_url = null;

            const resultBtn = card.locator(
                "a:has(input[value='View BID Results'])"
            );

            if (await resultBtn.count() > 0) {
                const href = await resultBtn.first().getAttribute("href");

                result_url = buildResultUrl(href);
            }

            bids.push({
                bid_id,
                category,
                buyer,
                quantity,
                bid_value: 0,
                award_date,
                result_url
            });

        } catch (error) {

            logger.error("Failed to extract bid card", error);

        }
    }

    return bids;
}


/* ---------------------------------------------------
   TABLE PARSER
--------------------------------------------------- */

async function parseTable(table) {

    const headers = (
        await table.locator("thead th").allTextContents()
    ).map(h => h.trim().toLowerCase());

    const rows = await table.locator("tbody tr").all();

    return { headers, rows };
}


/* ---------------------------------------------------
   BID DETAILS EXTRACTOR
--------------------------------------------------- */

async function extractBidDetails(page) {

    const result = {
        winner_name: "N/A",
        winner_price: 0,
        num_bidders: 0,
        vendors: []
    };

    try {

        /* ------------------------------------------
           NAVIGATE TO EVALUATION DETAILS TAB
           Only click actual Bootstrap-style tabs,
           NOT global nav links that navigate away.
        ------------------------------------------ */

        const tabSelectors = [
            ".nav-tabs a:has-text('Evaluation')",
            ".nav-pills a:has-text('Evaluation')",
            "[role='tablist'] a:has-text('Evaluation')",
            "a[data-toggle='tab']:has-text('Evaluation')",
            "a[data-bs-toggle='tab']:has-text('Evaluation')",
            ".nav-tabs a:has-text('Financial')",
            "a[data-toggle='tab']:has-text('Financial')"
        ];

        for (const selector of tabSelectors) {
            const tab = page.locator(selector).first();
            if (await tab.count() > 0 && await tab.isVisible()) {
                const href = await tab.getAttribute("href") || "";
                // Only click in-page tabs (anchors like #tab1) or same-domain links
                if (href.startsWith("#") || href === "" || href.includes("bidplus.gem.gov.in")) {
                    await tab.click();
                    await page.waitForTimeout(2000);
                    logger.info("Clicked Evaluation Details tab");
                    break;
                }
            }
        }

        const tables = await page.locator("table").all();

        if (tables.length === 0) {
            logger.warn(`No tables found: ${page.url()}`);
            return result;
        }

        let technicalTable = null;
        let financialTable = null;


        /* ------------------------------------------
           IDENTIFY TABLES
        ------------------------------------------ */

        for (const table of tables) {

            const { headers } = await parseTable(table);

            const hasTech =
                headers.some(h => h.includes("status")) ||
                headers.some(h => h.includes("participated"));

            const hasFinance =
                headers.some(h => h.includes("price")) ||
                headers.some(h => h.includes("rank"));

            if (hasTech && hasFinance) {
                technicalTable = table;
                financialTable = table;
                break;
            }

            if (hasTech) technicalTable = table;

            if (hasFinance) financialTable = table;
        }

        // Fallback
        if (!technicalTable) technicalTable = tables[0];

        if (!financialTable && tables.length > 1) {
            financialTable = tables[1];
        }


        /* ------------------------------------------
           TECHNICAL VENDORS
        ------------------------------------------ */

        const techVendors = [];

        if (technicalTable) {

            const { headers, rows } = await parseTable(technicalTable);

            const nameIndex =
                headers.findIndex(h =>
                    h.includes("seller") || h.includes("name")
                );

            const statusIndex =
                headers.findIndex(h =>
                    h.includes("status") || h.includes("eligibility")
                );

            const remarksIndex =
                headers.findIndex(h =>
                    h.includes("remark") || h.includes("reason")
                );

            for (const row of rows) {

                const cols = await row.locator("td").all();

                if (cols.length === 0) continue;

                const vendor_name =
                    nameIndex >= 0
                        ? await cols[nameIndex].innerText()
                        : "";

                if (!vendor_name) continue;

                let status_flag = "Qualified";

                if (statusIndex >= 0) {

                    const statusText =
                        await cols[statusIndex].innerText();

                    if (
                        statusText.toLowerCase().includes("disqualified")
                    ) {
                        status_flag = "Disqualified";
                    }
                }

                const remarks =
                    remarksIndex >= 0
                        ? await cols[remarksIndex].innerText()
                        : "N/A";

                techVendors.push({
                    vendor_name: vendor_name.trim(),
                    status_flag,
                    remarks: remarks.trim()
                });
            }
        }


        /* ------------------------------------------
           FINANCIAL VENDORS
        ------------------------------------------ */

        const finVendors = [];

        if (financialTable) {

            const { headers, rows } = await parseTable(financialTable);

            const nameIndex =
                headers.findIndex(h =>
                    h.includes("seller") || h.includes("name")
                );

            const priceIndex =
                headers.findIndex(h =>
                    h.includes("price") ||
                    h.includes("value") ||
                    h.includes("quoted")
                );

            const rankIndex =
                headers.findIndex(h => h.includes("rank"));

            for (const row of rows) {

                const cols = await row.locator("td").all();

                if (cols.length === 0) continue;

                const vendor_name =
                    nameIndex >= 0
                        ? await cols[nameIndex].innerText()
                        : "";

                if (!vendor_name) continue;

                const vendor_price =
                    priceIndex >= 0
                        ? await cols[priceIndex].innerText()
                        : "N/A";

                const rank =
                    rankIndex >= 0
                        ? await cols[rankIndex].innerText()
                        : "N/A";

                finVendors.push({
                    vendor_name: vendor_name.trim(),
                    vendor_price: vendor_price.trim(),
                    rank: rank.trim()
                });
            }
        }


        /* ------------------------------------------
           MERGE DATA
        ------------------------------------------ */

        const merged = [];

        const baseList =
            techVendors.length > 0
                ? techVendors
                : finVendors;

        for (const vendor of baseList) {

            const normalized = normalizeVendorName(
                vendor.vendor_name
            );

            const tech = techVendors.find(
                t =>
                    normalizeVendorName(t.vendor_name) === normalized
            );

            const fin = finVendors.find(
                f =>
                    normalizeVendorName(f.vendor_name) === normalized
            );

            merged.push({
                vendor_name: vendor.vendor_name,

                vendor_price:
                    fin?.vendor_price || "N/A",

                rank:
                    fin?.rank || "N/A",

                status_flag:
                    tech?.status_flag || "Qualified",

                remarks:
                    tech?.remarks || "N/A"
            });
        }

        result.vendors = merged;

        result.num_bidders = merged.length;


        /* ------------------------------------------
           FIND WINNER
        ------------------------------------------ */

        let winner = merged.find(
            v => v.rank.toUpperCase() === "L1"
        );

        // Fallback → lowest qualified bid
        if (!winner) {

            const qualified = merged.filter(
                v =>
                    v.status_flag === "Qualified" &&
                    v.vendor_price !== "N/A"
            );

            if (qualified.length > 0) {

                winner = qualified.reduce((lowest, current) => {

                    return parseNumeric(current.vendor_price)
                        < parseNumeric(lowest.vendor_price)
                        ? current
                        : lowest;

                });
            }
        }

        if (winner) {

            result.winner_name = winner.vendor_name;

            result.winner_price = parseNumeric(
                winner.vendor_price
            );
        }

    } catch (error) {

        logger.error(
            `Error extracting bid details: ${page.url()}`,
            error
        );

    }

    return result;
}


module.exports = {
    extractListingData,
    extractBidDetails
};