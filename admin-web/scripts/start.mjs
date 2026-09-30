// Production start: the standalone server reads PORT (set by Railway) and HOSTNAME.
// Containers set HOSTNAME to the container id, which would bind only that interface, so bind all interfaces.
process.env.HOSTNAME = process.env.BIND_HOSTNAME || "0.0.0.0";
process.env.PORT = process.env.PORT || "3000";
await import("../.next/standalone/server.js");
