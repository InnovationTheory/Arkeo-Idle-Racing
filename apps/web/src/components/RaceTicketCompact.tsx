import React from "react";
import HorseSilhouette from "./HorseSilhouette";
import JerseyIcon from "./JerseyIcon";
import { serviceIconPath } from "../utils/serviceIcons";
import { horseStyle } from "../utils/horseStyle";
import type { useWalletState } from "../hooks/useWalletState";

type TicketHorse = {
  raceHorseId: string;
  displayName: string;
  odds?: number | null;
  serviceType?: {
    displayName?: string;
    iconKey?: string;
  };
  providerMoniker?: string | null;
  jerseyColor?: string;
  slotNumber?: number;
  slotLabel?: string;
  status?: "pending" | "advancing" | "eliminated" | "winner";
};

function formatOdds(odds: number | null | undefined): string {
  if (odds == null) return "";
  if (odds === 1) return "EVEN";
  if (odds === 1.5) return "3-2";
  return `${odds}-1`;
}

type RaceTicketCompactProps = {
  raceId?: string | null;
  status?: string;
  ticketHorses?: TicketHorse[];
  walletState: ReturnType<typeof useWalletState>;
  estimatedReward?: number;
};

export default function RaceTicketCompact({
  raceId,
  status,
  ticketHorses,
  walletState,
  estimatedReward
}: RaceTicketCompactProps) {
  const {
    walletAddress,
    nickname
  } = walletState;

  const selections = (ticketHorses ?? []).slice(0, 3);

  return (
    <section className="surface relative overflow-hidden rounded-3xl border border-midnight/10 bg-[#FBF6EF] p-4">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-midnight/5" />
      <div className="pointer-events-none absolute left-6 top-0 h-full border-l border-dashed border-midnight/20" />
      <div className="pointer-events-none absolute left-3 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-90 text-[7px] uppercase tracking-[0.35em] text-slate">
        Race Ticket
      </div>

      <div className="relative z-10 flex flex-wrap items-center justify-between gap-4 pl-6">
        <div className="min-w-[220px]">
          <p className="text-[10px] uppercase tracking-[0.3em] text-slate">Race Ticket</p>
          <div className="flex flex-wrap items-center gap-2">
            {!walletAddress ? (
              <h3 className="font-display text-2xl uppercase tracking-[0.1em] text-ink">
                Connect a Wallet
              </h3>
            ) : (
              <h3 className="font-display text-2xl uppercase tracking-[0.1em] text-ink">
                {nickname || "Add Nickname"}
              </h3>
            )}
          </div>
          {typeof estimatedReward === "number" && estimatedReward > 0 && (
            <p className="-mt-1 text-sm font-semibold text-accent2">
              Rewards: {estimatedReward.toFixed(2)} ARKEO
            </p>
          )}
          {raceId && (
            <p className="mt-1 text-[10px] uppercase tracking-[0.3em] text-slate">
              Ticket ID {raceId.slice(0, 8)}
            </p>
          )}
        </div>

        <div className="flex flex-1 items-stretch gap-2">
          {selections.length ? (
            selections.map((horse) => {
              const serviceLabel = horse.serviceType?.displayName ?? "RaceDay";
              const iconKey = horse.serviceType?.iconKey;
              const ticketIcon = iconKey ? serviceIconPath(iconKey) : null;
              const visual = horseStyle(horse.raceHorseId);
              const coatColor = visual.coatColor;
              const providerLabel = horse.providerMoniker?.trim() ?? null;
              const horseStatus = horse.status ?? "pending";
              const showStatusIcon = horseStatus !== "pending";
              const isEliminated = horseStatus === "eliminated";
              const isAdvancing = horseStatus === "advancing" || horseStatus === "winner";
              const borderClass = isEliminated
                ? "border-2 border-warning"
                : isAdvancing
                  ? "border-2 border-accent2"
                  : "border border-midnight/10";
              return (
                <div
                  key={horse.raceHorseId}
                  className={`relative flex flex-1 items-center gap-2 rounded-2xl bg-panel/80 px-3 py-3 ${borderClass}`}
                >
                  <div className={`flex flex-1 items-center gap-2 ${isEliminated ? "grayscale" : ""}`}>
                    <div className="flex flex-col items-center">
                      <div className="relative flex h-14 w-14 shrink-0 items-center justify-center" style={{ marginTop: -4 }}>
                        <HorseSilhouette
                          width={42}
                          height={42}
                          className="drop-shadow-sm"
                          style={{ color: coatColor }}
                        />
                        {ticketIcon && (
                          <div
                            className="absolute z-20 flex items-center justify-center overflow-hidden rounded-full border border-midnight/10 bg-panel shadow-sm"
                            style={{
                              width: 18,
                              height: 18,
                              top: -2,
                              left: "50%",
                              transform: "translateX(-50%) translateX(-2px)"
                            }}
                          >
                            <img
                              src={ticketIcon}
                              alt=""
                              className="h-full w-full rounded-full object-cover"
                            />
                          </div>
                        )}
                        {horse.jerseyColor && (
                          <div
                            className="absolute left-1/2 top-1/2 z-10"
                            style={{ transform: "translate(-50%, -50%) translateX(-2px)" }}
                          >
                            <JerseyIcon
                              seed={horse.raceHorseId}
                              width={12}
                              height={20}
                              shape="square"
                              baseColor={horse.jerseyColor}
                              className="rounded-sm shadow-sm"
                            />
                          </div>
                        )}
                      </div>
                      {(showStatusIcon || horse.slotLabel) && (
                        <div className="flex items-center gap-1">
                          {showStatusIcon && (
                            <div
                              className={`flex h-4 w-4 items-center justify-center rounded-full ${
                                isEliminated ? "bg-warning" : "bg-accent2"
                              }`}
                            >
                              {isEliminated ? (
                                <svg width="8" height="8" viewBox="0 0 12 12" fill="none" className="text-white">
                                  <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                </svg>
                              ) : (
                                <svg width="8" height="8" viewBox="0 0 12 12" fill="none" className="text-white">
                                  <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </div>
                          )}
                          {horse.slotLabel && (
                            <span className="text-[8px] font-semibold uppercase tracking-wide text-slate whitespace-nowrap" style={{ marginTop: 1 }}>
                              {horse.slotLabel.replace(/\n/g, " ")}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-tight text-ink">
                        {horse.displayName}
                        {horse.odds && (
                          <span className="ml-2 text-green-600">{formatOdds(horse.odds)}</span>
                        )}
                      </p>
                      <p className="text-[10px] uppercase tracking-[0.2em] text-slate">
                        {serviceLabel}
                      </p>
                      {providerLabel && (
                        <span className="mt-1 inline-flex rounded-full bg-accent2/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-accent2">
                          {providerLabel}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-sm text-slate">No horses selected yet.</div>
          )}
        </div>

      </div>
    </section>
  );
}
