import React, { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api";

type RaceDayInfo = {
  raceDayId: string;
  name: string;
  status: string;
};

type HotWalletInfo = {
  address: string | null;
  balance: {
    amount: string;
    displayAmount: string;
    ticker: string;
  } | null;
  error?: string;
};

type CreateRaceDayForm = {
  name: string;
  poolCredits: number;
  pickWindowSecs: number;
  bufferSecs: number;
};

const defaultForm: CreateRaceDayForm = {
  name: `RaceDay ${new Date().toLocaleDateString()}`,
  poolCredits: 5,
  pickWindowSecs: 900,
  bufferSecs: 30
};

export default function Admin() {
  const [adminKey, setAdminKey] = useState(() => localStorage.getItem("adminKey") || "");
  const [racedays, setRacedays] = useState<RaceDayInfo[]>([]);
  const [hotWallet, setHotWallet] = useState<HotWalletInfo | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState<CreateRaceDayForm>({ ...defaultForm });

  const showMessage = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 5000);
  };

  const saveAdminKey = () => {
    localStorage.setItem("adminKey", adminKey);
    showMessage("Admin key saved");
  };

  const fetchData = async () => {
    try {
      const racedaysRes = await apiGet<{ racedays: RaceDayInfo[] }>("/api/racedays/list");
      setRacedays(racedaysRes?.racedays ?? []);
    } catch {
      showMessage("Failed to fetch data");
    }
  };

  const fetchHotWallet = async () => {
    if (!adminKey) return;
    try {
      const res = await fetch("/api/admin/hot-wallet", {
        headers: { "X-Admin-Key": adminKey }
      });
      if (res.ok) {
        const data = await res.json();
        setHotWallet(data);
      }
    } catch {
      // Silently fail - wallet info is optional
    }
  };

  useEffect(() => {
    fetchData();
    fetchHotWallet();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchHotWallet();
  }, [adminKey]);

  const adminFetch = async (url: string, method: string, body?: object) => {
    setLoading(true);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": adminKey
        },
        body: body ? JSON.stringify(body) : undefined
      });
      const data = await res.json();
      if (!res.ok) {
        showMessage(`Error: ${data.error || res.statusText}`);
      } else {
        showMessage("Success");
        await fetchData();
      }
    } catch (err) {
      showMessage(`Error: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const adminPost = (url: string, body?: object) => adminFetch(url, "POST", body);
  const adminDelete = (url: string) => adminFetch(url, "DELETE");

  const resetRaceday = (id: string) => adminPost(`/api/racedays/${id}/reset`);
  const completeRaceday = (id: string) => adminPost(`/api/racedays/${id}/cancel`);
  const startRaceday = (id: string) => adminPost(`/api/racedays/${id}/start`);
  const createRaceday = async () => {
    await adminPost("/api/racedays/create", {
      name: createForm.name,
      poolCredits: createForm.poolCredits,
      pickWindowSecs: createForm.pickWindowSecs,
      bufferSecs: createForm.bufferSecs
    });
    setShowCreateForm(false);
    setCreateForm({ ...defaultForm, name: `RaceDay ${new Date().toLocaleDateString()}` });
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      <h1 className="font-display text-4xl uppercase tracking-[0.1em] text-midnight">Admin</h1>

      {message && (
        <div className="rounded-xl bg-accent2/20 px-4 py-3 text-accent2 font-semibold">
          {message}
        </div>
      )}

      {/* Admin Key */}
      <section className="surface rounded-2xl p-4">
        <h2 className="text-sm uppercase tracking-[0.2em] text-slate mb-3">Admin Key</h2>
        <div className="flex gap-2">
          <input
            type="password"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            placeholder="Enter admin key..."
            className="flex-1 rounded-lg border border-midnight/20 bg-panel px-3 py-2 text-ink"
          />
          <button
            onClick={saveAdminKey}
            className="rounded-lg bg-midnight px-4 py-2 text-sm font-semibold text-white"
          >
            Save
          </button>
        </div>
      </section>

      {/* Hot Wallet Balance */}
      <section className="surface rounded-2xl p-4">
        <h2 className="text-sm uppercase tracking-[0.2em] text-slate mb-3">Hot Wallet (Rewards)</h2>
        {hotWallet ? (
          <div className="flex flex-col gap-2">
            {hotWallet.address ? (
              <>
                <p className="font-mono text-xs text-slate break-all">{hotWallet.address}</p>
                {hotWallet.balance ? (
                  <p className="text-2xl font-bold text-accent">
                    {hotWallet.balance.displayAmount} {hotWallet.balance.ticker}
                  </p>
                ) : (
                  <p className="text-warning">{hotWallet.error || "Balance unavailable"}</p>
                )}
              </>
            ) : (
              <p className="text-slate">Hot wallet not configured</p>
            )}
          </div>
        ) : (
          <p className="text-slate">Enter admin key to view wallet</p>
        )}
      </section>

      {/* RaceDays */}
      <section className="surface rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm uppercase tracking-[0.2em] text-slate">RaceDays</h2>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            disabled={loading}
            className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
              showCreateForm
                ? "bg-slate/20 text-slate"
                : "bg-accent2 text-white"
            }`}
          >
            {showCreateForm ? "Cancel" : "New RaceDay"}
          </button>
        </div>

        {/* Create RaceDay Form */}
        {showCreateForm && (
          <div className="mb-4 rounded-xl bg-panel/50 p-4 border border-midnight/10">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="md:col-span-2">
                <label className="block text-xs uppercase tracking-wider text-slate mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  className="w-full rounded-lg border border-midnight/20 bg-white px-3 py-2 text-ink"
                  placeholder="RaceDay Name (e.g., Holiday Special)"
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate mb-1">
                  ARKEO Reward Pool
                </label>
                <input
                  type="number"
                  value={createForm.poolCredits}
                  onChange={(e) => setCreateForm({ ...createForm, poolCredits: parseInt(e.target.value) || 5 })}
                  min={1}
                  max={10000}
                  className="w-full rounded-lg border border-midnight/20 bg-white px-3 py-2 text-ink"
                />
                <p className="text-xs text-slate mt-1">Total ARKEO to distribute</p>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate mb-1">
                  Pick Window (seconds)
                </label>
                <input
                  type="number"
                  value={createForm.pickWindowSecs}
                  onChange={(e) => setCreateForm({ ...createForm, pickWindowSecs: parseInt(e.target.value) || 900 })}
                  min={5}
                  max={900}
                  className="w-full rounded-lg border border-midnight/20 bg-white px-3 py-2 text-ink"
                />
                <p className="text-xs text-slate mt-1">{Math.floor(createForm.pickWindowSecs / 60)}m {createForm.pickWindowSecs % 60}s</p>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate mb-1">
                  Buffer Between Heats (seconds)
                </label>
                <input
                  type="number"
                  value={createForm.bufferSecs}
                  onChange={(e) => setCreateForm({ ...createForm, bufferSecs: parseInt(e.target.value) || 30 })}
                  min={0}
                  max={120}
                  className="w-full rounded-lg border border-midnight/20 bg-white px-3 py-2 text-ink"
                />
              </div>
            </div>
            <button
              onClick={createRaceday}
              disabled={loading || !createForm.name}
              className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Create RaceDay
            </button>
          </div>
        )}
        {racedays.length === 0 ? (
          <p className="text-slate">No racedays</p>
        ) : (
          <div className="flex flex-col gap-2">
            {racedays.map((rd) => (
              <div
                key={rd.raceDayId}
                className="flex items-center justify-between rounded-xl bg-panel/50 px-4 py-3"
              >
                <div>
                  <p className="font-semibold text-ink">{rd.name}</p>
                  <p className="text-xs text-slate font-mono">{rd.raceDayId}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${
                      rd.status === "running"
                        ? "bg-accent/20 text-accent"
                        : rd.status === "complete"
                        ? "bg-green-600/20 text-green-600"
                        : rd.status === "scheduled"
                        ? "bg-midnight/10 text-midnight"
                        : "bg-slate/20 text-slate"
                    }`}
                  >
                    {rd.status}
                  </span>
                  {rd.status === "scheduled" && (
                    <button
                      onClick={() => startRaceday(rd.raceDayId)}
                      disabled={loading}
                      className="rounded-lg bg-accent2 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      Start
                    </button>
                  )}
                  {(rd.status === "running" || rd.status === "picking" || rd.status === "polling") && (
                    <>
                      <button
                        onClick={() => resetRaceday(rd.raceDayId)}
                        disabled={loading}
                        className="rounded-lg bg-warning px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        Reset
                      </button>
                      <button
                        onClick={() => completeRaceday(rd.raceDayId)}
                        disabled={loading}
                        className="rounded-lg bg-warning px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        Complete
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

    </div>
  );
}
