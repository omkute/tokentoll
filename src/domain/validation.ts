export class DomainValidationError extends Error {
  readonly invalidPaths: readonly string[];

  constructor(invalidPaths: readonly string[]) {
    const uniquePaths = [...new Set(invalidPaths)];
    if (uniquePaths.length === 0) {
      throw new Error("Domain validation requires at least one invalid path");
    }

    super(`Invalid domain value: ${uniquePaths.join(", ")}`);
    this.name = "DomainValidationError";
    this.invalidPaths = Object.freeze(uniquePaths);
  }
}
