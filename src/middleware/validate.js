import { ApiError } from '../utils/ApiError.js';

function formatZodError(error) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

function makeValidator(schema, source = 'body') {
  return (req, res, next) => {
    const input = req[source];
    const result = schema.safeParse(input);

    if (!result.success) {
      return next(new ApiError(400, 'Validation failed', formatZodError(result.error)));
    }

    req[source] = result.data;
    next();
  };
}

export const validateBody = (schema) => makeValidator(schema, 'body');
export const validateQuery = (schema) => makeValidator(schema, 'query');
export const validateParams = (schema) => makeValidator(schema, 'params');
