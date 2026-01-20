import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { queryClient } from "./queryClient";
import Lobby from "./pages/Lobby";
import Race from "./pages/Race";
import RaceDay from "./pages/RaceDay";
import Admin from "./pages/Admin";
import HorseSilhouette from "./components/HorseSilhouette";
import SelectionBanner from "./components/SelectionBanner";
import RaceNotification from "./components/RaceNotification";
import QuickstartModal from "./components/QuickstartModal";
import PersistentChat from "./components/PersistentChat";
import { LockedSelectionProvider, useLockedSelection } from "./hooks/useLockedSelection";
import { useCurrentRace } from "./queries";
import { SoundProvider, useSound } from "./hooks";
import "./index.css";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm font-bold uppercase tracking-[0.2em] ${isActive ? "text-accent" : "text-midnight/70"}`;

function AppLayout() {
  const location = useLocation();
  const { lockedHorse, raceId: lockedRaceId } = useLockedSelection();
  const { displayRace } = useCurrentRace();
  const raceId = displayRace?.raceId ?? lockedRaceId;
  const { soundEnabled, toggleSound } = useSound();
  const [showQuickstart, setShowQuickstart] = React.useState(false);

  const quickstartKey = "arkeo.quickstart.dismissed";
  const hideQuickstart = () => setShowQuickstart(false);
  const dismissQuickstart = () => {
    localStorage.setItem(quickstartKey, "1");
    setShowQuickstart(false);
  };

  React.useEffect(() => {
    const dismissed = localStorage.getItem(quickstartKey) === "1";
    if (!dismissed) {
      setShowQuickstart(true);
    }
  }, []);

  const allowQuickstart = location.pathname !== "/admin";

  return (
    <div className="min-h-screen">
      <QuickstartModal
        open={showQuickstart && allowQuickstart}
        onClose={hideQuickstart}
        onDontShowAgain={dismissQuickstart}
      />
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 pt-6 md:px-12">
        <header>
          <div className="flex flex-col gap-4 rounded-2xl bg-white/50 p-4 backdrop-blur-sm md:flex-row md:items-center md:justify-between md:bg-transparent md:backdrop-blur-none">
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-center gap-0">
                <div className="mt-2 flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-midnight/10 bg-panel shadow-sm" style={{ transform: "translate(-6px, 2px)" }}>
                  <img
                    src="/resources/arkeo/info/logo.png"
                    alt="Arkeo"
                    className="h-full w-full object-cover"
                  />
                </div>
                <HorseSilhouette
                  width={68}
                  height={68}
                  className="drop-shadow-sm"
                  style={{ color: "#1E1E1E", transform: "translateY(-16px)" }}
                />
              </div>
              <div>
                <p className="font-display text-2xl md:text-4xl uppercase tracking-[0.2em] text-midnight">
                  Arkeo Idle Racing
                </p>
                <p className="text-[10px] md:text-xs uppercase tracking-[0.25em] text-slate">
                  Competitive Provider & Subscriber Testing
                </p>
              </div>
            </div>
            <nav className="flex items-center justify-center gap-4 md:justify-start md:gap-6">
              <NavLink to="/" className={navLinkClass}>
                Lobby
              </NavLink>
              <NavLink to="/race" className={navLinkClass}>
                Race
              </NavLink>
              <NavLink to="/raceday" className={navLinkClass}>
                RaceDay
              </NavLink>
              <button
                type="button"
                onClick={toggleSound}
                aria-pressed={soundEnabled}
                className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] transition ${
                  soundEnabled ? "bg-accent text-white" : "bg-ink/10 text-ink"
                }`}
              >
                {soundEnabled ? "Sound On" : "Sound Off"}
              </button>
            </nav>
          </div>
        </header>

        <main className="flex flex-col gap-6 pb-16">
          <RaceNotification />
          <Routes>
            <Route path="/" element={<Lobby />} />
            <Route path="/race" element={<Race />} />
            <Route path="/raceday" element={<RaceDay />} />
            <Route path="/admin" element={<Admin />} />
          </Routes>
          <SelectionBanner
            horse={lockedHorse}
            jerseyColor={lockedHorse?.jerseyColor}
            raceId={raceId}
          />
        </main>
      </div>
      {location.pathname !== "/admin" && <PersistentChat />}
    </div>
  );
}

function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <LockedSelectionProvider>
        <SoundProvider>
          <AppLayout />
        </SoundProvider>
      </LockedSelectionProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
