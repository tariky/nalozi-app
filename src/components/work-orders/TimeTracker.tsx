import { useState } from "react";
import { Play, Pause, Trash2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { timeEntriesApi } from "@/lib/api";
import { formatDate } from "@/lib/formatters";
import type { TimeEntry } from "@/types";

interface TimeTrackerProps {
  workOrderId: number;
  mechanicId?: number;
  timeEntries: TimeEntry[];
  onUpdate: () => void;
  isWorkOrderClosed?: boolean;
}

// Calculate total minutes from time entries
function calculateTotalMinutes(entries: TimeEntry[]): number {
  let totalMs = 0;
  for (const entry of entries) {
    const start = new Date(entry.started_at).getTime();
    const end = entry.ended_at ? new Date(entry.ended_at).getTime() : Date.now();
    totalMs += end - start;
  }
  return Math.floor(totalMs / (1000 * 60));
}

// Format time entry duration
function formatEntryDuration(entry: TimeEntry): string {
  const start = new Date(entry.started_at).getTime();
  const end = entry.ended_at ? new Date(entry.ended_at).getTime() : Date.now();
  const minutes = Math.floor((end - start) / (1000 * 60));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

// Format time (HH:mm)
function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString('bs-BA', { hour: '2-digit', minute: '2-digit' });
}

// Format total time for billing (rounded up to 15 min)
function formatBillingTime(totalMinutes: number): string {
  const billingMinutes = Math.ceil(totalMinutes / 15) * 15;
  const hours = Math.floor(billingMinutes / 60);
  const mins = billingMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

export function TimeTracker({ workOrderId, mechanicId, timeEntries, onUpdate, isWorkOrderClosed = false }: TimeTrackerProps) {
  const [loading, setLoading] = useState(false);

  // Check if there's an active (running) entry
  const activeEntry = timeEntries.find(e => !e.ended_at);
  const isRunning = !!activeEntry;

  const totalMinutes = calculateTotalMinutes(timeEntries);
  const billingMinutes = Math.ceil(totalMinutes / 15) * 15;

  const handleStart = async () => {
    setLoading(true);
    await timeEntriesApi.start(workOrderId, mechanicId);
    onUpdate();
    setLoading(false);
  };

  const handleStop = async () => {
    setLoading(true);
    await timeEntriesApi.stop(workOrderId);
    onUpdate();
    setLoading(false);
  };

  const handleDelete = async (entryId: number) => {
    if (confirm("Da li ste sigurni da želite obrisati ovaj unos?")) {
      await timeEntriesApi.delete(workOrderId, entryId);
      onUpdate();
    }
  };

  return (
    <div className="space-y-4">
      {/* Header with Start/Stop and Total */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm text-gray-500">Ukupno vrijeme</div>
          <div className="text-2xl font-bold text-gray-900">
            {formatBillingTime(totalMinutes)}
          </div>
          {totalMinutes !== billingMinutes && (
            <div className="text-xs text-gray-400">
              (stvarno: {Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m)
            </div>
          )}
        </div>

        {!isWorkOrderClosed && (
          <Button
            size="lg"
            variant={isRunning ? "destructive" : "default"}
            onClick={isRunning ? handleStop : handleStart}
            disabled={loading}
            className="gap-2"
          >
            {isRunning ? (
              <>
                <Pause className="h-5 w-5" />
                Pauziraj
              </>
            ) : (
              <>
                <Play className="h-5 w-5" />
                Pokreni
              </>
            )}
          </Button>
        )}
      </div>

      {/* Active entry indicator */}
      {isRunning && activeEntry && (
        <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg border border-green-200">
          <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-sm text-green-700">
            U toku od {formatTime(activeEntry.started_at)}
          </span>
        </div>
      )}

      {/* Time entries list */}
      {timeEntries.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium text-gray-700">Evidencija vremena</div>
          <div className="space-y-1">
            {timeEntries.map((entry) => (
              <div
                key={entry.id}
                className={`flex items-center justify-between p-2 rounded-lg text-sm ${
                  !entry.ended_at ? 'bg-green-50' : 'bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <div>
                    <span className="text-gray-600">{formatDate(entry.started_at)}</span>
                    <span className="mx-2 text-gray-400">
                      {formatTime(entry.started_at)} - {entry.ended_at ? formatTime(entry.ended_at) : '...'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {formatEntryDuration(entry)}
                  </span>
                  {entry.ended_at && !isWorkOrderClosed && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleDelete(entry.id)}
                    >
                      <Trash2 className="h-3 w-3 text-red-500" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {timeEntries.length === 0 && (
        <div className="text-center py-4 text-sm text-gray-500">
          Nema evidentiranog vremena
        </div>
      )}
    </div>
  );
}
