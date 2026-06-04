const http = require("http");
const https = require("https");

function ping(url, payload) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body = JSON.stringify(payload);
    const transport = parsed.protocol === "https:" ? https : http;
    const req = transport.request(
      parsed,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 10_000,
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`Heartbeat failed with status ${res.statusCode}`));
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("Heartbeat timed out"));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function startHeartbeat(config, getHealth) {
  if (!config.monitorHeartbeatUrl) {
    console.log("Heartbeat monitoring disabled.");
    return;
  }

  const minutes = Number(config.monitorHeartbeatMinutes);
  const intervalMs =
    Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1000 : 5 * 60 * 1000;

  const send = () => {
    ping(config.monitorHeartbeatUrl, {
      service: "mass-shift-coach",
      ...getHealth(),
      checkedAt: new Date().toISOString(),
    }).catch((error) => {
      console.error("Heartbeat monitor ping failed:", error.message);
    });
  };

  send();
  setInterval(send, intervalMs);
}

module.exports = { startHeartbeat };
