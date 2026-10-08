import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/** A password field with a show/hide toggle: eye-with-a-slash while the text is hidden, plain eye
 * while it is visible. Takes the same props as a normal input (minus type) and styles it with the
 * className passed in, leaving room on the right for the toggle. */
export function PasswordInput({ className = '', ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input {...rest} type={visible ? 'text' : 'password'} className={`${className} pr-10`} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 w-10 flex items-center justify-center text-text-muted"
      >
        {visible ? <Eye size={18} /> : <EyeOff size={18} />}
      </button>
    </div>
  );
}
