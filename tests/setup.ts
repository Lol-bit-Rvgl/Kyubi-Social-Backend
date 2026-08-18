process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars-long!!';
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.SMTP_HOST = '';
