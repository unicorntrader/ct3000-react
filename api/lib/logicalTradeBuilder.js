'use strict';

/**
 * buildLogicalTrades (CommonJS — server-side version)
 * Input: array of raw trades from the `trades` table (sorted by date_time ASC)
 * Output: array of logical trade objects ready to insert into `logical_trades`
 */
function buildLogicalTrades(rawTrades, userId) {
  const sorted = [...rawTrades].sort((a, b) => {
    const toMs = (dt) => {
      if (!dt) return 0;
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
        matching_status: 'auto',
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
        matching_status: 'auto',
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
          matching_status: 'unmatched',
          planned_trade_id: null,
          source_notes: 'No matching open trade found — outside query window',
        };
        logicalTrades.push(orphan);
      } else {
        const originalClosingQty = closingQty;
        const closingFxRate = weightedAvgFxRate(group);
        while (closingQty > 0 && opens.length > 0) {
          const oldest = opens[0];
          const available = oldest.remaining_quantity;
          const used = Math.min(closingQty, available);
          const pnlPortion = totalPnl * (used / originalClosingQty);

          oldest.remaining_quantity -= used;
          oldest.total_closing_quantity = (oldest.total_closing_quantity || 0) + used;
          oldest.total_realized_pnl = (oldest.total_realized_pnl || 0) + pnlPortion;
          oldest.fx_rate_to_base = closingFxRate;
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

  return logicalTrades;
}

module.exports = { buildLogicalTrades };
