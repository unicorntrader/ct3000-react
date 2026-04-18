/**
 * buildLogicalTrades
 * Input: array of raw trades from the `trades` table (already sorted by date_time ASC)
 * Output: array of logical trade objects ready to upsert into `logical_trades`
 */

export function buildLogicalTrades(rawTrades, userId) {
  // Step 0 — Drop rows that are not position-taking trades.
  // asset_category === 'CASH' is IBKR's marker for pure currency conversion
  // (e.g. buying JPY with EUR to settle a trade). They have no
  // open_close_indicator and net_cash = 0; if we let them through, they
  // land as phantom "open" positions in logical_trades.
  // FXCFD is kept because that is actual FX speculation with positions.
  const filtered = rawTrades.filter(t => t.asset_category !== 'CASH');

  // Step 1 — Sort by date_time ASC
  // trades.date_time transition: sync.js now parses IBKR's "YYYYMMDD;HHMMSS"
  // to ISO at sync time. New rows are ISO, historical rows may still be IBKR
  // compact. Try ISO parse first, fall back to the IBKR format. Once the
  // trades.date_time -> timestamptz migration runs, only ISO remains and
  // the fallback can be removed.
  const sorted = [...filtered].sort((a, b) => {
    const toMs = (dt) => {
      if (!dt) return 0;
      const asDate = new Date(dt);
      if (!isNaN(asDate.getTime())) return asDate.getTime();
      const [date, time] = dt.split(';');
      const d = date ? `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}` : '1970-01-01';
      const t = time ? `${time.slice(0,2)}:${time.slice(2,4)}:${time.slice(4,6)}` : '00:00:00';
      return new Date(`${d}T${t}Z`).getTime();
    };
    return toMs(a.date_time) - toMs(b.date_time);
  });

  // Step 2 — Group by order key
  // For OPT: group key = ib_order_id + conid
  // For everything else: group key = ib_order_id
  const orderGroups = new Map();
  for (const trade of sorted) {
    const key = trade.asset_category === 'OPT'
      ? `${trade.ib_order_id}_${trade.conid}`
      : trade.ib_order_id;

    if (!orderGroups.has(key)) orderGroups.set(key, []);
    orderGroups.get(key).push(trade);
  }

  // Step 3 — Process each group into logical trade events
  // We maintain a list of open logical trades per symbol to handle FIFO matching
  // openPositions: Map<symbol, LogicalTrade[]>
  const openPositions = new Map();
  const logicalTrades = [];
  let idCounter = 1;

  const getOpenForSymbol = (symbol) => {
    if (!openPositions.has(symbol)) openPositions.set(symbol, []);
    return openPositions.get(symbol);
  };

  // Accept both IBKR compact ("YYYYMMDD;HHMMSS") and ISO-shaped inputs.
  // Returns ISO 8601 with trailing Z. Historical trades.date_time rows may
  // still be in IBKR format until the trades.date_time -> timestamptz
  // migration runs; new rows from sync.js are already ISO.
  const parseDateTime = (dt) => {
    if (!dt) return null;
    // Already ISO (starts "YYYY-MM-DD" with a dash)? pass through.
    if (dt.length >= 10 && dt[4] === '-') {
      // Normalize: drop any trailing offset/Z, add 'Z' so callers have one format.
      const core = dt.slice(0, 19);
      return `${core}Z`;
    }
    // IBKR compact "YYYYMMDD;HHMMSS"
    const [date, time] = dt.split(';');
    if (!date) return null;
    const d = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
    const t = time ? `${time.slice(0,2)}:${time.slice(2,4)}:${time.slice(4,6)}` : '00:00:00';
    return `${d}T${t}Z`;
  };

  const weightedAvgPrice = (trades) => {
    const totalQty = trades.reduce((sum, t) => sum + Math.abs(parseFloat(t.quantity) || 0), 0);
    if (totalQty === 0) return 0;
    const totalValue = trades.reduce((sum, t) =>
      sum + Math.abs(parseFloat(t.quantity) || 0) * (parseFloat(t.trade_price) || 0), 0);
    return totalValue / totalQty;
  };

  // Weighted average FX rate across executions (weight = |qty|).
  // Returns null when ALL rows have null/missing fx_rate_to_base — meaning the raw trades
  // were synced before the column existed and need a full re-sync to populate.
  // Returns 1.0 only when at least one row has a real value (i.e. USD trades).
  const weightedAvgFxRate = (trades) => {
    const withRate = trades.filter(t => t.fx_rate_to_base != null && !isNaN(parseFloat(t.fx_rate_to_base)));
    if (withRate.length === 0) return null; // signal: data missing, not defaulted
    const totalQty = withRate.reduce((sum, t) => sum + Math.abs(parseFloat(t.quantity) || 0), 0);
    if (totalQty === 0) return null;
    const totalFx = withRate.reduce((sum, t) =>
      sum + Math.abs(parseFloat(t.quantity) || 0) * parseFloat(t.fx_rate_to_base), 0);
    return totalFx / totalQty;
  };

  const sumField = (trades, field) =>
    trades.reduce((sum, t) => sum + (parseFloat(t[field]) || 0), 0);

  const getDirection = (trades) => {
    // Direction is determined by the opening trades
    const openTrades = trades.filter(t => (t.open_close_indicator || '').includes('O'));
    if (openTrades.length === 0) return trades[0]?.buy_sell === 'BUY' ? 'LONG' : 'SHORT';
    return openTrades[0].buy_sell === 'BUY' ? 'LONG' : 'SHORT';
  };

  const isFX = (t) => t.asset_category === 'FXCFD' || t.asset_category === 'CASH';

  for (const [, group] of orderGroups) {
    const firstTrade = group[0];
    const symbol = firstTrade.symbol;
    const assetCategory = firstTrade.asset_category;
    const currency = firstTrade.currency || null;
    const accountId = firstTrade.account_id;
    const conid = firstTrade.conid;

    // Classify indicators across the group
    const indicators = group.map(t => (t.open_close_indicator || '').trim());
    const hasOpen = indicators.some(i => i.includes('O') || i === '');
    const hasClose = indicators.some(i => i.includes('C'));
    const hasCO = indicators.some(i => i === 'C;O');

    if (hasCO) {
      // IBKR C;O ("close then open") reversal: one execution that closes the
      // existing position AND opens the opposite one in a single fill. We
      // model it as two steps — FIFO-close the existing position using
      // `closeTrades`, then create a new logical trade for the opposite-side
      // opening using the same `group` (no qty split; the full quantity both
      // closes and opens).
      const closeTrades = group.filter(t => (t.open_close_indicator || '') === 'C;O');

      // Close side
      const opens = getOpenForSymbol(symbol);
      if (opens.length > 0) {
        let closingQty = Math.abs(sumField(closeTrades, 'quantity'));
        const totalPnl = sumField(closeTrades, 'fifo_pnl_realized');
        const coFxRate = weightedAvgFxRate(closeTrades);

        while (closingQty > 0 && opens.length > 0) {
          const oldest = opens[0];
          const available = oldest.remaining_quantity;
          const used = Math.min(closingQty, available);
          oldest.remaining_quantity -= used;
          oldest.total_closing_quantity = (oldest.total_closing_quantity || 0) + used;
          oldest.total_realized_pnl = (oldest.total_realized_pnl || 0) + totalPnl * (used / Math.abs(sumField(closeTrades, 'quantity')));
          oldest.fx_rate_to_base = coFxRate;
          oldest.closed_at = parseDateTime(firstTrade.date_time);
          closingQty -= used;

          if (oldest.remaining_quantity <= 0) {
            oldest.status = 'closed';
            oldest.remaining_quantity = 0;
            opens.shift();
          }
        }
      }

      // Open side — new logical trade in direction based on buy_sell of the C;O trades
      const direction = firstTrade.buy_sell === 'BUY' ? 'LONG' : 'SHORT';
      const qty = Math.abs(sumField(group, 'quantity'));
      const newTrade = {
        _tempId: idCounter++,
        user_id: userId,
        account_id: accountId,
        symbol,
        conid,
        asset_category: assetCategory,
        currency,
        opening_ib_order_id: firstTrade.ib_order_id,
        direction,
        opened_at: parseDateTime(firstTrade.date_time),
        closed_at: null,
        status: 'open',
        total_opening_quantity: qty,
        total_closing_quantity: 0,
        remaining_quantity: qty,
        avg_entry_price: weightedAvgPrice(group),
        total_realized_pnl: 0,
        fx_rate_to_base: weightedAvgFxRate(group),
        is_reversal: true,
        matching_status: 'needs_review',
        source_notes: `C;O reversal from order ${firstTrade.ib_order_id}`,
      };
      logicalTrades.push(newTrade);
      getOpenForSymbol(symbol).push(newTrade);

    } else if (hasOpen && !hasClose) {
      // Pure opening trade
      const direction = getDirection(group);
      const qty = Math.abs(sumField(group, 'quantity'));
      const pnl = isFX(firstTrade) ? sumField(group, 'net_cash') : 0;

      const newTrade = {
        _tempId: idCounter++,
        user_id: userId,
        account_id: accountId,
        symbol,
        conid,
        asset_category: assetCategory,
        currency,
        opening_ib_order_id: firstTrade.ib_order_id,
        direction,
        opened_at: parseDateTime(firstTrade.date_time),
        closed_at: null,
        status: 'open',
        total_opening_quantity: qty,
        total_closing_quantity: 0,
        remaining_quantity: qty,
        avg_entry_price: weightedAvgPrice(group),
        total_realized_pnl: pnl,
        fx_rate_to_base: weightedAvgFxRate(group),
        is_reversal: false,
        matching_status: 'needs_review',
        source_notes: null,
      };
      logicalTrades.push(newTrade);
      getOpenForSymbol(symbol).push(newTrade);

    } else if (hasClose && !hasOpen) {
      // Pure closing trade — FIFO match against open positions
      const opens = getOpenForSymbol(symbol);
      let closingQty = Math.abs(sumField(group, 'quantity'));
      const totalPnl = isFX(firstTrade)
        ? sumField(group, 'net_cash')
        : sumField(group, 'fifo_pnl_realized');

      if (opens.length === 0) {
        // No open position found — create orphan closed trade
        const direction = firstTrade.buy_sell === 'SELL' ? 'LONG' : 'SHORT';
        const qty = Math.abs(sumField(group, 'quantity'));
        const orphan = {
          _tempId: idCounter++,
          user_id: userId,
          account_id: accountId,
          symbol,
          conid,
          asset_category: assetCategory,
          currency,
          opening_ib_order_id: firstTrade.ib_order_id,
          direction,
          opened_at: parseDateTime(firstTrade.date_time),
          closed_at: parseDateTime(firstTrade.date_time),
          status: 'closed',
          total_opening_quantity: qty,
          total_closing_quantity: qty,
          remaining_quantity: 0,
          avg_entry_price: weightedAvgPrice(group),
          total_realized_pnl: sumField(group, 'fifo_pnl_realized'),
          fx_rate_to_base: weightedAvgFxRate(group),
          is_reversal: false,
          matching_status: 'needs_review',
          source_notes: 'No matching open trade found — outside query window',
        };
        logicalTrades.push(orphan);
      } else {
        // FIFO cascade
        const closingFxRate = weightedAvgFxRate(group);
        const coverPrice = weightedAvgPrice(group);

        while (closingQty > 0 && opens.length > 0) {
          const oldest = opens[0];
          const available = oldest.remaining_quantity;
          const used = Math.min(closingQty, available);

          // Per-lot P&L from actual prices. Weighted-average the closing
          // price into this lot's avg_exit_price so the UI can show a real
          // number instead of reverse-engineering one from stored P&L.
          const entry = oldest.avg_entry_price || 0;
          const lotPnl = oldest.direction === 'LONG'
            ? used * (coverPrice - entry)
            : used * (entry - coverPrice);

          const priorClosed = oldest.total_closing_quantity || 0;
          const priorExit = oldest.avg_exit_price || 0;
          const newClosed = priorClosed + used;
          oldest.avg_exit_price = newClosed > 0
            ? (priorExit * priorClosed + coverPrice * used) / newClosed
            : coverPrice;

          oldest.remaining_quantity -= used;
          oldest.total_closing_quantity = newClosed;
          oldest.total_realized_pnl = (oldest.total_realized_pnl || 0) + lotPnl;
          // Use the FX rate at close time — that's when P&L was realized
          oldest.fx_rate_to_base = closingFxRate;
          oldest.closed_at = parseDateTime(firstTrade.date_time);
          closingQty -= used;

          if (oldest.remaining_quantity <= 0) {
            oldest.status = 'closed';
            oldest.remaining_quantity = 0;
            opens.shift();
          }
        }

        // If closingQty > 0 here, FIFO ran dry -- more close qty than we
        // have visible opens. Happens when the user had positions opened
        // before the 30-day Flex window started. We DO NOT fabricate a
        // synthetic trade for the leftover -- truth-first. Our logical_
        // trades sum will not match IBKRs aggregate in this case, and
        // that gap is an honest signal of data we simply do not have.
      }
    }
  }

  // Clean up temp IDs before returning
  return logicalTrades.map(({ _tempId, ...trade }) => trade);
}
