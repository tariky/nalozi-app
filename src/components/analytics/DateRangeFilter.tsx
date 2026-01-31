import { useState } from "react";
import { format } from "date-fns";
import { bs } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DateRangeFilterProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}

export function DateRangeFilter({ from, to, onChange }: DateRangeFilterProps) {
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);

  const fromDate = from ? new Date(from) : undefined;
  const toDate = to ? new Date(to) : undefined;

  const handleFromSelect = (date: Date | undefined) => {
    if (date) {
      onChange(format(date, "yyyy-MM-dd"), to);
      setFromOpen(false);
    }
  };

  const handleToSelect = (date: Date | undefined) => {
    if (date) {
      onChange(from, format(date, "yyyy-MM-dd"));
      setToOpen(false);
    }
  };

  // Quick presets
  const setPreset = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    onChange(format(start, "yyyy-MM-dd"), format(end, "yyyy-MM-dd"));
  };

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
      {/* Date Pickers */}
      <div className="flex items-center gap-2">
        <Popover open={fromOpen} onOpenChange={setFromOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-[140px] justify-start text-left font-normal",
                !from && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {fromDate ? format(fromDate, "dd.MM.yyyy") : "Od datuma"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={fromDate}
              onSelect={handleFromSelect}
              initialFocus
              locale={bs}
            />
          </PopoverContent>
        </Popover>

        <span className="text-muted-foreground">—</span>

        <Popover open={toOpen} onOpenChange={setToOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-[140px] justify-start text-left font-normal",
                !to && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {toDate ? format(toDate, "dd.MM.yyyy") : "Do datuma"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={toDate}
              onSelect={handleToSelect}
              initialFocus
              locale={bs}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Quick Presets */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPreset(7)}
          className="text-xs h-8"
        >
          7 dana
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPreset(30)}
          className="text-xs h-8"
        >
          30 dana
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPreset(90)}
          className="text-xs h-8"
        >
          90 dana
        </Button>
      </div>
    </div>
  );
}
