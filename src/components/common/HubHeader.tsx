import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

/** The label above a block on a hub screen: an icon, a name, and a chevron when the block opens
 *  something.
 *
 * One row, used by both hubs, because a screen of blocks only reads as categories if the categories
 * are announced the same way every time. Before this, Profile said "This week" in plain text while
 * its cards carried a blue "Markets →" link and the rows below them carried a chevron, which is
 * three different ways of saying the same thing on one screen (see chat, Oct 2026).
 *
 * The chevron is the same one the list rows use, at the same size, so "this opens" looks identical
 * wherever it appears. */
export function HubHeader({
  icon,
  title,
  right,
  chevron = false,
}: {
  icon?: ReactNode;
  title: string;
  /** Anything that belongs on the right instead of a chevron (a count, a button). */
  right?: ReactNode;
  chevron?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      {icon && <span className="text-text-muted shrink-0 flex items-center">{icon}</span>}
      <p className="font-semibold text-xs flex-1 min-w-0 truncate">{title}</p>
      {right}
      {chevron && <ChevronRight size={14} className="text-text-muted shrink-0" />}
    </div>
  );
}
