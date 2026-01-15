import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface DateRangeFilterProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}

export function DateRangeFilter({ from, to, onChange }: DateRangeFilterProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
      <div className="flex-1 sm:flex-initial">
        <Label htmlFor="from" className="text-xs sm:text-sm text-gray-500 mb-1 block">
          Od datuma
        </Label>
        <Input
          id="from"
          type="date"
          value={from}
          onChange={(e) => onChange(e.target.value, to)}
          className="w-full sm:w-36"
        />
      </div>
      <div className="flex-1 sm:flex-initial">
        <Label htmlFor="to" className="text-xs sm:text-sm text-gray-500 mb-1 block">
          Do datuma
        </Label>
        <Input
          id="to"
          type="date"
          value={to}
          onChange={(e) => onChange(from, e.target.value)}
          className="w-full sm:w-36"
        />
      </div>
    </div>
  );
}
