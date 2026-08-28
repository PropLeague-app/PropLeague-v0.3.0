import { useEffect, useState } from 'react';

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'Kicked off';
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function CountdownTimer({ target, prefix = 'Kickoff in ' }: { target: string; prefix?: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const remaining = new Date(target).getTime() - now;
  return <span>{remaining <= 0 ? 'Kicked off' : `${prefix}${formatRemaining(remaining)}`}</span>;
}
