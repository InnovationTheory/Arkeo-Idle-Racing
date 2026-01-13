import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { queryClient } from "./queryClient";
import Lobby from "./pages/Lobby";
import Race from "./pages/Race";
import RaceDay from "./pages/RaceDay";
import Admin from "./pages/Admin";
import HorseSilhouette from "./components/HorseSilhouette";
import SelectionBanner from "./components/SelectionBanner";
import { LockedSelectionProvider, useLockedSelection } from "./hooks/useLockedSelection";
import { useCurrentRace } from "./queries";
import "./index.css";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm font-bold uppercase tracking-[0.2em] ${isActive ? "text-accent" : "text-midnight/70"}`;

function AppLayout() {
  const { lockedHorse, raceId: lockedRaceId } = useLockedSelection();
  const { displayRace } = useCurrentRace();
  const raceId = displayRace?.raceId ?? lockedRaceId;

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-6xl px-6 md:px-12">
        <header className="py-4">
          <div className="flex items-center justify-between">
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
                <p className="font-display text-4xl uppercase tracking-[0.2em] text-midnight">
                  Arkeo Idle Racing
                </p>
                <p className="text-xs uppercase tracking-[0.25em] text-slate">
                  Competitive Provider & Subscriber Testing
                </p>
              </div>
            </div>
            <nav className="flex gap-6">
              <NavLink to="/" className={navLinkClass}>
                Lobby
              </NavLink>
              <NavLink to="/race" className={navLinkClass}>
                Race
              </NavLink>
              <NavLink to="/raceday" className={navLinkClass}>
                RaceDay
              </NavLink>
            </nav>
          </div>
        </header>

        <main className="flex flex-col gap-7 pb-12">
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
    </div>
  );
}

function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <LockedSelectionProvider>
        <AppLayout />
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
