const appCwd = process.env.PARTNERX_PM2_CWD || process.cwd();

module.exports = {
  apps: [
    {
      name: 'partnerx',
      cwd: appCwd,
      script: 'npm',
      args: 'run start',
      env: {
        NODE_ENV: 'production'
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000
    }
  ]
};
