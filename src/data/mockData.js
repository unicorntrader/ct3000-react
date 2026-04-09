export const openPositions = [
  { symbol: 'AAPL', direction: 'Long', qty: 100, days: 12, pnl: '+$1,240', avg: '$178.20', positive: true },
  { symbol: 'MSFT', direction: 'Long', qty: 50, days: 3, pnl: '+$610', avg: '$412.50', positive: true },
  { symbol: 'TSLA', direction: 'Short', qty: 30, days: 1, pnl: '-$180', avg: '$242.10', positive: false },
];

export const activePlans = [
  { symbol: 'AMZN', direction: 'long', entry: '$182.00', target: '$195.00', stop: '$178.00', thesis: 'Breakout above key resistance. AWS growth reacceleration thesis.' },
  { symbol: 'GS', direction: 'short', entry: '$520.00', target: '$500.00', stop: '$530.00', thesis: 'Overextended on IB weakness. Rate sensitivity play.' },
];

export const plans = [
  { symbol: 'AMZN', direction: 'long', status: 'planned', date: 'Apr 6, 2026', shares: 30, rr: '3.25', entry: '$182.00', target: '$195.00', stop: '$178.00', risk: '-$120', reward: '+$390', thesis: 'Breakout above key resistance. AWS growth reacceleration thesis.' },
  { symbol: 'GS', direction: 'short', status: 'planned', date: 'Apr 7, 2026', shares: 20, rr: '2.00', entry: '$520.00', target: '$500.00', stop: '$530.00', risk: '-$200', reward: '+$400', thesis: 'Overextended on IB weakness. Rate sensitivity play.' },
  { symbol: 'AAPL', direction: 'long', status: 'matched', date: 'Mar 26, 2026', shares: 100, rr: '2.00', entry: '$175.00', target: '$185.00', stop: '$170.00', risk: '-$500', reward: '+$1,000', thesis: 'Services revenue resilience. Momentum continuation above key level.' },
];

export const dailyDays = [
  {
    id: 'jul26',
    date: 'Saturday, July 26, 2025',
    trades: 5,
    wins: 3,
    losses: 2,
    pnl: '+$970',
    positive: true,
    needsReview: 2,
    note: null,
    rows: [
      { time: '06:45 PM', symbol: 'SPY', entry: '$455.25', exit: '$458.75', qty: 100, pnl: '+$350', positive: true, status: 'matched' },
      { time: '05:30 PM', symbol: 'TSLA', entry: '$248', exit: '$242', qty: 50, pnl: '-$300', positive: false, status: 'unmatched', resolveId: 'tsla' },
      { time: '02:20 PM', symbol: 'NVDA', entry: '$445', exit: '$460', qty: 25, pnl: '+$375', positive: true, status: 'matched' },
      { time: '01:15 PM', symbol: 'MSFT', entry: '$420', exit: '$415.5', qty: 50, pnl: '-$225', positive: false, status: 'matched' },
      { time: '12:35 PM', symbol: 'AAPL', entry: '$175.5', exit: '$183.2', qty: 100, pnl: '+$770', positive: true, status: 'ambiguous', resolveId: 'aapl' },
    ],
  },
  {
    id: 'jul25',
    date: 'Friday, July 25, 2025',
    trades: 6,
    wins: 4,
    losses: 2,
    pnl: '+$373',
    positive: true,
    needsReview: 0,
    note: 'Heavy trading day - 6 trades! Started well with AAPL but got whipsawed on the second entry. META and GOOGL performed well. QQQ stop loss hit was painful but protected capital. Ended positive despite the loss.',
    rows: [
      { time: '06:30 PM', symbol: 'TSLA', entry: '$252', exit: '$259', qty: 50, pnl: '+$350', positive: true, status: 'matched' },
      { time: '03:10 PM', symbol: 'QQQ', entry: '$375', exit: '$371.5', qty: 150, pnl: '-$525', positive: false, status: 'matched' },
      { time: '02:20 PM', symbol: 'GOOGL', entry: '$134.75', exit: '$138.25', qty: 75, pnl: '+$262', positive: true, status: 'matched' },
      { time: '12:15 PM', symbol: 'META', entry: '$318.5', exit: '$325', qty: 30, pnl: '+$195', positive: true, status: 'matched' },
    ],
  },
];

export const journalTrades = [
  { date: 'Mar 10', symbol: 'AAPL', tags: ['Breakout', 'NY-Open'], pnl: '+$780', r: '2.4R', outcome: 'win', adherence: 84, plan: 'matched' },
  { date: 'Mar 14', symbol: 'NVDA', tags: ['Momentum', 'AI Play'], pnl: '+$1,688', r: '5.6R', outcome: 'win', adherence: 91, plan: 'matched' },
  { date: 'Mar 21', symbol: 'COIN', tags: ['Impulse'], pnl: '-$858', r: '-2.8R', outcome: 'loss', adherence: null, plan: 'unmatched' },
  { date: 'Feb 20', symbol: 'AMD', tags: ['Semiconductors'], pnl: '-$496', r: '-1.5R', outcome: 'loss', adherence: 72, plan: 'matched' },
];

export const reviewTrades = [
  {
    step: 1,
    symbol: 'NVDA',
    type: 'unmatched',
    direction: 'Long',
    pnl: '-$858',
    positive: false,
    entry: '$445.20',
    exit: '$427.98',
    qty: '50 shares',
    candidates: [
      { label: 'NVDA -- Long - Momentum', sub: 'Created Mar 20 - Entry $440 - 50 shares', value: 'p1' },
      { label: 'NVDA -- Long - Breakout', sub: 'Created Mar 18 - Entry $430 - 40 shares', value: 'p2' },
      { label: 'No plan -- mark as unplanned', sub: 'Discretionary trade', value: 'none', danger: true },
    ],
  },
  {
    step: 2,
    symbol: 'AAPL',
    type: 'ambiguous',
    direction: 'Long',
    pnl: '+$780',
    positive: true,
    entry: '$175.50',
    exit: '$183.30',
    duration: '2 days',
    note: '2 plans matched -- which one is it?',
    candidates: [
      { label: 'AAPL -- Long - Support', sub: 'Created Mar 19 - Entry $174 - 100 shares', value: 'p1' },
      { label: 'AAPL -- Long - Breakout', sub: 'Created Mar 20 - Entry $176 - 80 shares', value: 'p2' },
    ],
  },
  {
    step: 3,
    symbol: 'GRG',
    type: 'unmatched',
    direction: 'Long',
    pnl: '-GBP112',
    positive: false,
    entry: 'GBP17.03',
    status: 'Open',
    currency: 'GBP',
    note: 'No plans found for GRG.',
    candidates: [
      { label: 'Mark as unplanned', sub: 'Acknowledge discretionary trade', value: 'unplanned', danger: true },
      { label: 'Create plan retroactively', sub: 'Document the reasoning after the fact', value: 'retro' },
    ],
  },
];

export const insightCards = [
  { color: 'red', title: 'Revenge trading detected', body: '3 trades after loss streaks show 33% win rate. Average loss after streak: -$900.', action: 'Take 30-min break after any loss' },
  { color: 'green', title: 'Morning session dominance', body: 'NY-Open trades (9-11am) show 71% win rate vs 48% midday.', action: 'Focus 70% of trading in morning session' },
  { color: 'red', title: 'Large position underperformance', body: 'Positions over 100 shares: 44% win rate vs 68% for smaller sizes.', action: 'Cut max position size by 30%' },
  { color: 'green', title: 'Pre-market planning edge', body: 'Planned trades average +$480 vs unplanned -$215.', action: 'Plan every trade before market open' },
  { color: 'blue', title: 'NVDA specialization', body: 'NVDA: 78% win rate across 9 trades, +$4,200 total P&L.', action: 'Increase NVDA allocation on setups' },
];

export const strategies = [
  { group: 'Timeframe', options: ['Day Trade', 'Swing', 'Position'] },
  { group: 'Setup', options: ['Breakout', 'Support', 'Resistance', 'Momentum'] },
  { group: 'Thesis-driven', options: ['Value', 'Fundamental', 'Macro', 'Catalyst'] },
];
