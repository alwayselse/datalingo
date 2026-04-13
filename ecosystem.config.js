module.exports = {
  apps: [
    {
      name: "datalingo-backend",
      cwd: "/home/deploy/datalingo/backend",
      script: "/home/deploy/datalingo/venv/bin/uvicorn",
      args: "app.main:app --host 127.0.0.1 --port 8000 --workers 2",
      interpreter: "none",
      env_file: "/home/deploy/datalingo/.env",
      watch: false,
      autorestart: true,
      max_restarts: 10,
    },
    {
      name: "datalingo-frontend",
      cwd: "/home/deploy/datalingo/frontend",
      script: "node_modules/.bin/next",
      args: "start --port 3000",
      interpreter: "none",
      env_file: "/home/deploy/datalingo/.env",
      watch: false,
      autorestart: true,
    },
    {
      name: "datalingo-embedding",
      cwd: "/home/deploy/embedding-service",
      script: "/home/deploy/datalingo/venv/bin/uvicorn",
      args: "main:app --host 127.0.0.1 --port 8001",
      interpreter: "none",
      watch: false,
      autorestart: true,
    }
  ]
}
