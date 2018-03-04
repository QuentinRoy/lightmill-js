// Create a copy of an error with a header appended to its message.
export const errorWithHeader = (e, header) => {
  const err = new Error(e.message ? `${header}: ${e.message}` : header);
  err.original = e;
  err.stack = e.stack;
  if (e.type) err.type = e.type;
  return err;
};

// Return a function that will re-throw an error after appending a header.
export const throwWithHeader = header => e => {
  throw errorWithHeader(e, header);
};
