import type {
  InputHTMLAttributes,
  ReactElement,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

interface FieldShellProps {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}

function FieldShell({ id, label, hint, children }: FieldShellProps): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="eyebrow">
        {label}
      </label>
      {children}
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-sm text-mute">
          {hint}
        </p>
      )}
    </div>
  );
}

const CONTROL =
  "w-full bg-paper text-ink font-body text-base shadow-pressed px-3 py-2.5 placeholder:text-mute focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  hint?: string;
}

export function TextField({
  id,
  label,
  hint,
  className = "",
  ...rest
}: TextFieldProps): ReactElement {
  return (
    <FieldShell id={id} label={label} hint={hint}>
      <input
        id={id}
        aria-describedby={hint !== undefined ? `${id}-hint` : undefined}
        className={`${CONTROL} ${className}`}
        {...rest}
      />
    </FieldShell>
  );
}

export interface TextAreaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  id: string;
  label: string;
  hint?: string;
}

export function TextArea({
  id,
  label,
  hint,
  className = "",
  ...rest
}: TextAreaProps): ReactElement {
  return (
    <FieldShell id={id} label={label} hint={hint}>
      <textarea
        id={id}
        aria-describedby={hint !== undefined ? `${id}-hint` : undefined}
        className={`${CONTROL} ${className}`}
        {...rest}
      />
    </FieldShell>
  );
}

export interface FileFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  id: string;
  label: string;
  hint?: string;
}

export function FileField({
  id,
  label,
  hint,
  className = "",
  ...rest
}: FileFieldProps): ReactElement {
  return (
    <FieldShell id={id} label={label} hint={hint}>
      <input
        id={id}
        type="file"
        aria-describedby={hint !== undefined ? `${id}-hint` : undefined}
        className={`${CONTROL} text-sm file:mr-4 file:cursor-pointer file:border-0 file:bg-transparent file:px-[22px] file:py-3 file:font-display file:text-[13px] file:font-semibold file:uppercase file:tracking-[0.06em] file:text-accent file:shadow-outline ${className}`}
        {...rest}
      />
    </FieldShell>
  );
}
