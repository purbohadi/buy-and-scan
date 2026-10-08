/** @type {import("jest").Config} */
module.exports = {
  projects: [
    {
      displayName: 'worker',
      testEnvironment: 'node',
      roots: ['<rootDir>/test'],
      testMatch: ['**/*.test.ts'],
      transform: {
        '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
      },
    },
    {
      displayName: 'app',
      testEnvironment: 'jsdom',
      roots: ['<rootDir>/test'],
      testMatch: ['**/*.test.tsx'],
      transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test-ui.json' }],
      },
      clearMocks: true,
    },
  ],
};
