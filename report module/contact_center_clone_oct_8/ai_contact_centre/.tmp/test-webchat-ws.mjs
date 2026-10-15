import WebSocket from "ws";

const ws = new WebSocket(
  "ws://127.0.0.1:3002/ws/webchat?webchatId=wc_5d80cd9b1ace4080bc70717552472611&visitorId=v_test_ws",
);
ws.on("open", () => {
  console.log("open");
  ws.send(
    JSON.stringify({
      type: "session.start",
      webchatId: "wc_5d80cd9b1ace4080bc70717552472611",
      visitorId: "v_test_ws",
      pageUrl: "test",
      consent: { accepted: true },
    }),
  );
});
ws.on("message", (d) => console.log("msg", d.toString()));
ws.on("error", (e) => console.error("err", e.message));
ws.on("close", (c, r) => console.log("close", c, r.toString()));
setTimeout(() => {
  ws.close();
  process.exit(0);
}, 15000);
