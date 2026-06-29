const cwd = process.env.MIAOJING_PROJECT_DIR || __dirname;

module.exports = {
  apps: [
    {
      name: 'miaojing-api',
      cwd,
      script: 'npm',
      args: 'run start',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '512M',
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        COZE_PROJECT_ENV: 'PROD',
        APP_RUNTIME_ROLE: 'backend',
        DEPLOY_RUN_PORT: '5100',
      },
    },
    {
      name: 'miaojing-web',
      cwd,
      script: 'npm',
      args: 'run start',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '512M',
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        COZE_PROJECT_ENV: 'PROD',
        APP_RUNTIME_ROLE: 'frontend',
        BACKEND_INTERNAL_URL: 'http://127.0.0.1:5100',
        CONSOLE_INTERNAL_URL: 'http://127.0.0.1:5200',
        DEPLOY_RUN_PORT: '5000',
      },
    },
    {
      name: 'miaojing-console',
      cwd,
      script: 'npm',
      args: 'run start',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '512M',
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        COZE_PROJECT_ENV: 'PROD',
        APP_RUNTIME_ROLE: 'console',
        DEPLOY_RUN_PORT: '5200',
      },
    },
  ],
};
