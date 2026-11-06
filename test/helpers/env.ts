Object.assign(process.env, {
  PUBLIC_BASE_URL: 'https://app.example.com', DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgres://unused:unused@localhost:5432/unused',
  GHL_CLIENT_ID: 'test-client', GHL_CLIENT_SECRET: 'test-secret', GHL_SHARED_SECRET: 'test-shared', GHL_APP_ID: 'test-app',
  ENCRYPTION_KEY: 'ab'.repeat(32), SESSION_SECRET: 'test-secret'.repeat(8),
  GOOGLE_CLIENT_ID: 'test-google', GOOGLE_CLIENT_SECRET: 'test-google-secret', OPENAI_API_KEY: 'test-ai-key', AI_MODEL: 'test-model',
  RESEND_API_KEY: 'test-email', EMAIL_FROM: 'Xaylo <signin@example.com>',
  STRIPE_SECRET_KEY: 'sk_test_xaylo', STRIPE_WEBHOOK_SECRET: 'whsec_test_xaylo', STRIPE_PRICE_ID: 'price_test',
  NODE_ENV: 'test', DEV_PREVIEW: 'false', FREE_TRIAL_DAYS: '7', FREE_REPORT_LOOKBACK_DAYS: '7', PAID_REPORTS_PER_MONTH: '30'
});
