# Backend — `/api/sync.js`

## Overview

`api/sync.js` is the only server-side code in the project. It is a Vercel Serverless Function written in Node.js (CommonJS). Its sole job is to act as an authenticated proxy between the browser and the Interactive Brokers Flex Web Service XML API.

The function never touches the Supabase database. All database writes happen in the browser (inside `IBKRScreen.handleSync()`) after this function returns its JSON payload.

---

## File location and entry point

**File:** `/api/sync.js`

Vercel automatically treats any `.js` file inside the `/api/` directory as a serverless function and exposes it at the matching URL path (`/api/sync`).

**Exported handler:**

```js
module.exports = async function handler(req, res) { ... }
```

---

## HTTP interface

### Request

```
GET /api/sync?token=<flexToken>&queryId=<flexQueryId>
```

| Query parameter | Required | Description |
|---|---|---|
| `token` | Yes | IBKR Flex Web Service Token (from Client Portal > Flex Queries > Flex Web Service Configuration) |
| `queryId` | Yes | The numeric ID of the Activity Flex Query configured in IBKR |

CORS headers are set to `*` for all origins so the browser can call this from any domain (including `localhost`):

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

`OPTIONS` preflight requests are handled and return `200`.

Only `GET` is accepted; any other method returns `405 Method not allowed`.

### Successful response — `200 OK`

```json
{
  "success": true,
  "tradeCount": 42,
  "openPositionCount": 3,
  "baseCurrency": "USD",
  "trades": [
    {
      "ibExecID": "...",
      "ibOrderID": "...",
      "accountId": "U1234567",
      "conid": "265598",
      "symbol": "AAPL",
      "assetCategory": "STK",
      "buySell": "BUY",
      "openCloseIndicator": "O",
      "quantity": "100",
      "tradePrice": "185.50",
      "dateTime": "20260408;093045",
      "netCash": "-18550.00",
      "fifoPnlRealized": "0",
      "ibCommission": "-1.00",
      "ibCommissionCurrency": "USD",
      "currency": "USD",
      "fxRateToBase": "1",
      "transactionType": "ExchTrade",
      "notes": "",
      "multiplier": "1",
      "strike": "",
      "expiry": "",
      "putCall": ""
    }
  ],
  "openPositions": [
    {
      "accountId": "U1234567",
      "conid": "265598",
      "symbol": "AAPL",
      "assetCategory": "STK",
      "position": "100",
      "avgCost": "185.50",
      "marketValue": "18600.00",
      "unrealizedPnl": "50.00",
      "currency": "USD"
    }
  ]
}
```

### Error response — `500`

```json
{
  "success": false,
  "error": "Timed out waiting for IBKR statement after 10 attempts"
}
```

### Missing parameter response — `400`

```json
{
  "error": "Missing token or queryId params."
}
```

---

## Internal functions

### `httpsGet(url)`

A thin Promise wrapper around Node's built-in `https.get`. Accumulates chunks and resolves with the full response body string. No external HTTP libraries are used.

### `sleep(ms)`

Promise-based delay used between IBKR polling retries.

### `sendRequest(token, queryId)`

Calls the IBKR `FlexStatementService.SendRequest` endpoint. Extracts the `<ReferenceCode>` from the XML response using a regex. Throws with the status text if the reference code is absent.

**URL format:**
```
https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.SendRequest?t=<token>&q=<queryId>&v=3
```

### `getStatement(refCode, token, maxRetries = 10, waitMs = 3000)`

Polls `FlexStatementService.GetStatement` until one of three conditions is met:

1. `<FlexStatementResponse` with `<Status>Success</Status>` or `<Status>Complete</Status>` → data is embedded, return XML
2. Response contains `<FlexQueryResponse` or `<FlexStatement ` → also valid, return XML
3. Neither condition after `maxRetries` attempts → throw timeout error

Between each "still processing" response it waits `waitMs` milliseconds (default 3 seconds).

### `parseBaseCurrency(xml)`

Extracts the `baseCurrency` attribute from the `<FlexStatement ...>` tag using a regex:

```
/<FlexStatement[^>]+baseCurrency="([^"]+)"/
```

Returns `null` if the attribute is absent.

### `parseTrades(xml)`

Iterates all self-closing `<Trade ... />` elements using a global regex. For each match, extracts the following attribute fields:

| Attribute | Field name in output |
|---|---|
| `ibExecID` | Unique execution ID — used as upsert key in Supabase |
| `ibOrderID` | Order ID — used to group executions into logical trades |
| `accountId` | IBKR account number |
| `conid` | Contract ID |
| `symbol` | Ticker symbol |
| `assetCategory` | `STK`, `OPT`, `FXCFD`, `CASH`, etc. |
| `buySell` | `BUY` or `SELL` |
| `openCloseIndicator` | `O`, `C`, `C;O`, or empty |
| `quantity` | Number of shares/contracts |
| `tradePrice` | Execution price |
| `dateTime` | IBKR format: `"20260408;100300"` |
| `netCash` | Net cash impact |
| `fifoPnlRealized` | FIFO P&L reported by IBKR |
| `ibCommission` | Commission |
| `ibCommissionCurrency` | Commission currency |
| `currency` | Trade currency |
| `fxRateToBase` | FX rate to account base currency at execution time |
| `transactionType` | `ExchTrade`, etc. |
| `notes` | IBKR-populated notes |
| `multiplier` | Contract multiplier (options/futures) |
| `strike` | Strike price (options) |
| `expiry` | Expiry date (options) |
| `putCall` | `P` or `C` (options) |

Returns an array of plain objects. All values are strings as extracted from XML; numeric conversion happens in `IBKRScreen.jsx`.

### `parseOpenPositions(xml)`

Iterates all self-closing `<OpenPosition ... />` elements. Extracted fields:

| Attribute | Notes |
|---|---|
| `accountId` | |
| `conid` | |
| `symbol` | |
| `assetCategory` | |
| `position` | Number of shares/contracts held |
| `avgCost` | Falls back to `openPrice` if absent |
| `marketValue` | Falls back to `positionValue` if absent |
| `unrealizedPnl` | Falls back to `fifoPnlUnrealized` if absent |
| `currency` | |

---

## IBKR Flex Query requirements

For `parseTrades` to work correctly, the Flex Query configured in IBKR must include the **Trades** section with at minimum these fields enabled:

`ibExecID`, `ibOrderID`, `accountId`, `conid`, `symbol`, `assetCategory`, `buySell`, `openCloseIndicator`, `quantity`, `tradePrice`, `dateTime`, `netCash`, `fifoPnlRealized`, `ibCommission`, `ibCommissionCurrency`, `currency`, `fxRateToBase`, `transactionType`, `notes`, `multiplier`, `strike`, `expiry`, `putCall`

For `parseOpenPositions`, the **Open Positions** section must include:

`accountId`, `conid`, `symbol`, `assetCategory`, `position`, `avgCost`, `marketValue`, `unrealizedPnl`, `currency`

The `baseCurrency` attribute is automatically included on the `<FlexStatement>` element.

---

## Error handling

| Scenario | Behaviour |
|---|---|
| IBKR returns no `<ReferenceCode>` | `sendRequest` throws; handler returns `500` with error message |
| IBKR report still generating after 10 polls | `getStatement` throws timeout; handler returns `500` |
| Unexpected XML structure | `getStatement` throws; handler returns `500` |
| Missing `token` or `queryId` params | Handler returns `400` before calling IBKR |
| Any uncaught error | `catch (err)` returns `500` with `err.message` |

---

## How to extend

### Add a new parsed field from the Trade element

In `parseTrades`, add a new call to `get('attributeName')` inside the push block (around line 82). Then add the corresponding column mapping in `IBKRScreen.jsx` inside the `tradesToUpsert` `.map()` callback (around line 126), and add the column to the Supabase `trades` table.

### Add a new parsed section (e.g. Cash Transactions)

1. Add a new parse function following the same regex pattern as `parseTrades`:
   ```js
   function parseCashTransactions(xml) {
     const items = [];
     const regex = /<CashTransaction\s([^>]+)\/>/g;
     let match;
     while ((match = regex.exec(xml)) !== null) {
       const attrs = match[1];
       const get = (field) => { ... };
       items.push({ ... });
     }
     return items;
   }
   ```
2. Call it in the handler and include the result in the response JSON.
3. Handle the new data in `IBKRScreen.handleSync()`.

### Change the retry policy

Adjust the `maxRetries` (default `10`) and `waitMs` (default `3000` ms) parameters in the `getStatement` call inside the handler function. The maximum wait time is `maxRetries × waitMs` = 30 seconds by default.

### Add authentication to the sync endpoint

Currently the endpoint is open (any caller with a valid IBKR token and query ID can use it). To restrict access, add a Supabase JWT check:

```js
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const authHeader = req.headers['authorization'];
const { data: { user }, error } = await supabase.auth.getUser(authHeader?.split(' ')[1]);
if (!user) return res.status(401).json({ error: 'Unauthorized' });
```

⚠️ This requires adding `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as server-side (non-`REACT_APP_` prefixed) environment variables in Vercel.
