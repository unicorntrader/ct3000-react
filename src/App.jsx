import React, { useState } from 'react';
import Header from './components/Header';
import MobileNav from './components/MobileNav';
import Sidebar from './components/Sidebar';
import ReviewSheet from './components/ReviewSheet';
import PlanSheet from './components/PlanSheet';
import HomeScreen from './screens/HomeScreen';
import PlansScreen from './screens/PlansScreen';
import DailyViewScreen from './screens/DailyViewScreen';
import JournalScreen from './screens/JournalScreen';
import PerformanceScreen from './screens/PerformanceScreen';
import IBKRScreen from './screens/IBKRScreen';

export default function App() {
  const [activeTab, setActiveTab] = useState('home');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [reviewDismissed, setReviewDismissed] = useState(false);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setSidebarOpen(false);
  };

  const handleReviewComplete = () => {
    setReviewDismissed(true);
    setReviewOpen(false);
  };

  const renderScreen = () => {
    switch (activeTab) {
      case 'home':
        return (
          <HomeScreen
            onTabChange={handleTabChange}
            onReviewOpen={() => setReviewOpen(true)}
            reviewDismissed={reviewDismissed}
          />
        );
      case 'plans':
        return <PlansScreen onNewPlan={() => setPlanOpen(true)} />;
      case 'daily':
        return <DailyViewScreen />;
      case 'sj':
        return <JournalScreen />;
      case 'perf':
        return <PerformanceScreen />;
      case 'ibkr':
        return <IBKRScreen onBack={() => setActiveTab('home')} />;
      default:
        return null;
    }
  };

  return (
    <div className="bg-gray-50 min-h-screen">
      <Header
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onMenuOpen={() => setSidebarOpen(true)}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 md:pb-8">
        {renderScreen()}
      </main>

      <MobileNav activeTab={activeTab} onTabChange={handleTabChange} />

      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onTabChange={handleTabChange}
      />

      <ReviewSheet
        isOpen={reviewOpen}
        onClose={() => setReviewOpen(false)}
        onComplete={handleReviewComplete}
      />

      <PlanSheet
        isOpen={planOpen}
        onClose={() => setPlanOpen(false)}
      />
    </div>
  );
}
