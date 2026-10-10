/**
 * A short message that hangs just under a sticky header (pass it to BackHeader's `below`), so it is
 * seen wherever the page is scrolled without covering Back. An error from a prop near the bottom of
 * a long list used to show at the top of the page, out of view. Always one line: keep messages short,
 * and anything longer is cut with an ellipsis rather than wrapping.
 */
export function TopToast({ message, tone = 'error' }: { message: string | null; tone?: 'error' | 'info' }) {
  if (!message) return null;
  return (
    <div className="absolute inset-x-0 top-full flex justify-center px-4 pt-2 pointer-events-none">
      <p
        role="alert"
        className={`w-full max-w-md truncate whitespace-nowrap rounded-xl border bg-bg-raised px-3 py-2 text-xs font-semibold shadow-lg ${
          tone === 'error' ? 'border-loss/50 text-loss' : 'border-border text-text'
        }`}
      >
        {message}
      </p>
    </div>
  );
}
