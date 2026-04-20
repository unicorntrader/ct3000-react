'use strict';

/**
 * buildLogicalTrades (CommonJS — server-side version)
 * Input: array of raw trades from the `trades` table (sorted by date_time ASC)
 * Output: array of logical trade objects ready to insert into `logical_trades`
 */
function buildLogicalTrades(rawTrades, userId) {
  // Drop rows that are not position-taking trades.
  // asset_category === 'CASH' is IBKR's marker for pure currency conversion
  // (e.g. buying JPY with EUR to settle a trade). They have no
  // open_close_indicator and net_cash = 0; if we let them through, they
  // land as phantom "open" positions in logical_trades.
  // FXCFD is kept because that is actual FX speculation with positions.
  const filtered = rawTrades.filter(t => t.asset_category !== 'CASH');

  // trades.date_time transition: sync.js now parses IBKR's "YYYYMMDD;HHMMSS"
  // to ISO at sync time. New rows are ISO, historical rows may still be IBKR
  // compact. Try ISO parse first, fall back to the IBKR format.
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

  const orderGroups = new Map();
  for (const trade of sorted) {
    const key = trade.asset_category === 'OPT'
      ? `${trade.ib_order_id}_${trade.conid}`
      : trade.ib_order_id;
    if (!orderGroups.has(key)) orderGroups.set(key, []);
    orderGroups.get(key).push(trade);
  }

  const openPositions = new Map();
  const logicalTrades = [];

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
    if (dt.length >= 10 && dt[4] === '-') {
      const core = dt.slice(0, 19);
      return `${core}Z`;
    }
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

  const weightedAvgFxRate = (trades) => {
    const withRate = trades.filter(t => t.fx_rate_to_base != null && !isNaN(parseFloat(t.fx_rate_to_base)));
    if (withRate.length === 0) return null;
    const totalQty = withRate.reduce((sum, t) => sum + Math.abs(parseFloat(t.quantity) || 0), 0);
    if (totalQty === 0) return null;
    const totalFx = withRate.reduce((sum, t) =>
      sum + Math.abs(parseFloat(t.quantity) || 0) * parseFloat(t.fx_rate_to_base), 0);
    return totalFx / totalQty;
  };

  const sumField = (trades, field) =>
    trades.reduce((sum, t) => sum + (parseFloat(t[field]) || 0), 0);

  const getDirection = (trades) => {
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

    const indicators = group.map(t => (t.open_close_indicator || '').trim());
    const hasOpen = indicators.some(i => i.includes('O') || i === '');
    const hasClose = indicators.some(i => i.includes('C'));
    const hasCO = indicators.some(i => i === 'C;O');

    if (hasCO) {
      const closeTrades = group.filter(t => (t.open_close_indicator || '') === 'C;O');

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

      const direction = firstTrade.buy_sell === 'BUY' ? 'LONG' : 'SHORT';
      const qty = Math.abs(sumField(group, 'quantity'));
      const newTrade = {
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
        planned_trade_id: null,
        source_notes: `C;O reversal from order ${firstTrade.ib_order_id}`,
      };
      logicalTrades.push(newTrade);
      getOpenForSymbol(symbol).push(newTrade);

    } else if (hasOpen && !hasClose) {
      const direction = getDirection(group);
      const qty = Math.abs(sumField(group, 'quantity'));
      const pnl = isFX(firstTrade) ? sumField(group, 'net_cash') : 0;

      const newTrade = {
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
        planned_trade_id: null,
        source_notes: null,
      };
      logicalTrades.push(newTrade);
      getOpenForSymbol(symbol).push(newTrade);

    } else if (hasClose && !hasOpen) {
      const opens = getOpenForSymbol(symbol);
      let closingQty = Math.abs(sumField(group, 'quantity'));
      const totalPnl = isFX(firstTrade)
        ? sumField(group, 'net_cash')
        : sumField(group, 'fifo_pnl_realized');

      if (opens.length === 0) {
        // Orphan: the close execution is in our window but the open isn't.
        // We DO NOT fabricate an entry price or open date. weightedAvgPrice()
        // called on close executions returns the CLOSE price -- storing that
        // in avg_entry_price would lie. Null is honest: "we don't know".
        // P&L stays correct because IBKR's fifo_pnl_realized is computed
        // against the real (pre-window) cost basis that IBKR remembers.
        const direction = firstTrade.buy_sell === 'SELL' ? 'LONG' : 'SHORT';
        const qty = Math.abs(sumField(group, 'quantity'));
        const orphan = {
          user_id: userId,
          account_id: accountId,
          symbol,
          conid,
          asset_category: assetCategory,
          currency,
          opening_ib_order_id: firstTrade.ib_order_id,
          direction,
          // opened_at is genuinely unknown for orphans. Now that the NOT NULL
          // constraint was dropped (migration 20260420_logical_trades_opened_
          // at_nullable.sql), we store null -- the display layer already
          // renders "—" for null dates + null durations.
          opened_at: null,
          closed_at: parseDateTime(firstTrade.date_time),
          status: 'closed',
          total_opening_quantity: qty,
          total_closing_quantity: qty,
          remaining_quantity: 0,
          avg_entry_price: null,
          // We DO know the exit price -- it's the average of the close
          // executions we have. Store it so the UI can show "Exit: $X" even
          // when entry is blank.
          avg_exit_price: weightedAvgPrice(group),
          total_realized_pnl: sumField(group, 'fifo_pnl_realized'),
          fx_rate_to_base: weightedAvgFxRate(group),
          is_reversal: false,
          matching_status: 'needs_review',
          planned_trade_id: null,
          source_notes: 'Opened before the 30-day sync window — entry price and open date unknown. P&L from IBKR.',
        };
        logicalTrades.push(orphan);
      } else {
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

  return logicalTrades;
}

module.exports = { buildLogicalTrades };
