// Declarative field validation. Returns a clean payload or throws 400 with every field error at once.
import { badRequest } from './http.ts';
import { ENUMS } from './enums.ts';

export type FieldType = 'text' | 'longtext' | 'email' | 'phone' | 'date' | 'datetime' | 'money' | 'int' | 'bool' | 'enum' | 'ref' | 'country';
export interface FieldDef {
  type: FieldType;
  label: string;
  required?: boolean;
  max?: number;
  options?: string;          // ENUMS key for type 'enum'
  pattern?: [RegExp, string];
}
export type Schema = Record<string, FieldDef>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9 ()-]{7,20}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

export function validDate(s: string) {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * @param partial when true (updates) only keys present in `input` are validated/returned.
 */
export function validate(schema: Schema, input: Record<string, unknown>, partial = false) {
  const out: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const [key, f] of Object.entries(schema)) {
    if (partial && !(key in input)) continue;
    let v = input[key];
    if (typeof v === 'string') v = v.trim();
    if (isEmpty(v)) {
      if (f.required) errors[key] = `${f.label} is required.`;
      else out[key] = f.type === 'bool' ? false : f.type === 'money' ? '0' : null;
      continue;
    }
    switch (f.type) {
      case 'text': case 'longtext': case 'country': {
        const s = String(v);
        const max = f.max ?? (f.type === 'longtext' ? 4000 : 150);
        if (s.length > max) errors[key] = `${f.label} must be at most ${max} characters.`;
        else if (f.pattern && !f.pattern[0].test(s)) errors[key] = f.pattern[1];
        else out[key] = s;
        break;
      }
      case 'email':
        if (!EMAIL.test(String(v)) || String(v).length > 150) errors[key] = 'Enter a valid email address.';
        else out[key] = String(v).toLowerCase();
        break;
      case 'phone':
        if (!PHONE.test(String(v))) errors[key] = 'Enter a valid phone number (digits, spaces, + and - only).';
        else out[key] = String(v);
        break;
      case 'date':
        if (!validDate(String(v))) errors[key] = `${f.label} must be a valid date.`;
        else out[key] = String(v);
        break;
      case 'datetime': {
        const m = String(v).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/);
        if (!m || !validDate(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59) errors[key] = `${f.label} must be a valid date and time.`;
        else out[key] = `${m[1]} ${m[2]}:${m[3]}`;
        break;
      }
      case 'money': {
        const s = String(v).replace(/,/g, '');
        if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) errors[key] = `${f.label} must be a non-negative amount with up to 2 decimals.`;
        else out[key] = s;
        break;
      }
      case 'int': case 'ref': {
        const n = Number(v);
        if (!Number.isInteger(n) || n <= 0) errors[key] = `Select a valid ${f.label.toLowerCase()}.`;
        else out[key] = n;
        break;
      }
      case 'bool':
        out[key] = v === true || v === 'true' || v === 1 || v === '1' || v === 'yes' || v === 'Yes';
        break;
      case 'enum': {
        const opts = ENUMS[f.options!] || [];
        if (!opts.some((o) => o.value === v)) errors[key] = `Select a valid ${f.label.toLowerCase()}.`;
        else out[key] = v;
        break;
      }
    }
  }
  if (Object.keys(errors).length) throw badRequest('Please correct the highlighted fields.', errors);
  return out;
}
