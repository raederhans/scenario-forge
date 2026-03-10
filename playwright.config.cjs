const path = require('path');

module.exports = {
  testDir: path.join(__dirname, 'tests', 'e2e'),
  outputDir: path.join(__dirname, '.runtime', 'tests', 'playwright'),
  reporter: 'list',
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
};
