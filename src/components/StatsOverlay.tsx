import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface SessionRow {
  created_at: string;
  completed: boolean;
}

interface DayCount {
  label: string;
  count: number;
}

function getLastSevenDays(data: SessionRow[]): DayCount[] {
  const days: DayCount[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toDateString();
    const label = d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
    const count = data.filter(s => new Date(s.created_at).toDateString() === key).length;
    days.push({ label, count });
  }
  return days;
}

interface Props {
  onClose: () => void;
}

export function StatsOverlay({ onClose }: Props) {
  const [loading, setLoading]   = useState(true);
  const [error,   setError]     = useState<string | null>(null);
  const [total,   setTotal]     = useState(0);
  const [today,   setToday]     = useState(0);
  const [days,    setDays]      = useState<DayCount[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const { data, error: err } = await supabase
          .from('sessions')
          .select('created_at, completed');
        if (err) throw err;
        const rows = (data ?? []) as SessionRow[];
        const todayStr = new Date().toDateString();
        setTotal(rows.length);
        setToday(rows.filter(s => new Date(s.created_at).toDateString() === todayStr).length);
        setDays(getLastSevenDays(rows));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to load stats');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const maxCount = Math.max(...days.map(d => d.count), 1);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 fade-in"
      onClick={onClose}
    >
      <div
        className="game-panel w-full max-w-sm p-6 relative"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-pixel text-xs text-primary game-text-shadow">📊 STATS</h2>
          <button
            onClick={onClose}
            className="font-body text-muted-foreground hover:text-foreground text-lg leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {loading && (
          <p className="font-body text-sm text-muted-foreground text-center py-6">Loading…</p>
        )}

        {error && (
          <p className="font-body text-sm text-destructive text-center py-6">{error}</p>
        )}

        {!loading && !error && (
          <>
            {/* Summary row */}
            <div className="flex gap-3 mb-6">
              <div className="flex-1 bg-muted rounded-lg p-3 text-center">
                <p className="font-pixel text-lg text-primary">{total}</p>
                <p className="font-body text-xs text-muted-foreground mt-1">Total</p>
              </div>
              <div className="flex-1 bg-muted rounded-lg p-3 text-center">
                <p className="font-pixel text-lg text-secondary">{today}</p>
                <p className="font-body text-xs text-muted-foreground mt-1">Today</p>
              </div>
            </div>

            {/* Last 7 days */}
            <p className="font-pixel text-[9px] text-muted-foreground mb-3">LAST 7 DAYS</p>
            <div className="space-y-2">
              {days.map(({ label, count }) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="font-body text-xs text-foreground w-28 shrink-0">{label}</span>
                  <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-500"
                      style={{ width: `${(count / maxCount) * 100}%` }}
                    />
                  </div>
                  <span className="font-pixel text-xs text-primary w-5 text-right">{count}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
