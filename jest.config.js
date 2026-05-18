module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test', '<rootDir>/tst'],
  testMatch: ['**/*.test.ts', '**/*.test.js'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  }
};
