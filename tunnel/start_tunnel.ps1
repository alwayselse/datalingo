Write-Host "Starting SSH tunnels..."
ssh -N -f -L 5433:localhost:5432 -L 6333:localhost:6333 -L 6334:localhost:6334 datalingo-vps
Write-Host "Tunnels active. Postgres->5433, Qdrant->6333"
