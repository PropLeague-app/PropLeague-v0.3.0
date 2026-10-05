import type { LogoIdentity } from '../../types';
import { C } from '../palette';

/** A team or league logo drawn with inline styles only (the share canvas does not use Tailwind). */
export function ShareLogo({ identity, initials, size }: { identity: LogoIdentity | null; initials: string; size: number }) {
  const base = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: `2px solid ${C.border}`,
    boxSizing: 'border-box' as const,
    color: '#fff',
    fontWeight: 700,
  };
  if (identity?.logoMode === 'image' && identity.logoDataUrl) {
    return <img src={identity.logoDataUrl} alt="" style={{ ...base, objectFit: 'cover' }} />;
  }
  if (identity?.logoMode === 'emoji' && identity.logoEmoji) {
    return (
      <div style={{ ...base, backgroundColor: identity.logoColor, fontSize: size * 0.55, lineHeight: 1 }}>
        <span>{identity.logoEmoji}</span>
      </div>
    );
  }
  return (
    <div style={{ ...base, backgroundColor: identity?.logoColor ?? C.primary, fontSize: size * 0.36 }}>{initials}</div>
  );
}
