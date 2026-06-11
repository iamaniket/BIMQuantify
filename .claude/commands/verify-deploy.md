Run the full verification loop for a Docker-deployed change:

1. Run `pnpm type-check` serially across the affected package(s).
2. Run the relevant test suite serially (never concurrent pytest).
3. Rebuild and redeploy the affected Docker container: `docker compose up -d --build <service>`.
4. Confirm the new code is live by checking the container logs or hitting a health/status endpoint.

Report what passed, what was rebuilt, and any failures. If the service is the processor, check `docker compose logs processor --tail=20` after rebuild.
