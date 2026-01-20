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

type StatusFilter = "all" | "active" | "complete" | "canceled";
const ITEMS_PER_PAGE = 10;

export default function Admin() {
  const [adminKey, setAdminKey] = useState(() => localStorage.getItem("adminKey") || "");
  const [racedays, setRacedays] = useState<RaceDayInfo[]>([]);
  const [hotWallet, setHotWallet] = useState<HotWalletInfo | null>(null);
  const [adminStatus, setAdminStatus] = useState<"unknown" | "valid" | "invalid">("unknown");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState<CreateRaceDayForm>({ ...defaultForm });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);

  const showMessage = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 5000);
  };

  // Filter racedays by status
  const filteredRacedays = racedays.filter((rd) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "active") return !["canceled", "complete"].includes(rd.status);
    if (statusFilter === "complete") return rd.status === "complete";
    if (statusFilter === "canceled") return rd.status === "canceled";
    return true;
  });

  // Pagination
  const totalPages = Math.ceil(filteredRacedays.length / ITEMS_PER_PAGE);
  const paginatedRacedays = filteredRacedays.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  // Reset page when filter changes
  const handleFilterChange = (filter: StatusFilter) => {
    setStatusFilter(filter);
    setCurrentPage(1);
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
    if (!adminKey) {
      setHotWallet(null);
      setAdminStatus("unknown");
      return;
    }
    try {
      const res = await fetch("/api/admin/hot-wallet", {
        headers: { "X-Admin-Key": adminKey }
      });
      if (res.ok) {
        const data = await res.json();
        setHotWallet(data);
        setAdminStatus("valid");
      } else {
        setHotWallet(null);
        setAdminStatus("invalid");
      }
    } catch {
      setHotWallet(null);
      setAdminStatus("invalid");
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
  const cancelRaceday = (id: string) => adminPost(`/api/racedays/${id}/cancel`);
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
    <div className="flex flex-col gap-6">
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

      {adminStatus === "valid" ? (
        <>
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
            {(() => {
              // Block creation when any raceday is active (not canceled or complete)
              const activeRaceday = racedays.find((rd) =>
                !["canceled", "complete"].includes(rd.status)
              );
              const canCreate = !activeRaceday;
              return (
                <div className="flex flex-col gap-3 mb-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm uppercase tracking-[0.2em] text-slate">RaceDays</h2>
                    <div className="flex items-center gap-2">
                      {activeRaceday && (
                        <span className="text-xs text-warning">Event in progress</span>
                      )}
                      <button
                        onClick={() => setShowCreateForm(!showCreateForm)}
                        disabled={loading || !canCreate}
                        className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
                          showCreateForm
                            ? "bg-slate/20 text-slate"
                            : "bg-accent2 text-white"
                        }`}
                      >
                        {showCreateForm ? "Cancel" : "New RaceDay"}
                      </button>
                    </div>
                  </div>
                  {/* Filter buttons */}
                  <div className="flex gap-2">
                    {(["all", "active", "complete", "canceled"] as StatusFilter[]).map((filter) => (
                      <button
                        key={filter}
                        onClick={() => handleFilterChange(filter)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
                          statusFilter === filter
                            ? "bg-midnight text-white"
                            : "bg-midnight/10 text-midnight hover:bg-midnight/20"
                        }`}
                      >
                        {filter}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

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
            {filteredRacedays.length === 0 ? (
              <p className="text-slate">No racedays {statusFilter !== "all" ? `with status "${statusFilter}"` : ""}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {paginatedRacedays.map((rd) => (
                  <div
                    key={rd.raceDayId}
                    className="flex items-center justify-between gap-6 rounded-xl bg-panel px-5 py-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">{rd.name}</p>
                      <p className="text-xs text-slate font-mono truncate">{rd.raceDayId}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${
                          rd.status === "running"
                            ? "bg-accent/20 text-accent"
                            : rd.status === "complete"
                            ? "bg-green-600/20 text-green-600"
                            : rd.status === "canceled"
                            ? "bg-warning/20 text-warning"
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
                          Start Event
                        </button>
                      )}
                      {(rd.status === "running" || rd.status === "picking" || rd.status === "polling") && (
                        <>
                          <button
                            onClick={() => resetRaceday(rd.raceDayId)}
                            disabled={loading}
                            className="rounded-lg bg-orange-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            Reset Event
                          </button>
                          <button
                            onClick={() => cancelRaceday(rd.raceDayId)}
                            disabled={loading}
                            className="rounded-lg bg-orange-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            Cancel Event
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-4 border-t border-midnight/10">
                    <p className="text-xs text-slate">
                      Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1}-{Math.min(currentPage * ITEMS_PER_PAGE, filteredRacedays.length)} of {filteredRacedays.length}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="rounded-lg bg-midnight/10 px-3 py-1.5 text-xs font-semibold text-midnight disabled:opacity-50"
                      >
                        Previous
                      </button>
                      <span className="flex items-center px-3 text-xs text-slate">
                        Page {currentPage} of {totalPages}
                      </span>
                      <button
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="rounded-lg bg-midnight/10 px-3 py-1.5 text-xs font-semibold text-midnight disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="surface rounded-2xl p-4">
          <p className="text-sm text-slate">
            {adminStatus === "invalid"
              ? "Admin key is invalid. Enter a valid key to unlock controls."
              : "Enter an admin key to unlock controls."}
          </p>
        </section>
      )}

    </div>
  );
}
