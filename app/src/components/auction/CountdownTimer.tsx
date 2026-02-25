"use client";

import { useEffect, useState } from "react";

interface CountdownTimerProps {
  endTime: number;
  status: string;
  /** Seconds to add to Date.now() to approximate blockchain time (chain - client). */
  clockOffset?: number;
}

export default function CountdownTimer({ endTime, status, clockOffset = 0 }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState<number>(() =>
    Math.max(0, Math.floor(endTime - (Date.now() / 1000 + clockOffset)))
  );

  useEffect(() => {
    if (status !== "active") return;

    const tick = () => {
      const now = Date.now() / 1000 + clockOffset;
      const remaining = Math.max(0, Math.floor(endTime - now));
      setTimeLeft(remaining);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [endTime, status, clockOffset]);

  if (status !== "active" || timeLeft <= 0) {
    const statusLabel =
      status === "created"
        ? "AWAITING START"
        : status === "settled"
          ? "SETTLED"
          : status === "cancelled"
            ? "CANCELLED"
            : "ENDED";

    const statusColor =
      status === "created"
        ? "text-cream/60"
        : status === "settled"
          ? "text-emerald-400"
          : status === "cancelled"
            ? "text-red-400/70"
            : "text-gold";

    return (
      <div className="flex flex-col items-center" role="timer" aria-live="polite">
        <span className="mb-1 font-sans text-[10px] tracking-[0.25em] text-cream/40 uppercase">
          Auction Status
        </span>
        <span className={`font-serif text-2xl font-bold tracking-wider ${statusColor}`}>
          {statusLabel}
        </span>
      </div>
    );
  }

  const hours = Math.floor(timeLeft / 3600);
  const minutes = Math.floor((timeLeft % 3600) / 60);
  const seconds = timeLeft % 60;

  const pad = (n: number) => n.toString().padStart(2, "0");

  // Color states
  const isUrgent = timeLeft < 60;
  const isWarning = timeLeft < 300;

  let digitColor = "text-cream";
  if (isUrgent) digitColor = "text-red-600";
  else if (isWarning) digitColor = "text-amber-500";

  return (
    <div className="flex flex-col items-center" role="timer" aria-live="polite">
      <span className="mb-2 font-sans text-[10px] tracking-[0.25em] text-cream/40 uppercase">
        Time Remaining
      </span>
      <div
        className={`flex items-baseline gap-1 ${isUrgent ? "animate-timer-pulse" : ""}`}
      >
        <TimeSegment value={pad(hours)} label="h" color={digitColor} />
        <Separator color={digitColor} />
        <TimeSegment value={pad(minutes)} label="m" color={digitColor} />
        <Separator color={digitColor} />
        <TimeSegment value={pad(seconds)} label="s" color={digitColor} />
      </div>

    </div>
  );
}

function TimeSegment({
  value,
  label,
  color,
}: {
  value: string;
  label: string;
  color: string;
}) {
  return (
    <div className="flex items-baseline">
      <span className={`font-sans text-3xl font-semibold tabular-nums ${color}`}>
        {value}
      </span>
      <span className="ml-0.5 font-sans text-[10px] text-cream/30 uppercase">
        {label}
      </span>
    </div>
  );
}

function Separator({ color }: { color: string }) {
  return (
    <span className={`mx-0.5 font-sans text-xl font-light ${color} opacity-40`}>
      :
    </span>
  );
}
