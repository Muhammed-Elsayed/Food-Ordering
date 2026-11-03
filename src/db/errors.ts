// Prisma's error code for a unique-index violation.
export const isUniqueViolation = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
