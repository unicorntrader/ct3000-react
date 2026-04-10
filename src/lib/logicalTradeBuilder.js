/**
 * buildLogicalTrades
 * Input: array of raw trades from the `trades` table (already sorted by date_time ASC)
 * Output: array of logical trade objects ready to upsert into `logical_trades`
 */

export function buildLogicalTrades(rawTrades, userId) {
  // Step 1 — Sort by date_time ASC
  const sorted = [...rawTrades].sort((a, b) => {
    const toMs = (dt) => {
      if (!dt) return 0;
      // Format: "20260408;100300"
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

  const parseDateTime = (dt) => {
    if (!dt) return null;
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
    const accountId = firstTrade.account_id;
    const conid = firstTrade.conid;

    // Classify indicators across the group
    const indicators = group.map(t => (t.open_close_indicator || '').trim());
    const hasOpen = indicators.some(i => i.includes('O') || i === '');
    const hasClose = indicators.some(i => i.includes('C'));
    const hasCO = indicators.some(i => i === 'C;O');

    if (hasCO) {
      // Split C;O — process close portion first, then open portion
      const closeTrades = group.filter(t => (t.open_close_indicator || '') === 'C;O');
      const openTrades = group.filter(t => (t.open_close_indicator || '') === 'C;O'); // same trades, different qty split

      // For simplicity: treat C;O as fully closing then fully opening
      // Close side
      const opens = getOpenForSymbol(symbol);
      if (opens.length > 0) {
        let closingQty = Math.abs(sumField(closeTrades, 'quantity'));
        const totalPnl = sumField(closeTrades, 'fifo_pnl_realized');

        while (closingQty > 0 && opens.length > 0) {
          const oldest = opens[0];
          const available = oldest.remaining_quantity;
          const used = Math.min(closingQty, available);
          oldest.remaining_quantity -= used;
          oldest.total_closing_quantity = (oldest.total_closing_quantity || 0) + used;
          oldest.total_realized_pnl = (oldest.total_realized_pnl || 0) + totalPnl * (used / Math.abs(sumField(closeTrades, 'quantity')));
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
        is_reversal: true,
        matching_status: 'auto',
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
        is_reversal: false,
        matching_status: 'auto',
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
          is_reversal: false,
          matching_status: 'unmatched',
          source_notes: 'No matching open trade found — outside query window',
        };
        logicalTrades.push(orphan);
      } else {
        // FIFO cascade
        const originalClosingQty = closingQty;
        while (closingQty > 0 && opens.length > 0) {
          const oldest = opens[0];
          const available = oldest.remaining_quantity;
          const used = Math.min(closingQty, available);
          const pnlPortion = totalPnl * (used / originalClosingQty);

          oldest.remaining_quantity -= used;
          oldest.total_closing_quantity = (oldest.total_closing_quantity || 0) + used;
          oldest.total_realized_pnl = (oldest.total_realized_pnl || 0) + pnlPortion;
          oldest.closed_at = parseDateTime(firstTrade.date_time);
          closingQty -= used;

          if (oldest.remaining_quantity <= 0) {
            oldest.status = 'closed';
            oldest.remaining_quantity = 0;
            opens.shift();
          }
        }
      }
    }
  }

  // Clean up temp IDs before returning
  return logicalTrades.map(({ _tempId, ...trade }) => trade);
}
