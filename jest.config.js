/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/src/**/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      { tsconfig: { types: ["node", "jest"], esModuleInterop: true } },
    ],
  },
};
