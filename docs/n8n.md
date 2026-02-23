# Automating Kryfto with n8n

Kryfto is designed from the ground up to operate as an asynchronous, webhook-compatible headless browser engine. This makes it the perfect companion for visual workflow automation tools like [n8n](https://n8n.io/).

Unlike basic scraping widgets, Kryfto runs full Chromium browsers capable of executing JavaScript, bypassing Cloudflare/Datadome (via stealth mode), and returning structured JSON.

---

## 🏗️ Core n8n Architecture

The most reliable way to integrate Kryfto into n8n is using the **HTTP Request Node**.

Since advanced website scraping (waiting for selectors, clicking pagination) takes time, Kryfto uses a Job-Queue architecture. Rather than holding the HTTP request open for 60 seconds and risking a timeout, you can instruct Kryfto to execute the job and instantly `POST` the results back to an **n8n Webhook Node**.

### The Webhook Polling Payload

When creating a job, you can use the `webhook` parameter. Kryfto will ping this URL when the Playwright browser session finishes.

```json
{
  "url": "https://news.ycombinator.com",
  "webhook": "https://your-n8n-instance.com/webhook/my-kryfto-listener",
  "options": {
    "browserEngine": "chromium"
  },
  "extract": {
    "mode": "selectors",
    "selectors": {
      "topStories": ".titleline > a"
    }
  }
}
```

---

## 🚀 Scenario: The Daily Price Monitor Dashboard

**Goal:** Every morning at 8:00 AM, scrape a list of competitor eCommerce products and insert the prices into a Google Sheet.

### Step-by-Step n8n Pipeline:

#### 1. Setup the Trigger

- Add a **Schedule Trigger** node.
- Configure it to run daily at `08:00`.

#### 2. Dispatch to Kryfto (HTTP Request Node)

- Add an **HTTP Request** node.
- **Method:** `POST`
- **URL:** `http://<your-kryfto-server-ip>:8080/v1/jobs`
- **Authentication:** Header Auth
  - Name: `Authorization`
  - Value: `Bearer <KRYFTO_API_TOKEN>`
- **Body Content Type:** `JSON`
- **Parameters (Body):**

```json
{
  "url": "https://competitor.com/product/123",
  "wait": true,
  "options": {
    "timeoutMs": 30000
  },
  "extract": {
    "mode": "selectors",
    "selectors": {
      "productName": "h1.product-title",
      "price": "span.price-amount",
      "stockStatus": "div.inventory-level"
    }
  }
}
```

_(Note: Setting `"wait": true` tells the Kryfto API to hold the connection open until the scrape finishes and return the final data immediately. This is simpler than webhooks for fast jobs under 30 seconds)._

#### 3. Parse and Insert (Google Sheets Node)

- Add a **Google Sheets** node.
- **Operation:** `Append Row`
- Map the JSON response from Kryfto directly into your sheet columns:
  - Name Column: `={{ $json.data.extract.productName }}`
  - Price Column: `={{ $json.data.extract.price }}`

---

## 🥷 Bypassing Bot Protection in n8n

If your n8n workflow hits a site that heavily protects itself (like Amazon or Cloudflare), you just need to ensure Kryfto's backend environment is configured properly.

You do **not** need to change your n8n nodes. Simply go to your Kryfto `.env` file and enable:

```env
KRYFTO_STEALTH_MODE=true
KRYFTO_PROXY_URLS=socks5://proxy1:1080
```

This forces Kryfto to automatically inject anti-fingerprinting scripts and route the Playwright browsers through your residential proxy before loading the page. n8n will still receive the clean JSON!

---

## � Native Search Automation

You don't just have to scrape URLs you already know. Kryfto has a native `/v1/search` endpoint that queries search engines directly (without Google/Bing API limits).

You can use this inside an n8n HTTP Request node to find domains _before_ you crawl them.

**n8n HTTP Node Payload:**

- **Method:** `POST`
- **URL:** `http://<your-kryfto-server-ip>:8080/v1/search`
- **Body:**

```json
{
  "query": "best enterprise headless CMS tools 2025",
  "limit": 5,
  "engine": "duckduckgo",
  "safeSearch": "moderate",
  "locale": "us-en"
}
```

**n8n Chaining Pattern:**
You can route the JSON results array from this search node directly into an **n8n Split In Batches Node**, and then fire a separate Kryfto `/v1/jobs` crawling request for every single search result returned!

---

## �🔎 Extracting Data via LLM (Schema Mode)

If the HTML on a page is too messy for CSS selectors, you can use Kryfto's **LLM Schema Extraction**. Kryfto will read the page and use an AI model to structure the data exactly how you want it.

**n8n HTTP Node Payload:**

```json
{
  "url": "https://en.wikipedia.org/wiki/Apple_Inc.",
  "wait": true,
  "extract": {
    "mode": "schema",
    "schema": {
      "type": "object",
      "properties": {
        "companyName": { "type": "string" },
        "founders": {
          "type": "array",
          "items": { "type": "string" }
        },
        "revenue": { "type": "string", "description": "Latest annual revenue" }
      }
    }
  }
}
```

_(Note: LLM extraction requires you to have `OPENAI_API_KEY` configured in Kryfto's `.env` file)._
