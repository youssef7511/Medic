import { Cross } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export function Brand({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <Link
      href="/"
      className={cn('inline-flex items-center gap-2.5 text-navy-950', className)}
      aria-label="Medic"
    >
      <span className="grid h-10 w-10 place-items-center rounded-2xl bg-brand-500 text-white shadow-sm shadow-brand-500/20">
        <Cross className="h-5 w-5" strokeWidth={3} />
      </span>
      {!compact && <span className="text-2xl font-extrabold tracking-tight">Medic</span>}
    </Link>
  );
}
