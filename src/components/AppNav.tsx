'use client';

import {
  CalendarDays,
  Clock3,
  FileText,
  HeartPulse,
  LayoutDashboard,
  MessageSquare,
  ScrollText,
  Settings,
  ShieldAlert,
  Stethoscope,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export type NavIcon =
  | 'dashboard'
  | 'calendar'
  | 'availability'
  | 'messages'
  | 'documents'
  | 'allergies'
  | 'doctors'
  | 'users'
  | 'audit'
  | 'settings'
  | 'emergency';

export interface AppNavItem {
  href: string;
  label: string;
  icon?: NavIcon;
  danger?: boolean;
}

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  calendar: CalendarDays,
  availability: Clock3,
  messages: MessageSquare,
  documents: FileText,
  allergies: HeartPulse,
  doctors: Stethoscope,
  users: Users,
  audit: ScrollText,
  settings: Settings,
  emergency: ShieldAlert,
};

export function AppNav({ items, mobile = false }: { items: AppNavItem[]; mobile?: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigation principale"
      className={cn(
        mobile
          ? 'flex gap-2 overflow-x-auto px-4 pb-3'
          : 'flex flex-1 flex-col gap-1.5 px-4',
      )}
    >
      {items.map((item) => {
        const Icon = item.icon ? ICONS[item.icon] : LayoutDashboard;
        const active =
          pathname === item.href || (item.href !== '/p' && item.href !== '/d' && item.href !== '/admin' && pathname.startsWith(`${item.href}/`));

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group flex items-center gap-3 rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
              mobile ? 'shrink-0 px-3 py-2' : 'px-3 py-2.5',
              item.danger
                ? active
                  ? 'bg-red-50 text-red-700'
                  : 'text-red-600 hover:bg-red-50'
                : active
                  ? 'bg-brand-50 text-brand-800'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-navy-950',
            )}
          >
            <Icon
              className={cn(
                'h-[18px] w-[18px] shrink-0',
                active ? (item.danger ? 'text-red-600' : 'text-brand-600') : 'text-slate-400 group-hover:text-brand-600',
              )}
            />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
