import "../scripts/load-env";

// Unit tests must run without any configuration.
process.env.AUTH_SECRET ??= "unit-test-secret-that-is-at-least-32-characters-long";
