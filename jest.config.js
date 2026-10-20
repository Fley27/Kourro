module.exports = {
  testEnvironment: "jsdom",
  roots: ["<rootDir>"],
  testMatch: [
    "**/__tests__/**/*.{test,spec}.{ts,tsx,js}",
    "**/*.{test,spec}.{ts,tsx,js}",
  ],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  moduleNameMapper: {
    "^(\\./index)\\.js$": "$1.ts",
    "^(\\./mailer)\\.js$": "$1.ts",
    "^(\\.\\/\\./index)\\.js$": "$1.ts",
    "^(\\.\\/\\./mailer)\\.js$": "$1.ts",
    "^(\\.\\/\\./payroll)\\.js$": "$1.ts",
    "^react$": "<rootDir>/node_modules/react",
    "^react-dom$": "<rootDir>/node_modules/react-dom",
    "^react-dom/client$": "<rootDir>/node_modules/react-dom/client",
    "^react/jsx-runtime$": "<rootDir>/node_modules/react/jsx-runtime.js",
    "^react/jsx-dev-runtime$": "<rootDir>/node_modules/react/jsx-dev-runtime.js",
  },
  setupFiles: ["<rootDir>/jest.setup.js"],
  transform: {
    "^.+\\.(ts|tsx)$": "babel-jest",
  },
  transformIgnorePatterns: ["node_modules/(?!(.*)\\.mjs$)"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/android/", "/ios/", "/e2e/", "/shared/"],
  collectCoverageFrom: [
    "middleware/src/**/*.ts",
    "admin-portal/src/**/*.{ts,tsx}",
  ],
  coverageDirectory: "<rootDir>/coverage",
  coverageReporters: ["text", "lcov", "json"],
};
