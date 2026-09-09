import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodIssue } from 'zod';

/**
 * Zod's own messages describe the SCHEMA, not the form: a blank required input
 * came back as "Too small: expected string to have >=1 characters" with no
 * field name at all, because the client only ever shows the first message and
 * the field name lived in the key beside it. On a 15-field store form that says
 * nothing about what to fix.
 *
 * Every message produced here therefore starts with the field it is about, and
 * the common cases are phrased the way the person filling the form would say
 * them. The details map is still keyed by field, so a client that wants to mark
 * individual inputs still can.
 */
function fieldName(issue: ZodIssue): string {
  return issue.path.length ? issue.path.join('.') : 'request body';
}

/** The submitted value at an issue's path — absent and wrongly-typed differ. */
function valueAt(body: unknown, path: ZodIssue['path']): unknown {
  let cur: unknown = body;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[String(key)];
  }
  return cur;
}

function describe(issue: ZodIssue, body: unknown): string {
  const field = fieldName(issue);
  const i = issue as ZodIssue & {
    expected?: string; origin?: string; format?: string;
    minimum?: number | bigint; maximum?: number | bigint;
  };
  switch (issue.code) {
    case 'invalid_type':
      // A missing key and a wrongly-typed one both land here. Only the first is
      // "required"; the second is a client bug and says so.
      return valueAt(body, issue.path) === undefined
        ? `${field} is required`
        : `${field} must be a ${i.expected ?? 'valid value'}`;
    case 'too_small': {
      const min = Number(i.minimum ?? 1);
      if (i.origin === 'string') {
        return min <= 1 ? `${field} must not be blank` : `${field} must be at least ${min} characters`;
      }
      return `${field} must be at least ${min}`;
    }
    case 'too_big': {
      const max = Number(i.maximum ?? 0);
      if (i.origin === 'string') return `${field} must be at most ${max} characters`;
      return `${field} must be at most ${max}`;
    }
    case 'invalid_format':
      return `${field} is not a valid ${i.format ?? 'value'}`;
    case 'invalid_value':
      return `${field} is not one of the allowed values`;
    default:
      // Anything else keeps Zod's wording, prefixed so it is still attributable.
      return `${field}: ${issue.message}`;
  }
}

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details: Record<string, string[]> = {};
      for (const issue of result.error.issues) {
        const field = fieldName(issue);
        (details[field] ??= []).push(describe(issue, req.body));
      }
      res.status(400).json({ error: 'Validation error', details });
      return;
    }
    req.body = result.data;
    next();
  };
}
