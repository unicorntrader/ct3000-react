# CT3000 Trading Journal

React frontend prototype. All data is currently mock/static — no backend connected yet.

## Deploy to Vercel (recommended)

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) and sign in with GitHub
3. Click **Add New Project** → select this repo
4. Leave all settings as default → click **Deploy**
5. Done — live URL in ~60 seconds

## Project structure

```
src/
  App.jsx                 # Main app, tab routing, global state
  index.js                # React entry point
  index.css               # Global styles + slide-up/slide-right animations
  data/
    mockData.js           # All dummy data in one place (replace with API calls later)
  components/
    Header.jsx            # Desktop nav header
    MobileNav.jsx         # Bottom nav for mobile
    Sidebar.jsx           # Settings slide-right panel
    ReviewSheet.jsx       # Review trades slide-up wizard
    PlanSheet.jsx         # New plan slide-up form
  screens/
    HomeScreen.jsx        # Home tab
    PlansScreen.jsx       # Plans tab
    DailyViewScreen.jsx   # Daily View tab with inline resolve
    JournalScreen.jsx     # Smart Journal tab
    PerformanceScreen.jsx # Performance + Insights tab
    IBKRScreen.jsx        # IBKR connection page
```

## Next steps

- Connect Supabase for database (replace mockData.js with real API calls)
- Add authentication (Supabase Auth)
- Build IBKR sync backend (Node.js cron job on Railway)
